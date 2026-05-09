import os
# Suppress ONNX Runtime's CUDA-DLL-not-found noise.  rembg uses ORT and tries
# the CUDA provider first even when only CPU is available, producing a loud
# but harmless error.  Setting this before any ORT import silences it.
os.environ.setdefault("ORT_LOGGING_LEVEL", "4")   # 4 = FATAL only

import warnings
warnings.filterwarnings("ignore", category=FutureWarning, module="transformers")
warnings.filterwarnings("ignore", category=FutureWarning, module="diffusers")
warnings.filterwarnings("ignore", message=".*_register_pytree_node.*", category=FutureWarning)
warnings.filterwarnings("ignore", message=".*weights_only.*", category=FutureWarning)
warnings.filterwarnings("ignore", message=".*CLIPFeatureExtractor.*", category=FutureWarning)
warnings.filterwarnings("ignore", message=".*text_config_dict.*")

import torch
import io
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Response, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field, EmailStr
import uvicorn
from PIL import Image, ImageChops, ImageFilter
from torchvision import transforms
import os
import base64
import cv2
import numpy as np
import time
import re
from datetime import datetime, timezone, timedelta
from contextlib import asynccontextmanager
from typing import Optional, Any
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError
from bson import ObjectId
from dotenv import load_dotenv
from jose import jwt, JWTError
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHash
# IMPORTANT: This import requires the 'networks.py' file from the original
# pix2pix repo to be in the same directory as this script.
from networks import UnetGenerator
script_dir = os.path.dirname(__file__)
load_dotenv(os.path.join(script_dir, ".env"))

import sys
stylebend_path = os.path.join(script_dir, 'stylebend')
if stylebend_path not in sys.path:
    sys.path.append(stylebend_path)

from scripts.inversion import load_model, project_image, resolve_device
from scripts.blending import blend_latents

# ── Shared CPU-only rembg session ────────────────────────────────────────────
# Explicitly requesting CPUExecutionProvider prevents ORT from even attempting
# to load the CUDA DLL, which would otherwise log a loud error on machines that
# have onnxruntime-gpu installed but no matching CUDA toolkit.
_rembg_session = None
def get_rembg_session():
    global _rembg_session
    if _rembg_session is None:
        from rembg import new_session
        _rembg_session = new_session("u2net", providers=["CPUExecutionProvider"])
    return _rembg_session

def rembg_remove_cpu(data):
    from rembg import remove as _remove
    return _remove(data, session=get_rembg_session())
# ─────────────────────────────────────────────────────────────────────────────

MONGODB_URI = os.getenv("MONGODB_URI") or os.getenv("MONGO_URI") or "mongodb://127.0.0.1:27017"
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME") or os.getenv("MONGO_DB_NAME") or "clothcraft_ai"
MONGODB_REQUIRED = os.getenv("MONGODB_REQUIRED", "false").lower() == "true"
MONGODB_CONNECT_TIMEOUT_MS = int(os.getenv("MONGODB_CONNECT_TIMEOUT_MS", "5000"))
MONGODB_CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,"
        "http://localhost:5173,http://127.0.0.1:5173,"
        "https://cloth-craft-ai.vercel.app",
    ).split(",")
    if origin.strip()
]

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-change-me")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))
AUTH_COOKIE_NAME = os.getenv("AUTH_COOKIE_NAME", "cc_auth")
AUTH_COOKIE_SECURE = os.getenv("AUTH_COOKIE_SECURE", "false").lower() == "true"
AUTH_COOKIE_SAMESITE = os.getenv("AUTH_COOKIE_SAMESITE", "lax")

password_hasher = PasswordHasher()


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def utc_timestamp_ms() -> int:
    return int(time.time() * 1000)


