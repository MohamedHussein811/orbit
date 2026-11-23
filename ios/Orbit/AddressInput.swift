import Foundation

enum SearchEngine: String, CaseIterable, Codable, Identifiable {
    case google, duckduckgo, bing, ecosia, brave, startpage

    var id: String { rawValue }

    var name: String {
        switch self {
        case .duckduckgo: "DuckDuckGo"
        case .google: "Google"
        case .bing: "Bing"
        case .ecosia: "Ecosia"
        case .brave: "Brave Search"
        case .startpage: "Startpage"
        }
    }

    /// Same addresses as SEARCH_ENGINES in extension/src/shared/settings.ts.
    private var base: String {
        switch self {
        case .duckduckgo: "https://duckduckgo.com/?q="
        case .google: "https://www.google.com/search?q="
        case .bing: "https://www.bing.com/search?q="
        case .ecosia: "https://www.ecosia.org/search?q="
        case .brave: "https://search.brave.com/search?q="
        case .startpage: "https://www.startpage.com/do/search?query="
        }
    }

    func searchURL(for query: String) -> URL? {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&+=?#")
        guard let encoded = query.addingPercentEncoding(withAllowedCharacters: allowed) else { return nil }
        return URL(string: base + encoded)
    }
}

enum AddressInput {
    /// The page for what the person typed: the address when it looks like one, otherwise a search.
    static func url(for text: String, engine: SearchEngine) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let url = URL(string: trimmed), let scheme = url.scheme?.lowercased(),
           scheme == "http" || scheme == "https", url.host != nil {
            return url
        }
        if !trimmed.contains(" "), looksLikeHost(trimmed),
           let url = URL(string: "https://" + trimmed), url.host != nil {
            return url
        }
        return engine.searchURL(for: trimmed)
    }

    static func looksLikeHost(_ text: String) -> Bool {
        let beforePath = text.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: false).first ?? ""
        let host = beforePath.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false).first ?? ""
        if host.lowercased() == "localhost" { return true }
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        if labels.count == 4, labels.allSatisfy({ UInt8($0) != nil }) { return true }
        guard labels.count >= 2, let last = labels.last, last.count >= 2, last.allSatisfy(\.isLetter) else {
            return false
        }
        return labels.allSatisfy { label in
            !label.isEmpty && label.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" }
        }
    }
}
