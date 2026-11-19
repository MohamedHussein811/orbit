// Orbit's registered content scripts persist across browser restarts. Each register or unregister
// call makes the browser reprocess every registered script (over 20,000 site patterns), so only the
// scripts that changed are touched, in one call each. A script whose files and options stay the same
// and only its sites change is updated in place, which costs a tenth of unregistering and
// registering it again.

export interface ScriptSpec {
  id: string;
  js?: string[];
  css?: string[];
  matches?: string[];
  excludeMatches?: string[];
  allFrames?: boolean;
  matchOriginAsFallback?: boolean;
  runAt?: string;
  world?: string;
}

export interface ScriptPlan {
  unregister: string[];
  update: ScriptSpec[];
  register: ScriptSpec[];
}

const sameList = (a: readonly string[] = [], b: readonly string[] = []) => a.length === b.length && a.every((item, n) => item === b[n]);
const sameSet = (a: readonly string[] = [], b: readonly string[] = []) => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((item) => right.has(item));
};

/** Same files and options; the sites may differ. */
function sameShape(a: ScriptSpec, b: ScriptSpec): boolean {
  return (
    a.id === b.id &&
    sameList(a.js, b.js) &&
    sameList(a.css, b.css) &&
    Boolean(a.allFrames) === Boolean(b.allFrames) &&
    Boolean(a.matchOriginAsFallback) === Boolean(b.matchOriginAsFallback) &&
    (a.runAt ?? "document_idle") === (b.runAt ?? "document_idle") &&
    (a.world ?? "ISOLATED") === (b.world ?? "ISOLATED")
  );
}

export function sameScript(a: ScriptSpec, b: ScriptSpec): boolean {
  return sameShape(a, b) && sameSet(a.matches, b.matches) && sameSet(a.excludeMatches, b.excludeMatches);
}

/** What to unregister, update and register so that the owned scripts match |wanted|. Scripts that
 * |owns| rejects are left alone. */
export function planScripts(registered: readonly ScriptSpec[], wanted: readonly ScriptSpec[], owns: (id: string) => boolean): ScriptPlan {
  const current = new Map(registered.filter((script) => owns(script.id)).map((script) => [script.id, script]));
  const wantedIds = new Set(wanted.map((script) => script.id));
  const plan: ScriptPlan = { unregister: [...current.keys()].filter((id) => !wantedIds.has(id)), update: [], register: [] };
  for (const script of wanted) {
    const existing = current.get(script.id);
    if (existing && sameScript(existing, script)) continue;
    if (existing && sameShape(existing, script)) {
      plan.update.push({ id: script.id, matches: script.matches ?? [], excludeMatches: script.excludeMatches ?? [] });
      continue;
    }
    if (existing) plan.unregister.push(script.id);
    plan.register.push(script);
  }
  return plan;
}
