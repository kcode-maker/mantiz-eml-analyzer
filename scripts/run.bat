@echo off
REM Starts a local static server for Mantiz-EML-Analyzer and opens it in your browser.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
