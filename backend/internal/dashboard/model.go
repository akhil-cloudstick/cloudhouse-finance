// Package dashboard aggregates data already owned by other modules
// (internal/loan) into the small, purpose-built, paginated feeds the
// management dashboard's widgets need — it holds no persisted model of its
// own and writes nothing.
package dashboard

// NeedsAttentionItem is one row of the merged "Needs Attention" feed — Kind
// discriminates which of the three source rows this is; only the fields
// relevant to that Kind are populated, mirroring the JSX switch that used to
// build this same union client-side (frontend/components/Dashboard.tsx).
type NeedsAttentionItem struct {
	Kind string `json:"kind"` // "approval" | "request" | "auction"

	// approval / auction — the underlying loan's own identity.
	LoanID       uint   `json:"loanId,omitempty"`
	LoanNumber   string `json:"loanNumber,omitempty"`
	CustomerName string `json:"customerName,omitempty"`

	// approval only.
	Principal     float64 `json:"principal,omitempty"`
	ApprovalStage string  `json:"approvalStage,omitempty"`

	// request only.
	RequestID   uint   `json:"requestId,omitempty"`
	RequestType string `json:"requestType,omitempty"`
	Detail      string `json:"detail,omitempty"`

	// auction only.
	Outstanding float64 `json:"outstanding,omitempty"`
	Status      string  `json:"status,omitempty"`
}

// NeedsAttentionResult is GET /dashboard/needs-attention's response
// envelope. Items is the requested page's slice of the merged, ordered
// (approvals -> requests -> auctions) list. TotalCount/ApprovalsCount/
// RequestsCount/AuctionsCount are all counted across the FULL set, not just
// the returned page.
type NeedsAttentionResult struct {
	Items          []NeedsAttentionItem `json:"items"`
	TotalCount     int                  `json:"totalCount"`
	ApprovalsCount int                  `json:"approvalsCount"`
	RequestsCount  int                  `json:"requestsCount"`
	AuctionsCount  int                  `json:"auctionsCount"`
}
