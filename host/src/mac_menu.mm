// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

#import <Cocoa/Cocoa.h>

#include "mac_menu.h"

#include <iterator>
#include <string>

#include "include/cef_browser.h"
#include "include/cef_id_mappers.h"
#include "orbit_client.h"

// Runs a Chromium command in the window the person is using.
@interface OrbitMenuTarget : NSObject <NSMenuItemValidation>
- (void)runCommand:(NSMenuItem*)item;
@end

namespace {

constexpr NSEventModifierFlags kCmd = NSEventModifierFlagCommand;
constexpr NSEventModifierFlags kShift = NSEventModifierFlagShift;
constexpr NSEventModifierFlags kOption = NSEventModifierFlagOption;
constexpr NSEventModifierFlags kControl = NSEventModifierFlagControl;

struct CommandItem {
  const char* title;
  const char* command;  // nullptr marks a separator.
  const char* key;
  NSEventModifierFlags modifiers;
};

struct NativeItem {
  const char* title;
  SEL action;  // nullptr marks a separator.
  const char* key;
  NSEventModifierFlags modifiers;
};

OrbitMenuTarget* g_target = nil;
int g_new_window_id = -1;

NSMenuItem* TopLevel(NSMenu* bar, NSString* title) {
  NSMenuItem* item = [bar addItemWithTitle:title action:nil keyEquivalent:@""];
  NSMenu* menu = [[NSMenu alloc] initWithTitle:title];
  item.submenu = menu;
  return item;
}

void AddCommands(NSMenu* menu, const CommandItem* items, size_t count) {
  for (size_t i = 0; i < count; ++i) {
    const CommandItem& entry = items[i];
    if (!entry.command) {
      [menu addItem:[NSMenuItem separatorItem]];
      continue;
    }
    const int command = cef_id_for_command_id_name(entry.command);
    if (command == -1) {
      continue;
    }
    NSMenuItem* item = [menu addItemWithTitle:[NSString stringWithUTF8String:entry.title]
                                       action:@selector(runCommand:)
                                keyEquivalent:[NSString stringWithUTF8String:entry.key]];
    item.keyEquivalentModifierMask = entry.modifiers;
    item.target = g_target;
    item.tag = command;
  }
}

void AddNative(NSMenu* menu, const NativeItem* items, size_t count) {
  for (size_t i = 0; i < count; ++i) {
    const NativeItem& entry = items[i];
    if (!entry.action) {
      [menu addItem:[NSMenuItem separatorItem]];
      continue;
    }
    NSMenuItem* item = [menu addItemWithTitle:[NSString stringWithUTF8String:entry.title]
                                       action:entry.action
                                keyEquivalent:[NSString stringWithUTF8String:entry.key]];
    item.keyEquivalentModifierMask = entry.modifiers;
  }
}

// The browser showing in the frontmost Orbit window.
CefRefPtr<CefBrowser> ActiveBrowser(orbit::OrbitClient* client) {
  NSWindow* key = NSApp.keyWindow ?: NSApp.mainWindow;
  for (const auto& browser : client->browsers()) {
    NSView* view = CAST_CEF_WINDOW_HANDLE_TO_NSVIEW(browser->GetHost()->GetWindowHandle());
    if (view && view.window == key) {
      return browser;
    }
  }
  return client->browsers().empty() ? nullptr : client->browsers().back();
}

}  // namespace

@implementation OrbitMenuTarget
- (void)runCommand:(NSMenuItem*)item {
  orbit::OrbitClient* client = orbit::OrbitClient::GetInstance();
  if (!client) {
    return;
  }
  CefRefPtr<CefBrowser> browser = ActiveBrowser(client);
  if (!browser) {
    if (item.tag == g_new_window_id) {
      client->OpenWindow(std::string());
    }
    return;
  }
  browser->GetHost()->ExecuteChromeCommand(static_cast<int>(item.tag), CEF_WOD_CURRENT_TAB);
}

- (BOOL)validateMenuItem:(NSMenuItem*)item {
  orbit::OrbitClient* client = orbit::OrbitClient::GetInstance();
  if (!client) {
    return NO;
  }
  CefRefPtr<CefBrowser> browser = ActiveBrowser(client);
  if (!browser) {
    return item.tag == g_new_window_id;
  }
  return browser->GetHost()->CanExecuteChromeCommand(static_cast<int>(item.tag));
}
@end

