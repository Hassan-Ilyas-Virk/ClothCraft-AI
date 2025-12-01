import React from 'react';
import LayerItem from './LayerItem';
import './LayersPanel.css';

const LayersPanel = ({
    layers,
    activeLayerId,
    onLayerSelect,
    onAddLayer,
    onToggleVisibility,
    onToggleLock,
    onDeleteLayer,
    onClothify,
    onPatternMaker,
    onUpdateLayer
}) => {
    const activeLayer = layers.find(l => l.id === activeLayerId);
    const referenceLayer = layers.find(l => l.type === 'reference');
    const drawingLayers = layers.filter(l => l.type !== 'reference');

    return (
        <div className="layers-panel">
            <div className="layers-panel-header">
                <div className="layers-panel-title">Layers</div>
                <button
                    className="add-layer-btn"
                    onClick={onAddLayer}
                    title="Add new layer"
                >
                    +
                </button>
            </div>

            {/* Layer Controls (Opacity & Blend Mode) */}
            <div className="layer-controls" style={{ padding: '0.75rem', borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
                <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '12px', fontWeight: 500, color: '#4b5563' }}>Opacity</label>
                    <span style={{ fontSize: '11px', color: '#6b7280' }}>{activeLayer ? Math.round(activeLayer.opacity * 100) : 100}%</span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={activeLayer ? activeLayer.opacity : 1}
                    onChange={(e) => activeLayer && onUpdateLayer(activeLayer.id, { opacity: parseFloat(e.target.value) })}
                    disabled={!activeLayer}
                    style={{ width: '100%', marginBottom: '0.75rem', accentColor: '#8b5cf6' }}
                />

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '12px', fontWeight: 500, color: '#4b5563' }}>Blend Mode</label>
                    <select
                        value={activeLayer?.blendMode || 'source-over'}
                        onChange={(e) => activeLayer && onUpdateLayer(activeLayer.id, { blendMode: e.target.value })}
                        disabled={!activeLayer}
                        style={{
                            fontSize: '12px',
                            padding: '2px 4px',
                            borderRadius: '4px',
                            border: '1px solid #d1d5db',
                            backgroundColor: 'white',
                            color: '#374151',
                            outline: 'none'
                        }}
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
                        {[...drawingLayers].reverse().map((layer) => (
                            <LayerItem
                                key={layer.id}
                                layer={layer}
                                isActive={layer.id === activeLayerId}
                                onSelect={onLayerSelect}
                                onToggleVisibility={onToggleVisibility}
                                onToggleLock={onToggleLock}
                                onDelete={onDeleteLayer}
                                onClothify={onClothify}
                                onPatternMaker={onPatternMaker}
                            />
                        ))}

                        {/* Reference Layer (Pinned to Bottom) */}
                        {referenceLayer && (
                            <div style={{ borderTop: '2px solid #e5e7eb', marginTop: 'auto' }}>
                                <LayerItem
                                    key={referenceLayer.id}
                                    layer={referenceLayer}
                                    isActive={referenceLayer.id === activeLayerId}
                                    onSelect={onLayerSelect}
                                    onToggleVisibility={onToggleVisibility}
                                    onToggleLock={onToggleLock}
                                    onDelete={onDeleteLayer}
                                    onClothify={onClothify}
                                    onPatternMaker={onPatternMaker}
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
