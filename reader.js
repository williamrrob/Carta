// Carta reader: French and German quotations pitched just past what you know.
// Data: reader/<fr|de>/ (scripts/build-reader.py — all Wiktionary). Progress lives on
// this device only (localStorage "carta.read.<lc>"), keyed by lemma so rebuilds keep it.
//   tap a word        → its gloss, English cousin, and know/learning buttons
//   long-press a word → fly to it on the map
//   Next              → words you didn't tap count as known
(function () {
  "use strict";
  const LANG = { fr: { name: "French", own: "Français" }, de: { name: "German", own: "Deutsch" } };
  const V = "5";
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  // reader controls are cut from the same stuff as the rest of the chrome: each look styles .menu-act
  const btn = (cls, txt) => { const b = el("button", "menu-act " + cls, txt); b.type = "button"; return b; };
  const get = (p) => fetch("reader/" + p + "?v=" + V).then((r) => { if (!r.ok) throw new Error(p); return r.json(); });

  // pasted text: the same word pattern as scripts/reader_resolve.py (quotations come with their
  // words already resolved at build time; here the forms shards carry the same ranked readings)
  const LET = "A-Za-zÀ-ÖØ-öø-ÿŒœÆæßſ";
  const WORD = new RegExp("(?:[" + LET + "]|\\[[" + LET + "]+\\])+(?:[-’'ʼ](?:[" + LET + "]|\\[[" + LET + "]+\\])+)*[’'ʼ]?", "g");
  const ELIDE = /^(l|d|j|m|n|s|t|c|qu|jusqu|lorsqu|puisqu|quoiqu)'/i;
  const ELIDED = { l: "le", d: "de", j: "je", m: "me", n: "ne", s: "se", t: "te", c: "ce", qu: "que", jusqu: "jusque", lorsqu: "lorsque", puisqu: "puisque", quoiqu: "quoique" };
  const norm = (w) => w.replace(/ſ/g, "s").replace(/[’ʼ]/g, "'").replace(/[[\]]/g, "");
  function tokens(text) {
    const out = []; let m; WORD.lastIndex = 0;
    while ((m = WORD.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 3), m.index);
      out.push([m.index, m.index + m[0].length, m[0], m.index === 0 || /[.!?…:;«»„“"(\[—–]\s*$/.test(before)]);
    }
    return out;
  }
  // one word of pasted text → [[start, end, id, alt?]] (contractions split as the build does)
  async function resolveTok(raw, s, initial) {
    const look = async (w, ini) => {
      const f = fold(w)[0], k = f && /[a-z]/.test(f) ? f : "_", sh = await formShard(k);
      return (ini && sh["^" + w]) || sh[w] || sh[w.toLowerCase()] || null;
    };
    const w = norm(raw), core = w.replace(/'$/, "");
    let r = !/'$/.test(w) && (await look(w, initial));
    if (r) return [[s, s + raw.length, r[0], r[1]]];
    if (/'$/.test(w)) {
      const e = lc === "fr" && w.match(ELIDE);
      if (e && e[0].length === w.length) { r = await look(ELIDED[e[1].toLowerCase()], false); return [[s, s + raw.length, r ? r[0] : -1]]; }
      if (lc === "de") { r = (await look(core + "e", initial)) || (await look(core, initial)); if (r) return [[s, s + raw.length, r[0], r[1]]]; }
    }
    r = await look(core, initial); if (r) return [[s, s + core.length, r[0], r[1]]];
    if (lc === "fr") { const e = core.match(ELIDE); if (e && e[0].length < core.length) { const n = e[0].length, h = await look(ELIDED[e[1].toLowerCase()], false); return [[s, s + n, h ? h[0] : -1]].concat(await resolveTok(raw.slice(n), s + n, false)); } }
    if (lc === "de" && /'s$/.test(core) && core.length > 2) { const h = await look(core.slice(0, -2), initial), es = await look("es", false); if (h) return [[s, s + core.length - 2, h[0], h[1]], [s + core.length - 2, s + core.length, es ? es[0] : -1]]; }
    if (core.includes("-")) {
      const out = []; let at = 0;
      for (const [k, seg] of raw.slice(0, core.length).split("-").entries()) {
        const a = at; at += seg.length + 1;
        if (!seg || (k > 0 && norm(seg).toLowerCase() === "t")) continue;
        out.push(...(await resolveTok(seg, s + a, initial && k === 0)));
      }
      if (out.some((x) => x[2] >= 0)) return out;
    }
    if (lc === "de" && core.includes("ß")) { r = await look(core.replace(/ß/g, "ss"), initial); if (r) return [[s, s + core.length, r[0], r[1]]]; }
    return [[s, s + core.length, /^[A-ZÀ-Ý]/.test(raw) && !initial ? -2 : -1]];
  }
  const fold = (s) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ß/g, "ss").replace(/œ/g, "oe").replace(/æ/g, "ae");

  // ---- speech: the device's own voices (Web Speech API), nothing downloaded ---------
  const SP = window.speechSynthesis || null;
  const BCP = { fr: "fr-FR", de: "de-DE" };
  const RATES = [1, 0.8, 0.6];
  const pref = (k, d) => { try { const v = localStorage.getItem("carta.read." + k); return v == null ? d : v; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem("carta.read." + k, v); } catch (e) {} };
  let speakOn = pref("speak", "1") === "1", rateIx = +pref("rate", "0") || 0, reading = null;
  function voiceFor(lc) {
    if (!SP) return null;
    hookVoices();
    const vs = SP.getVoices().filter((v) => v.lang && v.lang.replace("_", "-").toLowerCase().startsWith(lc));
    if (!vs.length) return null;
    const best = (v) => (v.lang.replace("_", "-") === BCP[lc] ? 4 : 0) + (/premium|enhanced|natural|neural/i.test(v.name) ? 2 : 0) + (v.localService ? 1 : 0);
    return vs.sort((a, b) => best(b) - best(a))[0];
  }
  // Nothing touches the speech engine until you ask for speech: on iOS, waking it claims the
  // phone's audio and pauses whatever music is playing.
  let voicesHooked = false;
  function hookVoices() { if (!voicesHooked && SP && SP.addEventListener) { voicesHooked = true; SP.addEventListener("voiceschanged", () => { if (panel && !panel.hidden && lc) header(); }); } }
  // iOS only lets speech start inside a tap; speak an empty line at the tap to unlock it
  function unlock() { if (SP && !unlock.done) { try { SP.speak(new SpeechSynthesisUtterance("")); unlock.done = true; } catch (e) {} } }
  function stopSpeech() { if (SP && (SP.speaking || SP.pending)) SP.cancel(); reading = null; if (panel) panel.querySelectorAll(".rd-reading").forEach((x) => x.classList.remove("rd-reading")); setListen(false); }
  function say(text, rate, onWord, onEnd) {
    if (!SP) return false;
    const v = voiceFor(lc);
    SP.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = v ? v.lang : BCP[lc]; if (v) u.voice = v;
    u.rate = rate;
    if (onWord) u.onboundary = (e) => { if (e.name === "word" || e.name == null) onWord(e.charIndex); };
    u.onend = u.onerror = () => { if (onEnd) onEnd(); };
    SP.speak(u);
    return true;
  }
  function readAloud() {
    if (!cur) return;
    const spans = [...body().querySelectorAll(".rd-quote .rd-w")];
    const mark = (ci) => { spans.forEach((x) => x.classList.toggle("rd-reading", +x.dataset.s <= ci && ci < +x.dataset.e)); };
    reading = cur;
    setListen(true);
    say(cur.t, RATES[rateIx] * 0.95, mark, () => { if (reading === cur) stopSpeech(); });
  }
  function setListen(on) { const b = panel && panel.querySelector(".rd-listen"); if (b) { b.textContent = on ? "■ Stop" : "▶ Listen"; b.classList.toggle("rd-on", on); } }

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
    try { const s = JSON.parse(localStorage.getItem(SKEY(lc))); if (s && s.v === 2) return s; } catch (e) {}
    return null;
  }
  function save() { try { localStorage.setItem(SKEY(lc), JSON.stringify(st)); } catch (e) {} }
  // zipf*10 at or above which a word counts as known before you've met it
  const LEVELS = { fr: [[0, "None yet", 999, "Mostly cognates to start"], [1, "A little", 55, "The few hundred commonest words"], [2, "Some", 45, "Can read simple sentences"], [3, "Plenty", 38, "Reads with a dictionary"]],
    de: [[0, "None yet", 999, "Mostly cognates to start"], [1, "High school, rusty", 52, "The commonest words come back fast"], [2, "Some", 45, "Can read simple sentences"], [3, "Plenty", 38, "Reads with a dictionary"]] };
  // Words you tap come back: first within the session, then a day, three, eight, three weeks
  // later, always in a new sentence. Reading past one without tapping is the review.
  const DAY = 864e5, INT = [8 * 6e4, DAY, 3 * DAY, 8 * DAY, 21 * DAY];
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); };
  // progress is kept per dictionary entry: the spelling, plus the etymology number for homographs
  const wk = (L) => (L[8] ? L[0] + "#" + L[8] : L[0]);
  function lrn(w) { const x = st.learn[w]; if (x == null) return null; if (typeof x === "number") st.learn[w] = { n: x, s: 0, due: 0 }; return st.learn[w]; }
  const isDue = (x) => x && x.due <= Date.now();
  // A word you lose again after it had started to stick is a hard one for you: it starts
  // over, and every later gap for it is shorter (its ease falls). Words that keep holding
  // get longer gaps. Ease lives on the word, so each word keeps its own pace.
  function lapse(x) { if (x.s > 0 || x.n > 0) x.e = Math.max(0.55, (x.e || 1) - (x.s > 0 ? 0.2 : 0.1)); x.n++; x.s = 0; }
  // The level follows your translations: when you carry nearly everything across, rarer
  // words start counting as known (sentences get harder); when a run goes badly, they stop.
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
    const w = wk(L);
    const x = lrn(w);
    if (x) return x.s >= 2; // well on the way: no longer counts against the stretch
    if (st.known[w]) return true;
    return L[3] >= st.z || (L[5] === 1 && L[3] >= 25);
  }
  const learningIn = (q) => { const out = new Set(); for (const y of q.w) { const i = idOf(y); if (i >= 0) { const x = lrn(wk(D[lc].lex[i])); if (x) out.add(i); } } return out; };
  const dueIn = (q) => { let n = 0; for (const i of learningIn(q)) if (isDue(lrn(wk(D[lc].lex[i])))) n++; return n; };
  function idOf(x) { return Array.isArray(x) ? x[2] : x; }
  const unknownIn = (q) => { const u = new Set(); let n = 0; for (const x of q.w) { const i = idOf(x); n++; if (i === -2 || (i >= 0 && D[lc].lex[i][7] & 1)) continue; if (i < 0 || !known(i)) u.add(i < 0 ? "?" + n : i); } return u; };

  // ---- picking the next quotation -----------------------------------------------
  async function pick() {
    const d = D[lc], nb = d.idx.bands.length;
    let ids = [...Array(nb).keys()];
    if (st.author) ids = d.idx.ab[st.author] || ids;
    const srcOk = (q) => (st.src === "classics" ? q.c : st.src === "newer" ? !q.c : true);
    // walk up from the easiest band; stop once there are enough at the right stretch
    const good = [], near = [];
    let fewest = null, fewestShare = 2;    // nothing at the stretch (starting from zero): the fewest new words
    for (const b of ids) {
      const qs = await band(b);
      for (const q of qs) {
        if (st.author && q.a !== st.author) continue;
        if (!srcOk(q)) continue;
        const key = q.a + "|" + q.t.slice(0, 40);
        if (st.seen[key]) continue;
        const u = unknownIn(q).size, cov = 1 - u / q.w.length;
        if (u >= 1 && u <= 3 && cov >= 0.85) good.push(q); else if (u <= 6 && cov >= 0.7) near.push([u, q]);
        else if (u / q.w.length + Math.random() * 0.02 < fewestShare) { fewestShare = u / q.w.length; fewest = q; }
      }
      if (good.length >= 25 && (!Object.keys(st.learn).length || good.some((q) => dueIn(q) > 0) || b > ids[0] + 12)) break;
    }
    if (good.length) {
      // most of the time, bring back a word that's due
      const due = good.filter((q) => dueIn(q) > 0);
      if (due.length && Math.random() < 0.75) return due[Math.floor(Math.random() * Math.min(due.length, 12))];
      return good[Math.floor(Math.random() * Math.min(good.length, 25))];
    }
    near.sort((a, b) => a[0] - b[0]);
    return near.length ? near[Math.floor(Math.random() * Math.min(near.length, 8))][1] : fewest;
  }

  // ---- rendering --------------------------------------------------------------------
  function build() {
    panel = el("section", "reader"); panel.id = "reader"; panel.hidden = true;
    panel.setAttribute("aria-label", "Reader");
    panel.innerHTML = '<header class="rd-head"><div class="rd-title"></div><div class="rd-tools"></div><button class="rd-close" type="button" aria-label="Close">×</button></header>' +
      '<div class="rd-body"></div><div class="rd-card" hidden></div><footer class="rd-foot"></footer>';
    document.body.appendChild(panel);
    panel.querySelector(".rd-close").addEventListener("click", close);
    mini = btn("rd-mini", "Back to reading"); mini.hidden = true;
    mini.addEventListener("click", () => { mini.hidden = true; panel.hidden = false; });
    document.body.appendChild(mini);
  }
  const body = () => panel.querySelector(".rd-body"), foot = () => panel.querySelector(".rd-foot"), card = () => panel.querySelector(".rd-card");

  function header() {
    const d = D[lc];
    panel.querySelector(".rd-title").textContent = LANG[lc].own;
    const tools = panel.querySelector(".rd-tools"); tools.innerHTML = "";
    const sw = btn("rd-chip", LANG[lc === "fr" ? "de" : "fr"].own);
    sw.addEventListener("click", () => open(lc === "fr" ? "de" : "fr"));
    const au = el("select", "menu-act rd-author"); au.setAttribute("aria-label", "Author");
    const cur0 = st.author || (st.src ? "src:" + st.src : "");
    [["", "All books"], ["src:classics", "Classics only"], ["src:newer", "Newer books"]].forEach(([v, t]) => au.appendChild(new Option(t, v, false, cur0 === v)));
    const og = document.createElement("optgroup"); og.label = "Authors";
    (d.idx.canon || []).slice().sort((a, b) => a.split(" ").pop().localeCompare(b.split(" ").pop())).forEach((a) => og.appendChild(new Option(a, a, false, st.author === a)));
    au.appendChild(og);
    au.addEventListener("change", () => {
      const v = au.value; st.author = null; st.src = null;
      if (v.startsWith("src:")) st.src = v.slice(4); else if (v) st.author = v;
      save(); stopSpeech(); next(false);
    });
    const own = btn("rd-chip", "Paste a text"); own.addEventListener("click", pasteMode);
    const nw = Object.keys(st.learn).length;
    const wl = btn("rd-chip rd-words-btn", nw ? "Your words · " + nw : "Your words"); wl.addEventListener("click", wordList);
    tools.append(au, wl, own, sw);
    if (SP && voiceFor(lc)) {
      const sp = btn("rd-chip rd-speak" + (speakOn ? " rd-on" : ""), speakOn ? "Aloud: on" : "Aloud: off");
      sp.setAttribute("aria-pressed", speakOn ? "true" : "false");
      sp.addEventListener("click", () => { speakOn = !speakOn; setPref("speak", speakOn ? "1" : "0"); sp.textContent = speakOn ? "Aloud: on" : "Aloud: off"; sp.classList.toggle("rd-on", speakOn); sp.setAttribute("aria-pressed", String(speakOn)); if (!speakOn) stopSpeech(); });
      tools.appendChild(sp);
    }
  }

  function placement() {
    body().innerHTML = ""; foot().innerHTML = ""; card().hidden = true;
    const box = el("div", "rd-place");
    box.appendChild(el("h2", null, "How much " + LANG[lc].name + " do you have?"));
    box.appendChild(el("p", "rd-note", "Quotations are picked so only one to three words are new. Tap a word you don't know; hold it to see it on the map. Whatever you didn't tap counts as known when you go on."));
    for (const [, label, z, sub] of LEVELS[lc]) {
      const b = btn("rd-level");
      b.append(el("span", "rd-l1", label), el("span", "rd-l2", sub));
      b.addEventListener("click", () => { st = { v: 2, z, known: {}, learn: {}, seen: {}, author: null, n: 0 }; save(); header(); next(false); });
      box.appendChild(b);
    }
    body().appendChild(box);
  }

  let tappedHere = new Set(), selMode = false, checked = false;
  function renderText(q, toks) {
    const b = body(); b.innerHTML = ""; card().hidden = true; sel = null; tappedHere = new Set(); selMode = false; checked = false;
    const p = el("p", "rd-quote"); p.lang = lc;
    let at = 0;
    toks.forEach(([s, e, i, alt], n) => {
      if (s > at) p.appendChild(document.createTextNode(q.t.slice(at, s)));
      const w = el("span", "rd-w", q.t.slice(s, e));
      if (i === -2 || (i >= 0 && D[lc].lex[i][7] & 1)) w.classList.add("rd-name");    // a person or place
      else if (i < 0) w.classList.add("rd-unk");
      else if (lrn(wk(D[lc].lex[i]))) w.classList.add("rd-learn");
      else if (!known(i)) w.classList.add(D[lc].lex[i][5] ? "rd-cog" : "rd-new");
      w.dataset.n = n; w.dataset.i = i; w.dataset.s = s; w.dataset.e = e; if (alt != null) w.dataset.alt = alt;
      bindWord(w, q, i);
      p.appendChild(w); at = e;
    });
    if (at < q.t.length) p.appendChild(document.createTextNode(q.t.slice(at)));
    b.appendChild(p);
    if (SP && voiceFor(lc)) {
      const row = el("div", "rd-audio");
      const ls = btn("rd-chip rd-listen", "▶ Listen");
      ls.addEventListener("click", () => { unlock(); if (reading) stopSpeech(); else readAloud(); });
      const rt = btn("rd-chip rd-rate", RATES[rateIx] + "×"); rt.setAttribute("aria-label", "Reading speed");
      rt.addEventListener("click", () => { rateIx = (rateIx + 1) % RATES.length; setPref("rate", String(rateIx)); rt.textContent = RATES[rateIx] + "×"; if (reading) readAloud(); });
      row.append(ls, rt);
      b.appendChild(row);
    }
    const tr = btn("rd-chip rd-whole", "Whole sentence");
    tr.addEventListener("click", () => wholeSentence(q, p, tr));
    (b.querySelector(".rd-audio") || b.appendChild(el("div", "rd-audio"))).appendChild(tr);
    if (q.r || q.a) b.appendChild(el("p", "rd-ref", q.r ? q.r.replace(/:$/, "") : q.a));
    yours(q, p);
    if (speakOn) setTimeout(readAloud, 250);
    if (q.en) {
      const t = el("details", "rd-en"); t.appendChild(el("summary", null, "Translation")); t.appendChild(el("p", null, q.en)); b.appendChild(t);
    }
  }

  // a translation of the whole sentence: the browser's own translator where it has one
  // (Chrome); otherwise the passage turns into ordinary selectable text so the system's
  // Translate (iOS / macOS text menu) can take it
  async function wholeSentence(q, p, btn) {
    const out = body().querySelector(".rd-tr");
    if (out) { out.remove(); }
    if (selMode) { selMode = false; p.classList.remove("rd-selectable"); btn.classList.remove("rd-on"); window.getSelection().removeAllRanges(); return; }
    if (window.Translator && Translator.create) {
      const box = el("p", "rd-tr", "Translating…"); p.after(box);
      try {
        // the model may still be downloading; don't leave the reader waiting on it
        const t = await Promise.race([Translator.create({ sourceLanguage: lc, targetLanguage: "en" }), new Promise((_, no) => setTimeout(() => no(new Error("slow")), 5000))]);
        box.textContent = await t.translate(q.t);
        return;
      } catch (e) { box.remove(); }
    }
    selMode = true; btn.classList.add("rd-on");
    p.classList.add("rd-selectable");
    const r = document.createRange(); r.selectNodeContents(p);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    const hint = el("p", "rd-tr rd-note", "Selected — choose Translate in the menu that appears (hold the text if it doesn't). Tap Whole sentence again to go back to words.");
    p.after(hint);
  }

  function bindWord(w, q, i) {
    let timer = null, held = false, x0 = 0, y0 = 0;
    w.addEventListener("pointerdown", (e) => {
      if (selMode) return;
      held = false; x0 = e.clientX; y0 = e.clientY;
      timer = setTimeout(() => { held = true; w.classList.add("rd-held"); toMap(i, q.t.slice(+w.dataset.s || 0)); }, 480);
    });
    const cancel = () => { clearTimeout(timer); timer = null; };
    w.addEventListener("pointermove", (e) => { if (Math.hypot(e.clientX - x0, e.clientY - y0) > 10) cancel(); });
    w.addEventListener("pointerleave", cancel); w.addEventListener("pointercancel", cancel);
    w.addEventListener("pointerup", () => { if (selMode) return; cancel(); if (!held) tap(w, i); });
    w.addEventListener("contextmenu", (e) => { if (!selMode) e.preventDefault(); });
  }

  function tap(w, i) {
    if (SP && voiceFor(lc)) { unlock(); stopSpeech(); say(w.textContent, RATES[rateIx] * 0.85); }
    body().querySelectorAll(".rd-w.rd-sel").forEach((x) => x.classList.remove("rd-sel"));
    w.classList.add("rd-sel", "rd-tapped");
    sel = i;
    const c = card(); c.innerHTML = ""; c.hidden = false;
    const L = i >= 0 ? D[lc].lex[i] : null;
    const top = el("div", "rd-c-top");
    top.appendChild(el("b", "rd-c-w", L ? L[0] : w.textContent));
    if (SP && voiceFor(lc)) {
      const again = el("button", "rd-say", "♪"); again.type = "button"; again.setAttribute("aria-label", "Say it again");
      again.addEventListener("click", () => say(L && L[0].toLowerCase() !== w.textContent.toLowerCase() ? w.textContent + ". " + L[0] : w.textContent, RATES[rateIx] * 0.8));
      top.appendChild(again);
    }
    if (L && L[2]) top.appendChild(el("i", "rd-c-pos", L[2]));
    c.appendChild(top);
    c.appendChild(el("p", "rd-c-g", L ? L[1] || "—" : i === -2 ? "A name." : "Not in the dictionary yet."));
    if (L && L[4]) c.appendChild(el("p", "rd-c-cog", (L[5] ? "≈ English " : "Cousin of English ") + L[4]));
    // without the sentence's sense there's no sure choice between homographs: show the runner-up
    const ai = w.dataset.alt != null ? +w.dataset.alt : -1, A = ai >= 0 ? D[lc].lex[ai] : null;
    if (A && A[0] && (A[0] !== (L && L[0]) || A[1] !== (L && L[1]))) c.appendChild(el("p", "rd-c-cog", "Or: " + A[0] + (A[1] ? " — " + A[1] : "")));
    if (!L || L[7] & 1) return;
    // a tap means "show me": it joins the learning pile unless you say you know it
    const K = wk(L), had = lrn(K);
    if (had && had.src && had.src !== (cur && cur.a)) c.appendChild(el("p", "rd-c-met", "Met before in " + had.src));
    if (!tappedHere.has(K)) {
      tappedHere.add(K);
      const x = had || { n: 0, s: 0, due: 0, src: cur && !cur.own ? cur.a : "your text" };
      lapse(x); x.due = Date.now() + INT[0];
      st.learn[K] = x; delete st.known[K]; save(); wordsChip();
    }
    w.classList.remove("rd-cog", "rd-learn"); w.classList.add("rd-new");
    footer(!!(cur && cur.own));
    const row = el("div", "rd-c-acts");
    const k = btn("rd-btn", "I know this");
    k.addEventListener("click", () => { delete st.learn[K]; tappedHere.delete(K); st.known[K] = 1; save(); wordsChip(); w.classList.remove("rd-new", "rd-tapped"); c.hidden = true; footer(!!(cur && cur.own)); });
    const m = btn("rd-btn rd-btn-map", "On the map");
    m.addEventListener("click", () => toMap(i));
    row.append(k, m);
    c.appendChild(row);
  }

  // ---- your translation ----------------------------------------------------------------
  // You write the English; Carta checks it against what it knows, word by word: every
  // content word's dictionary sense should turn up somewhere in what you wrote. The
  // ones that don't are marked and join your words. Nothing here is generated: the
  // senses are Wiktionary's, and the whole-sentence version (where shown) is the
  // browser's own translator.
  const STOP = new Set("the a an of to in on at by for from with and or as be is are was were it its this that these those one someone something someplace sth sb used form not no very more most also".split(" "));
  const SKIP_POS = /^(article|det|pron|prep|postp|conj|particle|contraction|intj|interfix|punct|num)/i;
  const CHECK_MAX_Z = 62; // the very commonest words (sein, werden, être, avoir…) bend too much to check one-to-one
  const stem = (w) => w.toLowerCase().replace(/(ing|ed|es|s|ly)$/, "").slice(0, 5);
  function senseStems(g) {
    const out = new Set();
    for (const part of g.split(/[;,/]|\bor\b/)) for (const m of part.toLowerCase().replace(/\([^)]*\)/g, " ").match(/[a-z]+/g) || []) {
      if (m.length < 3 || STOP.has(m)) continue;
      out.add(stem(m));
    }
    return out;
  }
  function yours(q, p) {
    const box = el("div", "rd-yours");
    box.appendChild(el("label", "rd-you-cap", "Your English"));
    const ta = el("textarea", "rd-you"); ta.rows = 3; ta.lang = "en"; ta.placeholder = "Write what it says…";
    ta.setAttribute("autocapitalize", "sentences"); ta.spellcheck = true;
    ta.addEventListener("input", () => { if (checked) { checked = false; box.querySelector(".rd-verdict") && box.querySelector(".rd-verdict").remove(); footer(!!(cur && cur.own)); } });
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); check(q, ta); } });
    box.appendChild(ta);
    body().appendChild(box);
  }
  async function check(q, ta) {
    const text = ta.value.trim(); if (!text) return;
    checked = true;
    const mine = new Set((text.toLowerCase().match(/[a-z]+/g) || []).map(stem));
    const spans = [...body().querySelectorAll(".rd-quote .rd-w")];
    const got = [], missed = [];
    const seenL = new Set();
    for (const w of spans) {
      const i = +w.dataset.i; if (!(i >= 0)) continue;
      const L = D[lc].lex[i]; if (!L || !L[1] || L[7] & 1 || SKIP_POS.test(L[2] || "") || L[3] >= CHECK_MAX_Z) continue;
      if (seenL.has(L[0])) continue; seenL.add(L[0]);
      const st0 = senseStems(L[1]); if (!st0.size) continue;
      let hit = false;
      for (const g of st0) for (const m of mine) if (m === g || (g.length >= 4 && m.length >= 4 && (m.startsWith(g.slice(0, 4)) || g.startsWith(m.slice(0, 4))))) { hit = true; break; }
      // a cognate you carried straight across counts too
      if (!hit && L[4]) { const c = stem(L[4]); for (const m of mine) if (m.length >= 4 && (m.startsWith(c.slice(0, 4)))) hit = true; }
      spans.filter((x) => +x.dataset.i === i).forEach((x) => x.classList.add(hit ? "rd-got" : "rd-miss"));
      (hit ? got : missed).push(L);
    }
    const box = body().querySelector(".rd-yours");
    const old = box.querySelector(".rd-verdict"); if (old) old.remove();
    const v = el("div", "rd-verdict");
    const n = got.length + missed.length;
    v.appendChild(el("p", "rd-v-sum", !n ? "Nothing to check here." : missed.length ? got.length + " of " + n + " meanings found in your English." : "Every meaning is there."));
    if (missed.length) {
      const ul = el("ul", "rd-v-miss");
      for (const L of missed) {
        const li = el("li"); li.append(el("b", null, L[0]), document.createTextNode(" — " + L[1]));
        ul.appendChild(li);
        // a word you didn't carry over joins your words, as if you'd tapped it
        if (!tappedHere.has(wk(L))) {
          tappedHere.add(wk(L));
          const x = lrn(wk(L)) || { n: 0, s: 0, due: 0, src: cur && !cur.own ? cur.a : "your text" };
          lapse(x); x.due = Date.now() + INT[0]; st.learn[wk(L)] = x; delete st.known[wk(L)];
        }
      }
      v.appendChild(ul);
    }
    box.appendChild(v);
    // carried over correctly while still learning: that word is getting easier
    for (const L of got) { const x = lrn(wk(L)); if (x) x.e = Math.min(1.6, (x.e || 1) + 0.08); }
    adapt(n ? got.length / n : null, n);
    (st.tx = st.tx || []).push({ a: q.a || "", t: q.t, you: text, got: got.length, n, d: Date.now() });
    if (st.tx.length > 300) st.tx.splice(0, st.tx.length - 300);
    save(); wordsChip(); footer(!!(cur && cur.own));
    if (window.Translator && Translator.create) {
      try {
        const t = await Promise.race([Translator.create({ sourceLanguage: lc, targetLanguage: "en" }), new Promise((_, no) => setTimeout(() => no(new Error("slow")), 5000))]);
        const out = await t.translate(q.t);
        if (box.isConnected) { const r = el("p", "rd-tr"); r.append(el("span", "rd-tr-cap", "Your browser's translation: "), document.createTextNode(out)); v.appendChild(r); }
      } catch (e) {}
    }
  }

  // ---- your words: everything you've tapped (or missed in a translation) -----------------
  function wordsChip() { const c = panel && panel.querySelector(".rd-words-btn"); if (c) { const n = Object.keys(st.learn).length; c.textContent = n ? "Your words · " + n : "Your words"; } }
  function lexIndex() { const d = D[lc]; if (!d.byLemma) { d.byLemma = new Map(); d.lex.forEach((L, i) => { if (L && !d.byLemma.has(wk(L))) d.byLemma.set(wk(L), i); }); } return d.byLemma; }
  function when(due) {
    const d = due - Date.now();
    if (d <= 0) return "due now";
    const h = d / 36e5; if (h < 1) return "back in " + Math.max(1, Math.round(h * 60)) + " min"; if (h < 20) { const r = Math.round(h); return "back in " + r + (r === 1 ? " hour" : " hours"); }
    const days = Math.round(h / 24); return "back in " + days + (days === 1 ? " day" : " days");
  }
  function wordList() {
    stopSpeech(); card().hidden = true;
    const b = body(); b.innerHTML = "";
    const top = el("div", "rd-wl-top");
    top.appendChild(el("h2", "rd-wl-h", "Your words"));
    const back = btn("rd-chip", "Back to reading"); back.addEventListener("click", () => { header(); if (cur && cur.w) { renderText(cur, cur.w); footer(!!cur.own); } else next(false); });
    top.appendChild(back); b.appendChild(top);
    const words = Object.keys(st.learn).map((w) => [w, lrn(w)]).sort((a, z) => (a[1].due || 0) - (z[1].due || 0));
    if (!words.length) { b.appendChild(el("p", "rd-note", "Words you tap, and words your translation misses, collect here. They come back in new sentences until they stick.")); foot().innerHTML = ""; return; }
    b.appendChild(el("p", "rd-note", words.length + " words. Each comes back in a new sentence; read past it five times without tapping and it's learned."));
    const idx = lexIndex();
    const ul = el("ul", "rd-wl");
    for (const [w, x] of words) {
      const i = idx.has(w) ? idx.get(w) : -1, L = i >= 0 ? D[lc].lex[i] : null;
      const li = el("li", "rd-wl-i");
      const head = el("div", "rd-wl-head");
      head.appendChild(el("b", "rd-wl-w", L ? L[0] : w.replace(/#.*$/, "")));
      if (L && L[2]) head.appendChild(el("i", "rd-c-pos", L[2]));
      head.appendChild(el("span", "rd-wl-when", (x.s ? "step " + (x.s + 1) + " of 5 · " : "") + when(x.due)));
      li.appendChild(head);
      if (L && L[1]) li.appendChild(el("p", "rd-c-g", L[1]));
      if (L && L[4]) li.appendChild(el("p", "rd-c-cog", (L[5] ? "≈ English " : "Cousin of English ") + L[4]));
      if (x.src) li.appendChild(el("p", "rd-c-met", "Met in " + x.src));
      const acts = el("div", "rd-c-acts");
      if (SP && voiceFor(lc)) { const sy = btn("rd-btn", "♪ Say"); sy.addEventListener("click", () => { unlock(); say(L ? L[0] : w.replace(/#.*$/, ""), RATES[rateIx] * 0.85); }); acts.appendChild(sy); }
      const kn = btn("rd-btn", "I know it"); kn.addEventListener("click", () => { delete st.learn[w]; st.known[w] = 1; save(); li.remove(); });
      acts.appendChild(kn);
      if (i >= 0) { const mp = btn("rd-btn", "On the map"); mp.addEventListener("click", () => toMap(i)); acts.appendChild(mp); }
      li.appendChild(acts);
      ul.appendChild(li);
    }
    b.appendChild(ul);
    foot().innerHTML = "";
  }

  function toMap(i) {
    const L = i >= 0 ? D[lc].lex[i] : null;
    if (!L || !window.RootMap || !RootMap.loaded()) return;
    let n = L[6] >= 0 && RootMap.build && RootMap.build() === D[lc].idx.build ? L[6] : RootMap.findIn(LANG[lc].name, L[0]);
    if (n < 0 && L[4]) n = RootMap.find(L[4]);
    if (n < 0) { flash("Not on the map yet"); return; }
    stopSpeech(); panel.hidden = true; mini.hidden = false;
    if (window.Carta && Carta.openNode) Carta.openNode(n, true);
  }
  function flash(t) { const f = el("div", "rd-flash", t); panel.appendChild(f); setTimeout(() => f.remove(), 1600); }

  function footer(isOwn) {
    const f = foot(); f.innerHTML = "";
    const days = st.days || {}, t = days[today()] || 0;
    let run = 0;
    for (let k = 0; k < 400; k++) {
      const d = new Date(Date.now() - k * DAY), key = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
      if (days[key]) run++; else if (k > 0) break;
    }
    const learning = Object.keys(st.learn).length, grad = st.grad || 0;
    const bits = [t + " today"];
    if (run >= 2) bits.push(run + " days running");
    bits.push(learning + " learning");
    if (grad) bits.push(grad + " learned");
    const info = el("span", "rd-count", bits.join(" · "));
    if (t >= 8 && !isOwn) info.appendChild(el("span", "rd-stop", "A good place to stop — the next one will keep."));
    f.appendChild(info);
    const ta = body().querySelector(".rd-you");
    const needCheck = ta && !checked;
    if (needCheck) {
      const sk = el("button", "rd-skip", "Skip"); sk.type = "button";
      sk.addEventListener("click", () => { if (speakOn) unlock(); stopSpeech(); next(true); });
      f.appendChild(sk);
    }
    const nx = btn("rd-btn rd-next", needCheck ? "Check" : isOwn ? "Done" : "Next");
    nx.addEventListener("click", () => {
      if (needCheck) { if (!ta.value.trim()) { ta.focus(); return; } return check(cur, ta); }
      if (speakOn) unlock(); stopSpeech(); next(true);
    });
    f.appendChild(nx);
  }


  async function next(commit) {
    if (commit && cur) {
      // words met and not tapped: known now
      const now = Date.now();
      for (const y of cur.w) {
        const i = idOf(y);
        if (i < 0) continue;
        const w = wk(D[lc].lex[i]), x = lrn(w);
        if (x) {
          // read past it without asking: it held. Early sightings don't count; it has to have faded a little
          if (!tappedHere.has(w) && x.due <= now) {
            x.s++;
            if (x.s >= INT.length) { delete st.learn[w]; st.known[w] = 1; st.grad = (st.grad || 0) + 1; }
            else { x.e = Math.min(1.6, (x.e || 1) + 0.04); x.due = now + INT[x.s] * (x.e || 1) * (0.85 + Math.random() * 0.3); }
          }
        } else if (!known(i)) st.known[w] = 1;
      }
      st.days = st.days || {}; st.days[today()] = (st.days[today()] || 0) + 1;
      if (!cur.own) st.seen[cur.a + "|" + cur.t.slice(0, 40)] = 1;
      st.n++;
      save();
    }
    body().innerHTML = '<p class="rd-note">Finding a quotation…</p>';
    const q = await pick();
    cur = q;
    if (!q) { body().innerHTML = '<p class="rd-note">Nothing left at this level' + (st.author ? " for this author" : "") + ".</p>"; footer(false); return; }
    // quotations carry each word's position and reading from the build: [start, length, id, runner-up?]
    if (!q.conv) { q.w = q.w.map((x) => [x[0], x[0] + x[1], x[2], x[3]]); q.conv = 1; }
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
    const go = btn("rd-btn", "Read it");
    go.addEventListener("click", async () => {
      const t = ta.value.trim(); if (!t) return;
      try { localStorage.setItem("carta.read.paste." + lc, t); } catch (e) {}
      const w = [];
      for (const [s, , raw, ini] of tokens(t)) w.push(...(await resolveTok(raw, s, ini)));
      cur = { t, w, own: true, a: "", r: "Your text" };
      renderText(cur, w); footer(true);
    });
    b.appendChild(go);
    foot().innerHTML = "";
  }

  async function open(which) {
    stopSpeech();
    if (!panel) build();
    lc = which; panel.hidden = false; mini.hidden = true;
    body().innerHTML = '<p class="rd-note">Loading…</p>';
    try { await load(lc); } catch (e) { body().innerHTML = '<p class="rd-note">Couldn\'t load the reader.</p>'; return; }
    st = loadState(lc);
    if (!st) { header0(); return placement(); }
    header(); next(false);
  }
  function header0() { panel.querySelector(".rd-title").textContent = LANG[lc].own; panel.querySelector(".rd-tools").innerHTML = ""; }
  function close() { stopSpeech(); panel.hidden = true; mini.hidden = true; card().hidden = true; }

  window.CartaReader = { open, close };
})();
