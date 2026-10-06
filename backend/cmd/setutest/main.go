// Command setutest is a throwaway CLI to manually exercise the Surepass PAN
// verification integration (internal/platform/surepass.go) without
// spinning up the full API server. Run from backend/:
//
//	go run ./cmd/setutest ABCDE1234A
//
// Reads SUREPASS_API_TOKEN / SUREPASS_BASE_URL from backend/.env (via
// platform.LoadConfig).
package main

import (
	"fmt"
	"os"

	"cloudhouse/backend/internal/platform"
)

func main() {
	pan := "ABCDE1234A"
	if len(os.Args) > 1 {
		pan = os.Args[1]
	}

	cfg := platform.LoadConfig()
	client := platform.NewPANClient(cfg)

	fmt.Printf("Calling %s/api/v1/pan/pan for PAN=%s\n", cfg.SurepassBaseURL, pan)
	result, err := client.VerifyPAN(pan)
	if err != nil {
		fmt.Println("ERROR:", err)
		os.Exit(1)
	}

	fmt.Printf("verification=%s message=%q full_name=%q category=%q clientId=%s\n",
		result.Verification, result.Message, result.FullName, result.Category, result.TraceID)
}
