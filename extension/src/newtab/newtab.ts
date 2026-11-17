// Dashboard page: background, layout, widgets and the Customize dialog.

import { defaultLayout, moveWidget, sanitizeLayout, updateWidget, type Layout, type WidgetId, type WidgetSize } from "../shared/layout.ts";
import { localizePage, t } from "../shared/i18n.ts";
import {
  CLOCK_FORMATS,
  COLOR_IDS,
  COLORS,
  ENGINE_KEYWORDS,
  engineForKeyword,
  resolveTheme,
  sanitizeSettings,
  SEARCH_ENGINE_IDS,
  TOP_SITES_MODES,
  type Background,
  type ClockFormat,
  type ColorId,
  type SearchEngine,
  type Settings,
  type TopSitesMode,
} from "../shared/settings.ts";
import { currentItem, DEFAULT_ITEM, GALLERY_CATEGORIES, itemsIn, playsVideo, sanitizeGallery, thumbnailOf, type Gallery, type GalleryCategory, type GalleryItem, type GalleryMotion } from "../shared/gallery.ts";
import { h, icon, iconButton } from "./dom.ts";
import { loadCustomMedia, loadGalleryMedia, MAX_MEDIA_BYTES, MEDIA_TYPES, removeCustomMedia, saveCustomMedia, saveGalleryMedia, type GallerySlot } from "./media-store.ts";
import { ENGINE_NAMES, mountBookmarks, mountNotes, mountSearch, mountStats, mountWeather, type WidgetContext } from "./widgets.ts";
import { installContextMenu } from "./context-menu.ts";
import { isNewer, runningVersion, sanitizeRelease } from "../shared/updates.ts";
import { browserEngine, browserStartup, canSetBrowserEngine, setBrowserEngine, setBrowserStartup, startupUrl, type StartupMode, type StartupSettings } from "../shared/search.ts";

const DEFAULT_VIDEO = DEFAULT_ITEM.video!;
const DEFAULT_POSTER = DEFAULT_ITEM.poster;

const WIDGET_NAMES: Record<WidgetId, string> = {
  search: "widgetSearch",
  stats: "widgetProtection",
  bookmarks: "widgetShortcuts",
  weather: "widgetWeather",
  notes: "widgetNotes",
};
// Widgets always take their standard size.
const WIDGET_SIZE = Object.fromEntries(defaultLayout().widgets.map((widget) => [widget.id, widget.size])) as Record<WidgetId, WidgetSize>;
/** The background cards. "colors" stands for a color, a gradient or Orbit's plain surface. */
const BACKGROUND_CARDS = ["gallery", "colors", "custom"] as const;
type BackgroundCard = (typeof BACKGROUND_CARDS)[number];
const BACKGROUND_NAMES: Record<BackgroundCard, string> = { gallery: "backgroundGallery", colors: "backgroundColors", custom: "backgroundCustom" };
const cardOf = (background: Background): BackgroundCard => (background === "color" || background === "plain" ? "colors" : background === "custom" ? "custom" : "gallery");
const GALLERY_NAMES: Record<GalleryCategory | "all", string> = {
  all: "galleryAll",
  summer: "gallerySummer",
  animals: "galleryAnimals",
  space: "gallerySpace",
  travel: "galleryTravel",
  love: "galleryLove",
  sport: "gallerySport",
  people: "galleryPeople",
  city: "galleryCity",
  things: "galleryThings",
  nature: "galleryNature",
  christmas: "galleryChristmas",
  abstractions: "galleryAbstractions",
};
const COLOR_NAMES: Record<ColorId, string> = {
  graphite: "colorGraphite",
  midnight: "colorMidnight",
  ocean: "colorOcean",
  forest: "colorForest",
  wine: "colorWine",
  slate: "colorSlateGray",
  aurora: "colorAurora",
  nebula: "colorNebula",
  ember: "colorEmber",
  lagoon: "colorLagoon",
  dusk: "colorDusk",
  orchid: "colorOrchid",
};
const CLOCK_FORMAT_NAMES: Record<ClockFormat, string> = { auto: "clockAuto", "12": "clock12", "24": "clock24" };
const TOP_SITES_NAMES: Record<TopSitesMode, [string, string]> = {
  favorites: ["topSitesFavorites", "topSitesFavoritesNote"],
  frequent: ["topSitesFrequent", "topSitesFrequentNote"],
};
const DOCK = new Set<WidgetId>(["stats", "weather", "notes"]);

const SECTIONS = ["background", "clock", "search", "layout", "startup", "theme"] as const;
type Section = (typeof SECTIONS)[number];
const SECTION_NAMES: Record<Section, string> = {
  background: "background",
  clock: "sectionClock",
  search: "sectionSearch",
  layout: "widgets",
  startup: "sectionStartup",
  theme: "sectionTheme",
};
const SECTION_ICONS: Record<Section, string> = { background: "image", clock: "clock", search: "search", layout: "grid", startup: "power", theme: "palette" };

