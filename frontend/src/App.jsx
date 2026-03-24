import React, { useState, useRef, useEffect } from 'react';
import { Upload, Sparkles, X, ImagePlus, SlidersHorizontal, ChevronLeft, PenLine, Home } from 'lucide-react';
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
import GenerateHumanModal from './components/GenerateHumanModal';
import BrushControls from './components/BrushControls';
import ClothCraftLogo from './components/ClothCraftLogo';
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
    const [eraserSize, setEraserSize] = useState(20);
    const [brushColor, setBrushColor] = useState('#000000');
    const [clothifyLayer, setClothifyLayer] = useState(null);
    const [patternLayer, setPatternLayer] = useState(null);
    const [showMoodboard, setShowMoodboard] = useState(false);
    const [showStylebend, setShowStylebend] = useState(false);
    const [stylebendInitialImage, setStylebendInitialImage] = useState(null);
    const [clothifyProgress, setClothifyProgress] = useState(0);
    const [clothifyStatus, setClothifyStatus] = useState('');
    const [showGenerateHuman, setShowGenerateHuman] = useState(false);
    const [moodboardColors, setMoodboardColors] = useState([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState(null);

    // Handle Spacebar Pan (Photoshop style)
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Disable if Clothify modal is open
            if (clothifyLayer || patternLayer) return;

            if (e.code === 'KeyF' && !e.repeat && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                canvasRef.current?.fitToScreen();
            }

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
        const { layers: projLayers, activeLayerId: projActiveId, name, canvasWidth, canvasHeight } = proj;
        setCurrentProject(proj);
        setCanvasName(name);
        loadAllLayers(projLayers || [], projActiveId || null);
        
        // Use a small timeout to ensure the canvas is mounted before fitting
        setTimeout(() => {
            if (canvasRef.current) {
                if (canvasWidth && canvasHeight) {
                    canvasRef.current.setCanvasSize(canvasWidth, canvasHeight);
                }
                canvasRef.current.fitToScreen();
            }
        }, 100);
        
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
            setClothifyProgress(0);
            setClothifyStatus('Preparing layers...');
            setIsProcessing(true);
            console.log('🎨 Starting Clothify generation...');

            // Get the drawing layer blob
            setClothifyProgress(10);
            setClothifyStatus('Processing drawing...');
            const doodleBlob = await canvasRef.current.getLayerBlob(layerId);

            // Get the reference layer blob
            const referenceLayer = getReferenceLayer();
            const referenceBlob = await canvasRef.current.getLayerBlob(referenceLayer.id);

            // Step 1: Translate doodle with Pix2Pix
            setClothifyProgress(20);
            setClothifyStatus('Translating design with Pix2Pix...');
            console.log('   Step 1: Translating doodle with Pix2Pix');
            const translatedDoodleBlob = await translateDoodle(doodleBlob);

            // Step 2: Composite translated doodle onto reference
            setClothifyProgress(45);
            setClothifyStatus('Compositing onto reference...');
            console.log('   Step 2: Compositing onto reference');
            const compositedImageBlob = await compositeTranslatedDoodleOnReference(
                referenceBlob,
                translatedDoodleBlob,
                doodleBlob
            );

            // If blend strength is 0, skip Stable Diffusion and return composited result
            if (blendStrength === 0) {
                setClothifyProgress(100);
                setClothifyStatus('Done!');
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
            setClothifyProgress(60);
            setClothifyStatus('Creating mask...');
            console.log('   Step 3: Creating mask');
            const maskBlob = await createMaskFromDoodle(doodleBlob, blendStrength);

            // Step 4: Inpaint with Stable Diffusion
            setClothifyProgress(75);
            setClothifyStatus('Applying AI refinement...');
            console.log('   Step 4: Inpainting with Stable Diffusion');
            const inpaintedResultBlob = await inpaintWithStableDiffusion(
                compositedImageBlob,
                maskBlob,
                prompt,
                blendStrength
            );
            
            setClothifyProgress(100);
            setClothifyStatus('Done!');

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
            
            // We use a small timeout to let the UI settle before the canvas operation
            // This ensures the internal canvas state is ready for drawing
            setTimeout(async () => {
                if (canvasRef.current) {
                    await canvasRef.current.loadImageToLayer(referenceLayer.id, blob);
                    
                    // Force a re-render of the thumbnail and canvas state by giving it a fresh object URL
                    const freshUrl = URL.createObjectURL(blob);
                    updateLayer(referenceLayer.id, {
                        canvasData: freshUrl,
                        thumbnail: freshUrl
                    });
                }
            }, 50);

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

    const handleApplyGenerateHuman = async (resultUrl) => {
        try {
            // Fetch the generated AI image to get a blob
            const res = await fetch(resultUrl);
            const blob = await res.blob();
            
            if (layers.length === 0) {
                // If this is the first action, set as Reference Layer
                const refLayer = addLayer('reference', 'Generated Human');
                const objectUrl = URL.createObjectURL(blob);
                
                // Wait for the new canvas instance to attach to the DOM
                setTimeout(async () => {
                    if (canvasRef.current) {
                        await canvasRef.current.loadImageToLayer(refLayer.id, blob, true);
                        // Manually trigger the canvasData update since the canvas size shifted
                        updateLayer(refLayer.id, {
                            canvasData: objectUrl,
                            thumbnail: objectUrl
                        });
                    }
                }, 50);
            } else {
                // Otherwise normal drawing layer
                const objectUrl = URL.createObjectURL(blob);
                const newLayer = addLayer('drawing', `Generated Human`);
                updateLayer(newLayer.id, {
                    canvasData: objectUrl,
                    thumbnail: objectUrl
                });
            }

            console.log('✅ Generated Human applied');
        } catch (err) {
            console.error('Error applying Generated Human:', err);
            setError('Failed to apply Generated Human image to canvas');
        }
    };

    const handleStylebendFromLayer = (layer) => {
        const initialBlobUrl = layer.canvasData || layer.thumbnail;
        setStylebendInitialImage(initialBlobUrl);
        setShowStylebend(true);
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
    
    return (
        <div className="app">
            {/* Left Sidebar Column */}
            <div className="toolbar-column">
                <button className="app-back-btn home-sidebar-btn glass-panel" onClick={handleBackToHome} title="Back to Home">
                    <ClothCraftLogo size={40} color="black" />
                </button>
                
                {layers.length > 0 && (
                    <Toolbar
                        activeTool={activeTool}
                        onToolChange={setActiveTool}
                        brushColor={brushColor}
                        onColorChange={setBrushColor}
                        moodboardColors={moodboardColors}
                        onOpenMoodboard={handleOpenMoodboard}
                        disabled={isProcessing || !activeLayerId}
                    />
                )}
            </div>

            {error && (
                <div className="error-banner">
                    {error}
                    <button onClick={() => setError(null)}>
                        <X size={18} />
                    </button>
                </div>
            )}

            {/* Main Content Area */}
            <div className="app-main">
                {/* Brush Controls */}
                {layers.length > 0 && (
                    <BrushControls
                        brushSize={activeTool === 'eraser' ? eraserSize : brushSize}
                        onBrushSizeChange={(newSize) => {
                            if (activeTool === 'eraser') {
                                setEraserSize(newSize);
                            } else {
                                setBrushSize(newSize);
                            }
                        }}
                        brushColor={activeTool === 'eraser' ? '#ffffff' : brushColor}
                        visible={activeTool === 'brush' || activeTool === 'eraser'}
                        toolName={activeTool === 'eraser' ? 'Eraser' : 'Brush'}
                    />
                )}

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
                            <input
                                type="file"
                                id="imageUpload"
                                accept="image/*"
                                onChange={handleImageUpload}
                                style={{ display: 'none' }}
                            />
                            <div className="empty-state-icon">
                                <ImagePlus size={100} strokeWidth={1} color="rgba(255,255,255,0.1)" />
                            </div>
                            <div className="empty-state-text">
                                Start your project with a human base
                            </div>
                            <div style={{ display: 'flex', gap: '20px', marginTop: '32px' }}>
                                <label htmlFor="imageUpload" className="empty-state-btn primary">
                                    <Upload size={18} />
                                    Upload Reference
                                </label>
                                <button className="empty-state-btn secondary" onClick={() => setShowGenerateHuman(true)}>
                                    <Sparkles size={18} />
                                    AI Generate
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Right Layers Panel */}
                {layers.length > 0 && (
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
                        onStylebend={() => {
                            setStylebendInitialImage(null);
                            setShowStylebend(true);
                        }}
                        onStylebendFromLayer={handleStylebendFromLayer}
                        onGenerateHuman={() => setShowGenerateHuman(true)}
                    />
                )}
            </div >

            {/* Clothify Modal */}
            {
                clothifyLayer && (
                    <ClothifyModal
                        layer={clothifyLayer}
                        onClose={handleCloseClothify}
                        onApply={handleApplyClothify}
                        onGenerate={handleGenerateClothify}
                        progress={clothifyProgress}
                        status={clothifyStatus}
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
                        initialImage1Url={stylebendInitialImage}
                    />
                )
            }

            {/* Generate Human Modal */}
            {
                showGenerateHuman && (
                    <GenerateHumanModal
                        onClose={() => setShowGenerateHuman(false)}
                        onApply={handleApplyGenerateHuman}
                    />
                )
            }
        </div >
    );
}

export default App;
