import torch
import io
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
import uvicorn
from PIL import Image
from torchvision import transforms
import os
import base64
import numpy as np
# IMPORTANT: This import requires the 'networks.py' file from the original
# pix2pix repo to be in the same directory as this script.
from networks import UnetGenerator
script_dir = os.path.dirname(__file__)

import sys
stylebend_path = os.path.join(script_dir, 'stylebend')
if stylebend_path not in sys.path:
    sys.path.append(stylebend_path)

from scripts.inversion import load_model, project_image, resolve_device
from scripts.blending import blend_latents

# --- 1. CONFIGURATION ---
# Pix2Pix model for doodle translation
MODEL_PATH = os.path.join(script_dir, 'model', 'pix2pix.pth')
INPUT_NC = 3
OUTPUT_NC = 3
NGF = 64
NORM_LAYER = torch.nn.BatchNorm2d
USE_DROPOUT = True

# Stable Diffusion model for inpainting
SD_MODEL_PATH = os.path.join(script_dir, 'model', 'v1-5-pruned-emaonly.safetensors')

# StyleGAN model for style blending
STYLEGAN_MODEL_PATH = os.path.join(script_dir, 'model', 'stylegan_human_v2_1024.pkl')

device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Using device: {device}")

# --- 2. INITIALIZE FASTAPI APP AND LOAD MODELS ---
app = FastAPI(title="ClothCraft AI")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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
        torch_dtype=torch.float16 if device == "cuda" else torch.float32,
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



def translate_doodle(doodle_bytes):
    """Translates doodle using Pix2Pix model"""
    print("🎨 Running Pix2Pix doodle translation...")
    image = Image.open(io.BytesIO(doodle_bytes)).convert('RGB')
    input_tensor = transform(image).unsqueeze(0)

    with torch.no_grad():
        output_tensor = pix2pix_model(input_tensor)

    # De-normalize the output tensor from [-1, 1] to [0, 1]
    output_image = output_tensor.squeeze(0).cpu()
    output_image = (output_image * 0.5) + 0.5
    
    # Convert tensor back to a PIL Image
    output_image = transforms.ToPILImage()(output_image)

    # Save image to a byte buffer to send as response
    byte_io = io.BytesIO()
    output_image.save(byte_io, 'PNG')
    byte_io.seek(0)
    
    return byte_io

def inpaint_with_stable_diffusion(reference_image_bytes, mask_bytes, prompt="", strength=0.75):
    """Inpaints reference image using Stable Diffusion with the mask"""
    if sd_pipe is None:
        raise Exception("Stable Diffusion model not loaded")
    
    # Load reference image and mask
    reference_image = Image.open(io.BytesIO(reference_image_bytes)).convert('RGB')
    mask_image = Image.open(io.BytesIO(mask_bytes)).convert('L')  # Grayscale mask
    
    # Resize to optimal size for SD (512x512 recommended)
    original_size = reference_image.size
    reference_image = reference_image.resize((512, 512), Image.LANCZOS)
    mask_image = mask_image.resize((512, 512), Image.LANCZOS)
    
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
    
    # Resize back to original size
    result = result.resize(original_size, Image.LANCZOS)
    
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
    except Exception as e:
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
    try:
        img_bytes = await file.read()
        result_bytes = translate_doodle(img_bytes)
        return StreamingResponse(result_bytes, media_type='image/png')
    except Exception as e:
        print(f"Error translating doodle: {e}")
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
    try:
        reference_bytes = await reference.read()
        mask_bytes = await mask.read()
        result_bytes = inpaint_with_stable_diffusion(
            reference_bytes,
            mask_bytes,
            prompt,
            float(strength)
        )
        return StreamingResponse(result_bytes, media_type='image/png')
    except Exception as e:
        print(f"Error inpainting: {e}")
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
        return StreamingResponse(result_bytes, media_type='image/png')
    except Exception as e:
        print(f"Error refining pattern: {e}")
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
            
        return JSONResponse({"frames": frames})
    except Exception as e:
        print(f"Error blending styles: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- 4. RUN THE APP ---
if __name__ == '__main__':
    print("\n🚀 Starting FastAPI server...")
    print("Docs:          http://127.0.0.1:5000/docs")
    print("API endpoint:  http://127.0.0.1:5000/predict")
    print("React frontend should run on http://localhost:5173")
    uvicorn.run(app, host='0.0.0.0', port=5000)