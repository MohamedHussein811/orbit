// Runs before first paint, so a light theme never flashes dark. The cached value comes from newtab.ts.
try {
  const theme = localStorage.getItem("orbit-theme");
  if (theme) document.documentElement.dataset.theme = theme;
  const accent = localStorage.getItem("orbit-accent");
  if (accent) document.documentElement.style.setProperty("--accent", accent);
} catch {
  // Storage can be unavailable. The page still renders with its default theme.
}
