# Handoff: build the four-language graph (next steps)

## Status, Nov 10 2026: steps 1–3 done, report written, waiting on Will

- Built in a cloud session, not on the Mac (kaikki is reachable there, 7 GB RAM, no 3-minute cap).
  Commands are in PARITY.md "Pipeline"; the full run is ~35 min. Nothing from vendor data is in git.
- Step 1: 67 ancestor-language dumps fetched (every language cited ≥300 times that has its own dump).
  The 9 without one are Wiktionary etymology-only varieties; their citations are resolved against the
  parent language (Anglo-Norman → Old French, Old Latin → Latin, …): 6,525 citations matched that way.
- Step 2: `scripts/build-lexeme-graph.js` + `scripts/lexeme-lib.js`. Beyond the plan:
  `{{ety}}` decides an entry's direct sources, classic templates only add deeper steps; the
  extractor records how prose joins templates (`+` part, `&` "or/and", `.` new sentence), so
  alternatives aren't read as a chain; junk citations (`+`, `ine-pro:`) are dropped (they had become
  hubs tying unrelated families together); several descendants routing different chains through one
  entry-less form keep the majority source; prose parser + etym-derive.js as fallback; English
  inflected/alternative spellings (greatest, christian) fold under their lemma.
- Step 3: layout fed unchanged except: reads `g/` from the new builder, writes `size4.bin`,
  `fold.bin`, `edgekind.bin`, `g/keys.json`; and a bug fix in its cycle breaker (it orphaned every
  node whose line ran *into* a loop, e.g. *dress*, *christian*; now only an edge on the loop is cut).
  `V` bumped to 8. The current app renders it (screenshot checked, no console errors), `npm test` passes.
- Full numbers: `review/parity-graph-report.txt` (regenerate with `scripts/report-lexeme-graph.js`).

Open for Will (not decided in PARITY.md):
1. (Nov 10, Will: import them.) 239,467 English dictionary words with an etymology got entry pages
   (`import-kaikki.js --words`, list = single words, not names/phrases, not Internet/neologism/
   nonce/slang-only; vulgar, archaic, obsolete, rare and dialect words included). `words/` now
   462,047 entries; map 976k points, 776k drawn. Vulgar no longer hidden. Slang-only words
   stay out (Will: "definitely cut the slang"). Was: English points = the ~240k words that have a page in `words/` (+10k other English entries kept
   because something descends from them). 671k other English dictionary entries are left off the map.
2. (Accepted by Will, Nov 10.) Depth target missed: 94.8% of the 8,511 starting words reach an ancestor at least as old as before
   (target 97%). The ~440 that don't: names whose dictionary page has no etymology (charleston,
   helen); app headwords that are a different word from the old guess (`words/` *june* is the slang
   verb "to rush"); old links that were wrong (dollar ← Biblical Hebrew, zero ← PIE); chains that stop
   where the ancestor's entry says nothing further (Latin *experientiālis* has no page).
3. (Nov 10: accent-only variants now fold — accent on a vowel marks stress; palatal ḱ/ǵ and length
   marks stay distinct.) Reconstructed spelling variants still split families (PIE *h₁en / h₁én, *ǵʰreh₁- / gʰreh₁-).
   Folding them would mean ignoring accents or palatal marks in reconstructions: a rule, not the
   dictionary. Leave, or fold a bare citation onto an entry that differs only by an accent?

Read `CLAUDE.md`, then `PARITY.md` (every decision already made with Will; do not re-ask them), then this.
Branch: `claude/parity-graph`. Do not push to the main branch until Will has seen the numbers in "Report".

## Where things are

- Will's Mac, folder `~/carta-work` (ask him to connect it and allow deletion; git needs it):
  `vendor-data/kaikki-{English,French,German,Latin}.jsonl` (dumps), `vendor-data/slim-<Lang>-<0..3>.jsonl`
  (extracted lemmas), `repo/` (a clone of this branch: `git pull` there), `dl.sh` (resumable downloader).
- The Mac shell is a small sandbox: **3 minutes per command, nothing keeps running between commands,
  4 cores, 3 GB RAM.** Every heavy step must be sliced or resumable. Run node with `--max-old-space-size=2600`.
- Token rule: data never passes through you. Scripts print counts and at most ten sample lines.
  Never `cat`/`head` a dump or a slim file into the conversation beyond a few lines.

## Slim record (what `scripts/extract-kaikki.js` wrote)

`{ w, l, p, n?, g, ipa?, q?, x?, et?, ds? }`: word (= the dictionary page title), language code, part of
speech, etymology number, first gloss, IPA, register tags, etymology prose (cut at 400 chars), relation
templates in page order, and the entry's Descendants tree flattened as `[depth, langCode, word, borrowed?]`.

Relation templates, as observed in the data:

- Classic: `{n:"inh"|"bor"|"der"|"lbor"|…, a:[lang, sourceLang, term, display?, gloss?]}`.
  **`a[2]` is the page title of the source word; `a[3]` is only how it is displayed**
  (French *chanter*: `a[2]="canto"`, `a[3]="cantāre"`). Identity comes from `a[2]`, the label from `a[3]`.
- Parts: `{n:"af"|"compound"|"com"|"suffix"|"prefix"|"surf"|…, a:[lang, part1, part2, …]}`. Parts are in
  the same language unless written `xx:term`.
- New chain template: `{n:"ety"|"etymon", a:[lang, ":inh", "frm:cousin", …], id?, tree?}`. Keywords start
  with `:` (`:inh :bor :der :af …`) and govern the terms after them. A term is `lang:word<mod><mod>`;
  mods nest (`gmh:schade<ety:inh<goh:skado>>`, `<t:gloss>`, `<id:…>`). After `:af`, terms have no language
  prefix. **Parse with a bracket-depth scanner. A regex will silently mangle the nested ones.**
