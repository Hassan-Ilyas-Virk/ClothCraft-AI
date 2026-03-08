/**
 * Translate doodle using Pix2Pix model
 * @param {Blob} doodleBlob - The doodle image only (transparent background)
 * @returns {Promise<Blob>} - The translated doodle from Pix2Pix
 */
export async function translateDoodle(doodleBlob) {
  const formData = new FormData();
  formData.append('file', doodleBlob, 'doodle.png');

  try {
    const response = await fetch('http://127.0.0.1:5000/translate-doodle', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    return await response.blob();
  } catch (error) {
    console.error('Error translating doodle:', error);
    throw new Error('Failed to translate doodle with Pix2Pix');
  }
}

/**
 * Create feathered mask from original doodle shape
 * WHITE = enhance/inpaint this area, BLACK = preserve this area
 * Feathering creates soft edges for better blending
 * @param {Blob} originalDoodleBlob - The original doodle drawn by user
 * @param {number} featherAmount - How much to feather (0.0-1.0, higher = more blur)
 * @returns {Promise<Blob>} - Feathered mask (white where doodle is, black elsewhere)
 */
export async function createMaskFromDoodle(originalDoodleBlob, featherAmount = 0.5) {
  return new Promise(async (resolve, reject) => {
    try {
      // Load original doodle as image
      const img = await blobToImage(originalDoodleBlob);

      // Create canvas
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');

      // Draw the original doodle
      ctx.drawImage(img, 0, 0);

      // Get pixel data
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;

      // Create binary mask: WHITE where doodle exists, BLACK elsewhere
      for (let i = 0; i < pixels.length; i += 4) {
        const alpha = pixels[i + 3]; // Alpha channel

        // If pixel has alpha (doodle was drawn here)
        if (alpha > 10) {
          // White = enhance/inpaint this area
          pixels[i] = 255;
          pixels[i + 1] = 255;
          pixels[i + 2] = 255;
          pixels[i + 3] = 255;
        } else {
          // Black = preserve this area (no doodle here)
          pixels[i] = 0;
          pixels[i + 1] = 0;
          pixels[i + 2] = 0;
          pixels[i + 3] = 255;
        }
      }

      ctx.putImageData(imageData, 0, 0);

      // Apply feathering/blur for soft edges
      if (featherAmount > 0) {
        const blurRadius = Math.max(5, Math.round(featherAmount * 50)); // 5-50px blur

        // Create temporary canvas for blurring
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');

        // Apply CSS blur filter
        tempCtx.filter = `blur(${blurRadius}px)`;
        tempCtx.drawImage(canvas, 0, 0);

        // Copy blurred result back
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(tempCanvas, 0, 0);

        console.log(`🎭 Created feathered mask (blur: ${blurRadius}px)`);
      } else {
        console.log('🎭 Created binary mask (no feathering)');
      }

      // Convert to blob
      canvas.toBlob(resolve, 'image/png');
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Composite translated doodle onto reference image
 * @param {Blob} referenceBlob - The reference image
 * @param {Blob} translatedDoodleBlob - The translated doodle from Pix2Pix
 * @param {Blob} originalDoodleBlob - The original doodle (used for masking)
 * @returns {Promise<Blob>} - Composited image (reference + translated doodle)
 */
export async function compositeTranslatedDoodleOnReference(referenceBlob, translatedDoodleBlob, originalDoodleBlob) {
  return new Promise(async (resolve, reject) => {
    try {
      // Load all images
      const referenceImg = await blobToImage(referenceBlob);
      const translatedImg = await blobToImage(translatedDoodleBlob);
      const originalDoodleImg = await blobToImage(originalDoodleBlob);

      // Create canvas with reference size
      const canvas = document.createElement('canvas');
      canvas.width = referenceImg.width;
      canvas.height = referenceImg.height;
      const ctx = canvas.getContext('2d');

      // Draw reference image first
      ctx.drawImage(referenceImg, 0, 0);

      console.log('📐 Compositing translated doodle onto reference...');

      // Scale translated doodle to match reference size
      const scaledTranslatedCanvas = document.createElement('canvas');
      scaledTranslatedCanvas.width = referenceImg.width;
      scaledTranslatedCanvas.height = referenceImg.height;
      const scaledCtx = scaledTranslatedCanvas.getContext('2d');
      scaledCtx.drawImage(translatedImg, 0, 0, referenceImg.width, referenceImg.height);

      // Get original doodle pixels to use as mask
      const doodleCanvas = document.createElement('canvas');
      doodleCanvas.width = referenceImg.width;
      doodleCanvas.height = referenceImg.height;
      const doodleCtx = doodleCanvas.getContext('2d');
      doodleCtx.drawImage(originalDoodleImg, 0, 0, referenceImg.width, referenceImg.height);
      const doodleData = doodleCtx.getImageData(0, 0, referenceImg.width, referenceImg.height);

      // Get translated doodle pixels
      const translatedData = scaledCtx.getImageData(0, 0, referenceImg.width, referenceImg.height);

      // Composite: Only draw translated doodle where original doodle exists
      // BUT handle black doodles specially
      const compositeData = ctx.getImageData(0, 0, referenceImg.width, referenceImg.height);

      let pixelsComposited = 0;
      let blackBackgroundSkipped = 0;

      for (let i = 0; i < doodleData.data.length; i += 4) {
        const originalAlpha = doodleData.data[i + 3];

        if (originalAlpha > 10) {
          // Original doodle exists at this location

          // Check if original doodle was black/dark
          const origR = doodleData.data[i];
          const origG = doodleData.data[i + 1];
          const origB = doodleData.data[i + 2];
          const originalWasBlack = origR < 50 && origG < 50 && origB < 50;

          // Get translated pixel
          const transR = translatedData.data[i];
          const transG = translatedData.data[i + 1];
          const transB = translatedData.data[i + 2];
          const translatedIsBlack = transR < 20 && transG < 20 && transB < 20;

          // Decision logic:
          // - If original doodle WAS black → keep translated pixel even if black (it's content)
          // - If original doodle was NOT black → skip very black pixels (they're background from Pix2Pix)
          if (translatedIsBlack && !originalWasBlack) {
            // This is black background from Pix2Pix, not actual content
            // Skip it (keep reference image)
            blackBackgroundSkipped++;
          } else {
            // This is actual doodle content - use it
            compositeData.data[i] = transR;
            compositeData.data[i + 1] = transG;
            compositeData.data[i + 2] = transB;
            compositeData.data[i + 3] = 255;
            pixelsComposited++;
          }
        }
        // Otherwise keep reference image (already drawn)
      }

      ctx.putImageData(compositeData, 0, 0);

      console.log('✓ Composited: Reference + Translated Doodle');
      console.log(`  - Doodle pixels used: ${pixelsComposited}`);
      console.log(`  - Black background pixels skipped: ${blackBackgroundSkipped}`);

      // Convert to blob
      canvas.toBlob(resolve, 'image/png');
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Inpaint reference image using Stable Diffusion with translated doodle as mask
 * @param {Blob} referenceBlob - The reference image
 * @param {Blob} maskBlob - The mask (binary: white=inpaint, black=preserve)
 * @param {string} prompt - Prompt for Stable Diffusion
 * @param {number} strength - How much to change (0.0 = no change, 1.0 = full change)
 * @returns {Promise<Blob>} - The inpainted result
 */
export async function inpaintWithStableDiffusion(referenceBlob, maskBlob, prompt = '', strength = 0.75) {
  const formData = new FormData();
  formData.append('reference', referenceBlob, 'reference.png');
  formData.append('mask', maskBlob, 'mask.png');
  if (prompt) {
    formData.append('prompt', prompt);
  }
  formData.append('strength', strength.toString());

  console.log(`🎚️ Inpainting with strength: ${Math.round(strength * 100)}%`);
  console.log(`📝 Prompt: "${prompt}"`);

  try {
    const response = await fetch('http://127.0.0.1:5000/inpaint', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    return await response.blob();
  } catch (error) {
    console.error('Error inpainting with Stable Diffusion:', error);
    throw new Error('Failed to inpaint with Stable Diffusion');
  }
}

/**
 * Blend two fashion images using StyleGAN-Human
 * @param {Blob} image1Blob - First image
 * @param {Blob} image2Blob - Second image
 * @param {number} alpha - Blending strength (0.0 to 1.0)
 * @param {boolean} outpaint1 - Whether to outpaint image 1 to full body first
 * @param {boolean} outpaint2 - Whether to outpaint image 2 to full body first
 * @returns {Promise<Array>} - Array of blended frame data URLs
 */
export async function blendStyles(image1Blob, image2Blob, alpha, outpaint1 = false, outpaint2 = false) {
  const formData = new FormData();
  formData.append('image1', image1Blob, 'image1.jpg');
  formData.append('image2', image2Blob, 'image2.jpg');
  formData.append('alpha', alpha.toString());
  formData.append('outpaint1', outpaint1 ? 'true' : 'false');
  formData.append('outpaint2', outpaint2 ? 'true' : 'false');

  console.log(`👗 Blending styles with alpha: ${alpha}, outpaint1: ${outpaint1}, outpaint2: ${outpaint2}`);

  // 15-minute timeout — inversion with 700 steps can take several minutes
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15 * 60 * 1000);

  try {
    const response = await fetch('http://127.0.0.1:5000/blend-styles', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMsg = 'Failed to blend styles';
      try {
        const errorData = await response.json();
        errorMsg = errorData.error || errorMsg;
      } catch (e) { }
      throw new Error(errorMsg);
    }

    const data = await response.json();
    return data.frames;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timed out after 15 minutes. Try with fewer steps or a smaller image.');
    }
    console.error('Error blending styles:', error);
    throw new Error(error.message || 'Failed to blend styles');
  }
}

// Legacy function for backward compatibility
export async function processImageWithModel(doodleBlob) {
  return translateDoodle(doodleBlob);
}

/**
 * Compare two images pixel-by-pixel and extract the differences
 * This identifies the processed doodle area by comparing the model output
 * with the original reference image
 * 
 * ALGORITHM:
 * 1. Remove BLACK background from model output (black pixels → transparent)
 * 2. Compare remaining pixels with original reference image
 * 3. Keep only pixels that are DIFFERENT from reference (the processed doodle)
 * 4. Make pixels similar to reference TRANSPARENT
 * 
 * @param {HTMLCanvasElement} referenceCanvas - Canvas with ORIGINAL reference image (unchanged)
 * @param {HTMLCanvasElement} processedCanvas - Canvas with model output (has black background)
 * @param {number} threshold - Pixel difference threshold (0-255). Higher = more pixels kept
 * @param {number} blackThreshold - Threshold for black detection (0-255). Higher = more pixels considered black
 * @returns {HTMLCanvasElement} - Canvas with extracted processed doodle (transparent background)
 */
export function extractProcessedDoodle(referenceCanvas, processedCanvas, threshold = 30, blackThreshold = 30) {
  const width = referenceCanvas.width;
  const height = referenceCanvas.height;

  // Create contexts for reading pixel data
  const refCtx = referenceCanvas.getContext('2d');
  const procCtx = processedCanvas.getContext('2d');

  // Get pixel data from both images
  const refImageData = refCtx.getImageData(0, 0, width, height);
  const procImageData = procCtx.getImageData(0, 0, width, height);

  const refPixels = refImageData.data;
  const procPixels = procImageData.data;

  // Create a new canvas for the extracted doodle
  const extractedCanvas = document.createElement('canvas');
  extractedCanvas.width = width;
  extractedCanvas.height = height;
  const extractedCtx = extractedCanvas.getContext('2d');
  const extractedImageData = extractedCtx.createImageData(width, height);
  const extractedPixels = extractedImageData.data;

  let blackPixelCount = 0;
  let processedPixelCount = 0;
  let transparentPixelCount = 0;

  // Process each pixel
  for (let i = 0; i < procPixels.length; i += 4) {
    const r = procPixels[i];
    const g = procPixels[i + 1];
    const b = procPixels[i + 2];

    // STEP 1: Remove black background from model output
    // Check if pixel is black or very dark (common in model output backgrounds)
    const isBlack = r < blackThreshold && g < blackThreshold && b < blackThreshold;

    if (isBlack) {
      // Make black pixels transparent
      extractedPixels[i] = 0;
      extractedPixels[i + 1] = 0;
      extractedPixels[i + 2] = 0;
      extractedPixels[i + 3] = 0;
      blackPixelCount++;
    } else {
      // STEP 2: Compare non-black pixels with reference image
      const refR = refPixels[i];
      const refG = refPixels[i + 1];
      const refB = refPixels[i + 2];

      // Calculate Euclidean distance in RGB space
      const diff = Math.sqrt(
        Math.pow(r - refR, 2) +
        Math.pow(g - refG, 2) +
        Math.pow(b - refB, 2)
      );

      if (diff > threshold) {
        // STEP 3: Significant difference - keep this pixel (it's the processed doodle)
        extractedPixels[i] = r;
        extractedPixels[i + 1] = g;
        extractedPixels[i + 2] = b;
        extractedPixels[i + 3] = 255; // Fully opaque
        processedPixelCount++;
      } else {
        // STEP 4: Similar to reference - make transparent (unchanged area)
        extractedPixels[i] = 0;
        extractedPixels[i + 1] = 0;
        extractedPixels[i + 2] = 0;
        extractedPixels[i + 3] = 0;
        transparentPixelCount++;
      }
    }
  }

  console.log('🎨 Doodle Extraction Stats:');
  console.log(`   Black pixels removed: ${blackPixelCount}`);
  console.log(`   Processed doodle pixels kept: ${processedPixelCount}`);
  console.log(`   Transparent (unchanged) pixels: ${transparentPixelCount}`);
  console.log(`   Threshold used: ${threshold}, Black threshold: ${blackThreshold}`);

  extractedCtx.putImageData(extractedImageData, 0, 0);
  return extractedCanvas;
}

/**
 * Composite the processed doodle onto the reference image
 * @param {HTMLCanvasElement} referenceCanvas - Canvas with reference image
 * @param {HTMLCanvasElement} processedDoodleCanvas - Canvas with extracted processed doodle
 * @returns {HTMLCanvasElement} - Final composited canvas
 */
export function compositeImages(referenceCanvas, processedDoodleCanvas) {
  const width = referenceCanvas.width;
  const height = referenceCanvas.height;

  // Create final output canvas
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = width;
  outputCanvas.height = height;
  const outputCtx = outputCanvas.getContext('2d');

  // Draw reference image first (background)
  outputCtx.drawImage(referenceCanvas, 0, 0);

  // Draw processed doodle on top (with transparency)
  outputCtx.drawImage(processedDoodleCanvas, 0, 0);

  return outputCanvas;
}

/**
 * Convert a Blob to an HTMLImageElement
 * @param {Blob} blob - Image blob
 * @returns {Promise<HTMLImageElement>}
 */
export function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image from blob'));
    };
    img.src = url;
  });
}

/**
 * Load an image onto a canvas
 * @param {HTMLImageElement} image - The image to load
 * @param {HTMLCanvasElement} canvas - Target canvas
 */
export function loadImageToCanvas(image, canvas) {
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
}


/**
 * Refine a pattern using Stable Diffusion
 * @param {string} imageBase64 - The pattern image as base64 string
 * @param {string} prompt - Prompt for refinement
 * @param {number} strength - Denoising strength (0-1)
 * @returns {Promise<string>} - The refined image as base64 string
 */
export async function refinePattern(imageBase64, prompt, strength = 0.6) {
  const formData = new FormData();

  // Convert base64 to blob
  const response = await fetch(imageBase64);
  const blob = await response.blob();

  formData.append('image', blob, 'pattern.png');
  formData.append('prompt', prompt);
  formData.append('strength', strength.toString());

  try {
    const res = await fetch('http://127.0.0.1:5000/refine-pattern', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`Server error: ${res.status}`);
    }

    const resultBlob = await res.blob();

    // Convert blob back to base64 for frontend display
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(resultBlob);
    });
  } catch (error) {
    console.error('Error refining pattern:', error);
    throw error;
  }
}

/**
 * Convert RGB to HSL
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {object} - {h: 0-360, s: 0-100, l: 0-100}
 */
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}

