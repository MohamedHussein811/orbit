// Orbit's privacy page: choices the browser's own settings do not offer, and links to those it does.

import { h } from "../newtab/dom.ts";
import { CLEARABLE_DATA, HISTORY_DAYS, sanitizePrivacy, type ClearableData, type FingerprintLevel, type PrivacySettings, type WebRtcPolicy } from "../shared/privacy.ts";
import { normalizeHosts, type Message } from "../shared/shields.ts";

const page = document.getElementById("page")!;

const FINGERPRINT_CHOICES: Array<{ value: FingerprintLevel; label: string; detail: string }> = [
  { value: "standard", label: "Standard", detail: "Canvas, audio and graphics readings differ from site to site. Hardware details are rounded. This is the least likely to affect how sites work." },
  { value: "strict", label: "Strict", detail: "Also rounds screen size and changes text measurements slightly. Some sites may look or behave differently." },
  { value: "off", label: "Off", detail: "Sites read your real values." },
];

const WEBRTC_CHOICES: Array<{ value: WebRtcPolicy; label: string; detail: string }> = [
  { value: "default_public_interface_only", label: "Hide local network addresses", detail: "Calls work normally. Sites do not see your addresses inside your network." },
  { value: "disable_non_proxied_udp", label: "Only use a proxy", detail: "With no proxy set, video calls may not connect." },
  { value: "default", label: "Chromium default", detail: "Fewest connection problems, and the least protection." },
];

const CLEAR_LABELS: Record<ClearableData, string> = {
  cookies: "Cookies and site data",
  cache: "Cached images and files",
  history: "Browsing history",
  downloads: "Download history",
  formData: "Autofill form data",
};

function radioGroup<T extends string | number>(name: string, choices: Array<{ value: T; label: string; detail?: string }>, current: T, onChange: (value: T) => void): HTMLElement {
  return h(
    "div",
    { class: "options", role: "radiogroup", "aria-label": name },
    ...choices.map((choice) =>
      h(
        "label",
        {},
        h("input", { type: "radio", name, value: String(choice.value), checked: choice.value === current, onchange: () => onChange(choice.value) }),
        h("span", {}, choice.label),
        choice.detail ? h("small", {}, choice.detail) : null,
      ),
    ),
  );
}

async function save(settings: PrivacySettings): Promise<void> {
  const message: Message = { type: "set-privacy", settings };
  await chrome.runtime.sendMessage(message);
}

function section(title: string, description: string | null, ...content: HTMLElement[]): HTMLElement {
  return h("section", { class: "pane setting" }, h("h2", {}, title), description ? h("p", {}, description) : null, ...content);
}

function openBrowserPage(url: string, label: string): HTMLElement {
  return h("button", { type: "button", class: "link", onclick: () => void chrome.tabs.create({ url }) }, label);
}

async function draw(): Promise<void> {
  const stored = await chrome.storage.local.get(["privacy", "sitesOff"]);
  let settings = sanitizePrivacy(stored.privacy);
  const sitesOff = normalizeHosts(stored.sitesOff);
  const change = async (patch: Partial<PrivacySettings>) => {
    settings = sanitizePrivacy({ ...settings, ...patch });
    await save(settings);
  };

  const clearBoxes = h(
    "div",
    { class: "options" },
    ...CLEARABLE_DATA.map((item) => {
      const box = h("input", {
        type: "checkbox",
        name: item,
        checked: settings.clearOnStart.includes(item),
        onchange: () => {
          const next = box.checked ? [...settings.clearOnStart, item] : settings.clearOnStart.filter((other) => other !== item);
          void change({ clearOnStart: next });
        },
      });
      return h("label", {}, box, h("span", {}, CLEAR_LABELS[item]));
    }),
  );

  const historyChoices = HISTORY_DAYS.map((days) => ({ value: days as number, label: days === 0 ? "Keep until I delete it" : days === 365 ? "1 year" : `${days} days` }));

  const siteList = sitesOff.length
    ? h(
        "div",
        {},
        ...sitesOff.map((host) =>
          h(
            "div",
            { class: "site-row" },
            h("span", {}, host),
            h(
              "button",
              {
                type: "button",
                class: "ghost",
                onclick: async () => {
                  const message: Message = { type: "set-shields", host, enabled: true, incognito: false };
                  await chrome.runtime.sendMessage(message);
                  await draw();
                },
              },
              "Turn Shields on",
            ),
          ),
        ),
      )
    : h("p", {}, "Shields is on for every site.");

  const meta = await fetch(chrome.runtime.getURL("rules/meta.json")).then((res) => res.json());
  const lists = Object.values(meta.lists) as Array<{ name: string; license: string; homepage: string }>;
  const rulesTotal = Object.values(meta.rulesets as Record<string, { rules: number }>).reduce((total, ruleset) => total + ruleset.rules, 0);
  const updated = new Date(meta.generated).toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" });

  page.replaceChildren(
    h("h1", {}, "Privacy settings"),
    section(
      "Fingerprinting protection",
      "Sites can tell browsers apart by reading technical details. This makes those details less useful for tracking you. No setting can make you impossible to track, and canvases in web workers are not covered.",
      radioGroup("fingerprinting", FINGERPRINT_CHOICES, settings.fingerprinting, (value) => void change({ fingerprinting: value })),
    ),
    section("WebRTC", "WebRTC powers video calls, and it can reveal network addresses to sites.", radioGroup("webrtc", WEBRTC_CHOICES, settings.webrtc, (value) => void change({ webrtc: value }))),
    section("Clear data when Orbit starts", "Each time Orbit starts, it deletes what you choose here.", clearBoxes),
    section("Delete old history automatically", "Runs when Orbit starts.", radioGroup("historyDays", historyChoices, settings.historyDays, (value) => void change({ historyDays: value }))),
    section("Sites with Shields off", null, siteList),
    section(
      "Blocking lists",
      `${rulesTotal.toLocaleString()} rules, updated ${updated}. New rules arrive with Orbit updates.`,
      h(
        "table",
        { class: "list-table" },
        h("thead", {}, h("tr", {}, h("th", {}, "List"), h("th", {}, "License"))),
        h("tbody", {}, ...lists.map((list) => h("tr", {}, h("td", {}, h("a", { href: list.homepage }, list.name)), h("td", {}, list.license)))),
      ),
    ),
    section(
      "More in browser settings",
      null,
      h(
        "div",
        { class: "options" },
        openBrowserPage("chrome://settings/security", "Secure DNS provider"),
        openBrowserPage("chrome://settings/cookies", "Third-party cookies"),
        openBrowserPage("chrome://settings/content", "Site permissions"),
        openBrowserPage("chrome://settings/clearBrowserData", "Delete browsing data now"),
      ),
    ),
  );
}

void chrome.storage.local.get(["settings"]).then(({ settings: dashboard }) => {
  const theme = (dashboard as { theme?: string } | undefined)?.theme;
  if (theme === "light" || theme === "dark" || theme === "space") document.documentElement.dataset.theme = theme;
});
void draw();
