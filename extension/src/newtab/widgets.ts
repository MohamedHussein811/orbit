// The dashboard's widgets. Each one renders into its own frame and keeps working when another fails.

import type { Settings } from "../shared/settings.ts";
import { PERIODS, sanitizeStats, summarize, type Period } from "../shared/stats.ts";
import type { Message } from "../shared/shields.ts";
import {
  describeWeather,
  forecastUrl,
  geocodeUrl,
  isFresh,
  parseForecast,
  parsePlaces,
  WEATHER_PROVIDER,
  type WeatherPlace,
  type WeatherReport,
} from "../shared/weather.ts";
import { createNote, NOTE_COLORS, patchNote, sanitizeNotes, sortNotes, type Note, type NoteColor } from "../shared/notes.ts";
import { debounce, h, icon, iconButton } from "./dom.ts";

export interface WidgetContext {
  settings: () => Settings;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
}

const PERIOD_LABEL: Record<Period, string> = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days", all: "All time" };

// Search
function looksLikeAddress(text: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(text) || /^localhost(:\d+)?(\/\S*)?$/i.test(text);
}

export function mountSearch(root: HTMLElement): void {
  const input = h("input", { type: "search", name: "q", placeholder: "Search the web or enter an address", "aria-label": "Search the web or enter an address", autocomplete: "off", spellcheck: "false" });
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
  const numbers = {
    ads: h("dd", {}, "0"),
    trackers: h("dd", {}, "0"),
    threats: h("dd", {}, "0"),
  };
  const select = h(
    "select",
    {
      "aria-label": "Reporting period",
      onchange: () => {
        void context.saveSettings({ statsPeriod: select.value as Period });
        void refresh();
      },
    },
    ...PERIODS.map((period) => h("option", { value: period }, PERIOD_LABEL[period])),
  );
  select.value = context.settings().statsPeriod;

  const reset = h("button", { type: "button", class: "link", onclick: () => confirmReset() }, "Reset counts");
  const footEnd = h("span", {}, reset);

  function confirmReset(): void {
    footEnd.replaceChildren(
      "Reset all counts? ",
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
        "Reset",
      ),
      " ",
      h("button", { type: "button", class: "link", onclick: () => footEnd.replaceChildren(reset) }, "Keep"),
    );
  }

  async function refresh(): Promise<void> {
    const { stats } = await chrome.storage.local.get("stats");
    const totals = summarize(sanitizeStats(stats), context.settings().statsPeriod, Date.now());
    numbers.ads.textContent = totals.ads.toLocaleString();
    numbers.trackers.textContent = totals.trackers.toLocaleString();
    numbers.threats.textContent = totals.threats.toLocaleString();
  }

  root.append(
    h("div", { class: "widget-head" }, h("h2", {}, "Protection"), select),
    h(
      "dl",
      { class: "stat-row" },
      h("div", { class: "stat" }, numbers.ads, h("dt", {}, "Ads blocked")),
      h("div", { class: "stat" }, numbers.trackers, h("dt", {}, "Trackers blocked")),
      h("div", { class: "stat" }, numbers.threats, h("dt", {}, "Threats stopped")),
    ),
    h("div", { class: "foot" }, h("span", {}, "Counted on this device. Nothing is sent anywhere."), footEnd),
  );
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.stats) void refresh();
  });
  void refresh();
}

// Bookmarks
type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;
const BOOKMARKS_BAR = "1";

function faviconUrl(pageUrl: string): string {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", "32");
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

function bookmarkEditor(options: { title: string; url?: string; isFolder: boolean; heading: string; onSave: (title: string, url?: string) => Promise<void>; onDelete?: () => Promise<void> }): void {
  const titleInput = h("input", { type: "text", value: options.title, "aria-label": "Name" });
  const urlInput = options.isFolder ? null : h("input", { type: "text", inputmode: "url", value: options.url ?? "", "aria-label": "Address", placeholder: "example.com", spellcheck: "false" });
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
          const title = titleInput.value.trim() || "Untitled";
          let url: string | undefined;
          if (urlInput) {
            const valid = validBookmarkUrl(urlInput.value.trim());
            if (!valid) {
              error.textContent = "Enter a valid web address, such as example.com.";
              return;
            }
            url = valid;
          }
          await options.onSave(title, url);
          close();
        },
      },
      h("h2", {}, options.heading),
      h("label", { class: "field" }, h("span", {}, "Name"), titleInput),
      urlInput && h("label", { class: "field" }, h("span", {}, "Address"), urlInput),
      error,
      h(
        "div",
        { class: "editor-actions" },
        options.onDelete &&
          h(
            "button",
            {
              type: "button",
              class: "ghost danger",
              onclick: async () => {
                await options.onDelete!();
                close();
              },
            },
            "Delete",
          ),
        h("span", { class: "spacer" }),
        h("button", { type: "button", class: "ghost", onclick: close }, "Cancel"),
        h("button", { type: "submit", class: "primary" }, "Save"),
      ),
    ),
  );
  document.body.append(dialog);
  dialog.showModal();
  titleInput.select();
}

