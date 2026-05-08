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

/**
 * Composite translated Pix2Pix result onto the output canvas using the same
 * pixel-level logic as the Clothify pipeline (compositeTranslatedDoodleOnReference).
 * Handles dark doodle colors correctly by checking the original doodle brightness.
 */
function compositeTranslatedLayer(ctx, translatedImg, doodleImg, width, height, opacity) {
  // Draw doodle onto a temp canvas to read its pixels
  const doodleCv = document.createElement('canvas');
  doodleCv.width = width; doodleCv.height = height;
  const doodleCtx = doodleCv.getContext('2d');
  doodleCtx.drawImage(doodleImg, 0, 0, width, height);
  const doodleData = doodleCtx.getImageData(0, 0, width, height);

  // Draw translated result onto a temp canvas to read its pixels
  const transCv = document.createElement('canvas');
  transCv.width = width; transCv.height = height;
  const transCtx = transCv.getContext('2d');
  transCtx.drawImage(translatedImg, 0, 0, width, height);
  const transData = transCtx.getImageData(0, 0, width, height);

  // Read current composite (reference already drawn)
  const compositeData = ctx.getImageData(0, 0, width, height);

  const BLACK_THRESHOLD = 50;
  const DARK_THRESHOLD = 40;
  const EDGE_ALPHA_MIN = 30;
  const EDGE_ALPHA_SOFT = 200;

  for (let i = 0; i < doodleData.data.length; i += 4) {
    const originalAlpha = doodleData.data[i + 3];

    if (originalAlpha > EDGE_ALPHA_MIN) {
      // Check if original doodle was dark
      const origR = doodleData.data[i];
      const origG = doodleData.data[i + 1];
      const origB = doodleData.data[i + 2];
      const originalBrightness = origR * 0.299 + origG * 0.587 + origB * 0.114;
      const originalWasDark = originalBrightness < 100;

      const transR = transData.data[i];
      const transG = transData.data[i + 1];
      const transB = transData.data[i + 2];
      const translatedIsBlack = transR < BLACK_THRESHOLD && transG < BLACK_THRESHOLD && transB < BLACK_THRESHOLD;
      const brightness = transR * 0.299 + transG * 0.587 + transB * 0.114;
      const translatedIsDark = brightness < DARK_THRESHOLD;

      if ((translatedIsBlack || translatedIsDark) && !originalWasDark) {
        // Dark Pix2Pix background artifact on a light doodle — skip, keep reference
        continue;
      }

      // Edge feathering
      const blendFactor = originalAlpha >= EDGE_ALPHA_SOFT
        ? opacity
        : ((originalAlpha - EDGE_ALPHA_MIN) / (EDGE_ALPHA_SOFT - EDGE_ALPHA_MIN)) * opacity;

      const refR = compositeData.data[i];
      const refG = compositeData.data[i + 1];
      const refB = compositeData.data[i + 2];

      compositeData.data[i]     = Math.round(refR * (1 - blendFactor) + transR * blendFactor);
      compositeData.data[i + 1] = Math.round(refG * (1 - blendFactor) + transG * blendFactor);
      compositeData.data[i + 2] = Math.round(refB * (1 - blendFactor) + transB * blendFactor);
      compositeData.data[i + 3] = 255;
    }
  }

  ctx.putImageData(compositeData, 0, 0);
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
        if (refLayer) {
          const refBlob = await canvasRef.current.getLayerBlob(refLayer.id);
          if (refBlob) {
            const refUrl = URL.createObjectURL(refBlob);
            try {
              const refImg = await loadImage(refUrl);
              ctx.globalAlpha = refLayer.opacity ?? 1;
              ctx.drawImage(refImg, 0, 0, width, height);
              ctx.globalAlpha = 1;
            } finally {
              URL.revokeObjectURL(refUrl);
            }
          } else {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
          }
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
        // Pass the original blob through so we can use it as a mask
        const translations = await Promise.allSettled(
          layerBlobs.map(({ layer, blob }) =>
            blob ? sendToPix2Pix(blob).then(url => ({ layer, url, blob })) : Promise.resolve(null)
          )
        );

        if (gen !== genRef.current) return;

        // Composite results in layer order, masked by original doodle alpha
        let processed = 0;
        for (const result of translations) {
          if (result.status === 'fulfilled' && result.value) {
            const { layer, url, blob } = result.value;
            const translatedImg = await loadImage(url);

            // Load the original doodle as an image to use as alpha mask
            const doodleUrl = URL.createObjectURL(blob);
            try {
              const doodleImg = await loadImage(doodleUrl);
              compositeTranslatedLayer(ctx, translatedImg, doodleImg, width, height, layer.opacity ?? 1);
            } finally {
              URL.revokeObjectURL(doodleUrl);
            }
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
