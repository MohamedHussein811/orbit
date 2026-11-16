// Tells Shields when a person opens a link in a background tab on purpose (middle click, Ctrl, Cmd
// or Shift click, or the link's menu), so only tabs a page opens behind their back count as
// pop-unders. Nothing about the page or the link is sent, only that it happened.

function report(event: MouseEvent): void {
  const deliberate = event.type === "contextmenu" || event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey;
  if (!deliberate) return;
  const onLink = event.composedPath().some((target) => target instanceof HTMLAnchorElement && target.hasAttribute("href"));
  if (!onLink) return;
  try {
    void chrome.runtime.sendMessage({ type: "open-intent" }).catch(() => {});
  } catch {
    // The extension was updated while the page stayed open.
  }
}

for (const type of ["click", "auxclick", "contextmenu"] as const) addEventListener(type, report, { capture: true, passive: true });
