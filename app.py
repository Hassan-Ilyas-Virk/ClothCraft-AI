import torch
import io
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field, EmailStr
import uvicorn
from PIL import Image, ImageChops, ImageFilter
from torchvision import transforms
import os
import base64
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


MONGODB_URI = os.getenv("MONGODB_URI") or os.getenv("MONGO_URI") or "mongodb://127.0.0.1:27017"
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME") or os.getenv("MONGO_DB_NAME") or "clothcraft_ai"
MONGODB_REQUIRED = os.getenv("MONGODB_REQUIRED", "false").lower() == "true"
MONGODB_CONNECT_TIMEOUT_MS = int(os.getenv("MONGODB_CONNECT_TIMEOUT_MS", "5000"))
MONGODB_CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if origin.strip()
]

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-change-me")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))
AUTH_COOKIE_NAME = os.getenv("AUTH_COOKIE_NAME", "cc_auth")
AUTH_COOKIE_SECURE = os.getenv("AUTH_COOKIE_SECURE", "false").lower() == "true"

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
        samesite="lax",
        max_age=JWT_EXPIRE_MINUTES * 60,
        path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(
        key=AUTH_COOKIE_NAME,
        httponly=True,
        secure=AUTH_COOKIE_SECURE,
        samesite="lax",
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

# Stable Diffusion model for inpainting
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
    allow_origins=MONGODB_CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


async def get_current_user(request: Request) -> dict[str, Any]:
    mongo: MongoManager = app.state.mongo
    if mongo.db is None:
        raise HTTPException(status_code=503, detail="Database is not connected")

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

# Load Stable Diffusion inpainting model for Clothify feature
try:
    from diffusers import StableDiffusionInpaintPipeline
    print("Loading Stable Diffusion Inpainting model...")
    sd_pipe = StableDiffusionInpaintPipeline.from_single_file(
        SD_MODEL_PATH,
        torch_dtype=torch.float16 if device in ["cuda", "mps"] else torch.float32,
        safety_checker=None
    ).to(device)
    print("✅ Stable Diffusion model loaded successfully!")
except FileNotFoundError:
    print(f"⚠️  SD model not found at {SD_MODEL_PATH} — inpainting disabled.")
    sd_pipe = None
except Exception as e:
    print(f"⚠️  Error loading SD model: {e} — inpainting disabled.")
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



def translate_doodle(doodle_bytes):
    """Translates doodle using Pix2Pix model"""
    print("🎨 Running Pix2Pix doodle translation...")
    
    # Load original image
    original = Image.open(io.BytesIO(doodle_bytes))
    
    # If image has an alpha channel, composite it onto a WHITE background
    # This is CRITICAL because the Pix2Pix model was trained on white-background sketches.
    # PIL's default .convert('RGB') makes transparent areas BLACK, which the model doesn't understand.
    if original.mode == 'RGBA':
        image = Image.new("RGB", original.size, (255, 255, 255))
        image.paste(original, mask=original.split()[3])
    else:
        image = original.convert('RGB')
        
    input_tensor = transform(image).unsqueeze(0).to(device)

    with torch.no_grad():
        output_tensor = pix2pix_model(input_tensor)

    # De-normalize the output tensor from [-1, 1] to [0, 1]
    output_image = output_tensor.squeeze(0).cpu()
    output_image = (output_image * 0.5) + 0.5
    
    # Convert tensor back to a PIL Image
    output_image = transforms.ToPILImage()(output_image)

    # --- POST-PROCESSING ---
    # The Pix2Pix model often produces a light gray background [~180, 180, 180].
    # The frontend expects a BLACK background to correctly composite the result.
    # We use rembg to remove the gray background and place the object on black.
    try:
        from rembg import remove as rembg_remove
        print("   🪄 Removing Pix2Pix background using rembg...")
        
        # Convert to PNG bytes for rembg
        temp_io = io.BytesIO()
        output_image.save(temp_io, format="PNG")
        
        # Remove background
        result_bytes = rembg_remove(temp_io.getvalue())
        output_rgba = Image.open(io.BytesIO(result_bytes)).convert("RGBA")
        
        # Composite onto BLACK background (required by frontend skip-black logic)
        black_bg = Image.new("RGBA", output_rgba.size, (0, 0, 0, 255))
        black_bg.paste(output_rgba, mask=output_rgba.split()[3])
        output_image = black_bg.convert("RGB")
        print("   ✅ Background cleanup complete.")
    except Exception as e:
        print(f"   ⚠️ Background cleanup failed ({e}) — returning raw model output.")

    # Save image to a byte buffer to send as response
    byte_io = io.BytesIO()
    output_image.save(byte_io, 'PNG')
    byte_io.seek(0)
    
    return byte_io

def inpaint_with_stable_diffusion(reference_image_bytes, mask_bytes, prompt="", strength=0.75):
    """Inpaints reference image using Stable Diffusion with the mask"""
    if sd_pipe is None:
        raise Exception("Stable Diffusion model not loaded")
    
    # Load reference image with Alpha channel
    original_rgba = Image.open(io.BytesIO(reference_image_bytes)).convert('RGBA')
    
    # Composite onto pure white background so SD doesn't see black voids
    reference_image = Image.new("RGB", original_rgba.size, (255, 255, 255))
    reference_image.paste(original_rgba, mask=original_rgba.split()[3])

    mask_image = Image.open(io.BytesIO(mask_bytes)).convert('L')  # Grayscale mask
    
    # Resize to optimal size for SD (512x512 recommended)
    original_size = reference_image.size
    reference_image = reference_image.resize((512, 512), Image.LANCZOS)
    
    # Resize mask with BILINEAR (LANCZOS can create ringing on masks)
    # Then apply a slight Gaussian blur to smooth the transition for the AI
    mask_image = mask_image.resize((512, 512), Image.BILINEAR)
    mask_image = mask_image.filter(ImageFilter.GaussianBlur(radius=4))
    
    # Use prompt directly without forcing clothing/fabric keywords
    enhanced_prompt = prompt if prompt else "high quality, detailed"
    
    # Negative prompt to protect face and maintain quality
    negative_prompt = "face changes, facial features, distorted face, blurry face, deformed face, bad anatomy, low quality, blurry, distorted"
    
    print(f"🎚️ Inpainting with strength: {strength}")
    print(f"📝 Prompt: {enhanced_prompt}")
    print(f"🚫 Negative prompt: {negative_prompt}")
    
    # Inpaint with Stable Diffusion
    result = sd_pipe(
        prompt=enhanced_prompt,
        negative_prompt=negative_prompt,  # Tell AI what NOT to do
        image=reference_image,
        mask_image=mask_image,
        strength=float(strength),  # How much to change (0.0-1.0)
        num_inference_steps=50,
        guidance_scale=7.5,
    ).images[0]
    
    # Resize back to original size and restore the original alpha channel (background cutout)
    result = result.resize(original_size, Image.LANCZOS).convert('RGBA')
    result.putalpha(original_rgba.split()[3])
    
    # Save to byte buffer
    byte_io = io.BytesIO()
    result.save(byte_io, 'PNG')
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
        from rembg import remove as rembg_remove
        print("   🪄 Removing background using rembg...")
        img_bytes_io = io.BytesIO()
        img_pil.save(img_bytes_io, format="PNG")
        img_bytes_val = img_bytes_io.getvalue()
        result_bytes = rembg_remove(img_bytes_val)
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

    # Center horizontally, align to bottom (feet at the bottom)
    x_offset = (canvas_w - new_w) // 2
    y_offset = canvas_h - new_h  # stick figure to the bottom of canvas

    canvas.paste(scaled_img, (x_offset, y_offset))

    print(f"✅ Normalized to 512x1024 white canvas (scale={scale:.2f})")
    return canvas

# --- 3. DEFINE API ENDPOINTS ---

# Route for translating doodle with Pix2Pix
@app.post('/translate-doodle')
async def translate_doodle_endpoint(file: UploadFile = File(...)):
    """Translates doodle using Pix2Pix model"""
    start = time.perf_counter()
    try:
        img_bytes = await file.read()
        result_bytes = translate_doodle(img_bytes)
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

# Global cache for latents to make slider adjustments instant
latent_cache = {}
import hashlib

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
    steps: str = Form('50'),
    guidance: str = Form('7.5'),
):
    """Generates a human figure from a text prompt using Stable Diffusion"""
    if sd_pipe is None:
        raise HTTPException(status_code=500, detail="Stable Diffusion model not loaded")

    prompt = prompt + ", pure white background, white backdrop, clean studio"
    negative_prompt = negative_prompt + ", complex background, messy background, outdoors, scenery, landscape"

    print(f"🧑 Starting Text-to-Human Generation...")
    print(f"📝 Prompt: {prompt}")
    print(f"🚫 Negative: {negative_prompt}")
    start = time.perf_counter()

    try:
        # Create a blank white canvas — SD inpainting will replace everything
        width, height = 512, 768
        blank_image = Image.new("RGB", (width, height), (255, 255, 255))
        mask_image = Image.new("L", (width, height), 255)  # All-white mask = generate everywhere

        result = sd_pipe(
            prompt=prompt,
            negative_prompt=negative_prompt,
            image=blank_image,
            mask_image=mask_image,
            strength=1.0,              # Full generation from noise
            num_inference_steps=int(steps),
            guidance_scale=float(guidance),
        ).images[0]

        # Try to remove the background
        try:
            from rembg import remove as rembg_remove
            print("   🪄 Removing background using rembg...")
            img_bytes_io = io.BytesIO()
            result.save(img_bytes_io, format="PNG")
            result_bytes = rembg_remove(img_bytes_io.getvalue())
            result = Image.open(io.BytesIO(result_bytes)).convert("RGBA")
            print("   ✅ Background removed successfully.")
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
    """Suggests a color palette from a text prompt using low-step Stable Diffusion"""
    if sd_pipe is None:
        raise HTTPException(status_code=500, detail="Stable Diffusion model not loaded")
    
    print(f"🎨 Suggesting colors for: {prompt}")
    start = time.perf_counter()
    
    try:
        # Create a small blank canvas for speed
        width, height = 256, 256
        blank_image = Image.new("RGB", (width, height), (255, 255, 255))
        mask_image = Image.new("L", (width, height), 255)
        
        # Guide towards abstract color blobs
        enhanced_prompt = f"abstract color palette study, vibrant color blobs, {prompt}, high quality"
        
        # Low steps for fast "vibe" generation
        result = sd_pipe(
            prompt=enhanced_prompt,
            image=blank_image,
            mask_image=mask_image,
            strength=1.0,
            num_inference_steps=2, 
            guidance_scale=7.5,
        ).images[0]
        
        byte_io = io.BytesIO()
        result.save(byte_io, 'PNG')
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
    response = JSONResponse(serialize_user(created_user))
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
    response = JSONResponse(serialize_user(user_doc))
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
