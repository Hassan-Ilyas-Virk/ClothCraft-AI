import React, { useState } from 'react';
import { Eye, EyeOff, Lock, Unlock, Trash2, Sparkles, Edit, Copy, Grid3x3, Image as ImageIcon, Palette } from 'lucide-react';
import './LayersPanel.css';

const LayerItem = ({
    layer,
    isActive,
    onSelect,
    onToggleVisibility,
    onToggleLock,
    onDelete,
    onClothify,
    onPatternMaker
}) => {
    const [showContextMenu, setShowContextMenu] = useState(false);
    const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });

    const handleContextMenu = (e) => {
        e.preventDefault();
        if (layer.type === 'drawing') {
            setContextMenuPos({ x: e.clientX, y: e.clientY });
            setShowContextMenu(true);
        }
    };

    const handleClothify = () => {
        setShowContextMenu(false);
        onClothify(layer);
    };

    const handleDelete = () => {
        setShowContextMenu(false);
        onDelete(layer.id);
    };

    React.useEffect(() => {
        const handleClickOutside = () => setShowContextMenu(false);
        if (showContextMenu) {
            document.addEventListener('click', handleClickOutside);
            return () => document.removeEventListener('click', handleClickOutside);
        }
    }, [showContextMenu]);

    return (
        <>
            <div
                className={`layer-item ${isActive ? 'active' : ''} ${layer.locked ? 'locked' : ''}`}
                onClick={() => onSelect(layer.id)}
                onContextMenu={handleContextMenu}
            >
                <div className="layer-thumbnail">
                    {layer.thumbnail ? (
                        <img src={layer.thumbnail} alt={layer.name} />
                    ) : (
                        <span className="layer-thumbnail-placeholder">
                            {layer.type === 'reference' ? <ImageIcon size={24} /> : <Palette size={24} />}
                        </span>
                    )}
                </div>

                <div className="layer-info">
                    <div className="layer-name">{layer.name}</div>
                    <div className="layer-type">{layer.type}</div>
                </div>

                <div className="layer-controls">
                    <button
                        className={`layer-control-btn ${layer.visible ? 'active' : ''}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleVisibility(layer.id);
                        }}
                        title={layer.visible ? 'Hide layer' : 'Show layer'}
                    >
                        {layer.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                    </button>

                    <button
                        className={`layer-control-btn ${layer.locked ? 'active' : ''}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleLock(layer.id);
                        }}
                        title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                    >
                        {layer.locked ? <Lock size={16} /> : <Unlock size={16} />}
                    </button>

                    {layer.type !== 'reference' && (
                        <button
                            className="layer-control-btn delete"
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete(layer.id);
                            }}
                            title="Delete layer"
                        >
                            <Trash2 size={16} />
                        </button>
                    )}
                </div>
            </div>

            {showContextMenu && (
                <div
                    className="layer-context-menu"
                    style={{
                        position: 'fixed',
                        left: `${contextMenuPos.x}px`,
                        top: `${contextMenuPos.y}px`,
                    }}
                >
                    <div className="layer-context-menu-item clothify" onClick={handleClothify}>
                        <Sparkles size={16} /> Clothify
                    </div>
                    <div className="layer-context-menu-divider" />
                    <div className="layer-context-menu-item" onClick={() => setShowContextMenu(false)}>
                        <Edit size={16} /> Rename
                    </div>
                    <div className="layer-context-menu-item" onClick={() => setShowContextMenu(false)}>
                        <Copy size={16} /> Duplicate
                    </div>
                    <div className="layer-context-menu-item" onClick={() => {
                        setShowContextMenu(false);
                        onPatternMaker && onPatternMaker(layer);
                    }}>
                        <Grid3x3 size={16} /> Pattern Maker
                    </div>
                    <div className="layer-context-menu-divider" />
                    <div className="layer-context-menu-item" onClick={handleDelete}>
                        <Trash2 size={16} /> Delete
                    </div>
                </div>
            )}
        </>
    );
};

export default LayerItem;
