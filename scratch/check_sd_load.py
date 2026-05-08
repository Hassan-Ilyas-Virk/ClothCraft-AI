import torch
import os
from diffusers import StableDiffusionImg2ImgPipeline

SD_MODEL_PATH = 'models/realisticVisionV60B1_v51VAE.safetensors'
device = "cuda" if torch.cuda.is_available() else "cpu"

print(f"Testing SD load on {device}...")
try:
    pipe = StableDiffusionImg2ImgPipeline.from_single_file(
        SD_MODEL_PATH,
        torch_dtype=torch.float16 if device == "cuda" else torch.float32
    ).to(device)
    print("✅ Successfully loaded Realistic Vision!")
except Exception as e:
    print(f"❌ Failed to load: {e}")
    import traceback
    traceback.print_exc()
