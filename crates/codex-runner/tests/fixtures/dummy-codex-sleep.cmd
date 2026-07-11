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
more >nul
echo {"type":"message","content":"early"}
ping -n 11 127.0.0.1 >nul
echo {"type":"message","content":"late"}
exit /b 0
