// The new tab page's own right-click menu: page and link actions, instead of the browser's menu
// with Save as and Inspect. Text fields and selected text keep the browser's menu for copy and paste.

import { t } from "../shared/i18n.ts";
import { h, icon } from "./dom.ts";
import { tileMenus } from "./widgets.ts";

interface MenuItem {
  label: string;
  icon?: string;
  disabled?: boolean;
  run: () => void;
}

type Entry = MenuItem | "separator";

interface NavigationState {
  canGoBack?: boolean;
  canGoForward?: boolean;
}

let open: HTMLElement | null = null;

/** Back and forward arrows point the other way in right-to-left languages. */
function flipped(svg: SVGSVGElement, name: string): SVGSVGElement {
  if (name === "back" || name === "forward") svg.classList.add("flip");
  return svg;
}

function close(): void {
  open?.remove();
  open = null;
}

function show(entries: Entry[], x: number, y: number): void {
  close();
  const items: HTMLButtonElement[] = [];
  const menu = h(
    "div",
    { class: "context-menu", role: "menu", "aria-label": t("pageMenu") },
    ...entries.map((entry) => {
      if (entry === "separator") return h("div", { class: "context-separator", role: "separator" });
      const item = h(
        "button",
        {
          type: "button",
          role: "menuitem",
          class: "context-item",
          disabled: entry.disabled ?? false,
          tabindex: "-1",
          onclick: () => {
            close();
            entry.run();
          },
        },
        entry.icon ? flipped(icon(entry.icon), entry.icon) : h("span", { class: "context-icon-space" }),
        h("span", {}, entry.label),
      );
      items.push(item);
      return item;
    }),
  );
  menu.addEventListener("keydown", (event) => {
    const enabled = items.filter((item) => !item.disabled);
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      enabled[(index + step + enabled.length) % enabled.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? enabled[0] : enabled.at(-1))?.focus();
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      close();
    }
  });
  document.body.append(menu);
  open = menu;
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - height - 8))}px`;
  items.find((item) => !item.disabled)?.focus({ preventScroll: true });
}

function linkEntries(url: string): Entry[] {
  return [
    { label: t("openInNewTab"), icon: "tab", run: () => void chrome.tabs.create({ url, active: false }) },
    { label: t("openInNewWindow"), icon: "window", run: () => void chrome.windows.create({ url }) },
    { label: t("openInPrivateWindow"), icon: "private", run: () => void chrome.windows.create({ url, incognito: true }) },
    "separator",
    { label: t("copyLink"), icon: "copy", run: () => void navigator.clipboard.writeText(url) },
  ];
}

/** A shortcut's own actions first, then the usual link actions. */
function tileEntries(tile: Element, url: string | null): Entry[] | null {
  const menu = tileMenus.get(tile);
  if (!menu) return null;
  const own: Entry[] = [];
  if (menu.edit) own.push({ label: menu.edit.label, icon: "edit", run: menu.edit.run });
  if (menu.remove) own.push({ label: menu.remove.label, icon: "trash", run: menu.remove.run });
  return url ? [...own, "separator", ...linkEntries(url)] : own;
}

function pageEntries(actions: { customize: () => void }): Entry[] {
  const navigation = (window as unknown as { navigation?: NavigationState }).navigation;
  return [
    { label: t("back"), icon: "back", disabled: navigation ? !navigation.canGoBack : history.length < 2, run: () => history.back() },
    { label: t("forward"), icon: "forward", disabled: navigation ? !navigation.canGoForward : false, run: () => history.forward() },
    { label: t("reload"), icon: "reload", run: () => location.reload() },
    "separator",
    { label: t("addShortcut"), icon: "plus", run: () => document.dispatchEvent(new CustomEvent("orbit:add-shortcut")) },
    { label: t("customize"), icon: "sliders", run: actions.customize },
    "separator",
    { label: t("bookmarksManager"), icon: "bookmark", run: () => void chrome.tabs.update({ url: "chrome://bookmarks" }) },
    { label: t("historyPage"), icon: "history", run: () => void chrome.tabs.update({ url: "chrome://history" }) },
  ];
}

export function installContextMenu(actions: { customize: () => void }): void {
  document.addEventListener("contextmenu", (event) => {
    const target = event.target as Element | null;
    if (target?.closest(".context-menu")) {
      event.preventDefault();
      return;
    }
    const editable = target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
    const selected = (getSelection()?.toString() ?? "").trim() !== "";
    if (editable || selected || target?.closest("dialog")) return;
    event.preventDefault();
    const link = target?.closest<HTMLAnchorElement>("a[href]");
    const url = link && /^https?:/i.test(link.href) ? link.href : null;
    const fromKeyboard = event.button !== 2 && event.clientX === 0 && event.clientY === 0;
    const anchor = fromKeyboard ? (document.activeElement ?? document.body).getBoundingClientRect() : null;
    const tile = target?.closest(".tile");
    const entries = (tile && tileEntries(tile, url)) || (url ? linkEntries(url) : pageEntries(actions));
    show(entries, anchor ? anchor.left + 8 : event.clientX, anchor ? anchor.bottom + 4 : event.clientY);
  });
  document.addEventListener("pointerdown", (event) => {
    if (open && !open.contains(event.target as Node)) close();
  });
  for (const name of ["blur", "resize"] as const) addEventListener(name, close);
  document.addEventListener("scroll", close, true);
}
