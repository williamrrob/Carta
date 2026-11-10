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
 *   { w, l, p, n?, g, ipa?, q?:[tags], x?: etymology prose (≤400),
 *     et?: [{ n: template, a: [positional args 1..], t?: gloss }],   relations, as written
 *     ds?: [[depth, langCode, word, borrowed?1]] }                    its Descendants tree, flattened
 */
"use strict";
const fs = require("fs");
const [, , IN, OUT, K, NN] = process.argv;
const k = Number(K || 0), n = Number(NN || 1);
const size = fs.statSync(IN).size;
const start = Math.floor((size * k) / n), end = Math.floor((size * (k + 1)) / n);

const REL = new Set(["inh", "bor", "der", "lbor", "slbor", "ubor", "obor", "uder", "cal", "calque", "clq", "sl", "psm", "translit",
  "af", "affix", "com", "compound", "suffix", "suf", "prefix", "pre", "confix", "con", "surf", "surface analysis", "blend", "univ",
  "clipping", "back-formation", "bf", "deverbal", "abbrev", "root", "ety", "etymon", "doublet", "dbt", "piecewise doublet",
  "unc", "unk", "onom", "named-after", "nonlemma"]);
const QUIET = new Set(["slang", "Internet", "neologism", "nonce-word", "vulgar", "obsolete", "archaic", "rare", "dialectal"]);

function slimEt(tpls) {
  const out = []; const seen = new Set();
  for (const t of tpls) {
    const name = t.name.replace(/\+$/, "");
    if (!REL.has(name)) continue;
    const a = []; const args = t.args || {};
    for (let i = 1; i < 40 && args[i] !== undefined; i++) a.push(args[i]);
    // some relation templates leave gaps (lang, src, term, "", gloss): keep up to arg 5
    for (let i = a.length + 1; i <= 5; i++) if (args[i] !== undefined) { while (a.length < i - 1) a.push(""); a.push(args[i]); }
    const rec = { n: name, a };
    const gl = args.t || args.gloss || args.t1 || args.gloss1; if (gl) rec.t = String(gl).slice(0, 80);
    if (name === "ety" || name === "etymon") { if (args.id) rec.id = args.id; if (args.tree) rec.tree = 1; }
    const key = JSON.stringify(rec); if (seen.has(key)) continue; seen.add(key);
    out.push(rec);
  }
  return out;
}
function flatDesc(list, depth, out) {
  for (const d of list) {
    if (out.length >= 400) return;
    if (d.word && d.lang_code) out.push((d.raw_tags || d.tags || []).some((x) => /borrow/i.test(x)) ? [depth, d.lang_code, d.word, 1] : [depth, d.lang_code, d.word]);
    if (d.descendants) flatDesc(d.descendants, depth + 1, out);
  }
}
function slim(r) {
  const senses = r.senses || [];
  const real = senses.filter((s) => !(s.form_of || (s.tags || []).includes("form-of")));
  if (!real.length || !r.word) return null;
  const o = { w: r.word, l: r.lang_code, p: r.pos };
  if (r.etymology_number) o.n = r.etymology_number;
  const g = real[0].glosses && real[0].glosses[real[0].glosses.length - 1]; if (g) o.g = g.length > 120 ? g.slice(0, 118) + "…" : g;
  for (const s of r.sounds || []) if (s.ipa) { o.ipa = s.ipa; break; }
  const q = new Set(); let all = true;
  for (const s of real) { let any = false; for (const t of (s.tags || []).concat(s.raw_tags || [])) if (QUIET.has(t)) { q.add(t); any = true; } if (!any) all = false; }
  if (all && q.size) o.q = [...q];
  if (r.etymology_text) o.x = r.etymology_text.replace(/^Etymology tree[\s\S]*?\n\n/, "").slice(0, 400);
  if (r.etymology_templates) { const et = slimEt(r.etymology_templates); if (et.length) o.et = et; }
  if (r.descendants) { const ds = []; flatDesc(r.descendants, 0, ds); if (ds.length) o.ds = ds; }
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
process.stderr.write(`${IN} slice ${k}/${n}: ${seen} entries, ${kept} lemmas kept\n`);
