import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultLayout, moveWidget, sanitizeLayout, updateWidget } from "../src/shared/layout.ts";
import { createNote, patchNote, sanitizeNotes, sortNotes } from "../src/shared/notes.ts";
import { excludeMatches, historyCutoff, removalOptions, sanitizePrivacy } from "../src/shared/privacy.ts";
import { DEFAULT_ACCENT, resolveTheme, sanitizeSettings } from "../src/shared/settings.ts";
import { allowRule, ALLOW_ID_BASE, categoryOfMatch, normalizeHosts, siteOf } from "../src/shared/shields.ts";
import { addCount, dayKey, emptyStats, pruneStats, sanitizeStats, summarize } from "../src/shared/stats.ts";
import { describeWeather, forecastUrl, isFresh, parseForecast, parsePlaces, roundCoordinate, WEATHER_CACHE_MS } from "../src/shared/weather.ts";

const NOW = new Date(2026, 10, 9, 12).getTime();
const DAY = 86_400_000;

test("stats add up by period", () => {
  const stats = emptyStats(NOW);
  addCount(stats, "ads", 5, NOW);
  addCount(stats, "ads", 2, NOW - 3 * DAY);
  addCount(stats, "trackers", 7, NOW - 20 * DAY);
  addCount(stats, "threats", 1, NOW - 100 * DAY);
  assert.deepEqual(summarize(stats, "today", NOW), { ads: 5, trackers: 0, threats: 0 });
  assert.deepEqual(summarize(stats, "7d", NOW), { ads: 7, trackers: 0, threats: 0 });
  assert.deepEqual(summarize(stats, "30d", NOW), { ads: 7, trackers: 7, threats: 0 });
  assert.deepEqual(summarize(stats, "all", NOW), { ads: 7, trackers: 7, threats: 1 });
});

test("pruned days stay in the all-time total", () => {
  const stats = emptyStats(NOW);
  addCount(stats, "ads", 4, NOW - 500 * DAY);
  pruneStats(stats, NOW);
  assert.deepEqual(Object.keys(stats.days), []);
  assert.equal(summarize(stats, "all", NOW).ads, 4);
});

test("corrupted stats become clean stats", () => {
  const clean = sanitizeStats({ since: "x", days: { bad: { ads: 1 }, [dayKey(NOW)]: { ads: -3, trackers: 2.9, threats: "x" } }, archived: null }, NOW);
  assert.deepEqual(clean.days, { [dayKey(NOW)]: { ads: 0, trackers: 2, threats: 0 } });
  assert.equal(clean.since, NOW);
  assert.deepEqual(sanitizeStats("nonsense", NOW), emptyStats(NOW));
});

test("corrupted layouts become usable layouts", () => {
  assert.deepEqual(sanitizeLayout(null), defaultLayout());
  assert.deepEqual(sanitizeLayout({ widgets: "x" }), defaultLayout());
  const partial = sanitizeLayout({ widgets: [{ id: "notes", visible: false, size: "large" }, { id: "nope" }, { id: "notes" }, { id: "weather", size: "large" }] });
  assert.deepEqual(partial.widgets.map((w) => w.id), ["notes", "weather", "search", "bookmarks", "stats"]);
  assert.equal(partial.widgets[0]!.visible, false);
  assert.equal(partial.widgets[1]!.size, "small");
});

test("layouts move and resize widgets within their allowed sizes", () => {
  const layout = moveWidget(defaultLayout(), "notes", 0);
  assert.equal(layout.widgets[0]!.id, "notes");
  assert.equal(moveWidget(layout, "notes", 99).widgets.at(-1)!.id, "notes");
  assert.equal(updateWidget(layout, "weather", { size: "large" }).widgets.find((w) => w.id === "weather")!.size, "small");
  assert.equal(updateWidget(layout, "stats", { size: "large" }).widgets.find((w) => w.id === "stats")!.size, "large");
});

test("notes keep pinned ones first, then the newest edits", () => {
  const a = { ...createNote("a", 1), updated: 5 };
  const b = { ...createNote("b", 1), updated: 9 };
  const c = { ...createNote("c", 1), updated: 1, pinned: true };
  assert.deepEqual(sortNotes([a, b, c]).map((n) => n.id), ["c", "b", "a"]);
});

test("corrupted notes are repaired or dropped", () => {
  const notes = sanitizeNotes([{ id: "x", text: "hi", color: "plaid" }, { id: "x", text: "dup" }, { text: "no id" }, null, { id: "y", text: 3 }], NOW);
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.color, "ion");
  assert.deepEqual(sanitizeNotes("nope"), []);
});

test("note edits ignore invalid values", () => {
  const [note] = patchNote([createNote("a", 1)], "a", { color: "plaid" as never, text: "new" }, 5);
  assert.equal(note!.color, "ion");
  assert.equal(note!.text, "new");
  assert.equal(note!.updated, 5);
});

