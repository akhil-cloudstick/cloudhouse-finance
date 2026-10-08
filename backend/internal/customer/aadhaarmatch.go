package customer

import (
	"strings"
	"time"

	"cloudhouse/backend/internal/platform"
)

// aadhaarDOBLayouts are the date formats e-Aadhaar data is seen in — the UIDAI
// XML uses DD-MM-YYYY, but Surepass may normalise it to ISO.
var aadhaarDOBLayouts = []string{"02-01-2006", "2006-01-02", "02/01/2006", "2006/01/02"}

func parseAadhaarDOB(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	for _, layout := range aadhaarDOBLayouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// aadhaarMismatches compares the e-Aadhaar data fetched from DigiLocker with
// what is on the customer's profile and returns a human-readable reason for
// every field that does not match. An empty result means the DigiLocker
// identity is the same person as the profile. A name match alone is not
// enough — someone could log in with another person's Aadhaar whose name
// resembles the customer's — so DOB, the Aadhaar last 4 digits entered at
// registration, and the PIN code (when on file) must also agree.
func aadhaarMismatches(rec *Customer, a *platform.AadhaarXML) []string {
	var reasons []string

	if !namesMatch(rec.Name, a.Aadhaar.Name) {
		reasons = append(reasons, "Name does not match")
	}

	// DOB and the Aadhaar number are required on the profile: with nothing to
	// compare against, a DigiLocker login proves nothing about whose Aadhaar
	// it is, so verification is rejected rather than silently passed.
	if rec.DOB.IsZero() {
		reasons = append(reasons, "Date of birth not entered for this customer")
	} else if dob, ok := parseAadhaarDOB(a.Aadhaar.DateOfBirth); !ok {
		reasons = append(reasons, "Date of birth could not be read")
	} else if dob.Format("2006-01-02") != rec.DOB.Format("2006-01-02") {
		reasons = append(reasons, "Date of birth does not match")
	}

	if rec.AadhaarLast4 == "" {
		reasons = append(reasons, "Aadhaar number not entered for this customer")
	} else if masked := a.Aadhaar.MaskedNumber; len(masked) < 4 || masked[len(masked)-4:] != rec.AadhaarLast4 {
		reasons = append(reasons, "Aadhaar number does not match")
	}

	if rec.PinCode != "" && a.Aadhaar.Address.PIN != "" && strings.TrimSpace(rec.PinCode) != strings.TrimSpace(a.Aadhaar.Address.PIN) {
		reasons = append(reasons, "PIN code does not match")
	}

	return reasons
}
