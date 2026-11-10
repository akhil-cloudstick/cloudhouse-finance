//go:build !windows

package lan

// Off Windows there is no Windows Firewall to configure; the app is only shipped for Windows today.
func queryFirewall(httpPort, discPort int) FirewallInfo {
	return FirewallInfo{Supported: false}
}

func allowAccess(httpPort, discPort int) AllowResult {
	return AllowResult{Message: "Network access rules are only managed on Windows."}
}
