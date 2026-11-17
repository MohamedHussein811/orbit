import SwiftUI

struct NewTabView: View {
    @Environment(Browser.self) private var browser
    let tab: Tab

    private let columns = [GridItem(.adaptive(minimum: 76), spacing: 16)]

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                VStack(spacing: 8) {
                    OrbitMark()
                        .frame(width: 64, height: 64)
                    Text("Orbit")
                        .font(.largeTitle.weight(.semibold))
                        .foregroundStyle(Theme.text)
                }
                .padding(.top, 48)

                if tab.isPrivate {
                    notice(
                        icon: "eyeglasses",
                        title: "Private tab",
                        text: "Pages you open here leave no history, cookies or site data once you close every private tab."
                    )
                }

                if !browser.library.bookmarks.isEmpty {
                    LazyVGrid(columns: columns, spacing: 18) {
                        ForEach(browser.library.bookmarks.prefix(12)) { bookmark in
                            Button { tab.load(bookmark.url) } label: {
                                Shortcut(title: bookmark.title, host: bookmark.url.host() ?? "")
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 20)
                }

                notice(
                    icon: browser.library.settings.shieldsOn ? "shield.lefthalf.filled" : "shield.slash",
                    title: browser.library.settings.shieldsOn ? "Shields are on" : "Shields are off",
                    text: browser.library.settings.shieldsOn
                        ? "Ads, trackers and known malicious sites are blocked on every page, using the same lists as Orbit on the desktop."
                        : "Turn Shields on in Settings to block ads and trackers."
                )
                notice(
                    icon: "lock",
                    title: "Stays on this phone",
                    text: "Orbit has no accounts and sends no telemetry. Bookmarks, history and settings never leave this device."
                )
            }
            .padding(.bottom, 32)
        }
        .scrollDismissesKeyboard(.immediately)
        .background(Theme.surface)
    }

    private func notice(icon: String, title: LocalizedStringKey, text: LocalizedStringKey) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(Theme.primary)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline).foregroundStyle(Theme.text)
                Text(text).font(.subheadline).foregroundStyle(Theme.secondaryText)
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 16))
        .padding(.horizontal, 20)
    }
}

private struct Shortcut: View {
    let title: String
    let host: String

    var body: some View {
        VStack(spacing: 6) {
            Text(String(host.replacingOccurrences(of: "www.", with: "").prefix(1)).uppercased())
                .font(.title2.weight(.semibold))
                .foregroundStyle(Theme.primary)
                .frame(width: 56, height: 56)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 14))
            Text(title)
                .font(.caption)
                .foregroundStyle(Theme.text)
                .lineLimit(1)
        }
    }
}

/// Orbit's mark: a planet ring and a satellite in the accent color.
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
