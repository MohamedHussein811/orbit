import XCTest
import WebKit
@testable import Orbit

/// WebKit must accept every list tools/apple-rules.mjs writes; one rejected list would leave a
/// whole group of sites unblocked.
@MainActor
final class ShieldsTests: XCTestCase {
    private var storeFolder: URL!

    override func setUp() async throws {
        storeFolder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: storeFolder, withIntermediateDirectories: true)
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: storeFolder)
    }

    func testTheAppCarriesTheBlockingLists() throws {
        let manifest = try Shields(store: nil).manifest()
        let groups = Set(manifest.lists.map { $0.id.split(separator: "-").first.map(String.init) ?? "" })
        XCTAssertTrue(groups.isSuperset(of: ["ads", "trackers", "threats"]), "groups: \(groups)")
        XCTAssertTrue(manifest.lists.allSatisfy { $0.rules > 0 && $0.rules <= 150_000 })
    }

    func testWebKitCompilesEveryList() async throws {
        let store = try XCTUnwrap(WKContentRuleListStore(url: storeFolder))
        let shields = Shields(store: store)
        let lists = try await shields.load()
        XCTAssertEqual(lists.count, try shields.manifest().lists.count)

        let again = try await shields.load()
        XCTAssertEqual(Set(again.compactMap(\.identifier)), Set(lists.compactMap(\.identifier)))
    }

    func testHostRulesMatchTheHostAndItsSubdomainsOnly() async throws {
        let store = try XCTUnwrap(WKContentRuleListStore(url: storeFolder))
        let json = #"[{"trigger":{"url-filter":"^[^:]+://+([^:/]+\\.)?ads\\.test[:/]"},"action":{"type":"block"}}]"#
        let list = try await Shields.compile(json, as: "host-rule", in: store)
        XCTAssertEqual(list.identifier, "host-rule")

        let regex = try NSRegularExpression(pattern: #"^[^:]+://+([^:/]+\.)?ads\.test[:/]"#)
        func matches(_ text: String) -> Bool {
            regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
        }
        XCTAssertTrue(matches("https://ads.test/x.js"))
        XCTAssertTrue(matches("https://cdn.ads.test:443/x.js"))
        XCTAssertFalse(matches("https://ads.testing.com/x.js"))
        XCTAssertFalse(matches("https://notads.test/x.js"))
    }
}
