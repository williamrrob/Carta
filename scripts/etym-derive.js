/*
 * etym-derive.js — the plain-prose etymologies etym-parse.js leaves empty: derivations
 * inside one language, which Wiktionary often writes without naming the language.
 *
 *   "Compound of melon + head."            → parts melon, head
 *   "Latin fēmina + -ist + -in"            → parts Latin fēmina, -ist, -in
 *   "From nachlassen."                     → parent nachlassen
 *   "Deverbal from annoncer."              → parent annoncer
 *   "Substantivization of the verb schweigen." / "Clipping of barjot" / "Variant of …"
 *
 * Guard: a same-language form is only accepted if it is a real headword of that language
 * (`isWord(t)`); otherwise nothing is returned. Foreign parts need a named language.
 *
 *   derive(word, prose, isWord, langNames) → null | { parts:[{l,t,aff}], parent:{l,t,k} }
 */
"use strict";

const LEAD_ONE = new RegExp(
  "^(?:(?:\\(\\d{3,4}\\)\\s*)?" +
    "(?:from|deverbal (?:noun )?(?:from|of)|clipping of|clipped from|shortening of|short for|shortened from|" +
    "back-?formation from|abbreviation of|ellipsis of|contraction of|alteration of|variant of|diminutive of|" +
    "augmentative of|nominali[sz]ation of|nominali[sz]ed (?:\\w+ )?(?:form )?of|substantivi[sz]ation of|" +
    "substantivi[sz]ed (?:\\w+ )?of|verbal noun of|agent noun of|derived from|derivation of|univerbation of|" +
    "(?:a )?(?:feminine|masculine|female|male) (?:equivalent|form) of|conversion of|zero-derivation from|" +
    "denominal (?:verb )?(?:from|of)|deadjectival (?:noun )?(?:from|of)|frequentative of|intensive of|" +
    "pejorative of|respelling of|spelling (?:variant )?of|informal form of|colloquial form of))\\s+" +
    "(?:the\\s+)?(?:(?:past|present) participle (?:of\\s+)?|infinitive (?:of\\s+)?|(?:verb|noun|adjective|adverb|stem|root|word)\\s+)?" +
    "(?:of\\s+)?(?:the\\s+)?(?:(?:verb|noun|adjective|adverb)\\s+)?",
  "i",
);
const LEAD_PARTS = /^(?:\(\d{3,4}\)\s*)?(?:from|compound of|blend of|univerbation of|equivalent to|by surface analysis,?|surface analysis|formed from|composed of|derived from)?\s*/i;
const TOKEN = /^[\p{L}\p{M}'’-]+$/u;

function clean(prose) {
  let s = String(prose || "").replace(/\s+/g, " ").trim();
  // first sentence only; glosses and parentheticals out
  s = s.replace(/\(\s*\d{3,4}\s*\)\s*/, "");
  s = s.split(/(?<=[.;])\s|\. ?$/)[0] || s;
  s = s.replace(/\([^()]*\)/g, " ").replace(/“[^”]*”|"[^"]*"|‘[^’]*’/g, " ").replace(/\s+/g, " ").trim();
  return s.replace(/[.;:,]+$/, "").trim();
}

function derive(word, prose, isWord, langNames, selfLang) {
  const s = clean(prose);
  if (!s) return null;
  const langRe = new RegExp("^(" + langNames.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\s+(\\S+)$");
  const same = (t) => t && t !== word && (isWord(t) || isWord(t.toLowerCase()) || isWord(t[0].toUpperCase() + t.slice(1)));
  const isAff = (t) => /^-|-$/.test(t);
  // parts: "A + B (+ C)"
  if (/\s\+\s/.test(s)) {
    const body = s.replace(LEAD_PARTS, "").split(/,|\bor\b|\bwith\b/)[0];
    const pieces = body.split(/\s\+\s/).map((x) => x.trim()).filter(Boolean);
    if (pieces.length >= 2 && pieces.length <= 4) {
      const parts = [];
      for (const p of pieces) {
        const m = p.match(langRe);
        if (m && TOKEN.test(m[2])) { parts.push({ l: m[1], t: m[2], aff: isAff(m[2]) }); continue; }
        const t = p.replace(/^(?:the|a|an)\s+/i, "");
        if (!TOKEN.test(t)) return null;
        if (isAff(t)) { parts.push({ l: selfLang, t, aff: true }); continue; }
        if (!same(t)) return null;
        parts.push({ l: selfLang, t, aff: false });
      }
      if (parts.some((p) => !p.aff)) return { parts, parent: null };
    }
    return null;
  }
  // one parent in the same language
  const m = s.match(LEAD_ONE);
  if (!m) return null;
  const rest = s.slice(m[0].length).trim();
  const t = rest.split(/\s/)[0].replace(/[.,;:]+$/, "");
  if (!TOKEN.test(t) || isAff(t)) return null;
  // the sentence must end at the word (or a comma) — "From X, from Latin …" belongs to etym-parse
  const tail = rest.slice(t.length).trim();
  if (tail && !/^,/.test(tail)) return null;
  if (!same(t)) return null;
  return { parts: [], parent: { l: selfLang, t, k: "der" } };
}

module.exports = { derive, clean };
