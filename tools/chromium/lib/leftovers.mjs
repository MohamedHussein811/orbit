// Finds Chrome, Chromium, Google, Gemini and Incognito names left on Orbit's internal pages: every
// Settings route, the pages people use (new tab, history, downloads, bookmarks, passwords,
// extensions...), the private new tab page, then every other page listed on orbit://chrome-urls.
// Text is read through shadow roots and only from visible elements. Developer pages (internals,
// histograms, credits...) are reported apart: they are not part of the everyday browser.

export const WORDS = /\b(?:Chrom(?:e|ium)\w*|Google|Gemini|Incognito|INCOGNITO)\b|chrome:\/\/|كروم|غوغل|جوجل|متخف/;

// Other products, credits and choices the person makes, not the browser or a Google service.
const ALLOWED = new RegExp(
  [
    "Chrome Web Store", "سوق Chrome الإلكتروني", "Chromium Authors", "ChromeOS", "Chrome OS", "Chromebook",
    "Chrome Remote Desktop", "Chromecast", "Chrome Root Store", "Chrome Enterprise",
    "Google Chrome(?= (?:bookmarks|data|browser data))", "from Google Chrome", "Google Chrome and",
    "and Google Chrome", "Chrome Apps?\\b", "Chrome apps?\\b", "chrome://flags",
    "open source project Chromium", "Chromium open source project", "Chromium project",
  ].join("|"),
  "g",
);

// Search engine choices, import sources and links to an engine's own page name Google on purpose.
const ALLOWED_LINES = [
  /^Google$/,
  /^(?:Edit|Remove) Google$/,
  /^(?:More actions for|Click to open Edit dialog for) Google$/,
  /^(?:Google Chrome|Chromium|Microsoft Edge|Mozilla Firefox|Safari|Brave|Opera)$/,
  /google\.com\/search\?q=%s|\{google:baseURL\}/,
];

// Pages that crash, hang or change state, or only explain how to enable other pages.
const SKIP_PAGES = /^chrome:\/\/(?:quit|restart|crash|kill|hang|inducebrowsercrashforrealz|memory-exhaust|gpuclean|gpucrash|gpuhang|ppapiflashcrash|ppapiflashhang|webuijserror|badcastcrash|shorthang|chrome-urls|contextual-tasks|indexeddb-internals|internals|intro|profile-picker|history-sync-optin|dino)\b/;

// Pages people use, visited first so a page that hangs later cannot hide them.
const USER_PAGES = [
  "chrome://newtab", "chrome://history", "chrome://downloads", "chrome://bookmarks",
  "chrome://password-manager", "chrome://password-manager/passwords", "chrome://password-manager/checkup",
  "chrome://password-manager/settings", "chrome://extensions", "chrome://management",
  "chrome://version", "chrome://help", "chrome://welcome", "chrome://whats-new", "chrome://print",
  "chrome://history/syncedTabs", "chrome://settings/help",
];

const DEVELOPER_PAGES = /^chrome:\/\/(?:[\w-]+-internals|histograms|accessibility|credits|debug-webuis-disabled|tracing|net-export|gpu|media-engagement|webrtc-logs|device-log|inspect|serviceworker-internals|discards|ukm|user-actions|flags|components|terms|system|sandbox|process-internals|predictors|prefs-internals|local-state|signin-internals|sync-internals|omnibox|interstitials|segmentation-internals|traces|usb-internals|webrtc-internals)\b/;

const PAGE_TEXT = `(() => {
  const lines = [];
  const visit = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let node = walker.currentNode; node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.replace(/\\s+/g, " ").trim();
        const parent = node.parentElement;
        if (text && parent && !["SCRIPT", "STYLE", "TEMPLATE"].includes(parent.tagName) &&
            parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
          lines.push(text);
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        for (const attr of ["aria-label", "title", "placeholder"]) {
          const value = node.getAttribute(attr);
          if (value && node.checkVisibility()) lines.push(value);
        }
        if (node.shadowRoot) visit(node.shadowRoot);
      }
    }
  };
  if (document.body) visit(document.body);
  return [...new Set(lines)];
})()`;

export function leftoverWords(line) {
  if (ALLOWED_LINES.some((pattern) => pattern.test(line))) return null;
  const rest = line.replace(ALLOWED, "");
  const found = rest.match(new RegExp(WORDS.source, "g"));
  return found ? [...new Set(found)] : null;
}

async function pageLeftovers(page, url, settleMs) {
  const result = await page.goto(url, { settleMs, timeoutMs: 8000 });
  if (result.errorText) return { url, error: result.errorText, hits: [], lines: 0 };
  let lines;
  try {
    lines = await page.eval(PAGE_TEXT);
  } catch (error) {
    return { url, error: `text not readable: ${error.message}`, hits: [], lines: 0 };
  }
  const hits = [];
  for (const line of lines) {
    const words = leftoverWords(line);
    if (words) hits.push({ words, text: line.slice(0, 200) });
  }
  return { url, hits, lines: lines.length };
}

