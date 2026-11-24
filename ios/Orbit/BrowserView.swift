import SwiftUI
import WebKit

enum LibrarySheet: String, Identifiable {
    case bookmarks, history, settings
    var id: String { rawValue }
}

struct BrowserView: View {
    @Environment(Browser.self) private var browser
    @Environment(\.colorScheme) private var colorScheme
    @State private var showingTabs = false
    @State private var sheet: LibrarySheet?

    var body: some View {
        VStack(spacing: 0) {
            if let tab = browser.selected {
                ZStack {
                    WebContainer(tab: tab)
                        .opacity(tab.showsNewTab ? 0 : 1)
                    if tab.showsNewTab {
                        NewTabView(tab: tab)
                    }
                }
                .overlay(alignment: .bottom) {
                    if tab.isLoading {
                        ProgressView(value: tab.progress)
                            .progressViewStyle(.linear)
                            .frame(height: 2)
                    }
                }
                Group {
                    AddressBar(tab: tab)
                    BrowserToolbar(tab: tab, showingTabs: $showingTabs, sheet: $sheet)
                }
                .environment(\.colorScheme, tab.showsNewTab ? .dark : colorScheme)
            }
        }
        .background {
            if browser.selected?.showsNewTab == true {
                NewTabBackdrop()
            } else {
                Theme.surface.ignoresSafeArea()
            }
        }
        .sheet(isPresented: $showingTabs) {
            TabsView()
        }
        .sheet(item: $sheet) { sheet in
            switch sheet {
            case .bookmarks: BookmarksView()
            case .history: HistoryView()
            case .settings: SettingsView()
            }
        }
    }
}

/// Shows the selected tab's web view. The web views live in the tabs, so switching tabs keeps
/// each page as it was.
struct WebContainer: UIViewRepresentable {
    let tab: Tab

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        container.backgroundColor = .clear
        return container
    }

    func updateUIView(_ container: UIView, context: Context) {
        guard tab.webView.superview !== container else { return }
        container.subviews.forEach { $0.removeFromSuperview() }
        tab.webView.frame = container.bounds
        tab.webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        container.addSubview(tab.webView)
    }
}

