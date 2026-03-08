import React, { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import { X, Check } from 'lucide-react';

const createImage = (url) =>
    new Promise((resolve, reject) => {
        const image = new Image();
        image.addEventListener('load', () => resolve(image));
        image.addEventListener('error', (error) => reject(error));
        image.setAttribute('crossOrigin', 'anonymous');
        image.src = url;
    });

async function getCroppedImg(imageSrc, pixelCrop) {
    const image = await createImage(imageSrc);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) return null;

    canvas.width = pixelCrop.width;
    canvas.height = pixelCrop.height;

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

    return new Promise((resolve, reject) => {
        canvas.toBlob((file) => {
            if (file) resolve(file);
            else reject(new Error("Canvas failure"));
        }, 'image/jpeg');
    });
}

const DoubleImageCropperModal = ({ imageUrl1, imageUrl2, onClose, onCropComplete }) => {
    const [crop1, setCrop1] = useState({ x: 0, y: 0 });
    const [zoom1, setZoom1] = useState(1);
    const [croppedAreaPixels1, setCroppedAreaPixels1] = useState(null);

    const [crop2, setCrop2] = useState({ x: 0, y: 0 });
    const [zoom2, setZoom2] = useState(1);
    const [croppedAreaPixels2, setCroppedAreaPixels2] = useState(null);

    const [isCropping, setIsCropping] = useState(false);

    const handleApplyCrop = async () => {
        if (!croppedAreaPixels1 || !croppedAreaPixels2) return;
        setIsCropping(true);
        try {
            const croppedBlob1 = await getCroppedImg(imageUrl1, croppedAreaPixels1);
            const croppedBlob2 = await getCroppedImg(imageUrl2, croppedAreaPixels2);
            onCropComplete(croppedBlob1, croppedBlob2);
        } catch (e) {
            console.error(e);
        } finally {
            setIsCropping(false);
        }
    };

    return (
        <div className="clothify-modal-overlay" style={{ zIndex: 10000 }}>
            <div className="clothify-modal" style={{ maxWidth: '900px', width: '95%' }}>
                <div className="clothify-modal-header">
                    <div className="clothify-modal-title">
                        ✂️ Match & Crop Images (1:2)
                    </div>
                    <button className="clothify-modal-close" onClick={onClose} disabled={isCropping}>
                        <X size={20} />
                    </button>
                </div>

                <div className="clothify-modal-body" style={{ flexDirection: 'row', padding: 0, minHeight: '450px' }}>
                    {/* Left Cropper */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid #e5e7eb', height: '450px' }}>
                        <div style={{ padding: '8px', textAlign: 'center', background: '#f9fafb', fontWeight: 500, color: '#374151', flexShrink: 0 }}>Subject Image</div>
                        <div style={{ position: 'relative', width: '100%', height: '350px', background: '#333', flexShrink: 0 }}>
                            {imageUrl1 ? (
                                <Cropper
                                    image={imageUrl1}
                                    crop={crop1}
                                    zoom={zoom1}
                                    aspect={1 / 2}
                                    onCropChange={setCrop1}
                                    onCropComplete={(ca, cap) => setCroppedAreaPixels1(cap)}
                                    onZoomChange={setZoom1}
                                    showGrid={true}
                                />
                            ) : (
                                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>Missing Image</div>
                            )}
                        </div>
                        <div style={{ padding: '16px', background: '#f9fafb' }}>
                            <input
                                type="range"
                                value={zoom1}
                                min={1}
                                max={3}
                                step={0.1}
                                onChange={(e) => setZoom1(e.target.value)}
                                disabled={isCropping || !imageUrl1}
                                style={{ width: '100%', accentColor: '#8b5cf6' }}
                            />
                        </div>
                    </div>

                    {/* Right Cropper */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '450px' }}>
                        <div style={{ padding: '8px', textAlign: 'center', background: '#f9fafb', fontWeight: 500, color: '#374151', flexShrink: 0 }}>Style Image</div>
                        <div style={{ position: 'relative', width: '100%', height: '350px', background: '#333', flexShrink: 0 }}>
                            {imageUrl2 ? (
                                <Cropper
                                    image={imageUrl2}
                                    crop={crop2}
                                    zoom={zoom2}
                                    aspect={1 / 2}
                                    onCropChange={setCrop2}
                                    onCropComplete={(ca, cap) => setCroppedAreaPixels2(cap)}
                                    onZoomChange={setZoom2}
                                    showGrid={true}
                                />
                            ) : (
                                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>Missing Image</div>
                            )}
                        </div>
                        <div style={{ padding: '16px', background: '#f9fafb' }}>
                            <input
                                type="range"
                                value={zoom2}
                                min={1}
                                max={3}
                                step={0.1}
                                onChange={(e) => setZoom2(e.target.value)}
                                disabled={isCropping || !imageUrl2}
                                style={{ width: '100%', accentColor: '#8b5cf6' }}
                            />
                        </div>
                    </div>
                </div>

                <div className="clothify-modal-footer">
                    <button className="clothify-footer-btn clothify-footer-btn-cancel" onClick={onClose} disabled={isCropping}>
                        Cancel
                    </button>
                    <button
                        className="clothify-footer-btn clothify-footer-btn-ok"
                        onClick={handleApplyCrop}
                        disabled={isCropping || !croppedAreaPixels1 || !croppedAreaPixels2}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', color: '#fff' }}
                    >
                        {isCropping ? 'Processing...' : <><Check size={16} /> Apply Match</>}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DoubleImageCropperModal;
