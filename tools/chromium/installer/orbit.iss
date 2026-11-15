; Orbit's Windows setup: a window with progress and a "Launch Orbit" choice around Chromium's own
; installer, which has no window. Chromium's installer does the install, per user, and registers the
; uninstall entry, so this setup installs nothing of its own and has no uninstaller.
;   ISCC /DVersion=<x.y.z.w> /DInstaller=<mini_installer.exe> /DBranding=<branding folder> /O<out> orbit.iss

#ifndef Version
  #error Version is required
#endif
#ifndef Installer
  #error Installer is required
#endif
#ifndef Branding
  #error Branding is required
#endif

[Setup]
AppId={{6F2D4A1C-0B7E-4C9B-9E1A-5D3C8B7A2F10}
AppName=Orbit
AppVersion={#Version}
AppVerName=Orbit {#Version}
AppPublisher=NovaTech
AppPublisherURL=https://github.com/MohamedHussein811/orbit
VersionInfoVersion={#Version}
VersionInfoProductName=Orbit
VersionInfoDescription=Orbit Setup
VersionInfoCompany=NovaTech
DefaultDirName={localappdata}\NovaTech\Orbit
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
DisableWelcomePage=no
PrivilegesRequired=lowest
Uninstallable=no
CreateUninstallRegKey=no
CreateAppDir=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputBaseFilename=OrbitSetup-{#Version}-x64
SetupIconFile={#Branding}\icons\orbit.ico
WizardStyle=modern
WizardImageFile={#Branding}\installer\wizard-100.bmp,{#Branding}\installer\wizard-150.bmp,{#Branding}\installer\wizard-200.bmp
WizardSmallImageFile={#Branding}\installer\wizard-small-100.bmp,{#Branding}\installer\wizard-small-150.bmp,{#Branding}\installer\wizard-small-200.bmp
; Chromium's installer is already compressed.
Compression=none
ShowLanguageDialog=auto

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
#if FileExists(CompilerPath + "Languages\Arabic.isl")
  #define Arabic
Name: "ar"; MessagesFile: "compiler:Languages\Arabic.isl"
#endif

[CustomMessages]
en.Welcome=Orbit is a private, fast browser built on Chromium.%n%nSetup installs Orbit for your Windows account. It takes about a minute.
#ifdef Arabic
ar.Welcome=Orbit متصفح خاص وسريع مبني على Chromium.%n%nيثبّت المعالج Orbit لحساب Windows الخاص بك. يستغرق ذلك دقيقة تقريبًا.
#endif
en.Installing=Installing Orbit...
#ifdef Arabic
ar.Installing=جارٍ تثبيت Orbit...
#endif
en.NewerInstalled=A newer version of Orbit is already installed.
#ifdef Arabic
ar.NewerInstalled=يوجد إصدار أحدث من Orbit مثبّت بالفعل.
#endif
en.Failed=Orbit could not be installed (code %1). Close Orbit if it is open and try again.
#ifdef Arabic
ar.Failed=تعذّر تثبيت Orbit (الرمز %1). أغلق Orbit إن كان مفتوحًا وحاول مجددًا.
#endif
en.Launch=Launch Orbit
#ifdef Arabic
ar.Launch=تشغيل Orbit
#endif

[Files]
Source: "{#Installer}"; DestDir: "{tmp}"; DestName: "orbit_installer.exe"; Flags: deleteafterinstall

[Run]
Filename: "{localappdata}\NovaTech\Orbit\Application\orbit.exe"; Description: "{cm:Launch}"; Flags: nowait postinstall skipifsilent

[Code]
var
  Failure: String;

procedure InitializeWizard;
begin
  WizardForm.WelcomeLabel2.Caption := CustomMessage('Welcome');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep <> ssPostInstall then
    exit;
  WizardForm.StatusLabel.Caption := CustomMessage('Installing');
  WizardForm.FilenameLabel.Caption := '';
  WizardForm.ProgressGauge.Style := npbstMarquee;
  if not Exec(ExpandConstant('{tmp}\orbit_installer.exe'), '--do-not-launch-chrome', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    ResultCode := -1;
  WizardForm.ProgressGauge.Style := npbstNormal;
  // Chromium's installer: 0 installed, 1 repaired, 2 updated, 3 nothing to do, 30 updated while
  // Orbit was open (it switches on the next start), 4 a newer version is installed.
  case ResultCode of
    0, 1, 2, 3, 30: Failure := '';
    4: Failure := CustomMessage('NewerInstalled');
  else
    Failure := FmtMessage(CustomMessage('Failed'), [IntToStr(ResultCode)]);
  end;
  if Failure <> '' then
    Log('Orbit installer exit code ' + IntToStr(ResultCode));
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = wpFinished) and (Failure <> '') then
  begin
    WizardForm.FinishedHeadingLabel.Caption := 'Orbit';
    WizardForm.FinishedLabel.Caption := Failure;
    WizardForm.RunList.Visible := False;
  end;
end;
