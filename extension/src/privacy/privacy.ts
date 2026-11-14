// Orbit's privacy page: choices the browser's own settings do not offer, and links to those it does.

import { h } from "../newtab/dom.ts";
import { localizePage, t } from "../shared/i18n.ts";
import { CLEARABLE_DATA, HISTORY_DAYS, sanitizePrivacy, type ClearableData, type FingerprintLevel, type PrivacySettings, type WebRtcPolicy } from "../shared/privacy.ts";
import { resolveTheme } from "../shared/settings.ts";
import { normalizeHosts, type Message } from "../shared/shields.ts";

const page = document.getElementById("page")!;
const locale = () => chrome.i18n.getUILanguage();

const FINGERPRINT_CHOICES: Array<{ value: FingerprintLevel; label: string; detail: string }> = [
  { value: "standard", label: "fpStandard", detail: "fpStandardDetail" },
  { value: "strict", label: "fpStrict", detail: "fpStrictDetail" },
  { value: "off", label: "fpOff", detail: "fpOffDetail" },
];

const WEBRTC_CHOICES: Array<{ value: WebRtcPolicy; label: string; detail: string }> = [
  { value: "default_public_interface_only", label: "rtcHide", detail: "rtcHideDetail" },
  { value: "disable_non_proxied_udp", label: "rtcProxy", detail: "rtcProxyDetail" },
  { value: "default", label: "rtcDefault", detail: "rtcDefaultDetail" },
];

const CLEAR_LABELS: Record<ClearableData, string> = {
  cookies: "clearCookies",
  cache: "clearCache",
  history: "clearHistory",
  downloads: "clearDownloads",
  formData: "clearFormData",
};

function historyLabel(days: number): string {
  if (days === 0) return t("historyKeep");
  if (days === 365) return t("historyYear");
  return t("historyDays", days.toLocaleString(locale()));
}

function radioGroup<T extends string | number>(name: string, label: string, choices: Array<{ value: T; label: string; detail?: string }>, current: T, onChange: (value: T) => void): HTMLElement {
  return h(
    "div",
    { class: "choices", role: "radiogroup", "aria-label": label },
    ...choices.map((choice) =>
      h(
        "label",
        { class: "choice" },
        h("input", { type: "radio", name, value: String(choice.value), checked: choice.value === current, onchange: () => onChange(choice.value) }),
        h("span", { class: "choice-text" }, h("span", { class: "choice-label" }, choice.label), choice.detail ? h("small", {}, choice.detail) : null),
      ),
    ),
  );
}

async function save(settings: PrivacySettings): Promise<void> {
  const message: Message = { type: "set-privacy", settings };
  await chrome.runtime.sendMessage(message);
}

function section(title: string, description: string | null, ...content: HTMLElement[]): HTMLElement {
  return h("section", { class: "pane setting" }, h("h2", {}, title), description ? h("p", { class: "setting-detail" }, description) : null, ...content);
}

function browserLink(url: string, label: string): HTMLElement {
  return h("button", { type: "button", class: "row-link", onclick: () => void chrome.tabs.create({ url }) }, h("span", {}, label), h("span", { class: "chevron", "aria-hidden": "true" }));
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
    { class: "choices" },
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
      return h("label", { class: "choice" }, box, h("span", { class: "choice-label" }, t(CLEAR_LABELS[item])));
    }),
  );

  const historyChoices = HISTORY_DAYS.map((days) => ({ value: days as number, label: historyLabel(days) }));

  const siteList = sitesOff.length
    ? h(
        "div",
        { class: "site-list" },
        ...sitesOff.map((host) =>
          h(
            "div",
            { class: "site-row" },
            h("span", { dir: "ltr" }, host),
            h(
              "button",
              {
                type: "button",
                class: "button quiet",
                onclick: async () => {
                  const message: Message = { type: "set-shields", host, enabled: true, incognito: false };
                  await chrome.runtime.sendMessage(message);
                  await draw();
                },
              },
              t("turnShieldsOn"),
            ),
          ),
        ),
      )
    : h("p", { class: "notice" }, t("shieldsOnEverywhere"));

  const meta = await fetch(chrome.runtime.getURL("rules/meta.json")).then((res) => res.json());
  const lists = Object.values(meta.lists) as Array<{ name: string; license: string; homepage: string }>;
  const rulesTotal = Object.values(meta.rulesets as Record<string, { rules: number }>).reduce((total, ruleset) => total + ruleset.rules, 0);
  const updated = new Date(meta.generated).toLocaleDateString(locale(), { year: "numeric", month: "long", day: "numeric" });

  page.replaceChildren(
    h("header", { class: "page-head" }, h("img", { src: "../icons/orbit-48.png", alt: "", width: 40, height: 40 }), h("div", {}, h("h1", {}, t("privacyTitle")), h("p", { class: "notice" }, t("privacyIntro")))),
    section(t("fpTitle"), t("fpDetail"), radioGroup("fingerprinting", t("fpTitle"), FINGERPRINT_CHOICES.map((c) => ({ ...c, label: t(c.label), detail: t(c.detail) })), settings.fingerprinting, (value) => void change({ fingerprinting: value }))),
    section(t("rtcTitle"), t("rtcDetail"), radioGroup("webrtc", t("rtcTitle"), WEBRTC_CHOICES.map((c) => ({ ...c, label: t(c.label), detail: t(c.detail) })), settings.webrtc, (value) => void change({ webrtc: value }))),
    section(t("clearTitle"), t("clearDetail"), clearBoxes),
    section(t("historyTitle"), t("historyDetail"), radioGroup("historyDays", t("historyTitle"), historyChoices, settings.historyDays, (value) => void change({ historyDays: value }))),
    section(t("sitesOffTitle"), null, siteList),
    section(
      t("updatesTitle"),
      t("updatesDetail"),
      h(
        "div",
        { class: "choices" },
        h(
          "label",
          { class: "choice" },
          h("input", { type: "checkbox", name: "checkUpdates", checked: settings.checkUpdates, onchange: (event: Event) => void change({ checkUpdates: (event.target as HTMLInputElement).checked }) }),
          h("span", { class: "choice-label" }, t("updatesCheck")),
        ),
      ),
    ),
    section(
      t("listsTitle"),
      t("listsDetail", rulesTotal.toLocaleString(locale()), updated),
      h(
        "table",
        { class: "list-table" },
        h("thead", {}, h("tr", {}, h("th", {}, t("listName")), h("th", {}, t("listLicense")))),
        h("tbody", {}, ...lists.map((list) => h("tr", {}, h("td", {}, h("a", { href: list.homepage, dir: "auto" }, list.name)), h("td", { dir: "ltr" }, list.license)))),
      ),
    ),
    section(
      t("moreTitle"),
      null,
      h(
        "div",
        { class: "row-links" },
        browserLink("chrome://settings/security", t("moreDns")),
        browserLink("chrome://settings/cookies", t("moreCookies")),
        browserLink("chrome://settings/content", t("morePermissions")),
        browserLink("chrome://settings/clearBrowserData", t("moreClear")),
      ),
    ),
  );
}

const prefersDark = matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => {
  document.documentElement.dataset.theme = resolveTheme(prefersDark.matches);
};
prefersDark.addEventListener("change", applyTheme);
applyTheme();
localizePage();
void draw();
