@echo off
rem === Sibilant Lisp REPL launcher (Windows) ===
rem Interactive command-line REPL. Keep this window open while using it.
setlocal
set "NODE=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2\node.exe"
if not exist "%NODE%" (
  echo [ERROR] WorkBuddy Node runtime not found: %NODE%
  pause
  exit /b 1
)
cd /d "%~dp0"

echo === Sibilant Lisp REPL ===
echo Type expressions and press Enter. Quit with (exit) or Ctrl+C.
echo Browser REPL: open index.html directly or run start.bat.
echo.
"%NODE%" "%~dp0run.js" %*
pause
