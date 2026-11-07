// Carta reader: French and German quotations pitched just past what you know.
// Data: reader/<fr|de>/ (scripts/build-reader.py — all Wiktionary). Progress lives on
// this device only (localStorage "carta.read.<lc>"), keyed by lemma so rebuilds keep it.
//   tap a word        → its gloss, English cousin, and know/learning buttons
//   long-press a word → fly to it on the map
//   Next              → words you didn't tap count as known
(function () {
  "use strict";
  const LANG = { fr: { name: "French", own: "Français" }, de: { name: "German", own: "Deutsch" } };
  const V = "4";
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

  // ---- speech: the device's own voices (Web Speech API), nothing downloaded ---------
  const SP = window.speechSynthesis || null;
  const BCP = { fr: "fr-FR", de: "de-DE" };
  const RATES = [1, 0.8, 0.6];
  const pref = (k, d) => { try { const v = localStorage.getItem("carta.read." + k); return v == null ? d : v; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem("carta.read." + k, v); } catch (e) {} };
  let speakOn = pref("speak", "1") === "1", rateIx = +pref("rate", "0") || 0, reading = null;
  function voiceFor(lc) {
    if (!SP) return null;
    const vs = SP.getVoices().filter((v) => v.lang && v.lang.replace("_", "-").toLowerCase().startsWith(lc));
    if (!vs.length) return null;
    const best = (v) => (v.lang.replace("_", "-") === BCP[lc] ? 4 : 0) + (/premium|enhanced|natural|neural/i.test(v.name) ? 2 : 0) + (v.localService ? 1 : 0);
    return vs.sort((a, b) => best(b) - best(a))[0];
  }
  if (SP && SP.addEventListener) SP.addEventListener("voiceschanged", () => { if (panel && !panel.hidden && lc) header(); });
  // iOS only lets speech start inside a tap; speak an empty line at the tap to unlock it
  function unlock() { if (SP && !unlock.done) { try { SP.speak(new SpeechSynthesisUtterance("")); unlock.done = true; } catch (e) {} } }
  function stopSpeech() { if (SP) SP.cancel(); reading = null; if (panel) panel.querySelectorAll(".rd-reading").forEach((x) => x.classList.remove("rd-reading")); setListen(false); }
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
    try { const s = JSON.parse(localStorage.getItem(SKEY(lc))); if (s && s.v === 1) return s; } catch (e) {}
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
  function lrn(w) { const x = st.learn[w]; if (x == null) return null; if (typeof x === "number") st.learn[w] = { n: x, s: 0, due: 0 }; return st.learn[w]; }
  const isDue = (x) => x && x.due <= Date.now();
  function known(i) {
    const L = D[lc].lex[i]; if (!L) return false;
    const w = L[0];
    const x = lrn(w);
    if (x) return x.s >= 2; // well on the way: no longer counts against the stretch
    if (st.known[w]) return true;
    return L[3] >= st.z || (L[5] === 1 && L[3] >= 25);
  }
  const learningIn = (q) => { const out = new Set(); for (const y of q.w) { const i = idOf(y); if (i >= 0) { const x = lrn(D[lc].lex[i][0]); if (x) out.add(i); } } return out; };
  const dueIn = (q) => { let n = 0; for (const i of learningIn(q)) if (isDue(lrn(D[lc].lex[i][0]))) n++; return n; };
  function idOf(x) { return Array.isArray(x) ? x[2] : x; }
  const unknownIn = (q) => { const u = new Set(); let n = 0; for (const x of q.w) { const i = idOf(x); n++; if (i < 0 || !known(i)) u.add(i < 0 ? "?" + n : i); } return u; };

  // ---- picking the next quotation -----------------------------------------------
  async function pick() {
    const d = D[lc], nb = d.idx.bands.length;
    let ids = [...Array(nb).keys()];
    if (st.author) ids = d.idx.ab[st.author] || ids;
    const srcOk = (q) => (st.src === "classics" ? q.c : st.src === "newer" ? !q.c : true);
    // walk up from the easiest band; stop once there are enough at the right stretch
    const good = [], near = [];
    for (const b of ids) {
      const qs = await band(b);
      for (const q of qs) {
        if (st.author && q.a !== st.author) continue;
        if (!srcOk(q)) continue;
        const key = q.a + "|" + q.t.slice(0, 40);
        if (st.seen[key]) continue;
        const u = unknownIn(q).size, cov = 1 - u / q.w.length;
        if (u >= 1 && u <= 3 && cov >= 0.85) good.push(q); else if (u <= 6 && cov >= 0.7) near.push([u, q]);
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
    const own = el("button", "rd-chip", "Paste a text"); own.type = "button"; own.addEventListener("click", pasteMode);
    tools.append(au, own, sw);
    if (SP && voiceFor(lc)) {
      const sp = el("button", "rd-chip rd-speak", speakOn ? "🔊 Read aloud" : "🔇 Silent"); sp.type = "button";
      sp.setAttribute("aria-pressed", speakOn ? "true" : "false");
      sp.addEventListener("click", () => { unlock(); speakOn = !speakOn; setPref("speak", speakOn ? "1" : "0"); sp.textContent = speakOn ? "🔊 Read aloud" : "🔇 Silent"; sp.setAttribute("aria-pressed", String(speakOn)); if (!speakOn) stopSpeech(); });
      tools.appendChild(sp);
    }
  }

  function placement() {
    body().innerHTML = ""; foot().innerHTML = ""; card().hidden = true;
    const box = el("div", "rd-place");
    box.appendChild(el("h2", null, "How much " + LANG[lc].name + " do you have?"));
    box.appendChild(el("p", "rd-note", "Quotations are picked so only one to three words are new. Tap a word you don't know; hold it to see it on the map. Whatever you didn't tap counts as known when you go on."));
    for (const [, label, z, sub] of LEVELS[lc]) {
      const b = el("button", "rd-level"); b.type = "button";
      b.append(el("span", "rd-l1", label), el("span", "rd-l2", sub));
      b.addEventListener("click", () => { unlock(); st = { v: 1, z, known: {}, learn: {}, seen: {}, author: null, n: 0 }; save(); header(); next(false); });
      box.appendChild(b);
    }
    body().appendChild(box);
  }

  let tappedHere = new Set(), selMode = false;
  function renderText(q, toks) {
    const b = body(); b.innerHTML = ""; card().hidden = true; sel = null; tappedHere = new Set(); selMode = false;
    const p = el("p", "rd-quote"); p.lang = lc;
    let at = 0;
    toks.forEach(([s, e, i], n) => {
      if (s > at) p.appendChild(document.createTextNode(q.t.slice(at, s)));
      const w = el("span", "rd-w", q.t.slice(s, e));
      if (i < 0) w.classList.add("rd-unk");
      else if (lrn(D[lc].lex[i][0])) w.classList.add("rd-learn");
      else if (!known(i)) w.classList.add(D[lc].lex[i][5] ? "rd-cog" : "rd-new");
      w.dataset.n = n; w.dataset.i = i; w.dataset.s = s; w.dataset.e = e;
      bindWord(w, q, i);
      p.appendChild(w); at = e;
    });
    if (at < q.t.length) p.appendChild(document.createTextNode(q.t.slice(at)));
    b.appendChild(p);
    if (SP && voiceFor(lc)) {
      const row = el("div", "rd-audio");
      const ls = el("button", "rd-chip rd-listen", "▶ Listen"); ls.type = "button";
      ls.addEventListener("click", () => { unlock(); if (reading) stopSpeech(); else readAloud(); });
      const rt = el("button", "rd-chip rd-rate", RATES[rateIx] + "×"); rt.type = "button"; rt.setAttribute("aria-label", "Reading speed");
      rt.addEventListener("click", () => { rateIx = (rateIx + 1) % RATES.length; setPref("rate", String(rateIx)); rt.textContent = RATES[rateIx] + "×"; if (reading) readAloud(); });
      row.append(ls, rt);
      b.appendChild(row);
    }
    const tr = el("button", "rd-chip rd-whole", "Whole sentence"); tr.type = "button";
    tr.addEventListener("click", () => wholeSentence(q, p, tr));
    (b.querySelector(".rd-audio") || b.appendChild(el("div", "rd-audio"))).appendChild(tr);
    if (q.r || q.a) b.appendChild(el("p", "rd-ref", q.r ? q.r.replace(/:$/, "") : q.a));
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
      const again = el("button", "rd-say", "🔊"); again.type = "button"; again.setAttribute("aria-label", "Say it again");
      again.addEventListener("click", () => say(L && L[0].toLowerCase() !== w.textContent.toLowerCase() ? w.textContent + ". " + L[0] : w.textContent, RATES[rateIx] * 0.8));
      top.appendChild(again);
    }
    if (L && L[2]) top.appendChild(el("i", "rd-c-pos", L[2]));
    c.appendChild(top);
    c.appendChild(el("p", "rd-c-g", L ? L[1] || "—" : "Not in the dictionary yet."));
    if (L && L[4]) c.appendChild(el("p", "rd-c-cog", (L[5] ? "≈ English " : "Cousin of English ") + L[4]));
    if (!L) return;
    // a tap means "show me": it joins the learning pile unless you say you know it
    const had = lrn(L[0]);
    if (had && had.src && had.src !== (cur && cur.a)) c.appendChild(el("p", "rd-c-met", "Met before in " + had.src));
    if (!tappedHere.has(L[0])) {
      tappedHere.add(L[0]);
      const x = had || { n: 0, s: 0, due: 0, src: cur && !cur.own ? cur.a : "your text" };
      x.n++; x.s = 0; x.due = Date.now() + INT[0];
      st.learn[L[0]] = x; delete st.known[L[0]]; save();
    }
    w.classList.remove("rd-cog", "rd-learn"); w.classList.add("rd-new");
    footer(!!(cur && cur.own));
    const row = el("div", "rd-c-acts");
    const k = el("button", "rd-btn", "I know this"); k.type = "button";
    k.addEventListener("click", () => { delete st.learn[L[0]]; tappedHere.delete(L[0]); st.known[L[0]] = 1; save(); w.classList.remove("rd-new", "rd-tapped"); c.hidden = true; footer(!!(cur && cur.own)); });
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
    const nx = el("button", "rd-btn rd-next", isOwn ? "Done" : "Next"); nx.type = "button";
    nx.addEventListener("click", () => { unlock(); stopSpeech(); next(true); });
    f.appendChild(nx);
  }


  async function next(commit) {
    if (commit && cur) {
      // words met and not tapped: known now
      const now = Date.now();
      for (const y of cur.w) {
        const i = idOf(y);
        if (i < 0) continue;
        const w = D[lc].lex[i][0], x = lrn(w);
        if (x) {
          // read past it without asking: it held. Early sightings don't count; it has to have faded a little
          if (!tappedHere.has(w) && x.due <= now) {
            x.s++;
            if (x.s >= INT.length) { delete st.learn[w]; st.known[w] = 1; st.grad = (st.grad || 0) + 1; }
            else x.due = now + INT[x.s] * (0.85 + Math.random() * 0.3);
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
    // quotations store lemma ids only; positions come from the same tokenizer the build used
    const tk = tokens(q.t, lc);
    const w = tk.length === q.w.length ? tk.map(([s, e], n) => [s, e, idOf(q.w[n])]) : tk.map(([s, e]) => [s, e, -1]);
    q.w = w;
    renderText(q, w);
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
    unlock(); stopSpeech();
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
