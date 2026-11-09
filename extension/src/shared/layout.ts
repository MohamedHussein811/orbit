// Dashboard widget layout. Stored layouts are always normalized on read, so a
// corrupted or outdated value can never break the new tab page.

export const WIDGET_IDS = ["search", "stats", "bookmarks", "weather", "notes"] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

export const WIDGET_SIZES = ["small", "medium", "large"] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];

export interface WidgetState {
  id: WidgetId;
  visible: boolean;
  size: WidgetSize;
}

export interface Layout {
  version: 1;
  widgets: WidgetState[];
}

/** Sizes each widget supports. The search box always spans the full width. */
export const ALLOWED_SIZES: Record<WidgetId, readonly WidgetSize[]> = {
  search: ["large"],
  stats: ["small", "medium", "large"],
  bookmarks: ["medium", "large"],
  weather: ["small", "medium"],
  notes: ["small", "medium", "large"],
};

export function defaultLayout(): Layout {
  return {
    version: 1,
    widgets: [
      { id: "search", visible: true, size: "large" },
      { id: "bookmarks", visible: true, size: "large" },
      { id: "stats", visible: true, size: "medium" },
      { id: "weather", visible: true, size: "small" },
      { id: "notes", visible: true, size: "medium" },
    ],
  };
}

function isWidgetId(value: unknown): value is WidgetId {
  return typeof value === "string" && (WIDGET_IDS as readonly string[]).includes(value);
}

export function sanitizeLayout(raw: unknown): Layout {
  const defaults = defaultLayout();
  const defaultsById = new Map(defaults.widgets.map((widget) => [widget.id, widget]));
  const source = (raw as Partial<Layout> | null | undefined)?.widgets;
  if (!Array.isArray(source)) return defaults;

  const seen = new Set<WidgetId>();
  const widgets: WidgetState[] = [];
  for (const item of source) {
    const candidate = item as Partial<WidgetState> | null;
    if (!candidate || !isWidgetId(candidate.id) || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    const fallback = defaultsById.get(candidate.id)!;
    const size = ALLOWED_SIZES[candidate.id].includes(candidate.size as WidgetSize)
      ? (candidate.size as WidgetSize)
      : fallback.size;
    widgets.push({
      id: candidate.id,
      visible: typeof candidate.visible === "boolean" ? candidate.visible : fallback.visible,
      size,
    });
  }
  for (const widget of defaults.widgets) {
    if (!seen.has(widget.id)) widgets.push(widget);
  }
  return { version: 1, widgets };
}

export function moveWidget(layout: Layout, id: WidgetId, toIndex: number): Layout {
  const widgets = [...layout.widgets];
  const from = widgets.findIndex((widget) => widget.id === id);
  if (from < 0) return layout;
  const [moved] = widgets.splice(from, 1);
  const target = Math.max(0, Math.min(toIndex, widgets.length));
  widgets.splice(target, 0, moved!);
  return { ...layout, widgets };
}

export function updateWidget(layout: Layout, id: WidgetId, patch: Partial<Pick<WidgetState, "visible" | "size">>): Layout {
  return {
    ...layout,
    widgets: layout.widgets.map((widget) => {
      if (widget.id !== id) return widget;
      const next = { ...widget, ...patch };
      if (!ALLOWED_SIZES[id].includes(next.size)) next.size = widget.size;
      return next;
    }),
  };
}

export function nextSize(id: WidgetId, size: WidgetSize): WidgetSize {
  const sizes = ALLOWED_SIZES[id];
  const index = sizes.indexOf(size);
  return sizes[(index + 1) % sizes.length]!;
}
