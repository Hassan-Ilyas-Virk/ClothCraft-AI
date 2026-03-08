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
    onDeleteLayer,
    onClothify,
    onPatternMaker,
    onUpdateLayer,
    onStylebend
}) => {
    const [isMinimized, setIsMinimized] = useState(false);

    const activeLayer = layers.find(l => l.id === activeLayerId);
    const referenceLayer = layers.find(l => l.type === 'reference');
    const drawingLayers = layers.filter(l => l.type !== 'reference');


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
                            <div style={{ marginTop: 'auto' }}>
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

            {/* Stylebend Trigger */}
            <div className="layers-panel-footer" style={{ padding: '16px', borderTop: '1px solid #e5e7eb' }}>
                <button
                    onClick={onStylebend}
                    className="stylebend-trigger-btn"
                    style={{
                        width: '100%',
                        padding: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        background: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontWeight: '600',
                        transition: 'all 0.2s ease',
                        boxShadow: '0 4px 12px rgba(139, 92, 246, 0.3)'
                    }}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"></path></svg>
                    Stylebend
                </button>
            </div>
        </div>
    );
};

export default LayersPanel;
