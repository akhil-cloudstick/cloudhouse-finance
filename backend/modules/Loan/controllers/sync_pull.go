package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
	packetModels "cloudhouse/backend/modules/Packet/models"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

// closedKeepDays is how long a closed loan stays on a PC's local copy: effectively always (100 years), so the first download holds every loan the branch ever had.
const closedKeepDays = 36500

// pullOverlap is how far behind the pull time the next cursor sits, so a save that was still committing during a pull is read again by the next one.
const pullOverlap = 5 * time.Minute

const maxPullLimit = 1000

// pullCustomer is a customer as the customers API returns it (masked Aadhaar and all), plus the PC-visible UUID.
type pullCustomer struct {
	commonModels.CustomerResponse
	UUID string `json:"uuid"`
}

type pullRequest struct {
	models.LoanRequest
	Loan      *struct{}                `json:"loan,omitempty"`
	Approvals []models.RequestApproval `json:"approvals"`
}

type pullPacket struct {
	ID               uint                          `json:"id"`
	Code             string                        `json:"code"`
	LoanID           uint                          `json:"loan_id"`
	Status           string                        `json:"status"`
	CurrentLockerID  *uint                         `json:"current_locker_id"`
	TotalGrossWeight float64                       `json:"total_gross_weight"`
	TotalNetWeight   float64                       `json:"total_net_weight"`
	Movements        []packetModels.PacketMovement `json:"movements"`
	CreatedAt        time.Time                     `json:"created_at"`
	UpdatedAt        time.Time                     `json:"updated_at"`
}

// pullLoan is a loan with its whole history, so the PC holds everything the loan screens show.
type pullLoan struct {
	models.Loan
	TopUps   []models.LoanTopUp     `json:"top_ups"`
	Requests []pullRequest          `json:"requests"`
	Auctions []models.AuctionRecord `json:"auctions"`
	Packets  []pullPacket           `json:"packets"`
}

type pullNext struct {
	LoanAfter     string `json:"loan_after"`
	CustomerAfter string `json:"customer_after"`
	Start         string `json:"start"`
}

type pullDeleted struct {
	Loans     []string `json:"loans"`
	Customers []string `json:"customers"`
}

type pullResponse struct {
	Loans     []pullLoan     `json:"loans"`
	Customers []pullCustomer `json:"customers"`
	Deleted   pullDeleted    `json:"deleted"`
	Cursor    string         `json:"cursor"`
	HasMore   bool           `json:"has_more"`
	Next      pullNext       `json:"next"`
	// Scope says whose view this answer is ("all" branches, or "branch:<id>"). A PC that last downloaded under another scope
	// starts that download again, so a user who can see more than the last one gets all of it, not only what changed.
	Scope string `json:"scope"`
}

// ScopeLabel names a branch scope for the PC: nil is every branch.
func ScopeLabel(scope *uint) string {
	if scope == nil {
		return "all"
	}
	return "branch:" + strconv.FormatUint(uint64(*scope), 10)
}

type syncIDsResponse struct {
	Loans     []string `json:"loans"`
	Customers []string `json:"customers"`
}

func pullBranchScope(c echo.Context) *uint {
	scope := auth.GetBranchScope(c)
	// A role that works across branches (an admin) gets every branch: which one is on screen is a view the
	// screens apply to the local copy, so switching branch offline needs no new download.
	if _, pinned := auth.SingleBranchPin(c); !pinned && auth.IsCrossBranchRole(c) {
		return nil
	}
	return scope
}

type keyset struct {
	at time.Time
	id uint
}

func parseKeyset(raw string) (*keyset, bool) {
	if raw == "" {
		return nil, true
	}
	parts := strings.SplitN(raw, "|", 2)
	if len(parts) != 2 {
		return nil, false
	}
	at, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return nil, false
	}
	id, err := strconv.ParseUint(parts[1], 10, 64)
	if err != nil {
		return nil, false
	}
	return &keyset{at: at, id: uint(id)}, true
}

func formatKeyset(at time.Time, id uint) string {
	return at.UTC().Format(time.RFC3339Nano) + "|" + strconv.FormatUint(uint64(id), 10)
}

