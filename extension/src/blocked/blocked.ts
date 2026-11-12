// Warning page for a page load stopped by the threat lists. The blocked address arrives in the hash.

import { localizePage, t } from "../shared/i18n.ts";
import { siteOf, type Message } from "../shared/shields.ts";

document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
localizePage();

const target = location.hash.slice(1);
const host = siteOf(target);

const hostLine = document.getElementById("host")!;
hostLine.textContent = host ?? t("thisAddress");

document.getElementById("back")!.addEventListener("click", () => {
  if (history.length > 1) history.back();
  else location.replace("chrome://newtab/");
});

const continueButton = document.getElementById("continue") as HTMLButtonElement;
if (!host) continueButton.hidden = true;
continueButton.addEventListener("click", async () => {
  if (!host) return;
  const message: Message = { type: "continue-to-site", host };
  await chrome.runtime.sendMessage(message);
  location.replace(target);
});
