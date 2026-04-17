#define AppName "Masterway OPC UA Data Logging"
#ifndef AppVersion
#define AppVersion "0.1.0"
#endif
#ifndef AppSourceDir
#define AppSourceDir "..\dist-excel-viewer\MasterwayExcelViewer"
#endif
#ifndef OutputBaseFilename
#define OutputBaseFilename "Masterway_OPCUA_Data_Logging_Setup"
#endif
#define AppPublisher "Masterway"
#define AppExeName "MasterwayExcelViewer.exe"

[Setup]
AppId={{EA3A7018-CBA1-4589-A31A-F221FD3157B5}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL=https://github.com/cowoo-hub/OPC-UA-Data-Logging-Program
AppSupportURL=https://github.com/cowoo-hub/OPC-UA-Data-Logging-Program
AppUpdatesURL=https://github.com/cowoo-hub/OPC-UA-Data-Logging-Program
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=dist
OutputBaseFilename={#OutputBaseFilename}
SetupIconFile=..\assets\masterway.ico
UninstallDisplayIcon={app}\{#AppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin

[Tasks]
Name: "desktopicon"; Description: "Create a desktop icon"; Flags: unchecked

[Files]
Source: "{#AppSourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{commondesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Launch Masterway OPC UA Data Logging"; Flags: nowait postinstall skipifsilent
