// Dashboard page: background, layout, widgets and the Customize panel.

import { ALLOWED_SIZES, defaultLayout, moveWidget, sanitizeLayout, updateWidget, type Layout, type WidgetId, type WidgetSize } from "../shared/layout.ts";
import { localizePage, t } from "../shared/i18n.ts";
import { BACKGROUNDS, resolveTheme, sanitizeSettings, type Background, type Settings } from "../shared/settings.ts";
import { h, icon, iconButton } from "./dom.ts";
import { loadCustomMedia, MAX_MEDIA_BYTES, MEDIA_TYPES, removeCustomMedia, saveCustomMedia } from "./media-store.ts";
import { mountBookmarks, mountNotes, mountSearch, mountStats, mountWeather, type WidgetContext } from "./widgets.ts";

const DEFAULT_VIDEO = "media/blackhole.webm";
const DEFAULT_POSTER = "media/blackhole.jpg";
const VIDEO_SOURCE = "https://svs.gsfc.nasa.gov/13326/";

const WIDGET_NAMES: Record<WidgetId, string> = {
  search: "widgetSearch",
  stats: "widgetProtection",
  bookmarks: "widgetShortcuts",
  weather: "widgetWeather",
  notes: "widgetNotes",
};
const SIZE_NAMES: Record<WidgetSize, string> = { small: "sizeSmall", medium: "sizeMedium", large: "sizeLarge" };
const BACKGROUND_NAMES: Record<Background, string> = { default: "backgroundDefault", custom: "backgroundCustom", plain: "backgroundPlain" };
const DOCK = new Set<WidgetId>(["stats", "weather", "notes"]);

let settings: Settings;
let layout: Layout;
let customMedia: Blob | null = null;
let customUrl: string | null = null;
let customFailed = false;
let mediaNotice = "";

const root = document.documentElement;
const top = document.getElementById("top")!;
const searchSlot = document.getElementById("search")!;
const dock = document.getElementById("dock")!;
const credit = document.getElementById("credit")!;
const motion = document.getElementById("motion") as HTMLButtonElement;
const video = document.getElementById("backdrop-video") as HTMLVideoElement;
const image = document.getElementById("backdrop-image") as HTMLImageElement;
const drawer = document.getElementById("customize") as HTMLDialogElement;
const openButton = document.getElementById("open-customize") as HTMLButtonElement;
const prefersDark = matchMedia("(prefers-color-scheme: dark)");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

// Theme and background
function applyTheme(): void {
  root.dataset.theme = resolveTheme(prefersDark.matches);
  root.dataset.background = settings.background;
  try {
    localStorage.setItem("orbit-background", settings.background);
  } catch {
    // Only the first paint depends on this cache.
  }
}

const isVideo = (blob: Blob) => blob.type.startsWith("video/");

function setCustomMedia(blob: Blob | null): void {
  if (customUrl) URL.revokeObjectURL(customUrl);
  customMedia = blob;
  customUrl = blob ? URL.createObjectURL(blob) : null;
  customFailed = false;
}

function hasVideo(): boolean {
  return !video.hidden && Boolean(video.getAttribute("src"));
}

function syncPlayback(): void {
  motion.hidden = !hasVideo() || reducedMotion.matches;
  if (!hasVideo()) return;
  if (settings.videoPaused || reducedMotion.matches || document.hidden) video.pause();
  else void video.play().catch(() => {});
  const label = t(settings.videoPaused ? "playVideo" : "pauseVideo");
  motion.replaceChildren(icon(settings.videoPaused ? "play" : "pause"));
  motion.setAttribute("aria-label", label);
  motion.title = label;
}

function showVideo(src: string, poster: string | null): void {
  image.hidden = true;
  image.removeAttribute("src");
  video.hidden = false;
  if (poster) video.poster = poster;
  else video.removeAttribute("poster");
  if (video.getAttribute("src") !== src) video.src = src;
}

function showImage(src: string): void {
  video.pause();
  video.removeAttribute("src");
  video.hidden = true;
  image.hidden = false;
  image.src = src;
}

function showNoMedia(): void {
  video.pause();
  video.removeAttribute("src");
  video.hidden = true;
  image.hidden = true;
  image.removeAttribute("src");
}

function applyBackground(): void {
  credit.replaceChildren();
  if (settings.background === "plain") {
    showNoMedia();
  } else if (settings.background === "custom" && customMedia && customUrl && !customFailed) {
    if (isVideo(customMedia)) showVideo(customUrl, null);
    else showImage(customUrl);
  } else {
    showVideo(DEFAULT_VIDEO, DEFAULT_POSTER);
    credit.append(h("a", { href: VIDEO_SOURCE }, t("videoCredit")));
  }
  syncPlayback();
}

