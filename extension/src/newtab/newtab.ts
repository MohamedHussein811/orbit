// Dashboard page: loads settings and layout, draws the widgets, and runs the Customize panel.

import { ALLOWED_SIZES, defaultLayout, moveWidget, sanitizeLayout, updateWidget, type Layout, type WidgetId, type WidgetSize } from "../shared/layout.ts";
import { localizePage, t } from "../shared/i18n.ts";
import { BACKGROUNDS, resolveTheme, sanitizeSettings, type Background, type Settings } from "../shared/settings.ts";
import { h, icon, iconButton } from "./dom.ts";
import { mountBookmarks, mountNotes, mountSearch, mountStats, mountWeather, type WidgetContext } from "./widgets.ts";

const WIDGET_NAMES: Record<WidgetId, string> = {
  search: "widgetSearch",
  stats: "widgetProtection",
  bookmarks: "widgetShortcuts",
  weather: "widgetWeather",
  notes: "widgetNotes",
};
const SIZE_NAMES: Record<WidgetSize, string> = { small: "sizeSmall", medium: "sizeMedium", large: "sizeLarge" };
const BACKGROUND_NAMES: Record<Background, string> = { scene: "backgroundSpace", plain: "backgroundPlain" };
const MAX_WALLPAPER_BYTES = 12 * 1024 * 1024;
/** Widgets that sit above the planet's edge. The rest rest on the planet below it. */
const ABOVE_HORIZON = new Set<WidgetId>(["search", "bookmarks"]);

let settings: Settings;
let layout: Layout;

const root = document.documentElement;
const board = document.getElementById("board")!;
const drawer = document.getElementById("customize") as HTMLDialogElement;
const prefersDark = matchMedia("(prefers-color-scheme: dark)");

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

async function applyWallpaper(): Promise<void> {
  const { wallpaper } = await chrome.storage.local.get("wallpaper");
  const has = typeof wallpaper === "string" && wallpaper.startsWith("data:image/");
  document.body.classList.toggle("has-wallpaper", has);
  if (has) document.body.style.setProperty("--wallpaper", `url("${wallpaper}")`);
  else document.body.style.removeProperty("--wallpaper");
}

/** Puts the planet's edge in the gap above the first widget that rests on it. */
function placeHorizon(): void {
  const gap = board.querySelector<HTMLElement>(".horizon-gap");
  if (!gap) {
    root.style.setProperty("--horizon", "80vh");
    return;
  }
  const rect = gap.getBoundingClientRect();
  const middle = rect.top + scrollY + rect.height / 2;
  root.style.setProperty("--horizon", `${Math.round(Math.max(middle, innerHeight * 0.4))}px`);
}

async function saveSettings(patch: Partial<Settings>): Promise<void> {
  settings = sanitizeSettings({ ...settings, ...patch });
  await chrome.storage.local.set({ settings });
}

const context: WidgetContext = { settings: () => settings, saveSettings, relayout: () => placeHorizon() };

// Board
const MOUNT: Record<WidgetId, (frame: HTMLElement) => void> = {
  search: (frame) => mountSearch(frame),
  stats: (frame) => mountStats(frame, context),
  bookmarks: (frame) => mountBookmarks(frame, context),
  weather: (frame) => mountWeather(frame, context),
  notes: (frame) => mountNotes(frame),
};

function drawBoard(): void {
  board.replaceChildren();
  let gapPlaced = false;
  for (const widget of layout.widgets) {
    if (!gapPlaced && widget.visible && !ABOVE_HORIZON.has(widget.id)) {
      board.append(h("div", { class: "horizon-gap", "aria-hidden": "true" }));
      gapPlaced = true;
    }
    const frame = h("section", { class: `widget size-${widget.size}`, "data-id": widget.id, "aria-label": t(WIDGET_NAMES[widget.id]), hidden: !widget.visible });
    board.append(frame);
    if (widget.visible) {
      try {
        MOUNT[widget.id](frame);
      } catch (error) {
        console.error(`widget ${widget.id} failed`, error);
        frame.classList.add("pane");
        frame.textContent = t("widgetFailed", t(WIDGET_NAMES[widget.id]));
      }
    }
    attachDrag(frame, widget.id);
  }
  requestAnimationFrame(placeHorizon);
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
    const target = layout.widgets.findIndex((widget) => widget.id === id);
    void setLayout(moveWidget(layout, moved, target));
  });
}

async function setLayout(next: Layout): Promise<void> {
  layout = next;
  await chrome.storage.local.set({ layout });
  drawBoard();
  markEditable(drawer.open);
  drawDrawer();
}

function markEditable(editing: boolean): void {
  document.body.classList.toggle("editing", editing);
  for (const frame of board.querySelectorAll<HTMLElement>(".widget")) {
    frame.draggable = editing;
  }
}

