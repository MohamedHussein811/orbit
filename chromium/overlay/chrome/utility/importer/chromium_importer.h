// Copyright 2026 NovaTech. Use of this source code is governed by the
// Mozilla Public License 2.0, found in the LICENSE file.

#ifndef CHROME_UTILITY_IMPORTER_CHROMIUM_IMPORTER_H_
#define CHROME_UTILITY_IMPORTER_CHROMIUM_IMPORTER_H_

#include <stdint.h>

#include <string>

#include "base/files/file_path.h"
#include "chrome/utility/importer/importer.h"

// Imports bookmarks and history from browsers built on Chromium (Chrome,
// Edge, Brave, Opera, Vivaldi and others). Both are plain files in the source
// profile folder: Bookmarks is JSON and History is SQLite. Passwords and
// cookies are encrypted with keys only the source browser can use, so they
// are not read.
class ChromiumImporter : public Importer {
 public:
  ChromiumImporter();

  ChromiumImporter(const ChromiumImporter&) = delete;
  ChromiumImporter& operator=(const ChromiumImporter&) = delete;

  // Importer:
  void StartImport(const user_data_importer::SourceProfile& source_profile,
                   uint16_t items,
                   ImporterBridge* bridge) override;

 private:
  ~ChromiumImporter() override;

  void ImportBookmarks(const std::u16string& browser_name);
  void ImportHistory();

  base::FilePath source_path_;
};

#endif  // CHROME_UTILITY_IMPORTER_CHROMIUM_IMPORTER_H_
