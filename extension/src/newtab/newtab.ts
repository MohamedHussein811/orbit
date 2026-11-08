// Dashboard page: loads settings and layout, draws the widgets, and runs the Customize panel.

import { ALLOWED_SIZES, defaultLayout, moveWidget, sanitizeLayout, updateWidget, type Layout, type WidgetId, type WidgetSize } from "../shared/layout.ts";
import { ACCENTS, resolveTheme, sanitizeSettings, THEME_MODES, type Settings, type ThemeMode } from "../shared/settings.ts";
import { h, iconButton } from "./dom.ts";
import { mountBookmarks, mountNotes, mountSearch, mountStats, mountWeather, type WidgetContext } from "./widgets.ts";

const WIDGET_NAMES: Record<WidgetId, string> = { search: "Search", stats: "Protection", bookmarks: "Bookmarks", weather: "Weather", notes: "Notes" };
const SIZE_NAMES: Record<WidgetSize, string> = { small: "Small", medium: "Medium", large: "Large" };
const THEME_NAMES: Record<ThemeMode, string> = { system: "System", light: "Light", dark: "Dark", space: "Space" };
const MAX_WALLPAPER_BYTES = 12 * 1024 * 1024;

let settings: Settings;
let layout: Layout;

const board = document.getElementById("board")!;
const drawer = document.getElementById("customize") as HTMLDialogElement;
const prefersDark = matchMedia("(prefers-color-scheme: dark)");

// Theme
function applyTheme(): void {
  const theme = resolveTheme(settings.theme, prefersDark.matches);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty("--accent", settings.accent);
  try {
    localStorage.setItem("orbit-theme", theme);
    localStorage.setItem("orbit-accent", settings.accent);
  } catch {
    // Only the fast first paint depends on this cache.
  }
}

/** Asks the host to color the browser window to match. The dashboard works without it. */
function applyBrowserTheme(): void {
  void fetch("https://orbit.invalid/theme", {
    method: "POST",
    credentials: "omit",
    body: JSON.stringify({ mode: settings.theme, accent: settings.accent }),
  }).catch(() => {});
}

async function applyWallpaper(): Promise<void> {
  const { wallpaper } = await chrome.storage.local.get("wallpaper");
  if (typeof wallpaper === "string" && wallpaper.startsWith("data:image/")) {
    document.body.style.setProperty("--wallpaper", `url("${wallpaper}")`);
    document.body.classList.add("has-wallpaper");
  } else {
    document.body.style.removeProperty("--wallpaper");
    document.body.classList.remove("has-wallpaper");
  }
}

async function saveSettings(patch: Partial<Settings>): Promise<void> {
  settings = sanitizeSettings({ ...settings, ...patch });
  await chrome.storage.local.set({ settings });
}

const context: WidgetContext = { settings: () => settings, saveSettings };

// Board
const MOUNT: Record<WidgetId, (root: HTMLElement) => void> = {
  search: (root) => mountSearch(root),
  stats: (root) => mountStats(root, context),
  bookmarks: (root) => mountBookmarks(root, context),
  weather: (root) => mountWeather(root, context),
  notes: (root) => mountNotes(root),
};

