// Local test site. Hostnames map to this server through --host-resolver-rules, so tests
// exercise real cross-site behaviour without touching the internet.
import http from "node:http";
import https from "node:https";

const MIN_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 24 Tf 40 70 Td (Orbit PDF test) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n",
);
const DROP_TOTAL = 4 * 1024 * 1024;
const DROP_AT = 1024 * 1024;

/** Pass { pfx, passphrase } to serve HTTPS. */
export async function startFixture({ pfx, passphrase } = {}) {
  const log = [];
  let port;
  const scheme = pfx ? "https" : "http";
  const handler = (req, res) => {
    const host = (req.headers.host ?? "").split(":")[0];
    const url = new URL(req.url, `${scheme}://${req.headers.host}`);
    log.push({ host, path: url.pathname, cookie: req.headers.cookie ?? "", range: req.headers.range ?? "" });
    const html = (body) => { res.writeHead(200, { "content-type": "text/html" }); res.end(`<!doctype html><meta charset=utf-8><title>${host}</title>${body}`); };
    switch (url.pathname) {
      case "/":
        return html(`<h1>${host}</h1>`);
      case "/frames":
        return html(`<h1>top ${host}</h1><iframe id="x" src="${scheme}://b.test:${port}/frame"></iframe>`);
      case "/frames-same":
        return html(`<h1>top ${host}</h1><iframe id="x" src="${scheme}://${host}:${port}/frame"></iframe>`);
      case "/frame":
        res.writeHead(200, { "content-type": "text/html", "set-cookie": `third=party; Path=/; SameSite=None${pfx ? "; Secure" : ""}` });
        return res.end(`<!doctype html><title>frame</title><script>parent.postMessage({cookie:document.cookie},'*')</script>frame on ${host}`);
      case "/setcookie":
        res.writeHead(200, { "content-type": "text/html", "set-cookie": `first=party; Path=/` });
        return res.end(`<!doctype html><title>set</title>set`);
      case "/trackers":
        return html(`<h1>trackers</h1><script src="${scheme}://tracker.test:${port}/t.js"></script><img src="${scheme}://tracker.test:${port}/p.gif"><script src="${scheme}://a.test:${port}/ok.js"></script>`);
      case "/t.js":
      case "/ok.js":
        res.writeHead(200, { "content-type": "text/javascript" });
        return res.end("window.loaded=(window.loaded||0)+1");
      case "/p.gif":
        res.writeHead(200, { "content-type": "image/gif" });
        return res.end(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
      case "/ads-page": {
        const ad = url.searchParams.get("ad");
        const tracker = url.searchParams.get("tracker");
        return html(`<h1>ads</h1><script src="http://${ad}/ads.js"></script><img src="http://${ad}/banner.gif"><script src="http://${tracker}/collect.js"></script>`);
      }
      case "/ping-test":
        return html(`<a id="link" href="/ping-target" ping="/ping" target="_blank">go</a>`);
      case "/ping-target":
        return html(`<h1>target</h1>`);
      case "/ping":
        res.writeHead(204);
        return res.end();
      case "/doc.pdf":
        res.writeHead(200, { "content-type": "application/pdf" });
        return res.end(MIN_PDF);
      case "/dl":
        return html(`<style>a{display:block;font:32px sans-serif;margin:12px}</style><a id="slow" href="/slow.bin">slow</a><a id="drop" href="/drop.bin">drop</a><a id="exe" href="/orbit-probe.exe">exe</a>`);
      case "/slow.bin": {
        const total = 8 * 1024 * 1024;
        res.writeHead(200, { "content-type": "application/octet-stream", "content-length": total, "content-disposition": 'attachment; filename="orbit-slow.bin"' });
        let sent = 0;
        const timer = setInterval(() => {
          if (sent >= total || res.destroyed) { clearInterval(timer); return res.end(); }
          const chunk = Math.min(256 * 1024, total - sent);
          res.write(Buffer.alloc(chunk, 7));
          sent += chunk;
        }, 200);
        req.on("close", () => clearInterval(timer));
        return undefined;
      }
      case "/drop.bin": {
        const validators = { etag: '"orbit-drop-1"', "last-modified": "Sun, 01 Nov 2026 00:00:00 GMT", "accept-ranges": "bytes" };
        const range = /bytes=(\d+)-/.exec(req.headers.range ?? "");
        if (range) {
          const from = Number(range[1]);
          res.writeHead(206, { "content-type": "application/octet-stream", "content-length": DROP_TOTAL - from, "content-range": `bytes ${from}-${DROP_TOTAL - 1}/${DROP_TOTAL}`, "content-disposition": 'attachment; filename="orbit-drop.bin"', ...validators });
          return res.end(Buffer.alloc(DROP_TOTAL - from, 9));
        }
        res.writeHead(200, { "content-type": "application/octet-stream", "content-length": DROP_TOTAL, "content-disposition": 'attachment; filename="orbit-drop.bin"', ...validators });
        res.write(Buffer.alloc(DROP_AT, 9), () => setTimeout(() => req.socket.destroy(), 300));
        return undefined;
      }
      case "/orbit-probe.exe":
        res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="orbit-probe.exe"' });
        return res.end(Buffer.from("orbit test file, not a real program\n"));
      case "/login":
        return html(`<form action="/login-done" method="post"><input name="username" autocomplete="username"><input name="password" type="password" autocomplete="current-password"><button>Sign in</button></form>`);
      case "/login-done":
        req.resume();
        return html(`<h1>signed in</h1>`);
      default:
        res.writeHead(404);
        return res.end("not found");
    }
  };
  const server = pfx ? https.createServer({ pfx, passphrase }, handler) : http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
  return { port, log, scheme, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}
