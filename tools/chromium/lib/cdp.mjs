// Minimal Chrome DevTools Protocol client over the browser-level WebSocket.
export class Cdp {
  #ws;
  #id = 1;
  #pending = new Map();
  #listeners = [];

  static async connect(port, timeoutMs = 60000) {
    const started = Date.now();
    let info;
    while (Date.now() - started < timeoutMs) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) { info = await res.json(); break; }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!info) throw new Error(`no devtools endpoint on port ${port}`);
    const client = new Cdp();
    client.version = info;
    await client.#open(info.webSocketDebuggerUrl);
    return client;
  }

  #open(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.#ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(new Error(`websocket error ${e.message ?? ""}`));
      ws.onclose = () => {
        for (const p of this.#pending.values()) p.reject(new Error("devtools connection closed"));
        this.#pending.clear();
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id) {
          const p = this.#pending.get(msg.id);
          if (!p) return;
          this.#pending.delete(msg.id);
          if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
          else p.resolve(msg.result);
        } else {
          for (const l of this.#listeners) l(msg);
        }
      };
    });
  }

  send(method, params = {}, sessionId, timeoutMs = 60000) {
    const id = this.#id++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#pending.delete(id)) reject(new Error(`${method}: timed out`));
      }, timeoutMs);
      this.#pending.set(id, {
        method,
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.#ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(listener) {
    this.#listeners.push(listener);
    return () => { this.#listeners = this.#listeners.filter((l) => l !== listener); };
  }

  async targets() {
    return (await this.send("Target.getTargets")).targetInfos;
  }

  async attach(targetId) {
    return (await this.send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
  }

  /** Opens a new tab and returns a page helper bound to it. */
  async newPage(url = "about:blank") {
    const { targetId } = await this.send("Target.createTarget", { url });
    return this.page(targetId);
  }

  async page(targetId) {
    const sessionId = await this.attach(targetId);
    await this.send("Page.enable", {}, sessionId).catch(() => {});
    await this.send("Runtime.enable", {}, sessionId).catch(() => {});
    return new Page(this, targetId, sessionId);
  }

  close() { try { this.#ws.close(); } catch {} }
}

export class Page {
  constructor(cdp, targetId, sessionId) { Object.assign(this, { cdp, targetId, sessionId }); }

  send(method, params, timeoutMs) { return this.cdp.send(method, params, this.sessionId, timeoutMs); }

  async eval(expression, { awaitPromise = true, timeoutMs = 60000 } = {}) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true, userGesture: true }, timeoutMs);
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    }
    return r.result.value;
  }

  /** Navigates and waits for load. Returns { errorText } on a failed navigation. */
  async goto(url, { timeoutMs = 45000, settleMs = 300 } = {}) {
    const loaded = new Promise((resolve) => {
      const off = this.cdp.on((m) => {
        if (m.sessionId === this.sessionId && m.method === "Page.loadEventFired") { off(); resolve("load"); }
      });
      setTimeout(() => { off(); resolve("timeout"); }, timeoutMs);
    });
    const nav = await this.send("Page.navigate", { url }, timeoutMs);
    if (nav.errorText) return { errorText: nav.errorText };
    const how = await loaded;
    await new Promise((r) => setTimeout(r, settleMs));
    return { how };
  }

  async text(max = 4000) {
    return this.eval(`(document.body ? document.body.innerText : "").slice(0, ${max})`);
  }

  async screenshot() {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" }, 30000);
    return Buffer.from(data, "base64");
  }

  async close() {
    await this.cdp.send("Target.closeTarget", { targetId: this.targetId }).catch(() => {});
  }
}
