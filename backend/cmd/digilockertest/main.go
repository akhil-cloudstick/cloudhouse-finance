// Command digilockertest is a throwaway CLI to manually exercise the Setu
// DigiLocker sandbox integration (internal/platform/setu_digilocker.go).
// Unlike PAN verification, DigiLocker is a redirect flow — the customer
// must open the returned URL in a browser and complete Aadhaar+OTP login
// themselves, so this command can only create the request and print the
// URL/id. Run from backend/:
//
//	go run ./cmd/digilockertest create
//	go run ./cmd/digilockertest status <requestId>
//	go run ./cmd/digilockertest aadhaar <requestId>
//
// Reads SETU_DIGILOCKER_CLIENT_ID / SETU_DIGILOCKER_CLIENT_SECRET /
// SETU_DIGILOCKER_PRODUCT_INSTANCE_ID / SETU_DIGILOCKER_BASE_URL from
// backend/.env (via platform.LoadConfig).
package main

import (
	"fmt"
	"os"

	"cloudhouse/backend/internal/platform"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Println("usage: digilockertest <create|status|aadhaar> [requestId]")
		os.Exit(1)
	}

	cfg := platform.LoadConfig()
	client := platform.NewDigilockerClient(cfg)

	switch os.Args[1] {
	case "create":
		req, err := client.CreateRequest("http://localhost:3000/digilocker-callback")
		if err != nil {
			fmt.Println("ERROR:", err)
			os.Exit(1)
		}
		fmt.Printf("id=%s status=%s validUpto=%s\nlogin url (open this in a browser): %s\n", req.ID, req.Status, req.ValidUpto, req.URL)
	case "status":
		if len(os.Args) < 3 {
			fmt.Println("usage: digilockertest status <requestId>")
			os.Exit(1)
		}
		status, err := client.GetStatus(os.Args[2])
		if err != nil {
			fmt.Println("ERROR:", err)
			os.Exit(1)
		}
		fmt.Printf("status=%s digilockerId=%s phone=%s email=%s\n", status.Status, status.DigilockerUserDetails.DigilockerID, status.DigilockerUserDetails.PhoneNumber, status.DigilockerUserDetails.Email)
	case "aadhaar":
		if len(os.Args) < 3 {
			fmt.Println("usage: digilockertest aadhaar <requestId>")
			os.Exit(1)
		}
		aadhaar, err := client.GetAadhaar(os.Args[2])
		if err != nil {
			fmt.Println("ERROR:", err)
			os.Exit(1)
		}
		fmt.Printf("name=%q dob=%s gender=%s maskedNumber=%s\n", aadhaar.Aadhaar.Name, aadhaar.Aadhaar.DateOfBirth, aadhaar.Aadhaar.Gender, aadhaar.Aadhaar.MaskedNumber)
	default:
		fmt.Println("usage: digilockertest <create|status|aadhaar> [requestId]")
		os.Exit(1)
	}
}
