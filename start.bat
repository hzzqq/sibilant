@echo off
rem === Sibilant Lisp browser launcher (Windows) ===
rem Opens the Browser REPL directly (plain HTML/JS, no server needed).
rem Closing this window will NOT close the browser tab.
rem For the command-line REPL, use start-repl.bat instead.
setlocal
cd /d "%~dp0"

echo === Sibilant Browser REPL ===
echo Opening index.html in your default browser ...
start "" "%~dp0index.html"

echo.
echo [OK] Browser REPL opened.
echo     Tip: Close this window anytime; the page stays open.
echo     For the command-line REPL, run start-repl.bat.
timeout /t 2 /nobreak >nul
