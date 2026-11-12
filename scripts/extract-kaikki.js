#!/usr/bin/env node
/*
 * extract-kaikki.js — ONE extractor for every language (parity rebuild, Nov 2026).
 * Reads a byte-range slice of a per-language kaikki.org dump (uncompressed JSONL:
 * https://kaikki.org/dictionary/<Lang>/kaikki.org-dictionary-<Lang>.jsonl) and writes slim
 * lemma records. Slices make it resumable and parallel under a short command time limit:
 *
 *   node scripts/extract-kaikki.js <dump.jsonl> <out.jsonl> <k> <n>     (slice k of n, 0-based)
 *
 * A line belongs to the slice in which its first byte lies. Inflected-form-only entries are
 * skipped. Output record (one per lemma entry):
 *   { w, l, p, n?, h?: canonical form (Latin cantō for page canto), g, ipa?, q?:[tags],
 *     x?: etymology prose (≤400), id?: [ids other entries cite it by (<id:…>)],
 *     et?: [{ n: template, a: [positional args 1..], t?: gloss, id?, j?: "+"|"&" connector before it }],
 *     ds?: [[depth, langCode, word, flag?]],   its Descendants tree, flattened (flag 1 borrowed, 2 calque)
 *     dv?: [words] }                           its Derived terms list (same language)
 * With FORMS=1 in the environment, inflected-form entries are kept too, as { w, l, p, fo: [lemmas] }, and
 * a lemma page that is also a form (été: summer; past participle of être) carries fo beside its senses.
 * Beside the output: <out>.langs.json, language code → name votes.
 */
"use strict";
const fs = require("fs");
const [, , IN, OUT, K, NN] = process.argv;
const k = Number(K || 0), n = Number(NN || 1);
const size = fs.statSync(IN).size;
const start = Math.floor((size * k) / n), end = Math.floor((size * (k + 1)) / n);

const REL = new Set(["inh", "bor", "der", "lbor", "slbor", "ubor", "obor", "uder", "cal", "calque", "clq", "pcal", "sl", "psm", "translit",
  "af", "affix", "com", "compound", "suffix", "suf", "prefix", "pre", "confix", "con", "surf", "surface analysis", "blend", "univ",
  "clipping", "back-formation", "bf", "deverbal", "abbrev", "root", "ety", "etymon", "doublet", "dbt", "piecewise doublet",
  "unc", "unk", "onom", "named-after", "nonlemma", "cog", "cognate", "ncog", "noncog"]);
const CHAINT = new Set(["inh", "bor", "der", "lbor", "slbor", "ubor", "obor", "uder", "cal", "calque", "clq", "pcal", "sl", "psm"]);
const QUIET = new Set(["slang", "Internet", "neologism", "nonce-word", "vulgar", "obsolete", "archaic", "rare", "dialectal"]);
// language code → name votes, written beside the output (<out>.langs.json) for the graph builder
const votes = new Map();
function vote(code, name) {
  if (!code || !name || code === "unknown" || name.length > 40) return;
  let m = votes.get(code); if (!m) votes.set(code, (m = new Map()));
  m.set(name, (m.get(name) || 0) + 1);
}
const LEAD = /^(?:(?:Partly|Ultimately |Probably |Possibly )?(?:Inherited|Borrowed|Derived|Learned borrowing|Semi-learned borrowing|Unadapted borrowing|Orthographic borrowing|Calque|Partial calque|Semantic loan|Phono-semantic matching)\s+(?:from|of)\s+)/i;
// drop <ref:…> (citations, often HTML) from an ety/etymon term string, bracket-depth aware
function dropRefs(s) {
  let out = "", i = 0;
  while (i < s.length) {
    if (s.startsWith("<ref:", i)) { let j = i + 1, d = 1; while (j < s.length && d) { if (s[j] === "<") d++; else if (s[j] === ">") d--; j++; } i = j; continue; }
    out += s[i++];
  }
  return out;
}