def parse_object_id(raw_id: str) -> ObjectId:
    try:
        return ObjectId(raw_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid project id") from exc


def serialize_project(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(doc["_id"]),
        "userId": doc["userId"],
        "name": doc["name"],
        "createdAt": doc["createdAt"],
        "updatedAt": doc["updatedAt"],
        "thumbnail": doc.get("thumbnail"),
        "layersSnapshot": doc.get("layersSnapshot"),
    }


def serialize_user(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(doc["_id"]),
        "email": doc["email"],
        "displayName": doc["displayName"],
        "avatarUrl": doc.get("avatarUrl"),
        "createdAt": doc["createdAt"],
    }


def normalize_project_name(name: str) -> str:
    return " ".join(name.strip().lower().split())


def build_name_conflict_filter(user_id: str, normalized_name: str, raw_name: str, exclude_id: Optional[ObjectId] = None) -> dict[str, Any]:
    trimmed = raw_name.strip()
    escaped = re.escape(trimmed)
    conflict_filter: dict[str, Any] = {
        "userId": user_id,
        "$or": [
            {"nameNormalized": normalized_name},
            {"name": {"$regex": rf"^\s*{escaped}\s*$", "$options": "i"}},
        ],
    }
    if exclude_id is not None:
        conflict_filter["_id"] = {"$ne": exclude_id}
    return conflict_filter


def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {
        "sub": user_id,
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=AUTH_COOKIE_SECURE,
        samesite=AUTH_COOKIE_SAMESITE,
        max_age=JWT_EXPIRE_MINUTES * 60,
        path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(
        key=AUTH_COOKIE_NAME,
        httponly=True,
        secure=AUTH_COOKIE_SECURE,
        samesite=AUTH_COOKIE_SAMESITE,
        path="/",
    )


class MongoManager:
    def __init__(self, uri: str, db_name: str, timeout_ms: int = 5000):
        self.uri = uri
        self.db_name = db_name
        self.timeout_ms = timeout_ms
        self.client: Optional[AsyncIOMotorClient] = None
        self.db: Optional[AsyncIOMotorDatabase] = None

    async def connect(self) -> None:
        self.client = AsyncIOMotorClient(self.uri, serverSelectionTimeoutMS=self.timeout_ms)
        await self.client.admin.command("ping")
        self.db = self.client[self.db_name]
        await self._ensure_indexes()

    async def disconnect(self) -> None:
        if self.client is not None:
            self.client.close()
        self.client = None
        self.db = None

    async def _ensure_indexes(self) -> None:
        if self.db is None:
            return
        await self.db["users"].create_index([("email", ASCENDING)], unique=True)
        await self.db["projects"].create_index([
            ("userId", ASCENDING),
            ("updatedAt", DESCENDING),
        ])
        await self.db["projects"].create_index([
            ("userId", ASCENDING),
            ("nameNormalized", ASCENDING),
        ], unique=True, partialFilterExpression={"nameNormalized": {"$type": "string"}})
        await self.db["generation_logs"].create_index([("createdAt", DESCENDING)])


class ProjectCreate(BaseModel):
    name: str = Field(default="Untitled Design", min_length=1, max_length=120)


class ProjectSave(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    thumbnail: Optional[str] = None
    layersSnapshot: Optional[str] = None


class ProjectRename(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    displayName: str = Field(min_length=1, max_length=120)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UpdateProfileRequest(BaseModel):
    displayName: Optional[str] = Field(None, min_length=1, max_length=120)
    avatarUrl: Optional[str] = None  # base64 data URL, max ~150 KB


class ChangePasswordRequest(BaseModel):
    currentPassword: str = Field(min_length=1, max_length=128)
    newPassword: str = Field(min_length=8, max_length=128)


@asynccontextmanager
async def lifespan(_: FastAPI):
    mongo = MongoManager(MONGODB_URI, MONGODB_DB_NAME, MONGODB_CONNECT_TIMEOUT_MS)
    try:
        await mongo.connect()
        print(f"✅ MongoDB connected: db='{MONGODB_DB_NAME}'")
    except Exception as exc:
        mongo = MongoManager(MONGODB_URI, MONGODB_DB_NAME, MONGODB_CONNECT_TIMEOUT_MS)
        print(f"⚠️ MongoDB connection failed: {exc}")
        if MONGODB_REQUIRED:
            raise RuntimeError("MongoDB connection is required but unavailable") from exc

    app.state.mongo = mongo
    yield
    await mongo.disconnect()

# --- 1. CONFIGURATION ---
# Pix2Pix model for doodle translation
MODEL_PATH = os.path.join(script_dir, 'models', 'pix2pix.pth')
INPUT_NC = 3
OUTPUT_NC = 3
NGF = 64
NORM_LAYER = torch.nn.BatchNorm2d
USE_DROPOUT = True

# Stable Diffusion model (Realistic Vision — standard SD 1.5, NOT an inpainting checkpoint)
SD_MODEL_PATH = os.path.join(script_dir, 'models', 'realisticVisionV60B1_v51VAE.safetensors')

# StyleGAN model for style blending
STYLEGAN_MODEL_PATH = os.path.join(script_dir, 'models', 'stylegan_human_v2_1024.pkl')

if torch.cuda.is_available():
    device = "cuda"
elif torch.backends.mps.is_available():
    device = "mps"
else:
    device = "cpu"
print(f"Using device: {device}")

# --- 2. INITIALIZE FASTAPI APP AND LOAD MODELS ---
app = FastAPI(title="ClothCraft AI", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)


async def get_current_user(request: Request) -> dict[str, Any]:
    mongo: MongoManager = app.state.mongo
    if mongo.db is None:
        raise HTTPException(status_code=503, detail="Database is not connected")

    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip() if auth_header.startswith("Bearer ") else None
    if not token:
        token = request.cookies.get(AUTH_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid authentication token")
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid authentication token") from exc

    try:
        oid = parse_object_id(user_id)
    except HTTPException as exc:
        raise HTTPException(status_code=401, detail="Invalid authentication token") from exc
    user_doc = await mongo.db["users"].find_one({"_id": oid})
    if user_doc is None:
        raise HTTPException(status_code=401, detail="User account not found")
    return user_doc

# Load Pix2Pix model for doodle translation
try:
    pix2pix_model = UnetGenerator(INPUT_NC, OUTPUT_NC, 8, NGF, NORM_LAYER, USE_DROPOUT)
    pix2pix_model.load_state_dict(torch.load(MODEL_PATH, map_location=device, weights_only=False))
    pix2pix_model.to(device)
    pix2pix_model.eval()
    print("✅ Pix2Pix model loaded successfully!")
except FileNotFoundError:
    print(f"⚠️  Pix2Pix model not found at {MODEL_PATH} — doodle translation disabled.")
    pix2pix_model = None
except Exception as e:
    print(f"⚠️  Error loading Pix2Pix model: {e} — doodle translation disabled.")
    pix2pix_model = None

# Load Stable Diffusion Img2Img model for Clothify feature
# Realistic Vision is a standard SD 1.5 model (4-ch), NOT an inpainting model (9-ch),
# so we must use StableDiffusionImg2ImgPipeline instead of the Inpaint pipeline.
txt2img_pipe = None
try:
    from diffusers import StableDiffusionImg2ImgPipeline, StableDiffusionPipeline
    print("Loading Stable Diffusion model...")
    sd_pipe = StableDiffusionImg2ImgPipeline.from_single_file(
        SD_MODEL_PATH,
        torch_dtype=torch.float16 if device in ["cuda", "mps"] else torch.float32,
        safety_checker=None,
        requires_safety_checker=False
    ).to(device)

    if hasattr(sd_pipe, 'safety_checker'):
        sd_pipe.safety_checker = None

    # Build a txt2img pipeline that shares all the same model weights (no extra VRAM).
    # img2img with any initial image always encodes that image through the VAE first,
    # which biases generation toward the input's colors even at strength=1.0.
    # A proper txt2img pipeline starts from pure scheduler noise with no image latent.
    txt2img_pipe = StableDiffusionPipeline(
        vae=sd_pipe.vae,
        text_encoder=sd_pipe.text_encoder,
        tokenizer=sd_pipe.tokenizer,
        unet=sd_pipe.unet,
        scheduler=sd_pipe.scheduler,
        safety_checker=None,
        feature_extractor=getattr(sd_pipe, 'feature_extractor', None),
        requires_safety_checker=False,
    )

    print("✅ Stable Diffusion model loaded successfully!")
except FileNotFoundError:
    print(f"⚠️  SD model not found at {SD_MODEL_PATH} — img2img disabled.")
    sd_pipe = None
except Exception as e:
    print(f"⚠️  Error loading SD model: {e} — img2img disabled.")
    sd_pipe = None

# Load StyleGAN-Human model
try:
    print("Loading StyleGAN-Human model...")
    stylegan_model = load_model(STYLEGAN_MODEL_PATH, device)
    print("✅ StyleGAN model loaded successfully!")
except FileNotFoundError:
    print(f"❌ Error: StyleGAN model not found at {STYLEGAN_MODEL_PATH}")
    stylegan_model = None
except Exception as e:
    print(f"❌ Error loading StyleGAN model: {e}")
    stylegan_model = None


# Define the image transformations (should match training)
transform = transforms.Compose([
    transforms.Resize((256, 256)), # Matches 'crop_size: 256'
    transforms.ToTensor(),
    transforms.Normalize((0.5, 0.5, 0.5), (0.5, 0.5, 0.5))
])


async def log_generation_event(
    endpoint: str,
    status: str,
    duration_ms: int,
    metadata: Optional[dict[str, Any]] = None,
    error: Optional[str] = None,
) -> None:
    mongo: MongoManager = app.state.mongo
    if mongo.db is None:
        return
    try:
        await mongo.db["generation_logs"].insert_one({
            "endpoint": endpoint,
            "status": status,
            "durationMs": duration_ms,
            "metadata": metadata or {},
            "error": error,
            "createdAt": now_utc(),
        })
    except Exception as exc:
        # Logging must never fail the user-facing request.
        print(f"⚠️ Failed to write generation log: {exc}")



# ── Clothing/body parsing model (SegFormer fine-tuned on ATR dataset) ──────
# Labels:
#   0 Background, 1 Hat, 2 Hair, 3 Sunglasses, 4 Upper-clothes, 5 Skirt,
#   6 Pants, 7 Dress, 8 Belt, 9 Left-shoe, 10 Right-shoe, 11 Face,
#   12 Left-leg, 13 Right-leg, 14 Left-arm, 15 Right-arm, 16 Bag, 17 Scarf
_BODY_PART_LABELS = {2, 11, 12, 13, 14, 15}  # Hair, Face, legs, arms

_clothes_seg = None
def _get_clothes_segmenter():
    """Lazy-load the SegFormer clothing segmentation model (cached)."""
    global _clothes_seg
    if _clothes_seg is None:
        from transformers import SegformerImageProcessor, AutoModelForSemanticSegmentation
        print("   ⚙️  Loading clothing segmentation model (mattmdjaga/segformer_b2_clothes)...")
        processor = SegformerImageProcessor.from_pretrained("mattmdjaga/segformer_b2_clothes")
        model     = AutoModelForSemanticSegmentation.from_pretrained("mattmdjaga/segformer_b2_clothes")
        model.eval()
        _clothes_seg = (processor, model)
    return _clothes_seg


def _erase_body_parts(rgb_arr, alpha):
    """Pixel-accurate body-part erasure using SegFormer clothing parser.

    Per-pixel labels for face, hair, arms, legs are zeroed in alpha — clothing
    pixels survive untouched. No rectangles, no color heuristics.
    """
    try:
        processor, model = _get_clothes_segmenter()
        h, w = rgb_arr.shape[:2]

        pil_rgb = Image.fromarray(rgb_arr)
        with torch.no_grad():
            inputs  = processor(images=pil_rgb, return_tensors="pt")
            logits  = model(**inputs).logits  # [1, num_labels, h_logits, w_logits]
            up      = torch.nn.functional.interpolate(
                logits, size=(h, w), mode="bilinear", align_corners=False
            )
            pred    = up.argmax(dim=1)[0].cpu().numpy()  # (h, w) int

        # Build a body-parts mask (True where pixel is face/hair/arms/legs)
        body_mask = np.isin(pred, list(_BODY_PART_LABELS))

        # Light dilation so we also catch the 1–2 px boundary between
        # skin and clothing (e.g. collar/cuff edges).
        body_u8 = body_mask.astype(np.uint8) * 255
        body_u8 = cv2.dilate(body_u8, np.ones((5, 5), np.uint8), iterations=1)
        # Soft feather so the cut isn't pixel-sharp.
        body_u8 = cv2.GaussianBlur(body_u8, (11, 11), 0)

        erase_weight = body_u8.astype(np.float32) / 255.0
        return (alpha.astype(np.float32) * (1.0 - erase_weight)).astype(np.uint8)

    except Exception as e:
        print(f"   ⚠️ Body-part erasure failed ({e}) — skipping.")
        return alpha


def extract_doodle_from_image(img_bytes, num_colors=6):
    """Convert a clothing/fashion image into an editable flat-color doodle.

    Pipeline:
      1. rembg          — strip scene background, keep full subject.
      2. SegFormer      — per-pixel parse: erase face / hair / arms / legs.
      3. Smooth         — bilateral + median blur to flatten texture and wrinkles.
      4. K-means        — reduce to N flat colors (default 6).
      5. Output         — RGBA PNG with transparent background.
    """
    pil_in = Image.open(io.BytesIO(img_bytes)).convert('RGB')
    rgb = np.array(pil_in)
    h, w = rgb.shape[:2]

    # ── 1. Remove scene background ────────────────────────────────────────
    try:
        cut_bytes = rembg_remove_cpu(img_bytes)
        cut_pil = Image.open(io.BytesIO(cut_bytes)).convert('RGBA')
        if cut_pil.size != (w, h):
            cut_pil = cut_pil.resize((w, h), Image.LANCZOS)
        cut_arr = np.array(cut_pil)
        alpha = cut_arr[:, :, 3].copy()
        rgb   = cut_arr[:, :, :3]
    except Exception as e:
        print(f"   ⚠️ rembg unavailable ({e}) — using brightness fallback.")
        gray  = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        alpha = np.where(gray < 245, 255, 0).astype(np.uint8)

    # ── 2. Erase face / hair / arms / legs (per-pixel SegFormer clothing parser) ──
    alpha = _erase_body_parts(rgb, alpha)

    # ── 3. Smooth to flatten texture / wrinkles ───────────────────────────
    smooth = cv2.bilateralFilter(rgb, 9, 80, 80)
    smooth = cv2.medianBlur(smooth, 5)

    # ── 4. K-means color quantization on remaining foreground pixels ──────
    n_colors = max(2, min(int(num_colors), 16))
    fg_mask  = alpha > 32

    if fg_mask.sum() < n_colors:
        out_rgba = np.zeros((h, w, 4), dtype=np.uint8)
    else:
        fg_pixels = smooth[fg_mask].reshape(-1, 3).astype(np.float32)
        criteria  = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 12, 1.0)
        _, labels, centers = cv2.kmeans(
            fg_pixels, n_colors, None, criteria, 3, cv2.KMEANS_PP_CENTERS
        )
        centers = centers.astype(np.uint8)
        flat = np.zeros_like(smooth)
        flat[fg_mask] = centers[labels.flatten()]

        out_rgba = np.dstack([flat, alpha])
        out_rgba[~fg_mask] = (0, 0, 0, 0)

    out_pil = Image.fromarray(out_rgba, mode='RGBA')
    buf = io.BytesIO()
    out_pil.save(buf, format='PNG')
    buf.seek(0)
    return buf


def translate_doodle(doodle_bytes, return_rgba=False, fast=False):
    """Translates doodle using Pix2Pix model.

    return_rgba=True  → returns an RGBA PNG with real transparency.
    fast=True         → skips rembg (heavy neural net); uses fast threshold BG removal instead.
                        Ideal for live preview where speed matters more than perfect edges.
    return_rgba=False → composites onto black and returns RGB PNG (legacy behaviour).
    """
    print(f"🎨 Running Pix2Pix doodle translation (fast={fast})...")

    original = Image.open(io.BytesIO(doodle_bytes))

    if original.mode == 'RGBA':
        image = Image.new("RGB", original.size, (255, 255, 255))
        image.paste(original, mask=original.split()[3])
    else:
        image = original.convert('RGB')

    input_tensor = transform(image).unsqueeze(0).to(device)

    with torch.no_grad():
        output_tensor = pix2pix_model(input_tensor)

    output_image = output_tensor.squeeze(0).cpu()
    output_image = (output_image * 0.5) + 0.5
    output_image = transforms.ToPILImage()(output_image)

    if fast and return_rgba:
        # Fast path: threshold-based BG removal, no rembg neural net.
        out_np = np.array(output_image)
        alpha_mask = (np.max(out_np, axis=2) > 20).astype(np.uint8) * 255
        out_rgba = np.dstack([out_np, alpha_mask])
        byte_io = io.BytesIO()
        Image.fromarray(out_rgba, 'RGBA').save(byte_io, 'PNG')
        byte_io.seek(0)
        return byte_io

    try:
        print("   🪄 Removing Pix2Pix background using rembg...")

        temp_io = io.BytesIO()
        output_image.save(temp_io, format="PNG")
        result_bytes = rembg_remove_cpu(temp_io.getvalue())
        output_rgba = Image.open(io.BytesIO(result_bytes)).convert("RGBA")

        if return_rgba:
            byte_io = io.BytesIO()
            output_rgba.save(byte_io, 'PNG')
            byte_io.seek(0)
            return byte_io

        # Legacy: composite onto black for Clothify's skip-black pixel logic.
        black_bg = Image.new("RGBA", output_rgba.size, (0, 0, 0, 255))
        black_bg.paste(output_rgba, mask=output_rgba.split()[3])
        output_image = black_bg.convert("RGB")
        print("   ✅ Background cleanup complete.")
    except Exception as e:
        print(f"   ⚠️ Background cleanup failed ({e}) — returning raw model output.")

    byte_io = io.BytesIO()
    output_image.save(byte_io, 'PNG')
    byte_io.seek(0)
    return byte_io

def inpaint_with_stable_diffusion(reference_image_bytes, mask_bytes, prompt="", strength=0.75):
    """Inpaints reference image using Stable Diffusion Img2Img with manual mask compositing.
    
    Because we use a standard (non-inpainting) SD model, we simulate inpainting by:
    1. Adding noise/white to the masked region of the input image
    2. Running img2img so the model regenerates that region
    3. Compositing the result back: keep original pixels outside the mask
    """
    if sd_pipe is None:
        raise Exception("Stable Diffusion model not loaded")
    
    # Load reference image with Alpha channel
    original_rgba = Image.open(io.BytesIO(reference_image_bytes)).convert('RGBA')
    
    # Composite onto pure white background so SD doesn't see black voids
    reference_image = Image.new("RGB", original_rgba.size, (255, 255, 255))
    reference_image.paste(original_rgba, mask=original_rgba.split()[3])

    # The mask passed here is the Pix2Pix output (RGB with black background).
    # If we simply convert to Grayscale ('L'), colors like red or cyan become gray,
    # causing transparency in the mask and creating a "fade" or ghosting effect.
    # Instead, we threshold it: any pixel that isn't black becomes solid white in the mask.
    pix2pix_img = Image.open(io.BytesIO(mask_bytes)).convert('RGB')
    p2p_np = np.array(pix2pix_img)
    # Brightness threshold to detect the object vs black background
    mask_np_raw = (np.max(p2p_np, axis=2) > 20).astype(np.uint8) * 255
    mask_image = Image.fromarray(mask_np_raw, mode='L')
    
    # Resize to optimal size for SD (512x512 recommended)
    original_size = reference_image.size
    reference_image = reference_image.resize((512, 512), Image.LANCZOS)
    
    # Resize mask with BILINEAR (LANCZOS can create ringing on masks)
    # Then apply a slight Gaussian blur to smooth the transition for the AI
    # Keep radius small (2) just for anti-aliasing the sharp threshold
    mask_image = mask_image.resize((512, 512), Image.BILINEAR)
    mask_image = mask_image.filter(ImageFilter.GaussianBlur(radius=2))
    
    # --- img2img approach ---
    # The frontend already composited the Pix2Pix translated doodle onto the
    # reference image, so `reference_image` already contains the desired design
    # (e.g. the red shirt) in the masked region.  We pass it directly to img2img
    # so SD refines/blends what's already there instead of starting from white.
    mask_np = np.array(mask_image).astype(np.float32) / 255.0  # 0.0–1.0
    
    # Use prompt directly without forcing clothing/fabric keywords
    enhanced_prompt = prompt if prompt else "high quality, detailed"
    
    # Negative prompt to protect face and maintain quality
    negative_prompt = "face changes, facial features, distorted face, blurry face, deformed face, bad anatomy, low quality, blurry, distorted"
    
    print(f"🎚️ Img2Img inpainting with strength: {strength}")
    print(f"📝 Prompt: {enhanced_prompt}")
    print(f"🚫 Negative prompt: {negative_prompt}")
    
    # Run img2img directly on the composited reference (already has doodle on it)
    result = sd_pipe(
        prompt=enhanced_prompt,
        negative_prompt=negative_prompt,
        image=reference_image,
        strength=float(strength),
        num_inference_steps=50,
        guidance_scale=7.5,
    ).images[0]
    
    # --- Composite back: keep original pixels outside the mask ---
    ref_np = np.array(reference_image).astype(np.float32)
    result_np = np.array(result.resize((512, 512), Image.LANCZOS)).astype(np.float32)
    final_np = ref_np * (1.0 - mask_np[..., None]) + result_np * mask_np[..., None]
    composited = Image.fromarray(final_np.astype(np.uint8))
    
    # Resize back to original size and restore the original alpha channel
    composited = composited.resize(original_size, Image.LANCZOS).convert('RGBA')
    composited.putalpha(original_rgba.split()[3])
    
    # Save to byte buffer
    byte_io = io.BytesIO()
    composited.save(byte_io, 'PNG')
    byte_io.seek(0)
    
    return byte_io

def outpaint_to_full_body(img_pil):
    """
    Takes a half-body or bust-shot image and extends it to a 512x1024 full-body canvas.
    
    Strategy: Detect the background color from the image edges and fill the bottom
    with that color, blending softly at the seam. This ensures ZERO changes to the
    fashion in the original image — the top half is preserved pixel-perfectly.
    """
    import numpy as np

    img_pil = img_pil.convert("RGB")
    img_w, img_h = img_pil.size

    canvas_w, canvas_h = 512, 1024

    # ---------------------------------------------------------------
    # Step 1: Remove background using rembg (if available)
    # This makes the image match the SHHQ training distribution
    # which has clean white backgrounds
    # ---------------------------------------------------------------
    try:
        print("   🪄 Removing background using rembg...")
        img_bytes_io = io.BytesIO()
        img_pil.save(img_bytes_io, format="PNG")
        img_bytes_val = img_bytes_io.getvalue()
        result_bytes = rembg_remove_cpu(img_bytes_val)
        img_rgba = Image.open(io.BytesIO(result_bytes)).convert("RGBA")

        # Place the cutout (alpha-composited) on a pure WHITE background
        white_bg = Image.new("RGBA", img_rgba.size, (255, 255, 255, 255))
        white_bg.paste(img_rgba, mask=img_rgba.split()[3])  # use alpha mask
        img_pil = white_bg.convert("RGB")
        img_w, img_h = img_pil.size
        print("   ✅ Background removed successfully.")
    except ImportError:
        print("   ⚠️ rembg not installed — using background-fill fallback.")
    except (Exception, SystemExit) as e:
        print(f"   ⚠️ rembg failed ({e}) — using background-fill fallback.")

    # ---------------------------------------------------------------
    # Step 2: Scale and center onto 512x1024 white canvas
    # ---------------------------------------------------------------
    # Scale so the person fills the canvas vertically (use up to 95% height)
    scale_by_h = (canvas_h * 0.95) / img_h
    scale_by_w = canvas_w / img_w
    scale = min(scale_by_h, scale_by_w)  # fit without cropping

    new_w = int(img_w * scale)
    new_h = int(img_h * scale)

    scaled_img = img_pil.resize((new_w, new_h), Image.LANCZOS)

    # Create white canvas
    canvas = Image.new("RGB", (canvas_w, canvas_h), (255, 255, 255))

    # Center horizontally, and center vertically.
    # Bottom-aligning pushes the head too low on 512x768 inputs, which completely 
    # breaks the StyleGAN perceptual face loss (which targets the top 25% of the canvas).
    x_offset = (canvas_w - new_w) // 2
    y_offset = (canvas_h - new_h) // 2

    canvas.paste(scaled_img, (x_offset, y_offset))

    print(f"✅ Normalized to 512x1024 white canvas (scale={scale:.2f})")
    return canvas

# --- 3. DEFINE API ENDPOINTS ---

# Route for translating doodle with Pix2Pix
@app.post('/translate-doodle')
async def translate_doodle_endpoint(
    file: UploadFile = File(...),
    rgba: bool = Query(False, description="Return RGBA PNG with real transparency instead of black-background RGB"),
    fast: bool = Query(False, description="Skip rembg; use threshold BG removal for low-latency live preview"),
):
    """Translates doodle using Pix2Pix model"""
    start = time.perf_counter()
    try:
        img_bytes = await file.read()
        result_bytes = translate_doodle(img_bytes, return_rgba=rgba, fast=fast)
        await log_generation_event(
            endpoint="translate-doodle",
            status="success",
            duration_ms=int((time.perf_counter() - start) * 1000),
            metadata={"filename": file.filename},
        )
        return StreamingResponse(result_bytes, media_type='image/png')
    except Exception as e:
        print(f"Error translating doodle: {e}")
        await log_generation_event(
            endpoint="translate-doodle",
            status="error",
            duration_ms=int((time.perf_counter() - start) * 1000),
            metadata={"filename": file.filename},
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))

@app.post('/extract-doodle')
async def extract_doodle_endpoint(
    file: UploadFile = File(...),
    num_colors: int = Query(6, description="Number of flat colors in the quantized output (2-16)"),
):
    """Convert a clothing image into an editable flat-color 'doodle' (clothing only).

    Uses rembg to keep only the garment, then k-means color quantization to
    flatten it into a few solid colors. Output is RGBA PNG with transparent BG.
    """
    start = time.perf_counter()
    try:
        img_bytes = await file.read()
        result_bytes = extract_doodle_from_image(img_bytes, num_colors=num_colors)
        await log_generation_event(
            endpoint="extract-doodle",
            status="success",
            duration_ms=int((time.perf_counter() - start) * 1000),
            metadata={"filename": file.filename, "num_colors": num_colors},
        )
        return StreamingResponse(result_bytes, media_type='image/png')
    except Exception as e:
        print(f"Error extracting doodle: {e}")
        await log_generation_event(
            endpoint="extract-doodle",
            status="error",
            duration_ms=int((time.perf_counter() - start) * 1000),
            metadata={"filename": file.filename},
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))


# Route for inpainting with Stable Diffusion
@app.post('/inpaint')
async def inpaint(
    reference: UploadFile = File(...),
    mask: UploadFile = File(...),
    prompt: str = Form('high quality, detailed'),
    strength: str = Form('0.75'),
):
    """Inpaints reference image using Stable Diffusion with translated doodle as mask"""
    print("👕 Starting Clothify Inpainting...")
    start = time.perf_counter()
    try:
        reference_bytes = await reference.read()
        mask_bytes = await mask.read()
        result_bytes = inpaint_with_stable_diffusion(
            reference_bytes,
            mask_bytes,
            prompt,
            float(strength)
        )
        await log_generation_event(
            endpoint="inpaint",
            status="success",
            duration_ms=int((time.perf_counter() - start) * 1000),
            metadata={"prompt": prompt, "strength": strength},
        )
        return StreamingResponse(result_bytes, media_type='image/png')
    except Exception as e:
        print(f"Error inpainting: {e}")
        await log_generation_event(
            endpoint="inpaint",
            status="error",
            duration_ms=int((time.perf_counter() - start) * 1000),
            metadata={"prompt": prompt, "strength": strength},
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))

# Legacy endpoint (kept for backward compatibility)
@app.post('/predict')
async def predict(file: UploadFile = File(...)):
    """Legacy endpoint - redirects to translate-doodle"""
    return await translate_doodle_endpoint(file)

# Route for refining pattern
@app.post('/refine-pattern')
async def refine_pattern_endpoint(
    image: UploadFile = File(...),
    prompt: str = Form('seamless pattern, high quality'),
    strength: str = Form('0.6'),
):
    """Refines a pattern using Stable Diffusion (img2img via inpainting)"""
    print("✨ Starting Pattern Refinement...")
    start = time.perf_counter()
    try:
        image_bytes = await image.read()
        
        # Create a full white mask for the image
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        mask = Image.new("L", img.size, 255)  # White mask = inpaint everything
        
        mask_io = io.BytesIO()
        mask.save(mask_io, format="PNG")
        mask_bytes = mask_io.getvalue()
        
        result_bytes = inpaint_with_stable_diffusion(
            image_bytes,
            mask_bytes,
            prompt,
            strength=float(strength)
        )
        await log_generation_event(
            endpoint="refine-pattern",
            status="success",
            duration_ms=int((time.perf_counter() - start) * 1000),
            metadata={"prompt": prompt, "strength": strength},
        )
        return StreamingResponse(result_bytes, media_type='image/png')
    except Exception as e:
        print(f"Error refining pattern: {e}")
        await log_generation_event(
            endpoint="refine-pattern",
            status="error",
            duration_ms=int((time.perf_counter() - start) * 1000),
            metadata={"prompt": prompt, "strength": strength},
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))

