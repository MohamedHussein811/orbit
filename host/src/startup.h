// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

#ifndef ORBIT_HOST_STARTUP_H_
#define ORBIT_HOST_STARTUP_H_

#include <filesystem>
#include <string>

#include "include/cef_app.h"
#include "include/cef_command_line.h"

namespace orbit {

constexpr int kExitNoTestProfile = 78;

// Values of Chromium's session.restore_on_startup preference.
constexpr int kStartupRestoreLastSession = 1;
constexpr int kStartupOpenUrls = 4;
constexpr int kStartupNewTab = 5;

// Facts about this launch, resolved before CEF starts.
struct StartupOptions {
  std::filesystem::path user_data_root;
  std::string initial_url;
  bool explicit_url = false;
  // Read from disk, because the live preference reads as the default once the browser starts.
  int startup_setting = kStartupNewTab;
  bool crashed_last_run = false;
  bool crash_loop_detected = false;
};

// Returns false if this build must not continue, setting |exit_code|.
bool ResolveStartup(CefRefPtr<CefCommandLine> command_line,
                    StartupOptions& options,
                    int& exit_code);

void FillSettings(const StartupOptions& options, CefSettings& settings);

std::filesystem::path RestoreGuardPath(const StartupOptions& options);

// Returns the URL to open for an argument, or an empty string if it is not safe to open.
std::string UrlFromArguments(CefRefPtr<CefCommandLine> command_line);

}  // namespace orbit

#endif  // ORBIT_HOST_STARTUP_H_