let settings: Settings;
let layout: Layout;
let customMedia: Blob | null = null;
let customUrl: string | null = null;
let customFailed = false;
let mediaNotice = "";
let engineNotice = "";
let startup: StartupSettings | null = null;
let startupNotice = "";
let colorsOpen = false;
let section: Section = "background";

const root = document.documentElement;
const top = document.getElementById("top")!;
const searchSlot = document.getElementById("search")!;
const dock = document.getElementById("dock")!;
const credit = document.getElementById("credit")!;
const motion = document.getElementById("motion") as HTMLButtonElement;
const video = document.getElementById("backdrop-video") as HTMLVideoElement;
const image = document.getElementById("backdrop-image") as HTMLImageElement;
const customize = document.getElementById("customize") as HTMLDialogElement;
const openButton = document.getElementById("open-customize") as HTMLButtonElement;
const prefersDark = matchMedia("(prefers-color-scheme: dark)");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

// Theme and background
function applyTheme(): void {
  root.dataset.theme = resolveTheme(prefersDark.matches);
  root.dataset.background = settings.background;
  const color = COLORS[settings.color];
  if (settings.background === "color") root.style.setProperty("--backdrop-color", color);
  else root.style.removeProperty("--backdrop-color");
  try {
    localStorage.setItem("orbit-background", settings.background);
    localStorage.setItem("orbit-color", color);
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

// The part of the video that plays, for gallery videos with a title card or a closing logo.
let clip: { start: number; end: number } | null = null;

function keepInClip(): void {
  if (!clip) return;
  if (video.currentTime < clip.start - 0.25 || video.currentTime >= clip.end) video.currentTime = clip.start;
}

video.addEventListener("loadedmetadata", keepInClip);
video.addEventListener("timeupdate", keepInClip);

function showVideo(src: string, poster: string | null, range: { start?: number; end?: number } = {}): void {
  clip = range.start !== undefined && range.end !== undefined ? { start: range.start, end: range.end } : null;
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

// Orbit Gallery
let gallery: Gallery | null = null;
let galleryUrls: string[] = [];
let galleryRun = 0;
let galleryNotice = "";

async function loadGallery(): Promise<Gallery> {
  gallery ??= await fetch("gallery.json")
    .then((response) => response.json())
    .then(sanitizeGallery)
    .catch(() => sanitizeGallery(null));
  return gallery;
}

function creditFor(item: GalleryItem): HTMLElement {
  const text = item.local ? t("videoBy", item.author) : t(item.video ? "galleryVideoCredit" : "galleryCredit", item.author, item.license);
  return h("a", { href: item.page }, text);
}

async function galleryBlob(slot: GallerySlot, src: string): Promise<Blob> {
  const cached = await loadGalleryMedia(slot, src);
  if (cached) return cached;
  const response = await fetch(src, { credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error(`${slot} ${response.status}`);
  const blob = await response.blob();
  await saveGalleryMedia(slot, src, blob);
  return blob;
}

function keepGalleryUrls(urls: string[]): void {
  for (const url of galleryUrls) if (!urls.includes(url)) URL.revokeObjectURL(url);
  galleryUrls = urls;
}

/** Shows today's or the chosen item: its still frame first, then its video once downloaded. */
async function showGallery(): Promise<void> {
  const run = ++galleryRun;
  const stale = () => run !== galleryRun || settings.background !== "gallery";
  const item = currentItem(await loadGallery(), settings.galleryCategory, settings.galleryChoice, Date.now()) ?? DEFAULT_ITEM;
  if (stale()) return;
  credit.replaceChildren(creditFor(item));
  if (item.local) {
    keepGalleryUrls([]);
    if (playsVideo(item, settings.galleryMotion)) showVideo(item.video, item.poster);
    else showImage(item.poster);
    syncPlayback();
    return;
  }
  let still: string | null = null;
  try {
    const stillBlob = await galleryBlob("gallery-still", item.poster);
    if (stale()) return;
    still = URL.createObjectURL(stillBlob);
    keepGalleryUrls([still]);
    showImage(still);
    syncPlayback();
    if (playsVideo(item, settings.galleryMotion)) {
      const videoBlob = await galleryBlob("gallery-video", item.video);
      if (stale()) return;
      const clipUrl = URL.createObjectURL(videoBlob);
      keepGalleryUrls([still, clipUrl]);
      showVideo(clipUrl, still, item);
      syncPlayback();
    }
    galleryNotice = "";
  } catch {
    if (stale()) return;
    galleryNotice = t("galleryFailed");
    if (!still) {
      showVideo(DEFAULT_VIDEO, DEFAULT_POSTER);
      credit.replaceChildren(creditFor(DEFAULT_ITEM));
      syncPlayback();
    }
    if (customize.open) drawCustomize();
  }
}

function applyBackground(): void {
  credit.replaceChildren();
  if (settings.background === "plain" || settings.background === "color") {
    showNoMedia();
  } else if (settings.background === "gallery") {
    void showGallery();
  } else if (settings.background === "custom" && customMedia && customUrl && !customFailed) {
    if (isVideo(customMedia)) showVideo(customUrl, null);
    else showImage(customUrl);
  } else {
    showVideo(DEFAULT_VIDEO, DEFAULT_POSTER);
    credit.append(creditFor(DEFAULT_ITEM));
  }
  syncPlayback();
}

function customMediaFailed(): void {
  if (!customUrl || settings.background !== "custom") return;
  customFailed = true;
  mediaNotice = t("mediaUnplayable");
  applyBackground();
  if (customize.open) drawCustomize();
}

async function saveSettings(patch: Partial<Settings>): Promise<void> {
  settings = sanitizeSettings({ ...settings, ...patch });
  await chrome.storage.local.set({ settings });
}

async function chooseBackground(background: Background, color?: ColorId): Promise<void> {
  mediaNotice = "";
  await saveSettings(color ? { background, color } : { background });
  applyTheme();
  applyBackground();
  drawCustomize();
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
      drawCustomize();
      return;
    }
    setCustomMedia(chosen);
    await chooseBackground("custom");
    return;
  }
  drawCustomize();
}

const context: WidgetContext = { settings: () => settings, saveSettings, relayout: () => {} };

// Board
const MOUNT: Record<WidgetId, (frame: HTMLElement) => void> = {
  search: (frame) => mountSearch(frame, context),
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
    const frame = h("div", { class: `widget size-${WIDGET_SIZE[widget.id]}`, "data-id": widget.id, role: "region", "aria-label": t(WIDGET_NAMES[widget.id]), hidden: !widget.visible });
    slotFor(widget.id).append(frame);
    if (!widget.visible) continue;
    try {
      MOUNT[widget.id](frame);
    } catch (error) {
      console.error(`widget ${widget.id} failed`, error);
      frame.classList.add("pane");
      frame.textContent = t("widgetFailed", t(WIDGET_NAMES[widget.id]));
    }
  }
  dock.hidden = ![...dock.children].some((child) => !(child as HTMLElement).hidden);
}

async function setLayout(next: Layout): Promise<void> {
  layout = next;
  await chrome.storage.local.set({ layout });
  drawBoard();
  if (customize.open) drawCustomize();
}

async function setBoardSetting(patch: Partial<Settings>): Promise<void> {
  await saveSettings(patch);
  drawBoard();
  drawCustomize();
}

/** Index of the next dock widget before or after this one, or -1 at either end. */
function dockNeighbor(id: WidgetId, step: -1 | 1): number {
  const order = layout.widgets.filter((widget) => DOCK.has(widget.id)).map((widget) => widget.id);
  const neighbor = order[order.indexOf(id) + step];
  return neighbor ? layout.widgets.findIndex((widget) => widget.id === neighbor) : -1;
}

const isVisible = (id: WidgetId) => layout.widgets.find((widget) => widget.id === id)?.visible ?? false;

// Customize dialog: parts
function toggleRow(label: string, input: HTMLInputElement, note?: string): HTMLElement {
  return h("label", { class: "toggle-row" }, h("span", {}, label, note ? h("small", {}, note) : null), input);
}

function switchInput(key: string, checked: boolean, onChange: (checked: boolean) => void, disabled = false): HTMLInputElement {
  const input = h("input", { type: "checkbox", class: "switch", role: "switch", "data-focus-key": key, checked, disabled });
  input.addEventListener("change", () => onChange(input.checked));
  return input;
}

/** A set of choices drawn as cards, one of which is picked. */
function choiceGroup<T extends string>(
  name: string,
  label: string,
  options: ReadonlyArray<{ value: T; title: string; note?: string; preview?: HTMLElement; icon?: Element }>,
  current: T,
  onChange: (value: T) => void,
): HTMLElement {
  const withPreviews = options.some((option) => option.preview);
  return h(
    "div",
    { class: withPreviews ? "choices with-previews" : "choices", role: "radiogroup", "aria-label": label },
    ...options.map((option) => {
      const input = h("input", { type: "radio", name, value: option.value, checked: option.value === current, "data-focus-key": `${name}-${option.value}` });
      input.addEventListener("change", () => input.checked && onChange(option.value));
      return h(
        "label",
        { class: "choice" },
        option.preview ?? null,
        h("span", { class: "choice-line" }, input, option.icon ? h("span", { class: "choice-icon" }, option.icon) : null, h("span", { class: "choice-text" }, h("span", {}, option.title), option.note ? h("small", {}, option.note) : null)),
      );
    }),
  );
}

/** A small drawing of the shortcuts row: rows of site circles, with a badge for where they come from. */
function sitesPreview(rows: 1 | 2, badge?: "star" | "clock"): HTMLElement {
  const circles = (count: number) => h("span", { class: "preview-row" }, ...Array.from({ length: count }, () => h("span", { class: "preview-site" })));
  return h(
    "span",
    { class: "choice-preview", "aria-hidden": "true" },
    circles(5),
    rows === 2 ? circles(5) : null,
    badge ? h("span", { class: "preview-badge" }, icon(badge === "star" ? "star" : "history")) : null,
  );
}

function backgroundThumb(card: BackgroundCard): HTMLElement {
  const thumb = h("span", { class: "bg-thumb", "data-kind": card });
  if (card === "custom" && customMedia && customUrl && !customFailed) {
    thumb.append(isVideo(customMedia) ? h("video", { src: `${customUrl}#t=0.1`, muted: true, playsinline: true, preload: "auto" }) : h("img", { src: customUrl, alt: "", decoding: "async" }));
  } else if (card === "custom") {
    thumb.append(icon("upload"));
  } else if (card === "colors") {
    if (settings.background === "plain") thumb.dataset.plain = "";
    else thumb.style.setProperty("--swatch", COLORS[settings.color]);
  } else {
    const today = gallery ? currentItem(gallery, settings.galleryCategory, settings.galleryChoice, Date.now()) : null;
    thumb.append(today ? h("img", { src: thumbnailOf(today, 330), alt: "", decoding: "async" }) : icon("image"));
  }
  thumb.append(h("span", { class: "bg-check" }, icon("check")));
  return thumb;
}

/** Whether the background shown now is a video, so pausing it means something. */
function backgroundHasVideo(): boolean {
  if (settings.background === "custom") return Boolean(customMedia && customUrl && !customFailed && isVideo(customMedia));
  if (settings.background !== "gallery") return false;
  const item = (gallery && currentItem(gallery, settings.galleryCategory, settings.galleryChoice, Date.now())) ?? DEFAULT_ITEM;
  return playsVideo(item, settings.galleryMotion);
}

/** Orbit Gallery: a category, a new video each day or one the person picks, and live or still. */
function gallerySection(): HTMLElement[] {
  if (!gallery) return [h("p", { class: "notice" }, t("galleryLoading"))];
  const current = gallery;
  const chips = h(
    "div",
    { class: "gallery-chips", role: "radiogroup", "aria-label": t("galleryCategory") },
    ...(["all", ...GALLERY_CATEGORIES] as const).map((id) =>
      h(
        "button",
        {
          type: "button",
          role: "radio",
          class: "gallery-chip",
          "aria-checked": String(settings.galleryCategory === id),
          "data-focus-key": `gallery-${id}`,
          onclick: async () => {
            await saveSettings({ galleryCategory: id, galleryChoice: "daily" });
            applyBackground();
            drawCustomize();
          },
        },
        t(GALLERY_NAMES[id]),
      ),
    ),
  );
  const daily = switchInput("gallery-daily", settings.galleryChoice === "daily", async (checked) => {
    const first = itemsIn(current, settings.galleryCategory)[0];
    await saveSettings({ galleryChoice: checked || !first ? "daily" : first.page });
    applyBackground();
    drawCustomize();
  });
  const chosen = settings.galleryChoice === "daily" ? null : settings.galleryChoice;
  const grid = h(
    "div",
    { class: "gallery-grid" },
    ...itemsIn(current, settings.galleryCategory).map((picture) =>
      h(
        "button",
        {
          type: "button",
          class: "gallery-item",
          "aria-pressed": String(picture.page === chosen),
          "aria-label": picture.title,
          title: picture.title,
          "data-focus-key": `pic-${picture.page}`,
          onclick: async () => {
            await saveSettings({ background: "gallery", galleryChoice: picture.page });
            applyBackground();
            drawCustomize();
          },
        },
        h("img", { src: thumbnailOf(picture), alt: "", loading: "lazy", decoding: "async" }),
        h("span", { class: "bg-check" }, icon("check")),
      ),
    ),
  );
  const motions: Array<{ value: GalleryMotion; title: string; note?: string }> = [
    { value: "video", title: t("galleryLive"), note: t("galleryLiveNote") },
    { value: "still", title: t("galleryStill"), note: t("galleryStillNote") },
  ];
  const motion = choiceGroup("gallery-motion", t("galleryMotion"), motions, settings.galleryMotion, async (galleryMotion) => {
    await saveSettings({ galleryMotion });
    applyBackground();
    drawCustomize();
  });
  motion.classList.add("choices-row");
  return [
    h("h3", {}, t("backgroundGallery")),
    chips,
    h("div", { class: "group" }, toggleRow(t("galleryDaily"), daily, t("galleryDailyNote"))),
    motion,
    grid,
    h("p", { class: "notice alert", role: "status" }, galleryNotice),
    h("p", { class: "notice" }, t("gallerySource")),
  ];
}

// Customize dialog: sections
function colorsSection(): HTMLElement[] {
  const swatch = (label: string, pressed: boolean, choose: () => void, paint: (element: HTMLElement) => void, key: string) => {
    const element = h(
      "button",
      { type: "button", class: "color-option", "data-focus-key": key, "aria-pressed": String(pressed), "aria-label": label, title: label, onclick: choose },
      h("span", { class: "bg-check" }, icon("check")),
    );
    paint(element);
    return element;
  };
  return [
    h("h3", {}, t("backgroundColors")),
    h(
      "div",
      { class: "color-options", role: "group", "aria-label": t("backgroundColors") },
      swatch(t("backgroundPlain"), settings.background === "plain", () => void chooseBackground("plain"), (element) => (element.dataset.plain = ""), "color-plain"),
      ...COLOR_IDS.map((color) =>
        swatch(
          t(COLOR_NAMES[color]),
          settings.background === "color" && settings.color === color,
          () => void chooseBackground("color", color),
          (element) => element.style.setProperty("--swatch", COLORS[color]),
          `color-${color}`,
        ),
      ),
    ),
  ];
}

function backgroundSection(): HTMLElement[] {
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
  const current = cardOf(settings.background);
  const open: BackgroundCard = colorsOpen ? "colors" : current;
  const cards = h(
    "div",
    { class: "bg-options", role: "group", "aria-label": t("background") },
    ...BACKGROUND_CARDS.map((card) =>
      h(
        "button",
        {
          type: "button",
          class: "bg-option",
          "data-focus-key": `bg-${card}`,
          "aria-pressed": String(current === card),
          onclick: () => {
            colorsOpen = card === "colors";
            if (card === "custom" && !usable) file.click();
            else if (card === "colors") {
              if (current === "colors") drawCustomize();
              else void chooseBackground("color", settings.color);
            } else void chooseBackground(card);
          },
        },
        backgroundThumb(card),
        h("span", { class: "bg-label" }, t(BACKGROUND_NAMES[card])),
      ),
    ),
  );
  const parts: Array<HTMLElement | false> = [cards, file];
  if (backgroundHasVideo()) {
    const playback = switchInput("playback", !settings.videoPaused && !reducedMotion.matches, async (checked) => {
      await saveSettings({ videoPaused: !checked });
      syncPlayback();
    }, reducedMotion.matches);
    parts.push(h("div", { class: "group" }, toggleRow(t("playVideoSetting"), playback, reducedMotion.matches ? t("reducedMotionNote") : undefined)));
  }
  if (open === "custom") {
    parts.push(
      h(
        "div",
        { class: "drawer-row" },
        h("button", { type: "button", class: "button quiet", "data-focus-key": "media-choose", onclick: () => file.click() }, icon("upload"), t("chooseMedia")),
        customMedia
          ? h(
              "button",
              {
                type: "button",
                class: "button quiet",
                "data-focus-key": "media-remove",
                onclick: async () => {
                  await removeCustomMedia();
                  setCustomMedia(null);
                  await chooseBackground(settings.background === "custom" ? "gallery" : settings.background);
                },
              },
              t("removeMedia"),
            )
          : false,
      ),
      h("p", { class: "notice" }, t("mediaHint")),
    );
  }
  parts.push(h("p", { class: "notice alert", role: "status" }, mediaNotice));
  if (open === "gallery") parts.push(...gallerySection());
  if (open === "colors") parts.push(...colorsSection());
  return parts.filter((part): part is HTMLElement => Boolean(part));
}

function clockSection(): HTMLElement[] {
  return [
    h(
      "div",
      { class: "group" },
      toggleRow(t("showClock"), switchInput("clock", settings.showClock, async (checked) => {
        await saveSettings({ showClock: checked });
        applyClock();
        tick();
      })),
      toggleRow(t("showDate"), switchInput("date", settings.showDate, async (checked) => {
        await saveSettings({ showDate: checked });
        applyClock();
        tick();
      })),
    ),
    h("h3", {}, t("clockFormat")),
    choiceGroup("clock-format", t("clockFormat"), CLOCK_FORMATS.map((value) => ({ value, title: t(CLOCK_FORMAT_NAMES[value]) })), settings.clockFormat, async (clockFormat) => {
      await saveSettings({ clockFormat });
      tick();
    }),
  ];
}

/** The engine for the new tab's search box, which is also the browser's search engine. */
async function chooseEngine(engine: SearchEngine): Promise<void> {
  if (engine === "default") return;
  const applied = canSetBrowserEngine() ? await setBrowserEngine(ENGINE_KEYWORDS[engine]) : true;
  engineNotice = applied ? "" : t("engineNotSet");
  await setBoardSetting({ searchEngine: engine });
}

function searchSection(): HTMLElement[] {
  const engines = SEARCH_ENGINE_IDS.filter((value): value is Exclude<SearchEngine, "default"> => value !== "default").map((value) => ({
    value,
    title: ENGINE_NAMES[value],
    icon: h("img", { src: `engines/${value}.png`, alt: "", width: 20, height: 20 }),
  }));
  return [
    h("div", { class: "group" }, toggleRow(t("showSearch"), switchInput("search-visible", isVisible("search"), (checked) => void setLayout(updateWidget(layout, "search", { visible: checked }))))),
    h("h3", {}, t("searchEngine")),
    choiceGroup("engine", t("searchEngine"), engines, settings.searchEngine as Exclude<SearchEngine, "default">, (searchEngine) => void chooseEngine(searchEngine)),
    h("p", { class: "notice alert", role: "status" }, engineNotice),
  ];
}

/** Shortcuts and the widgets docked at the bottom of the page. */
function layoutSection(): HTMLElement[] {
  const hidden = settings.hiddenSites.length;
  const list = h(
    "ul",
    { class: "widget-list" },
    ...layout.widgets
      .filter((widget) => DOCK.has(widget.id))
      .map((widget) => {
        const name = t(WIDGET_NAMES[widget.id]);
        const visible = switchInput(`${widget.id}-visible`, widget.visible, (checked) => void setLayout(updateWidget(layout, widget.id, { visible: checked })));
        const before = dockNeighbor(widget.id, -1);
        const after = dockNeighbor(widget.id, 1);
        return h(
          "li",
          {},
          h("label", {}, visible, h("span", {}, name)),
          iconButton("up", t("moveUp", name), () => void setLayout(moveWidget(layout, widget.id, before)), { disabled: before < 0, "data-focus-key": `${widget.id}-up` }),
          iconButton("down", t("moveDown", name), () => void setLayout(moveWidget(layout, widget.id, after)), { disabled: after < 0, "data-focus-key": `${widget.id}-down` }),
        );
      }),
  );
  const parts: HTMLElement[] = [
    h("h3", {}, t("widgetShortcuts")),
    h("div", { class: "group" }, toggleRow(t("showTopSites"), switchInput("top-visible", isVisible("bookmarks"), (checked) => void setLayout(updateWidget(layout, "bookmarks", { visible: checked }))))),
    h("h3", {}, t("topSitesShow")),
    choiceGroup("top-mode", t("topSitesShow"), TOP_SITES_MODES.map((value) => ({ value, title: t(TOP_SITES_NAMES[value][0]), note: t(TOP_SITES_NAMES[value][1]), preview: sitesPreview(1, value === "favorites" ? "star" : "clock") })), settings.topSitesMode, (topSitesMode) => void setBoardSetting({ topSitesMode })),
    h("h3", {}, t("topSitesRows")),
    choiceGroup("top-rows", t("topSitesRows"), [{ value: "1", title: t("oneRow"), preview: sitesPreview(1) }, { value: "2", title: t("twoRows"), preview: sitesPreview(2) }], String(settings.shortcutRows) as "1" | "2", (rows) => void setBoardSetting({ shortcutRows: rows === "2" ? 2 : 1 })),
  ];
  if (hidden > 0 && settings.topSitesMode === "frequent") {
    parts.push(h("button", { type: "button", class: "button quiet", "data-focus-key": "unhide", onclick: () => void setBoardSetting({ hiddenSites: [] }) }, t("showHiddenSites", hidden)));
  }
  parts.push(h("h3", {}, t("widgetsDocked")), list, h("button", { type: "button", class: "link", "data-focus-key": "restore", onclick: () => void setLayout(defaultLayout()) }, t("restoreLayout")));
  return parts;
}

const STARTUP_MODES: readonly StartupMode[] = ["newTab", "restore", "pages"];
const STARTUP_NAMES: Record<StartupMode, string> = { newTab: "startupNewTab", restore: "startupRestore", pages: "startupPages" };

async function saveStartup(next: StartupSettings): Promise<void> {
  const saved = await setBrowserStartup(next);
  startupNotice = saved ? "" : t("startupNotSet");
  startup = (await browserStartup()) ?? (saved ? next : startup);
  drawCustomize();
}

/** What opens when Orbit starts, the same choice as Settings > On startup. */
function startupSection(): HTMLElement[] {
  const settingsLink = h("button", { type: "button", class: "link", "data-focus-key": "startup-settings", onclick: () => void chrome.tabs.update({ url: "chrome://settings/onStartup" }) }, t("startupMore"));
  if (!startup) return [h("p", { class: "notice lead" }, t("startupUnavailable")), settingsLink];
  const current = startup;
  const parts: HTMLElement[] = [
    h("h3", {}, t("startupHeading")),
    choiceGroup("startup", t("startupHeading"), STARTUP_MODES.map((value) => ({ value, title: t(STARTUP_NAMES[value]) })), current.mode, (mode) => void saveStartup({ ...current, mode })),
  ];
  if (current.managed) {
    for (const input of parts[1]!.querySelectorAll("input")) input.disabled = true;
    parts.push(h("p", { class: "notice" }, t("startupManaged")));
  }
  if (current.mode === "pages") {
    const list = h(
      "ul",
      { class: "widget-list startup-pages" },
      ...current.urls.map((url, index) =>
        h(
          "li",
          {},
          h("span", { class: "startup-url", dir: "ltr", title: url }, url),
          current.managed ? null : iconButton("trash", t("startupRemove", url), () => void saveStartup({ ...current, urls: current.urls.filter((_, i) => i !== index) }), { "data-focus-key": `startup-remove-${index}` }),
        ),
      ),
    );
    parts.push(h("h3", {}, t("startupPagesHeading")));
    if (current.urls.length === 0) parts.push(h("p", { class: "notice" }, t("startupNoPages")));
    else parts.push(list);
    if (!current.managed) {
      const field = h("input", { type: "url", "data-focus-key": "startup-new", placeholder: t("startupAddPlaceholder"), "aria-label": t("startupAdd"), dir: "ltr" });
      const add = async () => {
        const url = startupUrl(field.value);
        if (!url) {
          startupNotice = t("startupBadUrl");
          drawCustomize();
          return;
        }
        await saveStartup({ ...current, urls: [...current.urls.filter((item) => item !== url), url] });
      };
      field.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void add();
        }
      });
      const useOpen = async () => {
        const tabs = await chrome.tabs.query({});
        const urls = [...new Set(tabs.map((tab) => tab.url ?? "").filter((url) => /^https?:/.test(url)))];
        await saveStartup({ ...current, urls });
      };
      parts.push(
        h("form", { class: "drawer-row startup-add", onsubmit: (event: Event) => event.preventDefault() }, field, h("button", { type: "button", class: "button quiet", "data-focus-key": "startup-add", onclick: () => void add() }, icon("plus"), t("startupAdd"))),
        h("button", { type: "button", class: "button quiet", "data-focus-key": "startup-open", onclick: () => void useOpen() }, icon("tab"), t("startupUseOpen")),
      );
    }
  }
  parts.push(h("p", { class: "notice alert", role: "status" }, startupNotice), settingsLink);
  return parts;
}

