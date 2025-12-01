# Image-to-Image Enhancement Workflows

This project provides three progressive workflows that build on each other to turn rough doodles into refined imagery using Pix2Pix and Stable Diffusion. Each workflow can be run end-to-end with the same Flask backend and React frontend.

---

## 1. Quick Pix2Pix Translation (Baseline)

**Goal:** Instantly translate a doodle into a styled result by running it through the Pix2Pix UNet generator.

**When to use:**
- You only need a fast preview of how the model interprets a doodle.
- No compositing or Stable Diffusion post-processing is required.

**Data flow:**
1. User uploads a reference image (optional in this mode) and draws on the transparent doodle layer.
2. Frontend sends **only the doodle** (`PNG`, transparent background) to the backend.
3. Backend endpoint: `POST /translate-doodle`
   - Loads `models/pix2pix.pth` via `UnetGenerator`.
   - Applies the training transform (resize → tensor → normalize).
   - Runs a forward pass and returns the translated image (`PNG`).
4. Frontend displays the translated doodle directly.

**Key files:**
- `app.py` → `translate_doodle`
- `frontend/src/utils/imageProcessing.js` → `translateDoodle`

**Pros / Cons:**
- ✅ Extremely fast (single model inference)
- ❌ No compositing with the original reference image

---

## 2. Pix2Pix + Reference Compositing (Mask Extraction)

**Goal:** Keep the original reference image untouched while extracting only the meaningful pixels from the Pix2Pix output.

**When to use:**
- You want the Pix2Pix stylization but need it perfectly aligned on top of the reference.
- You must suppress black backgrounds or unchanged regions from the model output.

**Data flow:**
1. User draws a doodle on top of the reference in the canvas UI.
2. Frontend sends **only the doodle** to `POST /translate-doodle` and receives the translated doodle.
3. Frontend composites the translation onto the reference using smart masking:
   - Scales Pix2Pix output back to the original canvas size.
   - Uses the original doodle as a mask so only painted regions are kept.
   - Handles *black doodles* by comparing original and translated pixels:
     ```javascript
     if (translatedIsBlack && !originalWasBlack) skip; else keep;
     ```
4. Result: reference image + stylized doodle, perfectly aligned.

**Key files:**
- `frontend/src/utils/imageProcessing.js` → `compositeTranslatedDoodleOnReference`
- `frontend/src/components/DrawingCanvas.jsx` → `applyProcessedImage`

**Pros / Cons:**
- ✅ Keeps reference intact outside doodle regions
- ✅ Removes Pix2Pix black background artifacts
- ❌ Still limited to Pix2Pix stylization (no global image context)

---

## 3. Pix2Pix + Stable Diffusion Inpainting (Full Enhancement)

**Goal:** Blend the enhanced doodle seamlessly into the reference image using Stable Diffusion’s inpainting model.

**When to use:**
- You want photorealistic or highly artistic integration.
- You need prompt-driven control and fine-grained blend strength.

**Frontend Flow:**
1. User draws doodle (e.g., blue shirt on person)
   ↓
2. Doodle → Pix2Pix → Enhanced doodle (better looking blue shirt)
   ↓
3. Composite: Reference + Enhanced Doodle
   - (Now the reference has the blue shirt on it)
   ↓
4. Create mask from original doodle shape
   - (WHITE where doodle was drawn, BLACK elsewhere)
   ↓
5. Composited Image + Mask → Stable Diffusion
   - SD Input: Image with blue shirt already on it
   - SD Mask: Where to enhance/blend (the shirt area)
   ↓
6. Stable Diffusion enhances & blends the masked area
   - (Makes the blue shirt look natural with the whole image)
   ↓
7. Display final enhanced result

**Mask Feathering Visual Effect:**

Hard Edges (0% feathering):
```
Reference Image
┌─────────────────┐
│         ████████│  ← Sharp, visible boundary
│         ████████│
│    REF  █DOODLE█│
│         ████████│
└─────────────────┘
```

