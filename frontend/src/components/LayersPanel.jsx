import React, { useState } from 'react';
import { Plus, Minimize2, Maximize2 } from 'lucide-react';
import LayerItem from './LayerItem';
import './LayersPanel.css';

const LayersPanel = ({
    layers,
    activeLayerId,
    onLayerSelect,
    onAddLayer,
    onToggleVisibility,
    onToggleLock,
    onReorderLayers,
    onDuplicateLayer,
    onDeleteLayer,
    onClothify,
    onPatternMaker,
    onUpdateLayer,
    onStylebend,
    onStylebendFromLayer,
    onGenerateHuman
}) => {
    const [isMinimized, setIsMinimized] = useState(false);
    const [draggedLayerId, setDraggedLayerId] = useState(null);
    const [dragOverGapIndex, setDragOverGapIndex] = useState(null);

    const activeLayer = layers.find(l => l.id === activeLayerId);
    const referenceLayer = layers.find(l => l.type === 'reference');
    const drawingLayers = layers.filter(l => l.type !== 'reference');
    const drawingLayersTopDown = [...drawingLayers].reverse();
    const handleLayerDragStart = (layerId) => {
        setDraggedLayerId(layerId);
    };

    const handleLayerDragOver = (layerId) => {
        if (!draggedLayerId || draggedLayerId === layerId) return;
    };

    const handleGapDragOver = (gapIndex) => {
        if (!draggedLayerId) return;
        setDragOverGapIndex(gapIndex);
    };

    const handleLayerDrop = () => {
    };

    const handleGapDrop = (gapIndex) => {
        if (!draggedLayerId || drawingLayersTopDown.length === 0) {
            setDraggedLayerId(null);
            setDragOverGapIndex(null);
            return;
        }

        const fromIndex = layers.findIndex((layer) => layer.id === draggedLayerId);
        let toIndex = -1;

        if (gapIndex === 0) {
            const topMost = drawingLayersTopDown[0];
            const topMostIndex = layers.findIndex((layer) => layer.id === topMost.id);
            toIndex = topMostIndex + 1;
        } else {
            const upperNeighbor = drawingLayersTopDown[gapIndex - 1];
            toIndex = layers.findIndex((layer) => layer.id === upperNeighbor.id);
        }

        if (fromIndex !== -1 && toIndex !== -1) {
            onReorderLayers(fromIndex, toIndex);
        }

        setDraggedLayerId(null);
        setDragOverGapIndex(null);
    };

    const handleLayerDragEnd = () => {
        setDraggedLayerId(null);
        setDragOverGapIndex(null);
    };


    return (
        <div className={`layers-panel ${isMinimized ? 'minimized' : ''}`}>
            <div className="layers-panel-header">
                <div className="layers-panel-title">Layers</div>
                <div className="layers-panel-controls">
                    <button
                        className="panel-control-btn"
                        onClick={() => setIsMinimized(!isMinimized)}
                        title={isMinimized ? "Maximize" : "Minimize"}
                    >
                        {isMinimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
                    </button>
                    <button
                        className="panel-control-btn add-layer-btn"
                        onClick={onAddLayer}
                        title="Add new layer"
                    >
                        <Plus size={18} strokeWidth={2.5} />
                    </button>
                </div>
            </div>

            {/* Layer Controls (Opacity & Blend Mode) */}
            {/* Layer Controls (Opacity & Blend Mode) */}
            <div className="layer-controls-section">
                <div className="control-row">
                    <label className="control-label">Opacity</label>
                    <span className="control-value">{activeLayer ? Math.round(activeLayer.opacity * 100) : 100}%</span>
                </div>
                <div className="slider-container">
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={activeLayer ? activeLayer.opacity : 1}
                        onChange={(e) => activeLayer && onUpdateLayer(activeLayer.id, { opacity: parseFloat(e.target.value) })}
                        disabled={!activeLayer}
                        className="opacity-slider"
                        style={{
                            background: `linear-gradient(to right, #8b5cf6 0%, #8b5cf6 ${activeLayer ? activeLayer.opacity * 100 : 100}%, white ${activeLayer ? activeLayer.opacity * 100 : 100}%, white 100%)`
                        }}
                    />
                </div>

                <div className="control-row">
                    <label className="control-label">Blend Mode</label>
                    <select
                        value={activeLayer?.blendMode || 'source-over'}
                        onChange={(e) => activeLayer && onUpdateLayer(activeLayer.id, { blendMode: e.target.value })}
                        disabled={!activeLayer}
                        className="blend-mode-select"
                    >
                        <option value="source-over">Normal</option>
                        <option value="multiply">Multiply</option>
                        <option value="screen">Screen</option>
                        <option value="overlay">Overlay</option>
                        <option value="darken">Darken</option>
                        <option value="lighten">Lighten</option>
                        <option value="color-dodge">Color Dodge</option>
                        <option value="color-burn">Color Burn</option>
                        <option value="hard-light">Hard Light</option>
                        <option value="soft-light">Soft Light</option>
                        <option value="difference">Difference</option>
                        <option value="exclusion">Exclusion</option>
                        <option value="hue">Hue</option>
                        <option value="saturation">Saturation</option>
                        <option value="color">Color</option>
                        <option value="luminosity">Luminosity</option>
                    </select>
                </div>
            </div>

            <div className="layers-list">
                {layers.length === 0 ? (
                    <div style={{
                        textAlign: 'center',
                        padding: '2rem 1rem',
                        color: '#9ca3af',
                        fontSize: '13px'
                    }}>
                        No layers yet.<br />
                        Upload a reference image to start.
                    </div>
                ) : (
                    <>
                        {/* Drawing Layers (Top to Bottom) */}
                        {drawingLayersTopDown.map((layer, idx) => {
                            return (
                                <React.Fragment key={layer.id}>
                                    <div
                                        className={`layer-drop-gap ${draggedLayerId ? 'visible' : ''} ${dragOverGapIndex === idx ? 'drag-over' : ''}`}
                                        onDragOver={(e) => {
                                            if (!draggedLayerId) return;
                                            e.preventDefault();
                                            handleGapDragOver(idx);
                                        }}
                                        onDrop={(e) => {
                                            if (!draggedLayerId) return;
                                            e.preventDefault();
                                            handleGapDrop(idx);
                                        }}
                                    />
                                    <LayerItem
                                        layer={layer}
                                        isActive={layer.id === activeLayerId}
                                        onSelect={onLayerSelect}
                                        onToggleVisibility={onToggleVisibility}
                                        onToggleLock={onToggleLock}
                                        onDragStart={handleLayerDragStart}
                                        onDragOver={handleLayerDragOver}
                                        onDrop={handleLayerDrop}
                                        onDragEnd={handleLayerDragEnd}
                                        onRename={(id, name) => onUpdateLayer(id, { name })}
                                        onDuplicate={onDuplicateLayer}
                                        onDelete={onDeleteLayer}
                                        onClothify={onClothify}
                                        onPatternMaker={onPatternMaker}
                                    />
                                </React.Fragment>
                            );
                        })}

                        {drawingLayersTopDown.length > 0 && (
                            <div
                                className={`layer-drop-gap ${draggedLayerId ? 'visible' : ''} ${dragOverGapIndex === drawingLayersTopDown.length ? 'drag-over' : ''}`}
                                onDragOver={(e) => {
                                    if (!draggedLayerId) return;
                                    e.preventDefault();
                                    handleGapDragOver(drawingLayersTopDown.length);
                                }}
                                onDrop={(e) => {
                                    if (!draggedLayerId) return;
                                    e.preventDefault();
                                    handleGapDrop(drawingLayersTopDown.length);
                                }}
                            />
                        )}

                        {/* Reference Layer (Pinned to Bottom) */}
                        {referenceLayer && (
                            <div style={{ marginTop: 'auto' }}>
                                <LayerItem
                                    key={referenceLayer.id}
                                    layer={referenceLayer}
                                    isActive={referenceLayer.id === activeLayerId}
                                    onSelect={onLayerSelect}
                                    onToggleVisibility={onToggleVisibility}
                                    onToggleLock={onToggleLock}
                                    onRename={(id, name) => onUpdateLayer(id, { name })}
                                    onDelete={onDeleteLayer}
                                    onDuplicate={onDuplicateLayer}
                                    onClothify={onClothify}
                                    onPatternMaker={onPatternMaker}
                                    onStylebend={onStylebendFromLayer}
                                />
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default LayersPanel;
