package personalloan

import (
	"regexp"
	"strings"
)

// ToMalayalam is a best-effort phonetic Roman→Malayalam transliterator, used
// to print the bond document (bond.go) in Malayalam script even though names/
// places are stored in the database in English (that's how they're entered
// via the customer form — there is no Malayalam-script input anywhere in
// this app). It follows the same general scheme most Indic "phonetic" input
// methods use (often called "Mozhi"): common consonant digraphs (th, zh, ng,
// sh, ...) map to a single Malayalam letter, vowels attach as a matra (vowel
// sign) to the preceding consonant or stand alone as an independent vowel
// glyph at the start of a word or after another vowel, consonant clusters
// get a virama (chandrakkala) between them, and a handful of word-final
// consonants get their "chillu" form instead of a bare virama.
//
// This is NOT a dictionary or a machine-learning transliterator — it cannot
// know that, say, "Sooraj" should keep a long ൂ while "Suresh" should not;
// it just applies the same greedy longest-match rule everywhere. For common
// Malayalam names/places built from the digraphs below it reads correctly;
// for names with unusual spelling or non-Indian origin it will produce a
// plausible-looking but not necessarily correct rendering. This tradeoff was
// discussed and explicitly accepted (see conversation): the alternative,
// collecting a hand-typed Malayalam-script name at customer entry, was
// rejected in favour of zero extra data entry.
func ToMalayalam(s string) string {
	if strings.TrimSpace(s) == "" {
		return s
	}
	return wordRe.ReplaceAllStringFunc(s, transliterateWord)
}

// wordRe matches runs of Latin letters — everything else (spaces, digits,
// punctuation, an already-Malayalam substring) passes through untouched.
var wordRe = regexp.MustCompile(`[A-Za-z]+`)

const virama = "്" // ചന്ദ്രക്കല / chandrakkala — "no vowel follows this consonant"

type mlToken struct {
	vowel bool
	base  string // consonant base glyph (vowel==false), or the independent vowel glyph (vowel==true)
	matra string // vowel sign attached to a preceding consonant (vowel==true only); "" for inherent 'a'
}

// tokensByLen is consulted longest-match-first at every position, which is
// what makes e.g. "th" resolve to ത instead of ത + ഹ (from "t" then "h"
// matching separately) — digraphs MUST be tried before their component
// single letters.
var tokensByLen = [4]map[string]mlToken{
	3: {
		"chh": {base: "ഛ"}, // ഛ
	},
	2: {
		// aspirated / nasal consonant digraphs
		"kh": {base: "ഖ"}, // ഖ
		"gh": {base: "ഘ"}, // ഘ
		"ng": {base: "ങ"}, // ങ
		"ch": {base: "ച"}, // ച
		"jh": {base: "ഝ"}, // ഝ
		"ny": {base: "ഞ"}, // ഞ
		"th": {base: "ത"}, // ത (dental t — matches common names like "Thomman"→തൊമ്മാന)
		"dh": {base: "ധ"}, // ധ
		"ph": {base: "ഫ"}, // ഫ
		"bh": {base: "ഭ"}, // ഭ
		"sh": {base: "ഷ"}, // ഷ (retroflex sh — common in names, e.g. "Basheer"→ബഷീർ)
		"zh": {base: "ഴ"}, // ഴ (a sound with no English letter — the classic transliteration digraph)
		// geminated (doubled) consonants — rendered as base+virama+base
		"tt": {base: "ട്ട"}, // ട്ട
		"dd": {base: "ഡ്ഡ"}, // ഡ്ഡ
		"nn": {base: "ന്ന"}, // ന്ന
		"mm": {base: "മ്മ"}, // മ്മ
		"pp": {base: "പ്പ"}, // പ്പ
		"kk": {base: "ക്ക"}, // ക്ക
		"gg": {base: "ഗ്ഗ"}, // ഗ്ഗ
		"bb": {base: "ബ്ബ"}, // ബ്ബ
		"ss": {base: "സ്സ"}, // സ്സ
		"ll": {base: "ല്ല"}, // ല്ല
		"rr": {base: "റ്റ"}, // റ്റ (the classic Malayalam "otta" doubling)
		// vowel digraphs (long vowels / diphthongs)
		"aa": {vowel: true, base: "ആ", matra: "ാ"}, // ആ / ാ
		"ee": {vowel: true, base: "ഈ", matra: "ീ"}, // ഈ / ീ
		"ii": {vowel: true, base: "ഈ", matra: "ീ"}, // ഈ / ീ
		"oo": {vowel: true, base: "ഊ", matra: "ൂ"}, // ഊ / ൂ
		"uu": {vowel: true, base: "ഊ", matra: "ൂ"}, // ഊ / ൂ
		"ai": {vowel: true, base: "ഐ", matra: "ൈ"}, // ഐ / ൈ
		"au": {vowel: true, base: "ഔ", matra: "ൗ"}, // ഔ / ൗ
	},
	1: {
		"k": {base: "ക"},                          // ക
		"g": {base: "ഗ"},                          // ഗ
		"c": {base: "ച"},                          // ച
		"j": {base: "ജ"},                          // ജ
		"t": {base: "ത"},                          // ത (dental — see note on "th")
		"d": {base: "ദ"},                          // ദ
		"n": {base: "ന"},                          // ന
		"p": {base: "പ"},                          // പ
		"b": {base: "ബ"},                          // ബ
		"m": {base: "മ"},                          // മ
		"y": {base: "യ"},                          // യ
		"r": {base: "ര"},                          // ര
		"l": {base: "ല"},                          // ല
		"v": {base: "വ"},                          // വ
		"w": {base: "വ"},                          // വ
		"s": {base: "സ"},                          // സ
		"h": {base: "ഹ"},                          // ഹ
		"f": {base: "ഫ"},                          // ഫ
		"a": {vowel: true, base: "അ", matra: ""},  // അ (inherent — no matra needed after a consonant)
		"i": {vowel: true, base: "ഇ", matra: "ി"}, // ഇ / ി
		"u": {vowel: true, base: "ഉ", matra: "ു"}, // ഉ / ു
		"e": {vowel: true, base: "എ", matra: "െ"}, // എ / െ
		"o": {vowel: true, base: "ഒ", matra: "ൊ"}, // ഒ / ൊ
	},
}

