import React from 'react';
import './BrushControls.css';

const BrushControls = ({ brushSize, onBrushSizeChange, brushColor, visible }) => {
    return (
        <div className={`brush-controls-panel ${visible ? 'visible' : ''}`}>
            <div className="brush-control-group">
                <div className="brush-control-label">
                    <span>Brush Size</span>
                    <span className="brush-control-value">{brushSize}px</span>
                </div>
                <div className="brush-size-slider">
                    <input
                        type="range"
                        min="1"
                        max="100"
                        value={brushSize}
                        onChange={(e) => onBrushSizeChange(parseInt(e.target.value))}
                    />
                </div>
            </div>

            <div className="brush-control-group">
                <div className="brush-control-label">
                    <span>Preview</span>
                </div>
                <div className="brush-preview">
                    <div
                        className="brush-preview-dot"
                        style={{
                            width: `${Math.min(brushSize, 50)}px`,
                            height: `${Math.min(brushSize, 50)}px`,
                            backgroundColor: brushColor,
                        }}
                    />
                </div>
            </div>
        </div>
    );
};

export default BrushControls;
