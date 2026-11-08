// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

#include "host_api.h"

#include <cstdlib>
#include <vector>

#include "defaults.h"
#include "include/base/cef_callback.h"
#include "include/cef_parser.h"
#include "include/cef_stream.h"
#include "include/cef_task.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/wrapper/cef_stream_resource_handler.h"

namespace orbit {

namespace {

constexpr char kApiOrigin[] = "https://orbit.invalid/";
constexpr char kThemePath[] = "https://orbit.invalid/theme";

// |body| must outlive the response. Callers pass static strings.
CefRefPtr<CefResourceHandler> Reply(int status, const std::string& text, const std::string& body) {
  CefRefPtr<CefStreamReader> stream = CefStreamReader::CreateForData(const_cast<char*>(body.data()), body.size());
  CefResponse::HeaderMap headers;
  headers.emplace("Cache-Control", "no-store");
  headers.emplace("Access-Control-Allow-Origin", std::string("chrome-extension://") + kExtensionId);
  return new CefStreamResourceHandler(status, text, "application/json", headers, stream);
}

std::string ReadBody(CefRefPtr<CefRequest> request) {
  CefRefPtr<CefPostData> post = request->GetPostData();
  if (!post) {
    return std::string();
  }
  CefPostData::ElementVector elements;
  post->GetElements(elements);
  std::string body;
  for (const auto& element : elements) {
    if (element->GetType() != PDE_TYPE_BYTES) {
      continue;
    }
    std::vector<char> bytes(element->GetBytesCount());
    element->GetBytes(bytes.size(), bytes.data());
    body.append(bytes.data(), bytes.size());
  }
  return body;
}

bool ParseAccent(const std::string& accent, cef_color_t& color) {
  if (accent.size() != 7 || accent[0] != '#') {
    return false;
  }
  char* end = nullptr;
  const unsigned long value = std::strtoul(accent.c_str() + 1, &end, 16);
  if (end != accent.c_str() + 7) {
    return false;
  }
  color = 0xFF000000u | static_cast<cef_color_t>(value);
  return true;
}

bool HandleTheme(CefRefPtr<CefRequest> request) {
  const std::string body = ReadBody(request);
  CefRefPtr<CefValue> json = CefParseJSON(body.data(), body.size(), JSON_PARSER_RFC);
  if (!json || json->GetType() != VTYPE_DICTIONARY) {
    return false;
  }
  CefRefPtr<CefDictionaryValue> fields = json->GetDictionary();
  const std::string mode = fields->GetString("mode").ToString();
  const std::string accent = fields->GetString("accent").ToString();
  cef_color_t ignored;
  if (!ParseAccent(accent, ignored)) {
    return false;
  }
  if (mode != "system" && mode != "light" && mode != "dark" && mode != "space") {
    return false;
  }
  CefPostTask(TID_UI, base::BindOnce(base::IgnoreResult(&ApplyBrowserTheme), CefRequestContext::GetGlobalContext(), mode, accent));
  return true;
}

class HostApiHandler : public CefResourceRequestHandler {
 public:
  HostApiHandler() = default;
  HostApiHandler(const HostApiHandler&) = delete;
  HostApiHandler& operator=(const HostApiHandler&) = delete;

  CefRefPtr<CefResourceHandler> GetResourceHandler(CefRefPtr<CefBrowser> browser,
                                                   CefRefPtr<CefFrame> frame,
                                                   CefRefPtr<CefRequest> request) override {
    static const std::string kOk = "{\"ok\":true}";
    static const std::string kBad = "{\"ok\":false}";
    if (request->GetURL().ToString() == kThemePath && request->GetMethod() == "POST" && HandleTheme(request)) {
      return Reply(200, "OK", kOk);
    }
    return Reply(400, "Bad Request", kBad);
  }

 private:
  IMPLEMENT_REFCOUNTING(HostApiHandler);
};

}  // namespace

bool IsHostApiRequest(const std::string& url, const std::string& initiator) {
  if (url.rfind(kApiOrigin, 0) != 0) {
    return false;
  }
  return initiator == std::string("chrome-extension://") + kExtensionId ||
         initiator == std::string("chrome-extension://") + kExtensionId + "/";
}

CefRefPtr<CefResourceRequestHandler> CreateHostApiHandler() {
  return new HostApiHandler();
}

bool ApplyBrowserTheme(CefRefPtr<CefRequestContext> context, const std::string& mode, const std::string& accent) {
  cef_color_t color = 0;
  if (!context || !ParseAccent(accent, color)) {
    return false;
  }
  if (mode == "system") {
    context->SetChromeColorScheme(CEF_COLOR_VARIANT_SYSTEM, 0);
    context->SetChromeColorScheme(CEF_COLOR_VARIANT_TONAL_SPOT, color);
  } else if (mode == "light") {
    context->SetChromeColorScheme(CEF_COLOR_VARIANT_LIGHT, 0);
    context->SetChromeColorScheme(CEF_COLOR_VARIANT_TONAL_SPOT, color);
  } else if (mode == "dark") {
    context->SetChromeColorScheme(CEF_COLOR_VARIANT_DARK, 0);
    context->SetChromeColorScheme(CEF_COLOR_VARIANT_NEUTRAL, color);
  } else if (mode == "space") {
    context->SetChromeColorScheme(CEF_COLOR_VARIANT_DARK, 0);
    context->SetChromeColorScheme(CEF_COLOR_VARIANT_TONAL_SPOT, color);
  } else {
    return false;
  }
  return true;
}

}  // namespace orbit
