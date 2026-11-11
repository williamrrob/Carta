// Learn (one of the four divisions; divisions.js). French and German excerpts pitched just past
// what you know; you write the English under them; Check marks it. Tap a word and the map opens
// in a window between the excerpt and your English. Quiz brings back the words you keep missing.
//
// Data: reader/<fr|de>/ (scripts/build-reader.py). Progress lives on this device
// (localStorage "carta.read.<lc>", v2), keyed by dictionary entry, as the reader kept it, so
// nothing learned before is lost. The current excerpt and your half-written English are saved as
// you go (iOS closes home-screen apps in the background).
(function () {
  "use strict";
  const LANG = { fr: { name: "French", own: "Français" }, de: { name: "German", own: "Deutsch" } };
  const V = "5";
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const button = (cls, txt, label) => { const b = el("button", cls, txt); b.type = "button"; if (label) b.setAttribute("aria-label", label); return b; };
  const get = (p) => fetch("reader/" + p + "?v=" + V).then((r) => { if (!r.ok) throw new Error(p); return r.json(); });
  const RM = () => window.RootMap;
  const pref = (k, d) => { try { const v = localStorage.getItem("carta.read." + k); return v == null ? d : v; } catch (e) { return d; } };

  // ---- speech: the device's own voices, touched only when you press Listen (iOS: waking the
  // speech engine pauses the music you're playing) ----
  const SP = window.speechSynthesis || null;
  const BCP = { fr: "fr-FR", de: "de-DE" };
  const RATES = [1, 0.8, 0.6];
  function voiceFor(lc) {
    if (!SP) return null;
    const vs = SP.getVoices().filter((v) => v.lang && v.lang.replace("_", "-").toLowerCase().startsWith(lc));
    if (!vs.length) return null;
    const best = (v) => (v.lang.replace("_", "-") === BCP[lc] ? 4 : 0) + (/premium|enhanced|natural|neural/i.test(v.name) ? 2 : 0) + (v.localService ? 1 : 0);
    return vs.sort((a, b) => best(b) - best(a))[0];
  }
  let reading = false;
  function stopSpeech() { if (SP && reading) SP.cancel(); reading = false; if (page) page.querySelectorAll(".ln-reading").forEach((x) => x.classList.remove("ln-reading")); const b = page && page.querySelector(".ln-listen"); if (b) b.textContent = "Listen"; }
  function listen() {
    if (!SP || !cur) return;
    if (reading) { stopSpeech(); return; }
    const v = voiceFor(lc), u = new SpeechSynthesisUtterance(cur.t);
    u.lang = v ? v.lang : BCP[lc]; if (v) u.voice = v;
    u.rate = RATES[+pref("rate", "0") || 0] * 0.95;
    const spans = [...page.querySelectorAll(".ln-ex .ln-w")];
    u.onboundary = (e) => { if (e.name === "word" || e.name == null) spans.forEach((x) => x.classList.toggle("ln-reading", +x.dataset.s <= e.charIndex && e.charIndex < +x.dataset.e)); };
    u.onend = u.onerror = () => stopSpeech();
    SP.cancel(); SP.speak(u); reading = true;
    page.querySelector(".ln-listen").textContent = "Stop";
  }

  // ---- data ----
  const D = {};
  function load(lc) {
    if (D[lc]) return D[lc].ready;
    const d = (D[lc] = { bands: new Map() });
    d.ready = Promise.all([get(lc + "/index.json"), get(lc + "/lex.json")]).then(([idx, lex]) => { d.idx = idx; d.lex = lex; });
    d.ready.catch(() => { delete D[lc]; });
    return d.ready;
  }
  function band(b) { const d = D[lc]; if (!d.bands.has(b)) d.bands.set(b, get(lc + "/q/" + b + ".json").catch(() => [])); return d.bands.get(b); }

  // ---- progress (as the reader kept it) ----
  const SKEY = (lc) => "carta.read." + lc;
  function loadState(l) { try { const s = JSON.parse(localStorage.getItem(SKEY(l))); if (s && s.v === 2) return s; } catch (e) {} return null; }
  function save() { if (st) try { localStorage.setItem(SKEY(lc), JSON.stringify(st)); } catch (e) {} }
  const LEVELS = { fr: [[0, "None yet", 999, "Mostly cognates to start"], [1, "A little", 55, "The few hundred commonest words"], [2, "Some", 45, "Can read simple sentences"], [3, "Plenty", 38, "Reads with a dictionary"]],
    de: [[0, "None yet", 999, "Mostly cognates to start"], [1, "High school, rusty", 52, "The commonest words come back fast"], [2, "Some", 45, "Can read simple sentences"], [3, "Plenty", 38, "Reads with a dictionary"]] };
  const levelOf = (l, s) => Math.max(0, LEVELS[l].filter((x) => s.z <= x[2]).length - 1);
  const DAY = 864e5, INT = [8 * 6e4, DAY, 3 * DAY, 8 * DAY, 21 * DAY];
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); };
  const wk = (L) => (L[8] ? L[0] + "#" + L[8] : L[0]);
  function lrn(w) { const x = st.learn[w]; if (x == null) return null; if (typeof x === "number") st.learn[w] = { n: x, s: 0, due: 0 }; return st.learn[w]; }
  const isDue = (x) => x && x.due <= Date.now();
  function lapse(x) { if (x.s > 0 || x.n > 0) x.e = Math.max(0.55, (x.e || 1) - (x.s > 0 ? 0.2 : 0.1)); x.n++; x.s = 0; }
  // read past it (or picked it in the quiz) once it had faded a little: it held
  function held(w, x, now) {
    x.s++;
    if (x.s >= INT.length) { delete st.learn[w]; st.known[w] = 1; st.grad = (st.grad || 0) + 1; }
    else { x.e = Math.min(1.6, (x.e || 1) + 0.04); x.due = now + INT[x.s] * (x.e || 1) * (0.85 + Math.random() * 0.3); }
  }
  function adapt(r, n) {
    if (r == null || n < 3) return;
    const h = (st.hist = (st.hist || []).concat([r]).slice(-8));
    if (h.length < 4) return;
    const avg = h.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, h.length);
    st.z0 = st.z0 || st.z;
    if (avg >= 0.85 && st.z > 26) { st.z = st.z > 70 ? 62 : st.z - 2; st.hist = []; }
    else if (avg < 0.5 && st.z < st.z0 + 8) { st.z += 2; st.hist = []; }
  }
  function known(i) {
    const L = D[lc].lex[i]; if (!L) return false;
    const w = wk(L), x = lrn(w);
    if (x) return x.s >= 2;
    if (st.known[w]) return true;
    return L[3] >= st.z || (L[5] === 1 && L[3] >= 25);
  }
  const idOf = (x) => (Array.isArray(x) ? x[2] : x);
  const isName = (i) => i === -2 || (i >= 0 && D[lc].lex[i][7] & 1);
  const dueIn = (q) => { let n = 0; for (const y of q.w) { const i = idOf(y); if (i >= 0 && isDue(lrn(wk(D[lc].lex[i])))) n++; } return n; };
  const unknownIn = (q) => { const u = new Set(); let n = 0; for (const x of q.w) { const i = idOf(x); n++; if (isName(i)) continue; if (i < 0 || !known(i)) u.add(i < 0 ? "?" + n : i); } return u; };
  const keyOf = (q) => q.a + "|" + q.t.slice(0, 40);

  async function pick() {
    const d = D[lc], ids = [...Array(d.idx.bands.length).keys()];
    const good = [], near = []; let fewest = null, fewestShare = 2;
    for (const b of ids) {
      for (const q of await band(b)) {
        if (st.seen[keyOf(q)]) continue;
        if (st.queue && st.queue.length) break;
        const u = unknownIn(q).size, cov = 1 - u / q.w.length;
        if (u >= 1 && u <= 3 && cov >= 0.85) good.push(q); else if (u <= 6 && cov >= 0.7) near.push([u, q]);
        else if (u / q.w.length + Math.random() * 0.02 < fewestShare) { fewestShare = u / q.w.length; fewest = q; }
      }
      if (good.length >= 25 && (!Object.keys(st.learn).length || good.some((q) => dueIn(q) > 0) || b > ids[0] + 12)) break;
    }
    if (good.length) {
      const due = good.filter((q) => dueIn(q) > 0);
      if (due.length && Math.random() < 0.75) return due[Math.floor(Math.random() * Math.min(due.length, 12))];
      return good[Math.floor(Math.random() * Math.min(good.length, 25))];
    }
    near.sort((a, b) => a[0] - b[0]);
    return near.length ? near[Math.floor(Math.random() * Math.min(near.length, 8))][1] : fewest;
  }

  // ---- the meaning check: every content word's dictionary sense should turn up in your English ----
  const STOP = new Set("the a an of to in on at by for from with and or as be is are was were it its this that these those one someone something someplace sth sb used form not no very more most also".split(" "));
  const SKIP_POS = /^(article|det|pron|prep|postp|conj|particle|contraction|intj|interfix|punct|num)/i;
  const CHECK_MAX_Z = 62;
  const stem = (w) => w.toLowerCase().replace(/(ing|ed|es|s|ly)$/, "").slice(0, 5);
  function senseStems(g) {
    const out = new Set();
    for (const part of g.split(/[;,/]|\bor\b/)) for (const m of part.toLowerCase().replace(/\([^)]*\)/g, " ").match(/[a-z]+/g) || []) { if (m.length >= 3 && !STOP.has(m)) out.add(stem(m)); }
    return out;
  }
  const near = (m, g) => m === g || (g.length >= 4 && m.length >= 4 && (m.startsWith(g.slice(0, 4)) || g.startsWith(m.slice(0, 4))));
  function judge(q, text) {
    const mine = (text.match(/[A-Za-z]+/g) || []).map((w) => [w, stem(w)]);
    const got = [], missed = [], hitStems = new Set(), byTitle = new Map(), res = {};
    for (const y of q.w) {
      const i = idOf(y); if (!(i >= 0)) continue;
      const L = D[lc].lex[i]; if (!L || !L[1] || L[7] & 1 || SKIP_POS.test(L[2] || "") || L[3] >= CHECK_MAX_Z) continue;
      if (byTitle.has(L[0])) { res[i] = byTitle.get(L[0]); continue; }
      const gs = senseStems(L[1]); if (!gs.size) continue;
      let hit = null;
      for (const g of gs) for (const [, m] of mine) if (near(m, g)) { hit = m; break; }
      if (!hit && L[4]) { const c = stem(L[4]); for (const [, m] of mine) if (m.length >= 4 && m.startsWith(c.slice(0, 4))) hit = m; }
      if (hit) hitStems.add(hit);
      res[i] = !!hit; byTitle.set(L[0], !!hit);
      (hit ? got : missed).push(L);
    }
    return { got, missed, res, hitStems };
  }

  // ---- state of the division ----
  let page, scroll, lc = null, st = null, cur = null, view = "landing", tapped = null, inlayOpen = false, checked = null;
  let tappedHere = new Set();
  const S = { get() { try { return JSON.parse(localStorage.getItem("carta.learn")) || {}; } catch (e) { return {}; } }, set(v) { try { localStorage.setItem("carta.learn", JSON.stringify(v)); } catch (e) {} } };
  function remember() { S.set({ view, lc }); }

  // ---- landing: one row per language ----
  function landing() {
    view = "landing"; remember(); closeInlay(); stopSpeech();
    page.classList.remove("ln-holed");
    scroll.innerHTML = "";
    const box = el("div", "ln-block ln-landing");
    const head = el("header", "dv-head"); head.appendChild(el("span", "sc", "Learn")); box.appendChild(head);
    const row = (name, sub, acts) => {
      const r = el("section", "ln-row");
      const t = el("div", "ln-row-top"); t.append(el("span", "ln-row-name", name), el("i", "ln-row-sub", sub || "")); r.appendChild(t);
      const a = el("div", "ln-row-acts"); acts.forEach((x) => a.appendChild(x)); r.appendChild(a);
      box.appendChild(r);
    };
    const big = (label, sub, fn, off) => {
      const b = button("ln-big"); b.append(el("span", null, label), el("i", null, sub || "")); if (off) b.disabled = true; else b.addEventListener("click", fn); return b;
    };
    const nEn = window.Carta && Carta.savedEn ? Carta.savedEn().length : 0;
    row("English", "", [big("Quiz", nEn ? nEn + (nEn === 1 ? " word" : " words") : "today's words", () => { if (window.Carta && Carta.quiz) Carta.quiz(); })]);
    for (const l of ["fr", "de"]) {
      const s = loadState(l), n = s ? Object.keys(s.learn || {}).length : 0;
      row(LANG[l].own, s ? "Level " + levelOf(l, s) : "", [
        big("Translate", s && s.cur ? "continue" : "", () => translate(l)),
        big("Quiz", n ? n + (n === 1 ? " word" : " words") : "", () => quiz(l), !n),
      ]);
    }
    scroll.appendChild(box);
    scroll.scrollTop = 0;
  }

  // ---- placement: how much do you have (first time in a language) ----
  function placement() {
    scroll.innerHTML = "";
    const box = el("div", "ln-block");
    box.appendChild(header(false));
    box.appendChild(el("h2", "ln-h", "How much " + LANG[lc].name + " do you have?"));
    box.appendChild(el("p", "ln-note", "Excerpts are picked so only one to three words are new. Write what each says in English; tap a word to see where it comes from."));
    for (const [, label, z, sub] of LEVELS[lc]) {
      const b = button("ln-big ln-level"); b.append(el("span", null, label), el("i", null, sub));
      // a reset level keeps your words; only the stretch starts again
      b.addEventListener("click", () => { st = st ? Object.assign(st, { z, z0: z, hist: [], reset: 0 }) : { v: 2, z, known: {}, learn: {}, seen: {}, author: null, n: 0 }; save(); next(false); });
      box.appendChild(b);
    }
    scroll.appendChild(box);
  }
  function header(withListen) {
    const h = el("header", "dv-head ln-head");
    h.appendChild(el("span", "sc", LANG[lc].own));
    if (withListen && SP && voiceFor(lc)) { const b = button("ln-listen sc", "Listen"); b.addEventListener("click", listen); h.appendChild(b); }
    const x = button("ln-close", "×", "Close"); x.addEventListener("click", landing); h.appendChild(x);
    return h;
  }

  // ---- translate ----
  async function translate(l) {
    view = "tr"; lc = l; remember();
    scroll.innerHTML = '<div class="ln-block"><p class="ln-note">Loading…</p></div>';
    try { await load(lc); } catch (e) { scroll.innerHTML = '<div class="ln-block"><p class="ln-note">Couldn’t load the excerpts.</p></div>'; return; }
    st = loadState(lc);
    if (!st || st.reset) return placement();
    if (st.cur && st.cur.t) { cur = st.cur; render(); } else next(false);
  }
  async function next(commit) {
    if (commit && cur) {
      const now = Date.now();
      for (const y of cur.w) {
        const i = idOf(y); if (i < 0) continue;
        const w = wk(D[lc].lex[i]), x = lrn(w);
        if (x) { if (!tappedHere.has(w) && x.due <= now) held(w, x, now); }
        else if (!known(i)) st.known[w] = 1;
      }
      st.days = st.days || {}; st.days[today()] = (st.days[today()] || 0) + 1;
      st.seen[keyOf(cur)] = 1; st.n++;
    }
    scroll.innerHTML = '<div class="ln-block">' + '<p class="ln-note">Finding an excerpt…</p></div>';
    // an example queued from a word card comes first
    let q = null;
    if (st.queue && st.queue.length) q = st.queue.shift();
    if (!q) q = await pick();
    cur = q; tappedHere = new Set();
    if (q && !q.conv) { q.w = q.w.map((x) => [x[0], x[0] + x[1], x[2], x[3]]); q.conv = 1; }
    st.cur = q; st.draft = ""; st.checked = null; save();
    if (!q) { scroll.innerHTML = ""; const b = el("div", "ln-block"); b.append(header(false), el("p", "ln-note", "Nothing left at this level.")); scroll.appendChild(b); return; }
    render();
  }

  function render() {
    closeInlay(); stopSpeech();
    page.classList.add("ln-holed");
    scroll.innerHTML = "";
    const q = cur;
    const top = el("div", "ln-block ln-top");
    top.appendChild(header(true));
    const p = el("p", "ln-ex"); p.lang = lc;
    let at = 0;
    q.w.forEach(([s, e, i, alt]) => {
      if (s > at) p.appendChild(document.createTextNode(q.t.slice(at, s)));
      const w = el("span", "ln-w", q.t.slice(s, e));
      if (!isName(i) && (i < 0 || !known(i) || lrn(wk(D[lc].lex[i])))) w.classList.add("ln-new");   // dotted: new to you
      w.dataset.i = i; w.dataset.s = s; w.dataset.e = e; if (alt != null) w.dataset.alt = alt;
      w.addEventListener("click", () => tapWord(w, +w.dataset.i));
      p.appendChild(w); at = e;
    });
    if (at < q.t.length) p.appendChild(document.createTextNode(q.t.slice(at)));
    top.appendChild(p);
    if (q.r || q.a) top.appendChild(el("p", "ln-src sc", (q.r || q.a).replace(/:$/, "")));
    // the window onto the map: empty space in the page, with the map behind it
    const fig = el("figure", "ln-inlay"); fig.hidden = true;
    fig.innerHTML = '<div class="ln-co"></div>';
    const full = button("ln-full", "⤢", "Full screen"); full.addEventListener("click", () => toSwap());
    const know = button("ln-know sc", "I know this"); know.addEventListener("click", () => iKnow());
    fig.append(full, know);
    const bottom = el("div", "ln-block ln-bottom");
    const wrap = el("div", "ln-you-wrap");
    const ta = el("textarea", "ln-you"); ta.rows = 1; ta.lang = "en"; ta.placeholder = "Your English…";
    ta.setAttribute("aria-label", "Your English"); ta.setAttribute("autocapitalize", "sentences"); ta.spellcheck = true;
    ta.value = st.checked && st.draft ? st.draft : "";
    wrap.dataset.v = ta.value;
    ta.addEventListener("input", () => { wrap.dataset.v = ta.value; foot(); });
    // tapping your English while the map is open: the map closes, the keyboard comes back (focus in the tap)
    ta.addEventListener("pointerdown", () => { if (inlayOpen) closeInlay(); });
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doCheck(); } });
    wrap.appendChild(ta);
    bottom.appendChild(wrap);
    bottom.appendChild(el("div", "ln-result"));
    const f = el("div", "ln-foot"); bottom.appendChild(f);
    scroll.append(top, fig, bottom);
    if (st.checked) doCheck(true); else foot();
  }
  function foot() {
    const f = page.querySelector(".ln-foot"); if (!f) return;
    f.innerHTML = "";
    if (checked) {
      const leg = el("span", "ln-legend");
      leg.innerHTML = '<span class="ln-k ln-k-got">blue</span> you translated it · <span class="ln-k ln-k-miss">red</span> you missed it; you’ll see it again';
      const n = button("ln-go", "Next"); n.addEventListener("click", () => { stopSpeech(); next(true); });
      f.append(leg, n);
    } else {
      const ta = page.querySelector(".ln-you");
      const sk = button("ln-skip sc", "Skip"); sk.addEventListener("click", () => { stopSpeech(); next(true); });
      const c = button("ln-go", "Check"); c.disabled = !(ta && ta.value.trim()); c.addEventListener("click", () => doCheck());
      f.append(sk, c);
    }
  }

  // ---- tap a word: the keyboard drops, the map opens between the excerpt and your English ----
  function tapWord(w, i) {
    if (checked) return;
    const ta = page.querySelector(".ln-you"); if (ta) ta.blur();
    page.querySelectorAll(".ln-w.ln-sel").forEach((x) => x.classList.remove("ln-sel"));
    w.classList.add("ln-sel");
    const L = i >= 0 ? D[lc].lex[i] : null;
    tapped = { w, i, surface: w.textContent };
    if (L && !(L[7] & 1)) {
      // a tap means "show me": the word joins your words unless you say you know it
      const K = wk(L);
      if (!tappedHere.has(K)) {
        tappedHere.add(K);
        const x = lrn(K) || { n: 0, s: 0, due: 0, src: cur.a || "" };
        lapse(x); x.due = Date.now() + INT[0]; x.ctx = ctxOf(w);
        st.learn[K] = x; delete st.known[K]; save();
      }
      w.classList.add("ln-new");
    }
    openInlay(L, i, w);
  }
  // the sentence around a word, kept with it so the quiz can show where you met it
  function ctxOf(w) {
    const t = cur.t, s = +w.dataset.s, e = +w.dataset.e;
    let a = Math.max(t.lastIndexOf(". ", s), t.lastIndexOf("! ", s), t.lastIndexOf("? ", s), -1) + 1;
    let b = t.slice(e).search(/[.!?…](\s|$)/); b = b < 0 ? t.length : e + b + 1;
    if (b - a > 160) { a = Math.max(a, s - 70); b = Math.min(b, e + 70); }
    return { t: t.slice(a, b).trim(), s: w.textContent, a: cur.a || "" };
  }
  function mapIndex(L) {
    if (!L || !RM() || !RM().loaded()) return -1;
    let n = L[6] >= 0 && RM().build && RM().build() === D[lc].idx.build ? L[6] : RM().findIn(LANG[lc].name, L[0]);
    if (n < 0 && L[4]) n = RM().find(L[4]);
    return n;
  }
  function openInlay(L, i, w) {
    const fig = page.querySelector(".ln-inlay"); if (!fig) return;
    const co = fig.querySelector(".ln-co"); co.innerHTML = "";
    co.appendChild(el("b", "ln-co-w", L ? L[0] : w.textContent));
    co.appendChild(el("span", "ln-co-g", L ? L[1] || "—" : i === -2 ? "A name." : "Not in the dictionary yet."));
    if (L && L[4]) co.appendChild(el("i", "ln-co-c", (L[5] ? "≈ English " : "cousin of English ") + L[4]));
    const ai = w.dataset.alt != null ? +w.dataset.alt : -1, A = ai >= 0 ? D[lc].lex[ai] : null;
    if (A && A[0] && (A[0] !== (L && L[0]) || A[1] !== (L && L[1]))) co.appendChild(el("i", "ln-co-c", "or " + A[0] + (A[1] ? ": " + A[1] : "")));
    fig.querySelector(".ln-know").hidden = !L || !!(L[7] & 1);
    const n = mapIndex(L);
    fig.querySelector(".ln-full").hidden = n < 0;
    fig.hidden = false; inlayOpen = true; page.classList.add("ln-inlay-open");
    // keep the tapped line and the window both in view
    const wr = w.getBoundingClientRect(), sr = scroll.getBoundingClientRect();
    if (wr.top < sr.top + 8 || fig.getBoundingClientRect().bottom > sr.bottom) scroll.scrollTop += Math.min(fig.getBoundingClientRect().bottom - sr.bottom + 12, wr.top - sr.top - 60);
    tapped.n = n;
    window.CartaDiv.placeMap();
    if (n >= 0) {
      const rm = RM();
      rm.focus(n, { fly: false });
      const line = [n].concat(rm.lineage(n).slice(0, 5));
      // other words of this excerpt from the same family stay marked
      const tree = rm.treeOf(n), fam = [];
      for (const y of cur.w) { const j = idOf(y); if (j >= 0 && j !== i) { const m = mapIndex(D[lc].lex[j]); if (m >= 0 && m !== n && rm.treeOf(m) === tree) fam.push(m); } }
      rm.setMarks(fam.length ? fam : null);
      rm.fit(line, 700);
    }
  }
  function closeInlay() {
    if (!page) return;
    const fig = page.querySelector(".ln-inlay");
    if (fig) fig.hidden = true;
    page.classList.remove("ln-inlay-open");
    page.querySelectorAll(".ln-w.ln-sel").forEach((x) => x.classList.remove("ln-sel"));
    if (inlayOpen) { inlayOpen = false; if (RM() && RM().setMarks) RM().setMarks(null); window.CartaDiv.placeMap(); }
  }
  function iKnow() {
    if (!tapped) return;
    const L = tapped.i >= 0 ? D[lc].lex[tapped.i] : null;
    if (L) { const K = wk(L); delete st.learn[K]; tappedHere.delete(K); st.known[K] = 1; st.undo = { k: K, d: Date.now() }; save(); tapped.w.classList.remove("ln-new"); }
    closeInlay();
    const ta = page.querySelector(".ln-you"); if (ta) ta.focus({ preventScroll: true }); // inside the tap, so iOS raises the keyboard
  }
  // ⤢: the map fills the screen; this page waits as the strip
  function toSwap() {
    if (!tapped || tapped.n < 0) return;
    const n = tapped.n;
    closeInlay();
    window.CartaDiv.swap(true, () => { const inf = RM().info(n); if (inf && inf.isWord) Carta.run(inf.label); else Carta.openNode(n, true); });
  }

  // ---- check ----
  function doCheck(restoring) {
    const ta = page.querySelector(".ln-you"); if (!ta) return;
    const text = ta.value.trim(); if (!text) return;
    closeInlay();
    ta.blur();
    const r = judge(cur, text);
    checked = r;
    // marks in place: on the excerpt, and on the words of yours that carried a meaning across
    page.querySelectorAll(".ln-ex .ln-w").forEach((w) => { const v = r.res[+w.dataset.i]; w.classList.remove("ln-sel"); if (v === true) w.classList.add("ln-got"); else if (v === false) w.classList.add("ln-miss"); });
    const done = el("div", "ln-you-done"); done.lang = "en";
    for (const part of text.split(/([A-Za-z]+)/)) {
      if (/^[A-Za-z]+$/.test(part) && r.hitStems.has(stem(part))) done.appendChild(el("span", "ln-got", part)); else done.appendChild(document.createTextNode(part));
    }
    done.addEventListener("click", () => { // back to writing: the marks go
      checked = null; st.checked = null; save(); done.remove(); ta.parentElement.hidden = false;
      page.querySelectorAll(".ln-ex .ln-w").forEach((w) => w.classList.remove("ln-got", "ln-miss"));
      page.querySelector(".ln-result").innerHTML = ""; foot(); ta.focus({ preventScroll: true });
    });
    ta.parentElement.hidden = true; ta.parentElement.after(done);
    const n = r.got.length + r.missed.length;
    const out = page.querySelector(".ln-result"); out.innerHTML = "";
    out.appendChild(el("span", "sc", !n ? "Nothing to check here" : (cur.en ? "Translation · " : "Word by word · ") + r.got.length + " of " + n));
    if (cur.en) out.appendChild(el("p", "ln-tr", cur.en));
    else { // no published translation with this excerpt: each word's sense, in the order they come
      const ul = el("ul", "ln-wbw"), shown = new Set();
      for (const y of cur.w) {
        const i = idOf(y); if (!(i >= 0) || !(i in r.res)) continue;
        const L = D[lc].lex[i]; if (shown.has(L[0])) continue; shown.add(L[0]);
        const li = el("li", r.res[i] ? "ln-got-row" : "ln-miss-row"); li.lang = lc;
        li.append(el("b", null, L[0]), document.createTextNode(" " + L[1]));
        ul.appendChild(li);
      }
      out.appendChild(ul);
    }
    if (!restoring) {
      for (const L of r.missed) { // a word you didn't carry over joins your words, as if you'd tapped it
        const K = wk(L); if (tappedHere.has(K)) continue; tappedHere.add(K);
        const x = lrn(K) || { n: 0, s: 0, due: 0, src: cur.a || "" };
        lapse(x); x.due = Date.now() + INT[0];
        const w = [...page.querySelectorAll(".ln-ex .ln-w")].find((s) => D[lc].lex[+s.dataset.i] === L); if (w) x.ctx = ctxOf(w);
        st.learn[K] = x; delete st.known[K];
      }
      for (const L of r.got) { const x = lrn(wk(L)); if (x) x.e = Math.min(1.6, (x.e || 1) + 0.08); }
      adapt(n ? r.got.length / n : null, n);
      (st.tx = st.tx || []).push({ a: cur.a || "", t: cur.t, you: text, got: r.got.length, n, d: Date.now() });
      if (st.tx.length > 300) st.tx.splice(0, st.tx.length - 300);
    }
    st.draft = text; st.checked = 1; save();
    foot();
  }

  // ---- quiz: the words you keep missing, in the sentence where you met them ----
  let qz = null;
  async function quiz(l) {
    view = "quiz"; lc = l; remember(); closeInlay(); stopSpeech();
    page.classList.remove("ln-holed");
    scroll.innerHTML = '<div class="ln-block"><p class="ln-note">Loading…</p></div>';
    try { await load(lc); } catch (e) { return; }
    st = loadState(lc); if (!st) return landing();
    const byKey = new Map(); D[lc].lex.forEach((L, i) => { if (L && !byKey.has(wk(L))) byKey.set(wk(L), i); });
    // most-missed first, then the ones due soonest
    const words = Object.keys(st.learn).map((k) => [k, lrn(k)]).filter(([k]) => byKey.has(k))
      .sort((a, b) => (isDue(b[1]) - isDue(a[1])) || (b[1].n - a[1].n) || (a[1].due - b[1].due)).slice(0, 5);
    if (!words.length) return landing();
    qz = { items: words.map(([k, x]) => ({ k, x, i: byKey.get(k) })), at: 0, right: 0 };
    ask();
  }
  function choices(i) {
    const lex = D[lc].lex, L = lex[i], pos = (L[2] || "").split(",")[0], out = [L[1]];
    const pool = [];
    for (let t = 0; t < 6000 && pool.length < 40; t++) {
      const j = Math.floor(Math.random() * lex.length), M = lex[j];
      const loose = t > 2500; // a rare part of speech: any word of about the same frequency will do
      if (!M || j === i || !M[1] || M[7] & 1 || (!loose && (M[2] || "").split(",")[0] !== pos) || Math.abs(M[3] - L[3]) > (loose ? 20 : 12)) continue;
      if (M[1] === L[1] || pool.includes(M[1])) continue;
      pool.push(M[1]);
    }
    while (out.length < 4 && pool.length) // three wrong ones beside the right one
      out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return out.map((g) => (g.length > 70 ? g.slice(0, 68) + "…" : g)).sort(() => Math.random() - 0.5).map((g) => [g, g === (L[1].length > 70 ? L[1].slice(0, 68) + "…" : L[1])]);
  }
  function ask() {
    scroll.innerHTML = "";
    const it = qz.items[qz.at];
    const box = el("div", "ln-block ln-quiz");
    const h = el("header", "dv-head");
    h.appendChild(el("span", "sc", LANG[lc].own + " · Quiz · " + (qz.at + 1) + " of " + qz.items.length));
    const x = button("ln-close", "×", "Close"); x.addEventListener("click", landing); h.appendChild(x);
    box.appendChild(h);
    const L = D[lc].lex[it.i];
    box.appendChild(el("b", "ln-qw", L[0]));
    if (it.x.ctx && it.x.ctx.t) {
      const p = el("p", "ln-qctx"); p.lang = lc;
      const t = it.x.ctx.t, s = t.indexOf(it.x.ctx.s);
      if (s >= 0) { p.append(document.createTextNode(t.slice(0, s)), el("b", null, it.x.ctx.s), document.createTextNode(t.slice(s + it.x.ctx.s.length))); } else p.textContent = t;
      if (it.x.ctx.a) p.appendChild(document.createTextNode(" — " + it.x.ctx.a));
      box.appendChild(p);
    }
    const opts = el("div", "ln-opts");
    for (const [g, right] of choices(it.i)) {
      const b = button("ln-opt", g);
      b.addEventListener("click", () => {
        if (opts.dataset.done) return; opts.dataset.done = 1;
        const now = Date.now();
        if (right) { qz.right++; if (it.x.due <= now) held(it.k, it.x, now); else it.x.e = Math.min(1.6, (it.x.e || 1) + 0.04); }
        else { lapse(it.x); it.x.due = now + INT[0]; }
        save();
        opts.querySelectorAll(".ln-opt").forEach((o) => { if (o.textContent === b.textContent) o.classList.add(right ? "ln-right" : "ln-wrong"); });
        if (!right) [...opts.children].find((o) => o.dataset.r === "1").classList.add("ln-right");
        const go = button("ln-go", qz.at + 1 < qz.items.length ? "Next" : "Done");
        go.addEventListener("click", () => { qz.at++; if (qz.at < qz.items.length) ask(); else qdone(); });
        box.appendChild(el("div", "ln-foot")).appendChild(go);
      });
      if (right) b.dataset.r = "1";
      opts.appendChild(b);
    }
    box.appendChild(opts);
    scroll.appendChild(box);
  }
  function qdone() {
    scroll.innerHTML = "";
    const box = el("div", "ln-block ln-quiz");
    const h = el("header", "dv-head"); h.appendChild(el("span", "sc", LANG[lc].own + " · Quiz")); box.appendChild(h);
    box.appendChild(el("b", "ln-qw", qz.right + " of " + qz.items.length));
    box.appendChild(el("p", "ln-note", "The ones you missed come back sooner, in new excerpts too."));
    const f = el("div", "ln-foot"), d = button("ln-go", "Done"); d.addEventListener("click", landing); f.appendChild(d); box.appendChild(f);
    scroll.appendChild(box);
  }

  // ---- the division ----
  window.CartaDiv.define("Learn", {
    mount(p) {
      page = p; page.classList.add("ln-page");
      scroll = el("div", "dv-scroll ln-scroll"); page.appendChild(scroll);
      // the window follows the page when it scrolls or the keyboard changes the layout
      const follow = () => { if (inlayOpen) window.CartaDiv.placeMap(); };
      scroll.addEventListener("scroll", follow, { passive: true });
      if (window.visualViewport) window.visualViewport.addEventListener("resize", follow);
    },
    enter() {
      const s = S.get();
      if (view === "landing" && s.view === "tr" && s.lc) translate(s.lc);
      else if (view === "landing") landing();
    },
    again() { landing(); },
    leave() { stopSpeech(); closeInlay(); },
    back() { // the strip tapped: back on the page with the map window as it was
      if (view === "tr" && tapped && tapped.w && tapped.w.isConnected && !checked) { const t = tapped; setTimeout(() => { if (!window.CartaDiv.swapped()) { t.w.classList.add("ln-sel"); tapped = t; openInlay(t.i >= 0 ? D[lc].lex[t.i] : null, t.i, t.w); } }, 340); }
    },
    window() {
      if (!inlayOpen || !page) return null;
      const f = page.querySelector(".ln-inlay"), r = f.getBoundingClientRect(), cs = getComputedStyle(f);
      return { top: r.top + 1, bottom: r.bottom - 1, left: r.left + parseFloat(cs.borderLeftWidth) + 1, right: r.right - parseFloat(cs.borderRightWidth) - 1 };
    },
    strip() {
      const b = el("span", "ln-strip");
      if (cur && tapped) {
        const s = +tapped.w.dataset.s, e = +tapped.w.dataset.e, t = cur.t;
        const a = Math.max(0, t.lastIndexOf(" ", Math.max(0, s - 50))), z = t.indexOf(" ", Math.min(t.length, e + 30));
        const line = el("span", "ln-strip-ex"); line.lang = lc;
        line.append(document.createTextNode((a > 0 ? "… " : "") + t.slice(a, s).trimStart()), el("b", null, t.slice(s, e)), document.createTextNode(t.slice(e, z < 0 ? t.length : z) + (z < 0 ? "" : " …")));
        b.appendChild(line);
        const ta = page.querySelector(".ln-you");
        if (ta && ta.value.trim()) b.appendChild(el("i", "ln-strip-you", ta.value.length > 90 ? "… " + ta.value.slice(-88) : ta.value));
      }
      return { cap: "Learn · " + (lc ? LANG[lc].own : ""), body: b };
    },
  });
  // older entry points (map menu) land here now
  window.CartaReader = { open(l) { window.CartaDiv.go("Learn"); translate(l); }, close() {} };
  window.CartaLearn = {
    LANG, loadState, wk,
    words(l) { const s = loadState(l); return s ? s.learn : {}; },
    lex(l) { return load(l).then(() => D[l].lex); },
    // "I know this" taken back: the word goes back on your pile
    undoKnow(l, k) { const s = loadState(l); if (!s) return; delete s.known[k]; s.learn[k] = { n: 1, s: 0, due: Date.now() }; s.undo = null; try { localStorage.setItem(SKEY(l), JSON.stringify(s)); } catch (e) {} if (st && lc === l) st = s; },
    resetLevel(l) { const s = loadState(l); if (!s) return; s.reset = 1; s.cur = null; try { localStorage.setItem(SKEY(l), JSON.stringify(s)); } catch (e) {} if (lc === l) st = s; },
    open(l) { window.CartaDiv.go("Learn"); translate(l); },
    // a word card's example: it becomes your next excerpt
    queue(l, q) { const s = loadState(l); if (!s) return false; (s.queue = s.queue || []).unshift(q); try { localStorage.setItem(SKEY(l), JSON.stringify(s)); } catch (e) {} return true; },
  };
})();
