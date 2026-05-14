/**
 * ImageCropperModal — interactive crop dialog for single-image upload.
 *
 * Shown when the user uploads a reference image or drawing layer image.
 * react-easy-crop provides the pan/zoom/crop interaction; getCroppedImg
 * bakes the selected pixel crop region onto an offscreen canvas and returns
 * a JPEG blob that is then loaded onto the layer.
 */
import React, { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import { X, Check } from 'lucide-react';

const createImage = (url) =>
    new Promise((resolve, reject) => {
        const image = new Image();
        image.addEventListener('load', () => resolve(image));
        image.addEventListener('error', (error) => reject(error));
        // needed to avoid cross-origin issues on CodeSandbox
        image.setAttribute('crossOrigin', 'anonymous');
        image.src = url;
    });

/**
 * Returns the new bounding area of a cropped image.
 */
async function getCroppedImg(imageSrc, pixelCrop) {
    const image = await createImage(imageSrc);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
        return null;
    }

    // Size the output canvas to exactly the crop region so there is no padding
    // and the aspect ratio matches what react-easy-crop reported.
    canvas.width  = pixelCrop.width;
    canvas.height = pixelCrop.height;

    // Copy only the cropped rectangle from the source image onto the canvas.
    // Source rect: (pixelCrop.x, pixelCrop.y) → (width, height)
    // Dest rect:   (0, 0) → (width, height) — fills the entire output canvas.
    ctx.drawImage(
        image,
        pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
        0, 0, pixelCrop.width, pixelCrop.height
    );

    // Return as a JPEG blob — StyleGAN-Human works best with JPEG input,
    // and PNG would be larger without quality benefit at this stage.
    return new Promise((resolve, reject) => {
        canvas.toBlob((file) => {
            if (file) resolve(file);
            else reject(new Error("Canvas failure"));
        }, 'image/jpeg');
    });
}

const ImageCropperModal = ({ imageUrl, onClose, onCropComplete }) => {
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
    const [isCropping, setIsCropping] = useState(false);

    const onCropCompleteEvent = useCallback((croppedArea, croppedAreaPixels) => {
        setCroppedAreaPixels(croppedAreaPixels);
    }, []);

    const handleApplyCrop = async () => {
        if (!croppedAreaPixels) return;
        setIsCropping(true);
        try {
            // Bake the selected crop region to a JPEG blob and pass it back to the caller.
            const croppedBlob = await getCroppedImg(imageUrl, croppedAreaPixels);
            onCropComplete(croppedBlob);
        } catch (e) {
            console.error(e);
        } finally {
            setIsCropping(false);
        }
    };

    return (
        <div className="clothify-modal-overlay" style={{ zIndex: 10000 }}>
            <div className="clothify-modal" style={{ maxWidth: '600px', width: '90%' }}>
                <div className="clothify-modal-header">
                    <div className="clothify-modal-title">
                        ✂️ Crop 1:2
                    </div>
                    <button className="clothify-modal-close" onClick={onClose} disabled={isCropping}>
                        <X size={20} />
                    </button>
                </div>

                <div className="clothify-modal-body" style={{ flexDirection: 'column', padding: 0 }}>
                    <div style={{ position: 'relative', width: '100%', height: '400px', background: '#333' }}>
                        <Cropper
                            image={imageUrl}
                            crop={crop}
                            zoom={zoom}
                            aspect={1 / 2} // Force strict 1:2 aspect ratio for StyleGAN-Human
                            onCropChange={setCrop}
                            onCropComplete={onCropCompleteEvent}
                            onZoomChange={setZoom}
                            showGrid={true}
                        />
                    </div>
                    <div style={{ padding: '16px', background: '#f9fafb', display: 'flex', flexDirection: 'column' }}>
                        <label className="clothify-setting-label" style={{ marginBottom: '8px', fontSize: '12px' }}>
                            Adjust Zoom
                        </label>
                        <input
                            type="range"
                            value={zoom}
                            min={1}
                            max={3}
                            step={0.1}
                            aria-labelledby="Zoom"
                            onChange={(e) => {
                                setZoom(e.target.value);
                            }}
                            disabled={isCropping}
                            style={{ width: '100%', accentColor: '#8b5cf6' }}
                        />
                    </div>
                </div>

                <div className="clothify-modal-footer">
                    <button className="clothify-footer-btn clothify-footer-btn-cancel" onClick={onClose} disabled={isCropping}>
                        Cancel
                    </button>
                    <button
                        className="clothify-footer-btn clothify-footer-btn-ok"
                        onClick={handleApplyCrop}
                        disabled={isCropping}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        {isCropping ? 'Processing...' : <><Check size={16} /> Apply Crop</>}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ImageCropperModal;
