package loan

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/branch"
	"cloudhouse/backend/internal/commlog"
	"cloudhouse/backend/internal/customer"
	"cloudhouse/backend/internal/goldrate"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
	"cloudhouse/backend/internal/scheme"
	"cloudhouse/backend/internal/tenant"
	"cloudhouse/backend/internal/upload"
	"cloudhouse/backend/internal/workflow"
)

// PacketCreator auto-generates a loan's tracking packet right after
// creation ("Packet Generated" immediately follows "Loan Created" per the
// compliance doc's stage list). Implemented by packet.Service, injected as
// a narrow interface so internal/loan doesn't import internal/packet
// directly (packet already depends on loan for its joined display fields,
// so the dependency must stay one-directional).
type PacketCreator interface {
	CreatePacketForLoan(ctx context.Context, loanID uint, lockerID *uint) error
}

// CustomerNotifier delivers a durable, ack-tracked in-app notification to a
// customer's app (see internal/notification.Service, which implements this
// exactly) — injected as a narrow interface for the same reason as
// PacketCreator/CashRecorder: internal/loan must not import internal/
// notification directly. notifType/relatedEntityType/relatedEntityID mirror
// commlog's classification fields; title/body are the in-app list's
// user-facing text (title short, body the full sentence already built for
// WhatsApp).
type CustomerNotifier interface {
	Notify(ctx context.Context, customerID uint, notifType, title, body, relatedEntityType string, relatedEntityID uint)
}

// PacketMover records the matching packet movement when a loan's gold is
// pledged to / returned from a bank via RecordBankPledge/ReleaseBankPledge.
// Implemented by packet.Service, injected the same way as PacketCreator.
type PacketMover interface {
	RecordBankPledgeMovement(ctx context.Context, loanID uint, remarks string) error
	RecordBankReleaseMovement(ctx context.Context, loanID uint, remarks string) error
	// RecordGoldReleaseMovement moves a loan's packet through to Released —
	// called by CompleteRelease once every release gate has passed, and
	// also by RecordAuctionSale once the gold has actually been sold: an
	// auctioned loan's packet reads as an ordinary Released packet (the
	// gold left custody either way), not a separate status.
	RecordGoldReleaseMovement(ctx context.Context, loanID uint, remarks string) error
	// RecordPartialGoldReleaseMovement is CompleteRelease's Partial
	// Ornament Release counterpart to RecordGoldReleaseMovement above: only
	// some of the loan's ornaments are handed back, the packet stays in its
	// current stage (it's still physically holding the rest), and this just
	// logs the audit remark and decrements the packet's own weight totals
	// by what actually left custody.
	RecordPartialGoldReleaseMovement(ctx context.Context, loanID uint, releasedGrossWeight, releasedNetWeight float64, remarks string) error
}

// CashRecorder reflects a loan's real cash flow into Cash-in-Hand & Expenses
// (frontend/components/Cash.tsx): pledging gold with a bank brings cash in
// and NOTHING else — the bank's advance against pledged gold is borrowing,
// not spending, so it is deliberately not mirrored as an expense (it used to
// be, which double-counted one pledge as both Cash In and Expenses on the
// same day and inflated every expense report). Releasing it books the amount
// back out as a cash-out movement plus a release expense — that release is
// the only expense in the cycle — without touching the original cash-in
// entry, so both legs stay as permanent history.
// Disbursing a loan's principal to the customer is cash out, and every
// repayment is cash in. Implemented by cash.MovementService, injected the
// same way as PacketCreator/PacketMover so internal/loan doesn't import
// internal/cash directly.
type CashRecorder interface {
	RecordBankPledgeCashIn(ctx context.Context, loanID uint, loanNumber, bankName string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, bankID *uint, occurredOn time.Time) (movementID uint, err error)
	RecordBankPledgeCashOut(ctx context.Context, loanID uint, loanNumber, bankName string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, bankID *uint, occurredOn time.Time, branchID uint) (movementID uint, err error)
	RecordBankPledgeReleaseExpense(ctx context.Context, loanID uint, bankName string, amount float64, occurredOn time.Time, branchID uint) (expenseID uint, err error)

	// HeadOfficeBranchID is the branch every bank-pledge movement is booked
	// on (the branchID passed to the pledge methods above is ignored), so the
	// release balance check must look at that till, not the loan's.
	HeadOfficeBranchID(ctx context.Context) (uint, error)
	// DeleteCashMovement undoes one movement — used to roll a cash entry back
	// when the step that follows it fails, so a half-finished operation
	// never leaves cash in the books for something that was not saved.
	DeleteCashMovement(ctx context.Context, id uint) error

	// cashAmount/upiAmount/bankTransferAmount/chequeAmount split amount
	// across the mode CashMovement rows actually written (see
	// cash.MovementService.recordSplitCashMovement) — amount stays the
	// authoritative total. customerID (0 = none) populates CashMovement.
	// PartyCustomerID for the Party Transactions ledger. groupID is the
	// TransactionGroupID every row this call wrote shares — callers store
	// it (see LoanPayment.CashTransactionGroupID) so a payment can be
	// traced back to its full mode breakdown, not just a single row.
	RecordLoanDisbursementCashOut(ctx context.Context, loanID uint, loanNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, customerID uint, bankID *uint) (movementID uint, groupID string, err error)
	RecordLoanPaymentCashIn(ctx context.Context, loanID uint, loanNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, paymentType string, customerID uint, bankID *uint) (movementID uint, groupID string, err error)

	// RecordLoanTopUpCashOut books a loan top-up's cash-out — additional
	// principal handed to the customer against spare eligible value,
	// functionally an additional disbursement (same direction as
	// RecordLoanDisbursementCashOut). Purely additive to this interface: one
	// new method, one implementer (cash.MovementService) to update, no
	// other caller disturbed.
	RecordLoanTopUpCashOut(ctx context.Context, loanID uint, loanNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, customerID uint) (movementID uint, groupID string, err error)

	// RecordServiceChargeCashIn books a WithheldFromPayout scheme service
	// charge as company income at disbursement time — the charge never
	// leaves the till (it's deducted from what's paid out, not paid out
	// and then collected back), so this is a plain single-mode cash-in,
	// not a split like the other Record*CashOut/CashIn methods here.
	RecordServiceChargeCashIn(ctx context.Context, loanID uint, loanNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, bankID *uint) (movementID uint, err error)

	// RecordAuctionSaleCashIn books the NET proceeds of an auction (sale price
	// less auction expenses) into Cash-in-Hand. Previously an auction recorded
	// no cash movement at all, so money the branch genuinely received never
	// appeared in the books.
	RecordAuctionSaleCashIn(ctx context.Context, loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time) (movementID uint, err error)
	// RecordAuctionSurplusCashOut books the refund of an auction surplus back
	// to the customer. Called only for the RefundedToCustomer disposition —
	// retaining the surplus as income needs no movement, because the full net
	// proceeds already came in via RecordAuctionSaleCashIn.
	RecordAuctionSurplusCashOut(ctx context.Context, loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time) (movementID uint, err error)

	// DeleteLoanDisbursementCashMovements retracts a loan's disbursement
	// cash-out (and withheld-service-charge cash-in, if any) — called from
	// UpdateLoan when a materially edited, already-disbursed loan is
	// resubmitted for approval, since it will be disbursed again at the new
	// amount once re-sanctioned and the stale entry must not stay behind.
	DeleteLoanDisbursementCashMovements(ctx context.Context, loanNumber string) error

	// DeleteAllLoanCashEntries wipes every cash movement/expense tied to a
	// loan — called from HardDeleteLoan so a permanently deleted loan leaves
	// nothing behind in the ledger. movementIDs/expenseIDs are the bank-pledge
	// rows, which carry no loan number in their Purpose.
	DeleteAllLoanCashEntries(ctx context.Context, loanNumber string, movementIDs, expenseIDs []uint) error
}

var (
	ErrNotFound              = httpx.NewNotFound("loan not found")
	ErrOrnamentNotFound      = httpx.NewNotFound("ornament not found")
	ErrReleaseAlreadyPending = httpx.NewConflict("a release has already been requested for this loan and is waiting for approval")
	ErrBranchInvalid         = httpx.NewBadRequest("branch does not exist")
	ErrCustomerInvalid       = httpx.NewBadRequest("customer does not exist")
	ErrSchemeInvalid         = httpx.NewBadRequest("scheme does not exist")
	ErrNoOrnaments           = httpx.NewBadRequest("at least one ornament is required")
	ErrNoGoldRate            = httpx.NewBadRequest("no gold rate has been published yet")
	ErrGoldRateNotSetToday   = httpx.NewBadRequest("today's gold rate has not been set yet — please publish it before creating a loan")
	ErrInvalidPurity         = httpx.NewBadRequest("purity must be a karat like \"22K\" (10-24) or a fineness percentage like \"91.6%\" (0-100)")
	ErrInvalidWeight         = httpx.NewBadRequest("gross weight must be greater than zero")
	ErrPrincipalTooHigh      = httpx.NewBadRequest("principal amount cannot exceed the eligible loan amount")
	ErrInvalidPrincipal      = httpx.NewBadRequest("principal amount must be greater than zero")
	ErrInvalidDueDate        = httpx.NewBadRequest("due date must be after the opened date")
	ErrFutureOpenedDate      = httpx.NewBadRequest("loan date cannot be in the future")
	ErrWrongStage            = httpx.NewBadRequest("approval action does not match the loan's current approval stage")
	ErrAlreadyDecided        = httpx.NewBadRequest("loan  already disbursed")
	ErrInvalidAction         = httpx.NewBadRequest("action must be Approved or Rejected")
	ErrInvalidAmount         = httpx.NewBadRequest("amount must be greater than zero")
	ErrRequestNotFound       = httpx.NewNotFound("loan request not found")
	ErrInvalidRequestType    = httpx.NewBadRequest("type must be Extension or Release")
	ErrInvalidMonths         = httpx.NewBadRequest("requested extension months must be greater than zero")
	ErrExtensionNeedsPayment = httpx.NewBadRequest("outstanding interest and penal interest must be paid before an extension can be requested")
	ErrRequestAlreadyDecided = httpx.NewBadRequest("loan request has already been decided")
	ErrInvalidPaymentType    = httpx.NewBadRequest("type must be Interest, Principal, Partial, Full Settlement, Adjustment, Waiver, or Discount")
	ErrNotExtensionRequest   = httpx.NewBadRequest("this request is not an Extension request")
	ErrNotReleaseRequest     = httpx.NewBadRequest("this request is not a Release request")
	// ErrUseStagedExtensionApproval is returned by the old single-step
	// DecideRequest when called for an Extension request — extension
	// requests now go through the same 3-stage approval chain as Release
	// (see Service.ApproveExtensionRequest), never a single decide call.
	ErrUseStagedExtensionApproval = httpx.NewBadRequest("extension requests are now decided through the staged approval chain — use POST /loans/requests/:requestId/approve instead")
	ErrLoanAwaitingApproval       = httpx.NewBadRequest("this loan is still pending approval — extension or release can only be requested once it is approved and disbursed")
	ErrLoanTerminalState          = httpx.NewBadRequest("loan is already Closed, Auctioned, or Defaulted — nothing left to extend")
	ErrChecklistIncomplete        = httpx.NewBadRequest("\"Customer has seen the gold\" must be ticked and a payment recorded before this can be approved")
	// ErrTopUpShortfall mirrors personalloan.ErrRenewalShortfall exactly —
	// the requested top-up exceeds the loan's current headroom
	// (EligibleLoanAmount - OutstandingAmount); reject, don't clamp.
	ErrTopUpShortfall      = httpx.NewBadRequest("requested amount exceeds the loan's available headroom — add more ornaments first")
	ErrTopUpAlreadyPending = httpx.NewConflict("this loan already has a top-up waiting for approval")
	ErrTopUpNotFound       = httpx.NewNotFound("top-up not found")
	ErrTopUpAlreadyDecided = httpx.NewConflict("this top-up has already been approved or rejected")
	// ErrLoanNotActiveForTopUp guards TopUpLoan: only an Active loan has
	// spare eligible value worth drawing against.
	ErrLoanNotActiveForTopUp = httpx.NewConflict("loan must be Active to top up")
	// ErrTopUpNeedsPayment mirrors ErrExtensionNeedsPayment — returned when
	// TopUpInput.SettleInterest is "require" and outstanding interest/penal
	// interest still stands (same rationale: extending the customer's credit
	// on top of unpaid arrears would just let them compound further).
	ErrTopUpNeedsPayment = httpx.NewBadRequest("outstanding interest and penal interest must be paid before a top-up can proceed, or set the top-up to deduct it from the payout instead")
	// ErrNotManagerStage guards RecordReleasePayment: recording a payment/
	// discount from the release review screen is only allowed while the
	// request is still at the first (Manager) stage — once it has moved to
	// Management the normal ApproveReleaseRequest/CompleteRelease path takes
	// over, unchanged by this feature.
	ErrNotManagerStage = httpx.NewBadRequest("payment can only be recorded while the release request is at the Manager review stage")
	// ErrDueDateRequired is returned by RecordReleasePayment when the
	// discount+payment entered don't cover the final settlement and no due
	// date was supplied for the remaining balance.
	ErrDueDateRequired = httpx.NewBadRequest("a due date is required when the recorded amount doesn't cover the full settlement")
	// ErrPaymentNotCleared guards VerifyReleaseChecklist: staff may tick the
	// Record Payment checklist item by hand (e.g. the balance was paid off
	// through the loan's ordinary Record Payment screen rather than this
	// release review's own Discount/Payment fields), but only once the
	// loan's outstanding balance has actually reached zero — ticking it
	// is an attestation, not the thing that makes it true.
	ErrPaymentNotCleared = httpx.NewBadRequest("the loan's outstanding balance is not yet fully paid — cannot mark payment verified")
	// ErrReleaseNotApproved is classified NotFound (not BadRequest) — a
	// pre-existing choice this migration preserves: "no approved release
	// request" surfaces the same as a missing resource.
	ErrReleaseNotApproved        = httpx.NewNotFound("this loan has no approved release request")
	ErrOutstandingBalanceRemains = httpx.NewBadRequest("the final settlement has not been fully paid yet — record the remaining payment before releasing the gold")
	ErrBankPledgeStillActive     = httpx.NewBadRequest("gold is still pledged to a bank — release the bank pledge before releasing it to the customer")
	// ErrLoanNotPledgeable guards the bank re-pledge entry points against
	// loans whose gold is no longer in the branch's custody to hand over —
	// see bankPledgeIneligibleStatuses.
	ErrLoanNotPledgeable = httpx.NewBadRequest("this loan's gold is no longer held by the branch (closed, released or auctioned), so it cannot be re-pledged to a bank")
	// ErrBankPledgeAlreadyUsed covers a loan whose pledge has already been
	// released back from the bank: one bank pledge per loan, for its
	// lifetime. Distinct from ErrBankPledgeStillActive, which is the
	// not-yet-released case.
	ErrBankPledgeAlreadyUsed = httpx.NewBadRequest("this loan's gold has already been pledged to a bank and released once — it cannot be pledged again")
	ErrAuctionNotFound       = httpx.NewNotFound("this loan has no auction case yet — mark it auction-eligible first")
	ErrLoanNotDefaulted      = httpx.NewBadRequest("loan must be Defaulted (overdue by more than 90 days) before it can be marked auction-eligible")
	ErrAuctionAlreadyStarted = httpx.NewBadRequest("this loan already has an auction case in progress")
	ErrAuctionWrongStage     = httpx.NewBadRequest("action does not match the auction case's current stage")
	// ErrAuctionStepNotPermitted: the acting employee's role isn't granted
	// the specific "Approval Workflow" permission this auction step requires
	// (see internal/authz.Catalogue) — previously these five steps (mark
	// eligible, issue notice, schedule, record sale, settle) were only
	// gated by the general "can update loan" permission.
	ErrAuctionStepNotPermitted = httpx.NewForbidden("your role does not have permission to perform this auction step")

	// ErrDraftNotFound covers both "no such draft" and "not yours" — a draft
	// belongs to the employee who saved it (see LoanDraft), and answering
	// "exists, but not yours" would leak that someone else has one.
	ErrDraftNotFound = httpx.NewNotFound("loan draft not found")

	ErrInvalidCashTreatment = httpx.NewBadRequest("cashTreatment must be either \"CashIn\" or \"RecordOnly\"")
	ErrPledgeNotFound       = httpx.NewNotFound("bank pledge record not found")
	// ErrPledgeNotActive is a state conflict (already released/voided), not
	// a malformed request — Conflict, not BadRequest.
	ErrPledgeNotActive    = httpx.NewConflict("only an active bank pledge can be voided — this one is already released or voided")
	ErrVoidReasonRequired = httpx.NewBadRequest("a reason is required when voiding a bank pledge")

	// ErrAuctionDecisionPending blocks the auction pipeline while a repayment
	// decision is outstanding — a state conflict (409), not malformed input:
	// the request is well-formed, it simply conflicts with the case's current
	// state, and retrying after the decision is made will succeed. This is
	// the safety guarantee that stops gold being sold out from under a
	// customer whose payment is still under review.
	ErrAuctionDecisionPending = httpx.NewConflict("a repayment decision is pending on this auction — it must be resolved before the auction can proceed")

	ErrAuctionDecisionNotFound       = httpx.NewNotFound("auction decision request not found")
	ErrAuctionDecisionAlreadyDecided = httpx.NewConflict("this auction decision has already been made")
	ErrInvalidAuctionDecision        = httpx.NewBadRequest("decision is not valid for this kind of auction request")
	// ErrShortfallAuthorityRequired: a role that reached the route but may
	// not perform this specific action (only Branch Manager/Management/
	// Administrator may decide a shortfall) — Forbidden, not BadRequest.
	ErrShortfallAuthorityRequired    = httpx.NewForbidden("only a Branch Manager, Management, or Administrator may decide a post-auction shortfall")
	ErrPartialRepaymentAuthority     = httpx.NewForbidden("your role may not decide whether a part-paid loan stays in auction")
	ErrAuctionBalanceDueCannotSettle = httpx.NewBadRequest("this auction left a balance owing — resolve the shortfall decision instead of settling")
	// ErrAuctionAlreadyConcluded: SettleAuction was called against a case
	// that has already left the Auctioned stage (typically Settled) —
	// distinct from ErrAuctionWrongStage's other causes (e.g. calling it
	// before a sale is even recorded) so a stale client screen that still
	// shows a "Settle Surplus" button gets a message that actually explains
	// what happened, rather than the generic wrong-stage text.
	ErrAuctionAlreadyConcluded   = httpx.NewConflict("this auction case has already been settled")
	ErrNoSurplusToDispose        = httpx.NewBadRequest("this auction left no surplus to dispose of")
	ErrSurplusAlreadyDisposed    = httpx.NewConflict("this auction's surplus has already been disposed of")
	ErrInvalidSurplusDisposition = httpx.NewBadRequest("surplus disposition must be either \"RefundedToCustomer\" or \"RecordedAsIncome\"")
	ErrSettlementRemarksRequired = httpx.NewBadRequest("remarks are required when a customer's auction surplus is retained as income")
	ErrDecisionRemarksRequired   = httpx.NewBadRequest("remarks are required for this decision")

	// ErrEsignNotConfigured/ErrNoIndemnityBondSignRequest are returned by the
	// indemnity-bond Aadhaar eSign flow (StartIndemnityBondSign/
	// CheckIndemnityBondSign) — same shape as customer.Service's
	// ErrDigilockerNotConfigured/ErrNoDigilockerRequest.
	ErrEsignNotConfigured         = httpx.NewUnavailable("indemnity bond eSign is not configured")
	ErrNoIndemnityBondSignRequest = httpx.NewBadRequest("no indemnity bond eSign has been started for this loan")
	// ErrIndemnityBondAlreadySigned is a state conflict — Conflict, not BadRequest.
	ErrIndemnityBondAlreadySigned = httpx.NewConflict("this loan's indemnity bond has already been signed")
	// The message previously read `lang must be "en" or "gu"` while the code
	// validated "ml" — it named a language the server could not produce and
	// omitted the one it could.
	ErrUnsupportedIndemnityBondLang = httpx.NewBadRequest("lang must be \"en\", \"ml\" or \"gu\"")
	// ErrLanguageNotEnabled is distinct from ErrUnsupportedIndemnityBondLang:
	// the language is real and this server can render it, but this business
	// has not been granted it (see tenant.Tenant.HasLanguage).
	ErrLanguageNotEnabled              = httpx.NewForbidden("this business is not set up to issue documents in that language")
	ErrUnsupportedIndemnityBondDeliver = httpx.NewBadRequest("deliverBy must be \"open\", \"whatsapp\" or \"dashboard\"")

	// --- Partial Ornament Release ------------------------------------------

	// ErrRequestLocked is a state conflict (Locked is a real prior action —
	// a payment already recorded — not a malformed request), returned when
	// a Rejected approval action or a CustomerSawGold change is attempted
	// against a release request that a payment has already locked. See
	// LoanRequest.Locked's doc comment for why RecordPayment itself is
	// deliberately NOT gated by this.
	ErrRequestLocked = httpx.NewConflict("this release request is locked after payment — it can no longer be rejected or have its checklist changed")
	// ErrDriftPaymentRequired is ApproveReleaseRequest's refusal of a
	// Partial Ornament Release's final (Management) approval when live
	// drift (partialReleaseDrift, no buffer) has crept back above zero
	// since the request was created — e.g. extra penal interest accrued in
	// the meantime. Conflict, not BadRequest: the request itself was valid
	// when submitted, it is the passage of time that broke the condition.
	// The frontend responds by revealing the Top-Up Payment field.
	ErrDriftPaymentRequired = httpx.NewConflict("outstanding balance has drifted above what the remaining collateral supports — record a top-up payment before approving")
)

// Service implements loan business rules: ornament valuation, eligible-
// amount calculation, the fixed 3-step approval chain, and the lightweight
// payment/bank-pledge audit trail.
type Service struct {
	// db is used ONLY to wrap the auction flows that write several tables at
	// once (sale, decision resolution, and the auction hook inside
	// RecordPayment) in a transaction. Those are the paths where a failure
	// part-way could leave gold sold with no record of the proceeds, or a
	// payment recorded without the auction being frozen.
	//
	// The rest of this service keeps the codebase's existing non-transactional,
	// log-and-continue style — no transaction infrastructure existed here
	// before, and converting every write path was out of scope.
	db platform.DB

	repo                *Repository
	ornamentRepo        *OrnamentRepository
	approvalRepo        *ApprovalRepository
	paymentRepo         *PaymentRepository
	pledgeRepo          *BankPledgeRepository
	requestRepo         *LoanRequestRepository
	requestApprovalRepo *RequestApprovalRepository
	auctionRepo         *AuctionRepository

	// draftRepo/topUpRepo are built from db inside NewService rather than
	// being passed in like the repositories above — neither has another
	// consumer, and this constructor already takes 21 arguments.
	draftRepo *DraftRepository
	topUpRepo *LoanTopUpRepository

	branchRepo   *branch.Repository
	customerRepo *customer.Repository
	schemeRepo   *scheme.Repository
	goldRateRepo *goldrate.Repository

	packetCreator PacketCreator
	packetMover   PacketMover
	cashRecorder  CashRecorder
	notifier      CustomerNotifier   // nil-safe — see notifyCustomer
	whatsapp      platform.SMSSender // reused interface — Send(phone, message) matches SMSSender exactly
	commlogRepo   *commlog.Repository

	// esign drives the indemnity bond's Aadhaar eSign flow (see
	// indemnitybond.go, StartIndemnityBondSign/CheckIndemnityBondSign). nil
	// when SETU_ESIGN_* isn't configured — every method using it checks
	// first and returns ErrEsignNotConfigured rather than a nil-pointer
	// panic, same posture as customer.Service's setu/digilocker fields.
	esign      *platform.EsignClient
	uploadsDir string
	// uploadRepo records server-generated files (the signed indemnity bond)
	// so they resolve through the authenticated file handler like any other
	// upload. Without the record the PDF is written but unreachable.
	uploadRepo *upload.Repository
	// tenantRepo supplies the business name printed on a customer-facing
	// statement. A statement handed to a customer under another business's
	// name is the most visible possible version of a tenancy mistake.
	tenantRepo *tenant.Repository

	// razorpay drives customer-app online loan payments (see
	// CreateRazorpayOrder/VerifyAndRecordRazorpayPayment in payment.go). nil
	// when RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET aren't configured — those
	// methods check first and return ErrRazorpayNotConfigured rather than a
	// nil-pointer panic, same posture as esign above.
	razorpay *platform.RazorpayClient

	// aadhaarCipher decrypts a customer's full Aadhaar number (same key/
	// cipher as customer.Service's aadhaarCipher) so bondDataForLoan can
	// prefill it on the Aadhaar-eSign PDF, mirroring what the printable
	// pledge agreement shows via customer.Service.DecryptAadhaar.
	aadhaarCipher *platform.Cipher

	// permChecker gates every stage of the loan sanction/extension/release
	// approval chains, plus each auction decision/process step, against the
	// "Approval Workflow" permissions (see internal/authz.Catalogue) instead
	// of the hardcoded role-name comparisons these used before — see
	// checkStagePermission's doc comment. Reuses platform.PermissionChecker
	// (the same interface RequirePermission's middleware already checks
	// ordinary CRUD permissions against) rather than importing internal/authz
	// directly, structurally satisfied by *authz.Repository — see main.go's
	// wiring.
	permChecker platform.PermissionChecker

	// cashGuard blocks a payout larger than the branch's Balance in Hand —
	// see SetCashBalanceGuard. nil skips the check.
	cashGuard CashBalanceGuard

	// workflowSvc resolves which approval stages this tenant has switched on
	// for each chain (see internal/workflow and SetWorkflow). nil falls back
	// to the catalogue defaults — the chains exactly as they were hardcoded.
	workflowSvc *workflow.Service
}

// SetWorkflow wires the per-tenant approval-workflow configuration.
func (s *Service) SetWorkflow(w *workflow.Service) {
	s.workflowSvc = w
}

// chain loads flow's configured stages for the tenant in ctx.
func (s *Service) chain(ctx context.Context, flow string) (*workflow.Chain, error) {
	return s.workflowSvc.Chain(ctx, flow)
}

// canDecideAuction reports whether roleID is the decider role of an auction
// decision flow (its chain's single step), or Administrator.
func (s *Service) canDecideAuction(ctx context.Context, roleID uint, flow string) bool {
	c, err := s.chain(ctx, flow)
	if err != nil {
		return false
	}
	st, _ := c.First()
	return s.workflowSvc.CanAct(ctx, roleID, flow, st.Key)
}

// CashBalanceGuard is satisfied by *cash.SummaryService — declared here so
// loan doesn't import cash (same reason as CashRecorder). EnsureCashInHand
// returns a Conflict error when amount exceeds the branch's Balance in Hand.
type CashBalanceGuard interface {
	EnsureCashInHand(ctx context.Context, branchID uint, amount float64) error
}

// SetCashBalanceGuard wires the Balance-in-Hand limit on disbursement,
// top-up and bank-pledge release — a setter rather than another NewService
// argument.
func (s *Service) SetCashBalanceGuard(g CashBalanceGuard) {
	s.cashGuard = g
}

// ensureCashInHand is a nil-safe wrapper around cashGuard.
func (s *Service) ensureCashInHand(ctx context.Context, branchID uint, amount float64) error {
	if s.cashGuard == nil {
		return nil
	}
	return s.cashGuard.EnsureCashInHand(ctx, branchID, amount)
}

func NewService(
	db platform.DB,
	repo *Repository,
	ornamentRepo *OrnamentRepository,
	approvalRepo *ApprovalRepository,
	paymentRepo *PaymentRepository,
	pledgeRepo *BankPledgeRepository,
	requestRepo *LoanRequestRepository,
	requestApprovalRepo *RequestApprovalRepository,
	auctionRepo *AuctionRepository,
	branchRepo *branch.Repository,
	customerRepo *customer.Repository,
	schemeRepo *scheme.Repository,
	goldRateRepo *goldrate.Repository,
	packetCreator PacketCreator,
	packetMover PacketMover,
	cashRecorder CashRecorder,
	notifier CustomerNotifier,
	whatsapp platform.SMSSender,
	commlogRepo *commlog.Repository,
	esign *platform.EsignClient,
	uploadsDir string,
	uploadRepo *upload.Repository,
	tenantRepo *tenant.Repository,
	razorpay *platform.RazorpayClient,
	aadhaarCipher *platform.Cipher,
	permChecker platform.PermissionChecker,
) *Service {
	return &Service{
		db:                  db,
		repo:                repo,
		ornamentRepo:        ornamentRepo,
		approvalRepo:        approvalRepo,
		paymentRepo:         paymentRepo,
		pledgeRepo:          pledgeRepo,
		requestRepo:         requestRepo,
		requestApprovalRepo: requestApprovalRepo,
		auctionRepo:         auctionRepo,
		draftRepo:           NewDraftRepository(db),
		topUpRepo:           NewLoanTopUpRepository(db),
		branchRepo:          branchRepo,
		customerRepo:        customerRepo,
		schemeRepo:          schemeRepo,
		packetCreator:       packetCreator,
		packetMover:         packetMover,
		cashRecorder:        cashRecorder,
		notifier:            notifier,
		goldRateRepo:        goldRateRepo,
		whatsapp:            whatsapp,
		commlogRepo:         commlogRepo,
		esign:               esign,
		uploadsDir:          uploadsDir,
		uploadRepo:          uploadRepo,
		tenantRepo:          tenantRepo,
		razorpay:            razorpay,
		aadhaarCipher:       aadhaarCipher,
		permChecker:         permChecker,
	}
}

// checkStagePermission is the one place every approval-stage/auction-step
// gate below calls through — replaces what used to be a direct
// `actorRole != "<literal>"` string comparison per call site. A permission
// lookup failure (permChecker nil, e.g. in a test that doesn't wire one, or
// the DB query itself erroring) fails CLOSED (denies), the same as
// platform.RequirePermission's own middleware does for the equivalent CRUD
// checks — a broken permission lookup must never silently grant access.
func (s *Service) checkStagePermission(ctx context.Context, roleID uint, permissionName string) bool {
	if s.permChecker == nil {
		return false
	}
	allowed, err := s.permChecker.IsAllowed(ctx, roleID, permissionName)
	if err != nil {
		return false
	}
	return allowed
}

// notifyCustomer sends a WhatsApp message to a customer about a loan event
// (submission, sanction, etc.), logs the attempt (success or failure) to
// commlog for the Communication History report, AND — independently of
// whether WhatsApp is configured/succeeds — writes a durable in-app
// Notification and attempts a live push over the customer's WebSocket (see
// internal/notification). A notification bounce on either channel must
// never fail the loan operation it's attached to, the same
// enrichment-not-hard-dependency rule Create already applies to packet
// auto-creation. The two channels are deliberately independent: a customer
// with no WhatsApp/no phone on file still gets the in-app notification, and
// vice versa if the realtime notifier isn't wired up. title is a short
// user-facing label for the in-app notification list (the WhatsApp message
// stays the existing full-sentence copy); triggerType/relatedEntityType/
// relatedEntityID classify the event for both commlog and Notification.Type.
//
// The WhatsApp send (an outbound HTTP call to OpenWA, up to its client's own
// 15s timeout) runs in its own goroutine rather than inline: this used to
// block the calling request — a loan sanction, an extension/release
// approval, an auction step — on OpenWA actually confirming delivery before
// the HTTP response could return, so a slow or unreachable WhatsApp gateway
// made every one of those actions feel hung even though the underlying loan
// state change had already committed. The commlog write moves along with it
// (it needs the send's own success/failure to record), so the audit trail
// still reflects the real outcome — just written a moment after the request
// that triggered it has already returned.
//
// The WhatsApp leg runs in the BACKGROUND. It is an HTTP round-trip to an
// external gateway, and holding the request open for it made every button
// that triggers a customer message (Issue Auction Notice, sanction, release,
// …) sit spinning for as long as the gateway took to answer. Nothing was
// gained by waiting: the send result is only ever written to commlog and
// logged — it is never returned to the caller and never fails the operation
// (see this function's contract above), so the staff member learns nothing
// from the wait. Delivery outcomes are read from the Communication History
// report, which is where they belonged all along.
func (s *Service) notifyCustomer(ctx context.Context, customerID uint, phone, title, message, triggerType, relatedEntityType string, relatedEntityID uint) {
	if s.whatsapp != nil {
		// tenantID is read from ctx BEFORE spawning the goroutine below: the
		// request's own pinned connection (see platform.PinTenantConn) is
		// released the instant this handler returns, almost always before
		// that goroutine's commlog write runs, so a write still riding that
		// connection fails every time with "sql: connection is already
		// closed" — silently dropping the audit row for every one of these
		// notifications. commlogRepo.CreateBackground checks out its OWN
		// short-lived connection instead, scoped to this tenant, so it has
		// nothing to race against — see its doc comment.
		tenantID, _ := platform.TenantFromContext(ctx)
		go func() {
			// A panic in a detached goroutine takes the whole process with
			// it; a failed courtesy message must never do that.
			defer func() {
				if r := recover(); r != nil {
					log.Printf("whatsapp notification panicked (phone %s): %v", phone, r)
				}
			}()
			sendErr := s.whatsapp.Send(phone, message)
			if sendErr != nil {
				log.Printf("whatsapp notification failed (phone %s): %v", phone, sendErr)
			}
			if s.commlogRepo != nil {
				rec := &commlog.CommunicationLog{
					RecipientPhone:    phone,
					ChatID:            commlog.NormalizeChatID(phone),
					Channel:           commlog.ChannelWhatsApp,
					TriggerType:       triggerType,
					MessageBody:       message,
					RelatedEntityType: relatedEntityType,
					RelatedEntityID:   relatedEntityID,
					Status:            commlog.StatusSent,
				}
				if sendErr != nil {
					rec.Status = commlog.StatusFailed
					rec.ErrorMessage = sendErr.Error()
				}
				if err := s.commlogRepo.CreateBackground(tenantID, rec); err != nil {
					log.Printf("communication log write failed (phone %s): %v", phone, err)
				}
			}
		}()
	}
	if s.notifier != nil {
		s.notifier.Notify(ctx, customerID, triggerType, title, message, relatedEntityType, relatedEntityID)
	}
}

// OrnamentInput mirrors the fields captured for one pledged item at
// loan-creation time.
type OrnamentInput struct {
	Name            string
	Purity          string
	GrossWeight     float64
	DeductionWeight float64
	Quantity        int
	Remarks         string
}

// CreateInput mirrors the fields the operator supplies when opening a loan.
type CreateInput struct {
	BranchID        uint
	CustomerID      uint
	SchemeID        uint
	OpenedDate      time.Time
	DueDate         time.Time
	PrincipalAmount float64
	Ornaments       []OrnamentInput
	// LockerID optionally checks the loan's auto-created packet straight
	// into a locker at creation time, instead of requiring a separate
	// manual "check in to locker" step afterward.
	LockerID *uint
	// AdditionalInfo is free text captured at creation time — see Loan's
	// own field doc.
	AdditionalInfo string

	// ServiceChargeMode overrides the scheme's default collection mode for
	// this loan (the operator chooses it at creation). Empty = use the
	// scheme's.
	ServiceChargeMode string
}

// rateForPurity lives in purity.go (parses "22K"/"91.6%" and resolves the
// per-gram rate off the day's K24 benchmark).

// valueOrnament fills in NetWeight/GoldValue on an ornament:
//
//	NetWeight = GrossWeight - DeductionWeight
//	GoldValue = NetWeight × applicable Gold Rate (matched to declared purity)
func valueOrnament(o *Ornament, gr *goldrate.GoldRate) error {
	if o.GrossWeight <= 0 {
		return ErrInvalidWeight
	}
	rate, err := rateForPurity(gr, o.Purity)
	if err != nil {
		return err
	}
	o.NetWeight = o.GrossWeight - o.DeductionWeight
	if o.NetWeight < 0 {
		o.NetWeight = 0
	}
	o.GoldValue = o.NetWeight * rate
	return nil
}

