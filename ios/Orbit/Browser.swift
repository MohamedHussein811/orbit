import Foundation
import Observation
import WebKit

@MainActor
@Observable
final class Browser {
    private(set) var tabs: [Tab] = []
    var selectedID: UUID?
    private(set) var shieldsReady = false
    private(set) var shieldsError: String?
    /// Raised by the new tab page's search pill; the address bar takes focus when it changes.
    var addressFocusRequests = 0
    let library: Library

    @ObservationIgnored private var ruleLists: [WKContentRuleList] = []
    @ObservationIgnored private var privateStore: WKWebsiteDataStore?

    init(library: Library? = nil, loadsShields: Bool = true) {
        self.library = library ?? Library()
        // Settings > On startup: a new tab page, the tabs open last time, or the chosen pages.
        let pages = self.library.startupURLs()
        if pages.isEmpty {
            newTab(isPrivate: false)
        } else {
            for url in pages { newTab(isPrivate: false, url: url) }
            selectedID = tabs.first?.id
        }
        if loadsShields {
            let shields = Shields()
            Task { await loadShields(shields) }
        }
    }

    var selected: Tab? {
        tabs.first { $0.id == selectedID } ?? tabs.last
    }

    // MARK: Tabs

    @discardableResult
    func newTab(isPrivate: Bool, url: URL? = nil) -> Tab {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = isPrivate ? privateDataStore() : .default()
        configuration.allowsInlineMediaPlayback = true
        let tab = Tab(configuration: configuration, isPrivate: isPrivate, browser: self)
        applyShields(to: tab, host: url?.host())
        tabs.append(tab)
        selectedID = tab.id
        if let url { tab.load(url) }
        saveSession()
        return tab
    }

    /// Keeps the open regular tabs for "Continue where you left off".
    func saveSession() {
        library.saveSession(tabs.filter { !$0.isPrivate }.compactMap(\.url))
    }

    func select(_ tab: Tab) {
        selectedID = tab.id
    }

    func close(_ tab: Tab) {
        tab.webView.stopLoading()
        tabs.removeAll { $0 === tab }
        // Closing the last private tab ends the private session and forgets its data.
        if !tabs.contains(where: \.isPrivate) { privateStore = nil }
        if tabs.isEmpty { newTab(isPrivate: false) }
        if selectedID == tab.id { selectedID = tabs.last?.id }
        saveSession()
    }

    func closeAll(private isPrivate: Bool) {
        for tab in tabs where tab.isPrivate == isPrivate { close(tab) }
    }

    func open(_ text: String, in tab: Tab) {
        guard let url = AddressInput.url(for: text, engine: library.settings.engine) else { return }
        tab.load(url)
    }

    private func privateDataStore() -> WKWebsiteDataStore {
        if let privateStore { return privateStore }
        let store = WKWebsiteDataStore.nonPersistent()
        privateStore = store
        return store
    }

    // MARK: Shields

    func shieldsEnabled(for host: String?) -> Bool {
        guard library.settings.shieldsOn else { return false }
        guard let host else { return true }
        return !library.shieldsOff(for: host)
    }

    func applyShields(to tab: Tab, host: String?) {
        let controller = tab.webView.configuration.userContentController
        controller.removeAllContentRuleLists()
        if shieldsEnabled(for: host) {
            for list in ruleLists { controller.add(list) }
        }
    }

    /// Turns Shields on or off for one site and reloads that site's open tabs.
    func setShields(_ on: Bool, for host: String) {
        library.setShields(on, for: host)
        refreshShields(reloading: { Library.site($0) == Library.site(host) })
    }

    func setShieldsOn(_ on: Bool) {
        library.setShieldsOn(on)
        refreshShields(reloading: { _ in true })
    }

    private func refreshShields(reloading shouldReload: (String) -> Bool) {
        for tab in tabs {
            let host = tab.url?.host()
            applyShields(to: tab, host: host)
            if let host, shouldReload(host) { tab.webView.reload() }
        }
    }

    private func loadShields(_ shields: Shields) async {
        do {
            ruleLists = try await shields.load()
            for tab in tabs { applyShields(to: tab, host: tab.url?.host()) }
            shieldsReady = true
        } catch {
            shieldsError = String(describing: error)
        }
    }
}
