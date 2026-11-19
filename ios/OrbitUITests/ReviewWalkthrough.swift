import XCTest

/// Walks through Orbit's main features at a readable pace. CI records the simulator screen while
/// this runs to make the video for App Review.
final class ReviewWalkthrough: XCTestCase {
    private let app = XCUIApplication()

    func testWalkthrough() {
        continueAfterFailure = true
        app.launch()

        let search = app.buttons["newtab-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 180))
        pause(4)

        search.tap()
        type("private web browser\n")
        pause(8)

        let address = app.textFields["address"]
        if address.waitForExistence(timeout: 10) {
            address.tap()
            type("en.wikipedia.org/wiki/Web_browser\n")
            pause(10)
        }

        menu("Turn Shields off for this site")
        pause(4)
        menu("Turn Shields on for this site")
        pause(4)

        menu("Add bookmark")
        pause(2)
        menu("Bookmarks")
        pause(4)
        done()

        menu("New private tab")
        pause(4)
        if search.waitForExistence(timeout: 10) {
            search.tap()
            type("example.com\n")
            pause(6)
        }

        let tabs = app.buttons["Tabs"]
        if tabs.waitForExistence(timeout: 5) {
            tabs.tap()
            pause(4)
            done()
        }

        menu("History")
        pause(4)
        done()

        menu("Settings")
        pause(5)
        done()
        pause(2)
    }

    private func menu(_ item: String) {
        let button = app.buttons["Menu"]
        guard button.waitForExistence(timeout: 5) else { return }
        button.tap()
        let entry = app.buttons[item]
        if entry.waitForExistence(timeout: 5) {
            pause(1)
            entry.tap()
        } else {
            app.tap()
        }
    }

    private func done() {
        let button = app.buttons["Done"]
        if button.waitForExistence(timeout: 5) { button.tap() }
        pause(2)
    }

    private func type(_ text: String) {
        pause(1)
        app.typeText(text)
    }

    private func pause(_ seconds: TimeInterval) {
        Thread.sleep(forTimeInterval: seconds)
    }
}