# Route for refining a StyleGAN blended result with Stable Diffusion
@app.post('/refine-stylebend')
async def refine_stylebend_endpoint(
    image: UploadFile = File(...),
    strength: str = Form('0.35'),
):
    """Refines a StyleGAN blended fashion image using SD img2img.
    
    Low strength (0.35) preserves the outfit silhouette/pose from StyleGAN 
    while adding realistic fabric texture, sharpness and VS visual quality.
    """
    if sd_pipe is None:
        raise HTTPException(status_code=500, detail="Stable Diffusion model not loaded")

    print("✨ Refining StyleGAN output with Stable Diffusion...")
    start = time.perf_counter()
    try:
        image_bytes = await image.read()
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # Resize to 512x768 — SD 1.5 portrait native resolution
        img = img.resize((512, 768), Image.LANCZOS)

        prompt = (
            "fashion model wearing stylish outfit, high quality fabric texture, "
            "sharp details, professional fashion photography, clean white background, "
            "full body portrait, photorealistic"
        )
        negative_prompt = (
            "low quality, blurry, distorted, deformed, bad anatomy, extra limbs, "
            "duplicate, cropped, watermark, text, artifacts, noise"
        )

        result = sd_pipe(
            prompt=prompt,
            negative_prompt=negative_prompt,
            image=img,
            strength=float(strength),
            num_inference_steps=30,
            guidance_scale=7.5,
        ).images[0]

        byte_io = io.BytesIO()
        result.save(byte_io, 'PNG')
        byte_io.seek(0)

        await log_generation_event(
            endpoint="refine-stylebend",
            status="success",
            duration_ms=int((time.perf_counter() - start) * 1000),
            metadata={"strength": strength},
        )
        return StreamingResponse(byte_io, media_type='image/png')
    except Exception as e:
        print(f"Error refining StyleGAN output: {e}")
        await log_generation_event(
            endpoint="refine-stylebend",
            status="error",
            duration_ms=int((time.perf_counter() - start) * 1000),
            metadata={"strength": strength},
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))


