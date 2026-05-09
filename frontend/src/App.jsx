import React, { useState, useRef, useEffect } from 'react';
import { Upload, Sparkles, X, ImagePlus, SlidersHorizontal, ChevronLeft, PenLine, Home, Moon, Sun } from 'lucide-react';
import { useDarkMode } from './hooks/useDarkMode';
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
import LivePreviewPane from './components/LivePreviewPane';
import TextToClothesModal from './components/TextToClothesModal';
import ClothCraftLogo from './components/ClothCraftLogo';
import { useLayerManager } from './hooks/useLayerManager';
import {
    translateDoodle,
    createMaskFromDoodle,
    compositeTranslatedDoodleOnReference,
    inpaintWithStableDiffusion,
    refinePattern,
    extractDoodle
} from './utils/imageProcessing';

function App() {
    const canvasRef = useRef(null);
    const [isDark, toggleDark] = useDarkMode();

    // ── Routing / auth / project state ─────────────────────────────────
    const [currentView,    setCurrentView]    = useState('loading'); // 'loading'|'login'|'home'|'canvas'
    const [currentUser,    setCurrentUser]    = useState(null);
    const [currentProject, setCurrentProject] = useState(null);
    const [userProjects,   setUserProjects]   = useState([]);
    const [canvasName,     setCanvasName]     = useState('Untitled Design');
    const [nameEditing,    setNameEditing]    = useState(false);
    const canvasNameInputRef                  = useRef(null);
    const [canvasNameError, setCanvasNameError] = useState('');
    const [savedCanvasSize, setSavedCanvasSize] = useState(null);
    const [currentCanvasSize, setCurrentCanvasSize] = useState({ width: 1024, height: 1024 });
    const hydrationStateRef = useRef({ projectId: null, ready: false, targetSize: null });
    const didInitialFitRef  = useRef(false); // prevent fitToScreen on every addLayer
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
        reorderLayers,
        duplicateLayer,
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
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
    const [liveMode, setLiveMode] = useState(false);
    const [showTextToClothes, setShowTextToClothes] = useState(false);

    // Handle Spacebar Pan (Photoshop style)
    useEffect(() => {
        const isEditableTarget = (target) => {
            if (!target) return false;
            const tag = target.tagName;
            return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
        };

        const handleKeyDown = (e) => {
            if (currentView !== 'canvas') return;
            if (isEditableTarget(e.target)) return;

            // Disable if Clothify modal is open
            if (clothifyLayer || patternLayer) return;

            if (e.code === 'KeyF' && !e.repeat && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                canvasRef.current?.fitToScreen();
            }

            const isUndoCombo = (e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyZ' && !e.shiftKey;
            const isRedoCombo = ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyZ' && e.shiftKey)
                || (e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'KeyY');

            if (isUndoCombo) {
                e.preventDefault();
                void canvasRef.current?.undoActiveLayer?.();
                return;
            }

            if (isRedoCombo) {
                e.preventDefault();
                void canvasRef.current?.redoActiveLayer?.();
                return;
            }

            if (e.code === 'Space' && !e.repeat && activeTool !== 'pan') {
                e.preventDefault(); // Prevent scrolling
                setPreviousTool(activeTool);
                setActiveTool('pan');
            }
        };

        const handleKeyUp = (e) => {
            if (currentView !== 'canvas') return;
            if (isEditableTarget(e.target)) return;
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
    }, [activeTool, previousTool, clothifyLayer, patternLayer, currentView]);

    // ── Auth check on mount ────────────────────────────────────────────
    useEffect(() => {
        const loadSession = async () => {
            const user = await getUser();
            if (user) { setCurrentUser(user); setCurrentView('home'); }
            else      { setCurrentView('login'); }
        };
        void loadSession();
    }, []);

    // Refresh project list when arriving on the home view
    useEffect(() => {
        if (currentView === 'home' && currentUser) {
            const loadProjects = async () => {
                try {
                    const projects = await projectService.getProjects();
                    setUserProjects(projects);
                } catch (err) {
                    setError(err.message || 'Failed to load projects');
                }
            };
            void loadProjects();
        }
    }, [currentView, currentUser]);

    // Restore layers when a project is opened (key off project id so it only fires on project change)
    useEffect(() => {
        if (!currentProject) return;
        hydrationStateRef.current = { projectId: currentProject.id, ready: false, targetSize: null };
        setCanvasName(currentProject.name || 'Untitled Design');
        if (currentProject.layersSnapshot) {
            try {
                const { layers: sl, activeLayerId: sa, canvasWidth: cw, canvasHeight: ch } = JSON.parse(currentProject.layersSnapshot);
                const normalizedLayers = (sl || []).map((layer) => {
                    if (layer?.type !== 'reference') return layer;
                    return {
                        ...layer,
                        locked: true,
                        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
                    };
                });
                loadAllLayers(normalizedLayers, sa);
                const normalized = sanitizeSnapshotCanvasSize(currentProject.layersSnapshot);
                if (normalized) setSavedCanvasSize(normalized);
                else if (cw && ch) setSavedCanvasSize({ width: cw, height: ch });
                else setSavedCanvasSize(null);
            } catch {
                loadAllLayers([], null);
                hydrationStateRef.current = { projectId: currentProject.id, ready: true, targetSize: null };
            }
        } else {
            loadAllLayers([], null);
            setSavedCanvasSize(null);
            hydrationStateRef.current = { projectId: currentProject.id, ready: true, targetSize: null };
        }
    }, [currentProject?.id]);

    // Reset the initial-fit flag whenever the user opens a different project or view.
    useEffect(() => {
        didInitialFitRef.current = false;
    }, [currentView, currentProject?.id]);

    // Apply saved canvas dimensions after canvas mounts/layers load.
    // layers.length stays in deps so this fires once the first layer arrives,
    // but didInitialFitRef prevents it from re-running on every subsequent addLayer.
    useEffect(() => {
        if (currentView !== 'canvas') return;
        if (!canvasRef.current) return;
        if (layers.length === 0) return;
        if (didInitialFitRef.current) return; // already fitted for this project

        didInitialFitRef.current = true;

        if (savedCanvasSize) {
            hydrationStateRef.current = {
                projectId: currentProject?.id || null,
                ready: false,
                targetSize: { width: savedCanvasSize.width, height: savedCanvasSize.height },
            };
            canvasRef.current.setCanvasSize(savedCanvasSize.width, savedCanvasSize.height, true);
            return;
        }

        // Default framing for projects without stored dimensions.
        requestAnimationFrame(() => {
            canvasRef.current?.fitToScreen();
            hydrationStateRef.current = { projectId: currentProject?.id || null, ready: true, targetSize: null };
        });
    }, [currentView, savedCanvasSize, layers.length]);

    // Keep canvas size pinned to reference content size immediately (no delayed snap-back).
    useEffect(() => {
        if (currentView !== 'canvas') return;
        if (!canvasRef.current) return;

        const referenceLayer = layers.find((l) => l?.type === 'reference');
        if (!referenceLayer) return;

        const targetW = Number(referenceLayer?.bounds?.width);
        const targetH = Number(referenceLayer?.bounds?.height);
        if (Number.isFinite(targetW) && Number.isFinite(targetH) && targetW > 0 && targetH > 0) {
            const roundedW = Math.round(targetW);
            const roundedH = Math.round(targetH);
            if (currentCanvasSize.width !== roundedW || currentCanvasSize.height !== roundedH) {
                canvasRef.current.setCanvasSize(roundedW, roundedH, false);
            }
            return;
        }

        // Fallback for snapshots where reference bounds are missing: derive from image itself.
        if (!referenceLayer?.canvasData) return;
        let cancelled = false;
        void getImageDimensions(referenceLayer.canvasData).then((dims) => {
            if (cancelled || !dims || !canvasRef.current) return;
            if (currentCanvasSize.width !== dims.width || currentCanvasSize.height !== dims.height) {
                canvasRef.current.setCanvasSize(dims.width, dims.height, false);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [currentView, currentCanvasSize.width, currentCanvasSize.height, layers]);

    // Only mark hydration complete after canvas reports the exact restored dimensions.
    useEffect(() => {
        if (currentView !== 'canvas' || !currentProject) return;

        const hs = hydrationStateRef.current;
        if (hs.ready || hs.projectId !== currentProject.id) return;
        if (!hs.targetSize) return;

        if (currentCanvasSize.width === hs.targetSize.width && currentCanvasSize.height === hs.targetSize.height) {
            hydrationStateRef.current = { projectId: currentProject.id, ready: true, targetSize: null };
        }
    }, [currentView, currentProject?.id, currentCanvasSize.width, currentCanvasSize.height]);

    // Auto-save layers 3 s after the last change while on the canvas view
    useEffect(() => {
        if (currentView !== 'canvas' || !currentProject) return;
        if (!hydrationStateRef.current.ready || hydrationStateRef.current.projectId !== currentProject.id) return;
        const tid = setTimeout(() => { void _saveProject(canvasName); }, 3000);
        return () => clearTimeout(tid);
    }, [layers]);

    // Save canvas dimensions too, even when only size changes.
    useEffect(() => {
        if (currentView !== 'canvas' || !currentProject) return;
        if (!hydrationStateRef.current.ready || hydrationStateRef.current.projectId !== currentProject.id) return;
        const tid = setTimeout(() => { void _saveProject(canvasName); }, 1200);
        return () => clearTimeout(tid);
    }, [currentCanvasSize.width, currentCanvasSize.height]);

    // Focus the canvas name input when editing starts
    useEffect(() => {
        if (nameEditing && canvasNameInputRef.current) {
            canvasNameInputRef.current.select();
        }
    }, [nameEditing]);

    // Refit canvas after the DOM reflows when live mode is toggled
    useEffect(() => {
        if (currentView !== 'canvas') return;
        const tid = setTimeout(() => canvasRef.current?.fitToScreen(), 80);
        return () => clearTimeout(tid);
    }, [liveMode]);
    // ──────────────────────────────────────────────────────────────────

    // ── Auth handlers ─────────────────────────────────────────────────
    const handleLogin = async (email, password) => {
        const user = await authLogin(email, password);   // throws on failure
        setCurrentUser(user);
        setCurrentView('home');
    };
    const handleSignup = async (email, password, name) => {
        const user = await authSignup(email, password, name);
        setCurrentUser(user);
        setCurrentView('home');
    };
    const handleLogout = async () => {
        await authLogout();
        setCurrentUser(null);
        setCurrentProject(null);
        loadAllLayers([], null);
        setCurrentView('login');
    };

    // ── Project handlers ──────────────────────────────────────────────
    /** Internal: persist current state to storage */
    const _saveProject = async (nameOverride, options = {}) => {
        const { showGlobalError = true } = options;
        if (!currentProject) return;
        const name = (nameOverride || canvasName || '').trim() || 'Untitled Design';
        const thumbnail = layers.find(l => l.thumbnail)?.thumbnail || null;
        const liveCanvasSize = canvasRef.current?.getCanvasSize?.();
        const hydrationReady = hydrationStateRef.current.ready && hydrationStateRef.current.projectId === currentProject.id;
        const hydrationTarget = hydrationStateRef.current.targetSize;
        let canvasWidth = hydrationReady
            ? (liveCanvasSize?.width || currentCanvasSize?.width || 1024)
            : (hydrationTarget?.width || savedCanvasSize?.width || liveCanvasSize?.width || currentCanvasSize?.width || 1024);
        let canvasHeight = hydrationReady
            ? (liveCanvasSize?.height || currentCanvasSize?.height || 1024)
            : (hydrationTarget?.height || savedCanvasSize?.height || liveCanvasSize?.height || currentCanvasSize?.height || 1024);

        // Canonical rule: if a reference layer exists, its true content size defines project canvas size.
        const referenceLayer = layers.find((l) => l?.type === 'reference');
        const refBoundsW = Number(referenceLayer?.bounds?.width);
        const refBoundsH = Number(referenceLayer?.bounds?.height);
        if (Number.isFinite(refBoundsW) && Number.isFinite(refBoundsH) && refBoundsW > 0 && refBoundsH > 0) {
            canvasWidth = Math.round(refBoundsW);
            canvasHeight = Math.round(refBoundsH);
        } else if (referenceLayer?.canvasData) {
            const dims = await getImageDimensions(referenceLayer.canvasData);
            if (dims?.width && dims?.height) {
                canvasWidth = dims.width;
                canvasHeight = dims.height;
            }
        }

        // Do not rewrite local saved size during autosave; it can trigger delayed visual snap-backs.
        try {
            await projectService.saveProject(currentProject.id, { name, thumbnail, layers, activeLayerId, canvasWidth, canvasHeight });
        } catch (err) {
            if (showGlobalError) {
                setError(err.message || 'Failed to save project');
            }
            throw err;
        }
    };

    const buildNextUntitledName = (projects = []) => {
        const baseName = 'Untitled Design';
        const re = /^untitled design(?:\s+(\d+))?$/i;
        const used = new Set();

        projects.forEach((p) => {
            const name = (p?.name || '').trim();
            const match = name.match(re);
            if (!match) return;
            if (!match[1]) {
                used.add(1);
                return;
            }
            const n = Number(match[1]);
            if (Number.isFinite(n) && n > 0) used.add(n);
        });

        if (!used.has(1)) return baseName;

        let suffix = 2;
        while (used.has(suffix)) suffix += 1;
        return `${baseName} ${suffix}`;
    };

    const handleNewProject = async () => {
        try {
            let knownProjects = userProjects;
            try {
                knownProjects = await projectService.getProjects();
                setUserProjects(knownProjects);
            } catch {
                // Fall back to currently loaded home list if refresh fails.
            }

            let projectName = buildNextUntitledName(knownProjects);
            let proj = null;

            for (let attempt = 0; attempt < 6; attempt += 1) {
                try {
                    proj = await projectService.createProject(projectName);
                    break;
                } catch (err) {
                    const isNameConflict = /already exists/i.test(err?.message || '');
                    if (!isNameConflict) throw err;

                    knownProjects = await projectService.getProjects();
                    setUserProjects(knownProjects);
                    projectName = buildNextUntitledName(knownProjects);
                }
            }

            if (!proj) {
                throw new Error('Failed to create a unique untitled project name');
            }

            hydrationStateRef.current = { projectId: proj.id, ready: true, targetSize: null };
            setCurrentProject(proj);
            setCanvasName(proj.name);
            setSavedCanvasSize(null);
            loadAllLayers([], null);
            setCurrentView('canvas');
        } catch (err) {
            window.alert(err.message || 'Failed to create project');
        }
    };

    const getImageDimensions = (src) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.width, height: img.height });
        img.onerror = () => resolve(null);
        img.src = src;
    });

    const sanitizeSnapshotCanvasSize = (snapshotRaw) => {
        if (!snapshotRaw) return null;
        try {
            const parsed = JSON.parse(snapshotRaw);
            const refLayer = (parsed?.layers || []).find((l) => l?.type === 'reference');
            const bw = Number(refLayer?.bounds?.width);
            const bh = Number(refLayer?.bounds?.height);
            if (Number.isFinite(bw) && Number.isFinite(bh) && bw > 0 && bh > 0) {
                return { width: Math.round(bw), height: Math.round(bh) };
            }

            const cw = Number(parsed?.canvasWidth);
            const ch = Number(parsed?.canvasHeight);
            if (Number.isFinite(cw) && Number.isFinite(ch) && cw > 0 && ch > 0) {
                return { width: Math.round(cw), height: Math.round(ch) };
            }

            return null;
        } catch {
            return null;
        }
    };

    const normalizeLegacySnapshotSize = async (snapshotRaw) => {
        if (!snapshotRaw) return snapshotRaw;
        try {
            const parsed = JSON.parse(snapshotRaw);
            const layersInSnapshot = parsed.layers || [];
            const refLayer = layersInSnapshot.find((l) => l.type === 'reference' && l.canvasData);
            if (refLayer) {
                // Prefer persisted bounds because they represent actual reference content.
                const boundsW = Number(refLayer?.bounds?.width);
                const boundsH = Number(refLayer?.bounds?.height);
                if (Number.isFinite(boundsW) && Number.isFinite(boundsH) && boundsW > 0 && boundsH > 0) {
                    parsed.canvasWidth = Math.round(boundsW);
                    parsed.canvasHeight = Math.round(boundsH);
                } else {
                    const dims = await getImageDimensions(refLayer.canvasData);
                    if (dims) {
                        // Keep canvas locked to reference dimensions to prevent reopen drift.
                        parsed.canvasWidth = dims.width;
                        parsed.canvasHeight = dims.height;
                    }
                }

                // Reference layer should stay anchored on reopen.
                refLayer.transform = { x: 0, y: 0, scale: 1, rotation: 0 };
                refLayer.locked = true;
            }

            const sanitizedSize = sanitizeSnapshotCanvasSize(JSON.stringify(parsed));
            if (sanitizedSize) {
                parsed.canvasWidth = sanitizedSize.width;
                parsed.canvasHeight = sanitizedSize.height;
            }

            return JSON.stringify(parsed);
        } catch {
            return snapshotRaw;
        }
    };

    const handleOpenProject = async (proj) => {
        // Avoid carrying size state from the previously-opened project.
        setSavedCanvasSize(null);
        hydrationStateRef.current = { projectId: proj.id, ready: false, targetSize: null };
        const fullProject = await projectService.getProject(proj.id);
        const fixedSnapshot = await normalizeLegacySnapshotSize(fullProject.layersSnapshot);
        setCurrentProject({ ...fullProject, layersSnapshot: fixedSnapshot });
        setCanvasName(fullProject.name);
        setCurrentView('canvas');
    };
    const handleDeleteProject = async (projectId) => {
        await projectService.deleteProject(projectId);
        const projects = await projectService.getProjects();
        setUserProjects(projects);
    };
    const handleRenameProject = async (projectId, newName) => {
        await projectService.renameProject(projectId, newName);
        const projects = await projectService.getProjects();
        setUserProjects(projects);
    };
    const handleBackToHome = async () => {
        const hasContent = layers.some(l => l.type === 'reference' || (l.type === 'drawing' && l.canvasData));
        if (!hasContent && currentProject) {
            try {
                await projectService.deleteProject(currentProject.id);
            } catch (e) {
                console.error('Failed to delete empty project', e);
            }
        } else {
            await _saveProject();
        }
        setCurrentView('home');
    };

    // ── Canvas name handlers ──────────────────────────────────────────
    const handleNameCommit = async () => {
        const trimmed = (canvasName || '').trim() || 'Untitled Design';
        setCanvasName(trimmed);
        try {
            await _saveProject(trimmed, { showGlobalError: false });
            setCanvasNameError('');
            setNameEditing(false);
        } catch (err) {
            setCanvasNameError(err.message || 'Name unavailable');
            setNameEditing(true);
            setTimeout(() => canvasNameInputRef.current?.focus(), 0);
        }
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

    const handleUndo = async () => {
        if (!canvasRef.current) return;
        await canvasRef.current.undoActiveLayer?.();
    };

    const handleRedo = async () => {
        if (!canvasRef.current) return;
        await canvasRef.current.redoActiveLayer?.();
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
                    // Ensure the layer's transform is reset to default so it isn't applied twice,
                    // since canvasRef.current.getLayerBlob already bakes the transform into the pixels!
                    const freshUrl = URL.createObjectURL(blob);
                    updateLayer(referenceLayer.id, {
                        canvasData: freshUrl,
                        thumbnail: freshUrl,
                        transform: { x: 0, y: 0, scale: 1 }
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
            
            let targetLayer = getReferenceLayer();
            
            // If somehow there's no reference layer, fallback to active layer or the first layer
            if (!targetLayer && layers.length > 0) {
                targetLayer = layers.find(l => l.id === activeLayerId) || layers[0];
            }

            if (targetLayer) {
                // Use shouldResizeCanvas=false: the canvas is already sized to the reference image.
                // We want the StyleGAN result to FIT inside existing canvas bounds, not resize the canvas.
                setTimeout(async () => {
                    if (canvasRef.current) {
                        await canvasRef.current.loadImageToLayer(targetLayer.id, blob, false);
                        
                        const freshUrl = URL.createObjectURL(blob);
                        updateLayer(targetLayer.id, {
                            canvasData: freshUrl,
                            thumbnail: freshUrl,
                            // Standard reset transform
                            transform: { x: 0, y: 0, scale: 1, rotation: 0 }
                        });
                    }
                }, 50);
                console.log('✅ Stylebend result applied to target layer');
            } else {
                // Absolute fallback: create a new reference layer and resize canvas to image
                const objectUrl = URL.createObjectURL(blob);
                const newLayer = addLayer('reference', `Blended Style`);
                setTimeout(async () => {
                    if (canvasRef.current) {
                        await canvasRef.current.loadImageToLayer(newLayer.id, blob, true);
                        updateLayer(newLayer.id, {
                            canvasData: objectUrl,
                            thumbnail: objectUrl,
                            transform: { x: 0, y: 0, scale: 1, rotation: 0 }
                        });
                    }
                }, 50);
                console.log('✅ Stylebend result applied to new reference layer');
            }
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
                            thumbnail: objectUrl,
                            // Reset transform
                            transform: { x: 0, y: 0, scale: 1, rotation: 0 }
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

    // Convert reference clothing image into an editable doodle on a NEW drawing layer.
    const handleExtractDoodle = async (refLayer) => {
        try {
            if (!refLayer) return;

            // Source the highest-quality bytes available for the reference layer.
            let srcBlob = null;
            if (canvasRef.current?.getLayerBlob) {
                srcBlob = await canvasRef.current.getLayerBlob(refLayer.id);
            }
            if (!srcBlob) {
                const srcUrl = refLayer.canvasData || refLayer.thumbnail;
                if (!srcUrl) {
                    setError('Reference layer has no image to convert.');
                    return;
                }
                const res = await fetch(srcUrl);
                srcBlob = await res.blob();
            }

            const doodleBlob = await extractDoodle(srcBlob, 6);
            const newLayer = addLayer('drawing', `${refLayer.name || 'Reference'} Doodle`);

            // Wait for the new layer's canvas to mount, then paint the doodle onto it
            // so the user can immediately brush-edit on top.
            setTimeout(async () => {
                if (canvasRef.current?.loadImageToLayer) {
                    await canvasRef.current.loadImageToLayer(newLayer.id, doodleBlob, false);
                }
                const objUrl = URL.createObjectURL(doodleBlob);
                updateLayer(newLayer.id, {
                    canvasData: objUrl,
                    thumbnail: objUrl,
                });
                setActiveLayerId(newLayer.id);
            }, 60);
        } catch (err) {
            console.error('Error extracting doodle:', err);
            setError(err.message || 'Failed to convert reference to doodle');
        }
    };

    const handleApplyTextToClothes = async (resultUrl) => {
        try {
            const res = await fetch(resultUrl);
            const blob = await res.blob();
            const referenceLayer = getReferenceLayer();
            if (!referenceLayer) return;
            setTimeout(async () => {
                if (canvasRef.current) {
                    await canvasRef.current.loadImageToLayer(referenceLayer.id, blob, false);
                    const freshUrl = URL.createObjectURL(blob);
                    updateLayer(referenceLayer.id, {
                        canvasData: freshUrl,
                        thumbnail: freshUrl,
                        transform: { x: 0, y: 0, scale: 1 },
                    });
                }
            }, 50);
        } catch (err) {
            console.error('Error applying Text-to-Clothes result:', err);
            setError('Failed to apply Text-to-Clothes result');
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
            onUserUpdate={setCurrentUser}
            isDark={isDark}
            onToggleDark={toggleDark}
        />
    );
    
    return (
        <div className="app">
            {/* Left Sidebar Column */}
            <div className="toolbar-column">
                <button className="app-back-btn home-sidebar-btn" onClick={handleBackToHome} title="Back to Home">
                    <ClothCraftLogo size={34} color="black" />
                </button>

                <div className="toolbar-column-divider" />

                <button
                    className="home-sidebar-btn"
                    onClick={toggleDark}
                    title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                    style={{ color: isDark ? '#f9cc46' : '#7c3aed' }}
                >
                    {isDark ? <Sun size={20} /> : <Moon size={20} />}
                </button>

                <div className="toolbar-column-divider" />

                <Toolbar
                    activeTool={activeTool}
                    onToolChange={setActiveTool}
                    brushColor={brushColor}
                    onColorChange={setBrushColor}
                    moodboardColors={moodboardColors}
                    onOpenMoodboard={handleOpenMoodboard}
                    onUndo={handleUndo}
                    onRedo={handleRedo}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    disabled={isProcessing || !activeLayerId}
                    liveMode={liveMode}
                    onLiveModeToggle={() => setLiveMode(m => !m)}
                />
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
                <div className={`app-canvas-area${liveMode && layers.length > 0 ? ' live-mode' : ''}`}>
                    <div className="live-canvas-side">
                        {layers.length > 0 && (
                            <div className="canvas-title-bar glass-panel">
                                {nameEditing ? (
                                    <div className="canvas-title-edit-wrap">
                                        <input
                                            ref={canvasNameInputRef}
                                            className="canvas-title-input"
                                            value={canvasName}
                                            onChange={(e) => {
                                                setCanvasName(e.target.value);
                                                if (canvasNameError) setCanvasNameError('');
                                            }}
                                            onBlur={() => { void handleNameCommit(); }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') { e.preventDefault(); void handleNameCommit(); }
                                                if (e.key === 'Escape') {
                                                    setNameEditing(false);
                                                    setCanvasNameError('');
                                                    setCanvasName(currentProject?.name || 'Untitled Design');
                                                }
                                            }}
                                            maxLength={120}
                                        />
                                        {canvasNameError && <span className="canvas-title-error-tag">{canvasNameError}</span>}
                                    </div>
                                ) : (
                                    <button
                                        className="canvas-title-button"
                                        onClick={() => { setCanvasNameError(''); setNameEditing(true); }}
                                        title="Rename project"
                                    >
                                        {canvasName || 'Untitled Design'}
                                    </button>
                                )}
                            </div>
                        )}

                        {layers.length > 0 ? (
                            <MultiLayerCanvas
                                ref={canvasRef}
                                layers={layers}
                                activeLayerId={activeLayerId}
                                brushSize={activeTool === 'eraser' ? eraserSize : brushSize}
                                brushColor={brushColor}
                                activeTool={activeTool}
                                onLayerUpdate={handleLayerUpdate}
                                onCanvasSizeChange={setCurrentCanvasSize}
                                onHistoryStateChange={setHistoryState}
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

                    {liveMode && layers.length > 0 && (
                        <LivePreviewPane
                            layers={layers}
                            canvasRef={canvasRef}
                            canvasSize={currentCanvasSize}
                        />
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
                        onReorderLayers={reorderLayers}
                        onDuplicateLayer={duplicateLayer}
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
                        onTextToClothes={() => setShowTextToClothes(true)}
                        onExtractDoodle={handleExtractDoodle}
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

            {/* Text to Clothes Modal */}
            {
                showTextToClothes && (
                    <TextToClothesModal
                        referenceLayer={getReferenceLayer()}
                        onClose={() => setShowTextToClothes(false)}
                        onApply={handleApplyTextToClothes}
                    />
                )
            }
        </div >
    );
}

export default App;
