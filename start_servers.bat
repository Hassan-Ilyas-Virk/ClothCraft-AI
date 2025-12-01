@echo off
echo ========================================
echo  Pix2Pix Doodle Translator
echo ========================================
echo.
echo Starting backend and frontend servers...
echo.

REM Start Flask backend in a new window
start "Flask Backend" cmd /k "python app.py"

REM Wait a bit for backend to start
timeout /t 3 /nobreak >nul

REM Start React frontend in a new window
start "React Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo ========================================
echo Servers are starting!
echo Backend: http://127.0.0.1:5000
echo Frontend: http://localhost:3000
echo ========================================
echo.
echo Press any key to exit this window...
pause >nul

