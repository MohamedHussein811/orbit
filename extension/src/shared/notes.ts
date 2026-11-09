// Sticky notes model. Stored only in the local profile.

export const NOTE_COLORS = ["ion", "amber", "rose", "mint", "slate"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export const MAX_NOTE_LENGTH = 20_000;
export const MAX_NOTES = 200;

export interface Note {
  id: string;
  text: string;
  color: NoteColor;
  pinned: boolean;
  created: number;
  updated: number;
}

function isColor(value: unknown): value is NoteColor {
  return typeof value === "string" && (NOTE_COLORS as readonly string[]).includes(value);
}

export function sanitizeNotes(raw: unknown, now: number = Date.now()): Note[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const notes: Note[] = [];
  for (const item of raw.slice(0, MAX_NOTES)) {
    const candidate = item as Partial<Note> | null;
    if (!candidate || typeof candidate.id !== "string" || !candidate.id || seen.has(candidate.id)) continue;
    if (typeof candidate.text !== "string") continue;
    seen.add(candidate.id);
    notes.push({
      id: candidate.id,
      text: candidate.text.slice(0, MAX_NOTE_LENGTH),
      color: isColor(candidate.color) ? candidate.color : "ion",
      pinned: candidate.pinned === true,
      created: typeof candidate.created === "number" ? candidate.created : now,
      updated: typeof candidate.updated === "number" ? candidate.updated : now,
    });
  }
  return notes;
}

/** Pinned notes first, then most recently edited. */
export function sortNotes(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updated - a.updated;
  });
}

export function createNote(id: string, now: number, color: NoteColor = "ion"): Note {
  return { id, text: "", color, pinned: false, created: now, updated: now };
}

export function patchNote(notes: readonly Note[], id: string, patch: Partial<Pick<Note, "text" | "color" | "pinned">>, now: number): Note[] {
  return notes.map((note) => {
    if (note.id !== id) return note;
    const next: Note = { ...note, updated: now };
    if (typeof patch.text === "string") next.text = patch.text.slice(0, MAX_NOTE_LENGTH);
    if (isColor(patch.color)) next.color = patch.color;
    if (typeof patch.pinned === "boolean") next.pinned = patch.pinned;
    return next;
  });
}
