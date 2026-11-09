// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

#ifndef ORBIT_HOST_DEFAULTS_H_
#define ORBIT_HOST_DEFAULTS_H_

#include <filesystem>

#include "include/cef_command_line.h"
#include <filesystem>

#include "include/cef_preference.h"
#include <filesystem>

#include "include/cef_request_context.h"

namespace orbit {

// The built-in extension's ID, derived from the public key in extension/manifest.json.
inline constexpr char kExtensionId[] = "boccmnigbogdpajphlpgodcalflpinmk";

// Adds Orbit's privacy and security switches. Browser process only.
void ApplySwitches(CefRefPtr<CefCommandLine> command_line, const std::filesystem::path& extension_dir);

void RegisterPreferences(cef_preferences_type_t type,
                         CefRawPtr<CefPreferenceRegistrar> registrar);

// Apply first-run values once per profile, so that later user choices are kept.
void EnsureGlobalDefaults();
void EnsureContextDefaults(CefRefPtr<CefRequestContext> context);

}  // namespace orbit

#endif  // ORBIT_HOST_DEFAULTS_H_