function customMediaFailed(): void {
  if (!customUrl || settings.background !== "custom") return;
  customFailed = true;
  mediaNotice = t("mediaUnplayable");
  applyBackground();
  if (drawer.open) drawDrawer();
}

async function saveSettings(patch: Partial<Settings>): Promise<void> {
  settings = sanitizeSettings({ ...settings, ...patch });
  await chrome.storage.local.set({ settings });
}

async function chooseBackground(background: Background): Promise<void> {
  mediaNotice = "";
  await saveSettings({ background });
  applyTheme();
  applyBackground();
  drawDrawer();
}

async function useFile(chosen: File): Promise<void> {
  if (!MEDIA_TYPES.includes(chosen.type)) {
    mediaNotice = t("mediaUnsupported");
  } else if (chosen.size > MAX_MEDIA_BYTES) {
    mediaNotice = t("mediaTooLarge");
  } else {
    try {
      await saveCustomMedia(chosen);
    } catch {
      mediaNotice = t("mediaNotSaved");
      drawDrawer();
      return;
    }
    setCustomMedia(chosen);
    await chooseBackground("custom");
    return;
  }
  drawDrawer();
}

const context: WidgetContext = { settings: () => settings, saveSettings, relayout: () => {} };

// Board
const MOUNT: Record<WidgetId, (frame: HTMLElement) => void> = {
  search: (frame) => mountSearch(frame),
  stats: (frame) => mountStats(frame, context),
  bookmarks: (frame) => mountBookmarks(frame, context),
  weather: (frame) => mountWeather(frame, context),
  notes: (frame) => mountNotes(frame),
};

function slotFor(id: WidgetId): HTMLElement {
  if (id === "search") return searchSlot;
  if (id === "bookmarks") return top;
  return dock;
}

function drawBoard(): void {
  top.replaceChildren();
  searchSlot.replaceChildren();
  dock.replaceChildren();
  for (const widget of layout.widgets) {
    const frame = h("div", { class: `widget size-${widget.size}`, "data-id": widget.id, role: "region", "aria-label": t(WIDGET_NAMES[widget.id]), hidden: !widget.visible });
    slotFor(widget.id).append(frame);
    if (widget.visible) {
      try {
        MOUNT[widget.id](frame);
      } catch (error) {
        console.error(`widget ${widget.id} failed`, error);
        frame.classList.add("pane");
        frame.textContent = t("widgetFailed", t(WIDGET_NAMES[widget.id]));
      }
    }
    if (DOCK.has(widget.id)) attachDrag(frame, widget.id);
  }
  dock.hidden = ![...dock.children].some((child) => !(child as HTMLElement).hidden);
}

function attachDrag(frame: HTMLElement, id: WidgetId): void {
  frame.addEventListener("dragstart", (event) => {
    if (!document.body.classList.contains("editing") || event.target !== frame) return;
    event.dataTransfer!.setData("application/x-orbit-widget", id);
    event.dataTransfer!.effectAllowed = "move";
    frame.classList.add("is-dragging");
  });
  frame.addEventListener("dragend", () => frame.classList.remove("is-dragging"));
  frame.addEventListener("dragover", (event) => {
    if (document.body.classList.contains("editing")) event.preventDefault();
  });
  frame.addEventListener("drop", (event) => {
    const moved = event.dataTransfer?.getData("application/x-orbit-widget") as WidgetId | undefined;
    if (!moved || moved === id) return;
    event.preventDefault();
    void setLayout(moveWidget(layout, moved, layout.widgets.findIndex((widget) => widget.id === id)));
  });
}

async function setLayout(next: Layout): Promise<void> {
  layout = next;
  await chrome.storage.local.set({ layout });
  drawBoard();
  markEditable(drawer.open);
  if (drawer.open) drawDrawer();
}

function markEditable(editing: boolean): void {
  document.body.classList.toggle("editing", editing);
  for (const frame of dock.querySelectorAll<HTMLElement>(".widget")) frame.draggable = editing;
}

/** Index of the next dock widget before or after this one, or -1 at either end. */
function dockNeighbor(id: WidgetId, step: -1 | 1): number {
  const order = layout.widgets.filter((widget) => DOCK.has(widget.id)).map((widget) => widget.id);
  const neighbor = order[order.indexOf(id) + step];
  return neighbor ? layout.widgets.findIndex((widget) => widget.id === neighbor) : -1;
}