// recalculateTotals sums a loan's ornaments into its denormalized totals
// and recomputes EligibleLoanAmount = TotalGoldValue × SchemeLTVPercent/100,
// using the loan's own frozen scheme snapshot rather than a live scheme
// lookup.
func recalculateTotals(l *Loan, ornaments []Ornament) {
	var totalNet, totalValue float64
	for _, o := range ornaments {
		totalNet += o.NetWeight
		totalValue += o.GoldValue
	}
	l.TotalNetWeight = totalNet
	l.TotalGoldValue = totalValue
	l.EligibleLoanAmount = totalValue * (l.SchemeLTVPercent / 100)
}

// partialReleaseRemaining is the Partial Ornament Release eligibility check,
// evaluated at SELECTION/creation time (CreateReleaseRequest): how much more
// the customer needs to pay down (or how much MORE collateral they need to
// leave pledged) before the ornaments they want back can safely be released.
//
//	remaining = (outstandingBalance + buffer) - (remainingGoldValue × ltvPercent / 100)
//
// partialReleaseRemaining is the buffered version of the Partial Ornament
// Release collateral check — buffer = 5% of the loan's PrincipalAmount,
// deliberately included here (and nowhere else) to absorb ordinary drift
// between the moment a customer selects ornaments and the moment staff
// actually act on the request. No longer a HARD GATE on CreateReleaseRequest
// itself (a customer may log a partial release before paying anything
// down — see that function's own doc comment) — kept as the same pure,
// tested formula the frontend's own live warning mirrors, available for a
// future caller that wants this buffered figure rather than
// partialReleaseDrift's unbuffered one below.
//
// remaining <= 0 means the condition is met as-is; remaining > 0 is the
// amount still needed.
func partialReleaseRemaining(outstandingBalance, principalAmount, remainingGoldValue, ltvPercent float64) float64 {
	buffer := 0.05 * principalAmount
	return (outstandingBalance + buffer) - (remainingGoldValue * ltvPercent / 100)
}

// partialReleaseDrift is partialReleaseRemaining's no-buffer counterpart,
// and the SOLE point that actually enforces the collateral condition — at
// Management approval time, via ApproveReleaseRequest:
//
//	drift = outstandingBalance - (remainingGoldValue × ltvPercent / 100)
//
// drift <= 0 means the remaining collateral still covers the live balance
// and approval proceeds normally; drift > 0.01 means it no longer does, and
// ApproveReleaseRequest refuses with ErrDriftPaymentRequired until a top-up
// payment (recorded via the ordinary RecordPayment path — see
// LoanRequest.Locked's doc comment on why that call is never blocked by
// Locked) brings it back to zero or below.
func partialReleaseDrift(outstandingBalance, remainingGoldValue, ltvPercent float64) float64 {
	return outstandingBalance - (remainingGoldValue * ltvPercent / 100)
}

func (s *Service) Create(ctx context.Context, in CreateInput) (*Loan, error) {
	if len(in.Ornaments) == 0 {
		return nil, ErrNoOrnaments
	}
	if in.PrincipalAmount <= 0 {
		return nil, ErrInvalidPrincipal
	}
	if !in.DueDate.After(in.OpenedDate) {
		return nil, ErrInvalidDueDate
	}
	// Staff may backdate a loan (interest accrues from OpenedDate — see
	// LastAccrualDate below) but never post-date one. Compared as calendar
	// dates in time.Local, same as the gold-rate "today" check further down.
	if in.OpenedDate.Format("2006-01-02") > time.Now().Format("2006-01-02") {
		return nil, ErrFutureOpenedDate
	}

	branchOK, err := s.branchRepo.Exists(ctx, in.BranchID)
	if err != nil {
		return nil, err
	}
	if !branchOK {
		return nil, ErrBranchInvalid
	}

	if _, err := s.customerRepo.FindByID(ctx, in.CustomerID); err != nil {
		return nil, ErrCustomerInvalid
	}

	sch, err := s.schemeRepo.FindByID(ctx, in.SchemeID)
	if err != nil {
		return nil, ErrSchemeInvalid
	}

	rate, err := s.goldRateRepo.FindLatest(ctx)
	if err != nil {
		return nil, ErrNoGoldRate
	}
	now := time.Now()
	if rate.Date.Year() != now.Year() || rate.Date.YearDay() != now.YearDay() {
		return nil, ErrGoldRateNotSetToday
	}

	ornaments := make([]Ornament, 0, len(in.Ornaments))
	for _, oi := range in.Ornaments {
		o := Ornament{
			Name:            oi.Name,
			Purity:          oi.Purity,
			GrossWeight:     oi.GrossWeight,
			DeductionWeight: oi.DeductionWeight,
			Quantity:        oi.Quantity,
			Remarks:         oi.Remarks,
		}
		if o.Quantity <= 0 {
			o.Quantity = 1
		}
		if err := valueOrnament(&o, rate); err != nil {
			return nil, err
		}
		ornaments = append(ornaments, o)
	}

	firstStage, err := s.firstSanctionStage(ctx)
	if err != nil {
		return nil, err
	}

	rec := &Loan{
		BranchID:         in.BranchID,
		CustomerID:       in.CustomerID,
		SchemeID:         in.SchemeID,
		OpenedDate:       in.OpenedDate,
		DueDate:          in.DueDate,
		AdditionalInfo:   in.AdditionalInfo,
		Status:           StatusPendingApproval,
		ApprovalStage:    firstStage,
		BankPledgeStatus: BankPledgeStatusNotPledged,
		// Interest accrues from the day the loan is opened, not from
		// whenever it happens to first be viewed/paid against.
		LastAccrualDate: in.OpenedDate,
	}
	rec.applySchemeSnapshot(sch)
	switch in.ServiceChargeMode {
	case "":
	case scheme.ServiceChargeModeWithheldFromPayout, scheme.ServiceChargeModeAddedToPrincipal:
		rec.ServiceChargeMode = in.ServiceChargeMode
	default:
		return nil, httpx.NewBadRequest("invalid serviceChargeMode")
	}
	if rec.ServiceChargeMode == "" {
		rec.ServiceChargeMode = scheme.ServiceChargeModeWithheldFromPayout
	}
	recalculateTotals(rec, ornaments)

	// The service charge amount is computed once here, against the
	// principal the operator actually chose, and frozen from then on
	// (ServiceChargeAmount is never recomputed on a later edit — see
	// UpdateLoan's own doc comment). AddedToPrincipal rolls the charge
	// straight into what's borrowed (and therefore what interest accrues
	// on) — the FINAL principal (operator's chosen amount + charge) is
	// what must fit within EligibleLoanAmount below, same gold-coverage
	// safety check as an ordinary loan, so a loan with an added charge is
	// never under-collateralized by the charge amount; the operator may
	// need to choose a lower base amount to leave room for it.
	// WithheldFromPayout leaves PrincipalAmount/OutstandingAmount
	// untouched here — the reduction happens only at actual disbursement
	// time (see Approve's FinalSanction branch), since the charge is
	// deducted from the payout, not added to the debt.
	rec.ServiceChargeAmount = computeServiceChargeAmount(rec.ServiceChargeType, rec.ServiceChargeValue, in.PrincipalAmount)
	finalPrincipal := in.PrincipalAmount
	if rec.ServiceChargeMode == scheme.ServiceChargeModeAddedToPrincipal && rec.ServiceChargeAmount > 0 {
		finalPrincipal = platform.RoundMoney(in.PrincipalAmount + rec.ServiceChargeAmount)
	}
	// Compared at paise precision (same as UpdateLoan below): the eligible
	// amount is a float product of weight × rate × LTV, so a figure displayed
	// as 453900.00 can be 453899.9999… underneath and would reject the very
	// amount the operator was shown.
	// The cap applies to the amount the operator entered (the loan amount to
	// disburse), NOT to the final principal: an AddedToPrincipal charge sits
	// on top of the eligible amount rather than eating into it.
	if platform.RoundMoney(in.PrincipalAmount) > platform.RoundMoney(rec.EligibleLoanAmount) {
		return nil, ErrPrincipalTooHigh
	}
	rec.EligibleLoanAmount = platform.RoundMoney(rec.EligibleLoanAmount)
	rec.PrincipalAmount = finalPrincipal
	rec.OutstandingAmount = rec.PrincipalAmount

	// Derived from the highest suffix ever issued (including hard-deleted
	// loans), not a live row COUNT — see MaxLoanNumberSuffix's own doc
	// comment for why COUNT+1 can regenerate a number a surviving loan
	// already holds once anything's ever been hard-deleted.
	maxSuffix, err := s.repo.MaxLoanNumberSuffix(ctx)
	if err != nil {
		return nil, err
	}
	rec.LoanNumber = fmt.Sprintf("LN-%05d", maxSuffix+1)

	if err := s.repo.Create(ctx, rec); err != nil {
		return nil, err
	}
	for i := range ornaments {
		ornaments[i].LoanID = rec.ID
		if err := s.ornamentRepo.Create(ctx, &ornaments[i]); err != nil {
			return nil, err
		}
	}

	created, err := s.repo.FindByID(ctx, rec.ID)
	if err != nil {
		return nil, err
	}

	// Packet auto-creation is an enrichment, not a hard dependency of the
	// core lending flow — log and continue on failure rather than failing
	// loan creation.
	if s.packetCreator != nil {
		if err := s.packetCreator.CreatePacketForLoan(ctx, created.ID, in.LockerID); err != nil {
			log.Printf("packet auto-creation failed for loan %d: %v", created.ID, err)
		}
	}

	s.enrich(ctx, created)

	s.notifyCustomer(ctx, created.CustomerID, created.Customer.Phone, "Loan Application Submitted", s.brandedMessage(ctx,
		"Dear %s, your gold loan application %s for ₹%.2f has been submitted and is pending approval. We'll notify you once it's sanctioned. — CloudHouse Finance",
		created.Customer.Name, created.LoanNumber, created.PrincipalAmount,
	), commlog.TriggerLoanSubmission, "loan", created.ID)

	return created, nil
}

// List returns matching loans plus the total row count for f's filters
// (ignoring Limit/Offset) — 0 when f.Limit <= 0 (see Repository.FindAll).
// --- Gold-value risk assessment ---------------------------------------
//
// Compares each open loan's PRINCIPAL against what its pledged gold would
// fetch if sold TODAY (unlike TotalGoldValue on the Loan itself, which is a
// snapshot computed at creation/last-recalculation time off THAT day's
// rate — see model_loan.go's own doc comment on that field). A gold-backed
// loan's real security is the gold, not the paperwork, so as the gold price
// moves the safety margin between what's lent and what's actually holding
// it up can erode — this flags that before it becomes an actual loss.

// RiskLevel classifies a loan's current gold-value-vs-principal safety
// margin (see ClassifyRisk for the exact thresholds).
type RiskLevel string

const (
	RiskSafe   RiskLevel = "Safe"   // comfortably covered
	RiskAtRisk RiskLevel = "AtRisk" // covered today, but the margin has eroded under the buffer
	RiskLoss   RiskLevel = "Loss"   // gold, sold today, would not cover the principal
)

// RiskBufferPercent is the safety margin, as a fraction of principal, that
// separates "At Risk" from "Safe". A loan whose gold would fetch less than
// principal alone is always Loss regardless of this buffer.
const RiskBufferPercent = 0.10

// ClassifyRisk applies the loss/at-risk/safe thresholds documented on
// RiskLevel's own constants:
//   - currentGoldValue < principalAmount                        → Loss
//   - currentGoldValue < principalAmount × (1 + RiskBufferPercent) → AtRisk
//   - otherwise                                                  → Safe
func ClassifyRisk(currentGoldValue, principalAmount float64) RiskLevel {
	if currentGoldValue < principalAmount {
		return RiskLoss
	}
	if currentGoldValue < principalAmount*(1+RiskBufferPercent) {
		return RiskAtRisk
	}
	return RiskSafe
}

// riskEligibleStatuses is every status where the loan still both (a) holds
// the customer's gold in custody and (b) owes a real principal against it —
// PendingApproval is excluded (principal chosen but never actually
// disbursed yet) and Closed/Auctioned/AuctionedBalanceDue are excluded (the
// gold is no longer what's securing anything, having already been returned
// or sold).
var riskEligibleStatuses = []string{
	StatusActive, StatusDueSoon, StatusOverdue, StatusClosureRequested,
	StatusDefaulted, StatusAuctionEligible,
}

// LoanRiskRow is one loan's risk-assessment listing row — see
// ListLoanRiskAssessment.
type LoanRiskRow struct {
	LoanID            uint      `json:"loanId"`
	LoanNumber        string    `json:"loanNumber"`
	CustomerID        uint      `json:"customerId"`
	CustomerName      string    `json:"customerName"`
	Status            string    `json:"status"`
	PrincipalAmount   float64   `json:"principalAmount"`
	OutstandingAmount float64   `json:"outstandingAmount"`
	TotalNetWeight    float64   `json:"totalNetWeight"`
	CurrentGoldValue  float64   `json:"currentGoldValue"`
	RiskLevel         RiskLevel `json:"riskLevel"`
}

// RiskAssessmentFilter narrows ListLoanRiskAssessment's results.
type RiskAssessmentFilter struct {
	// Status, when set, must be one of riskEligibleStatuses (checked by the
	// handler) and narrows to exactly that status. Empty means every
	// risk-eligible status (the page's default "All" view).
	Status      string
	BranchScope *uint

	// RiskLevel, when set, must be one of RiskSafe/RiskAtRisk/RiskLoss and
	// narrows to loans classified at exactly that level. Empty means every
	// level. Applied AFTER classification (see ListLoanRiskAssessment's own
	// doc comment on why RiskLevel can't be pushed into the SQL query), but
	// BEFORE Counts/Total are computed — unlike Limit/Offset below, this is
	// a real narrowing of the matching set, not just which page of it is
	// returned, so the KPI tiles reflect the filtered set the same way
	// Status/OpenedFrom/OpenedTo already do.
	RiskLevel RiskLevel

	// OpenedFrom/OpenedTo bound OpenedDate, both optional and inclusive —
	// same semantics as LoanFilter's own fields.
	OpenedFrom *time.Time
	OpenedTo   *time.Time

	// Query matches loan number or customer name/code — same semantics as
	// LoanFilter.Query, pushed into the SQL fetch, so (like Status) it
	// narrows Counts/Total too.
	Query string

	// Limit/Offset paginate Items below; Limit <= 0 means "no limit"
	// (return everything matching, unpaginated). Applied in Go, AFTER
	// every matching loan has already been fetched and classified — see
	// RiskAssessmentResult's own doc comment for why.
	Limit  int
	Offset int
}

// RiskAssessmentResult is ListLoanRiskAssessment's return value: one page
// of Items (per f.Limit/Offset) plus Total/Counts computed across EVERY
// loan matching f's status/date/branch filters, not just the returned
// page — so the page's KPI tiles (total open / loss / at-risk / safe) stay
// correct regardless of which page is currently showing.
type RiskAssessmentResult struct {
	Items   []LoanRiskRow
	Total   int
	Counts  map[RiskLevel]int
	HasMore bool
}

// ListLoanRiskAssessment lists risk-eligible loans matching f (branchScope
// nil for an Administrator's unfiltered view — see platform.GetBranchScope)
// with each one's current gold value (today's published rate × each
// pledged ornament's own purity and net weight — a loan can carry
// mixed-purity ornaments, so this is NOT just principal vs. a single flat
// per-gram rate) and the resulting RiskLevel. Refused with ErrNoGoldRate if
// no rate has ever been published — there is nothing to compare against.
//
// RiskLevel is computed per-row against a live rate, not a stored column,
// so it can't be pushed down into a SQL WHERE/LIMIT/OFFSET the way
// Service.List's filters can — every status/date/branch-matching loan is
// fetched and classified first (one query, ordered the same opened_date
// desc, id desc as Service.List), THEN paginated in Go. Loan counts per
// branch are small enough (hundreds, not millions) for this to be cheap,
// and it's what lets Counts/Total below cover every matching loan rather
// than just whatever page happens to be showing.
func (s *Service) ListLoanRiskAssessment(ctx context.Context, f RiskAssessmentFilter) (*RiskAssessmentResult, error) {
	rate, err := s.goldRateRepo.FindLatest(ctx)
	if err != nil {
		return nil, ErrNoGoldRate
	}

	lf := LoanFilter{
		BranchScope: f.BranchScope,
		OpenedFrom:  f.OpenedFrom,
		OpenedTo:    f.OpenedTo,
		Query:       f.Query,
	}
	if f.Status != "" {
		lf.Status = f.Status
	} else {
		lf.StatusIn = riskEligibleStatuses
	}

	loans, _, err := s.repo.FindAll(ctx, lf)
	if err != nil {
		return nil, err
	}

	rows := make([]LoanRiskRow, 0, len(loans))
	counts := map[RiskLevel]int{RiskLoss: 0, RiskAtRisk: 0, RiskSafe: 0}
	for _, l := range loans {
		var currentValue float64
		for _, o := range l.Ornaments {
			// A released ornament (Partial Ornament Release) no longer
			// secures anything — including it here would overstate the
			// loan's collateral and understate its real risk.
			if o.ReleasedAt != nil {
				continue
			}
			r, rErr := rateForPurity(rate, o.Purity)
			if rErr != nil {
				// An ornament with an unparseable/legacy purity string
				// contributes nothing rather than failing the whole
				// listing — see NormalizeLegacyPurities's own doc comment
				// on why such a row is flagged for manual review, not
				// silently coerced.
				continue
			}
			currentValue += o.NetWeight * r
		}
		// Compared against what is still owed, not the original principal:
		// repayments/part-releases shrink the exposure the gold has to cover.
		level := ClassifyRisk(currentValue, l.OutstandingAmount)
		counts[level]++
		if f.RiskLevel != "" && level != f.RiskLevel {
			continue
		}
		rows = append(rows, LoanRiskRow{
			LoanID:            l.ID,
			LoanNumber:        l.LoanNumber,
			CustomerID:        l.CustomerID,
			CustomerName:      l.Customer.Name,
			Status:            l.Status,
			PrincipalAmount:   l.PrincipalAmount,
			OutstandingAmount: l.OutstandingAmount,
			TotalNetWeight:    l.TotalNetWeight,
			CurrentGoldValue:  currentValue,
			RiskLevel:         level,
		})
	}

	total := len(rows)
	items := rows
	hasMore := false
	if f.Limit > 0 {
		start := f.Offset
		if start > total {
			start = total
		}
		end := start + f.Limit
		if end > total {
			end = total
		}
		items = rows[start:end]
		hasMore = end < total
	}

	return &RiskAssessmentResult{Items: items, Total: total, Counts: counts, HasMore: hasMore}, nil
}

func (s *Service) List(ctx context.Context, f LoanFilter) ([]Loan, int64, error) {
	// OnlyDefaulted depends on read-time arrears (see LoanFilter.
	// OnlyDefaulted), so the SQL candidate set is fetched in full, enriched,
	// narrowed to IsDefaulted, and only then paginated — the same
	// fetch-classify-then-page approach ListLoanRiskAssessment uses.
	// AllAuctionCases works the same way, keeping IsDefaulted loans plus the
	// stored Auction Eligible / Auctioned - Balance Due statuses.
	limit, offset := f.Limit, f.Offset
	if f.OnlyDefaulted || f.AllAuctionCases || f.Servicing != "" || len(f.ServicingIn) > 0 {
		f.Limit, f.Offset = 0, 0
	}
	loans, total, err := s.repo.FindAll(ctx, f)
	if err != nil {
		return nil, 0, err
	}
	// Listing is read-only and can return many rows, so accrual here is
	// projected into the in-memory copy for display only (never saved) —
	// Get/RecordPayment are what actually advance AccruedInterest/
	// AccruedPenalInterest in the DB.
	now := time.Now()
	for i := range loans {
		l := &loans[i]
		// nil top-ups: see projectAccrual's firstMonthTopUps doc comment —
		// List's batch projection accepts the flat-month approximation for
		// its display-only figure rather than an extra query per row.
		interestDelta, penalDelta, _ := projectAccrual(l, now, nil)
		l.AccruedInterest = platform.RoundMoney(l.AccruedInterest + interestDelta)
		l.AccruedPenalInterest = platform.RoundMoney(l.AccruedPenalInterest + penalDelta)
		s.enrich(ctx, l)
	}
	if f.OnlyDefaulted {
		loans, total = pageKept(loans, limit, offset, func(l *Loan) bool { return l.IsDefaulted })
	} else if f.AllAuctionCases {
		loans, total = pageKept(loans, limit, offset, isAuctionCase)
	} else if len(f.ServicingIn) > 0 {
		servicingIn, statusIn := f.ServicingIn, f.StatusIn
		loans, total = pageKept(loans, limit, offset, func(l *Loan) bool {
			for _, st := range statusIn {
				if l.Status == st {
					return true
				}
			}
			for _, sv := range servicingIn {
				if matchesServicing(l, sv) {
					return true
				}
			}
			return false
		})
	} else if f.Servicing != "" {
		servicing := f.Servicing
		loans, total = pageKept(loans, limit, offset, func(l *Loan) bool { return matchesServicing(l, servicing) })
	}
	return loans, total, nil
}

// isAuctionCase reports whether an enriched loan belongs to any of the mobile
// Auctions screen's buckets (see LoanFilter.AllAuctionCases).
func isAuctionCase(l *Loan) bool {
	return l.Status == StatusAuctionEligible || l.Status == StatusAuctionedBalanceDue || l.IsDefaulted
}

// pageKept keeps only the loans (already enriched) matching keep and
// returns the requested page of them plus the total match count. limit <= 0
// returns every match (total is still reported).
func pageKept(loans []Loan, limit, offset int, keep func(*Loan) bool) ([]Loan, int64) {
	kept := loans[:0]
	for i := range loans {
		l := loans[i]
		if keep(&l) {
			kept = append(kept, l)
		}
	}
	total := int64(len(kept))
	if limit <= 0 {
		return kept, total
	}
	if offset < 0 {
		offset = 0
	}
	if offset > len(kept) {
		offset = len(kept)
	}
	end := offset + limit
	if end > len(kept) {
		end = len(kept)
	}
	return kept[offset:end], total
}

// CountList returns how many loans match f overall, ignoring its
// Limit/Offset — the total the paginated list endpoint reports so the
// Loans table can show a real "Page X of N".
func (s *Service) CountList(ctx context.Context, f LoanFilter) (int64, error) {
	return s.repo.CountFiltered(ctx, f)
}

func (s *Service) Get(ctx context.Context, id uint, branchID *uint) (*Loan, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, ErrNotFound
	}
	return s.accrueAndEnrich(ctx, rec)
}

// checkLoanBranch guards a loan-scoped action against branch scoping — nil
// branchID (Administrator) always passes; otherwise the loan must belong to
// that branch, or ErrNotFound is returned (same as a direct not-found, so a
// non-admin can't probe for another branch's loans/requests/auction cases).
func (s *Service) checkLoanBranch(ctx context.Context, loanID uint, branchID *uint) error {
	// The loan is resolved FIRST, and unconditionally.
	//
	// This used to return nil immediately when branchID was nil, which meant
	// the loan's existence was never checked at all for exactly the roles
	// with the widest access — Administrator and Management, the ones with no
	// branch restriction. Every caller then ran its follow-up query against
	// an id nobody had verified, and endpoints like
	// GET /loans/:id/auction/history answered 200 with an empty list for any
	// id at all, including another business's loan. The isolation harness
	// caught it (internal/app/isolation_test.go).
	//
	// No rows escaped, because the follow-up queries are tenant-filtered too
	// — the defence in depth held. But "no branch restriction" is not the
	// same statement as "no check", and reading it as the latter left the
	// whole family of per-loan endpoints resting on one layer instead of two.
	//
	// FindByID runs under the caller's tenant, so a loan belonging to another
	// business is not found here and never reaches the branch comparison.
	l, err := s.repo.FindByID(ctx, loanID)
	if err != nil {
		return ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return ErrNotFound
	}
	return nil
}

// GetByLoanNumber looks up a loan by its exact LoanNumber in one atomic
// query (see Repository.FindByLoanNumber) — backs GET
// /loans/by-number/:loanNumber, used by LoanDetail.tsx instead of the
// previous list-then-find-then-get approach.
func (s *Service) GetByLoanNumber(ctx context.Context, loanNumber string) (*Loan, error) {
	rec, err := s.repo.FindByLoanNumber(ctx, loanNumber)
	if err != nil {
		return nil, ErrNotFound
	}
	return s.accrueAndEnrich(ctx, rec)
}

// accrueAndEnrich persists any newly-accrued interest (this is always a
// single-loan detail view, where staff act on the numbers — record a
// payment, decide a settlement — so "what's owed" should be nailed down,
// not just projected like List's read-only accrual) and populates the
// computed OutstandingInterest/TotalOutstandingBalance/etc. fields.
func (s *Service) accrueAndEnrich(ctx context.Context, rec *Loan) (*Loan, error) {
	if s.accrueAndSave(ctx, rec) {
		saved, err := s.repo.FindByID(ctx, rec.ID)
		if err != nil {
			return nil, err
		}
		rec = saved
	}
	s.enrich(ctx, rec)
	return rec, nil
}

// AddOrnamentInput mirrors OrnamentInput for adding an ornament to an
// existing loan after creation.
type AddOrnamentInput = OrnamentInput

// AddOrnament pledges an additional ornament onto an existing loan and
// recalculates the loan's totals/eligible amount.
func (s *Service) AddOrnament(ctx context.Context, loanID uint, in AddOrnamentInput) (*Loan, error) {
	l, err := s.repo.FindByID(ctx, loanID)
	if err != nil {
		return nil, ErrNotFound
	}

	rate, err := s.goldRateRepo.FindLatest(ctx)
	if err != nil {
		return nil, ErrNoGoldRate
	}

	o := Ornament{
		LoanID:          loanID,
		Name:            in.Name,
		Purity:          in.Purity,
		GrossWeight:     in.GrossWeight,
		DeductionWeight: in.DeductionWeight,
		Quantity:        in.Quantity,
		Remarks:         in.Remarks,
	}
	if o.Quantity <= 0 {
		o.Quantity = 1
	}
	if err := valueOrnament(&o, rate); err != nil {
		return nil, err
	}
	if err := s.ornamentRepo.Create(ctx, &o); err != nil {
		return nil, err
	}

	return s.recalculateAndSave(ctx, l)
}

// DeleteOrnament removes a single pledged item from a loan — e.g. a
// data-entry mistake caught after the loan was already sanctioned. Its
// photos and any purity re-test record are removed with it (neither has a
// real DB-level FK cascade — see model_ornament.go — so both are deleted
// explicitly here, before the ornament row itself). The loan's totals
// (TotalNetWeight/TotalGoldValue/EligibleLoanAmount) are recalculated
// immediately after, exactly as AddOrnament/UpdateOrnament already do.
//
// Refused if this is the loan's LAST ornament (a loan must always have at
// least one — see ErrNoOrnaments at creation) or if the loan is already
// Closed/Auctioned.
func (s *Service) DeleteOrnament(ctx context.Context, ornamentID uint) (*Loan, error) {
	o, err := s.ornamentRepo.FindByID(ctx, ornamentID)
	if err != nil {
		return nil, ErrOrnamentNotFound
	}
	l, err := s.repo.FindByID(ctx, o.LoanID)
	if err != nil {
		return nil, ErrNotFound
	}
	switch l.Status {
	case StatusClosed, StatusRejected, StatusAuctioned, StatusAuctionedBalanceDue:
		return nil, ErrLoanTerminalState
	}
	existing, err := s.ornamentRepo.FindByLoanID(ctx, l.ID)
	if err != nil {
		return nil, err
	}
	if len(existing) <= 1 {
		return nil, ErrNoOrnaments
	}
	if err := s.db.WithContext(ctx).Where("ornament_id = ?", ornamentID).Delete(&OrnamentImage{}).Error; err != nil {
		return nil, err
	}
	if err := s.db.WithContext(ctx).Where("ornament_id = ?", ornamentID).Delete(&OrnamentPurityTest{}).Error; err != nil {
		return nil, err
	}
	if err := s.db.WithContext(ctx).Delete(&Ornament{}, ornamentID).Error; err != nil {
		return nil, err
	}
	return s.recalculateAndSave(ctx, l)
}

// UpdateLoanInput mirrors the fields editable on an existing loan, even
// after it has been fully sanctioned — see UpdateLoan's own doc comment
// for what "editable after sanction" actually changes vs. leaves alone.
// Both fields are pointers so a caller can change just one without
// resending the other.
type UpdateLoanInput struct {
	SchemeID        *uint
	PrincipalAmount *float64

	// ActorEmployeeID/ActorRole identify who made the edit — only used when
	// the edit touches a financially material field and the loan gets
	// resubmitted for approval (see UpdateLoan's own doc comment), to write
	// the LoanApproval audit row the same way Approve does.
	ActorEmployeeID uint
	ActorRole       string
}

