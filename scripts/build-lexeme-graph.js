#!/usr/bin/env node
/*
 * build-lexeme-graph.js — the four-language graph (PARITY.md), built in one pass from slim
 * dictionary records (scripts/extract-kaikki.js) of English, French, German, Latin and the
 * ancestor languages they cite (Proto-Indo-European, Old French, …).
 *
 *   node --max-old-space-size=6000 scripts/build-lexeme-graph.js <slim dir>
 *
 * Node = one (language, page title, etymology number); entries differing only in part of
 * speech merge. A citation resolves to a node in this order (HANDOFF.md):
 *   1 exact page title in that language · 2 that language's own title rule (Latin/Old English
 *   drop macrons, breves, dots; Ancient Greek drops macrons and breves; reconstructions drop the
 *   leading *) · 3 otherwise a bare node · homographs: by <id:…>, else the entry whose
 *   Descendants list names the citing word, else matching part of speech, else first (counted).
 * Edges: the entry's own templates (lexeme-lib.js); an ancestor's own entry outranks a chain
 * inferred from a descendant's entry; Descendants trees add edges the bottom-up pass missed
 * (the child's own etymology wins where they disagree); an entry with no history at all goes under
 * an entry that lists it among its Derived terms (src "v"); {{root}} only where the root isn't
 * already reached.
 *
 * Output: g/<hh>.json shards for scripts/build-graph-layout.js, key "<Language>|<title>[#n]":
 *   { l, t, g?, ipa?, hw?:1 (English headword with a words/ entry), lc?: en|fr|de|la, e?:1 (has
 *     an entry), up:[[key, kind, inferred?, src?]] (kind inh bor lbor der cal cmp aff; src
 *     "d" Descendants tree, "r" {{root}}, "s" stage bridge, "v" Derived terms list), fold?:[keys] (every parent in the same
 *     language: the non-affix parents it folds under), dr?:0 (not drawn), q?:1, en, ne, dbl, cog }
 * and g/stats.json (counts for the report). AMB=1 prints the commonest ambiguous citations and stops.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { DatabaseSync } = require("node:sqlite");
const { relations, doublets, cognates } = require("./lexeme-lib.js");
const P = require("../etym-parse.js");
const { derive } = require("./etym-derive.js");
const ROOT = path.join(__dirname, "..");
const DIR = process.argv[2];
const OUT = path.join(ROOT, "g");
const FOUR = { en: "English", fr: "French", de: "German", la: "Latin" };
const t0 = Date.now();
const log = (s) => process.stderr.write(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}\n`);

// ---- language names ------------------------------------------------------------------
const votes = new Map();
for (const f of fs.readdirSync(DIR)) if (f.endsWith(".langs.json"))
  for (const [c, m] of Object.entries(JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")))) {
    let x = votes.get(c); if (!x) votes.set(c, (x = new Map()));
    for (const [nm, v] of Object.entries(m)) x.set(nm, (x.get(nm) || 0) + v);
  }
const FIXED = { en: "English", fr: "French", de: "German", la: "Latin", "la-lat": "Late Latin", "la-new": "New Latin",
  "la-med": "Medieval Latin", "la-vul": "Vulgar Latin", "la-cla": "Classical Latin", "la-ecc": "Ecclesiastical Latin",
  "grc-koi": "Koine Greek", "grc-byz": "Byzantine Greek", grc: "Ancient Greek", frm: "Middle French", fro: "Old French", enm: "Middle English",
  ang: "Old English", "gem-pro": "Proto-Germanic", "ine-pro": "Proto-Indo-European", "gmw-pro": "Proto-West Germanic",
  "itc-pro": "Proto-Italic", xno: "Anglo-Norman", goh: "Old High German", gmh: "Middle High German", non: "Old Norse", dum: "Middle Dutch" };
const nameCache = new Map();
function langName(c) {
  if (FIXED[c]) return FIXED[c];
  let n = nameCache.get(c);
  if (n === undefined) { const m = votes.get(c); let b = c, k = -1; if (m) for (const [nm, v] of m) if (v > k) { b = nm; k = v; } nameCache.set(c, (n = b)); }
  return n;
}
// identity: period and dialect labels that cite the same written form share a node (from build-etym-graph.js)
const LANG_ID = {
  "Classical Latin": "Latin",
  "Anglian Old English": "Old English", "West Saxon Old English": "Old English", "Late Old English": "Old English",
  "Northumbrian Old English": "Old English", "Mercian Old English": "Old English", "Kentish Old English": "Old English",
  "Early Middle English": "Middle English", "Late Middle English": "Middle English",
  "Northern Middle English": "Middle English", "Southern Middle English": "Middle English",
  "Hellenistic Ancient Greek": "Ancient Greek", "Attic Greek": "Ancient Greek", "Epic Greek": "Ancient Greek",
  "Modern French": "French",
};
const langId = (l) => LANG_ID[l] || l;
const FAMILY = (l) => /(?:^|\s)Latin$/.test(l) && l !== "Old Latin" ? "Latin"
  : /^(?:Ancient|Koine|Hellenistic|Byzantine|Attic|Epic|Doric|Ionic) Greek$/.test(l) ? "Ancient Greek" : langId(l);
const famCache = new Map();
const famOf = (c) => { let f = famCache.get(c); if (f === undefined) famCache.set(c, (f = FAMILY(langName(c)))); return f; };
// etymology-only varieties kaikki has no dump for → the language whose entries hold their words
const VARIETY_OF = { "Anglo-Norman": "Old French", "Old Northern French": "Old French", "Old Latin": "Latin",
  "Classical Persian": "Persian", "Biblical Hebrew": "Hebrew", "Medieval Greek": "Greek", "Middle Low German": "Low German" };
const famOfRef = (ref) => (ref.ln ? FAMILY(langId(ref.ln)) : famOf(ref.c));
const FOUR_FAM = { English: "en", French: "fr", German: "de", Latin: "la" };

// ---- title rules (step 2) -------------------------------------------------------------
const nfc = (s) => String(s).normalize("NFC").trim();
const strip = (s, re) => s.normalize("NFD").replace(re, "").normalize("NFC");
const MAC_BREVE_DOT = /[̣̄̆̇]/g, MAC_BREVE = /[̄̆]/g;
function ruleOf(fam) {
  if (fam === "Latin" || fam === "Old Latin" || fam === "Old English") return (s) => strip(s.replace(/^\*/, ""), MAC_BREVE_DOT);
  if (fam === "Ancient Greek") return (s) => strip(s.replace(/^\*/, ""), MAC_BREVE);
  // reconstructions: an accent on a vowel or resonant marks stress, not a different word (*h₁en = h₁én);
  // the acute on k/g is the palatal (ḱ, ǵ), a different sound, and stays
  if (/^Proto-/.test(fam)) return (s) => s.replace(/^root\s+/, "").replace(/^\*/, "").normalize("NFD").replace(/([^kgKG])[\u0301\u0300]/g, "$1").normalize("NFC");
  return (s) => s.replace(/^root\s+/, "").replace(/^\*/, "");
}
const rules = new Map();
const ruleFor = (fam) => { let r = rules.get(fam); if (!r) rules.set(fam, (r = ruleOf(fam))); return r; };
// Romance etyma are cited in the Latin accusative; fold to the nominative citation form
const latinCitation = (t) => t.replace(/tatem$/, "tas").replace(/([st])ionem$/, "$1io").replace(/ationem$/, "atio")
  .replace(/torem$/, "tor").replace(/sorem$/, "sor").replace(/ionem$/, "io");

