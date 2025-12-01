import React from 'react';
import './Toolbar.css';

const Toolbar = ({ activeTool, onToolChange, brushColor, onColorChange, moodboardColors, onOpenMoodboard, disabled }) => {
    const tools = [
        { id: 'brush', icon: '🖌️', label: 'Brush' },
        { id: 'eraser', icon: '🧹', label: 'Eraser' },
        { id: 'pan', icon: '✋', label: 'Pan' },
        { id: 'select', icon: '⬚', label: 'Select' },
        { id: 'lasso', icon: '🔗', label: 'Lasso' },
        { id: 'shape-rect', icon: '▭', label: 'Rectangle' },
        { id: 'shape-circle', icon: '○', label: 'Circle' },
        { id: 'text', icon: 'T', label: 'Text' },
        { id: 'transform', icon: '⤡', label: 'Transform' },
        { id: 'zoom', icon: '🔍', label: 'Zoom' },
    ];

    return (
        <div className="toolbar">
            {tools.map((tool, index) => (
                <React.Fragment key={tool.id}>
                    <button
                        className={`toolbar-tool ${activeTool === tool.id ? 'active' : ''}`}
                        onClick={() => onToolChange(tool.id)}
                        disabled={disabled}
                        title={tool.label}
                    >
                        {tool.icon}
                        <span className="toolbar-tool-tooltip">{tool.label}</span>
                    </button>
                    {(index === 2 || index === 6) && <div className="toolbar-divider" />}
                </React.Fragment>
            ))}

            <div className="toolbar-color-section">
                <div
                    className="toolbar-moodboard-btn"
                    onClick={onOpenMoodboard}
                    title="Open Moodboard Color Extractor"
                >
                    🎨
                </div>
                <div className="toolbar-color-picker" title="Color">
                    <input
                        type="color"
                        value={brushColor}
                        onChange={(e) => onColorChange(e.target.value)}
                        disabled={disabled}
                    />
                </div>
            </div>

            {moodboardColors && moodboardColors.length > 0 && (
                <div className="toolbar-palette">
                    {moodboardColors.map((color, index) => (
                        <div
                            key={index}
                            className="toolbar-swatch"
                            style={{ backgroundColor: color }}
                            onClick={() => onColorChange(color)}
                            title={color}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default Toolbar;