// UpdateLoan lets staff correct a loan's scheme or principal amount even
// after final sanction. Both fields are financially material — they change
// what the customer owes and what rate it accrues at — so an edit to
// either one resubmits the loan for the sanction chain: ApprovalStage
// resets to the first stage and Status moves back to PendingApproval,
// exactly as if the loan were freshly created, with a LoanApproval audit
// row recording that the edit is what triggered the resubmission (mirrors
// the row Approve itself writes per stage decision — same table, same
// shape). A loan that's still mid-chain (not yet ApprovalStageApproved)
// simply restarts from the first stage again; there's no partial-progress
// state to preserve since the terms just changed underneath whatever an
// earlier stage had already signed off on.
//
// Scheme change: swapping SchemeID re-snapshots the new scheme's terms
// (interest rate, method, penal rate, LTV, duration) onto the loan at the
// moment of the swap — every accrual/eligibility calculation reads that
// frozen snapshot, not a live scheme lookup, so a later edit to either the
// old or new scheme never again affects this loan. Already-recorded
// AccruedInterest/AccruedPenalInterest are untouched — this is
// deliberately prospective-only, never rewriting history. LTVPercent also
// changes with the scheme, so EligibleLoanAmount is recalculated against
// the loan's current ornaments under the NEW scheme's snapshot, same as
// AddOrnament/UpdateOrnament/DeleteOrnament already do whenever the
// ornament set changes.
//
// Principal change: PrincipalAmount is replaced outright, but
// OutstandingAmount is adjusted by the DELTA (new − old) rather than
// recomputed from scratch — whatever principal has already been repaid
// stays repaid; only the portion still outstanding shifts by the same
// amount the principal itself changed by.
//
// Refused on a loan that's already Closed/Auctioned — editing a finished
// loan makes no sense.
func (s *Service) UpdateLoan(ctx context.Context, loanID uint, in UpdateLoanInput) (*Loan, error) {
	l, err := s.repo.FindByID(ctx, loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	switch l.Status {
	case StatusClosed, StatusRejected, StatusAuctioned, StatusAuctionedBalanceDue:
		return nil, ErrLoanTerminalState
	}

	// Detected against the loan as it stood before this call's own changes
	// are applied below — only a REAL change to what's charged/owed should
	// resubmit the loan for approval, not a no-op edit that happens to
	// resend the same SchemeID/PrincipalAmount already on file.
	materialChange := (in.SchemeID != nil && *in.SchemeID != l.SchemeID) ||
		(in.PrincipalAmount != nil && platform.RoundMoney(*in.PrincipalAmount) != platform.RoundMoney(l.PrincipalAmount))
	wasDisbursed := l.DisbursementDate != nil
	// Captured before the edit re-snapshots the scheme/principal: the
	// reversal below must offset what was actually paid out and kept.
	priorDisbursed := l.DisbursedAmount
	priorCharge := 0.0
	if l.ServiceChargeMode == scheme.ServiceChargeModeWithheldFromPayout {
		priorCharge = l.ServiceChargeAmount
	}

	if in.SchemeID != nil {
		sch, err := s.schemeRepo.FindByID(ctx, *in.SchemeID)
		if err != nil {
			return nil, ErrSchemeInvalid
		}
		l.SchemeID = *in.SchemeID
		l.applySchemeSnapshot(sch)
	}

	if in.PrincipalAmount != nil {
		if *in.PrincipalAmount <= 0 {
			return nil, ErrInvalidPrincipal
		}
		delta := *in.PrincipalAmount - l.PrincipalAmount
		l.PrincipalAmount = *in.PrincipalAmount
		l.OutstandingAmount = platform.RoundMoney(l.OutstandingAmount + delta)
		if l.OutstandingAmount < 0 {
			l.OutstandingAmount = 0
		}
	}

	ornaments, err := s.ornamentRepo.FindByLoanID(ctx, l.ID)
	if err != nil {
		return nil, err
	}
	recalculateTotals(l, ornaments)
	// Re-checked on the edit path against the (possibly re-snapshotted)
	// scheme LTV and the current ornaments, same as Create — the UI's
	// "Max ₹X (based on scheme LTV)" is advisory only.
	// An AddedToPrincipal charge is already folded into PrincipalAmount, and
	// sits on top of the eligible cap (see Create) — compare the entered base.
	capped := l.PrincipalAmount
	if l.ServiceChargeMode == scheme.ServiceChargeModeAddedToPrincipal && l.ServiceChargeValue > 0 {
		switch l.ServiceChargeType {
		case scheme.ServiceChargeTypeFlat:
			capped = l.PrincipalAmount - l.ServiceChargeValue
		case scheme.ServiceChargeTypePercent:
			capped = l.PrincipalAmount / (1 + l.ServiceChargeValue/100)
		}
	}
	if platform.RoundMoney(capped) > platform.RoundMoney(l.EligibleLoanAmount) {
		return nil, httpx.NewBadRequest(fmt.Sprintf("principal amount ₹%.2f cannot exceed the eligible loan amount ₹%.2f (based on scheme LTV)", capped, l.EligibleLoanAmount))
	}

	// Re-derived for consistency whenever the scheme or principal changed
	// (applySchemeSnapshot above already re-snapshotted ServiceChargeType/
	// Value/Mode from the new scheme, if one was given) — deliberately
	// NOT folded back into PrincipalAmount the way Create does for
	// AddedToPrincipal, since that would silently re-inflate the principal
	// on every edit; the resubmitted approval chain below is what surfaces
	// the new charge figure to a human before disbursement (still frozen
	// at whatever it is at FinalSanction, same as Create).
	if in.SchemeID != nil || in.PrincipalAmount != nil {
		l.ServiceChargeAmount = computeServiceChargeAmount(l.ServiceChargeType, l.ServiceChargeValue, l.PrincipalAmount)
	}

	firstStage := SanctionStageLoanOperator
	if materialChange {
		if firstStage, err = s.firstSanctionStage(ctx); err != nil {
			return nil, err
		}
		l.ApprovalStage = firstStage
		l.Status = StatusPendingApproval
		// The loan will be disbursed again, at the new amount, once it
		// clears the chain — the old sanction/disbursement snapshot no
		// longer describes what actually happened, and Approve's
		// FinalSanction branch only re-derives it (and re-records the cash
		// movement) when these are cleared. See SanctionedAmount's own doc
		// comment on why it's normally treated as immutable — this is the
		// deliberate exception, since the original disbursement is being
		// retracted below, not just amended.
		if wasDisbursed {
			l.SanctionedAmount = 0
			l.DisbursedAmount = 0
			l.DisbursementDate = nil
		}
	}

	if err := s.repo.Update(ctx, l); err != nil {
		return nil, err
	}

	// The original payout (its cash-out movement and its Disbursement ledger
	// row) is history and stays; the retraction is booked as an explicit
	// reversal entry instead of deleting it.
	if materialChange && wasDisbursed {
		s.reverseDisbursement(ctx, l, priorDisbursed, priorCharge)
	}

	if materialChange {
		audit := &LoanApproval{
			LoanID:          l.ID,
			Stage:           firstStage,
			Action:          ApprovalActionEdited,
			ActorEmployeeID: in.ActorEmployeeID,
			ActorRole:       in.ActorRole,
			Remarks:         "Loan edited (scheme/principal changed) — resubmitted for approval",
		}
		if err := s.approvalRepo.Create(ctx, audit); err != nil {
			log.Printf("edit-resubmission audit row failed for loan %d: %v", l.ID, err)
		}
	}

	return s.Get(ctx, l.ID, nil)
}

// reverseDisbursement books the retraction of a loan's latest payout as a
// Disbursement Reversal LoanPayment plus its offsetting cash-in, leaving the
// original Disbursement row and cash-out movement in place. The amount is net
// of a withheld service charge: that charge was booked as its own cash-in at
// sanction and is never paid out, so reversing only the rest nets the books
// to zero before the re-sanction records the new payout. Best-effort, like
// the cash recording it replaces.
func (s *Service) reverseDisbursement(ctx context.Context, l *Loan, disbursed, withheldCharge float64) {
	payments, err := s.paymentRepo.FindByLoanID(ctx, l.ID) // newest first
	if err != nil {
		log.Printf("reversing disbursement failed for loan %d: %v", l.ID, err)
		return
	}
	var orig *LoanPayment
	for i := range payments {
		if payments[i].Type == PaymentTypeDisbursement {
			orig = &payments[i]
			break
		}
	}
	if orig == nil {
		return
	}
	amount := platform.RoundMoney(disbursed - withheldCharge)
	if amount <= 0.01 {
		return
	}
	cash, upi, bank, cheque := scaleSplit(orig.CashAmount, orig.UpiAmount, orig.BankTransferAmount, orig.ChequeAmount, orig.Amount, amount)
	now := time.Now()
	p := &LoanPayment{
		LoanID:             l.ID,
		Amount:             amount,
		Type:               PaymentTypeDisbursementReversal,
		PaidOn:             now,
		Description:        "Disbursement reversed — loan edited, resubmitted for approval",
		Method:             platform.DeriveMethod(cash, upi, bank, cheque),
		CashAmount:         cash,
		UpiAmount:          upi,
		BankTransferAmount: bank,
		ChequeAmount:       cheque,
		BankID:             orig.BankID,
		// Nothing is disbursed until the edit clears the chain again.
		RunningBalance: 0,
	}
	if err := s.paymentRepo.Create(ctx, p); err != nil {
		log.Printf("disbursement reversal ledger row failed for loan %d: %v", l.ID, err)
		return
	}
	if s.cashRecorder == nil {
		return
	}
	if _, groupID, err := s.cashRecorder.RecordLoanPaymentCashIn(ctx, l.ID, l.LoanNumber, amount, cash, upi, bank, cheque, l.BranchID, now, PaymentTypeDisbursementReversal, l.CustomerID, orig.BankID); err != nil {
		log.Printf("cash-in movement (disbursement reversal) failed for loan %d: %v", l.ID, err)
	} else if groupID != "" {
		if err := s.paymentRepo.SetCashTransactionGroupID(ctx, p.ID, groupID); err != nil {
			log.Printf("linking disbursement reversal %d to cash movement group failed: %v", p.ID, err)
		}
	}
}

// scaleSplit shrinks a four-mode split summing to total so it sums to newTotal
// instead, proportionally (rather than favouring one mode), with the cheque
// bucket absorbing the rounding remainder. A no-op when the totals match.
func scaleSplit(cash, upi, bank, cheque, total, newTotal float64) (float64, float64, float64, float64) {
	if total <= 0 || math.Abs(newTotal-total) < 0.01 {
		return cash, upi, bank, cheque
	}
	scale := newTotal / total
	c := platform.RoundMoney(cash * scale)
	u := platform.RoundMoney(upi * scale)
	b := platform.RoundMoney(bank * scale)
	return c, u, b, platform.RoundMoney(newTotal - c - u - b)
}

// HardDeleteLoan permanently removes a loan and every record tied to it —
// a genuine `DELETE`, not GORM's soft-delete (the loans table's DeletedAt
// column is left entirely unused by this path) — with no undo. Gated by
// its own "can hard delete loan" permission (see authz.Catalogue), kept
// deliberately separate from the ordinary "can delete loan" grant, and
// meant for exactly one thing: erasing a genuinely mistaken loan (wrong
// customer, test data, duplicate entry), not for ordinary loan closure —
// CompleteRelease is what a loan that was actually serviced goes through.
//
// Deletes, inside one transaction, in FK-safe order (children before the
// loan itself): auction decision requests, auction records, request
// approvals, loan requests, bank pledge records, loan payments, loan
// approvals, ornament images/purity tests, ornaments, packets (a real
// physical gold-storage record — deleted rather than unlinked, per an
// explicit product decision), reminders, then the loan row. Packets/
// reminders live in their own packages (internal/packet, internal/
// reminder) — deleted here via raw SQL against their table names rather
// than importing those packages, which would create an import cycle
// (packet already imports loan for its own joined display fields).
// LoansForCustomer returns a minimal summary (id, loan number, status) of
// every loan belonging to the given customer — used by
// customer.Service.HardDeleteCustomer (via the customer.LoanHardDeleter
// interface this method satisfies) to check every loan is Closed/Auctioned
// before allowing a customer to be hard-deleted, and then to hard-delete
// each one in turn.
func (s *Service) LoansForCustomer(ctx context.Context, customerID uint) ([]customer.LoanSummary, error) {
	loans, _, err := s.repo.FindAll(ctx, LoanFilter{CustomerID: customerID})
	if err != nil {
		return nil, err
	}
	out := make([]customer.LoanSummary, len(loans))
	for i, l := range loans {
		out[i] = customer.LoanSummary{ID: l.ID, Number: l.LoanNumber, Status: l.Status}
	}
	return out, nil
}

func (s *Service) HardDeleteLoan(ctx context.Context, loanID uint) error {
	loan, err := s.repo.FindByID(ctx, loanID)
	if err != nil {
		return ErrNotFound
	}
	// Bank-pledge cash rows carry no loan number in their Purpose, so their
	// IDs are read off the pledge records before those are deleted below.
	var pledges []BankPledgeRecord
	if err := s.db.WithContext(ctx).Where("loan_id = ?", loanID).Find(&pledges).Error; err != nil {
		return err
	}
	var movementIDs, expenseIDs []uint
	for _, p := range pledges {
		for _, id := range []*uint{p.CashMovementID, p.ReleaseCashMovementID} {
			if id != nil {
				movementIDs = append(movementIDs, *id)
			}
		}
		for _, id := range []*uint{p.ExpenseID, p.ReleaseExpenseID} {
			if id != nil {
				expenseIDs = append(expenseIDs, *id)
			}
		}
	}
	if err := s.hardDeleteLoanRows(ctx, loanID); err != nil {
		return err
	}
	if s.cashRecorder == nil {
		return nil
	}
	return s.cashRecorder.DeleteAllLoanCashEntries(ctx, loan.LoanNumber, movementIDs, expenseIDs)
}

func (s *Service) hardDeleteLoanRows(ctx context.Context, loanID uint) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// AuctionRecord has THREE child tables (Notices/Events/
		// DecisionRequests all FK-reference it) — every one has to go
		// before the AuctionRecord row itself, same reasoning as
		// packet_movements/bank_pledge_events below.
		if err := tx.Where(
			"auction_record_id IN (SELECT id FROM auction_records WHERE loan_id = ?)", loanID,
		).Delete(&AuctionDecisionRequest{}).Error; err != nil {
			return err
		}
		if err := tx.Where(
			"auction_record_id IN (SELECT id FROM auction_records WHERE loan_id = ?)", loanID,
		).Delete(&AuctionNotice{}).Error; err != nil {
			return err
		}
		if err := tx.Where(
			"auction_record_id IN (SELECT id FROM auction_records WHERE loan_id = ?)", loanID,
		).Delete(&AuctionEvent{}).Error; err != nil {
			return err
		}
		if err := tx.Where("loan_id = ?", loanID).Delete(&AuctionRecord{}).Error; err != nil {
			return err
		}
		if err := tx.Where(
			"request_id IN (SELECT id FROM loan_requests WHERE loan_id = ?)", loanID,
		).Delete(&RequestApproval{}).Error; err != nil {
			return err
		}
		if err := tx.Where("loan_id = ?", loanID).Delete(&LoanRequest{}).Error; err != nil {
			return err
		}
		// bank_pledge_events FK-references bank_pledge_records, so its rows
		// for this loan's pledge(s) must go first — same shortfall as
		// packet_movements below.
		if err := tx.Where(
			"bank_pledge_record_id IN (SELECT id FROM bank_pledge_records WHERE loan_id = ?)", loanID,
		).Delete(&BankPledgeEvent{}).Error; err != nil {
			return err
		}
		if err := tx.Where("loan_id = ?", loanID).Delete(&BankPledgeRecord{}).Error; err != nil {
			return err
		}
		if err := tx.Where("loan_id = ?", loanID).Delete(&LoanPayment{}).Error; err != nil {
			return err
		}
		if err := tx.Where("loan_id = ?", loanID).Delete(&LoanApproval{}).Error; err != nil {
			return err
		}
		if err := tx.Where(
			"ornament_id IN (SELECT id FROM ornaments WHERE loan_id = ?)", loanID,
		).Delete(&OrnamentImage{}).Error; err != nil {
			return err
		}
		if err := tx.Where(
			"ornament_id IN (SELECT id FROM ornaments WHERE loan_id = ?)", loanID,
		).Delete(&OrnamentPurityTest{}).Error; err != nil {
			return err
		}
		if err := tx.Where("loan_id = ?", loanID).Delete(&Ornament{}).Error; err != nil {
			return err
		}
		// packet_movements FK-references packets, so its rows for this
		// loan's packet(s) must go first — deleting the packet row
		// directly (as below) without this violates fk_packets_movements.
		if err := tx.Exec(
			"DELETE FROM packet_movements WHERE packet_id IN (SELECT id FROM packets WHERE loan_id = ?)", loanID,
		).Error; err != nil {
			return err
		}
		if err := tx.Exec("DELETE FROM packets WHERE loan_id = ?", loanID).Error; err != nil {
			return err
		}
		if err := tx.Exec("DELETE FROM reminders WHERE loan_id = ?", loanID).Error; err != nil {
			return err
		}
		return tx.Unscoped().Delete(&Loan{}, loanID).Error
	})
}

// UpdateOrnamentInput mirrors OrnamentInput for editing a pledged ornament.
type UpdateOrnamentInput = OrnamentInput

// UpdateOrnament edits a pledged ornament's declared values and
// recalculates its owning loan's totals/eligible amount.
func (s *Service) UpdateOrnament(ctx context.Context, ornamentID uint, in UpdateOrnamentInput) (*Loan, error) {
	o, err := s.ornamentRepo.FindByID(ctx, ornamentID)
	if err != nil {
		return nil, ErrOrnamentNotFound
	}

	rate, err := s.goldRateRepo.FindLatest(ctx)
	if err != nil {
		return nil, ErrNoGoldRate
	}

	o.Name = in.Name
	o.Purity = in.Purity
	o.GrossWeight = in.GrossWeight
	o.DeductionWeight = in.DeductionWeight
	o.Quantity = in.Quantity
	o.Remarks = in.Remarks
	if o.Quantity <= 0 {
		o.Quantity = 1
	}
	if err := valueOrnament(o, rate); err != nil {
		return nil, err
	}
	if err := s.ornamentRepo.Update(ctx, o); err != nil {
		return nil, err
	}

	l, err := s.repo.FindByID(ctx, o.LoanID)
	if err != nil {
		return nil, ErrNotFound
	}
	return s.recalculateAndSave(ctx, l)
}

func (s *Service) recalculateAndSave(ctx context.Context, l *Loan) (*Loan, error) {
	ornaments, err := s.ornamentRepo.FindByLoanID(ctx, l.ID)
	if err != nil {
		return nil, err
	}
	recalculateTotals(l, ornaments)
	if err := s.repo.Update(ctx, l); err != nil {
		return nil, err
	}
	return s.Get(ctx, l.ID, nil)
}

// PurityTestInput mirrors the fields staff enter when manually re-testing
// a pledged ornament.
type PurityTestInput struct {
	TestedPurity          string
	TestedGrossWeight     float64
	TestedDeductionWeight float64
	TestingRemarks        string
	TestedBy              string
	TestedAt              time.Time
}

func (s *Service) RecordPurityTest(ctx context.Context, ornamentID uint, in PurityTestInput) (*Ornament, error) {
	o, err := s.ornamentRepo.FindByID(ctx, ornamentID)
	if err != nil {
		return nil, ErrOrnamentNotFound
	}
	if _, _, err := ParsePurity(in.TestedPurity); err != nil {
		return nil, ErrInvalidPurity
	}
	if in.TestedGrossWeight <= 0 {
		return nil, ErrInvalidWeight
	}

	t := o.PurityTest
	if t == nil {
		t = &OrnamentPurityTest{OrnamentID: ornamentID}
	}
	t.TestedPurity = in.TestedPurity
	t.TestedGrossWeight = in.TestedGrossWeight
	t.TestedDeductionWeight = in.TestedDeductionWeight
	t.TestedNetWeight = in.TestedGrossWeight - in.TestedDeductionWeight
	if t.TestedNetWeight < 0 {
		t.TestedNetWeight = 0
	}
	t.TestingRemarks = in.TestingRemarks
	t.TestedBy = in.TestedBy
	t.TestedAt = in.TestedAt

	if err := s.ornamentRepo.SavePurityTest(ctx, t); err != nil {
		return nil, err
	}
	return s.ornamentRepo.FindByID(ctx, ornamentID)
}

// AddOrnamentImage attaches one more photo (already uploaded via
// internal/upload) to an ornament.
func (s *Service) AddOrnamentImage(ctx context.Context, ornamentID uint, imageURL string) (*Ornament, error) {
	if _, err := s.ornamentRepo.FindByID(ctx, ornamentID); err != nil {
		return nil, ErrOrnamentNotFound
	}
	img := &OrnamentImage{OrnamentID: ornamentID, ImageURL: imageURL}
	if err := s.ornamentRepo.AddImage(ctx, img); err != nil {
		return nil, err
	}
	return s.ornamentRepo.FindByID(ctx, ornamentID)
}

// The loan sanction chain's stages (their order, labels and required
// permissions) live in workflow.Catalogue under workflow.FlowLoanSanction;
// which of them apply is per-tenant configuration (see s.chain). The chain
// can never be switched fully off — its last enabled stage is the one that
// disburses the loan (see Approve).

// firstSanctionStage returns the first enabled stage of the tenant's loan
// sanction chain — where a new (or materially edited) loan starts.
func (s *Service) firstSanctionStage(ctx context.Context) (string, error) {
	c, err := s.chain(ctx, workflow.FlowLoanSanction)
	if err != nil {
		return "", err
	}
	if st, ok := c.First(); ok {
		return st.Key, nil
	}
	return SanctionStageLoanOperator, nil
}

// normalizeSanctionStage maps the retired AuthorizedManagement stage onto
// FinalSanction so a loan left on it by the old 4-stage chain still has a
// role that can clear it (see SanctionStageAuthorizedManagement).
func normalizeSanctionStage(stage string) string {
	if stage == SanctionStageAuthorizedManagement {
		return SanctionStageFinalSanction
	}
	return stage
}

// sanctionLimits is an advisory-only reference table of a role's typical sign-off
// ceiling, used solely to compute Loan.ApprovalWarning ("consider escalating").
// It never blocks an approve/reject decision. Every role currently has no
// ceiling (0): the Branch Manager's former ₹2,00,000 and the Loan Operator's
// former editable limit were both removed on request, so no amount warns.
var sanctionLimits = map[string]float64{
	"Branch Manager": 0, // 0 == no advisory ceiling
	"Management":     0, // 0 == no advisory ceiling — Management/Final Sanction can clear any amount
}

// sanctionWarning looks up the role of the stage the loan waits at — a
// role-chain stage by its role ID, a legacy stage by its catalogue role —
// and checks the principal against that role's advisory limit.
func (s *Service) sanctionWarning(ctx context.Context, l *Loan) string {
	stage := normalizeSanctionStage(l.ApprovalStage)
	if stage == "" || stage == ApprovalStageApproved || stage == ApprovalStageRejected {
		return ""
	}
	role := s.workflowSvc.RoleName(ctx, stage)
	if role == "" {
		f, _ := workflow.FindFlow(workflow.FlowLoanSanction)
		for _, step := range f.Stages {
			if step.Key == stage {
				role = step.Role
			}
		}
	}
	limit := sanctionLimits[role]
	if limit > 0 && l.PrincipalAmount > limit {
		return fmt.Sprintf("Principal ₹%.0f exceeds the typical ₹%.0f limit for %s — consider escalating.", l.PrincipalAmount, limit, role)
	}
	return ""
}

// ApprovalInput mirrors the body of POST /loans/:id/approve.
type ApprovalInput struct {
	Stage           string // one of SanctionStage* — must match the loan's current ApprovalStage
	Action          string // "Approved" | "Rejected"
	ActorEmployeeID uint
	ActorRole       string // employee.ValidRoles value — audit-trail display only, not used for authorization any more (see checkStagePermission)
	ActorRoleID     uint   // authz.Role.ID — checked against sanctionChain's required "Approval Workflow" permission
	Remarks         string

	// CashAmount/UpiAmount/BankTransferAmount/ChequeAmount split the
	// principal actually disbursed across payment modes — only meaningful
	// (and only validated) when this call is the one that clears
	// FinalSanction and triggers disbursement; ignored at every earlier
	// stage. Must sum to the loan's PrincipalAmount within
	// platform.RoundMoney's tolerance — see platform.ValidateSplit.
	CashAmount         float64
	UpiAmount          float64
	BankTransferAmount float64
	ChequeAmount       float64
	// BankID — which bank the UPI/Bank Transfer/Cheque portion of the
	// disbursement was sent from; mirrors PaymentInput.BankID. Only
	// meaningful (and only stored) at the FinalSanction stage that triggers
	// the actual cash-out movement.
	BankID *uint

	// Charge* is how the operator records the withheld service charge —
	// split across payment modes the same way as the payout above. Only used
	// at the disbursing stage of a WithheldFromPayout loan. All zero means
	// "record it as Cash"; otherwise it must sum to the loan's service charge
	// and name ChargeBankID for any non-cash part.
	ChargeCashAmount         float64
	ChargeUpiAmount          float64
	ChargeBankTransferAmount float64
	ChargeChequeAmount       float64
	ChargeBankID             *uint
}

// Approve advances (or terminates) a loan's sanction chain. By default:
//
//	LoanOperator (verified) -> BranchManager (approved) -> FinalSanction (Management) -> Approved (Status -> Active)
//
// but each tenant configures the chain as an ordered list of approver roles
// (workflow.FlowLoanSanction): approving moves the loan to the next role,
// and the last role disburses it. A Rejected action at any stage sets
// Status -> Rejected. The actor must hold the current step's role, or be
// Administrator (see workflow.Service.CanAct).
//
// ApprovalActionVerified and Approved are accepted at any step and behave
// identically (the UI sends "Verified" for a Loan Operator step). No amount
// check gates it — the Loan Operator approval limit and sanctionLimits are
// advisory only, feeding Loan.ApprovalWarning.
func (s *Service) Approve(ctx context.Context, loanID uint, in ApprovalInput) (*Loan, error) {
	l, err := s.repo.FindByID(ctx, loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if in.Action != ApprovalStageApproved && in.Action != ApprovalStageRejected && in.Action != ApprovalActionVerified {
		return nil, ErrInvalidAction
	}
	if l.ApprovalStage == ApprovalStageApproved || l.ApprovalStage == ApprovalStageRejected {
		return nil, ErrAlreadyDecided
	}
	// Compare against the normalized stage so a loan parked on the retired
	// AuthorizedManagement value can be cleared by a client sending either
	// that value or FinalSanction.
	chain, err := s.chain(ctx, workflow.FlowLoanSanction)
	if err != nil {
		return nil, err
	}
	// The stored stage resolves onto the tenant's current chain (a loan
	// still on a legacy stage value maps onto it — see workflow.Chain). The
	// client may send either the stored value or the resolved stage key.
	stored := normalizeSanctionStage(l.ApprovalStage)
	step, ok := chain.ByKey(stored)
	if !ok {
		return nil, ErrWrongStage
	}
	if sent := normalizeSanctionStage(in.Stage); sent != stored && sent != step.Key {
		return nil, ErrWrongStage
	}
	stage := step.Key
	// The last step of this tenant's chain is the one that pays the loan out.
	final := chain.IsFinal(stage)
	next, _ := chain.Next(stage)

	// Only the step's own role (or Administrator) may act on it — see
	// workflow.Service.CanAct. Verified and Approved behave the same.
	if !s.workflowSvc.CanAct(ctx, in.ActorRoleID, workflow.FlowLoanSanction, stage) {
		return nil, ErrWrongStage
	}

	// The final stage pays the loan out — refuse it before anything (the
	// audit row included) is written if the branch can't cover it.
	if final && in.Action != ApprovalStageRejected {
		payout := l.PrincipalAmount
		if l.ServiceChargeMode == scheme.ServiceChargeModeWithheldFromPayout && l.ServiceChargeAmount > 0 {
			payout = platform.RoundMoney(l.PrincipalAmount - l.ServiceChargeAmount)
		}
		if err := s.ensureCashInHand(ctx, l.BranchID, payout); err != nil {
			return nil, err
		}
	}

	disbursing := false
	rejected := in.Action == ApprovalStageRejected
	var nextStageLabel string
	if rejected {
		l.ApprovalStage = ApprovalStageRejected
		l.Status = StatusRejected
		now := time.Now()
		l.RejectedAt = &now
		l.RejectedByEmployeeID = &in.ActorEmployeeID
		l.RejectedByName = s.employeeName(ctx, in.ActorEmployeeID)
		l.RejectionRemarks = in.Remarks
	} else {
		switch {
		case !final:
			l.ApprovalStage = next.Key
			nextStageLabel = next.Label
		default:
			l.ApprovalStage = ApprovalStageApproved
			l.Status = StatusActive
			disbursing = true
			// Frozen at the moment of final sanction — see these fields'
			// own doc comment on model_loan.go for why they're distinct
			// from PrincipalAmount. DisbursedAmount is PrincipalAmount
			// minus the service charge ONLY when it's WithheldFromPayout —
			// an AddedToPrincipal charge was already folded into
			// PrincipalAmount at Create, so the full amount is disbursed
			// (the charge was borrowed, not deducted); a WithheldFromPayout
			// charge is collected upfront by paying out that much less,
			// while the customer still owes interest on the full
			// (undiscounted) SanctionedAmount.
			now := time.Now()
			l.SanctionedAmount = l.PrincipalAmount
			l.DisbursedAmount = l.PrincipalAmount
			if l.ServiceChargeMode == scheme.ServiceChargeModeWithheldFromPayout && l.ServiceChargeAmount > 0 {
				l.DisbursedAmount = platform.RoundMoney(l.PrincipalAmount - l.ServiceChargeAmount)
			}
			l.DisbursementDate = &now
			startAccrualAtDisbursement(l, now)
		}
	}

	if disbursing {
		if err := platform.ValidateSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, l.DisbursedAmount); err != nil {
			return nil, err
		}
		if l.ServiceChargeMode == scheme.ServiceChargeModeWithheldFromPayout && l.ServiceChargeAmount > 0 {
			chargeSum := in.ChargeCashAmount + in.ChargeUpiAmount + in.ChargeBankTransferAmount + in.ChargeChequeAmount
			if chargeSum > 0 {
				if err := platform.ValidateSplit(in.ChargeCashAmount, in.ChargeUpiAmount, in.ChargeBankTransferAmount, in.ChargeChequeAmount, l.ServiceChargeAmount); err != nil {
					return nil, err
				}
				if in.ChargeBankID == nil && in.ChargeUpiAmount+in.ChargeBankTransferAmount+in.ChargeChequeAmount > 0 {
					return nil, ErrBankRequiredForSplitMode
				}
			}
		}
	}

	// The principal only actually leaves the till once the loan clears its
	// final approval stage — logging it earlier (e.g. at Create) would show
	// cash going out for a loan that might still be rejected. DisbursedAmount
	// (not PrincipalAmount) is what's actually handed over — see this
	// field's own doc comment just above for why they can differ.
	//
	// Booked BEFORE the loan is saved so a failure is returned to the operator
	// and the loan stays at its approval stage, instead of becoming Active
	// with no cash entry (the old behaviour just logged the error).
	if disbursing && s.cashRecorder != nil {
		if _, _, err := s.cashRecorder.RecordLoanDisbursementCashOut(ctx, l.ID, l.LoanNumber, l.DisbursedAmount, in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, l.BranchID, time.Now(), l.CustomerID, in.BankID); err != nil {
			return nil, fmt.Errorf("could not record the disbursement in Cash-in-Hand, loan not approved: %w", err)
		}
		// The withheld charge is real cash the branch keeps rather than
		// pays out — booked as its own cash-in (income) so it shows up in
		// Cash & Expenses like any other collection, not just as a number
		// on the loan (see item #11's CashTransactionGroupID work for the
		// same "make it visible in the ledger" rationale).
		if l.ServiceChargeMode == scheme.ServiceChargeModeWithheldFromPayout && l.ServiceChargeAmount > 0 {
			if _, err := s.cashRecorder.RecordServiceChargeCashIn(ctx, l.ID, l.LoanNumber, l.ServiceChargeAmount, in.ChargeCashAmount, in.ChargeUpiAmount, in.ChargeBankTransferAmount, in.ChargeChequeAmount, l.BranchID, time.Now(), in.ChargeBankID); err != nil {
				s.undoDisbursementCash(ctx, l.LoanNumber)
				return nil, fmt.Errorf("could not record the service charge in Cash-in-Hand, loan not approved: %w", err)
			}
		}
	}

	audit := &LoanApproval{
		LoanID:          loanID,
		Stage:           stage,
		Action:          in.Action,
		ActorEmployeeID: in.ActorEmployeeID,
		ActorRole:       in.ActorRole,
		Remarks:         in.Remarks,
	}
	if err := s.approvalRepo.Create(ctx, audit); err != nil {
		if disbursing {
			s.undoDisbursementCash(ctx, l.LoanNumber)
		}
		return nil, err
	}

	if err := s.repo.Update(ctx, l); err != nil {
		if disbursing {
			s.undoDisbursementCash(ctx, l.LoanNumber)
		}
		return nil, err
	}

	// Mirrors the cash-out movement above as a row on the loan's OWN ledger
	// (GetLoanLedger reads only from LoanPayment, never CashMovement — see
	// PaymentTypeDisbursement's doc comment) — without this, LoanDetail's
	// Transactions tab has no entry at all for the disbursement, so its
	// Bank/Method (in.BankID above) never surface there even though the
	// cash-out movement itself was recorded correctly.
	if disbursing {
		p := &LoanPayment{
			LoanID:             l.ID,
			Amount:             l.DisbursedAmount,
			Type:               PaymentTypeDisbursement,
			PaidOn:             time.Now(),
			Description:        "Loan disbursed",
			Method:             platform.DeriveMethod(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount),
			CashAmount:         in.CashAmount,
			UpiAmount:          in.UpiAmount,
			BankTransferAmount: in.BankTransferAmount,
			ChequeAmount:       in.ChequeAmount,
			BankID:             in.BankID,
			RunningBalance:     l.OutstandingAmount,
		}
		if err := s.paymentRepo.Create(ctx, p); err != nil {
			log.Printf("loan-payment ledger row (disbursement) failed for loan %d: %v", l.ID, err)
		}
	}

	switch {
	case disbursing:
		s.notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Loan Sanctioned", s.brandedMessage(ctx,
			"Dear %s, your gold loan %s has been sanctioned and ₹%.2f has been disbursed. Due date: %s. — CloudHouse Finance",
			l.Customer.Name, l.LoanNumber, l.DisbursedAmount, l.DueDate.Format("02-Jan-2006"),
		), commlog.TriggerLoanSanction, "loan", l.ID)
	case rejected:
		s.notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Loan Rejected", s.brandedMessage(ctx,
			"Dear %s, your gold loan application %s has been rejected during approval. Please contact the branch for details. — CloudHouse Finance",
			l.Customer.Name, l.LoanNumber,
		), commlog.TriggerLoanApproval, "loan", l.ID)
	case nextStageLabel != "":
		s.notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Loan Approved", s.brandedMessage(ctx,
			"Dear %s, your gold loan application %s has been approved at one stage and is now awaiting %s approval. — CloudHouse Finance",
			l.Customer.Name, l.LoanNumber, nextStageLabel,
		), commlog.TriggerLoanApproval, "loan", l.ID)
	}

	return s.Get(ctx, l.ID, nil)
}

// employeeName looks up an employee's display name for denormalized audit
// fields like Loan.RejectedByName. Best-effort: a failed lookup returns ""
// rather than failing the decision it is only describing.
func (s *Service) employeeName(ctx context.Context, employeeID uint) string {
	var name string
	if err := s.db.WithContext(ctx).Table("employees").Select("name").Where("id = ?", employeeID).Limit(1).Scan(&name).Error; err != nil {
		log.Printf("employee name lookup failed for employee %d: %v", employeeID, err)
	}
	return name
}

// GetInterestCollected sums the interest + penal-interest portions of
// payments recorded within [from, to] — backs Dashboard.tsx's "Interest
// Collected" KPI (GET /loans/interest-collected), replacing the old
// mock-only db.ledger figure that never had a real backend equivalent.
func (s *Service) GetInterestCollected(ctx context.Context, from, to time.Time, branchID *uint) (float64, error) {
	return s.paymentRepo.SumInterestCollected(ctx, from, to, branchID)
}

// CustomerInBranchScope reports whether the customer belongs to scope (nil =
// every branch) — a customer belongs to one branch, so with a branch selected
// another branch's customer reads as not found.
func (s *Service) CustomerInBranchScope(ctx context.Context, customerID uint, scope *uint) (bool, error) {
	if scope == nil {
		return true, nil
	}
	c, err := s.customerRepo.FindByID(ctx, customerID)
	if err != nil {
		return false, nil
	}
	return c.BranchID == *scope, nil
}

// ListApprovals returns the loan's full sanction-chain decision history, in
// the order decisions were made.
func (s *Service) ListApprovals(ctx context.Context, loanID uint) ([]LoanApproval, error) {
	if _, err := s.repo.FindByID(ctx, loanID); err != nil {
		return nil, ErrNotFound
	}
	return s.approvalRepo.FindByLoanID(ctx, loanID)
}

// PaymentInput mirrors the body of POST /loans/:id/payments. ProcessingFee
// is an optional additional charge collected alongside Amount — see
// LoanPayment.ProcessingFee's doc comment. Method is no longer accepted as
// free-text input — CashAmount/UpiAmount/BankTransferAmount/ChequeAmount
// (NOT NULL DEFAULT 0, must sum to Amount within platform.RoundMoney's
// tolerance — see platform.ValidateSplit) are now the source of truth, and
// the stored LoanPayment.Method is derived from them (platform.DeriveMethod)
// for old readers.
type PaymentInput struct {
	Amount        float64
	Type          string
	ProcessingFee float64
	PaidOn        time.Time
	// ReceivedByEmployeeID is nil for a customer-initiated online (Razorpay)
	// payment — see LoanPayment.ReceivedByEmployeeID's doc comment.
	ReceivedByEmployeeID *uint
	CashAmount           float64
	UpiAmount            float64
	BankTransferAmount   float64
	ChequeAmount         float64
	// Method is a legacy/system escape hatch for callers that don't have a
	// per-mode breakdown to give — VerifyAndRecordRazorpayPayment (an online
	// gateway payment, not one of the four in-branch modes) and
	// RecordReleasePayment's Partial-type settlement (which doesn't yet have
	// a split-entry UI). When set, split validation is skipped, the four
	// split columns stay 0, and the stored LoanPayment.Method is this string
	// verbatim instead of the derived one. New staff-entered payments (via
	// the split-payment UI) should leave this blank and supply the four
	// split amounts instead.
	Method      string
	Reference   string
	Description string
	// BankID is which bank the UPI/Bank Transfer/Cheque portion of this
	// payment landed in — required by validation when any of those three
	// split amounts is non-zero (see ErrBankRequiredForSplitMode). Nil for
	// a Cash-only payment.
	BankID *uint
	// InterestOverride, when set, replaces the system-computed interest
	// bucket (AccruedInterest − InterestPaid) for THIS call only — the
	// Record Payment screen shows the live-calculated interest prefilled,
	// but the minimum-one-month/daily-prorated formula (see accrual.go's
	// projectAccrual) is a formula, not a court order, and staff need to be
	// able to adjust the actual amount charged for a specific settlement.
	// Only meaningful for Interest/Partial/Full Settlement — the only
	// types whose waterfall touches an interest bucket at all. Principal/
	// penal/fee are never affected; AccruedInterest/InterestPaid still
	// reconcile against whatever was actually applied, exactly as an
	// un-overridden payment would.
	InterestOverride *float64
}

// ErrExceedsOutstanding is returned when a payment's Type restricts which
// bucket(s) it can pay down and Amount is more than currently owed in
// those buckets (e.g. an "Interest" payment bigger than outstanding
// interest+penal interest, or a "Full Settlement" smaller than the total
// owed).
var ErrExceedsOutstanding = httpx.NewBadRequest("amount does not match what is owed for this payment type")

// ErrBankRequiredForSplitMode is returned when any of UpiAmount/
// BankTransferAmount/ChequeAmount is non-zero but PaymentInput.BankID is
// nil — mirrors cash.ErrBankRequiredForMode's rationale for AddCashModal.
var ErrBankRequiredForSplitMode = httpx.NewBadRequest("bank is required when the payment breakdown includes UPI, Bank Transfer, or Cheque")

