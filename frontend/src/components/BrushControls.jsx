/**
 * BrushControls — floating panel for brush/eraser size.
 *
 * Shown/hidden by the `visible` prop (CSS class toggle) so it stays mounted
 * and doesn't reset the slider value on tool switch.
 * `toolName` is used as the label so the panel reads "Eraser Size" for the
 * eraser tool and "Brush Size" for the brush tool.
 * The preview dot is capped at 50 px so it stays inside the panel regardless
 * of brushSize (which can go up to 100 canvas pixels).
 */
import React from 'react';
import './BrushControls.css';

const BrushControls = ({ brushSize, onBrushSizeChange, brushColor, visible, toolName = 'Brush' }) => {
    return (
        <div className={`brush-controls-panel ${visible ? 'visible' : ''}`}>
            <div className="brush-control-group">
                <div className="brush-control-label">
                    <span>{toolName} Size</span>
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
