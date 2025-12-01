import React, { useState, useRef } from 'react';
import { extractDominantColors } from '../utils/imageProcessing';
import './MoodboardModal.css';

const MoodboardModal = ({ onClose, onApply }) => {
    const [image, setImage] = useState(null);
    const [colors, setColors] = useState([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const fileInputRef = useRef(null);

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            setIsProcessing(true);
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    setImage(img.src);
                    // Extract colors
                    const extracted = extractDominantColors(img, 4);
                    setColors(extracted);
                    setIsProcessing(false);
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    };

    return (
        <div className="moodboard-overlay">
            <div className="moodboard-content">
                <div className="moodboard-header">
                    <h2>🎨 Moodboard Extractor</h2>
                    <button className="moodboard-close-btn" onClick={onClose}>×</button>
                </div>

                <div className="moodboard-body">
                    <div
                        className="moodboard-upload-area"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        {image ? (
                            <img
                                src={image}
                                alt="Moodboard"
                                className="moodboard-preview-img"
                            />
                        ) : (
                            <div className="moodboard-upload-placeholder">
                                <span className="moodboard-icon">📁</span>
                                <div>Click to upload an image</div>
                                <div className="moodboard-hint">
                                    We'll extract the top 4 colors for you
                                </div>
                            </div>
                        )}
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleImageUpload}
                            accept="image/*"
                            style={{ display: 'none' }}
                        />
                    </div>

                    {isProcessing && (
                        <div style={{ textAlign: 'center', padding: '1rem', color: '#6b7280' }}>
                            Extracting colors...
                        </div>
                    )}

                    {colors.length > 0 && (
                        <div className="moodboard-palette-section">
                            <div className="moodboard-section-title">Extracted Palette</div>
                            <div className="moodboard-palette">
                                {colors.map((color, index) => (
                                    <div
                                        key={index}
                                        className="moodboard-swatch-container"
                                        style={{ animationDelay: `${index * 0.1}s` }}
                                    >
                                        <div
                                            className="moodboard-swatch"
                                            style={{ backgroundColor: color }}
                                        />
                                        <div className="moodboard-color-code">{color}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="moodboard-footer">
                    <button className="moodboard-btn moodboard-btn-secondary" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        className="moodboard-btn moodboard-btn-primary"
                        onClick={() => onApply(colors)}
                        disabled={colors.length === 0}
                    >
                        Apply to Palette
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MoodboardModal;
