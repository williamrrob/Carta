#!/usr/bin/env python3
"""
build-reader.py — the French / German reader's data. The reader and the map share ONE set of
dictionary entries: scripts/build-lexeme-graph.js writes g/lex-<lc>.jsonl (every French/German entry,
with its map key) and g/forms-<lc>.json (inflected form → lemmas); scripts/build-graph-layout.js
writes g/keys.json (map index → key) and the build stamp. Words are resolved by
scripts/reader_resolve.py (homographs, inflections, old spellings, contractions, names).

Quotation pool (vendor-data/reader-pool-<lc>.jsonl, one {t, r, en?} per line) comes from the
dictionaries' quotations:
  python3 scripts/build-reader.py pool [fr|de|all]     from vendor-data dumps (kaikki-<Lang>.jsonl.gz:
        English-Wiktionary examples with translations; frwikt-Francais / dewikt-Deutsch .jsonl.gz:
        the French/German editions' attributed quotations), canon authors + post-1850 books
  python3 scripts/build-reader.py pool-from-served [fr|de|all]   the quotations already in reader/
  python3 scripts/build-reader.py [fr|de|all]          build reader/<lc>/ from the pool

Output (served): reader/<fr|de>/
  lex.json      [[title, gloss, pos, zipf*10, cognate|"", transparent 0/1, map index|-1, flags, ety?], …]
                flags: 1 = a name (person/place), 2 = on the map but not drawn (no history yet);
                ety: the etymology number where several entries share the title (progress key)
  forms/<k>.json  surface (case-sensitive) → [entry ids, best first], for pasted text; sharded by
                first letter of the folded form
  q/<band>.json   quotations by difficulty: {t, r, a, y?, c?, en?, h, w: [[start, length, id, alt?], …]}
                id -1 = not in the dictionary, -2 = taken for a name (capitalised, unknown)
  index.json    counts, bands, authors, build (must equal graph/info.json build)
"""
import gzip, json, os, re, sys, unicodedata, collections, math
from wordfreq import zipf_frequency
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reader_resolve import Resolver, WORD, norm

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

# a modern book: a citation naming a publisher, a novel, or "Author, Title, … year" with no press cues
BOOKISH = {
 "fr": re.compile(r"Gallimard|Seuil|Stock|Flammarion|Folio|Livre de Poche|Grasset|Albin Michel|Julliard|Minuit|P\.?O\.?L|"
                  r"Actes Sud|Laffont|Plon|Denoël|Fayard|Calmann|Mercure de France|Boréal|J’ai lu|J'ai lu|Rivages|Points|"
                  r"Pocket|Phébus|Zulma|Verdier|Christian Bourgois|L’Olivier|Éditions de l’Olivier|Liana Levi|Sabine Wespieser|"
                  r"roman|nouvelle|récit|Pléiade|Hetzel|Lemerre|Charpentier|Ollendorff|Dentu|Michel Lévy"),
 "de": re.compile(r"Roman|Erzählung|Novelle|Suhrkamp|Fischer|Rowohlt|Hanser|dtv|Diogenes|Kiepenheuer|Ullstein|Piper|Aufbau|"
                  r"Reclam|Goldmann|Heyne|Droemer|Kein & Aber|DuMont|Insel|Luchterhand|Wagenbach|btb|Blessing|Penguin|"
                  r"Klett-Cotta|Matthes|Wallstein|Jung und Jung|Residenz|Zsolnay|Deuticke|Haffmans|Zweitausendeins"),
}
NOTBOOK = re.compile(r"In: |abgerufen|Abgerufen|Aufgerufen|URL|ISSN|Wikipedia|Lexikon|Handbuch|Einführung|Bulletin|Revue|"
                     r"[Ss]ite |\.fr\b|\.com\b|\.de\b|\.net\b|\.ch\b|\.be\b|Fehlender Parameter|règles du jeu|thèse|"
                     r"Dissertation|Bericht|Gesetz|Verordnung|Urkunde|Journal officiel|Bibel|Bible|traité de|manuel|Manuel|"
                     r"dictionnaire|Dictionnaire|Wörterbuch|Encyclopédie|Recueil|Zeitung|Magazin|Zeitschrift|Spiegel|Stern")