- An entry often carries both `ety` and the classic templates for the same facts. Deduplicate edges.

## Step 1: ancestor languages (answering Will: yes, add PIE, and not only PIE)

The four dumps cite ancestors that are not in them. Fetch each cited language's own dump so its entries
(gloss, onward history, Descendants tree) become real points. No reader for these.

1. Count cited source languages across the slim files (`a[1]` of classic templates, prefixes in `ety` terms).
2. Download and extract every language above ~300 citations. Expect: Proto-Indo-European, Proto-Germanic,
   Proto-West Germanic, Proto-Italic, Old French, Middle French, Anglo-Norman, Old English, Middle English,
   Old High German, Middle High German, Ancient Greek, Old Norse, Middle Dutch, Italian, Spanish.
3. `dl.sh` strips spaces from the file name only. For hyphenated names check the real URL with
   `curl -sI` before trusting it (kaikki's page for the language shows the link).

Why PIE matters most: its entries hold the Descendants trees (the top-down view that joins words whose own
entries stop early), the canonical spelling of each root (fixes the duplicate-root problem), and the root
glosses that Stage 4 will use to place families by meaning.

## Step 2: `scripts/build-lexeme-graph.js`

**Node** = one (language, page title, etymology number). Entries that differ only in part of speech merge.

**Resolving a citation to a node. This is where the old version broke; do it in this order:**

1. Exact match of `a[2]` against that language's page titles.
2. If none, apply **that language's own** title rule, then match: Latin and Old English drop macrons,
   breves and dots; Ancient Greek drops macrons and breves but keeps accents; reconstructed languages drop a
   leading `*` and the stray `root ` prefix. **Never strip diacritics across the board:** French *pêche*
   and *péché*, German *schon* and *schön* are different words.
3. If still none, create a bare node (cited form, no entry).
4. Several entries share the title (homographs): pick by `id` if the template gives one; else pick the entry
   whose Descendants tree contains the citing word; else the entry with matching part of speech; else attach
   to the first and count it as ambiguous. Report the ambiguous count; do not guess silently.
5. Fold period labels that name the same written form onto one node (Latin / Late Latin / Medieval Latin…):
   port `LANG_ID` and `FAMILY` from `scripts/build-etym-graph.js`.

**Edges.** Read `scripts/import-kaikki-etym.js` first: it already turns a template sequence plus the prose
connectors into a chain (`+` component, `&` parallel source). Port that logic; do not reinvent it. If it needs
fields the slim records lack (template expansions, full prose), add them to `extract-kaikki.js` and re-run
the extraction; it takes about a minute per language.

- A classic sequence "from A, from B, from C" means word→A, A→B, B→C, **not** word→each.
- **An ancestor's own entry outranks a chain inferred from a descendant's entry.** If A has its own entry
  with its own history, use that and drop the inferred A→B.
- Descendants trees add edges the bottom-up pass missed; mark them `desc`. If they disagree with the
  child's own etymology, the child's entry wins.
- Keep every parent. Keep the two rules from `build-graph-layout.js`: drop links that run backwards in time,
  and affixes head their own family.
- Mark each edge inherited, borrowed, derived, calque or part.

**Per node, also compute:**

- `fold`: true when every parent is in the same language (a derivative or compound). Record the non-affix
  parents it folds under (both, for a compound).
- `size4`: words beneath it in each of the four languages, counted over the primary-parent tree (exact and
  cheap; exact counting over all parents is not worth the cost).
- `drawn`: false for words with no relations at all, and for the quiet layer (`q` tags, same rule as now).

## Step 3: layout, unchanged algorithm

Feed the new graph to the existing `scripts/build-graph-layout.js` with the smallest change that works, so
the current app renders it before any UI work. Keep the served files it already writes, and add
`size4.bin`, `fold.bin`, `edgekind.bin`. English labels must still equal the `words/` shard keys so tapping a
point opens its entry. Do not open or rewrite the shards (iron rule 1).

## Report to Will, then stop (done Nov 10: see top of file and review/parity-graph-report.txt)

Before touching the renderer, give him these, in plain words:

- Points and drawn points per language, old map against new.
- Citations: matched exactly / matched by a language rule / bare / ambiguous.
- Of the 8,511 starting words in the old `graph/info.json`, how many trace at least as deep as before. If
  under 97%, say why and list twenty that got worse.
- These must be true; say so or say which fail:
  `*h₃reǵ-` and `*steh₂-` are one family each · *sister*, *Schwester*, *sœur*, *soror* share a root ·
  *heart*, *Herz*, *cor*, *cœur* share a root · French *cousin* reaches *\*swésōr* through *cōnsobrīnus* ·
  German *Cousine* is borrowed from French *cousine* · *Schadenfreude* has two parents ·
  French *chanter* resolves to one Latin verb · English *schadenfreude* is borrowed from German.
- The twenty largest pairs of families that still look like duplicates.
- IPA coverage for the 25,000 most common English words (`review/ranks.tsv`).

## After that (Stage 1 UI, Priestley only)

Marks per language, the four switches, waypoints, folded derivatives opening on tap, dashed borrowing lines,
donor language in the callout, pronunciation line. Spec: the mockups linked in `PARITY.md`.
Pronunciation is a fixed IPA-to-respelling table per language plus one hand-written hint per foreign sound;
show Will the French table for approval before applying it to every word.

## Habits to hold

- Never report a step as done without the numbers that show it.
- One source only. If the dictionary lacks something, say so; do not fill it from another dataset or write it.
- No generated text in the app. Embeddings are approved for positions only.
- Ask Will only for decisions that are not in `PARITY.md`. Check in at the report above, not before.
