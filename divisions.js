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
  function floor() { return swapped && strip && !strip.hidden ? strip.offsetHeight + 86 : 0; }

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

  // ---- public -------------------------------------------------------------------------------
  function define(n, m) { mods[n] = m; if (started && n === cur) { ensureMounted(n); render(); if (m.enter) m.enter(); } }
  define("Search", search);
  window.CartaDiv = {
    has: (n) => on() && NAMES.includes(n), cur: () => cur, on, floor, go, swap, define, fold,
    swapped: () => swapped,
    page: (n) => pages[n],
    placeMap,                                   // a module whose window moved calls this
    restrip: () => { if (swapped) render(); },
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
