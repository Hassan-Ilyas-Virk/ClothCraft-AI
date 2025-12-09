import React, { useState } from 'react';
import './ClothifyModal.css';

const ClothifyModal = ({
    layer,
    onClose,
    onApply,
    onGenerate
}) => {
    const [prompt, setPrompt] = useState('high quality, detailed, photorealistic clothing');
    const [blendStrength, setBlendStrength] = useState(0.75);
    const [preview, setPreview] = useState(null);
    const [isGenerating, setIsGenerating] = useState(false);

    const handleGenerate = async () => {
        setIsGenerating(true);
        try {
            const result = await onGenerate({
                layerId: layer.id,
                prompt,
                blendStrength,
            });
            setPreview(result);
        } catch (error) {
            console.error('Generation failed:', error);
            alert('Failed to generate preview. Please try again.');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleApply = () => {
        if (preview) {
            onApply(layer.id, preview);
            onClose();
        }
    };

    const handleOverlayClick = (e) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return (
        <div className="clothify-modal-overlay" onClick={handleOverlayClick}>
            <div className="clothify-modal">
                <div className="clothify-modal-header">
                    <div className="clothify-modal-title">
                        ✨ Clothify - {layer.name}
                    </div>
                    <button className="clothify-modal-close" onClick={onClose}>
                        ✕
                    </button>
                </div>

                <div className="clothify-modal-body">
                    {/* Settings Panel */}
                    <div className="clothify-settings">
                        <div className="clothify-setting-group">
                            <label className="clothify-setting-label">Prompt</label>
                            <textarea
                                className="clothify-prompt-input"
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder="Describe the clothing you want to generate..."
                            />
                        </div>

                        <div className="clothify-setting-group">
                            <label className="clothify-setting-label">
                                Blend Strength: {Math.round(blendStrength * 100)}%
                            </label>
                            <div className="clothify-slider">
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    value={blendStrength}
                                    onChange={(e) => setBlendStrength(parseFloat(e.target.value))}
                                />
                                <div className="clothify-slider-value">
                                    {blendStrength === 0
                                        ? '0% = Pix2Pix only (no Stable Diffusion)'
                                        : 'Higher = more change, softer edges'}
                                </div>
                            </div>
                        </div>

                        <div className="clothify-setting-group">
                            <label className="clothify-setting-label">Layer Info</label>
                            <div style={{ fontSize: '13px', color: '#6b7280' }}>
                                <div>Type: {layer.type}</div>
                                <div>Visible: {layer.visible ? 'Yes' : 'No'}</div>
                                <div>Locked: {layer.locked ? 'Yes' : 'No'}</div>
                            </div>
                        </div>
                    </div>

                    {/* Preview Panel */}
                    <div className="clothify-preview">
                        <div className="clothify-preview-container">
                            {preview ? (
                                <img
                                    src={preview}
                                    alt="Generated preview"
                                    className="clothify-preview-image"
                                />
                            ) : (
                                <div className="clothify-preview-placeholder">
                                    <div className="clothify-preview-placeholder-icon">🎨</div>
                                    <div className="clothify-preview-placeholder-text">
                                        Click "Generate" to create a preview
                                    </div>
                                </div>
                            )}

                            {isGenerating && (
                                <div className="clothify-loading">
                                    <div className="clothify-spinner"></div>
                                    <div className="clothify-loading-text">
                                        Generating your design...
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="clothify-preview-actions">
                            <button
                                className="clothify-btn clothify-btn-primary"
                                onClick={handleGenerate}
                                disabled={isGenerating}
                            >
                                {preview ? '🔄 Regenerate' : '✨ Generate'}
                            </button>
                            {preview && (
                                <button
                                    className="clothify-btn clothify-btn-secondary"
                                    onClick={() => setPreview(null)}
                                    disabled={isGenerating}
                                >
                                    🗑️ Clear
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="clothify-modal-footer">
                    <button
                        className="clothify-footer-btn clothify-footer-btn-cancel"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                    <button
                        className="clothify-footer-btn clothify-footer-btn-ok"
                        onClick={handleApply}
                        disabled={!preview || isGenerating}
                    >
                        ✓ Apply to Reference
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ClothifyModal;
