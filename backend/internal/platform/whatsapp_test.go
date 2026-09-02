package platform

import "testing"

// Regression test for the bug where an 11-digit number entered with a
// leading trunk "0" (e.g. "09048300196") produced an invalid, country-code
// -less chat id — OpenWA/Puppeteer then failed to resolve it and the
// message silently never reached that customer while a clean 10-digit
// number sent alongside it worked fine.
func TestToChatID(t *testing.T) {
	cases := []struct {
		name  string
		phone string
		want  string
	}{
		{"plain 10-digit", "9048300196", "919048300196@c.us"},
		{"leading trunk zero", "09048300196", "919048300196@c.us"},
		{"already has country code", "919048300196", "919048300196@c.us"},
		{"punctuated with country code", "+91 90483 00196", "919048300196@c.us"},
		{"punctuated 10-digit", "90483-00196", "919048300196@c.us"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := toChatID(c.phone); got != c.want {
				t.Errorf("toChatID(%q) = %q, want %q", c.phone, got, c.want)
			}
		})
	}
}
