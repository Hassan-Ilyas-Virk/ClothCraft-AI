import React from 'react';
import {
    Paintbrush,
    Eraser,
    Hand,
    BoxSelect,
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
        { id: 'brush',        icon: Paintbrush,          label: 'Brush',     hint: 'Drag to paint' },
        { id: 'eraser',       icon: Eraser,              label: 'Eraser',    hint: 'Drag to erase pixels' },
        { id: 'pan',          icon: Hand,                label: 'Pan',       hint: 'Drag to pan; or hold Space' },
        { id: 'select',       icon: BoxSelect,           label: 'Select',    hint: 'Drag a marquee — Delete cuts selection, Esc commits float' },
        { id: 'lasso',        icon: Lasso,               label: 'Lasso',     hint: 'Freehand selection — Delete cuts selection, Esc deselects' },
        { id: 'shape-rect',   icon: RectangleHorizontal, label: 'Rectangle', hint: 'Drag to stroke a rectangle' },
        { id: 'shape-circle', icon: Circle,              label: 'Circle',    hint: 'Drag to stroke an ellipse' },
        { id: 'text',         icon: Type,                label: 'Text',      hint: 'Click canvas, type, then Enter to stamp' },
        { id: 'transform',    icon: Move,                label: 'Transform', hint: 'Drag to move layer; drag corner handles to scale' },
        { id: 'zoom',         icon: ZoomIn,              label: 'Zoom',      hint: 'Click = zoom in, Shift+click = zoom out, Ctrl+scroll = zoom' },
    ];

    const activeToolObj = tools.find(t => t.id === activeTool);

    return (
        <>
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

        {activeToolObj?.hint && (
            <div className="toolbar-hint-bar">
                <span className="toolbar-hint-label">{activeToolObj.label}</span>
                {activeToolObj.hint}
            </div>
        )}
        </>
    );
};

export default Toolbar;