function themeSection(): HTMLElement[] {
  return [
    h("p", { class: "notice lead" }, t("browserThemeExplained")),
    h(
      "div",
      { class: "theme-links" },
      h("button", { type: "button", class: "row-link", "data-focus-key": "theme-mode", onclick: () => void chrome.tabs.update({ url: "chrome://settings/appearance" }) }, icon("palette"), h("span", {}, t("themeMode"), h("small", {}, t("themeModeNote")))),
      h("button", { type: "button", class: "row-link", "data-focus-key": "theme-color", onclick: () => void chrome.tabs.update({ url: "chrome://settings/manageProfile" }) }, icon("drop"), h("span", {}, t("themeColor"), h("small", {}, t("themeColorNote")))),
    ),
  ];
}

const SECTION_BODY: Record<Section, () => HTMLElement[]> = {
  background: backgroundSection,
  clock: clockSection,
  search: searchSection,
  layout: layoutSection,
  startup: startupSection,
  theme: themeSection,
};

// Customize dialog
function drawCustomize(): void {
  if (!customize.open) return;
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.focusKey;
  const scroll = customize.querySelector(".customize-panel")?.scrollTop ?? 0;
  const nav = h(
    "nav",
    { class: "customize-nav", role: "tablist", "aria-orientation": "vertical", "aria-label": t("customize") },
    ...SECTIONS.map((id) =>
      h(
        "button",
        {
          type: "button",
          role: "tab",
          id: `tab-${id}`,
          "aria-selected": String(id === section),
          "aria-controls": "customize-panel",
          tabindex: id === section ? "0" : "-1",
          "data-focus-key": `tab-${id}`,
          onclick: () => {
            const changed = id !== section;
            section = id;
            drawCustomize();
            if (changed) customize.querySelector<HTMLElement>(".customize-panel")!.scrollTop = 0;
          },
        },
        icon(SECTION_ICONS[id]),
        h("span", {}, t(SECTION_NAMES[id])),
      ),
    ),
  );
  nav.addEventListener("keydown", (event) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    section = SECTIONS[(SECTIONS.indexOf(section) + step + SECTIONS.length) % SECTIONS.length]!;
    drawCustomize();
    customize.querySelector<HTMLElement>(`#tab-${section}`)?.focus();
  });
  const panel = h(
    "div",
    { class: "customize-panel", id: "customize-panel", role: "tabpanel", "aria-labelledby": `tab-${section}` },
    h("h2", { class: "panel-title" }, t(SECTION_NAMES[section])),
    ...SECTION_BODY[section](),
  );
  customize.replaceChildren(
    h("div", { class: "customize-head" }, h("h2", { id: "customize-title" }, t("customize")), iconButton("close", t("close"), () => customize.close(), { "data-focus-key": "close" })),
    h("div", { class: "customize-body" }, nav, panel),
  );
  panel.scrollTop = scroll;
  if (focused) customize.querySelector<HTMLElement>(`[data-focus-key="${focused}"]`)?.focus();
}

