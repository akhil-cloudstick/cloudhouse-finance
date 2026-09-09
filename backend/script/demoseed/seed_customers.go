package demoseed

import (
	"context"
	"fmt"

	"cloudhouse/backend/internal/customer"
	"cloudhouse/backend/internal/upload"
)

// seedCustomers creates twelve customers and then sets their verification
// states.
//
// # WHY THE SECOND PASS
//
// customer.Service.Create hardcodes KYCStatus, PANStatus and AadhaarStatus to
// "Pending" on every insert, and the only code path that promotes any of them
// is deriveKYCStatus reacting to a live Setu verification result. So there is
// no input that produces a verified customer. Without a second pass the
// Customers list would be twelve identical "Pending" rows and none of the
// KYC badges, filters or the verified/failed states would demo at all.
//
// The pass is a scoped Updates on a single model, so the tenant callback adds
// its own predicate — it cannot touch another business's rows.
func seedCustomers(ctx context.Context, d *Deps, st *state, rep *Report) error {
	for i, f := range customerFixtures {
		in := customer.CreateInput{
			Name:            f.Name,
			Phone:           f.Phone,
			Address:         f.Address,
			BranchID:        st.branchIDs[i%len(st.branchIDs)],
			PAN:             f.PAN,
			District:        f.District,
			Taluk:           f.Taluk,
			Village:         f.Village,
			NomineeName:     f.NomineeName,
			NomineeRelation: f.NomineeRelation,
			NomineePhone:    f.Phone,
			// Age is a *int on the input; the fixture carries a value.
			Age: intPtr(f.Age),
			// DOB is derived from age so the two agree on screen. Day and
			// month are fixed so the value is stable across resets.
			DOB: st.clk.today.AddDate(-f.Age, 0, 0),
		}
		if f.Investor {
			in.CustomerType = customer.CustomerTypeInvestor
			in.BankAccountName = f.BankAccountName
			in.BankAccountNumber = f.BankAccountNumber
			in.BankIFSC = f.BankIFSC
		} else {
			in.CustomerType = customer.CustomerTypeBorrower
		}
		// Only if a cipher was built: Create rejects an Aadhaar it cannot
		// encrypt. On a deployment with no AADHAAR_ENCRYPTION_KEY the borrowers
		// simply have no last-four — but an INVESTOR without an Aadhaar fails
		// validation outright, so that case is reported rather than skipped.
		if f.Aadhaar != "" {
			if d.hasAadhaarCipher() {
				in.Aadhaar = f.Aadhaar
			} else if f.Investor {
				return fmt.Errorf(
					"cannot seed investor %q: an investor requires an Aadhaar number and AADHAAR_ENCRYPTION_KEY is not configured",
					f.Name)
			}
		}

		c, err := d.customerSvc.Create(ctx, in)
		if err != nil {
			return fmt.Errorf("create customer %q: %w", f.Name, err)
		}
		st.customerIDs = append(st.customerIDs, c.ID)
	}

	for i, id := range st.customerIDs {
		plan := customerKYCPlan[i%len(customerKYCPlan)]
		if err := d.db.WithContext(ctx).
			Model(&customer.Customer{}).
			Where("id = ?", id).
			Updates(map[string]any{
				"kyc_status":     plan.KYC,
				"pan_status":     plan.PAN,
				"aadhaar_status": plan.Aadhaar,
			}).Error; err != nil {
			return fmt.Errorf("set verification state on customer %d: %w", id, err)
		}
	}

	rep.created("customers", len(customerFixtures))
	return nil
}

// seedUploads writes ten small files through the real upload path and hangs
// them off customers and expenses.
//
// Uses SaveBytesRecorded rather than SaveBytes so each file also gets an
// uploaded_files row. That matters twice over: the documents are reachable in
// the UI (the serve handler resolves through the database, not the
// filesystem), and the wipe's disk-deletion path has something real to
// delete, which is what makes that behaviour observable in verification
// rather than taken on trust.
func seedUploads(ctx context.Context, d *Deps, st *state, rep *Report) error {
	for i := 0; i < 10; i++ {
		name := fmt.Sprintf("demo-document-%02d.png", i+1)
		key, err := upload.SaveBytesRecorded(ctx, d.uploadRepo, d.cfg.UploadsDir, name, onePixelPNG())
		if err != nil {
			return fmt.Errorf("save upload %q: %w", name, err)
		}
		st.uploadKeys = append(st.uploadKeys, key)
	}

	// Attach the first six to customers, so the customer detail screen shows
	// a photo and a KYC document rather than placeholders.
	for i := 0; i < 6 && i < len(st.customerIDs); i++ {
		if err := d.db.WithContext(ctx).
			Model(&customer.Customer{}).
			Where("id = ?", st.customerIDs[i]).
			Updates(map[string]any{
				"photo_url":        st.uploadKeys[i],
				"kyc_document_url": st.uploadKeys[(i+1)%len(st.uploadKeys)],
			}).Error; err != nil {
			return fmt.Errorf("attach documents to customer %d: %w", st.customerIDs[i], err)
		}
	}

	rep.created("uploaded files", len(st.uploadKeys))
	return nil
}

// onePixelPNG is the smallest valid PNG: a single transparent pixel.
//
// A real image rather than arbitrary bytes because upload.SaveBytes sniffs
// the content type from the leading bytes, and a blob it cannot classify
// would be stored with a type the UI refuses to render.
func onePixelPNG() []byte {
	return []byte{
		0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A,
		0x00, 0x00, 0x00, 0x0D, 'I', 'H', 'D', 'R',
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
		0x89, 0x00, 0x00, 0x00, 0x0A, 'I', 'D', 'A', 'T',
		0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05,
		0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00,
		0x00, 0x00, 'I', 'E', 'N', 'D', 0xAE, 0x42, 0x60, 0x82,
	}
}

func intPtr(v int) *int { return &v }
