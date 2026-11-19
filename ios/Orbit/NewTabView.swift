import SwiftUI
import UIKit

/// The new tab page, as on Orbit's other systems: the space picture under dark glass, the clock,
/// a search pill, shortcuts and Shields.
struct NewTabView: View {
    @Environment(Browser.self) private var browser
    let tab: Tab

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 4)

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                ClockView()
                    .padding(.top, 36)

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

                if tab.isPrivate {
                    GlassCard(
                        icon: "eyeglasses",
                        title: "Private tab",
                        text: "Pages you open here leave no history, cookies or site data once you close every private tab."
                    )
                }

                if !browser.library.bookmarks.isEmpty {
                    LazyVGrid(columns: columns, spacing: 14) {
                        ForEach(browser.library.bookmarks.prefix(8)) { bookmark in
                            Button { tab.load(bookmark.url) } label: {
                                Shortcut(title: bookmark.title, host: bookmark.url.host() ?? "")
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                GlassCard(
                    icon: browser.library.settings.shieldsOn ? "shield.lefthalf.filled" : "shield.slash",
                    title: browser.library.settings.shieldsOn ? "Shields are on" : "Shields are off",
                    text: browser.library.settings.shieldsOn
                        ? "Ads, trackers and known malicious sites are blocked on every page."
                        : "Turn Shields on in Settings to block ads and trackers."
                )

                Label("No accounts, no telemetry. Everything stays on this phone.", systemImage: "lock")
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.6))
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: 560)
            .padding(.horizontal, 18)
            .padding(.bottom, 28)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.immediately)
        .environment(\.colorScheme, .dark)
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
    /// The day period ("AM") in a 12-hour locale, drawn small after the digits as on the desktop.
    private static let periodFormatter: DateFormatter? = {
        guard DateFormatter.dateFormat(fromTemplate: "j", options: 0, locale: .current)?.contains("a") == true else { return nil }
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.setLocalizedDateFormatFromTemplate("a")
        return formatter
    }()

    var body: some View {
        TimelineView(.everyMinute) { context in
            VStack(spacing: 4) {
                HStack(alignment: .lastTextBaseline, spacing: 6) {
                    Text(context.date, format: .dateTime.hour(.defaultDigits(amPM: .omitted)).minute())
                        .font(.system(size: 72, weight: .thin))
                        .monospacedDigit()
                    if let period = Self.periodFormatter?.string(from: context.date) {
                        Text(period)
                            .font(.system(size: 20, weight: .regular))
                            .foregroundStyle(.white.opacity(0.72))
                    }
                }
                Text(context.date, format: .dateTime.weekday(.wide).month(.wide).day())
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.72))
            }
            .foregroundStyle(.white)
            .shadow(color: .black.opacity(0.45), radius: 8)
        }
    }
}

private struct GlassCard: View {
    let icon: String
    let title: LocalizedStringKey
    let text: LocalizedStringKey

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
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
