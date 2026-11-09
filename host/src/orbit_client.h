// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

#ifndef ORBIT_HOST_ORBIT_CLIENT_H_
#define ORBIT_HOST_ORBIT_CLIENT_H_

#include <list>

#include "include/cef_client.h"
#include "include/cef_request_handler.h"
#include "startup.h"

namespace orbit {

// Shared by every Orbit window, including those Chromium's own UI opens.
class OrbitClient : public CefClient, public CefLifeSpanHandler, public CefCommandHandler, public CefRequestHandler {
 public:
  explicit OrbitClient(StartupOptions options);
  OrbitClient(const OrbitClient&) = delete;
  OrbitClient& operator=(const OrbitClient&) = delete;

  static OrbitClient* GetInstance();

  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefCommandHandler> GetCommandHandler() override { return this; }
  CefRefPtr<CefRequestHandler> GetRequestHandler() override { return this; }

  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override;
  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override;

  bool OnChromeCommand(CefRefPtr<CefBrowser> browser,
                       int command_id,
                       cef_window_open_disposition_t disposition) override;
  bool IsChromeAppMenuItemVisible(CefRefPtr<CefBrowser> browser, int command_id) override;

  CefRefPtr<CefResourceRequestHandler> GetResourceRequestHandler(CefRefPtr<CefBrowser> browser,
                                                                 CefRefPtr<CefFrame> frame,
                                                                 CefRefPtr<CefRequest> request,
                                                                 bool is_navigation,
                                                                 bool is_download,
                                                                 const CefString& request_initiator,
                                                                 bool& disable_default_handling) override;

  void CloseAllBrowsers(bool force_close);
  bool HasNoWindows() const { return browsers_.empty(); }
  const std::list<CefRefPtr<CefBrowser>>& browsers() const { return browsers_; }

  // Opens |url| as a new tab in an existing window. Returns false if no window is open.
  bool OpenTab(const std::string& url);

  // Opens a new window showing |url|.
  void OpenWindow(const std::string& url);

 private:
  void ApplyStartupSetting(CefRefPtr<CefBrowser> browser);
  void OpenStartupUrls(CefRefPtr<CefBrowser> browser);
  void MaybeRestoreSession(CefRefPtr<CefBrowser> browser);
  void TryRestore();
  void CloseInitialAfterRestore();
  void ClearRestoreGuard();

  const StartupOptions options_;
  std::list<CefRefPtr<CefBrowser>> browsers_;
  bool restore_checked_ = false;
  bool quitting_ = false;
  CefRefPtr<CefBrowser> initial_browser_;
  int restore_attempts_ = 0;
  size_t browsers_before_restore_ = 0;

  IMPLEMENT_REFCOUNTING(OrbitClient);
};

}  // namespace orbit

#endif  // ORBIT_HOST_ORBIT_CLIENT_H_
