"""
reader_resolve.py — word → dictionary entry for the reader, over the SAME entries as the map
(g/lex-<lc>.jsonl and g/forms-<lc>.json, written by scripts/build-lexeme-graph.js).

  R = Resolver(lc, root)        # loads the lexicon, forms, frequencies
  R.token_parts(raw, initial)   # → [(start, end, [entry ids, best first] | None)] within raw
  R.readings(surface, initial)  # → [(entry id, how)] best first (how: "title" | "form" | "alt")

Ranking (no context, so it's a best guess; runners-up are kept for the tap card):
  1 an entry tagged obsolete/archaic/rare/dated, glossed "… spelling of", or a person/place name
    loses to any other reading (peut "obsolete spelling of put" → pouvoir);
  2 a closed-class entry (pronoun, article, preposition, conjunction, particle) with that exact
    spelling wins (es "it", not a form of der; mein, unser, devant);
  3 an inflection reading wins when its lemma's OTHER forms are at least 0.8× as frequent as this
    spelling and more frequent than the exact entry's own other forms (sein keeps "to be/his"
    against the pronoun form of es). Ratio examples:
    spelling (est 0.9 → être, donne 2.5 → donner, gewesen → sein; livre 0.75 stays "book", fils 0.26
    stays "son"). Frequency can't see meaning (bois 2.3 → boire, though "wood" is commoner), hence
    the hand-checked overrides and the runner-up shown on the tap card;
  4 otherwise the exact entry.
  review/reader-overrides.tsv (lc, surface, entry key) settles words checked by hand: it only
  chooses among existing entries.
Contractions: whole word if the dictionary has it (aujourd'hui, au, zum, peut-être); else French
elision (l', qu', jusqu'…), then hyphen parts (dit-il, a-t-elle: the euphonic t gets no entry),
German 's → es (war's), apocope hätt' → hätte, ß → ss (verdroß), each only onto a known word.
"""
import json, os, re, collections, unicodedata
from wordfreq import zipf_frequency

LETTER = "A-Za-zÀ-ÖØ-öø-ÿŒœÆæßſ"
# a word: letters (editorial [D]ie brackets allowed), joined by - ’ ' ; may end in ’/' (d' être, hätt')
WORD = re.compile(r"(?:[" + LETTER + r"]|\[[" + LETTER + r"]+\])+(?:[-’'](?:[" + LETTER + r"]|\[[" + LETTER + r"]+\])+)*[’']?")
ELIDE = re.compile(r"^(l|d|j|m|n|s|t|c|qu|jusqu|lorsqu|puisqu|quoiqu)'", re.I)
ELIDED = {"l": ["le", "la"], "d": ["de"], "j": ["je"], "m": ["me"], "n": ["ne"], "s": ["se", "si"], "t": ["te"], "c": ["ce"],
          "qu": ["que"], "jusqu": ["jusque"], "lorsqu": ["lorsque"], "puisqu": ["puisque"], "quoiqu": ["quoique"]}
CLOSED = {"pron", "det", "article", "prep", "conj", "particle", "postp", "contraction"}
DEMOTE_TAGS = {"obsolete", "archaic", "rare", "dated", "nonstandard", "misspelling"}
SENT_END = re.compile(r"[.!?…:;«»„“\"(\[—–]\s*$")

def norm(s):
    """the form looked up: long s, curly apostrophe and editorial brackets normalised (same length
    is not kept: offsets always refer to the raw text)."""
    return s.replace("ſ", "s").replace("’", "'").replace("[", "").replace("]", "")

# German capitalises every noun, so an unknown capitalised word is usually a compound the
# dictionary lacks (Weinhandlung = Wein + Handlung), not a name. Split it into two dictionary
# words: the last part a noun, the first any entry (a linking -s/-es/-n/-en/-e/-er allowed).
# A first part that is itself in the dictionary wins; the longest last part breaks ties
# (Literatur + Zeitschrift, not Literaturzeit + Schrift). Returns (first, last) as dictionary
# titles, or None. Same rule in learn.js (compoundOf).
LINK = ("", "s", "es", "n", "en", "e", "er")
# A last part may also be an inflected noun (Grab + Hände, Kartoffel + Feldern): noun_form(T)
# says whether T is a form of a noun. NOUN_END: German noun suffixes, enough on their own to say
# "a word, not a name" (Verspottung, Herzklopfens is caught by the split).
NOUN_END = re.compile(r"(ung|heit|keit|schaft|tion|ität|nis|tum|ismus|chen|lein)(en|s|e|n|ses|sen|se)?$")
def compound_parts(w, titles_lower, nouns, noun_form=None, _depth=0):
    best = None
    for k in range(3, len(w) - 3):
        h, t = w[:k], w[k:]
        T = t[:1].upper() + t[1:]
        if T not in nouns and not (noun_form and noun_form(T)): continue
        hl = h.lower()
        for cut in LINK:
            if cut and not hl.endswith(cut): continue
            hh = hl[:len(hl) - len(cut)] if cut else hl
            if len(hh) < 3: continue
            if hh in titles_lower:
                return (titles_lower[hh], T)          # k ascends: the first direct hit has the longest last part
            if _depth == 0 and best is None and compound_parts(hh[:1].upper() + hh[1:], titles_lower, nouns, noun_form, 1):
                best = (h[:1].upper() + h[1:], T)
    return best

