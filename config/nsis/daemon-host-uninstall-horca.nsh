; Horca (downstream distribution) variant of daemon-host-uninstall.nsh.
;
; Why a separate file: NSIS includes are static, and each distribution's
; uninstaller must only ever kill and remove ITS OWN relocated terminal daemon.
; Sharing the official include would make uninstalling Horca destroy an
; installed Orca's live daemon (and vice versa), breaking side-by-side installs.
;
; The LOCALAPPDATA folder name must stay in sync with windowsDaemonHostRootName
; in src/shared/distribution-identity.json and LOCAL_HOST_ROOT_NAME in
; daemon-host-relocation.ts. The host exe is a verbatim copy of the app exe;
; horca-terminal-daemon.exe stays only to reap hosts left by older builds.
; See the official include for the relocation rationale and the ${isUpdated} guard.
;
; Why APP_FILENAME is redefined: electron-builder's oneClick per-user NSIS
; sets APP_FILENAME from package.json name (`orca`), so Horca would install
; into %LOCALAPPDATA%\Programs\orca and overwrite an official Orca tree.
; PRODUCT_FILENAME is already Horca (win.executableName).
!macro customHeader
  !define /redef APP_FILENAME "${PRODUCT_FILENAME}"
!macroend
; Why customInstall writes the protocol: electron-builder's `protocols` field
; is consumed by macOS/Linux/AppX only. NSIS never writes Software\Classes\<scheme>,
; and the app does not call setAsDefaultProtocolClient, so silent install left
; horca: unregistered (orca-builds 32753835695).
!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\horca" "" "URL:Horca"
  WriteRegStr SHELL_CONTEXT "Software\Classes\horca" "URL Protocol" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\horca\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\horca\shell" "" "open"
  WriteRegStr SHELL_CONTEXT "Software\Classes\horca\shell\open\command" "" '"$appExe" "%1"'
!macroend
!macro customUnInstall
  ${ifNot} ${isUpdated}
    Push $0
    Push $1
    Push $2
    ReadEnvStr $1 USERNAME
    ${if} $1 == ""
      StrCpy $2 ""
    ${else}
      StrCpy $2 '/FI "USERNAME eq $1"'
    ${endIf}
    nsExec::Exec 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" $2'
    Pop $0
    nsExec::Exec 'taskkill /F /IM "horca-terminal-daemon.exe" $2'
    Pop $0
    Pop $2
    Pop $1
    Pop $0
    ; Give the OS a moment to release the image lock before removing the tree.
    Sleep 500
    RMDir /r "$LOCALAPPDATA\Horca\daemon-host"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\horca"
  ${endIf}
!macroend
