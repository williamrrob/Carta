// The reader and the map share one set of dictionary entries (scripts/build-reader.py reads the
// map's lexicon). This checks the built data still agrees:
//   - reader/<lc>/index.json and graph/info.json come from the same layout run (build stamp);
//   - every lexicon row that names a map point lands on a point with the same spelling;
//   - every quotation word's position lies inside its text, and its ids exist.
"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const J = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));

const info = J("graph/info.json");
const labels = J("graph/labels.json");
// spelling only: headwords may carry punctuation or superscripts (pas du tout !, Mᵉ.)
const fold = (s) => String(s).normalize("NFKD").replace(/[̄̆]/g, "").replace(/[^\p{L}\p{N}'’ -]/gu, "").trim().normalize("NFC");

for (const lc of ["fr", "de"]) {
  const idx = J(`reader/${lc}/index.json`);
  assert.strictEqual(idx.build, info.build, `reader/${lc} was built against another map (build ${idx.build} vs ${info.build})`);
  const lex = J(`reader/${lc}/lex.json`);
  let onMap = 0, same = 0;
  for (const L of lex) {
    if (L[6] < 0) continue;
    onMap++;
    assert.ok(L[6] < info.n, `${L[0]}: map index out of range`);
    if (fold(labels[L[6]]) === fold(L[0])) same++;
  }
  assert.ok(same >= onMap * 0.995, `${lc}: only ${same} of ${onMap} lexicon rows land on a point with their own spelling`);
  let words = 0;
  for (const f of fs.readdirSync(path.join(ROOT, "reader", lc, "q"))) {
    for (const q of J(`reader/${lc}/q/${f}`)) {
      for (const [s, len, id, alt] of q.w) {
        words++;
        assert.ok(s >= 0 && len > 0 && s + len <= q.t.length, `${lc}: a word position runs outside its quotation`);
        assert.ok(id >= -2 && id < lex.length && (alt == null || (alt >= 0 && alt < lex.length)), `${lc}: a word points at no entry`);
      }
    }
  }
  console.log(`ok - reader/${lc}: ${lex.length} entries (${onMap} on the map, ${same} same spelling), ${words} quotation words`);
}
console.log("Reader and map agree.");