// the prose between two relation templates says how the second relates to the first:
//   "+"  a further component ("from A + B")
//   "&"  an alternative or parallel source ("from A, or borrowed from B", "from A and B")
//   "."  a new sentence that isn't continuing the line ("… A. Compare B") — not a step back
//   none the next step back ("from A, from B"; "A. Ultimately from B")
function connector(sep) {
  if (/\+\s*$/.test(sep)) return "+";
  const brk = sep.search(/[.;]\s|[.;]$/);
  if (brk >= 0) { const after = sep.slice(brk + 1); return /\bfrom\s+(?:the\s+)?$/i.test(after) && !/\b(?:or|alternatively|compare|cognate|perhaps|possibly)\b/i.test(after) ? undefined : "."; }
  if (/\b(?:further|ultimately|in turn|itself|which is)\b[^,]*$/i.test(sep)) return undefined;   // "and further from"
  if (/\b(?:or|and|alternatively|either|influenced|compare|cognate|akin)\b/i.test(sep)) return "&";
  return undefined;
}
function slimEt(tpls, text) {
  const out = []; const seen = new Set();
  let cursor = 0;
  for (const t of tpls) {
    const name = t.name.replace(/\+$/, "");
    // where this template's rendered text sits in the prose: the connector before it
    // ("+" = a further component, "and"/"or" = a parallel source) — see import-kaikki-etym.js
    let sep = null;
    const exp = String(t.expansion || "").split("\n").pop();
    if (exp && text) { const k = text.indexOf(exp, cursor); if (k >= 0) { sep = text.slice(cursor, k); cursor = k + exp.length; } }
    if (!REL.has(name)) continue;
    const args = t.args || {};
    if ((name === "ety" || name === "etymon") && args.nl) continue;           // "see the lemma's etymology"
    let bad = false;
    const a = [];
    for (let i = 1; i < 40 && args[i] !== undefined; i++) a.push(args[i]);
    // some relation templates leave gaps (lang, src, term, "", gloss): keep up to arg 5
    for (let i = a.length + 1; i <= 5; i++) if (args[i] !== undefined) { while (a.length < i - 1) a.push(""); a.push(args[i]); }
    for (let i = 0; i < a.length; i++) { const v = String(a[i]); if (v.startsWith("['")) bad = true; a[i] = v.indexOf("<ref:") >= 0 ? dropRefs(v) : v; }
    // affix templates name which homograph each part is (id1=, id2=…) and gloss it (t1=…): carry
    // them on the part as ety-style modifiers, so one parser reads both
    if (!CHAINT.has(name) && name !== "ety" && name !== "etymon") for (let k = 1; k < a.length; k++) {
      const id = args["id" + k], tk = args["t" + k] || args["gloss" + k];
      if (id && a[k].indexOf("<id:") < 0) a[k] += "<id:" + id + ">";
      if (tk && a[k].indexOf("<t:") < 0) a[k] += "<t:" + String(tk).slice(0, 60) + ">";
    }
    if (bad) continue;                                                        // a stringified duplicate of a template
    const rec = { n: name, a };
    const gl = args.t || args.gloss || args.t1 || args.gloss1; if (gl) rec.t = String(gl).slice(0, 80);
    if (args.id) rec.id = String(args.id);
    if (name === "ety" || name === "etymon") {
      if (args.tree) rec.tree = 1;
      for (const m of String(t.expansion || "").matchAll(/"lang_name" : "([^"]+)", "status" : "[^"]*", "lang" : "([^"]+)"|"lang_name" : "([^"]+)", "term" : "[^"]*", "status" : "[^"]*", "lang" : "([^"]+)"/g)) vote(m[2] || m[4], m[1] || m[3]);
    } else if (CHAINT.has(name)) {
      if (sep != null) rec.j = connector(sep);
      const shown = a[3] || a[2];
      if (shown && exp) { const e2 = exp.replace(LEAD, ""); const k = e2.indexOf(String(shown).split(",")[0]); if (k > 0) vote(a[1], e2.slice(0, k).trim()); }
    }
    const key = JSON.stringify(rec); if (seen.has(key)) continue; seen.add(key);
    out.push(rec);
  }
  return out;
}
// Descendants tree, flattened: [depth, langCode, word, flag?] (flag 1 borrowed/learned, 2 calque).
// Heading rows without a word ("Insular Romance") don't add a level.
function flatDesc(list, depth, out) {
  for (const d of list) {
    if (out.length >= 600) return;
    if (d.lang_code && d.lang) vote(d.lang_code, d.lang);
    if (d.word && d.lang_code) {
      const tg = (d.raw_tags || []).concat(d.tags || []);
      const f = tg.some((x) => /borrow|learned/i.test(x)) ? 1 : tg.some((x) => /calque/i.test(x)) ? 2 : 0;
      out.push(f ? [depth, d.lang_code, d.word, f] : [depth, d.lang_code, d.word]);
    }
    if (d.descendants) flatDesc(d.descendants, d.word ? depth + 1 : depth, out);
  }
}
function slim(r) {
  const senses = r.senses || [];
  const real = senses.filter((s) => !(s.form_of || (s.tags || []).includes("form-of")));
  // FORMS=1: the lemmas this page is an inflected form of (suis → être, suivre), every one
  let fo = null;
  if (process.env.FORMS && r.word) { const s2 = new Set(); for (const s of senses) for (const f of s.form_of || []) if (f.word && f.word !== r.word) s2.add(f.word); if (s2.size) fo = [...s2]; }
  if (!real.length || !r.word) return fo ? { w: r.word, l: r.lang_code, p: r.pos, fo } : null;
  vote(r.lang_code, r.lang);
  const o = { w: r.word, l: r.lang_code, p: r.pos };
  if (fo) o.fo = fo;
  if (r.etymology_number) o.n = r.etymology_number;
  for (const f of r.forms || []) if ((f.tags || []).includes("canonical") && f.form && f.form !== r.word) { o.h = f.form; break; }
  const g = real[0].glosses && real[0].glosses[real[0].glosses.length - 1]; if (g) o.g = g.length > 120 ? g.slice(0, 118) + "…" : g;
  // FORMS=1: an entry whose every sense is "alternative spelling of X" names X (christian → Christian)
  if (process.env.FORMS && real.every((s) => s.alt_of && s.alt_of.length)) o.ao = real[0].alt_of[0].word;
  for (const s of r.sounds || []) if (s.ipa) { o.ipa = s.ipa; break; }
  const ids = new Set();
  for (const s of senses) for (const x of [].concat(s.senseid || [])) ids.add(String(x).replace(/^[a-z-]+:/, ""));
  const q = new Set(); let all = true;
  for (const s of real) { let any = false; for (const t of (s.tags || []).concat(s.raw_tags || [])) if (QUIET.has(t)) { q.add(t); any = true; } if (!any) all = false; }
  if (all && q.size) o.q = [...q];
  const text = String(r.etymology_text || "");
  if (text) {
    let x = text;
    if (x.startsWith("Etymology tree")) { const tag = "\n" + r.lang + " " + r.word + "\n"; const k = x.indexOf(tag); x = k >= 0 ? x.slice(k + tag.length) : x.replace(/^Etymology tree[\s\S]*?\n\n/, ""); }
    o.x = x.slice(0, 400);
  }
  if (r.etymology_templates) {
    const et = slimEt(r.etymology_templates, text); if (et.length) o.et = et;
    for (const t of et) if ((t.n === "ety" || t.n === "etymon") && t.id) ids.add(t.id);
  }
  if (ids.size) o.id = [...ids];
  if (r.descendants) { const ds = []; flatDesc(r.descendants, 0, ds); if (ds.length) o.ds = ds; }
  // its "Derived terms" list: a word with no etymology of its own (tagträumen) is placed under the
  // entry that lists it (Tagtraum) by build-lexeme-graph.js
  if (r.derived) { const dv = [...new Set(r.derived.map((d) => d && d.word).filter((w) => w && w !== r.word && w.length < 60))].slice(0, 120); if (dv.length) o.dv = dv; }
  return o;
}

