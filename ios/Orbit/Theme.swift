import SwiftUI
import UIKit

/// Orbit's palette from chromium/DESIGN.md: white or graphite with a single blue accent.
enum Theme {
    static let primary = Color(light: 0x1F5BB9, dark: 0x81B2FE)
    static let accent = Color(light: 0x7CACF8, dark: 0x7CACF8)
    static let surface = Color(light: 0xFFFFFF, dark: 0x181C21)
    static let frame = Color(light: 0xD2E3FF, dark: 0x1C1F25)
    static let addressBar = Color(light: 0xEAEEF4, dark: 0x23262C)
    static let card = Color(light: 0xF2F5FA, dark: 0x272B30)
    static let text = Color(light: 0x111C2C, dark: 0xE0E2E7)
    static let secondaryText = Color(light: 0x3F465E, dark: 0xC4C6CE)
}

extension Color {
    init(light: UInt32, dark: UInt32) {
        self.init(UIColor { traits in
            UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}
