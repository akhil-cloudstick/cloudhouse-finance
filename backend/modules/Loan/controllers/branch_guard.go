package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"

	"github.com/labstack/echo/v4"
)

// branchAllows reports whether a caller scoped to `scope` may touch a loan that
// belongs to loanBranch. A nil scope is an unrestricted (cross-branch) caller.
func branchAllows(loanBranch uint, scope *uint) bool {
	return scope == nil || loanBranch == *scope
}

// branchGuard builds route middleware that answers 404 "loan not found" when the
// loan a request addresses belongs to another branch than the caller's. resolve
// returns the loan id for the request; it runs only for branch-scoped callers.
func branchGuard(resolve func(c echo.Context) (uint, error)) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			scope := auth.GetBranchScope(c)
			if scope == nil {
				return next(c)
			}
			loanID, err := resolve(c)
			if err != nil {
				return common.FailErr(c, err)
			}
			if err := checkLoanBranch(auth.RequestContext(c), loanID, scope); err != nil {
				return common.FailErr(c, err)
			}
			return next(c)
		}
	}
}

// GuardLoanBranch protects routes addressed by the loan id path param (":id").
func GuardLoanBranch() echo.MiddlewareFunc {
	return branchGuard(func(c echo.Context) (uint, error) {
		return common.IDParam(c, "id")
	})
}

// GuardLoanBranchByNumber protects routes addressed by ":loan_number".
func GuardLoanBranchByNumber() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			scope := auth.GetBranchScope(c)
			if scope == nil {
				return next(c)
			}
			var l models.Loan
			if err := config.DB.WithContext(auth.RequestContext(c)).
				Select("id", "branch_id").
				Where("loan_number = ?", c.Param("loan_number")).First(&l).Error; err != nil {
				return common.FailErr(c, common.NewNotFound("loan not found"))
			}
			if !branchAllows(l.BranchID, scope) {
				return common.FailErr(c, common.NewNotFound("loan not found"))
			}
			return next(c)
		}
	}
}

// GuardOrnamentBranch protects routes addressed by ":ornament_id" by resolving
// the ornament to its loan.
func GuardOrnamentBranch() echo.MiddlewareFunc {
	return branchGuard(func(c echo.Context) (uint, error) {
		id, err := common.IDParam(c, "ornament_id")
		if err != nil {
			return 0, err
		}
		var o models.Ornament
		if err := config.DB.WithContext(auth.RequestContext(c)).
			Select("id", "loan_id").First(&o, id).Error; err != nil {
			return 0, common.NewNotFound("ornament not found")
		}
		return o.LoanID, nil
	})
}
