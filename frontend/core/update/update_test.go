package update

import "testing"

func TestSemverGreater(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"0.2.0", "0.1.0", true},
		{"0.1.0", "0.2.0", false},
		{"0.1.0", "0.1.0", false},
		{"1.0.0", "0.9.9", true},
		{"0.10.0", "0.9.0", true},
		{"v1.2.3", "1.2.2", true},
		{"1.0.0", "1.0.0-test", true},
		{"1.0.0-test", "1.0.0", false},
	}
	for _, c := range cases {
		if got := SemverGreater(c.a, c.b); got != c.want {
			t.Errorf("SemverGreater(%q, %q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}
