import { useState, useCallback } from 'react';

/**
 * Custom hook for managing layers in the drawing application
 */
export const useLayerManager = () => {
  const [layers, setLayers] = useState([]);
  const [activeLayerId, setActiveLayerId] = useState(null);

  // Add a new layer
  const addLayer = useCallback((type = 'drawing', name = null) => {
    const newLayer = {
      id: `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: name || `Layer ${layers.length + 1}`,
      type, // 'reference' or 'drawing'
      visible: true,
      locked: type === 'reference', // Default to locked for reference, but allow unlocking
      thumbnail: null,
      canvasData: null,
      opacity: 1.0,
      blendMode: 'source-over', // Default blend mode
      transform: { x: 0, y: 0, scale: 1, rotation: 0 } // Add transform state
    };
    
    setLayers(prev => [...prev, newLayer]);
    // Always set active, even for reference if added manually (though usually ref is first)
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

  // Reorder layers
  const reorderLayers = useCallback((fromIndex, toIndex) => {
    setLayers(prev => {
      const newLayers = [...prev];
      
      // Prevent moving the reference layer (assuming it's always at index 0)
      if (newLayers[fromIndex].type === 'reference') return prev;
      
      // Prevent moving anything below the reference layer (index 0)
      // If we try to move to index 0, move to index 1 instead
      const targetIndex = newLayers[toIndex]?.type === 'reference' ? 1 : toIndex;
      
      // If trying to move to 0 and 0 is reference, we already handled it. 
      // But if we are just swapping, we need to be careful.
      // Actually, let's just say index 0 is reserved for reference if it exists.
      const hasReference = newLayers.some(l => l.type === 'reference');
      if (hasReference && targetIndex === 0) return prev;

      const [movedLayer] = newLayers.splice(fromIndex, 1);
      newLayers.splice(targetIndex, 0, movedLayer);
      return newLayers;
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
    getActiveLayer,
    getReferenceLayer,
    getVisibleLayers,
    clearDrawingLayers,
  };
};
