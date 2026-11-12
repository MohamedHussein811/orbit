// The dashboard's widgets. Each one renders into its own frame and keeps working when another fails.

import { t, uiLanguage } from "../shared/i18n.ts";
import type { Settings } from "../shared/settings.ts";
import { CATEGORIES, PERIODS, sanitizeStats, summarize, type Category, type Period } from "../shared/stats.ts";
import type { Message } from "../shared/shields.ts";
import {
  forecastUrl,
  geocodeUrl,
  isFresh,
  parseForecast,
  parsePlaces,
  weatherConditionKey,
  weatherIcon,
  WEATHER_PROVIDER,
  WEATHER_TIMEOUT_MS,
  type WeatherPlace,
  type WeatherReport,
} from "../shared/weather.ts";
import { createNote, NOTE_COLORS, patchNote, sanitizeNotes, sortNotes, type Note, type NoteColor } from "../shared/notes.ts";
import { debounce, h, icon, iconButton } from "./dom.ts";

export interface WidgetContext {
  settings: () => Settings;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  /** Call after a widget changes height, so the scene can follow. */
  relayout: () => void;
}

const PERIOD_LABEL: Record<Period, string> = { today: "periodToday", "7d": "period7d", "30d": "period30d", all: "periodAll" };
const CATEGORY_LABEL: Record<Category, string> = { ads: "statAds", trackers: "statTrackers", threats: "statThreats" };
const locale = () => chrome.i18n.getUILanguage();

// Search
function looksLikeAddress(text: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(text) || /^localhost(:\d+)?(\/\S*)?$/i.test(text);
}

export function mountSearch(root: HTMLElement): void {
  const label = t("searchPlaceholder");
  const input = h("input", { type: "search", name: "q", placeholder: label, "aria-label": label, autocomplete: "off", spellcheck: "false", autofocus: true });
  const form = h(
    "form",
    {
      class: "search-form",
      role: "search",
      onsubmit: (event: Event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        if (looksLikeAddress(text)) {
          location.href = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
        } else {
          void chrome.search.query({ text, disposition: "CURRENT_TAB" });
        }
      },
    },
    icon("search"),
    input,
  );
  root.append(form);
}

// Protection
export function mountStats(root: HTMLElement, context: WidgetContext): void {
  root.classList.add("pane");
  const rows = Object.fromEntries(
    CATEGORIES.map((category) => {
      const value = h("dd", {}, "0");
      const fill = h("span", { class: "fill" });
      const row = h("div", { class: "meter", "data-category": category }, h("dt", {}, t(CATEGORY_LABEL[category])), value, h("span", { class: "track", "aria-hidden": "true" }, fill));
      return [category, { row, value, fill }];
    }),
  ) as unknown as Record<Category, { row: HTMLElement; value: HTMLElement; fill: HTMLElement }>;

  const select = h(
    "select",
    {
      "aria-label": t("reportingPeriod"),
      onchange: () => {
        void context.saveSettings({ statsPeriod: select.value as Period });
        void refresh();
      },
    },
    ...PERIODS.map((period) => h("option", { value: period }, t(PERIOD_LABEL[period]))),
  );
  select.value = context.settings().statsPeriod;

  const reset = h("button", { type: "button", class: "link", onclick: () => confirmReset() }, t("resetCounts"));
  const footEnd = h("span", {}, reset);

  function confirmReset(): void {
    footEnd.replaceChildren(
      t("resetCountsConfirm"),
      " ",
      h(
        "button",
        {
          type: "button",
          class: "link danger",
          onclick: async () => {
            const message: Message = { type: "reset-stats" };
            await chrome.runtime.sendMessage(message);
            footEnd.replaceChildren(reset);
            await refresh();
          },
        },
        t("reset"),
      ),
      " ",
      h("button", { type: "button", class: "link", onclick: () => footEnd.replaceChildren(reset) }, t("keep")),
    );
  }

  async function refresh(): Promise<void> {
    const { stats } = await chrome.storage.local.get("stats");
    const totals = summarize(sanitizeStats(stats), context.settings().statsPeriod, Date.now());
    const largest = Math.max(1, ...CATEGORIES.map((category) => totals[category]));
    for (const category of CATEGORIES) {
      rows[category].value.textContent = totals[category].toLocaleString(locale());
      rows[category].fill.style.setProperty("--share", `${(totals[category] / largest) * 100}%`);
    }
  }

  root.append(
    h("div", { class: "widget-head" }, h("h2", {}, t("widgetProtection")), select),
    h("dl", { class: "meters" }, ...CATEGORIES.map((category) => rows[category].row)),
    h("div", { class: "foot" }, h("span", {}, t("countedLocally")), footEnd),
  );
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.stats) void refresh();
  });
  void refresh();
}

