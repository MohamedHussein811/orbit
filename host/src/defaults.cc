// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

#include "defaults.h"

#include "host_api.h"

#include <string>
#include <vector>

#include "include/base/cef_logging.h"
#include "include/cef_values.h"

namespace orbit {

namespace {

constexpr int kDefaultsVersion = 1;
constexpr char kVersionPref[] = "orbit.defaults_version";
constexpr char kDefaultThemeMode[] = "space";
constexpr char kDefaultAccent[] = "#8d9bff";

const char* const kSwitches[] = {
    "disable-default-apps",
    "disable-domain-reliability",
    "disable-sync",
    "no-pings",
};

const char* const kEnableFeatures[] = {
    "CertificateTransparencyAskBeforeEnabling",
};

// Web APIs and browser features for AI and advertising.
const char* const kAiAndAdFeatures[] = {
    "AIPromptAPI",        "AISummarizationAPI", "AIWriterAPI",
    "AIRewriterAPI",      "AIProofreadingAPI",  "TranslationAPI",
    "LanguageDetectionAPI", "Fledge",           "TopicsAPI",
    "SharedStorageAPI",   "AttributionReporting", "FencedFrames",
    "PrivateStateTokens", "AdInterestGroupAPI",
};

const char* const kDisableFeatures[] = {
    "AimEnabled",
    "AimServerEligibilityEnabled",
    "NtpFooter",
    "NetworkTimeServiceQuerying",
    "PrivacySandboxAdsAPIsM1Override",
};

void MergeList(CefRefPtr<CefCommandLine> command_line,
               const char* name,
               const std::vector<std::string>& values) {
  std::string merged = command_line->GetSwitchValue(name).ToString();
  for (const std::string& value : values) {
    if (!merged.empty()) {
      merged += ",";
    }
    merged += value;
  }
  command_line->AppendSwitchWithValue(name, merged);
}

CefRefPtr<CefValue> BoolValue(bool value) {
  CefRefPtr<CefValue> result = CefValue::Create();
  result->SetBool(value);
  return result;
}

CefRefPtr<CefValue> IntValue(int value) {
  CefRefPtr<CefValue> result = CefValue::Create();
  result->SetInt(value);
  return result;
}

CefRefPtr<CefValue> StringValue(const char* value) {
  CefRefPtr<CefValue> result = CefValue::Create();
  result->SetString(value);
  return result;
}

CefRefPtr<CefValue> DefaultSearchEngine() {
  CefRefPtr<CefDictionaryValue> engine = CefDictionaryValue::Create();
  engine->SetString("keyword", "duckduckgo.com");
  engine->SetString("short_name", "DuckDuckGo");
  engine->SetString("url", "https://duckduckgo.com/?q={searchTerms}");
  engine->SetString("suggestions_url", "https://duckduckgo.com/ac/?q={searchTerms}&type=list");
  engine->SetString("favicon_url", "https://duckduckgo.com/favicon.ico");
  engine->SetBool("safe_for_autoreplace", false);
  engine->SetString("id", "orbit-default-search");
  CefRefPtr<CefValue> result = CefValue::Create();
  result->SetDictionary(engine);
  return result;
}

// Lets the built-in extension run in private windows and skips the new tab change prompt.
void SeedExtensionPrefs(CefRefPtr<CefRequestContext> context) {
  CefRefPtr<CefValue> current = context->GetPreference("extensions.settings");
  CefRefPtr<CefDictionaryValue> settings =
      current && current->GetType() == VTYPE_DICTIONARY ? current->GetDictionary()->Copy(false) : CefDictionaryValue::Create();
  CefRefPtr<CefDictionaryValue> entry =
      settings->HasKey(kExtensionId) ? settings->GetDictionary(kExtensionId) : CefDictionaryValue::Create();
  entry->SetBool("incognito", true);
  entry->SetBool("ack_ntp_bubble", true);
  settings->SetDictionary(kExtensionId, entry);
  CefRefPtr<CefValue> value = CefValue::Create();
  value->SetDictionary(settings);
  CefString error;
  if (!context->SetPreference("extensions.settings", value, error)) {
    LOG(WARNING) << "Could not set extension preferences: " << error.ToString();
  }

  CefRefPtr<CefListValue> pinned = CefListValue::Create();
  pinned->SetString(0, kExtensionId);
  CefRefPtr<CefValue> pinned_value = CefValue::Create();
  pinned_value->SetList(pinned);
  context->SetPreference("extensions.pinned_extensions", pinned_value, error);
}

void Set(CefRefPtr<CefPreferenceManager> manager,
         const char* name,
         CefRefPtr<CefValue> value) {
  CefString error;
  if (!manager->CanSetPreference(name) ||
      !manager->SetPreference(name, value, error)) {
    LOG(WARNING) << "Could not set preference " << name << ": " << error.ToString();
  }
}

}  // namespace

void ApplySwitches(CefRefPtr<CefCommandLine> command_line, const std::filesystem::path& extension_dir) {
  for (const char* name : kSwitches) {
    command_line->AppendSwitch(name);
  }
  std::error_code ignored;
  if (std::filesystem::exists(extension_dir / "manifest.json", ignored)) {
    command_line->AppendSwitchWithValue("load-extension", extension_dir.native());
  }
  std::vector<std::string> enable(std::begin(kEnableFeatures), std::end(kEnableFeatures));
  MergeList(command_line, "enable-features", enable);

  std::vector<std::string> disable(std::begin(kDisableFeatures), std::end(kDisableFeatures));
  disable.insert(disable.end(), std::begin(kAiAndAdFeatures), std::end(kAiAndAdFeatures));
  MergeList(command_line, "disable-features", disable);

  std::vector<std::string> blink(std::begin(kAiAndAdFeatures), std::end(kAiAndAdFeatures));
  MergeList(command_line, "disable-blink-features", blink);
}

void RegisterPreferences(cef_preferences_type_t type,
                         CefRawPtr<CefPreferenceRegistrar> registrar) {
  registrar->AddPreference(kVersionPref, IntValue(0));
}

void EnsureGlobalDefaults() {
  CefRefPtr<CefPreferenceManager> manager = CefPreferenceManager::GetGlobalPreferenceManager();
  CefRefPtr<CefValue> applied = manager->GetPreference(kVersionPref);
  if (applied && applied->GetInt() >= kDefaultsVersion) {
    return;
  }
  Set(manager, "dns_over_https.mode", StringValue("secure"));
  Set(manager, "dns_over_https.templates", StringValue("https://dns.quad9.net/dns-query"));
  Set(manager, "user_experience_metrics.reporting_enabled", BoolValue(false));
  Set(manager, kVersionPref, IntValue(kDefaultsVersion));
}

void EnsureContextDefaults(CefRefPtr<CefRequestContext> context) {
  if (!context || !context->HasPreference(kVersionPref)) {
    return;
  }
  CefRefPtr<CefValue> applied = context->GetPreference(kVersionPref);
  if (applied && applied->GetInt() >= kDefaultsVersion) {
    return;
  }
  Set(context, "default_search_provider_data.template_url_data", DefaultSearchEngine());
  Set(context, "profile.cookie_controls_mode", IntValue(1));
  Set(context, "https_only_mode_enabled", BoolValue(true));
  Set(context, "safebrowsing.enabled", BoolValue(false));
  Set(context, "safebrowsing.enhanced", BoolValue(false));
  Set(context, "search.suggest_enabled", BoolValue(false));
  Set(context, "net.network_prediction_options", IntValue(2));
  Set(context, "translate.enabled", BoolValue(false));
  Set(context, "alternate_error_pages.enabled", BoolValue(false));
  Set(context, "url_keyed_anonymized_data_collection.enabled", BoolValue(false));
  Set(context, "spellcheck.use_spelling_service", BoolValue(false));
  Set(context, "signin.allowed", BoolValue(false));
  Set(context, "profile.password_manager_leak_detection", BoolValue(false));
  SeedExtensionPrefs(context);
  ApplyBrowserTheme(context, kDefaultThemeMode, kDefaultAccent);
  Set(context, kVersionPref, IntValue(kDefaultsVersion));
}

}  // namespace orbit
