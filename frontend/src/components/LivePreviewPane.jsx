import React, { useEffect, useRef, useState } from 'react';
import './LivePreviewPane.css';

async function sendToPix2Pix(blob) {
  const formData = new FormData();
  formData.append('file', blob, 'doodle.png');
  // rgba=true → backend returns RGBA PNG with real rembg transparency.
  // No brightness-threshold stripping needed, so dark colours have no holes
  // and light colours have no black fringe.
  const res = await fetch('http://127.0.0.1:5001/translate-doodle?rgba=true', {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error(`Pix2Pix server error ${res.status}`);
  return res.blob();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = src;
  });
}

const LivePreviewPane = ({ layers, canvasRef, canvasSize }) => {
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [layerCount, setLayerCount] = useState(0);
  const [error, setError] = useState(null);
  const genRef = useRef(0);
  const debounceRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!canvasRef.current) return;
      const gen = ++genRef.current;

      setLoading(true);
      setError(null);

      try {
        const { width, height } = canvasSize;
        const outCanvas = document.createElement('canvas');
        outCanvas.width = width;
        outCanvas.height = height;
        const ctx = outCanvas.getContext('2d');

        // Draw reference layer as background
        const refLayer = layers.find(l => l.type === 'reference' && l.visible);
        if (refLayer?.canvasData) {
          const refImg = await loadImage(refLayer.canvasData);
          ctx.globalAlpha = refLayer.opacity ?? 1;
          ctx.drawImage(refImg, 0, 0, width, height);
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
        }

        // Each visible drawing layer is processed independently through Pix2Pix
        const drawingLayers = layers.filter(l => l.type !== 'reference' && l.visible);
        let processed = 0;

        for (const layer of drawingLayers) {
          if (gen !== genRef.current) return;

          const blob = await canvasRef.current.getLayerBlob(layer.id);
          if (!blob || gen !== genRef.current) return;

          let translatedBlob;
          try {
            translatedBlob = await sendToPix2Pix(blob);
          } catch {
            continue;
          }
          if (gen !== genRef.current) return;

          const translatedUrl = URL.createObjectURL(translatedBlob);
          try {
            const img = await loadImage(translatedUrl);
            ctx.globalAlpha = layer.opacity ?? 1;
            ctx.globalCompositeOperation = layer.blendMode || 'source-over';
            ctx.drawImage(img, 0, 0, width, height);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
            processed++;
          } finally {
            URL.revokeObjectURL(translatedUrl);
          }
        }

        if (gen !== genRef.current) return;
        setLayerCount(processed);
        setPreviewUrl(outCanvas.toDataURL('image/jpeg', 0.88));
      } catch (err) {
        if (gen === genRef.current) setError('Preview failed — is the backend running?');
      } finally {
        if (gen === genRef.current) setLoading(false);
      }
    }, 650);

    return () => clearTimeout(debounceRef.current);
  }, [layers, canvasSize.width, canvasSize.height]);

  return (
    <div className="live-preview-pane">
      <div className="live-preview-header">
        <span className="live-preview-label">Pix2Pix Preview</span>
        <div className="live-preview-meta">
          {!loading && previewUrl && layerCount > 0 && (
            <span className="live-preview-layer-count">{layerCount} layer{layerCount !== 1 ? 's' : ''}</span>
          )}
          {loading && <span className="live-preview-spinner" />}
        </div>
      </div>
      <div className="live-preview-body">
        {error ? (
          <p className="live-preview-message live-preview-error">{error}</p>
        ) : previewUrl ? (
          <img className="live-preview-img" src={previewUrl} alt="Pix2Pix live preview" />
        ) : (
          <p className="live-preview-message">
            {loading ? 'Processing layers…' : 'Draw on the canvas to see a live Pix2Pix preview'}
          </p>
        )}
      </div>
    </div>
  );
};

export default LivePreviewPane;
