package lan

import (
	"fmt"
	"strings"
	"time"
)

// Step is one line of the self-test, with the fix to try when it did not pass.
type Step struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"` // pass, warn, fail, skip
	Detail string `json:"detail"`
	Fix    string `json:"fix"`
}

// SelfTest checks everything the cable connection depends on, in order, and says what to do about each failure.
// peerTarget is the PC to test against ("ip" or "ip:port"); empty means the first PC found.
func (a *Agent) SelfTest(peerTarget string) []Step {
	a.log.Log("info", "SELFTEST", "self-test started")
	var steps []Step
	add := func(s Step) {
		steps = append(steps, s)
		lvl := map[string]string{"pass": "ok", "warn": "warn", "fail": "error", "skip": "info"}[s.Status]
		msg := fmt.Sprintf("%s: %s", s.Title, strings.ToUpper(s.Status))
		if s.Detail != "" {
			msg += " - " + s.Detail
		}
		if s.Fix != "" && s.Status != "pass" {
			msg += " Fix: " + s.Fix
		}
		a.log.Log(lvl, "SELFTEST", "%s", msg)
	}

	// 1. network addresses
	rep := ScanInterfaces()
	switch {
	case len(rep.Usable) > 0:
		var parts []string
		for _, i := range rep.Usable {
			p := i.Name + " " + i.IP
			if i.LinkLocal {
				p += " (direct cable address)"
			}
			parts = append(parts, p)
		}
		add(Step{ID: "iface", Title: "Network address", Status: "pass", Detail: strings.Join(parts, "; ")})
	case len(rep.NoAddress) > 0:
		add(Step{ID: "iface", Title: "Network address", Status: "fail",
			Detail: strings.Join(rep.NoAddress, ", ") + " is connected but has no IPv4 address yet.",
			Fix:    "Wait up to a minute: on a direct cable Windows assigns a 169.254.x.x address by itself. If it never does, set a fixed IP on both PCs (for example 192.168.10.1 and 192.168.10.2, mask 255.255.255.0)."})
	default:
		add(Step{ID: "iface", Title: "Network address", Status: "fail", Detail: "No connected network card found.", Fix: "Plug in the LAN cable (or connect Wi-Fi) and check the cable light."})
	}

	// 1b. several cards on the 169.254.x.x range
	if ov := overlappingLinkLocal(rep.Usable); ov != nil {
		add(Step{ID: "overlap", Title: "Cards on the same range", Status: "warn",
			Detail: strings.Join(ov, ", ") + " all have 169.254.x.x addresses.",
			Fix:    "The app tries each card, so this usually still works. If a connection test fails, switch off the card that is not the cable (for example Tailscale, or Wi-Fi) and run the test again."})
	} else {
		add(Step{ID: "overlap", Title: "Cards on the same range", Status: "pass", Detail: "No two cards share the 169.254.x.x range."})
	}

	// 2 and 3. Windows network type and firewall rule
	fw := a.FirewallInfo()
	switch {
	case !fw.Supported:
		add(Step{ID: "profile", Title: "Network type", Status: "skip", Detail: "Only checked on Windows."})
		add(Step{ID: "firewall", Title: "Firewall rule", Status: "skip", Detail: "Only checked on Windows."})
		add(Step{ID: "program", Title: "Windows blocks this program", Status: "skip", Detail: "Only checked on Windows."})
	default:
		ruleOK := fw.RuleTCP && fw.RuleUDP
		if fw.Error != "" {
			add(Step{ID: "profile", Title: "Network type", Status: "warn", Detail: fw.Error})
		} else {
			var public []string
			var all []string
			for _, p := range fw.Profiles {
				all = append(all, p.Interface+" = "+p.Category)
				if p.Category == "Public" {
					public = append(public, p.Interface)
				}
			}
			detail := strings.Join(all, "; ")
			if detail == "" {
				detail = "No network profile reported."
			}
			if len(public) > 0 && !ruleOK {
				add(Step{ID: "profile", Title: "Network type", Status: "warn",
					Detail: detail + ". Public networks (a direct cable counts as one) block incoming connections.",
					Fix:    "Press Allow network access, or switch the network to Private in Windows settings."})
			} else {
				add(Step{ID: "profile", Title: "Network type", Status: "pass", Detail: detail})
			}
		}
		if ruleOK {
			add(Step{ID: "firewall", Title: "Firewall rule", Status: "pass", Detail: fmt.Sprintf("Inbound TCP %d and UDP %d are allowed.", a.cfg.HTTPPort, a.cfg.DiscoveryPort)})
		} else {
			var missing []string
			if !fw.RuleTCP {
				missing = append(missing, fmt.Sprintf("TCP %d", a.cfg.HTTPPort))
			}
			if !fw.RuleUDP {
				missing = append(missing, fmt.Sprintf("UDP %d", a.cfg.DiscoveryPort))
			}
			add(Step{ID: "firewall", Title: "Firewall rule", Status: "fail",
				Detail: "No inbound rule for " + strings.Join(missing, " and ") + ". Other PCs cannot reach this one.",
				Fix:    "Press Allow network access and choose Yes on the Windows prompt."})
		}

		// a Block rule for this very program overrides every Allow rule above, on the networks it covers
		switch blocked := fw.BlockedRules(); {
		case len(blocked) > 0:
			var parts []string
			for _, r := range blocked {
				parts = append(parts, fmt.Sprintf("%s (%s, %s)", r.Name, r.Protocol, r.Profiles))
			}
			add(Step{ID: "program", Title: "Windows blocks this program", Status: "fail",
				Detail: "A Block rule names " + fw.Program + ": " + strings.Join(parts, "; ") + ". A Block rule overrides the Allow rules, so other PCs are dropped on those network types.",
				Fix:    "Press Allow network access. It removes the Block rule for this program and allows it on every network type."})
		case !fw.ProgramChecked:
			add(Step{ID: "program", Title: "Windows blocks this program", Status: "warn",
				Detail: "The Windows rule list could not be read (it may be in another language), so a Block rule cannot be ruled out.",
				Fix:    "Press Allow network access: it clears any Block rule for this program regardless."})
		default:
			add(Step{ID: "program", Title: "Windows blocks this program", Status: "pass", Detail: "No Block rule names " + fw.Program + "."})
		}
	}

	// 4. ports
	st := a.Status()
	switch {
	case st.TCPListening && st.UDPListening:
		add(Step{ID: "ports", Title: "Ports open in the app", Status: "pass", Detail: fmt.Sprintf("Listening on TCP %d and UDP %d.", st.HTTPPort, st.DiscoveryPort)})
	default:
		var problems []string
		if st.TCPError != "" {
			problems = append(problems, st.TCPError)
		}
		if st.UDPError != "" {
			problems = append(problems, st.UDPError)
		}
		add(Step{ID: "ports", Title: "Ports open in the app", Status: "fail", Detail: strings.Join(problems, " "),
			Fix: "Close any second copy of the app, or set CLOUDHOUSE_LAN_PORT / CLOUDHOUSE_LAN_DISCOVERY_PORT to free ports and restart."})
	}

	// 5. beacons sent
	switch {
	case st.BeaconsSent > 0 && len(st.LastSendErrors) == 0:
		add(Step{ID: "sent", Title: "Announcing this PC", Status: "pass", Detail: fmt.Sprintf("%d announcements sent.", st.BeaconsSent)})
	case st.BeaconsSent > 0:
		add(Step{ID: "sent", Title: "Announcing this PC", Status: "warn", Detail: strings.Join(st.LastSendErrors, "; "), Fix: "Some network cards could not send; check the log lines marked BEACON."})
	default:
		add(Step{ID: "sent", Title: "Announcing this PC", Status: "fail", Detail: "Nothing has been sent yet.", Fix: "Check the network address step above, then wait a few seconds and run the test again."})
	}

	// 6. beacons received
	peers := a.Peers()
	heard := 0
	for _, p := range peers {
		if p.Source == "beacon" {
			heard++
		}
	}
	switch {
	case heard > 0:
		add(Step{ID: "heard", Title: "Hearing other PCs", Status: "pass", Detail: fmt.Sprintf("%d other PC(s) announced themselves.", heard)})
	case len(peers) > 0:
		add(Step{ID: "heard", Title: "Hearing other PCs", Status: "warn", Detail: "Only PCs added by IP are known; broadcasts are not reaching this PC.", Fix: "Broadcasts are blocked (router isolation or the firewall on this PC). Adding by IP works as a fallback."})
	default:
		add(Step{ID: "heard", Title: "Hearing other PCs", Status: "fail", Detail: "No other PC has announced itself.",
			Fix: "On the other PC: open the app and press Allow network access. On both: check the cable and that both show a network address above."})
	}

	// 7. connection to a PC
	target := strings.TrimSpace(peerTarget)
	name := ""
	if target == "" && len(peers) > 0 {
		target = fmt.Sprintf("%s:%d", peers[0].IP, peers[0].Port)
		name = peers[0].Name
	}
	if target == "" {
		add(Step{ID: "probe", Title: "Connecting to the other PC", Status: "skip", Detail: "No other PC to test yet."})
	} else {
		host, port := splitTarget(target, a.cfg.HTTPPort)
		rep := ProbeDetailed(host, port, 3*time.Second)
		res := rep.Result
		label := host
		if name != "" {
			label = fmt.Sprintf("%s (%s)", name, host)
		} else if res.PeerName != "" {
			label = fmt.Sprintf("%s (%s)", res.PeerName, host)
		}
		var tried []string
		for _, at := range rep.Attempts {
			who := "Windows' own choice"
			if at.Via != "" {
				who = at.Via
			}
			tried = append(tried, who+": "+at.Status)
		}
		attempts := ""
		if len(rep.Attempts) > 1 {
			attempts = " Tried: " + strings.Join(tried, "; ") + "."
		}
		switch {
		case res.Status == "reachable" && rep.WrongCard:
			add(Step{ID: "probe", Title: "Connecting to the other PC", Status: "warn",
				Detail: fmt.Sprintf("%s answered in %d ms through %s, but Windows' own choice of card did not reach it.%s", label, res.LatencyMs, res.Via, attempts),
				Fix:    "Another card on the same address range (Tailscale, Wi-Fi) is being picked by Windows. The app sends through the right card, but switching the other card off removes the confusion."})
		case res.Status == "reachable":
			add(Step{ID: "probe", Title: "Connecting to the other PC", Status: "pass", Detail: fmt.Sprintf("%s answered in %d ms.%s", label, res.LatencyMs, attempts)})
		default:
			add(Step{ID: "probe", Title: "Connecting to the other PC", Status: "fail", Detail: fmt.Sprintf("%s: %s.%s", label, res.Status, attempts),
				Fix: res.Message + " If the other PC's own self-test shows a Block rule for its program, press Allow network access there."})
		}
	}

	fails, warns := 0, 0
	for _, s := range steps {
		switch s.Status {
		case "fail":
			fails++
		case "warn":
			warns++
		}
	}
	lvl := "ok"
	if fails > 0 {
		lvl = "error"
	} else if warns > 0 {
		lvl = "warn"
	}
	a.log.Log(lvl, "SELFTEST", "self-test finished: %d failed, %d warnings", fails, warns)
	return steps
}
