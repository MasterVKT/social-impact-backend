@echo off
REM Script de test de migration pour Windows
echo ========================================
echo Test de migration migrateUserDocument
echo ========================================
echo.

REM Vérifier que nous sommes dans le bon dossier
if not exist "package.json" (
    echo Erreur: Ce script doit etre execute depuis le dossier backend/functions
    pause
    exit /b 1
)

REM Vérifier les arguments
if "%1"=="" (
    echo Usage: test-migration.bat [command] [userId] [dryRun]
    echo.
    echo Commandes:
    echo   single  - Tester avec un utilisateur specifique (defaut)
    echo   all     - Migrer tous les utilisateurs
    echo.
    echo Exemples:
    echo   test-migration.bat single test-user-001 true
    echo   test-migration.bat all true
    echo.
    set /p command="Entrez la commande (single/all): "
    if "!command!"=="" set command=single
    set /p userId="Entrez l'ID utilisateur (ou laissez vide pour test-user-001): "
    if "!userId!"=="" set userId=test-user-001
    set /p dryRun="Mode dry-run? (true/false, defaut: true): "
    if "!dryRun!"=="" set dryRun=true
) else (
    set command=%1
    set userId=%2
    if "%userId%"=="" set userId=test-user-001
    set dryRun=%3
    if "%dryRun%"=="" set dryRun=true
)

echo.
echo Execution du test...
echo   Commande: %command%
echo   User ID: %userId%
echo   Dry Run: %dryRun%
echo.

call npm run test:migrate -- %command% %userId% %dryRun%

if errorlevel 1 (
    echo.
    echo Erreur lors du test
    pause
    exit /b 1
)

echo.
echo Test termine avec succes!
pause