// Shortcuts (bookmarks)
type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;
const BOOKMARKS_BAR = "1";

function faviconUrl(pageUrl: string): string {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", "64");
  return url.toString();
}

function openUrl(url: string, event: Event): void {
  // Links to browser pages need the tabs API. Web links keep normal link behaviour.
  if (/^https?:/i.test(url)) return;
  event.preventDefault();
  void chrome.tabs.update({ url });
}

function validBookmarkUrl(text: string): string | null {
  const value = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "javascript:" ? null : parsed.href;
  } catch {
    return null;
  }
}

function bookmarkEditor(options: {
  title: string;
  url?: string;
  isFolder: boolean;
  heading: string;
  onSave: (title: string, url?: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  alternative?: { label: string; open: () => void };
}): void {
  const titleInput = h("input", { type: "text", value: options.title, "aria-label": t("fieldName") });
  const urlInput = options.isFolder ? null : h("input", { type: "text", inputmode: "url", dir: "ltr", value: options.url ?? "", "aria-label": t("fieldAddress"), placeholder: "example.com", spellcheck: "false" });
  const error = h("p", { class: "notice", role: "alert" });
  const dialog = h("dialog", { class: "editor" });
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.append(
    h(
      "form",
      {
        method: "dialog",
        onsubmit: async (event: Event) => {
          event.preventDefault();
          const title = titleInput.value.trim() || t("untitled");
          let url: string | undefined;
          if (urlInput) {
            const valid = validBookmarkUrl(urlInput.value.trim());
            if (!valid) {
              error.textContent = t("invalidAddress");
              return;
            }
            url = valid;
          }
          await options.onSave(title, url);
          close();
        },
      },
      h("h2", {}, options.heading),
      h("label", { class: "field" }, h("span", {}, t("fieldName")), titleInput),
      urlInput && h("label", { class: "field" }, h("span", {}, t("fieldAddress")), urlInput),
      error,
      h(
        "div",
        { class: "editor-actions" },
        options.onDelete &&
          h(
            "button",
            {
              type: "button",
              class: "button quiet danger",
              onclick: async () => {
                await options.onDelete!();
                close();
              },
            },
            t("delete"),
          ),
        options.alternative &&
          h(
            "button",
            {
              type: "button",
              class: "button quiet",
              onclick: () => {
                close();
                options.alternative!.open();
              },
            },
            icon("folder-plus"),
            options.alternative.label,
          ),
        h("span", { class: "spacer" }),
        h("button", { type: "button", class: "button quiet", onclick: close }, t("cancel")),
        h("button", { type: "submit", class: "button primary" }, t("save")),
      ),
    ),
  );
  document.body.append(dialog);
  dialog.showModal();
  titleInput.select();
}

export function mountBookmarks(root: HTMLElement, context: WidgetContext): void {
  const collections = h("div", { class: "segmented", role: "tablist", "aria-label": t("bookmarkCollections") });
  const newFolder = iconButton("folder-plus", t("newFolder"), () => editNew(true));
  const bar = h("div", { class: "shortcuts-bar" });
  const body = h("div", { class: "shortcuts-body" });
  const railBack = iconButton("back", t("shortcutsBack"), () => scrollRail(-1), { class: "icon-button rail-arrow", "data-edge": "start", tabindex: "-1" });
  const railForward = iconButton("forward", t("shortcutsForward"), () => scrollRail(1), { class: "icon-button rail-arrow", "data-edge": "end", tabindex: "-1" });
  const rail = h("div", { class: "rail" }, railBack, body, railForward);
  root.append(h("div", { class: "shortcuts" }, bar, rail));
  let list: HTMLUListElement | null = null;
  const railSize = new ResizeObserver(() => updateRail());

  function scrollRail(step: 1 | -1): void {
    if (!list) return;
    const rtl = getComputedStyle(list).direction === "rtl";
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollBy({ left: step * (rtl ? -1 : 1) * list.clientWidth * 0.8, behavior: smooth ? "smooth" : "auto" });
  }

  function updateRail(): void {
    const max = list ? list.scrollWidth - list.clientWidth : 0;
    const position = list ? Math.abs(list.scrollLeft) : 0;
    rail.toggleAttribute("data-more-start", position > 1);
    rail.toggleAttribute("data-more-end", position < max - 1);
  }

  let current = context.settings().bookmarksFolder ?? BOOKMARKS_BAR;
  let dragId: string | null = null;

  function editNew(isFolder: boolean): void {
    bookmarkEditor({
      title: "",
      isFolder,
      heading: isFolder ? t("newFolder") : t("addShortcut"),
      onSave: async (title, url) => {
        await chrome.bookmarks.create({ parentId: current, title, url });
      },
      alternative: isFolder ? undefined : { label: t("newFolder"), open: () => editNew(true) },
    });
  }

  function openFolder(id: string): void {
    current = id;
    void context.saveSettings({ bookmarksFolder: id });
    void render();
  }

  function tile(node: BookmarkNode, parent: BookmarkNode, index: number): HTMLElement {
    const isFolder = !node.url;
    const name = node.title || node.url || t("untitled");
    const edit = iconButton(
      "edit",
      t("editItem", name),
      () =>
        bookmarkEditor({
          title: node.title,
          url: node.url,
          isFolder,
          heading: isFolder ? t("editFolder") : t("editShortcut"),
          onSave: async (title, url) => {
            await chrome.bookmarks.update(node.id, isFolder ? { title } : { title, url });
          },
          onDelete: async () => {
            await (isFolder ? chrome.bookmarks.removeTree(node.id) : chrome.bookmarks.remove(node.id));
          },
        }),
      { class: "icon-button edit" },
    );
    const iconBox = h("span", { class: "tile-icon" });
    iconBox.append(isFolder ? icon("folder") : h("img", { src: faviconUrl(node.url!), alt: "", width: 28, height: 28, loading: "lazy" }));
    const label = h("span", { class: "tile-title", dir: "auto" }, name);
    const open = isFolder
      ? h("button", { type: "button", class: "open-folder", onclick: () => openFolder(node.id) }, iconBox, label)
      : h("a", { href: node.url!, title: name, onclick: (event: Event) => openUrl(node.url!, event) }, iconBox, label);
    const item = h("li", { class: "tile", draggable: "true", "data-id": node.id }, open, edit);

    item.addEventListener("dragstart", (event) => {
      dragId = node.id;
      event.dataTransfer!.effectAllowed = "move";
      event.dataTransfer!.setData("text/plain", node.title);
    });
    item.addEventListener("dragover", (event) => {
      if (!dragId || dragId === node.id) return;
      event.preventDefault();
      item.classList.add("drop-target");
    });
    item.addEventListener("dragleave", () => item.classList.remove("drop-target"));
    item.addEventListener("drop", async (event) => {
      event.preventDefault();
      item.classList.remove("drop-target");
      const moved = dragId;
      dragId = null;
      if (!moved || moved === node.id) return;
      if (isFolder) {
        await chrome.bookmarks.move(moved, { parentId: node.id });
        return;
      }
      const from = parent.children!.findIndex((child) => child.id === moved);
      // Chromium counts the target index before removing the moved item.
      const to = from !== -1 && from < index ? index + 1 : index;
      await chrome.bookmarks.move(moved, { parentId: parent.id, index: to });
    });
    return item;
  }

  function addTile(): HTMLElement {
    const iconBox = h("span", { class: "tile-icon" }, icon("plus"));
    return h("li", { class: "tile" }, h("button", { type: "button", class: "add-tile", onclick: () => editNew(false) }, iconBox, h("span", { class: "tile-title" }, t("addShortcut"))));
  }

  async function render(): Promise<void> {
    const [tree] = await chrome.bookmarks.getTree();
    const roots = (tree?.children ?? []).filter((node) => node.id === BOOKMARKS_BAR || (node.children?.length ?? 0) > 0);
    const [folder] = await chrome.bookmarks.getSubTree(current).catch(() => chrome.bookmarks.getSubTree(BOOKMARKS_BAR));
    if (!folder) return;
    current = folder.id;

    const activeRoot = roots.find((node) => node.id === folder.id)?.id ?? null;
    collections.replaceChildren(
      ...roots.map((node) => h("button", { type: "button", role: "tab", "aria-selected": String(node.id === activeRoot), onclick: () => openFolder(node.id) }, node.title)),
    );
    const crumb = activeRoot ? null : h("div", { class: "crumb" }, iconButton("back", t("backToParent"), () => openFolder(folder.parentId ?? BOOKMARKS_BAR)), h("span", {}, folder.title));
    const barItems = crumb ? [crumb] : roots.length > 1 ? [collections] : [];
    bar.replaceChildren(...barItems, ...(barItems.length ? [newFolder] : []));
    bar.hidden = !barItems.length;

    const children = folder.children ?? [];
    list = h("ul", { class: "tiles" }, ...children.map((node, index) => tile(node, folder, index)), addTile());
    list.addEventListener("scroll", updateRail, { passive: true });
    railSize.disconnect();
    railSize.observe(list);
    const hint = children.length
      ? null
      : h(
          "p",
          { class: "empty" },
          t("shortcutsEmpty"),
          " ",
          h("button", { type: "button", class: "link", onclick: () => void chrome.tabs.create({ url: "chrome://settings/importData" }) }, t("importBookmarks")),
        );
    body.replaceChildren(list, ...(hint ? [hint] : []));
    updateRail();
    context.relayout();
  }

  for (const event of [chrome.bookmarks.onCreated, chrome.bookmarks.onRemoved, chrome.bookmarks.onChanged, chrome.bookmarks.onMoved, chrome.bookmarks.onChildrenReordered]) {
    (event as chrome.events.Event<() => void>).addListener(() => void render());
  }
  void render();
}

// Weather
export function mountWeather(root: HTMLElement, context: WidgetContext): void {
  root.classList.add("pane");
  const body = h("div", { class: "weather-body" });
  const credit = h("a", { href: WEATHER_PROVIDER.url, class: "link" }, t("weatherBy", WEATHER_PROVIDER.name));
  const unit = h("button", { type: "button", class: "link", onclick: () => toggleUnit() });
  const action = h("span", {});
  root.append(h("div", { class: "widget-head" }, h("h2", {}, t("widgetWeather")), unit), body, h("div", { class: "foot" }, action, credit));

  async function load(): Promise<{ place: WeatherPlace | null; report: WeatherReport | null }> {
    const { weatherPlace, weatherReport } = await chrome.storage.local.get(["weatherPlace", "weatherReport"]);
    return { place: (weatherPlace as WeatherPlace | undefined) ?? null, report: (weatherReport as WeatherReport | undefined) ?? null };
  }

  async function toggleUnit(): Promise<void> {
    const next = context.settings().temperatureUnit === "celsius" ? "fahrenheit" : "celsius";
    await context.saveSettings({ temperatureUnit: next });
    await chrome.storage.local.remove("weatherReport");
    await render();
  }

  function showPlaceForm(message?: string, canCancel = false): void {
    body.classList.remove("has-report");
    action.replaceChildren(...(canCancel ? [h("button", { type: "button", class: "link", onclick: () => void render() }, t("cancel"))] : []));
    const input = h("input", { type: "text", placeholder: t("cityName"), "aria-label": t("cityName") });
    const results = h("ul", { class: "place-results" });
    const form = h(
      "form",
      {
        class: "place-form",
        onsubmit: async (event: Event) => {
          event.preventDefault();
          const query = input.value.trim();
          if (!query) return;
          results.replaceChildren(h("li", { class: "notice" }, t("searching")));
          try {
            const res = await fetch(geocodeUrl(query, uiLanguage()), { credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS) });
            const places = parsePlaces(await res.json());
            results.replaceChildren();
            if (!places.length) {
              results.append(h("li", { class: "notice" }, t("noPlaceFound")));
            }
            for (const place of places) {
              results.append(
                h(
                  "li",
                  {},
                  h(
                    "button",
                    {
                      type: "button",
                      onclick: async () => {
                        await chrome.storage.local.set({ weatherPlace: place });
                        await chrome.storage.local.remove("weatherReport");
                        await render();
                      },
                    },
                    place.name,
                    " ",
                    h("small", {}, place.detail),
                  ),
                ),
              );
            }
          } catch {
            results.replaceChildren(h("li", { class: "notice" }, t("weatherUnreachable")));
          }
          context.relayout();
        },
      },
      input,
      h("button", { type: "submit", class: "button" }, t("find")),
    );
    body.replaceChildren(h("p", { class: "notice" }, message ?? t("weatherIntro", WEATHER_PROVIDER.name)), form, results);
    context.relayout();
  }

  async function render(): Promise<void> {
    const unitName = context.settings().temperatureUnit;
    unit.textContent = unitName === "celsius" ? t("showFahrenheit") : t("showCelsius");
    const { place, report: cached } = await load();
    if (!place) {
      showPlaceForm();
      return;
    }
    if (cached) {
      showReport(place, cached, false);
      if (isFresh(cached, Date.now())) return;
    } else {
      body.replaceChildren(h("p", { class: "weather-place" }, place.name), h("p", { class: "notice" }, t("weatherLoading")));
    }
    let report = cached;
    let failed = false;
    try {
      const res = await fetch(forecastUrl(place, unitName), { credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS) });
      const parsed = parseForecast(await res.json(), Date.now());
      if (parsed) {
        report = parsed;
        await chrome.storage.local.set({ weatherReport: parsed });
      } else {
        failed = true;
      }
    } catch {
      failed = true;
    }
    showReport(place, report, failed);
  }

  function showReport(place: WeatherPlace, report: WeatherReport | null, failed: boolean): void {
    action.replaceChildren(h("button", { type: "button", class: "link", onclick: () => showPlaceForm(undefined, true) }, t("changeCity")));
    body.classList.toggle("has-report", Boolean(report));
    if (!report) {
      body.replaceChildren(h("p", { class: "weather-place" }, place.name), h("p", { class: "notice" }, t("weatherUnavailable")));
      context.relayout();
      return;
    }
    const symbol = context.settings().temperatureUnit === "celsius" ? "°C" : "°F";
    const glyph = icon(weatherIcon(report.code));
    glyph.classList.add("weather-icon");
    const number = (value: number) => value.toLocaleString(locale());
    const degrees = (value: number) => `⁦${number(value)}°⁩`;
    body.replaceChildren(
      h("div", { class: "weather-now" }, glyph, h("span", { class: "weather-temp", dir: "ltr" }, `${number(report.temperature)}${symbol}`)),
      h(
        "div",
        { class: "weather-about" },
        h("p", { class: "weather-place" }, place.name),
        h("p", { class: "weather-condition" }, t(weatherConditionKey(report.code))),
        h("p", { class: "weather-range" }, t("highLow", degrees(report.high), degrees(report.low))),
      ),
      ...(failed ? [h("p", { class: "notice" }, t("weatherStale", new Date(report.fetchedAt).toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" })))] : []),
    );
    context.relayout();
  }
  void render();
}

// Notes
const NOTE_SWATCH: Record<NoteColor, string> = { ion: "#8d9bff", amber: "#f2b75b", rose: "#f28ca8", mint: "#5fd4c8", slate: "#9aa3b8" };
const NOTE_COLOR_NAME: Record<NoteColor, string> = { ion: "colorBlue", amber: "colorAmber", rose: "colorRose", mint: "colorMint", slate: "colorSlate" };

export function mountNotes(root: HTMLElement): void {
  root.classList.add("pane");
  let notes: Note[] = [];
  const list = h("div", { class: "notes-list" });
  root.append(h("div", { class: "widget-head" }, h("h2", {}, t("widgetNotes")), h("button", { type: "button", class: "button quiet", onclick: () => add() }, icon("plus"), t("addNote"))), list);

  const persist = () => chrome.storage.local.set({ notes });
  const persistSoon = debounce(() => void persist(), 400);

  function add(): void {
    const note = createNote(crypto.randomUUID(), Date.now());
    notes = [note, ...notes];
    void persist();
    render();
    list.querySelector<HTMLTextAreaElement>(`[data-note="${note.id}"] textarea`)?.focus();
  }

  function update(id: string, patch: Partial<Pick<Note, "text" | "color" | "pinned">>, redraw: boolean): void {
    notes = patchNote(notes, id, patch, Date.now());
    if (redraw) {
      void persist();
      render();
    } else {
      persistSoon();
    }
  }

  function noteCard(note: Note): HTMLElement {
    const text = h("textarea", { dir: "auto", "aria-label": t("noteText"), placeholder: t("notePlaceholder"), oninput: () => update(note.id, { text: text.value }, false) });
    text.value = note.text;
    const tools = h(
      "div",
      { class: "note-tools" },
      ...NOTE_COLORS.map((color) => {
        const swatch = h("button", { type: "button", class: "swatch", "aria-label": t("noteColor", t(NOTE_COLOR_NAME[color])), "aria-pressed": String(note.color === color), onclick: () => update(note.id, { color }, true) });
        swatch.style.setProperty("--swatch", NOTE_SWATCH[color]);
        return swatch;
      }),
      h("span", { class: "spacer" }),
      iconButton("pin", note.pinned ? t("unpinNote") : t("pinNote"), () => update(note.id, { pinned: !note.pinned }, true), { "aria-pressed": String(note.pinned) }),
      iconButton("trash", t("deleteNote"), () => {
        notes = notes.filter((other) => other.id !== note.id);
        void persist();
        render();
      }),
    );
    return h("article", { class: "note", "data-note": note.id, "data-color": note.color }, text, tools);
  }

  function render(): void {
    list.replaceChildren(...(notes.length ? sortNotes(notes).map(noteCard) : [h("p", { class: "empty" }, t("notesEmpty"))]));
  }

  void chrome.storage.local.get("notes").then((stored) => {
    notes = sanitizeNotes(stored.notes);
    render();
  });
}
