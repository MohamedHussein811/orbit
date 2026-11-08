; Orbit's Windows installer. Installs for the current user, with no administrator rights.
; Built by tools/package.mjs, which passes AppVersion, SourceDir and OutDir.

[Setup]
AppId={{F2C3D9A0-5A11-4B7E-9F3E-0E6C7A3B8D21}
AppName=Orbit
AppVersion={#AppVersion}
AppVerName=Orbit {#AppVersion}
AppPublisher=NovaTech
AppPublisherURL=https://github.com/MohamedHussein811/orbit
AppSupportURL=https://github.com/MohamedHussein811/orbit/issues
VersionInfoCompany=NovaTech
VersionInfoProductName=Orbit
VersionInfoVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\Orbit
DisableDirPage=yes
DisableProgramGroupPage=yes
DefaultGroupName=Orbit
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#OutDir}
OutputBaseFilename=Orbit-{#AppVersion}-windows-x64-setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\orbit.exe
UninstallDisplayName=Orbit
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
ChangesAssociations=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[InstallDelete]
; A new version must not keep files the old one shipped.
Type: filesandordirs; Name: "{app}\orbit-core"
Type: filesandordirs; Name: "{app}\locales"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Orbit"; Filename: "{app}\orbit.exe"; AppUserModelID: "NovaTech.Orbit"
Name: "{userdesktop}\Orbit"; Filename: "{app}\orbit.exe"; Tasks: desktopicon; AppUserModelID: "NovaTech.Orbit"

[Registry]
; Lets Windows offer Orbit as a browser in Default apps. Nothing here changes the current default.
Root: HKCU; Subkey: "Software\Classes\OrbitHTML"; ValueType: string; ValueData: "Orbit HTML Document"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\OrbitHTML\DefaultIcon"; ValueType: string; ValueData: "{app}\orbit.exe,0"
Root: HKCU; Subkey: "Software\Classes\OrbitHTML\shell\open\command"; ValueType: string; ValueData: """{app}\orbit.exe"" ""%1"""
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Orbit"; ValueType: string; ValueData: "Orbit"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Orbit\DefaultIcon"; ValueType: string; ValueData: "{app}\orbit.exe,0"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Orbit\shell\open\command"; ValueType: string; ValueData: """{app}\orbit.exe"""
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Orbit\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "Orbit"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Orbit\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "A privacy-focused web browser"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Orbit\Capabilities"; ValueType: string; ValueName: "ApplicationIcon"; ValueData: "{app}\orbit.exe,0"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Orbit\Capabilities\FileAssociations"; ValueType: string; ValueName: ".htm"; ValueData: "OrbitHTML"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Orbit\Capabilities\FileAssociations"; ValueType: string; ValueName: ".html"; ValueData: "OrbitHTML"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Orbit\Capabilities\FileAssociations"; ValueType: string; ValueName: ".pdf"; ValueData: "OrbitHTML"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Orbit\Capabilities\URLAssociations"; ValueType: string; ValueName: "http"; ValueData: "OrbitHTML"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Orbit\Capabilities\URLAssociations"; ValueType: string; ValueName: "https"; ValueData: "OrbitHTML"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Orbit\Capabilities\StartMenu"; ValueType: string; ValueName: "StartMenuInternet"; ValueData: "Orbit"
Root: HKCU; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "Orbit"; ValueData: "Software\Clients\StartMenuInternet\Orbit\Capabilities"; Flags: uninsdeletevalue

[Run]
; The network sandbox can only read files this group can read.
Filename: "{sys}\icacls.exe"; Parameters: """{app}"" /grant ""*S-1-15-2-2:(OI)(CI)(RX)"""; Flags: runhidden waituntilterminated
Filename: "{app}\orbit.exe"; Description: "Open Orbit"; Flags: postinstall nowait skipifsilent
