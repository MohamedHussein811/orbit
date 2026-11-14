// Runs in YouTube's pages before their own scripts. YouTube serves video ads from its own servers,
// so blocking requests cannot stop them. Instead this removes the ad entries from the player data
// (the first page load and every later video), so the player has no ads to play.

(() => {
  const AD_KEYS = ["adPlacements", "adSlots", "playerAds", "adBreakHeartbeatParams"];

  function prune(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const data = value as Record<string, unknown>;
    for (const key of AD_KEYS) {
      if (key in data) delete data[key];
    }
    prune(data.playerResponse);
    if (Array.isArray(data)) for (const item of data) prune((item as Record<string, unknown> | null)?.playerResponse);
  }

  // Data that arrives as text.
  const parse = JSON.parse;
  JSON.parse = function (this: unknown, ...args: Parameters<typeof JSON.parse>) {
    const result = parse.apply(this, args);
    prune(result);
    return result;
  };

  // Data that later videos fetch.
  const readJson = Response.prototype.json;
  Response.prototype.json = async function (this: Response) {
    const result = await readJson.call(this);
    prune(result);
    return result;
  };

  // Data written into the first page as script.
  {
    let stored: unknown;
    try {
      Object.defineProperty(window, "ytInitialPlayerResponse", {
        configurable: true,
        get: () => stored,
        set: (value: unknown) => {
          prune(value);
          stored = value;
        },
      });
    } catch {
      // The page already defined it; the other paths still apply.
    }
  }
})();
