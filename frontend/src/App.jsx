import React, { useState, useRef, useEffect } from 'react';
import { Upload, Sparkles, X, ImagePlus, SlidersHorizontal, ChevronLeft, PenLine } from 'lucide-react';
import { getUser, login as authLogin, signup as authSignup, logout as authLogout } from './services/auth';
import * as projectService from './services/projects';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
// Force re-compile
import './App.css';
import Toolbar from './components/Toolbar';
import LayersPanel from './components/LayersPanel';
import MultiLayerCanvas from './components/MultiLayerCanvas';
import ClothifyModal from './components/ClothifyModal';
import PatternMakerModal from './components/PatternMakerModal';
import MoodboardModal from './components/MoodboardModal';
import StylebendModal from './components/StylebendModal';
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

    // ── Routing / auth / project state ─────────────────────────────────
    const [currentView,    setCurrentView]    = useState('loading'); // 'loading'|'login'|'home'|'canvas'
    const [currentUser,    setCurrentUser]    = useState(null);
    const [currentProject, setCurrentProject] = useState(null);
    const [userProjects,   setUserProjects]   = useState([]);
    const [canvasName,     setCanvasName]     = useState('Untitled Design');
    const [nameEditing,    setNameEditing]    = useState(false);
    const canvasNameInputRef                  = useRef(null);
    // ───────────────────────────────────────────────────────────────────

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
        loadAllLayers,
    } = useLayerManager();

    const [activeTool, setActiveTool] = useState('brush');
    const [previousTool, setPreviousTool] = useState(null); // For spacebar panning
    const [brushSize, setBrushSize] = useState(5);
    const [brushColor, setBrushColor] = useState('#000000');
    const [clothifyLayer, setClothifyLayer] = useState(null);
    const [patternLayer, setPatternLayer] = useState(null);
    const [showMoodboard, setShowMoodboard] = useState(false);
    const [showStylebend, setShowStylebend] = useState(false);
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

    // ── Auth check on mount ────────────────────────────────────────────
    useEffect(() => {
        const user = getUser();
        if (user) { setCurrentUser(user); setCurrentView('home'); }
        else      { setCurrentView('login'); }
    }, []);

    // Refresh project list when arriving on the home view
    useEffect(() => {
        if (currentView === 'home' && currentUser) {
            setUserProjects(projectService.getProjects(currentUser.id));
        }
    }, [currentView, currentUser]);

    // Restore layers when a project is opened (key off project id so it only fires on project change)
    useEffect(() => {
        if (!currentProject) return;
        setCanvasName(currentProject.name || 'Untitled Design');
        if (currentProject.layersSnapshot) {
            try {
                const { layers: sl, activeLayerId: sa, canvasWidth: cw, canvasHeight: ch } = JSON.parse(currentProject.layersSnapshot);
                loadAllLayers(sl, sa);
                if (cw && ch) canvasRef.current?.setCanvasSize(cw, ch);
            } catch { loadAllLayers([], null); }
        } else {
            loadAllLayers([], null);
        }
    }, [currentProject?.id]);

    // Auto-save layers 3 s after the last change while on the canvas view
    useEffect(() => {
        if (currentView !== 'canvas' || !currentProject) return;
        const tid = setTimeout(() => _saveProject(canvasName), 3000);
        return () => clearTimeout(tid);
    }, [layers]);

    // Focus the canvas name input when editing starts
    useEffect(() => {
        if (nameEditing && canvasNameInputRef.current) {
            canvasNameInputRef.current.select();
        }
    }, [nameEditing]);
    // ──────────────────────────────────────────────────────────────────

    // ── Auth handlers ─────────────────────────────────────────────────
    const handleLogin = async (email, password) => {
        const user = authLogin(email, password);   // throws on failure
        setCurrentUser(user);
        setCurrentView('home');
    };
    const handleSignup = async (email, password, name) => {
        const user = authSignup(email, password, name);
        setCurrentUser(user);
        setCurrentView('home');
    };
    const handleLogout = () => {
        authLogout();
        setCurrentUser(null);
        setCurrentProject(null);
        loadAllLayers([], null);
        setCurrentView('login');
    };

    // ── Project handlers ──────────────────────────────────────────────
    /** Internal: persist current state to storage */
    const _saveProject = (nameOverride) => {
        if (!currentProject) return;
        const name = (nameOverride || canvasName || '').trim() || 'Untitled Design';
        const thumbnail = layers.find(l => l.thumbnail)?.thumbnail || null;
        const { width: canvasWidth, height: canvasHeight } = canvasRef.current?.getCanvasSize() ?? { width: 1024, height: 1024 };
        projectService.saveProject(currentProject.id, { name, thumbnail, layers, activeLayerId, canvasWidth, canvasHeight });
    };

    const handleNewProject = () => {
        const proj = projectService.createProject(currentUser.id, 'Untitled Design');
        setCurrentProject(proj);
        setCanvasName(proj.name);
        loadAllLayers([], null);
        setCurrentView('canvas');
    };
    const handleOpenProject = (proj) => {
        setCurrentProject(proj);
        setCurrentView('canvas');
    };
    const handleDeleteProject = (projectId) => {
        projectService.deleteProject(projectId);
        setUserProjects(projectService.getProjects(currentUser.id));
    };
    const handleRenameProject = (projectId, newName) => {
        projectService.renameProject(projectId, newName);
        setUserProjects(projectService.getProjects(currentUser.id));
    };
    const handleBackToHome = () => {
        _saveProject();
        setCurrentView('home');
    };

    // ── Canvas name handlers ──────────────────────────────────────────
    const handleNameCommit = () => {
        const trimmed = (canvasName || '').trim() || 'Untitled Design';
        setCanvasName(trimmed);
        setNameEditing(false);
        _saveProject(trimmed);
    };
    // ──────────────────────────────────────────────────────────────────

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

            // If blend strength is 0, skip Stable Diffusion and return composited result
            if (blendStrength === 0) {
                console.log('   ⏭️ Skipping Stable Diffusion (blend strength = 0)');
                console.log('   ✅ Returning Pix2Pix result only');

                // Convert blob to data URL for preview
                const reader = new FileReader();
                return new Promise((resolve, reject) => {
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(compositedImageBlob);
                });
            }

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

    const handleApplyStylebend = async (resultUrl) => {
        try {
            // Fetch the image to get a blob
            const res = await fetch(resultUrl);
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);

            // Create a new layer for the blended image
            const newLayer = addLayer('drawing', `Blended Style`);

            // Update the layer with the object URL
            updateLayer(newLayer.id, {
                canvasData: objectUrl,
                thumbnail: objectUrl
            });

            console.log('✅ Stylebend result applied to new layer');
        } catch (err) {
            console.error('Error applying Stylebend result:', err);
            setError('Failed to apply Stylebend image to canvas');
        }
    };

    // ── Conditional routing renders ────────────────────────────────────
    if (currentView === 'loading') return null;
    if (currentView === 'login') return (
        <LoginPage onLogin={handleLogin} onSignup={handleSignup} />
    );
    if (currentView === 'home') return (
        <HomePage
            user={currentUser}
            projects={userProjects}
            onNewProject={handleNewProject}
            onOpenProject={handleOpenProject}
            onDeleteProject={handleDeleteProject}
            onRenameProject={handleRenameProject}
            onLogout={handleLogout}
        />
    );
    // ── Canvas view ────────────────────────────────────────────────────
    return (
        <div className="app">
            {/* Top Header */}
            <header className="app-header">
                {/* Left: back + brand */}
                <div className="app-header-left">
                    <button className="app-back-btn" onClick={handleBackToHome} title="Back to Home">
                        <ChevronLeft size={17} />
                        <span>Home</span>
                    </button>
                    <div className="app-header-logo">
                        <Sparkles size={16} strokeWidth={1.5} />
                    </div>
                </div>

                {/* Center: editable project name */}
                <div className="app-name-area">
                    {nameEditing ? (
                        <input
                            ref={canvasNameInputRef}
                            className="app-name-input"
                            value={canvasName}
                            onChange={e => setCanvasName(e.target.value)}
                            onBlur={handleNameCommit}
                            onKeyDown={e => {
                                if (e.key === 'Enter')  { e.target.blur(); }
                                if (e.key === 'Escape') { setNameEditing(false); }
                                e.stopPropagation();
                            }}
                        />
                    ) : (
                        <button
                            className="app-name-display"
                            onClick={() => setNameEditing(true)}
                            title="Click to rename"
                        >
                            {canvasName}
                            <PenLine size={12} />
                        </button>
                    )}
                </div>

                {/* Right: upload */}
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
                        <Upload size={16} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'middle' }} />
                        Upload Reference
                    </label>
                </div>
            </header>

            {error && (
                <div className="error-banner">
                    ⚠️ {error}
                    <button onClick={() => setError(null)}>
                        <X size={18} />
                    </button>
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
                            <div className="empty-state-icon">
                                <ImagePlus size={80} strokeWidth={1.5} color="#d1d5db" />
                            </div>
                            <div className="empty-state-text">
                                Upload a reference image to get started
                            </div>
                            <label htmlFor="imageUpload" className="empty-state-btn">
                                <Upload size={16} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'middle' }} />
                                Upload Image
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
                    onStylebend={() => setShowStylebend(true)}
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

            {/* Stylebend Modal */}
            {
                showStylebend && (
                    <StylebendModal
                        onClose={() => setShowStylebend(false)}
                        onApply={handleApplyStylebend}
                    />
                )
            }
        </div >
    );
}

export default App;
