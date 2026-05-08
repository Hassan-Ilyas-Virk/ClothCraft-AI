import React, { useState } from 'react';
import { X, SlidersHorizontal, ImagePlus, Sparkles, Wand2 } from 'lucide-react';
import { blendStyles } from '../utils/imageProcessing';
import API_BASE, { NGROK_HEADERS } from '../config.js';
import './ProgressBar.css';

const StylebendModal = ({ onClose, onApply, initialImage1Url }) => {
    const [image1, setImage1] = useState(null);
    const [image2, setImage2] = useState(null);
    const [image1Preview, setImage1Preview] = useState(null);
    const [image2Preview, setImage2Preview] = useState(null);
    const [alpha, setAlpha] = useState(0.5);
    const [outpaint1, setOutpaint1] = useState(false);
    const [outpaint2, setOutpaint2] = useState(false);

    const [isGenerating, setIsGenerating] = useState(false);
    const [isRefining, setIsRefining] = useState(false);
    const [resultUrl, setResultUrl] = useState(null);
    const [refinedUrl, setRefinedUrl] = useState(null);
    const [frames, setFrames] = useState([]);
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState('');
    const [error, setError] = useState(null);

    React.useEffect(() => {
        const loadInitialImage = async () => {
            if (initialImage1Url) {
                try {
                    const res = await fetch(initialImage1Url);
                    const blob = await res.blob();
                    const file = new File([blob], 'subject.png', { type: blob.type });
                    handleImageUpload(file, 1);
                } catch (err) {
                    console.error('Failed to load initial image for stylebend:', err);
                }
            }
        };
        loadInitialImage();
    }, [initialImage1Url]); // Only run on mount or when url changes

    const handleImageUpload = (file, num) => {
        if (!file) return;
        const url = URL.createObjectURL(file);
        if (num === 1) {
            setImage1(file);
            setImage1Preview(url);
            setResultUrl(null);
            setFrames([]);
        } else {
            setImage2(file);
            setImage2Preview(url);
            setResultUrl(null);
            setFrames([]);
        }
    };

    const handleGenerate = async () => {
        if (!image1 || !image2) {
            setError('Please upload both images to blend.');
            return;
        }
        setError(null);
        setIsGenerating(true);
        setResultUrl(null);
        setFrames([]);

        try {
            // Simulated progress for Stylebend
            const simulateProgress = () => {
                setProgress(0);
                setStatus('Analyzing images...');
                
                const interval = setInterval(() => {
                    setProgress(prev => {
                        if (prev >= 90) {
                            clearInterval(interval);
                            return 90;
                        }
                        if (prev < 20) {
                            setStatus('Projecting into StyleGAN space...');
                            return prev + 1;
                        } else if (prev < 60) {
                            setStatus('Optimizing latent vectors (this takes time)...');
                            return prev + 0.5;
                        } else {
                            setStatus('Generating blended frames...');
                            return prev + 0.2;
                        }
                    });
                }, 500);
                return interval;
            };

            const progressInterval = simulateProgress();
            const allFrames = await blendStyles(image1, image2, alpha, outpaint1, outpaint2);
            clearInterval(progressInterval);
            
            setProgress(100);
            setStatus('Done!');
            
            setFrames(allFrames);
            const idx = Math.round(alpha * 20);
            setResultUrl(allFrames[Math.min(idx, allFrames.length - 1)]);
        } catch (err) {
            console.error('Generation failed:', err);
            setError(err.message || 'An error occurred during blending.');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleApply = async () => {
        if (!resultUrl || !onApply) return;

        setIsRefining(true);
        setStatus('Refining with Stable Diffusion...');
        try {
            // Fetch the current result (base64 data URL) and convert to a blob
            const res = await fetch(resultUrl);
            const blob = await res.blob();

            const formData = new FormData();
            formData.append('image', blob, 'stylebend_result.png');
            formData.append('strength', '0.35');

            const refineRes = await fetch(`${API_BASE}/refine-stylebend`, {
                method: 'POST',
                headers: NGROK_HEADERS,
                body: formData,
            });

            if (!refineRes.ok) {
                throw new Error(`Refinement failed: ${refineRes.status}`);
            }

            const refinedBlob = await refineRes.blob();
            const refinedObjectUrl = URL.createObjectURL(refinedBlob);
            setRefinedUrl(refinedObjectUrl);

            // Apply the refined result to the canvas
            onApply(refinedObjectUrl);
            onClose();
        } catch (err) {
            console.error('Refinement failed, applying unrefined result:', err);
            // Fallback: apply original StyleGAN result without refinement
            onApply(resultUrl);
            onClose();
        } finally {
            setIsRefining(false);
        }
    };

    const UploadBox = ({ num, preview, label }) => (
        <div style={{
            flex: 1, border: '2px dashed #d1d5db', borderRadius: '12px',
            padding: '1.5rem', textAlign: 'center', background: '#f9fafb'
        }}>
            <h4 style={{ color: '#374151', marginBottom: '12px' }}>{label}</h4>
            {preview ? (
                <div style={{ position: 'relative' }}>
                    <img
                        src={preview}
                        alt={label}
                        style={{ width: '100%', maxHeight: '220px', objectFit: 'contain', borderRadius: '4px' }}
                    />
                    <button
                        onClick={() => {
                            if (num === 1) { setImage1(null); setImage1Preview(null); }
                            else { setImage2(null); setImage2Preview(null); }
                            setResultUrl(null); setFrames([]);
                        }}
                        style={{
                            position: 'absolute', top: 5, right: 5,
                            background: 'rgba(255,255,255,0.85)', border: 'none',
                            color: '#ef4444', borderRadius: '4px', cursor: 'pointer',
                            padding: '4px', display: 'flex'
                        }}
                    ><X size={16} /></button>
                </div>
            ) : (
                <div>
                    <label
                        htmlFor={`styleUpload${num}`}
                        style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#6b7280' }}
                    >
                        <ImagePlus size={36} style={{ marginBottom: '0.5rem', color: '#8b5cf6' }} />
                        <span style={{ fontSize: '14px', fontWeight: '500' }}>Click to Upload</span>
                        <span style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>Any aspect ratio accepted</span>
                    </label>
                    <input
                        type="file"
                        id={`styleUpload${num}`}
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => handleImageUpload(e.target.files[0], num)}
                    />
                </div>
            )}
            <label style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: '6px', marginTop: '12px', fontSize: '12px', color: '#6b7280', cursor: 'pointer'
            }}>
                <input
                    type="checkbox"
                    checked={num === 1 ? outpaint1 : outpaint2}
                    onChange={e => num === 1 ? setOutpaint1(e.target.checked) : setOutpaint2(e.target.checked)}
                />
                Normalize background
            </label>
            <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                Removes background, places on white canvas for best StyleGAN results
            </p>
        </div>
    );

    return (
        <div className="clothify-modal-overlay">
            <div className="clothify-modal" style={{ maxWidth: '820px' }}>
                <div className="clothify-modal-header">
                    <div className="clothify-modal-title">Stylebend — Fashion Blending</div>
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

                    {/* Upload Row */}
                    <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                        <UploadBox num={1} preview={image1Preview} label="Subject Image" />
                        <UploadBox num={2} preview={image2Preview} label="Style Image" />
                    </div>

                    {/* Slider */}
                    <div className="clothify-setting-group">
                        <label className="clothify-setting-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <SlidersHorizontal size={16} /> Blend Alpha: {Math.round(alpha * 100)}%
                        </label>
                        <div className="clothify-slider">
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={alpha}
                                onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    setAlpha(val);
                                    if (frames.length > 0) {
                                        const idx = Math.round(val * 20);
                                        setResultUrl(frames[Math.min(idx, frames.length - 1)]);
                                    }
                                }}
                                disabled={isGenerating}
                            />
                            <div className="clothify-slider-value" style={{ display: 'flex', justifyContent: 'space-between', padding: '0 4px' }}>
                                <span>Subject</span>
                                <span>Equal Blend</span>
                                <span>Style</span>
                            </div>
                        </div>
                    </div>

                    {/* Loading */}
                    {isGenerating && (
                        <div className="clothify-preview-container" style={{ marginTop: '1.5rem', minHeight: '150px' }}>
                            <div className="clothify-loading">
                                <div className="progress-container">
                                    <div className="progress-header">
                                        <span>{status || 'Blending styles...'}</span>
                                        <span className="progress-percentage">{Math.round(progress)}%</span>
                                    </div>
                                    <div className="progress-track">
                                        <div 
                                            className="progress-bar" 
                                            style={{ width: `${progress}%` }}
                                        ></div>
                                    </div>
                                    <div className="progress-status">
                                        Inversion takes a few minutes on CPU...
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Result */}
                    {resultUrl && !isGenerating && (
                        <div style={{
                            marginTop: '1.5rem', height: '550px', display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            background: '#ffffff', border: '1px solid #e5e7eb',
                            borderRadius: '8px', overflow: 'hidden'
                        }}>
                            <img
                                src={resultUrl}
                                alt="Blended Result"
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
                        disabled={isGenerating || !image1 || !image2}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            background: 'var(--btn-purple)',
                            opacity: (isGenerating || !image1 || !image2) ? 0.5 : 1
                        }}
                    >
                        <Sparkles size={16} /> {resultUrl ? 'Re-Blend' : 'Blend'}
                    </button>
                    {resultUrl && !isGenerating && (
                        <button
                            className="clothify-footer-btn clothify-footer-btn-ok"
                            onClick={handleApply}
                            disabled={isRefining}
                            style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: isRefining ? 0.7 : 1 }}
                        >
                            {isRefining ? (
                                <>
                                    <Wand2 size={16} className="spin" />
                                    Refining...
                                </>
                            ) : (
                                <>
                                    <Wand2 size={16} />
                                    Refine & Apply
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StylebendModal;
