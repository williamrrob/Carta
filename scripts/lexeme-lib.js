/*
 * lexeme-lib.js — reads the relation templates kept in slim records (scripts/extract-kaikki.js)
 * and turns them into plain relations. Shared by scripts/count-cited-langs.js and
 * scripts/build-lexeme-graph.js.
 *
 *   relations(rec) → [{ from: termRef, to: termRef, k: kind, src: "tpl"|"ety", inferred: bool }]
 *     termRef = { c: langCode, t: page title (identity), d?: display, g?: gloss, id?: target id }
 *     kind: inh | bor | lbor | der | cal | part | root
 *     `from` is the record itself (null) or an ancestor named inside the record (inferred = true).
 *
 * {{ety}}/{{etymon}} terms are parsed with a bracket-depth scanner: mods nest
 * (gmh:schade<ety:inh<goh:skado>>), and a regex would mangle them.
 */
"use strict";

const CHAIN = {
  inh: "inh", "inh-lite": "inh", inherited: "inh",
  bor: "bor", borrowed: "bor", ubor: "bor", obor: "bor", lbor: "lbor", slbor: "lbor", "learned borrowing": "lbor",
  der: "der", "der-lite": "der", derived: "der", uder: "der", from: "der",
  cal: "cal", calque: "cal", clq: "cal", pcal: "cal", sl: "cal", psm: "cal",
};
const PARTS = new Set(["af", "affix", "afeq", "compound", "com", "prefix", "pre", "suffix", "suf", "confix", "con", "surf",
  "surface analysis", "blend", "univ", "univerbation"]);
const ONE = new Set(["clipping", "clip", "back-formation", "bf", "backform", "deverbal", "abbrev", "ellipsis", "short"]);
const DOUBLET = new Set(["doublet", "dbt", "piecewise doublet"]);
const COG = new Set(["cog", "cognate", "ncog", "noncog"]);

