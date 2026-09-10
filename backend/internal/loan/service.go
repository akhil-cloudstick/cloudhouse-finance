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
	RecordBankPledgeCashIn(ctx context.Context, loanID uint, bankName string, amount float64, occurredOn time.Time) (movementID uint, err error)
	RecordBankPledgeCashOut(ctx context.Context, loanID uint, bankName string, amount float64, occurredOn time.Time, branchID uint) (movementID uint, err error)
	RecordBankPledgeReleaseExpense(ctx context.Context, loanID uint, bankName string, amount float64, occurredOn time.Time, branchID uint) (expenseID uint, err error)
	RecordLoanDisbursementCashOut(ctx context.Context, loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time) (movementID uint, err error)
	RecordLoanPaymentCashIn(ctx context.Context, loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time, paymentType string) (movementID uint, err error)

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
}

var (
	ErrNotFound              = httpx.NewNotFound("loan not found")
	ErrOrnamentNotFound      = httpx.NewNotFound("ornament not found")
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
	ErrWrongStage            = httpx.NewBadRequest("approval action does not match the loan's current approval stage")
	ErrAlreadyDecided        = httpx.NewBadRequest("loan approval has already reached a terminal state")
	ErrInvalidAction         = httpx.NewBadRequest("action must be Approved or Rejected")
	ErrInvalidAmount         = httpx.NewBadRequest("amount must be greater than zero")
	ErrRequestNotFound       = httpx.NewNotFound("loan request not found")
	ErrInvalidRequestType    = httpx.NewBadRequest("type must be Extension or Release")
	ErrInvalidMonths         = httpx.NewBadRequest("requested extension months must be greater than zero")
	ErrRequestAlreadyDecided = httpx.NewBadRequest("loan request has already been decided")
	ErrInvalidPaymentType    = httpx.NewBadRequest("type must be Interest, Principal, Partial, Full Settlement, Adjustment, Waiver, or Discount")
	ErrNotExtensionRequest   = httpx.NewBadRequest("this request is not an Extension request")
	ErrNotReleaseRequest     = httpx.NewBadRequest("this request is not a Release request")
	// ErrUseStagedExtensionApproval is returned by the old single-step
	// DecideRequest when called for an Extension request — extension
	// requests now go through the same 3-stage approval chain as Release
	// (see Service.ApproveExtensionRequest), never a single decide call.
	ErrUseStagedExtensionApproval = httpx.NewBadRequest("extension requests are now decided through the staged approval chain — use POST /loans/requests/:requestId/approve instead")
	ErrLoanTerminalState          = httpx.NewBadRequest("loan is already Closed, Auctioned, or Defaulted — nothing left to extend")
	ErrChecklistIncomplete        = httpx.NewBadRequest("the release verification checklist must be fully complete before approval")
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
	ErrAuctionBalanceDueCannotSettle = httpx.NewBadRequest("this auction left a balance owing — resolve the shortfall decision instead of settling")
	ErrNoSurplusToDispose            = httpx.NewBadRequest("this auction left no surplus to dispose of")
	ErrSurplusAlreadyDisposed        = httpx.NewConflict("this auction's surplus has already been disposed of")
	ErrInvalidSurplusDisposition     = httpx.NewBadRequest("surplus disposition must be either \"RefundedToCustomer\" or \"RecordedAsIncome\"")
	ErrSettlementRemarksRequired     = httpx.NewBadRequest("remarks are required when a customer's auction surplus is retained as income")
	ErrDecisionRemarksRequired       = httpx.NewBadRequest("remarks are required for this decision")

	// ErrEsignNotConfigured/ErrNoIndemnityBondSignRequest are returned by the
	// indemnity-bond Aadhaar eSign flow (StartIndemnityBondSign/
	// CheckIndemnityBondSign) — same shape as customer.Service's
	// ErrDigilockerNotConfigured/ErrNoDigilockerRequest.
	ErrEsignNotConfigured         = httpx.NewUnavailable("indemnity bond eSign is not configured")
	ErrNoIndemnityBondSignRequest = httpx.NewBadRequest("no indemnity bond eSign has been started for this loan")
	// ErrIndemnityBondAlreadySigned is a state conflict — Conflict, not BadRequest.
	ErrIndemnityBondAlreadySigned      = httpx.NewConflict("this loan's indemnity bond has already been signed")
	ErrUnsupportedIndemnityBondLang    = httpx.NewBadRequest("lang must be \"en\" or \"gu\"")
	ErrUnsupportedIndemnityBondDeliver = httpx.NewBadRequest("deliverBy must be \"open\", \"whatsapp\" or \"dashboard\"")
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
	db *gorm.DB

	repo                *Repository
	ornamentRepo        *OrnamentRepository
	approvalRepo        *ApprovalRepository
	paymentRepo         *PaymentRepository
	pledgeRepo          *BankPledgeRepository
	requestRepo         *LoanRequestRepository
	requestApprovalRepo *RequestApprovalRepository
	auctionRepo         *AuctionRepository
	approvalLimitRepo   *ApprovalLimitRepository

	// draftRepo is built from db inside NewService rather than being passed
	// in like the repositories above — drafts are internal scratch state
	// with no other consumer, and this constructor already takes 21
	// arguments.
	draftRepo *DraftRepository

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
}