PRESS = re.compile(r"journal|magazine|AFP|Reuters|Wikipedia|Le Monde|Libération|Le Devoir|Le Figaro|Ouest|"
                   r"Télégramme|Die Zeit|Spiegel|Süddeutsche|FAZ|taz|Welt|Tagesschau|Wortschatz|20 minutes|Mediapart|"
                   r"Huffington|Le Point|L’Express|Le Parisien|Courrier|Stern|Focus|Bild|ZEIT", re.I)


def year_of(ref):
    ys = [int(y) for y in re.findall(r"\b(1[0-9]{3}|20[0-2][0-9])\b", ref or "")]
    return min(ys) if ys else None

def pool_path(lc): return os.path.join(V, f"reader-pool-{lc}.jsonl")

def collect_pool(lc):
    """candidate quotations from the dictionary dumps (canon authors, and newer books)"""
    LN, edition = LANGS[lc]
    CRE = canon_re(lc)
    out = []
    for d in jsonl_gz(os.path.join(V, f"kaikki-{LN}.jsonl.gz")):
        for s in d.get("senses", []):
            for e in s.get("examples") or []:
                ref = e.get("ref") or ""; en = e.get("english") or e.get("translation")
                if ref and en and e.get("text") and CRE.search(ref[:80]): out.append({"t": e["text"], "r": ref, "en": en})
    for d in jsonl_gz(os.path.join(V, edition)):
        for s in d.get("senses", []):
            for e in s.get("examples") or []:
                ref = e.get("ref") or ""
                if not ref or PRESS.search(ref): continue
                if not CRE.search(ref[:80]):
                    if NOTBOOK.search(ref) or not BOOKISH[lc].search(ref): continue
                    yy = year_of(ref)
                    if not yy or yy < 1850: continue
                q = {"t": e.get("text", ""), "r": ref}
                if e.get("translation"): q["en"] = e["translation"]
                out.append(q)
    with open(pool_path(lc), "w", encoding="utf-8") as f:
        for q in out: f.write(json.dumps(q, ensure_ascii=False) + "\n")
    print(f"pool {lc}: {len(out)} candidate quotations", flush=True)

def pool_from_served(lc):
    D = os.path.join(ROOT, "reader", lc, "q"); n = 0
    with open(pool_path(lc), "w", encoding="utf-8") as f:
        for fn in sorted(os.listdir(D)):
            for q in json.load(open(os.path.join(D, fn), encoding="utf-8")):
                o = {"t": q["t"], "r": q["r"]}
                if q.get("en"): o["en"] = q["en"]
                f.write(json.dumps(o, ensure_ascii=False) + "\n"); n += 1
    print(f"pool {lc}: {n} quotations taken from reader/{lc}", flush=True)

