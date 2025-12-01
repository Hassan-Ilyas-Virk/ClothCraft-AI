import React, { useState, useRef, useEffect } from 'react';
// Force re-compile
import './App.css';
import Toolbar from './components/Toolbar';
import LayersPanel from './components/LayersPanel';
import MultiLayerCanvas from './components/MultiLayerCanvas';
import ClothifyModal from './components/ClothifyModal';
import PatternMakerModal from './components/PatternMakerModal';
import MoodboardModal from './components/MoodboardModal';
import BrushControls from './components/BrushControls';
import { useLayerManager } from './hooks/useLayerManager';
import {
    translateDoodle,
    createMaskFromDoodle,
    compositeTranslatedDoodleOnReference,
    inpaintWithStableDiffusion,
    refinePattern
} from './utils/imageProcessing';

function App() {
    const canvasRef = useRef(null);
    const {
        layers,
        activeLayerId,
        setActiveLayerId,
        addLayer,
        removeLayer,
        updateLayer,
        toggleLayerVisibility,
        toggleLayerLock,
        getReferenceLayer,
    } = useLayerManager();

    const [activeTool, setActiveTool] = useState('brush');
    const [previousTool, setPreviousTool] = useState(null); // For spacebar panning
    const [brushSize, setBrushSize] = useState(5);
    const [brushColor, setBrushColor] = useState('#000000');
    const [clothifyLayer, setClothifyLayer] = useState(null);
    const [patternLayer, setPatternLayer] = useState(null);
    const [showMoodboard, setShowMoodboard] = useState(false);
    const [moodboardColors, setMoodboardColors] = useState([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState(null);

    // Handle Spacebar Pan (Photoshop style)
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Disable if Clothify modal is open
            if (clothifyLayer || patternLayer) return;

            if (e.code === 'Space' && !e.repeat && activeTool !== 'pan') {
                e.preventDefault(); // Prevent scrolling
                setPreviousTool(activeTool);
                setActiveTool('pan');
            }
        };

        const handleKeyUp = (e) => {
            if (clothifyLayer || patternLayer) return;

            if (e.code === 'Space' && previousTool) {
                e.preventDefault();
                setActiveTool(previousTool);
                setPreviousTool(null);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [activeTool, previousTool, clothifyLayer]);

    // Handle reference image upload
    const handleImageUpload = (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = async () => {
                    // Create reference layer
                    const refLayer = addLayer('reference', 'Reference');

                    // Convert image to blob
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);

                    canvas.toBlob(async (blob) => {
                        if (canvasRef.current) {
                            // Load image and resize canvas to fit it exactly (no borders)
                            await canvasRef.current.loadImageToLayer(refLayer.id, blob, true);
                        }
                    });

                    setError(null);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    };

    // Handle adding a new drawing layer
    const handleAddLayer = () => {
        addLayer('drawing');
    };

    // Handle layer selection
    const handleLayerSelect = (layerId) => {
        const layer = layers.find(l => l.id === layerId);
        if (layer && !layer.locked) {
            setActiveLayerId(layerId);
        }
    };

    // Handle layer update (thumbnail, canvas data)
    const handleLayerUpdate = (layerId, updates) => {
        updateLayer(layerId, updates);
    };

    // Handle opening Clothify modal
    const handleClothify = (layer) => {
        setClothifyLayer(layer);
    };

    // Handle closing Clothify modal
    const handleCloseClothify = () => {
        setClothifyLayer(null);
    };

    // Handle generating preview in Clothify modal
    const handleGenerateClothify = async ({ layerId, prompt, blendStrength }) => {
        try {
            setIsProcessing(true);
            console.log('🎨 Starting Clothify generation...');

            // Get the drawing layer blob
            const doodleBlob = await canvasRef.current.getLayerBlob(layerId);

            // Get the reference layer blob
            const referenceLayer = getReferenceLayer();
            const referenceBlob = await canvasRef.current.getLayerBlob(referenceLayer.id);

            // Step 1: Translate doodle with Pix2Pix
            console.log('   Step 1: Translating doodle with Pix2Pix');
            const translatedDoodleBlob = await translateDoodle(doodleBlob);

            // Step 2: Composite translated doodle onto reference
            console.log('   Step 2: Compositing onto reference');
            const compositedImageBlob = await compositeTranslatedDoodleOnReference(
                referenceBlob,
                translatedDoodleBlob,
                doodleBlob
            );

            // Step 3: Create mask from doodle
            console.log('   Step 3: Creating mask');
            const maskBlob = await createMaskFromDoodle(doodleBlob, blendStrength);

            // Step 4: Inpaint with Stable Diffusion
            console.log('   Step 4: Inpainting with Stable Diffusion');
            const inpaintedResultBlob = await inpaintWithStableDiffusion(
                compositedImageBlob,
                maskBlob,
                prompt,
                blendStrength
            );

            // Convert blob to data URL for preview
            const reader = new FileReader();
            return new Promise((resolve, reject) => {
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(inpaintedResultBlob);
            });

        } catch (err) {
            console.error('Error during Clothify generation:', err);
            setError(err.message || 'An error occurred during processing');
            throw err;
        } finally {
            setIsProcessing(false);
        }
    };

    // Handle applying Clothify result
    const handleApplyClothify = async (layerId, previewDataUrl) => {
        try {
            // Convert data URL to blob
            const response = await fetch(previewDataUrl);
            const blob = await response.blob();

            // Update reference layer with the result
            const referenceLayer = getReferenceLayer();
            await canvasRef.current.loadImageToLayer(referenceLayer.id, blob);

            // Remove the drawing layer
            removeLayer(layerId);

            console.log('✅ Clothify result applied to reference layer');
        } catch (err) {
            console.error('Error applying Clothify result:', err);
            setError(err.message || 'Failed to apply result');
        }
    };

    // Pattern Maker Handlers
    const handlePatternMaker = (layer) => {
        setPatternLayer(layer);
    };
    const handleClosePatternMaker = () => {
        setPatternLayer(null);
    };

    const handleApplyPattern = async (patternDataUrl) => {
        try {
            const baseName = patternLayer?.name || 'Pattern';

            // Create a new layer with the pattern
            const res = await fetch(patternDataUrl);
            const blob = await res.blob();

            // addLayer expects (type, name)
            const newLayer = addLayer('drawing', `${baseName} Pattern`);

            // Update the layer with the blob data (as canvasData URL)
            updateLayer(newLayer.id, {
                canvasData: patternDataUrl, // Use the URL directly, or create object URL from blob
                thumbnail: patternDataUrl
            });

            console.log('✅ Pattern applied to new layer');
        } catch (err) {
            console.error('Error applying pattern:', err);
            setError('Failed to apply pattern');
        }
    };

    const handleRefinePattern = async ({ image, prompt, strength }) => {
        return await refinePattern(image, prompt, strength);
    };

    const handleOpenMoodboard = () => {
        setShowMoodboard(true);
    };

    const handleCloseMoodboard = () => {
        setShowMoodboard(false);
    };

    const handleApplyMoodboard = (colors) => {
        setMoodboardColors(colors);
        setShowMoodboard(false);
    };

    return (
        <div className="app">
            {/* Top Header */}
            <header className="app-header">
                <h1>✨ Clothify Editor</h1>
                <div className="header-controls">
                    <input
                        type="file"
                        id="imageUpload"
                        accept="image/*"
                        onChange={handleImageUpload}
                        disabled={isProcessing}
                        style={{ display: 'none' }}
                    />
                    <label htmlFor="imageUpload" className="upload-btn">
                        📁 Upload Reference
                    </label>
                </div>
            </header>

            {error && (
                <div className="error-banner">
                    ⚠️ {error}
                    <button onClick={() => setError(null)}>✕</button>
                </div>
            )}

            {/* Main Content Area */}
            <div className="app-main">
                {/* Left Toolbar */}
                <Toolbar
                    activeTool={activeTool}
                    onToolChange={setActiveTool}
                    brushColor={brushColor}
                    onColorChange={setBrushColor}
                    moodboardColors={moodboardColors}
                    onOpenMoodboard={handleOpenMoodboard}
                    disabled={isProcessing || !activeLayerId}
                />

                {/* Brush Controls */}
                <BrushControls
                    brushSize={brushSize}
                    onBrushSizeChange={setBrushSize}
                    brushColor={brushColor}
                    visible={activeTool === 'brush' && activeLayerId !== null}
                />

                {/* Center Canvas */}
                <div className="app-canvas-area">
                    {layers.length > 0 ? (
                        <MultiLayerCanvas
                            ref={canvasRef}
                            layers={layers}
                            activeLayerId={activeLayerId}
                            brushSize={brushSize}
                            brushColor={brushColor}
                            activeTool={activeTool}
                            onLayerUpdate={handleLayerUpdate}
                        />
                    ) : (
                        <div className="empty-state">
                            <div className="empty-state-icon">🎨</div>
                            <div className="empty-state-text">
                                Upload a reference image to get started
                            </div>
                            <label htmlFor="imageUpload" className="empty-state-btn">
                                📁 Upload Image
                            </label>
                        </div>
                    )}
                </div>

                {/* Right Layers Panel */}
                <LayersPanel
                    layers={layers}
                    activeLayerId={activeLayerId}
                    onLayerSelect={handleLayerSelect}
                    onAddLayer={handleAddLayer}
                    onToggleVisibility={toggleLayerVisibility}
                    onToggleLock={toggleLayerLock}
                    onDeleteLayer={removeLayer}
                    onClothify={handleClothify}
                    onPatternMaker={handlePatternMaker}
                    onUpdateLayer={updateLayer}
                />
            </div >

            {/* Clothify Modal */}
            {
                clothifyLayer && (
                    <ClothifyModal
                        layer={clothifyLayer}
                        onClose={handleCloseClothify}
                        onApply={handleApplyClothify}
                        onGenerate={handleGenerateClothify}
                    />
                )
            }

            {/* Pattern Maker Modal */}
            {
                patternLayer && (
                    <PatternMakerModal
                        layer={patternLayer}
                        onClose={handleClosePatternMaker}
                        onApply={handleApplyPattern}
                        onRefine={handleRefinePattern}
                    />
                )
            }

            {/* Moodboard Modal */}
            {
                showMoodboard && (
                    <MoodboardModal
                        onClose={handleCloseMoodboard}
                        onApply={handleApplyMoodboard}
                    />
                )
            }
        </div >
    );
}

export default App;
