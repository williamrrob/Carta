#!/usr/bin/env python3
"""
build-reader.py — the French / German reader's data, all from Wiktionary.

Inputs (vendor-data/, gitignored):
  kaikki-French.jsonl.gz, kaikki-German.jsonl.gz   English-Wiktionary entries for FR/DE words
                                                   (English glosses, forms, etymology, a few
                                                   translated quotations)
  frwikt-Francais.jsonl.gz, dewikt-Deutsch.jsonl.gz French/German-Wiktionary editions
                                                   (hundreds of thousands of attributed quotations)
  kaikki-etym.jsonl, kaikki-etym-<fr|de>.jsonl      etymology chains (scripts/import-kaikki-etym.js)

Output (served): reader/<fr|de>/
  lex.json      lemma table: [[lemma, gloss, pos, zipf*10, cognate|"", transparent 0/1, mapKey|""], …]
  forms/<k>.json  surface form (lowercase) → lemma id, sharded by first letter (for pasted text)
  q/<band>.json  quotations by difficulty band: {t, r (ref), a (author), y, en?, w:[[start, end, lemmaId]…]}
  index.json    counts, bands, authors

  python3 scripts/build-reader.py [fr|de|all]
"""
import gzip, json, os, re, sys, unicodedata, collections, math
from wordfreq import zipf_frequency

ROOT = os.path.join(os.path.dirname(__file__), "..")
V = os.path.join(ROOT, "vendor-data")
LANGS = {"fr": ("French", "frwikt-Francais.jsonl.gz"), "de": ("German", "dewikt-Deutsch.jsonl.gz")}

def fold(s):
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn").replace("ß", "ss").replace("œ", "oe").replace("æ", "ae")

def sim(a, b):
    a, b = fold(a), fold(b)
    if not a or not b: return 0
    # normalized longest-common-prefix-weighted edit similarity
    n, m = len(a), len(b)
    d = list(range(m + 1))
    for i in range(1, n + 1):
        p, d[0] = d[0], i
        for j in range(1, m + 1):
            p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] != b[j - 1]))
    return 1 - d[m] / max(n, m)

def jsonl_gz(p):
    with gzip.open(p, "rt", encoding="utf-8") as f:
        for line in f:
            try: yield json.loads(line)
            except Exception: pass

