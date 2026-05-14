/**
 * useLayerManager — central state for the layer stack.
 *
 * Owns the entire layers array and the active layer ID. All mutations go
 * through the callbacks returned here; no component writes to layers directly.
 *
 * Layer shape:
 * {
 *   id:        string  — "layer-<timestamp>-<random9chars>"
 *   name:      string
 *   type:      'reference' | 'drawing'
 *   visible:   boolean
 *   locked:    boolean  — reference layers start locked
 *   thumbnail: string   — 480x480 data URL for the layers panel preview
 *   canvasData:string   — full-resolution PNG data URL or object URL
 *   opacity:   number   — 0.0 to 1.0
 *   blendMode: string   — CSS globalCompositeOperation value
 *   transform: { x, y, scale, rotation }
 * }
 *
 * Stack ordering convention:
 *   layers[0] = reference image (pinned at the bottom of the visual stack)
 *   layers[1..n] = drawing layers rendered on top, in ascending z-order
 */
import { useState, useCallback } from 'react';

export const useLayerManager = () => {
  const [layers, setLayers] = useState([]);
  const [activeLayerId, setActiveLayerId] = useState(null);

  /**
   * Create a new layer and push it onto the top of the stack.
   * Returns the new layer object synchronously so callers can immediately
   * use its id (e.g. to load an image onto it via MultiLayerCanvas).
   *
   * NOTE: addLayer depends on layers.length so its reference changes whenever
   * the stack grows. Callers that hold a stale closure (e.g. setTimeout) must
   * read the latest version from state, not capture the callback at mount time.
   */
  const addLayer = useCallback((type = 'drawing', name = null) => {
    const newLayer = {
      // Use timestamp + random suffix to guarantee uniqueness even when
      // multiple layers are added within the same millisecond.
      id: `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: name || `Layer ${layers.length + 1}`,
      type, // 'reference' or 'drawing'
      visible: true,
      locked: type === 'reference', // Reference images start locked to prevent accidental edits.
      thumbnail: null,
      canvasData: null,
      opacity: 1.0,
      blendMode: 'source-over', // CSS globalCompositeOperation; matches canvas default.
      transform: { x: 0, y: 0, scale: 1, rotation: 0 }
    };

    setLayers(prev => [...prev, newLayer]);
    setActiveLayerId(newLayer.id);
    return newLayer;
  }, [layers.length]);

  // Remove a layer
  const removeLayer = useCallback((layerId) => {
    setLayers(prev => prev.filter(layer => layer.id !== layerId));
    if (activeLayerId === layerId) {
      setActiveLayerId(null);
    }
  }, [activeLayerId]);

  // Update layer properties
  const updateLayer = useCallback((layerId, updates) => {
    setLayers(prev => prev.map(layer => 
      layer.id === layerId ? { ...layer, ...updates } : layer
    ));
  }, []);

  // Toggle layer visibility
  const toggleLayerVisibility = useCallback((layerId) => {
    setLayers(prev => prev.map(layer => 
      layer.id === layerId ? { ...layer, visible: !layer.visible } : layer
    ));
  }, []);

  // Toggle layer lock
  const toggleLayerLock = useCallback((layerId) => {
    setLayers(prev => prev.map(layer => 
      layer.id === layerId 
        ? { ...layer, locked: !layer.locked } 
        : layer
    ));
  }, []);

  /**
   * Move a layer from fromIndex to toIndex in the layers array.
   * The reference layer (index 0) is immovable; drawing layers cannot be
   * placed below it. The UI calls this after a drag-and-drop reorder.
   */
  const reorderLayers = useCallback((fromIndex, toIndex) => {
    setLayers(prev => {
      const newLayers = [...prev];

      // The reference layer is always pinned at the bottom of the stack.
      if (newLayers[fromIndex].type === 'reference') return prev;

      // Clamp the target to above the reference layer.
      const targetIndex = newLayers[toIndex]?.type === 'reference' ? 1 : toIndex;
      const hasReference = newLayers.some(l => l.type === 'reference');
      if (hasReference && targetIndex === 0) return prev;

      // Remove the layer from its current position and re-insert at the target.
      // The insertion index shifts by -1 when moving downward because the
      // splice(fromIndex, 1) shortens the array before the insert position.
      const [movedLayer] = newLayers.splice(fromIndex, 1);
      const insertionIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
      newLayers.splice(insertionIndex, 0, movedLayer);
      return newLayers;
    });
  }, []);

  // Duplicate a layer and place the copy directly above the source layer
  const duplicateLayer = useCallback((layerId) => {
    setLayers((prev) => {
      const sourceIndex = prev.findIndex((layer) => layer.id === layerId);
      if (sourceIndex === -1) return prev;

      const sourceLayer = prev[sourceIndex];
      if (sourceLayer.type === 'reference') return prev;

      const duplicated = {
        ...sourceLayer,
        id: `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: `${sourceLayer.name} Copy`,
      };

      const next = [...prev];
      next.splice(sourceIndex + 1, 0, duplicated);
      setActiveLayerId(duplicated.id);
      return next;
    });
  }, []);

  // Move a drawing layer one step up in stack order
  const moveLayerUp = useCallback((layerId) => {
    setLayers((prev) => {
      const fromIndex = prev.findIndex((layer) => layer.id === layerId);
      if (fromIndex === -1) return prev;

      const fromLayer = prev[fromIndex];
      if (fromLayer.type === 'reference') return prev;

      let toIndex = -1;
      for (let i = fromIndex + 1; i < prev.length; i += 1) {
        if (prev[i].type !== 'reference') {
          toIndex = i;
          break;
        }
      }

      if (toIndex === -1) return prev;

      const next = [...prev];
      [next[fromIndex], next[toIndex]] = [next[toIndex], next[fromIndex]];
      return next;
    });
  }, []);

  // Move a drawing layer one step down in stack order
  const moveLayerDown = useCallback((layerId) => {
    setLayers((prev) => {
      const fromIndex = prev.findIndex((layer) => layer.id === layerId);
      if (fromIndex === -1) return prev;

      const fromLayer = prev[fromIndex];
      if (fromLayer.type === 'reference') return prev;

      let toIndex = -1;
      for (let i = fromIndex - 1; i >= 0; i -= 1) {
        if (prev[i].type !== 'reference') {
          toIndex = i;
          break;
        }
      }

      if (toIndex === -1) return prev;

      const next = [...prev];
      [next[fromIndex], next[toIndex]] = [next[toIndex], next[fromIndex]];
      return next;
    });
  }, []);

  // Get active layer
  const getActiveLayer = useCallback(() => {
    return layers.find(layer => layer.id === activeLayerId);
  }, [layers, activeLayerId]);

  // Get reference layer
  const getReferenceLayer = useCallback(() => {
    return layers.find(layer => layer.type === 'reference');
  }, [layers]);

  // Get visible layers
  const getVisibleLayers = useCallback(() => {
    return layers.filter(layer => layer.visible);
  }, [layers]);

  // Clear all drawing layers
  const clearDrawingLayers = useCallback(() => {
    setLayers(prev => prev.filter(layer => layer.type === 'reference'));
    // If reference exists, make it active, otherwise null
    setLayers(prev => {
        const ref = prev.find(l => l.type === 'reference');
        if (ref) setActiveLayerId(ref.id);
        else setActiveLayerId(null);
        return prev;
    });
  }, []);

  /**
   * Replace the entire layer stack at once — used when opening a saved project.
   * Falls back to activating the first layer if the saved active ID is absent,
   * which handles legacy projects created before activeLayerId was persisted.
   *
   * @param {Array}       newLayers   - Layers deserialized from layersSnapshot
   * @param {string|null} newActiveId - Previously active layer ID
   */
  const loadAllLayers = useCallback((newLayers, newActiveId) => {
    setLayers(newLayers || []);
    setActiveLayerId(newActiveId || newLayers?.[0]?.id || null);
  }, []);

  return {
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
    moveLayerUp,
    moveLayerDown,
    getActiveLayer,
    getReferenceLayer,
    getVisibleLayers,
    clearDrawingLayers,
    loadAllLayers,
  };
};
