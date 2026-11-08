// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

#include "startup.h"

#include <cstdlib>
#include <fstream>
#include <sstream>
#include <vector>

#if defined(OS_WIN)
#include <windows.h>
#elif defined(OS_MAC)
#include <mach-o/dyld.h>
#endif

namespace orbit {

namespace fs = std::filesystem;

namespace {

constexpr char kNewTabUrl[] = "chrome://newtab/";

#if defined(OS_WIN)
std::wstring ReadEnv(const wchar_t* name) {
  wchar_t buffer[32768];
  const DWORD length = GetEnvironmentVariableW(name, buffer, 32768);
  if (length == 0 || length >= 32768) {
    return std::wstring();
  }
  return std::wstring(buffer, length);
}

fs::path EnvPath(const char* name) {
  const std::string narrow(name);
  return fs::path(ReadEnv(std::wstring(narrow.begin(), narrow.end()).c_str()));
}
#else
fs::path EnvPath(const char* name) {
  const char* value = std::getenv(name);
  return value ? fs::path(value) : fs::path();
}
#endif

fs::path DefaultUserDataRoot() {
#if defined(OS_WIN)
  fs::path base = EnvPath("LOCALAPPDATA");
  if (base.empty()) {
    base = EnvPath("USERPROFILE") / "AppData" / "Local";
  }
  return base / "NovaTech" / "Orbit" / "User Data";
#elif defined(OS_MAC)
  return EnvPath("HOME") / "Library" / "Application Support" / "Orbit";
#else
  fs::path base = EnvPath("XDG_CONFIG_HOME");
  if (base.empty()) {
    base = EnvPath("HOME") / ".config";
  }
  return base / "orbit";
#endif
}

std::string ReadFile(const fs::path& file) {
  std::ifstream in(file, std::ios::binary);
  std::stringstream contents;
  contents << in.rdbuf();
  return contents.str();
}

fs::path ExecutablePath() {
#if defined(OS_WIN)
  wchar_t buffer[32768];
  const DWORD length = GetModuleFileNameW(nullptr, buffer, 32768);
  return fs::path(std::wstring(buffer, length));
#elif defined(OS_MAC)
  char buffer[4096];
  uint32_t size = sizeof(buffer);
  if (_NSGetExecutablePath(buffer, &size) != 0) {
    return fs::path();
  }
  return fs::path(buffer);
#else
  std::error_code ignored;
  return fs::read_symlink("/proc/self/exe", ignored);
#endif
}

// The extension ships next to the executable, or inside the app bundle on macOS.
fs::path BuiltInExtensionDir() {
  const fs::path folder = ExecutablePath().parent_path();
#if defined(OS_MAC)
  return folder.parent_path() / "Resources" / "orbit-core";
#else
  return folder / "orbit-core";
#endif
}

bool LastRunCrashed(const fs::path& root) {
  return ReadFile(root / "Default" / "Preferences").find("\"exit_type\":\"Crashed\"") != std::string::npos;
}

// Protected preferences live in "Secure Preferences" on Windows and macOS, and in "Preferences" on Linux.
int SavedStartupSetting(const fs::path& root) {
  static const std::string kKey = "\"restore_on_startup\":";
  for (const char* name : {"Secure Preferences", "Preferences"}) {
    const std::string contents = ReadFile(root / "Default" / name);
    for (size_t at = contents.find(kKey); at != std::string::npos; at = contents.find(kKey, at + 1)) {
      const size_t value = at + kKey.size();
      if (value < contents.size() && contents[value] >= '0' && contents[value] <= '9') {
        return contents[value] - '0';
      }
    }
  }
  return kStartupNewTab;
}

// Percent-encodes a local path into a file: URL.
std::string FileUrlFromPath(const fs::path& path) {
  std::string generic = path.generic_u8string().empty() ? std::string() : std::string(reinterpret_cast<const char*>(path.generic_u8string().c_str()));
  std::string url = generic.rfind("/", 0) == 0 ? "file://" : "file:///";
  static const char kHex[] = "0123456789ABCDEF";
  for (unsigned char c : generic) {
    const bool keep = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '/' || c == ':' || c == '-' || c == '_' || c == '.' || c == '~';
    if (keep) {
      url.push_back(static_cast<char>(c));
    } else {
      url.push_back('%');
      url.push_back(kHex[c >> 4]);
      url.push_back(kHex[c & 15]);
    }
  }
  return url;
}

bool IsOpenableUrl(const std::string& value) {
  for (const char* scheme : {"http://", "https://", "file://"}) {
    if (value.rfind(scheme, 0) == 0) {
      return true;
    }
  }
  return false;
}

}  // namespace

std::filesystem::path RestoreGuardPath(const StartupOptions& options) {
  return options.user_data_root / "orbit-restore-guard";
}

std::string UrlFromArguments(CefRefPtr<CefCommandLine> command_line) {
  std::vector<CefString> arguments;
  command_line->GetArguments(arguments);
  for (const CefString& argument : arguments) {
    const std::string value = argument.ToString();
    if (IsOpenableUrl(value)) {
      return value;
    }
    std::error_code ignored;
    const fs::path path(argument.ToWString());
    if (path.is_absolute() && fs::is_regular_file(path, ignored)) {
      return FileUrlFromPath(path);
    }
  }
  return std::string();
}

bool ResolveStartup(CefRefPtr<CefCommandLine> command_line,
                    StartupOptions& options,
                    int& exit_code) {
  options.user_data_root = EnvPath("ORBIT_USER_DATA_DIR");
#if defined(ORBIT_TEST_BUILD)
  // The test build never falls back to a real profile.
  if (options.user_data_root.empty()) {
    exit_code = kExitNoTestProfile;
    return false;
  }
#endif
  if (options.user_data_root.empty()) {
    options.user_data_root = DefaultUserDataRoot();
  }

  std::error_code ignored;
  fs::create_directories(options.user_data_root, ignored);

  options.extension_dir = BuiltInExtensionDir();
  options.startup_setting = SavedStartupSetting(options.user_data_root);
  options.crashed_last_run = LastRunCrashed(options.user_data_root);
  if (options.crashed_last_run) {
    options.crash_loop_detected = fs::exists(RestoreGuardPath(options), ignored);
  }

  options.initial_url = UrlFromArguments(command_line);
#if defined(ORBIT_TEST_BUILD)
  if (command_line->HasSwitch("url")) {
    options.initial_url = command_line->GetSwitchValue("url").ToString();
  }
#endif
  options.explicit_url = !options.initial_url.empty();
  if (!options.explicit_url) {
    options.initial_url = kNewTabUrl;
  }
  return true;
}

void FillSettings(const StartupOptions& options, CefSettings& settings) {
  CefString(&settings.root_cache_path) = options.user_data_root.native();
  CefString(&settings.cache_path) = options.user_data_root.native();
#if defined(ORBIT_TEST_BUILD)
  settings.log_severity = LOGSEVERITY_WARNING;
#else
  settings.command_line_args_disabled = true;
  settings.log_severity = LOGSEVERITY_DISABLE;
#endif
}

}  // namespace orbit
