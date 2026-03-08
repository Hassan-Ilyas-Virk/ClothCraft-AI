# Stylebend: Fashion Style Blending (Windows + VS Code)

## Prerequisites
- Python 3.11 installed (you have: `C:\Users\PC\AppData\Local\Programs\Python\Python311\`)
- Optional: CUDA GPU. CPU works but is slower.
- Visual Studio Code

## File structure
```
stylebend/
├─ models/
│  └─ stylegan_human_v2_1024.pkl   # put your downloaded model here
├─ scripts/
│  ├─ inversion.py
│  └─ blending.py
├─ app.py
└─ requirements.txt
```

## Setup (Windows PowerShell)
1. Open VS Code and open folder: `stylebend`
2. Create virtual environment (Python 3.11):
```
C:\Users\PC\AppData\Local\Programs\Python\Python311\python.exe -m venv .venv
```
3. Activate venv:
```
.venv\Scripts\Activate.ps1
```
4. Install dependencies (PyTorch CPU by default):
```
pip install --upgrade pip
pip install -r requirements.txt
```
- For NVIDIA GPU with CUDA, install the matching torch build from https://pytorch.org and ignore the pinned versions here if needed.

5. Place model file:
- Copy `stylegan_human_v2_1024.pkl` into `models/`.

## Run
```
streamlit run app.py
```
Then open the local URL printed by Streamlit.

## Notes
- The inversion is a placeholder (random latent). Replace with e4e/PTI if you need faithful reconstructions.
- If import errors occur for torch/torchvision, reinstall them per PyTorch instructions. 