package demoseed

import (
	"cloudhouse/backend/internal/auditlog"
	"cloudhouse/backend/internal/authz"
	"cloudhouse/backend/internal/bank"
	"cloudhouse/backend/internal/branch"
	"cloudhouse/backend/internal/cash"
	"cloudhouse/backend/internal/commlog"
	"cloudhouse/backend/internal/customer"
	"cloudhouse/backend/internal/employee"
	"cloudhouse/backend/internal/goldrate"
	"cloudhouse/backend/internal/investment"
	"cloudhouse/backend/internal/loan"
	"cloudhouse/backend/internal/locker"
	"cloudhouse/backend/internal/notification"
	"cloudhouse/backend/internal/ornamenttype"
	"cloudhouse/backend/internal/packet"
	"cloudhouse/backend/internal/personalloan"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/puritystandard"
	"cloudhouse/backend/internal/reminder"
	"cloudhouse/backend/internal/scheme"
	"cloudhouse/backend/internal/tenant"
	"cloudhouse/backend/internal/upload"

	"gorm.io/gorm"
)

// Deps is the seeder's own service graph.
//
// IT IS DELIBERATELY NOT app.Build's GRAPH, AND THIS IS THE MOST IMPORTANT
// DECISION IN THE PACKAGE.
//
// app.Build wires loan.Service to the live WhatsApp sender. loan.Service's
// notifyCustomer fires `go s.whatsapp.Send(...)` on every loan create, every
// sanction step, every payment, every auction event and every notice. Seeding
// thirty loans through that graph would text roughly a hundred and fifty
// fabricated Indian phone numbers through the operator's real OpenWA instance
// — in the middle of a client meeting — burn the per-business daily quota in
// usage_counters, and make the reseed non-deterministic, because the commlog
// rows those goroutines write land whenever they land.
//
// So every outbound channel is nil here. The nil-safety is not accidental:
// loan.Service guards notifier, whatsapp, commlogRepo, cashRecorder,
// packetCreator and packetMover before use. Communication logs and
// notifications are seeded directly instead (see seed_comms.go), which is
// both deterministic and faster.
//
// The one dependency that MUST be real is permChecker. loan.Service's
// checkStagePermission fails CLOSED when it is nil, so a nil checker would
// make Approve and every auction transition refuse, and the dataset would be
// thirty loans stuck at the first sanction stage.
type Deps struct {
	db  *gorm.DB
	cfg platform.Config

	// aadhaarCipher is retained only so hasAadhaarCipher can report whether
	// the customers seeder may supply an Aadhaar number.
	aadhaarCipher *platform.Cipher

	tenantRepo *tenant.Repository
	authzRepo  *authz.Repository
	auditRepo  *auditlog.Repository

	branchRepo   *branch.Repository
	employeeRepo *employee.Repository
	customerRepo *customer.Repository
	loanRepo     *loan.Repository
	auctionRepo  *loan.AuctionRepository
	uploadRepo   *upload.Repository
	packetRepo   *packet.Repository
	ornamentRepo *loan.OrnamentRepository
	commlogRepo  *commlog.Repository
	notifRepo    *notification.Repository

	branchSvc     *branch.Service
	employeeSvc   *employee.Service
	customerSvc   *customer.Service
	schemeSvc     *scheme.Service
	goldRateSvc   *goldrate.Service
	lockerSvc     *locker.Service
	bankSvc       *bank.Service
	ornTypeSvc    *ornamenttype.Service
	puritySvc     *puritystandard.Service
	packetSvc     *packet.Service
	loanSvc       *loan.Service
	movementSvc   *cash.MovementService
	expenseSvc    *cash.ExpenseService
	openingSvc    *cash.OpeningBalanceService
	personalSvc   *personalloan.Service
	reminderSvc   *reminder.Service
	investmentSvc *investment.Service
}

