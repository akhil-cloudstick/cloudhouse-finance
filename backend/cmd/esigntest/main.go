// Command esigntest is a throwaway CLI to manually exercise the Setu
// Aadhaar eSign sandbox integration (internal/platform/setu_esign.go).
// Signing itself happens on Setu's hosted page — the customer must open
// the returned URL in a browser and complete Aadhaar+OTP — so this command
// can only upload/create/poll/download, mirroring cmd/digilockertest's
// shape. Run from backend/:
//
//	go run ./cmd/esigntest upload <path-to.pdf>
//	go run ./cmd/esigntest create <documentId> <identifier> <displayName> <birthYear>
//	go run ./cmd/esigntest status <requestId>
//	go run ./cmd/esigntest download <requestId>
//
// Reads SETU_ESIGN_CLIENT_ID / SETU_ESIGN_CLIENT_SECRET /
// SETU_ESIGN_PRODUCT_INSTANCE_ID / SETU_ESIGN_BASE_URL from backend/.env
// (via platform.LoadConfig).
package main

import (
	"fmt"
	"os"

	"cloudhouse/backend/internal/platform"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(1)
	}

	cfg := platform.LoadConfig()
	client := platform.NewEsignClient(cfg)

	switch os.Args[1] {
	case "upload":
		if len(os.Args) < 3 {
			fmt.Println("usage: esigntest upload <path-to.pdf>")
			os.Exit(1)
		}
		data, err := os.ReadFile(os.Args[2])
		if err != nil {
			fmt.Println("ERROR:", err)
			os.Exit(1)
		}
		doc, err := client.UploadDocument(data, "esigntest")
		if err != nil {
			fmt.Println("ERROR:", err)
			os.Exit(1)
		}
		fmt.Printf("documentId=%s name=%s\n", doc.ID, doc.Name)

	case "create":
		if len(os.Args) < 6 {
			fmt.Println("usage: esigntest create <documentId> <identifier> <displayName> <birthYear>")
			os.Exit(1)
		}
		req, err := client.CreateSignatureRequest(os.Args[2], platform.Signer{
			Identifier:  os.Args[3],
			DisplayName: os.Args[4],
			BirthYear:   os.Args[5],
			Signature: &platform.SignatureConfig{
				OnPages:  []string{"1"},
				Position: "bottom-right",
			},
		}, "http://localhost:3000/esign-callback")
		if err != nil {
			fmt.Println("ERROR:", err)
			os.Exit(1)
		}
		fmt.Printf("id=%s documentId=%s status=%s\nsigning url (open this in a browser): %s\n", req.ID, req.DocumentID, req.Status, req.URL)

	case "status":
		if len(os.Args) < 3 {
			fmt.Println("usage: esigntest status <requestId>")
			os.Exit(1)
		}
		status, err := client.GetSignatureStatus(os.Args[2])
		if err != nil {
			fmt.Println("ERROR:", err)
			os.Exit(1)
		}
		fmt.Printf("status=%s raw=%s\n", status.Status, status.RawStatus)

	case "download":
		if len(os.Args) < 3 {
			fmt.Println("usage: esigntest download <requestId>")
			os.Exit(1)
		}
		signed, err := client.GetSignedDocument(os.Args[2])
		if err != nil {
			fmt.Println("ERROR:", err)
			os.Exit(1)
		}
		fmt.Printf("downloadUrl=%s validUpto=%s\n", signed.DownloadURL, signed.ValidUpto)

	default:
		usage()
		os.Exit(1)
	}
}

func usage() {
	fmt.Println("usage: esigntest <upload|create|status|download> [args]")
}
