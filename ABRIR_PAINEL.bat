@echo off
chcp 65001 >nul
cls

echo.
echo ═══════════════════════════════════════════════════════════
echo           ABRINDO PAINEL FINANCEIRO NO CHROME
echo ═══════════════════════════════════════════════════════════
echo.

REM Obtém o diretório do script
cd /d "%~dp0"

REM Inicia o servidor Python em background
echo ⏳ Iniciando servidor HTTP local...
start cmd /k python -m http.server 8000

REM Aguarda 2 segundos para o servidor iniciar
timeout /t 2 /nobreak

REM Abre o Chrome na URL correta
echo 🚀 Abrindo Chrome...
start chrome http://localhost:8000

echo.
echo ✅ Painel aberto em http://localhost:8000
echo.
echo 📝 IMPORTANTE:
echo    - O servidor está rodando em background (janela preta)
echo    - Para parar, feche a janela do servidor
echo    - Chrome vai abrir automaticamente
echo.
echo ═══════════════════════════════════════════════════════════