// Customize panel
function drawDrawer(): void {
  const backgroundRow = h(
    "div",
    { class: "segmented", role: "group", "aria-label": t("background") },
    ...BACKGROUNDS.map((background) =>
      h(
        "button",
        {
          type: "button",
          "aria-pressed": String(settings.background === background),
          onclick: async () => {
            await saveSettings({ background });
            applyTheme();
            drawDrawer();
          },
        },
        t(BACKGROUND_NAMES[background]),
      ),
    ),
  );

  const wallpaperNotice = h("p", { class: "notice", role: "status" });
  const file = h("input", {
    type: "file",
    accept: "image/png,image/jpeg,image/webp",
    "aria-label": t("chooseImage"),
    onchange: () => {
      const chosen = file.files?.[0];
      if (!chosen) return;
      if (chosen.size > MAX_WALLPAPER_BYTES) {
        wallpaperNotice.textContent = t("imageTooLarge");
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        await chrome.storage.local.set({ wallpaper: String(reader.result) });
        wallpaperNotice.textContent = "";
        await applyWallpaper();
        drawDrawer();
      };
      reader.readAsDataURL(chosen);
    },
  });
  const hasWallpaper = document.body.classList.contains("has-wallpaper");

  const widgetList = h(
    "ul",
    { class: "widget-list" },
    ...layout.widgets.map((widget, index) => {
      const name = t(WIDGET_NAMES[widget.id]);
      const visible = h("input", {
        type: "checkbox",
        class: "switch",
        checked: widget.visible,
        onchange: () => void setLayout(updateWidget(layout, widget.id, { visible: visible.checked })),
      });
      const sizes = ALLOWED_SIZES[widget.id];
      const size =
        sizes.length > 1
          ? h(
              "select",
              { "aria-label": t("widgetSize", name), onchange: () => void setLayout(updateWidget(layout, widget.id, { size: size!.value as WidgetSize })) },
              ...sizes.map((option) => h("option", { value: option }, t(SIZE_NAMES[option]))),
            )
          : null;
      if (size) size.value = widget.size;
      return h(
        "li",
        {},
        h("label", {}, visible, name),
        size,
        iconButton("up", t("moveUp", name), () => void setLayout(moveWidget(layout, widget.id, index - 1)), { disabled: index === 0 }),
        iconButton("down", t("moveDown", name), () => void setLayout(moveWidget(layout, widget.id, index + 1)), { disabled: index === layout.widgets.length - 1 }),
      );
    }),
  );

  drawer.replaceChildren(
    h("div", { class: "drawer-head" }, h("h2", { id: "customize-title" }, t("customize")), iconButton("close", t("close"), () => drawer.close())),
    h(
      "section",
      {},
      h("h3", {}, t("background")),
      h("div", { class: "drawer-row" }, backgroundRow),
      h(
        "div",
        { class: "drawer-row", style: "margin-top: 0.75rem" },
        h("label", { class: "button quiet file-button" }, icon("image"), hasWallpaper ? t("changeImage") : t("chooseImage"), file),
        hasWallpaper &&
          h(
            "button",
            {
              type: "button",
              class: "button quiet",
              onclick: async () => {
                await chrome.storage.local.remove("wallpaper");
                await applyWallpaper();
                drawDrawer();
              },
            },
            t("removeImage"),
          ),
      ),
      wallpaperNotice,
    ),
    h(
      "section",
      {},
      h("h3", {}, t("browserTheme")),
      h("p", { class: "notice" }, t("browserThemeExplained")),
      h("button", { type: "button", class: "button quiet", onclick: () => void chrome.tabs.update({ url: "chrome://settings/appearance" }) }, t("openThemeSettings")),
    ),
    h(
      "section",
      {},
      h("h3", {}, t("widgets")),
      widgetList,
      h("p", { class: "notice", style: "margin-top: 0.5rem" }, t("dragHint")),
      h("button", { type: "button", class: "link", onclick: () => void setLayout(defaultLayout()) }, t("restoreLayout")),
    ),
  );
}

// Clock
const timeElement = document.getElementById("time") as HTMLTimeElement;
const dateElement = document.getElementById("date")!;

function tick(): void {
  const now = new Date();
  const locale = chrome.i18n.getUILanguage();
  timeElement.dateTime = now.toISOString();
  const parts = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).formatToParts(now);
  timeElement.replaceChildren(
    ...parts.map((part) => (part.type === "dayPeriod" ? h("span", { class: "period" }, part.value) : part.type === "literal" && /^s+$/.test(part.value) ? "" : part.value)),
  );
  dateElement.textContent = now.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" });
  setTimeout(tick, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
}

async function main(): Promise<void> {
  localizePage();
  const stored = await chrome.storage.local.get(["settings", "layout"]);
  settings = sanitizeSettings(stored.settings);
  layout = sanitizeLayout(stored.layout);
  applyTheme();
  tick();
  await applyWallpaper();
  drawBoard();
  drawDrawer();
  prefersDark.addEventListener("change", applyTheme);
  addEventListener("resize", placeHorizon);
  document.getElementById("open-customize")!.addEventListener("click", () => {
    drawDrawer();
    drawer.show();
    markEditable(true);
    drawer.querySelector<HTMLElement>("button")?.focus();
  });
  drawer.addEventListener("close", () => markEditable(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && drawer.open) drawer.close();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) {
      settings = sanitizeSettings(changes.settings.newValue);
      applyTheme();
    }
  });
}

void main();
