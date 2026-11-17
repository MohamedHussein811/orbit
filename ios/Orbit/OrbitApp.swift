import SwiftUI

@main
struct OrbitApp: App {
    @State private var browser = Browser()

    var body: some Scene {
        WindowGroup {
            BrowserView()
                .environment(browser)
                .tint(Theme.primary)
        }
    }
}
