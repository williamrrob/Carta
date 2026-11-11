#!/usr/bin/env python3
"""
add-translated-quotes.py — adds the dictionary's own translated quotations to Learn's excerpts,
without the graph intermediates (g/) a full build-reader.py run needs.

Learn shows an excerpt's published English after Check when it has one, so excerpts with a
translation are worth having. The English-edition dictionary (kaikki-<French|German>.jsonl.gz)
quotes thousands of sourced sentences with an English translation; build-reader.py only took
those by canon authors. This step takes the rest (same book/author filters, same difficulty
score) and resolves their words with the real resolver (scripts/reader_resolve.py), fed from the
SERVED dictionary (reader/<lc>/lex.json + forms/), so every id points at an entry the phone already
has and test/reader-map.test.js keeps passing. A word outside that vocabulary is unknown, and a
quotation with too many unknowns is dropped, exactly as in the full build.

  python3 scripts/add-translated-quotes.py <dump dir> [fr|de|all]
      dump dir holds kaikki-French.jsonl.gz / kaikki-German.jsonl.gz
      (https://kaikki.org/dictionary/<Lang>/kaikki.org-dictionary-<Lang>.jsonl)

Rewrites reader/<lc>/q/ (re-banded by difficulty) and index.json (bands, authors, counts).
lex.json and forms/ are untouched. Afterwards: node scripts/build-examples-index.js, bump V in
learn.js. A later full build-reader.py run supersedes this (its pool should then keep these too).
"""
import collections, gzip, importlib.util, json, os, re, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
spec = importlib.util.spec_from_file_location("build_reader", os.path.join(ROOT, "scripts", "build-reader.py"))
BR = importlib.util.module_from_spec(spec); spec.loader.exec_module(BR)
from reader_resolve import Resolver

LN = {"fr": "French", "de": "German"}
# a translation, not the English edition's title: at least about half as many words as the original
def real_en(t, en): return bool(en) and len(en.split()) >= max(3, 0.45 * len(t.split()))
# a periodical's name standing where an author goes (L'Anthropologie, Revue …, Bulletin …)
JOURNAL = re.compile(r"^(?:L[’']|Le |La |Les |Der |Die |Das )?[A-ZÀ-Ý][\w’'-]*(?:ologie|ographie|Zeitung|Zeitschrift|Blatt)$|^(?:Revue|Bulletin|Annales|Journal|Mercure|Archiv)\b")
BOOKREF = re.compile(r"→ISBN|\bpages? \d|\bchapter\b|\bvolume\b|\b[Aa]ct [IVX\d]|\bcanto\b|\bbook [IVX\d]")

def synth_root(lc):
    """a stand-in g/ built from the served dictionary: entry i here is lex.json row i"""
    D = os.path.join(ROOT, "reader", lc)
    lex = json.load(open(os.path.join(D, "lex.json"), encoding="utf-8"))
    tmp = tempfile.mkdtemp(prefix="carta-" + lc + "-")
    os.makedirs(os.path.join(tmp, "g"))
    os.symlink(os.path.join(ROOT, "review"), os.path.join(tmp, "review"))
    with open(os.path.join(tmp, "g", f"lex-{lc}.jsonl"), "w", encoding="utf-8") as f:
        for r in lex:
            e = {"t": r[0], "g": [r[1] or ""], "p": [p for p in (r[2] or "").split(",") if p]}
            if r[7] & 1: e["nm"] = 1
            f.write(json.dumps(e, ensure_ascii=False) + "\n")
    forms = {}
    for fn in os.listdir(os.path.join(D, "forms")):
        for surf, ids in json.load(open(os.path.join(D, "forms", fn), encoding="utf-8")).items():
            s = surf.lstrip("^")
            ts = [lex[i][0] for i in ids if i is not None and 0 <= i < len(lex) and lex[i][0] != s]
            if ts: forms.setdefault(s, [])
            for t in ts:
                if t not in forms[s]: forms[s].append(t)
    json.dump(forms, open(os.path.join(tmp, "g", f"forms-{lc}.json"), "w", encoding="utf-8"), ensure_ascii=False)
    return tmp, lex

def candidates(lc, dumps):
    out = []
    with gzip.open(os.path.join(dumps, f"kaikki-{LN[lc]}.jsonl.gz"), "rt", encoding="utf-8") as f:
        for line in f:
            d = json.loads(line)
            for s in d.get("senses", []):
                for e in s.get("examples") or []:
                    ref, en, t = e.get("ref") or "", e.get("english") or e.get("translation"), e.get("text")
                    if ref and en and t: out.append((t, ref, en))
    return out

