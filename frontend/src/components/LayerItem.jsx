import React, { useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Eye, EyeOff, Lock, Unlock, Trash2, Sparkles, Edit, Copy, Grid3x3, Image as ImageIcon, Palette } from 'lucide-react';
import './LayersPanel.css';

const LayerItem = ({
    layer,
    isActive,
    onSelect,
    onToggleVisibility,
    onToggleLock,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    onRename,
    onDuplicate,
    onDelete,
    onClothify,
    onPatternMaker,
    onStylebend
}) => {
    const [showContextMenu, setShowContextMenu] = useState(false);
    const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [isRenaming, setIsRenaming] = useState(false);
    const [nameValue, setNameValue] = useState(layer.name);
    const renameInputRef = useRef(null);

    React.useEffect(() => {
        if (!isRenaming) {
            setNameValue(layer.name);
        }
    }, [layer.name, isRenaming]);

    React.useEffect(() => {
        if (!isRenaming) return;
        const tid = setTimeout(() => renameInputRef.current?.focus(), 0);
        return () => clearTimeout(tid);
    }, [isRenaming]);

    const handleContextMenu = (e) => {
        e.preventDefault();
        setContextMenuPos({ x: e.clientX, y: e.clientY });
        setShowContextMenu(true);
    };

    const handleClothify = () => {
        setShowContextMenu(false);
        onClothify(layer);
    };

    const handleDelete = () => {
        setShowContextMenu(false);
        onDelete(layer.id);
    };

    const startRename = () => {
        setShowContextMenu(false);
        setIsRenaming(true);
        setNameValue(layer.name);
    };

    const commitRename = () => {
        const trimmed = (nameValue || '').trim();
        if (trimmed && trimmed !== layer.name) {
            onRename && onRename(layer.id, trimmed);
        }
        setNameValue(trimmed || layer.name);
        setIsRenaming(false);
    };

    const cancelRename = () => {
        setNameValue(layer.name);
        setIsRenaming(false);
    };

    React.useEffect(() => {
        const handleClickOutside = (e) => {
            // Close unless the click is inside the context menu itself
            if (!e.target.closest('.layer-context-menu')) {
                setShowContextMenu(false);
            }
        };
        if (showContextMenu) {
            // Use mousedown so it fires before click handlers and closes reliably
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [showContextMenu]);

    return (
        <>
            <div
                className={`layer-item ${isActive ? 'active' : ''} ${layer.locked ? 'locked' : ''} ${isDragging ? 'dragging' : ''}`}
                onClick={() => onSelect(layer.id)}
                onContextMenu={handleContextMenu}
                draggable={layer.type !== 'reference'}
                onDragStart={(e) => {
                    if (layer.type === 'reference') return;
                    e.dataTransfer.effectAllowed = 'move';
                    setIsDragging(true);
                    onDragStart(layer.id);
                }}
                onDragOver={(e) => {
                    if (layer.type === 'reference') return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    onDragOver(layer.id);
                }}
                onDrop={(e) => {
                    if (layer.type === 'reference') return;
                    e.preventDefault();
                    onDrop(layer.id);
                }}
                onDragEnd={() => {
                    setIsDragging(false);
                    onDragEnd();
                }}
            >
                {layer.type !== 'reference' && (
                    <button
                        className="layer-clothify-btn"
                        onClick={(e) => {
                            e.stopPropagation();
                            onClothify(layer);
                        }}
                        title="Clothify this layer"
                    >
                        <Sparkles size={14} />
                    </button>
                )}
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
                    {isRenaming ? (
                        <input
                            ref={renameInputRef}
                            className="layer-name-input"
                            value={nameValue}
                            maxLength={80}
                            onChange={(e) => setNameValue(e.target.value)}
                            onBlur={commitRename}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    commitRename();
                                }
                                if (e.key === 'Escape') {
                                    e.preventDefault();
                                    cancelRename();
                                }
                                e.stopPropagation();
                            }}
                        />
                    ) : (
                        <div className="layer-name">{layer.name}</div>
                    )}
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

            {showContextMenu && ReactDOM.createPortal(
                <div
                    className="layer-context-menu"
                    style={{
                        position: 'fixed',
                        left: `${contextMenuPos.x}px`,
                        top: `${contextMenuPos.y}px`,
                    }}
                >
                    {layer.type === 'reference' ? (
                        <>
                            <div className="layer-context-menu-item clothify" onClick={() => {
                                setShowContextMenu(false);
                                onStylebend && onStylebend(layer);
                            }}>
                                <Sparkles size={16} /> Stylebend Reference
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="layer-context-menu-item clothify" onClick={handleClothify}>
                                <Sparkles size={16} /> Clothify
                            </div>
                            <div className="layer-context-menu-divider" />
                            <div className="layer-context-menu-item" onClick={startRename}>
                                <Edit size={16} /> Rename
                            </div>
                            <div className="layer-context-menu-item" onClick={() => {
                                setShowContextMenu(false);
                                onDuplicate && onDuplicate(layer.id);
                            }}>
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
                        </>
                    )}
                </div>,
                document.body
            )}
        </>
    );
};

export default LayerItem;
