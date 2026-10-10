package controllers

import (
	"bytes"
	common "cloudhouse/backend/common/controllers"
	"encoding/json"
	"strings"
)

var (
	headerItems      = []string{"logo", "title", "sub"}
	headerDirs       = []string{"row", "col"}
	headerAligns     = []string{"start", "center", "spread"}
	headerPads       = []string{"normal", "compact", "roomy"}
	headerLogoShapes = []string{"square", "wide"}
)

type headerLayoutIn struct {
	Tree      json.RawMessage `json:"tree"`
	Align     string          `json:"align"`
	Pad       string          `json:"pad"`
	LogoShape string          `json:"logoShape"`
	LogoWidth float64         `json:"logoWidth"`
	TitleSize float64         `json:"titleSize"`
	SubSize   float64         `json:"subSize"`
}

type headerNode struct {
	Dir      string `json:"dir"`
	Children []any  `json:"children"`
}

type headerLayoutOut struct {
	V         int        `json:"v"`
	Tree      headerNode `json:"tree"`
	Align     string     `json:"align"`
	Pad       string     `json:"pad"`
	LogoShape string     `json:"logoShape"`
	LogoWidth int        `json:"logoWidth"`
	TitleSize float64    `json:"titleSize"`
	SubSize   float64    `json:"subSize"`
}

func normalizeHeaderLayout(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" {
		return "", nil
	}
	if len(raw) > 2000 {
		return "", common.NewBadRequest("invalid sidebar header layout")
	}
	var in headerLayoutIn
	dec := json.NewDecoder(bytes.NewReader([]byte(raw)))
	if err := dec.Decode(&in); err != nil {
		return "", common.NewBadRequest("invalid sidebar header layout")
	}
	seen := map[string]bool{}
	tree, err := parseHeaderNode(in.Tree, 0, seen)
	if err != nil {
		return "", err
	}
	out := headerLayoutOut{
		V:         1,
		Tree:      tree,
		Align:     pick(in.Align, headerAligns),
		Pad:       pick(in.Pad, headerPads),
		LogoShape: pick(in.LogoShape, headerLogoShapes),
		LogoWidth: 48,
		TitleSize: sizeOrAuto(in.TitleSize, 10, 40),
		SubSize:   sizeOrAuto(in.SubSize, 6, 16),
	}
	if in.LogoWidth > 0 {
		out.LogoWidth = int(clampFloat(in.LogoWidth, 24, 212) + 0.5)
	}
	b, err := json.Marshal(out)
	if err != nil {
		return "", common.NewBadRequest("invalid sidebar header layout")
	}
	return string(b), nil
}

func parseHeaderNode(raw json.RawMessage, depth int, seen map[string]bool) (headerNode, error) {
	if depth > 6 {
		return headerNode{}, common.NewBadRequest("invalid sidebar header layout")
	}
	var n struct {
		Dir      string            `json:"dir"`
		Children []json.RawMessage `json:"children"`
	}
	if err := json.Unmarshal(raw, &n); err != nil || !inSet(n.Dir, headerDirs) {
		return headerNode{}, common.NewBadRequest("invalid sidebar header layout")
	}
	if len(n.Children) > len(headerItems) {
		return headerNode{}, common.NewBadRequest("invalid sidebar header layout")
	}
	out := headerNode{Dir: n.Dir, Children: []any{}}
	for _, c := range n.Children {
		var item string
		if err := json.Unmarshal(c, &item); err == nil {
			if !inSet(item, headerItems) || seen[item] {
				return headerNode{}, common.NewBadRequest("invalid sidebar header layout")
			}
			seen[item] = true
			out.Children = append(out.Children, item)
			continue
		}
		child, err := parseHeaderNode(c, depth+1, seen)
		if err != nil {
			return headerNode{}, err
		}
		out.Children = append(out.Children, child)
	}
	return out, nil
}

func pick(v string, set []string) string {
	v = strings.TrimSpace(strings.ToLower(v))
	if inSet(v, set) {
		return v
	}
	return set[0]
}

func sizeOrAuto(v float64, lo, hi float64) float64 {
	if v <= 0 {
		return 0
	}
	return float64(int(clampFloat(v, lo, hi)*2+0.5)) / 2
}

func clampFloat(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func inSet(v string, set []string) bool {
	for _, a := range set {
		if v == a {
			return true
		}
	}
	return false
}
