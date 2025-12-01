import React, { useState, useEffect, useRef } from 'react';
import './PatternMakerModal.css';

const PatternMakerModal = ({
    layer,
    onClose,
    onApply,
    onRefine
}) => {
    const PROMPT_PRESETS = {
        'Custom': { element: '', pattern: '' },
        'Realistic': {
            element: 'photorealistic, high detail, 8k, texture, lighting',
            pattern: 'photorealistic seamless pattern, high detail, 8k, texture'
        },
        'Artistic': {
            element: 'digital art, painterly, expressive, vibrant colors, artistic style',
            pattern: 'artistic seamless pattern, painterly style, expressive, vibrant'
        },
        'Flat Design': {
            element: 'flat design, vector art, minimal, clean lines, no gradients',
            pattern: 'flat design seamless pattern, vector style, minimal, clean'
        },
        'Perfect Shapes': {
            element: 'perfect geometry, precise lines, mathematical, symmetry, vector',
            pattern: 'geometric seamless pattern, precise, symmetrical, vector quality'
        },
        'Vintage': {
            element: 'vintage style, retro, aged texture, muted colors',
            pattern: 'vintage seamless pattern, retro style, aged texture'
        }
    };

    const [scale, setScale] = useState(0.5);
    const [rotation, setRotation] = useState(0);
    const [spacingX, setSpacingX] = useState(0);
    const [spacingY, setSpacingY] = useState(0);
    const [bgColor, setBgColor] = useState('#ffffff');
    const [isTransparent, setIsTransparent] = useState(true);
    const [elementPrompt, setElementPrompt] = useState('high quality, detailed');
    const [patternPrompt, setPatternPrompt] = useState('seamless pattern, high quality, detailed texture');
    const [strength, setStrength] = useState(0.6);
    const [isRefining, setIsRefining] = useState(false);
    const [isRefiningElement, setIsRefiningElement] = useState(false);
    const [refinedImage, setRefinedImage] = useState(null);

    const canvasRef = useRef(null);
    const sourceImageRef = useRef(null);
    const originalSourceImageRef = useRef(null);

    // Load source image
    useEffect(() => {
        if (layer?.canvasData) {
            const img = new Image();
            img.onload = () => {
                // If layer has bounds, crop the image
                if (layer.bounds) {
                    const canvas = document.createElement('canvas');
                    canvas.width = layer.bounds.width;
                    canvas.height = layer.bounds.height;
                    const ctx = canvas.getContext('2d');

                    ctx.drawImage(
                        img,
                        layer.bounds.x,
                        layer.bounds.y,
                        layer.bounds.width,
                        layer.bounds.height,
                        0, 0,
                        layer.bounds.width,
                        layer.bounds.height
                    );

                    const croppedImg = new Image();
                    croppedImg.onload = () => {
                        sourceImageRef.current = croppedImg;
                        originalSourceImageRef.current = croppedImg; // Save original
                        updatePreview();
                    };
                    croppedImg.src = canvas.toDataURL();
                } else {
                    sourceImageRef.current = img;
                    originalSourceImageRef.current = img; // Save original
                    updatePreview();
                }
            };
            img.src = layer.canvasData;
        }
    }, [layer]);

    // Update preview when settings change
    // Update preview when settings change
    useEffect(() => {
        updatePreview();
    }, [scale, rotation, spacingX, spacingY, bgColor, isTransparent]);

    const updatePreview = () => {
        const canvas = canvasRef.current;
        const img = sourceImageRef.current;
        if (!canvas || !img) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        if (!isTransparent) {
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, width, height);
        }

        // Pattern logic
        const patternWidth = img.width * scale;
        const patternHeight = img.height * scale;

        // Calculate effective spacing
        const effSpacingX = patternWidth + spacingX;
        const effSpacingY = patternHeight + spacingY;

        // Calculate number of tiles needed
        // Add buffer for rotation
        const buffer = Math.max(patternWidth, patternHeight);
        const startX = -buffer;
        const startY = -buffer;
        const endX = width + buffer;
        const endY = height + buffer;

        ctx.save();

        for (let y = startY; y < endY; y += effSpacingY) {
            for (let x = startX; x < endX; x += effSpacingX) {
                ctx.save();

                // Translate to center of tile
                const cx = x + patternWidth / 2;
                const cy = y + patternHeight / 2;

                ctx.translate(cx, cy);
                ctx.rotate((rotation * Math.PI) / 180);

                // Draw image centered
                ctx.drawImage(
                    img,
                    -patternWidth / 2,
                    -patternHeight / 2,
                    patternWidth,
                    patternHeight
                );

                ctx.restore();
            }
        }

        ctx.restore();
    };

    const handleRefine = async () => {
        if (!canvasRef.current) return;

        setIsRefining(true);
        try {
            const patternData = canvasRef.current.toDataURL('image/png');
            const result = await onRefine({
                image: patternData,
                prompt: patternPrompt,
                strength: strength
            });
            setRefinedImage(result);
        } catch (error) {
            console.error('Refinement failed:', error);
            alert('Failed to refine pattern. Please try again.');
        } finally {
            setIsRefining(false);
        }
    };

    const handleRefineElement = async () => {
        // Always use original source for refinement to allow retries
        const sourceImg = originalSourceImageRef.current || sourceImageRef.current;
        if (!sourceImg) return;

        setIsRefiningElement(true);
        try {
            // 1. Create a canvas from the current source image
            const canvas = document.createElement('canvas');
            canvas.width = sourceImg.width;
            canvas.height = sourceImg.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(sourceImg, 0, 0);

            // 2. Create mask from alpha channel (white = opaque, black = transparent)
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = canvas.width;
            maskCanvas.height = canvas.height;
            const maskCtx = maskCanvas.getContext('2d');
            const maskData = maskCtx.createImageData(canvas.width, canvas.height);

            for (let i = 0; i < imageData.data.length; i += 4) {
                const alpha = imageData.data[i + 3];
                // If pixel is visible, make it white in mask (inpaint target)
                // If transparent, make it black (preserve)
                const val = alpha > 10 ? 255 : 0;
                maskData.data[i] = val;
                maskData.data[i + 1] = val;
                maskData.data[i + 2] = val;
                maskData.data[i + 3] = 255;
            }
            maskCtx.putImageData(maskData, 0, 0);

            // 3. Convert to blobs
            const imageBlob = await new Promise(r => canvas.toBlob(r));
            const maskBlob = await new Promise(r => maskCanvas.toBlob(r));

            // 4. Send to Inpaint API
            // We use a high strength to allow the shape to be refined/cleaned up
            const formData = new FormData();
            formData.append('reference', imageBlob, 'ref.png');
            formData.append('mask', maskBlob, 'mask.png');
            formData.append('reference', imageBlob, 'ref.png');
            formData.append('mask', maskBlob, 'mask.png');
            formData.append('prompt', elementPrompt);
            formData.append('strength', strength.toString());

            const response = await fetch('http://127.0.0.1:5000/inpaint', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) throw new Error('Refinement failed');

            const resultBlob = await response.blob();
            const resultImg = await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = URL.createObjectURL(resultBlob);
            });

            // 5. Remove black background from result (SD returns opaque image)
            const resultCanvas = document.createElement('canvas');
            resultCanvas.width = resultImg.width;
            resultCanvas.height = resultImg.height;
            const resultCtx = resultCanvas.getContext('2d');
            resultCtx.drawImage(resultImg, 0, 0);
            const resultData = resultCtx.getImageData(0, 0, resultCanvas.width, resultCanvas.height);

            for (let i = 0; i < resultData.data.length; i += 4) {
                const r = resultData.data[i];
                const g = resultData.data[i + 1];
                const b = resultData.data[i + 2];
                // Simple black removal
                if (r < 30 && g < 30 && b < 30) {
                    resultData.data[i + 3] = 0;
                }
            }
            resultCtx.putImageData(resultData, 0, 0);

            // 6. Update source image
            const finalImg = new Image();
            finalImg.onload = () => {
                sourceImageRef.current = finalImg;
                updatePreview();
            };
            finalImg.src = resultCanvas.toDataURL();

        } catch (error) {
            console.error('Element refinement failed:', error);
            alert('Failed to refine element.');
        } finally {
            setIsRefiningElement(false);
        }
    };

    const handleApply = () => {
        // If we have a refined image, use that. Otherwise use the generated pattern.
        const finalImage = refinedImage || canvasRef.current.toDataURL('image/png');
        onApply(finalImage);
        onClose();
    };

    return (
        <div className="pattern-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="pattern-modal">
                <div className="pattern-modal-header">
                    <div className="pattern-modal-title">
                        🎨 Pattern Maker - {layer.name}
                    </div>
                    <button className="pattern-modal-close" onClick={onClose}>✕</button>
                </div>

                <div className="pattern-modal-body">
                    {/* Settings */}
                    <div className="pattern-settings">
                        <div className="pattern-setting-group">
                            <label className="pattern-setting-label">
                                Scale: {Math.round(scale * 100)}%
                            </label>
                            <input
                                type="range"
                                min="0.1"
                                max="2.0"
                                step="0.1"
                                value={scale}
                                onChange={(e) => setScale(parseFloat(e.target.value))}
                                className="pattern-slider"
                            />
                        </div>

                        <div className="pattern-setting-group">
                            <label className="pattern-setting-label">
                                Rotation: {rotation}°
                            </label>
                            <input
                                type="range"
                                min="0"
                                max="360"
                                step="15"
                                value={rotation}
                                onChange={(e) => setRotation(parseInt(e.target.value))}
                                className="pattern-slider"
                            />
                        </div>

                        <div className="pattern-setting-group">
                            <label className="pattern-setting-label">
                                Spacing X: {spacingX}px
                            </label>
                            <input
                                type="range"
                                min="-100"
                                max="200"
                                step="5"
                                value={spacingX}
                                onChange={(e) => setSpacingX(parseInt(e.target.value))}
                                className="pattern-slider"
                            />
                        </div>

                        <div className="pattern-setting-group">
                            <label className="pattern-setting-label">
                                Spacing Y: {spacingY}px
                            </label>
                            <input
                                type="range"
                                min="-100"
                                max="200"
                                step="5"
                                value={spacingY}
                                onChange={(e) => setSpacingY(parseInt(e.target.value))}
                                className="pattern-slider"
                            />
                        </div>

                        <div className="pattern-setting-group">
                            <label className="pattern-setting-label">
                                Background
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 'normal' }}>
                                    <input
                                        type="checkbox"
                                        checked={isTransparent}
                                        onChange={(e) => setIsTransparent(e.target.checked)}
                                    />
                                    Transparent
                                </label>
                            </label>
                            {!isTransparent && (
                                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                    <input
                                        type="color"
                                        value={bgColor}
                                        onChange={(e) => setBgColor(e.target.value)}
                                        style={{ width: '40px', height: '40px', padding: 0, border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                    />
                                    <input
                                        type="text"
                                        value={bgColor}
                                        onChange={(e) => setBgColor(e.target.value)}
                                        className="pattern-prompt-input"
                                        style={{ height: '40px', padding: '0 0.5rem', display: 'flex', alignItems: 'center' }}
                                    />
                                </div>
                            )}
                        </div>

                        <div className="pattern-setting-group">
                            <label className="pattern-setting-label">Style Preset</label>
                            <select
                                className="pattern-prompt-input"
                                onChange={(e) => {
                                    const preset = PROMPT_PRESETS[e.target.value];
                                    if (preset && e.target.value !== 'Custom') {
                                        setElementPrompt(preset.element);
                                        setPatternPrompt(preset.pattern);
                                    }
                                }}
                                style={{ height: '40px' }}
                            >
                                {Object.keys(PROMPT_PRESETS).map(key => (
                                    <option key={key} value={key}>{key}</option>
                                ))}
                            </select>
                        </div>

                        <div className="pattern-setting-group">
                            <label className="pattern-setting-label">
                                AI Strength: {Math.round(strength * 100)}%
                            </label>
                            <input
                                type="range"
                                min="0.1"
                                max="1.0"
                                step="0.05"
                                value={strength}
                                onChange={(e) => setStrength(parseFloat(e.target.value))}
                                className="pattern-slider"
                            />
                            <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
                                Lower = closer to original, Higher = more creative
                            </div>
                        </div>

                        <div className="pattern-setting-group">
                            <label className="pattern-setting-label">Element Prompt</label>
                            <textarea
                                className="pattern-prompt-input"
                                value={elementPrompt}
                                onChange={(e) => setElementPrompt(e.target.value)}
                                placeholder="Describe how to refine the single element..."
                                style={{ height: '80px' }}
                            />
                        </div>

                        <div className="pattern-setting-group">
                            <label className="pattern-setting-label">Pattern Prompt</label>
                            <textarea
                                className="pattern-prompt-input"
                                value={patternPrompt}
                                onChange={(e) => setPatternPrompt(e.target.value)}
                                placeholder="Describe how to refine the full pattern..."
                                style={{ height: '80px' }}
                            />
                        </div>

                        <div className="pattern-setting-group">
                            <button
                                className="pattern-btn pattern-btn-secondary"
                                onClick={handleRefineElement}
                                disabled={isRefiningElement || isRefining}
                                style={{ marginBottom: '1rem', backgroundColor: '#f3f4f6' }}
                            >
                                {isRefiningElement ? '✨ Refining Element...' : '✨ Refine Single Element'}
                            </button>

                            <button
                                className="pattern-btn pattern-btn-primary"
                                onClick={handleRefine}
                                disabled={isRefining || isRefiningElement}
                            >
                                {isRefining ? '✨ Refining Pattern...' : '✨ Refine Full Pattern'}
                            </button>
                        </div>
                    </div>

                    {/* Preview */}
                    <div className="pattern-preview">
                        <div className="pattern-preview-container">
                            {refinedImage ? (
                                <img
                                    src={refinedImage}
                                    alt="Refined Pattern"
                                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                                />
                            ) : (
                                <canvas
                                    ref={canvasRef}
                                    width={1024}
                                    height={1024}
                                    className="pattern-preview-canvas"
                                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                                />
                            )}

                            {isRefining && (
                                <div className="pattern-loading">
                                    <div className="pattern-spinner"></div>
                                    <div>Refining pattern with Stable Diffusion...</div>
                                </div>
                            )}
                        </div>

                        {refinedImage && (
                            <button
                                className="pattern-btn pattern-btn-secondary"
                                onClick={() => setRefinedImage(null)}
                                style={{ alignSelf: 'center' }}
                            >
                                ↩️ Undo Refinement
                            </button>
                        )}
                    </div>
                </div>

                <div className="pattern-modal-footer">
                    <button className="pattern-btn pattern-btn-secondary" onClick={onClose}>
                        Cancel
                    </button>
                    <button className="pattern-btn pattern-btn-primary" onClick={handleApply}>
                        ✓ Apply to Layer
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PatternMakerModal;