function drawBoard(): void {
  board.replaceChildren();
  for (const widget of layout.widgets) {
    const frame = h("section", { class: `widget size-${widget.size}`, "data-id": widget.id, "aria-label": WIDGET_NAMES[widget.id], hidden: !widget.visible });
    board.append(frame);
    if (widget.visible) {
      try {
        MOUNT[widget.id](frame);
      } catch (error) {
        console.error(`widget ${widget.id} failed`, error);
        frame.classList.add("pane");
        frame.textContent = `${WIDGET_NAMES[widget.id]} could not load. The rest of the page still works.`;
      }
    }
    attachDrag(frame, widget.id);
  }
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
  const themeRow = h(
    "div",
    { class: "choice-row", role: "group", "aria-label": "Theme" },
    ...THEME_MODES.map((mode) =>
      h(
        "button",
        {
          type: "button",
          "aria-pressed": String(settings.theme === mode),
          onclick: async () => {
            await saveSettings({ theme: mode });
            applyTheme();
            applyBrowserTheme();
            drawDrawer();
          },
        },
        THEME_NAMES[mode],
      ),
    ),
  );

  const setAccent = async (accent: string) => {
    await saveSettings({ accent });
    applyTheme();
    applyBrowserTheme();
    drawDrawer();
  };
  const picker = h("input", { type: "color", value: settings.accent, "aria-label": "Custom accent color", onchange: () => void setAccent(picker.value) });
  const accentRow = h(
    "div",
    { class: "accent-row" },
    ...ACCENTS.map((accent) => {
      const swatch = h("button", { type: "button", class: "swatch", "aria-label": `Accent ${accent}`, "aria-pressed": String(settings.accent === accent), onclick: () => void setAccent(accent) });
      swatch.style.setProperty("--swatch", accent);
      return swatch;
    }),
    picker,
  );

  const file = h("input", {
    type: "file",
    accept: "image/png,image/jpeg,image/webp",
    "aria-label": "Choose a wallpaper",
    onchange: () => {
      const chosen = file.files?.[0];
      if (!chosen) return;
      if (chosen.size > MAX_WALLPAPER_BYTES) {
        wallpaperNotice.textContent = "Choose an image smaller than 12 MB.";
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        await chrome.storage.local.set({ wallpaper: String(reader.result) });
        wallpaperNotice.textContent = "";
        await applyWallpaper();
      };
      reader.readAsDataURL(chosen);
    },
  });
  const wallpaperNotice = h("p", { class: "notice", role: "status" });

  const widgetList = h(
    "ul",
    { class: "widget-list" },
    ...layout.widgets.map((widget, index) => {
      const visible = h("input", {
        type: "checkbox",
        checked: widget.visible,
        onchange: () => void setLayout(updateWidget(layout, widget.id, { visible: visible.checked })),
      });
      const sizes = ALLOWED_SIZES[widget.id];
      const size = h(
        "select",
        { "aria-label": `${WIDGET_NAMES[widget.id]} size`, disabled: sizes.length < 2, onchange: () => void setLayout(updateWidget(layout, widget.id, { size: size.value as WidgetSize })) },
        ...sizes.map((option) => h("option", { value: option }, SIZE_NAMES[option])),
      );
      size.value = widget.size;
      return h(
        "li",
        {},
        h("label", {}, visible, WIDGET_NAMES[widget.id]),
        size,
        iconButton("up", `Move ${WIDGET_NAMES[widget.id]} up`, () => void setLayout(moveWidget(layout, widget.id, index - 1)), { disabled: index === 0 }),
        iconButton("down", `Move ${WIDGET_NAMES[widget.id]} down`, () => void setLayout(moveWidget(layout, widget.id, index + 1)), { disabled: index === layout.widgets.length - 1 }),
      );
    }),
  );

  drawer.replaceChildren(
    h("div", { class: "drawer-head" }, h("h2", { id: "customize-title" }, "Customize"), iconButton("close", "Close", () => drawer.close())),
    h("h3", {}, "Theme"),
    themeRow,
    h("h3", {}, "Accent color"),
    accentRow,
    h("h3", {}, "Wallpaper"),
    file,
    wallpaperNotice,
    h(
      "p",
      {},
      h(
        "button",
        {
          type: "button",
          class: "link",
          onclick: async () => {
            await chrome.storage.local.remove("wallpaper");
            await applyWallpaper();
          },
        },
        "Remove wallpaper",
      ),
    ),
    h("h3", {}, "Widgets"),
    widgetList,
    h("p", { class: "notice" }, "While this panel is open, you can also drag widgets on the page."),
    h("div", { class: "foot" }, h("button", { type: "button", class: "link", onclick: () => void setLayout(defaultLayout()) }, "Restore default layout")),
  );
}

// Clock
const timeElement = document.getElementById("time")!;
const dateElement = document.getElementById("date")!;

function tick(): void {
  const now = new Date();
  timeElement.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  dateElement.textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  setTimeout(tick, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
}

async function main(): Promise<void> {
  const stored = await chrome.storage.local.get(["settings", "layout"]);
  settings = sanitizeSettings(stored.settings);
  layout = sanitizeLayout(stored.layout);
  applyTheme();
  tick();
  await applyWallpaper();
  drawBoard();
  drawDrawer();
  prefersDark.addEventListener("change", applyTheme);
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
