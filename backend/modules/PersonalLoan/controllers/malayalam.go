package controllers

import (
	"regexp"
	"strings"
)

var wordRe = regexp.MustCompile(`[A-Za-z]+`)

var tokensByLen = [4]map[string]mlToken{
	3: {
		"chh": {base: "ഛ"},
	},
	2: {
		"kh": {base: "ഖ"},
		"gh": {base: "ഘ"},
		"ng": {base: "ങ"},
		"ch": {base: "ച"},
		"jh": {base: "ഝ"},
		"ny": {base: "ഞ"},
		"th": {base: "ത"},
		"dh": {base: "ധ"},
		"ph": {base: "ഫ"},
		"bh": {base: "ഭ"},
		"sh": {base: "ഷ"},
		"zh": {base: "ഴ"},
		"tt": {base: "ട്ട"},
		"dd": {base: "ഡ്ഡ"},
		"nn": {base: "ന്ന"},
		"mm": {base: "മ്മ"},
		"pp": {base: "പ്പ"},
		"kk": {base: "ക്ക"},
		"gg": {base: "ഗ്ഗ"},
		"bb": {base: "ബ്ബ"},
		"ss": {base: "സ്സ"},
		"ll": {base: "ല്ല"},
		"rr": {base: "റ്റ"},
		"aa": {vowel: true, base: "ആ", matra: "ാ"},
		"ee": {vowel: true, base: "ഈ", matra: "ീ"},
		"ii": {vowel: true, base: "ഈ", matra: "ീ"},
		"oo": {vowel: true, base: "ഊ", matra: "ൂ"},
		"uu": {vowel: true, base: "ഊ", matra: "ൂ"},
		"ai": {vowel: true, base: "ഐ", matra: "ൈ"},
		"au": {vowel: true, base: "ഔ", matra: "ൗ"},
	},
	1: {
		"k": {base: "ക"},
		"g": {base: "ഗ"},
		"c": {base: "ച"},
		"j": {base: "ജ"},
		"t": {base: "ത"},
		"d": {base: "ദ"},
		"n": {base: "ന"},
		"p": {base: "പ"},
		"b": {base: "ബ"},
		"m": {base: "മ"},
		"y": {base: "യ"},
		"r": {base: "ര"},
		"l": {base: "ല"},
		"v": {base: "വ"},
		"w": {base: "വ"},
		"s": {base: "സ"},
		"h": {base: "ഹ"},
		"f": {base: "ഫ"},
		"a": {vowel: true, base: "അ", matra: ""},
		"i": {vowel: true, base: "ഇ", matra: "ി"},
		"u": {vowel: true, base: "ഉ", matra: "ു"},
		"e": {vowel: true, base: "എ", matra: "െ"},
		"o": {vowel: true, base: "ഒ", matra: "ൊ"},
	},
}

var chilluSuffix = map[string]string{
	"ന്": "ൻ",
	"ണ്": "ൺ",
	"ര്": "ർ",
	"ല്": "ൽ",
	"ള്": "ൾ",
}

type mlToken struct {
	vowel bool
	base  string
	matra string
}

func ToMalayalam(s string) string {
	if strings.TrimSpace(s) == "" {
		return s
	}
	return wordRe.ReplaceAllStringFunc(s, transliterateWord)
}

func transliterateWord(word string) string {
	lower := strings.ToLower(word)
	var sb strings.Builder
	pending := ""
	flushPendingBare := func() {
		if pending != "" {
			sb.WriteString(pending)
			sb.WriteString("്")
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
					sb.WriteString(tok.base)
				}
			} else {
				flushPendingBare()
				pending = tok.base
			}
			i += length
			matched = true
			break
		}
		if !matched {
			flushPendingBare()
			sb.WriteByte(lower[i])
			i++
		}
	}
	flushPendingBare()
	result := sb.String()
	for suffix, chillu := range chilluSuffix {
		if strings.HasSuffix(result, suffix) {
			result = strings.TrimSuffix(result, suffix) + chillu
			break
		}
	}
	return result
}
