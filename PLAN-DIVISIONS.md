# Carta — four divisions (plan, Nov 2026, not built)

Scope: Priestley look only; the other four looks come later. Rule: nothing does a job twice; fewest buttons that still reach everything in ≤2 taps.

## Structure
- **The map is one thing**: the etymology map (EN/FR/DE/LA + ancestors). Not a progress record.
- **Four divisions**: Explore, Learn, Search, Saved. Each keeps its own place when you leave and reopens there (Learn starts a new excerpt if the last one was finished).
- **Swap pattern**: Learn, Search and Saved open the map the same way — the map fills the screen and the division's page shrinks to a strip at the bottom; tap the strip to bring the page back. You stay in that division throughout. Explore is the map with nothing below.

## Everywhere
- **Orb** → panel: Explore · Learn · Search · Saved. (Nothing else.)

## Explore
- Full map; pan/pinch; tap a point → callout. First run opens on the whole map.
- **Back / Forward / Step out** (own buttons, separate from orb).
- **Language line**: English · Français · Deutsch · Latina in small caps along the bottom margin (Priestley's imprint line); struck through = hidden. Hiding removes points that exist only because of that language's dump and that no visible language refers to. Nothing moves.
- **Compass rose** top-right, only when fully zoomed out → expands the map key (how to read the map).
- Quiet layer (slang/Internet/neologisms) hidden unless turned on in Settings; visited quiet words still show.

## Callout (on the map)
- **Open** → word card.
- **N doublets** (when present) → draws the fork on the map directly.

## Word card
- **Lineage**: steps tappable (open that form). Second sources written into the step ("from *break* + *fast*", *fast* tappable) — no separate "+" buttons.
- **Doublets**: tap → draws the fork on the map (replaces "Show the fork" button).
- **Examples**: excerpts containing this exact entry, chosen by your Learn level, shortest first; English cards use English dictionary quotations. Tap → queued as your next Learn excerpt (brief confirmation), same rule everywhere; **Bookmark** an example → Saved.
- **Bookmark** the word (tap again to remove).
- Definitions, pronunciation, etymology text as now.
- **Synonyms**: one line under the definition, tappable, each with the language it came from. Cut: Descent/Sense/Doublets tabs (the Sense map view).

## Learn
- **Landing page** (opening Learn fresh): one row per language — tap the row to translate, tap its due-count to quiz; level shown on the row. English opens straight to Quiz until English Translate exists.
- **Translate page**: excerpt top (dotted = new to you); your English typed directly under it (the space is the field, with a caret and a faint "Your English…" before you start; no second box); source line. Header: language name (label only), **Listen** (one button: tap to start, tap again to stop; speed in Settings), **Close** → landing.
- **Tap a word** → keyboard drops; **map inlay** opens between excerpt and your English, cropped to the word's family (its line back, English relatives, other excerpt words from the same family; rest faint). Callout on the dot carries the gloss. Inlay buttons: **I know this**, **full-screen corner** (→ swap: map fills, Learn page becomes bottom strip; still in Learn). Tap your English → keyboard back, inlay closes.
- **Check** → marks your English in place (blue carried across, red comes back later) + shows the whole-sentence translation (published one when we have it, else browser Translator). Then **Next**.
- Scheduling: tapped/missed words return in later excerpts on a spaced schedule; reading past a due word advances it; per-word ease; level adapts from check scores.
- **Quiz** (per language): FR/DE/LA = words you keep missing, shown in the sentence where you met them, pick the meaning; shares the excerpt schedule. **English Quiz** = today's vocabulary quiz (saved English words + discovery words), kept as is.
- Cut: Paste a text, author/All books filter, Whole sentence button, Aloud on/off, speed chip, Say, On the map, Your words, level bands row, language chips.
- Later: English → FR/DE/LA translation (checking runs through form tables; level judged by target language).

## Search
- Words only, all four languages, inflected forms understood (*endors* → endormir). Results list grouped by spelling. Tap → swap (map fills, results become the strip).

## The map inside Learn / Search / Saved (swap)
- Back / Forward at the bottom beside the orb; the strip sits just above them (sentence with the tapped word, plus your English). No language line. Strip says what it holds ("12 results for endors", the excerpt's first words). Tapping other points doesn't change the strip.

## Saved
- **Words**: everything you're learning plus bookmarks, "keep missing" flagged; per-row undo for "I know this"; tap the bookmark to remove and **Excerpts** (bookmarked). Tap a word → swap; tap an excerpt → Learn.
- **Settings** line at the foot → opens in place: **Look**, **Quiet layer** toggle, **Reading speed**, **Reset a language's level**, **Check for updates**.

## Removed entirely
Doublet hunt; Somewhere else; home-screen buttons (Lire/Lesen/Quiz/hunt/random); hidden saved/refresh/theme buttons; Sense lens; "Show the fork" button; reader items listed above.

## Unchanged background
Installed iOS app behaviour (--vgap, icons, build meta), no audio at load, one dictionary source, progress in localStorage per device.

## Decided against (advisor suggestions)
Settings in the orb (stays in Saved: fewer buttons); inlay in the keyboard's space (stays between excerpt and your English); whole inlay as the full-screen tap (corner button kept so the inlay can pan).
