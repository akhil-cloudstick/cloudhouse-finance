package superadmin

import (
	"encoding/json"
	"testing"
)

func TestNormalizeHeaderLayout(t *testing.T) {
	t.Run("empty means classic lockup", func(t *testing.T) {
		for _, in := range []string{"", "  ", "null"} {
			got, err := normalizeHeaderLayout(in)
			if err != nil || got != "" {
				t.Fatalf("%q: got %q, %v", in, got, err)
			}
		}
	})

	t.Run("valid layout is canonicalised and clamped", func(t *testing.T) {
		got, err := normalizeHeaderLayout(`{"tree":{"dir":"row","children":["logo",{"dir":"col","children":["title","sub"]}]},
			"align":"CENTER","pad":"weird","logoShape":"wide","logoWidth":900,"titleSize":3,"subSize":8.26,"extra":1}`)
		if err != nil {
			t.Fatal(err)
		}
		var out headerLayoutOut
		if err := json.Unmarshal([]byte(got), &out); err != nil {
			t.Fatal(err)
		}
		if out.Align != "center" || out.Pad != "normal" || out.LogoShape != "wide" {
			t.Fatalf("enums: %+v", out)
		}
		if out.LogoWidth != maxHeaderLogoWidth || out.TitleSize != minHeaderTitleSize || out.SubSize != 8.5 {
			t.Fatalf("sizes: %+v", out)
		}
		if out.Tree.Dir != "row" || len(out.Tree.Children) != 2 {
			t.Fatalf("tree: %+v", out.Tree)
		}
	})

	t.Run("empty header is allowed", func(t *testing.T) {
		if _, err := normalizeHeaderLayout(`{"tree":{"dir":"col","children":[]}}`); err != nil {
			t.Fatal(err)
		}
	})

	for name, in := range map[string]string{
		"duplicate item":  `{"tree":{"dir":"row","children":["logo","logo"]}}`,
		"unknown item":    `{"tree":{"dir":"row","children":["logo","<script>"]}}`,
		"bad direction":   `{"tree":{"dir":"grid","children":["logo"]}}`,
		"bare item root":  `{"tree":"logo"}`,
		"missing tree":    `{"align":"start"}`,
		"not json":        `{tree`,
		"too many kids":   `{"tree":{"dir":"row","children":[{"dir":"col","children":[]},{"dir":"col","children":[]},{"dir":"col","children":[]},{"dir":"col","children":[]}]}}`,
		"too deep":        `{"tree":{"dir":"row","children":[{"dir":"col","children":[{"dir":"row","children":[{"dir":"col","children":[{"dir":"row","children":[{"dir":"col","children":[{"dir":"row","children":[{"dir":"col","children":["logo"]}]}]}]}]}]}]}]}}`,
	} {
		t.Run("rejects "+name, func(t *testing.T) {
			if _, err := normalizeHeaderLayout(in); err == nil {
				t.Fatalf("accepted %s", in)
			}
		})
	}
}
