// Once a day, when allowed, asks Orbit's release page for the newest version. Only the answer is
// kept, and only while it is newer than the running browser.

import { readPrivacy } from "./privacy.ts";
import { CHECK_PERIOD_MINUTES, isNewer, LATEST_URL, runningVersion, sanitizeRelease } from "../shared/updates.ts";

export const UPDATE_ALARM = "orbit-update-check";

export async function scheduleUpdateCheck(): Promise<void> {
  if (!(await chrome.alarms.get(UPDATE_ALARM))) {
    await chrome.alarms.create(UPDATE_ALARM, { delayInMinutes: 5, periodInMinutes: CHECK_PERIOD_MINUTES });
  }
}

export async function checkForUpdate(): Promise<void> {
  if (!(await readPrivacy()).checkUpdates) return;
  try {
    const response = await fetch(LATEST_URL, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) return;
    const release = sanitizeRelease(await response.json());
    const running = await runningVersion();
    if (release && isNewer(release, running)) {
      await chrome.storage.local.set({ update: release });
    } else {
      await chrome.storage.local.remove("update");
    }
  } catch {
    // Offline or GitHub unreachable: try again at the next check.
  }
}
