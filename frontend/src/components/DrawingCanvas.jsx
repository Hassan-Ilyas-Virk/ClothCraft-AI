import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import './DrawingCanvas.css';
import {
  blobToImage,
  loadImageToCanvas
} from '../utils/imageProcessing';

const DrawingCanvas = forwardRef(({ referenceImage, brushSize, brushColor }, ref) => {
  const containerRef = useRef(null);
  const referenceCanvasRef = useRef(null);
  const doodleCanvasRef = useRef(null);
  const compositeCanvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // Initialize canvases when reference image changes
  useEffect(() => {
    if (referenceImage && referenceCanvasRef.current) {
      const canvas = referenceCanvasRef.current;
      const ctx = canvas.getContext('2d');

      // Calculate canvas size to fit within container while maintaining aspect ratio
      const maxWidth = 800;
      const maxHeight = 600;
      let width = referenceImage.width;
      let height = referenceImage.height;

      const aspectRatio = width / height;
      if (width > maxWidth) {
        width = maxWidth;
        height = width / aspectRatio;
      }
      if (height > maxHeight) {
        height = maxHeight;
        width = height * aspectRatio;
      }

      // Set canvas dimensions
      canvas.width = width;
      canvas.height = height;
      
      // Draw reference image
      ctx.drawImage(referenceImage, 0, 0, width, height);
      
      setCanvasSize({ width, height });

      // Initialize doodle canvas with same dimensions
      if (doodleCanvasRef.current) {
        const doodleCanvas = doodleCanvasRef.current;
        doodleCanvas.width = width;
        doodleCanvas.height = height;
      }

      // Initialize composite canvas with same dimensions
      if (compositeCanvasRef.current) {
        const compositeCanvas = compositeCanvasRef.current;
        compositeCanvas.width = width;
        compositeCanvas.height = height;
      }
    }
  }, [referenceImage]);

  // Drawing functions
  const startDrawing = (e) => {
    setIsDrawing(true);
    draw(e);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    const ctx = doodleCanvasRef.current.getContext('2d');
    ctx.beginPath();
  };

  const draw = (e) => {
    if (!isDrawing && e.type !== 'mousedown' && e.type !== 'touchstart') return;

    const canvas = doodleCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();

    let x, y;
    if (e.type.startsWith('touch')) {
      e.preventDefault();
      const touch = e.touches[0] || e.changedTouches[0];
      x = touch.clientX - rect.left;
      y = touch.clientY - rect.top;
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }

    // Scale coordinates to canvas size
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    x *= scaleX;
    y *= scaleY;

    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.strokeStyle = brushColor;

    if (e.type === 'mousedown' || e.type === 'touchstart') {
      ctx.beginPath();
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
  };

  // Expose methods to parent component via ref
  useImperativeHandle(ref, () => ({
    // Get ONLY the doodle for sending to Pix2Pix
    getDoodleImage: () => {
      return new Promise((resolve) => {
        doodleCanvasRef.current.toBlob(resolve, 'image/png');
      });
    },

    // Get the reference image for inpainting
    getReferenceImage: () => {
      return new Promise((resolve) => {
        referenceCanvasRef.current.toBlob(resolve, 'image/png');
      });
    },

    // Apply final inpainted result from Stable Diffusion
    applyInpaintedResult: async (inpaintedBlob) => {
      try {
        console.log('📥 Received inpainted result from Stable Diffusion');
        
        // Convert blob to image
        const inpaintedImage = await blobToImage(inpaintedBlob);
        console.log(`📐 Inpainted image size: ${inpaintedImage.width}x${inpaintedImage.height}`);

        // Display the inpainted result on the composite canvas
        const compositeCtx = compositeCanvasRef.current.getContext('2d');
        compositeCtx.clearRect(0, 0, canvasSize.width, canvasSize.height);
        
        // Draw the inpainted image (which already includes the reference + inpainted areas)
        compositeCtx.drawImage(
          inpaintedImage,
          0, 0, inpaintedImage.width, inpaintedImage.height,
          0, 0, canvasSize.width, canvasSize.height
        );

        console.log('✅ Inpainted result displayed!');
        console.log('   - Stable Diffusion inpainting complete');
        console.log('   - Areas where doodle was drawn have been inpainted');

        // Clear the original doodle canvas
        const doodleCtx = doodleCanvasRef.current.getContext('2d');
        doodleCtx.clearRect(0, 0, canvasSize.width, canvasSize.height);

      } catch (error) {
        console.error('❌ Error applying inpainted result:', error);
        throw error;
      }
    },

    // Clear the doodle layer
    clearDoodle: () => {
      const ctx = doodleCanvasRef.current.getContext('2d');
      ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
      
      // Also clear the composite canvas
      const compositeCtx = compositeCanvasRef.current.getContext('2d');
      compositeCtx.clearRect(0, 0, canvasSize.width, canvasSize.height);
    },

    // Reset everything
    reset: () => {
      if (doodleCanvasRef.current) {
        const doodleCtx = doodleCanvasRef.current.getContext('2d');
        doodleCtx.clearRect(0, 0, canvasSize.width, canvasSize.height);
      }
      if (compositeCanvasRef.current) {
        const compositeCtx = compositeCanvasRef.current.getContext('2d');
        compositeCtx.clearRect(0, 0, canvasSize.width, canvasSize.height);
      }
    }
  }));

  return (
    <div className="drawing-canvas-container" ref={containerRef}>
      <div className="canvas-wrapper" style={{ width: canvasSize.width, height: canvasSize.height }}>
        {/* Reference image layer (background, never changes) */}
        <canvas
          ref={referenceCanvasRef}
          className="canvas-layer reference-canvas"
        />
        
        {/* Composite layer (shows processed result) */}
        <canvas
          ref={compositeCanvasRef}
          className="canvas-layer composite-canvas"
        />
        
        {/* Doodle layer (transparent, for drawing) */}
        <canvas
          ref={doodleCanvasRef}
          className="canvas-layer doodle-canvas"
          onMouseDown={startDrawing}
          onMouseUp={stopDrawing}
          onMouseMove={draw}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchEnd={stopDrawing}
          onTouchMove={draw}
        />
      </div>
    </div>
  );
});

DrawingCanvas.displayName = 'DrawingCanvas';

export default DrawingCanvas;