// chilluSuffix maps a word-final "consonant + virama" sequence to its
// chillu (pure-consonant, no vowel, no visible virama) form — standard
// Malayalam orthography prefers e.g. ർ over ര് at the end of a word.
var chilluSuffix = map[string]string{
	"ന്": "ൻ", // ന് → ൻ
	"ണ്": "ൺ", // ണ് → ൺ
	"ര്": "ർ", // ര് → ർ
	"ല്": "ൽ", // ല് → ൽ
	"ള്": "ൾ", // ള് → ൾ
}

// transliterateWord converts one run of Latin letters into Malayalam script
// using greedy longest-match tokenization (see tokensByLen's comment).
func transliterateWord(word string) string {
	lower := strings.ToLower(word)
	var sb strings.Builder
	pending := "" // a consonant base glyph waiting to find out if a vowel follows it

	flushPendingBare := func() {
		if pending != "" {
			sb.WriteString(pending)
			sb.WriteString(virama)
			pending = ""
		}
	}

	i := 0
	for i < len(lower) {
		matched := false
		for length := 3; length >= 1; length-- {
			if i+length > len(lower) {
				continue
			}
			tok, ok := tokensByLen[length][lower[i:i+length]]
			if !ok {
				continue
			}
			if tok.vowel {
				if pending != "" {
					sb.WriteString(pending)
					if tok.matra != "" {
						sb.WriteString(tok.matra)
					}
					pending = ""
				} else {
					sb.WriteString(tok.base) // independent vowel form
				}
			} else {
				flushPendingBare() // previous consonant had no vowel — it's a cluster, needs a virama
				pending = tok.base
			}
			i += length
			matched = true
			break
		}
		if !matched {
			// Character we don't have a mapping for (stray punctuation
			// caught inside a "word" by the regex, unlikely in practice) —
			// close out whatever consonant is pending and pass it through
			// unchanged rather than silently dropping it.
			flushPendingBare()
			sb.WriteByte(lower[i])
			i++
		}
	}
	flushPendingBare() // a word ending in a bare consonant sound, e.g. "Basheer"'s final r

	result := sb.String()
	for suffix, chillu := range chilluSuffix {
		if strings.HasSuffix(result, suffix) {
			result = strings.TrimSuffix(result, suffix) + chillu
			break
		}
	}
	return result
}
