import SwiftUI

struct TabsView: View {
    @Environment(Browser.self) private var browser
    @Environment(\.dismiss) private var dismiss
    @State private var showingPrivate = false

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 14)]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 14) {
                    ForEach(browser.tabs.filter { $0.isPrivate == showingPrivate }) { tab in
                        TabCard(tab: tab, selected: tab.id == browser.selected?.id) {
                            browser.select(tab)
                            dismiss()
                        } close: {
                            browser.close(tab)
                        }
                    }
                }
                .padding(16)
            }
            .background(Theme.surface)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Picker("Tabs", selection: $showingPrivate) {
                        Text("Tabs").tag(false)
                        Text("Private").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 200)
                }
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        browser.newTab(isPrivate: showingPrivate)
                        dismiss()
                    } label: { Image(systemName: "plus") }
                    .accessibilityLabel("New tab")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
                if showingPrivate, browser.tabs.contains(where: \.isPrivate) {
                    ToolbarItem(placement: .bottomBar) {
                        Button("Close all private tabs", role: .destructive) {
                            browser.closeAll(private: true)
                        }
                    }
                }
            }
            .onAppear { showingPrivate = browser.selected?.isPrivate ?? false }
        }
    }
}

private struct TabCard: View {
    let tab: Tab
    let selected: Bool
    let open: () -> Void
    let close: () -> Void

    var body: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Image(systemName: tab.isPrivate ? "eyeglasses" : "globe")
                        .foregroundStyle(Theme.primary)
                    Spacer()
                    Button(action: close) { Image(systemName: "xmark") }
                        .foregroundStyle(Theme.secondaryText)
                        .accessibilityLabel("Close tab")
                }
                Text(tab.displayTitle)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                Text(tab.url?.host() ?? "")
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
            }
            .padding(12)
            .frame(height: 120)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(selected ? Theme.primary : .clear, lineWidth: 2))
        }
        .buttonStyle(.plain)
    }
}

struct BookmarksView: View {
    @Environment(Browser.self) private var browser
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(browser.library.bookmarks) { bookmark in
                    Button {
                        open(bookmark.url)
                    } label: {
                        PageRow(title: bookmark.title, url: bookmark.url)
                    }
                }
                .onDelete { browser.library.removeBookmarks(at: $0) }
            }
            .overlay {
                if browser.library.bookmarks.isEmpty {
                    ContentUnavailableView("No bookmarks", systemImage: "book", description: Text("Add one from the menu on any page."))
                }
            }
            .navigationTitle("Bookmarks")
            .toolbar { Button("Done") { dismiss() } }
        }
    }

    private func open(_ url: URL) {
        if let tab = browser.selected { tab.load(url) }
        dismiss()
    }
}

struct HistoryView: View {
    @Environment(Browser.self) private var browser
    @Environment(\.dismiss) private var dismiss
    @State private var confirmingClear = false

    var body: some View {
        NavigationStack {
            List(browser.library.history) { visit in
                Button {
                    if let tab = browser.selected { tab.load(visit.url) }
                    dismiss()
                } label: {
                    PageRow(title: visit.title, url: visit.url, date: visit.date)
                }
            }
            .overlay {
                if browser.library.history.isEmpty {
                    ContentUnavailableView("No history", systemImage: "clock", description: Text("Private tabs are never saved here."))
                }
            }
            .navigationTitle("History")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .topBarLeading) {
                    Button("Clear", role: .destructive) { confirmingClear = true }
                        .disabled(browser.library.history.isEmpty)
                }
            }
            .confirmationDialog("Clear all history?", isPresented: $confirmingClear, titleVisibility: .visible) {
                Button("Clear history", role: .destructive) { browser.library.clearHistory() }
            }
        }
    }
}

private struct PageRow: View {
    let title: String
    let url: URL
    var date: Date?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.isEmpty ? (url.host() ?? url.absoluteString) : title)
                .foregroundStyle(Theme.text)
                .lineLimit(1)
            HStack {
                Text(url.host() ?? url.absoluteString)
                if let date {
                    Spacer()
                    Text(date, style: .relative)
                }
            }
            .font(.caption)
            .foregroundStyle(Theme.secondaryText)
            .lineLimit(1)
        }
    }
}

struct SettingsView: View {
    @Environment(Browser.self) private var browser
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Search") {
                    Picker("Search engine", selection: Binding(
                        get: { browser.library.settings.engine },
                        set: { browser.library.setEngine($0) }
                    )) {
                        ForEach(SearchEngine.allCases) { Text($0.name).tag($0) }
                    }
                }
                Section {
                    Toggle("Shields", isOn: Binding(
                        get: { browser.library.settings.shieldsOn },
                        set: { browser.setShieldsOn($0) }
                    ))
                    if let error = browser.shieldsError {
                        Text("The blocking lists could not load: \(error)")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    } else if !browser.shieldsReady {
                        Text("Preparing the blocking lists...")
                            .font(.footnote)
                            .foregroundStyle(Theme.secondaryText)
                    }
                    if !browser.library.settings.shieldsOffSites.isEmpty {
                        ForEach(browser.library.settings.shieldsOffSites, id: \.self) { site in
                            HStack {
                                Text(site)
                                Spacer()
                                Button("Turn on") { browser.setShields(true, for: site) }
                            }
                        }
                    }
                } header: {
                    Text("Shields")
                } footer: {
                    Text("Blocks ads, trackers and known malicious sites with the same lists as Orbit on the desktop. Sites listed here have Shields off.")
                }
                Section("Privacy") {
                    Text("Orbit has no accounts, no sync and no telemetry. Everything stays on this device.")
                        .foregroundStyle(Theme.secondaryText)
                }
                Section {
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
                    LabeledContent("Made by", value: "NovaTech")
                }
            }
            .navigationTitle("Settings")
            .toolbar { Button("Done") { dismiss() } }
        }
    }
}
