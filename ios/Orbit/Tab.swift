import Foundation
import Observation
import WebKit

@MainActor
@Observable
final class Tab: NSObject, Identifiable {
    let id = UUID()
    let isPrivate: Bool
    @ObservationIgnored let webView: WKWebView
    @ObservationIgnored weak var browser: Browser?

    var title = ""
    var url: URL?
    var progress = 0.0
    var isLoading = false
    var canGoBack = false
    var canGoForward = false

    @ObservationIgnored private var observations: [NSKeyValueObservation] = []

    init(configuration: WKWebViewConfiguration, isPrivate: Bool, browser: Browser) {
        self.isPrivate = isPrivate
        self.browser = browser
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true
        webView.isInspectable = false
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        observe()
    }

    /// The new tab page shows until the tab opens its first address.
    var showsNewTab: Bool { url == nil }

    var displayTitle: String {
        if !title.isEmpty { return title }
        return url?.host() ?? (isPrivate ? String(localized: "Private tab") : String(localized: "New tab"))
    }

    func load(_ url: URL) {
        self.url = url
        webView.load(URLRequest(url: url))
    }

    private func observe() {
        observations = [
            webView.observe(\.title) { [weak self] view, _ in
                MainActor.assumeIsolated { self?.title = view.title ?? "" }
            },
            webView.observe(\.url) { [weak self] view, _ in
                MainActor.assumeIsolated {
                    if let url = view.url { self?.url = url }
                }
            },
            webView.observe(\.estimatedProgress) { [weak self] view, _ in
                MainActor.assumeIsolated { self?.progress = view.estimatedProgress }
            },
            webView.observe(\.isLoading) { [weak self] view, _ in
                MainActor.assumeIsolated { self?.isLoading = view.isLoading }
            },
            webView.observe(\.canGoBack) { [weak self] view, _ in
                MainActor.assumeIsolated { self?.canGoBack = view.canGoBack }
            },
            webView.observe(\.canGoForward) { [weak self] view, _ in
                MainActor.assumeIsolated { self?.canGoForward = view.canGoForward }
            },
        ]
    }
}

extension Tab: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        if navigationAction.targetFrame?.isMainFrame ?? true {
            browser?.applyShields(to: self, host: navigationAction.request.url?.host())
        }
        return .allow
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !isPrivate, let url = webView.url, url.scheme == "https" || url.scheme == "http" else { return }
        browser?.library.recordVisit(title: webView.title ?? "", url: url)
    }
}

extension Tab: WKUIDelegate {
    /// Links that ask for a new window open in this tab; pages cannot open windows of their own.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if navigationAction.navigationType == .linkActivated, navigationAction.targetFrame == nil {
            webView.load(navigationAction.request)
        }
        return nil
    }
}