/**
 * Calculate color quality score based on saturation and vibrancy
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {number} - Quality score (0-100)
 */
function getColorQuality(r, g, b) {
  const hsl = rgbToHsl(r, g, b);

  // Prefer saturated colors (high saturation)
  const saturationScore = hsl.s;

  // Prefer colors that are not too dark or too light (mid-range lightness)
  // Peak quality at 50% lightness, decrease towards 0% and 100%
  const lightnessScore = 100 - Math.abs(50 - hsl.l) * 2;

  // Combined score (weighted average)
  return (saturationScore * 0.7) + (lightnessScore * 0.3);
}

/**
 * Extract dominant colors from an image
 * @param {HTMLImageElement} image - The source image
 * @param {number} count - Number of colors to extract
 * @returns {string[]} - Array of hex color strings
 */
export function extractDominantColors(image, count = 4) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // Resize for faster processing
  const width = 100;
  const height = (image.height / image.width) * width;
  canvas.width = width;
  canvas.height = height;

  ctx.drawImage(image, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height).data;
  const colorMap = {};

  // Quantize colors (round to nearest 20 to group similar colors)
  const quantization = 20;

  // Thresholds for filtering
  const MIN_SATURATION = 25; // Filter out colors with saturation < 25%
  const MIN_LIGHTNESS = 15;  // Filter out very dark colors (< 15%)
  const MAX_LIGHTNESS = 85;  // Filter out very light colors (> 85%)

  for (let i = 0; i < imageData.length; i += 4) {
    const r = imageData[i];
    const g = imageData[i + 1];
    const b = imageData[i + 2];
    const a = imageData[i + 3];

    // Skip transparent pixels
    if (a < 128) continue;

    // Convert to HSL to check saturation and lightness
    const hsl = rgbToHsl(r, g, b);

    // Filter out low saturation colors (grays, pale colors)
    if (hsl.s < MIN_SATURATION) continue;

    // Filter out very light colors (near-white, pale yellows)
    if (hsl.l > MAX_LIGHTNESS) continue;

    // Filter out very dark colors (near-black)
    if (hsl.l < MIN_LIGHTNESS) continue;

    // Quantize after filtering
    const rQuant = Math.round(r / quantization) * quantization;
    const gQuant = Math.round(g / quantization) * quantization;
    const bQuant = Math.round(b / quantization) * quantization;

    const rgb = `${rQuant},${gQuant},${bQuant}`;
    colorMap[rgb] = (colorMap[rgb] || 0) + 1;
  }

  // Sort by combined score: frequency + quality
  const sortedColors = Object.entries(colorMap)
    .map(([rgb, frequency]) => {
      const [r, g, b] = rgb.split(',').map(Number);
      const quality = getColorQuality(r, g, b);

      // Combined score: normalize frequency and add quality
      const maxFreq = Math.max(...Object.values(colorMap));
      const normalizedFreq = (frequency / maxFreq) * 100;

      // Weight: 60% frequency, 40% quality
      const score = (normalizedFreq * 0.6) + (quality * 0.4);

      return { rgb, frequency, quality, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(({ rgb }) => {
      const [r, g, b] = rgb.split(',').map(Number);
      return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    });

  return sortedColors;
}