// allocatePayment splits amount across the processing-fee/penal-interest/
// interest/principal buckets according to paymentType's waterfall rule,
// against l's *current* outstanding figures (call accrueAndSave first, and
// add any newly-charged ProcessingFee to l.OutstandingProcessingFee,
// before calling this, so the buckets are up to date). Processing fee has
// first priority — the very next rupee paid in clears it before penal
// interest/interest/principal — matching Loan Operator/branch expectation
// that outstanding fees get cleared before anything else. It does not
// mutate l — the caller applies the returned deltas and decides
// cash-recording.
//
// interestOverride, when non-nil, replaces the system-computed interest
// bucket (AccruedInterest − InterestPaid) with a staff-entered figure —
// see PaymentInput.InterestOverride's own doc comment for why this exists.
// Every other bucket (fee/penal/principal) is unaffected; auction-driven
// callers (RecordAuctionSale/write-off) always pass nil, since there is no
// staff-facing amount to override there.
func allocatePayment(l *Loan, paymentType string, amount float64, interestOverride *float64) (fee, penal, interest, principal float64, err error) {
	const epsilon = 0.01 // guards against float rounding rejecting an exact payoff
	feeOutstanding := l.OutstandingProcessingFee
	penalOutstanding := l.AccruedPenalInterest - l.PenalInterestPaid
	interestOutstanding := l.AccruedInterest - l.InterestPaid
	if interestOverride != nil {
		interestOutstanding = *interestOverride
	}
	principalOutstanding := l.OutstandingAmount

	switch paymentType {
	case PaymentTypePrincipal:
		remaining := amount
		fee = math.Min(remaining, feeOutstanding)
		remaining -= fee
		if remaining > principalOutstanding+epsilon {
			return 0, 0, 0, 0, ErrExceedsOutstanding
		}
		principal = remaining

	case PaymentTypeInterest:
		remaining := amount
		fee = math.Min(remaining, feeOutstanding)
		remaining -= fee
		penal = math.Min(remaining, penalOutstanding)
		remaining -= penal
		interest = math.Min(remaining, interestOutstanding)
		remaining -= interest
		if remaining > epsilon {
			return 0, 0, 0, 0, ErrExceedsOutstanding
		}

	case PaymentTypePenalInterest:
		// Stops one bucket short of PaymentTypeInterest — the regular
		// interest is left owing on purpose.
		remaining := amount
		fee = math.Min(remaining, feeOutstanding)
		remaining -= fee
		penal = math.Min(remaining, penalOutstanding)
		remaining -= penal
		if remaining > epsilon {
			return 0, 0, 0, 0, ErrExceedsOutstanding
		}

	case PaymentTypePartial:
		remaining := amount
		fee = math.Min(remaining, feeOutstanding)
		remaining -= fee
		penal = math.Min(remaining, penalOutstanding)
		remaining -= penal
		interest = math.Min(remaining, interestOutstanding)
		remaining -= interest
		principal = math.Min(remaining, principalOutstanding)
		remaining -= principal
		if remaining > epsilon {
			return 0, 0, 0, 0, ErrExceedsOutstanding
		}

	case PaymentTypeFullSettlement:
		total := feeOutstanding + penalOutstanding + interestOutstanding + principalOutstanding
		// Exactly what is owed (incl. any additional charge) — neither short nor
		// over: an overpayment would record cash the loan never applies.
		if amount+epsilon < total || amount > total+epsilon {
			return 0, 0, 0, 0, ErrExceedsOutstanding
		}
		fee, penal, interest, principal = feeOutstanding, penalOutstanding, interestOutstanding, principalOutstanding

	case PaymentTypeAuctionSale:
		// Auction proceeds pay down exactly like a Partial payment (fee →
		// penal → interest → principal), but must never be rejected for
		// overshooting: gold can fetch more than the debt, and the excess is
		// the customer's surplus, handled by RecordAuctionSale rather than
		// being an error. So each bucket is simply capped and any remainder is
		// left for the surplus path.
		remaining := amount
		fee = math.Min(remaining, feeOutstanding)
		remaining -= fee
		penal = math.Min(remaining, penalOutstanding)
		remaining -= penal
		interest = math.Min(remaining, interestOutstanding)
		remaining -= interest
		principal = math.Min(remaining, principalOutstanding)

	case PaymentTypeAuctionWriteOff:
		// Forgiving a post-auction shortfall. Unlike Waiver this DOES reach
		// principal — once the gold is sold there is no collateral left, so
		// what management is writing off is the principal itself, not merely
		// accrued interest. Capped at what is owed so a write-off can never
		// push a balance negative.
		remaining := amount
		fee = math.Min(remaining, feeOutstanding)
		remaining -= fee
		penal = math.Min(remaining, penalOutstanding)
		remaining -= penal
		interest = math.Min(remaining, interestOutstanding)
		remaining -= interest
		principal = math.Min(remaining, principalOutstanding)

	case PaymentTypeAdjustment:
		// A manual correction to the principal ledger (e.g. fixing a data
		// entry error) — never overshoots into a negative outstanding
		// balance, and never touches fee/interest/penal interest.
		principal = math.Min(amount, principalOutstanding)

	case PaymentTypeWaiver:
		// Forgives owed interest/penal interest without any cash changing
		// hands — same penal-then-interest order as a real payment would
		// use, but never reaches into fee/principal (a fee is a real charge,
		// not something a waiver forgives).
		remaining := amount
		penal = math.Min(remaining, penalOutstanding)
		remaining -= penal
		interest = math.Min(remaining, interestOutstanding)
		remaining -= interest
		if remaining > epsilon {
			return 0, 0, 0, 0, ErrExceedsOutstanding
		}

	case PaymentTypeDiscount:
		// A negotiated reduction of the release settlement — reaches
		// principal (unlike Waiver above), capped at what is owed rather
		// than erroring on overshoot, same as PaymentTypeAuctionWriteOff:
		// staff may round a discount up past the exact remaining balance
		// without the call failing.
		remaining := amount
		penal = math.Min(remaining, penalOutstanding)
		remaining -= penal
		interest = math.Min(remaining, interestOutstanding)
		remaining -= interest
		principal = math.Min(remaining, principalOutstanding)

	default:
		return 0, 0, 0, 0, ErrInvalidPaymentType
	}
	return fee, penal, interest, principal, nil
}

// RecordPayment logs one ledger entry against a loan: it first brings
// AccruedInterest/AccruedPenalInterest up to date (so the allocation below
// is against real, current figures), charges any newly-added
// ProcessingFee onto OutstandingProcessingFee, then allocates the payment
// across processing fee → penal interest → interest → principal per its
// Type (see allocatePayment), updates the paid-so-far totals, and
// auto-closes the loan once nothing is left owing in any bucket
// (including the fee). Only cash-bearing types (see isCashPaymentType) are
// reflected in Cash-in-Hand — Adjustment/Waiver correct the ledger without
// any cash actually moving.
func (s *Service) RecordPayment(ctx context.Context, loanID uint, in PaymentInput) (*Loan, error) {
	l, err := s.repo.FindByID(ctx, loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if in.Amount <= 0 {
		return nil, ErrInvalidAmount
	}
	if in.ProcessingFee < 0 {
		return nil, ErrInvalidAmount
	}
	// Split validation only applies to cash-bearing types — Adjustment/
	// Waiver/Discount/Auction* move no real cash, so there is no mode to
	// speak of for them (their split fields are left at their zero value) —
	// and is skipped for a caller using the legacy Method escape hatch (see
	// PaymentInput.Method's doc comment).
	if isCashPaymentType(in.Type) && in.Method == "" {
		if err := platform.ValidateSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, in.Amount); err != nil {
			return nil, err
		}
		if (in.UpiAmount > 0 || in.BankTransferAmount > 0 || in.ChequeAmount > 0) && in.BankID == nil {
			return nil, ErrBankRequiredForSplitMode
		}
	}
	if in.InterestOverride != nil && *in.InterestOverride < 0 {
		return nil, ErrInvalidAmount
	}

	s.accrueAndSave(ctx, l)

	// A payment made today is stamped with the moment it is actually saved —
	// after the interest it triggered was booked above — so the ledger, which
	// orders purely by time, shows that debit before the payment. (The
	// handler captured PaidOn before accruing, so it would otherwise be a few
	// milliseconds EARLIER than the charge.) A backdated payment keeps its date.
	if now := time.Now(); !in.PaidOn.After(now) && in.PaidOn.Format("2006-01-02") == now.Format("2006-01-02") {
		in.PaidOn = now
	}

	// Charging the fee before allocating means this same payment's Amount
	// can immediately go toward clearing it — fee has first priority in
	// allocatePayment's waterfall.
	if in.ProcessingFee > 0 {
		l.OutstandingProcessingFee = platform.RoundMoney(l.OutstandingProcessingFee + in.ProcessingFee)
	}

	fee, penal, interest, principal, err := allocatePayment(l, in.Type, in.Amount, in.InterestOverride)
	if err != nil {
		return nil, err
	}

	// Every balance is rounded as it is written, so stored figures stay exact
	// rupee amounts and the waterfall's float arithmetic cannot accumulate
	// drift across payments — see platform.RoundMoney.
	l.OutstandingProcessingFee = platform.RoundMoney(l.OutstandingProcessingFee - fee)
	if l.OutstandingProcessingFee < 0 {
		l.OutstandingProcessingFee = 0
	}
	l.PenalInterestPaid = platform.RoundMoney(l.PenalInterestPaid + penal)
	l.InterestPaid = platform.RoundMoney(l.InterestPaid + interest)
	l.OutstandingAmount = platform.RoundMoney(l.OutstandingAmount - principal)
	if l.OutstandingAmount < 0 {
		l.OutstandingAmount = 0
	}

	outstandingInterest := l.AccruedInterest - l.InterestPaid
	outstandingPenal := l.AccruedPenalInterest - l.PenalInterestPaid
	if l.OutstandingAmount <= 0 && outstandingInterest <= 0.01 && outstandingPenal <= 0.01 &&
		l.OutstandingProcessingFee <= 0.01 &&
		(l.Status == StatusActive || l.Status == StatusDueSoon || l.Status == StatusOverdue) {
		// Not StatusClosed: the balance clearing to zero here doesn't mean the
		// gold has actually been handed back — it's the same "fully paid, gold
		// still with us" state the manual release-request checklist path
		// already models as ClosureRequested. CompleteRelease (below) is the
		// one place that ever sets StatusClosed, once a staff member actually
		// releases the packet.
		l.Status = StatusClosureRequested
	} else {
		// Not fully settled, but this payment may have cleared the arrears —
		// which takes an expired-term loan off Overdue and back to Active.
		refreshServicingStatus(l, time.Now())
	}
	if err := s.repo.Update(ctx, l); err != nil {
		return nil, err
	}

	runningBalance := l.OutstandingAmount + math.Max(0, outstandingInterest) + math.Max(0, outstandingPenal) + l.OutstandingProcessingFee
	p := &LoanPayment{
		LoanID:               loanID,
		Amount:               in.Amount,
		Type:                 in.Type,
		ProcessingFee:        in.ProcessingFee,
		ProcessingFeeApplied: fee,
		PaidOn:               in.PaidOn,
		ReceivedByEmployeeID: in.ReceivedByEmployeeID,
		Description:          in.Description,
		Method:               methodOrDerived(in.Method, in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount),
		CashAmount:           in.CashAmount,
		UpiAmount:            in.UpiAmount,
		BankTransferAmount:   in.BankTransferAmount,
		ChequeAmount:         in.ChequeAmount,
		BankID:               in.BankID,
		Reference:            in.Reference,
		PenalInterestApplied: penal,
		InterestApplied:      interest,
		PrincipalApplied:     principal,
		RunningBalance:       runningBalance,
	}
	if err := s.paymentRepo.Create(ctx, p); err != nil {
		return nil, err
	}

	// Amount is the actual cash handed over — the fee (if any) is paid out
	// of this same amount, not collected on top of it (see allocatePayment's
	// fee-first priority), so the cash-in movement is just Amount.
	if isCashPaymentType(in.Type) && s.cashRecorder != nil {
		if _, groupID, err := s.cashRecorder.RecordLoanPaymentCashIn(ctx, l.ID, l.LoanNumber, in.Amount, in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, l.BranchID, in.PaidOn, in.Type, l.CustomerID, in.BankID); err != nil {
			log.Printf("cash-in movement (payment) failed for loan %d: %v", l.ID, err)
		} else if groupID != "" {
			// Best-effort, same as the cash recording itself above: losing
			// this link is worse UX (can't trace the payment to its ledger
			// rows) but must never fail a payment that otherwise succeeded.
			// RecordPayment returns a fresh s.Get() below, not p directly, so
			// this write only needs to land in the DB, not on p in memory.
			if err := s.paymentRepo.SetCashTransactionGroupID(ctx, p.ID, groupID); err != nil {
				log.Printf("linking payment %d to cash movement group failed: %v", p.ID, err)
			}
		}
	}

	// A customer paying while their gold sits in the auction pipeline must
	// change what happens to that gold — previously the payment landed and the
	// auction carried on regardless.
	auctionNotified := s.resolveAuctionAfterPayment(ctx, l, p)

	// The generic "a payment was recorded" notification — skipped when the
	// auction path above already sent its own, more specific message for
	// this exact payment (so the customer never gets two notifications for
	// one payment).
	if !auctionNotified {
		s.notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Payment Received", s.brandedMessage(ctx,
			"Dear %s, we have received your payment of ₹%.2f (%s) towards loan %s. — CloudHouse Finance",
			l.Customer.Name, in.Amount, in.Type, l.LoanNumber,
		), commlog.TriggerPayment, "loan", l.ID)
	}

	return s.Get(ctx, l.ID, nil)
}

// TopUpSettleInterest values for TopUpInput.SettleInterest — staff's choice
// for how a loan's currently-outstanding interest/penal interest (if any)
// is handled at top-up time, rather than silently left to keep accruing on
// top of a now-larger balance.
const (
	// TopUpSettleRequire blocks the top-up outright (ErrTopUpNeedsPayment)
	// if any interest/penal interest is outstanding — staff records a
	// separate payment first, then retries. Same gate CreateExtensionRequest
	// already enforces for extensions.
	TopUpSettleRequire = "require"
	// TopUpSettleDeduct clears the outstanding interest/penal interest out
	// of the top-up's own cash payout — the customer's principal/outstanding
	// balance still increases by the full Amount, but the cash actually
	// disbursed is Amount minus what was owed, mirroring how a
	// WithheldFromPayout service charge reduces DisbursedAmount at
	// sanction (see Service.Approve's FinalSanction branch) rather than
	// requiring a separate payment.
	TopUpSettleDeduct = "deduct"
)

// TopUpInput mirrors the "Top Up Loan" form.
type TopUpInput struct {
	Amount             float64
	CashAmount         float64
	UpiAmount          float64
	BankTransferAmount float64
	ChequeAmount       float64
	OccurredOn         time.Time
	Reference          string
	// SettleInterest is TopUpSettleRequire (default, if empty) or
	// TopUpSettleDeduct — staff's per-top-up choice for handling any
	// interest/penal interest already outstanding on the loan. Ignored
	// (no-op) when nothing is currently outstanding.
	SettleInterest       string
	ReceivedByEmployeeID uint
}

// TopUpLoan lets a customer draw additional cash against an already-Active
// loan's spare eligible value, without closing/reopening it — a single-step
// flow (no multi-stage sanction chain, per the confirmed design): headroom
// = EligibleLoanAmount - OutstandingAmount (OutstandingAmount is already
// principal-only, see Loan.OutstandingAmount's own doc comment), and the
// entire read-headroom-then-write-principal sequence runs inside one
// row-locked transaction (Phase 0.5 §5) so two simultaneous top-ups on the
// same loan serialize instead of both succeeding against the same stale
// headroom.
//
// On success, PrincipalAmount and OutstandingAmount both increase by
// Amount — accrual.go's existing accrual already runs off OutstandingAmount
// going forward, so interest naturally starts accruing on the larger
// balance from OccurredOn without any separate recalculation (interest is
// never charged on interest — only principal ever feeds accrual.go).
//
// When the tenant has the top-up approval chain switched on (workflow.
// FlowLoanTopUp) nothing is paid out here: the top-up is saved as Pending
// and only runs — re-validated against the loan's figures at that moment —
// when its final stage approves it (see ApproveTopUp).
func (s *Service) TopUpLoan(ctx context.Context, loanID uint, in TopUpInput) (*Loan, error) {
	chain, err := s.chain(ctx, workflow.FlowLoanTopUp)
	if err != nil {
		return nil, err
	}
	if chain.Off() {
		return s.executeTopUp(ctx, loanID, in, nil)
	}
	first, _ := chain.First()
	return s.requestTopUp(ctx, loanID, in, first)
}

// requestTopUp saves a top-up as Pending at the chain's first stage after
// the same up-front checks the payout itself would run (loan state, split,
// headroom) — so an obviously impossible request is refused immediately
// rather than after it has gone round the approvers.
func (s *Service) requestTopUp(ctx context.Context, loanID uint, in TopUpInput, first workflow.StageDef) (*Loan, error) {
	if in.Amount <= 0 {
		return nil, ErrInvalidAmount
	}
	if err := platform.ValidateSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, in.Amount); err != nil {
		return nil, err
	}
	l, err := s.repo.FindByID(ctx, loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if l.Status != StatusActive && l.Status != StatusDueSoon && l.Status != StatusOverdue {
		return nil, ErrLoanNotActiveForTopUp
	}
	if pending, err := s.topUpRepo.FindPendingByLoanID(ctx, loanID); err != nil {
		return nil, err
	} else if pending != nil {
		return nil, ErrTopUpAlreadyPending
	}
	ornaments, err := s.ornamentRepo.FindByLoanID(ctx, l.ID)
	if err != nil {
		return nil, err
	}
	recalculateTotals(l, ornaments)
	amount := platform.RoundMoney(in.Amount)
	if amount > platform.RoundMoney(l.EligibleLoanAmount-l.OutstandingAmount)+0.01 {
		return nil, ErrTopUpShortfall
	}
	occurredOn := in.OccurredOn
	if occurredOn.IsZero() {
		occurredOn = time.Now()
	}
	t := &LoanTopUp{
		LoanID:                l.ID,
		Amount:                amount,
		EligibleAmountAtTopUp: l.EligibleLoanAmount,
		CashAmount:            in.CashAmount,
		UpiAmount:             in.UpiAmount,
		BankTransferAmount:    in.BankTransferAmount,
		ChequeAmount:          in.ChequeAmount,
		OccurredOn:            occurredOn,
		Reference:             in.Reference,
		Status:                TopUpStatusPending,
		ApprovalStage:         first.Pending,
		SettleInterest:        in.SettleInterest,
	}
	if in.ReceivedByEmployeeID != 0 {
		t.ReceivedByEmployeeID = &in.ReceivedByEmployeeID
	}
	if err := s.topUpRepo.CreateTx(ctx, s.db.WithContext(ctx), t); err != nil {
		return nil, err
	}
	return s.Get(ctx, l.ID, nil)
}

// TopUpApprovalInput mirrors the body of POST /loans/topups/:topUpId/approve.
type TopUpApprovalInput struct {
	Stage           string // workflow.FlowLoanTopUp stage key — must match the top-up's current stage
	Action          string // "Approved" | "Rejected"
	ActorEmployeeID uint
	ActorRole       string
	ActorRoleID     uint
	Remarks         string
}

// ApproveTopUp advances (or rejects) a Pending top-up through the tenant's
// top-up approval chain. The final enabled stage pays it out through the
// same executeTopUp path an unapproved top-up uses, so every headroom,
// arrears and cash-in-hand check runs again against today's figures.
func (s *Service) ApproveTopUp(ctx context.Context, topUpID uint, branchID *uint, in TopUpApprovalInput) (*LoanTopUp, error) {
	t, err := s.topUpRepo.FindByID(ctx, topUpID)
	if err != nil {
		return nil, ErrTopUpNotFound
	}
	if err := s.checkLoanBranch(ctx, t.LoanID, branchID); err != nil {
		return nil, err
	}
	if t.Status != TopUpStatusPending {
		return nil, ErrTopUpAlreadyDecided
	}
	if in.Action != ApprovalStageApproved && in.Action != ApprovalStageRejected {
		return nil, ErrInvalidAction
	}
	chain, err := s.chain(ctx, workflow.FlowLoanTopUp)
	if err != nil {
		return nil, err
	}
	step, ok := chain.ByPending(t.ApprovalStage)
	if !ok || in.Stage != step.Key {
		return nil, ErrWrongStage
	}
	if !s.workflowSvc.CanAct(ctx, in.ActorRoleID, workflow.FlowLoanTopUp, step.Key) {
		return nil, ErrWrongStage
	}

	switch next, hasNext := chain.Next(step.Key); {
	case in.Action == ApprovalStageRejected:
		t.Status = TopUpStatusRejected
		t.ApprovalStage = ApprovalStageRejected
		if err := s.topUpRepo.Update(ctx, t); err != nil {
			return nil, err
		}
	case hasNext:
		t.ApprovalStage = next.Pending
		if err := s.topUpRepo.Update(ctx, t); err != nil {
			return nil, err
		}
	default:
		// The money leaves now, so the top-up is dated now — the backdating
		// guard compares against the loan's latest event today, not the day
		// the request was raised.
		if _, err := s.executeTopUp(ctx, t.LoanID, TopUpInput{
			Amount:               t.Amount,
			CashAmount:           t.CashAmount,
			UpiAmount:            t.UpiAmount,
			BankTransferAmount:   t.BankTransferAmount,
			ChequeAmount:         t.ChequeAmount,
			OccurredOn:           time.Now(),
			Reference:            t.Reference,
			SettleInterest:       t.SettleInterest,
			ReceivedByEmployeeID: in.ActorEmployeeID,
		}, t); err != nil {
			return nil, err
		}
	}

	s.workflowSvc.RecordAction(ctx, &workflow.ApprovalAction{
		Flow: workflow.FlowLoanTopUp, EntityID: t.ID, Stage: step.Key, Action: in.Action,
		ActorEmployeeID: in.ActorEmployeeID, ActorRole: in.ActorRole, Remarks: in.Remarks,
	})
	return s.topUpRepo.FindByID(ctx, t.ID)
}

// executeTopUp pays a top-up out (see TopUpLoan's doc comment). pending, when
// non-nil, is the approved Pending row to turn Active instead of inserting a
// new one.
func (s *Service) executeTopUp(ctx context.Context, loanID uint, in TopUpInput, pending *LoanTopUp) (*Loan, error) {
	if in.Amount <= 0 {
		return nil, ErrInvalidAmount
	}
	if err := platform.ValidateSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, in.Amount); err != nil {
		return nil, err
	}
	occurredOn := in.OccurredOn
	if occurredOn.IsZero() {
		occurredOn = time.Now()
	}

	var result *Loan
	var eligibleAtTopUp float64
	var cashOut float64
	// What a TopUpSettleDeduct top-up withheld, split the way the interest
	// waterfall applied it, plus the loan's balance after — kept so the
	// withheld interest can be booked as its own ledger payment below.
	var settledInterest, settledPenal, balanceAfter float64
	var interestGroupID string
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		l, err := s.repo.LockByID(ctx, tx, loanID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotFound
			}
			return err
		}
		if l.Status != StatusActive && l.Status != StatusDueSoon && l.Status != StatusOverdue {
			return ErrLoanNotActiveForTopUp
		}

		// Recompute EligibleLoanAmount from the loan's current ornaments —
		// the same scheme-LTV calculation AddOrnament/UpdateLoan already use
		// (recalculateTotals, against the loan's frozen scheme snapshot) —
		// rather than trusting the denormalized field to not have drifted,
		// since this number is about to gate real money going out.
		ornaments, err := s.ornamentRepo.FindByLoanID(ctx, l.ID)
		if err != nil {
			return err
		}
		recalculateTotals(l, ornaments)

		// Backdating guard (Phase 0.5 §7): OccurredOn must be >= the most
		// recent event on this account — either a payment or an earlier
		// top-up — and not in the future.
		latestPaidOn, err := s.paymentRepo.FindLatestPaidOn(ctx, l.ID)
		if err != nil {
			return err
		}
		latestTopUp, err := s.topUpRepo.FindMostRecentDate(ctx, l.ID)
		if err != nil {
			return err
		}
		latest := latestPaidOn
		if latestTopUp.After(latest) {
			latest = latestTopUp
		}
		if err := platform.ValidateOccurredOn(occurredOn, latest, time.Now()); err != nil {
			return err
		}

		headroom := platform.RoundMoney(l.EligibleLoanAmount - l.OutstandingAmount)
		amount := platform.RoundMoney(in.Amount)
		if amount > headroom+0.01 {
			return ErrTopUpShortfall
		}
		eligibleAtTopUp = l.EligibleLoanAmount

		// Bring AccruedInterest/AccruedPenalInterest up to date before
		// judging what's outstanding — same "catch stale accrual up first"
		// rationale as CreateExtensionRequest, inlined rather than calling
		// s.accrueAndSave/s.enrich directly: those write via s.db, not tx,
		// which would race against this function's own tx-bound update of
		// the same already-locked row below.
		now := time.Now()
		var firstMonthTopUps []LoanTopUp
		if l.LastAccrualDate.IsZero() || l.LastAccrualDate.Equal(l.OpenedDate) {
			if ups, err := s.topUpRepo.FindActiveByLoanID(ctx, l.ID); err == nil {
				firstMonthTopUps = ups
			}
		}
		interestDelta, penalDelta, anchor := projectAccrual(l, now, firstMonthTopUps)
		if interestDelta > 0 || penalDelta > 0 {
			l.AccruedInterest = platform.RoundMoney(l.AccruedInterest + interestDelta)
			l.AccruedPenalInterest = platform.RoundMoney(l.AccruedPenalInterest + penalDelta)
			l.LastAccrualDate = anchor
			refreshServicingStatus(l, now)
		}
		outstandingInterest := clampMoney(l.AccruedInterest - l.InterestPaid)
		outstandingPenal := clampMoney(l.AccruedPenalInterest - l.PenalInterestPaid)
		arrears := platform.RoundMoney(outstandingInterest + outstandingPenal)

		settleMode := in.SettleInterest
		if settleMode == "" {
			settleMode = TopUpSettleRequire
		}
		// deductedFromPayout — 0 unless settleMode is TopUpSettleDeduct and
		// there's actually something owed — is what shrinks the cash
		// disbursed below (see cashOutAmount) without touching the
		// principal/OutstandingAmount increase the customer is drawing.
		var deductedFromPayout float64
		if arrears > moneyEpsilon {
			switch settleMode {
			case TopUpSettleDeduct:
				// Capped at the top-up amount itself — a top-up can only ever
				// settle arrears out of its OWN payout, never claw back
				// principal the customer isn't actually drawing right now.
				deductedFromPayout = math.Min(arrears, amount)
				penalPortion := math.Min(deductedFromPayout, outstandingPenal)
				interestPortion := deductedFromPayout - penalPortion
				settledInterest, settledPenal = interestPortion, penalPortion
				l.PenalInterestPaid = platform.RoundMoney(l.PenalInterestPaid + penalPortion)
				l.InterestPaid = platform.RoundMoney(l.InterestPaid + interestPortion)
			default: // TopUpSettleRequire
				// Still persist the caught-up accrual even though the top-up
				// itself is being rejected — the customer/loan owes this
				// interest regardless of whether the top-up proceeds, and
				// leaving it unpersisted would just make the next accrual
				// run redo the same catch-up.
				if interestDelta > 0 || penalDelta > 0 {
					_ = s.repo.UpdateTx(ctx, tx, l)
				}
				return ErrTopUpNeedsPayment
			}
		}

		if err := s.ensureCashInHand(ctx, l.BranchID, platform.RoundMoney(amount-deductedFromPayout)); err != nil {
			return err
		}

		l.PrincipalAmount = platform.RoundMoney(l.PrincipalAmount + amount)
		l.OutstandingAmount = platform.RoundMoney(l.OutstandingAmount + amount)
		if err := s.repo.UpdateTx(ctx, tx, l); err != nil {
			return err
		}

		// cashOutAmount is what actually leaves the till — the full top-up
		// amount, less whatever was just withheld to clear arrears (0 unless
		// TopUpSettleDeduct fired above). The split fields on LoanTopUp
		// record what the CUSTOMER handed over (still Amount, split across
		// modes as entered on the form) — CashRecorder gets the smaller
		// cashOutAmount separately below, mirroring how a WithheldFromPayout
		// service charge shrinks DisbursedAmount without changing
		// PrincipalAmount/SanctionedAmount.
		cashOutAmount := platform.RoundMoney(amount - deductedFromPayout)

		topUp := &LoanTopUp{
			LoanID:                l.ID,
			Amount:                amount,
			EligibleAmountAtTopUp: eligibleAtTopUp,
			CashAmount:            in.CashAmount,
			UpiAmount:             in.UpiAmount,
			BankTransferAmount:    in.BankTransferAmount,
			ChequeAmount:          in.ChequeAmount,
			OccurredOn:            occurredOn,
			Reference:             in.Reference,
			Status:                TopUpStatusActive,
		}
		if in.ReceivedByEmployeeID != 0 {
			topUp.ReceivedByEmployeeID = &in.ReceivedByEmployeeID
		}
		if pending != nil {
			// The approved request becomes the ledger row itself.
			topUp.ID = pending.ID
			topUp.TenantScoped = pending.TenantScoped
			topUp.CreatedAt = pending.CreatedAt
			topUp.ApprovalStage = ApprovalStageApproved
			topUp.SettleInterest = pending.SettleInterest
			if err := s.topUpRepo.UpdateTx(ctx, tx, topUp); err != nil {
				return err
			}
		} else if err := s.topUpRepo.CreateTx(ctx, tx, topUp); err != nil {
			return err
		}

		cashOut = cashOutAmount
		balanceAfter = platform.RoundMoney(l.OutstandingAmount + clampMoney(l.AccruedInterest-l.InterestPaid) + clampMoney(l.AccruedPenalInterest-l.PenalInterestPaid) + l.OutstandingProcessingFee)
		result = l
		return nil
	})
	if err != nil {
		return nil, err
	}

	// Best-effort and outside the transaction, same rationale as
	// RecordPayment's disbursement/collection cash recording.
	if s.cashRecorder != nil {
		// cashOut is in.Amount unless TopUpSettleDeduct withheld part of it
		// to clear arrears above — shrink each mode's split proportionally
		// (rather than favoring one mode) so the recorded split still sums
		// to exactly cashOut. A no-op when nothing was withheld.
		cashAmt, upiAmt, bankAmt, chequeAmt := in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount
		if cashOut < in.Amount-0.01 && in.Amount > 0 {
			scale := cashOut / in.Amount
			cashAmt = platform.RoundMoney(in.CashAmount * scale)
			upiAmt = platform.RoundMoney(in.UpiAmount * scale)
			bankAmt = platform.RoundMoney(in.BankTransferAmount * scale)
			chequeAmt = platform.RoundMoney(cashOut - cashAmt - upiAmt - bankAmt) // absorbs rounding remainder
		}
		if _, _, err := s.cashRecorder.RecordLoanTopUpCashOut(ctx, result.ID, result.LoanNumber, cashOut, cashAmt, upiAmt, bankAmt, chequeAmt, result.BranchID, occurredOn, result.CustomerID); err != nil {
			log.Printf("cash-out movement (top-up) failed for loan %d: %v", result.ID, err)
		}
		// The withheld arrears never left the till — booked as its own
		// cash-in (income/collection) so it's visible in Cash & Expenses
		// like any other collection, not just as a smaller cash-out above.
		// Mirrors RecordServiceChargeCashIn's "withheld, not paid out and
		// collected back" rationale.
		if deducted := platform.RoundMoney(in.Amount - cashOut); deducted > 0.01 {
			if _, groupID, err := s.cashRecorder.RecordLoanPaymentCashIn(ctx, result.ID, result.LoanNumber, deducted, deducted, 0, 0, 0, result.BranchID, occurredOn, "Interest (top-up settlement)", result.CustomerID, nil); err != nil {
				log.Printf("cash-in movement (top-up interest settlement) failed for loan %d: %v", result.ID, err)
			} else {
				interestGroupID = groupID
			}
		}
	}
	// The cash ledgers hide "Collection" cash movements and show LoanPayment
	// rows instead, and the loan's own ledger reads only LoanPayment — so the
	// withheld interest needs a payment row of its own, or it never appears
	// in any ledger. Stamped with the top-up's own time (the ledger breaks
	// that tie payout-first) and written after the top-up row it settles.
	if deducted := platform.RoundMoney(in.Amount - cashOut); deducted > 0.01 {
		p := &LoanPayment{
			LoanID:                 result.ID,
			Amount:                 deducted,
			Type:                   PaymentTypeInterest,
			PaidOn:                 occurredOn.Add(time.Millisecond), // just after the top-up it settles
			Description:            "Interest settled from top-up payout",
			Method:                 platform.DeriveMethod(deducted, 0, 0, 0),
			CashAmount:             deducted,
			PenalInterestApplied:   settledPenal,
			InterestApplied:        settledInterest,
			RunningBalance:         balanceAfter,
			CashTransactionGroupID: interestGroupID,
		}
		if in.ReceivedByEmployeeID != 0 {
			p.ReceivedByEmployeeID = &in.ReceivedByEmployeeID
		}
		if err := s.paymentRepo.Create(ctx, p); err != nil {
			log.Printf("loan-payment ledger row (top-up interest settlement) failed for loan %d: %v", result.ID, err)
		}
	}
	return s.Get(ctx, result.ID, nil)
}

// ListTopUps returns the loan's full top-up history, newest first — backs
// the "Top-up history" panel on LoanDetail.tsx.
func (s *Service) ListTopUps(ctx context.Context, loanID uint) ([]LoanTopUp, error) {
	if _, err := s.repo.FindByID(ctx, loanID); err != nil {
		return nil, ErrNotFound
	}
	return s.topUpRepo.FindByLoanID(ctx, loanID)
}

// ledgerCreditTypes are the LoanPayment.Type values that reduce what the
// customer owes — cash actually received (Interest/Penal Interest/Principal/
// Partial/Full Settlement) plus the two ways a balance is cleared without
// new cash (Auction Sale applies auction proceeds, Auction Write-Off forgives
// a shortfall) — mirrors scratch/loan-ledger-history-mockup.html's "payment
// received" (cr) bucket. Everything else on a loan's ledger today
// (Adjustment, Waiver, Discount) is a balance-reducing entry too but isn't a
// customer-facing "payment" in the mockup's sense; they still classify as
// credit here since none of them increase what's owed.
var ledgerCreditTypes = map[string]bool{
	PaymentTypeInterest:        true,
	PaymentTypePenalInterest:   true,
	PaymentTypePrincipal:       true,
	PaymentTypePartial:         true,
	PaymentTypeFullSettlement:  true,
	PaymentTypeAuctionSale:     true,
	PaymentTypeAuctionWriteOff: true,
	PaymentTypeWaiver:          true,
	PaymentTypeAdjustment:      true,
	PaymentTypeDiscount:        true,
}

