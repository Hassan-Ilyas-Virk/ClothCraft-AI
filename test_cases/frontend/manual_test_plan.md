# Clothify — Manual Frontend Test Plan

Comprehensive checklist for verifying all UI features in the Clothify React
frontend. Run this after every major release. Tick each box as you verify it.

---

## 1. Authentication

### 1.1 Login / Signup Page
- [ ] Navigating to `/` shows the animated Iridescence background
- [ ] The ClothCraft AI logo and login form are visible
- [ ] Clicking "Create account" switches to the signup form
- [ ] **Signup**: fill name, email, password → submit → redirects to Home
- [ ] **Signup duplicate email**: re-submit same email → shows "email already exists" error
- [ ] **Login**: correct credentials → redirects to Home
- [ ] **Login wrong password**: shows "Incorrect email or password" error
- [ ] **Login empty fields**: form validation prevents submission

### 1.2 Session Persistence
- [ ] Refresh the page while logged in → session is restored (no redirect to login)
- [ ] Open a new tab → still logged in (JWT cookie persists)

### 1.3 Logout
- [ ] Click avatar / profile icon → Profile modal opens
- [ ] Close modal, then click Logout → redirects to login page
- [ ] After logout, navigating back shows login page (session cleared)

---

## 2. Home Page

- [ ] Logged-in user's name and avatar initial appear in the top bar
- [ ] "New Project" card is visible
- [ ] Clicking "New Project" navigates to the canvas view
- [ ] Existing projects appear as cards with thumbnails
- [ ] **Open project**: click any project card → loads canvas with saved state
- [ ] **Rename project**: hover card → rename icon → type new name → Enter confirms
- [ ] **Duplicate name on rename**: shows conflict error, not saved
- [ ] **Delete project**: hover card → delete icon → confirms deletion → removed from list
- [ ] Dark mode toggle in header → entire page switches theme
- [ ] Projects sorted newest-first (most recently updated at top)

---

## 3. Canvas View — Layout

- [ ] Left toolbar is visible with all tool buttons
- [ ] Central canvas area has a checkerboard (transparent) background
- [ ] Right layers panel is visible
- [ ] Top bar shows project name (editable inline), undo/redo, and Back button
- [ ] Back button from empty canvas → project silently deleted, returns to Home
- [ ] Back button with content → project auto-saved, returns to Home

---

## 4. Reference Image Upload

- [ ] Click the upload area → file picker opens
- [ ] Upload a portrait JPEG (1:2 ratio) → canvas resizes to match image
- [ ] **Crop modal**: uploading a non-1:2 image opens the crop dialog
- [ ] Crop modal: pan, zoom slider work; "Apply Crop" produces cropped result
- [ ] Crop modal: "Cancel" closes without loading image
- [ ] After upload, reference layer appears pinned at the bottom of layers panel
- [ ] Reference layer is locked by default (lock icon shows)
- [ ] Reference layer thumbnail updates to match the image

---

## 5. Drawing Tools

### 5.1 Brush
- [ ] Select Brush → draw on canvas → strokes appear in the active layer colour
- [ ] Colour picker changes stroke colour immediately
- [ ] Brush size slider changes stroke thickness
- [ ] Preview dot in BrushControls reflects current colour and size

### 5.2 Eraser
- [ ] Select Eraser → drag over strokes → pixels become transparent
- [ ] Eraser size slider works independently of brush size

### 5.3 Pan & Zoom
- [ ] Pan tool: drag canvas → pans viewport
- [ ] Hold Spacebar with any tool → temporarily pans
- [ ] Zoom tool: click → zooms in; Shift+click → zooms out
- [ ] Ctrl+Scroll → zooms in/out smoothly
- [ ] Canvas fits within viewport on initial load

### 5.4 Selection Tools
- [ ] **Marquee select**: drag → rectangle selection with marching-ant dashes
- [ ] **Lasso select**: freehand closed selection visible
- [ ] With selection active → Delete key → selected pixels cleared
- [ ] Escape key → commits floating selection / deselects

### 5.5 Shape Tools
- [ ] Rectangle: drag → stroked rectangle drawn in brush colour
- [ ] Circle: drag → stroked ellipse drawn in brush colour

### 5.6 Text Tool
- [ ] Click canvas → text overlay input appears
- [ ] Type text → text renders live in the overlay
- [ ] Press Enter → text stamped onto the canvas layer
- [ ] Text overlay resize handle works (drag corner)
- [ ] Clicking outside text box commits text