// ---- nodes ------------------------------------------------------------------------------
// N[i] = { f: family, t: title/cited form, n?: ety no., e?: entry, ipa?, g?, h?, p: Set(pos), ids?, ds?, rels?, q?, labels: Map, forms: Map }
const N = [];
const byTitle = new Map();   // fam → Map(title → [i])
const byNorm = new Map();    // fam → Map(normTitle → [i])
const byId = new Map();      // fam|title|id → i
const bareKey = new Map();   // fam|normForm → i
const keyOfNode = [];
const pushTo = (m, fam, k, i) => { let x = m.get(fam); if (!x) m.set(fam, (x = new Map())); const a = x.get(k); if (a) a.push(i); else x.set(k, [i]); };
const entryIdx = new Map();  // fam|title|n → i

// hidden until visited: Internet slang, neologisms, nonce words, slang (Will, Nov 2026: vulgar words are fine)
const QUIET_NOW = new Set(["slang", "Internet", "neologism", "nonce-word"]);
let records = 0;
// the reader's languages: inflected form → lemma titles (FORMS=1 extraction), for g/lex-<lc>
const READER = { fr: { forms: new Map() }, de: { forms: new Map() } };
let headwordsG = new Set();
const formOf = new Map();   // English inflected form → lemma (FORMS=1 extraction), used only for words/ headwords
function addRecord(r) {
  if (r.fo) {
    const fo = [].concat(r.fo);
    if (r.l === "en") { if (!formOf.has(r.w)) formOf.set(nfc(r.w), nfc(fo[0])); }
    else if (READER[r.l]) { const m = READER[r.l].forms; const w = nfc(r.w); let x = m.get(w); if (!x) m.set(w, (x = new Set())); for (const f of fo) x.add(nfc(f)); }
    if (!r.g) return;   // a page that is only a form
  }
  const fam = famOf(r.l);
  const title = nfc(r.w);
  const ek = fam + "|" + title + "|" + (r.n || "");
  let i = entryIdx.get(ek);
  if (i === undefined) {
    i = N.length;
    N.push({ f: fam, t: title, n: r.n, e: 1, p: new Set(), labels: new Map([[langId(langName(r.l)), 1]]) });
    entryIdx.set(ek, i);
    pushTo(byTitle, fam, title, i);
    const nt = ruleFor(fam)(title); pushTo(byNorm, fam, nt, i);
  }
  const x = N[i];
  records++;
  x.p.add(r.p);
  if (!x.g && r.g) x.g = r.g;
  if (!x.ipa && r.ipa) x.ipa = r.ipa;
  if (!x.h && r.h) x.h = nfc(r.h);
  if (r.q) { const qs = r.q.filter((t) => QUIET_NOW.has(t)); x.qn = (x.qn || 0) + (qs.length ? 1 : 0); if (READER[r.l]) { x.tags = x.tags || new Set(); for (const t of r.q) x.tags.add(t); } }
  if (READER[r.l] && r.g && !x.gs) x.gs = [];
  if (READER[r.l] && r.g && x.gs.length < 4 && !x.gs.includes(r.g)) x.gs.push(r.g);
  x.pn = (x.pn || 0) + 1;
  for (const id of r.id || []) { byId.set(fam + "|" + title + "|" + id, i); }
  if (r.ds) x.ds = x.ds ? x.ds.concat(r.ds) : r.ds;
  if (r.dv) x.dv = x.dv ? x.dv.concat(r.dv) : r.dv;
  let gotRel = false;
  if (r.et) {
    const rel = relations(r);
    if (rel.length) { x.rels = x.rels ? x.rels.concat(rel) : rel; gotRel = true; }
    if (r.l === "en") { const d = doublets(r); if (d.length) x.dbl = (x.dbl || []).concat(d); const c = cognates(r); if (c.length && !x.cog) x.cog = c.slice(0, 12); }
  }
  if (!gotRel && r.x && !x.rels) x.prose = r.x;
  if (r.ao && !x.ao) x.ao = nfc(r.ao);
  x.lcode = r.l;
}
// ---- prose fallback (etym-parse.js, etym-derive.js) for entries whose templates gave nothing ----
let fromProse = 0, fromDerive = 0;
function proseRelations(i, langNames) {
  const x = N[i], self = langName(x.lcode);
  const o = P.parse(x.t, x.prose);
  const rel = [];
  const GRAM = /^(?:plural|singular|feminine|masculine|neuter|genitive|dative|accusative|nominative|ablative|oblique|diminutive|infinitive)\s+/i;
  const ref = (st) => { const r = { ln: st.l || self, t: String(st.t).replace(GRAM, "") }; if (st.g) r.g = st.g; return r; };
  const real = (st) => st && typeof st.t === "string" && P.fold(st.t).replace(/[*\-–‐\s()]/g, "").length > 0;
  for (const p of o.parts.filter(real)) rel.push({ from: null, to: ref(p), k: "part", src: "prose", inferred: false });
  let cur = null;
  for (const st of o.chain) {
    if (st.p) {
      const ps = st.p.filter(real); if (!ps.length) continue;
      for (const c of ps) rel.push({ from: cur, to: ref(c), k: "part", src: "prose", inferred: cur !== null });
      const main = ps.filter((c) => !c.aff); cur = ref(main.length ? main[main.length - 1] : ps[ps.length - 1]);
      continue;
    }
    if (!real(st)) continue;
    const r = ref(st); rel.push({ from: cur, to: r, k: st.k || "der", src: "prose", inferred: cur !== null }); cur = r;
  }
  if (rel.length) { fromProse++; return rel; }
  const tit = byTitle.get(x.f) || new Map();
  const dv = derive(x.t, x.prose, (t) => tit.has(t), langNames, self);
  if (!dv) return null;
  for (const p of dv.parts) rel.push({ from: null, to: { ln: p.l || self, t: p.t }, k: "part", src: "prose", inferred: false });
  if (dv.parent) rel.push({ from: null, to: { ln: dv.parent.l || self, t: dv.parent.t }, k: "der", src: "prose", inferred: false });
  if (rel.length) { fromDerive++; return rel; }
  return null;
}

