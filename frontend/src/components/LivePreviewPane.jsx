import React, { useEffect, useRef, useState } from 'react';
import API_BASE, { NGROK_HEADERS } from '../config.js';
import './LivePreviewPane.css';

// Content-hash cache: avoids re-running Pix2Pix on unchanged layers
const resultCache = new Map(); // hex hash → result blob URL
const MAX_CACHE = 30;

async function hashBlob(blob) {
  const buf = await blob.arrayBuffer();
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function downscaleBlob(blob, maxSize = 512) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(maxSize / bitmap.width, maxSize / bitmap.height, 1);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise(res => cv.toBlob(res, 'image/png'));
}

async function sendToPix2Pix(blob) {
  const small = await downscaleBlob(blob, 512);
  const hash = await hashBlob(small);

  if (resultCache.has(hash)) return resultCache.get(hash);

  const formData = new FormData();
  formData.append('file', small, 'doodle.png');
  const res = await fetch(`${API_BASE}/translate-doodle?rgba=true&fast=true`, {
    method: 'POST',
    headers: NGROK_HEADERS,
    body: formData,
  });
  if (!res.ok) throw new Error(`Pix2Pix server error ${res.status}`);
  const resultBlob = await res.blob();
  const url = URL.createObjectURL(resultBlob);

  if (resultCache.size >= MAX_CACHE) {
    const oldest = resultCache.keys().next().value;
    URL.revokeObjectURL(resultCache.get(oldest));
    resultCache.delete(oldest);
  }
  resultCache.set(hash, url);
  return url;
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

        const drawingLayers = layers.filter(l => l.type !== 'reference' && l.visible);

        // Fetch all layer blobs first (must be sequential — canvas access)
        const layerBlobs = [];
        for (const layer of drawingLayers) {
          if (gen !== genRef.current) return;
          const blob = await canvasRef.current.getLayerBlob(layer.id);
          layerBlobs.push({ layer, blob });
        }

        if (gen !== genRef.current) return;

        // Translate all layers in parallel (Pix2Pix calls are independent)
        const translations = await Promise.allSettled(
          layerBlobs.map(({ layer, blob }) =>
            blob ? sendToPix2Pix(blob).then(url => ({ layer, url })) : Promise.resolve(null)
          )
        );

        if (gen !== genRef.current) return;

        // Composite results in layer order
        let processed = 0;
        for (const result of translations) {
          if (result.status === 'fulfilled' && result.value) {
            const { layer, url } = result.value;
            const img = await loadImage(url);
            ctx.globalAlpha = layer.opacity ?? 1;
            ctx.globalCompositeOperation = layer.blendMode || 'source-over';
            ctx.drawImage(img, 0, 0, width, height);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
            processed++;
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
    }, 700);

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
