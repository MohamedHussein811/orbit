; Orbit's Windows setup: a window with Orbit's privacy policy to accept, progress, an automatic
; updates choice and a "Launch Orbit" choice around Chromium's own installer, which has no window. Chromium's installer does the install,
; per user, and registers the uninstall entry, so this setup installs nothing of its own and has no
; uninstaller. Orbit's updater runs this same file with /VERYSILENT, which keeps the person's
; automatic updates choice.
; The privacy policy is PRIVACY.md as plain text, written by privacy-text.mjs.
;   ISCC /DVersion=<x.y.z.w> /DInstaller=<mini_installer.exe> /DBranding=<branding folder> /DPrivacy=<privacy.txt> /O<out> orbit.iss

#ifndef Version
  #error Version is required
#endif
#ifndef Installer
  #error Installer is required
#endif
#ifndef Branding
  #error Branding is required
#endif
#ifndef Privacy
  #error Privacy is required
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
LicenseFile={#Privacy}
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

[Messages]
en.WizardLicense=Privacy policy
en.LicenseLabel=Please read Orbit's privacy policy before you continue.
en.LicenseLabel3=It lists every connection Orbit makes on its own. Accept it to install Orbit.
#ifdef Arabic
ar.WizardLicense=سياسة الخصوصية
ar.LicenseLabel=يُرجى قراءة سياسة الخصوصية في Orbit قبل المتابعة.
ar.LicenseLabel3=تذكر كل اتصال يجريه Orbit من تلقاء نفسه. اقبلها لتثبيت Orbit.
#endif

[CustomMessages]
en.Welcome=Orbit is a private, fast browser built on Chromium.%n%nSetup installs Orbit for your Windows account. It takes about a minute.%n%nOrbit has no accounts, ads or telemetry. To stay up to date it checks Orbit's releases on GitHub every few hours, which you can turn off during setup.
#ifdef Arabic
ar.Welcome=Orbit متصفح خاص وسريع مبني على Chromium.%n%nيثبّت المعالج Orbit لحساب Windows الخاص بك. يستغرق ذلك دقيقة تقريبًا.%n%nلا يحتوي Orbit على حسابات أو إعلانات أو قياس عن بُعد. ليبقى محدّثًا، يتحقق من إصدارات Orbit على GitHub كل بضع ساعات، ويمكنك إيقاف ذلك أثناء التثبيت.
#endif
en.PrivacyAccept=I have read and accept Orbit's privacy policy
#ifdef Arabic
ar.PrivacyAccept=قرأت سياسة الخصوصية في Orbit وأقبلها
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
en.AutoUpdate=Keep Orbit up to date automatically
#ifdef Arabic
ar.AutoUpdate=إبقاء Orbit محدّثًا تلقائيًا
#endif
en.Launch=Launch Orbit
#ifdef Arabic
ar.Launch=تشغيل Orbit
#endif

[Tasks]
Name: "autoupdate"; Description: "{cm:AutoUpdate}"

[Registry]
; Read by Orbit's updater. Written only when a person runs setup, so silent updates keep the choice.
Root: HKCU; Subkey: "Software\NovaTech\Orbit Update"; ValueType: dword; ValueName: "Enabled"; ValueData: 1; Tasks: autoupdate; Check: not WizardSilent
Root: HKCU; Subkey: "Software\NovaTech\Orbit Update"; ValueType: dword; ValueName: "Enabled"; ValueData: 0; Tasks: not autoupdate; Check: not WizardSilent

[Files]
Source: "{#Installer}"; DestDir: "{tmp}"; DestName: "orbit_installer.exe"; Flags: deleteafterinstall

[Run]
Filename: "{localappdata}\NovaTech\Orbit\Application\orbit.exe"; Description: "{cm:Launch}"; Flags: nowait postinstall skipifsilent

[Code]
var
  Failure: String;
  PrivacyAccepted: TNewCheckBox;

// One checkbox in place of the license page's accept and decline buttons.
procedure PrivacyAcceptedClick(Sender: TObject);
begin
  WizardForm.LicenseAcceptedRadio.Checked := PrivacyAccepted.Checked;
  WizardForm.LicenseNotAcceptedRadio.Checked := not PrivacyAccepted.Checked;
  WizardForm.NextButton.Enabled := PrivacyAccepted.Checked;
end;

procedure InitializeWizard;
begin
  WizardForm.WelcomeLabel2.Caption := CustomMessage('Welcome');
  WizardForm.LicenseAcceptedRadio.Visible := False;
  WizardForm.LicenseNotAcceptedRadio.Visible := False;
  PrivacyAccepted := TNewCheckBox.Create(WizardForm);
  PrivacyAccepted.Parent := WizardForm.LicenseAcceptedRadio.Parent;
  PrivacyAccepted.Left := WizardForm.LicenseAcceptedRadio.Left;
  PrivacyAccepted.Top := WizardForm.LicenseAcceptedRadio.Top;
  PrivacyAccepted.Width := WizardForm.LicenseMemo.Width;
  PrivacyAccepted.Height := WizardForm.LicenseAcceptedRadio.Height;
  PrivacyAccepted.Caption := CustomMessage('PrivacyAccept');
  PrivacyAccepted.OnClick := @PrivacyAcceptedClick;
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
  if CurPageID = wpLicense then
    WizardForm.NextButton.Enabled := PrivacyAccepted.Checked;
  if (CurPageID = wpFinished) and (Failure <> '') then
  begin
    WizardForm.FinishedHeadingLabel.Caption := 'Orbit';
    WizardForm.FinishedLabel.Caption := Failure;
    WizardForm.RunList.Visible := False;
  end;
end;
