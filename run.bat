@echo off
title ANTIMUSIC
cd /d "%~dp0"

echo ===================================================
echo                ANTIMUSIC - starting
echo ===================================================

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js tidak ditemukan. Install Node.js 20+ dari https://nodejs.org
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [INFO] Memasang dependency...
    call npm install --omit=dev --no-audit --no-fund
)

if not exist ".env" (
    echo [ERROR] File .env belum ada. Copy .env.example menjadi .env lalu isi DISCORD_TOKEN dan CLIENT_ID.
    pause
    exit /b 1
)

node index.js

echo.
echo ===================================================
echo [INFO] ANTIMUSIC berhenti. Tekan tombol apa saja...
echo ===================================================
pause
