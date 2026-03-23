import React, { useState } from 'react';
import { X, Sparkles, User, SlidersHorizontal } from 'lucide-react';
import { generateHuman } from '../utils/imageProcessing';

const GenerateHumanModal = ({ onClose, onApply }) => {
    const [prompt, setPrompt] = useState('');
    const [negativePrompt, setNegativePrompt] = useState('');
    const [steps, setSteps] = useState(50);
    const [guidance, setGuidance] = useState(7.5);
    const [showAdvanced, setShowAdvanced] = useState(false);

    const [isGenerating, setIsGenerating] = useState(false);
    const [resultUrl, setResultUrl] = useState(null);
    const [error, setError] = useState(null);

    const presets = [
        { label: 'Casual Dress', prompt: 'a fashion model wearing a stylish casual dress, full body, standing pose, studio lighting, high quality, detailed' },
        { label: 'Winter Coat', prompt: 'a fashion model wearing an elegant winter coat, full body, standing pose, studio lighting, high quality, detailed' },
        { label: 'Formal Suit', prompt: 'a fashion model wearing a tailored formal suit, full body, standing pose, studio lighting, high quality, detailed' },
        { label: 'Summer Outfit', prompt: 'a fashion model wearing a trendy summer outfit, full body, standing pose, bright lighting, high quality, detailed' },
    ];

    const handleGenerate = async () => {
        if (!prompt.trim()) {
            setError('Please enter a description of the outfit you want to generate.');
            return;
        }
        setError(null);
        setIsGenerating(true);
        setResultUrl(null);

        try {
            const blob = await generateHuman(prompt, negativePrompt, steps, guidance);
            const url = URL.createObjectURL(blob);
            setResultUrl(url);
        } catch (err) {
            console.error('Generation failed:', err);
            setError(err.message || 'An error occurred during generation.');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleApply = () => {
        if (resultUrl && onApply) {
            onApply(resultUrl);
            onClose();
        }
    };

    return (
        <div className="clothify-modal-overlay">
            <div className="clothify-modal" style={{ maxWidth: '700px' }}>
                <div className="clothify-modal-header">
                    <div className="clothify-modal-title">Generate Human — AI Fashion Figure</div>
                    <button className="clothify-modal-close" onClick={onClose} disabled={isGenerating}>
                        <X size={20} />
                    </button>
                </div>

                <div className="clothify-modal-body" style={{ padding: '24px', flexDirection: 'column', overflow: 'auto' }}>
                    {error && (
                        <div className="error-banner style-banner" style={{ marginBottom: '1rem', borderRadius: '8px' }}>
                            {error}
                        </div>
                    )}

                    {/* Prompt Input */}
                    <div className="clothify-setting-group">
                        <label className="clothify-setting-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                            <User size={16} /> Describe the outfit
                        </label>
                        <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="e.g. A fashion model wearing a red evening gown, full body, standing pose, studio lighting"
                            disabled={isGenerating}
                            style={{
                                width: '100%',
                                minHeight: '80px',
                                padding: '12px',
                                borderRadius: '8px',
                                border: '1px solid #d1d5db',
                                fontSize: '14px',
                                fontFamily: 'inherit',
                                resize: 'vertical',
                                background: '#f9fafb',
                                outline: 'none',
                                boxSizing: 'border-box',
                            }}
                        />
                    </div>

                    {/* Presets */}
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
                        {presets.map((p, i) => (
                            <button
                                key={i}
                                onClick={() => setPrompt(p.prompt)}
                                disabled={isGenerating}
                                style={{
                                    padding: '6px 12px',
                                    fontSize: '12px',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: '16px',
                                    background: prompt === p.prompt ? '#8b5cf6' : 'white',
                                    color: prompt === p.prompt ? 'white' : '#374151',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                }}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>

                    {/* Advanced Toggle */}
                    <button
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        style={{
                            marginTop: '16px',
                            background: 'none',
                            border: 'none',
                            color: '#6b7280',
                            cursor: 'pointer',
                            fontSize: '13px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: 0,
                        }}
                    >
                        <SlidersHorizontal size={14} />
                        {showAdvanced ? 'Hide' : 'Show'} Advanced Settings
                    </button>

                    {showAdvanced && (
                        <div style={{
                            marginTop: '12px',
                            padding: '16px',
                            background: '#f9fafb',
                            borderRadius: '8px',
                            border: '1px solid #e5e7eb',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                        }}>
                            {/* Negative Prompt */}
                            <div>
                                <label style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px', display: 'block' }}>
                                    Negative Prompt (what to avoid)
                                </label>
                                <input
                                    type="text"
                                    value={negativePrompt}
                                    onChange={(e) => setNegativePrompt(e.target.value)}
                                    placeholder="low quality, blurry, deformed..."
                                    disabled={isGenerating}
                                    style={{
                                        width: '100%',
                                        padding: '8px 12px',
                                        borderRadius: '6px',
                                        border: '1px solid #d1d5db',
                                        fontSize: '13px',
                                        background: 'white',
                                        boxSizing: 'border-box',
                                    }}
                                />
                            </div>

                            {/* Steps */}
                            <div>
                                <label style={{ fontSize: '12px', color: '#6b7280', display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Steps</span>
                                    <span>{steps}</span>
                                </label>
                                <input
                                    type="range" min="20" max="100" step="5" value={steps}
                                    onChange={(e) => setSteps(parseInt(e.target.value))}
                                    disabled={isGenerating}
                                    style={{ width: '100%' }}
                                />
                            </div>

                            {/* Guidance */}
                            <div>
                                <label style={{ fontSize: '12px', color: '#6b7280', display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Guidance Scale</span>
                                    <span>{guidance}</span>
                                </label>
                                <input
                                    type="range" min="1" max="20" step="0.5" value={guidance}
                                    onChange={(e) => setGuidance(parseFloat(e.target.value))}
                                    disabled={isGenerating}
                                    style={{ width: '100%' }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Loading */}
                    {isGenerating && (
                        <div className="clothify-preview-container" style={{ marginTop: '1.5rem', minHeight: '150px' }}>
                            <div className="clothify-loading">
                                <div className="clothify-spinner"></div>
                                <span className="clothify-loading-text">
                                    Generating human figure (~1–3 min on CPU)…
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Result */}
                    {resultUrl && !isGenerating && (
                        <div style={{
                            marginTop: '1.5rem', height: '420px', display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            background: '#f9fafb', border: '1px solid #e5e7eb',
                            borderRadius: '8px', overflow: 'hidden'
                        }}>
                            <img
                                src={resultUrl}
                                alt="Generated Human"
                                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            />
                        </div>
                    )}
                </div>

                <div className="clothify-modal-footer">
                    <button className="clothify-footer-btn clothify-footer-btn-cancel" onClick={onClose} disabled={isGenerating}>
                        Cancel
                    </button>
                    <button
                        className="clothify-footer-btn clothify-footer-btn-ok"
                        onClick={handleGenerate}
                        disabled={isGenerating || !prompt.trim()}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            background: 'var(--btn-purple)',
                            opacity: (isGenerating || !prompt.trim()) ? 0.5 : 1
                        }}
                    >
                        <Sparkles size={16} /> {resultUrl ? 'Re-Generate' : 'Generate'}
                    </button>
                    {resultUrl && (
                        <button className="clothify-footer-btn clothify-footer-btn-ok" onClick={handleApply}>
                            Apply to Canvas
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default GenerateHumanModal;