// resolveAuctionAfterPayment reacts to a payment on a loan whose gold is still
// in the auction pipeline:
//
//   - Loan now fully closed → the auction is cancelled automatically and
//     recorded as Settled by Repayment. The customer rescued their gold; no
//     human action should be needed to notice that.
//   - Loan still open → a PartialRepayment escalation is raised and the
//     auction FREEZES (see requireNoPendingDecision). A part-payment is not
//     the system's call to interpret: somebody with authority decides whether
//     to keep pursuing the auction or release the gold. Deliberately NOT
//     auto-withdrawn.
//
// A no-op for the overwhelming majority of payments, which have no live
// auction — the lookup returns nothing and this returns immediately.
//
// Returns true if this payment had an active auction to react to (and thus
// already sent its own auction-specific notification) — RecordPayment uses
// this to decide whether it still needs to send its own generic
// "PaymentRecorded" notification, so a customer never gets two
// notifications for one payment.
func (s *Service) resolveAuctionAfterPayment(ctx context.Context, l *Loan, p *LoanPayment) bool {
	hadActiveAuction := false
	// autoKeep: the tenant switched the partial-repayment decision stage off,
	// so a part-payment no longer freezes the auction for a human decision.
	autoKeep, autoKept := false, false
	if c, err := s.chain(ctx, workflow.FlowAuctionPartialRepayment); err == nil && c.Off() {
		autoKeep = true
	}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Locked: a concurrent auction action must not read this same state and
		// overwrite the freeze we are about to apply.
		rec, err := s.auctionRepo.FindActiveByLoanIDForUpdate(ctx, tx, l.ID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil // no live auction — nothing to do
			}
			return err
		}
		hadActiveAuction = true

		// A case at Auctioned (or later) has already been sold — this
		// function's keep/remove-from-auction reaction only makes sense
		// pre-sale, while the gold itself is still at risk. Letting it run
		// post-sale wrongly moved the case to Withdrawn whenever a payment
		// happened to zero out interest/penal arrears, even though the case
		// still had an undisposed surplus sitting on SurplusPayableAmount —
		// FindActiveByLoanID's `stage NOT IN (Settled, Withdrawn)` filter
		// then could never find it again, so the Settle Auction screen
		// failed with "this loan has no auction case yet" even though the
		// gold had genuinely been sold. Shortfall/surplus disposition after
		// a sale is handled entirely by ResolveAuctionDecision (Shortfall
		// kind) and SettleAuction — this function must leave those cases
		// alone.
		if !IsPreSaleAuctionStage(rec.Stage) {
			return nil
		}

		if l.Status == StatusClosed {
			rec.Stage = AuctionStageSettled
			rec.FinalSettlementStatus = AuctionSettlementSettledByRepayment
			if err := s.auctionRepo.UpdateTx(ctx, tx, rec); err != nil {
				return err
			}
			s.recordAuctionEvent(ctx, tx, rec.ID, AuctionEventSettledByRepaymentAuto, nil, "",
				fmt.Sprintf("Loan cleared in full by payment of ₹%.2f — auction cancelled automatically", p.Amount))
			s.notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Loan Settled", s.brandedMessage(ctx,
				"Dear %s, we have received your payment of ₹%.2f. Loan %s is now fully settled, the auction has been cancelled, and your pledged gold is safe. — CloudHouse Finance",
				l.Customer.Name, p.Amount, l.LoanNumber,
			), commlog.TriggerPayment, "loan", l.ID)
			return nil
		}

		// Refresh the live figures so the decision-maker sees what is actually
		// still owed at this moment.
		s.enrich(ctx, l)
		outstanding := platform.RoundMoney(l.TotalOutstandingBalance)

		// Arrears cleared — interest AND penal interest fully paid, even
		// though principal is still owed. The customer has caught up on
		// everything that fell due, which is precisely what the auction was
		// pursuing, so the case is withdrawn automatically rather than
		// escalated: there is nothing left for a manager to weigh. Principal
		// not yet due is not grounds to sell someone's gold.
		//
		// A payment that leaves ANY arrears standing still raises the
		// keep/remove escalation below — otherwise a token ₹100 could pull a
		// scheduled auction with no manager involved.
		if l.OutstandingInterest < moneyEpsilon && l.OutstandingPenalInterest < moneyEpsilon {
			rec.Stage = AuctionStageWithdrawn
			if err := s.auctionRepo.UpdateTx(ctx, tx, rec); err != nil {
				return err
			}
			// Any escalation raised by an earlier part-payment is now moot.
			if pending, err := s.auctionRepo.FindPendingDecision(ctx, tx, rec.ID, AuctionDecisionKindPartialRepayment); err == nil && pending != nil {
				pending.Status = AuctionDecisionRemovedFromAuction
				pending.OutstandingAtRequest = outstanding
				if err := s.auctionRepo.UpdateDecision(ctx, tx, pending); err != nil {
					return err
				}
			} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			// Back to an ordinary collection status. Not in arrears, so
			// Active — the same rule refreshServicingStatus applies to loans
			// that never entered the auction pipeline (an expired term alone
			// does not read as Overdue for a customer who is servicing).
			l.Status = StatusActive
			if err := tx.Save(l).Error; err != nil {
				return err
			}
			s.recordAuctionEvent(ctx, tx, rec.ID, AuctionEventDecisionRemove, nil, "", fmt.Sprintf(
				"Payment of ₹%.2f cleared all interest and penal interest — auction withdrawn automatically (₹%.2f principal still payable)", p.Amount, outstanding))
			s.notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Removed From Auction", s.brandedMessage(ctx,
				"Dear %s, we have received your payment of ₹%.2f. Loan %s is no longer overdue and has been removed from auction — your pledged gold is no longer at risk. A balance of ₹%.2f remains payable. — CloudHouse Finance",
				l.Customer.Name, p.Amount, l.LoanNumber, outstanding,
			), commlog.TriggerPayment, "loan", l.ID)
			return nil
		}

		// One pending request per case: a second part-payment updates the
		// existing escalation rather than stacking up duplicates.
		existing, err := s.auctionRepo.FindPendingDecision(ctx, tx, rec.ID, AuctionDecisionKindPartialRepayment)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if existing == nil && autoKeep {
			// This tenant has no partial-repayment decision stage: the
			// auction simply carries on (Keep in Auction), recorded as an
			// already-decided request so the case history still shows it.
			now := time.Now()
			if err := s.auctionRepo.CreateDecision(ctx, tx, &AuctionDecisionRequest{
				AuctionRecordID:      rec.ID,
				LoanID:               l.ID,
				Kind:                 AuctionDecisionKindPartialRepayment,
				TriggeredByPaymentID: &p.ID,
				AmountPaid:           platform.RoundMoney(p.Amount),
				OutstandingAtRequest: outstanding,
				Status:               AuctionDecisionKeepInAuction,
				DecidedByRole:        "System",
				DecisionRemarks:      "No approval configured — auction continues automatically",
				DecidedAt:            &now,
			}); err != nil {
				return err
			}
			autoKept = true
			s.recordAuctionEvent(ctx, tx, rec.ID, AuctionEventDecisionKeep, nil, "", fmt.Sprintf(
				"Part-payment of ₹%.2f received (₹%.2f still owed) — kept in auction automatically (no decision stage configured)", p.Amount, outstanding))
			return nil
		}
		if existing != nil {
			existing.AmountPaid = platform.RoundMoney(existing.AmountPaid + p.Amount)
			existing.OutstandingAtRequest = outstanding
			existing.TriggeredByPaymentID = &p.ID
			if err := s.auctionRepo.UpdateDecision(ctx, tx, existing); err != nil {
				return err
			}
		} else if err := s.auctionRepo.CreateDecision(ctx, tx, &AuctionDecisionRequest{
			AuctionRecordID:      rec.ID,
			LoanID:               l.ID,
			Kind:                 AuctionDecisionKindPartialRepayment,
			TriggeredByPaymentID: &p.ID,
			AmountPaid:           platform.RoundMoney(p.Amount),
			OutstandingAtRequest: outstanding,
			Status:               AuctionDecisionPending,
		}); err != nil {
			return err
		}

		s.recordAuctionEvent(ctx, tx, rec.ID, AuctionEventDecisionRequested, nil, "", fmt.Sprintf(
			"Part-payment of ₹%.2f received (₹%.2f still owed) — auction frozen pending a keep/remove decision", p.Amount, outstanding))
		return nil
	})
	if err != nil {
		// Logged rather than failing the payment: the money was genuinely
		// received and must stay recorded. The auction stays where it was, and
		// the pipeline guards still re-read state on every subsequent action.
		log.Printf("auction resolution after payment failed for loan %d: %v", l.ID, err)
		return hadActiveAuction
	}

	// Fixes a pre-existing bug: this used to fire unconditionally for every
	// non-closing payment on ANY loan (auction or not), because it wasn't
	// actually gated on an active auction having been found above — now it
	// only fires for the case it was written for.
	if hadActiveAuction && l.Status != StatusClosed && !autoKept {
		s.notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Payment Received — Auction On Hold", s.brandedMessage(ctx,
			"Dear %s, we have received your payment of ₹%.2f towards loan %s. As the loan is not yet fully settled, the auction of your pledged gold is on hold while our management reviews your account. We will inform you of the decision. — CloudHouse Finance",
			l.Customer.Name, p.Amount, l.LoanNumber,
		), commlog.TriggerPayment, "loan", l.ID)
	}
	return hadActiveAuction
}

// BankPledgeInput mirrors the body of POST /loans/:id/bank-pledge. BankID/
// BankName both come from the caller — the frontend's bank search dropdown
// already resolves both for the bank the staff member picked, so the
// service just stores them as given rather than re-looking the bank up.
type BankPledgeInput struct {
	BankID            *uint
	BankName          string
	PledgedAmount     float64
	PledgeDate        time.Time
	BankInterestRate  float64
	ReferenceNumber   string
	BankPledgeDueDate *time.Time

	// CashTreatment decides whether the bank's advance is booked into
	// Cash-in-Hand or recorded with no cash effect at all. Must be one of the
	// BankPledgeCashTreatment* constants — the handler substitutes RecordOnly
	// for an omitted value, so cash only moves on an explicit opt-in.
	CashTreatment string

	// CashAmount/UpiAmount/BankTransferAmount/ChequeAmount split how the
	// advance was received (CashIn only; all-zero means all Cash), and
	// ReceivedBankID is the branch bank account the non-cash share landed in.
	CashAmount         float64
	UpiAmount          float64
	BankTransferAmount float64
	ChequeAmount       float64
	ReceivedBankID     *uint

	// ActorEmployeeID/ActorRole identify the real authenticated staff member
	// for the audit trail — read from JWT claims via platform.ActorFromContext,
	// never from the request body.
	ActorEmployeeID *uint
	ActorRole       string
}

func (s *Service) RecordBankPledge(ctx context.Context, loanID uint, branchID *uint, in BankPledgeInput) (*Loan, error) {
	l, err := s.repo.FindByID(ctx, loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, ErrNotFound
	}
	if in.PledgedAmount <= 0 {
		return nil, ErrInvalidAmount
	}
	// The gold must still be in the branch's custody to hand to a bank. A
	// closed/released, auctioned or not-yet-disbursed loan has nothing to
	// pledge — previously this was unchecked, so a Closed loan could be
	// re-pledged straight back into the Bank Pledge worklist.
	if err := bankPledgeRefusal(l.Status, l.BankPledgeStatus); err != nil {
		return nil, err
	}
	// The check above reads the loan's own stored fields; this one asks the
	// pledge RECORDS, for the same reason CompleteRelease does — on a loan
	// whose string has drifted away from an already-open record, the check
	// above passes and a second live pledge would be created.
	hasActivePledge, err := s.pledgeRepo.HasActive(ctx, loanID)
	if err != nil {
		return nil, err
	}
	if hasActivePledge {
		return nil, ErrBankPledgeStillActive
	}

	// Only currently-pledged ornaments can be handed to the bank — a
	// released one is already back with the customer.
	var grossWeight float64
	for _, o := range l.Ornaments {
		if o.ReleasedAt != nil {
			continue
		}
		grossWeight += o.GrossWeight
	}

	// An unrecognised treatment is rejected rather than coerced: silently
	// reading a typo as "no cash" would suppress a real cash entry. The
	// handler is what turns an OMITTED value into RecordOnly.
	switch in.CashTreatment {
	case BankPledgeCashTreatmentCashIn, BankPledgeCashTreatmentRecordOnly:
	default:
		return nil, ErrInvalidCashTreatment
	}

	// Cash is touched ONLY when the operator explicitly chose CashIn. A
	// RecordOnly pledge is pure book-keeping: no movement at all, and
	// correspondingly no reversal on release (see ReleaseBankPledge).
	//
	// A pledge books cash IN only — the bank's advance is borrowing, not
	// spending, so no expense is recorded here. The expense is booked at
	// release (RecordBankPledgeReleaseExpense), when the money actually
	// goes back to the bank.
	//
	// Booked BEFORE the pledge is saved so a failure is returned to the
	// operator instead of leaving a CashIn pledge with no cash entry.
	var cashMovementID *uint
	var recvCash, recvUpi, recvBankTransfer, recvCheque float64
	var recvBankID *uint
	if in.CashTreatment == BankPledgeCashTreatmentCashIn {
		recvCash, recvUpi, recvBankTransfer, recvCheque, err = platform.NormalizeSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, platform.RoundMoney(in.PledgedAmount), in.ReceivedBankID)
		if err != nil {
			return nil, err
		}
		if recvUpi+recvBankTransfer+recvCheque > 0 {
			recvBankID = in.ReceivedBankID
		}
	}
	if in.CashTreatment == BankPledgeCashTreatmentCashIn && s.cashRecorder != nil {
		id, err := s.cashRecorder.RecordBankPledgeCashIn(ctx, loanID, l.LoanNumber, in.BankName, platform.RoundMoney(in.PledgedAmount), recvCash, recvUpi, recvBankTransfer, recvCheque, recvBankID, in.PledgeDate)
		if err != nil {
			return nil, fmt.Errorf("could not record the pledge in Cash-in-Hand, pledge not saved: %w", err)
		}
		cashMovementID = &id
	}

	p := &BankPledgeRecord{
		LoanID:             loanID,
		BankID:             in.BankID,
		BankName:           in.BankName,
		PledgedAmount:      platform.RoundMoney(in.PledgedAmount),
		PledgeDate:         in.PledgeDate,
		BankInterestRate:   in.BankInterestRate,
		ReferenceNumber:    in.ReferenceNumber,
		BankPledgeDueDate:  in.BankPledgeDueDate,
		PledgedGrossWeight: grossWeight,
		PledgedNetWeight:   l.TotalNetWeight,
		CashTreatment:      in.CashTreatment,
		CashAmount:         recvCash,
		UpiAmount:          recvUpi,
		BankTransferAmount: recvBankTransfer,
		ChequeAmount:       recvCheque,
		ReceivedBankID:     recvBankID,
		Status:             BankPledgeStatusRecordActive,
		CashMovementID:     cashMovementID,
	}
	if err := s.pledgeRepo.Create(ctx, p); err != nil {
		s.undoCashMovement(ctx, cashMovementID)
		return nil, err
	}

	l.BankPledgeStatus = BankPledgeStatusPledged
	if err := s.repo.Update(ctx, l); err != nil {
		return nil, err
	}

	if s.packetMover != nil {
		if err := s.packetMover.RecordBankPledgeMovement(ctx, loanID, "Bank pledge: "+in.BankName); err != nil {
			log.Printf("packet movement (bank pledge) failed for loan %d: %v", loanID, err)
		}
	}

	s.recordPledgeEvent(ctx, p, BankPledgeEventPledged, in.ActorEmployeeID, in.ActorRole, pledgeTreatmentRemark(in.CashTreatment))

	return s.Get(ctx, l.ID, nil)
}

// undoDisbursementCash retracts the disbursement cash-out and withheld-charge
// cash-in booked for loanNumber when the approval that triggered them could
// not be saved — see Service.Approve.
func (s *Service) undoDisbursementCash(ctx context.Context, loanNumber string) {
	if s.cashRecorder == nil {
		return
	}
	if err := s.cashRecorder.DeleteLoanDisbursementCashMovements(ctx, loanNumber); err != nil {
		log.Printf("could not roll back disbursement cash for %s after a failed approval: %v", loanNumber, err)
	}
}

// undoCashMovement rolls back a movement booked just before a step that then
// failed. Best-effort — if the delete itself fails the orphan is logged for
// manual clean-up rather than masking the original error.
func (s *Service) undoCashMovement(ctx context.Context, id *uint) {
	if id == nil || s.cashRecorder == nil {
		return
	}
	if err := s.cashRecorder.DeleteCashMovement(ctx, *id); err != nil {
		log.Printf("could not roll back cash movement %d after a failed save: %v", *id, err)
	}
}

// pledgeTreatmentRemark renders the cash decision in plain words, so the audit
// timeline explains itself without the reader having to know the enum.
func pledgeTreatmentRemark(treatment string) string {
	if treatment == BankPledgeCashTreatmentCashIn {
		return "Pledged amount added to Cash-in-Hand"
	}
	return "Recorded as a re-pledge record only — no cash effect"
}

// recordPledgeEvent appends to a re-pledge record's audit trail. Like
// notifyCustomer, a failure here is logged rather than propagated: losing an
// audit line must never roll back the financial operation it describes.
func (s *Service) recordPledgeEvent(ctx context.Context, p *BankPledgeRecord, action string, actorID *uint, actorRole, remarks string) {
	if err := s.pledgeRepo.CreateEvent(ctx, &BankPledgeEvent{
		BankPledgeRecordID: p.ID,
		Action:             action,
		ActorEmployeeID:    actorID,
		ActorRole:          actorRole,
		Amount:             p.PledgedAmount,
		Remarks:            remarks,
	}); err != nil {
		log.Printf("bank pledge event (%s) failed for pledge %d: %v", action, p.ID, err)
	}
}

// --- Auction workflow (7-stage) --------------------------------------------
//
// Overdue -> Defaulted (both derived read-time flags, see
// accrual.go's enrichStatusFlags — no AuctionRecord exists yet at that
// point) -> AuctionEligible -> NoticeIssued -> AuctionScheduled ->
// Auctioned -> Settled. Each function below advances exactly one stage and
// validates the AuctionRecord/Loan is in the correct prior stage first.

// getAuctionRecord returns the loan's LIVE auction case. A loan may carry
// concluded cases from earlier attempts; those are reached through
// GetAuctionHistory instead, so "the" auction always means the active one.
func (s *Service) getAuctionRecord(ctx context.Context, loanID uint) (*AuctionRecord, error) {
	rec, err := s.auctionRepo.FindActiveByLoanID(ctx, loanID)
	if err != nil {
		return nil, ErrAuctionNotFound
	}
	return rec, nil
}

// requireNoPendingDecision blocks a pipeline step while any escalation is
// outstanding against the case. This is the load-bearing safety check of the
// whole auction rework: once a customer has paid something, their gold must
// not advance one step closer to being sold until a human has ruled on it.
func (s *Service) requireNoPendingDecision(ctx context.Context, recID uint) error {
	pending, err := s.auctionRepo.HasAnyPendingDecision(ctx, recID)
	if err != nil {
		return err
	}
	if pending {
		return ErrAuctionDecisionPending
	}
	return nil
}

// recordAuctionEvent appends to a case's staff-action audit trail. Logged
// rather than propagated on failure, for the same reason as recordPledgeEvent:
// losing an audit line must not roll back the operation it describes.
func (s *Service) recordAuctionEvent(ctx context.Context, tx *gorm.DB, recID uint, action string, actorID *uint, actorRole, remarks string) {
	if err := s.auctionRepo.CreateEvent(ctx, tx, &AuctionEvent{
		AuctionRecordID: recID,
		Action:          action,
		ActorEmployeeID: actorID,
		ActorRole:       actorRole,
		Remarks:         remarks,
	}); err != nil {
		log.Printf("auction event (%s) failed for auction %d: %v", action, recID, err)
	}
}

// GetAuctionHistory returns every auction case ever opened against a loan.
func (s *Service) GetAuctionHistory(ctx context.Context, loanID uint, branchID *uint) ([]AuctionRecord, error) {
	if err := s.checkLoanBranch(ctx, loanID, branchID); err != nil {
		return nil, err
	}
	return s.auctionRepo.FindHistoryByLoanID(ctx, loanID)
}

// ListConcludedAuctions returns finished auction cases (Settled or Withdrawn)
// across all loans, scoped to the caller's branch — backs the Auctions
// screen's History tab. See AuctionRepository.FindAllConcluded for hasSale/
// query/limit/offset semantics.
func (s *Service) ListConcludedAuctions(ctx context.Context, branchID *uint, hasSale *bool, query string, limit, offset int) ([]ConcludedAuctionRow, int64, error) {
	return s.auctionRepo.FindAllConcluded(ctx, branchID, hasSale, query, limit, offset)
}

// ListPendingAuctionDecisions returns every outstanding escalation awaiting a
// human decision, scoped to the caller's branch.
func (s *Service) ListPendingAuctionDecisions(ctx context.Context, branchID *uint) ([]AuctionDecisionRequest, error) {
	return s.auctionRepo.FindPendingDecisions(ctx, branchID)
}

// GetAuctionRecord returns a loan's auction case record (including its
// notice history), or ErrAuctionNotFound if the loan was never marked
// auction-eligible.
func (s *Service) GetAuctionRecord(ctx context.Context, loanID uint, branchID *uint) (*AuctionRecord, error) {
	if err := s.checkLoanBranch(ctx, loanID, branchID); err != nil {
		return nil, err
	}
	return s.getAuctionRecord(ctx, loanID)
}

// MarkAuctionEligible starts a loan's auction case: requires the loan to
// currently be Defaulted (IsDefaulted — overdue by more than 90 days AND
// still carrying genuine interest/penal-interest arrears, see accrual.go),
// creates an AuctionRecord at AuctionEligible, and sets Loan.Status
// accordingly. A loan that's overdue but has kept its accrued interest and
// penal interest fully paid down cannot be started into auction here.
//
// Only one case may be ACTIVE per loan, but a loan that had a case withdrawn
// (customer caught up) and then defaulted again can start a fresh one — the
// old behavior of "one auction per loan, forever" left such loans permanently
// unauctionable. The rule is enforced in the database by a partial unique
// index (see cmd/migrate), so two concurrent requests cannot both open a case;
// the constraint violation is translated back to ErrAuctionAlreadyStarted.
func (s *Service) MarkAuctionEligible(ctx context.Context, loanID uint, branchID *uint, actorID *uint, actorRole string, actorRoleID uint) (*AuctionRecord, error) {
	if !s.checkStagePermission(ctx, actorRoleID, "can mark loan auction eligible") {
		return nil, ErrAuctionStepNotPermitted
	}
	l, err := s.repo.FindByID(ctx, loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, ErrNotFound
	}
	// Without this, IsDefaulted below is judged against whatever
	// AccruedInterest/AccruedPenalInterest a plain FindByID happens to find
	// in the DB — stale until something else's read path (Get/
	// GetByLoanNumber) last persisted a fresh accrual. A loan genuinely 130
	// days overdue but not accrued since, say, day 60 could still show
	// arrears as fully paid down here and get rejected with
	// ErrLoanNotDefaulted, even though List()'s own in-memory accrual
	// projection (what the Auctions screen actually displays) already
	// shows it as Defaulted. Catching this action up the same way every
	// other balance-changing action does keeps the check honest.
	s.accrueAndSave(ctx, l)
	s.enrich(ctx, l)
	if !l.IsDefaulted {
		return nil, ErrLoanNotDefaulted
	}
	// Checks the ACTIVE case only — a concluded one must not block a new
	// attempt. The DB index is the real guard against races.
	if _, err := s.auctionRepo.FindActiveByLoanID(ctx, loanID); err == nil {
		return nil, ErrAuctionAlreadyStarted
	}

	rec := &AuctionRecord{
		LoanID:                loanID,
		Stage:                 AuctionStageEligible,
		AuctionEligibleDate:   time.Now(),
		FinalSettlementStatus: AuctionSettlementPending,
	}
	if err := s.auctionRepo.Create(ctx, rec); err != nil {
		// A unique-violation here means a concurrent request won the race and
		// already opened the case, which is exactly "already started".
		if isUniqueViolation(err) {
			return nil, ErrAuctionAlreadyStarted
		}
		return nil, err
	}

	l.Status = StatusAuctionEligible
	if err := s.repo.Update(ctx, l); err != nil {
		return nil, err
	}

	s.recordAuctionEvent(ctx, nil, rec.ID, AuctionEventEligible, actorID, actorRole, "Loan marked auction-eligible")
	s.notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Auction Eligible", s.brandedMessage(ctx,
		"Dear %s, your gold loan %s is seriously overdue and has now been marked eligible for auction. Outstanding: ₹%.2f. Please contact the branch immediately to settle and retain your pledged items. — CloudHouse Finance",
		l.Customer.Name, l.LoanNumber, l.TotalOutstandingBalance,
	), commlog.TriggerAuctionEvent, "auction_record", rec.ID)

	return s.getAuctionRecord(ctx, loanID)
}

// isUniqueViolation reports whether err is a duplicate-key error. Matched on
// message text rather than a driver-specific error code, because this codebase
// keeps GORM driver details out of the service layer; the substrings cover
// Postgres ("duplicate key value violates unique constraint") and SQLite
// ("UNIQUE constraint failed").
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "duplicate key") ||
		strings.Contains(msg, "unique constraint") ||
		strings.Contains(msg, "uniqueviolation")
}

// auctionNoticeChannels are the channels every auction notice is sent
// through. SMS and Registered Post used to be listed alongside WhatsApp,
// but neither ever had a real provider wired up — they were only ever
// logged as if sent, which misrepresented to staff (and the customer
// notice history) that the notice had actually gone out three ways when
// only one message was ever delivered. Trimmed to the one channel that is
// real.
var auctionNoticeChannels = []string{"WhatsApp"}

// IssueAuctionNotice logs a customer notice against the loan's auction case
// on every channel in auctionNoticeChannels and advances it to NoticeIssued
// (idempotent re-issue: additional notices can be logged after the stage has
// already advanced past Eligible). Actually delivers the WhatsApp message
// (best-effort — a delivery failure never blocks logging the notice, same
// rule as notifyCustomer elsewhere).
func (s *Service) IssueAuctionNotice(ctx context.Context, loanID uint, branchID *uint, remarks string, actorID *uint, actorRole string, actorRoleID uint) (*AuctionRecord, error) {
	if !s.checkStagePermission(ctx, actorRoleID, "can issue auction notice") {
		return nil, ErrAuctionStepNotPermitted
	}
	if err := s.checkLoanBranch(ctx, loanID, branchID); err != nil {
		return nil, err
	}
	rec, err := s.getAuctionRecord(ctx, loanID)
	if err != nil {
		return nil, err
	}
	if rec.Stage == AuctionStageAuctioned || rec.Stage == AuctionStageSettled {
		return nil, ErrAuctionWrongStage
	}
	// Do not escalate pressure on a customer whose payment is under review.
	if err := s.requireNoPendingDecision(ctx, rec.ID); err != nil {
		return nil, err
	}

	l, err := s.repo.FindByID(ctx, loanID)
	if err != nil {
		return nil, ErrNotFound
	}

	for _, method := range auctionNoticeChannels {
		if err := s.auctionRepo.CreateNotice(ctx, &AuctionNotice{
			AuctionRecordID: rec.ID,
			IssuedAt:        time.Now(),
			Method:          method,
			Remarks:         remarks,
		}); err != nil {
			return nil, err
		}
		if method == "WhatsApp" {
			s.notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Auction Notice", fmt.Sprintf(
				"Dear %s, your gold loan %s is overdue and has been marked for auction. Please contact the branch immediately to settle dues and avoid losing your pledged items.",
				l.Customer.Name, l.LoanNumber,
			), commlog.TriggerAuctionNotice, "auction_record", rec.ID)
		}
	}

	if rec.Stage == AuctionStageEligible {
		rec.Stage = AuctionStageNotice
		if err := s.auctionRepo.Update(ctx, rec); err != nil {
			return nil, err
		}
	}
	s.recordAuctionEvent(ctx, nil, rec.ID, AuctionEventNoticeIssued, actorID, actorRole, remarks)
	return s.getAuctionRecord(ctx, loanID)
}

// ScheduleAuction records the actual auction date/reference and advances
// the case to AuctionScheduled. Requires at least one notice to have been
// issued first.
func (s *Service) ScheduleAuction(ctx context.Context, loanID uint, branchID *uint, date time.Time, referenceNumber string, actorID *uint, actorRole string, actorRoleID uint) (*AuctionRecord, error) {
	if !s.checkStagePermission(ctx, actorRoleID, "can schedule auction") {
		return nil, ErrAuctionStepNotPermitted
	}
	if err := s.checkLoanBranch(ctx, loanID, branchID); err != nil {
		return nil, err
	}
	rec, err := s.getAuctionRecord(ctx, loanID)
	if err != nil {
		return nil, err
	}
	if rec.Stage != AuctionStageNotice {
		return nil, ErrAuctionWrongStage
	}
	// Never fix a sale date for gold whose repayment is still being reviewed.
	if err := s.requireNoPendingDecision(ctx, rec.ID); err != nil {
		return nil, err
	}
	rec.AuctionDate = &date
	rec.AuctionReferenceNumber = referenceNumber
	rec.Stage = AuctionStageScheduled
	if err := s.auctionRepo.Update(ctx, rec); err != nil {
		return nil, err
	}

	s.recordAuctionEvent(ctx, nil, rec.ID, AuctionEventScheduled, actorID, actorRole,
		fmt.Sprintf("Auction scheduled for %s (ref %s)", date.Format("02-Jan-2006"), referenceNumber))
	if l, err := s.repo.FindByID(ctx, loanID); err == nil {
		s.notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Auction Scheduled", s.brandedMessage(ctx,
			"Dear %s, the auction of the gold pledged against loan %s has been scheduled for %s (ref %s). You may still settle the outstanding dues before this date to reclaim your items. — CloudHouse Finance",
			l.Customer.Name, l.LoanNumber, date.Format("02-Jan-2006"), referenceNumber,
		), commlog.TriggerAuctionEvent, "auction_record", rec.ID)
	}
	return s.getAuctionRecord(ctx, loanID)
}

// RecordAuctionSale records what the gold actually sold for and what it cost
// to run the auction, then makes that money REAL:
//
//  1. The net proceeds are booked as a cash-in movement. Previously the sale
//     amount was captured and then thrown away — the branch received money
//     that never appeared anywhere in the books.
//  2. The proceeds are applied against the debt through the ordinary payment
//     waterfall (fee → penal → interest → principal) and logged as a ledger
//     entry, instead of the balance simply being forced to zero.
//  3. What happens next depends on whether the sale actually covered the debt:
//     - Covered it: the loan closes, and any excess is recorded as a surplus
//     payable to the customer, awaiting an explicit disposition decision.
//     - Did not cover it: the loan does NOT close. It moves to
//     StatusAuctionedBalanceDue with the real remaining balance intact, and a
//     Shortfall escalation is raised for Branch Manager/Management to decide
//     whether to write the balance off or pursue it. The old code closed such
//     loans anyway, silently erasing money the customer still owed.
//
// Runs in a transaction: the cash movement, ledger entry, balance change,
// case update and escalation must all land together, or a failure part-way
// could leave gold sold with no record of the proceeds.
func (s *Service) RecordAuctionSale(ctx context.Context, loanID uint, branchID *uint, saleAmount, expenses float64, actorID *uint, actorRole string, actorRoleID uint) (*AuctionRecord, error) {
	if !s.checkStagePermission(ctx, actorRoleID, "can record auction sale") {
		return nil, ErrAuctionStepNotPermitted
	}
	if saleAmount <= 0 {
		return nil, ErrInvalidAmount
	}
	if expenses < 0 {
		return nil, ErrInvalidAmount
	}
	rec, err := s.getAuctionRecord(ctx, loanID)
	if err != nil {
		return nil, err
	}
	if rec.Stage != AuctionStageScheduled {
		return nil, ErrAuctionWrongStage
	}
	// The decisive guard: gold must never be sold while a repayment decision
	// is outstanding.
	if err := s.requireNoPendingDecision(ctx, rec.ID); err != nil {
		return nil, err
	}
	// autoPursue: the tenant switched the shortfall decision stage off, so a
	// shortfall is pursued automatically instead of escalated.
	shortfallChain, err := s.chain(ctx, workflow.FlowAuctionShortfall)
	if err != nil {
		return nil, err
	}
	autoPursue := shortfallChain.Off()
	l, err := s.repo.FindByID(ctx, loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, ErrNotFound
	}

	// Bring interest up to date first so the debt being compared against the
	// proceeds is the real, current figure.
	s.accrueAndSave(ctx, l)
	s.enrich(ctx, l)

	saleAmount = platform.RoundMoney(saleAmount)
	expenses = platform.RoundMoney(expenses)
	netProceeds := platform.RoundMoney(saleAmount - expenses)
	totalDebt := platform.RoundMoney(l.TotalOutstandingBalance)
	fullyCovered := netProceeds >= totalDebt-0.01

	// Only the portion that can actually settle debt goes through the
	// waterfall; anything beyond that is the customer's surplus, handled
	// separately so it is never quietly absorbed as if it paid something.
	applied := netProceeds
	if applied > totalDebt {
		applied = totalDebt
	}

	auctionDate := time.Now()
	var payment *LoanPayment

	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if applied > 0 {
			fee, penal, interest, principal, err := allocatePayment(l, PaymentTypeAuctionSale, applied, nil)
			if err != nil {
				return err
			}
			l.OutstandingProcessingFee = platform.RoundMoney(math.Max(0, l.OutstandingProcessingFee-fee))
			l.PenalInterestPaid = platform.RoundMoney(l.PenalInterestPaid + penal)
			l.InterestPaid = platform.RoundMoney(l.InterestPaid + interest)
			l.OutstandingAmount = platform.RoundMoney(math.Max(0, l.OutstandingAmount-principal))

			outstandingInterest := l.AccruedInterest - l.InterestPaid
			outstandingPenal := l.AccruedPenalInterest - l.PenalInterestPaid
			payment = &LoanPayment{
				LoanID:               loanID,
				Amount:               applied,
				Type:                 PaymentTypeAuctionSale,
				PaidOn:               auctionDate,
				ReceivedByEmployeeID: actorID,
				Method:               "Auction",
				Reference:            rec.AuctionReferenceNumber,
				Description:          fmt.Sprintf("Auction proceeds applied (sale ₹%.2f less expenses ₹%.2f)", saleAmount, expenses),
				ProcessingFeeApplied: fee,
				PenalInterestApplied: penal,
				InterestApplied:      interest,
				PrincipalApplied:     principal,
				RunningBalance: platform.RoundMoney(l.OutstandingAmount +
					math.Max(0, outstandingInterest) + math.Max(0, outstandingPenal) + l.OutstandingProcessingFee),
			}
			if err := tx.Create(payment).Error; err != nil {
				return err
			}
		}

		rec.SaleAmount = saleAmount
		rec.AuctionExpenses = expenses
		// Kept as the informational snapshot it always was: positive = surplus
		// owed to the customer, negative = shortfall still unrecovered.
		rec.SurplusShortfall = platform.RoundMoney(netProceeds - totalDebt)
		rec.SurplusPayableAmount = platform.RoundMoney(math.Max(0, netProceeds-totalDebt))
		if fullyCovered && rec.SurplusPayableAmount <= 0.01 {
			// The sale exactly covered the debt — there is no surplus decision
			// left for a Branch Manager to make (SettleAuction actively refuses
			// to run with nothing to dispose of, see ErrNoSurplusToDispose), so
			// staying at "Auctioned" would leave this case with no action ever
			// available to move it into history. Settle it immediately: nothing
			// is owed to the customer, and the full proceeds already covered
			// the loan co's own debt, matching AuctionSurplusRecordedAsIncome's
			// FinalSettlementStatus for the same "no money changes hands" case.
			rec.FinalSettlementStatus = AuctionSettlementSettledToLoanCo
			rec.Stage = AuctionStageSettled
		} else {
			rec.Stage = AuctionStageAuctioned
		}
		if err := s.auctionRepo.UpdateTx(ctx, tx, rec); err != nil {
			return err
		}

		l.AuctionDate = &auctionDate
		l.AuctionAmount = &saleAmount
		if fullyCovered {
			// StatusAuctioned, not StatusClosed — the gold was sold, not
			// released back to the customer, and the rest of the codebase
			// already treats the two as distinct terminal states (see
			// bankPledgeIneligibleStatuses and isTerminalStatus's own
			// separate StatusAuctioned branch).
			l.Status = StatusAuctioned
		} else {
			// Deliberately NOT Closed: real money is still owed. Accrual is
			// frozen in this state (see StatusAuctionedBalanceDue) so the
			// manager decides against a stable figure.
			l.Status = StatusAuctionedBalanceDue
		}
		if err := tx.Save(l).Error; err != nil {
			return err
		}

		if !fullyCovered && autoPursue {
			// No shortfall decision stage for this tenant: the balance is
			// pursued automatically — the same effect as a PursueBalance
			// decision (see ResolveAuctionDecision), recorded as decided.
			shortfall := platform.RoundMoney(totalDebt - netProceeds)
			rec.Stage = AuctionStageWithdrawn
			if err := s.auctionRepo.UpdateTx(ctx, tx, rec); err != nil {
				return err
			}
			l.Status = StatusOverdue
			if err := tx.Save(l).Error; err != nil {
				return err
			}
			now := time.Now()
			if err := s.auctionRepo.CreateDecision(ctx, tx, &AuctionDecisionRequest{
				AuctionRecordID:      rec.ID,
				LoanID:               loanID,
				Kind:                 AuctionDecisionKindShortfall,
				AmountPaid:           netProceeds,
				OutstandingAtRequest: shortfall,
				Status:               AuctionDecisionPursueBalance,
				DecidedByRole:        "System",
				DecisionRemarks:      "No approval configured — balance pursued automatically",
				DecidedAt:            &now,
			}); err != nil {
				return err
			}
		} else if !fullyCovered {
			shortfall := platform.RoundMoney(totalDebt - netProceeds)
			if err := s.auctionRepo.CreateDecision(ctx, tx, &AuctionDecisionRequest{
				AuctionRecordID:      rec.ID,
				LoanID:               loanID,
				Kind:                 AuctionDecisionKindShortfall,
				AmountPaid:           netProceeds,
				OutstandingAtRequest: shortfall,
				Status:               AuctionDecisionPending,
			}); err != nil {
				return err
			}
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}

	// Cash, packet and notifications sit outside the transaction because all
	// three are external side effects that must not be able to roll back a
	// completed, already-consistent sale — the same log-and-continue rule
	// the rest of this service applies to cash and WhatsApp.
	if s.cashRecorder != nil {
		if _, err := s.cashRecorder.RecordAuctionSaleCashIn(ctx, loanID, l.LoanNumber, netProceeds, l.BranchID, auctionDate); err != nil {
			log.Printf("cash-in movement (auction sale) failed for loan %d: %v", loanID, err)
		}
	}
	if s.packetMover != nil {
		if err := s.packetMover.RecordGoldReleaseMovement(ctx, loanID, fmt.Sprintf("Auction sale — sold for ₹%.2f", saleAmount)); err != nil {
			log.Printf("packet movement (auction sale) failed for loan %d: %v", loanID, err)
		}
	}

	s.recordAuctionEvent(ctx, nil, rec.ID, AuctionEventSaleRecorded, actorID, actorRole, fmt.Sprintf(
		"Sold for ₹%.2f, expenses ₹%.2f, net ₹%.2f applied against debt of ₹%.2f", saleAmount, expenses, netProceeds, totalDebt))

	if fullyCovered {
		surplusNote := ""
		if rec.SurplusPayableAmount > 0.01 {
			surplusNote = fmt.Sprintf(" A surplus of ₹%.2f is due back to you — the branch will contact you regarding this.", rec.SurplusPayableAmount)
		}
		s.notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Auction Settled", s.brandedMessage(ctx,
			"Dear %s, the gold pledged against loan %s was auctioned on %s for ₹%.2f. Your loan is now fully settled and closed.%s — CloudHouse Finance",
			l.Customer.Name, l.LoanNumber, auctionDate.Format("02-Jan-2006"), saleAmount, surplusNote,
		), commlog.TriggerAuctionEvent, "auction_record", rec.ID)
	} else if autoPursue {
		shortfall := platform.RoundMoney(totalDebt - netProceeds)
		s.recordAuctionEvent(ctx, nil, rec.ID, AuctionEventDecisionPursue, nil, "System", fmt.Sprintf(
			"Auction proceeds fell short by ₹%.2f — balance pursued automatically (no shortfall decision stage configured)", shortfall))
		s.notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Auction Shortfall", s.brandedMessage(ctx,
			"Dear %s, the auction of your pledged gold under loan %s did not clear the full amount due. A balance of ₹%.2f remains payable and will continue to accrue interest. Please contact the branch to arrange settlement. — CloudHouse Finance",
			l.Customer.Name, l.LoanNumber, shortfall,
		), commlog.TriggerAuctionEvent, "auction_record", rec.ID)
	} else {
		s.recordAuctionEvent(ctx, nil, rec.ID, AuctionEventShortfallEscalated, actorID, actorRole, fmt.Sprintf(
			"Auction proceeds fell short by ₹%.2f — escalated for a write-off/pursue decision", platform.RoundMoney(totalDebt-netProceeds)))
		s.notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Auction Shortfall", s.brandedMessage(ctx,
			"Dear %s, the gold pledged against loan %s was auctioned on %s for ₹%.2f, which did not cover the full amount due. A balance of ₹%.2f remains and is under review by our management. We will inform you of the outcome. — CloudHouse Finance",
			l.Customer.Name, l.LoanNumber, auctionDate.Format("02-Jan-2006"), saleAmount, platform.RoundMoney(totalDebt-netProceeds),
		), commlog.TriggerAuctionEvent, "auction_record", rec.ID)
	}

	return s.getAuctionRecord(ctx, loanID)
}

