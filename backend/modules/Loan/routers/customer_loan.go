package routers

import (
	"cloudhouse/backend/auth"
	loan "cloudhouse/backend/modules/Loan/controllers"

	"github.com/labstack/echo/v4"
)

var customerLoanPath = "/api/v1/customers/:customer_id"

func CustomerLoanRoutes(e *echo.Echo) *echo.Echo {
	e.GET(customerLoanPath+"/loans", loan.CustomerListLoans, auth.Customer()...)
	e.GET(customerLoanPath+"/loans/:id", loan.CustomerGetLoan, auth.Customer()...)
	e.GET(customerLoanPath+"/loans/:id/requests", loan.CustomerListLoanRequests, auth.Customer()...)
	e.POST(customerLoanPath+"/loans/:id/extension-request", loan.CustomerCreateExtensionRequest, auth.Customer()...)
	e.POST(customerLoanPath+"/loans/:id/release-request", loan.CustomerCreateReleaseRequest, auth.Customer()...)
	e.POST(customerLoanPath+"/loans/:id/pay/create-order", loan.CustomerCreateRazorpayOrder, auth.Customer()...)
	e.POST(customerLoanPath+"/loans/:id/pay/verify", loan.CustomerVerifyRazorpayPayment, auth.Customer()...)
	e.GET(customerLoanPath+"/loans/:id/payments", loan.CustomerListLoanPayments, auth.Customer()...)
	e.GET(customerLoanPath+"/loans/:id/statement", loan.CustomerLoanStatement, auth.Customer()...)
	e.GET(customerLoanPath+"/loans/:id/indemnity-bond/esign/status", loan.CustomerCheckIndemnityBondEsign, auth.Customer()...)
	e.GET(customerLoanPath+"/payments", loan.CustomerListPayments, auth.Customer()...)
	e.GET(customerLoanPath+"/payments/:payment_id/receipt", loan.CustomerPaymentReceipt, auth.Customer()...)
	return e
}