// split "head<a:b><c<d>>" into head and depth-0 mods
function scan(s) {
  s = String(s == null ? "" : s);
  let i = 0, head = "";
  while (i < s.length && s[i] !== "<") head += s[i++];
  const mods = [];
  while (i < s.length) {
    if (s[i] !== "<") { i++; continue; }
    let j = i + 1, d = 1;
    while (j < s.length && d) { if (s[j] === "<") d++; else if (s[j] === ">") d--; j++; }
    const body = s.slice(i + 1, d ? s.length : j - 1);
    const c = body.indexOf(":"), lt = body.indexOf("<");
    if (c > 0 && (lt < 0 || c < lt)) mods.push([body.slice(0, c), body.slice(c + 1)]);
    else mods.push([body, ""]);
    i = j;
  }
  return { head: head.trim(), mods };
}
const CODE = /^([a-z]{2,3}(?:-[a-z]{2,4}){0,3}):(.+)$/;
// not a word: empty, punctuation only ("+", "?"), a bare language code ("ine-pro:"), markup
const junk = (t) => !t || !/\p{L}/u.test(t) || /^\[|^⇒|^>|:\s|:$/.test(t) || /script needed/.test(t);

// one ety term → { c, t, g?, id?, alt?, ety?: "kw<term>…" }
function etyTerm(s, defLang) {
  const { head, mods } = scan(s);
  let c = defLang, t = head;
  const m = head.match(CODE);
  if (m) { c = m[1]; t = m[2]; }
  const o = { c, t: t.trim() };
  for (const [k, v] of mods) {
    if ((k === "t" || k === "gloss") && !o.g) o.g = v;
    else if (k === "id" && !o.id) o.id = v;
    else if (k === "alt" && !o.alt) o.alt = v;
    else if (k === "ety" && !o.ety) o.ety = v;
  }
  if (!o.t && o.alt) { const a = o.alt.match(CODE); o.t = a ? a[2] : o.alt; }
  return o;
}
// "kw<term><term>:kw2<term>" → [{kw, terms:[str]}]
function etyGroups(body) {
  const groups = []; let cur = null, i = 0, word = "";
  while (i < body.length) {
    if (body[i] === "<") {
      let j = i + 1, d = 1;
      while (j < body.length && d) { if (body[j] === "<") d++; else if (body[j] === ">") d--; j++; }
      const kw = word.trim().replace(/^:/, "");
      if (kw) { cur = { kw, terms: [] }; groups.push(cur); word = ""; }
      if (!cur) { cur = { kw: "from", terms: [] }; groups.push(cur); }
      cur.terms.push(body.slice(i + 1, d ? body.length : j - 1));
      i = j;
    } else word += body[i++];
  }
  return groups;
}
function kindOf(kw) {
  kw = kw.replace(/\+$/, "");
  if (CHAIN[kw]) return CHAIN[kw];
  if (PARTS.has(kw)) return "part";
  if (ONE.has(kw)) return "der";
  return null;
}
// prefix/suffix templates mark parts implicitly
function markAffixes(name, parts) {
  if (name === "prefix" || name === "pre") return parts.map((p, j) => (j < parts.length - 1 && !/-$/.test(p.t) ? { ...p, t: p.t + "-" } : p));
  if (name === "suffix" || name === "suf") return parts.map((p, j) => (j > 0 && !/^-/.test(p.t) ? { ...p, t: "-" + p.t } : p));
  if (name === "confix" || name === "con") return parts.map((p, j) => (j === 0 && !/-$/.test(p.t) ? { ...p, t: p.t + "-" } : j === parts.length - 1 && !/^-/.test(p.t) ? { ...p, t: "-" + p.t } : p));
  return parts;
}

function relations(rec) {
  const out = [];
  const self = null;
  const L = rec.l;
  const add = (from, to, k, src, inferred) => { if (to && !junk(to.t)) out.push({ from, to, k, src, inferred: !!inferred }); };
  // walk one ety group set for `owner` (null = the record)
  const walkEty = (owner, groups, defLang, depth) => {
    if (depth > 10) return;
    for (const g of groups) {
      const k = kindOf(g.kw); if (!k) continue;
      const ts = g.terms.map((x) => etyTerm(x, defLang)).filter((x) => !junk(x.t));
      for (const x of ts) {
        const ref = { c: x.c, t: x.t }; if (x.g) ref.g = x.g; if (x.id) ref.id = x.id;
        add(owner, ref, k, "ety", owner !== null);
        if (x.ety) walkEty(ref, etyGroups(x.ety), x.c, depth + 1);
      }
    }
  };
  // classic chain, honouring connectors: "from A, from B" = rec→A, A→B; "+ C" = co-component; "and D" = parallel source
  let cur = self, child = undefined, curRef = null;
  const firstSteps = [];
  let dead = false;
  for (const tp of rec.et || []) {
    const n = tp.n, a = tp.a || [];
    if (n === "ety" || n === "etymon") {
      if (a[0] !== L) continue;
      const groups = []; let g = null;
      for (let i = 1; i < a.length; i++) {
        const v = String(a[i] || "").trim(); if (!v) continue;
        if (v.startsWith(":")) { g = { kw: scan(v.slice(1)).head, terms: [] }; groups.push(g); continue; }
        if (!g) { g = { kw: "from", terms: [] }; groups.push(g); }
        g.terms.push(v);
      }
      walkEty(self, groups, L, 0);
      continue;
    }
    if (CHAIN[n]) {
      // a new sentence that doesn't continue the line ("… Compare Old Norse X"): the rest of the
      // classic chain is not read as steps back
      if (tp.j === ".") dead = true;
      if (dead) continue;
      const c = a[1], term = scan(a[2]).head, disp = a[3] ? scan(a[3]).head : "";
      if (!c || junk(term)) continue;
      const ref = { c, t: term }; if (disp && disp !== term) ref.d = disp; if (tp.t) ref.g = tp.t; if (tp.id) ref.id = tp.id;
      const id2 = scan(a[2]).mods.find((m) => m[0] === "id"); if (id2 && !ref.id) ref.id = id2[1];
      const isAff = /^\*?-|-$/.test(term);
      if ((tp.j === "+" || tp.j === "&") && child !== undefined) { add(child, ref, tp.j === "+" ? "part" : CHAIN[n], "tpl", child !== null); continue; }
      // an affix is a part of the form before it, never the next step back: "from A + -is, from B"
      // is A ← B, so the line stays on A
      if (isAff && child !== undefined && cur !== self) { add(child, ref, "part", "tpl", child !== null); continue; }
      if (isAff) { add(cur, ref, "part", "tpl", cur !== self); continue; }
      add(cur, ref, CHAIN[n], "tpl", cur !== self);
      if (cur === self) firstSteps.push(ref);
      child = cur; cur = ref; curRef = ref;
      continue;
    }
    if (PARTS.has(n)) {
      if (a[0] !== L) continue;
      let parts = a.slice(1).map((v) => etyTerm(v, L)).filter((x) => !junk(x.t));
      parts = markAffixes(n, parts);
      for (const x of parts) { const ref = { c: x.c, t: x.t }; if (x.g) ref.g = x.g; if (x.id) ref.id = x.id; add(self, ref, "part", "tpl"); }
      continue;
    }
    if (ONE.has(n)) {
      if (a[0] !== L) continue;
      const x = etyTerm(a[1], L); add(self, { c: x.c, t: x.t }, "der", "tpl");
      continue;
    }
    if (n === "root") {
      const c = a[1];
      for (const v of a.slice(2)) { const x = scan(v).head; if (c && x) add(self, { c, t: x }, "root", "tpl"); }
    }
  }
  // {{ety}} is the complete statement of the entry's own sources: where it gave any, the classic
  // templates' direct edges are dropped (they often describe an intermediate form's parts) and only
  // the further steps they infer, plus {{root}}, are kept
  const etyDirect = out.filter((r) => r.src === "ety" && r.from === null);
  if (etyDirect.length) {
    // the classic chain's deeper steps hang from its first step; where {{ety}} names the first step in the
    // same language under another spelling (Middle English speculation / speculacioun), continue from that
    for (const f of firstSteps) {
      const same = etyDirect.filter((r) => r.to.c === f.c);
      if (same.length === 1) for (const r of out) if (r.from === f) r.from = same[0].to;
    }
    return out.filter((r) => r.src === "ety" || r.from !== null || r.k === "root");
  }
  return out;
}
function doublets(rec) {
  const out = [];
  for (const tp of rec.et || []) if (DOUBLET.has(tp.n) && tp.a[0] === rec.l) for (const v of tp.a.slice(1)) { const x = scan(v).head; if (x && x !== rec.w) out.push(x); }
  return out;
}
function cognates(rec) {
  const out = [];
  for (const tp of rec.et || []) if (COG.has(tp.n)) { const c = tp.a[0], x = scan(tp.a[1]).head; if (c && x && c !== rec.l) out.push(tp.t ? [c, x, tp.t] : [c, x]); }
  return out;
}

module.exports = { scan, etyTerm, etyGroups, relations, doublets, cognates, CHAIN, PARTS };
