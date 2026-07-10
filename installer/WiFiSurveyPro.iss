; ── WiFi Survey Pro — Inno Setup installer script ───────────────────────────
; Build with Inno Setup 6 (https://jrsoftware.org/isdl.php):
;     ISCC installer\WiFiSurveyPro.iss
; Or run build_installer.bat from the repo root, which builds the exe first.
;
; Produces: installer\Output\WiFiSurveyProSetup-<version>.exe
; The installer places the app in Program Files and creates Start Menu +
; (optional) Desktop shortcuts. User data lives in %LOCALAPPDATA%\WiFi Survey Pro.

#define MyAppName "WiFi Survey Pro"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Rick Smart"
#define MyAppExeName "WiFi Survey Pro.exe"
; Path to the PyInstaller output, relative to this script (installer\ -> repo root).
#define MyAppExeSource "..\dist\WiFi Survey Pro.exe"

[Setup]
; A stable, unique GUID identifies this app for upgrades/uninstall. Do not change
; between versions — it lets new installers upgrade the previous install in place.
AppId={{9F4C2B7A-1E3D-4C88-9A21-7D5E0B6F42A1}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#MyAppExeName}
OutputDir=Output
OutputBaseFilename=WiFiSurveyProSetup-{#MyAppVersion}
SetupIconFile=..\assets\wifi-survey-pro.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; Per-user install by default so no admin rights are required; users can still
; choose an all-users install if they run elevated.
PrivilegesRequiredOverridesAllowed=dialog

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#MyAppExeSource}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
