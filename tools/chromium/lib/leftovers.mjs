// Finds Chrome, Chromium, Google, Gemini and Incognito names left on Orbit's internal pages: every
// Settings route, every page listed on orbit://chrome-urls and the private new tab page. Text is
// read through shadow roots and only from visible elements.

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
  /^(?:Google Chrome|Chromium|Microsoft Edge|Mozilla Firefox|Safari|Brave|Opera)$/,
  /google\.com\/search\?q=%s|\{google:baseURL\}/,
];

// Debug pages that crash or hang, change state, or only explain how to enable other pages.
const SKIP_PAGES = /^chrome:\/\/(?:quit|restart|crash|kill|hang|inducebrowsercrashforrealz|memory-exhaust|gpuclean|gpucrash|gpuhang|ppapiflashcrash|ppapiflashhang|webuijserror|badcastcrash|shorthang|chrome-urls|contextual-tasks)\b/;

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
      } else {
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
  if (result.errorText) return { url, error: result.errorText, hits: [] };
  const lines = await page.eval(PAGE_TEXT).catch(() => []);
  const hits = [];
  for (const line of lines) {
    const words = leftoverWords(line);
    if (words) hits.push({ words, text: line.slice(0, 200) });
  }
  return { url, hits };
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

/** Visits the pages and returns [{ url, hits: [{ words, text }], error? }] for pages with hits. */
export async function crawlLeftovers(cdp, { log = console.log, progress = () => {} } = {}) {
  let page = await cdp.newPage("about:blank");
  const found = [];
  const visit = async (url, settleMs) => {
    progress(url);
    try {
      return await pageLeftovers(page, url, settleMs);
    } catch (error) {
      await page.close();
      page = await cdp.newPage("about:blank").catch(() => null);
      return { url, error: page ? error.message : `${error.message}; the browser stopped`, hits: [] };
    }
  };
  const paths = await settingsPaths(page).catch((error) => {
    log(`note Settings routes not readable: ${error.message}`);
    return ["/"];
  });
  const urls = await chromeUrls(page).catch((error) => {
    log(`note orbit://chrome-urls not readable: ${error.message}`);
    return [];
  });
  log(`crawl: ${paths.length} Settings routes, ${urls.length} internal pages`);
  const targets = [...paths.map((path) => [`chrome://settings${path}`, 1200]), ...urls.map((url) => [url, 1000])];
  for (const [url, settleMs] of targets) {
    const result = await visit(url, settleMs);
    if (result.hits.length || result.error) found.push(result);
    if (!page) return found;
  }
  await page.close();

  const context = await cdp.send("Target.createBrowserContext").catch(() => null);
  if (context) {
    try {
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId: context.browserContextId });
      const result = await pageLeftovers(await cdp.page(targetId), "chrome://newtab", 1500);
      result.url = "private chrome://newtab";
      if (result.hits.length || result.error) found.push(result);
    } catch (error) {
      found.push({ url: "private chrome://newtab", error: error.message, hits: [] });
    }
    await cdp.send("Target.disposeBrowserContext", { browserContextId: context.browserContextId }).catch(() => {});
  }
  return found;
}

export function printLeftovers(found, log = console.log) {
  let count = 0;
  for (const { url, hits, error } of found) {
    if (error) log(`leftover ${url}: page error ${error}`);
    for (const hit of hits) {
      count++;
      log(`leftover ${url.replace(/^chrome:/, "orbit:")} [${hit.words.join(", ")}] ${hit.text}`);
    }
  }
  log(`crawl: ${count} leftover texts on ${found.filter((f) => f.hits.length).length} pages`);
  return count;
}
