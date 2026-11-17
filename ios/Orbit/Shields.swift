import Foundation
import WebKit

/// Orbit's blocking lists, compiled by WebKit from the Rules folder that tools/apple-rules.mjs
/// writes at build time. Compiled lists are kept by WebKit and reused until the lists change.
@MainActor
final class Shields {
    struct Manifest: Decodable {
        struct Entry: Decodable {
            let id: String
            let file: String
            let rules: Int
        }

        let generated: String
        let lists: [Entry]
    }

    enum Failure: Error {
        case missingRules
        case noStore
    }

    private let store: WKContentRuleListStore?
    private let bundle: Bundle

    init(store: WKContentRuleListStore? = WKContentRuleListStore.default(), bundle: Bundle = .main) {
        self.store = store
        self.bundle = bundle
    }

    var rulesFolder: URL? { bundle.url(forResource: "Rules", withExtension: nil) }

    func manifest() throws -> Manifest {
        guard let folder = rulesFolder else { throw Failure.missingRules }
        let data = try Data(contentsOf: folder.appendingPathComponent("lists.json"))
        return try JSONDecoder().decode(Manifest.self, from: data)
    }

    /// Every list, from WebKit's store when this version is already compiled, otherwise compiled now.
    func load() async throws -> [WKContentRuleList] {
        guard let store else { throw Failure.noStore }
        guard let folder = rulesFolder else { throw Failure.missingRules }
        let manifest = try manifest()
        var lists: [WKContentRuleList] = []
        for entry in manifest.lists {
            let identifier = "\(entry.id)@\(manifest.generated)"
            if let list = await Shields.lookUp(identifier, in: store) {
                lists.append(list)
                continue
            }
            let json = try String(contentsOf: folder.appendingPathComponent(entry.file), encoding: .utf8)
            lists.append(try await Shields.compile(json, as: identifier, in: store))
        }
        let current = Set(lists.compactMap(\.identifier))
        for identifier in await Shields.identifiers(in: store) where !current.contains(identifier) {
            await Shields.remove(identifier, from: store)
        }
        return lists
    }

    static func compile(_ json: String, as identifier: String, in store: WKContentRuleListStore) async throws -> WKContentRuleList {
        try await withCheckedThrowingContinuation { continuation in
            store.compileContentRuleList(forIdentifier: identifier, encodedContentRuleList: json) { list, error in
                if let list {
                    continuation.resume(returning: list)
                } else {
                    continuation.resume(throwing: error ?? Failure.missingRules)
                }
            }
        }
    }

    private static func lookUp(_ identifier: String, in store: WKContentRuleListStore) async -> WKContentRuleList? {
        await withCheckedContinuation { continuation in
            store.lookUpContentRuleList(forIdentifier: identifier) { list, _ in
                continuation.resume(returning: list)
            }
        }
    }

    private static func identifiers(in store: WKContentRuleListStore) async -> [String] {
        await withCheckedContinuation { continuation in
            store.getAvailableContentRuleListIdentifiers { identifiers in
                continuation.resume(returning: identifiers ?? [])
            }
        }
    }

    private static func remove(_ identifier: String, from store: WKContentRuleListStore) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            store.removeContentRuleList(forIdentifier: identifier) { _ in
                continuation.resume()
            }
        }
    }
}