namespace orbit {

void InstallMainMenu() {
  g_target = [[OrbitMenuTarget alloc] init];
  g_new_window_id = cef_id_for_command_id_name("IDC_NEW_WINDOW");

  NSMenu* bar = [[NSMenu alloc] initWithTitle:@""];

  NSMenu* app = TopLevel(bar, @"Orbit").submenu;
  static const CommandItem kAbout[] = {{"About Orbit", "IDC_ABOUT", "", 0}};
  AddCommands(app, kAbout, std::size(kAbout));
  [app addItem:[NSMenuItem separatorItem]];
  static const CommandItem kSettings[] = {
      {"Settings…", "IDC_OPTIONS", ",", kCmd},
      {"Delete Browsing Data…", "IDC_CLEAR_BROWSING_DATA", "\x08", kCmd | kShift},
  };
  AddCommands(app, kSettings, std::size(kSettings));
  [app addItem:[NSMenuItem separatorItem]];
  NSMenuItem* services = [app addItemWithTitle:@"Services" action:nil keyEquivalent:@""];
  services.submenu = [[NSMenu alloc] initWithTitle:@"Services"];
  NSApp.servicesMenu = services.submenu;
  static const NativeItem kAppNative[] = {
      {"", nullptr, "", 0},
      {"Hide Orbit", @selector(hide:), "h", kCmd},
      {"Hide Others", @selector(hideOtherApplications:), "h", kCmd | kOption},
      {"Show All", @selector(unhideAllApplications:), "", 0},
      {"", nullptr, "", 0},
      {"Quit Orbit", @selector(terminate:), "q", kCmd},
  };
  AddNative(app, kAppNative, std::size(kAppNative));

  NSMenu* file = TopLevel(bar, @"File").submenu;
  static const CommandItem kFile[] = {
      {"New Tab", "IDC_NEW_TAB", "t", kCmd},
      {"New Window", "IDC_NEW_WINDOW", "n", kCmd},
      {"New Incognito Window", "IDC_NEW_INCOGNITO_WINDOW", "n", kCmd | kShift},
      {"Reopen Closed Tab", "IDC_RESTORE_TAB", "t", kCmd | kShift},
      {"Open Location…", "IDC_FOCUS_LOCATION", "l", kCmd},
      {"", nullptr, "", 0},
      {"Close Window", "IDC_CLOSE_WINDOW", "w", kCmd | kShift},
      {"Close Tab", "IDC_CLOSE_TAB", "w", kCmd},
      {"Save Page As…", "IDC_SAVE_PAGE", "s", kCmd},
      {"", nullptr, "", 0},
      {"Print…", "IDC_PRINT", "p", kCmd},
  };
  AddCommands(file, kFile, std::size(kFile));

  NSMenu* edit = TopLevel(bar, @"Edit").submenu;
  static const NativeItem kEdit[] = {
      {"Undo", @selector(undo:), "z", kCmd},
      {"Redo", @selector(redo:), "z", kCmd | kShift},
      {"", nullptr, "", 0},
      {"Cut", @selector(cut:), "x", kCmd},
      {"Copy", @selector(copy:), "c", kCmd},
      {"Paste", @selector(paste:), "v", kCmd},
      {"Select All", @selector(selectAll:), "a", kCmd},
      {"", nullptr, "", 0},
  };
  AddNative(edit, kEdit, std::size(kEdit));
  static const CommandItem kFind[] = {
      {"Find…", "IDC_FIND", "f", kCmd},
      {"Find Next", "IDC_FIND_NEXT", "g", kCmd},
      {"Find Previous", "IDC_FIND_PREVIOUS", "g", kCmd | kShift},
  };
  AddCommands(edit, kFind, std::size(kFind));

  NSMenu* view = TopLevel(bar, @"View").submenu;
  static const CommandItem kView[] = {
      {"Always Show Bookmarks Bar", "IDC_SHOW_BOOKMARK_BAR", "b", kCmd | kShift},
      {"", nullptr, "", 0},
      {"Reload This Page", "IDC_RELOAD", "r", kCmd},
      {"Force Reload This Page", "IDC_RELOAD_BYPASSING_CACHE", "r", kCmd | kShift},
      {"", nullptr, "", 0},
      {"Enter Full Screen", "IDC_FULLSCREEN", "f", kCmd | kControl},
      {"Actual Size", "IDC_ZOOM_NORMAL", "0", kCmd},
      {"Zoom In", "IDC_ZOOM_PLUS", "+", kCmd},
      {"Zoom Out", "IDC_ZOOM_MINUS", "-", kCmd},
      {"", nullptr, "", 0},
      {"Developer Tools", "IDC_DEV_TOOLS_TOGGLE", "i", kCmd | kOption},
      {"View Source", "IDC_VIEW_SOURCE", "u", kCmd | kOption},
  };
  AddCommands(view, kView, std::size(kView));

  NSMenu* history = TopLevel(bar, @"History").submenu;
  static const CommandItem kHistory[] = {
      {"Back", "IDC_BACK", "[", kCmd},
      {"Forward", "IDC_FORWARD", "]", kCmd},
      {"", nullptr, "", 0},
      {"Show Full History", "IDC_SHOW_HISTORY", "y", kCmd},
  };
  AddCommands(history, kHistory, std::size(kHistory));

  NSMenu* bookmarks = TopLevel(bar, @"Bookmarks").submenu;
  static const CommandItem kBookmarks[] = {
      {"Bookmark This Tab…", "IDC_BOOKMARK_THIS_TAB", "d", kCmd},
      {"Bookmark Manager", "IDC_SHOW_BOOKMARK_MANAGER", "b", kCmd | kOption},
  };
  AddCommands(bookmarks, kBookmarks, std::size(kBookmarks));

  NSMenuItem* windowItem = TopLevel(bar, @"Window");
  static const NativeItem kWindowNative[] = {
      {"Minimize", @selector(performMiniaturize:), "m", kCmd},
      {"Zoom", @selector(performZoom:), "", 0},
      {"", nullptr, "", 0},
  };
  AddNative(windowItem.submenu, kWindowNative, std::size(kWindowNative));
  static const CommandItem kWindow[] = {
      {"Select Next Tab", "IDC_SELECT_NEXT_TAB", "}", kCmd | kShift},
      {"Select Previous Tab", "IDC_SELECT_PREVIOUS_TAB", "{", kCmd | kShift},
      {"", nullptr, "", 0},
      {"Downloads", "IDC_SHOW_DOWNLOADS", "j", kCmd | kShift},
      {"Extensions", "IDC_MANAGE_EXTENSIONS", "", 0},
  };
  AddCommands(windowItem.submenu, kWindow, std::size(kWindow));
  NSApp.windowsMenu = windowItem.submenu;

  NSApp.mainMenu = bar;
}

}  // namespace orbit
