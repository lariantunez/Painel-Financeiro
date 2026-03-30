@echo off
chcp 65001 >nul
echo ===================================
echo Iniciando Servidor HTTP Local
echo ===================================
echo.
echo Abra seu navegador em: http://localhost:8000
echo.
python -m http.server 8000
