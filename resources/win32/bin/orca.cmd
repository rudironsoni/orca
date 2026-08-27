@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
REM Why %~n0: downstream distributions ship this same shim under their own CLI
REM name (e.g. horca.cmd beside horca.exe), so the native launcher name
REM derives from the shim's own basename.
set "LAUNCHER=%SCRIPT_DIR%%~n0.exe"

if not exist "%LAUNCHER%" (
  echo Unable to locate the native CLI launcher at "%LAUNCHER%" 1>&2
  exit /b 1
)

REM Why: cmd.exe reparses %%* and can execute/truncate embedded newlines. The
REM native launcher is the supported path for orchestration message bodies.
if /I "%~1"=="orchestration" if /I "%~2"=="send" goto :unsafe_body
if /I "%~1"=="orchestration" if /I "%~2"=="reply" goto :unsafe_body

"%LAUNCHER%" %*
exit /b %ERRORLEVEL%

:unsafe_body
echo orca.cmd cannot safely forward orchestration message bodies. Use "%LAUNCHER%" instead. 1>&2
exit /b 2