// SyncPull returns this branch's loans and customers changed since the cursor, for the exe to write over its
// local copy. The first pull (no cursor) sends every loan that is not deleted, closed ones included. With a
// limit the answer comes in pages in (updated_at, id) order: the exe sends back "next" until has_more is false.
// Removed rows come back as UUIDs under "deleted". The cursor is the time the pull began less a short overlap, so
// a row is never skipped; one inside the overlap may repeat, which is harmless because the exe upserts by UUID.
func SyncPull(c echo.Context) error {
	ctx := auth.RequestContext(c)
	scope := pullBranchScope(c)

	var since time.Time
	if raw := c.QueryParam("since"); raw != "" {
		t, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			return common.Fail(c, http.StatusBadRequest, "invalid since cursor")
		}
		since = t
	}
	loanAfter, ok := parseKeyset(c.QueryParam("loan_after"))
	if !ok {
		return common.Fail(c, http.StatusBadRequest, "invalid loan_after")
	}
	custAfter, ok := parseKeyset(c.QueryParam("customer_after"))
	if !ok {
		return common.Fail(c, http.StatusBadRequest, "invalid customer_after")
	}
	start := time.Now()
	if raw := c.QueryParam("start"); raw != "" {
		t, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			return common.Fail(c, http.StatusBadRequest, "invalid start")
		}
		start = t
	}
	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	if limit > maxPullLimit {
		limit = maxPullLimit
	}

	lq := config.DB.WithContext(ctx).Unscoped().Model(&models.Loan{})
	if scope != nil {
		lq = lq.Where("branch_id = ?", *scope)
	}
	if since.IsZero() {
		lq = lq.Where("deleted_at IS NULL AND (status <> ? OR updated_at >= ?)", models.StatusClosed, start.AddDate(0, 0, -closedKeepDays))
	} else {
		lq = lq.Where("updated_at >= ?", since)
	}
	if loanAfter != nil {
		lq = lq.Where("(updated_at > ? OR (updated_at = ? AND id > ?))", loanAfter.at, loanAfter.at, loanAfter.id)
	}
	lq = lq.Order("updated_at, id")
	if limit > 0 {
		lq = lq.Limit(limit + 1)
	}
	var rows []models.Loan
	if err := preloadAll(lq).Find(&rows).Error; err != nil {
		return common.FailErr(c, err)
	}

	cq := config.DB.WithContext(ctx).Unscoped().Model(&commonModels.Customer{}).Preload("Branch")
	if scope != nil {
		cq = cq.Where("(branch_id = ? OR id IN (SELECT customer_id FROM loans WHERE branch_id = ? AND deleted_at IS NULL))", *scope, *scope)
	}
	if since.IsZero() {
		cq = cq.Where("deleted_at IS NULL")
	} else if scope != nil {
		cq = cq.Where("(updated_at >= ? OR id IN (SELECT customer_id FROM loans WHERE branch_id = ? AND deleted_at IS NULL AND updated_at >= ?))", since, *scope, since)
	} else {
		cq = cq.Where("(updated_at >= ? OR id IN (SELECT customer_id FROM loans WHERE deleted_at IS NULL AND updated_at >= ?))", since, since)
	}
	if custAfter != nil {
		cq = cq.Where("(updated_at > ? OR (updated_at = ? AND id > ?))", custAfter.at, custAfter.at, custAfter.id)
	}
	cq = cq.Order("updated_at, id")
	if limit > 0 {
		cq = cq.Limit(limit + 1)
	}
	var custs []commonModels.Customer
	if err := cq.Find(&custs).Error; err != nil {
		return common.FailErr(c, err)
	}

	hasMore := false
	if limit > 0 {
		if len(rows) > limit {
			rows = rows[:limit]
			hasMore = true
		}
		if len(custs) > limit {
			custs = custs[:limit]
			hasMore = true
		}
	}

	out := pullResponse{Loans: []pullLoan{}, Customers: []pullCustomer{}, Deleted: pullDeleted{Loans: []string{}, Customers: []string{}}}
	out.Next = pullNext{Start: start.UTC().Format(time.RFC3339Nano)}
	if len(rows) > 0 {
		last := rows[len(rows)-1]
		out.Next.LoanAfter = formatKeyset(last.UpdatedAt, last.ID)
	} else if loanAfter != nil {
		out.Next.LoanAfter = formatKeyset(loanAfter.at, loanAfter.id)
	}
	if len(custs) > 0 {
		last := custs[len(custs)-1]
		out.Next.CustomerAfter = formatKeyset(last.UpdatedAt, last.ID)
	} else if custAfter != nil {
		out.Next.CustomerAfter = formatKeyset(custAfter.at, custAfter.id)
	}
	out.HasMore = hasMore
	out.Scope = ScopeLabel(scope)

	live := make([]models.Loan, 0, len(rows))
	for _, l := range rows {
		if l.DeletedAt.Valid {
			out.Deleted.Loans = append(out.Deleted.Loans, l.UUID)
			continue
		}
		// the same read-time figures (interest to date, due flags, totals) a list of loans carries, so a PC
		// showing its local copy shows what the server would have shown
		enrichLoan(ctx, &l)
		live = append(live, l)
	}
	history, err := loadLoanHistory(c, live)
	if err != nil {
		return common.FailErr(c, err)
	}
	for _, l := range live {
		pl := history[l.ID]
		pl.Loan = l
		out.Loans = append(out.Loans, pl)
	}
	for _, cu := range custs {
		if cu.DeletedAt.Valid {
			out.Deleted.Customers = append(out.Deleted.Customers, cu.UUID)
		} else {
			cu := cu
			out.Customers = append(out.Customers, pullCustomer{CustomerResponse: common.CustomerToResponse(&cu), UUID: cu.UUID})
		}
	}

	cursor := start.Add(-pullOverlap)
	if cursor.Before(since) {
		cursor = since
	}
	out.Cursor = cursor.UTC().Format(time.RFC3339Nano)
	return common.Success(c, http.StatusOK, out)
}

