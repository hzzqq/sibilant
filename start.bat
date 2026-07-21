@echo off
rem === Sibilant Lisp launcher (Windows) ===
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo [ERROR] Node.js not found. Install from https://nodejs.org && pause && exit /b 1)
echo === Sibilant Lisp REPL ===
echo Type expressions and press Enter. Quit with (exit) or Ctrl+C.
echo Browser REPL: open index.html directly (plain script, works via file://).
echo.
node "%~dp0run.js" %*
pause