# ---- canon: authors whose quotations are worth meeting (classics, literature, philosophy, history,
# art history). Full names as the editions cite them; matched only at the start of a reference.
CANON = {
 "fr": """Michel de Montaigne; Blaise Pascal; René Descartes; Voltaire; Jean-Jacques Rousseau; Denis Diderot;
 Montesquieu; La Rochefoucauld; Jean de La Bruyère; Victor Hugo; Honoré de Balzac; Gustave Flaubert; Stendhal;
 Émile Zola; Guy de Maupassant; Charles Baudelaire; Marcel Proust; Albert Camus; Jean-Paul Sartre;
 Simone de Beauvoir; André Gide; Marguerite Yourcenar; Colette; Marguerite Duras; Michel Houellebecq;
 Louis-Ferdinand Céline; André Malraux; Jules Michelet; Alexis de Tocqueville; Henri Bergson; Jacques Derrida;
 Michel Foucault; Roland Barthes; Jacques Lacan; Gilles Deleuze; Georges Bataille; Maurice Blanchot; Paul Valéry;
 Guillaume Apollinaire; Arthur Rimbaud; Paul Verlaine; Stéphane Mallarmé; Jean Racine; Molière; Pierre Corneille;
 Jean de La Fontaine; Chateaubriand; Alexandre Dumas; Jules Verne; George Sand; Théophile Gautier;
 Joris-Karl Huysmans; Anatole France; François Mauriac; Jean Giono; Georges Simenon; Georges Perec;
 Raymond Queneau; Patrick Modiano; Annie Ernaux; Le Clézio; Claude Lévi-Strauss; Pierre Bourdieu;
 Gaston Bachelard; Maurice Merleau-Ponty; Simone Weil; Antoine de Saint-Exupéry; Jean Cocteau; André Breton;
 Louis Aragon; Paul Éluard; Jacques Prévert; Henri Michaux; Eugène Ionesco; Samuel Beckett; Jean Genet;
 Boris Vian; Françoise Sagan; Marcel Pagnol; Charles Péguy; Paul Claudel; Ernest Renan; Hippolyte Taine;
 Sainte-Beuve; Choderlos de Laclos; Marivaux; François Rabelais; Pierre de Ronsard; François Villon;
 Alfred de Musset; Alfred de Vigny; Alphonse de Lamartine; Gérard de Nerval; Prosper Mérimée; Alphonse Daudet;
 Pierre Loti; Octave Mirbeau; Jules Renard; Alain-Fournier; Georges Bernanos; Jean Giraudoux; Romain Rolland;
 Nathalie Sarraute; Alain Robbe-Grillet; Claude Simon; Fénelon; Bossuet; Madame de Staël; Benjamin Constant;
 Joseph de Maistre; Fustel de Coulanges; Élie Faure; Henri Focillon; Condorcet; Buffon; Fontenelle;
 Antonin Artaud; Tristan Tzara; Émile Durkheim; Marcel Mauss; Fernand Braudel; Marc Bloch; Lucien Febvre;
 Paul Ricœur; Emmanuel Levinas; Jean Baudrillard; Guy Debord; Julia Kristeva; Hélène Cixous; Maurice Barrès;
 Anatole France; Jean Jaurès; Romain Gary; Albert Cohen; Marcel Aymé; Jean Giono; Henry de Montherlant;
 Pierre Drieu la Rochelle; Julien Gracq; Yves Bonnefoy; René Char; Saint-John Perse; Francis Ponge""",
 "de": """Johann Wolfgang von Goethe; Goethe; Friedrich Schiller; Schiller; Immanuel Kant; Georg Wilhelm Friedrich Hegel;
 Hegel; Friedrich Nietzsche; Karl Marx; Friedrich Engels; Sigmund Freud; Franz Kafka; Rainer Maria Rilke;
 Thomas Mann; Heinrich Mann; Hermann Hesse; Heinrich Heine; Georg Büchner; Theodor Fontane; Heinrich von Kleist;
 Friedrich Hölderlin; Novalis; Gotthold Ephraim Lessing; Arthur Schopenhauer; Martin Heidegger; Walter Benjamin;
 Theodor W. Adorno; Hannah Arendt; Bertolt Brecht; Robert Musil; Stefan Zweig; Joseph Roth; Günter Grass;
 Heinrich Böll; Ingeborg Bachmann; Paul Celan; W. G. Sebald; Peter Handke; Elfriede Jelinek; Thomas Bernhard;
 Max Frisch; Friedrich Dürrenmatt; Ludwig Wittgenstein; Martin Luther; Jacob Grimm; Wilhelm Grimm;
 Brüder Grimm; Theodor Storm; Gottfried Keller; Adalbert Stifter; Wilhelm Raabe; E. T. A. Hoffmann;
 Joseph von Eichendorff; Georg Christoph Lichtenberg; Johann Gottfried Herder; Wilhelm von Humboldt;
 Alexander von Humboldt; Gerhart Hauptmann; Alfred Döblin; Kurt Tucholsky; Erich Kästner; Erich Maria Remarque;
 Hans Fallada; Arthur Schnitzler; Hugo von Hofmannsthal; Georg Trakl; Gottfried Benn; Karl Kraus;
 Leopold von Ranke; Theodor Mommsen; Jacob Burckhardt; Johann Joachim Winckelmann; Georg Simmel; Max Weber;
 Edmund Husserl; Johann Gottlieb Fichte; Friedrich Wilhelm Joseph Schelling; Gottfried Wilhelm Leibniz;
 Ludwig Feuerbach; Jean Paul; Franz Grillparzer; Jeremias Gotthelf; Christoph Martin Wieland;
 Friedrich Gottlieb Klopstock; Christian Dietrich Grabbe; Friedrich Hebbel; Eduard Mörike;
 Annette von Droste-Hülshoff; Lou Andreas-Salomé; Rosa Luxemburg; Christa Wolf; Uwe Johnson; Peter Weiss;
 Ernst Jünger; Elias Canetti; Hermann Broch; Robert Walser; Ödön von Horváth; Ernst Bloch; Siegfried Kracauer;
 Aby Warburg; Erwin Panofsky; Friedrich Meinecke; Wilhelm Busch; Christian Morgenstern; Else Lasker-Schüler;
 Lion Feuchtwanger; Anna Seghers; Klaus Mann; Erich Fromm; Karl Jaspers; Max Scheler; Ernst Cassirer""",
}
def canon_re(lc):
    names = sorted({n.strip() for n in CANON[lc].replace("\n", " ").split(";") if n.strip()}, key=len, reverse=True)
    return re.compile(r"^\W*(?:\d{4},?\s*)?(" + "|".join(re.escape(n) for n in names) + r")\b")

