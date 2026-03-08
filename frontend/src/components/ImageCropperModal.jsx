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

    // Set canvas dimensions to the exact requested crop size 
    // This removes any padding or squishing.
    canvas.width = pixelCrop.width;
    canvas.height = pixelCrop.height;

    // Draw the cropped image onto the canvas
    ctx.drawImage(
        image,
        pixelCrop.x,
        pixelCrop.y,
        pixelCrop.width,
        pixelCrop.height,
        0,
        0,
        pixelCrop.width,
        pixelCrop.height
    );

    // As blob
    return new Promise((resolve, reject) => {
        canvas.toBlob((file) => {
            if (file) {
                // Ensure output is exactly the right ratio structure
                resolve(file);
            } else {
                reject(new Error("Canvas failure"));
            }
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
