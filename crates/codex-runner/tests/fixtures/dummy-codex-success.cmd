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
  echo       --reasoning-effort ^<EFFORT^>
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
more 1>&2
echo prompt: Say done 1>&2
echo prompt: Check project status. 1>&2
echo {"type":"session","id":"sess_dummy_success"}
echo {"type":"message","content":"done"}
if defined LAST_MESSAGE echo done>"%LAST_MESSAGE%"
exit /b 0
