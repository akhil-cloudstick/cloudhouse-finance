package lan

import (
	"strings"
	"testing"
)

func allowedInfo() FirewallInfo {
	return FirewallInfo{
		Supported: true, RuleTCP: true, RuleUDP: true, ProgramChecked: true,
		ProgramRules: []ProgramRule{
			{Name: ruleProgTCP, Action: "Allow", Enabled: true},
			{Name: ruleProgUDP, Action: "Allow", Enabled: true},
		},
	}
}

func TestAllowNetworkAccessIsSkippedOnlyWhenEverythingIsInPlace(t *testing.T) {
	if !allowedInfo().inPlace() {
		t.Fatal("all rules present and nothing blocking: nothing to ask permission for")
	}
	cases := map[string]func(*FirewallInfo){
		"port rule missing":         func(f *FirewallInfo) { f.RuleUDP = false },
		"program rule missing":      func(f *FirewallInfo) { f.ProgramRules = f.ProgramRules[:1] },
		"program rule switched off": func(f *FirewallInfo) { f.ProgramRules[0].Enabled = false },
		"a block rule exists": func(f *FirewallInfo) {
			f.ProgramRules = append(f.ProgramRules, ProgramRule{Name: "Block", Action: "Block", Enabled: true})
		},
		"rule list not understood": func(f *FirewallInfo) { f.ProgramChecked = false },
		"not Windows":              func(f *FirewallInfo) { f.Supported = false },
	}
	for name, mutate := range cases {
		f := allowedInfo()
		mutate(&f)
		if f.inPlace() {
			t.Errorf("%s: the permission prompt must not be skipped", name)
		}
	}
}

func TestLostFirewallRulesAreReportedOnceAndOnlyAfterTheyWereInPlace(t *testing.T) {
	a := New(Config{DataDir: t.TempDir(), HTTPPort: 19125, DiscoveryPort: 19126})
	missing := []string{ruleProgTCP}
	a.fwCheck = func() ([]string, bool) { return missing, true }

	a.checkDrift() // the rules were never in place on this PC: no alarm
	if a.Status().FirewallDrift != "" {
		t.Fatal("rules that were never added must not raise an alarm")
	}

	missing = nil
	a.checkDrift() // everything is there: remembered
	missing = []string{ruleProgTCP, ruleProgUDP}
	a.checkDrift()
	if d := a.Status().FirewallDrift; !strings.Contains(d, ruleProgTCP) || !strings.Contains(d, "Allow network access") {
		t.Fatalf("lost rules must be reported with the fix, got %q", d)
	}
	lines := 0
	for _, e := range a.log.Entries() {
		if e.Component == "FIREWALL" && e.Level == "error" {
			lines++
		}
	}
	a.checkDrift() // same loss again: no second log line
	after := 0
	for _, e := range a.log.Entries() {
		if e.Component == "FIREWALL" && e.Level == "error" {
			after++
		}
	}
	if lines != 1 || after != 1 {
		t.Fatalf("the loss must be logged once, got %d then %d", lines, after)
	}

	missing = nil
	a.checkDrift()
	if a.Status().FirewallDrift != "" {
		t.Fatal("the warning must clear when the rules are back")
	}
}