func NewService(
	db *gorm.DB,
	repo *Repository,
	ornamentRepo *OrnamentRepository,
	approvalRepo *ApprovalRepository,
	paymentRepo *PaymentRepository,
	pledgeRepo *BankPledgeRepository,
	requestRepo *LoanRequestRepository,
	requestApprovalRepo *RequestApprovalRepository,
	auctionRepo *AuctionRepository,
	approvalLimitRepo *ApprovalLimitRepository,
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
		approvalLimitRepo:   approvalLimitRepo,
		draftRepo:           NewDraftRepository(db),
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
		// WithoutCancel, not Background: the goroutine outlives the request
		// (whose ctx is cancelled the moment the handler returns, which would
		// abort the commlog write) but must keep every value on it — tenant
		// scope above all, since the commlog row is tenant-owned (see
		// platform.TenantScoped).
		bg := context.WithoutCancel(ctx)
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
				if err := s.commlogRepo.Create(bg, rec); err != nil {
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
// and recomputes EligibleLoanAmount = TotalGoldValue × Scheme.LTVPercent/100.
func recalculateTotals(l *Loan, ornaments []Ornament, sch *scheme.Scheme) {
	var totalNet, totalValue float64
	for _, o := range ornaments {
		totalNet += o.NetWeight
		totalValue += o.GoldValue
	}
	l.TotalNetWeight = totalNet
	l.TotalGoldValue = totalValue
	l.EligibleLoanAmount = totalValue * (sch.LTVPercent / 100)
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

	rec := &Loan{
		BranchID:         in.BranchID,
		CustomerID:       in.CustomerID,
		SchemeID:         in.SchemeID,
		OpenedDate:       in.OpenedDate,
		DueDate:          in.DueDate,
		AdditionalInfo:   in.AdditionalInfo,
		Status:           StatusPendingApproval,
		ApprovalStage:    SanctionStageLoanOperator,
		BankPledgeStatus: BankPledgeStatusNotPledged,
		// Interest accrues from the day the loan is opened, not from
		// whenever it happens to first be viewed/paid against.
		LastAccrualDate: in.OpenedDate,
	}
	recalculateTotals(rec, ornaments, sch)

	if in.PrincipalAmount > rec.EligibleLoanAmount {
		return nil, ErrPrincipalTooHigh
	}
	rec.PrincipalAmount = in.PrincipalAmount
	rec.OutstandingAmount = in.PrincipalAmount

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
	RiskGreen  RiskLevel = "Green"  // comfortably covered
	RiskOrange RiskLevel = "Orange" // covered today, but the margin has eroded under the buffer
	RiskRed    RiskLevel = "Red"    // gold, sold today, would not cover the principal
)

// RiskBufferPercent is the safety margin, as a fraction of principal, that
// separates "Orange / At Risk" from "Green". A loan whose gold would fetch
// less than principal alone is always Red regardless of this buffer.
const RiskBufferPercent = 0.10

// ClassifyRisk applies the red/orange/green thresholds documented on
// RiskLevel's own constants:
//   - currentGoldValue < principalAmount                        → Red
//   - currentGoldValue < principalAmount × (1 + RiskBufferPercent) → Orange
//   - otherwise                                                  → Green
func ClassifyRisk(currentGoldValue, principalAmount float64) RiskLevel {
	if currentGoldValue < principalAmount {
		return RiskRed
	}
	if currentGoldValue < principalAmount*(1+RiskBufferPercent) {
		return RiskOrange
	}
	return RiskGreen
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
	LoanID           uint      `json:"loanId"`
	LoanNumber       string    `json:"loanNumber"`
	CustomerID       uint      `json:"customerId"`
	CustomerName     string    `json:"customerName"`
	Status           string    `json:"status"`
	PrincipalAmount  float64   `json:"principalAmount"`
	TotalNetWeight   float64   `json:"totalNetWeight"`
	CurrentGoldValue float64   `json:"currentGoldValue"`
	RiskLevel        RiskLevel `json:"riskLevel"`
}

// RiskAssessmentFilter narrows ListLoanRiskAssessment's results.
type RiskAssessmentFilter struct {
	// Status, when set, must be one of riskEligibleStatuses (checked by the
	// handler) and narrows to exactly that status. Empty means every
	// risk-eligible status (the page's default "All" view).
	Status      string
	BranchScope *uint

	// OpenedFrom/OpenedTo bound OpenedDate, both optional and inclusive —
	// same semantics as LoanFilter's own fields.
	OpenedFrom *time.Time
	OpenedTo   *time.Time

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
	counts := map[RiskLevel]int{RiskRed: 0, RiskOrange: 0, RiskGreen: 0}
	for _, l := range loans {
		var currentValue float64
		for _, o := range l.Ornaments {
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
		level := ClassifyRisk(currentValue, l.PrincipalAmount)
		counts[level]++
		rows = append(rows, LoanRiskRow{
			LoanID:           l.ID,
			LoanNumber:       l.LoanNumber,
			CustomerID:       l.CustomerID,
			CustomerName:     l.Customer.Name,
			Status:           l.Status,
			PrincipalAmount:  l.PrincipalAmount,
			TotalNetWeight:   l.TotalNetWeight,
			CurrentGoldValue: currentValue,
			RiskLevel:        level,
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
		interestDelta, penalDelta, _ := projectAccrual(l, &l.Scheme, now)
		l.AccruedInterest = platform.RoundMoney(l.AccruedInterest + interestDelta)
		l.AccruedPenalInterest = platform.RoundMoney(l.AccruedPenalInterest + penalDelta)
		s.enrich(ctx, l)
	}
	return loans, total, nil
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
	case StatusClosed, StatusAuctioned, StatusAuctionedBalanceDue:
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
}

// UpdateLoan lets staff correct a loan's scheme or principal amount even
// after final sanction — deliberately allowed with no confirmation/audit
// trail beyond the ordinary "can update loan" permission, per an explicit
// product decision (unlike Update's own field-by-field `changes` pattern
// elsewhere in this package, nothing here is separately logged).
//
// Scheme change: swapping SchemeID is enough on its own — l.Scheme is
// loaded fresh on every read/accrual call, so the new interest rate,
// method and penal rate apply automatically to everything computed from
// this point forward. Already-recorded AccruedInterest/
// AccruedPenalInterest are untouched — this is deliberately
// prospective-only, never rewriting history. LTVPercent also changes with
// the scheme, so EligibleLoanAmount is recalculated against the loan's
// current ornaments under the NEW scheme, same as AddOrnament/
// UpdateOrnament/DeleteOrnament already do whenever the ornament set
// changes.
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
	case StatusClosed, StatusAuctioned, StatusAuctionedBalanceDue:
		return nil, ErrLoanTerminalState
	}

	if in.SchemeID != nil {
		if _, err := s.schemeRepo.FindByID(ctx, *in.SchemeID); err != nil {
			return nil, ErrSchemeInvalid
		}
		l.SchemeID = *in.SchemeID
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

	sch, err := s.schemeRepo.FindByID(ctx, l.SchemeID)
	if err != nil {
		return nil, ErrSchemeInvalid
	}
	ornaments, err := s.ornamentRepo.FindByLoanID(ctx, l.ID)
	if err != nil {
		return nil, err
	}
	recalculateTotals(l, ornaments, sch)
	if l.PrincipalAmount > l.EligibleLoanAmount {
		return nil, ErrPrincipalTooHigh
	}
	if err := s.repo.Update(ctx, l); err != nil {
		return nil, err
	}
	return s.Get(ctx, l.ID, nil)
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
func (s *Service) HardDeleteLoan(ctx context.Context, loanID uint) error {
	if _, err := s.repo.FindByID(ctx, loanID); err != nil {
		return ErrNotFound
	}
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
	sch, err := s.schemeRepo.FindByID(ctx, l.SchemeID)
	if err != nil {
		return nil, ErrSchemeInvalid
	}
	ornaments, err := s.ornamentRepo.FindByLoanID(ctx, l.ID)
	if err != nil {
		return nil, err
	}
	recalculateTotals(l, ornaments, sch)
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

// sanctionChain is the loan sanction chain's fixed stage order — index i's
// Permission must be held by the acting employee's role (see Approve and
// checkStagePermission) to advance from SanctionStage[i] to
// SanctionStage[i+1] (or to ApprovalStageApproved, for the last stage).
// Role is kept only as a human-readable label for sanctionWarning's advisory
// message text below — it plays no part in the actual authorization check
// any more (see the "Approval Workflow" permissions in internal/authz.Catalogue,
// which default-grant these to the same roles this used to hardcode).
var sanctionChain = []struct{ Stage, Role, Permission string }{
	{SanctionStageLoanOperator, "Loan Operator", "can verify loan"},
	{SanctionStageBranchManager, "Branch Manager", "can approve branch manager stage"},
	{SanctionStageFinalSanction, "Management", "can sanction loan"},
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

// sanctionLimits is an advisory-only reference table for Branch Manager/
// Management — "a Branch Manager would typically only sign off on loans up
// to ₹X," etc. It is NEVER used to block an approve/reject decision for
// these two roles, only to compute Loan.ApprovalWarning so the UI can show
// a "consider escalating" note. Hardcoded (no admin screen to edit these
// yet — an explicit scope decision, not an oversight; only the Loan
// Operator limit below was asked to become editable/hard-enforced).
//
// Loan Operator's limit used to live here too, advisory-only; it's now a
// real, admin-editable, HARD-enforced cap — see ApprovalLimit/
// loanOperatorLimit/Approve's stage-role check below.
var sanctionLimits = map[string]float64{
	"Branch Manager": 200000,
	"Management":     0, // 0 == no advisory ceiling — Management/Final Sanction can clear any amount
}

func sanctionWarning(l *Loan) string {
	stage := normalizeSanctionStage(l.ApprovalStage)
	for _, step := range sanctionChain {
		if step.Stage != stage {
			continue
		}
		limit := sanctionLimits[step.Role]
		if limit > 0 && l.PrincipalAmount > limit {
			return fmt.Sprintf("Principal ₹%.0f exceeds the typical ₹%.0f limit for %s — consider escalating.", l.PrincipalAmount, limit, step.Role)
		}
		return ""
	}
	return ""
}

// loanOperatorLimit reads the current hard-enforced Loan Operator approval
// limit from the DB, falling back to DefaultLoanOperatorApprovalLimit if
// no row exists yet (shouldn't happen past first migration — see
// SeedLoanOperatorLimit — but a missing row should never silently disable
// enforcement).
func (s *Service) loanOperatorLimit(ctx context.Context) float64 {
	rec, err := s.approvalLimitRepo.FindByRole(ctx, "Loan Operator")
	if err != nil {
		return DefaultLoanOperatorApprovalLimit
	}
	return rec.MaxAmount
}

// GetLoanOperatorLimit exposes the current limit for GET /loans/approval-limits/loan-operator.
func (s *Service) GetLoanOperatorLimit(ctx context.Context) float64 {
	return s.loanOperatorLimit(ctx)
}

// SetLoanOperatorLimit updates the Loan Operator's hard-enforced approval
// limit (PUT /loans/approval-limits/loan-operator). amount must be > 0 —
// a Loan Operator having literally no approval authority isn't a state
// this endpoint models; remove the role from the sanction chain instead if
// that's ever needed.
func (s *Service) SetLoanOperatorLimit(ctx context.Context, amount float64) (float64, error) {
	if amount <= 0 {
		return 0, ErrInvalidAmount
	}
	rec, err := s.approvalLimitRepo.Upsert(ctx, "Loan Operator", amount)
	if err != nil {
		return 0, err
	}
	return rec.MaxAmount, nil
}

// ApprovalInput mirrors the body of POST /loans/:id/approve.
type ApprovalInput struct {
	Stage           string // one of SanctionStage* — must match the loan's current ApprovalStage
	Action          string // "Approved" | "Rejected"
	ActorEmployeeID uint
	ActorRole       string // employee.ValidRoles value — audit-trail display only, not used for authorization any more (see checkStagePermission)
	ActorRoleID     uint   // authz.Role.ID — checked against sanctionChain's required "Approval Workflow" permission
	Remarks         string
}

// Approve advances (or terminates) a loan's 3-step sanction chain:
//
//	LoanOperator (verified) -> BranchManager (approved) -> FinalSanction (Management) -> Approved (Status -> Active)
//
// A Rejected action at any stage closes the loan (Status -> Closed) since
// the doc's status list has no distinct "Rejected" bucket. in.ActorRole
// must match the current stage's required role (see sanctionChain); an
// "Administrator" actor is exempt and may act at whichever stage is
// currently pending.
//
// The LoanOperator stage is a *verification*, not a sanction: the operator
// who made the loan confirms it and the chain moves on to the Branch
// Manager, who is the first actual approver. Both ApprovalActionVerified
// and Approved are accepted there and behave identically (the UI sends
// "Verified"; "Approved" stays accepted so older clients keep working).
// No amount check gates it — the Loan Operator approval limit and
// sanctionLimits are advisory only, feeding Loan.ApprovalWarning.
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
	stage := normalizeSanctionStage(l.ApprovalStage)
	if normalizeSanctionStage(in.Stage) != stage {
		return nil, ErrWrongStage
	}

	var requiredRole, requiredPermission string
	for _, step := range sanctionChain {
		if step.Stage == stage {
			requiredRole = step.Role
			requiredPermission = step.Permission
			break
		}
	}

	// Verified belongs to the LoanOperator stage only.
	if in.Action == ApprovalActionVerified && requiredRole != "Loan Operator" {
		return nil, ErrWrongStage
	}
	// Permission-gated (see checkStagePermission's doc comment) — "Administrator"
	// is no longer special-cased here: its role's grants can't be revoked
	// (see authz.Repository), so it always holds requiredPermission already.
	if requiredPermission != "" && !s.checkStagePermission(ctx, in.ActorRoleID, requiredPermission) {
		return nil, ErrWrongStage
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
		return nil, err
	}

	disbursing := false
	rejected := in.Action == ApprovalStageRejected
	var nextStageLabel string
	if rejected {
		l.ApprovalStage = ApprovalStageRejected
		l.Status = StatusClosed
	} else {
		switch stage {
		case SanctionStageLoanOperator:
			l.ApprovalStage = SanctionStageBranchManager
			nextStageLabel = "Branch Manager"
		case SanctionStageBranchManager:
			l.ApprovalStage = SanctionStageFinalSanction
			nextStageLabel = "Management"
		case SanctionStageFinalSanction:
			l.ApprovalStage = ApprovalStageApproved
			l.Status = StatusActive
			disbursing = true
		}
	}

	if err := s.repo.Update(ctx, l); err != nil {
		return nil, err
	}

	// The principal only actually leaves the till once the loan clears its
	// final approval stage — logging it earlier (e.g. at Create) would show
	// cash going out for a loan that might still be rejected.
	if disbursing && s.cashRecorder != nil {
		if _, err := s.cashRecorder.RecordLoanDisbursementCashOut(ctx, l.ID, l.LoanNumber, l.PrincipalAmount, l.BranchID, time.Now()); err != nil {
			log.Printf("cash-out movement (disbursement) failed for loan %d: %v", l.ID, err)
		}
	}

	switch {
	case disbursing:
		s.notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Loan Sanctioned", s.brandedMessage(ctx,
			"Dear %s, your gold loan %s has been sanctioned and ₹%.2f has been disbursed. Due date: %s. — CloudHouse Finance",
			l.Customer.Name, l.LoanNumber, l.PrincipalAmount, l.DueDate.Format("02-Jan-2006"),
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

// GetInterestCollected sums the interest + penal-interest portions of
// payments recorded within [from, to] — backs Dashboard.tsx's "Interest
// Collected" KPI (GET /loans/interest-collected), replacing the old
// mock-only db.ledger figure that never had a real backend equivalent.
func (s *Service) GetInterestCollected(ctx context.Context, from, to time.Time) (float64, error) {
	return s.paymentRepo.SumInterestCollected(ctx, from, to)
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
// LoanPayment.ProcessingFee's doc comment.
type PaymentInput struct {
	Amount        float64
	Type          string
	ProcessingFee float64
	PaidOn        time.Time
	// ReceivedByEmployeeID is nil for a customer-initiated online (Razorpay)
	// payment — see LoanPayment.ReceivedByEmployeeID's doc comment.
	ReceivedByEmployeeID *uint
	Method               string
	Reference            string
	Description          string
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
		if amount+epsilon < total {
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
	if in.InterestOverride != nil && *in.InterestOverride < 0 {
		return nil, ErrInvalidAmount
	}

	s.accrueAndSave(ctx, l)

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
		Method:               in.Method,
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
		if _, err := s.cashRecorder.RecordLoanPaymentCashIn(ctx, l.ID, l.LoanNumber, in.Amount, l.BranchID, in.PaidOn, in.Type); err != nil {
			log.Printf("cash-in movement (payment) failed for loan %d: %v", l.ID, err)
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
	if hadActiveAuction && l.Status != StatusClosed {
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

	var grossWeight float64
	for _, o := range l.Ornaments {
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
		Status:             BankPledgeStatusRecordActive,
	}
	if err := s.pledgeRepo.Create(ctx, p); err != nil {
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

	// Cash is touched ONLY when the operator explicitly chose CashIn. A
	// RecordOnly pledge is pure book-keeping: no movement at all, and
	// correspondingly no reversal on release (see ReleaseBankPledge).
	//
	// A pledge books cash IN only — the bank's advance is borrowing, not
	// spending, so no expense is recorded here. The expense is booked at
	// release (RecordBankPledgeReleaseExpense), when the money actually
	// goes back to the bank.
	if in.CashTreatment == BankPledgeCashTreatmentCashIn && s.cashRecorder != nil {
		movementID, err := s.cashRecorder.RecordBankPledgeCashIn(ctx, loanID, in.BankName, p.PledgedAmount, in.PledgeDate)
		if err != nil {
			log.Printf("cash-in movement (bank pledge) failed for loan %d: %v", loanID, err)
		} else {
			p.CashMovementID = &movementID
		}

		if err := s.pledgeRepo.Update(ctx, p); err != nil {
			log.Printf("saving cash movement link (bank pledge) failed for loan %d: %v", loanID, err)
		}
	}

	s.recordPledgeEvent(ctx, p, BankPledgeEventPledged, in.ActorEmployeeID, in.ActorRole, pledgeTreatmentRemark(in.CashTreatment))

	return s.Get(ctx, l.ID, nil)
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
// limit/offset semantics.
func (s *Service) ListConcludedAuctions(ctx context.Context, branchID *uint, hasSale *bool, limit, offset int) ([]ConcludedAuctionRow, int64, error) {
	return s.auctionRepo.FindAllConcluded(ctx, branchID, hasSale, limit, offset)
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

		if !fullyCovered {
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
			log.Printf("cash-out movement (auction surplus refund) failed for loan %d: %v", loanID, err)
		} else {
			rec.SurplusPaidOutMovementID = &movementID
		}
	}

	rec.SurplusDisposition = disposition
	if disposition == AuctionSurplusRefundedToCustomer {
		rec.FinalSettlementStatus = AuctionSettlementSettledToCustomer
	} else {
		rec.FinalSettlementStatus = AuctionSettlementSettledToLoanCo
	}
	rec.Stage = AuctionStageSettled
	if err := s.auctionRepo.Update(ctx, rec); err != nil {
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

	return s.getAuctionRecord(ctx, loanID)
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
			if !s.checkStagePermission(ctx, actorRoleID, "can decide auction partial repayment") {
				return ErrShortfallAuthorityRequired
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
			if !s.checkStagePermission(ctx, actorRoleID, "can decide auction shortfall") {
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
	if _, err := s.repo.FindByID(ctx, loanID); err != nil {
		return nil, ErrNotFound
	}
	if in.Months <= 0 {
		return nil, ErrInvalidMonths
	}
	requestedBy := in.RequestedBy
	if requestedBy == "" {
		requestedBy = RequestedByStaff
	}
	months := in.Months
	req := &LoanRequest{
		LoanID:                   loanID,
		Type:                     RequestTypeExtension,
		Status:                   RequestStatusPending,
		RequestedBy:              requestedBy,
		Detail:                   in.Detail,
		RequestedExtensionMonths: &months,
		ApprovalStage:            ApprovalStagePendingLoanOfficer,
		RequestedAt:              time.Now(),
	}
	if err := s.requestRepo.Create(ctx, req); err != nil {
		return nil, err
	}
	return s.requestRepo.FindByID(ctx, req.ID)
}

// ReleaseRequestInput mirrors the body of POST /loans/:id/release-request.
type ReleaseRequestInput struct {
	Detail      string
	RequestedBy string // "Customer" | "Staff"; defaults to "Staff" if empty
}

// CreateReleaseRequest logs a customer's ask to close a loan and take the
// pledged gold back. It does not itself close the loan — staff must Approve
// it via DecideRequest, which moves the loan to Closure Requested; actual
// closure still happens through the existing full-settlement payment flow.
func (s *Service) CreateReleaseRequest(ctx context.Context, loanID uint, in ReleaseRequestInput) (*LoanRequest, error) {
	if _, err := s.repo.FindByID(ctx, loanID); err != nil {
		return nil, ErrNotFound
	}
	requestedBy := in.RequestedBy
	if requestedBy == "" {
		requestedBy = RequestedByStaff
	}
	req := &LoanRequest{
		LoanID:      loanID,
		Type:        RequestTypeRelease,
		Status:      RequestStatusPending,
		RequestedBy: requestedBy,
		Detail:      in.Detail,
		RequestedAt: time.Now(),
	}
	if err := s.requestRepo.Create(ctx, req); err != nil {
		return nil, err
	}
	return s.requestRepo.FindByID(ctx, req.ID)
}

func (s *Service) ListRequests(ctx context.Context, f LoanRequestFilter) ([]LoanRequest, int64, error) {
	reqs, total, err := s.requestRepo.FindAll(ctx, f)
	if err != nil {
		return nil, 0, err
	}
	for i := range reqs {
		s.syncPaymentVerified(ctx, &reqs[i])
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
	s.syncPaymentVerified(ctx, req)
	return req, nil
}

// syncPaymentVerified keeps a pending Release request's PaymentVerified
// checklist item honest against the loan's LIVE balance, so the Record
// Payment checkbox reflects reality regardless of how the balance actually
// got cleared — RecordReleasePayment's own increments (which already tick
// it directly), or the loan's ordinary Record Payment screen used instead,
// which this package otherwise has no visibility into. Cheap in the common
// case (already true, or not a pending Release request) — the one real
// Get(loanID) call, with its accrual/enrich cost, only happens for a
// pending Release request still waiting on this one checklist item.
// Errors are swallowed: this is a best-effort read-time refresh, not
// something that should fail whatever endpoint called it.
func (s *Service) syncPaymentVerified(ctx context.Context, req *LoanRequest) {
	if req.Type != RequestTypeRelease || req.Status != RequestStatusPending || req.PaymentVerified {
		return
	}
	l, err := s.Get(ctx, req.LoanID, nil)
	if err != nil {
		return
	}
	if l.TotalOutstandingBalance <= 0.01 {
		req.PaymentVerified = true
		req.PaymentDueDate = nil
		_ = s.requestRepo.Update(ctx, req)
	}
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
// nothing left to extend or release — Closed, Auctioned, or Defaulted.
// Everything else (Overdue, Due Soon, Closure Requested, ...) is left to
// staff judgment, per the extension business rules.
func isLoanTerminal(status string) bool {
	return status == StatusClosed || status == StatusAuctioned || status == StatusDefaulted
}

// ChecklistInput mirrors the body of PUT /loans/requests/:requestId/verify.
type ChecklistInput struct {
	PaymentVerified    *bool
	PacketVerified     *bool
	BankPledgeVerified *bool
	CustomerConfirmed  *bool
	VerificationNotes  *string
	Charges            *float64
	ActorRoleID        uint // authz.Role.ID — must hold "can verify release checklist"
}

// VerifyReleaseChecklist updates one or more of a pending Release request's
// verification-checklist items. Callable repeatedly as staff confirm each
// item in person (payment settled, packet location, bank pledge status,
// customer confirmation) — ApproveReleaseRequest refuses the first approval
// stage until all four are true. Previously had no role gate at all — any
// authenticated caller could verify a release checklist; now requires "can
// verify release checklist" (see internal/authz.Catalogue).
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

	if in.PaymentVerified != nil {
		if *in.PaymentVerified {
			// Balance can clear through paths this package never sees the
			// increments of (e.g. the loan's own ordinary Record Payment
			// screen, used directly instead of this review screen's
			// Discount/Payment fields) — RecordReleasePayment isn't the
			// only way PaymentVerified should ever become true, but ticking
			// it must still mean the balance is genuinely settled, not just
			// staff's say-so.
			l, err := s.Get(ctx, req.LoanID, nil)
			if err != nil {
				return nil, err
			}
			if l.TotalOutstandingBalance > 0.01 {
				return nil, ErrPaymentNotCleared
			}
			req.PaymentDueDate = nil
		}
		req.PaymentVerified = *in.PaymentVerified
	}
	if in.PacketVerified != nil {
		req.PacketVerified = *in.PacketVerified
	}
	if in.BankPledgeVerified != nil {
		if *in.BankPledgeVerified {
			// Same reasoning as PaymentVerified above: ticking this must mean
			// there's genuinely no active bank pledge left, not just staff's
			// say-so — otherwise the checklist could be marked complete and
			// sail through Manager approval, only for the final Management
			// stage's own CompleteRelease call to fail with
			// ErrBankPledgeStillActive, well after staff believed this item
			// was already confirmed. Checked the same way CompleteRelease
			// itself does: the loan's own stored status first (cheap, covers
			// the normal case), then the pledge RECORDS (in case that string
			// has drifted away from an already-open record).
			l, err := s.Get(ctx, req.LoanID, nil)
			if err != nil {
				return nil, err
			}
			hasActivePledge, err := s.pledgeRepo.HasActive(ctx, req.LoanID)
			if err != nil {
				return nil, err
			}
			if l.BankPledgeStatus == BankPledgeStatusPledged || hasActivePledge {
				return nil, ErrBankPledgeStillActive
			}
		}
		req.BankPledgeVerified = *in.BankPledgeVerified
	}
	if in.CustomerConfirmed != nil {
		req.CustomerConfirmed = *in.CustomerConfirmed
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
// POST /loans/requests/:requestId/release-payment.
type ReleasePaymentInput struct {
	Discount float64
	Payment  float64
	// DueDate is required only when Discount+Payment don't cover the final
	// settlement (see RecordReleasePayment).
	DueDate         *time.Time
	ActorEmployeeID uint
	ActorRoleID     uint // authz.Role.ID — must hold "can verify release checklist"
}

// RecordReleasePayment is the "Record Payment" step on the Manager-stage
// release review screen: staff enter a Discount (a negotiated reduction,
// posted as a no-cash PaymentTypeDiscount ledger entry) and/or a Payment
// (real cash, posted as PaymentTypePartial) directly against the loan.
//
// This used to also close the loan out immediately and force the request to
// Approved the moment the balance hit zero — completely bypassing
// ApproveReleaseRequest's Manager→Management sign-off chain, so a single
// "can verify release checklist" actor could hand gold back on their own.
// It no longer does either: recording a payment only ever records the
// payment. If the two together clear the balance, that only flips the
// checklist's PaymentVerified flag (one of the four checkboxes
// ApproveReleaseRequest requires complete before its chain will even start —
// see ErrChecklistIncomplete) and clears any stored PaymentDueDate; the
// request stays Pending and must still go through the ordinary Manager then
// Management approval, and CompleteRelease (the actual hand-the-gold-back
// step), like any other release. If they fall short, the shortfall stays
// outstanding and DueDate is stored so the Requests list/review screen can
// flag it red once that date passes unpaid.
//
// Only callable while the request is still at (or before) the Manager
// stage — see ErrNotManagerStage.
func (s *Service) RecordReleasePayment(ctx context.Context, requestID uint, branchID *uint, in ReleasePaymentInput) (*LoanRequest, error) {
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
	if req.ApprovalStage != "" && req.ApprovalStage != ApprovalStagePendingManager {
		return nil, ErrNotManagerStage
	}
	if !s.checkStagePermission(ctx, in.ActorRoleID, "can verify release checklist") {
		return nil, ErrWrongStage
	}
	if in.Discount < 0 || in.Payment < 0 {
		return nil, ErrInvalidAmount
	}

	// Charges (the staff-entered release charges override) is a real amount
	// owed on top of the loan's own outstanding balance, but it is never
	// itself part of that balance — allocatePayment's buckets only ever
	// track fee/penal/interest/principal. It is folded into the SAME
	// Payment call below as PaymentInput.ProcessingFee (the "charge it, then
	// let this same call collect it" mechanism ordinary loan payments
	// already use), fee being allocatePayment's first-priority bucket — so
	// Payment must cover Outstanding + Charges − Discount, exactly the
	// on-screen "Final Settlement" figure, and a Payment that falls short
	// still fails with ErrExceedsOutstanding ("amount does not match what is
	// owed"), same as any other shortfall. chargeDelta (not the raw Charges
	// total) is used so re-recording after Charges was already added in a
	// previous Save Payment click never re-charges the same rupees twice.
	chargeDelta := platform.RoundMoney(req.Charges - req.ChargesApplied)
	if chargeDelta < 0 {
		chargeDelta = 0
	}

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
	// Payment carries chargeDelta even when in.Payment is 0 — Charges must
	// still get billed and collected on its own if that's the only thing
	// left to settle this round (e.g. Discount alone already covered the
	// rest of the balance).
	paymentAmount := in.Payment
	if chargeDelta > 0.01 && paymentAmount <= 0 {
		paymentAmount = chargeDelta
	}
	if paymentAmount > 0 {
		if _, err := s.RecordPayment(ctx, req.LoanID, PaymentInput{
			Amount:               paymentAmount,
			Type:                 PaymentTypePartial,
			ProcessingFee:        chargeDelta,
			PaidOn:               time.Now(),
			ReceivedByEmployeeID: &in.ActorEmployeeID,
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
	req.RecordedPayment = platform.RoundMoney(req.RecordedPayment + in.Payment)

	if l.TotalOutstandingBalance <= 0.01 {
		// Balance cleared — that satisfies the PaymentVerified checklist item,
		// nothing more. The request stays Pending: ApproveReleaseRequest's own
		// Manager→Management chain (gated on the full checklist, including
		// this flag) is still required before the gold can actually be
		// released via CompleteRelease.
		req.PaymentVerified = true
		req.PaymentDueDate = nil
	} else {
		if in.DueDate == nil {
			return nil, ErrDueDateRequired
		}
		req.PaymentDueDate = in.DueDate
	}

	if err := s.requestRepo.Update(ctx, req); err != nil {
		return nil, err
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
// same workflow as loan sanctioning. The chain cannot even start until the
// verification checklist (VerifyReleaseChecklist) is fully complete. A
// Rejected action at either stage only rejects the request — the loan is
// untouched. The final Approved action (Management stage) snapshots
// SettlementAmount = Loan.TotalOutstandingBalance + Charges and moves the
// loan to StatusClosureRequested; CompleteRelease (below) does the actual
// hand-back once the settlement is fully paid.
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
	// Refresh PaymentVerified against the loan's live balance first — the
	// balance may have cleared through the loan's ordinary Record Payment
	// screen rather than this package's own RecordReleasePayment, which is
	// the only path that otherwise ever sets this flag directly.
	s.syncPaymentVerified(ctx, req)
	if !req.PaymentVerified || !req.PacketVerified || !req.BankPledgeVerified || !req.CustomerConfirmed {
		return nil, ErrChecklistIncomplete
	}

	stage := req.ApprovalStage
	if stage == "" {
		stage = ApprovalStagePendingManager
	}
	var expectedStage, requiredPermission string
	switch stage {
	case ApprovalStagePendingManager:
		expectedStage = "Manager"
		requiredPermission = "can approve release manager stage"
	case ApprovalStagePendingManagement:
		expectedStage = "Management"
		requiredPermission = "can approve release management stage"
	}
	if in.Stage != expectedStage {
		return nil, ErrWrongStage
	}
	// Previously had no role gate at all — any authenticated caller could
	// approve either release stage; now requires the matching "Approval
	// Workflow" permission (see internal/authz.Catalogue).
	if requiredPermission != "" && !s.checkStagePermission(ctx, in.ActorRoleID, requiredPermission) {
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

	finalApproval := false
	switch stage {
	case ApprovalStagePendingManager:
		req.ApprovalStage = ApprovalStagePendingManagement
	case ApprovalStagePendingManagement:
		req.ApprovalStage = ApprovalStageApproved
		finalApproval = true

		l, err := s.Get(ctx, req.LoanID, nil)
		if err != nil {
			return nil, err
		}
		req.SettlementAmount = l.TotalOutstandingBalance + req.Charges
		l.Status = StatusClosureRequested
		if err := s.repo.Update(ctx, l); err != nil {
			return nil, err
		}

		req.Status = RequestStatusApproved
		now := time.Now()
		req.DecidedAt = &now
		req.DecidedByEmployeeID = &in.ActorEmployeeID
		req.Remarks = in.Remarks

		// Persist the Approved state before CompleteRelease runs: when the
		// balance isn't already fully cleared (an early release, paid off
		// afterward per the settlement schedule), CompleteRelease's own
		// guard looks up an Approved release request for this loan — it
		// must already be saved as Approved for that lookup to succeed.
		if err := s.requestRepo.Update(ctx, req); err != nil {
			return nil, err
		}
		//  Finish the release right here rather than leaving staff to find
		// and click a separate "Complete Release" action afterward —
		// Management approval was the last real decision point; once it's
		// given there is nothing left to authorize; see CompleteRelease's
		// own doc comment for what it still checks (bank pledge cleared,
		// balance settled) before it will actually hand the gold back.
		if _, err := s.CompleteRelease(ctx, req.LoanID, nil, in.ActorEmployeeID); err != nil {
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
				"Dear %s, your gold release request for loan %s has moved to the next approval stage (Management). — CloudHouse Finance",
				notifyLoan.Customer.Name, notifyLoan.LoanNumber,
			), commlog.TriggerReleaseRequest, "loan_request", req.ID)
		}
	}
	return s.requestRepo.FindByID(ctx, req.ID)
}

// extensionChain is the Extension-request chain's fixed stage order,
// mirroring sanctionChain above — index i's Permission must be held by the
// acting employee's role (see ApproveExtensionRequest and
// checkStagePermission) to advance from extensionChain[i]'s stage to the
// next one, or to ApprovalStageApproved for the last stage. Role is kept
// only as a display label — no longer used for authorization.
var extensionChain = []struct{ ApprovalStage, Stage, Role, Permission string }{
	{ApprovalStagePendingLoanOfficer, "LoanOfficer", "Loan Operator", "can verify the loan extension"},
	{ApprovalStagePendingBranchManager, "BranchManager", "Branch Manager", "can approve extension branch manager stage"},
	{ApprovalStagePendingManagement, "Management", "Management", "can approve extension management stage"},
}

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
	var expectedStage, requiredPermission string
	for _, step := range extensionChain {
		if step.ApprovalStage == stage {
			expectedStage = step.Stage
			requiredPermission = step.Permission
			break
		}
	}
	if in.Stage != expectedStage {
		return nil, ErrWrongStage
	}
	if requiredPermission != "" && !s.checkStagePermission(ctx, in.ActorRoleID, requiredPermission) {
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
			s.notifyCustomer(ctx, notifyLoan.CustomerID, notifyLoan.Customer.Phone, "Extension Rejected", s.brandedMessage(ctx,
				"Dear %s, your extension request for loan %s has been rejected. Please contact the branch for details. — CloudHouse Finance",
				notifyLoan.Customer.Name, notifyLoan.LoanNumber,
			), commlog.TriggerExtensionRequest, "loan_request", req.ID)
		}
		return s.requestRepo.FindByID(ctx, req.ID)
	}

	finalApproval := false
	var nextStageLabel string
	switch stage {
	case ApprovalStagePendingLoanOfficer:
		req.ApprovalStage = ApprovalStagePendingBranchManager
		nextStageLabel = "Branch Manager"
	case ApprovalStagePendingBranchManager:
		req.ApprovalStage = ApprovalStagePendingManagement
		nextStageLabel = "Management"
	case ApprovalStagePendingManagement:
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
		req.DecidedByEmployeeID = &in.ActorEmployeeID
		req.Remarks = in.Remarks
		finalApproval = true
		notifyLoan = l
	}

	if err := s.requestRepo.Update(ctx, req); err != nil {
		return nil, err
	}
	if notifyLoan != nil {
		if finalApproval {
			s.notifyCustomer(ctx, notifyLoan.CustomerID, notifyLoan.Customer.Phone, "Extension Approved", s.brandedMessage(ctx,
				"Dear %s, your extension request for loan %s has been fully approved. New due date: %s. — CloudHouse Finance",
				notifyLoan.Customer.Name, notifyLoan.LoanNumber, notifyLoan.DueDate.Format("02-Jan-2006"),
			), commlog.TriggerExtensionRequest, "loan_request", req.ID)
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
// approving the release request. It requires: an Approved Release request
// for this loan; the settlement fully paid (TotalOutstandingBalance <= 0 —
// every repayment recorded via RecordPayment has already reduced this
// automatically); and the bank pledge already released, if there was one.
// Only then does it move the loan's packet to Released and close the loan.
func (s *Service) CompleteRelease(ctx context.Context, loanID uint, branchID *uint, employeeID uint) (*Loan, error) {
	if _, err := s.requestRepo.FindApprovedReleaseByLoanID(ctx, loanID); err != nil {
		return nil, ErrReleaseNotApproved
	}

	l, err := s.Get(ctx, loanID, branchID)
	if err != nil {
		return nil, err
	}
	paidInFull := l.TotalOutstandingBalance <= 0.01
	if !paidInFull {
		if _, err := s.requestRepo.FindApprovedReleaseByLoanID(ctx, loanID); err != nil {
			return nil, ErrReleaseNotApproved
		}
	}
	if l.TotalOutstandingBalance > 0.01 {
		return nil, ErrOutstandingBalanceRemains
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

// ReleaseBankPledge reclaims a loan's gold from the bank. Its cash effect
// MIRRORS whatever was chosen when the pledge was created: a CashIn pledge
// books the amount back out, while a RecordOnly pledge is a symmetric no-op —
// nothing was booked in, so nothing is booked out. Without that symmetry a
// RecordOnly pledge would credit the till on release for money that never
// arrived.
func (s *Service) ReleaseBankPledge(ctx context.Context, loanID, pledgeID uint, branchID *uint, actorID *uint, actorRole string) (*Loan, error) {
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

	now := time.Now()
	p.ReleaseDate = &now
	p.Status = BankPledgeStatusRecordReleased
	if err := s.pledgeRepo.Update(ctx, p); err != nil {
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
		movementID, err := s.cashRecorder.RecordBankPledgeCashOut(ctx, loanID, p.BankName, p.PledgedAmount, now, l.BranchID)
		if err != nil {
			log.Printf("cash-out movement (bank release) failed for loan %d: %v", loanID, err)
		} else {
			p.ReleaseCashMovementID = &movementID
		}

		expenseID, err := s.cashRecorder.RecordBankPledgeReleaseExpense(ctx, loanID, p.BankName, p.PledgedAmount, now, l.BranchID)
		if err != nil {
			log.Printf("release expense entry (bank release) failed for loan %d: %v", loanID, err)
		} else {
			p.ReleaseExpenseID = &expenseID
		}

		if err := s.pledgeRepo.Update(ctx, p); err != nil {
			log.Printf("saving cash-out movement/expense links (bank release) failed for loan %d: %v", loanID, err)
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
		movementID, err := s.cashRecorder.RecordBankPledgeCashOut(ctx, loanID, p.BankName, p.PledgedAmount, now, l.BranchID)
		if err != nil {
			log.Printf("compensating cash-out (pledge void) failed for loan %d: %v", loanID, err)
		} else {
			p.VoidCashMovementID = &movementID
		}
	}

	if err := s.pledgeRepo.Update(ctx, p); err != nil {
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
func (s *Service) ListBankPledgeHistory(ctx context.Context, branchID *uint, limit, offset int) ([]BankPledgeRecord, int64, error) {
	return s.pledgeRepo.FindAllHistory(ctx, branchID, limit, offset)
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
func (s *Service) ListLoansForCustomer(ctx context.Context, customerID uint, from, to *time.Time, limit, offset int) ([]Loan, int64, error) {
	// The customer is resolved first, exactly as the four sibling sub-table
	// methods below do. This was the one of the five that omitted it, so it
	// answered 200 with an empty list for a customer belonging to another
	// business while the others answered 404 — found by the isolation
	// harness. The customer lookup runs under the caller's tenant, so
	// another business's customer is simply not found.
	if _, err := s.customerRepo.FindByID(ctx, customerID); err != nil {
		return nil, 0, ErrCustomerInvalid
	}
	return s.List(ctx, LoanFilter{CustomerID: customerID, OpenedFrom: from, OpenedTo: to, Limit: limit, Offset: offset})
}

// ListOrnamentsForCustomer paginates every ornament pledged across every
// loan belonging to customerID — backs GET /customers/:id/ornaments, the
// Customer 360 view's Pledged Ornaments sub-table.
func (s *Service) ListOrnamentsForCustomer(ctx context.Context, customerID uint, from, to *time.Time, limit, offset int) ([]CustomerOrnamentRow, int64, error) {
	if _, err := s.customerRepo.FindByID(ctx, customerID); err != nil {
		return nil, 0, ErrCustomerInvalid
	}
	return s.ornamentRepo.FindByCustomerID(ctx, customerID, from, to, limit, offset)
}

// ListPaymentsForCustomer paginates every payment across every loan
// belonging to customerID — backs GET /customers/:id/payments, the
// Customer 360 view's Payment History sub-table.
func (s *Service) ListPaymentsForCustomer(ctx context.Context, customerID uint, from, to *time.Time, limit, offset int) ([]CustomerPaymentRow, int64, error) {
	if _, err := s.customerRepo.FindByID(ctx, customerID); err != nil {
		return nil, 0, ErrCustomerInvalid
	}
	return s.paymentRepo.FindByCustomerIDForProfile(ctx, customerID, from, to, limit, offset)
}

// ListBankPledgesForCustomer paginates every re-pledge record across every
// loan belonging to customerID — backs GET /customers/:id/bank-pledges, the
// Customer 360 view's Bank Pledges sub-table.
func (s *Service) ListBankPledgesForCustomer(ctx context.Context, customerID uint, from, to *time.Time, limit, offset int) ([]CustomerBankPledgeRow, int64, error) {
	if _, err := s.customerRepo.FindByID(ctx, customerID); err != nil {
		return nil, 0, ErrCustomerInvalid
	}
	return s.pledgeRepo.FindAllByCustomerID(ctx, customerID, from, to, limit, offset)
}

// ListAuctionHistoryForCustomer paginates every auction case ever opened
// across every loan belonging to customerID — backs
// GET /customers/:id/auction-history, the Customer 360 view's Auction
// History sub-table.
func (s *Service) ListAuctionHistoryForCustomer(ctx context.Context, customerID uint, from, to *time.Time, limit, offset int) ([]CustomerAuctionRow, int64, error) {
	if _, err := s.customerRepo.FindByID(ctx, customerID); err != nil {
		return nil, 0, ErrCustomerInvalid
	}
	return s.auctionRepo.FindAllByCustomerID(ctx, customerID, from, to, limit, offset)
}

// --- Indemnity bond Aadhaar eSign (Setu) ------------------------------------

// bondDataForLoan builds the RenderIndemnityBondPDF input from a loan's
// preloaded Customer/Branch — same fields frontend/components/NewLoan.tsx's
// printIndemnity() assembles via buildDraft(), computed from the loan's own
// data rather than the pre-save draft it uses (this runs against a real,
// persisted loan — see StartIndemnityBondSign).
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

	return BondData{
		LoanNumber:      l.LoanNumber,
		CustomerName:    l.Customer.Name,
		Age:             age,
		Address:         l.Customer.Address,
		BranchName:      l.Branch.Name,
		Phone:           l.Customer.Phone,
		PAN:             l.Customer.PAN,
		Aadhaar:         aadhaar,
		PrincipalAmount: l.PrincipalAmount,
		InterestRate:    l.Scheme.InterestRate,
		Ornaments:       ornaments,
		Day:             now.Day(),
		Month:           now.Month().String(),
		Year:            now.Year(),
		BusinessName:    s.businessName(ctx),
	}
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
	if lang != BondLangEnglish && lang != BondLangMalayalam {
		return nil, ErrUnsupportedIndemnityBondLang
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

	pdfBytes, err := RenderIndemnityBondPDF(s.bondDataForLoan(ctx, l), lang)
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
		// WithoutCancel, not Background: the goroutine outlives the request
		// (whose ctx is cancelled the moment the handler returns, which would
		// abort the commlog write) but must keep every value on it — tenant
		// scope above all, since the commlog row is tenant-owned (see
		// platform.TenantScoped).
		bg := context.WithoutCancel(ctx)
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
				if err := s.commlogRepo.Create(bg, rec); err != nil {
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
