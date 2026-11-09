// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
// Portions copyright (c) 2013 The Chromium Embedded Framework Authors, under the BSD-style
// license in THIRD_PARTY_NOTICES.md.

#import <Cocoa/Cocoa.h>

#include "include/cef_application_mac.h"
#include "include/cef_command_line.h"
#include "include/wrapper/cef_helpers.h"
#include "include/wrapper/cef_library_loader.h"
#include "mac_menu.h"
#include "orbit_app.h"
#include "orbit_client.h"
#include "startup.h"

@interface OrbitAppDelegate : NSObject <NSApplicationDelegate>
- (void)createApplication:(id)object;
- (void)tryToTerminateApplication:(NSApplication*)app;
@end

@interface OrbitApplication : NSApplication <CefAppProtocol> {
 @private
  BOOL handlingSendEvent_;
}
@end

@implementation OrbitApplication
- (BOOL)isHandlingSendEvent {
  return handlingSendEvent_;
}

- (void)setHandlingSendEvent:(BOOL)handlingSendEvent {
  handlingSendEvent_ = handlingSendEvent;
}

- (void)sendEvent:(NSEvent*)event {
  CefScopedSendingEvent sendingEventScoper;
  [super sendEvent:event];
}

// Chromium must leave the main run loop to shut down in order, so quit closes every browser
// and the application exits once the last one is gone.
- (void)terminate:(id)sender {
  OrbitAppDelegate* delegate = static_cast<OrbitAppDelegate*>([NSApp delegate]);
  [delegate tryToTerminateApplication:self];
}
@end

@implementation OrbitAppDelegate
- (void)createApplication:(id)object {
  orbit::InstallMainMenu();
  [[NSApplication sharedApplication] setDelegate:self];
}

- (void)tryToTerminateApplication:(NSApplication*)app {
  orbit::OrbitClient* client = orbit::OrbitClient::GetInstance();
  if (client) {
    client->CloseAllBrowsers(false);
  }
}

// Clicking the Dock icon with no windows open opens a new one.
- (BOOL)applicationShouldHandleReopen:(NSApplication*)sender hasVisibleWindows:(BOOL)hasVisibleWindows {
  orbit::OrbitClient* client = orbit::OrbitClient::GetInstance();
  if (!hasVisibleWindows && client) {
    client->OpenWindow(std::string());
  }
  return NO;
}

- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication*)sender {
  return NSTerminateNow;
}

- (BOOL)applicationSupportsSecureRestorableState:(NSApplication*)app {
  return YES;
}
@end

int main(int argc, char* argv[]) {
  // The macOS sandbox requires the framework to load at runtime.
  CefScopedLibraryLoader library_loader;
  if (!library_loader.LoadInMain()) {
    return 1;
  }

  CefMainArgs main_args(argc, argv);

  @autoreleasepool {
    [OrbitApplication sharedApplication];
    CHECK([NSApp isKindOfClass:[OrbitApplication class]]);

    CefRefPtr<CefCommandLine> command_line = CefCommandLine::CreateCommandLine();
    command_line->InitFromArgv(argc, argv);

    int exit_code = 0;
    orbit::StartupOptions options;
    if (!orbit::ResolveStartup(command_line, options, exit_code)) {
      return exit_code;
    }

    CefSettings settings;
    orbit::FillSettings(options, settings);

    CefRefPtr<orbit::OrbitApp> app(new orbit::OrbitApp(options));
    if (!CefInitialize(main_args, settings, app.get(), nullptr)) {
      return CefGetExitCode();
    }

    NSObject* delegate = [[OrbitAppDelegate alloc] init];
    [delegate performSelectorOnMainThread:@selector(createApplication:)
                               withObject:nil
                            waitUntilDone:NO];

    CefRunMessageLoop();
    CefShutdown();
    delegate = nil;
  }
  return 0;
}
