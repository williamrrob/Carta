#!/usr/bin/env node
// Indexes the four divisions read, derived from files already served (graph/, reader/);
// no dumps needed. Re-run after the layout or build-reader.py, then bump V in graph.js.
//
//   graph/sorted4.bin      Uint32: every English, French, German and Latin *word* on the map
//                          (no affixes, no reconstructions), ordered by fold(label). Search
//                          binary-searches it for a prefix.
//   graph/forms/<lc>-<k>.json
//                          French / German inflected form (folded) → map indices of its
//                          lemma(s), from reader/<lc>/forms + lex.json. k = first folded
//                          letter, "_" otherwise. Search uses it so "endors" finds endormir.
//
// fold() must stay identical to the one in divisions.js.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const G = path.join(ROOT, "graph");

const fold = (s) => String(s).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ß/g, "ss").replace(/œ/g, "oe").replace(/æ/g, "ae");
const LANGS4 = (name) => name === "English" || name === "French" || name === "German" || /(^|\s)Latin$/.test(name);
const isWord = (t) => t && !/^[-*]|-$/.test(t) && !/\s{2,}/.test(t);

const info = JSON.parse(fs.readFileSync(path.join(G, "info.json"), "utf8"));
const labels = JSON.parse(fs.readFileSync(path.join(G, "labels.json"), "utf8"));
const lang = new Uint16Array(fs.readFileSync(path.join(G, "lang.bin")).buffer.slice(0));
const want = info.langs.map(LANGS4);

// ---- sorted4.bin ----
const keep = [];
for (let i = 0; i < info.n; i++) if (want[lang[i]] && isWord(labels[i])) keep.push(i);
const key = new Map(keep.map((i) => [i, fold(labels[i])]));
keep.sort((a, b) => { const x = key.get(a), y = key.get(b); return x < y ? -1 : x > y ? 1 : a - b; });
fs.writeFileSync(path.join(G, "sorted4.bin"), Buffer.from(new Uint32Array(keep).buffer));
const byLang = {};
for (const i of keep) { const n = info.langs[lang[i]]; byLang[n] = (byLang[n] || 0) + 1; }
console.log("sorted4.bin:", keep.length, "words;", Object.entries(byLang).sort((a, b) => b[1] - a[1]).slice(0, 6).map((x) => x.join(" ")).join(", "));

// ---- forms ----
const outDir = path.join(G, "forms");
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));
for (const lc of ["fr", "de"]) {
  const dir = path.join(ROOT, "reader", lc);
  const lex = JSON.parse(fs.readFileSync(path.join(dir, "lex.json"), "utf8"));
  const shards = {};
  let n = 0;
  for (const file of fs.readdirSync(path.join(dir, "forms"))) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, "forms", file), "utf8"));
    for (const [surf, ids] of Object.entries(m)) {
      const s = surf.replace(/^\^/, "");
      const fs_ = fold(s);
      const out = [];
      for (const id of ids || []) {
        const L = id >= 0 ? lex[id] : null;
        if (!L || L[6] == null || L[6] < 0) continue;
        if (fold(L[0]) === fs_) continue;          // the lemma itself: the sorted index has it
        if (!out.includes(L[6])) out.push(L[6]);
      }
      if (!out.length) continue;
      const k = /^[a-z]/.test(fs_) ? fs_[0] : "_";
      const sh = (shards[k] = shards[k] || {});
      const prev = sh[fs_] || [];
      for (const x of out) if (!prev.includes(x)) prev.push(x);
      sh[fs_] = prev; n++;
    }
  }
  let bytes = 0;
  for (const [k, sh] of Object.entries(shards)) { const t = JSON.stringify(sh); bytes += t.length; fs.writeFileSync(path.join(outDir, lc + "-" + k + ".json"), t); }
  console.log("forms " + lc + ":", n, "forms,", Object.keys(shards).length, "shards,", Math.round(bytes / 1024) + " KB");
}

// ---- langmask.bin: one byte per point. Bits 1 English, 2 French, 4 German, 8 Latin: set for a
// point in that language and for every point it descends from (primary parent and cross links).
// Explore hides a language by these bits; a point with no bit set belongs to none of the four and
// always shows.
{
  const parent = new Int32Array(fs.readFileSync(path.join(G, "tree.bin")).buffer.slice(0));
  const links = new Int32Array(fs.readFileSync(path.join(G, "links.bin")).buffer.slice(0));
  const up = new Map();
  for (let k = 0; k + 1 < links.length; k += 2) { const c = links[k], p = links[k + 1]; (up.get(c) || up.set(c, []).get(c)).push(p); }
  const bit = info.langs.map((n) => (n === "English" ? 1 : n === "French" ? 2 : n === "German" ? 4 : /(^|\s)Latin$/.test(n) ? 8 : 0));
  const mask = new Uint8Array(info.n);
  for (let i = 0; i < info.n; i++) {
    const b = bit[lang[i]]; if (!b) continue;
    // walk every ancestor, stopping where this bit is already set
    const stack = [i];
    while (stack.length) {
      const x = stack.pop();
      if (mask[x] & b && x !== i) continue;
      mask[x] |= b;
      if (parent[x] >= 0 && !(mask[parent[x]] & b)) stack.push(parent[x]);
      const c = up.get(x); if (c) for (const p of c) if (!(mask[p] & b)) stack.push(p);
    }
  }
  fs.writeFileSync(path.join(G, "langmask.bin"), Buffer.from(mask.buffer));
  let none = 0; for (const m of mask) if (!m) none++;
  console.log("langmask.bin:", info.n, "points,", none, "outside the four languages' lines");
}
