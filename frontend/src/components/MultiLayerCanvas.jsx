import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import './DrawingCanvas.css';

const MultiLayerCanvas = forwardRef(({
    layers,
    activeLayerId,
    brushSize,
    brushColor,
    activeTool,
    onLayerUpdate
}, ref) => {
    const containerRef = useRef(null);
    const wrapperRef = useRef(null);
    const canvasRefs = useRef({});
    const [isDrawing, setIsDrawing] = useState(false);
    const [canvasSize, setCanvasSize] = useState({ width: 1024, height: 1024 });
    const [viewScale, setViewScale] = useState(1); // View zoom level
    const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 }); // View pan offset
    const [cursorPos, setCursorPos] = useState({ x: -100, y: -100 }); // Cursor position for brush indicator

    // Transform state
    const [transformState, setTransformState] = useState(null); // { mode: 'move' | 'resize' | 'pan', ... }

    // Overlay canvas for shape/selection previews
    const overlayCanvasRef = useRef(null);
    // In-progress mouse operation: shape drag, selection drag, lasso draw
    const operationRef = useRef(null);
    // Committed selection: { type:'rect', x, y, w, h } | { type:'lasso', points:[] }
    const selectionRef = useRef(null);
    // Floating selection during transform (extract → drag → commit)
    const floatingSelRef = useRef(null);
    // Text tool input state — canvasFontSize is kept in sync with box height
    const [textInput, setTextInput] = useState({ visible: false, x: 0, y: 0, value: '', canvasX: 0, canvasY: 0, width: 200, height: 60, canvasFontSize: 24 });
    const textInputFieldRef = useRef(null);
    // Resize drag tracking for the text overlay box
    const textResizeRef = useRef({ active: false });
    // Whether a committed selection exists (shown as a persistent canvas badge)
    const [selectionActive, setSelectionActive] = useState(false);
    // Whether Space is held for temporary pan
    const spaceHeld = useRef(false);

    // Imperatively focus the text input after it mounts (autoFocus is unreliable inside mousedown handlers)
    useEffect(() => {
        if (textInput.visible && textInputFieldRef.current) {
            const id = setTimeout(() => textInputFieldRef.current?.focus(), 20);
            return () => clearTimeout(id);
        }
    }, [textInput.visible]);

    // Global mouse handlers for dragging the text-box resize handle
    useEffect(() => {
        const onMove = (e) => {
            const r = textResizeRef.current;
            if (!r.active) return;
            const newWidth  = Math.max(60, r.startWidth  + (e.clientX - r.startX));
            const newHeight = Math.max(24, r.startHeight + (e.clientY - r.startY));
            const newScreenFont  = Math.round(newHeight * 0.5);
            const newCanvasFont  = Math.max(6, Math.round(newScreenFont / (r.viewScale || 1) / (r.layerScale || 1)));
            setTextInput(prev => ({ ...prev, width: newWidth, height: newHeight, canvasFontSize: newCanvasFont }));
        };
        const onUp = () => {
            if (textResizeRef.current.active) {
                textResizeRef.current.active = false;
                // Return focus to textarea after a resize so the user can keep typing
                setTimeout(() => textInputFieldRef.current?.focus(), 0);
            }
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup',   onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup',   onUp);
        };
    }, []);

    // Initialize canvases for all layers
    useEffect(() => {
        layers.forEach(layer => {
            if (!canvasRefs.current[layer.id]) {
                canvasRefs.current[layer.id] = React.createRef();
            }
        });
    }, [layers]);

    // Handle wheel zoom
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleWheel = (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const delta = e.deltaY * -0.001;
                setViewScale(prev => Math.min(Math.max(0.1, prev + delta), 5));
            }
        };

        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => container.removeEventListener('wheel', handleWheel);
    }, []);

    // Escape = commit float at current position (keeps move+resize); or clear selection
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Space = temporary pan (skip when typing in a text field)
            if (e.key === ' ') {
                const tag = document.activeElement?.tagName;
                if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
                    e.preventDefault();
                    spaceHeld.current = true;
                }
            }
            if (e.key === 'Escape') {
                if (floatingSelRef.current) {
                    commitFloat();
                    setTransformState(null);
                } else {
                    selectionRef.current = null;
                    setSelectionActive(false);
                    operationRef.current = null;
                    const overlay = overlayCanvasRef.current;
                    if (overlay) overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
                }
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectionRef.current && activeLayerId) {
                const canvasEl = canvasRefs.current[activeLayerId]?.current;
                if (!canvasEl) return;
                const sel = selectionRef.current;
                const ctx = canvasEl.getContext('2d');
                ctx.save();
                ctx.globalCompositeOperation = 'destination-out';
                if (sel.type === 'rect') {
                    ctx.fillRect(sel.x, sel.y, sel.w, sel.h);
                } else if (sel.type === 'lasso' && sel.points.length > 2) {
                    ctx.beginPath();
                    ctx.moveTo(sel.points[0].x, sel.points[0].y);
                    for (let i = 1; i < sel.points.length; i++) ctx.lineTo(sel.points[i].x, sel.points[i].y);
                    ctx.closePath();
                    ctx.fill();
                }
                ctx.restore();
                updateLayerThumbnail(activeLayerId);
            }
        };
        const handleKeyUp = (e) => {
            if (e.key === ' ') {
                spaceHeld.current = false;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup',   handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup',   handleKeyUp);
        };
    }, [activeLayerId]);

    // Clear overlay + selection atomics on tool/layer switch
    useEffect(() => {
        operationRef.current = null;
        if (activeTool === 'select' || activeTool === 'lasso') {
            selectionRef.current = null;
            setSelectionActive(false);
        }
    }, [activeTool, activeLayerId]);

    // Unified overlay: always redraws the correct overlay content when anything relevant changes.
    useEffect(() => {
        const overlay = overlayCanvasRef.current;
        if (!overlay) return;

        // Float manages its own overlay — re-render it and bail out BEFORE clearing.
        // Clearing first would wipe float pixels that were drawn imperatively during drag.
        if (floatingSelRef.current) {
            renderFloatOnOverlay();
            return;
        }

        const ctx = overlay.getContext('2d');
        ctx.clearRect(0, 0, overlay.width, overlay.height);

        if (activeTool === 'transform' && activeLayerId) {
            if (selectionRef.current) {
                // Selection active: marching ants + corner handles so user can drag to float+resize
                drawSelectionWithHandles(selectionRef.current);
            } else {
                // No selection: whole-layer bounding box + handles
                const activeLayer = layers.find(l => l.id === activeLayerId);
                if (activeLayer) drawTransformHandlesOnOverlay(ctx, activeLayer);
            }
        } else if (activeTool !== 'select' && activeTool !== 'lasso' && selectionRef.current) {
            drawSelectionOnOverlay(selectionRef.current);
        }
    }, [activeTool, activeLayerId, layers, canvasSize, transformState]);

    // Draw layer content when layer data changes — never draws handles here so the canvas
    // pixels are always clean (handles live on the overlay canvas instead).
    useEffect(() => {
        layers.forEach(layer => {
            const canvasRef = canvasRefs.current[layer.id];
            if (canvasRef && canvasRef.current && layer.canvasData) {
                const ctx = canvasRef.current.getContext('2d');
                const img = new Image();
                img.onload = () => {
                    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.drawImage(img, 0, 0);
                };
                img.src = layer.canvasData;
            }
        });
    }, [layers, canvasSize]);

    // Draw transform handles on the OVERLAY canvas in wrapper-space coordinates.
    // bounds are in layer-local pixels; convert using the layer's CSS transform.
    const drawTransformHandlesOnOverlay = (ctx, layer) => {
        const bounds = layer.bounds || { x: 0, y: 0, width: canvasSize.width, height: canvasSize.height };
        const t = layer.transform || { x: 0, y: 0, scale: 1 };

        // Convert layer-local bounds → wrapper (overlay) coordinate space
        const x = t.x + bounds.x * t.scale;
        const y = t.y + bounds.y * t.scale;
        const w = bounds.width * t.scale;
        const h = bounds.height * t.scale;
        const handleSize = 10;

        ctx.save();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#8b5cf6';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, w, h);

        ctx.fillStyle = 'white';
        const corners = [
            { x: x,     y: y     },
            { x: x + w, y: y     },
            { x: x + w, y: y + h },
            { x: x,     y: y + h },
        ];
        corners.forEach(c => {
            ctx.fillRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
            ctx.strokeRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
        });
        ctx.restore();
    };

    const getMousePos = (e) => {
        if (!wrapperRef.current) return { x: 0, y: 0 };

        const rect = wrapperRef.current.getBoundingClientRect();
        let clientX, clientY;

        if (e.type.startsWith('touch')) {
            const touch = e.touches[0] || e.changedTouches[0];
            clientX = touch.clientX;
            clientY = touch.clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        // Adjust for view scale
        return {
            x: (clientX - rect.left) / viewScale,
            y: (clientY - rect.top) / viewScale
        };
    };

    const handleMouseMove = (e) => {
        // Update cursor position for brush indicator
        let clientX, clientY;
        if (e.type.startsWith('touch')) {
            const touch = e.touches[0] || e.changedTouches[0];
            clientX = touch.clientX;
            clientY = touch.clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        // Get relative to container for the cursor overlay
        if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            setCursorPos({
                x: clientX - rect.left,
                y: clientY - rect.top
            });
        }

        draw(e);
    };

    const getDistance = (p1, p2) => {
        return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    };

    const getContentBounds = (canvas) => {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        let minX = width, minY = height, maxX = 0, maxY = 0;
        let found = false;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const alpha = data[(y * width + x) * 4 + 3];
                if (alpha > 0) {
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                    found = true;
                }
            }
        }

        if (!found) return null;

        return {
            x: minX,
            y: minY,
            width: maxX - minX + 1,
            height: maxY - minY + 1
        };
    };

    // ── Overlay helpers ──────────────────────────────────────────────────────

    const clearOverlay = () => {
        const overlay = overlayCanvasRef.current;
        if (!overlay) return;
        overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
    };

    const drawOverlayPreview = () => {
        const overlay = overlayCanvasRef.current;
        if (!overlay || !operationRef.current) return;
        const ctx = overlay.getContext('2d');
        const op = operationRef.current;
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        ctx.save();
        if (op.tool === 'select') {
            const x = Math.min(op.startX, op.endX);
            const y = Math.min(op.startY, op.endY);
            const w = Math.abs(op.endX - op.startX);
            const h = Math.abs(op.endY - op.startY);
            ctx.setLineDash([6, 3]);
            ctx.strokeStyle = '#8b5cf6';
            ctx.lineWidth = 1.5;
            ctx.fillStyle = 'rgba(139, 92, 246, 0.06)';
            ctx.fillRect(x, y, w, h);
            ctx.strokeRect(x, y, w, h);
        } else if (op.tool === 'lasso') {
            if (op.points.length < 2) { ctx.restore(); return; }
            ctx.setLineDash([6, 3]);
            ctx.strokeStyle = '#8b5cf6';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(op.points[0].x, op.points[0].y);
            for (let i = 1; i < op.points.length; i++) ctx.lineTo(op.points[i].x, op.points[i].y);
            ctx.stroke();
        } else if (op.tool === 'shape-rect') {
            const x = Math.min(op.startX, op.endX);
            const y = Math.min(op.startY, op.endY);
            const w = Math.abs(op.endX - op.startX);
            const h = Math.abs(op.endY - op.startY);
            ctx.setLineDash([]);
            ctx.strokeStyle = brushColor;
            ctx.lineWidth = brushSize;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeRect(x, y, w, h);
        } else if (op.tool === 'shape-circle') {
            const cx = (op.startX + op.endX) / 2;
            const cy = (op.startY + op.endY) / 2;
            const rx = Math.abs(op.endX - op.startX) / 2;
            const ry = Math.abs(op.endY - op.startY) / 2;
            if (rx > 0 && ry > 0) {
                ctx.setLineDash([]);
                ctx.strokeStyle = brushColor;
                ctx.lineWidth = brushSize;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
        ctx.restore();
    };

    const drawSelectionOnOverlay = (sel) => {
        const overlay = overlayCanvasRef.current;
        if (!overlay) return;
        const ctx = overlay.getContext('2d');
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        if (!sel) return;
        ctx.save();
        ctx.setLineDash([6, 3]);
        ctx.strokeStyle = '#8b5cf6';
        ctx.lineWidth = 1.5;
        ctx.fillStyle = 'rgba(139, 92, 246, 0.06)';
        if (sel.type === 'rect') {
            ctx.fillRect(sel.x, sel.y, sel.w, sel.h);
            ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
        } else if (sel.type === 'lasso' && sel.points.length > 2) {
            ctx.beginPath();
            ctx.moveTo(sel.points[0].x, sel.points[0].y);
            for (let i = 1; i < sel.points.length; i++) ctx.lineTo(sel.points[i].x, sel.points[i].y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
        ctx.restore();
    };

    // Marching ants + corner handles for a selection (transform tool, before floating)
    const drawSelectionWithHandles = (sel) => {
        const overlay = overlayCanvasRef.current;
        if (!overlay || !sel) return;
        const ctx = overlay.getContext('2d');
        ctx.save();
        ctx.setLineDash([6, 3]);
        ctx.strokeStyle = '#8b5cf6';
        ctx.lineWidth = 1.5;
        ctx.fillStyle = 'rgba(139, 92, 246, 0.06)';
        if (sel.type === 'rect') {
            ctx.fillRect(sel.x, sel.y, sel.w, sel.h);
            ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
        } else if (sel.type === 'lasso' && sel.points.length > 2) {
            ctx.beginPath();
            ctx.moveTo(sel.points[0].x, sel.points[0].y);
            for (let i = 1; i < sel.points.length; i++) ctx.lineTo(sel.points[i].x, sel.points[i].y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
        ctx.restore();
        const bounds = getSelBounds(sel);
        if (!bounds) return;
        const handleSize = 9;
        const corners = [
            { x: bounds.x,           y: bounds.y           },
            { x: bounds.x + bounds.w, y: bounds.y           },
            { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
            { x: bounds.x,           y: bounds.y + bounds.h },
        ];
        ctx.save();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#8b5cf6';
        ctx.fillStyle = 'white';
        ctx.lineWidth = 1.5;
        corners.forEach(c => {
            ctx.fillRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
            ctx.strokeRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
        });
        ctx.restore();
    };

    // Returns the axis-aligned bounding box of any selection shape (canvas pixel coords)
    const getSelBounds = (sel) => {
        if (!sel) return null;
        if (sel.type === 'rect') return { x: sel.x, y: sel.y, w: sel.w, h: sel.h };
        if (sel.type === 'lasso' && sel.points.length > 1) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const p of sel.points) {
                if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
            }
            return { x: Math.floor(minX), y: Math.floor(minY), w: Math.ceil(maxX - minX), h: Math.ceil(maxY - minY) };
        }
        return null;
    };

    // Render the in-flight floating selection on the overlay canvas (with scale + corner handles)
    const renderFloatOnOverlay = () => {
        const float = floatingSelRef.current;
        const overlay = overlayCanvasRef.current;
        if (!float || !overlay) return;
        const ctx = overlay.getContext('2d');
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        const bounds = getSelBounds(float.sel);
        const sx = float.sx ?? 1;
        const sy = float.sy ?? 1;
        // Draw float pixels scaled from the selection's top-left origin
        ctx.save();
        if (bounds) {
            ctx.translate(float.tx + bounds.x, float.ty + bounds.y);
            ctx.scale(sx, sy);
            ctx.translate(-bounds.x, -bounds.y);
        } else {
            ctx.translate(float.tx, float.ty);
        }
        ctx.drawImage(float.canvas, 0, 0);
        ctx.restore();
        // Draw marching-ants border + corner resize handles
        if (bounds) {
            const bx = float.tx + bounds.x;
            const by = float.ty + bounds.y;
            const bw = bounds.w * sx;
            const bh = bounds.h * sy;
            ctx.save();
            ctx.setLineDash([6, 3]);
            ctx.strokeStyle = '#8b5cf6';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh);
            ctx.restore();
            const handleSize = 8;
            const corners = [
                { x: bx,      y: by      },
                { x: bx + bw, y: by      },
                { x: bx + bw, y: by + bh },
                { x: bx,      y: by + bh },
            ];
            ctx.save();
            ctx.setLineDash([]);
            ctx.strokeStyle = '#8b5cf6';
            ctx.fillStyle = 'white';
            ctx.lineWidth = 1.5;
            corners.forEach(c => {
                ctx.fillRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
                ctx.strokeRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
            });
            ctx.restore();
        } else {
            const sel = float.sel;
            ctx.save();
            ctx.translate(float.tx, float.ty);
            ctx.setLineDash([6, 3]);
            ctx.strokeStyle = '#8b5cf6';
            ctx.lineWidth = 1.5;
            if (sel.type === 'rect') {
                ctx.strokeRect(sel.x + 0.5, sel.y + 0.5, sel.w, sel.h);
            } else if (sel.type === 'lasso' && sel.points.length > 2) {
                ctx.beginPath();
                ctx.moveTo(sel.points[0].x, sel.points[0].y);
                for (let i = 1; i < sel.points.length; i++) ctx.lineTo(sel.points[i].x, sel.points[i].y);
                ctx.closePath();
                ctx.stroke();
            }
            ctx.restore();
        }
    };

    // Paste the floating selection onto the active layer at its final position+scale, then clear the float
    const commitFloat = () => {
        const float = floatingSelRef.current;
        if (!float || !activeLayerId) return;
        const canvasEl = canvasRefs.current[activeLayerId]?.current;
        if (!canvasEl) return;
        const ctx = canvasEl.getContext('2d');
        const bounds = getSelBounds(float.sel);
        const sx = float.sx ?? 1;
        const sy = float.sy ?? 1;
        ctx.save();
        if (bounds) {
            ctx.translate(float.tx + bounds.x, float.ty + bounds.y);
            ctx.scale(sx, sy);
            ctx.translate(-bounds.x, -bounds.y);
        } else {
            ctx.translate(float.tx, float.ty);
        }
        ctx.drawImage(float.canvas, 0, 0);
        ctx.restore();
        floatingSelRef.current = null;
        selectionRef.current = null;
        setSelectionActive(false);
        clearOverlay();
        updateLayerThumbnail(activeLayerId);
    };

    // Cancel float: restore pixels at their original position
    const cancelFloat = () => {
        const float = floatingSelRef.current;
        if (!float || !activeLayerId) return;
        const canvasEl = canvasRefs.current[activeLayerId]?.current;
        if (!canvasEl) return;
        canvasEl.getContext('2d').drawImage(float.canvas, 0, 0);
        floatingSelRef.current = null;
        if (selectionRef.current) drawSelectionOnOverlay(selectionRef.current);
        else clearOverlay();
        updateLayerThumbnail(activeLayerId);
    };

    // Returns a Path2D clipping region in layer-local coordinate space.
    // sel coords are in canvas space; we convert using the layer transform t.
    const applySelectionClipPath = (sel, t) => {
        const path = new Path2D();
        if (sel.type === 'rect') {
            path.rect(
                (sel.x - t.x) / t.scale,
                (sel.y - t.y) / t.scale,
                sel.w / t.scale,
                sel.h / t.scale,
            );
        } else if (sel.type === 'lasso' && sel.points.length > 2) {
            const p0 = sel.points[0];
            path.moveTo((p0.x - t.x) / t.scale, (p0.y - t.y) / t.scale);
            for (let i = 1; i < sel.points.length; i++) {
                const p = sel.points[i];
                path.lineTo((p.x - t.x) / t.scale, (p.y - t.y) / t.scale);
            }
            path.closePath();
        }
        return path;
    };

    // Commits a completed shape drag to the active layer canvas
    const commitShape = (op) => {
        if (!activeLayerId) return;
        const canvasEl = canvasRefs.current[activeLayerId]?.current;
        if (!canvasEl) return;
        const activeLayerForShape = layers.find(l => l.id === activeLayerId);
        const t = activeLayerForShape?.transform || { x: 0, y: 0, scale: 1 };
        // Convert from wrapper-space to layer canvas-space
        const toLocal = (gx, gy) => ({ x: (gx - t.x) / t.scale, y: (gy - t.y) / t.scale });
        const ctx = canvasEl.getContext('2d');
        ctx.save();
        // Clip shape to an active selection if present
        if (selectionRef.current) {
            ctx.clip(applySelectionClipPath(selectionRef.current, t));
        }
        ctx.strokeStyle = brushColor;
        ctx.lineWidth = brushSize / t.scale;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalCompositeOperation = 'source-over';
        if (op.tool === 'shape-rect') {
            const p1 = toLocal(Math.min(op.startX, op.endX), Math.min(op.startY, op.endY));
            const p2 = toLocal(Math.max(op.startX, op.endX), Math.max(op.startY, op.endY));
            ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
        } else if (op.tool === 'shape-circle') {
            const p1 = toLocal(op.startX, op.startY);
            const p2 = toLocal(op.endX, op.endY);
            const cx = (p1.x + p2.x) / 2;
            const cy = (p1.y + p2.y) / 2;
            const rx = Math.abs(p2.x - p1.x) / 2;
            const ry = Math.abs(p2.y - p1.y) / 2;
            if (rx > 0 && ry > 0) {
                ctx.beginPath();
                ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
        ctx.restore();
        updateLayerThumbnail(activeLayerId);
    };

    // Commits typed text to the active layer canvas
    const commitTextToLayer = (text, canvasX, canvasY, fontSize) => {
        if (!activeLayerId || !text.trim()) return;
        const canvasEl = canvasRefs.current[activeLayerId]?.current;
        if (!canvasEl) return;
        const layerForText = layers.find(l => l.id === activeLayerId);
        const t = layerForText?.transform || { x: 0, y: 0, scale: 1 };
        const ctx = canvasEl.getContext('2d');
        ctx.save();
        if (selectionRef.current) {
            ctx.clip(applySelectionClipPath(selectionRef.current, t));
        }
        ctx.fillStyle = brushColor;
        const resolvedFontSize = fontSize ?? Math.max(12, brushSize * 6);
        ctx.font = `${resolvedFontSize}px sans-serif`;
        ctx.globalCompositeOperation = 'source-over';
        // Support multiline: split on newlines, use lineHeight spacing
        const lines = text.split('\n');
        const lineHeight = resolvedFontSize * 1.2;
        lines.forEach((line, i) => {
            ctx.fillText(line, canvasX, canvasY + resolvedFontSize * 0.85 + lineHeight * i);
        });
        ctx.restore();
        updateLayerThumbnail(activeLayerId);
    };

    // ─────────────────────────────────────────────────────────────────────────

    const startDrawing = (e) => {
        // If text input is open and user clicks outside it, commit the text and eat the click
        if (textInput.visible) {
            if (textInput.value.trim()) {
                commitTextToLayer(textInput.value, textInput.canvasX, textInput.canvasY, textInput.canvasFontSize);
            }
            setTextInput({ visible: false, x: 0, y: 0, value: '', canvasX: 0, canvasY: 0, width: 200, height: 60, canvasFontSize: 24 });
            return;
        }

        // Space held = temporary pan regardless of active tool
        if (spaceHeld.current) {
            setTransformState({
                mode: 'pan',
                startX: e.clientX,
                startY: e.clientY,
                initialOffset: { ...viewOffset }
            });
            return;
        }

        // Handle Pan Tool (View Panning)
        if (activeTool === 'pan') {
            let clientX, clientY;
            if (e.type.startsWith('touch')) {
                const touch = e.touches[0] || e.changedTouches[0];
                clientX = touch.clientX;
                clientY = touch.clientY;
            } else {
                clientX = e.clientX;
                clientY = e.clientY;
            }

            setTransformState({
                mode: 'pan',
                startX: clientX,
                startY: clientY,
                initialOffset: { ...viewOffset }
            });
            return;
        }

        // Zoom is a view operation — no active layer needed
        if (activeTool === 'zoom') {
            const factor = e.shiftKey ? 1 / 1.25 : 1.25;
            const containerRect = containerRef.current?.getBoundingClientRect();
            if (containerRect) {
                const clickX = e.clientX - containerRect.left - containerRect.width / 2;
                const clickY = e.clientY - containerRect.top - containerRect.height / 2;
                setViewOffset(prev => ({
                    x: clickX - (clickX - prev.x) * factor,
                    y: clickY - (clickY - prev.y) * factor,
                }));
                setViewScale(prev => Math.min(Math.max(0.1, prev * factor), 10));
            }
            return;
        }

        if (!activeLayerId) return;
        const activeLayer = layers.find(l => l.id === activeLayerId);
        if (!activeLayer) return;
        if (activeLayer.locked && activeTool !== 'transform') return;
        if (activeLayer.locked) return;

        const pos = getMousePos(e);

        if (activeTool === 'transform') {
            // If a float is already active, interact with it before creating a new one
            if (floatingSelRef.current) {
                const float = floatingSelRef.current;
                const bounds = getSelBounds(float.sel);
                if (bounds) {
                    const sx = float.sx ?? 1;
                    const sy = float.sy ?? 1;
                    const bx = float.tx + bounds.x;
                    const by = float.ty + bounds.y;
                    const bw = bounds.w * sx;
                    const bh = bounds.h * sy;
                    const handleHalf = 8;
                    const corners = [
                        { x: bx,      y: by      }, // TL
                        { x: bx + bw, y: by      }, // TR
                        { x: bx + bw, y: by + bh }, // BR
                        { x: bx,      y: by + bh }, // BL
                    ];
                    let hitFloatHandle = null;
                    for (let i = 0; i < corners.length; i++) {
                        if (Math.abs(pos.x - corners[i].x) < handleHalf && Math.abs(pos.y - corners[i].y) < handleHalf) {
                            hitFloatHandle = i;
                            break;
                        }
                    }
                    if (hitFloatHandle !== null) {
                        const anchorIdx = (hitFloatHandle + 2) % 4;
                        setTransformState({
                            mode: 'float-resize', handle: hitFloatHandle,
                            startX: pos.x, startY: pos.y,
                            startSx: sx, startSy: sy,
                            initialTx: float.tx, initialTy: float.ty,
                            anchorX: corners[anchorIdx].x, anchorY: corners[anchorIdx].y,
                        });
                        return;
                    }
                    if (pos.x >= bx && pos.x <= bx + bw && pos.y >= by && pos.y <= by + bh) {
                        // Move the already-floating selection; capture current tx/ty so re-moves accumulate
                        setTransformState({ mode: 'float-move', startX: pos.x, startY: pos.y, initialTx: float.tx, initialTy: float.ty });
                        return;
                    }
                    // Click outside float bounds — commit it
                    commitFloat();
                    return;
                }
            }

            const sel = selectionRef.current;

            // If a selection is active: check corner handles OR inside region to create a float
            if (sel) {
                const bounds = getSelBounds(sel);
                if (bounds) {
                    const handleHalf = 9;
                    const selCorners = [
                        { x: bounds.x,           y: bounds.y           }, // 0: TL
                        { x: bounds.x + bounds.w, y: bounds.y           }, // 1: TR
                        { x: bounds.x + bounds.w, y: bounds.y + bounds.h }, // 2: BR
                        { x: bounds.x,           y: bounds.y + bounds.h }, // 3: BL
                    ];
                    let hitSelHandle = null;
                    for (let i = 0; i < selCorners.length; i++) {
                        if (Math.abs(pos.x - selCorners[i].x) < handleHalf && Math.abs(pos.y - selCorners[i].y) < handleHalf) {
                            hitSelHandle = i;
                            break;
                        }
                    }
                    const insideSel = pos.x >= bounds.x && pos.x <= bounds.x + bounds.w &&
                                      pos.y >= bounds.y && pos.y <= bounds.y + bounds.h;

                    if (hitSelHandle !== null || insideSel) {
                        const canvasEl = canvasRefs.current[activeLayerId]?.current;
                        if (canvasEl) {
                            // Extract selected pixels into an offscreen canvas
                            const floatCanvas = document.createElement('canvas');
                            floatCanvas.width = canvasSize.width;
                            floatCanvas.height = canvasSize.height;
                            const floatCtx = floatCanvas.getContext('2d');
                            floatCtx.save();
                            floatCtx.clip(applySelectionClipPath(sel, activeLayer.transform || { x: 0, y: 0, scale: 1 }));
                            floatCtx.drawImage(canvasEl, 0, 0);
                            floatCtx.restore();

                            // Erase those pixels from the layer canvas
                            const layerCtx = canvasEl.getContext('2d');
                            layerCtx.save();
                            layerCtx.globalCompositeOperation = 'destination-out';
                            layerCtx.clip(applySelectionClipPath(sel, activeLayer.transform || { x: 0, y: 0, scale: 1 }));
                            layerCtx.fillRect(0, 0, canvasSize.width, canvasSize.height);
                            layerCtx.restore();

                            floatingSelRef.current = { canvas: floatCanvas, sel, tx: 0, ty: 0, sx: 1, sy: 1 };
                            renderFloatOnOverlay();
                            if (hitSelHandle !== null) {
                                const anchorIdx = (hitSelHandle + 2) % 4;
                                setTransformState({
                                    mode: 'float-resize', handle: hitSelHandle,
                                    startX: pos.x, startY: pos.y,
                                    startSx: 1, startSy: 1,
                                    initialTx: 0, initialTy: 0,
                                    anchorX: selCorners[anchorIdx].x, anchorY: selCorners[anchorIdx].y,
                                });
                            } else {
                                setTransformState({ mode: 'float-move', startX: pos.x, startY: pos.y, initialTx: 0, initialTy: 0 });
                            }
                        }
                        return;
                    }
                }
            }

            const transform = activeLayer.transform || { x: 0, y: 0, scale: 1 };
            const bounds = activeLayer.bounds || { x: 0, y: 0, width: canvasSize.width, height: canvasSize.height };

            // Check for handle hits
            const localX = (pos.x - transform.x) / transform.scale;
            const localY = (pos.y - transform.y) / transform.scale;

            const hitThreshold = 15 / transform.scale;

            const corners = [
                { x: bounds.x, y: bounds.y, anchor: 2 }, // TL -> Anchor BR
                { x: bounds.x + bounds.width, y: bounds.y, anchor: 3 }, // TR -> Anchor BL
                { x: bounds.x + bounds.width, y: bounds.y + bounds.height, anchor: 0 }, // BR -> Anchor TL
                { x: bounds.x, y: bounds.y + bounds.height, anchor: 1 } // BL -> Anchor TR
            ];

            let hitHandle = null;

            for (let i = 0; i < corners.length; i++) {
                const c = corners[i];
                if (Math.abs(localX - c.x) < hitThreshold && Math.abs(localY - c.y) < hitThreshold) {
                    hitHandle = i;
                    break;
                }
            }

            if (hitHandle !== null) {
                const anchorIndex = corners[hitHandle].anchor;
                const anchorLocal = corners[anchorIndex];

                // Calculate Global Anchor Position
                const anchorGlobalX = transform.x + anchorLocal.x * transform.scale;
                const anchorGlobalY = transform.y + anchorLocal.y * transform.scale;

                setTransformState({
                    mode: 'resize',
                    handle: hitHandle,
                    startX: pos.x,
                    startY: pos.y,
                    initialScale: transform.scale,
                    initialTransform: { ...transform },
                    anchor: { x: anchorGlobalX, y: anchorGlobalY },
                    anchorLocal: { x: anchorLocal.x, y: anchorLocal.y },
                    startDist: getDistance(pos, { x: anchorGlobalX, y: anchorGlobalY })
                });
            } else {
                setTransformState({
                    mode: 'move',
                    startX: pos.x,
                    startY: pos.y,
                    initialTransform: { ...transform }
                });
            }
            return;
        }

        if (activeTool === 'brush' || activeTool === 'eraser') {
            setIsDrawing(true);
            draw(e);
            return;
        }

        // Select: rectangular marquee
        if (activeTool === 'select') {
            selectionRef.current = null;
            setSelectionActive(false);
            clearOverlay();
            operationRef.current = { tool: 'select', startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y };
            return;
        }

        // Lasso: freehand marquee
        if (activeTool === 'lasso') {
            selectionRef.current = null;
            setSelectionActive(false);
            clearOverlay();
            operationRef.current = { tool: 'lasso', points: [{ x: pos.x, y: pos.y }] };
            return;
        }

        // Shape tools: drag to draw rectangle or ellipse
        if (activeTool === 'shape-rect' || activeTool === 'shape-circle') {
            operationRef.current = { tool: activeTool, startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y };
            return;
        }

        // Text tool: show inline resizable input at the exact screen position of the click
        if (activeTool === 'text' && containerRef.current) {
            const activeLayerForText = layers.find(l => l.id === activeLayerId);
            const t = activeLayerForText?.transform || { x: 0, y: 0, scale: 1 };
            const containerRect = containerRef.current.getBoundingClientRect();
            const initialHeight = 60;
            const screenFont = Math.round(initialHeight * 0.5);
            const canvasFont = Math.max(6, Math.round(screenFont / viewScale / t.scale));
            setTextInput({
                visible: true,
                x: e.clientX - containerRect.left,
                y: e.clientY - containerRect.top,
                value: '',
                canvasX: (pos.x - t.x) / t.scale,
                canvasY: (pos.y - t.y) / t.scale,
                width: 200,
                height: initialHeight,
                canvasFontSize: canvasFont,
            });
        }
    };

    const stopDrawing = () => {
        // End floating selection drag/resize without committing — float stays active for further adjustments
        if (transformState?.mode === 'float-move' || transformState?.mode === 'float-resize') {
            setTransformState(null);
            return;
        }

        if (transformState) {
            setTransformState(null);
            return;
        }

        // Commit in-progress shape/selection operations
        if (operationRef.current) {
            const op = operationRef.current;
            operationRef.current = null;
            if (op.tool === 'shape-rect' || op.tool === 'shape-circle') {
                commitShape(op);
                clearOverlay();
            } else if (op.tool === 'select') {
                const x = Math.min(op.startX, op.endX);
                const y = Math.min(op.startY, op.endY);
                const w = Math.abs(op.endX - op.startX);
                const h = Math.abs(op.endY - op.startY);
                if (w > 2 && h > 2) {
                    selectionRef.current = { type: 'rect', x, y, w, h };
                    setSelectionActive(true);
                    drawSelectionOnOverlay(selectionRef.current);
                } else {
                    selectionRef.current = null;
                    setSelectionActive(false);
                    clearOverlay();
                }
            } else if (op.tool === 'lasso') {
                if (op.points.length > 2) {
                    selectionRef.current = { type: 'lasso', points: op.points };
                    setSelectionActive(true);
                    drawSelectionOnOverlay(selectionRef.current);
                } else {
                    selectionRef.current = null;
                    setSelectionActive(false);
                    clearOverlay();
                }
            }
            return;
        }

        if (isDrawing && activeLayerId) {
            setIsDrawing(false);
            const canvasRef = canvasRefs.current[activeLayerId];
            if (canvasRef && canvasRef.current) {
                const ctx = canvasRef.current.getContext('2d');
                ctx.beginPath();

                const canvas = canvasRef.current;
                const newCanvasData = canvas.toDataURL('image/png');

                // Calculate content bounds
                const bounds = getContentBounds(canvas);

                updateLayerThumbnail(activeLayerId, newCanvasData);
                if (bounds) {
                    onLayerUpdate(activeLayerId, { bounds });
                }
            }
        }
    };

    const draw = (e) => {
        // Handle View Panning
        if (transformState?.mode === 'pan') {
            e.preventDefault();
            let clientX, clientY;
            if (e.type.startsWith('touch')) {
                const touch = e.touches[0] || e.changedTouches[0];
                clientX = touch.clientX;
                clientY = touch.clientY;
            } else {
                clientX = e.clientX;
                clientY = e.clientY;
            }

            const dx = clientX - transformState.startX;
            const dy = clientY - transformState.startY;

            setViewOffset({
                x: transformState.initialOffset.x + dx,
                y: transformState.initialOffset.y + dy
            });
            return;
        }

        const pos = getMousePos(e);

        // Handle floating selection drag
        if (transformState?.mode === 'float-move') {
            const float = floatingSelRef.current;
            if (float) {
                // Use initialTx/Ty so re-moves accumulate correctly
                float.tx = (transformState.initialTx ?? 0) + (pos.x - transformState.startX);
                float.ty = (transformState.initialTy ?? 0) + (pos.y - transformState.startY);
                renderFloatOnOverlay();
            }
            return;
        }

        // Handle floating selection resize (anchor-aware — opposite corner stays fixed)
        if (transformState?.mode === 'float-resize') {
            const float = floatingSelRef.current;
            if (float) {
                const bounds = getSelBounds(float.sel);
                if (bounds) {
                    const ts = transformState;
                    const dx = pos.x - ts.startX;
                    const dy = pos.y - ts.startY;
                    const startW = bounds.w * ts.startSx;
                    const startH = bounds.h * ts.startSy;
                    let new_sx, new_sy, new_tx, new_ty;
                    switch (ts.handle) {
                        case 2: // BR — anchor TL, grow right+down
                            new_sx = Math.max(0.1, (startW + dx) / bounds.w);
                            new_sy = Math.max(0.1, (startH + dy) / bounds.h);
                            new_tx = ts.initialTx; new_ty = ts.initialTy;
                            break;
                        case 0: // TL — anchor BR, grow left+up
                            new_sx = Math.max(0.1, (startW - dx) / bounds.w);
                            new_sy = Math.max(0.1, (startH - dy) / bounds.h);
                            new_tx = ts.anchorX - bounds.x - bounds.w * new_sx;
                            new_ty = ts.anchorY - bounds.y - bounds.h * new_sy;
                            break;
                        case 1: // TR — anchor BL, grow right+up
                            new_sx = Math.max(0.1, (startW + dx) / bounds.w);
                            new_sy = Math.max(0.1, (startH - dy) / bounds.h);
                            new_tx = ts.anchorX - bounds.x;
                            new_ty = ts.anchorY - bounds.y - bounds.h * new_sy;
                            break;
                        case 3: // BL — anchor TR, grow left+down
                            new_sx = Math.max(0.1, (startW - dx) / bounds.w);
                            new_sy = Math.max(0.1, (startH + dy) / bounds.h);
                            new_tx = ts.anchorX - bounds.x - bounds.w * new_sx;
                            new_ty = ts.anchorY - bounds.y;
                            break;
                        default:
                            new_sx = ts.startSx; new_sy = ts.startSy;
                            new_tx = ts.initialTx; new_ty = ts.initialTy;
                    }
                    float.sx = new_sx; float.sy = new_sy;
                    float.tx = new_tx; float.ty = new_ty;
                    renderFloatOnOverlay();
                }
            }
            return;
        }

        if (transformState && activeLayerId) {
            e.preventDefault();

            if (transformState.mode === 'move') {
                const dx = pos.x - transformState.startX;
                const dy = pos.y - transformState.startY;

                const newTransform = {
                    ...transformState.initialTransform,
                    x: transformState.initialTransform.x + dx,
                    y: transformState.initialTransform.y + dy
                };
                onLayerUpdate(activeLayerId, { transform: newTransform });
            } else if (transformState.mode === 'resize') {
                const currentDist = getDistance(pos, transformState.anchor);

                if (transformState.startDist > 0) {
                    const scaleRatio = currentDist / transformState.startDist;
                    const newScale = Math.max(0.1, transformState.initialScale * scaleRatio);

                    // Calculate new position to keep anchor fixed
                    const newX = transformState.anchor.x - transformState.anchorLocal.x * newScale;
                    const newY = transformState.anchor.y - transformState.anchorLocal.y * newScale;

                    onLayerUpdate(activeLayerId, {
                        transform: {
                            x: newX,
                            y: newY,
                            scale: newScale
                        }
                    });
                }
            }
            return;
        }

        // Handle in-progress shape/selection/lasso operations
        if (operationRef.current) {
            const op = operationRef.current;
            if (op.tool === 'select' || op.tool === 'shape-rect' || op.tool === 'shape-circle') {
                op.endX = pos.x;
                op.endY = pos.y;
                drawOverlayPreview();
            } else if (op.tool === 'lasso') {
                const last = op.points[op.points.length - 1];
                const dx = pos.x - last.x;
                const dy = pos.y - last.y;
                // Throttle: only record a point every ≥4px to keep array lean
                if (dx * dx + dy * dy >= 16) {
                    op.points.push({ x: pos.x, y: pos.y });
                    drawOverlayPreview();
                }
            }
            return;
        }

        if (!isDrawing) return;
        if (!activeLayerId || (activeTool !== 'brush' && activeTool !== 'eraser')) return;

        const canvasRef = canvasRefs.current[activeLayerId];
        if (!canvasRef || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');

        const activeLayer = layers.find(l => l.id === activeLayerId);
        const transform = activeLayer?.transform || { x: 0, y: 0, scale: 1 };

        const localX = (pos.x - transform.x) / transform.scale;
        const localY = (pos.y - transform.y) / transform.scale;

        ctx.lineWidth = brushSize / transform.scale;
        ctx.lineCap = 'round';
        ctx.strokeStyle = activeTool === 'eraser' ? 'rgba(0,0,0,1)' : brushColor; // Eraser needs color but opacity matters
        ctx.globalCompositeOperation = activeTool === 'eraser' ? 'destination-out' : 'source-over';

        if (e.type === 'mousedown' || e.type === 'touchstart') {
            ctx.beginPath();
            ctx.moveTo(localX, localY);
        } else {
            // Clip to an active selection so drawing is confined to it
            const sel = selectionRef.current;
            if (sel) ctx.save();
            if (sel) ctx.clip(applySelectionClipPath(sel, transform));
            ctx.lineTo(localX, localY);
            ctx.stroke();
            if (sel) ctx.restore();
            ctx.beginPath();
            ctx.moveTo(localX, localY);
        }
    };

    const bakeLayerTransform = (layerId) => {
        const layer = layers.find(l => l.id === layerId);
        // Read from stored canvasData, NOT from the DOM canvas.
        // The DOM canvas may have transform handles painted onto it by the
        // draw-layer-content useEffect; baking from canvasData ensures those
        // handles are never written into the actual image pixels.
        if (!layer || !layer.canvasData) return;

        const transform = layer.transform || { x: 0, y: 0, scale: 1 };
        if (transform.x === 0 && transform.y === 0 && transform.scale === 1) return;

        const img = new Image();
        img.onload = () => {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvasSize.width;
            tempCanvas.height = canvasSize.height;
            const ctx = tempCanvas.getContext('2d');
            ctx.save();
            ctx.translate(transform.x, transform.y);
            ctx.scale(transform.scale, transform.scale);
            ctx.drawImage(img, 0, 0);
            ctx.restore();

            const newData = tempCanvas.toDataURL('image/png');
            const newBounds = getContentBounds(tempCanvas);
            onLayerUpdate(layerId, {
                canvasData: newData,
                transform: { x: 0, y: 0, scale: 1 },
                bounds: newBounds,
            });
        };
        img.src = layer.canvasData;
    };

    // Bake transform when switching away from transform tool;
    // also commit any in-flight floating selection first
    useEffect(() => {
        if (activeTool !== 'transform' && activeLayerId) {
            if (floatingSelRef.current) {
                commitFloat();
            }
            bakeLayerTransform(activeLayerId);
        }
    }, [activeTool, activeLayerId]);

    const updateLayerThumbnail = (layerId, newCanvasData) => {
        const canvasRef = canvasRefs.current[layerId];
        if (canvasRef && canvasRef.current) {
            const canvas = canvasRef.current;
            const data = newCanvasData || canvas.toDataURL('image/png');

            // Calculate content bounds
            const bounds = getContentBounds(canvas);

            const thumbnailCanvas = document.createElement('canvas');
            thumbnailCanvas.width = 100;
            thumbnailCanvas.height = 100;
            const tCtx = thumbnailCanvas.getContext('2d');

            const img = new Image();
            img.onload = () => {
                tCtx.drawImage(img, 0, 0, 100, 100);
                const thumbnail = thumbnailCanvas.toDataURL('image/png');
                onLayerUpdate(layerId, { thumbnail, canvasData: data, bounds });
            };
            img.src = data;
        }
    };

    useImperativeHandle(ref, () => ({
        getLayerCanvas: (layerId) => canvasRefs.current[layerId]?.current,

        getLayerBlob: (layerId) => {
            return new Promise((resolve) => {
                const layer = layers.find(l => l.id === layerId);
                const canvasRef = canvasRefs.current[layerId];

                if (canvasRef && canvasRef.current && layer) {
                    // Create a temp canvas to apply transforms
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = canvasSize.width;
                    tempCanvas.height = canvasSize.height;
                    const ctx = tempCanvas.getContext('2d');

                    // Apply transform
                    const transform = layer.transform || { x: 0, y: 0, scale: 1 };

                    // The transform is applied to the layer's div, so we need to replicate that on the canvas context
                    // Note: The canvas itself is 1024x1024 (or whatever size), and the transform moves the canvas element.
                    // To bake the transform into the image, we need to draw the image at the transformed position.

                    ctx.save();
                    ctx.translate(transform.x, transform.y);
                    ctx.scale(transform.scale, transform.scale);
                    ctx.drawImage(canvasRef.current, 0, 0);
                    ctx.restore();

                    tempCanvas.toBlob(resolve, 'image/png');
                } else {
                    resolve(null);
                }
            });
        },

        loadImageToLayer: async (layerId, imageBlob, shouldResizeCanvas = false) => {
            const canvasRef = canvasRefs.current[layerId];
            if (!canvasRef || !canvasRef.current) return;

            const img = new Image();
            const url = URL.createObjectURL(imageBlob);

            return new Promise((resolve) => {
                img.onload = () => {
                    // Create a temp canvas to get the data URL correctly sized
                    const tempCanvas = document.createElement('canvas');
                    let targetWidth = canvasSize.width;
                    let targetHeight = canvasSize.height;

                    if (shouldResizeCanvas) {
                        targetWidth = img.width;
                        targetHeight = img.height;
                        setCanvasSize({ width: targetWidth, height: targetHeight });

                        // Auto-fit view to container
                        if (containerRef.current) {
                            const containerWidth = containerRef.current.clientWidth;
                            const containerHeight = containerRef.current.clientHeight;
                            const scale = Math.min(
                                containerWidth / targetWidth,
                                containerHeight / targetHeight
                            ) * 0.9; // 90% fit
                            setViewScale(scale);
                            setViewOffset({ x: 0, y: 0 }); // Reset pan
                        }
                    }

                    tempCanvas.width = targetWidth;
                    tempCanvas.height = targetHeight;
                    const tCtx = tempCanvas.getContext('2d');

                    if (shouldResizeCanvas) {
                        tCtx.drawImage(img, 0, 0);
                    } else {
                        const scale = Math.min(
                            targetWidth / img.width,
                            targetHeight / img.height
                        );

                        const finalWidth = img.width * (scale < 1 ? scale : 1);
                        const finalHeight = img.height * (scale < 1 ? scale : 1);

                        const x = (targetWidth - finalWidth) / 2;
                        const y = (targetHeight - finalHeight) / 2;

                        tCtx.drawImage(img, 0, 0, img.width, img.height, x, y, finalWidth, finalHeight);
                    }

                    const newDataUrl = tempCanvas.toDataURL('image/png');
                    URL.revokeObjectURL(url);

                    // Calculate bounds for the new image
                    const bounds = getContentBounds(tempCanvas);

                    updateLayerThumbnail(layerId, newDataUrl);
                    // Also update bounds immediately
                    onLayerUpdate(layerId, { bounds });

                    resolve();
                };
                img.src = url;
            });
        },

        setCanvasSize: (width, height) => {
            setCanvasSize({ width, height });
        },

        getCanvasSize: () => ({ ...canvasSize }),
    }));

    return (
        <div
            className="drawing-canvas-container"
            ref={containerRef}
            style={{
                width: '100%',
                height: '100%',
                overflow: 'hidden',
                position: 'relative',
                cursor: activeTool === 'pan'
                    ? (transformState?.mode === 'pan' ? 'grabbing' : 'grab')
                    : activeTool === 'text'
                    ? 'text'
                    : activeTool === 'zoom'
                    ? 'zoom-in'
                    : ['select', 'lasso', 'shape-rect', 'shape-circle'].includes(activeTool)
                    ? 'crosshair'
                    : 'none'
            }}
            onMouseDown={startDrawing}
            onMouseUp={stopDrawing}
            onMouseMove={handleMouseMove}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchEnd={stopDrawing}
            onTouchMove={handleMouseMove}
        >
            <div className="canvas-wrapper" ref={wrapperRef} style={{
                width: canvasSize.width,
                height: canvasSize.height,
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: `translate(calc(-50% + ${viewOffset.x}px), calc(-50% + ${viewOffset.y}px)) scale(${viewScale})`,
                boxShadow: '0 0 20px rgba(0,0,0,0.1)',
                backgroundColor: 'white',
                transition: transformState?.mode === 'pan' ? 'none' : 'transform 0.1s ease-out'
            }}>
                {layers.map((layer) => {
                    if (!canvasRefs.current[layer.id]) {
                        canvasRefs.current[layer.id] = React.createRef();
                    }

                    const transform = layer.transform || { x: 0, y: 0, scale: 1 };

                    return (
                        <canvas
                            key={layer.id}
                            ref={canvasRefs.current[layer.id]}
                            className={`canvas-layer ${layer.id === activeLayerId ? 'active' : ''}`}
                            width={canvasSize.width}
                            height={canvasSize.height}
                            style={{
                                opacity: layer.visible ? (layer.opacity || 1.0) : 0,
                                mixBlendMode: layer.blendMode || 'normal',
                                pointerEvents: layer.id === activeLayerId && !layer.locked ? 'auto' : 'none',
                                transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                                transformOrigin: '0 0',
                                position: 'absolute',
                                top: 0,
                                left: 0
                            }}
                        />
                    );
                })}

                {/* Overlay canvas — live preview for shapes and selections */}
                <canvas
                    ref={overlayCanvasRef}
                    width={canvasSize.width}
                    height={canvasSize.height}
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        pointerEvents: 'none',
                        zIndex: 100,
                    }}
                />
            </div>

            {/* Text input overlay — resizable box. Enter = newline, Shift+Enter = stamp, click outside = stamp */}
            {textInput.visible && (
                <div
                    style={{
                        position: 'absolute',
                        left: textInput.x,
                        top: textInput.y,
                        width: textInput.width,
                        height: textInput.height,
                        zIndex: 200,
                        pointerEvents: 'auto',
                        border: '1.5px dashed #8b5cf6',
                        borderRadius: 3,
                        background: 'rgba(255,255,255,0.92)',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                        display: 'flex',
                        flexDirection: 'column',
                    }}
                    onMouseDown={e => e.stopPropagation()}
                >
                    <textarea
                        ref={textInputFieldRef}
                        value={textInput.value}
                        onChange={(e) => setTextInput(prev => ({ ...prev, value: e.target.value }))}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                                setTextInput({ visible: false, x: 0, y: 0, value: '', canvasX: 0, canvasY: 0, width: 200, height: 60, canvasFontSize: 24 });
                            }
                            // Shift+Enter = stamp; plain Enter = natural newline in the textarea
                            if (e.key === 'Enter' && e.shiftKey) {
                                e.preventDefault();
                                if (textInput.value.trim()) commitTextToLayer(textInput.value, textInput.canvasX, textInput.canvasY, textInput.canvasFontSize);
                                setTextInput({ visible: false, x: 0, y: 0, value: '', canvasX: 0, canvasY: 0, width: 200, height: 60, canvasFontSize: 24 });
                            }
                            e.stopPropagation();
                        }}
                        style={{
                            flex: 1,
                            background: 'transparent',
                            border: 'none',
                            outline: 'none',
                            padding: '4px 6px',
                            fontSize: `${Math.round(textInput.height * 0.5)}px`,
                            color: brushColor,
                            fontFamily: 'sans-serif',
                            resize: 'none',
                            overflow: 'hidden',
                            lineHeight: 1.2,
                        }}
                        placeholder="Type… Shift+Enter to stamp"
                    />
                    {/* SE corner drag handle — drag to resize box → changes stamped font size */}
                    <div
                        style={{
                            position: 'absolute',
                            bottom: 0,
                            right: 0,
                            width: 16,
                            height: 16,
                            cursor: 'se-resize',
                            background: '#8b5cf6',
                            borderRadius: '2px 0 3px 0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            fontSize: 9,
                            fontWeight: 'bold',
                            userSelect: 'none',
                        }}
                        onMouseDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault(); // keep textarea focused
                            const layerT = (layers.find(l => l.id === activeLayerId)?.transform) || { x: 0, y: 0, scale: 1 };
                            textResizeRef.current = {
                                active: true,
                                startX: e.clientX,
                                startY: e.clientY,
                                startWidth: textInput.width,
                                startHeight: textInput.height,
                                viewScale,
                                layerScale: layerT.scale,
                            };
                        }}
                    >⤡</div>
                </div>
            )}

            {/* Selection active badge — persists across tool switches */}
            {selectionActive && (
                <div style={{
                    position: 'absolute',
                    bottom: 40,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'rgba(15, 10, 30, 0.78)',
                    backdropFilter: 'blur(6px)',
                    WebkitBackdropFilter: 'blur(6px)',
                    color: '#e5e7eb',
                    fontSize: 12,
                    padding: '5px 14px',
                    borderRadius: 20,
                    border: '1px solid rgba(139, 92, 246, 0.35)',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    zIndex: 500,
                }}>
                    <span style={{ fontWeight: 700, color: '#a78bfa', marginRight: 5 }}>Selection active</span>
                    Esc to clear · Delete to erase
                </div>
            )}

            {/* Brush Cursor Indicator */}
            {(activeTool === 'brush' || activeTool === 'eraser') && (
                <div style={{
                    position: 'absolute',
                    top: cursorPos.y,
                    left: cursorPos.x,
                    width: brushSize * viewScale, // Scale cursor with view
                    height: brushSize * viewScale,
                    borderRadius: '50%',
                    border: '1px solid rgba(0,0,0,0.5)',
                    backgroundColor: activeTool === 'eraser' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.1)', // Subtle fill
                    transform: 'translate(-50%, -50%)',
                    pointerEvents: 'none',
                    zIndex: 1000
                }} />
            )}

            {/* Zoom indicator */}
            <div style={{
                position: 'absolute',
                bottom: 20,
                right: 20,
                background: 'rgba(0,0,0,0.7)',
                color: 'white',
                padding: '4px 8px',
                borderRadius: 4,
                fontSize: 12,
                pointerEvents: 'none'
            }}>
                {Math.round(viewScale * 100)}%
            </div>
        </div>
    );
});

MultiLayerCanvas.displayName = 'MultiLayerCanvas';

export default MultiLayerCanvas;