// ---- resolution ------------------------------------------------------------------------------
const ambS = new Map();
const STOP = new Set(["the", "a", "an", "of", "to", "in", "or", "and", "for", "used", "form", "with", "as", "on", "from", "by", "that", "which", "be", "is"]);
const words = (s) => String(s).toLowerCase().match(/\p{L}+/gu)?.filter((w) => w.length > 2 && !STOP.has(w)) || [];
const POSW = { adv: /\badverb/i, adj: /\badjective/i, noun: /\bnoun|substantive/i, verb: /\bverb/i, name: /\bnoun|name/i };
const descStat = {};
const stat = { exact: 0, rule: 0, bare: 0, ambiguous: 0, ambiguousAffix: 0, ambiguousWord: 0, byId: 0, byDesc: 0, byPos: 0, byGloss: 0, byAffixGloss: 0, homographs: 0, descAmbiguous: 0, descByParent: 0, byParentLang: 0 };
function bare(fam, form, label, disp) {
  const nk = fam + "|" + ruleFor(fam)(form);
  let i = bareKey.get(nk);
  if (i === undefined) { i = N.length; N.push({ f: fam, t: form, labels: new Map(), forms: new Map() }); bareKey.set(nk, i); }
  const x = N[i];
  x.labels.set(label, (x.labels.get(label) || 0) + 1);
  const d = disp || form; x.forms.set(d, (x.forms.get(d) || 0) + 1);
  return i;
}
// ref {c, t, d?, g?, id?}; ctx { lc, w, pos } of the citing word (for homographs), counts → stat or null
function resolve(ref, ctx, count) {
  const fam = famOfRef(ref);
  let t = nfc(ref.t);
  let cands = (byTitle.get(fam) || new Map()).get(t), how = "exact";
  if (!cands) {
    const rule = ruleFor(fam);
    cands = (byNorm.get(fam) || new Map()).get(rule(t));
    if (!cands && fam === "Latin") cands = (byNorm.get(fam) || new Map()).get(rule(latinCitation(t)));
    how = "rule";
  }
  if (!cands && VARIETY_OF[fam]) {
    // an etymology-only variety (no dump of its own): its words are entries of the parent language
    const pf = VARIETY_OF[fam], rule = ruleFor(pf);
    cands = (byTitle.get(pf) || new Map()).get(t) || (byNorm.get(pf) || new Map()).get(rule(t));
    if (cands && count) stat.byParentLang++;
    if (cands) how = null;
  }
  if (!cands) {
    if (count) stat.bare++;
    const label = ref.ln ? langId(ref.ln) : langId(langName(ref.c));
    const i = bare(fam, t, label, ref.d ? nfc(ref.d) : null);
    if (ref.g && !N[i].g) N[i].g = ref.g;
    return i;
  }
  if (count && how) stat[how]++;
  // a cited form that names an entry gives it a label vote (Late Latin vs Latin) only for bare nodes
  if (cands.length === 1) return cands[0];
  if (count) stat.homographs++;
  if (ref.id) {
    for (const c of cands) { const hit = byId.get(fam + "|" + N[c].t + "|" + ref.id); if (hit === c) { if (count) stat.byId++; return c; } }
  }
  if (ctx && ctx.pi !== undefined) {
    // a Descendants-tree item: the candidate whose own entry already names this parent
    for (const c of cands) { const m = own.get(c); if (m && m.has(ctx.pi)) { stat.descByParent++; return c; } }
    for (const c of cands) { const m = own.get(c); if (m) for (const p of m.keys()) if (N[p].f === N[ctx.pi].f) { stat.descByParent++; return c; } }
  }
  if (ctx) {
    for (const c of cands) if (N[c].ds && N[c].ds.some((d) => d[2] === ctx.w && famOf(d[1]) === ctx.f)) { if (count) stat.byDesc++; return c; }
  }
  // the template's own gloss against each candidate's first gloss: a unique best word overlap
  if (ref.g) {
    const W = new Set(words(ref.g)); let best = -1, bc = 0, n = 0;
    for (const c of cands) { const o = words(N[c].g || "").filter((w) => W.has(w)).length; if (o > bc) { bc = o; best = c; n = 1; } else if (o === bc && o > 0) n++; }
    if (best >= 0 && n === 1) { if (count) stat.byGloss++; return best; }
  }
  if (ctx && ctx.pos) {
    // an affix whose gloss says it forms the citing word's part of speech (-ly "used to form adverbs")
    if (/^\*?-|-$/.test(t)) {
      const hits = cands.filter((c) => [...ctx.pos].some((p) => POSW[p] && POSW[p].test(N[c].g || "")));
      if (hits.length === 1) { if (count) stat.byAffixGloss++; return hits[0]; }
    }
    const hits = cands.filter((c) => N[c].p && [...ctx.pos].some((p) => N[c].p.has(p)));
    if (hits.length === 1) { if (count) stat.byPos++; return hits[0]; }
  }
  if (count) { stat.ambiguous++; if (/^\*?-|-$/.test(t)) stat.ambiguousAffix++; else stat.ambiguousWord++; if (process.env.AMB) { const k = fam + "|" + t + " ← " + (ctx ? ctx.f + ":" + ctx.w : ""); ambS.set(fam + "|" + t, (ambS.get(fam + "|" + t) || 0) + 1); if (Math.random() < 0.0004) process.stderr.write("AMB " + k + " " + JSON.stringify(ref) + " cands " + cands.map((c) => N[c].n + "/" + [...N[c].p].join(",")).join(" ") + "\n"); } } else stat.descAmbiguous++;
  return cands[0];
}

