@echo off
echo Downloading all product photos for Tinsel ^& Pine...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\download-images.ps1"
echo.
pause