# Global cache for latents to make slider adjustments instant
latent_cache = {}
import hashlib

# ─── Garment-keyword → SegFormer label IDs ──────────────────────────────────
# SegFormer labels (mattmdjaga/segformer_b2_clothes):
#   0 Background  1 Hat       2 Hair      3 Sunglasses 4 Upper-clothes
#   5 Skirt       6 Pants     7 Dress     8 Belt       9 Left-shoe
#  10 Right-shoe 11 Face     12 L-leg    13 R-leg     14 L-arm
#  15 R-arm     16 Bag      17 Scarf
# Multi-word entries are listed first so substring matching picks them before
# their single-word components.
GARMENT_LABEL_MAP = [
    ('crop top',   {4}),
    ('tank top',   {4}),
    ('button up',  {4}),
    ('button-up',  {4}),
    ('t-shirt',    {4}),
    ('tshirt',     {4}),
    ('shirt',      {4}),
    ('blouse',     {4}),
    ('sweatshirt', {4}),
    ('sweater',    {4}),
    ('hoodie',     {4}),
    ('jacket',     {4}),
    ('blazer',     {4}),
    ('cardigan',   {4}),
    ('pullover',   {4}),
    ('jumper',     {4}),
    ('coat',       {4}),
    ('vest',       {4}),
    ('tee',        {4}),
    ('top',        {4}),

    # Full-body garments — replace upper + lower regions
    ('dress',      {4, 5, 6, 7}),
    ('gown',       {4, 5, 6, 7}),
    ('frock',      {4, 5, 6, 7}),
    ('robe',       {4, 5, 6, 7}),
    ('jumpsuit',   {4, 5, 6, 7}),
    ('overall',    {4, 5, 6, 7}),

    # Lower body
    ('jeans',      {6}),
    ('trousers',   {6}),
    ('chinos',     {6}),
    ('slacks',     {6}),
    ('leggings',   {6}),
    ('joggers',    {6}),
    ('sweatpants', {6}),
    ('shorts',     {6}),
    ('pants',      {6}),
    ('skirt',      {5}),

    # Two-piece
    ('suit',       {4, 6}),

    # Headwear
    ('beanie',     {1}),
    ('cap',        {1}),
    ('hat',        {1}),

    ('scarf',      {17}),
    ('belt',       {8}),
]


def _detect_garment_labels(prompt: str):
    """Match garment keywords in prompt → set of SegFormer label IDs."""
    p = prompt.lower()
    matched = set()
    for keyword, labels in GARMENT_LABEL_MAP:
        if keyword in p:
            matched.update(labels)
    if not matched:
        matched = {4}   # default: replace upper-clothes
    return matched


# The natural BODY REGION a garment should occupy, regardless of what's currently
# in the reference image. e.g. "trousers" should cover the full legs even if the
# model is wearing shorts. We build the mask over this region (not just existing
# garment pixels) and then pre-paint it with the requested colour so SD has a
# strong colour+shape signal to work from.
#   Labels: 4 Upper-clothes  5 Skirt  6 Pants  7 Dress
#          12 L-leg  13 R-leg  14 L-arm  15 R-arm
GARMENT_REGION_MAP = [
    # Long lower-body → full legs
    ('jeans',       {6, 12, 13}),
    ('trousers',    {6, 12, 13}),
    ('chinos',      {6, 12, 13}),
    ('slacks',      {6, 12, 13}),
    ('leggings',    {6, 12, 13}),
    ('joggers',     {6, 12, 13}),
    ('sweatpants',  {6, 12, 13}),
    ('pants',       {6, 12, 13}),

    # Long upper-body with sleeves → torso + arms
    ('long sleeve', {4, 14, 15}),
    ('long-sleeve', {4, 14, 15}),
    ('hoodie',      {4, 14, 15}),
    ('sweatshirt',  {4, 14, 15}),
    ('sweater',     {4, 14, 15}),
    ('cardigan',    {4, 14, 15}),
    ('jacket',      {4, 14, 15}),
    ('blazer',      {4, 14, 15}),
    ('coat',        {4, 14, 15}),

    # Skirt → skirt region + legs (so it can extend below)
    ('skirt',       {5, 12, 13}),

    # Full-body → torso + legs
    ('jumpsuit',    {4, 5, 6, 7, 12, 13}),
    ('overall',     {4, 5, 6, 7, 12, 13}),
    ('dress',       {4, 5, 6, 7, 12, 13}),
    ('gown',        {4, 5, 6, 7, 12, 13}),
    ('frock',       {4, 5, 6, 7, 12, 13}),
    ('robe',        {4, 5, 6, 7, 12, 13}),

    # Two-piece → upper + legs + arms
    ('suit',        {4, 6, 12, 13, 14, 15}),
]


def _detect_garment_region(prompt: str):
    """Return the natural body-region labels the requested garment should cover,
    or None if the garment doesn't need region extension (e.g. short-sleeve
    shirts, shorts — those stay limited to existing garment pixels)."""
    p = prompt.lower()
    for keyword, labels in GARMENT_REGION_MAP:
        if keyword in p:
            return set(labels)
    return None


def _color_prefill(image_pil: Image.Image, mask_pil: Image.Image, color_rgb) -> Image.Image:
    """Paint the masked region of *image_pil* with *color_rgb* and a touch of
    brightness noise so SD treats it as fabric, not a flat slab. Outside the
    mask is unchanged."""
    img = np.array(image_pil.convert('RGB')).astype(np.float32)
    msk = np.array(mask_pil.convert('L')).astype(np.float32) / 255.0
    color_arr = np.array(color_rgb, dtype=np.float32).reshape(1, 1, 3)

    h, w = img.shape[:2]
    noise = (np.random.rand(h, w, 1).astype(np.float32) - 0.5) * 12.0
    painted = np.clip(color_arr + noise, 0, 255)

    out = img * (1.0 - msk[..., None]) + painted * msk[..., None]
    return Image.fromarray(out.astype(np.uint8))