// ---- edges ---------------------------------------------------------------------------------
// own[i]: Map(parent → {k, s}) from i's own entry; inf[i]: inferred from descendants' entries
const own = new Map(), inf = new Map();
const KRANK = { inh: 0, bor: 1, lbor: 1, cal: 2, der: 3, part: 4, root: 5 };
function edge(store, c, p, k, s) {
  if (c === p) return;
  let m = store.get(c); if (!m) store.set(c, (m = new Map()));
  const o = m.get(p);
  if (!o) m.set(p, { k, s });
  else if ((KRANK[k] ?? 9) < (KRANK[o.k] ?? 9) && !(o.k === "part" && k === "der")) o.k = k;
}

async function load() {
  const files = fs.readdirSync(DIR).filter((f) => /^slim-.*\.jsonl$/.test(f)).sort();
  for (const f of files) {
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(DIR, f)), crlfDelay: Infinity });
    for await (const line of rl) if (line) addRecord(JSON.parse(line));
    log(`${f}: ${N.length} nodes`);
  }
}

function build() {
  const nEntries = N.length;
  const langNames = [...new Set([...votes.keys()].map(langName))].filter((n) => /^[A-Z]/.test(n)).sort((a, b) => b.length - a.length);
  for (let i = 0; i < nEntries; i++) if (N[i].prose) { const r = proseRelations(i, langNames); if (r) N[i].rels = r; N[i].prose = null; }
  // an alternative spelling with no history of its own takes its main spelling's (christian → Christian)
  // (the structured link, else a gloss that says so: "Alternative letter-case form of Buddha."; the
  // target must be a page of the same language; "India from the NATO/ICAO Phonetic Alphabet" → India)
  let alt = 0;
  const ALT = /^(?:(?:alternative|uncommon|obsolete|archaic|dated|rare|nonstandard|informal|eye dialect|less common|standard)\s+)?(?:letter-case\s+|spelling\s+|typographic(?:al)?\s+|capitali[sz]ation\s+)?(?:form|spelling|variant)\s+of\s+(.+?)\.?$/i;
  const target = (s0) => String(s0).replace(/\s*\(.*$/, "").replace(/\s+from\s+the\s+.*$/, "").replace(/[.;:,]+$/, "").trim();
  for (let i = 0; i < nEntries; i++) {
    const x = N[i]; if (x.rels) continue;
    let t = x.ao ? target(x.ao) : null;
    if (!t && x.g) { const m = x.g.match(ALT); if (m) t = target(m[1]); }
    if (!t || t === x.t || !(byTitle.get(x.f) || new Map()).has(t)) continue;
    x.rels = [{ from: null, to: { c: x.lcode, t }, k: "der", src: "alt", inferred: false }]; alt++;
  }
  log(`alternative spellings placed under their main spelling: ${alt}`); stat.altOf = alt;
  // an English headword whose lemma pages say nothing of their history but which is also an inflected
  // form (bones: the instrument; plural of bone) takes the form-of link
  let fo = 0;
  for (const [w, is] of byTitle.get("English") || []) {
    if (!formOf.has(w) || !headwordsG.has(w) || is.some((i) => N[i].rels)) continue;
    N[is[0]].rels = [{ from: null, to: { c: "en", t: formOf.get(w) }, k: "der", src: "form", inferred: false }]; fo++;
  }
  log(`history-less headwords placed under their lemma as inflected forms: ${fo}`); stat.formOfLemma = fo;
  log(`prose fallback: ${fromProse} entries from etymology prose, ${fromDerive} from in-language derivations`);
  // pass 1: entries' own relations
  for (let i = 0; i < nEntries; i++) {
    const x = N[i]; if (!x.rels) continue;
    const ctx = { f: x.f, w: x.t, pos: x.p };
    const refIdx = new Map();
    const R = (ref) => { const k = (ref.c || ref.ln) + "|" + ref.t + "|" + (ref.id || ""); let j = refIdx.get(k); if (j === undefined) refIdx.set(k, (j = resolve(ref, ctx, true))); return j; };
    for (const r of x.rels) {
      const p = R(r.to);
      if (r.from === null) edge(own, i, p, r.k, r.k === "root" ? "r" : "");
      else { const c = R(r.from); if (c === p) continue; edge(inf, c, p, r.k, ""); const v = inf.get(c).get(p); if (v.last !== i) { v.votes = (v.votes || 0) + 1; v.last = i; } }
    }
    x.rels = null;
  }
  log(`entries' own relations: ${own.size} children; inferred chains for ${inf.size}`);
  // an ancestor's own entry outranks a chain inferred from a descendant's entry
  let infKept = 0, infDropped = 0;
  const hasOwnHistory = (i) => { const m = own.get(i); if (!m) return false; for (const v of m.values()) if (v.k !== "root") return true; return false; };
  let infOutvoted = 0;
  for (const [c, m] of inf) {
    if (hasOwnHistory(c)) { infDropped += m.size; continue; }
    // several descendants route different chains through one form that has no entry of its own
    // (Old French suer "sister" / suer "to sweat"): per source language, keep the source most of
    // them name; parts are kept as they are
    const best = new Map();
    for (const [p, v] of m) if (v.k !== "part") { const f = N[p].f; best.set(f, Math.max(best.get(f) || 0, v.votes || 1)); }
    for (const [p, v] of m) {
      if (v.k !== "part" && (v.votes || 1) < best.get(N[p].f)) { infOutvoted++; continue; }
      edge(own, c, p, v.k, "i"); infKept++;
    }
  }
  inf.clear();
  log(`inferred steps kept ${infKept}, dropped ${infDropped} (the ancestor's own entry says otherwise), ${infOutvoted} outvoted`);
  Object.assign(descStat, { infKept, infDropped, infOutvoted });
  // Descendants trees
  const loaded = new Set(); for (let i = 0; i < nEntries; i++) loaded.add(N[i].f);
  let descAdded = 0, descSkipped = 0, descAgree = 0;
  const crossParent = (i) => { const m = own.get(i); if (!m) return false; for (const [p, v] of m) if (N[p].f !== N[i].f && v.k !== "root") return true; return false; };
  for (let i = 0; i < nEntries; i++) {
    const ds = N[i].ds; if (!ds) continue;
    const items = ds.map((d) => ({ d: d[0], c: d[1], w: nfc(String(d[2]).replace(/^\?\s*/, "")), fl: d[3] || 0 }));
    const par = new Int32Array(items.length).fill(-1);
    const stack = [];
    for (let k = 0; k < items.length; k++) {
      while (stack.length && items[stack[stack.length - 1]].d >= items[k].d) stack.pop();
      par[k] = stack.length ? stack[stack.length - 1] : -1;
      stack.push(k);
    }
    const keep = new Uint8Array(items.length);
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      if (!it.c || it.c === "unknown" || /^\[|^⇒|^>|:\s|script needed/.test(it.w) || !it.w) continue;
      if (loaded.has(famOf(it.c))) for (let q = k; q >= 0 && !keep[q]; q = par[q]) keep[q] = 1;
    }
    const nodeOf = new Int32Array(items.length).fill(-2);
    for (let k = 0; k < items.length; k++) {
      if (!keep[k]) continue;
      const it = items[k];
      const pi = par[k] < 0 ? i : nodeOf[par[k]];
      if (pi < 0) { nodeOf[k] = -1; continue; }
      const c = resolve({ c: it.c, t: it.w }, { f: N[pi].f, w: N[pi].t, pos: null, pi }, false);
      nodeOf[k] = c;
      if (c === pi) continue;
      const kind = it.fl === 1 ? "bor" : it.fl === 2 ? "cal" : N[c].f === N[pi].f ? "der" : "inh";
      const m = own.get(c);
      if (m && m.has(pi)) { descAgree++; continue; }
      if (N[c].e ? crossParent(c) : false) { descSkipped++; continue; }
      edge(own, c, pi, kind, "d"); descAdded++;
    }
    N[i].ds = null;
  }
  log(`Descendants trees: ${descAdded} edges added, ${descAgree} already there, ${descSkipped} skipped (the child's own entry gives another source)`);
  Object.assign(descStat, { descAdded, descAgree, descSkipped });
  // "Derived terms" lists: an entry with no history at all (tagträumen: no etymology section) goes
  // under an entry of its own language that lists it as derived (Tagtraum). Several list it →
  // the one sharing the longest start with it (Tagtraum over träumen), then the first.
  let dvAdded = 0;
  const bare0 = (c) => { const m = own.get(c); return !m || !m.size; };
  const lcp = (a, b) => { a = a.toLowerCase(); b = b.toLowerCase(); let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++; return k; };
  const dvBest = new Map();   // child → [parent, score]
  for (let i = 0; i < nEntries; i++) {
    const x = N[i]; if (!x.dv) continue;
    const T = byTitle.get(x.f);
    for (const w0 of x.dv) {
      const cs = T && T.get(nfc(w0)); if (!cs) continue;
      for (const c of cs) {
        if (c === i || c >= nEntries || !N[c].e || !bare0(c)) continue;
        const sc = lcp(N[c].t, x.t), b = dvBest.get(c);
        if (!b || sc > b[1]) dvBest.set(c, [i, sc]);
      }
    }
    x.dv = null;
  }
  for (const [c, [p]] of dvBest) { edge(own, c, p, "der", "v"); dvAdded++; }
  log(`Derived-terms lists: ${dvAdded} history-less entries placed under the entry that lists them`);
  Object.assign(descStat, { dvAdded });
  // {{root}}: only where the root isn't reached already
  let rootKept = 0, rootDropped = 0;
  const up = (i) => own.get(i);
  for (const [c, m] of own) {
    for (const [p, v] of [...m]) {
      if (v.k !== "root") continue;
      // BFS over the other parents
      const seen = new Set([c]); const q = []; for (const [pp, vv] of m) if (pp !== p) q.push(pp);
      let hit = false, steps = 0;
      while (q.length && steps < 400) { const y = q.shift(); steps++; if (y === p) { hit = true; break; } if (seen.has(y)) continue; seen.add(y); const mm = up(y); if (mm) for (const z of mm.keys()) q.push(z); }
      if (hit) { m.delete(p); rootDropped++; } else { v.k = "der"; v.s = "r"; rootKept++; }
    }
  }
  log(`{{root}}: ${rootKept} kept, ${rootDropped} already reached through the entry's own history`);
}

// ---- keep: the four languages and everything they descend from ---------------------------
// words/ keys English proper nouns in lower case (richardson ← Richardson): such an entry stands
// for that headword unless the lower-case page exists too
function aliasHeadwords(headwords) {
  const en = byTitle.get("English") || new Map(); let n = 0;
  for (const [t, is] of en) { if (headwords.has(t)) continue; const lo = t.toLowerCase(); if (lo !== t && headwords.has(lo) && !en.has(lo)) { for (const i of is) N[i].hwk = lo; n++; } }
  return n;
}
const hwName = (x) => x.hwk || x.t;
// a person, place or organisation: only a proper noun, and not a calendar, festival, language or
// scripture word (Monday, January, Christmas, Purim, Romansh, New Testament keep their points)
const NAME_KEEP = /day of the week|\bmonth\b|calendar|festival|feast|holiday|celebrat|\blanguage\b|\bdialect\b|\bbible\b|testament|gospel/i;
const properName = (x) => x.e && x.p && x.p.size === 1 && x.p.has("name") && !NAME_KEEP.test(x.g || (x.gs && x.gs[0]) || "");
function prune(headwords) {
  const keep = new Uint8Array(N.length);
  const q = [];
  let enDropped = 0, namesHeld = 0;
  for (let i = 0; i < N.length; i++) {
    const x = N[i], lc = FOUR_FAM[x.f];
    if (!lc) continue;
    // English: points are the words that have an entry in the app (words/); other English entries
    // stay only as ancestors of something kept
    if (lc === "en" && !headwords.has(hwName(x))) { if (x.e) enDropped++; continue; }
    // names (Toronto, Fiona, CIA) aren't points of their own; they stay only as ancestors (Caesar → Kaiser)
    if (properName(x)) { namesHeld++; continue; }
    keep[i] = 1; q.push(i);
  }
  while (q.length) { const i = q.pop(); const m = own.get(i); if (m) for (const p of m.keys()) if (!keep[p]) { keep[p] = 1; q.push(p); } }
  let enRescued = 0; for (let i = 0; i < N.length; i++) if (keep[i] && N[i].f === "English" && !headwords.has(hwName(N[i])) && N[i].e) enRescued++;
  let namesKept = 0; for (let i = 0; i < N.length; i++) if (keep[i] && properName(N[i]) && FOUR_FAM[N[i].f]) namesKept++;
  log(`names: ${namesHeld} not points of their own, ${namesKept} kept as ancestors`); stat.namesHeld = namesHeld; stat.namesKeptAsAncestors = namesKept;
  return { keep, enDropped: enDropped - enRescued, enRescued };
}

async function main() {
  await load();
  log(`${records} records → ${N.length} entry nodes`);
  const db = new DatabaseSync(path.join(ROOT, "rootwork.sqlite"), { readOnly: true });
  const headwords = new Set(db.prepare("select word from words").all().map((r) => r.word));
  headwordsG = headwords;
  const rank = new Map();
  for (const line of fs.readFileSync(path.join(ROOT, "review", "ranks.tsv"), "utf8").split("\n").slice(1)) { const i = line.lastIndexOf("\t"); if (i > 0) rank.set(line.slice(0, i), Number(line.slice(i + 1))); }
  // inflected headwords (greatest, sent) that have no lemma entry: a point folded under the lemma
  { const en = byTitle.get("English") || new Map(); let n = 0;
    for (const [w, base] of formOf) {
      if (!headwords.has(w) || en.has(w) || w === base) continue;
      const i = N.length; N.push({ f: "English", t: w, e: 1, p: new Set(["form"]), labels: new Map([["English", 1]]), lcode: "en",
        rels: [{ from: null, to: { c: "en", t: base }, k: "der", src: "form", inferred: false }] });
      pushTo(byTitle, "English", w, i); pushTo(byNorm, "English", w, i); n++;
    }
    log(`inflected headwords placed under their lemma: ${n}`); stat.formOf = n; }
  build();
  log(`resolution: ${JSON.stringify(stat)}`);
  if (process.env.AMB) { const a = [...ambS].sort((x, y) => y[1] - x[1]); log("top ambiguous: " + a.slice(0, 40).map((x) => x[0] + " " + x[1]).join(" · ")); const byF = new Map(); for (const [k, v] of a) { const f = k.split("|")[0]; byF.set(f, (byF.get(f) || 0) + v); } log("by language: " + JSON.stringify([...byF])); process.exit(0); }
  // stage bridging (as build-etym-graph.js): a parentless bare form that exists one stage earlier
  const STAGES = { "French": ["Middle French", "Old French"], "Middle French": ["Old French"], "English": ["Middle English", "Old English"],
    "Middle English": ["Old English"], "German": ["Middle High German", "Old High German"], "Middle High German": ["Old High German"],
    "Dutch": ["Middle Dutch", "Old Dutch"], "Middle Dutch": ["Old Dutch"] };
  let bridged = 0;
  for (let i = 0; i < N.length; i++) {
    if (N[i].e || own.has(i)) continue;
    for (const older of STAGES[N[i].f] || []) {
      const c = ((byTitle.get(older) || new Map()).get(N[i].t) || [])[0] ?? bareKey.get(older + "|" + ruleFor(older)(N[i].t));
      if (c !== undefined && own.has(c)) { edge(own, i, c, "inh", "s"); bridged++; break; }
    }
  }
  log(`bridged ${bridged} later-stage citations to their earlier stage`);
  log(`English proper nouns matched to lower-case headwords: ${aliasHeadwords(headwords)}`);
  const { keep, enDropped, enRescued } = prune(headwords);
  // keys
  const seenKey = new Set();
  for (let i = 0; i < N.length; i++) {
    if (!keep[i]) continue;
    const x = N[i];
    let k = x.f + "|" + hwName(x);
    if (seenKey.has(k)) k += "#" + (x.n || i);
    while (seenKey.has(k)) k += "'";
    seenKey.add(k); keyOfNode[i] = k;
  }
  // children (kept) for drawn / folding
  const hasKid = new Uint8Array(N.length);
  for (const [c, m] of own) if (keep[c]) for (const p of m.keys()) hasKid[p] = 1;
  const isAff = (t) => /^\*?[-‐]|[-‐]$/.test(t || "");
  const top = (m) => { let b = null, c = -1; if (m) for (const [k, v] of m) if (v > c) { b = k; c = v; } return b; };
  const display = (x) => {
    // a headword carrying notes ("point oblique singular or …") is not a label
    if (x.e) return x.f === "English" ? hwName(x) : x.h && (!/\s/.test(x.h) || /\s/.test(x.t)) ? x.h : x.t;
    let best = x.t, score = -1;
    for (const [f, c] of x.forms || []) {
      if (/\s/.test(f) && !/\s/.test(x.t)) continue;   // a display carrying notes ("general (oblique singular) or …")
      const marks = (f.normalize("NFD").match(/\p{M}/gu) || []).length + (f.startsWith("*") ? 1 : 0); const s = c * 10 + marks; if (s > score) { best = f; score = s; } }
    return best;
  };
  // English descendants per node (detail panel), as before
  const enDesc = new Map();
  for (let i = 0; i < N.length; i++) {
    if (!keep[i] || N[i].f !== "English" || !headwords.has(hwName(N[i]))) continue;
    const seen = new Set([i]); const q = [[i, 0]];
    while (q.length) { const [y, d] = q.shift(); if (d >= 12) continue; const m = own.get(y); if (m) for (const p of m.keys()) if (!seen.has(p) && keep[p]) { seen.add(p); q.push([p, d + 1]); let s = enDesc.get(p); if (!s) enDesc.set(p, (s = [])); s.push(hwName(N[i])); } }
  }
  const ancOf = (i) => { const seen = new Map([[i, 0]]); const q = [i]; while (q.length) { const y = q.shift(); const d = seen.get(y); if (d >= 12) continue; const m = own.get(y); if (m) for (const p of m.keys()) if (keep[p] && !seen.has(p)) { seen.set(p, d + 1); q.push(p); } } seen.delete(i); return seen; };
  const enIdx = new Map(); for (let i = 0; i < N.length; i++) if (keep[i] && N[i].f === "English" && N[i].e && !enIdx.has(hwName(N[i]))) enIdx.set(hwName(N[i]), i);
  const splitPoint = (i, w) => { const j = enIdx.get(w); if (j === undefined) return -1; const A = ancOf(i), B = ancOf(j); let best = -1, bd = 1e9; for (const [k, da] of A) if (B.has(k)) { const s2 = da + B.get(k); if (s2 < bd) { bd = s2; best = k; } } return best; };
  const rankOf = (w) => (rank.has(w) ? rank.get(w) : 9e6 + w.length);
  // write
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  const shards = new Map();
  const shardOf = (key) => { let h = 5381; for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0; return (h & 255).toString(16).padStart(2, "0"); };
  const per = {}; const bump = (lc, f) => { per[lc] = per[lc] || { points: 0, drawn: 0, entries: 0, folded: 0, quiet: 0, unconnected: 0 }; per[lc][f]++; };
  let written = 0;
  for (let i = 0; i < N.length; i++) {
    if (!keep[i]) continue;
    const x = N[i], key = keyOfNode[i], lc = FOUR_FAM[x.f];
    const rec = { l: x.e ? x.f : top(x.labels) || x.f, t: display(x) };
    if (x.f === "English" && headwords.has(hwName(x))) rec.hw = 1;
    if (lc) rec.lc = lc;
    if (x.e) rec.e = 1;
    if (x.g && !rec.hw) rec.g = x.g;
    if (x.ipa) rec.ipa = x.ipa;
    const m = own.get(i);
    const ups = m ? [...m].filter(([p]) => keep[p]) : [];
    if (ups.length) rec.up = ups.map(([p, v]) => { const kind = v.k === "part" ? (isAff(N[p].t) ? "aff" : "cmp") : v.k; const o = [keyOfNode[p], kind]; if (v.s && v.s !== "d") o.push(1); else if (v.s === "d") o.push(0); if (v.s) o.push(v.s); return o; });
    if (ups.length && ups.every(([p]) => N[p].f === x.f)) rec.fold = ups.filter(([p]) => !isAff(N[p].t)).map(([p]) => keyOfNode[p]);
    let drawn = 1;
    if (!ups.length && !hasKid[i]) { drawn = 0; if (lc) bump(lc, "unconnected"); }
    if (x.qn && x.qn === x.pn) { const rk = rank.get(x.t); if (!(lc === "en" && rk != null && rk <= 25000)) { drawn = 0; rec.q = 1; if (lc) bump(lc, "quiet"); } }
    if (!drawn) rec.dr = 0;
    if (lc) { bump(lc, "points"); if (drawn) bump(lc, "drawn"); if (x.e) bump(lc, "entries"); if (rec.fold) bump(lc, "folded"); }
    else { bump("ancestors", "points"); if (drawn) bump("ancestors", "drawn"); if (x.e) bump("ancestors", "entries"); }
    const d = enDesc.get(i);
    if (d) { const u = [...new Set(d)].filter((w) => w !== rec.t).sort((a, b) => rankOf(a) - rankOf(b)); rec.ne = u.length; rec.en = u.slice(0, 48); }
    if (rec.hw && x.dbl) rec.dbl = [...new Set(x.dbl)].filter((w) => headwords.has(w) && w !== rec.t).map((w) => { const v = splitPoint(i, w); return v >= 0 ? [w, keyOfNode[v]] : [w]; });
    if (rec.hw && x.cog) rec.cog = x.cog.map(([c, t, g]) => (g ? [langName(c), t, g] : [langName(c), t]));
    const s = shardOf(key); let o = shards.get(s); if (!o) shards.set(s, (o = [])); o.push(JSON.stringify(key) + ":" + JSON.stringify(rec));
    written++;
  }
  for (const [s, arr] of shards) fs.writeFileSync(path.join(OUT, s + ".json"), "{\n" + arr.join(",\n") + "\n}\n");
  // the reader's lexicon: every French and German entry, with its map key when it is a point
  // (scripts/build-reader.py reads these; the map and the reader share one set of entries)
  for (const lc of Object.keys(READER)) {
    const fam = FOUR[lc], lines = [];
    for (let i = 0; i < N.length; i++) {
      const x = N[i]; if (!x.e || x.f !== fam) continue;
      const o = { k: keep[i] ? keyOfNode[i] : null, t: x.t, p: [...x.p] };
      if (x.h) o.h = x.h; if (x.n) o.n = x.n; if (x.gs) o.g = x.gs; if (x.ipa) o.ipa = x.ipa;
      if (x.tags) o.q = [...x.tags]; if (x.ao) o.ao = x.ao;
      if (properName(x)) o.nm = 1;
      lines.push(JSON.stringify(o));
    }
    fs.writeFileSync(path.join(OUT, "lex-" + lc + ".jsonl"), lines.join("\n") + "\n");
    const fm = {}; for (const [f, ls] of READER[lc].forms) fm[f] = [...ls];
    fs.writeFileSync(path.join(OUT, "forms-" + lc + ".json"), JSON.stringify(fm));
    log(`reader lexicon ${lc}: ${lines.length} entries, ${READER[lc].forms.size} inflected forms`);
  }
  const stats = { desc: descStat, fromProse, fromDerive, records, nodes: N.length, written, resolution: stat, bridged, englishEntriesDropped: enDropped, englishEntriesKeptAsAncestors: enRescued, per };
  fs.writeFileSync(path.join(OUT, "stats.json"), JSON.stringify(stats, null, 1));
  log(`wrote ${written} nodes; ${JSON.stringify(per)}`);
}
main();
