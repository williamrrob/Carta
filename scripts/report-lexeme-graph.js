#!/usr/bin/env node
/*
 * report-lexeme-graph.js — the numbers HANDOFF.md asks for before any renderer work.
 *   node scripts/report-lexeme-graph.js <old graph dir>   (new = g/ + graph/)
 * Prints plain text; writes g/report.json.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const ROOT = path.join(__dirname, "..");
const OLD = process.argv[2];
const out = {};
const say = (s) => console.log(s);

// ---- g/ (keys, up edges) -------------------------------------------------------------
const G = new Map();
for (const f of fs.readdirSync(path.join(ROOT, "g"))) {
  if (!/^[0-9a-f]{2}\.json$/.test(f)) continue;
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, "g", f), "utf8")); for (const k in j) G.set(k, j[k]);
}
const stats = JSON.parse(fs.readFileSync(path.join(ROOT, "g", "stats.json"), "utf8"));
const db = new DatabaseSync(path.join(ROOT, "rootwork.sqlite"), { readOnly: true });
const headwords = db.prepare("select word from words").all().map((r) => r.word);

// ---- 1. points per language --------------------------------------------------------------
const oldC = (() => {
  const info = JSON.parse(fs.readFileSync(path.join(OLD, "info.json"), "utf8"));
  const lang = new Uint16Array(fs.readFileSync(path.join(OLD, "lang.bin")).buffer.slice(0));
  const q = fs.readFileSync(path.join(OLD, "quiet.bin"));
  const c = {};
  for (let i = 0; i < info.n; i++) { const l = info.langs[lang[i]]; const k = { English: "en", French: "fr", German: "de", Latin: "la" }[l] || "other"; c[k] = c[k] || [0, 0]; c[k][0]++; if (!(q[i >> 3] & (1 << (i & 7)))) c[k][1]++; }
  return c;
})();
const newC = { en: [0, 0], fr: [0, 0], de: [0, 0], la: [0, 0], other: [0, 0] };
const enInG = new Set();
for (const [k, r] of G) { const c = r.lc || "other"; newC[c][0]++; if (r.dr !== 0) newC[c][1]++; if (r.hw) enInG.add(r.t); }
for (const w of headwords) if (!enInG.has(w)) newC.en[0]++;   // headwords the layout adds as unconnected (not drawn)
// the layout also hides set phrases with no descendants: read the final quiet layer for drawn counts
const info = JSON.parse(fs.readFileSync(path.join(ROOT, "graph", "info.json"), "utf8"));
const NN = info.n;
const labels = JSON.parse(fs.readFileSync(path.join(ROOT, "graph", "labels.json"), "utf8"));
const langA = new Uint16Array(fs.readFileSync(path.join(ROOT, "graph", "lang.bin")).buffer.slice(0));
const quiet = fs.readFileSync(path.join(ROOT, "graph", "quiet.bin"));
say("1. Points per language (all points / drawn)");
say("   language   old map              new map");
for (const c of ["en", "fr", "de", "la", "other"]) say(`   ${c.padEnd(9)} ${String(oldC[c] ? oldC[c][0] : 0).padStart(8)} / ${String(oldC[c] ? oldC[c][1] : 0).padEnd(8)}  ${String(newC[c][0]).padStart(8)} / ${newC[c][1]}`);
let drawnFinal = 0; for (let i = 0; i < NN; i++) if (!(quiet[i >> 3] & (1 << (i & 7)))) drawnFinal++;
say(`   (new map total ${NN} points, ${drawnFinal} drawn after the layout's phrase rule; old ${Object.values(oldC).reduce((s, x) => s + x[0], 0)})`);
say(`   English dictionary entries not on the map (no page in words/, not an ancestor): ${stats.englishEntriesDropped}; kept as ancestors: ${stats.englishEntriesKeptAsAncestors}`);
say(`   per-language detail: ${JSON.stringify(stats.per)}`);
out.points = { old: oldC, new: newC, drawnFinal };

// ---- 2. citations -------------------------------------------------------------------------
const R = stats.resolution;
say(`\n2. Citations: exact ${R.exact} · by a language rule ${R.rule} · bare ${R.bare} · ambiguous ${R.ambiguous} (affixes ${R.ambiguousAffix}, words ${R.ambiguousWord})`);
say(`   homographs ${R.homographs}: by id ${R.byId}, by Descendants list ${R.byDesc}, by gloss ${R.byGloss}, affix by what it forms ${R.byAffixGloss}, by part of speech ${R.byPos}; Descendants-tree items ambiguous ${R.descAmbiguous}`);
out.citations = R;

// ---- 3. starting words: as deep as before? ------------------------------------------------
function load(dir) {
  const inf = JSON.parse(fs.readFileSync(path.join(dir, "info.json"), "utf8"));
  const lab = JSON.parse(fs.readFileSync(path.join(dir, "labels.json"), "utf8"));
  const lg = new Uint16Array(fs.readFileSync(path.join(dir, "lang.bin")).buffer.slice(0));
  const tr = new Int32Array(fs.readFileSync(path.join(dir, "tree.bin")).buffer.slice(0));
  const ln = new Int32Array(fs.readFileSync(path.join(dir, "links.bin")).buffer.slice(0));
  const up = Array.from({ length: inf.n }, () => []);
  for (let i = 0; i < inf.n; i++) if (tr[i] >= 0) up[i].push(tr[i]);
  for (let i = 0; i < ln.length; i += 2) up[ln[i]].push(ln[i + 1]);
  const year = (i) => inf.eras[lg[i]];
  const chain = (i) => { let d = 0, x = tr[i]; while (x >= 0 && d < 40) { d++; x = tr[x]; } return d; };
  const oldest = (i) => { let best = year(i), bl = inf.langs[lg[i]]; const seen = new Set([i]); const q = [i]; while (q.length) { const y = q.pop(); for (const p of up[y]) if (!seen.has(p)) { seen.add(p); q.push(p); if (year(p) < best) { best = year(p); bl = inf.langs[lg[p]]; } } } return [best, bl]; };
  return { inf, lab, lg, tr, up, chain, oldest };
}
const O = load(OLD), Nw = load(path.join(ROOT, "graph"));
const newByWord = new Map();
for (let i = 0; i < Nw.inf.n; i++) if (Nw.lg[i] === 0) { const w = Nw.lab[i]; let a = newByWord.get(w); if (!a) newByWord.set(w, (a = [])); a.push(i); }
let same = 0, worse = [], missing = 0, chainSame = 0;
for (const i of O.inf.starts) {
  const w = O.lab[i];
  const [oy, ol] = O.oldest(i), oc = O.chain(i);
  const c = newByWord.get(w);
  if (!c) { missing++; worse.push([w, `${ol} (${oy})`, "not on the new map", oc, 0]); continue; }
  let by = Infinity, bl = "", bc = 0;
  for (const j of c) { const [y, l] = Nw.oldest(j); if (y < by) { by = y; bl = l; } bc = Math.max(bc, Nw.chain(j)); }
  if (bc >= oc) chainSame++;
  if (by <= oy) same++; else worse.push([w, `${ol} (${oy})`, `${bl} (${by})`, oc, bc]);
}
const tot = O.inf.starts.length;
say(`\n3. Of the ${tot} starting words, ${same} (${(100 * same / tot).toFixed(1)}%) reach an ancestor at least as old as before;`);
say(`   ${chainSame} (${(100 * chainSame / tot).toFixed(1)}%) have a primary line at least as many steps long. ${missing} are missing from the new map.`);
worse.sort((a, b) => (b[3] - b[4]) - (a[3] - a[4]));
out.depth = { total: tot, asOld: same, chainAsLong: chainSame, missing, worse: worse.slice(0, 200) };
if (same / tot < 0.97) { say("   Twenty that got worse (word: old oldest ancestor → new oldest; old/new primary steps):"); for (const x of worse.slice(0, 20)) say(`     ${x[0]}: ${x[1]} → ${x[2]}; ${x[3]}/${x[4]}`); }

// ---- 4. checks -------------------------------------------------------------------------------
const nf = (s) => String(s).normalize("NFC");
// a word by language and title or displayed form (Latin rēx is page "rex")
const plain = (t) => nf(t).normalize("NFD").replace(/[\u0304\u0306]/g, "").normalize("NFC");
const findKeys = (lang, title) => [...G.keys()].filter((k) => { const b = k.indexOf("|"); if (k.slice(0, b) !== lang) return false; const t = nf(k.slice(b + 1)).replace(/#.*$/, "").replace(/'+$/, ""); return t === nf(title) || plain(t) === plain(title) || nf(G.get(k).t) === nf(title); });
const ups = (k) => (G.get(k) && G.get(k).up) || [];
const anc = (k) => { const seen = new Map([[k, 0]]); const q = [k]; while (q.length) { const y = q.shift(); for (const u of ups(y)) if (!seen.has(u[0])) { seen.set(u[0], seen.get(y) + 1); q.push(u[0]); } } return seen; };
const ancAll = (keys) => { const m = new Map(); for (const k of keys) for (const [a, d] of anc(k)) if (!m.has(a) || m.get(a) > d) m.set(a, d); return m; };
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok, detail }); say(`   ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };
say("\n4. Checks");
// one family each: a single PIE point, and the words descending from it sit in one tree
const treeOfLabel = (lang, w) => { const res = []; for (let i = 0; i < Nw.inf.n; i++) if (Nw.inf.langs[Nw.lg[i]] === lang && Nw.lab[i] === w) { let x = i; while (Nw.tr[x] >= 0) x = Nw.tr[x]; res.push(x); } return res; };
for (const [root, members] of [["h₃reǵ-", [["Latin", "rēx"], ["Latin", "regō"], ["English", "right"], ["German", "recht"], ["English", "regal"]]], ["steh₂-", [["Latin", "stō"], ["English", "stand"], ["German", "stehen"], ["French", "ester"], ["English", "state"]]]]) {
  const pts = [...G.keys()].filter((k) => k.startsWith("Proto-Indo-European|") && nf(k.slice(20)).replace(/^\*/, "").replace(/#.*|'+$/g, "") === nf(root));
  const reach = members.map(([l, w]) => { const ks = findKeys(l, w); const a = ancAll(ks); return [l + " " + w, ks.length ? pts.some((p) => a.has(p)) : null]; });
  const ok = pts.length === 1 && reach.every((r) => r[1]);
  check(`*${root} is one family`, ok, `${pts.length} PIE point(s) [${pts.join(", ")}]; descend from it: ${reach.map((r) => r[0] + (r[1] ? " ✓" : r[1] === null ? " (no point)" : " ✗")).join(", ")}`);
}
const shareRoot = (name, set) => {
  const A = set.map(([l, w]) => ancAll(findKeys(l, w)));
  const common = [...A[0].keys()].filter((k) => A.every((a) => a.has(k)));
  const pie = common.filter((k) => k.startsWith("Proto-Indo-European|"));
  const best = common.sort((a, b) => A.reduce((s, m) => s + m.get(a), 0) - A.reduce((s, m) => s + m.get(b), 0))[0];
  check(name, !!best, best ? `nearest shared ancestor ${best}${pie.length ? "; PIE: " + pie.join(", ") : ""}` : "no shared ancestor");
};
shareRoot("sister, Schwester, sœur, soror share a root", [["English", "sister"], ["German", "Schwester"], ["French", "sœur"], ["Latin", "soror"]]);
shareRoot("heart, Herz, cor, cœur share a root", [["English", "heart"], ["German", "Herz"], ["Latin", "cor"], ["French", "cœur"]]);
{
  // path French cousin → … → *swésōr passing cōnsobrīnus
  const start = findKeys("French", "cousin"), cons = findKeys("Latin", "consobrinus"), sw = [...G.keys()].filter((k) => /^Proto-Indo-European\|\*?swésōr/.test(nf(k)));
  const a = ancAll(start), viaCons = cons.some((c) => a.has(c)), b = ancAll(cons);
  const ok = viaCons && sw.some((s) => b.has(s));
  // the path itself
  let pathS = "";
  for (const st of start) {
    const prev = new Map([[st, null]]); const q = [st]; let hit = null;
    while (q.length && !hit) { const y = q.shift(); for (const u of ups(y)) if (!prev.has(u[0])) { prev.set(u[0], y); if (sw.includes(u[0])) { hit = u[0]; break; } q.push(u[0]); } }
    if (hit) { const p = []; for (let x = hit; x; x = prev.get(x)) p.unshift(G.get(x).t + " (" + x.split("|")[0] + ")"); pathS = p.join(" → "); break; }
  }
  check("French cousin reaches *swésōr through cōnsobrīnus", ok, `cousin→cōnsobrīnus ${viaCons ? "yes" : "no"}; cōnsobrīnus→*swésōr ${sw.some((s) => b.has(s)) ? "yes" : "no"}; shortest path: ${pathS || "none"}`);
}
{
  const ks = findKeys("German", "Cousine"); const u = ks.flatMap((k) => ups(k)); const hit = u.find((x) => /^French\|cousine/.test(x[0]));
  check("German Cousine is borrowed from French cousine", !!hit && /bor/.test(hit[1]), `parents: ${u.map((x) => x[0] + " (" + x[1] + ")").join(", ") || "none"}`);
}
{
  const ks = findKeys("German", "Schadenfreude"); const u = ks.flatMap((k) => ups(k));
  check("German Schadenfreude has two parents", u.length >= 2, u.map((x) => x[0] + " (" + x[1] + ")").join(", "));
}
{
  const ks = findKeys("French", "chanter"); const a = ancAll(ks); const lat = new Set([...a.keys()].filter((k) => k.startsWith("Latin|") && !/^Latin\|-/.test(k)));
  // the Latin verbs it resolves to directly or through Old French
  const near = [...lat].filter((k) => /^Latin\|cant|^Latin\|can/.test(k));
  check("French chanter resolves to one Latin verb", near.filter((k) => /^Latin\|canto/.test(k)).length === 1, `Latin ancestors: ${[...lat].map((k) => k + " " + (G.get(k).t || "")).join(", ")}`);
}
{
  const ks = findKeys("English", "schadenfreude"); const u = ks.flatMap((k) => ups(k)); const hit = u.find((x) => /^German\|Schadenfreude/.test(x[0]));
  check("English schadenfreude is borrowed from German", !!hit && /bor/.test(hit[1]), u.map((x) => x[0] + " (" + x[1] + ")").join(", ") || "no parents");
}
out.checks = checks;

