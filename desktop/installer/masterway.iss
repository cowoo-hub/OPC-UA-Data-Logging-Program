#define AppName "Masterway"
#ifndef AppVersion
#define AppVersion "0.1.0"
#endif
#ifndef AppSourceDir
#define AppSourceDir "..\dist\Masterway"
#endif
#ifndef OutputBaseFilename
#define OutputBaseFilename "MasterwaySetup"
#endif
#define AppPublisher "Masterway"
#define AppExeName "Masterway.exe"

[Setup]
AppId={{EA3A7018-CBA1-4589-A31A-F221FD3157B5}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL=https://github.com/cowoo-hub/io-link-codex
AppSupportURL=https://github.com/cowoo-hub/io-link-codex
AppUpdatesURL=https://github.com/cowoo-hub/io-link-codex
DefaultDirName={pf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=dist
OutputBaseFilename={#OutputBaseFilename}
SetupIconFile=..\assets\masterway.ico
UninstallDisplayIcon={app}\{#AppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=admin

[Tasks]
Name: "desktopicon"; Description: "Create a desktop icon"; Flags: unchecked

[Files]
Source: "{#AppSourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{commondesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Launch Masterway"; Flags: nowait postinstall skipifsilent
