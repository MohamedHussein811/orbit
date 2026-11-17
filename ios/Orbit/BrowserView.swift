import SwiftUI
import WebKit

enum LibrarySheet: String, Identifiable {
    case bookmarks, history, settings
    var id: String { rawValue }
}

struct BrowserView: View {
    @Environment(Browser.self) private var browser
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
                AddressBar(tab: tab)
                BrowserToolbar(tab: tab, showingTabs: $showingTabs, sheet: $sheet)
            }
        }
        .background(Theme.surface.ignoresSafeArea())
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
        .background(Theme.addressBar, in: Capsule())
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .onAppear { text = displayText }
        .onChange(of: tab.url) { if !focused { text = displayText } }
        .onChange(of: tab.id) { text = displayText }
        .onChange(of: focused) { text = focused ? (tab.url?.absoluteString ?? "") : displayText }
    }

    @ViewBuilder private var statusIcon: some View {
        if tab.isPrivate {
            Image(systemName: "eyeglasses")
                .foregroundStyle(Theme.primary)
                .accessibilityLabel("Private tab")
        } else if browser.shieldsEnabled(for: tab.url?.host()) {
            Image(systemName: "shield.lefthalf.filled")
                .foregroundStyle(Theme.primary)
                .accessibilityLabel("Shields on")
        } else {
            Image(systemName: "shield.slash")
                .foregroundStyle(Theme.secondaryText)
                .accessibilityLabel("Shields off")
        }
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
        .padding(.horizontal, 24)
        .padding(.vertical, 10)
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
            Button { browser.newTab(isPrivate: true) } label: { Label("New private tab", systemImage: "eyeglasses") }
            Button { sheet = .settings } label: { Label("Settings", systemImage: "gearshape") }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .accessibilityLabel("Menu")
    }
}