// ---- 5. duplicate-looking families ------------------------------------------------------------
{
  // a pair "looks like a duplicate" when two family heads in one language have the same form once
  // marks and the leading * are ignored, and at least one of them is a bare citation (no entry):
  // two entries with the same form are the dictionary's own homographs (PIE *dʰeh₁- "suckle" / "put")
  const keys = JSON.parse(fs.readFileSync(path.join(ROOT, "g", "keys.json"), "utf8"));
  const n = Nw.inf.n, size = new Uint32Array(n), root = new Int32Array(n);
  for (let i = 0; i < n; i++) { let x = i, d = 0; while (Nw.tr[x] >= 0 && d < 60) { x = Nw.tr[x]; d++; } root[i] = x; size[x]++; }
  const norm = (s) => String(s).normalize("NFD").replace(/\p{M}/gu, "").replace(/^\*/, "").normalize("NFC");
  const groups = new Map(); let homo = 0;
  for (let i = 0; i < n; i++) if (root[i] === i && size[i] >= 3) { const k = Nw.inf.langs[Nw.lg[i]] + "|" + norm(Nw.lab[i]); let a = groups.get(k); if (!a) groups.set(k, (a = [])); a.push(i); }
  const pairs = [];
  for (const [k, a] of groups) {
    if (a.length < 2) continue;
    const bareOnes = a.filter((i) => !(G.get(keys[i]) || {}).e);
    if (!bareOnes.length) { homo++; continue; }
    a.sort((x, y) => size[y] - size[x]);
    pairs.push([size[a[0]] + size[a[1]], a.map((i) => `${Nw.lab[i]}${(G.get(keys[i]) || {}).e ? "" : " [bare]"} (${size[i]})`).join(" · "), k.split("|")[0]]);
  }
  pairs.sort((a, b) => b[0] - a[0]);
  say(`\n5. Families that still look like duplicates (same language and form once marks and * are ignored, one of them a bare citation): ${pairs.length} groups (plus ${homo} groups of the dictionary's own homographs). Largest twenty, with family sizes:`);
  for (const p of pairs.slice(0, 20)) say(`   ${p[2]}: ${p[1]}`);
  out.duplicates = pairs.slice(0, 50);
}

// ---- 6. IPA coverage --------------------------------------------------------------------------
{
  const top = fs.readFileSync(path.join(ROOT, "review", "ranks.tsv"), "utf8").split("\n").slice(1).filter(Boolean).map((l) => l.slice(0, l.lastIndexOf("\t"))).slice(0, 25000);
  const ipa = new Set(), have = new Set();
  for (const [k, r] of G) if (r.lc === "en") { have.add(r.t); if (r.ipa) ipa.add(r.t); }
  const withIpa = top.filter((w) => ipa.has(w)).length, onMap = top.filter((w) => have.has(w)).length;
  const missing = top.filter((w) => have.has(w) && !ipa.has(w));
  say(`\n6. IPA for the 25,000 most common English words: ${withIpa} (${(100 * withIpa / top.length).toFixed(1)}%); ${onMap} of them are dictionary points; ${missing.length} points lack IPA, e.g. ${missing.slice(0, 12).join(", ")}`);
  out.ipa = { top: top.length, withIpa, onMap, missingSample: missing.slice(0, 100) };
}
fs.writeFileSync(path.join(ROOT, "g", "report.json"), JSON.stringify(out, null, 1));
