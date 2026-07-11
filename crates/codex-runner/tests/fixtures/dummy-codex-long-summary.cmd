@echo off
setlocal EnableExtensions
if "%~1"=="--version" (
  echo codex 999.0.0-test
  exit /b 0
)
if "%~1"=="exec" if "%~2"=="--help" (
  echo Usage: codex exec [OPTIONS] -
  echo       --cd ^<DIR^>
  echo       --json
  echo       --color ^<WHEN^>
  echo       --model ^<MODEL^>
  echo       --sandbox ^<MODE^>
  echo       --config ^<key=value^>
  echo       --output-last-message ^<PATH^>
  echo       --skip-git-repo-check
  exit /b 0
)
if not "%~1"=="exec" exit /b 64
shift
set "LAST_MESSAGE="
:parse
if "%~1"=="" goto run
if "%~1"=="--output-last-message" goto capture_last_message
shift
goto parse
:capture_last_message
set "LAST_MESSAGE=%~2"
shift
shift
goto parse
:run
more >nul
echo {"type":"message","content":"long-summary"}
if defined LAST_MESSAGE powershell -NoProfile -Command "[IO.File]::WriteAllText($env:LAST_MESSAGE, (([char]0x3042).ToString() * 2105), [Text.UTF8Encoding]::new($false))"
exit /b 0