def _build_garment_mask(reference_rgb: Image.Image, label_ids) -> Image.Image:
    """Pixel-accurate mask of the requested garment regions, returned as PIL 'L'."""
    arr = np.array(reference_rgb)
    h, w = arr.shape[:2]

    processor, model = _get_clothes_segmenter()
    pil = Image.fromarray(arr)
    with torch.no_grad():
        inputs = processor(images=pil, return_tensors="pt")
        logits = model(**inputs).logits
        up = torch.nn.functional.interpolate(
            logits, size=(h, w), mode="bilinear", align_corners=False
        )
        pred = up.argmax(dim=1)[0].cpu().numpy()

    mask_u8 = np.isin(pred, list(label_ids)).astype(np.uint8) * 255

    # Slight dilate then feather so SD has a few pixels of margin to blend.
    mask_u8 = cv2.dilate(mask_u8, np.ones((5, 5), np.uint8), iterations=2)
    mask_u8 = cv2.GaussianBlur(mask_u8, (15, 15), 0)
    return Image.fromarray(mask_u8, mode='L')


def _masked_latent_inpaint(
    image_pil: Image.Image,
    mask_pil:  Image.Image,
    prompt: str,
    negative_prompt: str,
    strength: float = 0.95,
    num_steps: int = 30,
    guidance: float = 7.5,
) -> Image.Image:
    """Real masked-latent inpainting using the standard 4-channel SD img2img model.

    At every denoising step:
      • Inside  the mask → keep the model's denoised latent (the new garment).
      • Outside the mask → re-blend the original latent renoised to this step
        (so face/body/background converge back to the source image).

    This gives true inpainting behaviour without requiring a 9-channel inpaint
    checkpoint — the only thing we change in the final image is what's masked.
    """
    pipe   = sd_pipe
    device = pipe.device
    dtype  = pipe.unet.dtype

    # ── Encode original image to latents ───────────────────────────────────
    img_np = np.array(image_pil.convert('RGB')).astype(np.float32) / 255.0
    img_t  = torch.from_numpy(img_np).permute(2, 0, 1).unsqueeze(0).to(device, dtype)
    img_t  = 2.0 * img_t - 1.0
    with torch.no_grad():
        init_latents = pipe.vae.encode(img_t).latent_dist.sample() * pipe.vae.config.scaling_factor

    # ── Build latent-resolution mask (1/8 of image) ────────────────────────
    h_lat, w_lat = init_latents.shape[-2:]
    mask_np = np.array(mask_pil.convert('L')).astype(np.float32) / 255.0
    mask_lat = cv2.resize(mask_np, (w_lat, h_lat), interpolation=cv2.INTER_LINEAR)
    mask_t = torch.from_numpy(mask_lat).unsqueeze(0).unsqueeze(0).to(device, dtype)

    # ── Encode prompts (CFG) ───────────────────────────────────────────────
    tok = pipe.tokenizer
    pos = tok([prompt],          padding="max_length", max_length=tok.model_max_length,
              truncation=True, return_tensors="pt").input_ids.to(device)
    neg = tok([negative_prompt], padding="max_length", max_length=tok.model_max_length,
              truncation=True, return_tensors="pt").input_ids.to(device)
    with torch.no_grad():
        pos_emb = pipe.text_encoder(pos)[0]
        neg_emb = pipe.text_encoder(neg)[0]
    cond_emb = torch.cat([neg_emb, pos_emb])

    # ── Setup scheduler with strength offset ───────────────────────────────
    pipe.scheduler.set_timesteps(num_steps, device=device)
    all_t   = pipe.scheduler.timesteps
    init_idx = max(0, int(num_steps * (1.0 - strength)))
    timesteps = all_t[init_idx:]

    noise = torch.randn_like(init_latents)
    latents = pipe.scheduler.add_noise(init_latents, noise, timesteps[:1])

    # ── Denoising loop with mask blending ──────────────────────────────────
    for i, t in enumerate(timesteps):
        with torch.no_grad():
            inp = torch.cat([latents, latents])
            inp = pipe.scheduler.scale_model_input(inp, t)
            noise_pred = pipe.unet(inp, t, encoder_hidden_states=cond_emb).sample

        n_uncond, n_text = noise_pred.chunk(2)
        noise_pred = n_uncond + guidance * (n_text - n_uncond)

        latents = pipe.scheduler.step(noise_pred, t, latents).prev_sample

        # Renoise the original to the *next* timestep, then blend.
        if i + 1 < len(timesteps):
            t_next = timesteps[i + 1].unsqueeze(0)
            noisy_orig = pipe.scheduler.add_noise(init_latents, noise, t_next)
        else:
            noisy_orig = init_latents
        latents = latents * mask_t + noisy_orig * (1.0 - mask_t)

    # ── Decode latents to image ────────────────────────────────────────────
    with torch.no_grad():
        decoded = pipe.vae.decode(latents / pipe.vae.config.scaling_factor).sample
    decoded = ((decoded + 1) / 2).clamp(0, 1)
    out_np  = (decoded[0].permute(1, 2, 0).float().cpu().numpy() * 255).astype(np.uint8)
    return Image.fromarray(out_np)


_COLOR_MAP = {
    # Multi-word first so they match before single-word substrings
    'sky blue':   (100, 160, 220),
    'baby blue':  (140, 185, 230),
    'navy blue':  ( 20,  30, 100),
    'dark blue':  ( 25,  45, 120),
    'light blue': (120, 180, 230),
    'dark green': ( 25,  80,  40),
    'olive green':( 90, 110,  45),
    'dark red':   (140,  20,  20),
    'dark grey':  ( 70,  70,  70),
    'dark gray':  ( 70,  70,  70),
    'light grey': (190, 190, 190),
    'light gray': (190, 190, 190),
    # Single-word colours
    'red':        (210,  55,  55),
    'crimson':    (175,  25,  30),
    'scarlet':    (195,  45,  30),
    'blue':       ( 55, 100, 205),
    'navy':       ( 20,  30, 100),
    'cobalt':     ( 35,  75, 160),
    'black':      ( 28,  28,  28),
    'white':      (242, 242, 242),
    'cream':      (240, 228, 200),
    'ivory':      (240, 235, 215),
    'green':      ( 50, 150,  65),
    'olive':      ( 95, 115,  45),
    'emerald':    ( 25, 140,  75),
    'yellow':     (220, 200,  45),
    'gold':       (200, 165,  40),
    'mustard':    (190, 155,  40),
    'purple':     (115,  45, 180),
    'violet':     (135,  55, 180),
    'lavender':   (170, 125, 205),
    'pink':       (225,  95, 150),
    'magenta':    (200,  45, 150),
    'rose':       (210,  75, 130),
    'orange':     (220, 115,  45),
    'coral':      (220,  95,  75),
    'peach':      (225, 158, 125),
    'brown':      (115,  75,  45),
    'tan':        (180, 138,  95),
    'khaki':      (180, 168, 128),
    'beige':      (212, 190, 158),
    'camel':      (190, 150,  95),
    'grey':       (128, 128, 128),
    'gray':       (128, 128, 128),
    'silver':     (178, 178, 178),
    'teal':       ( 45, 148, 148),
    'cyan':       ( 45, 178, 200),
    'turquoise':  ( 55, 175, 168),
    'mint':       (148, 210, 178),
    'maroon':     (115,  25,  30),
    'burgundy':   ( 95,  18,  38),
    'wine':       (100,  20,  40),
}

def _parse_color_from_prompt(prompt: str):
    """Return (R, G, B) for the first colour keyword found in *prompt*."""
    pl = prompt.lower()
    # Longest match first so 'navy blue' beats 'blue'
    for name in sorted(_COLOR_MAP, key=len, reverse=True):
        if name in pl:
            return _COLOR_MAP[name]
    return (148, 128, 115)   # warm neutral fallback


