import os
import streamlit as st
from PIL import Image
from scripts.inversion import load_model, image_to_latent, resolve_device, project_image
from scripts.blending import blend_latents

st.set_page_config(page_title="Fashion Style Bending", page_icon="🎨", layout="centered")
st.title("Fashion Style Bending 🎨")

MODEL_PATH_DEFAULT = "../model/stylegan_human_v2_1024.pkl"

st.markdown("Upload two images and blend their styles with StyleGAN-Human. Or generate random to test GPU.")

# Helper to resolve model path whether Streamlit is run from repo root or subfolder

def resolve_model_path(input_path: str) -> str:
	if os.path.isabs(input_path):
		return input_path
	candidates = [
		os.path.join(os.getcwd(), input_path),
		os.path.join(os.path.dirname(__file__), input_path),
		os.path.join(os.path.dirname(os.path.dirname(__file__)), input_path),
	]
	for p in candidates:
		if os.path.isfile(p):
			return p
	# Fall back to first candidate even if missing so user can see where we looked
	return candidates[0]

# Model path input and check
with st.expander("Model settings", expanded=True):
	model_path = st.text_input("Model .pkl path", value=MODEL_PATH_DEFAULT)
	device_choice = st.selectbox("Device", ["cuda", "cpu"], index=0)
	resolved_path = resolve_model_path(model_path)
	check = os.path.isfile(resolved_path)
	st.write("Resolved path:", resolved_path)
	st.write("Model file present:", "✅" if check else "❌")

@st.cache_resource(show_spinner=True)
def get_model_cached(path: str, device: str):
	return load_model(model_path=path, device=device)

# Load model only if present
G = None
if os.path.isfile(resolved_path):
	try:
		G = get_model_cached(resolved_path, device_choice)
		st.success(f"Model loaded on {resolve_device(device_choice)}")
	except Exception as e:
		st.error(f"Failed to load model: {e}")
else:
	st.warning("Place your model .pkl in 'model/' or provide a correct path above.")

colA, colB = st.columns(2)
with colA:
	img1 = st.file_uploader("Upload first fashion image", type=["jpg", "jpeg", "png"], key="img1")
with colB:
	img2 = st.file_uploader("Upload second fashion image", type=["jpg", "jpeg", "png"], key="img2")

# Random generation test (no uploads needed)
if G is not None:
	if st.button("Generate random sample"):
		with st.spinner("Generating..."):
			w = image_to_latent(G, None)
			from scripts.blending import torch
			img = G.synthesis(w, noise_mode="const")
			from torchvision.transforms.functional import to_pil_image
			img = (img.clamp(-1, 1) + 1) / 2.0
			img = to_pil_image(img[0].cpu())
			st.image(img, caption="Random Sample", use_column_width=True)

if G is not None and img1 and img2:
	alpha = st.slider("Blending intensity", 0.0, 1.0, 0.5, 0.05)
	if st.button("Compute projections and blend"):
		with st.spinner("Projecting images (may take ~30-60s each)..."):
			img1_pil = Image.open(img1).convert("RGB")
			img2_pil = Image.open(img2).convert("RGB")
			w1 = project_image(G, img1_pil, steps=200)
			w2 = project_image(G, img2_pil, steps=200)
			blended_img = blend_latents(G, w1, w2, alpha)
			st.image(blended_img, caption="Blended Fashion Output", use_column_width=True)
elif G is not None:
	st.info("Upload two images or try 'Generate random sample'.") 