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

## Pipeline (heavy steps run on Will's Mac, folder `~/carta-work`, via the device shell)

Limits there: 3-minute commands, nothing survives between commands, 4 cores, 3 GB. So every step is sliced.

1. `carta-work/dl.sh <Lang>…` — resumable download of per-language dumps into `carta-work/vendor-data/`
   (`kaikki-English|French|German|Latin.jsonl` are downloaded, 6.4 GB).
2. `node scripts/extract-kaikki.js <dump> <out> <k> <n>` — slim lemma records, slice k of n (4 in parallel).
   Output `vendor-data/slim-<Lang>-<k>.jsonl`.
3. TODO `scripts/build-lexeme-graph.js` — nodes/edges from slim records; then ancestor-language dumps
   (download only the languages actually cited, by count); then layout (current radial layout first).
4. Bring `graph/` back as one archive (device_stage_files), commit from the cloud clone.

Status is tracked at the bottom of this file.

## Status

- [x] dumps downloaded (en, fr, de, la)
- [x] extractor written and slice-tested
- [x] extraction run → `carta-work/vendor-data/slim-<Lang>-<0..3>.jsonl` (repo clone at `carta-work/repo`)
      lemmas / with relations / with IPA: English 962,474 / 475,442 / 128,473 · Français 103,564 / 51,040 / 78,661 ·
      Deutsch 103,021 / 70,106 / 62,605 · Latina 54,642 / 32,712 / 39,123. Latin entries with a Descendants tree: 16,710.
- [ ] graph builder
- [ ] renderer: marks, switches, waypoints, folded derivatives
