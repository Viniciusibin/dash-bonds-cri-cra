@echo off
cd /d "%~dp0"
set PYTHON=C:\Users\ViniciusIbiapina\dash-titulos\venv\Scripts\python.exe

echo ===========================================
echo  BTG Pactual - Monitor de Renda Fixa
echo ===========================================
echo  Iniciando servidor...
echo  Acesse: http://localhost:5001
echo.

start "" "http://localhost:5001"
"%PYTHON%" app.py

echo.
echo Servidor encerrado.
pause