### 5.7 Transform Tool
- [ ] Select drawing layer → transform tool shows bounding box handles
- [ ] Drag inside bounding box → moves layer pixels
- [ ] Drag corner handles → scales layer
- [ ] With a selection active → transform extracts floating selection
- [ ] Escape commits floating selection at current position

### 5.8 Undo / Redo
- [ ] Draw → Ctrl+Z → stroke removed (per-layer history)
- [ ] Ctrl+Z again → previous stroke removed
- [ ] Ctrl+Shift+Z (or Ctrl+Y) → redo restores stroke
- [ ] Undo disabled (greyed out) when no history
- [ ] Redo disabled after new stroke is drawn

---

## 6. Layers Panel

- [ ] Drawing layers appear above the pinned reference layer
- [ ] "+ Add Layer" button adds a new empty drawing layer
- [ ] Active layer highlighted in the panel
- [ ] Clicking a layer row makes it active on the canvas
- [ ] **Locked layers**: clicking a locked layer row does not make it active
- [ ] **Eye icon**: toggle hides/shows the layer on the canvas
- [ ] **Lock icon**: toggle locks/unlocks the layer
- [ ] **Delete icon**: removes the drawing layer
- [ ] **Drag-and-drop reorder**: drag a drawing layer up/down → canvas render order changes
- [ ] Drop gap highlighted as layer is dragged past it
- [ ] Reference layer cannot be dragged

### 6.1 Opacity & Blend Mode
- [ ] Opacity slider changes layer transparency on the canvas in real time
- [ ] Blend mode dropdown changes the compositing mode (Multiply, Screen, etc.)

### 6.2 Context Menu (right-click layer)
- [ ] Drawing layer context menu shows: Clothify, Rename, Duplicate, Pattern Maker, Merge Down, Delete
- [ ] Reference layer context menu shows: Text to Clothes, Stylebend Reference, Convert to Doodle
- [ ] **Rename**: double-click via menu → inline edit → Enter commits, Escape cancels
- [ ] **Duplicate**: creates a copy above the selected layer
- [ ] **Merge Down**: merges drawing layer onto the one below (greyed out if no layer below)

---

## 7. Clothify Pipeline (Pix2Pix + SD)

- [ ] Right-click drawing layer → Clothify → ClothifyModal opens
- [ ] Modal shows layer name, prompt textarea, and blend strength slider
- [ ] **Blend strength = 0**: "Pix2Pix only" label shown; SD step skipped
- [ ] Click Generate → progress bar appears with status messages
- [ ] After generation, preview image appears in the modal
- [ ] **Regenerate**: change prompt → click again → new preview
- [ ] **Clear**: clears preview back to placeholder
- [ ] **Apply to Reference**: result replaces reference layer; drawing layer removed
- [ ] Cancel button closes modal without changes
- [ ] Clicking dark overlay closes modal without changes

---

## 8. Live Pix2Pix Preview

- [ ] Click the lightning bolt (Zap) button → Live Preview pane appears on the right
- [ ] Drawing on the canvas → after ~700 ms debounce, preview updates
- [ ] Preview shows translated result composited onto the reference image
- [ ] "Pix2Pix Preview" header shows layer count
- [ ] Loading spinner appears during processing
- [ ] Multiple drawing layers are all translated and composited
- [ ] Toggling a layer's visibility removes it from the live preview
- [ ] Clicking the Zap button again → hides Live Preview pane

---

## 9. Pattern Maker

- [ ] Right-click drawing layer → Pattern Maker → PatternMakerModal opens
- [ ] Pattern preview canvas shows tiled version of the layer
- [ ] **Scale slider**: changes tile size in real time
- [ ] **Rotation slider**: rotates tiles in real time
- [ ] **Spacing X/Y sliders**: adds gap between tiles
- [ ] **Background colour**: picker sets tile background
- [ ] **Transparent toggle**: removes background fill
- [ ] Prompt preset buttons populate element and pattern prompt fields
- [ ] **Refine Element** button: sends doodle to SD inpainting → replaces source image
- [ ] **Refine Pattern** button: sends tiled result to SD → overlay shows refined image
- [ ] **Apply**: adds pattern as a new drawing layer above the stack
- [ ] Cancel closes without adding a layer

---

## 10. Moodboard / Colour Extractor

- [ ] Click Palette icon in toolbar → MoodboardModal opens
- [ ] **Upload mode**: upload an image → 4 dominant colour swatches extracted
- [ ] **AI mode**: type a mood (e.g. "sad winter") → 4 swatches appear
- [ ] Click a swatch → swatch gets a check mark (selected)
- [ ] Click "Apply" → active brush colour updates to selected swatch
- [ ] Selected swatches appear as clickable chips in the toolbar palette
- [ ] Clicking a toolbar swatch sets the brush colour
- [ ] Re-opening moodboard → previous swatches cleared
- [ ] Cancel closes without changing brush colour