// NewDeps builds the graph.
//
// It must not issue a single query. internal/app/isolation_test.go constructs
// the whole router against a *gorm.DB whose connection is never opened, so a
// constructor that reads from the database would turn TestEveryRouteIsClassified
// red on any machine without Postgres — and that test is the one thing
// standing between a mis-classified route and a wiped test database.
func NewDeps(db *gorm.DB, cfg platform.Config) *Deps {
	tenantRepo := tenant.NewRepository(db)
	authzRepo := authz.NewRepository(db)
	auditRepo := auditlog.NewRepository(db)

	branchRepo := branch.NewRepository(db)
	employeeRepo := employee.NewRepository(db)
	customerRepo := customer.NewRepository(db)
	schemeRepo := scheme.NewRepository(db)
	goldRateRepo := goldrate.NewRepository(db)
	lockerRepo := locker.NewRepository(db)
	packetRepo := packet.NewRepository(db)
	bankRepo := bank.NewRepository(db)
	ornTypeRepo := ornamenttype.NewRepository(db)
	purityRepo := puritystandard.NewRepository(db)
	uploadRepo := upload.NewRepository(db)
	commlogRepo := commlog.NewRepository(db, db)
	notifRepo := notification.NewRepository(db)

	loanRepo := loan.NewRepository(db)
	ornamentRepo := loan.NewOrnamentRepository(db)
	approvalRepo := loan.NewApprovalRepository(db)
	paymentRepo := loan.NewPaymentRepository(db)
	pledgeRepo := loan.NewBankPledgeRepository(db)
	requestRepo := loan.NewLoanRequestRepository(db)
	requestApprovalRepo := loan.NewRequestApprovalRepository(db)
	auctionRepo := loan.NewAuctionRepository(db)
	approvalLimitRepo := loan.NewApprovalLimitRepository(db)

	movementRepo := cash.NewMovementRepository(db)
	expenseRepo := cash.NewExpenseRepository(db)
	openingRepo := cash.NewOpeningBalanceRepository(db)

	// The repos satisfy each other's narrow interfaces (locker.PacketCounter
	// and packet.LockerCapacityProvider), so neither service depends on the
	// other and there is no construction order problem.
	packetSvc := packet.NewService(packetRepo, lockerRepo)
	lockerSvc := locker.NewService(lockerRepo, branchRepo, packetRepo)
	movementSvc := cash.NewMovementService(movementRepo, expenseRepo, branchRepo)

	// Aadhaar cipher: real, so the six customers given an Aadhaar number show
	// a last-four in the UI like production data does. An error here is not
	// fatal — NewAadhaarCipher only fails on a malformed key, and a nil
	// cipher just means customer.Service.Create rejects any input carrying an
	// Aadhaar, which seed_customers.go handles by omitting it.
	aadhaarCipher, err := platform.NewAadhaarCipher(cfg.AadhaarEncryptionKey)
	if err != nil {
		aadhaarCipher = nil
	}

	// Built here rather than inline in the literal below because reminderSvc
	// takes it as a dependency.
	personalSvc := personalloan.NewService(personalloan.NewRepository(db), customerRepo, movementSvc, aadhaarCipher)

	loanSvc := loan.NewService(
		db,
		loanRepo,
		ornamentRepo,
		approvalRepo,
		paymentRepo,
		pledgeRepo,
		requestRepo,
		requestApprovalRepo,
		auctionRepo,
		approvalLimitRepo,
		branchRepo,
		customerRepo,
		schemeRepo,
		goldRateRepo,
		packetSvc,   // packetCreator — wanted: every loan gets its packet
		packetSvc,   // packetMover
		movementSvc, // cashRecorder — wanted: disbursements and receipts move cash
		nil,         // notifier: no WebSocket push for fabricated customers
		nil,         // whatsapp: see the type comment. This one matters most.
		nil,         // commlogRepo: only written from the whatsapp goroutine; seeded directly
		nil,         // esign: would call Setu for real
		cfg.UploadsDir,
		uploadRepo,
		tenantRepo,
		nil,           // razorpay: would call Razorpay for real
		aadhaarCipher, //
		authzRepo,     // permChecker — MUST be real; fails closed when nil
	)

	return &Deps{
		db:  db,
		cfg: cfg,

		aadhaarCipher: aadhaarCipher,

		tenantRepo: tenantRepo,
		authzRepo:  authzRepo,
		auditRepo:  auditRepo,

		branchRepo:   branchRepo,
		employeeRepo: employeeRepo,
		customerRepo: customerRepo,
		loanRepo:     loanRepo,
		auctionRepo:  auctionRepo,
		uploadRepo:   uploadRepo,
		packetRepo:   packetRepo,
		ornamentRepo: ornamentRepo,
		commlogRepo:  commlogRepo,
		notifRepo:    notifRepo,

		branchSvc:   branch.NewService(branchRepo, tenantRepo, auditRepo),
		employeeSvc: employee.NewService(employeeRepo, branchRepo, authzRepo, auditRepo),
		// setu and digilocker nil: the only paths that use them are the
		// explicit PAN/Aadhaar verify endpoints, never Create.
		customerSvc: customer.NewService(db, customerRepo, branchRepo, aadhaarCipher, nil, nil),
		schemeSvc:   scheme.NewService(schemeRepo, branchRepo),
		goldRateSvc: goldrate.NewService(goldRateRepo),
		lockerSvc:   lockerSvc,
		bankSvc:     bank.NewService(bankRepo),
		ornTypeSvc:  ornamenttype.NewService(ornTypeRepo),
		puritySvc:   puritystandard.NewService(purityRepo),
		packetSvc:   packetSvc,
		loanSvc:     loanSvc,
		movementSvc: movementSvc,
		expenseSvc:  cash.NewExpenseService(expenseRepo, branchRepo),
		openingSvc:  cash.NewOpeningBalanceService(openingRepo, branchRepo),
		personalSvc: personalSvc,
		// whatsapp and commlogRepo nil for the same reason as loanSvc: the
		// due/overdue sweep is the only thing that sends, and a reset must not.
		reminderSvc: reminder.NewService(reminder.NewRepository(db), customerRepo, loanRepo, personalSvc, auctionRepo, nil, nil, tenantRepo),
		// comms nil: investment.Service only uses it to announce payouts and
		// maturity over WhatsApp.
		investmentSvc: investment.NewService(investment.NewRepository(db), customerRepo, movementSvc, nil, tenantRepo),
	}
}

// hasAadhaarCipher reports whether customer records can carry an encrypted
// Aadhaar number. customer.Service.Create rejects an Aadhaar it cannot
// encrypt, so the customers seeder asks before supplying one — which keeps
// the reset working on a deployment that has not configured
// AADHAAR_ENCRYPTION_KEY, just with the last-four column blank.
func (d *Deps) hasAadhaarCipher() bool { return d.aadhaarCipher != nil }