# Route for Text-to-Clothes generation
@app.post('/text-to-clothes')
async def text_to_clothes_endpoint(
    reference: UploadFile = File(...),
    prompt: str = Form(...),
    strength: str = Form('0.95'),
):
    """Replace a specific garment described in the prompt while keeping the
    face, pose, hands, hair, and background pixel-perfect.

    New pipeline (no more whole-image regeneration):
      1. SegFormer parses the image into per-pixel body / clothing labels.
      2. Garment keywords in the prompt (`shirt`, `dress`, `pants`, …) decide
         which labels to mask. Default = upper-clothes.
      3. Real masked-latent inpainting only regenerates inside that mask.
         Face, body shape, hands, and background are never touched.
      4. Hard pixel-level composite as a final safety net.
    """
    if sd_pipe is None:
        raise HTTPException(status_code=500, detail="Stable Diffusion model not loaded")

    start = time.perf_counter()
    print(f"👗 Text-to-Clothes: '{prompt}'")

    try:
        reference_bytes = await reference.read()
        strength_val = max(0.5, min(1.0, float(strength)))

        # ── Load reference ───────────────────────────────────────────────────
        original_rgba  = Image.open(io.BytesIO(reference_bytes)).convert('RGBA')
        original_alpha = original_rgba.split()[3]
        reference_rgb  = Image.new("RGB", original_rgba.size, (255, 255, 255))
        reference_rgb.paste(original_rgba, mask=original_alpha)
        original_size  = reference_rgb.size

        # ── Detect garment labels + target body region from prompt ───────────
        labels = _detect_garment_labels(prompt)
        region = _detect_garment_region(prompt)
        all_labels = set(labels) | (region or set())
        print(f"   🏷️  Garment labels: {sorted(labels)}  region: {sorted(region) if region else '—'}")

        # ── Build pixel-precise garment mask covering the union ──────────────
        print("   🎭 Building garment mask…")
        garment_mask = _build_garment_mask(reference_rgb, all_labels)

        if int(np.array(garment_mask).max()) < 30:
            raise HTTPException(
                status_code=400,
                detail="Could not find a matching body region in the reference image.",
            )

        # ── Pre-fill the masked region with the parsed colour ────────────────
        # Gives SD a strong colour+shape signal so e.g. "red trousers" on a
        # shorts model produces actual red trousers covering the legs, not a
        # tinted version of the existing shorts.
        color_rgb = _parse_color_from_prompt(prompt)
        print(f"   🎨 Pre-fill colour: {color_rgb}")
        prefilled_rgb = _color_prefill(reference_rgb, garment_mask, color_rgb)

        # ── Resize to 512×512 for SD ─────────────────────────────────────────
        ref_512_orig = reference_rgb.resize((512, 512), Image.LANCZOS)
        ref_512      = prefilled_rgb.resize((512, 512), Image.LANCZOS)
        mask_512     = garment_mask.resize((512, 512), Image.BILINEAR)

        # ── Prompts ──────────────────────────────────────────────────────────
        positive = (
            f"a person wearing {prompt}, "
            "fashion photography, photorealistic, sharp focus, "
            "studio lighting, detailed fabric texture, high quality, 8k"
        )
        negative = (
            "deformed, distorted, blurry, low quality, watermark, text, logo, "
            "extra limbs, bad anatomy, ugly, oversaturated, cartoon, illustration"
        )
        print(f"   📝 Prompt: {positive}")
        print(f"   🎚️ Strength: {strength_val}")

        # ── Real masked-latent inpainting ────────────────────────────────────
        print("   🎨 Running masked-latent inpainting…")
        result_512 = _masked_latent_inpaint(
            image_pil       = ref_512,
            mask_pil        = mask_512,
            prompt          = positive,
            negative_prompt = negative,
            strength        = strength_val,
            num_steps       = 30,
            guidance        = 8.0,
        )

        # ── Hard pixel-level composite (safety net) ──────────────────────────
        # Blend against the *original* (not pre-filled) so mask edges don't
        # leak the pre-fill colour onto skin/background.
        ref_np    = np.array(ref_512_orig).astype(np.float32)
        result_np = np.array(result_512).astype(np.float32)
        m_np      = np.array(mask_512).astype(np.float32) / 255.0
        final_np  = ref_np * (1.0 - m_np[..., None]) + result_np * m_np[..., None]
        composited = Image.fromarray(final_np.astype(np.uint8))

        # ── Restore original resolution and alpha channel ────────────────────
        composited = composited.resize(original_size, Image.LANCZOS).convert('RGBA')
        composited.putalpha(original_alpha)

        byte_io = io.BytesIO()
        composited.save(byte_io, 'PNG')
        byte_io.seek(0)

        elapsed_ms = int((time.perf_counter() - start) * 1000)
        await log_generation_event(
            endpoint="text-to-clothes",
            status="success",
            duration_ms=elapsed_ms,
            metadata={"prompt": prompt, "labels": sorted(labels), "strength": strength_val},
        )
        print(f"   ✅ Text-to-Clothes complete in {elapsed_ms}ms")
        return StreamingResponse(byte_io, media_type='image/png')

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in text-to-clothes: {e}")
        await log_generation_event(
            endpoint="text-to-clothes",
            status="error",
            duration_ms=int((time.perf_counter() - start) * 1000),
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))


# Route for Style Bending
@app.post('/blend-styles')
async def blend_styles(
    image1: UploadFile = File(...),
    image2: UploadFile = File(...),
    alpha: str = Form('0.5'),
    outpaint1: str = Form('false'),
    outpaint2: str = Form('false'),
):
    """Projects two images to latent space and blends them"""
    if stylegan_model is None:
        raise HTTPException(status_code=500, detail="StyleGAN model not loaded")

    # Read raw bytes
    image1_bytes = await image1.read()
    image2_bytes = await image2.read()

    outpaint1_flag = outpaint1.lower() == 'true'
    outpaint2_flag = outpaint2.lower() == 'true'

    print(f"👗 Starting Style Bending with alpha={alpha}...")
    start = time.perf_counter()
    
    try:
        # Step 1 & 2: Project or retrieve from cache
        # Include outpaint flags in hash so toggling them invalidates cache
        h1 = hashlib.md5(image1_bytes + b'|op1=' + str(outpaint1_flag).encode()).hexdigest()
        h2 = hashlib.md5(image2_bytes + b'|op2=' + str(outpaint2_flag).encode()).hexdigest()
        
        if h1 in latent_cache:
            print("   Step 1: Using cached latent for image 1")
            w1 = latent_cache[h1]
        else:
            print("   Step 1: Projecting image 1...")
            img1_pil = Image.open(io.BytesIO(image1_bytes)).convert('RGB')
            if outpaint1_flag:
                print("   Step 1: Outpainting image 1 to full body...")
                img1_pil = outpaint_to_full_body(img1_pil)
            w1 = project_image(stylegan_model, img1_pil, steps=400, device=device)
            latent_cache[h1] = w1
            
        if h2 in latent_cache:
            print("   Step 2: Using cached latent for image 2")
            w2 = latent_cache[h2]
        else:
            print("   Step 2: Projecting image 2...")
            img2_pil = Image.open(io.BytesIO(image2_bytes)).convert('RGB')
            if outpaint2_flag:
                print("   Step 2: Outpainting image 2 to full body...")
                img2_pil = outpaint_to_full_body(img2_pil)
            w2 = project_image(stylegan_model, img2_pil, steps=400, device=device)
            latent_cache[h2] = w2
            
        # Step 3: Blend and generate a sprite sheet / frames for all alphas
        print("   Step 3: Blending latents for all alphas...")
        frames = []
        import numpy as np
        alphas = np.linspace(0.0, 1.0, 21) # 0.0 to 1.0 with 0.05 intervals
        for a in alphas:
            blended_img_pil = blend_latents(stylegan_model, w1, w2, float(a))
            byte_io = io.BytesIO()
            blended_img_pil.save(byte_io, 'JPEG', quality=85)
            b64 = base64.b64encode(byte_io.getvalue()).decode('utf-8')
            frames.append(f"data:image/jpeg;base64,{b64}")
        await log_generation_event(
            endpoint="blend-styles",
            status="success",
            duration_ms=int((time.perf_counter() - start) * 1000),
            metadata={"alpha": alpha, "outpaint1": outpaint1_flag, "outpaint2": outpaint2_flag},
        )
        return JSONResponse({"frames": frames})
    except Exception as e:
        print(f"Error blending styles: {e}")
        await log_generation_event(
            endpoint="blend-styles",
            status="error",
            duration_ms=int((time.perf_counter() - start) * 1000),
            metadata={"alpha": alpha, "outpaint1": outpaint1_flag, "outpaint2": outpaint2_flag},
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))

# Route for Text-to-Human generation
@app.post('/generate-human')
async def generate_human_endpoint(
    prompt: str = Form('a fashion model wearing stylish clothing, full body, high quality, detailed'),
    negative_prompt: str = Form('low quality, blurry, distorted, deformed, bad anatomy, extra limbs, ugly'),
    steps: str = Form('35'),
    guidance: str = Form('7.5'),
):
    """Generates a human figure from a text prompt using Stable Diffusion"""
    if txt2img_pipe is None:
        raise HTTPException(status_code=500, detail="Stable Diffusion model not loaded")

    _COLOR_RE = re.compile(
        r'\b(black|white|red|blue|green|yellow|purple|pink|orange|brown|gr[ae]y|navy|'
        r'burgundy|maroon|teal|cyan|magenta|beige|cream|gold|silver|dark|light|bright|'
        r'pastel|neon|olive|coral|turquoise|indigo|violet|crimson|scarlet|azure|ivory|'
        r'charcoal|tan|khaki|lime)\b',
        re.IGNORECASE,
    )
    _DARK_COLORS = {
        'black', 'dark', 'navy', 'charcoal', 'burgundy', 'maroon',
        'indigo', 'violet', 'crimson', 'scarlet', 'teal', 'olive',
    }

    color_hits = list(dict.fromkeys(m.lower() for m in _COLOR_RE.findall(prompt)))

    if color_hits:
        # Anchor each colour to a clothing noun before repeating.
        # Bare colour words ("black, black, black") get applied to whatever the model
        # associates first — usually skin or hair. Pairing with a clothing noun
        # ("black clothing, black clothing, …") locks the colour to the garment.
        # We also try to extract the specific clothing item from the user's prompt
        # (e.g. "suit", "dress") so the repetition is even more precise.
        _GARMENT_RE = re.compile(
            r'\b(suit|dress|gown|jacket|coat|shirt|pants|trousers|blouse|skirt|'
            r'jeans|blazer|hoodie|sweater|uniform|robe|outfit|attire|top|wear)\b',
            re.IGNORECASE,
        )
        garment_match = _GARMENT_RE.search(prompt)
        garment = garment_match.group(1).lower() if garment_match else 'clothing'

        anchored = [f"{c} {garment}" for c in color_hits[:2]]
        repeated_colors = ', '.join(phrase for phrase in anchored for _ in range(4))
        prompt = repeated_colors + ', ' + prompt

    # For dark colours, push white/light tones away via the negative prompt.
    dark_found = [c for c in color_hits if c in _DARK_COLORS]
    if dark_found:
        negative_prompt = (
            "white clothing, white dress, white shirt, white suit, white outfit, "
            "light colored clothing, pale outfit, bright clothing, "
            + negative_prompt
        )

    prompt = prompt + ", professional fashion photography, photorealistic, sharp focus"
    negative_prompt = (
        negative_prompt
        + ", outdoors, complex background, scenery, landscape, "
        + "extra limbs, extra arms, extra legs, missing limbs, floating limbs, "
        + "duplicate, cloned face, disfigured, gross proportions, mutation, "
        + "watermark, text, signature, jpeg artifacts"
    )

    print(f"🧑 Starting Text-to-Human Generation...")
    print(f"📝 Prompt: {prompt}")
    print(f"🚫 Negative: {negative_prompt}")
    start = time.perf_counter()

    try:
        width, height = 512, 768
        result = txt2img_pipe(
            prompt=prompt,
            negative_prompt=negative_prompt,
            num_inference_steps=int(steps),
            guidance_scale=float(guidance),
            width=width,
            height=height,
        ).images[0]

        # Try to remove the background and place on solid white
        try:
            print("   🪄 Removing background using rembg...")
            img_bytes_io = io.BytesIO()
            result.save(img_bytes_io, format="PNG")
            result_bytes = rembg_remove_cpu(img_bytes_io.getvalue())
            img_rgba = Image.open(io.BytesIO(result_bytes)).convert("RGBA")
            
            # Place the cutout (alpha-composited) on a pure WHITE background
            # This ensures frontend bounds logic doesn't shrink the canvas to the silhouette
            white_bg = Image.new("RGBA", img_rgba.size, (255, 255, 255, 255))
            white_bg.paste(img_rgba, mask=img_rgba.split()[3])
            result = white_bg.convert("RGB")
            
            print("   ✅ Background removed and replaced with solid white.")
        except Exception as e:
            print(f"   ⚠️ Background removal failed or not installed ({e}) — keeping original background.")

        # Return as PNG
        byte_io = io.BytesIO()
        result.save(byte_io, 'PNG')
        byte_io.seek(0)

        print("✅ Human generation complete!")
        await log_generation_event(
            endpoint="generate-human",
            status="success",
            duration_ms=int((time.perf_counter() - start) * 1000),
            metadata={"steps": steps, "guidance": guidance},
        )
        return StreamingResponse(byte_io, media_type='image/png')
    except Exception as e:
        print(f"Error generating human: {e}")
        await log_generation_event(
            endpoint="generate-human",
            status="error",
            duration_ms=int((time.perf_counter() - start) * 1000),
            metadata={"steps": steps, "guidance": guidance},
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))