Soft Edges (75% feathering):
```
Reference Image
┌─────────────────┐
│         ▓▓▓▓▓▓▓▓│  ← Smooth gradient
│         ▒▒▒▒▒▒▒▒│     (blended transition)
│    REF  ░DOODLE░│
│         ▒▒▒▒▒▒▒▒│
└─────────────────┘
```

**Mask generation:**
- White (255) = areas to inpaint
- Black (0) = preserve
- Slider controls feathering amount (Gaussian blur between 5–50px) for soft transitions:
  ```javascript
  const blurRadius = Math.max(5, Math.round(featherAmount * 50));
  ```

**Backend Flow:**
1. Loads `StableDiffusionInpaintPipeline` from `models/v1-5-pruned-emaonly.safetensors` (CUDA if available).
2. Resizes image & mask to 512×512.
3. Calls `sd_pipe(... strength=float(strength))`.
4. Resizes back to original resolution and streams PNG response.

**Key files:**
- `app.py` → `inpaint_with_stable_diffusion`, `/inpaint`
- `frontend/src/App.jsx` → `handleTranslate` (full workflow orchestration)
- `frontend/src/utils/imageProcessing.js` → `createMaskFromDoodle`, `inpaintWithStableDiffusion`

**Pros / Cons:**
- ✅ Highest quality blending + prompt control
- ✅ Feathered masks prevent hard edges
- ❌ Requires Stable Diffusion weights (larger load time & GPU for best performance)

---

## Frontend Controls

| Control                | Purpose                                                     |
|------------------------|-------------------------------------------------------------|
| Brush Size slider      | Sets drawing stroke width                                   |
| Color picker           | Chooses doodle color                                        |
| Prompt input           | Text prompt for Stable Diffusion                            |
| Blend Strength slider  | Dual-purpose: (1) mask feathering, (2) SD `strength` value   |
| Translate button       | Triggers the selected workflow (default = Workflow #3)      |
| Clear Doodle / Reset   | Clears doodle layer or resets the entire session            |

**Blend Strength Guide:**
- 0% → Hard mask edges, minimal SD change
- 25% → Soft edges, light enhancements
- 50% → Moderate blend
- 75% → Soft edges, noticeable changes *(default)*
- 100% → Very soft edges, strong transformations

---

## Running the Stack

```bash
# Backend
pip install -r requirements.txt
python app.py          # Loads Pix2Pix immediately; SD takes up to ~1 minute

# Frontend (new terminal)
cd frontend
npm install
npm run dev            # Vite dev server on http://localhost:3000
```

> **Tip:** Use the slider and prompt to iteratively refine the Stable Diffusion output without re-uploading the reference image.

---

## API Reference

| Endpoint               | Method | Payload                                     | Description                                 |
|------------------------|--------|---------------------------------------------|---------------------------------------------|
| `/translate-doodle`    | POST   | `file` (doodle PNG)                         | Returns Pix2Pix translation                 |
| `/inpaint`             | POST   | `reference`, `mask`, `prompt`, `strength`   | Returns Stable Diffusion inpainted image    |

All responses stream PNG binary data; the frontend consumes them as `Blob` objects and displays them via `URL.createObjectURL`.

---

## Choosing the Right Workflow

| Scenario                                                    | Recommended Workflow                |
|-------------------------------------------------------------|-------------------------------------|
| Quick preview of doodle translation                         | Workflow #1 (Pix2Pix only)          |
| Need stylized doodle aligned on reference                   | Workflow #2 (Pix2Pix + compositing) |
| Highest fidelity, smooth blending, prompt-driven control    | Workflow #3 (Pix2Pix + SD Inpaint)  |

Every workflow shares the same canvas UI and doodle capture logic—only the backend orchestration changes. You can easily extend the system by adding new endpoints (e.g., style transfer, SDXL) and wiring them through `handleTranslate`.

---

**Next steps:**
- Experiment with prompts and blend strength to dial in desired results.
- Swap out `v1-5-pruned-emaonly.safetensors` for other inpainting checkpoints if needed.
- Extend the frontend to let users pick the workflow (toggle)
  or add preset buttons (“Quick Pix2Pix”, “Pix2Pix + Blend”, “Full SD Inpaint”).

Enjoy transforming rough doodles into polished artwork! 🎨✨
