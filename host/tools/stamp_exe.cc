// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

// Build tool: replaces the icons and version information of a Windows executable with those in a
// compiled resource file. CEF documents changing these resources on its bootstrap executable.
//   orbit_stamp <exe> <res>

#include <windows.h>

#include <cstdint>
#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

namespace {

struct ResourceId {
  bool is_name = false;
  WORD number = 0;
  std::wstring name;

  LPCWSTR Get() const { return is_name ? name.c_str() : MAKEINTRESOURCEW(number); }
};

struct Resource {
  ResourceId type;
  ResourceId name;
  WORD language = 0;
  std::vector<BYTE> data;
};

struct Existing {
  LPCWSTR type;
  WORD number;
  WORD language;
};

size_t Align4(size_t value) {
  return (value + 3) & ~static_cast<size_t>(3);
}

size_t ReadId(const std::vector<BYTE>& file, size_t at, ResourceId& id) {
  const auto* words = reinterpret_cast<const WORD*>(&file[at]);
  if (words[0] == 0xFFFF) {
    id.number = words[1];
    return at + 4;
  }
  id.is_name = true;
  size_t length = 0;
  while (words[length] != 0) {
    id.name.push_back(static_cast<wchar_t>(words[length]));
    ++length;
  }
  return at + (length + 1) * 2;
}

// A .res file is a list of records, each a header followed by data, both aligned to 4 bytes.
bool ParseRes(const std::vector<BYTE>& file, std::vector<Resource>& out) {
  size_t at = 0;
  while (at + 32 <= file.size()) {
    const DWORD data_size = *reinterpret_cast<const DWORD*>(&file[at]);
    const DWORD header_size = *reinterpret_cast<const DWORD*>(&file[at + 4]);
    if (header_size < 32 || at + header_size + data_size > file.size()) {
      return false;
    }
    Resource resource;
    size_t field = ReadId(file, at + 8, resource.type);
    field = ReadId(file, field, resource.name);
    field = Align4(field);
    resource.language = *reinterpret_cast<const WORD*>(&file[field + 6]);
    if (data_size > 0) {
      resource.data.assign(file.begin() + at + header_size, file.begin() + at + header_size + data_size);
      out.push_back(std::move(resource));
    }
    at = Align4(at + header_size + data_size);
  }
  return true;
}

BOOL CALLBACK OnLanguage(HMODULE, LPCWSTR type, LPCWSTR name, WORD language, LONG_PTR context) {
  if (IS_INTRESOURCE(name)) {
    reinterpret_cast<std::vector<Existing>*>(context)->push_back({type, static_cast<WORD>(reinterpret_cast<ULONG_PTR>(name)), language});
  }
  return TRUE;
}

BOOL CALLBACK OnName(HMODULE module, LPCWSTR type, LPWSTR name, LONG_PTR context) {
  EnumResourceLanguagesW(module, type, name, OnLanguage, context);
  return TRUE;
}

std::vector<Existing> FindReplaced(const wchar_t* exe) {
  std::vector<Existing> found;
  HMODULE module = LoadLibraryExW(exe, nullptr, LOAD_LIBRARY_AS_DATAFILE);
  if (module) {
    constexpr WORD kIcon = 3;
    constexpr WORD kGroupIcon = 14;
    constexpr WORD kVersion = 16;
    for (WORD type : {kIcon, kGroupIcon, kVersion}) {
      EnumResourceNamesW(module, MAKEINTRESOURCEW(type), OnName, reinterpret_cast<LONG_PTR>(&found));
    }
    FreeLibrary(module);
  }
  return found;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  if (argc != 3) {
    fprintf(stderr, "usage: orbit_stamp <exe> <res>\n");
    return 2;
  }
  std::ifstream in(argv[2], std::ios::binary);
  const std::vector<BYTE> file((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
  std::vector<Resource> resources;
  if (file.empty() || !ParseRes(file, resources) || resources.empty()) {
    fprintf(stderr, "orbit_stamp: could not read %ls\n", argv[2]);
    return 1;
  }

  const std::vector<Existing> replaced = FindReplaced(argv[1]);
  HANDLE update = BeginUpdateResourceW(argv[1], FALSE);
  if (!update) {
    fprintf(stderr, "orbit_stamp: BeginUpdateResource failed: %lu\n", GetLastError());
    return 1;
  }
  for (const Existing& old : replaced) {
    UpdateResourceW(update, old.type, MAKEINTRESOURCEW(old.number), old.language, nullptr, 0);
  }
  for (const Resource& resource : resources) {
    if (!UpdateResourceW(update, resource.type.Get(), resource.name.Get(), resource.language,
                         const_cast<BYTE*>(resource.data.data()), static_cast<DWORD>(resource.data.size()))) {
      fprintf(stderr, "orbit_stamp: UpdateResource failed: %lu\n", GetLastError());
      EndUpdateResourceW(update, TRUE);
      return 1;
    }
  }
  if (!EndUpdateResourceW(update, FALSE)) {
    fprintf(stderr, "orbit_stamp: EndUpdateResource failed: %lu\n", GetLastError());
    return 1;
  }
  printf("stamped %zu resources into %ls\n", resources.size(), argv[1]);
  return 0;
}