---

## 11. Stylebend (StyleGAN Latent Blending)

- [ ] Click Stylebend button in header (or right-click reference layer → Stylebend Reference) → modal opens
- [ ] Subject Image is pre-populated from the reference layer
- [ ] Upload a second Style Image → thumbnail appears
- [ ] **Normalize background checkboxes**: toggle works for each image
- [ ] Click Generate → progress bar shows "Projecting into StyleGAN space…" stages
- [ ] After generation, result image appears
- [ ] **Alpha slider**: drag left/right → different blended frames shown instantly (no re-request)
- [ ] **Remove image (×)**: clears the upload slot, resets frames
- [ ] Click Apply → result passed through SD refinement (progress indicator) → applied to reference layer
- [ ] Cancel closes without changes
- [ ] **DoubleImageCropperModal**: if images are not 1:2 ratio, crop modal opens for both

---

## 12. Text to Clothes

- [ ] Right-click reference layer → Text to Clothes → TextToClothesModal opens
- [ ] Colour chip buttons (Red, Blue, Black…) append to the prompt
- [ ] Garment chip buttons (Shirt, Dress, Blazer…) append to the prompt
- [ ] Strength slider range is 0.5–1.0
- [ ] Click Generate → loading message appears
- [ ] After generation, preview image shown
- [ ] **Before/After toggle**: switches between original and generated
- [ ] Click Apply → result loaded onto reference layer, modal closes
- [ ] Clicking backdrop closes modal without changes

---

## 13. Generate Human (txt2img)

- [ ] Click Generate Human button in header → modal opens
- [ ] **Model Type**: Any / Female / Male buttons toggle correctly (one active at a time)
- [ ] **Preset buttons**: clicking fills the prompt textarea with a preset
- [ ] **Advanced options** toggle reveals Steps and Guidance sliders
- [ ] Click Generate → loading spinner appears; generation takes 20–60 s
- [ ] Result shown in preview area
- [ ] Click Apply → result loaded as reference layer with white background; modal closes
- [ ] If no reference layer exists → canvas resized to fit the generated image
- [ ] Cancel closes without adding a layer

---

## 14. Profile Modal

- [ ] Click avatar chip in top bar → ProfileModal opens
- [ ] **Profile tab**: display name field shows current name
- [ ] Edit display name → Save → name updates in top bar immediately
- [ ] Click avatar circle → file picker → upload image → thumbnail preview updates
- [ ] Save with new avatar → avatar shown in header/home page
- [ ] **Password tab**: current/new/confirm password fields
- [ ] Wrong current password → "Current password is incorrect" error
- [ ] New passwords don't match → "Passwords do not match" error
- [ ] Successful password change → success message, fields cleared
- [ ] Clicking backdrop closes modal
- [ ] Toggle eye icons show/hide each password field

---

## 15. Dark Mode

- [ ] Dark mode toggle in header switches entire app theme
- [ ] All modals, panels, and canvas background adapt to dark theme
- [ ] Preference persists across page refresh (stored in localStorage)
- [ ] Login page Iridescence effect visible in both modes

---

## 16. Auto-Save

- [ ] Draw something → wait 3 s → browser console logs "Auto-saved"
- [ ] Resize canvas → wait 1.2 s → auto-save fires
- [ ] Navigate to Home (Back button) → project saved with latest thumbnail
- [ ] Re-open project → canvas restores to exact previous state (layers, sizes)
- [ ] Thumbnail on Home page updates to reflect latest canvas state

---

## 17. Extract Doodle (Photo → Doodle)

- [ ] Right-click reference layer → Convert to Doodle
- [ ] New drawing layer appears above reference layer with flat-colour version
- [ ] Doodle layer is immediately selected (active)
- [ ] Colours roughly match dominant hues of original photo
- [ ] Face, hair, arms, and legs are removed (clothing only)

---

## 18. Edge Cases & Error Handling

- [ ] Backend unreachable → Clothify/Generate shows error message (not blank UI)
- [ ] Upload a non-image file → gracefully ignored or error shown
- [ ] Undo with no history → button disabled, no crash
- [ ] Merge Down greyed out when only one drawing layer exists
- [ ] Rename project to an existing name → conflict error shown
- [ ] Creating two projects with same name → second gets 409 error toast
- [ ] Very large canvas (4K) → zoom-to-fit keeps it within viewport
- [ ] Rapidly switching tools while drawing → no crash or corrupted state
