// Carta's four divisions (PLAN-DIVISIONS.md): Explore · Learn · Search · Saved, reached from the orb.
//
// One map serves them all. It never moves or resizes: pages sit over it, and a division that
// wants the map either opens a window in its page (RootMap.setViewport) or *swaps*: the page
// slides away, the map fills the screen, and the page waits as a strip at the bottom (tap it to
// come back). Each division keeps its own place: the map's camera, lit word and marks are saved
// when you leave it (RootMap.scene) and put back when you return.
//
// Modules register with CartaDiv.define(name, {mount(page), enter(), leave(), strip(), window()}).
// Explore is the map itself (app.js); Search and Saved live here; Learn is learn.js.
(function () {
  "use strict";
  const root = document.documentElement;
  const NAMES = ["Explore", "Learn", "Search", "Saved"];
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const button = (cls, txt, label) => { const b = el("button", cls, txt); b.type = "button"; if (label) b.setAttribute("aria-label", label); return b; };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  // fold() is shared with scripts/build-division-index.js: keep the two identical
  const fold = (s) => String(s).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ß/g, "ss").replace(/œ/g, "oe").replace(/æ/g, "ae");

  const mods = {};
  const scenes = {};             // division → { map: RootMap.scene(), place: app's "@i" / word }
  let cur = "Explore", swapped = false, started = false;
  let app, pages = {}, strip, nav;
  const RM = () => window.RootMap;
  const on = () => root.getAttribute("data-look") === "priestley";
  const H = () => (app && app.getBoundingClientRect().height) || window.innerHeight;

  // ---- the shell ------------------------------------------------------------------------
  function build() {
    app = document.querySelector(".app");
    for (const n of NAMES.slice(1)) {
      const p = el("section", "dv-page"); p.dataset.div = n; p.hidden = true; p.setAttribute("aria-label", n);
      app.appendChild(p); pages[n] = p;
      p.addEventListener("transitionend", (e) => { if (e.target === p) placeMap(); }); // a window measured mid-slide is re-measured once the page settles
    }
    strip = button("dv-strip", null, "Back to the page"); strip.hidden = true;
    strip.addEventListener("click", () => swap(false));
    app.appendChild(strip);
    // Back · Forward · Step out: the map's own history (app.js keeps it; these are its buttons)
    nav = el("div", "dv-nav");
    const proxy = (id, glyph, label) => {
      const b = button("dv-nav-btn", glyph, label), src = document.getElementById(id);
      b.dataset.for = id;
      b.addEventListener("click", () => { if (src && !src.disabled) src.click(); });
      if (src) { const sync = () => { b.disabled = !!src.disabled; }; sync(); new MutationObserver(sync).observe(src, { attributes: true, attributeFilter: ["disabled"] }); }
      return b;
    };
    nav.append(proxy("navBack", "←", "Back"), proxy("navFwd", "→", "Forward"), proxy("navHome", "⤢", "Step out"));
    app.appendChild(nav);
    explore.build();
    window.addEventListener("resize", () => { if (started) placeMap(); });
  }

  // where the map may show for the current state
  function placeMap() {
    const rm = RM(); if (!rm || !rm.setViewport) return;
    app.style.setProperty("--dv-floor", floor() + "px");
    if (!on() || cur === "Explore" || swapped) { rm.setViewport(null); if (window.Carta) Carta.sheet(Carta.sheet()); return; }
    const w = mods[cur] && mods[cur].window ? mods[cur].window() : null;   // a window in the page (Learn's inlay)
    rm.setViewport(w ? { top: w.top, bottom: H() - w.bottom, left: w.left || 0, right: w.right != null ? (app.getBoundingClientRect().width - w.right) : 0 } : { top: H(), bottom: 0 });
  }
  // the strip and the nav row sit under the map's working area while swapped
  // Explore keeps its nav row clear; a swap also keeps the strip clear
  function floor() { if (!on()) return 0; if (swapped && strip && !strip.hidden) return strip.offsetHeight + 86; return cur === "Explore" ? 76 : 0; }

  function render() {
    app.dataset.div = on() ? cur : "";
    app.dataset.swap = swapped ? "1" : "";
    for (const n in pages) pages[n].hidden = !on() || n !== cur;
    if (swapped && mods[cur] && mods[cur].strip) {
      strip.innerHTML = "";
      const s = mods[cur].strip();
      strip.appendChild(el("span", "dv-strip-cap", s.cap));
      if (s.body) strip.appendChild(s.body);
      strip.hidden = false;
    } else strip.hidden = true;
    nav.hidden = !on() || !(cur === "Explore" || swapped);
    nav.querySelector('[data-for="navHome"]').hidden = cur !== "Explore";
    explore.show(on() && cur === "Explore");
    placeMap();
  }

  function saveScene(n) {
    const rm = RM(); if (!rm || !rm.loaded || !rm.loaded()) return;
    scenes[n] = { map: rm.scene(), place: window.Carta ? Carta.word() : "" };
  }
  // put a division's map back as it was; Explore also gets its word (and callout) back
  function restoreScene(n) {
    const sc = scenes[n], rm = RM(); if (!sc || !rm) return;
    if (n === "Explore" && window.Carta && sc.place !== Carta.word()) {
      if (sc.place) Carta.run(sc.place); else { Carta.home(); rm.setScene(sc.map, 0); }
      return;
    }
    rm.setScene(sc.map, 0);
  }

  function go(n) {
    if (!NAMES.includes(n)) return;
    if (n === cur) { if (swapped) swap(false); else if (mods[n] && mods[n].again) mods[n].again(); return; }
    if (cur === "Explore" || swapped) saveScene(cur + (swapped ? ":swap" : ""));
    if (mods[cur] && mods[cur].leave) mods[cur].leave();
    cur = n; swapped = false;
    store.set("carta.div", { cur: n });
    ensureMounted(n);
    render();
    if (n === "Explore") restoreScene("Explore");
    if (mods[n] && mods[n].enter) mods[n].enter();
  }
  function ensureMounted(n) { const m = mods[n]; if (m && !m.mounted && m.mount) { m.mounted = true; m.mount(pages[n]); } }

  // swap: the map fills the screen; the page waits as the strip
  function swap(want, then) {
    if (cur === "Explore" || want === swapped) { if (then) then(); return; }
    if (!want) saveScene(cur + ":swap");
    swapped = want;
    render();
    if (want) {
      if (window.Carta) Carta.sheet(Carta.sheet());          // frame above the strip
      if (scenes[cur + ":swap"] && !then) restoreScene(cur + ":swap");
      if (then) then();
    } else {
      if (window.Carta && Carta.sheet() !== "home") Carta.sheet("callout"); // a word card opened from the strip goes away with it
      if (mods[cur] && mods[cur].back) mods[cur].back();
    }
  }

  // ---- Search: words in all four languages, inflected forms understood -------------------------
  const search = (function () {
    let page, input, count, list, sorted = null, sortedP = null, token = 0, results = [], q0 = "";
    const forms = new Map();
    const LANG_CAP = { English: "English", French: "Français", German: "Deutsch" };
    const langCap = (n) => LANG_CAP[n] || (n === "Latin" ? "Latina" : n.replace(/ Latin$/, " Lat."));
    function loadSorted() {
      if (!sortedP) sortedP = RM().ready.then(() => RM().fetchGraph("sorted4.bin")).then((r) => r.arrayBuffer()).then((b) => { sorted = new Uint32Array(b); return sorted; });
      return sortedP;
    }
    function formShard(lc, k) {
      const key = lc + "-" + k;
      if (!forms.has(key)) forms.set(key, RM().fetchGraph("forms/" + key + ".json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
      return forms.get(key);
    }
    // first index whose folded label is ≥ q
    function lower(q) {
      let lo = 0, hi = sorted.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (fold(RM().label(sorted[m])) < q) lo = m + 1; else hi = m; }
      return lo;
    }
    async function find(raw) {
      const q = fold(raw.trim()); q0 = raw.trim();
      const t = ++token;
      if (!q) { results = []; draw(); return; }
      await loadSorted(); if (t !== token) return;
      const exact = [], pre = []; let total = 0;
      for (let k = lower(q); k < sorted.length; k++) {
        const i = sorted[k], f = fold(RM().label(i));
        if (!f.startsWith(q)) break;
        total++;
        if (f === q) exact.push(i); else if (pre.length < 400) pre.push(i);
      }
      // the shortest words first, then the ones with the most descendants
      pre.sort((a, b) => RM().label(a).length - RM().label(b).length || RM().size(b) - RM().size(a));
      let byForm = [];
      if (q.length >= 2) {
        const k = /^[a-z]/.test(q) ? q[0] : "_";
        const [fr, de] = await Promise.all([formShard("fr", k), formShard("de", k)]);
        if (t !== token) return;
        byForm = [...(fr[q] || []), ...(de[q] || [])].filter((i) => !exact.includes(i));
      }
      const seen = new Set();
      results = [];
      for (const [i, form] of [...exact.map((i) => [i, false]), ...byForm.map((i) => [i, true]), ...pre.map((i) => [i, false])]) {
        if (seen.has(i)) continue; seen.add(i); results.push({ i, form });
      }
      // grouped by spelling: one spelling's languages sit together
      const firstAt = new Map(); results.forEach((r, k) => { const s = RM().label(r.i); if (!firstAt.has(s)) firstAt.set(s, k); });
      results = results.map((r, k) => [firstAt.get(RM().label(r.i)), k, r]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
      results.total = total + byForm.length;
      draw();
    }
    function draw() {
      list.innerHTML = "";
      const n = results.length ? results.total : 0;
      count.textContent = !q0 ? "" : n ? (n > 400 ? "400 or more" : n) + (n === 1 ? " result" : " results") : "Nothing by that spelling";
      let prev = null;
      for (const r of results.slice(0, 40)) {
        const s = RM().label(r.i), same = s === prev; prev = s;
        const b = button("dv-res" + (same ? " dv-same" : ""));
        const head = el("span", "dv-res-head");
        head.append(el("span", "dv-res-w", same ? "" : s), el("span", "dv-res-l sc", langCap(RM().langName(r.i))));
        const g = el("i", "dv-res-g");
        b.append(head, g);
        RM().details(r.i).then((d) => { const gl = d.g || d.sd || ""; g.textContent = (gl.length > 90 ? gl.slice(0, 88) + "…" : gl) + (r.form ? (gl ? " · " : "") + q0 + " is a form of it" : ""); });
        b.addEventListener("click", () => open(r.i));
        list.appendChild(b);
      }
    }
    // a result opens on the map (swap); every result stays marked there
    function open(i) {
      input.blur();
      swap(true, () => {
        RM().setMarks(results.slice(0, 200).map((r) => r.i));
        if (RM().info(i).isWord) Carta.run(RM().label(i)); else Carta.openNode(i, true);
      });
    }
    return {
      mount(p) {
        page = p;
        const head = el("header", "dv-head"); head.appendChild(el("span", "sc", "Search the index"));
        const lab = el("label", "dv-q");
        input = el("input"); input.type = "search"; input.setAttribute("aria-label", "Word");
        input.setAttribute("autocapitalize", "none"); input.setAttribute("autocorrect", "off"); input.spellcheck = false;
        input.setAttribute("enterkeyhint", "search");
        lab.appendChild(input);
        count = el("p", "dv-count sc");
        list = el("div", "dv-list");
        const scroll = el("div", "dv-scroll"); scroll.append(head, lab, count, list);
        page.appendChild(scroll);
        let deb = 0;
        input.addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(() => find(input.value), 90); });
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (results[0]) open(results[0].i); } });
        loadSorted();
      },
      enter() { if (!input.value) setTimeout(() => input.focus({ preventScroll: true }), 0); },
      again() { input.select(); input.focus({ preventScroll: true }); },
      leave() { input.blur(); },
      back() { /* the list is as you left it */ },
      strip() {
        const n = results.length ? results.total : 0;
        return { cap: "Search", body: el("span", "dv-strip-line", n + (n === 1 ? " result" : " results") + " for " + q0) };
      },
    };
  })();


  // ---- Saved: your words and excerpts; Settings at the foot --------------------------------------
  // Bookmarks: English words share the English quiz's list ("rootwork.saved"); any other map point
  // is kept by spelling and language ("carta.marks"), so a rebuilt map still finds it.
  const marks = {
    list() { return store.get("carta.marks", []); },
    has(w, l) { return l === "English" ? !!(window.Carta && Carta.savedEn().includes(w)) : marks.list().some((m) => m.w === w && m.l === l); },
    toggle(w, l) {
      if (l === "English") return Carta.toggleSavedEn(w);
      const a = marks.list(), k = a.findIndex((m) => m.w === w && m.l === l);
      if (k >= 0) a.splice(k, 1); else a.unshift({ w, l, d: Date.now() });
      store.set("carta.marks", a); return k < 0;
    },
  };
  const excerpts = {
    list() { return store.get("carta.excerpts", []); },
    has(q) { return excerpts.list().some((x) => x.q.t === q.t); },
    toggle(lc, q) {
      const a = excerpts.list(), k = a.findIndex((x) => x.q.t === q.t);
      if (k >= 0) a.splice(k, 1); else a.unshift({ lc, q: { t: q.t, w: q.w, a: q.a, r: q.r, en: q.en } });
      store.set("carta.excerpts", a); return k < 0;
    },
  };
  const savedDiv = (function () {
    let page, body, last = "";
    const LC = { fr: "French", de: "German" }, SHORT = { English: "en", French: "fr", German: "de" };
    function openWord(w, l) {
      const rm = RM(); if (!rm || !rm.loaded()) return;
      const i = l === "English" ? rm.find(w) : rm.findIn(l, w);
      if (i < 0) return;
      last = w;
      swap(true, () => { if (rm.info(i).isWord) Carta.run(rm.label(i)); else Carta.openNode(i, true); });
    }
    function row(w, l, flag, act) {
      const r = el("div", "sv-row");
      const b = button("sv-w");
      b.append(el("span", "sv-word", w), el("span", "sv-lang sc", SHORT[l] || l));
      if (flag) b.appendChild(el("span", "sv-flag", "· keeps coming back"));
      b.addEventListener("click", () => openWord(w, l));
      r.appendChild(b);
      if (act) r.appendChild(act);
      return r;
    }
    function draw() {
      body.innerHTML = "";
      const head = el("header", "dv-head"); head.appendChild(el("span", "sc", "Saved")); body.appendChild(head);
      body.appendChild(el("div", "sc sv-sec", "Words"));
      const rows = [], seen = new Set();
      const star = (w, l) => { const b = button("sv-act sv-star", "★", "Remove bookmark"); b.addEventListener("click", () => { marks.toggle(w, l); draw(); }); return b; };
      // taken back within the day: "I know this" by mistake
      for (const lc of ["fr", "de"]) {
        const st = window.CartaLearn && CartaLearn.loadState(lc);
        if (st && st.undo && Date.now() - st.undo.d < 864e5) {
          const w = st.undo.k.replace(/#.*$/, ""), u = button("sv-act sv-undo", "undo", "Undo I know this");
          u.addEventListener("click", () => { CartaLearn.undoKnow(lc, st.undo.k); draw(); });
          rows.push(row(w, LC[lc], false, u)); seen.add(LC[lc] + "|" + w);
        }
      }
      for (const w of (window.Carta ? Carta.savedEn() : []).slice().reverse()) { rows.push(row(w, "English", false, star(w, "English"))); seen.add("English|" + w); }
      for (const m of marks.list()) { rows.push(row(m.w, m.l, false, star(m.w, m.l))); seen.add(m.l + "|" + m.w); }
      for (const lc of ["fr", "de"]) {
        const ws = window.CartaLearn ? CartaLearn.words(lc) : {};
        Object.keys(ws).sort((a, b) => ((ws[b] && ws[b].n) || 0) - ((ws[a] && ws[a].n) || 0)).forEach((k) => {
          const w = k.replace(/#.*$/, ""); if (seen.has(LC[lc] + "|" + w)) return; seen.add(LC[lc] + "|" + w);
          rows.push(row(w, LC[lc], ws[k] && ws[k].n >= 3, null));
        });
      }
      if (rows.length) rows.forEach((r) => body.appendChild(r));
      else body.appendChild(el("p", "sv-empty", "Words you tap while translating, and words you bookmark, collect here."));
      const ex = excerpts.list();
      body.appendChild(el("div", "sc sv-sec", "Excerpts"));
      if (!ex.length) body.appendChild(el("p", "sv-empty", "Bookmark an example on a word’s card to keep it here."));
      for (const x of ex) {
        const r = el("div", "sv-row");
        const b = button("sv-ex"); b.lang = x.lc;
        b.append(document.createTextNode("“" + (x.q.t.length > 90 ? x.q.t.slice(0, 88) + "…" : x.q.t) + "” "), el("span", "sv-lang sc", (x.q.a || "").split(" ").pop()));
        b.addEventListener("click", () => { if (window.CartaLearn && CartaLearn.queue(x.lc, x.q)) CartaLearn.open(x.lc); });
        const s = button("sv-act sv-star", "★", "Remove bookmark"); s.addEventListener("click", () => { excerpts.toggle(x.lc, x.q); draw(); });
        r.append(b, s); body.appendChild(r);
      }
      body.appendChild(settings());
    }
    // ☞ points at the choice in force (Priestley's own pointing hand)
    function choice(label, opts, curv, set) {
      const r = el("div", "sv-set"); r.setAttribute("role", "radiogroup"); r.setAttribute("aria-label", label);
      r.appendChild(el("span", "sv-set-l", label));
      for (const [v, t] of opts) {
        const b = button("sv-opt"); b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(v === curv));
        if (v === curv) b.appendChild(el("span", "sv-hand", "☞ "));
        b.appendChild(el("i", null, t));
        b.addEventListener("click", () => { set(v); draw(); });
        r.appendChild(b);
      }
      return r;
    }
    function settings() {
      const d = el("details", "sv-settings"); d.open = !!store.get("carta.settingsOpen", false);
      d.addEventListener("toggle", () => store.set("carta.settingsOpen", d.open));
      d.appendChild(el("summary", "sc", "Settings"));
      const box = el("div", "sv-set-box");
      const look = el("div", "sv-set"); look.append(el("span", "sv-set-l", "Look"), el("i", "sv-set-v", "Priestley")); box.appendChild(look);
      let quiet = false; try { quiet = localStorage.getItem("rootwork.showQuiet") === "1"; } catch (e) {}
      box.appendChild(choice("Slang and new words", [[false, "hidden"], [true, "shown"]], quiet, (v) => {
        try { localStorage.setItem("rootwork.showQuiet", v ? "1" : ""); } catch (e) {} if (RM()) RM().setOptions({ showQuiet: v });
      }));
      let rate = 0; try { rate = +localStorage.getItem("carta.read.rate") || 0; } catch (e) {}
      box.appendChild(choice("Reading speed", [[0, "1×"], [1, "0.8×"], [2, "0.6×"]], rate, (v) => { try { localStorage.setItem("carta.read.rate", String(v)); } catch (e) {} }));
      const acts = el("div", "sv-set-acts");
      const reset = button("sv-btn", "Reset a level");
      reset.addEventListener("click", () => {
        acts.innerHTML = "";
        for (const lc of ["fr", "de"]) {
          if (!(window.CartaLearn && CartaLearn.loadState(lc))) continue;
          const b = button("sv-btn", CartaLearn.LANG[lc].own);
          b.addEventListener("click", () => { CartaLearn.resetLevel(lc); b.textContent = CartaLearn.LANG[lc].own + " · reset"; b.disabled = true; });
          acts.appendChild(b);
        }
        if (!acts.children.length) acts.appendChild(el("i", "sv-set-v", "No level set yet"));
      });
      const upd = button("sv-btn", "Check for updates");
      upd.addEventListener("click", () => {
        if (!window.cartaCheckUpdate || upd.disabled) return;
        upd.disabled = true; upd.textContent = "Checking…";
        window.cartaCheckUpdate().then((r) => { upd.textContent = r === "current" ? "Up to date" : r === "offline" ? "Offline" : "Updating…"; setTimeout(() => { upd.disabled = false; upd.textContent = "Check for updates"; }, 2500); });
      });
      acts.append(reset, upd);
      box.appendChild(acts);
      d.appendChild(box);
      return d;
    }
    return {
      mount(p) { page = p; body = el("div", "dv-scroll sv"); page.appendChild(body); },
      enter() { draw(); },
      again() { draw(); },
      strip() { return { cap: "Saved", body: el("span", "dv-strip-line", last) }; },
    };
  })();
  define("Saved", savedDiv);


  // ---- Explore: the languages along the top, the compass rose (whole chart only) opens the key ----
  const explore = (function () {
    let line, rose, key;
    const LANGS = [["English", 1], ["Français", 2], ["Deutsch", 4], ["Latina", 8]];
    let hidden = store.get("carta.langs", 0);
    function apply() { if (RM() && RM().setHidden) RM().setHidden(hidden); line.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(!(hidden & +b.dataset.bit)))); }
    function buildKey() {
      key = el("section", "dv-key"); key.hidden = true; key.setAttribute("aria-label", "How to read the map");
      key.appendChild(el("div", "sc", "How to read the map"));
      for (const t of ["Every dot is a word or an older form of one. Each family is drawn around its deepest known ancestor.",
        "Distance from a family’s centre is time: the ancestor in the middle, today’s words on the rim. Zoom into a family to see its era rings.",
        "Families that share compounds or cross-links sit next to each other. The faint outer band holds entries with no recorded ancestry.",
        "Dot size is how many words descend from that point. Colour is the language family:"]) key.appendChild(el("p", null, t));
      const fams = el("div", "dv-fams");
      (RM() ? RM().families() : []).forEach((f, k) => { const r = el("div", "dv-fam"), d = el("i"); d.style.background = RM().colorOf(k); r.append(d, document.createTextNode(f)); fams.appendChild(r); });
      key.appendChild(fams);
      key.appendChild(el("p", null, "Struck through in the line along the top: a language you’ve hidden, with the older forms only it leads back to. Nothing moves."));
      app.appendChild(key);
      document.addEventListener("pointerdown", (e) => { if (!key.hidden && !e.target.closest(".dv-key, .dv-rose")) key.hidden = true; });
    }
    function build() {
      line = el("nav", "dv-langs"); line.setAttribute("aria-label", "Languages shown");
      for (const [n, b] of LANGS) {
        const x = button("dv-lang sc", n); x.dataset.bit = b;
        x.addEventListener("click", () => { hidden ^= b; if ((hidden & 15) === 15) hidden ^= b; store.set("carta.langs", hidden); apply(); }); // never all four
        line.appendChild(x);
      }
      rose = button("dv-rose", null, "How to read the map"); rose.hidden = true;
      rose.innerHTML = '<svg width="54" height="54" viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="22" class="r-face"></circle><circle cx="27" cy="27" r="18" class="r-ring"></circle><path d="M27 6 L31 27 L27 48 L23 27 Z" class="r-ns"></path><path d="M6 27 L27 23 L48 27 L27 31 Z" class="r-ew"></path><text x="24.5" y="5.2" class="r-n">N</text></svg>';
      rose.addEventListener("click", () => { if (!key) buildKey(); key.hidden = !key.hidden; });
      app.append(line, rose);
      // the rose shows only at the whole-chart view (checked a few times a second; no redraws)
      setInterval(() => { const want = on() && cur === "Explore" && !swapped && RM() && RM().atOverview && RM().atOverview(); if (rose.hidden === !!want) rose.hidden = !want; if (!want && key && !key.hidden && cur !== "Explore") key.hidden = true; }, 300);
      if (RM()) RM().ready.then(apply);
    }
    return { build, show(v) { if (line) line.hidden = !v; if (!v && key) key.hidden = true; } };
  })();

  // ---- public -------------------------------------------------------------------------------
  function define(n, m) { mods[n] = m; if (started && n === cur) { ensureMounted(n); render(); if (m.enter) m.enter(); } }
  define("Search", search);
  window.CartaDiv = {
    has: (n) => on() && NAMES.includes(n), cur: () => cur, on, floor, go, swap, define, fold,
    swapped: () => swapped,
    page: (n) => pages[n],
    placeMap,                                   // a module whose window moved calls this
    restrip: () => { if (swapped) render(); },
    marks, excerpts,
  };

  function start() {
    build();
    started = true;
    if (window.Carta && Carta.sheet() === "home") Carta.sheet("home"); // app.js sized its home sheet before the divisions existed
    const last = store.get("carta.div", { cur: "Explore" }).cur;
    const rm = RM();
    const go0 = () => {
      if (on() && window.Carta && !Carta.word() && Carta.sheet() === "home") rm.overview(0); // framed for the old home sheet: frame the whole chart again
      if (on() && NAMES.includes(last) && last !== "Explore") go(last); else render();
    };
    if (rm && rm.ready) rm.ready.then(go0); else go0();
    new MutationObserver(() => render()).observe(root, { attributes: true, attributeFilter: ["data-look"] });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
