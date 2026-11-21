import SwiftUI
import UIKit

/// The new tab page, as on Orbit's other systems: the space picture under dark glass, the clock
/// and date, a search pill, shortcuts and Shields. Clock, date and search are off until turned on
/// in Customize (the button fixed at the bottom); what is shown sits in the middle of the page.
struct NewTabView: View {
    @Environment(Browser.self) private var browser
    let tab: Tab
    @State private var customizing = false

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 4)
    private var settings: Settings { browser.library.settings }

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                content
                    .frame(maxWidth: 560)
                    .padding(.horizontal, 18)
                    .frame(maxWidth: .infinity, minHeight: proxy.size.height)
            }
            .scrollDismissesKeyboard(.immediately)
        }
        .overlay(alignment: .bottomTrailing) {
            Button { customizing = true } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(.ultraThinMaterial, in: Circle())
                    .overlay(Circle().stroke(.white.opacity(0.14), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .padding(.trailing, 18)
            .padding(.bottom, 12)
            .accessibilityLabel("Customize")
            .accessibilityIdentifier("newtab-customize")
        }
        .sheet(isPresented: $customizing) {
            CustomizeSheet()
        }
        .environment(\.colorScheme, .dark)
    }

    private var content: some View {
        VStack(spacing: 22) {
            Spacer(minLength: 24)

            if settings.showClock || settings.showDate {
                ClockView(showsTime: settings.showClock, showsDate: settings.showDate)
            }

            if settings.showSearch {
                Button { browser.addressFocusRequests += 1 } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass")
                        Text("Search or enter address")
                        Spacer(minLength: 0)
                    }
                    .font(.body)
                    .foregroundStyle(.white.opacity(0.72))
                    .padding(.horizontal, 18)
                    .frame(height: 50)
                    .background(.ultraThinMaterial, in: Capsule())
                    .overlay(Capsule().stroke(Theme.accent.opacity(0.55), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("newtab-search")
            }

            if tab.isPrivate {
                GlassCard(
                    icon: nil,
                    title: "Private tab",
                    text: "Pages you open here leave no history, cookies or site data once you close every private tab."
                )
            }

            if !browser.library.bookmarks.isEmpty {
                if settings.shortcutRows == 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        LazyHStack(spacing: 6) {
                            ForEach(browser.library.bookmarks) { bookmark in
                                shortcut(bookmark).frame(width: 76)
                            }
                        }
                        .padding(.horizontal, 4)
                    }
                    .accessibilityIdentifier("newtab-shortcuts-row")
                } else {
                    LazyVGrid(columns: columns, spacing: 14) {
                        ForEach(browser.library.bookmarks) { bookmark in
                            shortcut(bookmark)
                        }
                    }
                    .accessibilityIdentifier("newtab-shortcuts-grid")
                }
            }

            GlassCard(
                icon: settings.shieldsOn ? "shield.lefthalf.filled" : "shield.slash",
                title: settings.shieldsOn ? "Shields are on" : "Shields are off",
                text: settings.shieldsOn
                    ? "Ads, trackers and known malicious sites are blocked on every page."
                    : "Turn Shields on in Settings to block ads and trackers."
            )

            Label("No accounts, no telemetry. Everything stays on this phone.", systemImage: "lock")
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.6))
                .multilineTextAlignment(.center)

            // Room for the Customize button fixed at the bottom.
            Spacer(minLength: 72)
        }
    }

    private func shortcut(_ bookmark: Bookmark) -> some View {
        Button { tab.load(bookmark.url) } label: {
            Shortcut(title: bookmark.title, host: bookmark.url.host() ?? "")
        }
        .buttonStyle(.plain)
    }
}

/// The new tab page's Customize sheet: which widgets show and how shortcuts are laid out.
struct CustomizeSheet: View {
    @Environment(Browser.self) private var browser
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let library = browser.library
        NavigationStack {
            Form {
                Section("Widgets") {
                    Toggle("Clock", isOn: Binding(get: { library.settings.showClock }, set: { on in library.update { $0.showClock = on } }))
                    Toggle("Date", isOn: Binding(get: { library.settings.showDate }, set: { on in library.update { $0.showDate = on } }))
                    Toggle("Search", isOn: Binding(get: { library.settings.showSearch }, set: { on in library.update { $0.showSearch = on } }))
                }
                Section("Shortcuts") {
                    Picker("Rows", selection: Binding(get: { library.settings.shortcutRows }, set: { rows in library.update { $0.shortcutRows = rows } })) {
                        Text("One row").tag(1)
                        Text("Multiple rows").tag(2)
                    }
                    .pickerStyle(.segmented)
                }
                Section {
                    Button("Restore layout") { library.restoreLayout() }
                }
            }
            .navigationTitle("Customize")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
        }
        .presentationDetents([.medium, .large])
    }
}

/// The space picture of Orbit's new tab page, darkened at the top and bottom so text and the
/// bars stay readable.
struct NewTabBackdrop: View {
    private static let image = UIImage(named: "NewTabBackdrop.jpg")

