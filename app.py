import torch
import io
from flask import Flask, request, send_file, jsonify
from flask_cors import CORS
from PIL import Image
from torchvision import transforms
import os
import base64
import numpy as np
from diffusers import StableDiffusionInpaintPipeline, StableDiffusionPipeline
# IMPORTANT: This import requires the 'networks.py' file from the original
# pix2pix repo to be in the same directory as this script.
from networks import UnetGenerator
script_dir = os.path.dirname(__file__)

# --- 1. CONFIGURATION ---
# Pix2Pix model for doodle translation
MODEL_PATH = os.path.join(script_dir, 'models', 'pix2pix.pth')
INPUT_NC = 3
OUTPUT_NC = 3
NGF = 64
NORM_LAYER = torch.nn.BatchNorm2d
USE_DROPOUT = True

# Stable Diffusion model for inpainting
SD_MODEL_PATH = os.path.join(script_dir, 'models', 'v1-5-pruned-emaonly.safetensors')
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Using device: {device}")

# --- 2. INITIALIZE FLASK APP AND LOAD MODELS ---
app = Flask(__name__)
CORS(app)  # Enable CORS for React frontend

# Load Pix2Pix model for doodle translation
try:
    pix2pix_model = UnetGenerator(INPUT_NC, OUTPUT_NC, 8, NGF, norm_layer=NORM_LAYER, use_dropout=USE_DROPOUT)
    state_dict = torch.load(MODEL_PATH, map_location=torch.device('cpu'))
    pix2pix_model.load_state_dict(state_dict)
    pix2pix_model.eval()
    print("✅ Pix2Pix model loaded successfully!")
except FileNotFoundError:
    print(f"❌ Error: Pix2Pix model file not found at {MODEL_PATH}")
    exit()
except Exception as e:
    print(f"❌ Error loading Pix2Pix model: {e}")
    exit()

# Load Stable Diffusion inpainting model
try:
    print("Loading Stable Diffusion model... (this may take a minute)")
    # Load as standard pipeline first to handle 4-channel weights
    pipe = StableDiffusionPipeline.from_single_file(
        SD_MODEL_PATH,
        torch_dtype=torch.float16 if device == "cuda" else torch.float32,
    )
    
    # Convert to inpainting pipeline
    # This keeps the 4-channel UNet and adapts it for inpainting
    sd_pipe = StableDiffusionInpaintPipeline(
        vae=pipe.vae,
        text_encoder=pipe.text_encoder,
        tokenizer=pipe.tokenizer,
        unet=pipe.unet,
        scheduler=pipe.scheduler,
        safety_checker=None,
        feature_extractor=pipe.feature_extractor,
        image_encoder=None
    ).to(device)
    
    print("✅ Stable Diffusion model loaded successfully (adapted for inpainting)!")
except FileNotFoundError:
    print(f"❌ Error: Stable Diffusion model not found at {SD_MODEL_PATH}")
    sd_pipe = None
except Exception as e:
    print(f"❌ Error loading Stable Diffusion: {e}")
    print("Inpainting will not be available")
    sd_pipe = None


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

# --- 3. DEFINE API ENDPOINTS ---

# Route for translating doodle with Pix2Pix
@app.route('/translate-doodle', methods=['POST'])
def translate_doodle_endpoint():
    """Translates doodle using Pix2Pix model"""
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
    
    try:
        img_bytes = file.read()
        result_bytes = translate_doodle(img_bytes)
        return send_file(result_bytes, mimetype='image/png')
    except Exception as e:
        print(f"Error translating doodle: {e}")
        return jsonify({"error": str(e)}), 500

# Route for inpainting with Stable Diffusion
@app.route('/inpaint', methods=['POST'])
def inpaint():
    """Inpaints reference image using Stable Diffusion with translated doodle as mask"""
    if 'reference' not in request.files or 'mask' not in request.files:
        return jsonify({"error": "Missing reference or mask"}), 400
    
    reference_file = request.files['reference']
    mask_file = request.files['mask']
    prompt = request.form.get('prompt', 'high quality, detailed')
    strength = request.form.get('strength', '0.75')
    
    print("👕 Starting Clothify Inpainting...")
    
    try:
        reference_bytes = reference_file.read()
        mask_bytes = mask_file.read()
        result_bytes = inpaint_with_stable_diffusion(
            reference_bytes, 
            mask_bytes, 
            prompt,
            float(strength)
        )
        return send_file(result_bytes, mimetype='image/png')
    except Exception as e:
        print(f"Error inpainting: {e}")
        return jsonify({"error": str(e)}), 500

# Legacy endpoint (kept for backward compatibility)
@app.route('/predict', methods=['POST'])
def predict():
    """Legacy endpoint - redirects to translate-doodle"""
    return translate_doodle_endpoint()

# Route for refining pattern
@app.route('/refine-pattern', methods=['POST'])
def refine_pattern_endpoint():
    """Refines a pattern using Stable Diffusion (img2img via inpainting)"""
    if 'image' not in request.files:
        return jsonify({"error": "No image file"}), 400
    
    image_file = request.files['image']
    prompt = request.form.get('prompt', 'seamless pattern, high quality')
    strength = request.form.get('strength', '0.6')
    
    print("✨ Starting Pattern Refinement...")
    
    try:
        image_bytes = image_file.read()
        
        # Create a full white mask for the image
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        mask = Image.new("L", img.size, 255) # White mask = inpaint everything
        
        mask_io = io.BytesIO()
        mask.save(mask_io, format="PNG")
        mask_bytes = mask_io.getvalue()
        
        # Use existing inpaint function
        result_bytes = inpaint_with_stable_diffusion(
            image_bytes, 
            mask_bytes, 
            prompt,
            strength=float(strength)
        )
        return send_file(result_bytes, mimetype='image/png')
    except Exception as e:
        print(f"Error refining pattern: {e}")
        return jsonify({"error": str(e)}), 500

# --- 4. RUN THE APP ---
if __name__ == '__main__':
    print("\n🚀 Starting Flask server...")
    print("API endpoint: http://127.0.0.1:5000/predict")
    print("React frontend should run on http://localhost:3000")
    app.run(debug=True, host='0.0.0.0', port=5000)