async function openCustomize(): Promise<void> {
  if (!customMedia) setCustomMedia(await loadCustomMedia());
  await loadGallery();
  colorsOpen = false;
  engineNotice = "";
  startupNotice = "";
  startup = await browserStartup();
  const keyword = await browserEngine();
  if (keyword !== null && engineForKeyword(keyword) !== settings.searchEngine) await saveSettings({ searchEngine: engineForKeyword(keyword) });
  customize.showModal();
  openButton.setAttribute("aria-expanded", "true");
  drawCustomize();
  customize.querySelector<HTMLElement>(`#tab-${section}`)?.focus();
}

// Search focus: choosing the search box clears the page around it until the person leaves it.
function installSearchFocus(): void {
  const enter = () => document.body.classList.add("search-focus");
  const leave = () => document.body.classList.remove("search-focus");
  const field = () => searchSlot.querySelector<HTMLInputElement>("input");
  searchSlot.addEventListener("pointerdown", (event) => {
    if ((event.target as Element).closest(".search-form")) enter();
  });
  searchSlot.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      leave();
      field()?.blur();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      enter();
    }
  });
  searchSlot.addEventListener("focusout", () => {
    if (!field()?.value.trim()) leave();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!(event.target as Element).closest(".search-form")) leave();
  });
}

