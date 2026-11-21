import Foundation
import Observation

struct Bookmark: Codable, Identifiable, Hashable {
    var id = UUID()
    var title: String
    var url: URL
}

struct Visit: Codable, Identifiable, Hashable {
    var id = UUID()
    var title: String
    var url: URL
    var date: Date
}

/// What opens when Orbit starts, as in Orbit's Settings on its other systems.
enum StartupMode: String, Codable, CaseIterable, Identifiable {
    case newTab, restore, pages
    var id: String { rawValue }
}

struct Settings: Codable, Equatable {
    var engine: SearchEngine = .duckduckgo
    var shieldsOn = true
    var shieldsOffSites: [String] = []
    // New tab page widgets, off by default as on Orbit's other phones.
    var showClock = false
    var showDate = false
    var showSearch = false
    /// 1: one row of shortcuts that scrolls sideways; 2: every shortcut in a grid.
    var shortcutRows = 1
    var startup: StartupMode = .newTab
    var startupPages: [URL] = []

    init() {}

    // Settings saved by an earlier version lack the newer keys; those take their defaults.
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let defaults = Settings()
        engine = (try? values.decodeIfPresent(SearchEngine.self, forKey: .engine)) ?? defaults.engine
        shieldsOn = (try? values.decodeIfPresent(Bool.self, forKey: .shieldsOn)) ?? defaults.shieldsOn
        shieldsOffSites = (try? values.decodeIfPresent([String].self, forKey: .shieldsOffSites)) ?? defaults.shieldsOffSites
        showClock = (try? values.decodeIfPresent(Bool.self, forKey: .showClock)) ?? defaults.showClock
        showDate = (try? values.decodeIfPresent(Bool.self, forKey: .showDate)) ?? defaults.showDate
        showSearch = (try? values.decodeIfPresent(Bool.self, forKey: .showSearch)) ?? defaults.showSearch
        shortcutRows = (try? values.decodeIfPresent(Int.self, forKey: .shortcutRows)) ?? defaults.shortcutRows
        startup = (try? values.decodeIfPresent(StartupMode.self, forKey: .startup)) ?? defaults.startup
        startupPages = (try? values.decodeIfPresent([URL].self, forKey: .startupPages)) ?? defaults.startupPages
    }
}

/// Bookmarks, history and settings, kept only on this device as JSON files.
@MainActor
@Observable
final class Library {
    static let historyLimit = 5000

    private(set) var bookmarks: [Bookmark]
    private(set) var history: [Visit]
    private(set) var settings: Settings

    @ObservationIgnored private let folder: URL

    init(folder: URL? = nil) {
        let folder = folder ?? Library.defaultFolder
        self.folder = folder
        bookmarks = Library.read([Bookmark].self, "bookmarks.json", in: folder) ?? []
        history = Library.read([Visit].self, "history.json", in: folder) ?? []
        settings = Library.read(Settings.self, "settings.json", in: folder) ?? Settings()
        session = Library.read([URL].self, "session.json", in: folder) ?? []
    }

    nonisolated static var defaultFolder: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("Orbit", isDirectory: true)
    }

    // MARK: Bookmarks

    func isBookmarked(_ url: URL?) -> Bool {
        guard let url else { return false }
        return bookmarks.contains { $0.url == url }
    }

    func toggleBookmark(title: String, url: URL) {
        if isBookmarked(url) {
            bookmarks.removeAll { $0.url == url }
        } else {
            bookmarks.append(Bookmark(title: title.isEmpty ? (url.host() ?? url.absoluteString) : title, url: url))
        }
        write(bookmarks, "bookmarks.json")
    }

    func removeBookmarks(at offsets: IndexSet) {
        for index in offsets.sorted(by: >) where bookmarks.indices.contains(index) {
            bookmarks.remove(at: index)
        }
        write(bookmarks, "bookmarks.json")
    }

    // MARK: History

    func recordVisit(title: String, url: URL, date: Date = Date()) {
        if let first = history.first, first.url == url {
            history[0].title = title
            history[0].date = date
        } else {
            history.insert(Visit(title: title, url: url, date: date), at: 0)
            if history.count > Library.historyLimit { history.removeLast(history.count - Library.historyLimit) }
        }
        write(history, "history.json")
    }

    func clearHistory() {
        history = []
        write(history, "history.json")
    }

    // MARK: Settings

    func setEngine(_ engine: SearchEngine) {
        settings.engine = engine
        write(settings, "settings.json")
    }

    func setShieldsOn(_ on: Bool) {
        settings.shieldsOn = on
        write(settings, "settings.json")
    }

    /// Changes the settings with `change` and saves them.
    func update(_ change: (inout Settings) -> Void) {
        change(&settings)
        write(settings, "settings.json")
    }

    /// The new tab page's widgets and shortcut rows back to their defaults.
    func restoreLayout() {
        let defaults = Settings()
        update {
            $0.showClock = defaults.showClock
            $0.showDate = defaults.showDate
            $0.showSearch = defaults.showSearch
            $0.shortcutRows = defaults.shortcutRows
        }
    }

    // MARK: Session

    /// The open regular tabs, kept for "Continue where you left off". Private tabs are never saved.
    private(set) var session: [URL] = []

    func saveSession(_ urls: [URL]) {
        guard urls != session else { return }
        session = urls
        write(urls, "session.json")
    }

    /// The pages to open at start for the startup choice: none means one new tab page.
    func startupURLs() -> [URL] {
        switch settings.startup {
        case .newTab: return []
        case .restore: return session
        case .pages: return settings.startupPages
        }
    }

    func shieldsOff(for host: String) -> Bool {
        settings.shieldsOffSites.contains(Library.site(host))
    }

    func setShields(_ on: Bool, for host: String) {
        let site = Library.site(host)
        settings.shieldsOffSites.removeAll { $0 == site }
        if !on { settings.shieldsOffSites.append(site) }
        write(settings, "settings.json")
    }

    /// The host without a leading www., so one choice covers both forms of a site.
    static func site(_ host: String) -> String {
        let lower = host.lowercased()
        return lower.hasPrefix("www.") ? String(lower.dropFirst(4)) : lower
    }

    // MARK: Files

    private static func read<Value: Decodable>(_ type: Value.Type, _ name: String, in folder: URL) -> Value? {
        guard let data = try? Data(contentsOf: folder.appendingPathComponent(name)) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    private func write<Value: Encodable>(_ value: Value, _ name: String) {
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(value)
            try data.write(to: folder.appendingPathComponent(name), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            assertionFailure("could not save \(name): \(error)")
        }
    }
}
