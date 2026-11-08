// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

#ifndef ORBIT_HOST_HOST_API_H_
#define ORBIT_HOST_HOST_API_H_

#include <string>

#include "include/cef_request_context.h"
#include "include/cef_resource_request_handler.h"

namespace orbit {

// Pages of Orbit's built-in extension ask the host for browser-level changes through requests to
// https://orbit.invalid/. Requests are answered in-process and never reach the network. Only the
// extension's own origin, as reported by the browser process, is accepted.
bool IsHostApiRequest(const std::string& url, const std::string& initiator);

CefRefPtr<CefResourceRequestHandler> CreateHostApiHandler();

// Applies a theme mode (system, light, dark, space) and accent (#rrggbb) to the browser window.
// Returns false for values it does not recognize. Must run on the UI thread.
bool ApplyBrowserTheme(CefRefPtr<CefRequestContext> context, const std::string& mode, const std::string& accent);

}  // namespace orbit

#endif  // ORBIT_HOST_HOST_API_H_
