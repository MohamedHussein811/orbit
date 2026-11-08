// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

#ifndef ORBIT_HOST_ORBIT_APP_H_
#define ORBIT_HOST_ORBIT_APP_H_

#include "include/cef_app.h"
#include "orbit_client.h"
#include "startup.h"

namespace orbit {

class OrbitApp : public CefApp, public CefBrowserProcessHandler {
 public:
  explicit OrbitApp(StartupOptions options);
  OrbitApp(const OrbitApp&) = delete;
  OrbitApp& operator=(const OrbitApp&) = delete;

  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override { return this; }
  void OnBeforeCommandLineProcessing(const CefString& process_type,
                                     CefRefPtr<CefCommandLine> command_line) override;

  void OnRegisterCustomPreferences(cef_preferences_type_t type,
                                   CefRawPtr<CefPreferenceRegistrar> registrar) override;
  void OnContextInitialized() override;
  bool OnAlreadyRunningAppRelaunch(CefRefPtr<CefCommandLine> command_line,
                                   const CefString& current_directory) override;
  CefRefPtr<CefClient> GetDefaultClient() override;

 private:
  const StartupOptions options_;
  CefRefPtr<OrbitClient> client_;

  IMPLEMENT_REFCOUNTING(OrbitApp);
};

}  // namespace orbit

#endif  // ORBIT_HOST_ORBIT_APP_H_
