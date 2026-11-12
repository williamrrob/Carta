// Progress across devices. Everything Carta remembers lives in this browser's localStorage; this
// keeps one copy of it in a private gist on your own GitHub account ("carta-progress.json") and
// merges it with each device. No server of ours: the browser talks to api.github.com with a token
// you paste once per device (Saved → Settings → Sync). The token needs the "gist" permission only.
//
// What travels: Learn's progress per language (carta.read.fr / .de), English saved words and their
// quiz schedule (rootwork.saved / rootwork.sr), bookmarks (carta.marks) and bookmarked excerpts
// (carta.excerpts). What stays on the device: the excerpt you're in the middle of and your
// half-written English, the map's view, settings.
//
// Merging is per word, not per file, so an evening on the phone and a morning on the Mac both
// survive: a word's record with the later change wins (learn.js stamps `m` on each change and a
// time on "I know this" / learned); counts take the larger; lists are merged three ways against
// what this device last saw, so removing a bookmark on one device removes it everywhere.
//
// The same file can be exported and imported by hand (Saved → Settings), e.g. through iCloud Drive.
(function () {
  "use strict";
  const FILE = "carta-progress.json", API = "https://api.github.com";
  const CFG = "carta.sync", BASE = "carta.sync.base";
  const LANGS = ["fr", "de"];
  const LOCAL_ONLY = ["cur", "draft", "checked", "queue", "undo", "reset"];
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ---- this device's copy ----
  function readState(lc) { const s = ls.get("carta.read." + lc, null); return s && s.v === 2 ? s : null; }
  function local() {
    const d = { v: 1, read: {}, saved: ls.get("rootwork.saved", []), sr: ls.get("rootwork.sr", {}), marks: ls.get("carta.marks", []), excerpts: ls.get("carta.excerpts", []) };
    for (const lc of LANGS) { const s = readState(lc); if (s) d.read[lc] = s; }
    return d;
  }
  // the travelling copy leaves the device-only parts behind
  function strip(d) {
    const o = clone(d);
    for (const lc in o.read) for (const k of LOCAL_ONLY) delete o.read[lc][k];
    return o;
  }
  function writeLocal(d) {
    for (const lc of LANGS) if (d.read[lc]) ls.set("carta.read." + lc, d.read[lc]);
    ls.set("rootwork.saved", d.saved); ls.set("rootwork.sr", d.sr); ls.set("carta.marks", d.marks); ls.set("carta.excerpts", d.excerpts);
  }

  // ---- merge ----
  const kt = (v) => (typeof v === "number" && v > 1 ? v : 0);   // known: 1 = read past it, a time = you said so / it was learned
  function mergeRead(A, B) {
    if (!A) return B ? clone(B) : null;
    if (!B) return A;
    const newer = (A.mt || 0) >= (B.mt || 0) ? A : B;
    const o = { v: 2, z: newer.z, known: {}, learn: {}, seen: Object.assign({}, B.seen, A.seen), author: newer.author == null ? null : newer.author,
      n: Math.max(A.n || 0, B.n || 0), mt: Math.max(A.mt || 0, B.mt || 0) };
    if (newer.z0 != null) o.z0 = newer.z0;
    if (newer.hist) o.hist = newer.hist;
    const grad = Math.max(A.grad || 0, B.grad || 0); if (grad) o.grad = grad;
    if (A.days || B.days) { o.days = Object.assign({}, B.days); for (const k in A.days || {}) o.days[k] = Math.max(o.days[k] || 0, A.days[k]); }
    if (A.tx || B.tx) {
      const by = new Map(); for (const x of (B.tx || []).concat(A.tx || [])) by.set(x.d + "|" + (x.t || "").slice(0, 24), x);
      o.tx = [...by.values()].sort((x, y) => x.d - y.d).slice(-300);
    }
    const AL = A.learn || {}, BL = B.learn || {}, AK = A.known || {}, BK = B.known || {};
    const norm = (x) => (typeof x === "number" ? { n: x, s: 0, due: 0 } : x);
    const words = new Set([...Object.keys(AL), ...Object.keys(BL), ...Object.keys(AK), ...Object.keys(BK)]);
    for (const w of words) {
      // candidates in order of preference on a tie: still learning (this device, then the other), then known
      const c = [];
      if (AL[w] != null) c.push(["l", (norm(AL[w]).m || 0), norm(AL[w])]);
      if (BL[w] != null) c.push(["l", (norm(BL[w]).m || 0), norm(BL[w])]);
      if (AK[w]) c.push(["k", kt(AK[w]), AK[w]]);
      if (BK[w]) c.push(["k", kt(BK[w]), BK[w]]);
      let best = c[0]; for (const x of c) if (x[1] > best[1]) best = x;
      if (best[0] === "l") o.learn[w] = best[2]; else o.known[w] = best[2];
    }
    for (const k of LOCAL_ONLY) if (A[k] != null) o[k] = A[k];
    return o;
  }
  // lists, three ways: what either side added stays, what either side removed (it was in the base) goes
  function mergeList(a, b, base, key) {
    a = a || []; b = b || [];
    if (!base) base = [];
    const ka = new Set(a.map(key)), kb = new Set(b.map(key)), k0 = new Set(base.map(key));
    const out = [], seen = new Set();
    for (const x of a.concat(b)) {
      const k = key(x); if (seen.has(k)) continue;
      if (k0.has(k) && (!ka.has(k) || !kb.has(k))) continue;
      seen.add(k); out.push(x);
    }
    return out;
  }
  function merge(A, B, base) {
    if (!B) return A;
    const o = { v: 1, read: {} };
    for (const lc of LANGS) { const m = mergeRead(A.read[lc], (B.read || {})[lc]); if (m) o.read[lc] = m; }
    base = base || {};
    o.saved = mergeList(A.saved, B.saved, base.saved, (x) => x);
    o.marks = mergeList(A.marks, B.marks, base.marks, (m) => m.l + "|" + m.w);
    o.excerpts = mergeList(A.excerpts, B.excerpts, base.excerpts, (x) => x.q.t);
    o.sr = Object.assign({}, B.sr);
    for (const w in A.sr || {}) if (!o.sr[w] || (A.sr[w].due || 0) >= (o.sr[w].due || 0)) o.sr[w] = A.sr[w];
    return o;
  }
  const baseOf = (d) => ({ saved: d.saved, marks: d.marks.map((m) => ({ w: m.w, l: m.l })), excerpts: d.excerpts.map((x) => ({ q: { t: x.q.t } })) });
  // stable text of a copy (keys sorted), to tell whether anything differs
  function canon(v) {
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
    return JSON.stringify(v);
  }

  // ---- GitHub ----
  let cfg = ls.get(CFG, null);   // { token, gist, at, user }
  let status = { state: cfg ? "idle" : "off", at: cfg ? cfg.at || 0 : 0, error: "" };
  const listeners = new Set();
  function setStatus(s) { Object.assign(status, s); listeners.forEach((f) => { try { f(status); } catch (e) {} }); }
  function gh(path, opt) {
    opt = opt || {};
    const text = opt.body ? JSON.stringify(opt.body) : undefined;
    // keepalive lets a save finish while the app is being put away, but browsers cap it at 64 KB
    return fetch(API + path, { method: opt.method || "GET", cache: "no-store", keepalive: !!opt.keepalive && !!text && text.length < 60000,
      headers: Object.assign({ Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github+json" }, text ? { "Content-Type": "application/json" } : {}),
      body: text,
    }).then((r) => {
      if (r.status === 401 || r.status === 403) throw new Error(r.status === 401 ? "GitHub didn’t accept the token" : "The token can’t use gists");
      if (r.status === 404) throw new Error("notfound");
      if (!r.ok) throw new Error("GitHub answered " + r.status);
      return r.json();
    });
  }
  async function findGist() {
    for (let page = 1; page <= 3; page++) {
      const gs = await gh("/gists?per_page=100&page=" + page);
      const g = gs.find((x) => x.files && x.files[FILE]); if (g) return g.id;
      if (gs.length < 100) break;
    }
    return null;
  }
  async function readRemote() {
    const g = await gh("/gists/" + cfg.gist), f = g.files && g.files[FILE];
    if (!f) return null;
    let text = f.content;
    if (f.truncated) text = await (await fetch(f.raw_url, { cache: "no-store" })).text();
    try { const d = JSON.parse(text); return d && d.v === 1 ? d : null; } catch (e) { return null; }
  }
  const body = (d) => ({ description: "Carta progress (kept by the app; edit at your own risk)", files: { [FILE]: { content: JSON.stringify(d) } } });

  let running = null, again = false, lastSeen = "";
  // one round: fetch, merge, write here if the other devices had news, write there if we did
  async function round(opt) {
    if (!cfg) return;
    setStatus({ state: "syncing", error: "" });
    if (!cfg.gist) { cfg.gist = await findGist(); if (cfg.gist) ls.set(CFG, cfg); }
    let remote = null;
    if (cfg.gist) { try { remote = await readRemote(); } catch (e) { if (e.message !== "notfound") throw e; cfg.gist = null; } }
    const mine = local();                       // read after the network wait, so nothing written meanwhile is lost
    const merged = merge(mine, remote, ls.get(BASE, null));
    const changedHere = canon(merged) !== canon(mine);
    if (changedHere) writeLocal(merged);
    const out = strip(merged);
    if (!cfg.gist) { const g = await gh("/gists", { method: "POST", body: Object.assign({ public: false }, body(out)) }); cfg.gist = g.id; }
    else if (!remote || canon(out) !== canon(remote)) await gh("/gists/" + cfg.gist, { method: "PATCH", body: body(out), keepalive: opt && opt.keepalive });
    ls.set(BASE, baseOf(merged));
    cfg.at = Date.now(); ls.set(CFG, cfg);
    lastSeen = canon(strip(local()));
    setStatus({ state: "idle", at: cfg.at, error: "" });
    if (changedHere) window.dispatchEvent(new Event("carta-sync"));
  }
  function sync(opt) {
    if (!cfg) return Promise.resolve();
    if (running) { again = true; return running; }
    running = round(opt).catch((e) => { setStatus({ state: "error", error: navigator.onLine === false ? "Offline" : (e && e.message) || "Couldn’t reach GitHub" }); })
      .then(() => { running = null; if (again) { again = false; return sync(); } });
    return running;
  }
  // something changed here: push soon (a few taps in a row make one round)
  let timer = 0;
  function touch() { if (!cfg) return; clearTimeout(timer); timer = setTimeout(() => sync(), 4000); }
  const dirty = () => !!cfg && canon(strip(local())) !== lastSeen;

  async function connect(token) {
    token = String(token || "").trim(); if (!token) throw new Error("Paste a token first");
    const was = cfg; cfg = { token, gist: null, at: 0 };
    try { const u = await gh("/user"); cfg.user = u.login; }
    catch (e) { cfg = was; throw e.message === "notfound" ? new Error("GitHub didn’t accept the token") : e; }
    ls.set(CFG, cfg); ls.del(BASE);
    setStatus({ state: "idle", at: 0, error: "" });
    await sync();
    if (status.state === "error") throw new Error(status.error);
  }
  function disconnect() { cfg = null; ls.del(CFG); ls.del(BASE); clearTimeout(timer); setStatus({ state: "off", at: 0, error: "" }); }

  // ---- by hand: one file out, one file in (merged, never overwriting) ----
  function exportFile() {
    const text = JSON.stringify(strip(local())), name = "carta-progress.json";
    const file = typeof File === "function" ? new File([text], name, { type: "application/json" }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file] }).catch(() => {});
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "application/json" })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return Promise.resolve();
  }
  function importText(text) {
    let d = null; try { d = JSON.parse(text); } catch (e) {}
    if (!d || d.v !== 1 || !d.read) throw new Error("That isn’t a Carta progress file");
    const mine = local(), merged = merge(mine, d, null);
    writeLocal(merged);
    window.dispatchEvent(new Event("carta-sync"));
    touch();
  }

  // ---- when ----
  window.addEventListener("load", () => setTimeout(() => sync(), 1500));
  document.addEventListener("visibilitychange", () => {
    if (!cfg) return;
    if (document.visibilityState === "hidden") { if (dirty()) sync({ keepalive: true }); }
    else if (Date.now() - (cfg.at || 0) > 60000) sync();
  });
  window.addEventListener("pagehide", () => { if (dirty()) sync({ keepalive: true }); });
  window.addEventListener("online", () => { if (cfg) sync(); });
  setInterval(() => { if (cfg && document.visibilityState === "visible" && !running && dirty()) sync(); }, 30000);

  window.CartaSync = {
    on: () => !!cfg, status: () => status, user: () => (cfg && cfg.user) || "",
    watch(f) { listeners.add(f); return () => listeners.delete(f); },
    connect, disconnect, sync: () => sync(), touch, exportFile, importText,
    _merge: merge, _mergeRead: mergeRead, _mergeList: mergeList,   // test/sync.test.js
  };
  if (typeof module !== "undefined") module.exports = window.CartaSync;
})();
