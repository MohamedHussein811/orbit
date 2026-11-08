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

namespace {

// With no parent window, Chrome style opens Chromium's full tabbed browser.
void OpenWindow(CefRefPtr<CefClient> client, const std::string& url) {
  CefWindowInfo window_info;
#if defined(OS_WIN)
  window_info.SetAsPopup(nullptr, "Orbit");
#endif
  window_info.runtime_style = CEF_RUNTIME_STYLE_CHROME;
  CefBrowserSettings browser_settings;
  CefBrowserHost::CreateBrowser(window_info, client, url, browser_settings, nullptr, nullptr);
}

}  // namespace

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
  OpenWindow(client_, options_.initial_url);
}

bool OrbitApp::OnAlreadyRunningAppRelaunch(CefRefPtr<CefCommandLine> command_line,
                                           const CefString& current_directory) {
  const std::string url = UrlFromArguments(command_line);
  if (url.empty() || !client_) {
    return false;
  }
  if (!client_->OpenTab(url)) {
    OpenWindow(client_, url);
  }
  return true;
}

CefRefPtr<CefClient> OrbitApp::GetDefaultClient() {
  return client_;
}

}  // namespace orbit
