// Carta reader: French and German quotations pitched just past what you know.
// Data: reader/<fr|de>/ (scripts/build-reader.py — all Wiktionary). Progress lives on
// this device only (localStorage "carta.read.<lc>"), keyed by lemma so rebuilds keep it.
//   tap a word        → its gloss, English cousin, and know/learning buttons
//   long-press a word → fly to it on the map
//   Next              → words you didn't tap count as known
(function () {
  "use strict";
  const LANG = { fr: { name: "French", own: "Français" }, de: { name: "German", own: "Deutsch" } };
  const V = "1";
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const get = (p) => fetch("reader/" + p + "?v=" + V).then((r) => { if (!r.ok) throw new Error(p); return r.json(); });

  // same tokenizer as scripts/build-reader.py
  const WORD = /[A-Za-zÀ-ÖØ-öø-ÿŒœÆæß]+(?:[-’'][A-Za-zÀ-ÖØ-öø-ÿŒœÆæß]+)*/g;
  const ELIDE = /^(l|d|j|m|n|s|t|c|qu|jusqu|lorsqu|puisqu|quoiqu)[’']/i;
  function tokens(text, lc) {
    const out = []; let m; WORD.lastIndex = 0;
    while ((m = WORD.exec(text))) {
      let s = m.index, w = m[0];
      if (lc === "fr") { const e = w.match(ELIDE); if (e && w.length > e[0].length) { out.push([s, s + e[0].length, e[1].toLowerCase() + "e"]); s += e[0].length; w = w.slice(e[0].length); } }
      out.push([s, m.index + m[0].length, w]);
    }
    return out;
  }
  const fold = (s) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ß/g, "ss").replace(/œ/g, "oe").replace(/æ/g, "ae");

  const D = {}; // lc -> {idx, lex, bands: Map, forms: Map}
  let lc = null, st = null, cur = null, sel = null, panel = null, mini = null;

  function load(lc) {
    if (D[lc]) return D[lc].ready;
    const d = (D[lc] = { bands: new Map(), forms: new Map() });
    d.ready = Promise.all([get(lc + "/index.json"), get(lc + "/lex.json")]).then(([idx, lex]) => { d.idx = idx; d.lex = lex; });
    return d.ready;
  }
  function band(b) {
    const d = D[lc];
    if (!d.bands.has(b)) d.bands.set(b, get(lc + "/q/" + b + ".json").catch(() => []));
    return d.bands.get(b);
  }
  function formShard(k) {
    const d = D[lc];
    if (!d.forms.has(k)) d.forms.set(k, get(lc + "/forms/" + k + ".json").catch(() => ({})));
    return d.forms.get(k);
  }

  // ---- progress -----------------------------------------------------------------
  const SKEY = (lc) => "carta.read." + lc;
  function loadState(lc) {
    try { const s = JSON.parse(localStorage.getItem(SKEY(lc))); if (s && s.v === 1) return s; } catch (e) {}
    return null;
  }
  function save() { try { localStorage.setItem(SKEY(lc), JSON.stringify(st)); } catch (e) {} }
  // zipf*10 at or above which a word counts as known before you've met it
  const LEVELS = { fr: [[0, "None yet", 999, "Mostly cognates to start"], [1, "A little", 55, "The few hundred commonest words"], [2, "Some", 45, "Can read simple sentences"], [3, "Plenty", 38, "Reads with a dictionary"]],
    de: [[0, "None yet", 999, "Mostly cognates to start"], [1, "High school, rusty", 52, "The commonest words come back fast"], [2, "Some", 45, "Can read simple sentences"], [3, "Plenty", 38, "Reads with a dictionary"]] };
  function known(i) {
    const L = D[lc].lex[i]; if (!L) return false;
    const w = L[0];
    if (st.learn[w]) return false;
    if (st.known[w]) return true;
    return L[3] >= st.z || (L[5] === 1 && L[3] >= 25);
  }
  const unknownIn = (q) => { const u = new Set(); let n = 0; for (const [, , i] of q.w) { n++; if (i < 0 || !known(i)) u.add(i < 0 ? "?" + n : i); } return u; };

  // ---- picking the next quotation -----------------------------------------------
  async function pick() {
    const d = D[lc], nb = d.idx.bands.length;
    let ids = [...Array(nb).keys()];
    if (st.author) ids = d.idx.ab[st.author] || ids;
    // walk up from the easiest band; stop once there are enough at the right stretch
    const good = [], near = [];
    for (const b of ids) {
      const qs = await band(b);
      for (const q of qs) {
        if (st.author && q.a !== st.author) continue;
        const key = q.a + "|" + q.t.slice(0, 40);
        if (st.seen[key]) continue;
        const u = unknownIn(q).size, cov = 1 - u / q.w.length;
        if (u >= 1 && u <= 3 && cov >= 0.85) good.push(q); else if (u <= 6 && cov >= 0.7) near.push([u, q]);
      }
      if (good.length >= 25) break;
    }
    if (good.length) return good[Math.floor(Math.random() * Math.min(good.length, 25))];
    near.sort((a, b) => a[0] - b[0]);
    return near.length ? near[Math.floor(Math.random() * Math.min(near.length, 8))][1] : null;
  }

  // ---- rendering --------------------------------------------------------------------
  function build() {
    panel = el("section", "reader"); panel.id = "reader"; panel.hidden = true;
    panel.setAttribute("aria-label", "Reader");
    panel.innerHTML = '<header class="rd-head"><div class="rd-title"></div><div class="rd-tools"></div><button class="rd-close" type="button" aria-label="Close">×</button></header>' +
      '<div class="rd-body"></div><div class="rd-card" hidden></div><footer class="rd-foot"></footer>';
    document.body.appendChild(panel);
    panel.querySelector(".rd-close").addEventListener("click", close);
    mini = el("button", "rd-mini", "↩ Back to reading"); mini.type = "button"; mini.hidden = true;
    mini.addEventListener("click", () => { mini.hidden = true; panel.hidden = false; });
    document.body.appendChild(mini);
  }
  const body = () => panel.querySelector(".rd-body"), foot = () => panel.querySelector(".rd-foot"), card = () => panel.querySelector(".rd-card");

  function header() {
    const d = D[lc];
    panel.querySelector(".rd-title").textContent = LANG[lc].own;
    const tools = panel.querySelector(".rd-tools"); tools.innerHTML = "";
    const sw = el("button", "rd-chip", LANG[lc === "fr" ? "de" : "fr"].own); sw.type = "button";
    sw.addEventListener("click", () => open(lc === "fr" ? "de" : "fr"));
    const au = el("select", "rd-author"); au.setAttribute("aria-label", "Author");
    au.appendChild(new Option("All authors", ""));
    Object.keys(d.idx.ab).sort((a, b) => a.split(" ").pop().localeCompare(b.split(" ").pop())).forEach((a) => au.appendChild(new Option(a, a, false, st.author === a)));
    au.addEventListener("change", () => { st.author = au.value || null; save(); next(false); });
    const own = el("button", "rd-chip", "Paste a text"); own.type = "button"; own.addEventListener("click", pasteMode);
    tools.append(au, own, sw);
  }

  function placement() {
    body().innerHTML = ""; foot().innerHTML = ""; card().hidden = true;
    const box = el("div", "rd-place");
    box.appendChild(el("h2", null, "How much " + LANG[lc].name + " do you have?"));
    box.appendChild(el("p", "rd-note", "Quotations are picked so only one to three words are new. Tap a word you don't know; hold it to see it on the map. Whatever you didn't tap counts as known when you go on."));
    for (const [, label, z, sub] of LEVELS[lc]) {
      const b = el("button", "rd-level"); b.type = "button";
      b.append(el("span", "rd-l1", label), el("span", "rd-l2", sub));
      b.addEventListener("click", () => { st = { v: 1, z, known: {}, learn: {}, seen: {}, author: null, n: 0 }; save(); header(); next(false); });
      box.appendChild(b);
    }
    body().appendChild(box);
  }

  function renderText(q, toks) {
    const b = body(); b.innerHTML = ""; card().hidden = true; sel = null;
    const p = el("p", "rd-quote"); p.lang = lc;
    let at = 0;
    toks.forEach(([s, e, i], n) => {
      if (s > at) p.appendChild(document.createTextNode(q.t.slice(at, s)));
      const w = el("span", "rd-w", q.t.slice(s, e));
      if (i < 0) w.classList.add("rd-unk");
      else if (!known(i)) w.classList.add(D[lc].lex[i][5] ? "rd-cog" : "rd-new");
      w.dataset.n = n; w.dataset.i = i;
      bindWord(w, q, i);
      p.appendChild(w); at = e;
    });
    if (at < q.t.length) p.appendChild(document.createTextNode(q.t.slice(at)));
    b.appendChild(p);
    if (q.r || q.a) b.appendChild(el("p", "rd-ref", q.r ? q.r.replace(/:$/, "") : q.a));
    if (q.en) {
      const t = el("details", "rd-en"); t.appendChild(el("summary", null, "Translation")); t.appendChild(el("p", null, q.en)); b.appendChild(t);
    }
  }

  function bindWord(w, q, i) {
    let timer = null, held = false, x0 = 0, y0 = 0;
    w.addEventListener("pointerdown", (e) => {
      held = false; x0 = e.clientX; y0 = e.clientY;
      timer = setTimeout(() => { held = true; w.classList.add("rd-held"); toMap(i, q.t.slice(+w.dataset.s || 0)); }, 480);
    });
    const cancel = () => { clearTimeout(timer); timer = null; };
    w.addEventListener("pointermove", (e) => { if (Math.hypot(e.clientX - x0, e.clientY - y0) > 10) cancel(); });
    w.addEventListener("pointerleave", cancel); w.addEventListener("pointercancel", cancel);
    w.addEventListener("pointerup", () => { cancel(); if (!held) tap(w, i); });
    w.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  function tap(w, i) {
    body().querySelectorAll(".rd-w.rd-sel").forEach((x) => x.classList.remove("rd-sel"));
    w.classList.add("rd-sel", "rd-tapped");
    sel = i;
    const c = card(); c.innerHTML = ""; c.hidden = false;
    const L = i >= 0 ? D[lc].lex[i] : null;
    const top = el("div", "rd-c-top");
    top.appendChild(el("b", "rd-c-w", L ? L[0] : w.textContent));
    if (L && L[2]) top.appendChild(el("i", "rd-c-pos", L[2]));
    c.appendChild(top);
    c.appendChild(el("p", "rd-c-g", L ? L[1] || "—" : "Not in the dictionary yet."));
    if (L && L[4]) c.appendChild(el("p", "rd-c-cog", (L[5] ? "≈ English " : "Cousin of English ") + L[4]));
    if (!L) return;
    // a tap means "show me": it joins the learning pile unless you say you know it
    st.learn[L[0]] = (st.learn[L[0]] || 0) + 1; delete st.known[L[0]]; save();
    w.classList.remove("rd-cog"); w.classList.add("rd-new");
    footer(!!(cur && cur.own));
    const row = el("div", "rd-c-acts");
    const k = el("button", "rd-btn", "I know this"); k.type = "button";
    k.addEventListener("click", () => { delete st.learn[L[0]]; st.known[L[0]] = 1; save(); w.classList.remove("rd-new", "rd-tapped"); c.hidden = true; });
    const m = el("button", "rd-btn rd-btn-map", "On the map"); m.type = "button";
    m.addEventListener("click", () => toMap(i));
    row.append(k, m);
    c.appendChild(row);
  }

  function toMap(i) {
    const L = i >= 0 ? D[lc].lex[i] : null;
    if (!L || !window.RootMap || !RootMap.loaded()) return;
    let n = RootMap.findIn(LANG[lc].name, L[0]);
    if (n < 0 && L[4]) n = RootMap.find(L[4]);
    if (n < 0) { flash("Not on the map yet"); return; }
    panel.hidden = true; mini.hidden = false;
    if (window.Carta && Carta.openNode) Carta.openNode(n, true);
  }
  function flash(t) { const f = el("div", "rd-flash", t); panel.appendChild(f); setTimeout(() => f.remove(), 1600); }

  function footer(isOwn) {
    const f = foot(); f.innerHTML = "";
    const learning = Object.keys(st.learn).length, kn = Object.keys(st.known).length;
    f.appendChild(el("span", "rd-count", learning + " learning · " + kn + " marked known"));
    const nx = el("button", "rd-btn rd-next", isOwn ? "Done" : "Next"); nx.type = "button";
    nx.addEventListener("click", () => next(true));
    f.appendChild(nx);
  }

  async function next(commit) {
    if (commit && cur) {
      // words met and not tapped: known now
      for (const [, , i] of cur.w) {
        if (i < 0) continue;
        const L = D[lc].lex[i];
        if (!st.learn[L[0]] && !known(i)) st.known[L[0]] = 1;
      }
      if (!cur.own) st.seen[cur.a + "|" + cur.t.slice(0, 40)] = 1;
      st.n++;
      save();
    }
    body().innerHTML = '<p class="rd-note">Finding a quotation…</p>';
    const q = await pick();
    cur = q;
    if (!q) { body().innerHTML = '<p class="rd-note">Nothing left at this level' + (st.author ? " for this author" : "") + ".</p>"; footer(false); return; }
    renderText(q, q.w);
    footer(false);
  }

  function pasteMode() {
    card().hidden = true;
    const b = body(); b.innerHTML = "";
    b.appendChild(el("p", "rd-note", "Paste a passage from something you're reading. It stays on this device."));
    const ta = el("textarea", "rd-paste"); ta.rows = 8; ta.lang = lc;
    try { ta.value = localStorage.getItem("carta.read.paste." + lc) || ""; } catch (e) {}
    b.appendChild(ta);
    const go = el("button", "rd-btn", "Read it"); go.type = "button";
    go.addEventListener("click", async () => {
      const t = ta.value.trim(); if (!t) return;
      try { localStorage.setItem("carta.read.paste." + lc, t); } catch (e) {}
      const toks = tokens(t, lc);
      const keys = new Set(toks.map(([, , w]) => { const f = fold(w)[0]; return f && /[a-z]/.test(f) ? f : "_"; }));
      const shards = {}; await Promise.all([...keys].map(async (k) => (shards[k] = await formShard(k))));
      const w = toks.map(([s, e, x]) => {
        const f = fold(x)[0], sh = shards[f && /[a-z]/.test(f) ? f : "_"] || {};
        const i = sh[x] != null ? sh[x] : sh[x.toLowerCase()];
        return [s, e, i == null ? -1 : i];
      });
      cur = { t, w, own: true, a: "", r: "Your text" };
      renderText(cur, w); footer(true);
    });
    b.appendChild(go);
    foot().innerHTML = "";
  }

  async function open(which) {
    if (!panel) build();
    lc = which; panel.hidden = false; mini.hidden = true;
    body().innerHTML = '<p class="rd-note">Loading…</p>';
    try { await load(lc); } catch (e) { body().innerHTML = '<p class="rd-note">Couldn\'t load the reader.</p>'; return; }
    st = loadState(lc);
    if (!st) { header0(); return placement(); }
    header(); next(false);
  }
  function header0() { panel.querySelector(".rd-title").textContent = LANG[lc].own; panel.querySelector(".rd-tools").innerHTML = ""; }
  function close() { panel.hidden = true; mini.hidden = true; card().hidden = true; }

  window.CartaReader = { open, close };
})();
