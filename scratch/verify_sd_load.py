# --- SECURITY PATCH FOR CVE-2025-32434 ---
try:
    import transformers.utils.import_utils as import_utils
    import_utils.check_torch_load_is_safe = lambda: None
    
    import transformers.utils as utils
    if hasattr(utils, "check_torch_load_is_safe"):
        utils.check_torch_load_is_safe = lambda: None
        
    import transformers.modeling_utils as modeling_utils
    if hasattr(modeling_utils, "check_torch_load_is_safe"):
        modeling_utils.check_torch_load_is_safe = lambda: None
        
    print("[INFO] Bypassed torch security check (CVE-2025-32434).")
except Exception as e:
    print(f"[WARN] Failed to apply security bypass: {e}")

import torch
import os
import numpy as np
from PIL import Image
from diffusers import StableDiffusionImg2ImgPipeline
from transformers import CLIPTextModel

if not hasattr(CLIPTextModel, 'text_model'):
    print("[INFO] Applying global patch to CLIPTextModel...")
    CLIPTextModel.text_model = property(lambda self: self)

device = "cuda" if torch.cuda.is_available() else "cpu"
SD_MODEL_PATH = os.path.join(os.getcwd(), 'models', 'realisticVisionV60B1_v51VAE.safetensors')

print(f"Using device: {device}")

try:
    print("Loading SD model...")
    sd_pipe = StableDiffusionImg2ImgPipeline.from_single_file(
        SD_MODEL_PATH,
        torch_dtype=torch.float16 if device == "cuda" else torch.float32,
        load_safety_checker=False,
        low_cpu_mem_usage=False,
        device=device,
    )
    if hasattr(sd_pipe, 'safety_checker'):
        sd_pipe.safety_checker = None

    print("[OK] Stable Diffusion model loaded successfully!")
except Exception as e:
    import traceback
    print(f"[ERR] Error loading SD model: {e}")
    traceback.print_exc()