# Route for AI Color Suggestions
@app.post('/suggest-colors')
async def suggest_colors_endpoint(prompt: str = Form(...)):
    """Suggests a color palette from a text prompt using HSL color theory + keyword mapping.
    Generates clean, accurate swatch strip images directly - no generative AI needed.
    """
    import colorsys, hashlib
    from PIL import ImageDraw

    print(f"\U0001f3a8 Suggesting colors for: {prompt}")
    start = time.perf_counter()

    try:
        # ── Comprehensive keyword → (base_hue, saturation, lightness_min, lightness_max) ──
        # Emotions are primary. Low sat + low lightness = muted/sad. High sat + high lightness = joyful.
        HUE_KEYWORDS = [
            # Sadness / Depression / Grief
            ("sad", 225, 25, 25, 45), ("sadness", 225, 25, 25, 45),
            ("lonely", 220, 20, 22, 42), ("loneliness", 220, 20, 22, 42), ("alone", 215, 18, 25, 45),
            ("depress", 230, 20, 15, 35), ("grief", 220, 22, 18, 35), ("sorrow", 225, 25, 20, 40),
            ("heartbreak", 340, 30, 22, 42), ("heartbroken", 340, 30, 22, 42),
            ("melancholy", 225, 22, 25, 45), ("hopeless", 220, 15, 18, 32),
            ("despair", 225, 18, 12, 30), ("empty", 210, 10, 28, 48),
            ("numb", 215, 8, 28, 45), ("broken", 215, 18, 20, 38),
            ("crying", 215, 25, 25, 45), ("tears", 205, 28, 28, 48),
            ("wistful", 215, 22, 32, 52), ("mournful", 225, 20, 18, 35),
            ("regret", 220, 22, 25, 42), ("miss", 220, 20, 28, 48),
            # Happiness / Joy
            ("happy", 50, 85, 60, 80), ("happiness", 50, 85, 60, 80),
            ("joy", 45, 90, 62, 82), ("joyful", 45, 90, 62, 82),
            ("excited", 25, 90, 55, 75), ("cheerful", 50, 80, 65, 82),
            ("elated", 48, 88, 62, 80), ("bliss", 55, 80, 68, 85),
            ("euphoria", 40, 92, 60, 78), ("celebrate", 35, 88, 58, 78),
            ("playful", 45, 85, 62, 80), ("fun", 30, 88, 60, 78),
            ("laugh", 48, 82, 65, 82), ("bright", 50, 80, 68, 85),
            ("sunshine", 52, 88, 65, 82), ("radiant", 48, 88, 65, 82),
            # Anger / Rage
            ("angry", 0, 85, 35, 55), ("anger", 0, 85, 35, 55),
            ("rage", 0, 90, 25, 42), ("furious", 5, 88, 28, 45),
            ("frustrated", 10, 70, 35, 52), ("frustrat", 10, 70, 35, 52),
            ("hate", 355, 80, 25, 42), ("violent", 0, 88, 22, 40),
            # Fear / Anxiety
            ("fear", 250, 35, 18, 38), ("scared", 245, 30, 20, 40),
            ("anxious", 240, 28, 25, 45), ("anxiety", 240, 30, 22, 42),
            ("nervous", 235, 25, 28, 48), ("panic", 10, 60, 28, 48),
            ("dread", 240, 25, 15, 32), ("horror", 240, 20, 12, 28),
            ("terror", 235, 22, 12, 28), ("stressed", 235, 25, 25, 45),
            ("stress", 235, 25, 25, 45), ("worried", 235, 22, 28, 48),
            ("worry", 235, 22, 28, 48),
            # Calm / Peace
            ("calm", 195, 40, 55, 75), ("calming", 195, 40, 55, 75),
            ("peace", 175, 35, 55, 75), ("peaceful", 175, 35, 55, 75),
            ("serene", 190, 38, 58, 78), ("tranquil", 185, 35, 58, 78),
            ("relax", 185, 38, 55, 75), ("zen", 145, 30, 50, 70),
            ("gentle", 185, 30, 62, 80), ("quiet", 210, 18, 48, 68),
            # Romance / Love
            ("love", 345, 70, 55, 78), ("loving", 345, 70, 55, 78),
            ("romantic", 340, 60, 60, 80), ("passion", 350, 85, 45, 65),
            ("tender", 345, 50, 65, 82), ("heart", 355, 70, 55, 75),
            # Mystery / Darkness
            ("myster", 270, 50, 15, 35), ("dark", 240, 20, 10, 28),
            ("shadow", 235, 18, 12, 30), ("eerie", 260, 35, 18, 35),
            ("gothic", 280, 40, 12, 30), ("haunted", 250, 25, 15, 32),
            ("noir", 220, 12, 10, 28), ("sinister", 255, 35, 12, 28),
            # Hope / Optimism
            ("hope", 165, 55, 50, 72), ("hopeful", 165, 55, 50, 72),
            ("dream", 270, 40, 60, 82), ("dreamy", 280, 40, 60, 82),
            ("inspire", 190, 60, 50, 72), ("ambit", 195, 58, 48, 68),
            # Energy / Power
            ("energy", 30, 90, 52, 72), ("power", 270, 70, 28, 52),
            ("bold", 0, 80, 38, 58), ("fierce", 10, 85, 32, 52),
            ("intense", 240, 60, 25, 45), ("vibrant", 35, 90, 55, 75),
            # Nostalgia
            ("nostalgi", 30, 42, 50, 68), ("memory", 35, 35, 52, 70),
            ("vintage", 35, 40, 50, 65), ("retro", 28, 55, 48, 68),
            # Aesthetics
            ("cyberpunk", 280, 85, 40, 70), ("neon", 290, 90, 50, 75),
            ("gloomy", 225, 22, 22, 42), ("moody", 235, 28, 22, 42),
            ("dreary", 220, 18, 20, 38), ("pastel", 300, 30, 75, 90),
            ("boho", 30, 55, 55, 70), ("ethereal", 270, 35, 65, 85),
            ("magical", 290, 60, 50, 75), ("fairy", 295, 45, 65, 85),
            ("elegant", 260, 30, 40, 60), ("luxury", 45, 70, 45, 65),
            ("minimal", 210, 15, 50, 75), ("futuristic", 200, 70, 40, 65),
            ("industrial", 210, 20, 28, 48), ("grunge", 35, 30, 22, 42),
            # Nature
            ("grass", 110, 55, 35, 65), ("green", 120, 60, 30, 65),
            ("forest", 130, 50, 25, 55), ("ocean", 200, 75, 35, 65),
            ("sky", 205, 70, 50, 80), ("sea", 195, 70, 35, 65),
            ("sunset", 20, 85, 50, 70), ("fire", 10, 90, 45, 65),
            ("autumn", 25, 80, 45, 65), ("snow", 210, 20, 85, 95),
            ("winter", 220, 38, 42, 62), ("spring", 90, 55, 55, 75),
            ("summer", 50, 70, 60, 80), ("tropical", 165, 70, 45, 65),
            ("desert", 35, 65, 55, 75), ("mountain", 220, 25, 35, 55),
            ("earth", 30, 45, 35, 55), ("mint", 160, 55, 60, 80),
            # Direct colors
            ("red", 0, 80, 40, 65), ("pink", 340, 70, 65, 85),
            ("rose", 350, 65, 55, 75), ("orange", 25, 85, 50, 70),
            ("yellow", 55, 85, 55, 75), ("gold", 45, 80, 50, 65),
            ("purple", 275, 70, 35, 60), ("violet", 265, 75, 40, 65),
            ("lavender", 260, 50, 70, 85), ("indigo", 245, 70, 35, 55),
            ("blue", 215, 75, 40, 65), ("navy", 225, 65, 25, 45),
            ("teal", 175, 65, 35, 55), ("cyan", 185, 75, 45, 65),
            ("brown", 25, 50, 30, 50), ("beige", 35, 40, 70, 85),
            ("gray", 220, 10, 40, 65), ("grey", 220, 10, 40, 65),
            ("charcoal", 220, 15, 15, 30), ("black", 240, 10, 8, 20),
            ("white", 0, 0, 88, 97), ("silver", 215, 15, 65, 80),
        ]

        prompt_lower = prompt.lower()
        matched = []
        for kw, hue, sat, lmin, lmax in HUE_KEYWORDS:
            if kw in prompt_lower:
                matched.append((hue, sat, lmin, lmax))

        if not matched:
            h = int(hashlib.md5(prompt_lower.encode()).hexdigest(), 16)
            base_hue = h % 360
            matched.append((base_hue, 45, 35, 62))

        # Blend all matched keywords into one unified emotional base
        avg_hue = sum(m[0] for m in matched) / len(matched)
        avg_sat = sum(m[1] for m in matched) / len(matched)
        avg_lmin = sum(m[2] for m in matched) / len(matched)
        avg_lmax = sum(m[3] for m in matched) / len(matched)
        base_hue = int(avg_hue)
        sat = int(avg_sat)
        lmin = int(avg_lmin)
        lmax = int(avg_lmax)

        # Analogous harmony spanning the emotional lightness range
        NUM_SWATCHES = 5
        offsets = [0, 12, -12, 22, -22]
        swatches = []
        for j, offset in enumerate(offsets):
            hue = (base_hue + offset) % 360
            lightness = lmin + (lmax - lmin) * (j / (NUM_SWATCHES - 1))
            s = max(8, min(95, sat + (j - 2) * 4))
            swatches.append((hue, s, lightness))
        # Render as a clean palette strip PNG
        sw, sh, pad = 110, 110, 12
        total_w = NUM_SWATCHES * sw + (NUM_SWATCHES + 1) * pad
        total_h = sh + 2 * pad
        palette_img = Image.new("RGB", (total_w, total_h), (240, 240, 245))
        draw = ImageDraw.Draw(palette_img)

        for i, (h, s, l) in enumerate(swatches[:NUM_SWATCHES]):
            r, g, b = colorsys.hls_to_rgb(h / 360, l / 100, s / 100)
            rgb = (int(r * 255), int(g * 255), int(b * 255))
            x = pad + i * (sw + pad)
            y = pad
            draw.rectangle([x, y, x + sw, y + sh], fill=rgb)

        byte_io = io.BytesIO()
        palette_img.save(byte_io, 'PNG')
        byte_io.seek(0)
        await log_generation_event(
            endpoint="suggest-colors",
            status="success",
            duration_ms=int((time.perf_counter() - start) * 1000),
            metadata={"prompt": prompt},
        )
        return StreamingResponse(byte_io, media_type='image/png')
    except Exception as e:
        print(f"Error suggesting colors: {e}")
        await log_generation_event(
            endpoint="suggest-colors",
            status="error",
            duration_ms=int((time.perf_counter() - start) * 1000),
            metadata={"prompt": prompt},
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))


