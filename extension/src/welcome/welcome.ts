// Orbit's welcome tour, shown once on a new profile and again from the privacy page: what Orbit
// is, that protection is on, bringing bookmarks, history and passwords from another browser, and
// the way out. Every step can be skipped, and nothing is imported unless the person asks.

import { localizePage, t } from "../shared/i18n.ts";

const steps = [...document.querySelectorAll<HTMLElement>(".step")];
const count = document.getElementById("step-count")!;
const dots = document.querySelector<HTMLElement>(".dots")!;
const back = document.getElementById("back") as HTMLButtonElement;
const next = document.getElementById("next") as HTMLButtonElement;
let current = 0;

const openPage = (url: string) => void chrome.tabs.create({ url });

function finish(): void {
  void chrome.storage.local.set({ welcomeShown: true });
  void chrome.tabs.getCurrent().then((tab) => (tab?.id !== undefined ? chrome.tabs.update(tab.id, { url: "chrome://newtab/" }) : undefined));
}

function show(index: number, focus = true): void {
  current = Math.max(0, Math.min(index, steps.length - 1));
  steps.forEach((step, n) => (step.hidden = n !== current));
  count.textContent = t("welcomeStep", current + 1, steps.length);
  dots.replaceChildren(...steps.map((_, n) => Object.assign(document.createElement("span"), { className: n === current ? "dot on" : "dot" })));
  back.hidden = current === 0;
  next.textContent = t(current === steps.length - 1 ? "welcomeStart" : "welcomeNext");
  if (focus) steps[current]!.querySelector<HTMLElement>("h1")?.focus();
}

document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
localizePage();
for (const heading of document.querySelectorAll<HTMLElement>(".step h1")) heading.tabIndex = -1;
show(0, false);

next.addEventListener("click", () => (current === steps.length - 1 ? finish() : show(current + 1)));
back.addEventListener("click", () => show(current - 1));
document.getElementById("skip")!.addEventListener("click", finish);
document.getElementById("import")!.addEventListener("click", () => openPage("chrome://settings/importData"));
document.getElementById("passwords")!.addEventListener("click", () => openPage("chrome://password-manager/settings"));
document.getElementById("default-browser")!.addEventListener("click", () => openPage("chrome://settings/defaultBrowser"));
document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLElement && event.target.closest("details, button, a")) return;
  const rtl = document.documentElement.dir === "rtl";
  if (event.key === (rtl ? "ArrowLeft" : "ArrowRight")) show(current + 1);
  if (event.key === (rtl ? "ArrowRight" : "ArrowLeft")) show(current - 1);
});
