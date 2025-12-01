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

    // Draw layer content when layer data or transform changes
    useEffect(() => {
        layers.forEach(layer => {
            const canvasRef = canvasRefs.current[layer.id];
            if (canvasRef && canvasRef.current && layer.canvasData) {
                const ctx = canvasRef.current.getContext('2d');
                const img = new Image();
                img.onload = () => {
                    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
                    ctx.globalCompositeOperation = 'source-over'; // Reset composite operation
                    ctx.drawImage(img, 0, 0);

                    if (layer.id === activeLayerId && activeTool === 'transform') {
                        drawTransformHandles(ctx, layer);
                    }
                };
                img.src = layer.canvasData;
            }
        });
    }, [layers, canvasSize, activeLayerId, activeTool]);

    const drawTransformHandles = (ctx, layer) => {
        const bounds = layer.bounds || { x: 0, y: 0, width: canvasSize.width, height: canvasSize.height };
        const transform = layer.transform || { scale: 1 };

        ctx.save();
        ctx.strokeStyle = '#8b5cf6';
        ctx.lineWidth = 2 / transform.scale;
        ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

        const handleSize = 10 / transform.scale;
        ctx.fillStyle = 'white';

        const corners = [
            { x: bounds.x, y: bounds.y },
            { x: bounds.x + bounds.width, y: bounds.y },
            { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
            { x: bounds.x, y: bounds.y + bounds.height }
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

    const startDrawing = (e) => {
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

        if (!activeLayerId) return;
        const activeLayer = layers.find(l => l.id === activeLayerId);
        if (!activeLayer) return;
        if (activeLayer.locked && activeTool !== 'transform') return;
        if (activeLayer.locked) return;

        const pos = getMousePos(e);

        if (activeTool === 'transform') {
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
        }
    };

    const stopDrawing = () => {
        if (transformState) {
            setTransformState(null);
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
            ctx.lineTo(localX, localY);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(localX, localY);
        }
    };

    const bakeLayerTransform = (layerId) => {
        const canvasRef = canvasRefs.current[layerId];
        if (!canvasRef || !canvasRef.current) return;

        const layer = layers.find(l => l.id === layerId);
        if (!layer) return;

        const transform = layer.transform || { x: 0, y: 0, scale: 1 };

        // If no significant transform, skip
        if (transform.x === 0 && transform.y === 0 && transform.scale === 1) return;

        // Create temp canvas
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvasSize.width;
        tempCanvas.height = canvasSize.height;
        const ctx = tempCanvas.getContext('2d');

        // Draw with transform
        ctx.translate(transform.x, transform.y);
        ctx.scale(transform.scale, transform.scale);
        ctx.drawImage(canvasRef.current, 0, 0);

        // Update layer data
        const newData = tempCanvas.toDataURL('image/png');

        // Calculate new bounds
        const newBounds = getContentBounds(tempCanvas);

        onLayerUpdate(layerId, {
            canvasData: newData,
            transform: { x: 0, y: 0, scale: 1 }, // Reset transform
            bounds: newBounds
        });
    };

    // Bake transform when switching away from transform tool
    useEffect(() => {
        if (activeTool !== 'transform' && activeLayerId) {
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
        }
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
                cursor: activeTool === 'pan' ? (transformState?.mode === 'pan' ? 'grabbing' : 'grab') : 'none' // Hide default cursor for brush
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
            </div>

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
