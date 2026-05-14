/**
 * ClothifyModal — UI for the Clothify AI pipeline.
 *
 * The modal manages two phases:
 *   1. Generate: calls onGenerate({ layerId, prompt, blendStrength }) which
 *      runs the Pix2Pix → composite → (optional) Stable Diffusion pipeline
 *      in App.jsx and returns a preview data URL.
 *   2. Apply: calls onApply(layerId, previewDataUrl) which replaces the
 *      reference layer with the generated result and removes the drawing layer.
 *
 * Props:
 *   layer        - The drawing layer being Clothified (for its id and name)
 *   onClose      - Close the modal without applying
 *   onApply      - Apply the generated preview to the reference layer
 *   onGenerate   - Run the AI pipeline; returns a Promise<dataUrl>
 *   progress     - 0-100 progress value reported by App.jsx during generation
 *   status       - Human-readable status string shown in the progress bar
 *
 * blendStrength controls the Stable Diffusion influence:
 *   0   = Pix2Pix only — fast, preserves original colors
 *   0.75 = default — SD refines edges and textures
 *   1.0 = full SD — maximum change, may drift from original composition
 */
import React, { useState } from 'react';
import './ClothifyModal.css';
import './ProgressBar.css';

const ClothifyModal = ({
    layer,
    onClose,
    onApply,
    onGenerate,
    progress,
    status
}) => {
    const [prompt, setPrompt] = useState('high quality, detailed, photorealistic clothing');
    const [blendStrength, setBlendStrength] = useState(0.75);
    const [preview, setPreview] = useState(null);
    const [isGenerating, setIsGenerating] = useState(false);

    const handleGenerate = async () => {
        setIsGenerating(true);
        try {
            // onGenerate is async and may take 10–60 seconds depending on
            // blendStrength (0 = Pix2Pix only; >0 also runs Stable Diffusion).
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
            // Delegate to App.jsx which replaces the reference layer and
            // removes the drawing layer that was Clothified.
            onApply(layer.id, preview);
            onClose();
        }
    };

    // Close the modal when the user clicks the dark overlay behind it.
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
                        Clothify - {layer.name}
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
                                    <div className="clothify-preview-placeholder-text">
                                        Click "Generate" to create a preview
                                    </div>
                                </div>
                            )}

                            {isGenerating && (
                                <div className="clothify-loading">
                                    <div className="progress-container">
                                        <div className="progress-header">
                                            <span>{status || 'Generating...'}</span>
                                            <span className="progress-percentage">{Math.round(progress || 0)}%</span>
                                        </div>
                                        <div className="progress-track">
                                            <div 
                                                className="progress-bar" 
                                                style={{ width: `${progress}%` }}
                                            ></div>
                                        </div>
                                        <div className="progress-status">
                                            This may take a minute or two...
                                        </div>
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
                                {preview ? 'Regenerate' : 'Generate'}
                            </button>
                            {preview && (
                                <button
                                    className="clothify-btn clothify-btn-secondary"
                                    onClick={() => setPreview(null)}
                                    disabled={isGenerating}
                                >
                                    Clear
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
                        Apply to Reference
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ClothifyModal;
