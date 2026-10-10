package models

type NeedsAttentionItem struct {
	Kind          string  `json:"kind"`
	LoanID        uint    `json:"loan_id,omitempty"`
	LoanNumber    string  `json:"loan_number,omitempty"`
	CustomerName  string  `json:"customer_name,omitempty"`
	Principal     float64 `json:"principal,omitempty"`
	ApprovalStage string  `json:"approval_stage,omitempty"`
	Flow          string  `json:"flow,omitempty"`
	EntityID      uint    `json:"entity_id,omitempty"`
	RequestID     uint    `json:"request_id,omitempty"`
	RequestType   string  `json:"request_type,omitempty"`
	Detail        string  `json:"detail,omitempty"`
	Outstanding   float64 `json:"outstanding,omitempty"`
	Status        string  `json:"status,omitempty"`
}

type NeedsAttentionResult struct {
	Items          []NeedsAttentionItem `json:"items"`
	TotalCount     int                  `json:"total_count"`
	ApprovalsCount int                  `json:"approvals_count"`
	RequestsCount  int                  `json:"requests_count"`
	AuctionsCount  int                  `json:"auctions_count"`
}
