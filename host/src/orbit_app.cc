// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

#include "orbit_app.h"

#include <string>

#include "defaults.h"
#include "include/cef_browser.h"
#include "include/cef_request_context.h"
#include "include/wrapper/cef_helpers.h"

namespace orbit {

OrbitApp::OrbitApp(StartupOptions options) : options_(std::move(options)) {}

void OrbitApp::OnBeforeCommandLineProcessing(const CefString& process_type,
                                             CefRefPtr<CefCommandLine> command_line) {
  if (process_type.empty()) {
    ApplySwitches(command_line, options_.extension_dir);
  }
}

void OrbitApp::OnRegisterCustomPreferences(cef_preferences_type_t type,
                                           CefRawPtr<CefPreferenceRegistrar> registrar) {
  RegisterPreferences(type, registrar);
}

void OrbitApp::OnContextInitialized() {
  CEF_REQUIRE_UI_THREAD();
  EnsureGlobalDefaults();
  EnsureContextDefaults(CefRequestContext::GetGlobalContext());
  client_ = new OrbitClient(options_);
  client_->OpenWindow(options_.initial_url);
}

bool OrbitApp::OnAlreadyRunningAppRelaunch(CefRefPtr<CefCommandLine> command_line,
                                           const CefString& current_directory) {
  if (!client_) {
    return false;
  }
  const std::string url = UrlFromArguments(command_line);
  if (url.empty()) {
    // With a window open, Chromium's default opens a new one. With none, nothing would appear.
    if (client_->HasNoWindows()) {
      client_->OpenWindow(std::string());
      return true;
    }
    return false;
  }
  if (!client_->OpenTab(url)) {
    client_->OpenWindow(url);
  }
  return true;
}

CefRefPtr<CefClient> OrbitApp::GetDefaultClient() {
  return client_;
}

}  // namespace orbit
