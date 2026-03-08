import os
import sys
import pickle
import torch
import torch.nn.functional as F
from typing import Optional

# Try to make NVLabs StyleGAN2-ADA modules discoverable if vendored
_VENDOR_CANDIDATES = [
	os.path.join(os.path.dirname(os.path.dirname(__file__)), "vendor", "stylegan2-ada-pytorch"),
	os.path.join(os.path.dirname(os.path.dirname(__file__)), "StyleGAN-Human"),
]
for _p in _VENDOR_CANDIDATES:
	if os.path.isdir(_p) and _p not in sys.path:
		sys.path.insert(0, _p)

try:
	import torch_utils  # type: ignore
	import dnnlib  # type: ignore
	# Skip compiling custom CUDA ops; force reference implementations for speed/stability
	try:
		from torch_utils import custom_ops  # type: ignore
		def _skip_plugin(*args, **kwargs):
			return None
		custom_ops.get_plugin = _skip_plugin  # type: ignore[attr-defined]
	except Exception:
		pass
except Exception:
	pass


def resolve_device(preferred: Optional[str] = None) -> torch.device:
	if preferred is not None:
		return torch.device(preferred)
	return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def load_model(model_path: str = "../model/stylegan_human_v2_1024.pkl", device: Optional[str] = None):
	"""Load StyleGAN generator from pickle (expects dict with 'G_ema').
	Raises FileNotFoundError with a helpful message if missing.
	"""
	if not os.path.isfile(model_path):
		raise FileNotFoundError(
			f"Model file not found at '{model_path}'. Place your .pkl in 'model/' or pass an explicit path."
		)
	dev = resolve_device(device)
	
	# Monkey-patch torch.load to bypass weights_only=True security error in torch>=2.6
	# since dnnlib calls it internally during unpickling.
	import torch
	if hasattr(torch.serialization, 'load'):
		_orig_load = torch.load
		def _patched_load(*args, **kwargs):
			kwargs['weights_only'] = False
			return _orig_load(*args, **kwargs)
		torch.load = _patched_load

	with open(model_path, "rb") as f:
		obj = pickle.load(f)
		G = obj["G_ema"] if isinstance(obj, dict) and "G_ema" in obj else obj
		
	if hasattr(torch.serialization, 'load'):
		torch.load = _orig_load  # restore

	G = G.to(dev)
	G.eval()
	return G


@torch.no_grad()
def image_to_latent(G, image_path_or_bytes, device: Optional[str] = None):
	"""Random W or W+ latent (fast placeholder)."""
	dev = resolve_device(device) if device is not None else next(G.parameters()).device
	z = torch.randn([1, G.z_dim], device=dev)
	w = G.mapping(z, None)
	if hasattr(G, "num_ws") and w.shape[1] != getattr(G, "num_ws"):
		w = w[:, :1].repeat(1, G.num_ws, 1)
	return w


