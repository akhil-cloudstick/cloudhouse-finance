// Command setutest is a throwaway CLI to manually exercise the Setu PAN
// verification sandbox integration (internal/platform/setu.go) without
// spinning up the full API server. Run from backend/:
//
//	go run ./cmd/setutest ABCDE1234A
//
// Reads SETU_CLIENT_ID / SETU_CLIENT_SECRET / SETU_PRODUCT_INSTANCE_ID /
// SETU_BASE_URL from backend/.env (via platform.LoadConfig).
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
	client := platform.NewSetuClient(cfg)

	fmt.Printf("Calling %s/api/verify/pan for PAN=%s\n", cfg.SetuBaseURL, pan)
	result, err := client.VerifyPAN(pan, "Verifying customer PAN for gold loan onboarding KYC")
	if err != nil {
		fmt.Println("ERROR:", err)
		os.Exit(1)
	}

	fmt.Printf("verification=%s message=%q full_name=%q category=%q aadhaar_seeding_status=%q traceId=%s\n",
		result.Verification, result.Message, result.FullName, result.Category, result.AadhaarSeedingStatus, result.TraceID)
}
