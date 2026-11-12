#!/usr/bin/env python3
"""Re-label served German excerpt words that were taken for names but are compounds the
dictionary lacks (Weinhandlung = Wein + Handlung): -2 (a name) → -1 (not in the dictionary).

Works on the served files only (reader/de/lex.json, reader/de/q/*.json), so it runs without the
dumps. build-reader.py and add-translated-quotes.py apply the same rule (Resolver.is_name), so a
fresh build needs no fix-up; this is for builds made before that rule existed.

  python3 scripts/fix-de-compound-names.py          # dry run: counts and examples
  python3 scripts/fix-de-compound-names.py --apply  # rewrite reader/de/q/*.json; then bump V in learn.js
"""
import glob, json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from reader_resolve import compound_parts, NOUN_END

ROOT = os.path.join(os.path.dirname(__file__), "..")
apply = "--apply" in sys.argv
import array
lex = json.load(open(os.path.join(ROOT, "reader/de/lex.json"), encoding="utf-8"))
# the reader's lex holds only words that occur in excerpts; the map holds every German headword.
# A German headword written with a capital is a noun (or a name, which a split can't produce).
labels = json.load(open(os.path.join(ROOT, "graph/labels.json"), encoding="utf-8"))
langs = json.load(open(os.path.join(ROOT, "graph/info.json"), encoding="utf-8"))["langs"]
lang = array.array("H"); lang.frombytes(open(os.path.join(ROOT, "graph/lang.bin"), "rb").read())
DE = langs.index("German")
german = [labels[i] for i in range(len(labels)) if lang[i] == DE and isinstance(labels[i], str) and not labels[i].startswith(("*", "-")) and not labels[i].endswith("-")]
titles_lower = {}
for t in german + [r[0] for r in lex]: titles_lower.setdefault(t.lower(), t)
nouns = {t for t in german if t[:1].isupper()} | {r[0] for r in lex if r[2] == "noun"}
forms = {}
for f in glob.glob(os.path.join(ROOT, "reader/de/forms/*.json")): forms.update(json.load(open(f, encoding="utf-8")))
noun_form = lambda T: any(i >= 0 and lex[i][2] == "noun" for i in forms.get(T, ()))

total = fixed = 0; examples = []
for f in sorted(glob.glob(os.path.join(ROOT, "reader/de/q/*.json"))):
    qs = json.load(open(f, encoding="utf-8")); changed = False
    for q in qs:
        for y in q["w"]:
            if y[2] != -2: continue
            total += 1
            w = q["t"][y[0]:y[0] + y[1]]
            parts = compound_parts(w, titles_lower, nouns, noun_form) or (NOUN_END.search(w) and ("", w))
            if not parts: continue
            y[2] = -1; fixed += 1; changed = True
            if len(examples) < 25: examples.append(f"{w} = {parts[0]} + {parts[1]}" if parts[0] else f"{w} (noun ending)")
    if apply and changed:
        with open(f, "w", encoding="utf-8") as o: json.dump(qs, o, ensure_ascii=False, separators=(",", ":"))
print(f"{fixed} of {total} 'names' are compounds" + ("" if apply else " (dry run)"))
print("\n".join(examples))
