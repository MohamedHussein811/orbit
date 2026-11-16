// Copyright 2026 NovaTech. Use of this source code is governed by the
// Mozilla Public License 2.0, found in the LICENSE file.

#include "chrome/utility/importer/chromium_importer.h"

#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/files/file_util.h"
#include "base/files/scoped_temp_dir.h"
#include "base/json/json_reader.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "base/time/time.h"
#include "base/values.h"
#include "chrome/common/importer/importer_bridge.h"
#include "components/user_data_importer/common/imported_bookmark_entry.h"
#include "components/user_data_importer/common/importer_data_types.h"
#include "components/user_data_importer/common/importer_url_row.h"
#include "sql/database.h"
#include "sql/statement.h"
#include "url/gurl.h"

namespace {

inline constexpr sql::Database::Tag kDatabaseTag{"OrbitChromiumImporter"};

constexpr size_t kMaxBookmarksFileBytes = 64 * 1024 * 1024;
constexpr int kMaxHistoryRows = 100000;
constexpr int kMaxFolderDepth = 64;

bool CanImportURL(const GURL& url) {
  return url.is_valid() && (url.SchemeIsHTTPOrHTTPS() || url.SchemeIsFile());
}

// Chromium stores times as microseconds since 1601.
base::Time ChromiumTime(int64_t microseconds) {
  return microseconds > 0 ? base::Time::FromDeltaSinceWindowsEpoch(
                                base::Microseconds(microseconds))
                          : base::Time();
}

base::Time ChromiumTime(const std::string* text) {
  int64_t microseconds = 0;
  return text && base::StringToInt64(*text, &microseconds)
             ? ChromiumTime(microseconds)
             : base::Time();
}

void AddBookmarkNodes(
    const base::ListValue* children,
    bool in_toolbar,
    int depth,
    std::vector<std::u16string>& path,
    std::vector<user_data_importer::ImportedBookmarkEntry>& entries) {
  if (!children || depth > kMaxFolderDepth) {
    return;
  }
  for (const base::Value& child : *children) {
    const base::DictValue* node = child.GetIfDict();
    if (!node) {
      continue;
    }
    const std::string* type = node->FindString("type");
    const std::string* name = node->FindString("name");
    const std::u16string title =
        name ? base::UTF8ToUTF16(*name) : std::u16string();
    if (type && *type == "url") {
      const std::string* url_text = node->FindString("url");
      const GURL url(url_text ? *url_text : std::string());
      if (!CanImportURL(url)) {
        continue;
      }
      user_data_importer::ImportedBookmarkEntry entry;
      entry.in_toolbar = in_toolbar;
      entry.is_folder = false;
      entry.url = url;
      entry.path = path;
      entry.title = title;
      entry.creation_time = ChromiumTime(node->FindString("date_added"));
      entries.push_back(std::move(entry));
    } else if (type && *type == "folder") {
      const base::ListValue* folder_children = node->FindList("children");
      if (!folder_children || folder_children->empty()) {
        // Empty folders are kept, as the source browser shows them.
        user_data_importer::ImportedBookmarkEntry entry;
        entry.in_toolbar = in_toolbar;
        entry.is_folder = true;
        entry.path = path;
        entry.title = title;
        entry.creation_time = ChromiumTime(node->FindString("date_added"));
        entries.push_back(std::move(entry));
        continue;
      }
      path.push_back(title);
      AddBookmarkNodes(folder_children, in_toolbar, depth + 1, path, entries);
      path.pop_back();
    }
  }
}

}  // namespace

ChromiumImporter::ChromiumImporter() = default;

ChromiumImporter::~ChromiumImporter() = default;

void ChromiumImporter::StartImport(
    const user_data_importer::SourceProfile& source_profile,
    uint16_t items,
    ImporterBridge* bridge) {
  bridge_ = bridge;
  source_path_ = source_profile.source_path;

  bridge_->NotifyStarted();
  // History first, so favicons of bookmarked pages find their history rows.
  if ((items & user_data_importer::HISTORY) && !cancelled()) {
    bridge_->NotifyItemStarted(user_data_importer::HISTORY);
    ImportHistory();
    bridge_->NotifyItemEnded(user_data_importer::HISTORY);
  }
  if ((items & user_data_importer::FAVORITES) && !cancelled()) {
    bridge_->NotifyItemStarted(user_data_importer::FAVORITES);
    ImportBookmarks(source_profile.importer_name);
    bridge_->NotifyItemEnded(user_data_importer::FAVORITES);
  }
  bridge_->NotifyEnded();
}

void ChromiumImporter::ImportBookmarks(const std::u16string& browser_name) {
  std::string text;
  if (!base::ReadFileToStringWithMaxSize(source_path_.AppendASCII("Bookmarks"),
                                         &text, kMaxBookmarksFileBytes)) {
    return;
  }
  std::optional<base::DictValue> file = base::JSONReader::ReadDict(text);
  const base::DictValue* roots = file ? file->FindDict("roots") : nullptr;
  if (!roots) {
    return;
  }

  std::vector<user_data_importer::ImportedBookmarkEntry> entries;
  std::vector<std::u16string> path;
  static constexpr struct {
    const char* key;
    bool in_toolbar;
  } kRoots[] = {{"bookmark_bar", true}, {"other", false}, {"synced", false}};
  for (const auto& root : kRoots) {
    if (const base::DictValue* node = roots->FindDict(root.key)) {
      AddBookmarkNodes(node->FindList("children"), root.in_toolbar, 0, path,
                       entries);
    }
  }
  if (!entries.empty() && !cancelled()) {
    bridge_->AddBookmarks(entries, browser_name);
  }
}

void ChromiumImporter::ImportHistory() {
  const base::FilePath source = source_path_.AppendASCII("History");
  base::ScopedTempDir copy;
  if (!base::PathExists(source) || !copy.CreateUniqueTempDir()) {
    return;
  }
  // The source browser keeps its history locked while it runs, so this copy
  // only works once that browser is closed.
  const base::FilePath file = copy.GetPath().AppendASCII("History");
  if (!base::CopyFile(source, file)) {
    return;
  }

  std::vector<user_data_importer::ImporterURLRow> rows;
  {
    sql::Database db(kDatabaseTag);
    if (!db.Open(file)) {
      return;
    }
    sql::Statement statement(db.GetUniqueStatement(
        "SELECT url, title, visit_count, typed_count, last_visit_time "
        "FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ?"));
    if (!statement.is_valid()) {
      return;
    }
    statement.BindInt(0, kMaxHistoryRows);
    while (statement.Step() && !cancelled()) {
      const GURL url(statement.ColumnStringView(0));
      if (!CanImportURL(url)) {
        continue;
      }
      user_data_importer::ImporterURLRow row(url);
      row.title = statement.ColumnString16(1);
      row.visit_count = statement.ColumnInt(2);
      row.typed_count = statement.ColumnInt(3);
      row.last_visit = ChromiumTime(statement.ColumnInt64(4));
      row.hidden = false;
      rows.push_back(std::move(row));
    }
  }
  // History has no separate source for these browsers; imported visits are
  // marked the same way as visits imported from Firefox.
  if (!rows.empty() && !cancelled()) {
    bridge_->SetHistoryItems(
        rows, user_data_importer::VISIT_SOURCE_FIREFOX_IMPORTED);
  }
}
