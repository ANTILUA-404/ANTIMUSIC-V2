@echo off
title ANTIMUSIC
cd /d "%~dp0"

if not exist node_modules (
  echo [antimusic] node_modules belum ada, menjalankan npm install...
  call npm install
)

if not exist .env (
  echo [antimusic] .env belum ada.
  echo             copy .env.example menjadi .env lalu isi DISCORD_TOKEN ^& CLIENT_ID.
  pause
  exit /b 1
)

node index.js
pause
