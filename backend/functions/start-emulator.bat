@echo off
REM Script de démarrage de l'émulateur Firebase pour Windows
echo ========================================
echo Demarrage de l'emulateur Firebase
echo ========================================
echo.

REM Vérifier que nous sommes dans le bon dossier
if not exist "package.json" (
    echo Erreur: Ce script doit etre execute depuis le dossier backend/functions
    pause
    exit /b 1
)

REM Construire le projet
echo [1/2] Construction du projet...
call npm run build
if errorlevel 1 (
    echo Erreur lors de la construction
    pause
    exit /b 1
)

REM Démarrer l'émulateur
echo [2/2] Demarrage de l'emulateur...
echo.
echo L'emulateur sera accessible sur:
echo   - Firestore: localhost:8081
echo   - Auth: localhost:9100
echo   - Functions: localhost:5002
echo   - UI: http://localhost:4001
echo.
echo Appuyez sur Ctrl+C pour arreter l'emulateur
echo.

call firebase emulators:start --only functions,firestore,auth

pause