export function mountBookmarks(root: HTMLElement, context: WidgetContext): void {
  root.classList.add("pane");
  const tabs = h("div", { class: "tabs", role: "tablist", "aria-label": "Bookmark collections" });
  const addBookmark = h("button", { type: "button", class: "ghost", onclick: () => editNew(false) }, "Add bookmark");
  const addFolder = h("button", { type: "button", class: "ghost", onclick: () => editNew(true) }, "New folder");
  const head = h("div", { class: "widget-head" }, tabs, h("div", { class: "tabs" }, addBookmark, addFolder));
  const body = h("div", {});
  root.append(head, body);

  let current = context.settings().bookmarksFolder ?? BOOKMARKS_BAR;
  let dragId: string | null = null;

  function editNew(isFolder: boolean): void {
    bookmarkEditor({
      title: "",
      isFolder,
      heading: isFolder ? "New folder" : "Add bookmark",
      onSave: async (title, url) => {
        await chrome.bookmarks.create({ parentId: current, title, url });
      },
    });
  }

  function openFolder(id: string): void {
    current = id;
    void context.saveSettings({ bookmarksFolder: id });
    void render();
  }

  function tile(node: BookmarkNode, parent: BookmarkNode, index: number): HTMLElement {
    const isFolder = !node.url;
    const edit = iconButton(
      "edit",
      `Edit ${node.title || "bookmark"}`,
      () =>
        bookmarkEditor({
          title: node.title,
          url: node.url,
          isFolder,
          heading: isFolder ? "Edit folder" : "Edit bookmark",
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
    iconBox.append(isFolder ? icon("folder") : h("img", { src: faviconUrl(node.url!), alt: "", width: 24, height: 24, loading: "lazy" }));
    const label = h("span", { class: "tile-title" }, node.title || node.url || "Untitled");
    const open = isFolder
      ? h("button", { type: "button", class: "open-folder", onclick: () => openFolder(node.id) }, iconBox, label)
      : h("a", { href: node.url!, onclick: (event: Event) => openUrl(node.url!, event) }, iconBox, label);
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

  async function render(): Promise<void> {
    const [tree] = await chrome.bookmarks.getTree();
    const roots = (tree?.children ?? []).filter((node) => node.id === BOOKMARKS_BAR || (node.children?.length ?? 0) > 0);
    const [folder] = await chrome.bookmarks.getSubTree(current).catch(() => chrome.bookmarks.getSubTree(BOOKMARKS_BAR));
    if (!folder) return;
    current = folder.id;

    const activeRoot = roots.find((node) => node.id === folder.id)?.id ?? null;
    tabs.replaceChildren(
      ...roots.map((node) =>
        h("button", { type: "button", role: "tab", "aria-selected": String(node.id === activeRoot), onclick: () => openFolder(node.id) }, node.title),
      ),
    );

    const children = folder.children ?? [];
    const list = h("ul", { class: "tiles" }, ...children.map((node, index) => tile(node, folder, index)));
    const crumb = activeRoot
      ? null
      : h("div", { class: "crumb" }, iconButton("back", "Back to the parent folder", () => openFolder(folder.parentId ?? BOOKMARKS_BAR)), h("span", {}, folder.title));
    const empty = h(
      "p",
      { class: "empty" },
      "No bookmarks here yet. Add one, or ",
      h("button", { type: "button", class: "link", onclick: () => void chrome.tabs.create({ url: "chrome://settings/importData" }) }, "import them from another browser"),
      ".",
    );
    body.replaceChildren(...(crumb ? [crumb] : []), children.length ? list : empty);
  }

  for (const event of [chrome.bookmarks.onCreated, chrome.bookmarks.onRemoved, chrome.bookmarks.onChanged, chrome.bookmarks.onMoved, chrome.bookmarks.onChildrenReordered]) {
    (event as chrome.events.Event<() => void>).addListener(() => void render());
  }
  void render();
}

// Weather
export function mountWeather(root: HTMLElement, context: WidgetContext): void {
  root.classList.add("pane");
  const body = h("div", {});
  const credit = h("a", { href: WEATHER_PROVIDER.url, class: "link" }, `Weather by ${WEATHER_PROVIDER.name}`);
  const unit = h("button", { type: "button", class: "link", onclick: () => toggleUnit() });
  root.append(h("div", { class: "widget-head" }, h("h2", {}, "Weather"), unit), body, h("div", { class: "foot" }, credit));

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

  function showPlaceForm(message?: string): void {
    const input = h("input", { type: "text", placeholder: "City name", "aria-label": "City name" });
    const results = h("ul", { class: "place-results" });
    const form = h(
      "form",
      {
        class: "place-form",
        onsubmit: async (event: Event) => {
          event.preventDefault();
          const query = input.value.trim();
          if (!query) return;
          results.replaceChildren();
          try {
            const res = await fetch(geocodeUrl(query), { credentials: "omit", referrerPolicy: "no-referrer" });
            const places = parsePlaces(await res.json());
            if (!places.length) {
              results.append(h("li", { class: "notice" }, "No place found with that name. Check the spelling."));
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
            results.append(h("li", { class: "notice" }, "Could not reach the weather service. Check your connection and try again."));
          }
        },
      },
      input,
      h("button", { type: "submit", class: "ghost" }, "Find"),
    );
    body.replaceChildren(
      h("p", { class: "notice" }, message ?? `Enter your city to see the weather. Your search goes to ${WEATHER_PROVIDER.name}.`),
      form,
      results,
    );
  }

  async function render(): Promise<void> {
    const unitName = context.settings().temperatureUnit;
    unit.textContent = unitName === "celsius" ? "Show in °F" : "Show in °C";
    const { place, report: cached } = await load();
    if (!place) {
      showPlaceForm();
      return;
    }
    let report = cached;
    let failed = false;
    if (!isFresh(report, Date.now())) {
      try {
        const res = await fetch(forecastUrl(place, unitName), { credentials: "omit", referrerPolicy: "no-referrer" });
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
    }
    const change = h("button", { type: "button", class: "link", onclick: () => showPlaceForm() }, "Change city");
    if (!report) {
      body.replaceChildren(h("p", { class: "weather-place" }, place.name), h("p", { class: "notice" }, "Weather is unavailable right now. Check your connection."), change);
      return;
    }
    const symbol = unitName === "celsius" ? "°C" : "°F";
    body.replaceChildren(
      h(
        "div",
        { class: "weather-now" },
        h("span", { class: "weather-temp" }, `${report.temperature}${symbol}`),
        h("span", { class: "weather-range" }, `High ${report.high}° Low ${report.low}°`),
      ),
      h("p", { class: "weather-place" }, place.name),
      h("p", { class: "weather-condition" }, describeWeather(report.code)),
      ...(failed ? [h("p", { class: "notice" }, `Showing the last update, from ${new Date(report.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`)] : []),
      change,
    );
  }
  void render();
}

// Notes
const NOTE_SWATCH: Record<NoteColor, string> = { ion: "#8d9bff", amber: "#f2b75b", rose: "#f28ca8", mint: "#5fd4c8", slate: "#9aa3b8" };

export function mountNotes(root: HTMLElement): void {
  root.classList.add("pane");
  let notes: Note[] = [];
  const list = h("div", { class: "notes-list" });
  root.append(h("div", { class: "widget-head" }, h("h2", {}, "Notes"), h("button", { type: "button", class: "ghost", onclick: () => add() }, "Add note")), list);

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
    const text = h("textarea", { "aria-label": "Note text", placeholder: "Write a note", oninput: () => update(note.id, { text: text.value }, false) });
    text.value = note.text;
    const tools = h(
      "div",
      { class: "note-tools" },
      ...NOTE_COLORS.map((color) => {
        const swatch = h("button", { type: "button", class: "swatch", "aria-label": `Color ${color}`, "aria-pressed": String(note.color === color), onclick: () => update(note.id, { color }, true) });
        swatch.style.setProperty("--swatch", NOTE_SWATCH[color]);
        return swatch;
      }),
      h("span", { class: "spacer" }),
      iconButton("pin", note.pinned ? "Unpin note" : "Pin note", () => update(note.id, { pinned: !note.pinned }, true), { "aria-pressed": String(note.pinned) }),
      iconButton("trash", "Delete note", () => {
        notes = notes.filter((other) => other.id !== note.id);
        void persist();
        render();
      }),
    );
    return h("article", { class: "note", "data-note": note.id, "data-color": note.color }, text, tools);
  }

  function render(): void {
    if (!notes.length) {
      list.replaceChildren(h("p", { class: "empty" }, "No notes yet. Notes stay on this device."));
      return;
    }
    list.replaceChildren(...sortNotes(notes).map(noteCard));
  }

  void chrome.storage.local.get("notes").then((stored) => {
    notes = sanitizeNotes(stored.notes);
    render();
  });
}