// derefUint safely unwraps an optional employee ID for fields that require a
// concrete value; 0 means "system", matching how the rest of the codebase
// treats an absent actor.
func derefUint(p *uint) uint {
	if p == nil {
		return 0
	}
	return *p
}

// SettleAuction disposes of a surplus and closes the case out. It is only
// reachable when the auction fully covered the debt: a sale that left money
// owing goes through the Shortfall decision instead (see
// ResolveAuctionDecision), which is why StatusAuctionedBalanceDue is rejected
// here rather than being quietly settled.
//
// The disposition must be chosen explicitly — the surplus is the customer's
// money, so where it went is recorded as a decision, not a default:
//   - RefundedToCustomer books a real cash-out and links the movement.
//   - RecordedAsIncome books no cash-out, because the full net proceeds
//     already entered the till at sale time; booking another movement would
//     count the same rupees twice.
//
// A disposition can only be set once, so a surplus can never be paid out
// twice.
func (s *Service) SettleAuction(ctx context.Context, loanID uint, branchID *uint, disposition, remarks string, actorID *uint, actorRole string, actorRoleID uint) (*AuctionRecord, error) {
	if !s.checkStagePermission(ctx, actorRoleID, "can settle auction") {
		return nil, ErrAuctionStepNotPermitted
	}
	switch disposition {
	case AuctionSurplusRefundedToCustomer, AuctionSurplusRecordedAsIncome:
	default:
		return nil, ErrInvalidSurplusDisposition
	}
	if disposition == AuctionSurplusRecordedAsIncome && strings.TrimSpace(remarks) == "" {
		// Retaining a customer's surplus is the kind of decision that must
		// carry a stated reason.
		return nil, ErrSettlementRemarksRequired
	}
	l, err := s.repo.FindByID(ctx, loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, ErrNotFound
	}
	rec, err := s.getAuctionRecord(ctx, loanID)
	if err != nil {
		// getAuctionRecord's FindActiveByLoanID excludes Settled/Withdrawn
		// cases outright (see that repository method's own doc comment), so
		// a loan whose auction case ALREADY settled looks identical to one
		// that never had a case at all — both fail the active lookup and,
		// without this fallback, both surfaced the same misleading
		// ErrAuctionNotFound ("mark it auction-eligible first") even when
		// the sale had genuinely already gone through and the surplus
		// already disposed of. A stale client screen re-submitting Settle
		// after its first click already succeeded is exactly when this
		// fires: history still finds the just-concluded record, so the
		// error now names what actually happened.
		if hist, histErr := s.auctionRepo.FindHistoryByLoanID(ctx, loanID); histErr == nil {
			for _, h := range hist {
				if h.Stage == AuctionStageSettled {
					return nil, ErrAuctionAlreadyConcluded
				}
			}
		}
		return nil, err
	}
	if rec.Stage != AuctionStageAuctioned {
		return nil, ErrAuctionWrongStage
	}
	if l.Status == StatusAuctionedBalanceDue {
		return nil, ErrAuctionBalanceDueCannotSettle
	}
	if rec.SurplusPayableAmount <= 0.01 {
		return nil, ErrNoSurplusToDispose
	}
	if rec.SurplusDisposition != "" || rec.SurplusPaidOutMovementID != nil {
		return nil, ErrSurplusAlreadyDisposed
	}

	now := time.Now()
	if disposition == AuctionSurplusRefundedToCustomer && s.cashRecorder != nil {
		movementID, err := s.cashRecorder.RecordAuctionSurplusCashOut(ctx, loanID, l.LoanNumber, rec.SurplusPayableAmount, l.BranchID, now)
		if err != nil {
			return nil, fmt.Errorf("could not record the surplus refund in Cash-in-Hand, settlement not saved: %w", err)
		}
		rec.SurplusPaidOutMovementID = &movementID
	}

	rec.SurplusDisposition = disposition
	if disposition == AuctionSurplusRefundedToCustomer {
		rec.FinalSettlementStatus = AuctionSettlementSettledToCustomer
	} else {
		rec.FinalSettlementStatus = AuctionSettlementSettledToLoanCo
	}
	rec.Stage = AuctionStageSettled
	if err := s.auctionRepo.Update(ctx, rec); err != nil {
		s.undoCashMovement(ctx, rec.SurplusPaidOutMovementID)
		return nil, err
	}

	s.recordAuctionEvent(ctx, nil, rec.ID, AuctionEventSettled, actorID, actorRole, fmt.Sprintf(
		"Surplus ₹%.2f — %s. %s", rec.SurplusPayableAmount, disposition, remarks))

	if disposition == AuctionSurplusRefundedToCustomer {
		s.notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Auction Surplus Refund", s.brandedMessage(ctx,
			"Dear %s, the surplus of ₹%.2f from the auction of loan %s is being refunded to you. Please visit the branch to collect it. — CloudHouse Finance",
			l.Customer.Name, rec.SurplusPayableAmount, l.LoanNumber,
		), commlog.TriggerAuctionEvent, "auction_record", rec.ID)
	} else {
		s.notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Auction Settled", s.brandedMessage(ctx,
			"Dear %s, the auction settlement for loan %s is now complete and the loan is closed. — CloudHouse Finance",
			l.Customer.Name, l.LoanNumber,
		), commlog.TriggerAuctionEvent, "auction_record", rec.ID)
	}

	// rec is already fully updated (Stage=Settled, disposition, in-memory)
	// and saved above — NOT re-fetched via getAuctionRecord, which would
	// immediately fail: its FindActiveByLoanID excludes Settled/Withdrawn
	// records outright (see that repository method's own doc comment), so
	// calling it here on the record THIS SAME FUNCTION just settled always
	// returned ErrAuctionNotFound (mapped to a 404) even on a fully
	// successful settle — the settle itself went through (Stage, event, and
	// notification all already committed above), but the response looked
	// like a failure and the caller never received the updated record.
	return rec, nil
}

// ResolveAuctionDecision records a human decision on an escalation and applies
// its consequences. Both kinds of escalation share this one entry point, with
// the legal outcomes validated per kind:
//
//	PartialRepayment → KeepInAuction | RemovedFromAuction
//	Shortfall        → PursueBalance | WriteOff
//
// The most consequential branch is Shortfall/PursueBalance: it returns the loan
// to Overdue, which is what resumes interest accrual through the ordinary path
// (projectAccrual only accrues for Active/DueSoon/Overdue). While the decision
// was pending the balance sat frozen at StatusAuctionedBalanceDue, so the
// decision-maker judged a stable figure rather than a moving one.
func (s *Service) ResolveAuctionDecision(ctx context.Context, loanID, requestID uint, branchID *uint, decision, remarks string, actorID *uint, actorRole string, actorRoleID uint) (*AuctionRecord, error) {
	l, err := s.repo.FindByID(ctx, loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, ErrNotFound
	}

	var (
		notifyMsg    string
		auctionRecID uint
	)

	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		req, err := s.auctionRepo.FindDecisionByID(ctx, tx, requestID)
		if err != nil {
			// Only a genuinely missing row reads as "not found". Translating
			// every error hid a real fault (a tenant-scope failure) behind a
			// message that sent staff looking for a vanished request.
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrAuctionDecisionNotFound
			}
			return err
		}
		if req.LoanID != loanID {
			return ErrAuctionDecisionNotFound
		}
		if req.Status != AuctionDecisionPending {
			return ErrAuctionDecisionAlreadyDecided
		}
		auctionRecID = req.AuctionRecordID

		rec, err := s.auctionRepo.FindActiveByLoanIDForUpdate(ctx, tx, loanID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrAuctionNotFound
			}
			return err
		}

		now := time.Now()
		req.Status = decision
		req.DecidedByEmployeeID = actorID
		req.DecidedByRole = actorRole
		req.DecisionRemarks = remarks
		req.DecidedAt = &now

		switch req.Kind {
		case AuctionDecisionKindPartialRepayment:
			if !s.canDecideAuction(ctx, actorRoleID, workflow.FlowAuctionPartialRepayment) {
				return ErrPartialRepaymentAuthority
			}
			switch decision {
			case AuctionDecisionKeepInAuction:
				// Case simply un-freezes and continues from its current stage.
				s.recordAuctionEvent(ctx, tx, rec.ID, AuctionEventDecisionKeep, actorID, actorRole, remarks)
				notifyMsg = s.brandedMessage(ctx,
					"Dear %s, following review of your recent payment, loan %s remains scheduled for auction as a balance of ₹%.2f is still outstanding. Please contact the branch urgently. — CloudHouse Finance",
					l.Customer.Name, l.LoanNumber, req.OutstandingAtRequest,
				)
			case AuctionDecisionRemovedFromAuction:
				rec.Stage = AuctionStageWithdrawn
				if err := s.auctionRepo.UpdateTx(ctx, tx, rec); err != nil {
					return err
				}
				// Back to a normal collection status. A fresh default later can
				// open a brand-new auction case (the partial unique index only
				// restricts ACTIVE cases).
				l.Status = normalStatusFor(l, now)
				if err := tx.Save(l).Error; err != nil {
					return err
				}
				s.recordAuctionEvent(ctx, tx, rec.ID, AuctionEventDecisionRemove, actorID, actorRole, remarks)
				notifyMsg = s.brandedMessage(ctx,
					"Dear %s, following your recent payment, loan %s has been removed from auction and your pledged gold is no longer at risk. A balance of ₹%.2f remains payable. — CloudHouse Finance",
					l.Customer.Name, l.LoanNumber, req.OutstandingAtRequest,
				)
			default:
				return ErrInvalidAuctionDecision
			}

		case AuctionDecisionKindShortfall:
			if !s.canDecideAuction(ctx, actorRoleID, workflow.FlowAuctionShortfall) {
				return ErrShortfallAuthorityRequired
			}
			if strings.TrimSpace(remarks) == "" {
				return ErrDecisionRemarksRequired
			}
			switch decision {
			case AuctionDecisionPursueBalance:
				// Overdue is what resumes accrual and normal collection — see
				// this function's doc comment. The case itself is done with
				// the auction pipeline (same as AuctionDecisionRemovedFromAuction
				// above) — leaving rec.Stage at Auctioned forever made this
				// record permanently invisible to FindAllConcluded's
				// Stage IN (Settled, Withdrawn) filter, so it never showed up
				// in the Auction History tab even though the case was fully
				// decided. FinalSettlementStatus stays Pending: the balance is
				// still owed, not settled or written off.
				rec.Stage = AuctionStageWithdrawn
				if err := s.auctionRepo.UpdateTx(ctx, tx, rec); err != nil {
					return err
				}
				l.Status = StatusOverdue
				if err := tx.Save(l).Error; err != nil {
					return err
				}
				s.recordAuctionEvent(ctx, tx, rec.ID, AuctionEventDecisionPursue, actorID, actorRole, remarks)
				notifyMsg = s.brandedMessage(ctx,
					"Dear %s, the auction of your pledged gold under loan %s did not clear the full amount due. A balance of ₹%.2f remains payable and will continue to accrue interest. Please contact the branch to arrange settlement. — CloudHouse Finance",
					l.Customer.Name, l.LoanNumber, req.OutstandingAtRequest,
				)

			case AuctionDecisionWriteOff:
				// Clear the remaining balance through the ordinary allocation
				// waterfall as a non-cash write-off, so the ledger shows the
				// forgiveness explicitly instead of the balance being zeroed
				// behind the scenes.
				s.enrich(ctx, l)
				owed := platform.RoundMoney(l.TotalOutstandingBalance)
				if owed > 0 {
					fee, penal, interest, principal, err := allocatePayment(l, PaymentTypeAuctionWriteOff, owed, nil)
					if err != nil {
						return err
					}
					l.OutstandingProcessingFee = platform.RoundMoney(math.Max(0, l.OutstandingProcessingFee-fee))
					l.PenalInterestPaid = platform.RoundMoney(l.PenalInterestPaid + penal)
					l.InterestPaid = platform.RoundMoney(l.InterestPaid + interest)
					l.OutstandingAmount = platform.RoundMoney(math.Max(0, l.OutstandingAmount-principal))

					if err := tx.Create(&LoanPayment{
						LoanID:               loanID,
						Amount:               owed,
						Type:                 PaymentTypeAuctionWriteOff,
						PaidOn:               now,
						ReceivedByEmployeeID: actorID,
						Method:               "Write-Off",
						Description:          "Post-auction shortfall written off by management: " + remarks,
						ProcessingFeeApplied: fee,
						PenalInterestApplied: penal,
						InterestApplied:      interest,
						PrincipalApplied:     principal,
						RunningBalance:       0,
					}).Error; err != nil {
						return err
					}
				}
				l.Status = StatusClosed
				if err := tx.Save(l).Error; err != nil {
					return err
				}
				rec.Stage = AuctionStageSettled
				rec.FinalSettlementStatus = AuctionSettlementWrittenOff
				if err := s.auctionRepo.UpdateTx(ctx, tx, rec); err != nil {
					return err
				}
				s.recordAuctionEvent(ctx, tx, rec.ID, AuctionEventDecisionWriteOff, actorID, actorRole,
					fmt.Sprintf("Shortfall of ₹%.2f written off: %s", owed, remarks))
				notifyMsg = s.brandedMessage(ctx,
					"Dear %s, the balance remaining on loan %s after auction has been waived and the loan is now closed. No further amount is payable. — CloudHouse Finance",
					l.Customer.Name, l.LoanNumber,
				)

			default:
				return ErrInvalidAuctionDecision
			}

		default:
			return ErrInvalidAuctionDecision
		}

		return s.auctionRepo.UpdateDecision(ctx, tx, req)
	})
	if txErr != nil {
		return nil, txErr
	}

	if notifyMsg != "" {
		s.notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Auction Decision", notifyMsg, commlog.TriggerAuctionEvent, "auction_record", auctionRecID)
	}

	// The case may now be concluded, in which case there is no active record to
	// return — fall back to its history entry so callers still see the outcome.
	if rec, err := s.auctionRepo.FindActiveByLoanID(ctx, loanID); err == nil {
		return rec, nil
	}
	if recs, err := s.auctionRepo.FindHistoryByLoanID(ctx, loanID); err == nil {
		for i := range recs {
			if recs[i].ID == auctionRecID {
				return &recs[i], nil
			}
		}
	}
	return nil, ErrAuctionNotFound
}

// normalStatusFor derives the status an open loan should carry based purely on
// its due date — used when a loan leaves the auction pipeline and has to rejoin
// ordinary collection. Mirrors the thresholds enrichStatusFlags applies to its
// read-time display flags (accrual.go), so a withdrawn loan lands on the same
// status it would have had if it had never been marked auction-eligible.
func normalStatusFor(l *Loan, asOf time.Time) string {
	if asOf.After(l.DueDate) {
		return StatusOverdue
	}
	if int(l.DueDate.Sub(asOf).Hours()/24) <= dueSoonWindowDays {
		return StatusDueSoon
	}
	return StatusActive
}

// --- Extension & release requests ------------------------------------------

// ExtensionRequestInput mirrors the body of POST /loans/:id/extension-request.
type ExtensionRequestInput struct {
	Months      int
	Detail      string
	RequestedBy string // "Customer" | "Staff"; defaults to "Staff" if empty
}

// CreateExtensionRequest logs a customer's ask to push a loan's due date
// out by Months. It does not itself change the loan — staff must Approve it
// via DecideRequest for the new due date to take effect.
func (s *Service) CreateExtensionRequest(ctx context.Context, loanID uint, in ExtensionRequestInput) (*LoanRequest, error) {
	l, err := s.repo.FindByID(ctx, loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if in.Months <= 0 {
		return nil, ErrInvalidMonths
	}
	if l.Status == StatusPendingApproval {
		return nil, ErrLoanAwaitingApproval
	}
	// Same "catch stale accrual up first" rationale as MarkAuctionEligible's
	// IsDefaulted check — without this, OutstandingInterest/
	// OutstandingPenalInterest below are judged against whatever the DB
	// happened to have from the last read path that persisted a fresh
	// accrual, not what's actually owed today.
	s.accrueAndSave(ctx, l)
	s.enrich(ctx, l)
	// The customer must clear the interest/penal-interest arrears currently
	// standing before an extension moves forward — extending the due date
	// on top of unpaid arrears would just let them compound further.
	// Principal not yet due is not a blocker here (same distinction
	// resolveAuctionAfterPayment draws): an extension is about arrears, not
	// the full balance.
	if l.OutstandingInterest > moneyEpsilon || l.OutstandingPenalInterest > moneyEpsilon {
		return nil, ErrExtensionNeedsPayment
	}
	requestedBy := in.RequestedBy
	if requestedBy == "" {
		requestedBy = RequestedByStaff
	}
	chain, err := s.chain(ctx, workflow.FlowLoanExtension)
	if err != nil {
		return nil, err
	}
	// With no extension stage switched on for this tenant the request is
	// approved on the spot — logged for the audit trail, then applied.
	first, needsApproval := chain.First()
	if !needsApproval && isLoanTerminal(l.Status) {
		return nil, ErrLoanTerminalState
	}
	months := in.Months
	req := &LoanRequest{
		LoanID:                   loanID,
		Type:                     RequestTypeExtension,
		Status:                   RequestStatusPending,
		RequestedBy:              requestedBy,
		Detail:                   in.Detail,
		RequestedExtensionMonths: &months,
		ApprovalStage:            first.Pending,
		RequestedAt:              time.Now(),
	}
	if err := s.requestRepo.Create(ctx, req); err != nil {
		return nil, err
	}
	if !needsApproval {
		if _, err := s.applyExtension(ctx, req, nil, "Auto-approved — no extension approval stages configured"); err != nil {
			return nil, err
		}
		if err := s.requestRepo.Update(ctx, req); err != nil {
			return nil, err
		}
		s.notifyExtensionApproved(ctx, l, req)
	}
	return s.requestRepo.FindByID(ctx, req.ID)
}

// applyExtension is an Extension request's final approval: it pushes the
// loan's DueDate out by the requested months and marks req Approved (the
// caller persists req). Shared by ApproveExtensionRequest's final stage and
// CreateExtensionRequest when the tenant has no extension stage enabled.
func (s *Service) applyExtension(ctx context.Context, req *LoanRequest, actorEmployeeID *uint, remarks string) (*Loan, error) {
	l, err := s.repo.FindByID(ctx, req.LoanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if isLoanTerminal(l.Status) {
		return nil, ErrLoanTerminalState
	}

	months := 0
	if req.RequestedExtensionMonths != nil {
		months = *req.RequestedExtensionMonths
	}
	newDue := l.DueDate.AddDate(0, months, 0)
	l.DueDate = newDue
	req.NewDueDate = &newDue
	// The due-soon/overdue check (CheckDueAndOverdueLoans) dedupes on
	// these two timestamps — a fresh due date means the customer hasn't
	// been reminded against it yet, so both must reset.
	l.DueSoonNotifiedAt = nil
	l.OverdueNotifiedAt = nil
	if _, err := s.recalculateAndSave(ctx, l); err != nil {
		return nil, err
	}

	req.ApprovalStage = ApprovalStageApproved
	req.Status = RequestStatusApproved
	now := time.Now()
	req.DecidedAt = &now
	req.DecidedByEmployeeID = actorEmployeeID
	req.Remarks = remarks
	return l, nil
}

// notifyExtensionApproved tells the customer an extension was fully approved.
func (s *Service) notifyExtensionApproved(ctx context.Context, l *Loan, req *LoanRequest) {
	s.notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Extension Approved", s.brandedMessage(ctx,
		"Dear %s, your extension request for loan %s has been fully approved. New due date: %s. — CloudHouse Finance",
		l.Customer.Name, l.LoanNumber, l.DueDate.Format("02-Jan-2006"),
	), commlog.TriggerExtensionRequest, "loan_request", req.ID)
}

// ReleaseRequestInput mirrors the body of POST /loans/:id/release-request.
type ReleaseRequestInput struct {
	Detail      string
	RequestedBy string // "Customer" | "Staff"; defaults to "Staff" if empty
	// OrnamentIDs selects which of the loan's currently-pledged ornaments
	// this request asks to release. Empty/omitted means "every ornament" —
	// the existing full-release behavior, completely unchanged. A non-empty
	// STRICT SUBSET makes this a Partial Ornament Release (IsPartial=true),
	// gated by partialReleaseRemaining below. Selecting every currently-
	// pledged ornament is also treated as a full release regardless of how
	// it was expressed (explicit full list or omitted) — see this func's
	// own comment on why.
	OrnamentIDs []uint
}

// CreateReleaseRequest logs a customer's ask to release gold back — either
// every currently-pledged ornament (full release, closing the loan once
// fully settled — unchanged from before Partial Ornament Release existed),
// or, via in.OrnamentIDs, a Partial Ornament Release of just some of them
// while the loan continues on the rest.
//
// IsPartial is always computed here, never client-supplied: selecting ALL
// currently-pledged ornaments (or omitting the selection) forces
// IsPartial=false unconditionally, because V_remain would otherwise be zero
// — meaningless as a partial-release computation, and this is exactly what
// a full release already is. This same rule is what makes a single-
// ornament loan work with no special-case code: selecting that one
// ornament is selecting 100%, so it always resolves to a full release.
//
// A genuine strict-subset selection no longer blocks CreateReleaseRequest
// itself on partialReleaseRemaining — a customer may ask for a partial
// release before paying anything down, and staff record that payment
// later from the release review screen. ApproveReleaseRequest re-runs the
// same collateral check (partialReleaseDrift, no buffer) at approval time
// and refuses with ErrDriftPaymentRequired until it is satisfied — that is
// now the sole enforcement point; this function only computes IsPartial.
func (s *Service) CreateReleaseRequest(ctx context.Context, loanID uint, in ReleaseRequestInput) (*LoanRequest, error) {
	l, err := s.Get(ctx, loanID, nil)
	if err != nil {
		return nil, ErrNotFound
	}
	if l.Status == StatusPendingApproval {
		return nil, ErrLoanAwaitingApproval
	}
	requestedBy := in.RequestedBy
	if requestedBy == "" {
		requestedBy = RequestedByStaff
	}

	// One pending release per loan: a second request (a double tap, or the
	// customer and staff apps at once) would ask for the same gold twice.
	pending, _, err := s.requestRepo.FindAll(ctx, LoanRequestFilter{LoanID: loanID, Status: RequestStatusPending})
	if err != nil {
		return nil, err
	}
	for _, r := range pending {
		if r.Type == RequestTypeRelease {
			return nil, ErrReleaseAlreadyPending
		}
	}

	active := make([]Ornament, 0, len(l.Ornaments))
	for _, o := range l.Ornaments {
		if o.ReleasedAt == nil {
			active = append(active, o)
		}
	}

	isPartial := false
	var selectedIDs []uint
	if len(in.OrnamentIDs) > 0 && len(in.OrnamentIDs) < len(active) {
		activeByID := make(map[uint]Ornament, len(active))
		for _, o := range active {
			activeByID[o.ID] = o
		}
		selectedSet := make(map[uint]bool, len(in.OrnamentIDs))
		for _, id := range in.OrnamentIDs {
			if _, ok := activeByID[id]; !ok {
				// Not a currently-pledged ornament on THIS loan — either it
				// belongs to a different loan, doesn't exist, or has
				// already been released. Refusing outright is safer than
				// silently ignoring an ID that doesn't belong.
				return nil, ErrOrnamentNotFound
			}
			selectedSet[id] = true
		}
		selectedIDs = in.OrnamentIDs
		isPartial = true
	} else if len(in.OrnamentIDs) > 0 {
		// Every active ornament was selected (or more IDs than exist were
		// passed, which len(active) below would also have to satisfy) —
		// forced to a full release regardless of the LTV math; validate the
		// IDs belong to this loan for a clean error rather than silently
		// falling through.
		activeByID := make(map[uint]bool, len(active))
		for _, o := range active {
			activeByID[o.ID] = true
		}
		for _, id := range in.OrnamentIDs {
			if !activeByID[id] {
				return nil, ErrOrnamentNotFound
			}
		}
	}

	req := &LoanRequest{
		LoanID:      loanID,
		Type:        RequestTypeRelease,
		Status:      RequestStatusPending,
		RequestedBy: requestedBy,
		Detail:      in.Detail,
		IsPartial:   isPartial,
		RequestedAt: time.Now(),
	}
	if err := s.requestRepo.Create(ctx, req); err != nil {
		return nil, err
	}
	if isPartial {
		if err := s.requestRepo.CreateOrnamentSelections(ctx, req.ID, selectedIDs); err != nil {
			return nil, err
		}
	}
	return s.requestRepo.FindByID(ctx, req.ID)
}

func (s *Service) ListRequests(ctx context.Context, f LoanRequestFilter) ([]LoanRequest, int64, error) {
	reqs, total, err := s.requestRepo.FindAll(ctx, f)
	if err != nil {
		return nil, 0, err
	}
	return reqs, total, nil
}

// GetRequest fetches a single LoanRequest by ID — used by the generalized
// POST /loans/requests/:requestId/approve handler to read req.Type before
// dispatching to ApproveExtensionRequest or ApproveReleaseRequest.
func (s *Service) GetRequest(ctx context.Context, requestID uint) (*LoanRequest, error) {
	req, err := s.requestRepo.FindByID(ctx, requestID)
	if err != nil {
		return nil, ErrRequestNotFound
	}
	return req, nil
}

// DecideRequest is the RETIRED single-step decision path — Release requests
// never used it (ErrNotExtensionRequest), and Extension requests now go
// through the same staged Loan Officer -> Branch Manager -> Management
// approval chain as Release (see Service.ApproveExtensionRequest), so this
// now always returns ErrUseStagedExtensionApproval for Extension too. Kept
// (rather than deleted) as the clear, explicit error surface for old
// clients/routes that still call PUT /loans/requests/:requestId/decide.
func (s *Service) DecideRequest(ctx context.Context, requestID uint, branchID *uint, approve bool, decidedByEmployeeID uint, remarks string) (*LoanRequest, error) {
	req, err := s.requestRepo.FindByID(ctx, requestID)
	if err != nil {
		return nil, ErrRequestNotFound
	}
	if err := s.checkLoanBranch(ctx, req.LoanID, branchID); err != nil {
		return nil, err
	}
	if req.Type != RequestTypeExtension {
		return nil, ErrNotExtensionRequest
	}
	return nil, ErrUseStagedExtensionApproval
}

// isLoanTerminal reports whether a loan has already reached a state with
// nothing left to extend or release — Closed, Rejected, Auctioned, or Defaulted.
// Everything else (Overdue, Due Soon, Closure Requested, ...) is left to
// staff judgment, per the extension business rules.
func isLoanTerminal(status string) bool {
	return status == StatusClosed || status == StatusRejected || status == StatusAuctioned || status == StatusDefaulted
}

// ChecklistInput mirrors the body of PUT /loans/requests/:requestId/verify.
//
// PacketVerified/BankPledgeVerified/PaymentVerified are accepted but no
// longer applied — see LoanRequest's doc comment on why the checklist
// collapsed to CustomerSawGold/PaymentRecorded/Locked. Kept only so an old
// client sending them doesn't hit a binding error; VerifyReleaseChecklist
// simply ignores them now.
type ChecklistInput struct {
	CustomerSawGold    *bool
	PaymentVerified    *bool
	PacketVerified     *bool
	BankPledgeVerified *bool
	CustomerConfirmed  *bool
	VerificationNotes  *string
	Charges            *float64
	ActorRoleID        uint // authz.Role.ID — must hold "can verify release checklist"
}

// VerifyReleaseChecklist updates a pending Release request's reworked
// 2-item checklist. CustomerSawGold can be set freely while the request is
// Pending — this used to also require the loan's packet be at
// packet.StatusReadyForRelease (ErrPacketNotReadyForRelease), but that gate
// was removed: staff confirming the customer has seen the gold in person is
// itself the check, and the packet's own stage is tracked/enforced
// separately in internal/packet, not duplicated here. Can no longer be
// changed at all once the request is Locked (ErrRequestLocked) — see
// LoanRequest's own doc comment for why. Previously had no role gate at
// all; now requires "can verify release checklist" (see internal/authz.Catalogue).
func (s *Service) VerifyReleaseChecklist(ctx context.Context, requestID uint, branchID *uint, in ChecklistInput) (*LoanRequest, error) {
	req, err := s.requestRepo.FindByID(ctx, requestID)
	if err != nil {
		return nil, ErrRequestNotFound
	}
	if err := s.checkLoanBranch(ctx, req.LoanID, branchID); err != nil {
		return nil, err
	}
	if req.Type != RequestTypeRelease {
		return nil, ErrNotReleaseRequest
	}
	if req.Status != RequestStatusPending {
		return nil, ErrRequestAlreadyDecided
	}
	if !s.checkStagePermission(ctx, in.ActorRoleID, "can verify release checklist") {
		return nil, ErrWrongStage
	}

	if in.CustomerSawGold != nil {
		if req.Locked {
			return nil, ErrRequestLocked
		}
		req.CustomerSawGold = *in.CustomerSawGold
	}
	if in.VerificationNotes != nil {
		req.VerificationNotes = *in.VerificationNotes
	}
	if in.Charges != nil {
		req.Charges = *in.Charges
	}
	if req.ApprovalStage == "" {
		req.ApprovalStage = ApprovalStagePendingManager
	}

	if err := s.requestRepo.Update(ctx, req); err != nil {
		return nil, err
	}
	return s.requestRepo.FindByID(ctx, req.ID)
}

// ReleasePaymentInput mirrors the body of
// POST /loans/requests/:requestId/release-payment — the release review
// screen's "Record Payment" action, now a thin release-context wrapper
// around the SAME general RecordPayment/PaymentInput path used everywhere
// else on a loan (see RecordReleaseRequestPayment's own doc comment),
// rather than a bespoke Interest-only/Interest+Principal selector.
type ReleasePaymentInput struct {
	// Type is any of the ordinary PaymentType* values RecordPayment already
	// accepts (Interest, Principal, Partial, Full Settlement, ...) — the
	// same general payment modal used elsewhere on the loan, opened from
	// this release context. Defaults to PaymentTypePartial when empty, for
	// backward compatibility with callers still posting a bare
	// amount/discount pair the old way.
	Type   string
	Amount float64
	// Discount is a negotiated reduction posted alongside Amount as its own
	// PaymentTypeDiscount ledger entry — see allocatePayment's
	// PaymentTypeDiscount case. Independent of Type/Amount: either, both,
	// or neither may be set.
	Discount           float64
	CashAmount         float64
	UpiAmount          float64
	BankTransferAmount float64
	ChequeAmount       float64
	// BankID — see PaymentInput.BankID's own doc comment.
	BankID           *uint
	Method           string
	Reference        string
	InterestOverride *float64
	// DueDate is required only when Discount+Amount don't cover the final
	// settlement (see RecordReleaseRequestPayment).
	DueDate         *time.Time
	ActorEmployeeID uint
	ActorRoleID     uint // authz.Role.ID — must hold "can verify release checklist"
}

