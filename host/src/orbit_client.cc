// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

#include "orbit_client.h"

#include <fstream>
#include <system_error>

#include "defaults.h"
#include "include/base/cef_callback.h"
#include "include/cef_id_mappers.h"
#include "include/cef_values.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/wrapper/cef_helpers.h"

namespace orbit {

namespace {

OrbitClient* g_instance = nullptr;

constexpr int kRestorePollMs = 250;
constexpr int kRestorePollLimit = 40;
constexpr int kRestoreSettleMs = 1500;
constexpr int kCrashGuardMs = 60000;
constexpr char kStartupPref[] = "session.restore_on_startup";
constexpr char kStartupUrlsPref[] = "session.startup_urls";

// Commands that lead to Google services or Chrome promotion.
bool IsRemovedCommand(int command_id) {
  static const int kRemoved[] = {
      cef_id_for_command_id_name("IDC_HELP_PAGE_VIA_KEYBOARD"),
      cef_id_for_command_id_name("IDC_HELP_PAGE_VIA_MENU"),
      cef_id_for_command_id_name("IDC_FEEDBACK"),
      cef_id_for_command_id_name("IDC_CHROME_WHATS_NEW"),
      cef_id_for_command_id_name("IDC_SEND_TAB_TO_SELF"),
      cef_id_for_command_id_name("IDC_SHOW_SIGNIN"),
      cef_id_for_command_id_name("IDC_SHOW_CHROME_LABS"),
  };
  for (int removed : kRemoved) {
    if (removed != -1 && removed == command_id) {
      return true;
    }
  }
  return false;
}

void OpenTabIn(CefRefPtr<CefBrowser> browser, const std::string& url) {
  CefRefPtr<CefDictionaryValue> params = CefDictionaryValue::Create();
  params->SetString("url", url);
  browser->GetHost()->ExecuteDevToolsMethod(0, "Target.createTarget", params);
}

}  // namespace

OrbitClient::OrbitClient(StartupOptions options) : options_(std::move(options)) {
  g_instance = this;
}

// static
OrbitClient* OrbitClient::GetInstance() {
  return g_instance;
}

void OrbitClient::OnAfterCreated(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();
  browsers_.push_back(browser);
  EnsureContextDefaults(browser->GetHost()->GetRequestContext());
  if (!restore_checked_) {
    restore_checked_ = true;
    ApplyStartupSetting(browser);
    MaybeRestoreSession(browser);
  }
}

void OrbitClient::OnBeforeClose(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();
  for (auto it = browsers_.begin(); it != browsers_.end(); ++it) {
    if ((*it)->IsSame(browser)) {
      browsers_.erase(it);
      break;
    }
  }
  if (browsers_.empty()) {
    CefQuitMessageLoop();
  }
}

bool OrbitClient::OnChromeCommand(CefRefPtr<CefBrowser> browser,
                                  int command_id,
                                  cef_window_open_disposition_t disposition) {
  return IsRemovedCommand(command_id);
}

bool OrbitClient::IsChromeAppMenuItemVisible(CefRefPtr<CefBrowser> browser, int command_id) {
  return !IsRemovedCommand(command_id);
}

void OrbitClient::CloseAllBrowsers(bool force_close) {
  if (!CefCurrentlyOn(TID_UI)) {
    CefPostTask(TID_UI, base::BindOnce(&OrbitClient::CloseAllBrowsers, this, force_close));
    return;
  }
  for (const auto& browser : browsers_) {
    browser->GetHost()->CloseBrowser(force_close);
  }
}

bool OrbitClient::OpenTab(const std::string& url) {
  CEF_REQUIRE_UI_THREAD();
  if (browsers_.empty()) {
    return false;
  }
  OpenTabIn(browsers_.back(), url);
  return true;
}

// Puts the saved choice back, so the Settings page shows it and the next launch can read it.
void OrbitClient::ApplyStartupSetting(CefRefPtr<CefBrowser> browser) {
  if (options_.startup_setting == kStartupNewTab) {
    return;
  }
  CefRefPtr<CefValue> value = CefValue::Create();
  value->SetInt(options_.startup_setting);
  CefString error;
  browser->GetHost()->GetRequestContext()->SetPreference(kStartupPref, value, error);
  if (options_.startup_setting == kStartupOpenUrls && !options_.crashed_last_run && !options_.explicit_url) {
    OpenStartupUrls(browser);
  }
}

void OrbitClient::OpenStartupUrls(CefRefPtr<CefBrowser> browser) {
  CefRefPtr<CefValue> urls = browser->GetHost()->GetRequestContext()->GetPreference(kStartupUrlsPref);
  if (!urls || urls->GetType() != VTYPE_LIST || urls->GetList()->GetSize() == 0) {
    return;
  }
  CefRefPtr<CefListValue> list = urls->GetList();
  browser->GetMainFrame()->LoadURL(list->GetString(0));
  for (size_t i = 1; i < list->GetSize(); ++i) {
    OpenTabIn(browser, list->GetString(i).ToString());
  }
}

void OrbitClient::MaybeRestoreSession(CefRefPtr<CefBrowser> browser) {
  std::error_code ignored;
  bool wanted = options_.startup_setting == kStartupRestoreLastSession;
  if (options_.crash_loop_detected) {
    // The last restore ended in another crash, so this launch stays empty.
    std::filesystem::remove(RestoreGuardPath(options_), ignored);
    wanted = false;
  } else if (options_.crashed_last_run) {
    wanted = true;
    std::ofstream(RestoreGuardPath(options_)) << "restoring after a crash\n";
    CefPostDelayedTask(TID_UI, base::BindOnce(&OrbitClient::ClearRestoreGuard, this), kCrashGuardMs);
  }
  if (!wanted) {
    return;
  }
  initial_browser_ = browser;
  restore_attempts_ = 0;
  CefPostDelayedTask(TID_UI, base::BindOnce(&OrbitClient::TryRestore, this), kRestorePollMs);
}

void OrbitClient::TryRestore() {
  if (!initial_browser_) {
    return;
  }
  static const int restore_id = cef_id_for_command_id_name("IDC_RESTORE_TAB");
  CefRefPtr<CefBrowserHost> host = initial_browser_->GetHost();
  if (restore_id != -1 && host->CanExecuteChromeCommand(restore_id)) {
    browsers_before_restore_ = browsers_.size();
    host->ExecuteChromeCommand(restore_id, CEF_WOD_CURRENT_TAB);
    CefPostDelayedTask(TID_UI, base::BindOnce(&OrbitClient::CloseInitialAfterRestore, this), kRestoreSettleMs);
    return;
  }
  if (++restore_attempts_ < kRestorePollLimit) {
    CefPostDelayedTask(TID_UI, base::BindOnce(&OrbitClient::TryRestore, this), kRestorePollMs);
    return;
  }
  initial_browser_ = nullptr;
}

void OrbitClient::CloseInitialAfterRestore() {
  if (initial_browser_ && !options_.explicit_url && browsers_.size() > browsers_before_restore_) {
    initial_browser_->GetHost()->CloseBrowser(false);
  }
  initial_browser_ = nullptr;
}

void OrbitClient::ClearRestoreGuard() {
  std::error_code ignored;
  std::filesystem::remove(RestoreGuardPath(options_), ignored);
}

}  // namespace orbit
