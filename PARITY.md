# Parity rebuild — working notes (Nov 2026)

Goal: English, French, German and Latin on equal footing in ONE graph, built by one pass.
Decisions made with Will (don't re-ask):

- **Graph**: a point = a word in a language. All parents kept (compounds get both). Built from the
  dictionary's structured etymology (`etymology_templates`, incl. the newer `ety`/`etymon` chains, and
  `descendants` trees); prose parser is fallback only.
- **Map**: one master map. Four language switches (any combination) hide/show; nothing moves.
  A hidden language's words stay as faint waypoints when a shown word descends from them.
  Dot size = words beneath it in the shown languages.
- **Marks, not colours, per language** (Priestley is one ink): filled circle English, open circle
  Français, square Deutsch, triangle Latina. Washes = branch (Germanic, Romance…). Borrowing = dashed line.
- **Language names in their own language**: English, Français, Deutsch, Latina.
- **Derivatives** (sisterly, sisterhood) fold under their base word; they appear when the base is tapped.
  Search still reaches them.
- **Unconnected words** (the old outer ring, ~135k English) are not drawn; searchable, shown when visited.
- **Callout** names the donor language for a borrowing ("borrowed from French · 17th c.").
- **Pronunciation**: plain English respelling under the word, stress in capitals; a foreign sound gets its
  nearest English spelling plus a fixed plain-English hint (one hint per sound per language, a hand-written
  table). Made mechanically from the dictionary's IPA. No per-word generated text. IPA only in the full entry.
- **Organisation**: map switches at top; Practice opens in the sheet over the map with its own
  single-language picker (reader for Français/Deutsch/Latina, root-naming for English). Map behind the
  sheet follows the tapped word. One "due" count across languages on the orb.
- **Latin**: classical base, later Latin (Vulgate → Spinoza) as an opt-in tier; classical pronunciation.
- **Looks**: work in Priestley only for now; bring the other four back afterwards.
- Layout later: fixed branch order for angle, meaning (root-gloss embedding, positions only) between
  families, time slice. Embeddings for positioning are approved; no generated text.
- Nothing saved on the live site needs preserving.

Mockups: https://claude.ai/artifact/9CbHAm3Yg7L96j6FR6X8Y8

## Pipeline

Ran in a cloud Claude session (Nov 10 2026): it reaches kaikki.org directly, has 7 GB RAM and no 3-minute
command cap, so the whole build takes ~35 min there. The Mac folder `~/carta-work` still works for the
same commands (slice them). Raw dumps and slim files are not kept in the repo; everything regenerates.

1. Download `kaikki.org/dictionary/<Lang>/` dumps. The file name drops spaces AND hyphens
   (`ProtoIndoEuropean.jsonl`): read the link off the language's `index.html` rather than guessing.
2. `[FORMS=1] node scripts/extract-kaikki.js <dump> <out> <k> <n>` → slim lemma records, slice k of n, plus
   `<out>.langs.json` (code → name votes). FORMS=1 (English only) also keeps inflected forms as `{w,fo}`.
   Records now carry the connector before each classic template (`j`: `+` part, `&` alternative, `.` new
   sentence), affix-template ids/glosses as `<id:…>`/`<t:…>` on the part, `h` (Latin cantō for page canto), `id`.
3. `node scripts/count-cited-langs.js <slim dir>` → which ancestor languages to fetch (≥300 citations).
   67 fetched; 9 have no dump of their own (Anglo-Norman, Old Northern French, Old Latin, Frankish,
   Middle Low German, Classical Persian, Biblical Hebrew, Medieval Greek, Gaulish): etymology-only
   varieties, resolved against their parent language's titles where that has the word.
4. `node --max-old-space-size=6000 scripts/build-lexeme-graph.js <slim dir>` → `g/` (~90 s). Template
   parsing lives in `scripts/lexeme-lib.js` (bracket-depth scanner for `{{ety}}`).
5. `node --max-old-space-size=6000 scripts/build-graph-layout.js` → `graph/` (~13 min), then bump `V` in graph.js.
6. `node scripts/report-lexeme-graph.js <old graph dir>` → the numbers and checks for Will.

Status is tracked at the bottom of this file.

## Status

- [x] dumps downloaded (en, fr, de, la)
- [x] extractor written and slice-tested
- [x] extraction run (lemmas / with relations / with IPA: English 962,474 / 475,442 / 128,473 · Français
      103,564 / 51,040 / 78,661 · Deutsch 103,021 / 70,106 / 62,605 · Latina 54,642 / 32,712 / 39,123)
- [x] ancestor languages: 67 dumps fetched and extracted
- [x] graph builder (`build-lexeme-graph.js`) and layout fed from it (`size4.bin`, `fold.bin`, `edgekind.bin`)
- [ ] Will has seen the report (HANDOFF.md) → then renderer: marks, switches, waypoints, folded derivatives