def build(lc):
    print(f"== {LANGS[lc][0]}", flush=True)
    R = Resolver(lc, ROOT)
    if R.over_missing: print("override words with no matching entry:", R.over_missing, flush=True)
    # the map: key → index, and the build stamp the client checks against graph/info.json
    keys = json.load(open(os.path.join(ROOT, "g", "keys.json"), encoding="utf-8"))
    kix = {k: i for i, k in enumerate(keys)}
    build_id = open(os.path.join(ROOT, "g", "build.txt")).read().strip()
    info = json.load(open(os.path.join(ROOT, "graph", "info.json"), encoding="utf-8"))
    assert info.get("build") == build_id, "graph/ and g/ come from different layout runs"
    labels = json.load(open(os.path.join(ROOT, "graph", "labels.json"), encoding="utf-8"))
    quiet = open(os.path.join(ROOT, "graph", "quiet.bin"), "rb").read()
    # English cognates: carried over from the previous reader build by title until the graph supplies them
    old = {}
    # (default: the reader's own previous lex.json, read before it is replaced)
    oldp = os.environ.get("READER_OLD_LEX", os.path.join(ROOT, "reader", "<lc>", "lex.json")).replace("<lc>", lc)
    if oldp and os.path.exists(oldp):
        for r in json.load(open(oldp, encoding="utf-8")):
            if r[4] and r[0] not in old: old[r[0]] = (r[4], r[5])

    # ---- quotations
    CRE = canon_re(lc)
    seen = set(); out = []; by_author = collections.Counter(); used = collections.Counter()
    for line in open(pool_path(lc), encoding="utf-8"):
        p = json.loads(line); t, ref, en = p.get("t"), p.get("r") or "", p.get("en")
        t = re.sub(r"\s+", " ", (t or "")).strip()
        if t.startswith("„") and t.endswith("“") and t.count("„") == 1: t = t[1:-1].strip()
        if not t or t in seen: continue
        seen.add(t)
        # a citation line standing where the sentence goes ("Translation: 1970, Hannah Arendt: On Violence. … page 81:")
        if re.search(r"^\s*(?:Translation|Übersetzung|Traduction)\s*:|^\W*\d{4},\s+[A-ZÀ-Ý]|\bISBN\b", t): continue
        toks = list(R.tokens(t))
        if not (6 <= len(toks) <= 45): continue
        ws = []; unk = 0; hard = 0; counted = 0
        for s, e, ids in toks:
            raw = t[s:e]
            if ids is None:
                # unknown: a capitalised word not at the start of a sentence is taken for a name
                if raw[:1].isupper() and s > 0 and not re.search(r"[.!?…:«»„“\"—]\s*$", t[:s]): ws.append([s, e - s, -2]); continue
                if raw.lower() in ("t",): continue
                ws.append([s, e - s, -1]); unk += 1; hard += 1; counted += 1; continue
            E = R.E[ids[0]]
            if E.get("nm"): ws.append([s, e - s, ids[0]]); continue           # names don't count toward difficulty
            row = [s, e - s, ids[0]] + ([ids[1]] if len(ids) > 1 else [])
            ws.append(row); used[ids[0]] += 1
            if len(ids) > 1: used[ids[1]] += 0
            counted += 1
            z = R.z(E["t"]); tr = old.get(E["t"], ("", 0))[1]
            if not (z >= 5.0 or tr): hard += 1
        if counted == 0 or unk > max(2, counted // 6): continue
        m = CRE.search(ref[:80])
        if m: author = m.group(1)
        else:
            author = re.split(r"\s*[,:(]\s*", re.sub(r"^\W*\d{4},?\s*", "", ref))[0].strip()
            if BOOKISH[lc].search(author) or NOTBOOK.search(author): continue
            if not (3 <= len(author) <= 40) or len(author.split()) > 5 or not re.match(r"^[A-ZÀ-Ý]", author) or re.search(r"\d", author): continue
        q = {"t": t, "r": ref[:110], "a": author, "w": ws, "h": round(hard / counted, 2)}
        y = year_of(ref)
        if y: q["y"] = y
        if m: q["c"] = 1
        if en: q["en"] = re.sub(r"\s+", " ", en).strip()
        out.append(q); by_author[author] += 1
    out.sort(key=lambda q: (q["a"], 0 if q.get("en") else 1, q["h"]))
    kept, cnt = [], collections.Counter()
    for q in out:
        cap = 300 if q.get("c") else 40
        if cnt[q["a"]] >= cap and q["a"] not in ("Michel Houellebecq", "Jacques Derrida"): continue
        cnt[q["a"]] += 1; kept.append(q)
    kept.sort(key=lambda q: q["h"])
    print(f"quotations kept {len(kept)} from {len(out)}; authors {len(cnt)}", flush=True)

    # ---- which entries the phone gets: every one used in a quotation, its runner-ups, and the
    # readings of common words (wordfreq zipf ≥ 2.5) for pasted text
    need = set()
    for q in kept:
        for x in q["w"]:
            for i in x[2:]:
                if i >= 0: need.add(i)
    surfaces = set()
    for q in kept:
        for x in q["w"]: surfaces.add(q["t"][x[0]:x[0] + x[1]])
    for i, e in enumerate(R.E):
        if R.z(e["t"]) >= 2.5: surfaces.add(e["t"])
    for f in R.forms:
        if R.z(f) >= 2.5: surfaces.add(f)
    formmap = {}
    for f in surfaces:
        n = norm(f).rstrip("'")
        r = R.ids(n, False)
        if r: formmap[n] = r; need.update(r)
        if n[:1].isupper():
            r2 = R.ids(n, True)
            if r2 and r2 != formmap.get(n): formmap["^" + n] = r2; need.update(r2)
    order = sorted(need, key=lambda i: -R.z(R.E[i]["t"]))
    lid = {i: n for n, i in enumerate(order)}
    lex = []; onmap = 0; bad = 0
    for i in order:
        e = R.E[i]
        g = "; ".join(dict.fromkeys(re.sub(r"\s*\([^)]*\)", "", x).strip()[:60] for x in (e.get("g") or [])[:3]))
        mi = kix.get(e.get("k"), -1)
        flags = (1 if e.get("nm") else 0)
        if mi >= 0:
            onmap += 1
            if quiet[mi >> 3] & (1 << (mi & 7)): flags |= 2
            # every row lands on a point with its own spelling
            if labels[mi] not in (e["t"], e.get("h")): bad += 1
        cg, tr = old.get(e["t"], ("", 0))
        row = [e["t"], g, ",".join(e.get("p") or []), round(R.z(e["t"]) * 10), cg, tr, mi, flags]
        if len(R.by_title.get(e["t"], [])) > 1: row.append(e.get("n") or str(i))   # homographs: progress per entry
        lex.append(row)
    assert bad == 0, f"{bad} lexicon rows point at a map point with another spelling"
    print(f"lex {len(lex)} entries, {onmap} on the map; forms {len(formmap)}", flush=True)
    for q in kept:
        q["w"] = [x[:2] + [lid[i] if i >= 0 else i for i in x[2:]] for x in q["w"]]
    formmap = {k: [lid[i] for i in v] for k, v in formmap.items()}

    # ---- write
    D = os.path.join(ROOT, "reader", lc)
    if os.path.isdir(D):
        import shutil; shutil.rmtree(D)
    os.makedirs(os.path.join(D, "q")); os.makedirs(os.path.join(D, "forms"))
    with open(os.path.join(D, "lex.json"), "w", encoding="utf-8") as f: json.dump(lex, f, ensure_ascii=False, separators=(",", ":"))
    shards = collections.defaultdict(dict)
    for form, ids in formmap.items():
        k = fold(form.lstrip("^"))[:1]
        if not ("a" <= k <= "z"): k = "_"
        shards[k][form] = ids
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
    canon_authors = sorted({q["a"] for q in kept if q.get("c")})
    idx = {"lang": lc, "build": build_id, "lex": len(lex), "quotes": len(kept), "bands": bands, "ab": ab, "canon": canon_authors,
           "authors": [x for x in cnt.most_common() if x[0] in set(canon_authors)], "formShards": sorted(shards)}
    with open(os.path.join(D, "index.json"), "w", encoding="utf-8") as f: json.dump(idx, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote reader/{lc}: {len(bands)} bands; top authors {cnt.most_common(8)}", flush=True)

if __name__ == "__main__":
    a = sys.argv[1:]
    mode = a[0] if a and a[0] in ("pool", "pool-from-served") else "build"
    which = (a[1] if mode != "build" and len(a) > 1 else a[0] if mode == "build" and a else "all")
    for lc in (["fr", "de"] if which == "all" else [which]):
        {"pool": collect_pool, "pool-from-served": pool_from_served, "build": build}[mode](lc)