def project_image(G, pil_image, steps: int = 1000, lr: float = 0.1, device: Optional[str] = None):
	"""Optimize W+ latent to match a given PIL image.

	Key fixes and improvements:
	  - Correct aspect ratio: StyleGAN outputs 1024×512 (H×W portrait).
	    Target is first normalized to 1024×512, then LPIPS is computed at
	    512×256 (half-res, correct 2:1 ratio) — no more squashing distortion.
	  - Full-resolution L2 term at 1024×512 for accurate color/structure.
	  - 1000 steps with LR warmup (20 steps) + cosine annealing for smooth convergence.
	  - 64-sample W-space mean for a stable, representative start point.
	"""
	from torchvision.transforms.functional import to_tensor
	import lpips
	import math

	dev = resolve_device(device) if device is not None else next(G.parameters()).device

	# StyleGAN-Human v2 1024 model synthesises [B,C,1024,512] — portrait format
	CANVAS_H, CANVAS_W = 1024, 512

	# ---- initialise W+ from the mapping network mean ----
	with torch.no_grad():
		z = torch.randn([64, G.z_dim], device=dev)
		w_samples = G.mapping(z, None)
		if hasattr(G, "num_ws") and w_samples.shape[1] != getattr(G, "num_ws"):
			w_samples = w_samples[:, :1].repeat(1, G.num_ws, 1)
		w_avg = w_samples.mean(dim=0, keepdim=True)   # [1, num_ws, c]

	# ---- prepare multi-scale targets at the CORRECT aspect ratio ----
	target = to_tensor(pil_image).to(dev)        # [C,H,W] in [0,1]
	target = target * 2.0 - 1.0                  # → [-1,1]

	# Normalise target to the canvas size so we compare apples-to-apples
	target_full = F.interpolate(target.unsqueeze(0),
	                            size=(CANVAS_H, CANVAS_W), mode='bilinear',
	                            align_corners=False)          # [1,C,1024,512]

	# Half-res target: 512×256 — correct 2:1 portrait ratio
	target_half = F.interpolate(target_full,
	                            size=(CANVAS_H // 2, CANVAS_W // 2),
	                            mode='area')                  # [1,C,512,256]

	# Quarter-res target: 256×128
	target_qtr = F.interpolate(target_full,
	                           size=(CANVAS_H // 4, CANVAS_W // 4),
	                           mode='area')                   # [1,C,256,128]

	# ---- Spatial weight map: upweight face region ----
	# In SHHQ-style full-body images, the face occupies roughly the top 18-22%
	# of the 1024px canvas (rows 0 ~ 204). Multiplying those rows by 4 in L2
	# forces the optimizer to preserve face appearance without hurting clothing.
	weight_map = torch.ones(1, 1, CANVAS_H, CANVAS_W, device=dev)
	face_row_end = int(CANVAS_H * 0.25)      # top 25% → row 256
	weight_map[:, :, :face_row_end, :] = 6.0  # 6× weight on face rows

	# LPIPS uses (N,C,H,W) with values in [-1,1] — works at any res
	loss_fn = lpips.LPIPS(net='vgg').to(dev).eval()

	# ---- optimise W+ ----
	w_opt = w_avg.clone().detach().requires_grad_(True)
	opt = torch.optim.Adam([w_opt], lr=lr)

	# LR schedule: short linear warmup → cosine decay
	warmup_steps = 20
	def lr_lambda(step):
		if step < warmup_steps:
			return step / warmup_steps             # ramp 0→lr
		progress = (step - warmup_steps) / max(steps - warmup_steps, 1)
		return 0.5 * (1.0 + math.cos(math.pi * progress)) * 0.99 + 0.01  # 1→0.01

	scheduler = torch.optim.lr_scheduler.LambdaLR(opt, lr_lambda)

	# Pre-compute face crop targets for dedicated face LPIPS
	face_tgt_crop = target_full[:, :, :face_row_end, :]          # [1,C,256,512]
	face_tgt_sq   = F.interpolate(face_tgt_crop, size=(256, 256), mode='area')

	for step in range(steps):
		opt.zero_grad(set_to_none=True)
		img = G.synthesis(w_opt, noise_mode='const')     # [1,C,1024,512]

		# ── Body perceptual loss at half-res 512×256 (correct 2:1 ratio) ──────
		img_half = F.interpolate(img, size=(CANVAS_H // 2, CANVAS_W // 2), mode='area')
		percep   = loss_fn(img_half, target_half).mean()

		# ── Dedicated face-region LPIPS (face crop → 256×256 square) ──────────
		# Gives VGG a focused gradient signal on the face without squashing the body
		face_gen_crop = img[:, :, :face_row_end, :]
		face_gen_sq   = F.interpolate(face_gen_crop, size=(256, 256), mode='area')
		percep_face   = loss_fn(face_gen_sq, face_tgt_sq).mean()

		# ── Multi-scale L2 ────────────────────────────────────────────────────
		img_qtr  = F.interpolate(img, size=(CANVAS_H // 4, CANVAS_W // 4), mode='area')
		l2_half  = F.mse_loss(img_half, target_half)
		l2_qtr   = F.mse_loss(img_qtr,  target_qtr)
		# Face rows (top 25%) weighted 6× in full-res pixel loss
		l2_full  = (weight_map * (img - target_full) ** 2).mean()

		# ── W regularization (very light) ─────────────────────────────────────
		w_reg = 0.01 * F.mse_loss(w_opt, w_avg)

		# ── Combined loss ─────────────────────────────────────────────────────
		# 0.4 face_percep: strong enough to fix faces, small enough to not hurt clothing
		loss = (percep
		        + 0.4 * percep_face
		        + 0.5 * l2_half
		        + 0.3 * l2_qtr
		        + 0.3 * l2_full
		        + w_reg)
		loss.backward()
		opt.step()
		scheduler.step()

	return w_opt.detach()