@app.get('/health/db')
async def health_db():
    mongo: MongoManager = app.state.mongo
    is_connected = mongo.db is not None
    payload = {
        "status": "ok" if is_connected else "degraded",
        "mongodbConnected": is_connected,
        "database": MONGODB_DB_NAME,
    }
    if is_connected:
        await mongo.client.admin.command("ping")
    return JSONResponse(payload)


@app.post('/auth/signup')
async def signup(payload: SignupRequest):
    mongo: MongoManager = app.state.mongo
    if mongo.db is None:
        raise HTTPException(status_code=503, detail="Database is not connected")

    email = payload.email.lower().strip()
    existing_user = await mongo.db["users"].find_one({"email": email})
    if existing_user is not None:
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    now_ms = utc_timestamp_ms()
    user_doc = {
        "email": email,
        "displayName": payload.displayName.strip(),
        "passwordHash": password_hasher.hash(payload.password),
        "createdAt": now_ms,
        "updatedAt": now_ms,
    }
    result = await mongo.db["users"].insert_one(user_doc)
    created_user = await mongo.db["users"].find_one({"_id": result.inserted_id})

    token = create_access_token(str(result.inserted_id))
    response = JSONResponse({"user": serialize_user(created_user), "token": token})
    set_auth_cookie(response, token)
    return response


@app.post('/auth/login')
async def login(payload: LoginRequest):
    mongo: MongoManager = app.state.mongo
    if mongo.db is None:
        raise HTTPException(status_code=503, detail="Database is not connected")

    email = payload.email.lower().strip()
    user_doc = await mongo.db["users"].find_one({"email": email})
    password_hash = "" if user_doc is None else user_doc.get("passwordHash", "")
    try:
        is_valid = bool(user_doc) and password_hasher.verify(password_hash, payload.password)
    except (VerifyMismatchError, InvalidHash):
        is_valid = False

    if not is_valid:
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    if password_hasher.check_needs_rehash(password_hash):
        await mongo.db["users"].update_one(
            {"_id": user_doc["_id"]},
            {"$set": {"passwordHash": password_hasher.hash(payload.password), "updatedAt": utc_timestamp_ms()}},
        )

    token = create_access_token(str(user_doc["_id"]))
    response = JSONResponse({"user": serialize_user(user_doc), "token": token})
    set_auth_cookie(response, token)
    return response


@app.post('/auth/logout')
async def logout():
    response = JSONResponse({"logout": True})
    clear_auth_cookie(response)
    return response


@app.get('/auth/me')
async def auth_me(current_user: dict[str, Any] = Depends(get_current_user)):
    return JSONResponse(serialize_user(current_user))


@app.patch('/auth/profile')
async def update_profile(
    payload: UpdateProfileRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    mongo: MongoManager = app.state.mongo
    updates: dict[str, Any] = {"updatedAt": utc_timestamp_ms()}
    if payload.displayName is not None:
        updates["displayName"] = payload.displayName.strip()
    if payload.avatarUrl is not None:
        if len(payload.avatarUrl) > 250_000:
            raise HTTPException(status_code=400, detail="Avatar image too large (max ~180 KB)")
        updates["avatarUrl"] = payload.avatarUrl
    updated = await mongo.db["users"].find_one_and_update(
        {"_id": current_user["_id"]},
        {"$set": updates},
        return_document=True,
    )
    return JSONResponse(serialize_user(updated))


@app.post('/auth/change-password')
async def change_password(
    payload: ChangePasswordRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    try:
        password_hasher.verify(current_user["passwordHash"], payload.currentPassword)
    except (VerifyMismatchError, InvalidHash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    mongo: MongoManager = app.state.mongo
    await mongo.db["users"].update_one(
        {"_id": current_user["_id"]},
        {"$set": {"passwordHash": password_hasher.hash(payload.newPassword), "updatedAt": utc_timestamp_ms()}},
    )
    return JSONResponse({"success": True})


@app.post('/projects')
async def create_project(project: ProjectCreate, current_user: dict[str, Any] = Depends(get_current_user)):
    mongo: MongoManager = app.state.mongo
    if mongo.db is None:
        raise HTTPException(status_code=503, detail="Database is not connected")

    normalized_name = normalize_project_name(project.name)
    conflict = await mongo.db["projects"].find_one(
        build_name_conflict_filter(str(current_user["_id"]), normalized_name, project.name)
    )
    if conflict is not None:
        raise HTTPException(status_code=409, detail="A project with this name already exists")
    now_ms = utc_timestamp_ms()
    doc = {
        "userId": str(current_user["_id"]),
        "name": project.name.strip(),
        "nameNormalized": normalized_name,
        "createdAt": now_ms,
        "updatedAt": now_ms,
        "thumbnail": None,
        "layersSnapshot": None,
    }
    try:
        result = await mongo.db["projects"].insert_one(doc)
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="A project with this name already exists") from exc
    created = await mongo.db["projects"].find_one({"_id": result.inserted_id})
    return JSONResponse(serialize_project(created))


@app.get('/projects')
async def list_projects(current_user: dict[str, Any] = Depends(get_current_user)):
    mongo: MongoManager = app.state.mongo
    if mongo.db is None:
        raise HTTPException(status_code=503, detail="Database is not connected")

    cursor = mongo.db["projects"].find({"userId": str(current_user["_id"])}).sort("updatedAt", DESCENDING)
    items = [serialize_project(doc) async for doc in cursor]
    return JSONResponse(items)


@app.get('/projects/item/{project_id}')
async def get_project(project_id: str, current_user: dict[str, Any] = Depends(get_current_user)):
    mongo: MongoManager = app.state.mongo
    if mongo.db is None:
        raise HTTPException(status_code=503, detail="Database is not connected")

    oid = parse_object_id(project_id)
    doc = await mongo.db["projects"].find_one({"_id": oid, "userId": str(current_user["_id"])})
    if doc is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return JSONResponse(serialize_project(doc))


@app.put('/projects/{project_id}')
async def save_project(project_id: str, payload: ProjectSave, current_user: dict[str, Any] = Depends(get_current_user)):
    mongo: MongoManager = app.state.mongo
    if mongo.db is None:
        raise HTTPException(status_code=503, detail="Database is not connected")

    oid = parse_object_id(project_id)
    normalized_name = normalize_project_name(payload.name)
    conflict = await mongo.db["projects"].find_one(
        build_name_conflict_filter(str(current_user["_id"]), normalized_name, payload.name, exclude_id=oid)
    )
    if conflict is not None:
        raise HTTPException(status_code=409, detail="A project with this name already exists")
    update = {
        "$set": {
            "name": payload.name.strip(),
            "nameNormalized": normalized_name,
            "thumbnail": payload.thumbnail,
            "layersSnapshot": payload.layersSnapshot,
            "updatedAt": utc_timestamp_ms(),
        }
    }
    try:
        result = await mongo.db["projects"].update_one({"_id": oid, "userId": str(current_user["_id"])}, update)
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="A project with this name already exists") from exc
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")

    doc = await mongo.db["projects"].find_one({"_id": oid, "userId": str(current_user["_id"])})
    return JSONResponse(serialize_project(doc))


@app.patch('/projects/{project_id}/rename')
async def rename_project(project_id: str, payload: ProjectRename, current_user: dict[str, Any] = Depends(get_current_user)):
    mongo: MongoManager = app.state.mongo
    if mongo.db is None:
        raise HTTPException(status_code=503, detail="Database is not connected")

    normalized_name = normalize_project_name(payload.name)
    oid = parse_object_id(project_id)
    conflict = await mongo.db["projects"].find_one(
        build_name_conflict_filter(str(current_user["_id"]), normalized_name, payload.name, exclude_id=oid)
    )
    if conflict is not None:
        raise HTTPException(status_code=409, detail="A project with this name already exists")
    try:
        result = await mongo.db["projects"].update_one(
            {"_id": oid, "userId": str(current_user["_id"])},
            {"$set": {"name": payload.name.strip(), "nameNormalized": normalized_name, "updatedAt": utc_timestamp_ms()}},
        )
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="A project with this name already exists") from exc
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")

    doc = await mongo.db["projects"].find_one({"_id": oid, "userId": str(current_user["_id"])})
    return JSONResponse(serialize_project(doc))


@app.delete('/projects/{project_id}')
async def delete_project(project_id: str, current_user: dict[str, Any] = Depends(get_current_user)):
    mongo: MongoManager = app.state.mongo
    if mongo.db is None:
        raise HTTPException(status_code=503, detail="Database is not connected")

    oid = parse_object_id(project_id)
    result = await mongo.db["projects"].delete_one({"_id": oid, "userId": str(current_user["_id"])})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")
    return JSONResponse({"deleted": True, "projectId": project_id})

# --- 4. RUN THE APP ---
if __name__ == '__main__':
    print("\n🚀 Starting FastAPI server...")
    print("Docs:          http://127.0.0.1:5001/docs")
    print("API endpoint:  http://127.0.0.1:5001/predict")
    print("React frontend should run on http://localhost:3000")
    uvicorn.run(app, host='0.0.0.0', port=5001)
