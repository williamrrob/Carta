#!/usr/bin/env python3
"""Set phrases in the reader's excerpts: il y a, ce que, tout à fait, es gibt, zu Hause…

Word by word, "il y avait" reads as "he there had"; the dictionary's multiword entries (the map's
French and German points whose title has a space) say "there was". This finds every such entry
that occurs in a served excerpt and records where:

  reader/<lc>/phrases.json   [[title, gloss, map index], …]   (only phrases some excerpt uses)
  reader/<lc>/q/<band>.json  each excerpt gains  p: [[phrase id, word, word, …], …]
                             (word = index into its w list; the phrase's own words only)

Matching works on letter runs, so apostrophes and hyphens don't matter (s'en aller, est-ce que).
A phrase word matches an excerpt word with the same spelling; a verb, which phrases give in the
infinitive, also matches its other forms (avoir honte ~ avait honte, y avoir ~ y avait); se/sich match
any reflexive pronoun (se rendre compte ~ je me rends compte). Phrases often close around a
pronoun, a negation or an adverb (faire très attention, wenn sie nicht, plus vite que jamais):
up to GAP such words may sit between phrase words, in the same clause, never before the first
word or after the last.
Fewest gaps, then longest phrase, wins; matches don't overlap.

Served files only (graph/, reader/), so it runs without the dumps. Run after build-reader.py /
add-translated-quotes.py (they rewrite the q files); then bump V in learn.js.

  python3 scripts/build-phrases.py [fr|de|all]
"""
import array, glob, json, os, re, sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
RUN = re.compile(r"[^\W\d_]+")
REFL = {"fr": {"se", "me", "te", "nous", "vous", "s", "m", "t", "soi"},
        "de": {"sich", "mich", "dich", "uns", "euch", "mir", "dir"}}
# the only words a phrase may close around: personal and reflexive pronouns, negation, and adverbs
GAPW = {"fr": {"ne", "n", "me", "m", "te", "t", "se", "s", "nous", "vous", "lui", "leur", "y", "en",
               "je", "j", "tu", "il", "elle", "on", "ils", "elles"},   # not le/la/les: mostly articles
        "de": {"ich", "du", "er", "sie", "es", "wir", "ihr", "mich", "dich", "ihn", "uns", "euch", "mir", "dir", "ihm", "ihnen", "sich", "nicht"}}
REFL_HEAD = {"fr": {"se", "s"}, "de": {"sich"}}
NAME = {"fr": "French", "de": "German"}
MAXW = 6
GAP = 2

# entries that are notes about spelling or grammar, not a meaning of the phrase
NOT_MEANING = re.compile(r"^(used other than|alternative (form|spelling)|initialism|abbreviation|acronym|contraction|"
                         r"(obsolete|archaic|dated|nonstandard|rare) (form|spelling)|misspelling|plural of|inflection of|"
                         r"(feminine|masculine)? ?(singular|plural)? ?(form )?of\b)|used in meme", re.I)