// RecordReleaseRequestPayment is the "Record Payment" step on the release
// review screen (see ReleasePaymentInput). It posts Discount (if any) as
// PaymentTypeDiscount, then Amount as whatever Type was given, through the
// exact same RecordPayment/allocatePayment waterfall as any other loan
// payment — no bespoke Interest-only/Interest+Principal selector.
//
// On success, called against a still-Pending release request: sets
// PaymentRecorded=true and Locked=true on the request (see LoanRequest's own
// doc comment on what Locked then blocks), then auto-advances the request
// one stage forward by running the exact same logic ApproveReleaseRequest's
// Manager stage performs — staff no longer click a separate "approve" action
// right after recording the triggering payment; recording it IS the
// forwarding action. This only fires the FIRST time a payment is recorded
// (PaymentRecorded still false coming in) — a later drift/top-up payment
// (ErrDriftPaymentRequired's remedy) reuses this same method but must NOT
// re-advance a request that has already moved past Manager, so the
// auto-advance is skipped whenever the request is already Locked.
//
// Only callable while the request is still at (or before) the Manager
// stage — see ErrNotManagerStage. Renamed from the old RecordReleasePayment:
// same route, same audit/DueDate mechanics, but driven by the general
// payment path instead of its own Interest/Principal split.
func (s *Service) RecordReleaseRequestPayment(ctx context.Context, requestID uint, branchID *uint, in ReleasePaymentInput) (*LoanRequest, error) {
	req, err := s.requestRepo.FindByID(ctx, requestID)
	if err != nil {
		return nil, ErrRequestNotFound
	}
	if err := s.checkLoanBranch(ctx, req.LoanID, branchID); err != nil {
		return nil, err
	}
	if req.Type != RequestTypeRelease {
		return nil, ErrNotReleaseRequest
	}
	if req.Status != RequestStatusPending {
		return nil, ErrRequestAlreadyDecided
	}
	// A drift/top-up payment (ErrDriftPaymentRequired's remedy) legitimately
	// arrives with ApprovalStage already advanced to a later approver step —
	// that IS the request being past the Manager stage, by design (see this
	// func's doc comment). Refusing it here would make ErrDriftPaymentRequired
	// unrecoverable: staff could never record the very payment the error
	// tells them to record. Only a Locked, IsPartial request gets this
	// exception; an ordinary (non-drift) attempt to pay past Manager stage
	// is still refused.
	pastManagerForDriftTopUp := req.IsPartial && req.Locked &&
		req.ApprovalStage != ApprovalStageApproved && req.ApprovalStage != ApprovalStageRejected
	if req.ApprovalStage != "" && req.ApprovalStage != ApprovalStagePendingManager && !pastManagerForDriftTopUp {
		return nil, ErrNotManagerStage
	}
	if !s.checkStagePermission(ctx, in.ActorRoleID, "can verify release checklist") {
		return nil, ErrWrongStage
	}
	if in.Discount < 0 || in.Amount < 0 {
		return nil, ErrInvalidAmount
	}

	// Charges (the staff-entered release charges override) is a real amount
	// owed on top of the loan's own outstanding balance, but it is never
	// itself part of that balance — allocatePayment's buckets only ever
	// track fee/penal/interest/principal. It is folded into the SAME
	// Payment call below as PaymentInput.ProcessingFee (the "charge it, then
	// let this same call collect it" mechanism ordinary loan payments
	// already use). chargeDelta (not the raw Charges total) is used so
	// re-recording after Charges was already added in a previous Save
	// Payment click never re-charges the same rupees twice.
	chargeDelta := platform.RoundMoney(req.Charges - req.ChargesApplied)
	if chargeDelta < 0 {
		chargeDelta = 0
	}

	wasAlreadyRecorded := req.PaymentRecorded

	if in.Discount > 0 {
		if _, err := s.RecordPayment(ctx, req.LoanID, PaymentInput{
			Amount:               in.Discount,
			Type:                 PaymentTypeDiscount,
			PaidOn:               time.Now(),
			ReceivedByEmployeeID: &in.ActorEmployeeID,
			Description:          "Release discount",
		}); err != nil {
			return nil, err
		}
	}

	paymentType := in.Type
	if paymentType == "" {
		paymentType = PaymentTypePartial
	}
	// Amount carries chargeDelta even when in.Amount is 0 — Charges must
	// still get billed and collected on its own if that's the only thing
	// left to settle this round (e.g. Discount alone already covered the
	// rest of the balance).
	paymentAmount := in.Amount
	if chargeDelta > 0.01 && paymentAmount <= 0 {
		paymentAmount = chargeDelta
	}
	if paymentAmount > 0 {
		if _, err := s.RecordPayment(ctx, req.LoanID, PaymentInput{
			Amount:               paymentAmount,
			Type:                 paymentType,
			ProcessingFee:        chargeDelta,
			PaidOn:               time.Now(),
			ReceivedByEmployeeID: &in.ActorEmployeeID,
			CashAmount:           in.CashAmount,
			UpiAmount:            in.UpiAmount,
			BankTransferAmount:   in.BankTransferAmount,
			ChequeAmount:         in.ChequeAmount,
			BankID:               in.BankID,
			Method:               in.Method,
			Reference:            in.Reference,
			InterestOverride:     in.InterestOverride,
			Description:          "Release payment",
		}); err != nil {
			return nil, err
		}
		req.ChargesApplied = platform.RoundMoney(req.ChargesApplied + chargeDelta)
	}

	l, err := s.Get(ctx, req.LoanID, branchID)
	if err != nil {
		return nil, err
	}

	req.RecordedDiscount = platform.RoundMoney(req.RecordedDiscount + in.Discount)
	req.RecordedPayment = platform.RoundMoney(req.RecordedPayment + in.Amount)

	if req.IsPartial {
		// PaymentDueDate exists to track a FULL release's final settlement
		// still falling short after a payment (see LoanRequest's own doc
		// comment) — a concept that doesn't apply to a Partial Ornament
		// Release at all. That release only concerns the ornaments being
		// selected out; the loan's overall TotalOutstandingBalance is
		// expected to stay positive regardless (the rest of the loan
		// continues on its own existing due date), so this check would
		// otherwise demand a due date on every partial-release payment
		// even when the minimum amount needed to release THOSE ornaments
		// (the "Remaining" figure on the request modal) has already been
		// fully covered.
		req.PaymentDueDate = nil
	} else if l.TotalOutstandingBalance <= 0.01 {
		req.PaymentDueDate = nil
	} else if in.Discount <= 0 && paymentAmount <= 0 {
		// Neither a discount nor a real payment was actually posted this
		// call (e.g. Charges alone, already fully applied) — nothing
		// changed, so there is nothing to flip PaymentRecorded/Locked over
		// and no new DueDate requirement either.
	} else if in.DueDate == nil {
		return nil, ErrDueDateRequired
	} else {
		req.PaymentDueDate = in.DueDate
	}

	req.PaymentRecorded = true
	req.Locked = true

	if err := s.requestRepo.Update(ctx, req); err != nil {
		return nil, err
	}

	// A request still at the pre-payment position was never advanced (e.g. a
	// drift error on the first attempt, possible when the tenant has no
	// later release stage and this advance is the final one), so a later
	// payment advances it too.
	stillAtPaymentStage := req.ApprovalStage == "" || req.ApprovalStage == ApprovalStagePendingManager
	if !wasAlreadyRecorded || stillAtPaymentStage {
		// Auto-advance one stage forward, exactly like ApproveReleaseRequest's
		// Manager-stage branch — this is the mechanism, not a second
		// approval action staff must separately click. Runs with the SAME
		// actor identity that recorded the payment; a top-up/drift payment
		// recorded later against an already-advanced request does not repeat this.
		if _, err := s.advanceReleaseRequestStage(ctx, req, in.ActorEmployeeID, "Auto-advanced after payment was recorded"); err != nil {
			return nil, err
		}
	}
	return s.requestRepo.FindByID(ctx, req.ID)
}

// ReleaseApprovalInput mirrors the body of POST /loans/requests/:requestId/approve.
type ReleaseApprovalInput struct {
	Stage           string // "Manager" | "Management" — must match the request's current ApprovalStage
	Action          string // "Approved" | "Rejected"
	ActorEmployeeID uint
	ActorRoleID     uint // authz.Role.ID — must hold "can approve release manager/management stage" for the current stage
	Remarks         string
}

// ApproveReleaseRequest advances (or terminates) a Release request's fixed
// 2-step Manager→Management chain — the exact same pattern as Loan.Approve,
// reused per the business decision that release approvals go through the
// same workflow as loan sanctioning. A Rejected action at either stage only
// rejects the request — the loan is untouched, and is refused outright with
// ErrRequestLocked once a payment has locked the request (see LoanRequest.
// Locked's doc comment). The final Approved action (Management stage)
// snapshots SettlementAmount = Loan.TotalOutstandingBalance + Charges and
// moves the loan to StatusClosureRequested (full release only — a Partial
// Ornament Release leaves the loan exactly as it is); CompleteRelease
// (below) does the actual hand-back.
func (s *Service) ApproveReleaseRequest(ctx context.Context, requestID uint, branchID *uint, in ReleaseApprovalInput) (*LoanRequest, error) {
	req, err := s.requestRepo.FindByID(ctx, requestID)
	if err != nil {
		return nil, ErrRequestNotFound
	}
	if err := s.checkLoanBranch(ctx, req.LoanID, branchID); err != nil {
		return nil, err
	}
	if req.Type != RequestTypeRelease {
		return nil, ErrNotReleaseRequest
	}
	if in.Action != ApprovalStageApproved && in.Action != ApprovalStageRejected {
		return nil, ErrInvalidAction
	}
	if req.ApprovalStage == ApprovalStageApproved || req.ApprovalStage == ApprovalStageRejected {
		return nil, ErrRequestAlreadyDecided
	}
	if in.Action == ApprovalStageRejected && req.Locked {
		return nil, ErrRequestLocked
	}
	// The checklist gates APPROVAL only. Rejecting is exactly what staff do
	// when the customer never came to see the gold or never paid, so
	// demanding a ticked checklist and a recorded payment first made a
	// rejection impossible in the very case it exists for.
	if in.Action == ApprovalStageApproved && !req.CustomerSawGold {
		return nil, ErrChecklistIncomplete
	}
	if in.Action == ApprovalStageApproved && !req.PaymentRecorded {
		// PaymentRecorded is ordinarily set by RecordReleaseRequestPayment,
		// tying a specific settlement figure to this request for the audit
		// trail. But a loan can also already satisfy the release's own
		// financial condition WITHOUT a payment ever run through that
		// request-linked endpoint — e.g. it was paid down by an ordinary
		// payment before the release was even requested, or via the Top-Up
		// Payment path (posted against the plain loan, not this request —
		// see ReleaseReviewModal.tsx's own comment on why). Forcing staff to
		// click Record Payment again in that case would either double-charge
		// or require recording a pointless ₹0 entry just to flip this flag.
		// Checked here, live, rather than trusting a stale req field: a full
		// release is satisfied once the loan's balance is actually cleared;
		// a partial release reuses the exact same drift check
		// ApprovalStagePendingManagement re-runs below.
		l, err := s.Get(ctx, req.LoanID, nil)
		if err != nil {
			return nil, err
		}
		conditionAlreadyMet := false
		if req.IsPartial {
			remainingGoldValue, gvErr := s.partialReleaseRemainingGoldValue(ctx, req)
			if gvErr == nil && partialReleaseDrift(l.TotalOutstandingBalance, remainingGoldValue, l.SchemeLTVPercent) <= 0.01 {
				conditionAlreadyMet = true
			}
		} else if l.TotalOutstandingBalance <= 0.01 {
			conditionAlreadyMet = true
		}
		if !conditionAlreadyMet {
			return nil, ErrChecklistIncomplete
		}
	}

	stage := req.ApprovalStage
	if stage == "" {
		stage = ApprovalStagePendingManager
	}
	chain, err := s.chain(ctx, workflow.FlowLoanRelease)
	if err != nil {
		return nil, err
	}
	step, ok := chain.ByPending(stage)
	if !ok || in.Stage != step.Key {
		return nil, ErrWrongStage
	}
	// Only the step's own role (or Administrator) may act on it.
	if !s.workflowSvc.CanAct(ctx, in.ActorRoleID, workflow.FlowLoanRelease, step.Key) {
		return nil, ErrWrongStage
	}

	audit := &RequestApproval{
		RequestID:       requestID,
		Stage:           in.Stage,
		Action:          in.Action,
		ActorEmployeeID: in.ActorEmployeeID,
		Remarks:         in.Remarks,
	}
	if err := s.requestApprovalRepo.Create(ctx, audit); err != nil {
		return nil, err
	}

	// Loaded once, up front, purely for notifications below — LoanRequest has
	// no CustomerID of its own (see model.go), only reachable via its parent
	// Loan.
	notifyLoan, _ := s.repo.FindByID(ctx, req.LoanID)

	if in.Action == ApprovalStageRejected {
		req.ApprovalStage = ApprovalStageRejected
		req.Status = RequestStatusRejected
		now := time.Now()
		req.DecidedAt = &now
		req.DecidedByEmployeeID = &in.ActorEmployeeID
		req.Remarks = in.Remarks
		if err := s.requestRepo.Update(ctx, req); err != nil {
			return nil, err
		}
		if notifyLoan != nil {
			s.notifyCustomer(ctx, notifyLoan.CustomerID, notifyLoan.Customer.Phone, "Release Rejected", s.brandedMessage(ctx,
				"Dear %s, your gold release request for loan %s has been rejected. Please contact the branch for details. — CloudHouse Finance",
				notifyLoan.Customer.Name, notifyLoan.LoanNumber,
			), commlog.TriggerReleaseRequest, "loan_request", req.ID)
		}
		return s.requestRepo.FindByID(ctx, req.ID)
	}

	return s.advanceReleaseRequestStage(ctx, req, in.ActorEmployeeID, in.Remarks)
}

// advanceReleaseRequestStage moves a Release request one step forward
// through its Manager→Management chain — Manager becomes pending
// Management, Management becomes the final Approved (which snapshots
// SettlementAmount and, for a full release, moves the loan to
// StatusClosureRequested before CompleteRelease hands the gold back).
//
// Shared by two callers: ApproveReleaseRequest's own explicit approval
// action, and RecordReleaseRequestPayment's auto-advance the moment the
// triggering payment is recorded (see that method's own doc comment on why
// staff no longer click a separate approval action right after paying) —
// both need the exact same stage-transition/settlement/CompleteRelease
// logic, just reached from a different trigger.
//
// For a Partial Ornament Release specifically, the final (Management) step
// re-checks partialReleaseDrift (no buffer) against the loan's LIVE balance:
// if drift has crept back above zero since the request was created (e.g.
// extra penal interest accrued while it sat waiting for approval), this
// refuses with ErrDriftPaymentRequired rather than proceeding — the caller
// records a top-up payment (through RecordReleaseRequestPayment again,
// still allowed while Locked) and retries. A full release keeps its
// existing "settle in full" gate untouched — CompleteRelease still enforces
// that on its own for a full release; only the partial path needs this
// extra drift check here, before the loan is ever touched.
func (s *Service) advanceReleaseRequestStage(ctx context.Context, req *LoanRequest, actorEmployeeID uint, remarks string) (*LoanRequest, error) {
	stage := req.ApprovalStage
	if stage == "" {
		stage = ApprovalStagePendingManager
	}
	// Snapshot of every field the Management branch below mutates, restored
	// if CompleteRelease then fails — see that branch's own comment on why
	// the Approved state must be persisted BEFORE CompleteRelease runs
	// (its own "not yet fully cleared" lookup needs to find it already
	// saved). Without this rollback, a CompleteRelease failure (e.g.
	// ErrBankPledgeStillActive — the bank pledge/locker was never actually
	// released before Management approved) left the request stuck Approved
	// in the DB while the caller only ever saw the returned error: the UI
	// never learned the new status (stayed open on stale "Pending" state),
	// and the request could never be approved again afterward
	// (ApproveReleaseRequest refuses an already-Approved request outright).
	preApprovalStage, preStatus := req.ApprovalStage, req.Status

	notifyLoan, _ := s.repo.FindByID(ctx, req.LoanID)

	// PendingManager doubles as the "awaiting payment" position (see
	// RecordReleaseRequestPayment), so a request can sit there even when the
	// tenant switched the Manager stage off; moving on always goes to the
	// next ENABLED stage, and with none left this step is the final one.
	chain, err := s.chain(ctx, workflow.FlowLoanRelease)
	if err != nil {
		return nil, err
	}
	// An empty chain resolves no stage: this advance is then the final one.
	cur, ok := chain.ByPending(stage)
	if !ok && !chain.Off() {
		return nil, ErrWrongStage
	}
	next, hasNext := chain.Next(cur.Key)

	finalApproval := false
	switch {
	case hasNext:
		req.ApprovalStage = next.Pending
	default:
		l, err := s.Get(ctx, req.LoanID, nil)
		if err != nil {
			return nil, err
		}

		if req.IsPartial {
			remainingGoldValue, err := s.partialReleaseRemainingGoldValue(ctx, req)
			if err != nil {
				return nil, err
			}
			drift := partialReleaseDrift(l.TotalOutstandingBalance, remainingGoldValue, l.SchemeLTVPercent)
			if drift > 0.01 {
				return nil, ErrDriftPaymentRequired
			}
		}

		req.ApprovalStage = ApprovalStageApproved
		finalApproval = true

		req.SettlementAmount = l.TotalOutstandingBalance + req.Charges
		if !req.IsPartial {
			l.Status = StatusClosureRequested
			if err := s.repo.Update(ctx, l); err != nil {
				return nil, err
			}
		}

		req.Status = RequestStatusApproved
		now := time.Now()
		req.DecidedAt = &now
		req.DecidedByEmployeeID = &actorEmployeeID
		req.Remarks = remarks

		// Persist the Approved state before CompleteRelease runs: when the
		// balance isn't already fully cleared (an early release, paid off
		// afterward per the settlement schedule), CompleteRelease's own
		// guard looks up an Approved release request for this loan — it
		// must already be saved as Approved for that lookup to succeed.
		if err := s.requestRepo.Update(ctx, req); err != nil {
			return nil, err
		}
		// Finish the release right here rather than leaving staff to find
		// and click a separate "Complete Release" action afterward —
		// Management approval was the last real decision point; once it's
		// given there is nothing left to authorize; see CompleteRelease's
		// own doc comment for what it still checks (bank pledge cleared,
		// balance settled for a full release) before it will actually hand
		// the gold back.
		if _, err := s.CompleteRelease(ctx, req.LoanID, nil, actorEmployeeID); err != nil {
			// Roll back the Approved state just persisted above — see this
			// function's own doc comment on preApprovalStage/preStatus for
			// why leaving it stuck Approved is worse than the extra write.
			req.ApprovalStage = preApprovalStage
			req.Status = preStatus
			req.DecidedAt = nil
			req.DecidedByEmployeeID = nil
			if rbErr := s.requestRepo.Update(ctx, req); rbErr != nil {
				log.Printf("could not roll back release request %d to %s after CompleteRelease failed: %v", req.ID, preStatus, rbErr)
			}
			return nil, err
		}
	}

	if err := s.requestRepo.Update(ctx, req); err != nil {
		return nil, err
	}
	if notifyLoan != nil {
		if finalApproval {
			s.notifyCustomer(ctx, notifyLoan.CustomerID, notifyLoan.Customer.Phone, "Release Approved", s.brandedMessage(ctx,
				"Dear %s, your gold release request for loan %s has been fully approved. Closure is now being processed. — CloudHouse Finance",
				notifyLoan.Customer.Name, notifyLoan.LoanNumber,
			), commlog.TriggerReleaseRequest, "loan_request", req.ID)
		} else {
			s.notifyCustomer(ctx, notifyLoan.CustomerID, notifyLoan.Customer.Phone, "Release Approved", s.brandedMessage(ctx,
				"Dear %s, your gold release request for loan %s has moved to the next approval stage (%s). — CloudHouse Finance",
				notifyLoan.Customer.Name, notifyLoan.LoanNumber, next.Label,
			), commlog.TriggerReleaseRequest, "loan_request", req.ID)
		}
	}
	return s.requestRepo.FindByID(ctx, req.ID)
}

// partialReleaseRemainingGoldValue re-derives V_remain (the combined
// GoldValue of whatever ornaments this Partial Ornament Release request
// would leave pledged) at the moment it is needed, rather than trusting a
// value snapshotted back at CreateReleaseRequest time — GoldValue itself can
// move between creation and approval (a new gold rate published in the
// meantime), so re-deriving keeps the drift check honest against the
// CURRENT numbers, not stale ones.
func (s *Service) partialReleaseRemainingGoldValue(ctx context.Context, req *LoanRequest) (float64, error) {
	all, err := s.ornamentRepo.FindAllByLoanID(ctx, req.LoanID)
	if err != nil {
		return 0, err
	}
	selected := make(map[uint]bool, len(req.OrnamentSelections))
	for _, sel := range req.OrnamentSelections {
		selected[sel.OrnamentID] = true
	}
	var remaining float64
	for _, o := range all {
		if o.ReleasedAt != nil {
			continue // already gone, contributes to neither side
		}
		if !selected[o.ID] {
			remaining += o.GoldValue
		}
	}
	return remaining, nil
}

// The Extension-request chain's stages live in workflow.Catalogue under
// workflow.FlowLoanExtension (stage key e.g. "LoanOfficer", stored as
// LoanRequest.ApprovalStage "PendingLoanOfficer"); which apply is per-tenant.

// ExtensionApprovalInput mirrors the body of
// POST /loans/requests/:requestId/approve for an Extension-type request.
type ExtensionApprovalInput struct {
	Stage           string // "LoanOfficer" | "BranchManager" | "Management" — must match the request's current ApprovalStage
	Action          string // "Approved" | "Rejected"
	ActorEmployeeID uint
	ActorRole       string // employee.ValidRoles value — audit-trail display only, not used for authorization any more
	ActorRoleID     uint   // authz.Role.ID — checked against extensionChain's required "Approval Workflow" permission
	Remarks         string
}

// ApproveExtensionRequest advances (or terminates) an Extension request's
// fixed 3-step Loan Officer -> Branch Manager -> Management chain — the same
// pattern as ApproveReleaseRequest/Loan.Approve, reused per the business
// decision that extension approvals go through a real, audited chain
// instead of DecideRequest's old single-step decision. A Rejected action at
// any stage only rejects the request — the loan is untouched. The final
// Approved action (Management stage) pushes the loan's DueDate out by the
// requested months, exactly like DecideRequest used to, and is blocked if
// the loan has already reached a terminal state (nothing left to extend).
func (s *Service) ApproveExtensionRequest(ctx context.Context, requestID uint, branchID *uint, in ExtensionApprovalInput) (*LoanRequest, error) {
	req, err := s.requestRepo.FindByID(ctx, requestID)
	if err != nil {
		return nil, ErrRequestNotFound
	}
	if err := s.checkLoanBranch(ctx, req.LoanID, branchID); err != nil {
		return nil, err
	}
	if req.Type != RequestTypeExtension {
		return nil, ErrNotExtensionRequest
	}
	if in.Action != ApprovalStageApproved && in.Action != ApprovalStageRejected {
		return nil, ErrInvalidAction
	}
	if req.ApprovalStage == ApprovalStageApproved || req.ApprovalStage == ApprovalStageRejected {
		return nil, ErrRequestAlreadyDecided
	}

	stage := req.ApprovalStage
	if stage == "" {
		stage = ApprovalStagePendingLoanOfficer
	}
	chain, err := s.chain(ctx, workflow.FlowLoanExtension)
	if err != nil {
		return nil, err
	}
	step, ok := chain.ByPending(stage)
	if !ok || in.Stage != step.Key {
		return nil, ErrWrongStage
	}
	if !s.workflowSvc.CanAct(ctx, in.ActorRoleID, workflow.FlowLoanExtension, step.Key) {
		return nil, ErrWrongStage
	}
	next, hasNext := chain.Next(step.Key)

	// Re-check the same arrears gate CreateExtensionRequest enforced at
	// request time — interest/penal interest keeps accruing while the
	// request sits in the approval chain, so a request that was clean when
	// raised can arrive at any stage with fresh arrears standing again. Only
	// gates Approved: rejecting a request must always go through regardless
	// of the loan's current arrears.
	if in.Action == ApprovalStageApproved {
		if l, err := s.repo.FindByID(ctx, req.LoanID); err == nil {
			s.accrueAndSave(ctx, l)
			s.enrich(ctx, l)
			if l.OutstandingInterest > moneyEpsilon || l.OutstandingPenalInterest > moneyEpsilon {
				return nil, ErrExtensionNeedsPayment
			}
		}
	}

	audit := &RequestApproval{
		RequestID:       requestID,
		Stage:           in.Stage,
		Action:          in.Action,
		ActorEmployeeID: in.ActorEmployeeID,
		Remarks:         in.Remarks,
	}
	if err := s.requestApprovalRepo.Create(ctx, audit); err != nil {
		return nil, err
	}

	// Loaded once, up front, purely for notifications below — LoanRequest has
	// no CustomerID of its own (see model.go), only reachable via its parent
	// Loan.
	notifyLoan, _ := s.repo.FindByID(ctx, req.LoanID)

	if in.Action == ApprovalStageRejected {
		req.ApprovalStage = ApprovalStageRejected
		req.Status = RequestStatusRejected
		now := time.Now()
		req.DecidedAt = &now
		req.DecidedByEmployeeID = &in.ActorEmployeeID
		req.Remarks = in.Remarks
		if err := s.requestRepo.Update(ctx, req); err != nil {
			return nil, err
		}
		if notifyLoan != nil {
			s.notifyCustomer(ctx, notifyLoan.CustomerID, notifyLoan.Customer.Phone, "Extension Rejected", s.brandedMessage(ctx,
				"Dear %s, your extension request for loan %s has been rejected. Please contact the branch for details. — CloudHouse Finance",
				notifyLoan.Customer.Name, notifyLoan.LoanNumber,
			), commlog.TriggerExtensionRequest, "loan_request", req.ID)
		}
		return s.requestRepo.FindByID(ctx, req.ID)
	}

	finalApproval := false
	var nextStageLabel string
	if hasNext {
		req.ApprovalStage = next.Pending
		nextStageLabel = next.Label
	} else {
		actor := in.ActorEmployeeID
		l, err := s.applyExtension(ctx, req, &actor, in.Remarks)
		if err != nil {
			return nil, err
		}
		finalApproval = true
		notifyLoan = l
	}

	if err := s.requestRepo.Update(ctx, req); err != nil {
		return nil, err
	}
	if notifyLoan != nil {
		if finalApproval {
			s.notifyExtensionApproved(ctx, notifyLoan, req)
		} else if nextStageLabel != "" {
			s.notifyCustomer(ctx, notifyLoan.CustomerID, notifyLoan.Customer.Phone, "Extension Approved", s.brandedMessage(ctx,
				"Dear %s, your extension request for loan %s has moved to the next approval stage (%s). — CloudHouse Finance",
				notifyLoan.Customer.Name, notifyLoan.LoanNumber, nextStageLabel,
			), commlog.TriggerExtensionRequest, "loan_request", req.ID)
		}
	}
	return s.requestRepo.FindByID(ctx, req.ID)
}

// CompleteRelease is the actual "hand the gold back" step — separate from
// approving the release request. Requires an Approved Release request for
// this loan and the bank pledge already released, if there was one.
//
// Branches on that request's IsPartial:
//
//   - Full release (IsPartial == false): completely unchanged from before
//     Partial Ornament Release existed — additionally requires the
//     settlement fully paid (TotalOutstandingBalance <= 0), moves the
//     packet through to Released, and closes the loan.
//   - Partial release (IsPartial == true): the "fully paid" guard is
//     skipped entirely — a Partial Ornament Release is already gated
//     upstream by partialReleaseRemaining (at creation) and
//     partialReleaseDrift (at final approval), which is a collateral-
//     coverage check, not a "balance must be zero" one; the loan is
//     expected to still carry a real outstanding balance on the ornaments
//     staying pledged. Only the SELECTED ornaments are marked Released,
//     the packet stays in its current stage (still holding the rest — see
//     RecordPartialGoldReleaseMovement), the loan's own Status is left
//     exactly as it was, and TotalNetWeight/TotalGoldValue/
//     EligibleLoanAmount are recomputed from what remains
//     (PrincipalAmount/OutstandingAmount untouched). Finishes by
//     generating the Partial Release Receipt in place of FORM 7.
func (s *Service) CompleteRelease(ctx context.Context, loanID uint, branchID *uint, employeeID uint) (*Loan, error) {
	l, err := s.Get(ctx, loanID, branchID)
	if err != nil {
		return nil, err
	}

	// Asks the pledge RECORDS, not just the loan-level string. The string is
	// a stored copy that can lie: a loan carrying two Active records (only
	// possible before RecordBankPledge's once-per-loan guard) has its string
	// set to "Released" the moment either one is released, which let a loan
	// be closed with a live ₹30k pledge still open against it. The string is
	// still checked first — it is the cheap path and covers the normal case.
	if l.BankPledgeStatus == BankPledgeStatusPledged {
		return nil, ErrBankPledgeStillActive
	}
	hasActivePledge, err := s.pledgeRepo.HasActive(ctx, loanID)
	if err != nil {
		return nil, err
	}
	if hasActivePledge {
		return nil, ErrBankPledgeStillActive
	}

	paidInFull := l.TotalOutstandingBalance <= 0.01

	// A loan that's already paid in full closes directly here — the
	// release-approval checklist (payment/packet/bank-pledge verification,
	// manager sign-off) exists to negotiate a discount/settlement BEFORE
	// the balance is cleared; once it's genuinely zero there's nothing left
	// for that workflow to decide, and gold has already been confirmed
	// returned by the pledge checks just above. Only a Partial Ornament
	// Release (which by definition leaves a real balance on the ornaments
	// staying pledged) or a not-yet-fully-paid settlement still requires an
	// approved release request.
	var approved *LoanRequest
	if !paidInFull {
		approved, err = s.requestRepo.FindApprovedReleaseByLoanID(ctx, loanID)
		if err != nil {
			return nil, ErrReleaseNotApproved
		}
	} else if a, err := s.requestRepo.FindApprovedReleaseByLoanID(ctx, loanID); err == nil {
		approved = a
	}

	if approved != nil && approved.IsPartial {
		return s.completePartialRelease(ctx, l, approved)
	}

	if l.TotalOutstandingBalance > 0.01 {
		return nil, ErrOutstandingBalanceRemains
	}

	if s.packetMover != nil {
		if err := s.packetMover.RecordGoldReleaseMovement(ctx, loanID, "Gold released to customer"); err != nil {
			log.Printf("packet gold-release movement failed for loan %d: %v", loanID, err)
		}
	}

	l.Status = StatusClosed
	if err := s.repo.Update(ctx, l); err != nil {
		return nil, err
	}

	// A Pending release request left over from before the balance cleared
	// (see this func's own doc comment on the "already paid in full" path,
	// which never touches that request's own checklist/approval chain) would
	// otherwise sit stuck showing Pending forever on a loan that's actually
	// already released — auto-resolve it here rather than leaving staff to
	// puzzle over why a Closed loan still lists a request awaiting review.
	if pending, findErr := s.requestRepo.FindPendingReleaseByLoanID(ctx, loanID); findErr == nil {
		now := time.Now()
		pending.Status = RequestStatusApproved
		pending.ApprovalStage = ApprovalStageApproved
		// Balance is 0 at this point (paidInFull, checked above), so the total
		// actually settled is just whatever Charges was on record.
		pending.SettlementAmount = pending.Charges
		pending.DecidedAt = &now
		pending.DecidedByEmployeeID = &employeeID
		if pending.Remarks == "" {
			pending.Remarks = "Auto-resolved — balance was paid in full and the release completed directly, without this request's own checklist/approval chain."
		}
		if err := s.requestRepo.Update(ctx, pending); err != nil {
			log.Printf("could not auto-resolve pending release request %d for loan %d: %v", pending.ID, loanID, err)
		}
	}

	return s.Get(ctx, l.ID, nil)
}

// completePartialRelease is CompleteRelease's Partial Ornament Release
// branch — see that function's own doc comment for the full contrast with
// the full-release path.
func (s *Service) completePartialRelease(ctx context.Context, l *Loan, approved *LoanRequest) (*Loan, error) {
	selected := make(map[uint]bool, len(approved.OrnamentSelections))
	for _, sel := range approved.OrnamentSelections {
		selected[sel.OrnamentID] = true
	}
	if len(selected) == 0 {
		// Should be unreachable — CreateReleaseRequest never marks a request
		// IsPartial without a real selection — but a defensive check here is
		// cheap insurance against releasing nothing while still reporting
		// success.
		return nil, ErrReleaseNotApproved
	}

	all, err := s.ornamentRepo.FindAllByLoanID(ctx, l.ID)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	var releasedGross, releasedNet float64
	releasedCount := 0
	for i := range all {
		o := &all[i]
		if !selected[o.ID] || o.ReleasedAt != nil {
			continue
		}
		o.ReleasedAt = &now
		if err := s.ornamentRepo.Update(ctx, o); err != nil {
			return nil, err
		}
		releasedGross += o.GrossWeight
		releasedNet += o.NetWeight
		releasedCount++
	}

	if s.packetMover != nil {
		remarks := fmt.Sprintf("Partial release: %d ornament(s) handed back to customer", releasedCount)
		if err := s.packetMover.RecordPartialGoldReleaseMovement(ctx, l.ID, releasedGross, releasedNet, remarks); err != nil {
			log.Printf("packet partial gold-release movement failed for loan %d: %v", l.ID, err)
		}
	}

	// Recompute the loan's collateral totals from what remains pledged —
	// PrincipalAmount/OutstandingAmount are deliberately untouched: a
	// Partial Ornament Release changes what secures the loan, not what is
	// owed on it. Loan.Status is likewise left exactly as it was — the loan
	// is still active on the ornaments that remain.
	if _, err := s.recalculateAndSave(ctx, l); err != nil {
		return nil, err
	}

	// The Partial Release Receipt itself is generated on demand by
	// DownloadPartialReleaseReceiptPDF (mirrors DownloadReleaseAgreementPDF)
	// rather than eagerly here — nothing about this method's job ("hand the
	// selected gold back") requires a PDF to exist yet, and generating one
	// speculatively on every release would burn a headless-Chromium render
	// for a document staff may never actually download.
	return s.Get(ctx, l.ID, nil)
}

// BankPledgeReleaseInput is the optional body of PUT /loans/:id/bank-pledge/
// :pledgeId/release: how the pledged amount is paid back to the bank. An
// all-zero split books the whole amount as Cash, as releases always did.
type BankPledgeReleaseInput struct {
	CashAmount         float64
	UpiAmount          float64
	BankTransferAmount float64
	ChequeAmount       float64
	BankID             *uint
}

// ReleaseBankPledge reclaims a loan's gold from the bank. Its cash effect
// MIRRORS whatever was chosen when the pledge was created: a CashIn pledge
// books the amount back out, while a RecordOnly pledge is a symmetric no-op —
// nothing was booked in, so nothing is booked out. Without that symmetry a
// RecordOnly pledge would credit the till on release for money that never
// arrived.
func (s *Service) ReleaseBankPledge(ctx context.Context, loanID, pledgeID uint, branchID *uint, in BankPledgeReleaseInput, actorID *uint, actorRole string) (*Loan, error) {
	l, err := s.repo.FindByID(ctx, loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, ErrNotFound
	}
	p, err := s.pledgeRepo.FindByID(ctx, pledgeID)
	if err != nil || p.LoanID != loanID {
		return nil, ErrNotFound
	}
	// How the money goes back to the bank — only a CashIn pledge moves any.
	var relCash, relUpi, relBankTransfer, relCheque float64
	var relBankID *uint
	if p.CashTreatment == BankPledgeCashTreatmentCashIn {
		relCash, relUpi, relBankTransfer, relCheque, err = platform.NormalizeSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, p.PledgedAmount, in.BankID)
		if err != nil {
			return nil, err
		}
		if relUpi+relBankTransfer+relCheque > 0 {
			relBankID = in.BankID
		}
	}
	// A CashIn pledge's release pays the cash share of the pledged amount back
	// out of the till (UPI/Bank Transfer/Cheque leave a bank account instead).
	// The pledge's cash lives on the Head Office till (see
	// CashRecorder.HeadOfficeBranchID), so that is the balance to check.
	if p.CashTreatment == BankPledgeCashTreatmentCashIn && s.cashRecorder != nil && relCash > 0 {
		hoID, err := s.cashRecorder.HeadOfficeBranchID(ctx)
		if err != nil {
			return nil, err
		}
		if err := s.ensureCashInHand(ctx, hoID, relCash); err != nil {
			return nil, err
		}
	}

	now := time.Now()
	p.ReleaseDate = &now
	p.Status = BankPledgeStatusRecordReleased

	// Cash first: a failed cash entry is returned to the operator with the
	// pledge still active, instead of a released pledge with no cash-out.
	var releaseMovementID, releaseExpenseID *uint
	if p.CashTreatment == BankPledgeCashTreatmentCashIn && s.cashRecorder != nil {
		// The original cash-in movement from the pledge stays untouched as
		// permanent history; releasing the gold books the same amount back
		// out as a fresh cash-out movement plus a release expense — the one
		// and only expense in the pledge cycle, since the pledge itself now
		// books cash in only (see CashRecorder).
		//
		// The release expense is deliberately Mode "Bank", not "Cash": the
		// cash-out movement above already covers the same amount, so a
		// "Cash" expense would subtract it twice from Expected Cash in Hand
		// (see cash.SummaryService.ForDate, which offsets only Mode "Cash").
		movementID, err := s.cashRecorder.RecordBankPledgeCashOut(ctx, loanID, l.LoanNumber, p.BankName, p.PledgedAmount, relCash, relUpi, relBankTransfer, relCheque, relBankID, now, l.BranchID)
		if err != nil {
			return nil, fmt.Errorf("could not record the pledge release in Cash-in-Hand, release not saved: %w", err)
		}
		releaseMovementID = &movementID

		expenseID, err := s.cashRecorder.RecordBankPledgeReleaseExpense(ctx, loanID, p.BankName, p.PledgedAmount, now, l.BranchID)
		if err != nil {
			s.undoCashMovement(ctx, releaseMovementID)
			return nil, fmt.Errorf("could not record the pledge release expense, release not saved: %w", err)
		}
		releaseExpenseID = &expenseID
		p.ReleaseCashMovementID = releaseMovementID
		p.ReleaseExpenseID = releaseExpenseID
	}

	if err := s.pledgeRepo.Update(ctx, p); err != nil {
		s.undoCashMovement(ctx, releaseMovementID)
		return nil, err
	}

	l.BankPledgeStatus = BankPledgeStatusReleased
	if err := s.repo.Update(ctx, l); err != nil {
		return nil, err
	}

	if s.packetMover != nil {
		if err := s.packetMover.RecordBankReleaseMovement(ctx, loanID, "Gold returned from bank: "+p.BankName); err != nil {
			log.Printf("packet bank-release movement failed for loan %d: %v", loanID, err)
		}
	}

	s.recordPledgeEvent(ctx, p, BankPledgeEventReleased, actorID, actorRole, pledgeReleaseRemark(p.CashTreatment))

	return s.Get(ctx, l.ID, nil)
}