// Clock
const timeElement = document.getElementById("time") as HTMLTimeElement;

function applyClock(): void {
  timeElement.hidden = !settings.showClock && !settings.showDate;
}

let tickTimer: ReturnType<typeof setTimeout> | undefined;

function tick(): void {
  clearTimeout(tickTimer);
  const now = new Date();
  const locale = chrome.i18n.getUILanguage();
  const hour12 = settings.clockFormat === "auto" ? undefined : settings.clockFormat === "12";
  timeElement.dateTime = now.toISOString();
  const parts = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", hour12 }).formatToParts(now);
  timeElement.replaceChildren(
    settings.showClock
      ? h(
          "span",
          { class: "time" },
          ...parts.map((part) => (part.type === "dayPeriod" ? h("span", { class: "period" }, part.value) : part.type === "literal" && /^\s+$/.test(part.value) ? "" : part.value)),
        )
      : "",
    settings.showDate ? h("span", { class: "date" }, now.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" })) : "",
  );
  tickTimer = setTimeout(tick, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
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
  installContextMenu({ customize: () => void openCustomize() });
  installSearchFocus();
  prefersDark.addEventListener("change", applyTheme);
  reducedMotion.addEventListener("change", () => {
    syncPlayback();
    drawCustomize();
  });
  document.addEventListener("visibilitychange", syncPlayback);
  motion.addEventListener("click", async () => {
    await saveSettings({ videoPaused: !settings.videoPaused });
    syncPlayback();
    drawCustomize();
  });
  openButton.addEventListener("click", () => void openCustomize());
  customize.addEventListener("click", (event) => {
    if (event.target === customize) customize.close();
  });
  customize.addEventListener("close", () => {
    openButton.setAttribute("aria-expanded", "false");
    openButton.focus();
  });
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local" || !changes.settings) return;
    const next = sanitizeSettings(changes.settings.newValue);
    const backgroundChanged = next.background !== settings.background || next.color !== settings.color || next.galleryCategory !== settings.galleryCategory || next.galleryChoice !== settings.galleryChoice || next.galleryMotion !== settings.galleryMotion;
    settings = next;
    applyTheme();
    applyClock();
    tick();
    if (backgroundChanged) {
      setCustomMedia(await loadCustomMedia());
      applyBackground();
    } else {
      syncPlayback();
    }
  });
}

// A quiet note in the corner when a newer Orbit is out. The background check stores it.
async function showUpdate(): Promise<void> {
  const { update } = await chrome.storage.local.get("update");
  const release = sanitizeRelease(update);
  document.querySelector(".update-chip")?.remove();
  if (!release || !isNewer(release, await runningVersion())) return;
  const label = t("updateAvailable", release.tag.slice(1));
  document.body.append(
    h("a", { class: "update-chip", href: release.url, target: "_blank", rel: "noopener" }, h("span", { class: "update-dot", "aria-hidden": "true" }), h("span", {}, label), h("strong", {}, t("updateGet"))),
  );
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.update) void showUpdate();
});

void main();
void showUpdate();
