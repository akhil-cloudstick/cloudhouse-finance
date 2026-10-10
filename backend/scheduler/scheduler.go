package scheduler

import (
	"context"
	"log"

	"github.com/robfig/cron/v3"

	common "cloudhouse/backend/common/controllers"
	billing "cloudhouse/backend/modules/Billing/controllers"
	dashboard "cloudhouse/backend/modules/Dashboard/controllers"
	investment "cloudhouse/backend/modules/Investment/controllers"
	loan "cloudhouse/backend/modules/Loan/controllers"
	personalLoan "cloudhouse/backend/modules/PersonalLoan/controllers"
)

func StartCronJobs() {
	NotificationCronJobs()
	LoanCronJobs()
	PersonalLoanCronJobs()
	InvestmentCronJobs()
	BillingCronJobs()
	DashboardCronJobs()
	log.Println("Background jobs scheduled")
}

func NotificationCronJobs() {
	c := cron.New()
	c.AddFunc("@every 10m", func() {
		common.ForEachActive(context.Background(), "notification resend", func(ctx context.Context) error {
			common.ResendPending(ctx)
			return nil
		})
	})
	c.Start()
}

func LoanCronJobs() {
	c := cron.New()
	c.AddFunc("@every 1h", func() {
		common.ForEachActive(context.Background(), "due/overdue sweep", func(ctx context.Context) error {
			loan.CheckDueAndOverdueLoans(ctx)
			return nil
		})
	})
	c.Start()
}

func PersonalLoanCronJobs() {
	c := cron.New()
	c.AddFunc("@every 1h", func() {
		common.ForEachActive(context.Background(), "personal loan penal interest sweep", personalLoan.SweepPenalInterest)
	})
	c.Start()
}

func InvestmentCronJobs() {
	c := cron.New()
	c.AddFunc("@every 1h", func() {
		common.ForEachActive(context.Background(), "investment maturity sweep", investment.SweepMaturities)
	})
	c.Start()
}

func BillingCronJobs() {
	c := cron.New()
	c.AddFunc("@every 6h", func() {
		billing.NotifyExpiringSubscriptions(context.Background())
	})
	c.Start()
}

func DashboardCronJobs() {
	capture := func() {
		common.ForEachActive(context.Background(), "dashboard snapshot", dashboard.CaptureDailySnapshot)
	}
	go capture()
	c := cron.New()
	c.AddFunc("@every 1h", capture)
	c.Start()
}
