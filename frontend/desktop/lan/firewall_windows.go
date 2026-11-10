//go:build windows

package lan

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"
	"unicode/utf16"
)

// run executes a command with no console window and a time limit.
func run(timeout time.Duration, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	err := cmd.Run()
	text := strings.TrimSpace(out.String())
	if err != nil && strings.TrimSpace(errb.String()) != "" {
		text = strings.TrimSpace(errb.String())
	}
	return text, err
}

func ruleExists(name string) bool {
	// netsh exits with 0 when the rule exists and 1 when "No rules match", in any Windows language
	_, err := run(8*time.Second, "netsh", "advfirewall", "firewall", "show", "rule", "name="+name)
	return err == nil
}

func queryFirewall(httpPort, discPort int) FirewallInfo {
	info := FirewallInfo{Supported: true}
	info.RuleTCP = ruleExists(ruleNameTCP(httpPort))
	info.RuleUDP = ruleExists(ruleNameUDP(discPort))

	// rules that name this very program: a Block rule here overrides the port rules above
	if exe, err := os.Executable(); err == nil {
		info.Program = exe
		if out, err := run(90*time.Second, "netsh", "advfirewall", "firewall", "show", "rule", "name=all", "dir=in", "verbose"); err == nil {
			rules, understood := parseProgramRules(out, exe)
			info.ProgramRules = rules
			info.ProgramChecked = understood > 0
		}
	}

	const script = `Get-NetConnectionProfile | ForEach-Object { [pscustomobject]@{ Name = $_.Name; Interface = $_.InterfaceAlias; Category = $_.NetworkCategory.ToString() } } | ConvertTo-Json -Compress`
	out, err := run(10*time.Second, "powershell", "-NoProfile", "-NonInteractive", "-Command", script)
	if err != nil {
		info.Error = "could not read the network profile: " + err.Error()
		return info
	}
	if out == "" {
		return info
	}
	type row struct{ Name, Interface, Category string }
	var rows []row
	if strings.HasPrefix(out, "[") {
		err = json.Unmarshal([]byte(out), &rows)
	} else {
		var one row
		if err = json.Unmarshal([]byte(out), &one); err == nil {
			rows = []row{one}
		}
	}
	if err != nil {
		info.Error = "could not read the network profile: " + err.Error()
		return info
	}
	for _, r := range rows {
		info.Profiles = append(info.Profiles, NetProfile{Name: r.Name, Interface: r.Interface, Category: r.Category})
	}
	return info
}

func allowAccess(httpPort, discPort int) AllowResult {
	tcp, udp := ruleNameTCP(httpPort), ruleNameUDP(discPort)
	inner := fmt.Sprintf(
		`netsh advfirewall firewall delete rule name="%[1]s"; netsh advfirewall firewall delete rule name="%[2]s"; `+
			`netsh advfirewall firewall add rule name="%[1]s" dir=in action=allow protocol=TCP localport=%[3]d profile=any; `+
			`netsh advfirewall firewall add rule name="%[2]s" dir=in action=allow protocol=UDP localport=%[4]d profile=any`,
		tcp, udp, httpPort, discPort)
	// Windows adds a Block rule for a program when its "allow access" prompt is closed without choosing Allow, and a Block
	// rule beats every Allow rule. Remove whatever rules name this exact program, then allow it on every network type.
	if exe, err := os.Executable(); err == nil && !strings.ContainsAny(exe, `"';`+"`") {
		inner += fmt.Sprintf(
			`; netsh advfirewall firewall delete rule name=all program="%[1]s"; `+
				`netsh advfirewall firewall add rule name="Cloudhouse LAN app TCP" dir=in action=allow program="%[1]s" protocol=TCP profile=any; `+
				`netsh advfirewall firewall add rule name="Cloudhouse LAN app UDP" dir=in action=allow program="%[1]s" protocol=UDP profile=any`,
			exe)
	}
	// the script is passed encoded, so no quoting can break it on its way through the elevated shell
	u := utf16.Encode([]rune(inner))
	raw := make([]byte, 0, len(u)*2)
	for _, c := range u {
		raw = append(raw, byte(c), byte(c>>8))
	}
	enc := base64.StdEncoding.EncodeToString(raw)
	outer := "Start-Process -FilePath powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','" + enc + "'"
	if out, err := run(90*time.Second, "powershell", "-NoProfile", "-NonInteractive", "-Command", outer); err != nil {
		msg := out
		if msg == "" {
			msg = err.Error()
		}
		if strings.Contains(strings.ToLower(msg), "cancel") {
			return AllowResult{Message: "Windows permission was declined, so no rule was added. Press the button again and choose Yes."}
		}
		return AllowResult{Message: "Could not ask Windows for permission: " + msg}
	}
	if ruleExists(tcp) && ruleExists(udp) {
		return AllowResult{OK: true, Message: fmt.Sprintf("Inbound rules added for TCP %d and UDP %d on every network type.", httpPort, discPort)}
	}
	return AllowResult{Message: "The rules were not added. If a Windows permission prompt appeared, choose Yes; a company firewall policy may also block it."}
}