export async function settingsPaths(page) {
  await page.goto("chrome://settings", { settleMs: 1500 });
  return page.eval(`import("chrome://settings/settings.js").then((m) =>
    [...new Set(Object.values(m.Router.getInstance().getRoutes()).filter((r) => r && r.path).map((r) => r.path))].sort())`);
}

export async function chromeUrls(page) {
  await page.goto("chrome://chrome-urls", { settleMs: 1500 });
  const urls = await page.eval(`(() => {
    const app = document.querySelector("chrome-urls-app");
    const root = app && app.shadowRoot;
    return root ? [...root.querySelectorAll("a[href^='chrome://']")].map((a) => a.getAttribute("href")) : [];
  })()`);
  return [...new Set(urls)].filter((url) => !SKIP_PAGES.test(url)).sort();
}

/**
 * Visits the pages and returns { results: [{ url, group, hits, lines, error? }], unvisited }.
 * group is "settings", "user", "private" or "developer".
 */
export async function crawlLeftovers(cdp, { log = console.log, progress = () => {} } = {}) {
  let page = await cdp.newPage("about:blank");
  const results = [];
  const visit = async (url, settleMs) => {
    progress(url);
    try {
      return await pageLeftovers(page, url, settleMs);
    } catch (error) {
      await page.close();
      page = await cdp.newPage("about:blank").catch(() => null);
      return { url, error: page ? error.message : `${error.message}; the browser stopped`, hits: [], lines: 0 };
    }
  };
  const paths = await settingsPaths(page).catch((error) => {
    log(`note Settings routes not readable: ${error.message}`);
    return ["/"];
  });
  const listed = await chromeUrls(page).catch((error) => {
    log(`note orbit://chrome-urls not readable: ${error.message}`);
    return [];
  });
  const user = [...new Set([...USER_PAGES, ...listed.filter((url) => !DEVELOPER_PAGES.test(url))])];
  const developer = listed.filter((url) => DEVELOPER_PAGES.test(url));
  log(`crawl: ${paths.length} Settings routes, ${user.length} other pages, ${developer.length} developer pages`);

  const run = async (items) => {
    for (let i = 0; i < items.length; i++) {
      const [url, settleMs, group] = items[i];
      results.push({ ...(await visit(url, settleMs)), group });
      if (!page) return items.slice(i + 1).map(([url]) => url);
    }
    return [];
  };
  const visitPrivate = async () => {
    const context = await cdp.send("Target.createBrowserContext").catch(() => null);
    if (!context) return;
    try {
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId: context.browserContextId });
      const result = await pageLeftovers(await cdp.page(targetId), "chrome://newtab", 1500);
      results.push({ ...result, url: "private chrome://newtab", group: "private" });
    } catch (error) {
      results.push({ url: "private chrome://newtab", error: error.message, hits: [], lines: 0, group: "private" });
    }
    await cdp.send("Target.disposeBrowserContext", { browserContextId: context.browserContextId }).catch(() => {});
  };

  const rest = user.filter((url) => !USER_PAGES.includes(url));
  let unvisited = await run([
    ...paths.map((path) => [`chrome://settings${path}`, 1200, "settings"]),
    ...USER_PAGES.map((url) => [url, 1000, "user"]),
  ]);
  if (page) {
    await visitPrivate();
    unvisited = await run([...rest.map((url) => [url, 1000, "user"]), ...developer.map((url) => [url, 1000, "developer"])]);
  } else {
    unvisited.push("private chrome://newtab", ...rest, ...developer);
  }
  await page?.close();
  return { results, unvisited };
}

export function printLeftovers({ results, unvisited }, log = console.log) {
  let count = 0;
  const show = (url) => url.replace(/chrome:\/\//, "orbit://");
  for (const group of ["settings", "user", "private", "developer"]) {
    const pages = results.filter((r) => r.group === group);
    const empty = pages.filter((r) => !r.error && r.lines === 0).map((r) => show(r.url));
    let hits = 0;
    for (const { url, hits: found, error } of pages) {
      if (error) log(`leftover ${group} ${show(url)}: page error ${error}`);
      for (const hit of found) {
        hits++;
        log(`leftover ${group} ${show(url)} [${hit.words.join(", ")}] ${hit.text}`);
      }
    }
    if (group !== "developer") count += hits;
    const lines = pages.reduce((sum, r) => sum + r.lines, 0);
    log(`crawl ${group}: ${pages.length} pages, ${lines} text lines read, ${hits} leftover texts` +
      (empty.length ? `, no text on ${empty.join(" ")}` : ""));
  }
  if (unvisited.length) log(`crawl: not visited (the browser stopped): ${unvisited.map(show).join(" ")}`);
  log(`crawl: ${count} leftover texts outside developer pages`);
  return count;
}
