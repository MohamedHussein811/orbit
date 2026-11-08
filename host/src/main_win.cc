// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
// Portions copyright (c) 2013 The Chromium Embedded Framework Authors, under the BSD-style
// license in THIRD_PARTY_NOTICES.md.

#include <windows.h>

#include "include/cef_command_line.h"
#include "include/cef_sandbox_win.h"
#include "include/cef_version_info.h"
#include "orbit_app.h"
#include "startup.h"

namespace {

int RunMain(HINSTANCE instance, void* sandbox_info) {
  CefMainArgs main_args(instance);
  int exit_code = CefExecuteProcess(main_args, nullptr, sandbox_info);
  if (exit_code >= 0) {
    return exit_code;
  }

  CefRefPtr<CefCommandLine> command_line = CefCommandLine::CreateCommandLine();
  command_line->InitFromString(::GetCommandLineW());

  orbit::StartupOptions options;
  if (!orbit::ResolveStartup(command_line, options, exit_code)) {
    return exit_code;
  }

  CefSettings settings;
  orbit::FillSettings(options, settings);

  CefRefPtr<orbit::OrbitApp> app(new orbit::OrbitApp(options));
  if (!CefInitialize(main_args, settings, app.get(), sandbox_info)) {
    return CefGetExitCode();
  }
  CefRunMessageLoop();
  CefShutdown();
  return 0;
}

}  // namespace

// Called by bootstrap.exe, CEF's sandboxed entry point. |sandbox_info| is always set in a
// supported launch, and Orbit never disables the sandbox.
CEF_BOOTSTRAP_EXPORT int RunWinMain(HINSTANCE instance,
                                    LPWSTR command_line,
                                    int show_command,
                                    void* sandbox_info,
                                    cef_version_info_t* version_info) {
  return RunMain(instance, sandbox_info);
}