const fd = fs.openSync(IN, "r");
const out = fs.openSync(OUT, "w");
const CH = 16 << 20; const buf = Buffer.allocUnsafe(CH);
let pos = start > 0 ? start - 1 : 0, carry = null, lineStart = pos, first = start > 0, kept = 0, seen = 0, outBuf = [];
let done = false;
while (!done) {
  const got = fs.readSync(fd, buf, 0, CH, pos); if (!got) break;
  let from = 0;
  for (;;) {
    const nl = buf.indexOf(10, from); if (nl < 0 || nl >= got) break;
    const piece = buf.subarray(from, nl);
    const line = carry ? Buffer.concat([carry, piece]) : piece; carry = null;
    const ls = lineStart; lineStart = pos + nl + 1; from = nl + 1;
    if (first) { first = false; continue; }           // partial (or previous slice's) line
    if (ls >= end) { done = true; break; }
    if (line.length > 2) {
      seen++;
      let r; try { r = JSON.parse(line.toString("utf8")); } catch (e) { continue; }
      const s = slim(r); if (s) { kept++; outBuf.push(JSON.stringify(s)); if (outBuf.length >= 2000) { fs.writeSync(out, outBuf.join("\n") + "\n"); outBuf = []; } }
    }
  }
  if (!done && from < got) carry = carry ? Buffer.concat([carry, buf.subarray(from, got)]) : Buffer.from(buf.subarray(from, got));
  pos += got;
}
if (!done && carry && carry.length > 2 && !first && lineStart < end) { try { const s = slim(JSON.parse(carry.toString("utf8"))); if (s) { kept++; outBuf.push(JSON.stringify(s)); } } catch (e) {} }
if (outBuf.length) fs.writeSync(out, outBuf.join("\n") + "\n");
fs.closeSync(out);
{ const v = {}; for (const [c, m] of votes) v[c] = Object.fromEntries(m); fs.writeFileSync(OUT + ".langs.json", JSON.stringify(v)); }
process.stderr.write(`${IN} slice ${k}/${n}: ${seen} entries, ${kept} lemmas kept\n`);
