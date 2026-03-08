import torch
from PIL import Image
import torchvision.transforms.functional as TF


def _tensor_to_pil(img_tensor: torch.Tensor) -> Image.Image:
	# img_tensor: [N,C,H,W] or [C,H,W] in [-inf, +inf]; clamp to [-1,1], map to [0,1]
	if img_tensor.dim() == 4:
		img_tensor = img_tensor[0]
	img_tensor = img_tensor.clamp(-1, 1)
	img_tensor = (img_tensor + 1.0) / 2.0  # [0,1]
	return TF.to_pil_image(img_tensor.cpu())


def blend_latents(G, w1: torch.Tensor, w2: torch.Tensor, alpha: float = 0.5):
	"""Linear interpolate two latents and synthesize a PIL image."""
	alpha = float(min(max(alpha, 0.0), 1.0))
	w = (1.0 - alpha) * w1 + alpha * w2
	with torch.no_grad():
		img = G.synthesis(w, noise_mode="const")  # [N, C, H, W]
	return _tensor_to_pil(img) 