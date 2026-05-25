/**
 * LayerItem — a single row in the layers panel.
 *
 * Renders the layer thumbnail, name (editable inline), type badge,
 * visibility/lock/delete controls, and a context menu with AI actions.
 *
 * Context menu contents differ by layer type:
 *   drawing  — Clothify, Rename, Duplicate, Pattern Maker, Merge Down, Delete
 *   reference — Text to Clothes, Stylebend Reference, Convert to Doodle
 *
 * The context menu is rendered via ReactDOM.createPortal into document.body
 * so it is not clipped by the layers panel's overflow:hidden container.
 * A mousedown listener on the document closes it when the user clicks outside.
 *
 * Inline rename: double-click the layer name (via context menu → Rename)
 * to switch to an input. Enter or blur commits; Escape cancels.
 */
import React, { useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Eye, EyeOff, Lock, Unlock, Trash2, Sparkles, Edit, Copy, Grid3x3, Image as ImageIcon, Palette, Wand2, PenLine, ArrowDownToLine } from 'lucide-react';
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
    onStylebend,
    onTextToClothes,
    onExtractDoodle,
    onMergeDown,
    canMergeDown,
}) => {
    const [showContextMenu, setShowContextMenu] = useState(false);
    const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [isRenaming, setIsRenaming] = useState(false);
    const [nameValue, setNameValue] = useState(layer.name);
    const renameInputRef = useRef(null);

    // Keep the displayed name in sync when the layer is renamed externally
    // (e.g. via handleApplyClothify which sets the layer name programmatically).
    React.useEffect(() => {
        if (!isRenaming) {
            setNameValue(layer.name);
        }
    }, [layer.name, isRenaming]);

    // Auto-focus the rename input after it mounts. setTimeout(0) defers focus
    // until after React finishes the render that made the input visible.
    React.useEffect(() => {
        if (!isRenaming) return;
        const tid = setTimeout(() => renameInputRef.current?.focus(), 0);
        return () => clearTimeout(tid);
    }, [isRenaming]);

    const handleContextMenu = (e) => {
        e.preventDefault();
        // Store the cursor position so the portal-rendered menu appears exactly
        // where the user right-clicked, regardless of scroll or layout.
        setContextMenuPos({ x: e.clientX, y: e.clientY });
        setShowContextMenu(true);
    };

    const handleClothify = () => {
        // Close the menu before opening the modal so they don't overlap.
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
        // Pre-fill the input with the current name so the user can edit in place.
        setNameValue(layer.name);
    };

    const commitRename = () => {
        const trimmed = (nameValue || '').trim();
        // Only fire the rename callback if the name actually changed.
        if (trimmed && trimmed !== layer.name) {
            onRename && onRename(layer.id, trimmed);
        }
        // If the user cleared the field, revert to the original name.
        setNameValue(trimmed || layer.name);
        setIsRenaming(false);
    };

    const cancelRename = () => {
        // Discard edits and restore the original name without calling onRename.
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
                    onDragOver(layer.id, e);
                }}
                onDrop={(e) => {
                    if (layer.type === 'reference') return;
                    e.preventDefault();
                    onDrop(layer.id, e);
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
                                onTextToClothes && onTextToClothes(layer);
                            }}>
                                <Wand2 size={16} /> Text to Clothes
                            </div>
                            <div className="layer-context-menu-divider" />
                            <div className="layer-context-menu-item clothify" onClick={() => {
                                setShowContextMenu(false);
                                onStylebend && onStylebend(layer);
                            }}>
                                <Sparkles size={16} /> Stylebend Reference
                            </div>
                            <div className="layer-context-menu-divider" />
                            <div className="layer-context-menu-item clothify" onClick={() => {
                                setShowContextMenu(false);
                                onExtractDoodle && onExtractDoodle(layer);
                            }}>
                                <PenLine size={16} /> Convert to Doodle
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
                            {canMergeDown && (
                                <>
                                    <div className="layer-context-menu-divider" />
                                    <div className="layer-context-menu-item" onClick={() => {
                                        setShowContextMenu(false);
                                        onMergeDown && onMergeDown(layer.id);
                                    }}>
                                        <ArrowDownToLine size={16} /> Merge Down
                                    </div>
                                </>
                            )}
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
