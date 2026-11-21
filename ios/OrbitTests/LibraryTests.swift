import XCTest
import WebKit
@testable import Orbit

@MainActor
final class LibraryTests: XCTestCase {
    private var folder: URL!

    override func setUp() async throws {
        folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: folder)
    }

    func testBookmarksAndSettingsPersist() {
        let url = URL(string: "https://example.com/")!
        let library = Library(folder: folder)
        library.toggleBookmark(title: "Example", url: url)
        library.setEngine(.startpage)
        library.setShields(false, for: "www.example.com")

        let reopened = Library(folder: folder)
        XCTAssertTrue(reopened.isBookmarked(url))
        XCTAssertEqual(reopened.settings.engine, .startpage)
        XCTAssertTrue(reopened.shieldsOff(for: "example.com"))
        XCTAssertTrue(reopened.shieldsOff(for: "WWW.EXAMPLE.COM"))

        reopened.toggleBookmark(title: "Example", url: url)
        XCTAssertFalse(Library(folder: folder).isBookmarked(url))
    }

    func testHistoryMergesReloadsAndKeepsNewestFirst() {
        let library = Library(folder: folder)
        let a = URL(string: "https://a.test/")!
        let b = URL(string: "https://b.test/")!
        library.recordVisit(title: "A", url: a)
        library.recordVisit(title: "A again", url: a)
        library.recordVisit(title: "B", url: b)
        XCTAssertEqual(library.history.map(\.url), [b, a])
        XCTAssertEqual(library.history.last?.title, "A again")
        library.clearHistory()
        XCTAssertTrue(Library(folder: folder).history.isEmpty)
    }

    func testPrivateTabsShareOneSessionThatEndsWithTheLastOne() {
        let browser = Browser(library: Library(folder: folder), loadsShields: false)
        let first = browser.newTab(isPrivate: true)
        let second = browser.newTab(isPrivate: true)
        let firstStore = first.webView.configuration.websiteDataStore
        XCTAssertFalse(firstStore.isPersistent)
        XCTAssertTrue(firstStore === second.webView.configuration.websiteDataStore)

        browser.close(first)
        browser.close(second)
        let third = browser.newTab(isPrivate: true)
        XCTAssertFalse(third.webView.configuration.websiteDataStore === firstStore)
        XCTAssertTrue(browser.tabs.first!.webView.configuration.websiteDataStore.isPersistent)
    }

    func testClosingTheLastTabOpensANewOne() {
        let browser = Browser(library: Library(folder: folder), loadsShields: false)
        XCTAssertEqual(browser.tabs.count, 1)
        browser.close(browser.tabs[0])
        XCTAssertEqual(browser.tabs.count, 1)
        XCTAssertEqual(browser.selected?.id, browser.tabs[0].id)
    }

    func testSettingsFromAnEarlierVersionKeepTheirValuesAndTakeTheNewDefaults() throws {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let old = #"{"engine":"startpage","shieldsOn":false,"shieldsOffSites":["example.com"]}"#
        try Data(old.utf8).write(to: folder.appendingPathComponent("settings.json"))
        let settings = Library(folder: folder).settings
        XCTAssertEqual(settings.engine, .startpage)
        XCTAssertFalse(settings.shieldsOn)
        XCTAssertEqual(settings.shieldsOffSites, ["example.com"])
        XCTAssertFalse(settings.showClock)
        XCTAssertFalse(settings.showDate)
        XCTAssertFalse(settings.showSearch)
        XCTAssertEqual(settings.shortcutRows, 1)
        XCTAssertEqual(settings.startup, .newTab)
    }

    func testNewTabLayoutChangesPersistAndRestoreLayoutResetsThem() {
        let library = Library(folder: folder)
        library.update {
            $0.showClock = true
            $0.showSearch = true
            $0.shortcutRows = 2
        }
        let reopened = Library(folder: folder)
        XCTAssertTrue(reopened.settings.showClock)
        XCTAssertTrue(reopened.settings.showSearch)
        XCTAssertEqual(reopened.settings.shortcutRows, 2)
        reopened.restoreLayout()
        XCTAssertFalse(Library(folder: folder).settings.showClock)
        XCTAssertEqual(Library(folder: folder).settings.shortcutRows, 1)
    }

    func testStartupOpensTheChosenPagesOrTheLastTabsButNoPrivateOnes() {
        let a = URL(string: "https://a.test/")!
        let b = URL(string: "https://b.test/")!
        let library = Library(folder: folder)
        library.update {
            $0.startup = .pages
            $0.startupPages = [a, b]
        }
        let started = Browser(library: Library(folder: folder), loadsShields: false)
        XCTAssertEqual(started.tabs.map(\.url), [a, b])
        XCTAssertEqual(started.selected?.url, a)

        started.newTab(isPrivate: true, url: URL(string: "https://private.test/")!)
        Library(folder: folder).update { $0.startup = .restore }
        let restored = Browser(library: Library(folder: folder), loadsShields: false)
        XCTAssertEqual(restored.tabs.map(\.url), [a, b])

        Library(folder: folder).update { $0.startup = .newTab }
        let fresh = Browser(library: Library(folder: folder), loadsShields: false)
        XCTAssertEqual(fresh.tabs.count, 1)
        XCTAssertNil(fresh.tabs[0].url)
    }

    func testShieldsFollowTheGlobalSwitchAndSiteChoices() {
        let browser = Browser(library: Library(folder: folder), loadsShields: false)
        XCTAssertTrue(browser.shieldsEnabled(for: "example.com"))
        browser.setShields(false, for: "example.com")
        XCTAssertFalse(browser.shieldsEnabled(for: "www.example.com"))
        XCTAssertTrue(browser.shieldsEnabled(for: "other.test"))
        browser.setShieldsOn(false)
        XCTAssertFalse(browser.shieldsEnabled(for: "other.test"))
    }
}
