// The shortcuts a new profile starts with. They are ordinary bookmarks in the bookmarks bar, so
// people edit, move and remove them like their own. Their icons ship with Orbit, so showing them
// contacts none of these sites.

export interface DefaultShortcut {
  title: string;
  url: string;
  icon: string;
}

export const DEFAULT_SHORTCUTS: readonly DefaultShortcut[] = [
  { title: "Google", url: "https://www.google.com/", icon: "google" },
  { title: "YouTube", url: "https://www.youtube.com/", icon: "youtube" },
  { title: "Facebook", url: "https://www.facebook.com/", icon: "facebook" },
  { title: "Instagram", url: "https://www.instagram.com/", icon: "instagram" },
  { title: "X", url: "https://x.com/", icon: "x" },
  { title: "WhatsApp", url: "https://web.whatsapp.com/", icon: "whatsapp" },
  { title: "Wikipedia", url: "https://www.wikipedia.org/", icon: "wikipedia" },
];

const BUNDLED_ICONS: ReadonlyMap<string, string> = new Map(DEFAULT_SHORTCUTS.map((site) => [new URL(site.url).origin, site.icon]));

/** The icon Orbit ships for this site's origin, as a path inside the extension, or null. */
export function bundledIconPath(url: string): string | null {
  try {
    const name = BUNDLED_ICONS.get(new URL(url).origin);
    return name ? `/newtab/sites/${name}.svg` : null;
  } catch {
    return null;
  }
}

export const BOOKMARKS_BAR_ID = "1";

/** The folder shortcuts live in: the bookmarks bar, or on Android, which hides an empty bookmarks
 * bar from extensions and shows only Mobile bookmarks, the first folder there is. */
export async function shortcutsRootId(): Promise<string> {
  const [tree] = await chrome.bookmarks.getTree();
  const roots = tree?.children ?? [];
  return (roots.find((node) => node.id === BOOKMARKS_BAR_ID) ?? roots[0])?.id ?? BOOKMARKS_BAR_ID;
}

/** Adds the default shortcuts once per profile, and only to an empty shortcuts folder. The flag is
 * set first, so the background and the page never both add them; a failed attempt clears it, so a
 * later one tries again. */
export async function seedDefaultShortcuts(): Promise<boolean> {
  const { shortcutsSeeded } = await chrome.storage.local.get("shortcutsSeeded");
  if (shortcutsSeeded) return false;
  await chrome.storage.local.set({ shortcutsSeeded: true });
  try {
    const parentId = await shortcutsRootId();
    const existing = await chrome.bookmarks.getChildren(parentId);
    if (existing.length) return false;
    for (const site of DEFAULT_SHORTCUTS) {
      await chrome.bookmarks.create({ parentId, title: site.title, url: site.url });
    }
    return true;
  } catch (error) {
    await chrome.storage.local.set({ shortcutsSeeded: false });
    throw error;
  }
}
