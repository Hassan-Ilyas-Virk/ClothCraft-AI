import React from 'react';
import {
    Paintbrush,
    Eraser,
    Hand,
    Square,
    Lasso,
    RectangleHorizontal,
    Circle,
    Type,
    Move,
    ZoomIn,
    Palette
} from 'lucide-react';
import './Toolbar.css';

const Toolbar = ({ activeTool, onToolChange, brushColor, onColorChange, moodboardColors, onOpenMoodboard, disabled }) => {
    const tools = [
        { id: 'brush', icon: Paintbrush, label: 'Brush' },
        { id: 'eraser', icon: Eraser, label: 'Eraser' },
        { id: 'pan', icon: Hand, label: 'Pan' },
        { id: 'select', icon: Square, label: 'Select' },
        { id: 'lasso', icon: Lasso, label: 'Lasso' },
        { id: 'shape-rect', icon: RectangleHorizontal, label: 'Rectangle' },
        { id: 'shape-circle', icon: Circle, label: 'Circle' },
        { id: 'text', icon: Type, label: 'Text' },
        { id: 'transform', icon: Move, label: 'Transform' },
        { id: 'zoom', icon: ZoomIn, label: 'Zoom' },
    ];

    return (
        <div className="toolbar">
            {tools.map((tool, index) => {
                const IconComponent = tool.icon;
                return (
                    <React.Fragment key={tool.id}>
                        <button
                            className={`toolbar-tool ${activeTool === tool.id ? 'active' : ''}`}
                            onClick={() => onToolChange(tool.id)}
                            disabled={disabled}
                            title={tool.label}
                        >
                            <IconComponent size={20} strokeWidth={2} />
                            <span className="toolbar-tool-tooltip">{tool.label}</span>
                        </button>
                        {(index === 2 || index === 6) && <div className="toolbar-divider" />}
                    </React.Fragment>
                );
            })}

            <div className="toolbar-color-section">
                <div
                    className="toolbar-moodboard-btn"
                    onClick={onOpenMoodboard}
                    title="Open Moodboard Color Extractor"
                >
                    <Palette size={18} strokeWidth={2} />
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