PRESS = re.compile(r"journal|magazine|AFP|Reuters|Wikipedia|Le Monde|Libération|Le Devoir|Le Figaro|Ouest|"
                   r"Télégramme|Die Zeit|Spiegel|Süddeutsche|FAZ|taz|Welt|Tagesschau|Wortschatz|20 minutes|Mediapart|"
                   r"Huffington|Le Point|L’Express|Le Parisien|Courrier|Stern|Focus|Bild|ZEIT", re.I)

WORD = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿŒœÆæß]+(?:[-’'][A-Za-zÀ-ÖØ-öø-ÿŒœÆæß]+)*")
ELIDE = re.compile(r"^(l|d|j|m|n|s|t|c|qu|jusqu|lorsqu|puisqu|quoiqu)[’']", re.I)

def tokens(text, lc):
    for m in WORD.finditer(text):
        s, e, w = m.start(), m.end(), m.group(0)
        if lc == "fr":
            mm = ELIDE.match(w)
            if mm and len(w) > mm.end():
                yield s, s + mm.end(), mm.group(1).lower() + ("e" if mm.group(1).lower() in "ldjmnstc" else "e")
                s = s + mm.end(); w = w[mm.end():]
        yield s, e, w

def year_of(ref):
    ys = [int(y) for y in re.findall(r"\b(1[0-9]{3}|20[0-2][0-9])\b", ref or "")]
    return min(ys) if ys else None

def build(lc):
    LN, edition = LANGS[lc]
    print(f"== {LN}", flush=True)
    # ---- lexicon from English Wiktionary
    lem = {}            # lemma -> {g, p}
    forms = {}          # folded-lower form -> lemma
    tquotes = []        # English-Wiktionary quotations with translations
    for d in jsonl_gz(os.path.join(V, f"kaikki-{LN}.jsonl.gz")):
        w, pos = d.get("word"), d.get("pos")
        if not w or pos in ("name", "character", "symbol", "suffix", "prefix", "infix", "phrase", "proverb"): continue
        real = [s for s in d.get("senses", []) if not s.get("form_of") and "form-of" not in s.get("tags", [])]
        for s in d.get("senses", []):
            for fo in s.get("form_of") or []:
                if fo.get("word"): forms.setdefault(w.lower(), fo["word"])
        if real:
            g = next((gg for s in real for gg in (s.get("glosses") or [])[-1:]), "")
            g = re.sub(r"\s*\([^)]*\)", "", g).strip()[:70]
            if w not in lem or (lem[w]["p"] in ("name",) and pos != "name"):
                lem.setdefault(w, {"g": g, "p": pos})
            for f in d.get("forms") or []:
                ff = f.get("form", ""); tg = f.get("tags") or []
                if not ff or "table-tags" in tg or "inflection-template" in tg or "romanization" in tg or " " in ff: continue
                forms.setdefault(ff.lower(), w)
            forms.setdefault(w.lower(), w)
        for s in d.get("senses", []):
            for e in s.get("examples") or []:
                if e.get("ref") and (e.get("english") or e.get("translation")) and e.get("text"):
                    tquotes.append((e["text"], e["ref"], e.get("english") or e.get("translation")))
    print(f"lemmas {len(lem)}, forms {len(forms)}, translated quotations {len(tquotes)}", flush=True)

    # ---- English cognates: (a) English entries citing this word as cognate, (b) English words
    # borrowed from it, (c) shared ancestor in the etymology chains
    ANC_LANGS = ("Old French|Middle French|Anglo-Norman|Late Latin|Medieval Latin|New Latin|Vulgar Latin|Latin|"
                 "Ancient Greek|Proto-Germanic|Proto-West Germanic|Old High German|Middle High German|Old English|"
                 "Middle English|Frankish|Old Norse|Proto-Indo-European|Middle Low German|Old Saxon|Italian|Spanish")
    PROSE = re.compile(r"\b(" + ANC_LANGS + r") (\*?[^\s,.;()“”]+)")
    def K(l, t): return (l, fold(t).lstrip("*"))
    chains = {}
    with open(os.path.join(V, f"kaikki-etym-{lc}.jsonl"), encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            ch = [(s["l"], s["t"]) for s in r.get("ch", [])]
            if not ch and r.get("e"):
                ch = [(m.group(1), m.group(2)) for m in PROSE.finditer(r["e"])][:5]
            chains[r["w"]] = ch
    cand = collections.defaultdict(set)  # lemma -> english words
    anc = collections.defaultdict(set)   # (lang, folded term) -> english words
    enl = {}                             # english word -> set of languages in its history
    with open(os.path.join(V, "kaikki-etym.jsonl"), encoding="utf-8") as f:
        for line in f:
            r = json.loads(line); ew = r["w"]
            if " " in ew or not ew.islower(): continue
            for c in r.get("cg", []):
                if c.get("l") == LN: cand[c["t"]].add(ew)
            ch = [(s["l"], s["t"]) for s in r.get("ch", [])[:7]]
            if not ch and r.get("e"): ch = [(m.group(1), m.group(2)) for m in PROSE.finditer(r["e"])][:6]
            enl[ew] = {l for l, _ in ch}
            for l, t in ch:
                if l == LN: cand[t].add(ew)
                anc[K(l, t)].add(ew)
    ROOTS = {"fr": {"Old French", "Middle French", "Anglo-Norman", "Latin", "Late Latin", "Medieval Latin", "New Latin", "French"},
             "de": {"Proto-Germanic", "Proto-West Germanic", "Old English", "German", "Middle High German", "Old High German", "Middle Dutch", "Dutch", "Middle Low German"}}[lc]
    def zen(w): return zipf_frequency(w, "en")
    lex = []; lid = {}
    def cognate(w, depth=0):
        cs = set(cand.get(w, ()))
        for l, t in chains.get(w, [])[:5]:
            if l == "English": cs.add(t)
            if l == LN and depth == 0 and t != w:  # derived within the language (photo < photographie): its cognate
                c2 = cognate(t, 1)[0]
                if c2: cs.add(c2)
            if l not in ROOTS and l != LN: continue  # cousins at the Latin / Germanic level, not PIE
            if len(fold(t).strip("*-")) < 3 or re.match(r"^\*?-|-$", t): continue  # affixes link everything
            a2 = anc.get(K(l, t), set())
            if len(a2) <= 60: cs |= {e for e in a2 if sim(w, e) >= 0.4 or e in cand.get(w, ())}
        fw = fold(w)
        if len(fw) >= 4 and fw in enl and zen(fw) >= 3 and (enl[fw] & ROOTS): cs.add(fw)   # same spelling, same stock
        best, bs = "", 0
        for e in cs:
            if zen(e) < 3.0: continue
            sc = sim(w, e) + 0.05 * min(zen(e), 6)
            if sc > bs: best, bs = e, sc
        # transparent = looks alike AND means the same (the English word, or its stem, is in the gloss)
        g = fold(lem.get(w, {}).get("g", ""))
        stem = fold(best)[: max(4, len(best) - 3)]
        same = bool(best) and (re.search(r"\b" + re.escape(stem), g) is not None)
        if best and not same and sim(w, best) >= 0.9 and not g: same = True
        if best and fold(w) == fold(best) and not same: best = ""      # same spelling, other meaning: a false friend
        return best, (1 if best and same and sim(w, best) >= 0.55 else 0)
    for w, v in lem.items():
        if " " in w or (len(w) < 2 and not w.islower()) or (w.isupper() and len(w) > 1): continue
        z = zipf_frequency(w, lc)
        if z < 1.5 and w.lower() not in forms: continue
        best, transparent = cognate(w)
        lid[w] = len(lex)
        lex.append([w, v["g"], v["p"], round(z * 10), best, transparent, ""])
    print(f"lex {len(lex)}; with English cognate {sum(1 for x in lex if x[4])}, transparent {sum(x[5] for x in lex)}", flush=True)

    def lemma_of(f):
        # a form can point at another form (déployée → déployé → déployer): follow a few hops
        l = forms.get(f)
        for _ in range(3):
            if l is None or l in lid: return l
            l = forms.get(l.lower()) if forms.get(l.lower()) != l else None
        return l if l in lid else None
    def lookup(tok):
        for t in (tok, tok.lower(), tok[:1].upper() + tok[1:].lower()):
            if t in lid: return lid[t]
            l = lemma_of(t.lower())
            if l: return lid[l]
        return -1

    # ---- quotations: translated ones from English Wiktionary + canon authors from the native edition
    CRE = canon_re(lc)
    pool = []
    # translated quotations from English Wiktionary: only from the canon (the rest is song
    # lyrics, ad copy and newspaper filler)
    for t, ref, en in tquotes:
        if CRE.search(ref[:80]): pool.append((t, ref, en))
    n_native = 0; by_author = collections.Counter()
    for d in jsonl_gz(os.path.join(V, edition)):
        for s in d.get("senses", []):
            for e in s.get("examples") or []:
                ref = e.get("ref") or ""
                if not ref or PRESS.search(ref): continue
                head = ref[:80]
                m = CRE.search(head)
                if not m: continue
                pool.append((e.get("text", ""), ref, e.get("translation")))
                n_native += 1
    print(f"native canon quotations {n_native}", flush=True)
    seen = set(); out = []
    for t, ref, en in pool:
        t = re.sub(r"\s+", " ", (t or "")).strip()
        if not t or t in seen: continue
        seen.add(t)
        toks = list(tokens(t, lc))
        if not (6 <= len(toks) <= 45): continue
        ws = []; unk = 0
        for s, e, w in toks:
            i = lookup(w)
            ws.append([s, e, i])
            if i < 0: unk += 1
        if unk > max(2, len(toks) // 6): continue  # too many words we can't gloss
        m = CRE.search(ref[:80])
        if not m: continue
        author = m.group(1)
        y = year_of(ref)
        # baseline difficulty: share of words outside the 1,500 most common that aren't transparent cognates
        hard = 0
        for s, e, i in ws:
            if i < 0: hard += 1; continue
            L = lex[i]
            if L[3] >= 50 or L[5]: continue
            hard += 1
        q = {"t": t, "r": ref[:160], "a": author, "w": ws, "h": round(hard / len(ws), 3)}
        if y: q["y"] = y
        if en: q["en"] = re.sub(r"\s+", " ", en).strip()
        out.append(q); by_author[author] += 1
    # keep author variety: at most 300 per author, preferring the easier and the translated
    out.sort(key=lambda q: (q["a"], 0 if q.get("en") else 1, q["h"]))
    kept, cnt = [], collections.Counter()
    for q in out:
        if cnt[q["a"]] >= 300 and q["a"] not in ("Michel Houellebecq", "Jacques Derrida"): continue
        cnt[q["a"]] += 1; kept.append(q)
    kept.sort(key=lambda q: q["h"])
    print(f"quotations kept {len(kept)} from {len(out)}; authors {len(cnt)}", flush=True)

    # ---- write
    D = os.path.join(ROOT, "reader", lc)
    if os.path.isdir(D):
        import shutil; shutil.rmtree(D)
    os.makedirs(os.path.join(D, "q")); os.makedirs(os.path.join(D, "forms"))
    used = set(i for q in kept for _, _, i in q["w"] if i >= 0)
    with open(os.path.join(D, "lex.json"), "w", encoding="utf-8") as f: json.dump(lex, f, ensure_ascii=False, separators=(",", ":"))
    shards = collections.defaultdict(dict)
    for form in forms:
        l = lemma_of(form)
        if l:
            k = fold(form)[:1]
            if not ("a" <= k <= "z"): k = "_"
            shards[k][form] = lid[l]
    for w in lid: shards[(fold(w)[:1] if "a" <= fold(w)[:1] <= "z" else "_")][w.lower()] = lid[w]
    for k, m in shards.items():
        with open(os.path.join(D, "forms", k + ".json"), "w", encoding="utf-8") as f: json.dump(m, f, ensure_ascii=False, separators=(",", ":"))
    BAND = 400
    bands = []
    for b in range(0, len(kept), BAND):
        chunk = kept[b:b + BAND]
        with open(os.path.join(D, "q", f"{len(bands)}.json"), "w", encoding="utf-8") as f: json.dump(chunk, f, ensure_ascii=False, separators=(",", ":"))
        bands.append([chunk[0]["h"], chunk[-1]["h"]])
    ab = collections.defaultdict(list)
    for bi in range(len(bands)):
        for q in kept[bi * BAND:(bi + 1) * BAND]:
            if not ab[q["a"]] or ab[q["a"]][-1] != bi: ab[q["a"]].append(bi)
    idx = {"lang": lc, "lex": len(lex), "quotes": len(kept), "bands": bands, "ab": ab,
           "authors": cnt.most_common(), "formShards": sorted(shards)}
    with open(os.path.join(D, "index.json"), "w", encoding="utf-8") as f: json.dump(idx, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote reader/{lc}: {len(bands)} bands; top authors {cnt.most_common(12)}", flush=True)

if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    for lc in (["fr", "de"] if which == "all" else [which]):
        build(lc)