class Resolver:
    def is_name(self, raw):
        """an unknown capitalised word: a name, unless (German) it splits into dictionary words"""
        if self.lc != "de": return True
        if NOUN_END.search(raw): return False
        return not compound_parts(raw, self.titles_lower, self.nouns, lambda T: any(l in self.nouns for l in self.forms.get(T, ())))

    def __init__(self, lc, root):
        self.lc = lc
        self.E = []                                   # entries (dicts from g/lex-<lc>.jsonl)
        with open(os.path.join(root, "g", f"lex-{lc}.jsonl"), encoding="utf-8") as f:
            for line in f:
                if line.strip(): self.E.append(json.loads(line))
        self.by_title = collections.defaultdict(list)
        for i, e in enumerate(self.E): self.by_title[e["t"]].append(i)
        with open(os.path.join(root, "g", f"forms-{lc}.json"), encoding="utf-8") as f: self.forms = json.load(f)
        for fm, ls in self.forms.items():             # some links carry a gloss: "laufen 'to run'" → laufen
            self.forms[fm] = [l if l in self.by_title else re.split(r"\s+['‘’“(]", l)[0].strip() for l in ls]
        self.forms_of = collections.defaultdict(set)  # lemma title → its forms
        for fm, ls in self.forms.items():
            for l in ls: self.forms_of[l].add(fm)
        self.forms_or_titles = set(self.forms) | set(self.by_title)
        self.titles_lower = {}
        for t in self.by_title: self.titles_lower.setdefault(t.lower(), t)
        self.nouns = {e["t"] for e in self.E if "noun" in (e.get("p") or [])}
        self.over = {}
        p = os.path.join(root, "review", "reader-overrides.tsv")
        self.over_missing = []
        if os.path.exists(p):
            for line in open(p, encoding="utf-8"):
                if line.startswith("#") or not line.strip(): continue
                c = line.rstrip("\n").split("\t")
                if len(c) < 3 or c[0] != lc: continue
                hint = (c[3] if len(c) > 3 else "").lower()
                cands = self.by_title.get(c[2], [])
                pick = next((i for i in cands if hint and hint in " ".join(self.E[i].get("g") or []).lower()), cands[0] if cands else None)
                if pick is None: self.over_missing.append(c[1]); continue
                self.over[c[1]] = pick
        self._z = {}; self._agg = {}; self._cache = {}

    # ---- frequencies ------------------------------------------------------------------------
    def z(self, w):
        v = self._z.get(w)
        if v is None: v = self._z[w] = zipf_frequency(w, self.lc)
        return v
    def agg_other(self, lemma, surface, rivals=()):
        """frequency of a lemma's forms other than this spelling (and the lemma itself). A form it
        shares with a rival reading (verres: verre and verrer; Tage: Tag and tagen) is counted for
        neither, and in German a lower-case form that is also a capitalised noun form isn't counted
        for the verb (wordfreq can't tell tage from Tage)."""
        k = (lemma, surface, rivals)
        v = self._agg.get(k)
        if v is None:
            shared = set()
            for r in rivals:
                if r != lemma: shared |= self.forms_of.get(r, set()) | {r}
            tot = 0.0
            for fm in self.forms_of.get(lemma, set()) | {lemma}:
                if fm == surface or fm.lower() == surface.lower() or (fm in shared and fm != lemma): continue
                if self.lc == "de" and fm[:1].islower() and (fm[:1].upper() + fm[1:]) in self.forms_or_titles: continue
                tot += 10 ** self.z(fm)
            v = self._agg[k] = tot
        return v

    def demoted(self, i):
        e = self.E[i]
        if e.get("nm"): return True
        if DEMOTE_TAGS & set(e.get("q") or []): return True
        gs = e.get("g") or [""]
        return all(re.search(r"\bspelling of\b|\bform of\b|\bobsolete\b|\barchaic\b", g, re.I) for g in gs)

    def alt_target(self, i):
        """the main spelling an old/variant spelling points to, if it is a known word"""
        e = self.E[i]
        for t in ([e["ao"], e["ao"].split(" ")[0]] if e.get("ao") else []) + [self.spelling_target(i)]:
            if t and (t in self.by_title or t in self.forms): return t
        return None

    def spelling_target(self, i):
        g = (self.E[i].get("g") or [""])[0]
        m = re.search(r"\b(?:spelling|letter-case form|form) of ([^\s,.;:()]+)", g)
        return m.group(1) if m and m.group(1) in self.by_title or (m and m.group(1) in self.forms) else None

    def entries_for(self, title):
        """entries with this title, best first: non-names, non-demoted, then the first etymology"""
        ids = self.by_title.get(title, [])
        return sorted(ids, key=lambda i: (self.demoted(i), i))

    # ---- readings ----------------------------------------------------------------------------
    def readings(self, s, initial=False, depth=0):
        key = (s, initial)
        if key in self._cache: return self._cache[key]
        if depth > 3: return []          # spelling links that loop (A spelling of B, B of A)
        variants = [s]
        low = s.lower()
        if low != s: variants = [low, s] if initial else [s, low]
        if self.lc == "de" and s[:1].islower(): variants.append(s[:1].upper() + s[1:])   # a noun written lower case
        best = {}                                    # entry → (score, order, how): the best way it was reached
        def add(i, how, score):
            if i not in best or score < best[i][0]: best[i] = (score, best[i][1] if i in best else len(best), how)
        fs = 10 ** self.z(s)
        for vi, v in enumerate(variants):
            vpen = vi * 0.5
            if v != s and s[:1].islower(): vpen = 4          # a capitalised noun for a lower-case word: last resort
            if v != s and s[:1].isupper() and not initial and self.lc == "de": vpen = 4   # mid-sentence capital: a noun
            title = self.entries_for(v)
            # how strong the exact entries are in their own right: their other inflections
            # (sein: ist, sind, war… — so a pronoun form "sein" of es doesn't take it)
            tstrength = max([self.agg_other(v, v) / fs if fs > 0 else 0] if any(not self.demoted(i) for i in title) else [0])
            for i in title:
                e = self.E[i]
                tgt = self.alt_target(i) if self.demoted(i) else None
                if tgt and tgt != v and self.demoted(i) and not e.get("nm"):  # an old spelling (daß → dass, gewußt → wissen)
                    for j, how in self.readings(tgt, False, depth + 1)[:2]: add(j, "alt", 2.5 + vpen)
                    add(i, "title", 5 + vpen); continue
                if self.demoted(i): add(i, "title", 5 + vpen); continue
                closed = bool(CLOSED & set(e.get("p") or []))
                add(i, "title", (0.5 if closed else 2) + vpen)
            lemmas = []
            for l in self.forms.get(v, []):
                # a form of a form (devenue → devenu → devenir): follow up to three hops to an entry
                for _ in range(3):
                    if self.by_title.get(l) or l not in self.forms: break
                    l = self.forms[l][0]
                if l not in lemmas: lemmas.append(l)
            rivals = tuple(sorted(set(lemmas) | ({v} if title else set())))
            if title: tstrength = max(tstrength, self.agg_other(v, v, rivals) / fs if fs > 0 else 0)
            for l in lemmas:
                ratio = self.agg_other(l, v, rivals) / fs if fs > 0 else 1
                for j in self.entries_for(l)[:1]:
                    closed_l = bool(CLOSED & set(self.E[j].get("p") or []))   # cette → ce, des → un
                    add(j, "form", (0.6 if closed_l else 1 if ratio >= 0.8 and ratio > tstrength else 3) + vpen - min(ratio, 50) / 1000)
            if v in self.over:
                add(self.over[v], "override", -1)
        # a capitalised word that the dictionary has as a person or place: the name (Paris, Jean, Dieu),
        # except at a sentence start where the lower-case word is a pronoun/article/preposition (Le)
        if s[:1].isupper() and self.lc == "fr":
            names = [i for i in self.by_title.get(s, []) if self.E[i].get("nm")]
            low_closed = any(v[0] <= 1.1 for i, v in best.items() if not self.E[i].get("nm"))   # a strong common reading (Le, Cette, On)
            if names and not low_closed:
                for i in names: add(i, "name", -0.5)
        r = self._cache[key] = [(i, v[2]) for i, v in sorted(best.items(), key=lambda kv: (kv[1][0], kv[1][1]))]
        return r

    def known(self, s, initial=False): return bool(self.readings(s, initial))

    # ---- tokens and contractions -----------------------------------------------------------------
    def tokens(self, text):
        for m in WORD.finditer(text):
            s, e = m.start(), m.end()
            initial = s == 0 or bool(SENT_END.search(text[max(0, s - 3):s])) or text[:s].strip() == ""
            for part in self.token_parts(text[s:e], initial):
                yield (s + part[0], s + part[1], part[2])

    NOISE = re.compile(r"\bletter\b|abbreviation|initialism|acronym|symbol|\bspelling of\b|letter-case|surname|given name", re.I)
    def ids(self, w, initial):
        """[best, runner-up?]: the runner-up only when it is a plausible other reading (not obsolete,
        not a name, a letter or an abbreviation)"""
        r = self.readings(w, initial)
        if not r: return None
        out = [r[0][0]]
        for i, how in r[1:]:
            e = self.E[i]
            if self.demoted(i) or e.get("nm") or self.NOISE.search((e.get("g") or [""])[0]): continue
            out.append(i); break
        return out

    def token_parts(self, raw, initial=False):
        """[(start, end, ids|None)] relative to raw; ids None = not a dictionary word (a name, a typo)"""
        w = norm(raw)
        trail = w.endswith("'")
        core = w.rstrip("'")
        # 1 the whole word (aujourd'hui, peut-être, au, zum); an apostrophe at the end is an elision
        #   (d' être) or an apocope (hätt') — tried below
        if not trail and self.known(w, initial): return [(0, len(raw), self.ids(w, initial))]
        if trail and self.lc == "fr":
            m = ELIDE.match(w)
            if m and len(m.group(0)) == len(w): return [(0, len(raw), self.elided(m.group(1), initial))]
        if trail and self.lc == "de":
            for cand in (core + "e", core):
                if self.known(cand, initial): return [(0, len(raw), self.ids(cand, initial))]
        if self.known(core, initial): return [(0, len(core), self.ids(core, initial))]
        # 2 French elision: l'homme, qu'est-ce, jusqu'à
        if self.lc == "fr":
            m = ELIDE.match(core)
            if m and len(m.group(0)) < len(core):
                n = len(m.group(0))
                return [(0, n, self.elided(m.group(1), initial))] + [(a + n, b + n, x) for a, b, x in self.token_parts(raw[n:], False)]
        # 3 German 's (war's, geht's) → es
        if self.lc == "de" and re.search(r"'s$", core) and len(core) > 2:
            head = core[:-2]
            if self.known(head, initial):
                return [(0, len(head), self.ids(head, initial)), (len(head), len(core), self.ids("es", False))]
        # 4 hyphen parts: dit-il, a-t-elle (the euphonic t: no entry), donne-moi, jour-là
        if "-" in core:
            out = []; pos = 0
            for k, seg in enumerate(raw[:len(core)].split("-")):
                a, b = pos, pos + len(seg); pos = b + 1
                if not seg: continue
                if norm(seg).lower() == "t" and 0 < k: out.append((a, b, None)); continue
                out += [(a + x, a + y, ids) for x, y, ids in self.token_parts(seg, initial and k == 0)]
            if any(p[2] for p in out): return out
        # 5 ß → ss (verdroß), only onto a known word
        if self.lc == "de" and "ß" in core:
            alt = core.replace("ß", "ss")
            if self.known(alt, initial): return [(0, len(core), self.ids(alt, initial))]
        r = self.inflected(core, initial)
        return [(0, len(core), r)]

    SEP = sorted("ab an auf aus bei dar durch ein fest fort her heraus herein herum hervor herab heran herauf herunter "
                 "hin hinaus hinein hinauf hinunter hinab los mit nach nieder vor voran voraus vorbei vorüber weg weiter "
                 "zu zurück zusammen empor entgegen davon dahin daher dazu umher heim fehl frei hoch statt teil".split(), key=len, reverse=True)
    def inflected(self, w, initial):
        """last resorts, each only onto a known entry: French plural -s/-x; German adjective endings
        (blitzenden → blitzend), separable verbs (herauskam → heraus + kommen = herauskommen,
        auszubeuten → ausbeuten)"""
        if self.lc == "fr":
            if len(w) > 3 and w[-1] in "sx" and self.known(w[:-1], initial): return self.ids(w[:-1], initial)
            return None
        lw = w.lower()
        for suf in ("en", "em", "er", "es", "e"):
            b = w[:-len(suf)]
            if len(b) >= 4 and w.endswith(suf) and self.known(b, initial): return self.ids(b, initial)
        for p in self.SEP:
            if not lw.startswith(p) or len(lw) - len(p) < 3: continue
            rest = lw[len(p):]
            if rest.startswith("zu") and self.known(p + rest[2:], False): return self.ids(p + rest[2:], False)
            for cand in (rest,) + tuple(rest[:-len(x)] for x in ("en", "em", "er", "es", "e") if rest.endswith(x)):
                r = self.readings(cand, False)
                if not r: continue
                t = self.E[r[0][0]]["t"]
                if self.by_title.get(p + t): return self.ids(p + t, False)
        return None

    def elided(self, head, initial):
        for full in ELIDED.get(head.lower(), []):
            r = self.ids(full, False)
            if r: return r
        return None