func loadLoanHistory(c echo.Context, loans []models.Loan) (map[uint]pullLoan, error) {
	ctx := auth.RequestContext(c)
	out := make(map[uint]pullLoan, len(loans))
	if len(loans) == 0 {
		return out, nil
	}
	ids := make([]uint, len(loans))
	for i, l := range loans {
		ids[i] = l.ID
		out[l.ID] = pullLoan{TopUps: []models.LoanTopUp{}, Requests: []pullRequest{}, Auctions: []models.AuctionRecord{}, Packets: []pullPacket{}}
	}

	var topUps []models.LoanTopUp
	if err := config.DB.WithContext(ctx).Where("loan_id IN ?", ids).Order("id").Find(&topUps).Error; err != nil {
		return nil, err
	}
	for _, t := range topUps {
		pl := out[t.LoanID]
		pl.TopUps = append(pl.TopUps, t)
		out[t.LoanID] = pl
	}

	var reqs []models.LoanRequest
	if err := config.DB.WithContext(ctx).Preload("OrnamentSelections").Where("loan_id IN ?", ids).Order("id").Find(&reqs).Error; err != nil {
		return nil, err
	}
	approvals := map[uint][]models.RequestApproval{}
	if len(reqs) > 0 {
		reqIDs := make([]uint, len(reqs))
		for i, r := range reqs {
			reqIDs[i] = r.ID
		}
		var rows []models.RequestApproval
		if err := config.DB.WithContext(ctx).Where("request_id IN ?", reqIDs).Order("id").Find(&rows).Error; err != nil {
			return nil, err
		}
		for _, a := range rows {
			approvals[a.RequestID] = append(approvals[a.RequestID], a)
		}
	}
	for _, r := range reqs {
		pl := out[r.LoanID]
		a := approvals[r.ID]
		if a == nil {
			a = []models.RequestApproval{}
		}
		pl.Requests = append(pl.Requests, pullRequest{LoanRequest: r, Approvals: a})
		out[r.LoanID] = pl
	}

	var auctions []models.AuctionRecord
	if err := preloadAuctionDetail(config.DB.WithContext(ctx)).Where("loan_id IN ?", ids).Order("id").Find(&auctions).Error; err != nil {
		return nil, err
	}
	for _, a := range auctions {
		pl := out[a.LoanID]
		pl.Auctions = append(pl.Auctions, a)
		out[a.LoanID] = pl
	}

	var packets []packetModels.Packet
	if err := config.DB.WithContext(ctx).Preload("Movements").Where("loan_id IN ?", ids).Order("id").Find(&packets).Error; err != nil {
		return nil, err
	}
	for _, p := range packets {
		pl := out[p.LoanID]
		mv := p.Movements
		if mv == nil {
			mv = []packetModels.PacketMovement{}
		}
		pl.Packets = append(pl.Packets, pullPacket{
			ID: p.ID, Code: p.Code, LoanID: p.LoanID, Status: p.Status, CurrentLockerID: p.CurrentLockerID,
			TotalGrossWeight: p.TotalGrossWeight, TotalNetWeight: p.TotalNetWeight, Movements: mv,
			CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
		})
		out[p.LoanID] = pl
	}
	return out, nil
}

// SyncIDs returns the UUIDs of the loans and customers this caller can see right now. A PC compares them with its local
// copy and drops what is no longer there: a record hard-deleted on the server, or moved to another branch, cannot be
// found by a "changed since" pull because the row is gone from this caller's view.
func SyncIDs(c echo.Context) error {
	ctx := auth.RequestContext(c)
	scope := pullBranchScope(c)

	lq := config.DB.WithContext(ctx).Model(&models.Loan{}).Where("deleted_at IS NULL")
	cq := config.DB.WithContext(ctx).Model(&commonModels.Customer{}).Where("deleted_at IS NULL")
	if scope != nil {
		lq = lq.Where("branch_id = ?", *scope)
		cq = cq.Where("(branch_id = ? OR id IN (SELECT customer_id FROM loans WHERE branch_id = ? AND deleted_at IS NULL))", *scope, *scope)
	}
	out := syncIDsResponse{Loans: []string{}, Customers: []string{}}
	if err := lq.Pluck("uuid", &out.Loans).Error; err != nil {
		return common.FailErr(c, err)
	}
	if err := cq.Pluck("uuid", &out.Customers).Error; err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, out)
}
