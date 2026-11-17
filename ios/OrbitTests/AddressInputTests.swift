import XCTest
@testable import Orbit

final class AddressInputTests: XCTestCase {
    func testFullAddressesOpenAsTyped() {
        XCTAssertEqual(AddressInput.url(for: "https://example.com/a?b=1", engine: .duckduckgo)?.absoluteString, "https://example.com/a?b=1")
        XCTAssertEqual(AddressInput.url(for: "  http://example.com  ", engine: .duckduckgo)?.absoluteString, "http://example.com")
    }

    func testHostsGetHTTPS() {
        XCTAssertEqual(AddressInput.url(for: "example.com", engine: .duckduckgo)?.absoluteString, "https://example.com")
        XCTAssertEqual(AddressInput.url(for: "news.example.co.uk/path", engine: .duckduckgo)?.absoluteString, "https://news.example.co.uk/path")
        XCTAssertEqual(AddressInput.url(for: "localhost:8080", engine: .duckduckgo)?.absoluteString, "https://localhost:8080")
        XCTAssertEqual(AddressInput.url(for: "192.168.1.1", engine: .duckduckgo)?.absoluteString, "https://192.168.1.1")
    }

    func testEverythingElseSearches() {
        XCTAssertEqual(AddressInput.url(for: "privacy browser", engine: .duckduckgo)?.absoluteString, "https://duckduckgo.com/?q=privacy%20browser")
        XCTAssertEqual(AddressInput.url(for: "a&b=c", engine: .brave)?.absoluteString, "https://search.brave.com/search?q=a%26b%3Dc")
        XCTAssertEqual(AddressInput.url(for: "javascript:alert(1)", engine: .duckduckgo)?.host(), "duckduckgo.com")
        XCTAssertEqual(AddressInput.url(for: "version1.2", engine: .google)?.host(), "www.google.com")
        XCTAssertNil(AddressInput.url(for: "   ", engine: .duckduckgo))
    }
}