func pledgeReleaseRemark(treatment string) string {
	if treatment == BankPledgeCashTreatmentCashIn {
		return "Pledged amount booked back out of Cash-in-Hand"
	}
	return "No cash effect — pledge was recorded only"
}

// VoidBankPledge cancels a re-pledge recorded in error and is the ONLY way to
// correct a mis-chosen CashTreatment, which is otherwise immutable. Editing
// that field in place would retroactively falsify cash history: a pledge that
// really did put money in the till would start claiming it never had, and its
// release would then skip the reversal that money needs.
//
// Voiding instead leaves the original record fully intact and visible, books a
// compensating cash-out only if the original actually moved cash, and logs who
// voided it and why. Staff then create a fresh pledge with the right treatment.
func (s *Service) VoidBankPledge(ctx context.Context, loanID, pledgeID uint, branchID *uint, reason string, actorID *uint, actorRole string) (*Loan, error) {
	l, err := s.repo.FindByID(ctx, loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, ErrNotFound
	}
	p, err := s.pledgeRepo.FindByID(ctx, pledgeID)
	if err != nil || p.LoanID != loanID {
		return nil, ErrPledgeNotFound
	}
	if p.Status != BankPledgeStatusRecordActive {
		return nil, ErrPledgeNotActive
	}
	if strings.TrimSpace(reason) == "" {
		return nil, ErrVoidReasonRequired
	}

	now := time.Now()
	p.Status = BankPledgeStatusRecordVoided
	p.VoidedAt = &now
	p.VoidReason = reason

	// Only a pledge that actually credited the till needs a reversal. Voiding a
	// RecordOnly pledge touches no cash, exactly as creating it didn't.
	if p.CashTreatment == BankPledgeCashTreatmentCashIn && s.cashRecorder != nil {
		// Reverse in the same modes the advance arrived in (an all-zero split,
		// i.e. a pledge from before modes existed, reverses as Cash).
		movementID, err := s.cashRecorder.RecordBankPledgeCashOut(ctx, loanID, l.LoanNumber, p.BankName, p.PledgedAmount, p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount, p.ReceivedBankID, now, l.BranchID)
		if err != nil {
			return nil, fmt.Errorf("could not record the compensating cash-out, pledge not voided: %w", err)
		}
		p.VoidCashMovementID = &movementID
	}

	if err := s.pledgeRepo.Update(ctx, p); err != nil {
		s.undoCashMovement(ctx, p.VoidCashMovementID)
		return nil, err
	}

	// The gold was never really with the bank, so the loan goes back to
	// not-pledged and the packet is moved back accordingly.
	l.BankPledgeStatus = BankPledgeStatusNotPledged
	if err := s.repo.Update(ctx, l); err != nil {
		return nil, err
	}
	if s.packetMover != nil {
		if err := s.packetMover.RecordBankReleaseMovement(ctx, loanID, "Bank pledge voided: "+reason); err != nil {
			log.Printf("packet movement (pledge void) failed for loan %d: %v", loanID, err)
		}
	}

	s.recordPledgeEvent(ctx, p, BankPledgeEventVoided, actorID, actorRole, reason)

	return s.Get(ctx, l.ID, nil)
}

// GetBankPledgeHistory returns every re-pledge ever recorded against a loan,
// including released and voided ones, each with its audit trail.
func (s *Service) GetBankPledgeHistory(ctx context.Context, loanID uint, branchID *uint) ([]BankPledgeRecord, error) {
	if err := s.checkLoanBranch(ctx, loanID, branchID); err != nil {
		return nil, err
	}
	return s.pledgeRepo.FindHistoryByLoanID(ctx, loanID)
}

// ListBankPledgeHistory returns re-pledge records across all loans, scoped to
// the caller's branch — backs the Bank Re-Pledge screen's History tab.
func (s *Service) ListBankPledgeHistory(ctx context.Context, branchID *uint, query string, limit, offset int) ([]BankPledgeHistoryRow, int64, error) {
	return s.pledgeRepo.FindAllHistory(ctx, branchID, query, limit, offset)
}

// --- Customer 360 -----------------------------------------------------------

// Customer360 is a one-screen consolidated view of everything a customer
// has ever done — every loan (with its ornaments, payments, bank pledges),
// every auction case, and running totals across all of it. Lives here
// (not in internal/customer) because internal/loan already imports
// internal/customer for Loan.Customer — the reverse import would be a
// cycle — and Repository.FindAll already preloads Customer/Ornaments/
// Payments/Pledges on every loan, so no extra queries are needed beyond
// one auction lookup per loan. Mirrors the "merge multiple domains into
// one read-only aggregation" style of reminder.Service.GetCalendarEvents.
type Customer360 struct {
	Customer         customer.CustomerResponse `json:"customer"`
	Loans            []Loan                    `json:"loans"`
	AuctionHistory   []AuctionRecord           `json:"auctionHistory"`
	TotalDisbursed   float64                   `json:"totalDisbursed"`
	TotalOutstanding float64                   `json:"totalOutstanding"`
	TotalPaid        float64                   `json:"totalPaid"`
	ActiveLoanCount  int                       `json:"activeLoanCount"`
	ClosedLoanCount  int                       `json:"closedLoanCount"`
}

// GetCustomer360 aggregates a customer's whole loan relationship. from/to
// are optional (nil = unbounded) inclusive bounds on each loan's OpenedDate;
// because every other section of the 360 view (ornaments, payments, bank
// pledges, auction history) and every total below is derived from the loan
// set, narrowing the window narrows the entire profile consistently.
func (s *Service) GetCustomer360(ctx context.Context, customerID uint, from, to *time.Time) (*Customer360, error) {
	cust, err := s.customerRepo.FindByID(ctx, customerID)
	if err != nil {
		return nil, ErrCustomerInvalid
	}
	loans, _, err := s.repo.FindAll(ctx, LoanFilter{CustomerID: customerID, OpenedFrom: from, OpenedTo: to})
	if err != nil {
		return nil, err
	}

	out := &Customer360{Customer: cust.ToResponse()}
	for i := range loans {
		s.enrich(ctx, &loans[i])
		// Only money that actually left the till. A loan still in the sanction
		// chain (or rejected) has been disbursed nothing — see Decide's
		// `disbursing` flag, which is what triggers the cash-out movement.
		// Outstanding/paid are scoped to the same disbursed set as
		// TotalDisbursed above — a loan still in the sanction chain (or
		// rejected) hasn't had any cash move, so it must not contribute to
		// either total even if it happens to carry a nonzero balance.
		if loans[i].ApprovalStage == ApprovalStageApproved {
			out.TotalDisbursed += loans[i].PrincipalAmount
			out.TotalOutstanding += loans[i].TotalOutstandingBalance
			out.TotalPaid += loans[i].TotalPaid
		}
		switch loans[i].Status {
		case StatusClosed, StatusAuctioned:
			out.ClosedLoanCount++
		case StatusActive, StatusDueSoon, StatusOverdue, StatusClosureRequested,
			// A post-auction shortfall balance is still owed and still being
			// collected, so it counts as an open relationship, not a closed one.
			StatusAuctionedBalanceDue:
			out.ActiveLoanCount++
		}
		// A loan can accumulate several auction cases over its life (one
		// withdrawn after the customer caught up, another after a later
		// default), so the 360 view shows all of them rather than just one.
		if recs, err := s.auctionRepo.FindHistoryByLoanID(ctx, loans[i].ID); err == nil {
			out.AuctionHistory = append(out.AuctionHistory, recs...)
		}
	}
	out.Loans = loans
	return out, nil
}

// ListLoansForCustomer paginates a customer's own loans server-side — backs
// GET /customers/:id/loans, the Customer 360 view's Loan History sub-table.
// Reuses the existing List/FindAll path (with enrichment and accrual
// projection) rather than a bespoke query, since a customer's loan list is
// already exactly what LoanFilter{CustomerID: ...} produces.
//
// search, when non-empty, matches the loan number (LoanFilter.Query also
// matches the customer's own name/code, which is constant here).
func (s *Service) ListLoansForCustomer(ctx context.Context, customerID uint, from, to *time.Time, search string, limit, offset int) ([]Loan, int64, error) {
	// The customer is resolved first, exactly as the four sibling sub-table
	// methods below do. This was the one of the five that omitted it, so it
	// answered 200 with an empty list for a customer belonging to another
	// business while the others answered 404 — found by the isolation
	// harness. The customer lookup runs under the caller's tenant, so
	// another business's customer is simply not found.
	if _, err := s.customerRepo.FindByID(ctx, customerID); err != nil {
		return nil, 0, ErrCustomerInvalid
	}
	return s.List(ctx, LoanFilter{CustomerID: customerID, OpenedFrom: from, OpenedTo: to, Query: search, Limit: limit, Offset: offset})
}

// ListOrnamentsForCustomer paginates every ornament pledged across every
// loan belonging to customerID — backs GET /customers/:id/ornaments, the
// Customer 360 view's Pledged Ornaments sub-table.
func (s *Service) ListOrnamentsForCustomer(ctx context.Context, customerID uint, from, to *time.Time, search string, limit, offset int) ([]CustomerOrnamentRow, int64, error) {
	if _, err := s.customerRepo.FindByID(ctx, customerID); err != nil {
		return nil, 0, ErrCustomerInvalid
	}
	return s.ornamentRepo.FindByCustomerID(ctx, customerID, from, to, search, limit, offset)
}

// ListPaymentsForCustomer paginates every payment across every loan
// belonging to customerID — backs GET /customers/:id/payments, the
// Customer 360 view's Payment History sub-table.
func (s *Service) ListPaymentsForCustomer(ctx context.Context, customerID uint, from, to *time.Time, search string, limit, offset int) ([]CustomerPaymentRow, int64, error) {
	if _, err := s.customerRepo.FindByID(ctx, customerID); err != nil {
		return nil, 0, ErrCustomerInvalid
	}
	return s.paymentRepo.FindByCustomerIDForProfile(ctx, customerID, from, to, search, limit, offset)
}

// ListBankPledgesForCustomer paginates every re-pledge record across every
// loan belonging to customerID — backs GET /customers/:id/bank-pledges, the
// Customer 360 view's Bank Pledges sub-table.
func (s *Service) ListBankPledgesForCustomer(ctx context.Context, customerID uint, from, to *time.Time, search string, limit, offset int) ([]CustomerBankPledgeRow, int64, error) {
	if _, err := s.customerRepo.FindByID(ctx, customerID); err != nil {
		return nil, 0, ErrCustomerInvalid
	}
	return s.pledgeRepo.FindAllByCustomerID(ctx, customerID, from, to, search, limit, offset)
}

// ListAuctionHistoryForCustomer paginates every auction case ever opened
// across every loan belonging to customerID — backs
// GET /customers/:id/auction-history, the Customer 360 view's Auction
// History sub-table.
func (s *Service) ListAuctionHistoryForCustomer(ctx context.Context, customerID uint, from, to *time.Time, search string, limit, offset int) ([]CustomerAuctionRow, int64, error) {
	if _, err := s.customerRepo.FindByID(ctx, customerID); err != nil {
		return nil, 0, ErrCustomerInvalid
	}
	return s.auctionRepo.FindAllByCustomerID(ctx, customerID, from, to, search, limit, offset)
}

// --- Indemnity bond Aadhaar eSign (Setu) ------------------------------------

// bondDataForLoan builds the RenderIndemnityBondPDF input from a loan's
// preloaded Customer/Branch — same fields frontend/components/NewLoan.tsx's
// printIndemnity() assembles via buildDraft(), computed from the loan's own
// data rather than the pre-save draft it uses (this runs against a real,
// persisted loan — see StartIndemnityBondSign).
//
// Deliberately reads l.Ornaments UNFILTERED (not released_at IS NULL): the
// indemnity bond is the pledge agreement for what the customer originally
// pledged when the loan opened — it stays historically accurate even after
// a later Partial Ornament Release, exactly like the FORM 7 release
// agreement's own full-history read (see releaseAgreementDataForLoan).
func (s *Service) bondDataForLoan(ctx context.Context, l *Loan) BondData {
	now := time.Now()
	age := 0
	if !l.Customer.DOB.IsZero() {
		age = int(now.Sub(l.Customer.DOB).Hours() / 24 / 365.25)
	}
	ornaments := make([]BondOrnament, 0, len(l.Ornaments))
	for _, o := range l.Ornaments {
		ornaments = append(ornaments, BondOrnament{
			Name:        o.Name,
			Purity:      o.Purity,
			GrossWeight: o.GrossWeight,
			NetWeight:   o.NetWeight,
			Value:       o.GoldValue,
		})
	}
	// Decrypted best-effort: a customer with no Aadhaar on file, or a
	// decrypt failure, just leaves the bond's Aadhaar line blank for staff
	// to fill by hand rather than blocking the eSign flow entirely.
	var aadhaar string
	if l.Customer.AadhaarEncrypted != "" && s.aadhaarCipher != nil {
		if plain, err := s.aadhaarCipher.Decrypt(l.Customer.AadhaarEncrypted); err == nil {
			aadhaar = plain
		} else {
			log.Printf("pledge agreement: decrypt Aadhaar for customer %d failed: %v", l.Customer.ID, err)
		}
	}

	// The lender's own particulars come from the tenant profile, not from
	// the loan — see renderBondHTML for the fallback order.
	legalName, addressLine, kmlRegNo, policy := s.lenderProfile(ctx)
	lenderAge, lenderPAN, lenderAadhaar := s.lenderIdentity(ctx)

	return BondData{
		LoanNumber:      l.LoanNumber,
		CustomerName:    l.Customer.Name,
		Age:             age,
		Address:         l.Customer.Address,
		BranchName:      bondPlace(s.singleBranch(ctx), l.Branch.Name, addressLine),
		Phone:           l.Customer.Phone,
		PAN:             l.Customer.PAN,
		Aadhaar:         aadhaar,
		PrincipalAmount: l.PrincipalAmount,
		InterestRate:    l.SchemeInterestRate,
		Ornaments:       ornaments,
		Day:             now.Day(),
		Month:           now.Month().String(),
		Year:            now.Year(),
		BusinessName:    s.businessName(ctx),
		LegalName:       legalName,
		AddressLine:     addressLine,
		KMLRegNo:        kmlRegNo,
		LenderAge:       lenderAge,
		LenderPAN:       lenderPAN,
		LenderAadhaar:   lenderAadhaar,
		Policy:          policy,
		DueDate:         l.DueDate,
		LenderSignature: s.lenderSignature(ctx),
		Disbursements:   s.bondDisbursements(ctx, l),
	}
}

// bondDisbursements splits l.PrincipalAmount into the initial advance and
// each later additional advance (the loan's Active top-ups), oldest first,
// for the bond's amount-distribution table. Returns nil when there were no
// additional advances — or the lookup fails — so the bond falls back to
// printing the single total.
func (s *Service) bondDisbursements(ctx context.Context, l *Loan) []BondDisbursement {
	ups, err := s.topUpRepo.FindActiveByLoanID(ctx, l.ID)
	if err != nil || len(ups) == 0 {
		return nil
	}
	initial := l.PrincipalAmount
	for _, t := range ups {
		initial -= t.Amount
	}
	out := []BondDisbursement{{Date: l.OpenedDate, Amount: math.Max(platform.RoundMoney(initial), 0), Initial: true}}
	// FindActiveByLoanID returns newest first.
	for i := len(ups) - 1; i >= 0; i-- {
		out = append(out, BondDisbursement{Date: ups[i].OccurredOn, Amount: ups[i].Amount})
	}
	return out
}

// FillLenderProfile stamps the current business's own lender particulars and
// uploaded signature onto data — for PreviewIndemnityBondPDF, whose draft
// BondData comes from the request body and so otherwise printed the demo
// lender, wrong document family and no signature.
func (s *Service) FillLenderProfile(ctx context.Context, data *BondData) {
	data.LegalName, data.AddressLine, data.KMLRegNo, data.Policy = s.lenderProfile(ctx)
	data.LenderAge, data.LenderPAN, data.LenderAadhaar = s.lenderIdentity(ctx)
	data.BusinessName = s.businessName(ctx)
	data.LenderSignature = s.lenderSignature(ctx)
}

// RenderIndemnityBondPDFForLoan renders the pledge agreement PDF for
// loanID, in the given language, WITHOUT touching Setu at all — a plain
// downloadable copy (with a real per-page header/footer, via
// RenderIndemnityBondPDF's chromedp header/footer templates) for staff to
// save/print for offline wet-ink signing, as an alternative to the
// client-side window.print() copy (frontend/modules/loans/utils/
// indemnityBond.ts), which has no way to produce a real repeating
// per-page header/footer — only a browser's own print dialog can do that,
// and only server-side via chromedp, not from page CSS alone.
func (s *Service) RenderIndemnityBondPDFForLoan(ctx context.Context, loanID uint, branchID *uint, lang string) ([]byte, string, error) {
	if lang != BondLangEnglish && lang != BondLangMalayalam && lang != BondLangGujarati {
		return nil, "", ErrUnsupportedIndemnityBondLang
	}
	l, err := s.repo.FindByID(ctx, loanID)
	if err != nil {
		return nil, "", ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, "", ErrNotFound
	}

	pdfBytes, err := RenderIndemnityBondPDF(s.bondDataForLoan(ctx, l), lang)
	if err != nil {
		return nil, "", err
	}

	filename := "Pledge-Agreement-" + l.LoanNumber + ".pdf"
	switch lang {
	case BondLangMalayalam:
		filename = "Pledge-Agreement-Malayalam-" + l.LoanNumber + ".pdf"
	case BondLangGujarati:
		filename = "Pledge-Agreement-Gujarati-" + l.LoanNumber + ".pdf"
	}
	return pdfBytes, filename, nil
}

// StartIndemnityBondSign renders the pledge agreement PDF for loanID,
// uploads it to Setu, and creates an Aadhaar eSign signature request naming
// the loan's customer as signer. redirectURL is where Setu sends the
// customer back to after they complete Aadhaar+OTP signing on their own
// device — the frontend supplies this the same way customer.Service.
// StartAadhaarVerify's redirectURL works.
//
// lang selects which pledge-agreement template is rendered and sent to
// Setu — BondLangEnglish or BondLangMalayalam; any other value is rejected.
// The signed copy remembers which one was actually sent (see
// l.IndemnityBondSignRequestID below), so re-checking status later doesn't
// need lang passed again.
//
// deliverBy selects how the signing URL reaches the customer — one of
// BondDeliverOpen/WhatsApp/Dashboard (empty defaults to Open, matching the
// original behavior before this parameter existed: the URL is just
// returned to the caller). Whatever's chosen, the URL is always returned
// too — Open's caller opens it directly, WhatsApp/Dashboard's callers use
// it only to show a confirmation, since the actual delivery already
// happened server-side.
//
// The bond's print-and-sign-by-hand buttons (NewLoan.tsx/LoanDetail.tsx)
// are untouched by this — eSign is an additional path, not a replacement,
// since it needs the customer's own device and network.
func (s *Service) StartIndemnityBondSign(ctx context.Context, loanID uint, branchID *uint, lang string, redirectURL string, deliverBy string) (*platform.SignatureRequest, error) {
	if s.esign == nil {
		return nil, ErrEsignNotConfigured
	}
	// Two separate checks. The first asks whether the language exists at
	// all; the second asks whether THIS business was granted it, which is
	// the vendor's decision and must be enforced server-side — hiding the
	// option in the picker only decides what is drawn.
	if lang != BondLangEnglish && lang != BondLangMalayalam && lang != BondLangGujarati {
		return nil, ErrUnsupportedIndemnityBondLang
	}
	if !s.tenantAllowsLanguage(ctx, lang) {
		return nil, ErrLanguageNotEnabled
	}
	if deliverBy == "" {
		deliverBy = BondDeliverOpen
	}
	if deliverBy != BondDeliverOpen && deliverBy != BondDeliverWhatsApp && deliverBy != BondDeliverDashboard {
		return nil, ErrUnsupportedIndemnityBondDeliver
	}
	l, err := s.repo.FindByID(ctx, loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, ErrNotFound
	}
	if l.IndemnityBondSignStatus == "sign_complete" {
		return nil, ErrIndemnityBondAlreadySigned
	}

	if tenantID, ok := platform.TenantFromContext(ctx); ok {
		if err := platform.CheckAndRecordUsage(s.db, tenantID, platform.UsageSetuEsign); err != nil {
			return nil, err
		}
	}

	pdfBytes, slots, err := RenderIndemnityBondPDFWithSlots(s.bondDataForLoan(ctx, l), lang)
	if err != nil {
		return nil, err
	}

	docTitle := "Pledge Agreement - " + l.LoanNumber
	if lang == BondLangMalayalam {
		docTitle = "Pledge Agreement (Malayalam) - " + l.LoanNumber
	}
	doc, err := s.esign.UploadDocument(pdfBytes, docTitle)
	if err != nil {
		return nil, err
	}

	phone := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, l.Customer.Phone)
	if len(phone) > 10 {
		phone = phone[len(phone)-10:]
	}
	if len(phone) < 10 {
		phone = "9876543210"
	}

	name := strings.TrimSpace(l.Customer.Name)
	if len(name) < 3 {
		name = "Customer " + l.LoanNumber
	}

	lastPage := strconv.Itoa(CountPDFPages(pdfBytes))
	if lastPage == "" || lastPage == "0" {
		lastPage = "1"
	}

	signer := platform.Signer{
		Identifier:  phone,
		DisplayName: name,
		Signature: &platform.SignatureConfig{
			OnPages:  []string{lastPage},
			Position: "bottom-right",
			Slots:    slots,
		},
	}
	if !l.Customer.DOB.IsZero() {
		signer.BirthYear = strconv.Itoa(l.Customer.DOB.Year())
	}
	req, err := s.esign.CreateSignatureRequest(doc.ID, signer, redirectURL)
	if err != nil {
		return nil, err
	}

	l.IndemnityBondDocumentID = doc.ID
	l.IndemnityBondSignRequestID = req.ID
	l.IndemnityBondSignStatus = req.Status
	if err := s.repo.Update(ctx, l); err != nil {
		return nil, err
	}

	if req.URL != "" {
		s.deliverEsignLink(ctx, l, req.URL, lang, deliverBy, phone)
	}
	return req, nil
}

// deliverEsignLink sends the just-created signing URL to the customer by
// whichever channel staff picked, in addition to always returning it to the
// caller (see StartIndemnityBondSign's deliverBy doc comment). BondDeliverOpen
// is a no-op here — the caller opening the URL themselves is the entire
// delivery. phone is the same 10-digit number already resolved for Setu's
// signer.Identifier, so both use the identical number.
func (s *Service) deliverEsignLink(ctx context.Context, l *Loan, url, lang, deliverBy, phone string) {
	langLabel := "English"
	if lang == BondLangMalayalam {
		langLabel = "Malayalam"
	}
	title := "Sign Your Pledge Agreement"
	body := fmt.Sprintf(
		"CloudHouse Finance: your %s pledge agreement for loan %s is ready to sign with Aadhaar. Open this link on your own phone to complete it: %s",
		langLabel, l.LoanNumber, url,
	)

	switch deliverBy {
	case BondDeliverWhatsApp:
		if s.whatsapp == nil {
			log.Printf("indemnity bond: WhatsApp delivery requested for loan %d but no WhatsApp sender is configured", l.ID)
			return
		}
		// Same fire-and-forget-in-a-goroutine + commlog pattern as
		// notifyCustomer — an OpenWA send can take up to its own client
		// timeout, and this must not hold up the eSign response the
		// caller is waiting on to open its own confirmation screen.
		// tenantID (not the request ctx) is what the commlog write below
		// uses — see notifyCustomer's identical comment for why: the
		// request's own pinned connection is gone by the time this goroutine
		// runs, so commlogRepo.CreateBackground pins its own instead.
		tenantID, _ := platform.TenantFromContext(ctx)
		go func() {
			// A panic in a detached goroutine takes the whole process with
			// it; a failed courtesy message must never do that.
			defer func() {
				if r := recover(); r != nil {
					log.Printf("indemnity bond eSign WhatsApp notification panicked (loan %d): %v", l.ID, r)
				}
			}()
			sendErr := s.whatsapp.Send(phone, body)
			if sendErr != nil {
				log.Printf("indemnity bond eSign WhatsApp send failed (loan %d, phone %s): %v", l.ID, phone, sendErr)
			}
			if s.commlogRepo != nil {
				rec := &commlog.CommunicationLog{
					RecipientPhone:    phone,
					ChatID:            commlog.NormalizeChatID(phone),
					Channel:           commlog.ChannelWhatsApp,
					TriggerType:       commlog.TriggerIndemnityBondEsign,
					MessageBody:       body,
					RelatedEntityType: "loan",
					RelatedEntityID:   l.ID,
					Status:            commlog.StatusSent,
				}
				if sendErr != nil {
					rec.Status = commlog.StatusFailed
					rec.ErrorMessage = sendErr.Error()
				}
				if err := s.commlogRepo.CreateBackground(tenantID, rec); err != nil {
					log.Printf("indemnity bond eSign: communication log write failed (loan %d): %v", l.ID, err)
				}
			}
		}()
	case BondDeliverDashboard:
		if s.notifier == nil {
			log.Printf("indemnity bond: dashboard delivery requested for loan %d but no notifier is configured", l.ID)
			return
		}
		s.notifier.Notify(ctx, l.CustomerID, "IndemnityBondEsignReady", title, body, "loan", l.ID)
	}
}

// CheckIndemnityBondSign polls the outstanding Setu signature request
// started by StartIndemnityBondSign. While the customer hasn't finished
// Aadhaar+OTP signing yet, this returns the current status and leaves the
// loan's stored signed-document fields untouched — callers should poll
// again later. Once "sign_complete", it downloads the signed PDF from
// Setu's (time-limited) link and re-hosts it via internal/upload so the
// loan keeps its own permanent copy rather than depending on Setu's
// validUpto-bounded URL.
func (s *Service) CheckIndemnityBondSign(ctx context.Context, loanID uint, branchID *uint) (*Loan, *platform.SignatureStatus, error) {
	if s.esign == nil {
		return nil, nil, ErrEsignNotConfigured
	}
	l, err := s.repo.FindByID(ctx, loanID)
	if err != nil {
		return nil, nil, ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, nil, ErrNotFound
	}
	if l.IndemnityBondSignRequestID == "" {
		return nil, nil, ErrNoIndemnityBondSignRequest
	}

	status, err := s.esign.GetSignatureStatus(l.IndemnityBondSignRequestID)
	if err != nil {
		return nil, nil, err
	}
	if status.Status != "sign_complete" {
		l.IndemnityBondSignStatus = status.Status
		if updErr := s.repo.Update(ctx, l); updErr != nil {
			log.Printf("indemnity bond sign status update failed for loan %d: %v", l.ID, updErr)
		}
		return l, status, nil
	}

	signed, err := s.esign.GetSignedDocument(l.IndemnityBondSignRequestID)
	if err != nil {
		return nil, nil, err
	}

	resp, err := http.Get(signed.DownloadURL)
	if err != nil {
		return nil, nil, fmt.Errorf("indemnity bond: download signed document: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, nil, fmt.Errorf("indemnity bond: download signed document: unexpected status %d", resp.StatusCode)
	}
	pdfBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, fmt.Errorf("indemnity bond: read signed document: %w", err)
	}

	url, err := upload.SaveBytesRecorded(ctx, s.uploadRepo, s.uploadsDir, "indemnity-bond-"+l.LoanNumber+".pdf", pdfBytes)
	if err != nil {
		return nil, nil, fmt.Errorf("indemnity bond: store signed document: %w", err)
	}

	now := time.Now()
	l.IndemnityBondSignStatus = "sign_complete"
	l.IndemnityBondSignedURL = url
	l.IndemnityBondSignedAt = &now
	if err := s.repo.Update(ctx, l); err != nil {
		return nil, nil, err
	}

	updated, err := s.repo.FindByID(ctx, l.ID)
	if err != nil {
		return nil, nil, err
	}
	return updated, status, nil
}

// --- Loan drafts ------------------------------------------------------------

// DraftOrnamentInput is one row of a draft's ornament table. Every field is
// optional: a draft records how far staff got, so a row with a name but no
// weight yet (or a weight but no type) is legitimate and stored as-is.
type DraftOrnamentInput struct {
	Name        string
	Purity      string
	GrossWeight float64
	Quantity    int
	ImageURL    string
	ImageName   string
}

// DraftInput is the whole New Gold Loan form as saved by "Save Draft".
// BranchID is the only required field — everything else may legitimately be
// unset in a part-filled form (see LoanDraft's doc comment for why nothing
// here is validated the way CreateInput is).
type DraftInput struct {
	BranchID          uint
	CustomerID        *uint
	SchemeID          *uint
	LockerID          *uint
	PrincipalOverride *float64
	Ornaments         []DraftOrnamentInput
}

// ErrDraftBranchRequired is the one validation a draft does enforce: without
// a branch there's nothing to scope the draft to, so it could never be
// listed back by its owner.
var ErrDraftBranchRequired = httpx.NewBadRequest("branchId is required to save a draft")

func (in DraftInput) toOrnamentRows() []LoanDraftOrnament {
	rows := make([]LoanDraftOrnament, len(in.Ornaments))
	for i, o := range in.Ornaments {
		rows[i] = LoanDraftOrnament{
			Name:        o.Name,
			Purity:      o.Purity,
			GrossWeight: o.GrossWeight,
			Quantity:    o.Quantity,
			ImageURL:    o.ImageURL,
			ImageName:   o.ImageName,
			Position:    i,
		}
	}
	return rows
}

// SaveDraft creates a new draft owned by actorEmployeeID. Branch existence
// is checked (a draft pointing at a deleted branch could never be listed),
// but customer/scheme/locker are NOT — an unverified customer or an inactive
// scheme is a perfectly normal thing to have half-selected, and those rules
// are applied at submission by Create.
func (s *Service) SaveDraft(ctx context.Context, actorEmployeeID uint, in DraftInput) (*LoanDraft, error) {
	if in.BranchID == 0 {
		return nil, ErrDraftBranchRequired
	}
	if _, err := s.branchRepo.FindByID(ctx, in.BranchID); err != nil {
		return nil, ErrBranchInvalid
	}
	d := &LoanDraft{
		CreatedByEmployeeID: actorEmployeeID,
		BranchID:            in.BranchID,
		CustomerID:          in.CustomerID,
		SchemeID:            in.SchemeID,
		LockerID:            in.LockerID,
		PrincipalOverride:   in.PrincipalOverride,
		Ornaments:           in.toOrnamentRows(),
	}
	if err := s.draftRepo.Create(ctx, d); err != nil {
		return nil, err
	}
	return s.draftRepo.FindByID(ctx, d.ID)
}

// UpdateDraft overwrites an existing draft — what the "Save Draft" button
// does on its second and subsequent presses within the same sitting, so
// repeated saves don't accumulate near-identical drafts. Only the owner may
// update; anyone else gets ErrDraftNotFound.
func (s *Service) UpdateDraft(ctx context.Context, draftID, actorEmployeeID uint, in DraftInput) (*LoanDraft, error) {
	existing, err := s.getOwnDraft(ctx, draftID, actorEmployeeID)
	if err != nil {
		return nil, err
	}
	if in.BranchID == 0 {
		return nil, ErrDraftBranchRequired
	}
	if in.BranchID != existing.BranchID {
		if _, err := s.branchRepo.FindByID(ctx, in.BranchID); err != nil {
			return nil, ErrBranchInvalid
		}
	}
	existing.BranchID = in.BranchID
	existing.CustomerID = in.CustomerID
	existing.SchemeID = in.SchemeID
	existing.LockerID = in.LockerID
	existing.PrincipalOverride = in.PrincipalOverride
	existing.Ornaments = in.toOrnamentRows()
	if err := s.draftRepo.Replace(ctx, existing); err != nil {
		return nil, err
	}
	return s.draftRepo.FindByID(ctx, existing.ID)
}

// ListDrafts returns the caller's own saved drafts, newest-saved first.
func (s *Service) ListDrafts(ctx context.Context, actorEmployeeID uint, branchScope *uint) ([]LoanDraft, error) {
	return s.draftRepo.FindAllByEmployee(ctx, actorEmployeeID, branchScope)
}

// GetDraft returns one of the caller's own drafts, for reopening it in the
// New Gold Loan form.
func (s *Service) GetDraft(ctx context.Context, draftID, actorEmployeeID uint) (*LoanDraft, error) {
	return s.getOwnDraft(ctx, draftID, actorEmployeeID)
}

// DeleteDraft discards a draft — either explicitly ("Discard"), or
// automatically once the loan it became has been created (see
// DeleteDraftQuietly).
func (s *Service) DeleteDraft(ctx context.Context, draftID, actorEmployeeID uint) error {
	if _, err := s.getOwnDraft(ctx, draftID, actorEmployeeID); err != nil {
		return err
	}
	return s.draftRepo.Delete(ctx, draftID)
}

// DeleteDraftQuietly discards a draft without reporting failure, used on the
// loan-submission success path: the loan is already created and returned, so
// a lingering draft is untidy rather than wrong, and must not turn a
// successful submission into an error. Mirrors the fail-soft posture Create
// already takes for packet auto-creation and WhatsApp notifications.
func (s *Service) DeleteDraftQuietly(ctx context.Context, draftID, actorEmployeeID uint) {
	if draftID == 0 {
		return
	}
	if err := s.DeleteDraft(ctx, draftID, actorEmployeeID); err != nil {
		log.Printf("loan: could not delete draft %d after submission: %v", draftID, err)
	}
}

// getOwnDraft loads a draft and enforces ownership, collapsing "missing" and
// "someone else's" into the same ErrDraftNotFound.
func (s *Service) getOwnDraft(ctx context.Context, draftID, actorEmployeeID uint) (*LoanDraft, error) {
	d, err := s.draftRepo.FindByID(ctx, draftID)
	if err != nil {
		return nil, ErrDraftNotFound
	}
	if d.CreatedByEmployeeID != actorEmployeeID {
		return nil, ErrDraftNotFound
	}
	return d, nil
}
