# Manual Frontend Test Plan

This document outlines the manual verification steps for the Clothify React Frontend. Since automated frontend testing requires new dependencies, this checklist ensures UI stability without code modifications.

## 1. Initial Load & Layout
- [ ] **Open Application**: Navigate to `http://localhost:3000`.
- [ ] **Verify Title**: "Clothify" header is visible.
- [ ] **Verify Canvas**: The central drawing area matches the reference image (or default).
- [ ] **Verify Toolbar**: All tools (Brush, Eraser, Move) are visible on the left.
- [ ] **Verify Panels**: Layers panel is visible on the right.

## 2. Drawing Interaction
- [ ] **Brush Tool**: Select Brush, pick a color (e.g., Red), and draw on the canvas. Verify strokes appear.
- [ ] **Brush Size**: Change slider size. Verify stroke thickness changes.
- [ ] **Eraser Tool**: Select Eraser. Verify it removes drawn strokes.
- [ ] **Undo/Redo**: Draw -> Undo (Ctrl+Z) -> Redo (Ctrl+Shift+Z). Verify state restores.

## 3. Workflow #1: Pix2Pix Translation
- [ ] **Draw Doodle**: Draw a simple shape (e.g., a shirt outline).
- [ ] **Click "Translate"**: Press the magic wand button.
- [ ] **Check Output**: Verify the drawing is replaced/overlaid by a textured/translated version.
- [ ] **Check Console**: Ensure no network errors (200 OK from `/translate-doodle`).

## 4. Workflow #3: Inpainting (Full Enhancement)
- [ ] **Setup**: Ensure a reference image is loaded and a doodle is drawn.
- [ ] **Enter Prompt**: Type "denim texture" in the prompt box.
- [ ] **Set Strength**: Set slider to ~0.75.
- [ ] **Click "Translate"**:
    - Verify loading state (spinner/text).
    - Verify final image appears after ~5-10 seconds.
    - Verify the result looks blended (not just a rough cut-and-paste).

## 5. Pattern Maker
- [ ] **Open Modal**: Click "Pattern Maker" button.
- [ ] **Generate**: Enter prompt "floral", click Generate.
- [ ] **Verify Result**: 4 pattern options appear.
- [ ] **Select Pattern**: Click a pattern -> Verify it fills the doodle layer.

## 6. Moodboard
- [ ] **Open Modal**: Click "Moodboard" button.
- [ ] **Verify Logic**: Check that extracted colors match the dominant tones of the current image.

## 7. Layers Panel
- [ ] **Toggle Visibility**: Click eye icon on "Doodle" layer. Verify doodle disappears/reappears.
- [ ] **Opacity**: Drag opacity slider. Verify layer transparency changes.