test("settings fall back to safe defaults", () => {
  const settings = sanitizeSettings({ theme: "neon", accent: "red", statsPeriod: "never", temperatureUnit: "kelvin", bookmarksFolder: 4 });
  assert.equal(settings.theme, "space");
  assert.equal(settings.accent, DEFAULT_ACCENT);
  assert.equal(settings.statsPeriod, "7d");
  assert.equal(settings.temperatureUnit, "celsius");
  assert.equal(settings.bookmarksFolder, null);
  assert.equal(sanitizeSettings({ accent: "#ABCDEF" }).accent, "#abcdef");
});

test("the system theme follows the operating system", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("space", false), "space");
});

test("only block rules count as blocks", () => {
  assert.equal(categoryOfMatch("ads", 5), "ads");
  assert.equal(categoryOfMatch("trackers", ALLOW_ID_BASE - 1), "trackers");
  assert.equal(categoryOfMatch("ads", ALLOW_ID_BASE), null);
  assert.equal(categoryOfMatch("_dynamic", 1), null);
  assert.equal(categoryOfMatch("_session", 1), null);
});

test("site switches apply to web pages only", () => {
  assert.equal(siteOf("https://Example.COM/a?b=1"), "example.com");
  assert.equal(siteOf("chrome://settings"), null);
  assert.equal(siteOf("chrome-extension://abc/x.html"), null);
  assert.equal(siteOf("not a url"), null);
  assert.equal(siteOf(undefined), null);
});

test("host lists are cleaned before they become rules", () => {
  assert.deepEqual(normalizeHosts(["B.example", "a.example", "a.example", "bad host", 4, ""]), ["a.example", "b.example"]);
  assert.deepEqual(normalizeHosts("x"), []);
  const rule = allowRule(1, ["a.example"]);
  assert.equal(rule.action.type, "allowAllRequests");
  assert.ok(rule.priority! > 3, "must outrank every compiled rule");
});

test("privacy settings fall back to the protective default", () => {
  const settings = sanitizePrivacy({ fingerprinting: "x", webrtc: "y", clearOnStart: ["cookies", "nope", "cookies"], historyDays: 12 });
  assert.equal(settings.fingerprinting, "standard");
  assert.equal(settings.webrtc, "default_public_interface_only");
  assert.deepEqual(settings.clearOnStart, ["cookies"]);
  assert.equal(settings.historyDays, 0);
  assert.equal(sanitizePrivacy({ fingerprinting: "off" }).fingerprinting, "off");
});

test("clearing cookies clears all site storage", () => {
  const options = removalOptions(["cookies", "history"]);
  assert.equal(options.cookies, true);
  assert.equal(options.localStorage, true);
  assert.equal(options.indexedDB, true);
  assert.equal(options.history, true);
  assert.equal(options.cache, undefined);
  assert.deepEqual(removalOptions([]), {});
});

test("history cleanup only runs when chosen", () => {
  assert.equal(historyCutoff(0, NOW), null);
  assert.equal(historyCutoff(30, NOW), NOW - 30 * DAY);
});

test("sites with Shields off keep real values, subdomains included", () => {
  assert.deepEqual(excludeMatches(["a.example"]), ["*://a.example/*", "*://*.a.example/*"]);
});

test("weather requests round the location", () => {
  assert.equal(roundCoordinate(30.0626), 30.1);
  const url = new URL(forecastUrl({ latitude: 30.0626, longitude: 31.2497 }, "celsius"));
  assert.equal(url.searchParams.get("latitude"), "30.1");
  assert.equal(url.searchParams.get("longitude"), "31.2");
  assert.equal(url.hostname, "api.open-meteo.com");
});

test("weather parsing rejects incomplete answers", () => {
  const good = { current: { temperature_2m: 21.6, weather_code: 3, is_day: 1 }, daily: { temperature_2m_max: [25.2], temperature_2m_min: [14.5] } };
  assert.deepEqual(parseForecast(good, NOW), { temperature: 22, high: 25, low: 15, code: 3, isDay: true, fetchedAt: NOW });
  assert.equal(parseForecast({ current: {} }, NOW), null);
  assert.equal(parseForecast(null, NOW), null);
  assert.deepEqual(parsePlaces({ results: [{ name: "Cairo", latitude: 30, longitude: 31, country: "Egypt" }, { name: "x" }] }), [{ name: "Cairo", detail: "Egypt", latitude: 30, longitude: 31 }]);
  assert.equal(describeWeather(0), "Clear sky");
  assert.equal(describeWeather(1234), "Unknown conditions");
});

test("weather reports expire", () => {
  const report = parseForecast({ current: { temperature_2m: 1, weather_code: 0 }, daily: { temperature_2m_max: [1], temperature_2m_min: [1] } }, NOW)!;
  assert.equal(isFresh(report, NOW + 1000), true);
  assert.equal(isFresh(report, NOW + WEATHER_CACHE_MS + 1), false);
  assert.equal(isFresh(null, NOW), false);
});