// Customize panel
function backgroundThumb(background: Background): HTMLElement {
  const thumb = h("span", { class: "bg-thumb", "data-kind": background });
  if (background === "default") {
    thumb.append(h("img", { src: DEFAULT_POSTER, alt: "", decoding: "async" }));
  } else if (background === "custom" && customMedia && customUrl && !customFailed) {
    thumb.append(isVideo(customMedia) ? h("video", { src: `${customUrl}#t=0.1`, muted: true, playsinline: true, preload: "auto" }) : h("img", { src: customUrl, alt: "", decoding: "async" }));
  } else if (background === "custom") {
    thumb.append(icon("upload"));
  }
  thumb.append(h("span", { class: "bg-check" }, icon("check")));
  return thumb;
}

function toggleRow(label: string, input: HTMLInputElement, note?: string): HTMLElement {
  return h("label", { class: "toggle-row" }, h("span", {}, label, note ? h("small", {}, note) : null), input);
}

function drawDrawer(): void {
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.focusKey;
  const usable = Boolean(customMedia && !customFailed);

  const file = h("input", {
    type: "file",
    class: "visually-hidden",
    accept: MEDIA_TYPES.join(","),
    tabindex: "-1",
    "aria-hidden": "true",
    onchange: () => {
      const chosen = file.files?.[0];
      if (chosen) void useFile(chosen);
    },
  });

  const options = h(
    "div",
    { class: "bg-options", role: "group", "aria-label": t("background") },
    ...BACKGROUNDS.map((background) =>
      h(
        "button",
        {
          type: "button",
          class: "bg-option",
          "data-focus-key": `bg-${background}`,
          "aria-pressed": String(settings.background === background),
          onclick: () => {
            if (background === "custom" && !usable) file.click();
            else void chooseBackground(background);
          },
        },
        backgroundThumb(background),
        h("span", { class: "bg-label" }, t(BACKGROUND_NAMES[background])),
      ),
    ),
  );

  const clock = h("input", {
    type: "checkbox",
    class: "switch",
    "data-focus-key": "clock",
    checked: settings.showClock,
    onchange: async () => {
      await saveSettings({ showClock: clock.checked });
      applyClock();
    },
  });

  const playback = h("input", {
    type: "checkbox",
    class: "switch",
    "data-focus-key": "playback",
    checked: !settings.videoPaused && !reducedMotion.matches,
    disabled: reducedMotion.matches,
    onchange: async () => {
      await saveSettings({ videoPaused: !playback.checked });
      syncPlayback();
    },
  });

  const widgetList = h(
    "ul",
    { class: "widget-list" },
    ...layout.widgets.map((widget) => {
      const name = t(WIDGET_NAMES[widget.id]);
      const visible = h("input", {
        type: "checkbox",
        class: "switch",
        "data-focus-key": `${widget.id}-visible`,
        checked: widget.visible,
        onchange: () => void setLayout(updateWidget(layout, widget.id, { visible: visible.checked })),
      });
      const sizes = ALLOWED_SIZES[widget.id];
      const inDock = DOCK.has(widget.id);
      const size =
        inDock && sizes.length > 1
          ? h(
              "select",
              { "aria-label": t("widgetSize", name), "data-focus-key": `${widget.id}-size`, onchange: () => void setLayout(updateWidget(layout, widget.id, { size: size!.value as WidgetSize })) },
              ...sizes.map((option) => h("option", { value: option }, t(SIZE_NAMES[option]))),
            )
          : null;
      if (size) size.value = widget.size;
      const before = dockNeighbor(widget.id, -1);
      const after = dockNeighbor(widget.id, 1);
      return h(
        "li",
        {},
        h("label", {}, visible, h("span", {}, name)),
        size,
        inDock && iconButton("up", t("moveUp", name), () => void setLayout(moveWidget(layout, widget.id, before)), { disabled: before < 0, "data-focus-key": `${widget.id}-up` }),
        inDock && iconButton("down", t("moveDown", name), () => void setLayout(moveWidget(layout, widget.id, after)), { disabled: after < 0, "data-focus-key": `${widget.id}-down` }),
      );
    }),
  );

  drawer.replaceChildren(
    h("div", { class: "drawer-head" }, h("h2", { id: "customize-title" }, t("customize")), iconButton("close", t("close"), () => drawer.close(), { "data-focus-key": "close" })),
    h(
      "section",
      {},
      h("h3", {}, t("background")),
      options,
      file,
      h(
        "div",
        { class: "drawer-row" },
        h("button", { type: "button", class: "button quiet", "data-focus-key": "media-choose", onclick: () => file.click() }, icon("upload"), t("chooseMedia")),
        customMedia &&
          h(
            "button",
            {
              type: "button",
              class: "button quiet",
              "data-focus-key": "media-remove",
              onclick: async () => {
                await removeCustomMedia();
                setCustomMedia(null);
                await chooseBackground(settings.background === "custom" ? "default" : settings.background);
              },
            },
            t("removeMedia"),
          ),
      ),
      h("p", { class: "notice" }, t("mediaHint")),
      h("p", { class: "notice alert", role: "status" }, mediaNotice),
    ),
    h("section", {}, toggleRow(t("showClock"), clock), toggleRow(t("playVideoSetting"), playback, reducedMotion.matches ? t("reducedMotionNote") : undefined)),
    h(
      "section",
      {},
      h("h3", {}, t("browserTheme")),
      h("p", { class: "notice" }, t("browserThemeExplained")),
      h("button", { type: "button", class: "button quiet", "data-focus-key": "theme", onclick: () => void chrome.tabs.update({ url: "chrome://settings/appearance" }) }, t("openThemeSettings")),
    ),
    h(
      "section",
      {},
      h("h3", {}, t("widgets")),
      widgetList,
      h("p", { class: "notice" }, t("dragHint")),
      h("button", { type: "button", class: "link", "data-focus-key": "restore", onclick: () => void setLayout(defaultLayout()) }, t("restoreLayout")),
    ),
  );
  if (focused) drawer.querySelector<HTMLElement>(`[data-focus-key="${focused}"]`)?.focus();
}

