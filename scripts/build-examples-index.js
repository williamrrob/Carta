#!/usr/bin/env node
// graph/ex/<chunk>.json — a French or German entry's examples, for its word card: up to three
// of the shortest excerpts that contain that exact entry (reader/<lc>/q, already resolved word by
// word), easiest first. Keyed by map index, chunked like graph/n/ (1024 points a file), so a card
// fetches one small file. Row: [text, author, band, index in band, has English?].
// Learn fetches the band itself only if you choose to translate one.
// Re-run after scripts/build-reader.py (it reads the served reader/ files), then bump V in graph.js.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const PER = 3, MAXLEN = 240, CHUNK = 1024;
const by = new Map(); // map index → [[len, row]]
for (const lc of ["fr", "de"]) {
  const dir = path.join(ROOT, "reader", lc);
  const lex = JSON.parse(fs.readFileSync(path.join(dir, "lex.json"), "utf8"));
  const idx = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
  idx.bands.forEach((_, b) => {
    const f = path.join(dir, "q", b + ".json"); if (!fs.existsSync(f)) return;
    JSON.parse(fs.readFileSync(f, "utf8")).forEach((q, k) => {
      if (!q.t || q.t.length > MAXLEN) return;
      const seen = new Set();
      for (const w of q.w) {
        const L = w[2] >= 0 ? lex[w[2]] : null;
        if (!L || L[6] == null || L[6] < 0 || L[7] & 1 || seen.has(L[6])) continue;
        seen.add(L[6]);
        const row = [q.t, (q.a || "").trim(), b, k, q.en ? 1 : 0];
        const a = by.get(L[6]) || by.set(L[6], []).get(L[6]);
        // keep the best few: translated first, then shortest
        a.push([(q.en ? 0 : 1000) + q.t.length + b * 2, lc, row]);
        if (a.length > PER * 4) { a.sort((x, y) => x[0] - y[0]); a.length = PER * 2; }
      }
    });
  });
}
const out = path.join(ROOT, "graph", "ex");
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) fs.unlinkSync(path.join(out, f));
const chunks = new Map();
for (const [i, a] of by) {
  a.sort((x, y) => x[0] - y[0]);
  const c = Math.floor(i / CHUNK);
  // one passage once: drop an excerpt that contains, or sits inside, one already kept
  const keep = [];
  for (const x of a) { const t = x[2][0]; if (!keep.some((y) => y[2][0].includes(t) || t.includes(y[2][0]))) keep.push(x); if (keep.length === PER) break; }
  (chunks.get(c) || chunks.set(c, {}).get(c))[i] = keep.map((x) => [x[1]].concat(x[2]));
}
let bytes = 0;
for (const [c, o] of chunks) { const t = JSON.stringify(o); bytes += t.length; fs.writeFileSync(path.join(out, c + ".json"), t); }
console.log("examples:", by.size, "entries,", chunks.size, "files,", Math.round(bytes / 1048576 * 10) / 10 + " MB");