def run(lc, dumps):
    tmp, lex = synth_root(lc)
    R = Resolver(lc, tmp)
    assert len(R.E) == len(lex)
    transparent = {r[0]: r[5] for r in lex}
    CRE = BR.canon_re(lc)
    D = os.path.join(ROOT, "reader", lc)
    idx = json.load(open(os.path.join(D, "index.json"), encoding="utf-8"))
    served = []
    for b in range(len(idx["bands"])):
        served += json.load(open(os.path.join(D, "q", f"{b}.json"), encoding="utf-8"))
    by_text = {q["t"]: q for q in served}
    per_author = collections.Counter(q["a"] for q in served)
    added = enriched = 0
    for t, ref, en in candidates(lc, dumps):
        t = re.sub(r"\s+", " ", t).strip()
        if t.startswith("„") and t.endswith("“") and t.count("„") == 1: t = t[1:-1].strip()
        en = re.sub(r"\s+", " ", en).strip()
        if not real_en(t, en): continue
        if t in by_text:                                  # already an excerpt: give it its English
            if not by_text[t].get("en"): by_text[t]["en"] = en; enriched += 1
            continue
        m = CRE.search(ref[:80])
        if not m:                                         # the build's own filters for books
            # the English edition cites books as "2008, Author, Title, page 55" (often with an ISBN):
            # those count as books too, beside the build's own cues
            if BR.PRESS.search(ref) or BR.NOTBOOK.search(ref) or not (BR.BOOKISH[lc].search(ref) or BOOKREF.search(ref)): continue
            y = BR.year_of(ref)
            if not y or y < 1850: continue
        toks = list(R.tokens(t))
        if not (6 <= len(toks) <= 45): continue
        ws = []; unk = hard = counted = 0
        for s, e, ids in toks:
            raw = t[s:e]
            if ids is None:
                if raw[:1].isupper() and s > 0 and not re.search(r"[.!?…:«»„“\"—]\s*$", t[:s]): ws.append([s, e - s, -2]); continue
                if raw.lower() in ("t",): continue
                ws.append([s, e - s, -1]); unk += 1; hard += 1; counted += 1; continue
            E = R.E[ids[0]]
            if E.get("nm"): ws.append([s, e - s, ids[0]]); continue
            ws.append([s, e - s, ids[0]] + ([ids[1]] if len(ids) > 1 else []))
            counted += 1
            if not (R.z(E["t"]) >= 5.0 or transparent.get(E["t"])): hard += 1
        if counted == 0 or unk > max(2, counted // 6): continue
        if m: author = m.group(1)
        else:
            author = re.split(r"\s*[,:(]\s*", re.sub(r"^\W*\d{4},?\s*", "", ref))[0].strip()
            if BR.BOOKISH[lc].search(author) or BR.NOTBOOK.search(author): continue
            if not (3 <= len(author) <= 40) or len(author.split()) > 5 or not re.match(r"^[A-ZÀ-Ý]", author) or re.search(r"\d", author): continue
        if not m and JOURNAL.search(author): continue
        if per_author[author] >= (300 if m else 40) and author not in ("Michel Houellebecq", "Jacques Derrida"): continue
        q = {"t": t, "r": ref[:110], "a": author, "w": ws, "h": round(hard / counted, 2), "en": en}
        y = BR.year_of(ref)
        if y: q["y"] = y
        if m: q["c"] = 1
        by_text[t] = q; per_author[author] += 1; added += 1
    dropped = 0
    for q in by_text.values():                            # the same test for English already served
        if q.get("en") and not real_en(q["t"], q["en"]): del q["en"]; dropped += 1
    kept = sorted(by_text.values(), key=lambda q: q["h"])
    for fn in os.listdir(os.path.join(D, "q")): os.unlink(os.path.join(D, "q", fn))
    BAND = 400; bands = []
    for b in range(0, len(kept), BAND):
        chunk = kept[b:b + BAND]
        with open(os.path.join(D, "q", f"{len(bands)}.json"), "w", encoding="utf-8") as f: json.dump(chunk, f, ensure_ascii=False, separators=(",", ":"))
        bands.append([chunk[0]["h"], chunk[-1]["h"]])
    ab = collections.defaultdict(list)
    for bi in range(len(bands)):
        for q in kept[bi * BAND:(bi + 1) * BAND]:
            if not ab[q["a"]] or ab[q["a"]][-1] != bi: ab[q["a"]].append(bi)
    cnt = collections.Counter(q["a"] for q in kept)
    canon = sorted({q["a"] for q in kept if q.get("c")})
    idx.update({"quotes": len(kept), "bands": bands, "ab": ab, "canon": canon, "authors": [x for x in cnt.most_common() if x[0] in set(canon)]})
    json.dump(idx, open(os.path.join(D, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    withen = sum(1 for q in kept if q.get("en"))
    print(f"{lc}: +{added} translated excerpts, {enriched} existing ones given their English, {dropped} titles-not-translations removed; {len(kept)} excerpts, {withen} with English; {len(bands)} bands", flush=True)

if __name__ == "__main__":
    dumps = sys.argv[1]
    which = (sys.argv[2:] or ["all"])[0]
    for lc in (["fr", "de"] if which == "all" else [which]): run(lc, dumps)