async function openDrawer(): Promise<void> {
  if (!customMedia) setCustomMedia(await loadCustomMedia());
  drawDrawer();
  drawer.show();
  openButton.setAttribute("aria-expanded", "true");
  markEditable(true);
  drawer.querySelector<HTMLElement>(".bg-option[aria-pressed='true']")?.focus();
}

// Clock
const timeElement = document.getElementById("time") as HTMLTimeElement;

function applyClock(): void {
  timeElement.hidden = !settings.showClock;
}

function tick(): void {
  const now = new Date();
  const locale = chrome.i18n.getUILanguage();
  timeElement.dateTime = now.toISOString();
  const parts = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).formatToParts(now);
  timeElement.replaceChildren(
    h(
      "span",
      { class: "time" },
      ...parts.map((part) => (part.type === "dayPeriod" ? h("span", { class: "period" }, part.value) : part.type === "literal" && /^\s+$/.test(part.value) ? "" : part.value)),
    ),
    h("span", { class: "date" }, now.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" })),
  );
  setTimeout(tick, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
}

async function main(): Promise<void> {
  localizePage();
  const stored = await chrome.storage.local.get(["settings", "layout"]);
  settings = sanitizeSettings(stored.settings);
  layout = sanitizeLayout(stored.layout);
  applyTheme();
  applyClock();
  tick();
  if (settings.background === "custom") setCustomMedia(await loadCustomMedia());
  video.addEventListener("error", () => {
    if (customUrl && video.getAttribute("src") === customUrl) customMediaFailed();
  });
  image.addEventListener("error", () => {
    if (customUrl && image.getAttribute("src") === customUrl) customMediaFailed();
  });
  applyBackground();
  drawBoard();
  prefersDark.addEventListener("change", applyTheme);
  reducedMotion.addEventListener("change", () => {
    syncPlayback();
    if (drawer.open) drawDrawer();
  });
  document.addEventListener("visibilitychange", syncPlayback);
  motion.addEventListener("click", async () => {
    await saveSettings({ videoPaused: !settings.videoPaused });
    syncPlayback();
    if (drawer.open) drawDrawer();
  });
  openButton.addEventListener("click", () => {
    if (drawer.open) drawer.close();
    else void openDrawer();
  });
  drawer.addEventListener("close", () => {
    markEditable(false);
    openButton.setAttribute("aria-expanded", "false");
    openButton.focus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && drawer.open) drawer.close();
  });
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local" || !changes.settings) return;
    const next = sanitizeSettings(changes.settings.newValue);
    const backgroundChanged = next.background !== settings.background;
    settings = next;
    applyTheme();
    applyClock();
    if (backgroundChanged) {
      setCustomMedia(await loadCustomMedia());
      applyBackground();
    } else {
      syncPlayback();
    }
  });
}

void main();
