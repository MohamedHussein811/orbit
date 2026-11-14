// Orbit's notes in the side panel. The same notes as the new tab page, stored in the local profile.

import { mountNotes } from "../newtab/widgets.ts";
import { localizePage } from "../shared/i18n.ts";

localizePage();
mountNotes(document.getElementById("notes")!);
