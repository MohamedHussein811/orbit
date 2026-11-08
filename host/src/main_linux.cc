// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
// Portions copyright (c) 2013 The Chromium Embedded Framework Authors, under the BSD-style
// license in THIRD_PARTY_NOTICES.md.

#if defined(CEF_X11)
#include <X11/Xlib.h>
#endif

#include "include/base/cef_logging.h"
#include "include/cef_command_line.h"
#include "orbit_app.h"
#include "startup.h"

#if defined(CEF_X11)
namespace {

int XErrorHandlerImpl(Display* display, XErrorEvent* event) {
  LOG(WARNING) << "X error received: type " << event->type << ", error_code "
               << static_cast<int>(event->error_code);
  return 0;
}

int XIOErrorHandlerImpl(Display* display) {
  return 0;
}

}  // namespace
#endif

NO_STACK_PROTECTOR
int main(int argc, char* argv[]) {
  CefMainArgs main_args(argc, argv);
  int exit_code = CefExecuteProcess(main_args, nullptr, nullptr);
  if (exit_code >= 0) {
    return exit_code;
  }

#if defined(CEF_X11)
  XSetErrorHandler(XErrorHandlerImpl);
  XSetIOErrorHandler(XIOErrorHandlerImpl);
#endif

  CefRefPtr<CefCommandLine> command_line = CefCommandLine::CreateCommandLine();
  command_line->InitFromArgv(argc, argv);

  orbit::StartupOptions options;
  if (!orbit::ResolveStartup(command_line, options, exit_code)) {
    return exit_code;
  }

  CefSettings settings;
  orbit::FillSettings(options, settings);

  CefRefPtr<orbit::OrbitApp> app(new orbit::OrbitApp(options));
  if (!CefInitialize(main_args, settings, app.get(), nullptr)) {
    return CefGetExitCode();
  }
  CefRunMessageLoop();
  CefShutdown();
  return 0;
}