    var body: some View {
        ZStack {
            Color.black
            if let image = Self.image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            }
            Color.black.opacity(0.3)
            RadialGradient(
                colors: [.black.opacity(0), .black.opacity(0.55)],
                center: .center,
                startRadius: 120,
                endRadius: 520
            )
            LinearGradient(
                stops: [
                    .init(color: .black.opacity(0.6), location: 0),
                    .init(color: .black.opacity(0), location: 0.32),
                    .init(color: .black.opacity(0), location: 0.5),
                    .init(color: .black.opacity(0.8), location: 1),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

private struct ClockView: View {
    var showsTime = true
    var showsDate = true

    /// The day period ("AM") in a 12-hour locale, drawn small after the digits as on the desktop.
    private static let periodFormatter: DateFormatter? = {
        guard DateFormatter.dateFormat(fromTemplate: "j", options: 0, locale: .current)?.contains("a") == true else { return nil }
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.setLocalizedDateFormatFromTemplate("a")
        return formatter
    }()

    /// Hours and minutes in the locale's own style: "8:10" where clocks use 12 hours, "08:10" where
    /// they use 24.
    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.setLocalizedDateFormatFromTemplate("jmm")
        return formatter
    }()

    private static func digits(_ date: Date) -> String {
        var text = timeFormatter.string(from: date)
        let symbols: [String?] = [timeFormatter.amSymbol, timeFormatter.pmSymbol]
        for case let symbol? in symbols where !symbol.isEmpty {
            text = text.replacingOccurrences(of: symbol, with: "")
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        TimelineView(.everyMinute) { context in
            VStack(spacing: 4) {
                if showsTime {
                    HStack(alignment: .lastTextBaseline, spacing: 6) {
                        Text(Self.digits(context.date))
                            .font(.system(size: 72, weight: .thin))
                            .monospacedDigit()
                        if let period = Self.periodFormatter?.string(from: context.date) {
                            Text(period)
                                .font(.system(size: 20, weight: .regular))
                                .foregroundStyle(.white.opacity(0.72))
                        }
                    }
                }
                if showsDate {
                    Text(context.date, format: .dateTime.weekday(.wide).month(.wide).day())
                        .font(showsTime ? .subheadline : .title3)
                        .foregroundStyle(.white.opacity(0.72))
                }
            }
            .foregroundStyle(.white)
            .shadow(color: .black.opacity(0.45), radius: 8)
        }
    }
}

private struct GlassCard: View {
    /// An SF Symbol, or nil for Orbit's private mark.
    let icon: String?
    let title: LocalizedStringKey
    let text: LocalizedStringKey

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Group {
                if let icon {
                    Image(systemName: icon).font(.title3)
                } else {
                    OrbitPrivateMark(color: Theme.accent).frame(width: 22, height: 22)
                }
            }
            .foregroundStyle(Theme.accent)
            .frame(width: 26)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                Text(text).font(.footnote).foregroundStyle(.white.opacity(0.7))
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(.white.opacity(0.1), lineWidth: 1))
    }
}

private struct Shortcut: View {
    let title: String
    let host: String

    var body: some View {
        VStack(spacing: 6) {
            Text(String(host.replacingOccurrences(of: "www.", with: "").prefix(1)).uppercased())
                .font(.title3.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 52, height: 52)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(Circle().stroke(.white.opacity(0.12), lineWidth: 1))
            Text(title)
                .font(.caption2)
                .foregroundStyle(.white)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
    }
}

/// Orbit's private mark: the orbit ring and dot of Orbit's mark with a crescent moon inside, the
/// same drawing as on the desktop and Android (tools/android/brand.py private_mark, on its 512 grid).
struct OrbitPrivateMark: View {
    var color: Color = Theme.primary

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            let k = side / 320
            let ox = (proxy.size.width - side) / 2 - 96 * k
            let oy = (proxy.size.height - side) / 2 - 96 * k
            let moon = CGRect(x: ox + 184 * k, y: oy + 184 * k, width: 144 * k, height: 144 * k)
            let bite = CGRect(x: ox + 219.46 * k, y: oy + 168.54 * k, width: 124 * k, height: 124 * k)
            Circle()
                .trim(from: 0, to: 300.0 / 360.0)
                .stroke(color, style: StrokeStyle(lineWidth: 46 * k, lineCap: .round))
                .rotationEffect(.degrees(-15))
                .frame(width: 268 * k, height: 268 * k)
                .position(x: ox + 256 * k, y: oy + 256 * k)
            Circle()
                .fill(color)
                .frame(width: 60 * k, height: 60 * k)
                .position(x: ox + 350.75 * k, y: oy + 161.25 * k)
            Path { path in
                path.addEllipse(in: moon)
                path.addEllipse(in: bite)
            }
            .fill(color, style: FillStyle(eoFill: true))
            .clipShape(Path(ellipseIn: moon))
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }
}

/// Orbit's mark: an open ring and a satellite in the accent color.
struct OrbitMark: View {
    var body: some View {
        ZStack {
            Circle()
                .stroke(Theme.accent.opacity(0.35), lineWidth: 5)
            Circle()
                .trim(from: 0, to: 0.72)
                .stroke(Theme.accent, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Circle()
                .fill(Theme.primary)
                .frame(width: 12, height: 12)
                .offset(x: 0, y: -26)
                .rotationEffect(.degrees(80))
        }
        .accessibilityHidden(true)
    }
}
