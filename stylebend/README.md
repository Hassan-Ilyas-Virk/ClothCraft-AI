<div align="center">

# Stylebend

**A microservice for blending fashion styles using StyleGAN.**

</div>

---

This microservice is a component of the **ClothCraft-AI** project. It uses a pre-trained StyleGAN model to perform latent space interpolation between two clothing items, effectively "blending" their styles.

This implementation is based on the work from the official StyleGAN-Human repository. Thank you to the original authors for their excellent research and for making the model publicly available.

- **Original Repository:** [https://github.com/stylegan-human/StyleGAN-Human](https://github.com/stylegan-human/StyleGAN-Human)

---

## Tech Stack

- **Framework:** Streamlit
- **AI Model:** StyleGAN-Human v2
- **Core Library:** PyTorch

---

## Setup (Windows & PowerShell)

### 1. Prerequisites

- **Python 3.10+**
- **Visual Studio Code**
- (Optional) NVIDIA GPU with CUDA for significantly faster processing. CPU is supported but will be slow.

### 2. Installation

1.  **Open this `stylebend/` folder** in Visual Studio Code.

2.  **Create a Python virtual environment:**
    ```powershell
    python -m venv .venv
    ```

3.  **Activate the virtual environment:**
    ```powershell
    .venv\Scripts\Activate.ps1
    ```

4.  **Install the required dependencies:**
    ```powershell
    pip install --upgrade pip
    pip install -r requirements.txt
    ```
    > **Note for GPU users:** If you have a CUDA-enabled GPU, you may need to install a specific PyTorch build. Please see the official [PyTorch website](https://pytorch.org/) for instructions.

5.  **Download the Model:**
    -   Download the `stylegan_human_v2_1024.pkl` model from the original repository's releases.
    -   Create a `models/` directory inside the `stylebend/` folder.
    -   Place the downloaded `.pkl` file inside `stylebend/models/`.

The final structure should look like this:
```
stylebend/
├── .venv/
├── models/
│   └── stylegan_human_v2_1024.pkl
├── scripts/
│   ├── inversion.py
│   └── blending.py
├── app.py
└── requirements.txt
```

---

## Running the Service

Once the setup is complete, run the Streamlit application from your terminal:

```bash
streamlit run app.py
```

This will start a local web server. Open the URL shown in your terminal to access the Stylebend interface.

---

## Notes

-   **Image Inversion:** The current inversion script (`inversion.py`) is a basic placeholder that generates a random latent code. For faithful reconstruction of real images, this should be replaced with a more advanced projection technique like e4e or PTI.
-   **Import Errors:** If you encounter import errors related to `torch` or `torchvision`, it usually indicates a mismatch in your PyTorch installation. Please try reinstalling these packages according to the official PyTorch instructions for your system (CPU or GPU). 