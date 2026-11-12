// Translated text for Orbit's built-in pages, from _locales through chrome.i18n.

export function t(key: string, ...substitutions: Array<string | number>): string {
  return chrome.i18n.getMessage(key, substitutions.map(String)) || key;
}

/** The browser's UI language as a two-letter code, such as "en" or "ar". */
export function uiLanguage(): string {
  return chrome.i18n.getUILanguage().split("-")[0]!.toLowerCase();
}

/** Sets the page language and direction, and fills elements marked with data-i18n. */
export function localizePage(root: ParentNode = document): void {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  document.documentElement.dir = chrome.i18n.getMessage("@@bidi_dir") || "ltr";
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n!);
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n-label]")) {
    element.setAttribute("aria-label", t(element.dataset.i18nLabel!));
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n-title]")) {
    element.title = t(element.dataset.i18nTitle!);
  }
  for (const element of root.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]")) {
    element.placeholder = t(element.dataset.i18nPlaceholder!);
  }
  const title = document.querySelector<HTMLElement>("title[data-i18n]");
  if (title) document.title = t(title.dataset.i18n!);
}
