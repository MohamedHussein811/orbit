import SwiftUI

@main
struct OrbitApp: App {
    @State private var browser = Browser()

    var body: some Scene {
        WindowGroup {
            BrowserView()
                .environment(browser)
                .tint(Theme.primary)
                .task {
                    // A page given at launch (-OrbitOpen <url>), used for the App Store screenshots.
                    if let page = UserDefaults.standard.string(forKey: "OrbitOpen"), let tab = browser.selected {
                        browser.open(page, in: tab)
                    }
                }
        }
    }
}
