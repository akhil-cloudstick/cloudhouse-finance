package superadmin

import (
	"bytes"
	"encoding/json"
	"strings"

	"cloudhouse/backend/internal/platform/httpx"
)

// The sidebar header a vendor arranges in the console's Branding step.
//
// The console sends it as JSON and the tenant row stores it as JSON, but it
// is never stored as received: normalizeHeaderLayout re-builds it from a
// closed vocabulary, so the row only ever holds a shape the frontend knows how
// to draw. Anything else is a 400 rather than a silently half-applied layout.
//
// The arrangement is a small tree. A node lays its children out in a row or a
// column; a leaf is one of the three header items. For example, a logo beside
// a title stacked over a subtitle:
//
//	{"dir":"row","children":["logo",{"dir":"col","children":["title","sub"]}]}

const (
	maxHeaderLayoutBytes = 2000
	maxHeaderDepth       = 6

	minHeaderLogoWidth     = 24
	maxHeaderLogoWidth     = 212
	defaultHeaderLogoWidth = 48
	minHeaderTitleSize     = 10
	maxHeaderTitleSize     = 40
	minHeaderSubSize       = 6
	maxHeaderSubSize       = 16
)

var (
	headerItems      = []string{"logo", "title", "sub"}
	headerDirs       = []string{"row", "col"}
	headerAligns     = []string{"start", "center", "spread"}
	headerPads       = []string{"normal", "compact", "roomy"}
	headerLogoShapes = []string{"square", "wide"}
)

var errBadHeaderLayout = httpx.NewBadRequest("invalid sidebar header layout")

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
	// TitleSize/SubSize are pixel sizes; 0 means "size automatically from the
	// text's length", the same steps the classic lockup uses.
	TitleSize float64 `json:"titleSize"`
	SubSize   float64 `json:"subSize"`
}

// normalizeHeaderLayout validates a layout from the console and returns its
// canonical JSON. An empty input returns "" (the classic lockup).
func normalizeHeaderLayout(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" {
		return "", nil
	}
	if len(raw) > maxHeaderLayoutBytes {
		return "", errBadHeaderLayout
	}
	var in headerLayoutIn
	dec := json.NewDecoder(bytes.NewReader([]byte(raw)))
	if err := dec.Decode(&in); err != nil {
		return "", errBadHeaderLayout
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
		LogoWidth: defaultHeaderLogoWidth,
		TitleSize: sizeOrAuto(in.TitleSize, minHeaderTitleSize, maxHeaderTitleSize),
		SubSize:   sizeOrAuto(in.SubSize, minHeaderSubSize, maxHeaderSubSize),
	}
	if in.LogoWidth > 0 {
		out.LogoWidth = int(clampFloat(in.LogoWidth, minHeaderLogoWidth, maxHeaderLogoWidth) + 0.5)
	}
	b, err := json.Marshal(out)
	if err != nil {
		return "", errBadHeaderLayout
	}
	return string(b), nil
}

// parseHeaderNode accepts only a node object at this position. Leaves are
// handled by the caller so the root can never be a bare item.
func parseHeaderNode(raw json.RawMessage, depth int, seen map[string]bool) (headerNode, error) {
	if depth > maxHeaderDepth {
		return headerNode{}, errBadHeaderLayout
	}
	var n struct {
		Dir      string            `json:"dir"`
		Children []json.RawMessage `json:"children"`
	}
	if err := json.Unmarshal(raw, &n); err != nil || !inSet(n.Dir, headerDirs) {
		return headerNode{}, errBadHeaderLayout
	}
	// Three items exist in total, so no node can legitimately hold more.
	if len(n.Children) > len(headerItems) {
		return headerNode{}, errBadHeaderLayout
	}
	out := headerNode{Dir: n.Dir, Children: []any{}}
	for _, c := range n.Children {
		var item string
		if err := json.Unmarshal(c, &item); err == nil {
			if !inSet(item, headerItems) || seen[item] {
				return headerNode{}, errBadHeaderLayout
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

// pick returns v when it is in the closed set, otherwise the set's first
// entry, which is each field's default.
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
	// Half-pixel steps are all the console's resize handle produces.
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

// inSet is a strict membership test: unlike oneOf, an empty value is NOT
// accepted, because nothing in a layout has an "empty means default" meaning.
func inSet(v string, set []string) bool {
	for _, a := range set {
		if v == a {
			return true
		}
	}
	return false
}