struct AddressBar: View {
    @Environment(Browser.self) private var browser
    let tab: Tab
    @State private var text = ""
    @State private var showingShields = false
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 10) {
            statusIcon
            TextField("Search or enter address", text: $text)
                .focused($focused)
                .keyboardType(.webSearch)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .foregroundStyle(Theme.text)
                .onSubmit {
                    browser.open(text, in: tab)
                    focused = false
                }
                .accessibilityIdentifier("address")
            if focused, !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill") }
                    .foregroundStyle(Theme.secondaryText)
                    .accessibilityLabel("Clear")
            } else if tab.isLoading {
                Button { tab.webView.stopLoading() } label: { Image(systemName: "xmark") }
                    .accessibilityLabel("Stop")
            } else if !tab.showsNewTab {
                Button { tab.webView.reload() } label: { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel("Reload")
            }
        }
        .padding(.horizontal, 14)
        .frame(height: 44)
        .background {
            if tab.showsNewTab {
                Capsule().fill(.ultraThinMaterial)
            } else {
                Capsule().fill(Theme.addressBar)
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .onAppear { text = displayText }
        .onChange(of: browser.addressFocusRequests) { focused = true }
        .onChange(of: tab.url) { if !focused { text = displayText } }
        .onChange(of: tab.id) { text = displayText }
        .onChange(of: focused) { text = focused ? (tab.url?.absoluteString ?? "") : displayText }
    }

    /// The Shields button at the start of the address bar (Orbit's private mark in private tabs);
    /// it opens the Shields sheet for the site.
    private var statusIcon: some View {
        Button { showingShields = true } label: {
            if tab.isPrivate {
                OrbitPrivateMark(color: Theme.primary)
                    .frame(width: 18, height: 18)
            } else if browser.shieldsEnabled(for: tab.url?.host()) {
                Image(systemName: "shield.lefthalf.filled")
                    .foregroundStyle(Theme.primary)
            } else {
                Image(systemName: "shield.slash")
                    .foregroundStyle(Theme.secondaryText)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(shieldsLabel)
        .accessibilityIdentifier("shields")
        .sheet(isPresented: $showingShields) {
            ShieldsSheet(host: tab.url?.host())
        }
    }

    private var shieldsLabel: String {
        if tab.isPrivate { return String(localized: "Private tab, Shields") }
        return browser.shieldsEnabled(for: tab.url?.host())
            ? String(localized: "Shields on") : String(localized: "Shields off")
    }

    private var displayText: String {
        tab.url?.host(percentEncoded: false) ?? ""
    }
}

struct BrowserToolbar: View {
    @Environment(Browser.self) private var browser
    let tab: Tab
    @Binding var showingTabs: Bool
    @Binding var sheet: LibrarySheet?
    @State private var confirmingRemove = false

    var body: some View {
        HStack {
            Button { tab.webView.goBack() } label: { Image(systemName: "chevron.backward") }
                .disabled(!tab.canGoBack)
                .accessibilityLabel("Back")
            Spacer()
            Button { tab.webView.goForward() } label: { Image(systemName: "chevron.forward") }
                .disabled(!tab.canGoForward)
                .accessibilityLabel("Forward")
            Spacer()
            bookmarkButton
            Spacer()
            Button { browser.newTab(isPrivate: tab.isPrivate) } label: { Image(systemName: "plus") }
                .accessibilityLabel("New tab")
            Spacer()
            Button { showingTabs = true } label: {
                Text("\(browser.tabs.count)")
                    .font(.footnote.weight(.semibold))
                    .frame(minWidth: 22, minHeight: 22)
                    .overlay(RoundedRectangle(cornerRadius: 5).stroke(lineWidth: 1.5))
            }
            .accessibilityLabel("Tabs")
            Spacer()
            menu
        }
        .font(.title3)
        .tint(tab.showsNewTab ? .white : Theme.primary)
        .padding(.horizontal, 24)
        .padding(.vertical, 10)
    }

    /// Bookmarks the page; filled when it is bookmarked, and then a tap offers to remove it.
    private var bookmarkButton: some View {
        let saved = browser.library.isBookmarked(tab.url)
        return Button {
            guard let url = tab.url else { return }
            if saved {
                confirmingRemove = true
            } else {
                browser.library.toggleBookmark(title: tab.title, url: url)
            }
        } label: {
            Image(systemName: saved ? "star.fill" : "star")
        }
        .disabled(tab.url == nil)
        .accessibilityLabel(saved ? Text("Edit bookmark") : Text("Bookmark this page"))
        .confirmationDialog("Remove this bookmark?", isPresented: $confirmingRemove, titleVisibility: .visible) {
            Button("Remove bookmark", role: .destructive) {
                if let url = tab.url { browser.library.toggleBookmark(title: tab.title, url: url) }
            }
        }
    }

    private var menu: some View {
        Menu {
            if let url = tab.url {
                Button {
                    browser.library.toggleBookmark(title: tab.title, url: url)
                } label: {
                    browser.library.isBookmarked(url)
                        ? Label("Remove bookmark", systemImage: "star.slash")
                        : Label("Add bookmark", systemImage: "star")
                }
                if let host = url.host(), browser.library.settings.shieldsOn {
                    let on = browser.shieldsEnabled(for: host)
                    Button {
                        browser.setShields(!on, for: host)
                    } label: {
                        on
                            ? Label("Turn Shields off for this site", systemImage: "shield.slash")
                            : Label("Turn Shields on for this site", systemImage: "shield.lefthalf.filled")
                    }
                }
                ShareLink(item: url)
                Divider()
            }
            Button { sheet = .bookmarks } label: { Label("Bookmarks", systemImage: "book") }
            Button { sheet = .history } label: { Label("History", systemImage: "clock") }
            Button { browser.newTab(isPrivate: true) } label: { Label("New private tab", systemImage: "moon") }
            Button { sheet = .settings } label: { Label("Settings", systemImage: "gearshape") }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .accessibilityLabel("Menu")
    }
}

/// Shields for the site in the tab, opened from the address bar, like Orbit's Shields panel on
/// its other systems. Safari's content blocking does not report what it blocked, so there are no
/// counts here.
struct ShieldsSheet: View {
    @Environment(Browser.self) private var browser
    @Environment(\.dismiss) private var dismiss
    let host: String?

    var body: some View {
        NavigationStack {
            Form {
                if let host {
                    Section {
                        Toggle(isOn: Binding(
                            get: { browser.shieldsEnabled(for: host) },
                            set: { browser.setShields($0, for: host) }
                        )) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Shields for this site")
                                Text(Library.site(host))
                                    .font(.footnote)
                                    .foregroundStyle(Theme.secondaryText)
                            }
                        }
                        .disabled(!browser.library.settings.shieldsOn)
                        .accessibilityIdentifier("shields-site")
                    } footer: {
                        browser.library.settings.shieldsOn
                            ? Text("Blocks ads, trackers and known malicious sites here. Changing it reloads the page.")
                            : Text("Shields are off on every site.")
                    }
                } else {
                    Section {
                        Text("Open a site to turn Shields off or on for it.")
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
                Section {
                    Toggle("Shields on every site", isOn: Binding(
                        get: { browser.library.settings.shieldsOn },
                        set: { browser.setShieldsOn($0) }
                    ))
                }
            }
            .navigationTitle("Shields")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
        }
        .presentationDetents([.medium])
    }
}
