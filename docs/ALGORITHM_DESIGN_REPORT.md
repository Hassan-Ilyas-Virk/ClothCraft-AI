# Algorithm Design Report

## 1. Introduction
This report outlines the major algorithmic modules used in the Clothify project. The system integrates deep learning models for image generation with client-side image processing for a seamless user experience.

## 2. Major Modules & Algorithms

### Algorithm 1: Pix2Pix Generator (Doodle Translation)
**Module:** Backend (`app.py`, `networks.py`)
**Description:** A Conditional Generative Adversarial Network (cGAN) is used to translate user-drawn doodles into realistic clothing textures/shapes. The generator follows a U-Net architecture with skip connections to preserve spatial information.

**Input:** Tensor $x$ (Doodle Image, $3 \times 256 \times 256$)
**Output:** Tensor $y$ (Generated Image, $3 \times 256 \times 256$)

**Pseudocode (U-Net Forward Pass):**
```plaintext
Function UnetGenerator(x):
    // Encoder (Downsampling)
    e1 <- Conv2d(x)
    e2 <- Conv2d(LeakyReLU(e1))
    e3 <- Conv2d(LeakyReLU(e2))
    ...
    en <- Conv2d(LeakyReLU(en-1)) // Bottleneck

    // Decoder (Upsampling with Skip Connections)
    d1 <- Deconv2d(ReLU(en))
    d1 <- Concatenate(d1, en-1)
    
    d2 <- Deconv2d(ReLU(d1))
    d2 <- Concatenate(d2, en-2)
    ...
    dm <- Deconv2d(ReLU(dm-1))
    dm <- Concatenate(dm, e0)

    // Output Layer
    y <- Tanh(Conv2d(dm))
    return y
```

---

### Algorithm 2: Stable Diffusion Inpainting
**Module:** Backend (`app.py`)
**Description:** A Latent Diffusion Model (LDM) is used to inpaint textures onto the clothing based on a text prompt. It uses a VAE to work in latent space and a U-Net for denoising.

**Input:** Reference Image $I_{ref}$, Mask $M$, Prompt $P$, Strength $S$
**Output:** Inpainted Image $I_{out}$

**Pseudocode:**
```plaintext
Function InpaintWithStableDiffusion(I_ref, M, P, S):
    // Preprocessing
    I_ref <- Resize(I_ref, 512, 512)
    M <- Resize(M, 512, 512)
    
    // Encode to Latent Space
    Z <- VAE_Encode(I_ref)
    
    // Add Noise based on Strength
    Noise <- GaussianNoise()
    Z_noisy <- (1 - S) * Z + S * Noise
    
    // Text Embedding
    C <- TextEncoder(P)
    
    // Denoising Loop (Reverse Diffusion)
    For t from T down to 0:
        // Predict noise
        Noise_pred <- UNet(Z_noisy, t, C)
        
        // Step towards clean image
        Z_prev <- SchedulerStep(Z_noisy, Noise_pred, t)
        
        // Inpainting Specific: Enforce known pixels from original image
        // (Blend predicted latent with original latent based on mask)
        Z_clean_known <- VAE_Encode(I_ref) + Noise(t)
        Z_prev <- M * Z_prev + (1 - M) * Z_clean_known
        
        Z_noisy <- Z_prev
    End For
    
    // Decode back to Pixel Space
    I_out <- VAE_Decode(Z_noisy)
    I_out <- Resize(I_out, OriginalSize)
    
    return I_out
```

---

### Algorithm 3: Doodle Mask Creation
**Module:** Frontend (`imageProcessing.js`)
**Description:** Creates a binary or feathered mask from the user's doodle to guide the inpainting process.

**Input:** Doodle Image $I_{doodle}$, Feather Amount $F$
**Output:** Mask Image $M$

**Pseudocode:**
```plaintext
Function CreateMaskFromDoodle(I_doodle, F):
    Initialize Canvas C with size of I_doodle
    Draw I_doodle onto C
    Pixels <- GetImageData(C)
    
    // Create Binary Mask
    For each pixel p in Pixels:
        If p.alpha > Threshold then
            p.rgb <- (255, 255, 255) // White (Inpaint Area)
            p.alpha <- 255
        Else
            p.rgb <- (0, 0, 0)       // Black (Preserve Area)
            p.alpha <- 255
        End If
    End For
    
    PutImageData(Pixels, C)
    
    // Apply Feathering
    If F > 0 then
        BlurRadius <- CalculateRadius(F)
        ApplyGaussianBlur(C, BlurRadius)
    End If
    
    return C
```

---

### Algorithm 4: Client-Side Compositing
**Module:** Frontend (`imageProcessing.js`)
**Description:** Composites the Pix2Pix translated output onto the original reference image, using the original doodle as a stencil to ensure clean edges.

**Input:** Reference $I_{ref}$, Translated Doodle $I_{trans}$, Original Doodle $I_{doodle}$
**Output:** Composited Image $I_{comp}$

**Pseudocode:**
```plaintext
Function CompositeImages(I_ref, I_trans, I_doodle):
    Initialize Canvas C
    Draw I_ref onto C
    
    Data_ref <- GetPixelData(C)
    Data_trans <- GetPixelData(I_trans)
    Data_doodle <- GetPixelData(I_doodle)
    
    For each pixel i:
        // Check if doodle exists at this pixel
        If Data_doodle[i].alpha > Threshold then
            // Check for black background artifact from Pix2Pix
            If IsBlack(Data_trans[i]) AND NOT IsBlack(Data_doodle[i]) then
                // Skip artifact, keep reference pixel
                Continue
            Else
                // Overwrite reference with translated pixel
                Data_ref[i] <- Data_trans[i]
            End If
        End If
    End For
    
    PutImageData(Data_ref, C)
    return C
```

---

### Algorithm 5: Dominant Color Extraction
**Module:** Frontend (`imageProcessing.js`)
**Description:** Extracts the most frequent colors from an image to generate a moodboard palette.

**Input:** Image $I$, Count $N$
**Output:** List of Colors $Palette$

**Pseudocode:**
```plaintext
Function ExtractDominantColors(I, N):
    // Resize for performance
    I_small <- Resize(I, 100, AspectRatio)
    Pixels <- GetImageData(I_small)
    
    Initialize Map ColorCounts
    Quantization <- 20
    
    // Count quantized colors
    For each pixel p in Pixels:
        If p.alpha < 128 then Continue
        
        // Quantize RGB values to group similar colors
        r <- Round(p.r / Quantization) * Quantization
        g <- Round(p.g / Quantization) * Quantization
        b <- Round(p.b / Quantization) * Quantization
        
        Key <- (r, g, b)
        ColorCounts[Key] <- ColorCounts[Key] + 1
    End For
    
    // Sort and Select
    SortedColors <- SortDescending(ColorCounts.Values)
    Palette <- Top N keys from SortedColors
    
    return Palette
```
