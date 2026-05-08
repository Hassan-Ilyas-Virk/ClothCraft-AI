import React, { useState } from 'react';
import { Wand2, RotateCcw, Info } from 'lucide-react';
import API_BASE, { NGROK_HEADERS } from '../config.js';
import './TextToClothesModal.css';

const COLOR_CHIPS = ['red', 'blue', 'navy', 'black', 'white', 'green', 'yellow', 'purple', 'pink', 'orange', 'grey', 'brown'];
const GARMENT_CHIPS = ['shirt', 'dress', 'blazer', 'jacket', 'jeans', 'suit', 'hoodie', 'crop top', 'skirt', 'coat', 'sweater', 'vest'];

const TextToClothesModal = ({ referenceLayer, onClose, onApply }) => {
    const [prompt, setPrompt] = useState('');
    const [strength, setStrength] = useState(0.55);
    const [preview, setPreview] = useState(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [status, setStatus] = useState('');
    const [showOriginal, setShowOriginal] = useState(false);

    const appendChip = (chip) => {
        setPrompt(prev => {
            const trimmed = prev.trim();
            return trimmed ? `${trimmed}, ${chip}` : chip;
        });
    };

    const handleGenerate = async () => {
        if (!prompt.trim()) return;
        setIsGenerating(true);
        setStatus('Preparing image…');
        setPreview(null);
        setShowOriginal(false);
        try {
            const res = await fetch(referenceLayer.canvasData);
            const referenceBlob = await res.blob();

            const formData = new FormData();
            formData.append('reference', referenceBlob, 'reference.png');
            formData.append('prompt', prompt.trim());
            formData.append('strength', strength.toString());

            setStatus('Generating clothing…');
            const response = await fetch(`${API_BASE}/text-to-clothes`, {
                method: 'POST',
                headers: NGROK_HEADERS,
                body: formData,
            });

            if (!response.ok) throw new Error(`Server error: ${response.status}`);

            const blob = await response.blob();
            setPreview(URL.createObjectURL(blob));
            setStatus('');
        } catch (err) {
            console.error('Text-to-clothes error:', err);
            setStatus('Generation failed — is the backend running?');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleApply = () => {
        if (preview) {
            onApply(preview);
            onClose();
        }
    };

    const handleOverlayClick = (e) => {
        if (e.target === e.currentTarget) onClose();
    };

    return (
        <div className="ttc-overlay" onClick={handleOverlayClick}>
            <div className="ttc-modal">
                {/* Header */}
                <div className="ttc-header">
                    <div className="ttc-header-title">
                        <Wand2 size={20} className="ttc-header-icon" />
                        <div>
                            <h2>Text to Clothes</h2>
                            <p>Describe clothing to apply to the model</p>
                        </div>
                    </div>
                    <button className="ttc-close" onClick={onClose}>✕</button>
                </div>

                {/* Body */}
                <div className="ttc-body">
                    {/* Sidebar */}
                    <div className="ttc-sidebar">
                        <div className="ttc-field">
                            <label className="ttc-label">Clothing Description</label>
                            <textarea
                                className="ttc-textarea"
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder="e.g. red shirt, blue jeans, black dress…"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                        e.preventDefault();
                                        handleGenerate();
                                    }
                                    e.stopPropagation();
                                }}
                            />
                        </div>

                        <div className="ttc-suggestions">
                            <label className="ttc-label">Colors</label>
                            <div className="ttc-chips">
                                {COLOR_CHIPS.map(c => (
                                    <button key={c} className="ttc-chip" onClick={() => appendChip(c)}>{c}</button>
                                ))}
                            </div>
                        </div>

                        <div className="ttc-suggestions">
                            <label className="ttc-label">Garments</label>
                            <div className="ttc-chips">
                                {GARMENT_CHIPS.map(g => (
                                    <button key={g} className="ttc-chip" onClick={() => appendChip(g)}>{g}</button>
                                ))}
                            </div>
                        </div>

                        <div className="ttc-field">
                            <div className="ttc-label-row">
                                <label className="ttc-label">Blend Strength</label>
                                <span className="ttc-value">{Math.round(strength * 100)}%</span>
                            </div>
                            <input
                                type="range"
                                className="ttc-range"
                                min="0.3"
                                max="0.85"
                                step="0.05"
                                value={strength}
                                onChange={(e) => setStrength(parseFloat(e.target.value))}
                                style={{
                                    background: `linear-gradient(to right, var(--btn-purple) 0%, var(--btn-purple) ${((strength - 0.3) / 0.55) * 100}%, #e5e7eb ${((strength - 0.3) / 0.55) * 100}%, #e5e7eb 100%)`
                                }}
                            />
                            <p className="ttc-hint">
                                Lower = preserve original more · Higher = stronger clothing change
                            </p>
                        </div>

                        <div className="ttc-info-box">
                            <Info size={15} />
                            <p>Face, pose and background are preserved. Only the clothing is regenerated based on your description.</p>
                        </div>

                        <button
                            className={`ttc-generate-btn${isGenerating ? ' loading' : ''}`}
                            onClick={handleGenerate}
                            disabled={isGenerating || !prompt.trim()}
                        >
                            {isGenerating
                                ? <><span className="ttc-spinner" /> Generating…</>
                                : <><Wand2 size={16} /> {preview ? 'Regenerate' : 'Generate'}</>
                            }
                        </button>
                    </div>

                    {/* Preview pane */}
                    <div className="ttc-preview">
                        <div className="ttc-preview-canvas">
                            {preview && !showOriginal ? (
                                <>
                                    <img src={preview} alt="Generated result" className="ttc-preview-img" />
                                    <span className="ttc-badge">GENERATED</span>
                                </>
                            ) : referenceLayer?.canvasData ? (
                                <>
                                    <img src={referenceLayer.canvasData} alt="Original reference" className="ttc-preview-img" />
                                    {preview && <span className="ttc-badge">ORIGINAL</span>}
                                </>
                            ) : (
                                <div className="ttc-placeholder">
                                    <Wand2 size={40} strokeWidth={1} />
                                    <p>Describe clothing and click Generate</p>
                                </div>
                            )}

                            {isGenerating && (
                                <div className="ttc-loading-overlay">
                                    <span className="ttc-spinner large" />
                                    <p>{status}</p>
                                </div>
                            )}
                        </div>

                        {status && !isGenerating && (
                            <p className="ttc-status">{status}</p>
                        )}

                        {preview && (
                            <div className="ttc-toggle-row">
                                <button
                                    className={`ttc-toggle-btn${!showOriginal ? ' active' : ''}`}
                                    onClick={() => setShowOriginal(false)}
                                >Generated</button>
                                <button
                                    className={`ttc-toggle-btn${showOriginal ? ' active' : ''}`}
                                    onClick={() => setShowOriginal(true)}
                                >Original</button>
                                <button
                                    className="ttc-reset-btn"
                                    onClick={() => { setPreview(null); setShowOriginal(false); setStatus(''); }}
                                >
                                    <RotateCcw size={13} /> Reset
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="ttc-footer">
                    <button className="ttc-btn secondary" onClick={onClose}>Cancel</button>
                    <button
                        className="ttc-btn primary"
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

export default TextToClothesModal;