ARTICLE = {"fr": {"le", "la", "les", "l", "un", "une", "des"}, "de": {"der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "eines"}}

def skips(lc):
    """review/phrase-skip.tsv: phrases checked by hand that collide with ordinary word sequences
    (et des "or thereabouts" fires on every "et des"); first column lc, second the title"""
    out = set()
    try:
        for line in open(os.path.join(ROOT, "review/phrase-skip.tsv"), encoding="utf-8"):
            f = line.rstrip("\n").split("\t")
            if len(f) >= 2 and f[0] == lc: out.add(f[1])
    except FileNotFoundError: pass
    return out

def load(p): return json.load(open(os.path.join(ROOT, p), encoding="utf-8"))

def main(lc):
    info = load("graph/info.json"); chunk = info["chunk"]
    labels = load("graph/labels.json")
    lang = array.array("H"); lang.frombytes(open(os.path.join(ROOT, "graph/lang.bin"), "rb").read())
    L = info["langs"].index(NAME[lc])
    lex = load(f"reader/{lc}/lex.json")
    forms = {}
    for f in glob.glob(os.path.join(ROOT, f"reader/{lc}/forms/*.json")): forms.update(load(os.path.relpath(f, ROOT)))
    verbs = {r[0].lower() for r in lex if "verb" in (r[2] or "")}
    adverb = {i for i, r in enumerate(lex) if "adv" in (r[2] or "") and not re.search(r"noun|verb|adj", r[2] or "")}
    def lemmas(w):   # the dictionary entries a written word can be
        out = {w}
        for k in (w, w.capitalize()):
            for i in forms.get(k, ()):
                if isinstance(i, int) and i >= 0: out.add(lex[i][0].lower())
        return out

    # the phrases: multiword entries of this language on the map, with a meaning
    cand = {}; skip = skips(lc); gl = {}; cache = {}
    def gloss(i):
        c = i // chunk
        if c not in cache: cache[c] = load(f"graph/n/{c}.json")
        d = cache[c]; rec = d[i % chunk] if isinstance(d, list) else d.get(str(i))
        return (rec or {}).get("g") or ""
    for i, t in enumerate(labels):
        if lang[i] != L or not isinstance(t, str) or " " not in t.strip() or t in skip: continue
        if re.search(r"[.\d]", t): continue                                   # S. M., initials, numbers
        runs = [r.lower() for r in RUN.findall(t.replace("’", "'"))]
        if not 2 <= len(runs) <= MAXW: continue
        if len(runs) == 2 and runs[0] in ARTICLE[lc]: continue                # die Alten, das Haus: article + word
        g = gloss(i)
        if not g or NOT_MEANING.search(g): continue
        cand[i] = (t, runs); gl[i] = g
    print(f"{lc}: {len(cand)} multiword entries")
    # index by every form the first word can match
    index = {}
    for i, (t, runs) in cand.items():
        head = runs[0]
        keys = {"\0refl"} if head in REFL_HEAD[lc] else lemmas(head)
        for k in keys: index.setdefault(k, []).append(i)
    word_lem = {}
    def wl(w):
        if w not in word_lem: word_lem[w] = lemmas(w)
        return word_lem[w]

    used = {}; files = sorted(glob.glob(os.path.join(ROOT, f"reader/{lc}/q/*.json"))); hits = 0
    for f in files:
        qs = json.load(open(f, encoding="utf-8"))
        for q in qs:
            t = q["t"].replace("’", "'")
            # letter runs, each with its word index and that word's dictionary entry
            runs = []; prev_end = 0; brk = []   # brk[a]: punctuation between run a-1 and run a
            for k, y in enumerate(q["w"]):
                rs = RUN.findall(t[y[0]:y[0] + y[1]])
                ent = lex[y[2]][0].lower() if len(rs) == 1 and isinstance(y[2], int) and y[2] >= 0 else None
                gap_ok = len(rs) == 1 and (rs[0].lower() in GAPW[lc] or (isinstance(y[2], int) and y[2] in adverb))
                gap_txt = t[prev_end:y[0]]; prev_end = y[0] + y[1]
                for n_, r in enumerate(rs):
                    runs.append((r.lower(), k, ent, gap_ok)); brk.append(bool(n_ == 0 and re.search(r"[,.;:!?()«»\"—–]", gap_txt)))
            def fits(er, ee, pw):
                if er == pw: return True
                if pw in REFL_HEAD[lc] | REFL[lc] and er in REFL[lc]: return True
                # a verb's other forms (fait ≠ fais: "en fait" isn't faire; force ≠ forcer)
                return bool(ee and pw in verbs and ee == pw)
            def walk(a, pr, m, gaps):
                """positions of pr[m:] from run a on, allowing GAP extra runs in total; None if not"""
                if m == len(pr): return []
                b = a
                while b < len(runs) and b - a <= GAP - gaps:
                    if b > a and brk[b]: return None   # no reaching across punctuation
                    er, _, ee, _g = runs[b]
                    if fits(er, ee, pr[m]):
                        rest = walk(b + 1, pr, m + 1, gaps + (b - a))
                        if rest is not None: return [b] + rest
                    if m == 0 or not runs[b][3]: return None   # the first word starts it; only pronouns, negation, adverbs between
                    b += 1
                    if b < len(runs) and brk[b]: return None
                return None
            found = []
            for a, (r, k, ent, _g) in enumerate(runs):
                keys = {r} | ({ent} if ent else set())
                if r in REFL[lc]: keys.add("\0refl")
                for key in keys:
                    for pi in index.get(key, ()):
                        pos = walk(a, cand[pi][1], 0, 0)
                        if not pos: continue
                        words = sorted({runs[b][1] for b in pos})
                        if len(words) < 2: continue          # a phrase joins at least two words
                        gaps = pos[-1] - pos[0] + 1 - len(pos)
                        found.append((gaps, -len(pos), a, pi, words))
            found.sort(); taken = set(); keep = []
            for gaps, _, a, pi, words in found:
                if set(words) & taken or any(x[0] == pi and x[1:] == words for x in keep): continue
                taken |= set(words); keep.append([pi] + words)
            keep.sort(key=lambda x: x[1])
            for x in keep:
                x[0] = used.setdefault(x[0], len(used))
            if keep: q["p"] = keep; hits += len(keep)
            else: q.pop("p", None)
        with open(f, "w", encoding="utf-8") as o: json.dump(qs, o, ensure_ascii=False, separators=(",", ":"))
    # glosses from the map's node details
    out = [None] * len(used)
    for mi, pid in used.items(): out[pid] = [cand[mi][0], gl[mi], mi]
    with open(os.path.join(ROOT, f"reader/{lc}/phrases.json"), "w", encoding="utf-8") as o:
        json.dump(out, o, ensure_ascii=False, separators=(",", ":"))
    print(f"{lc}: {len(used)} phrases set {hits} times")
    from collections import Counter
    cnt = Counter()
    for f in files:
        for q in load(os.path.relpath(f, ROOT)):
            for x in q.get("p", ()): cnt[x[0]] += 1
    for p, n in cnt.most_common(int(os.environ.get("TOP", "25"))): print(f"  {n:5d}  {out[p][0]}  |  {out[p][1][:70]}")

for lc in (["fr", "de"] if len(sys.argv) < 2 or sys.argv[1] == "all" else [sys.argv[1]]): main(lc)
