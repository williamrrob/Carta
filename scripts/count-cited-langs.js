#!/usr/bin/env node
/*
 * count-cited-langs.js — which ancestor languages do the slim records cite, and how often?
 * Decides which extra kaikki dumps to fetch (HANDOFF step 1).
 *
 *   node scripts/count-cited-langs.js <slim dir> [min=300]
 * Counts every language code named by a relation (classic templates' source language, prefixes
 * of {{ety}} terms, nested ones included), across all slim-*.jsonl files in the directory.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { relations } = require("./lexeme-lib.js");
const DIR = process.argv[2], MIN = Number(process.argv[3] || 300);
const count = new Map(), names = new Map();
for (const f of fs.readdirSync(DIR)) {
  if (f.endsWith(".langs.json")) {
    for (const [c, m] of Object.entries(JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")))) {
      let x = names.get(c); if (!x) names.set(c, (x = new Map()));
      for (const [nm, v] of Object.entries(m)) x.set(nm, (x.get(nm) || 0) + v);
    }
    continue;
  }
  if (!f.endsWith(".jsonl")) continue;
  for (const line of fs.readFileSync(path.join(DIR, f), "utf8").split("\n")) {
    if (!line || line.indexOf('"et":') < 0) continue;
    const r = JSON.parse(line);
    for (const x of relations(r)) for (const ref of [x.to, x.from]) if (ref && ref.c !== r.l) count.set(ref.c, (count.get(ref.c) || 0) + 1);
  }
}
const top = (m) => { let b = null, c = -1; if (m) for (const [k, v] of m) if (v > c) { b = k; c = v; } return b; };
const rows = [...count].sort((a, b) => b[1] - a[1]);
const out = rows.filter((r) => r[1] >= MIN).map(([c, n]) => ({ c, name: top(names.get(c)), n }));
fs.writeFileSync(path.join(DIR, "cited-langs.json"), JSON.stringify(out, null, 1));
for (const r of out) console.log(String(r.n).padStart(8), r.c.padEnd(10), r.name);
console.log(`${rows.length} cited languages; ${out.length} at ≥${MIN}`);
