@echo off
rem Platin Touch am eigenen PC starten (braucht Node.js: https://nodejs.org)
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js fehlt - bitte von https://nodejs.org installieren. & pause & exit /b 1)
start "" http://localhost:8080
node serve.js
pause
