package lan

import (
	"fmt"
	"strings"
)

// NetProfile is a Windows network and how it is classified. A direct cable shows up as "Unidentified network",
// which Windows treats as Public, and Public blocks incoming connections.
type NetProfile struct {
	Name      string `json:"name"`
	Interface string `json:"interface"`
	Category  string `json:"category"` // Public, Private, DomainAuthenticated
}

// ProgramRule is one Windows Firewall rule that names this very program (its exe path).
type ProgramRule struct {
	Name     string `json:"name"`
	Profiles string `json:"profiles"`
	Action   string `json:"action"` // Allow or Block
	Protocol string `json:"protocol"`
	Enabled  bool   `json:"enabled"`
}

// FirewallInfo is what this PC's firewall currently allows for the app.
type FirewallInfo struct {
	Supported bool         `json:"supported"`
	RuleTCP   bool         `json:"ruleTcp"`
	RuleUDP   bool         `json:"ruleUdp"`
	Profiles  []NetProfile `json:"profiles"`
	Error     string       `json:"error"`
	// Program is this app's exe path. ProgramChecked is false when the rule list could not be read (for example on a
	// Windows in another language), so "no block found" is never claimed without having looked.
	Program        string        `json:"program"`
	ProgramChecked bool          `json:"programChecked"`
	ProgramRules   []ProgramRule `json:"programRules"`
}

// BlockedRules are the enabled Block rules for this program. A Block rule beats every Allow rule, so while one exists
// no amount of port rules lets other PCs in on the networks it covers.
func (f FirewallInfo) BlockedRules() []ProgramRule {
	var out []ProgramRule
	for _, r := range f.ProgramRules {
		if r.Enabled && strings.EqualFold(r.Action, "Block") {
			out = append(out, r)
		}
	}
	return out
}

// AllowResult is the outcome of Allow network access.
type AllowResult struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

func ruleNameTCP(port int) string { return fmt.Sprintf("Cloudhouse LAN TCP %d", port) }
func ruleNameUDP(port int) string { return fmt.Sprintf("Cloudhouse LAN UDP %d", port) }

// the two program rules Allow network access adds (they name the exe, so they hold whatever port is used)
const (
	ruleProgTCP = "Cloudhouse LAN app TCP"
	ruleProgUDP = "Cloudhouse LAN app UDP"
)

// inPlace says whether everything Allow network access sets up is already there: both port rules, both program rules
// switched on and allowing, and no Block rule for this program. It is only true when the rule list was really read, so a
// Windows whose labels could not be understood never skips the permission prompt by mistake.
func (f FirewallInfo) inPlace() bool {
	if !f.Supported || !f.RuleTCP || !f.RuleUDP || !f.ProgramChecked || len(f.BlockedRules()) > 0 {
		return false
	}
	have := map[string]bool{}
	for _, r := range f.ProgramRules {
		if r.Enabled && strings.EqualFold(r.Action, "Allow") {
			have[r.Name] = true
		}
	}
	return have[ruleProgTCP] && have[ruleProgUDP]
}

// parseProgramRules picks the rules that name exe out of the text `netsh advfirewall firewall show rule name=all dir=in
// verbose` prints. It returns how many rules it understood, so a list it could not read (the labels are translated on a
// Windows in another language) is told apart from a list with no rule for this program.
func parseProgramRules(raw, exe string) (rules []ProgramRule, understood int) {
	want := strings.ToLower(strings.TrimSpace(exe))
	for _, rec := range strings.Split("\n"+strings.ReplaceAll(raw, "\r", ""), "\nRule Name:")[1:] {
		lines := strings.Split(rec, "\n")
		field := func(key string) string {
			for _, l := range lines[1:] {
				if k, v, ok := strings.Cut(l, ":"); ok && strings.EqualFold(strings.TrimSpace(k), key) {
					return strings.TrimSpace(v)
				}
			}
			return ""
		}
		if field("Action") == "" {
			continue
		}
		understood++
		if prog := strings.ToLower(field("Program")); prog == "" || prog != want {
			continue
		}
		rules = append(rules, ProgramRule{
			Name:     strings.TrimSpace(lines[0]),
			Profiles: field("Profiles"),
			Action:   field("Action"),
			Protocol: field("Protocol"),
			Enabled:  strings.EqualFold(field("Enabled"), "Yes"),
		})
	}
	return rules, understood
}

// FirewallInfo reads the firewall state without changing anything.
func (a *Agent) FirewallInfo() FirewallInfo {
	return queryFirewall(a.cfg.HTTPPort, a.cfg.DiscoveryPort)
}

// AllowAccess removes any rule that blocks this program, then adds the allow rules (one Windows permission prompt) and
// checks they are in place.
func (a *Agent) AllowAccess() AllowResult {
	// the rules stay in Windows between runs, so when all of them are already right there is nothing to ask permission for
	if info := a.FirewallInfo(); info.inPlace() {
		msg := fmt.Sprintf("Network access is already set up (TCP %d, UDP %d, and this program is allowed, nothing blocks it). No permission prompt was needed.", a.cfg.HTTPPort, a.cfg.DiscoveryPort)
		a.log.Log("ok", "FIREWALL", "%s", msg)
		a.clearDrift()
		return AllowResult{OK: true, Message: msg}
	}
	a.log.Log("info", "FIREWALL", "adding inbound rules for TCP %d and UDP %d and clearing any block on this program (Windows will ask for permission)", a.cfg.HTTPPort, a.cfg.DiscoveryPort)
	res := allowAccess(a.cfg.HTTPPort, a.cfg.DiscoveryPort)
	if res.OK {
		a.clearDrift()
		a.log.Log("ok", "FIREWALL", "%s", res.Message)
	} else {
		a.log.Log("error", "FIREWALL", "%s", res.Message)
	}
	return res
}
