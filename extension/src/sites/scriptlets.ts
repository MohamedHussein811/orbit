// Scriptlets: small changes to a page's own scripts that stop pop-unders, redirects and ad loaders
// that request blocking cannot reach. Filter lists name them as `site##+js(name, args)`; Orbit's
// filter build turns those into data, and the extension build wraps this file around each data
// file (see tools/build-extension.mjs). It runs in the page's world before the page's scripts.
// These are Orbit's own implementations of the scriptlets uBlock Origin documents.

interface ScriptletData {
  calls: string[][];
  sites: Record<string, number[]>;
  except: Record<string, number[]>;
}

function orbitScriptlets(data: ScriptletData): void {
  type Owner = Record<string, unknown>;
  type Fn = (...args: unknown[]) => unknown;
  const win = window as unknown as Owner;
  const noop = () => {};

  // Site keys for this frame: the host and its parents, and the same names under any suffix.
  function frameHost(): string {
    if (location.hostname) return location.hostname;
    try {
      return new URL(self.origin).hostname;
    } catch {
      return "";
    }
  }

  function siteKeys(host: string): string[] {
    const labels = host.toLowerCase().split(".");
    const keys: string[] = [];
    for (let i = 0; i < labels.length - 1; i++) {
      const rest = labels.slice(i);
      keys.push(rest.join("."));
      for (let cut = 1; cut <= 2 && cut < rest.length; cut++) keys.push(`${rest.slice(0, -cut).join(".")}.*`);
    }
    return keys;
  }

  // A needle is text to find, a /regex/ with optional flags, or either after "!" to negate.
  function toRegex(needle: string, flags = ""): RegExp {
    const literal = /^\/(.+)\/([gimsu]*)$/.exec(needle);
    if (literal) {
      try {
        return new RegExp(literal[1]!, literal[2] || flags);
      } catch {
        return /(?!)/;
      }
    }
    return new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
  }

  function needleTest(needle: string | undefined): (text: string) => boolean {
    if (!needle) return () => true;
    const negated = needle.startsWith("!");
    const re = toRegex(negated ? needle.slice(1) : needle);
    return (text) => re.test(text) !== negated;
  }

  function delayTest(delay: string | undefined): (value: unknown) => boolean {
    if (!delay) return () => true;
    const negated = delay.startsWith("!");
    const wanted = Number(negated ? delay.slice(1) : delay);
    if (Number.isNaN(wanted)) return () => true;
    return (value) => (Number(value ?? 0) === wanted) !== negated;
  }

  function callbackText(callback: unknown): string {
    if (typeof callback === "function") return Function.prototype.toString.call(callback);
    if (callback && typeof callback === "object" && typeof (callback as { handleEvent?: unknown }).handleEvent === "function") {
      return Function.prototype.toString.call((callback as { handleEvent: Fn }).handleEvent);
    }
    return String(callback);
  }

  function findDescriptor(owner: object, prop: string): PropertyDescriptor | undefined {
    for (let current: object | null = owner; current; current = Object.getPrototypeOf(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, prop);
      if (descriptor) return descriptor;
    }
    return undefined;
  }

  // Waits for each object along a dotted path, then calls `onLast` with the last owner and name.
  function trapChain(owner: Owner, chain: string, onLast: (owner: Owner, prop: string) => void): void {
    const dot = chain.indexOf(".");
    if (dot === -1) {
      onLast(owner, chain);
      return;
    }
    const prop = chain.slice(0, dot);
    const rest = chain.slice(dot + 1);
    const value = owner[prop];
    if (value !== null && (typeof value === "object" || typeof value === "function")) {
      trapChain(value as Owner, rest, onLast);
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(owner, prop);
    if (descriptor && !descriptor.configurable) return;
    let current = value;
    try {
      Object.defineProperty(owner, prop, {
        configurable: true,
        enumerable: true,
        get: () => current,
        set: (next) => {
          current = next;
          if (next !== null && (typeof next === "object" || typeof next === "function")) trapChain(next as Owner, rest, onLast);
        },
      });
    } catch {
      // The page made this property fixed.
    }
  }

  function constantValue(raw: string): { value: unknown } | null {
    const named: Record<string, () => unknown> = {
      undefined: () => undefined,
      false: () => false,
      true: () => true,
      null: () => null,
      "": () => "",
      "''": () => "",
      emptyStr: () => "",
      noopFunc: () => noop,
      trueFunc: () => () => true,
      falseFunc: () => () => false,
      throwFunc: () => () => {
        throw new Error();
      },
      noopCallbackFunc: () => () => noop,
      emptyArr: () => [],
      "[]": () => [],
      emptyObj: () => ({}),
      "{}": () => ({}),
      yes: () => "yes",
      no: () => "no",
    };
    if (raw in named) return { value: named[raw]!() };
    if (/^-?\d+(\.\d+)?$/.test(raw) && Math.abs(Number(raw)) <= 32767) return { value: Number(raw) };
    return null;
  }

  function setConstant(chain: string, raw: string): void {
    const constant = constantValue(raw ?? "");
    if (!constant || !chain) return;
    trapChain(win, chain, (owner, prop) => {
      const descriptor = Object.getOwnPropertyDescriptor(owner, prop);
      if (descriptor && !descriptor.configurable) return;
      try {
        Object.defineProperty(owner, prop, { configurable: true, enumerable: true, get: () => constant.value, set: noop });
      } catch {
        // Fixed by the page.
      }
    });
  }

  function abortError(): ReferenceError {
    return new ReferenceError(`${Math.random().toString(36).slice(2)} is not defined`);
  }

  function abortOnRead(chain: string): void {
    if (!chain) return;
    trapChain(win, chain, (owner, prop) => {
      try {
        Object.defineProperty(owner, prop, {
          configurable: true,
          get: () => {
            throw abortError();
          },
          set: noop,
        });
      } catch {
        // Fixed by the page.
      }
    });
  }

  function abortOnWrite(chain: string): void {
    if (!chain) return;
    trapChain(win, chain, (owner, prop) => {
      const value = owner[prop];
      try {
        Object.defineProperty(owner, prop, {
          configurable: true,
          get: () => value,
          set: () => {
            throw abortError();
          },
        });
      } catch {
        // Fixed by the page.
      }
    });
  }

  // Throws when the property is used while a matching script runs (by its text, or its stack).
  function abortWhen(chain: string, shouldAbort: () => boolean): void {
    if (!chain) return;
    trapChain(win, chain, (owner, prop) => {
      const descriptor = findDescriptor(owner, prop);
      if (descriptor && Object.prototype.hasOwnProperty.call(owner, prop) && !descriptor.configurable) return;
      let value = descriptor && "value" in descriptor ? descriptor.value : undefined;
      try {
        Object.defineProperty(owner, prop, {
          configurable: true,
          get() {
            if (shouldAbort()) throw abortError();
            return descriptor?.get ? descriptor.get.call(this) : value;
          },
          set(next) {
            if (shouldAbort()) throw abortError();
            if (descriptor?.set) descriptor.set.call(this, next);
            else value = next;
          },
        });
      } catch {
        // Fixed by the page.
      }
    });
  }

  function abortCurrentScript(chain: string, needle: string, context?: string): void {
    const own = document.currentScript;
    const textMatches = needleTest(needle);
    const contextMatches = needleTest(context);
    abortWhen(chain, () => {
      const script = document.currentScript;
      if (!(script instanceof HTMLScriptElement) || script === own) return false;
      if (context && !contextMatches(script.src)) return false;
      return textMatches(script.src && !script.textContent ? script.src : script.textContent ?? "");
    });
  }

  function abortOnStackTrace(chain: string, needle: string): void {
    const matches = needleTest(needle);
    abortWhen(chain, () => matches(new Error().stack ?? ""));
  }

  function wrap(owner: Owner, prop: string, apply: (target: Fn, self: unknown, args: unknown[]) => unknown): void {
    const original = owner[prop];
    if (typeof original !== "function") return;
    owner[prop] = new Proxy(original as Fn, { apply: (target, self, args) => apply(target, self, args) });
  }

  function noWindowOpenIf(needle: string): void {
    const matches = needleTest(needle);
    wrap(win, "open", (target, self, args) => (matches(String(args[0] ?? "")) ? null : Reflect.apply(target, self, args)));
  }

  function noTimerIf(name: "setTimeout" | "setInterval", needle: string, delay: string): void {
    const matches = needleTest(needle);
    const delayMatches = delayTest(delay);
    wrap(win, name, (target, self, args) => {
      if (matches(callbackText(args[0])) && delayMatches(args[1])) args[0] = noop;
      return Reflect.apply(target, self, args);
    });
  }

  function timerBooster(name: "setTimeout" | "setInterval", needle: string, delay: string, boost: string): void {
    const matches = needleTest(needle);
    const wanted = delay === "*" ? null : Number(delay || 1000);
    const factor = Math.min(50, Math.max(0.001, Number(boost || 0.05) || 0.05));
    wrap(win, name, (target, self, args) => {
      if (matches(callbackText(args[0])) && (wanted === null || Number(args[1]) === wanted)) args[1] = Number(args[1] ?? 0) * factor;
      return Reflect.apply(target, self, args);
    });
  }

  function onNodes(nodeName: string, handle: (node: Node) => void): void {
    const wanted = nodeName.toLowerCase();
    const check = (node: Node) => {
      if (node.nodeName.toLowerCase() === wanted) handle(node);
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) check(node);
    });
    observer.observe(document, { childList: true, subtree: true });
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) check(node);
  }

  // Pages that require Trusted Types accept new script text only through a policy.
  type Policy = { createScript: (text: string) => unknown };
  let policy: Policy | null | undefined;
  function scriptText(text: string): unknown {
    if (policy === undefined) {
      try {
        const factory = (window as unknown as { trustedTypes?: { createPolicy: (name: string, rules: { createScript: (s: string) => string }) => Policy } }).trustedTypes;
        policy = factory ? factory.createPolicy(`orbit-${Math.random().toString(36).slice(2)}`, { createScript: (s) => s }) : null;
      } catch {
        policy = null;
      }
    }
    return policy ? policy.createScript(text) : text;
  }

  function setNodeText(node: Node, text: string): void {
    try {
      if (node.nodeName === "SCRIPT") (node as unknown as { textContent: unknown }).textContent = scriptText(text);
      else node.textContent = text;
    } catch {
      // The page refuses new script text. A script that should lose all of it is removed instead.
      if (text === "" && node.nodeName === "SCRIPT") (node as ChildNode).remove();
    }
  }

  function removeNodeText(nodeName: string, pattern: string): void {
    if (!nodeName || !pattern) return;
    const re = toRegex(pattern);
    onNodes(nodeName, (node) => {
      if (re.test(node.textContent ?? "")) setNodeText(node, "");
    });
  }

  function replaceNodeText(nodeName: string, pattern: string, replacement = ""): void {
    if (!nodeName || !pattern) return;
    const re = toRegex(pattern, "gms");
    onNodes(nodeName, (node) => {
      const text = node.textContent ?? "";
      re.lastIndex = 0;
      if (re.test(text)) setNodeText(node, text.replace(re, replacement));
    });
  }

  function addEventListenerDefuser(type: string, needle: string): void {
    const typeMatches = needleTest(type);
    const matches = needleTest(needle);
    wrap(EventTarget.prototype as unknown as Owner, "addEventListener", (target, self, args) => {
      if (typeMatches(String(args[0])) && matches(callbackText(args[1]))) return undefined;
      return Reflect.apply(target, self, args);
    });
  }

  // Request properties: "url:..." "method:..." pairs, or a bare needle for the URL.
  function requestMatcher(props: string): (request: Record<string, string>) => boolean {
    const tests = props
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => {
        const colon = /^(\w+):(.*)$/.exec(part);
        const [key, needle] = colon ? [colon[1]!, colon[2]!] : ["url", part];
        const test = needleTest(needle);
        return (request: Record<string, string>) => test(request[key] ?? "");
      });
    return (request) => tests.every((test) => test(request));
  }

  function fakeBody(kind: string | undefined): string {
    return kind === "emptyObj" ? "{}" : kind === "emptyArr" ? "[]" : "";
  }

  function noFetchIf(props: string, body?: string): void {
    if (!props && !body) return;
    const matches = requestMatcher(props);
    wrap(win, "fetch", (target, self, args) => {
      const input = args[0];
      const init = (args[1] ?? {}) as { method?: string };
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      const method = init.method ?? (input instanceof Request ? input.method : "GET");
      if (!matches({ url, method })) return Reflect.apply(target, self, args);
      return Promise.resolve(new Response(fakeBody(body), { status: 200, statusText: "OK" }));
    });
  }

  function noXhrIf(props: string, body?: string): void {
    if (!props) return;
    const matches = requestMatcher(props);
    const blocked = new WeakSet<XMLHttpRequest>();
    const proto = XMLHttpRequest.prototype as unknown as Owner;
    wrap(proto, "open", (target, self, args) => {
      const xhr = self as XMLHttpRequest;
      if (matches({ method: String(args[0] ?? "GET"), url: String(args[1] ?? "") })) blocked.add(xhr);
      else blocked.delete(xhr);
      return Reflect.apply(target, self, args);
    });
    wrap(proto, "send", (target, self, args) => {
      const xhr = self as XMLHttpRequest;
      if (!blocked.has(xhr)) return Reflect.apply(target, self, args);
      const text = fakeBody(body);
      Object.defineProperties(xhr, {
        readyState: { value: 4 },
        status: { value: 200 },
        statusText: { value: "OK" },
        responseText: { value: text },
        response: { value: text },
      });
      setTimeout(() => {
        for (const type of ["readystatechange", "load", "loadend"]) xhr.dispatchEvent(new Event(type));
      }, 1);
      return undefined;
    });
  }

  function noEvalIf(needle: string): void {
    const matches = needleTest(needle);
    wrap(win, "eval", (target, self, args) => (matches(String(args[0])) ? undefined : Reflect.apply(target, self, args)));
  }

  function prunePath(root: unknown, path: string[], remove: boolean): boolean {
    if (root === null || typeof root !== "object") return false;
    const [head, ...rest] = path;
    if (head === undefined) return false;
    const object = root as Record<string, unknown>;
    const keys = head === "[]" || head === "*" ? Object.keys(object) : [head];
    let found = false;
    for (const key of keys) {
      if (!(key in object)) continue;
      if (rest.length === 0) {
        found = true;
        if (remove) delete object[key];
      } else if (prunePath(object[key], rest, remove)) {
        found = true;
      }
    }
    return found;
  }

  function jsonPrune(toRemove: string, required?: string): void {
    const removals = (toRemove ?? "").split(/\s+/).filter(Boolean).map((path) => path.split("."));
    if (removals.length === 0) return;
    const needs = (required ?? "").split(/\s+/).filter(Boolean).map((path) => path.split("."));
    wrap(JSON as unknown as Owner, "parse", (target, self, args) => {
      const result = Reflect.apply(target, self, args);
      if (needs.every((path) => prunePath(result, path, false))) {
        for (const path of removals) prunePath(result, path, true);
      }
      return result;
    });
  }

  function whenDocumentReady(work: () => void): void {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", work, { once: true });
    else work();
  }

  function keepRemoving(selector: string, change: (element: Element) => void): void {
    if (!selector) return;
    const run = () => {
      try {
        for (const element of document.querySelectorAll(selector)) change(element);
      } catch {
        // Not a selector this browser accepts.
      }
    };
    let queued = false;
    whenDocumentReady(() => {
      run();
      new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          run();
        });
      }).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    });
  }

  function removeAttr(attrs: string, selector?: string): void {
    const names = (attrs ?? "").split(/\s*\|\s*/).filter(Boolean);
    if (names.length === 0) return;
    keepRemoving(selector || names.map((name) => `[${CSS.escape(name)}]`).join(","), (element) => {
      for (const name of names) element.removeAttribute(name);
    });
  }

  function removeClass(classes: string, selector?: string): void {
    const names = (classes ?? "").split(/\s*\|\s*/).filter(Boolean);
    if (names.length === 0) return;
    keepRemoving(selector || names.map((name) => `.${CSS.escape(name)}`).join(","), (element) => {
      element.classList.remove(...names);
    });
  }

  function setStorageItem(storage: "localStorage" | "sessionStorage", key: string, raw: string): void {
    if (!key) return;
    const values: Record<string, string> = { "": "", undefined: "undefined", null: "null", false: "false", true: "true", emptyArr: "[]", emptyObj: "{}", yes: "yes", no: "no", on: "on", off: "off" };
    try {
      const store = window[storage];
      if (raw === "$remove$") store.removeItem(key);
      else if (raw in values) store.setItem(key, values[raw]!);
      else if (/^\d+$/.test(raw) && Number(raw) <= 32767) store.setItem(key, raw);
    } catch {
      // Storage is off for this page.
    }
  }

  const RUN: Record<string, (args: string[]) => void> = {
    set: (a) => setConstant(a[0]!, a[1]!),
    aopr: (a) => abortOnRead(a[0]!),
    aopw: (a) => abortOnWrite(a[0]!),
    acs: (a) => abortCurrentScript(a[0]!, a[1]!, a[2]),
    aost: (a) => abortOnStackTrace(a[0]!, a[1]!),
    nowoif: (a) => noWindowOpenIf(a[0]!),
    nostif: (a) => noTimerIf("setTimeout", a[0]!, a[1]!),
    nosiif: (a) => noTimerIf("setInterval", a[0]!, a[1]!),
    "nano-sib": (a) => timerBooster("setInterval", a[0]!, a[1]!, a[2]!),
    "nano-stb": (a) => timerBooster("setTimeout", a[0]!, a[1]!, a[2]!),
    rmnt: (a) => removeNodeText(a[0]!, a[1]!),
    rpnt: (a) => replaceNodeText(a[0]!, a[1]!, a[2]),
    aeld: (a) => addEventListenerDefuser(a[0]!, a[1]!),
    "no-fetch-if": (a) => noFetchIf(a[0]!, a[1]),
    "no-xhr-if": (a) => noXhrIf(a[0]!, a[1]),
    "noeval-if": (a) => noEvalIf(a[0]!),
    noeval: () => noEvalIf(""),
    "json-prune": (a) => jsonPrune(a[0]!, a[1]),
    ra: (a) => removeAttr(a[0]!, a[1]),
    rc: (a) => removeClass(a[0]!, a[1]),
    "set-local-storage-item": (a) => setStorageItem("localStorage", a[0]!, a[1] ?? ""),
    "set-session-storage-item": (a) => setStorageItem("sessionStorage", a[0]!, a[1] ?? ""),
    "window.name-defuser": () => {
      if (window === window.top) window.name = "";
    },
  };

  const keys = siteKeys(frameHost());
  const off = new Set<number>();
  for (const key of keys) for (const index of data.except[key] ?? []) off.add(index);
  if (off.has(-1)) return;
  const chosen = new Set<number>();
  for (const key of keys) for (const index of data.sites[key] ?? []) if (!off.has(index)) chosen.add(index);
  for (const index of chosen) {
    const call = data.calls[index];
    if (!call) continue;
    const [name, ...args] = call;
    try {
      RUN[name!]?.(args.map((arg) => arg ?? ""));
    } catch {
      // One scriptlet failing leaves the others running.
    }
  }
}
