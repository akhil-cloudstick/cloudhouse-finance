package controllers

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"strings"
	"time"
)

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

func aadhaarMismatches(rec *commonModels.Customer, a *config.AadhaarXML) []string {
	var reasons []string
	if !namesMatch(rec.Name, a.Aadhaar.Name) {
		reasons = append(reasons, "Name does not match")
	}
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
