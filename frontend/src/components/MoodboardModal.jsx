import React, { useState, useRef } from 'react';
import { extractDominantColors, suggestColors, blobToImage } from '../utils/imageProcessing';
import { 
    Sparkles, 
    Upload, 
    MousePointerClick, 
    Wand2, 
    ImagePlus, 
    Palette, 
    X, 
    Check, 
    Info,
    RefreshCw
} from 'lucide-react';
import './MoodboardModal.css';

const MoodboardModal = ({ onClose, onApply }) => {
    const [image, setImage] = useState(null);       // Only set for uploaded images
    const [colors, setColors] = useState([]);
    const [prompt, setPrompt] = useState('');
    const [status, setStatus] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [activeOption, setActiveOption] = useState(null); // 'upload' or 'ai'
    const [aiDone, setAiDone] = useState(false);    // True after successful AI generation
    const fileInputRef = useRef(null);

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            setActiveOption('upload');
            processImageFile(file);
        }
    };

    const processImageFile = (file) => {
        setIsProcessing(true);
        setStatus('Extrapolating color data...');
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                setImage(img.src);
                const extracted = extractDominantColors(img, 4);
                setColors(extracted);
                setIsProcessing(false);
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    };

    const handleAISuggest = async () => {
        if (!prompt) return;
        setActiveOption('ai');
        setAiDone(false);
        setImage(null);   // Clear any previous upload preview
        setColors([]);
        setIsProcessing(true);
        setStatus('AI is analyzing the aesthetic...');
        try {
            const blob = await suggestColors(prompt);
            setStatus('Distilling palette...');
            
            // Use blob only for color extraction — DO NOT show the raw palette strip PNG
            const img = await blobToImage(blob);
            const extracted = extractDominantColors(img, 4);
            setColors(extracted);
            setAiDone(true);
        } catch (error) {
            console.error('AI Suggestion failed:', error);
            alert('AI color suggestion failed. Please try again.');
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="moodboard-overlay">
            <div className="moodboard-content">
                <div className="moodboard-header">
                    <h2>
                        <Palette className="header-icon" size={24} />
                        Moodboard Extractor
                    </h2>
                    <button className="moodboard-close-btn" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="moodboard-body">
                    {/* LEFT: SOURCE SELECTION */}
                    <div className="moodboard-sources">
                        <div className="section-title">Select Source</div>
                        
                        {/* Option 1: Upload */}
                        <div 
                            className={`moodboard-option-card ${activeOption === 'upload' ? 'active' : ''}`}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <div className="option-header">
                                <div className="option-icon-box">
                                    <Upload size={20} />
                                </div>
                                <div className="option-info">
                                    <h3>From Image</h3>
                                    <p>Extract from existing photos</p>
                                </div>
                            </div>
                            <div className="upload-dropzone">
                                <ImagePlus size={24} />
                                <span>Click to select file</span>
                            </div>
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleImageUpload}
                                accept="image/*"
                                style={{ display: 'none' }}
                            />
                        </div>

                        {/* Option 2: AI Suggestion */}
                        <div className={`moodboard-option-card ${activeOption === 'ai' ? 'active' : ''}`}>
                            <div className="option-header">
                                <div className="option-icon-box">
                                    <Sparkles size={20} />
                                </div>
                                <div className="option-info">
                                    <h3>AI Dreamer</h3>
                                    <p>Generate vibes from text</p>
                                </div>
                            </div>
                            <div className="ai-input-container">
                                <input
                                    type="text"
                                    className="moodboard-ai-input-v3"
                                    placeholder="e.g. Cyberpunk Neon..."
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleAISuggest()}
                                />
                                <button 
                                    className="ai-generate-btn"
                                    onClick={handleAISuggest}
                                    disabled={isProcessing || !prompt}
                                >
                                    {isProcessing && activeOption === 'ai' ? 
                                        <RefreshCw className="spin" size={18} /> : 
                                        <Wand2 size={18} />
                                    }
                                </button>
                            </div>
                        </div>

                        <div className="info-tip">
                            <Info size={14} />
                            <span>Select an image or prompt AI to begin analysis.</span>
                        </div>
                    </div>

                    {/* RIGHT: ANALYSIS RESULTS */}
                    <div className="moodboard-results">
                        <div className="section-title">Analysis & Palette</div>
                        
                        <div className="preview-container">
                            {/* Uploaded image — show the actual photo */}
                            {activeOption === 'upload' && image && (
                                <div style={{ position: 'relative' }}>
                                    <img src={image} alt="Source" className="main-preview-v2" />
                                    {isProcessing && (
                                        <div className="loading-overlay">
                                            <div className="moodboard-spinner-v2"></div>
                                            <span>{status}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* AI processing spinner */}
                            {activeOption === 'ai' && isProcessing && (
                                <div className="empty-state">
                                    <div className="moodboard-spinner-v2" style={{ margin: '0 auto 12px' }}></div>
                                    <p>{status}</p>
                                </div>
                            )}

                            {/* AI success — show a clean generated badge instead of raw PNG */}
                            {activeOption === 'ai' && aiDone && !isProcessing && (
                                <div className="empty-state" style={{ gap: '8px' }}>
                                    <Sparkles size={40} style={{ color: 'var(--accent, #7c3aed)', opacity: 0.85 }} />
                                    <p style={{ fontWeight: 600, margin: 0 }}>Palette generated for</p>
                                    <p style={{ color: 'var(--accent, #7c3aed)', fontWeight: 700, margin: 0, fontSize: '1rem' }}>"{prompt}"</p>
                                </div>
                            )}

                            {/* Default empty state */}
                            {!activeOption && (
                                <div className="empty-state">
                                    <MousePointerClick size={48} className="pulse-icon" />
                                    <p>Choose a source on the left to extract its color profile</p>
                                </div>
                            )}
                        </div>

                        {colors.length > 0 && (
                            <div className="palette-container">
                                <div className="palette-title">
                                    <Check size={16} className="text-green-500" />
                                    Identified Palette
                                </div>
                                <div className="palette-grid-v2">
                                    {colors.map((color, index) => (
                                        <div 
                                            key={index} 
                                            className="palette-card"
                                            style={{ animationDelay: `${index * 0.1}s` }}
                                        >
                                            <div
                                                className="color-swatch"
                                                style={{ backgroundColor: color }}
                                            />
                                            <span className="hex-label">{color.toUpperCase()}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="moodboard-footer">
                    <button className="btn-secondary-v2" onClick={onClose}>
                        Discard
                    </button>
                    <button
                        className="btn-primary-v2"
                        onClick={() => onApply(colors)}
                        disabled={colors.length === 0 || isProcessing}
                    >
                        Apply to Design
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MoodboardModal;
