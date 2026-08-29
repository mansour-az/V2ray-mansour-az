#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

#define AppName "Venzo VPN"
#define AppExeName "Venzo-VPN.exe"

[Setup]
AppId={{7AF67E8D-DF95-4E4C-9B5D-5B1076C23042}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Venzo VPN
AppPublisherURL=https://t.me/venzo_vpn
AppSupportURL=https://t.me/Venzzo_vpn
AppUpdatesURL=https://github.com/mansour-az/V2ray-mansour-az/releases
DefaultDirName={autopf}\Venzo VPN
DefaultGroupName=Venzo VPN
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=dist
OutputBaseFilename=Venzo-VPN-Setup-{#AppVersion}
SetupIconFile=..\desktop\assets\app.ico
UninstallDisplayIcon={app}\{#AppExeName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
LicenseFile=..\staging\LICENSE

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "..\staging\bin\settings.json"; DestDir: "{app}\bin"; Flags: onlyifdoesntexist
Source: "..\staging\*"; DestDir: "{app}"; Excludes: "bin\settings.json"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Venzo VPN"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\Venzo VPN"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked
Name: "autostart"; Description: "Start Venzo VPN with Windows"; GroupDescription: "Startup:"; Flags: unchecked

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Venzo VPN"; ValueData: """{app}\{#AppExeName}"" -tray"; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Launch Venzo VPN"; Flags: nowait postinstall skipifsilent
