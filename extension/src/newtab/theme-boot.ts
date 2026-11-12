// Runs before first paint, so the page never flashes the wrong theme or background.
document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
try {
  const background = localStorage.getItem("orbit-background");
  if (background) document.documentElement.dataset.background = background;
} catch {
  // Storage can be unavailable. The page still renders with the default background.
}
