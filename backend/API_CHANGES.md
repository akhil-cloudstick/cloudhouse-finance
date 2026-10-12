# API contract changes

Every change the backend made to its HTTP contract. Apply these in `frontend/`, `mobile/` and `customer-mobile/`.

## Round 3 (code restructure, contract unchanged)

- No path, verb, request field or response field changed; the apps need no update.
- Fixed: `PATCH /api/v1/users/:user_id/loans/requests/:request_id/verify` now reads `customer_saw_gold` and `verification_notes` (snake_case, as the apps send them). Before this fix every call answered 400 "Invalid input", so "Customer has seen the gold" could not be ticked.
- Migrations are one file per module and every create file is additive and idempotent: on an existing database only missing pieces are added, no row is changed. The 32 missing foreign-key indexes are built with `CREATE INDEX CONCURRENTLY`.
- The separate `migrate` container/command is gone: the server applies migrations on boot (`docker compose up -d --build`).

## 1. General rules

| Area | Before | After |
|---|---|---|
| Prefix | `/api/v1` | `/api/v1` (unchanged) |
| Staff routes | `/api/v1/<entity>…` | `/api/v1/users/:user_id/<entity>…`, where `:user_id` is the signed-in employee's id |
| Customer app routes | `/api/v1/customer/<entity>…` | `/api/v1/customers/:customer_id/<entity>…`, where `:customer_id` is the signed-in customer's id |
| Superadmin console | `/api/v1/superadmin/<entity>…` | `/api/v1/superadmin/users/:user_id/<entity>…` |
| Unchanged | | `/auth/*` (login, forgot/reset, me, qr), `/public/*`, `/customer/auth/*`, `/customer/ws`, `/superadmin/login`, `/uploads/*`, webhooks |
| Identity check | none | the id in the path must equal the token's user, otherwise **403** `This request does not belong to the signed-in user, please sign in again` |
| Update | `PUT /x/:id` | `PATCH /x/:id/update`; other `PUT` actions became `PATCH` on the same path |
| Delete | `DELETE /x/:id` | `DELETE /x/:id/delete`; sub-resource deletes such as `/:id/logo` keep their path |
| Success status | `201` on create | always `200` |
| JSON keys | camelCase | **snake_case** in request and response bodies (`isActive` → `is_active`), see section 4 |
| JWT claims | | unchanged; the token payload still uses `employeeId`, `tenantId` and so on |
| Errors | | unchanged envelope `{success:false, error}` with 400/401/403/404/409; never 500 |

## 2. Lists

Every paginated list now takes `?page=&limit=` (1-based) instead of `?limit=&offset=`.

- With `page` and `limit` set, you get one page. `limit` is capped at **500**.
- With `page=0`, `limit=0` or neither sent, you get every row. Exceptions: lists whose server already had a default page size (personal loans, investments, ledgers, dashboard activity) return their first page, and the envelope reports the real `page`/`limit` used.
- Response shape:

```json
{ "success": true, "message": { "page": 1, "limit": 20, "total": 134, "total_pages": 7, "data": [ ... ], "total_debit": 0, "total_credit": 0 } }
```

- This replaces `{success, data: [...]}` (no limit) and `{success, data: {items, hasMore, total}}` (with limit). Rows are now in `message.data`.
- List-level aggregates that used to sit next to `items` keep their (snake_case) names inside `message`. Examples: `total_debit`, `total_credit`, `page_balance`, `total_amount`, `total_balance`, `unassigned_balance`, `totals`, `counts`, `total_sold`, `total_cost`, `total_profit`.
- `has_more` is gone. A next page exists when `page < total_pages`. `total` is the row count across all pages (on an unpaged list it equals the number of rows returned). On the few lists that do not count their rows (customer notifications, loan sources, investment schedule and transactions, the customer's loan requests), `total` is absent and `total_pages` is `page + 1` when another page exists.
- The loan ledger (`GET …/loans/:id/ledger`) can open on a focus row. The `page` it returns is the page it actually landed on.
- Non-paginated endpoints that return an array (lookups, switchable branches, quota and so on) still return `{success, data: [...]}`.
- Reports (`…/reports/*`) keep their own shape `{success, data: {rows, totals, total_count}}` and their own `page` / `page_size` parameters; only the keys inside became snake_case. `expense-cashflow` now returns its rows newest day first, then branch name, so each page holds the same rows on every call; before, the order was random.

## 3. Query and path parameters

| Kind | Before | After |
|---|---|---|
| path | `bankId` | `bank_id` |
| path | `customerId` | `customer_id` |
| path | `draftId` | `draft_id` |
| path | `loanNumber` | `loan_number` |
| path | `ornamentId` | `ornament_id` |
| path | `paymentId` | `payment_id` |
| path | `payoutId` | `payout_id` |
| path | `pledgeId` | `pledge_id` |
| path | `requestId` | `request_id` |
| path | `topUpId` | `top_up_id` |
| query | `aadhaarStatus` | `aadhaar_status` |
| query | `active` | `is_active` |
| query | `activeOnly` | `active_only` |
| query | `auctionCase` | `auction_case` |
| query | `bankId` | `bank_id` |
| query | `bankPledgeStatus` | `bank_pledge_status` |
| query | `branchId` | `branch_id` |
| query | `branchIds` | `branch_ids` |
| query | `customerId` | `customer_id` |
| query | `customerIds` | `customer_ids` |
| query | `customerType` | `customer_type` |
| query | `entityType` | `entity_type` |
| query | `excludeBankPledged` | `exclude_bank_pledged` |
| query | `focusAmount` | `focus_amount` |
| query | `focusDate` | `focus_date` |
| query | `focusKey` | `focus_key` |
| query | `fromDate` | `from_date` |
| query | `hasSale` | `has_sale` |
| query | `loanId` | `loan_id` |
| query | `loanIds` | `loan_ids` |
| query | `loanNumber` | `loan_number` |
| query | `loanNumbers` | `loan_numbers` |
| query | `lockerId` | `locker_id` |
| query | `pageSize` | `page_size` |
| query | `panStatus` | `pan_status` |
| query | `q` | `search` |
| query | `riskLevel` | `risk_level` |
| query | `schemeId` | `scheme_id` |
| query | `tenantId` | `tenant_id` |
| query | `toDate` | `to_date` |
| query | `offset` | removed; use `page` |
| query | `pageSize` | `limit` (on the lists above) |

## 4. JSON field renames

Every camelCase key became snake_case by one rule: an underscore goes before each capital, then everything is lower-cased (`aadhaarLast4` → `aadhaar_last4`, `cashFlow7d` → `cash_flow7d`). The complete list of keys that changed, sorted (the same key changes the same way everywhere):

| Before | After |
|---|---|
| `aadhaarLast4` | `aadhaar_last4` |
| `aadhaarStatus` | `aadhaar_status` |
| `accentColor` | `accent_color` |
| `accountNo` | `account_no` |
| `accruedInterest` | `accrued_interest` |
| `accruedOn` | `accrued_on` |
| `accruedPenalInterest` | `accrued_penal_interest` |
| `actionLabel` | `action_label` |
| `activeCount` | `active_count` |
| `activeLoanCount` | `active_loan_count` |
| `actorEmployeeId` | `actor_employee_id` |
| `actorName` | `actor_name` |
| `actorRole` | `actor_role` |
| `additionalInfo` | `additional_info` |
| `overallPhotoUrl` | `overall_photo_url` |
| `addressLine` | `address_line` |
| `addressProofUrl` | `address_proof_url` |
| `adminName` | `admin_name` |
| `adminPassword` | `admin_password` |
| `adminPhone` | `admin_phone` |
| `adminUsername` | `admin_username` |
| `amountInPaise` | `amount_in_paise` |
| `amountPaid` | `amount_paid` |
| `appUrl` | `app_url` |
| `approvalStage` | `approval_stage` |
| `approvalWarning` | `approval_warning` |
| `approvalsCount` | `approvals_count` |
| `approvedAt` | `approved_at` |
| `approvedBy` | `approved_by` |
| `assetsValue` | `assets_value` |
| `atRisk` | `at_risk` |
| `auctionAmount` | `auction_amount` |
| `auctionDate` | `auction_date` |
| `auctionEligibleDate` | `auction_eligible_date` |
| `auctionExpenses` | `auction_expenses` |
| `auctionHistory` | `auction_history` |
| `auctionRecordId` | `auction_record_id` |
| `auctionReferenceNumber` | `auction_reference_number` |
| `auctionRefunds` | `auction_refunds` |
| `auctionsCount` | `auctions_count` |
| `balanceDate` | `balance_date` |
| `bankAccountName` | `bank_account_name` |
| `bankAccountNumber` | `bank_account_number` |
| `bankBalance` | `bank_balance` |
| `bankId` | `bank_id` |
| `bankIfsc` | `bank_ifsc` |
| `bankInterestRate` | `bank_interest_rate` |
| `bankName` | `bank_name` |
| `bankPledgeDueDate` | `bank_pledge_due_date` |
| `bankPledgeRecordId` | `bank_pledge_record_id` |
| `bankPledgeStatus` | `bank_pledge_status` |
| `bankPledgeVerified` | `bank_pledge_verified` |
| `bankPledged` | `bank_pledged` |
| `bankPledges` | `bank_pledges` |
| `bankRef` | `bank_ref` |
| `bankReleases` | `bank_releases` |
| `bankTransferAmount` | `bank_transfer_amount` |
| `branchId` | `branch_id` |
| `branchName` | `branch_name` |
| `branchQuota` | `branch_quota` |
| `branchesTotal` | `branches_total` |
| `brandColor` | `brand_color` |
| `businessCode` | `business_code` |
| `businessStatus` | `business_status` |
| `canSwitch` | `can_switch` |
| `cashAmount` | `cash_amount` |
| `cashExpenses` | `cash_expenses` |
| `cashFlow7d` | `cash_flow7d` |
| `cashInHand` | `cash_in_hand` |
| `cashMovementId` | `cash_movement_id` |
| `cashTransactionGroupId` | `cash_transaction_group_id` |
| `cashTreatment` | `cash_treatment` |
| `categoryName` | `category_name` |
| `chargeBankId` | `charge_bank_id` |
| `chargeBankTransferAmount` | `charge_bank_transfer_amount` |
| `chargeCashAmount` | `charge_cash_amount` |
| `chargeChequeAmount` | `charge_cheque_amount` |
| `chargeUpiAmount` | `charge_upi_amount` |
| `chargesApplied` | `charges_applied` |
| `chatId` | `chat_id` |
| `chequeAmount` | `cheque_amount` |
| `closedAt` | `closed_at` |
| `closedLoanCount` | `closed_loan_count` |
| `closingAmount` | `closing_amount` |
| `closingCount` | `closing_count` |
| `collectionsAmount` | `collections_amount` |
| `collectionsBreakdown` | `collections_breakdown` |
| `collectionsCount` | `collections_count` |
| `contactPhone` | `contact_phone` |
| `contentType` | `content_type` |
| `costAmount` | `cost_amount` |
| `costCashMovementId` | `cost_cash_movement_id` |
| `counterBankId` | `counter_bank_id` |
| `counterBankRef` | `counter_bank_ref` |
| `createdAt` | `created_at` |
| `createdByEmployeeId` | `created_by_employee_id` |
| `currentGoldValue` | `current_gold_value` |
| `currentLockerId` | `current_locker_id` |
| `customerCode` | `customer_code` |
| `customerConfirmed` | `customer_confirmed` |
| `customerId` | `customer_id` |
| `customerName` | `customer_name` |
| `customerSawGold` | `customer_saw_gold` |
| `customerType` | `customer_type` |
| `daysOverdue` | `days_overdue` |
| `debitOrCredit` | `debit_or_credit` |
| `decidedAt` | `decided_at` |
| `decidedByEmployeeId` | `decided_by_employee_id` |
| `decidedByRole` | `decided_by_role` |
| `decisionRemarks` | `decision_remarks` |
| `decisionRequests` | `decision_requests` |
| `deductionWeight` | `deduction_weight` |
| `defaultEnabled` | `default_enabled` |
| `deliverBy` | `deliver_by` |
| `deliveredAt` | `delivered_at` |
| `deviceId` | `device_id` |
| `deviceToken` | `device_token` |
| `disbursedAmount` | `disbursed_amount` |
| `disbursedAt` | `disbursed_at` |
| `disbursementBankId` | `disbursement_bank_id` |
| `disbursementBankTransferAmount` | `disbursement_bank_transfer_amount` |
| `disbursementCashAmount` | `disbursement_cash_amount` |
| `disbursementChequeAmount` | `disbursement_cheque_amount` |
| `disbursementDate` | `disbursement_date` |
| `disbursementUpiAmount` | `disbursement_upi_amount` |
| `disbursementsBreakdown` | `disbursements_breakdown` |
| `documentId` | `document_id` |
| `draftId` | `draft_id` |
| `dueDate` | `due_date` |
| `dueSoon` | `due_soon` |
| `dueTodayCount` | `due_today_count` |
| `durationMonths` | `duration_months` |
| `durationMs` | `duration_ms` |
| `duringAmount` | `during_amount` |
| `duringCount` | `during_count` |
| `eligibleAmountAtTopUp` | `eligible_amount_at_top_up` |
| `eligibleLoanAmount` | `eligible_loan_amount` |
| `employeeId` | `employee_id` |
| `employeeName` | `employee_name` |
| `entityId` | `entity_id` |
| `entityName` | `entity_name` |
| `entityType` | `entity_type` |
| `errorMessage` | `error_message` |
| `excessAssetsOverLiabilities` | `excess_assets_over_liabilities` |
| `excessLiabilitiesOverAssets` | `excess_liabilities_over_assets` |
| `expectedCash` | `expected_cash` |
| `expenseId` | `expense_id` |
| `expensesToday` | `expenses_today` |
| `expiresAt` | `expires_at` |
| `expiresIn` | `expires_in` |
| `failureReasons` | `failure_reasons` |
| `fatherName` | `father_name` |
| `filesRemoved` | `files_removed` |
| `finalAction` | `final_action` |
| `finalSettlementStatus` | `final_settlement_status` |
| `finenessPercent` | `fineness_percent` |
| `fontFamily` | `font_family` |
| `fontScale` | `font_scale` |
| `fromBank` | `from_bank` |
| `fromBankId` | `from_bank_id` |
| `fromStatus` | `from_status` |
| `fullDisbursement` | `full_disbursement` |
| `goldPurchases` | `gold_purchases` |
| `goldRate` | `gold_rate` |
| `goldSales` | `gold_sales` |
| `goldValue` | `gold_value` |
| `goldWeight` | `gold_weight` |
| `gracePeriodDays` | `grace_period_days` |
| `gracePeriodEndsAt` | `grace_period_ends_at` |
| `grossGoldValue` | `gross_gold_value` |
| `grossWeight` | `gross_weight` |
| `hasGoldRate` | `has_gold_rate` |
| `hasMore` | `has_more` |
| `hasSignature` | `has_signature` |
| `hasSubscription` | `has_subscription` |
| `headerLayout` | `header_layout` |
| `identityProofUrl` | `identity_proof_url` |
| `imageName` | `image_name` |
| `imageUrls` | `image_urls` |
| `imageUrl` | `image_url` |
| `inCount` | `in_count` |
| `inLocker` | `in_locker` |
| `indemnityBondDocumentId` | `indemnity_bond_document_id` |
| `indemnityBondSignRequestId` | `indemnity_bond_sign_request_id` |
| `indemnityBondSignStatus` | `indemnity_bond_sign_status` |
| `indemnityBondSignedAt` | `indemnity_bond_signed_at` |
| `indemnityBondSignedUrl` | `indemnity_bond_signed_url` |
| `installmentAmount` | `installment_amount` |
| `installmentId` | `installment_id` |
| `interestAfter` | `interest_after` |
| `interestAmount` | `interest_amount` |
| `interestApplied` | `interest_applied` |
| `interestBefore` | `interest_before` |
| `interestCollected` | `interest_collected` |
| `interestMethod` | `interest_method` |
| `interestOverride` | `interest_override` |
| `interestPaid` | `interest_paid` |
| `interestRate` | `interest_rate` |
| `interestRatePercent` | `interest_rate_percent` |
| `interestRateType` | `interest_rate_type` |
| `interestType` | `interest_type` |
| `interestValue` | `interest_value` |
| `interestWithdrawn` | `interest_withdrawn` |
| `investmentId` | `investment_id` |
| `investmentNumber` | `investment_number` |
| `investmentsActive` | `investments_active` |
| `ipAddress` | `ip_address` |
| `isActive` | `is_active` |
| `isCommon` | `is_common` |
| `isDefaulted` | `is_defaulted` |
| `isDueSoon` | `is_due_soon` |
| `isLoan` | `is_loan` |
| `isOverdue` | `is_overdue` |
| `isPartial` | `is_partial` |
| `isPrincipalReturn` | `is_principal_return` |
| `isSet` | `is_set` |
| `isSystem` | `is_system` |
| `issuedAt` | `issued_at` |
| `keyId` | `key_id` |
| `kmlRegNo` | `kml_reg_no` |
| `kycDocumentUrl` | `kyc_document_url` |
| `kycStatus` | `kyc_status` |
| `lastAccrualDate` | `last_accrual_date` |
| `lastActivityAt` | `last_activity_at` |
| `lastAttemptAt` | `last_attempt_at` |
| `lastPayment` | `last_payment` |
| `lastPenalAppliedAt` | `last_penal_applied_at` |
| `legalName` | `legal_name` |
| `lenderAadhaar` | `lender_aadhaar` |
| `lenderAddress` | `lender_address` |
| `lenderAge` | `lender_age` |
| `lenderName` | `lender_name` |
| `lenderPan` | `lender_pan` |
| `liabilitiesValue` | `liabilities_value` |
| `loanCount` | `loan_count` |
| `loanDisbursements` | `loan_disbursements` |
| `loanId` | `loan_id` |
| `loanNumber` | `loan_number` |
| `loanOpenedAt` | `loan_opened_at` |
| `loanSource` | `loan_source` |
| `loansActive` | `loans_active` |
| `loansIssued` | `loans_issued` |
| `loansIssuedAmount` | `loans_issued_amount` |
| `loansProcessed` | `loans_processed` |
| `loansTotal` | `loans_total` |
| `lockerCode` | `locker_code` |
| `lockerId` | `locker_id` |
| `lockupTagline` | `lockup_tagline` |
| `logoDisplay` | `logo_display` |
| `logoScale` | `logo_scale` |
| `logoUrl` | `logo_url` |
| `ltvPercent` | `ltv_percent` |
| `matchedName` | `matched_name` |
| `maturityDate` | `maturity_date` |
| `maxAmount` | `max_amount` |
| `maxOutstanding` | `max_outstanding` |
| `maxOutstandingDate` | `max_outstanding_date` |
| `maxSteps` | `max_steps` |
| `messageBody` | `message_body` |
| `minEnabled` | `min_enabled` |
| `minPrincipal` | `min_principal` |
| `minimumDays` | `minimum_days` |
| `moduleName` | `module_name` |
| `movementCount` | `movement_count` |
| `navTextColor` | `nav_text_color` |
| `needsModeReview` | `needs_mode_review` |
| `netCashflow` | `net_cashflow` |
| `netWeight` | `net_weight` |
| `newCustomers` | `new_customers` |
| `newDueDate` | `new_due_date` |
| `newLoan` | `new_loan` |
| `newPassword` | `new_password` |
| `nomineeName` | `nominee_name` |
| `nomineePhone` | `nominee_phone` |
| `nomineeRelation` | `nominee_relation` |
| `notifType` | `notif_type` |
| `notificationId` | `notification_id` |
| `occurredAt` | `occurred_at` |
| `occurredOn` | `occurred_on` |
| `offBehavior` | `off_behavior` |
| `oldLoan` | `old_loan` |
| `onBrandTextColor` | `on_brand_text_color` |
| `openedDate` | `opened_date` |
| `openedTodayCount` | `opened_today_count` |
| `openingAmount` | `opening_amount` |
| `openingCash` | `opening_cash` |
| `openingCashSet` | `opening_cash_set` |
| `openingCount` | `opening_count` |
| `orderId` | `order_id` |
| `originalName` | `original_name` |
| `ornamentId` | `ornament_id` |
| `ornamentIds` | `ornament_ids` |
| `ornamentSelections` | `ornament_selections` |
| `ornamentType` | `ornament_type` |
| `outCount` | `out_count` |
| `outstandingAmount` | `outstanding_amount` |
| `outstandingAtRequest` | `outstanding_at_request` |
| `outstandingInterest` | `outstanding_interest` |
| `outstandingLiability` | `outstanding_liability` |
| `outstandingPenalInterest` | `outstanding_penal_interest` |
| `outstandingPrincipal` | `outstanding_principal` |
| `outstandingProcessingFee` | `outstanding_processing_fee` |
| `overdueCount` | `overdue_count` |
| `packetId` | `packet_id` |
| `packetVerified` | `packet_verified` |
| `pageBalance` | `page_balance` |
| `paidAmount` | `paid_amount` |
| `paidAt` | `paid_at` |
| `paidByEmployeeId` | `paid_by_employee_id` |
| `paidOn` | `paid_on` |
| `panStatus` | `pan_status` |
| `partyCustomer` | `party_customer` |
| `partyCustomerId` | `party_customer_id` |
| `paymentDueDate` | `payment_due_date` |
| `paymentId` | `payment_id` |
| `paymentRecorded` | `payment_recorded` |
| `paymentVerified` | `payment_verified` |
| `payoutFrequency` | `payout_frequency` |
| `penalApplied` | `penal_applied` |
| `penalCycleCount` | `penal_cycle_count` |
| `penalFlatAmount` | `penal_flat_amount` |
| `penalInterest` | `penal_interest` |
| `penalInterestApplied` | `penal_interest_applied` |
| `penalInterestPaid` | `penal_interest_paid` |
| `penalInterestRate` | `penal_interest_rate` |
| `penalRate` | `penal_rate` |
| `pendingApprovalCount` | `pending_approval_count` |
| `periodFrom` | `period_from` |
| `periodLabel` | `period_label` |
| `periodTo` | `period_to` |
| `permissionId` | `permission_id` |
| `personalLoanId` | `personal_loan_id` |
| `personalLoansActive` | `personal_loans_active` |
| `photoUrl` | `photo_url` |
| `pinCode` | `pin_code` |
| `planId` | `plan_id` |
| `planName` | `plan_name` |
| `pledgeDate` | `pledge_date` |
| `pledgedAmount` | `pledged_amount` |
| `pledgedGrossWeight` | `pledged_gross_weight` |
| `pledgedNetWeight` | `pledged_net_weight` |
| `priceInPaise` | `price_in_paise` |
| `principalAfter` | `principal_after` |
| `principalAmount` | `principal_amount` |
| `principalApplied` | `principal_applied` |
| `principalBefore` | `principal_before` |
| `principalOverride` | `principal_override` |
| `processingFee` | `processing_fee` |
| `processingFeeApplied` | `processing_fee_applied` |
| `productType` | `product_type` |
| `profitForPeriod` | `profit_for_period` |
| `purityTest` | `purity_test` |
| `rateChangePct` | `rate_change_pct` |
| `rateDate` | `rate_date` |
| `rateTiers` | `rate_tiers` |
| `razorpayPaymentId` | `razorpay_payment_id` |
| `razorpaySignature` | `razorpay_signature` |
| `razorpaySubscriptionId` | `razorpay_subscription_id` |
| `readAt` | `read_at` |
| `receiptImage` | `receipt_image` |
| `receivedBankId` | `received_bank_id` |
| `receivedByEmployeeId` | `received_by_employee_id` |
| `recentActivity` | `recent_activity` |
| `recipientName` | `recipient_name` |
| `recipientPhone` | `recipient_phone` |
| `recordId` | `record_id` |
| `recordedByEmployeeId` | `recorded_by_employee_id` |
| `recordedById` | `recorded_by_id` |
| `recordedByName` | `recorded_by_name` |
| `recordedDiscount` | `recorded_discount` |
| `recordedPayment` | `recorded_payment` |
| `redirectUrl` | `redirect_url` |
| `refNo` | `ref_no` |
| `referenceNumber` | `reference_number` |
| `rejectedAt` | `rejected_at` |
| `rejectedByEmployeeId` | `rejected_by_employee_id` |
| `rejectedByName` | `rejected_by_name` |
| `rejectionRemarks` | `rejection_remarks` |
| `relatedEntityId` | `related_entity_id` |
| `relatedEntityType` | `related_entity_type` |
| `relatedLoanId` | `related_loan_id` |
| `releaseCashMovementId` | `release_cash_movement_id` |
| `releaseDate` | `release_date` |
| `releaseExpenseId` | `release_expense_id` |
| `releasedAt` | `released_at` |
| `reminderId` | `reminder_id` |
| `remindersSent` | `reminders_sent` |
| `renewedFromInvestmentId` | `renewed_from_investment_id` |
| `renewedFromLoanId` | `renewed_from_loan_id` |
| `renewedToInvestmentId` | `renewed_to_investment_id` |
| `renewedToLoanId` | `renewed_to_loan_id` |
| `repaidAmount` | `repaid_amount` |
| `repaidCount` | `repaid_count` |
| `requestId` | `request_id` |
| `requestType` | `request_type` |
| `requestedAt` | `requested_at` |
| `requestedBy` | `requested_by` |
| `requestedExtensionMonths` | `requested_extension_months` |
| `requestsCount` | `requests_count` |
| `reversalOfMovementId` | `reversal_of_movement_id` |
| `riskLevel` | `risk_level` |
| `roleId` | `role_id` |
| `roleIds` | `role_ids` |
| `runningBalance` | `running_balance` |
| `saleAmount` | `sale_amount` |
| `sanctionedAmount` | `sanctioned_amount` |
| `schemeCode` | `scheme_code` |
| `schemeDurationMonths` | `scheme_duration_months` |
| `schemeId` | `scheme_id` |
| `schemeInterestMethod` | `scheme_interest_method` |
| `schemeInterestRate` | `scheme_interest_rate` |
| `schemeLtvPercent` | `scheme_ltv_percent` |
| `schemeName` | `scheme_name` |
| `schemePenalRate` | `scheme_penal_rate` |
| `secondaryColor` | `secondary_color` |
| `section1Advanced` | `section1_advanced` |
| `section2Redeemed` | `section2_redeemed` |
| `section3Deposits` | `section3_deposits` |
| `section4FinancialPosition` | `section4_financial_position` |
| `seededAt` | `seeded_at` |
| `sentAt` | `sent_at` |
| `sequenceNo` | `sequence_no` |
| `serviceChargeAmount` | `service_charge_amount` |
| `serviceChargeMode` | `service_charge_mode` |
| `serviceChargeType` | `service_charge_type` |
| `serviceChargeValue` | `service_charge_value` |
| `setBy` | `set_by` |
| `settleInterest` | `settle_interest` |
| `settlementAmount` | `settlement_amount` |
| `settlementStatus` | `settlement_status` |
| `sharedSteps` | `shared_steps` |
| `shortName` | `short_name` |
| `shortNameSet` | `short_name_set` |
| `sidebarColor` | `sidebar_color` |
| `singleBranch` | `single_branch` |
| `sizeBytes` | `size_bytes` |
| `soldAmount` | `sold_amount` |
| `soldOn` | `sold_on` |
| `sourceId` | `source_id` |
| `startDate` | `start_date` |
| `storageBytes` | `storage_bytes` |
| `storageKey` | `storage_key` |
| `subscriptionExpiresAt` | `subscription_expires_at` |
| `subscriptionId` | `subscription_id` |
| `superAdminUser` | `super_admin_user` |
| `superAdminUserId` | `super_admin_user_id` |
| `surplusDisposition` | `surplus_disposition` |
| `surplusPaidOutMovementId` | `surplus_paid_out_movement_id` |
| `surplusPayableAmount` | `surplus_payable_amount` |
| `surplusShortfall` | `surplus_shortfall` |
| `targetId` | `target_id` |
| `tenantId` | `tenant_id` |
| `tenantName` | `tenant_name` |
| `tenureCount` | `tenure_count` |
| `tenureMonths` | `tenure_months` |
| `testedAt` | `tested_at` |
| `testedBy` | `tested_by` |
| `testedDeductionWeight` | `tested_deduction_weight` |
| `testedGrossWeight` | `tested_gross_weight` |
| `testedNetWeight` | `tested_net_weight` |
| `testedPurity` | `tested_purity` |
| `testingRemarks` | `testing_remarks` |
| `tierId` | `tier_id` |
| `tierName` | `tier_name` |
| `toBank` | `to_bank` |
| `toBankId` | `to_bank_id` |
| `toBankRef` | `to_bank_ref` |
| `toStatus` | `to_status` |
| `topUp` | `top_up` |
| `topUps` | `top_ups` |
| `totalAmount` | `total_amount` |
| `totalAssets` | `total_assets` |
| `totalBalance` | `total_balance` |
| `totalCollections` | `total_collections` |
| `totalCost` | `total_cost` |
| `totalCount` | `total_count` |
| `totalCredit` | `total_credit` |
| `totalDebit` | `total_debit` |
| `totalDisbursed` | `total_disbursed` |
| `totalDisbursements` | `total_disbursements` |
| `totalDue` | `total_due` |
| `totalEquity` | `total_equity` |
| `totalExpenses` | `total_expenses` |
| `totalGoldValue` | `total_gold_value` |
| `totalGrossWeight` | `total_gross_weight` |
| `totalIn` | `total_in` |
| `totalIncome` | `total_income` |
| `totalInterest` | `total_interest` |
| `totalInterestPaid` | `total_interest_paid` |
| `totalLiabilities` | `total_liabilities` |
| `totalLoans` | `total_loans` |
| `totalLoansProcessed` | `total_loans_processed` |
| `totalNetWeight` | `total_net_weight` |
| `totalOut` | `total_out` |
| `totalOutstanding` | `total_outstanding` |
| `totalOutstandingBalance` | `total_outstanding_balance` |
| `totalPaid` | `total_paid` |
| `totalPaidInPaise` | `total_paid_in_paise` |
| `totalPenal` | `total_penal` |
| `totalPenalInterestCharged` | `total_penal_interest_charged` |
| `totalPending` | `total_pending` |
| `totalPrincipal` | `total_principal` |
| `totalProfit` | `total_profit` |
| `totalSaleAmount` | `total_sale_amount` |
| `totalSettlement` | `total_settlement` |
| `totalSold` | `total_sold` |
| `traceId` | `trace_id` |
| `transactionGroupId` | `transaction_group_id` |
| `triggerType` | `trigger_type` |
| `triggeredByEmployeeId` | `triggered_by_employee_id` |
| `triggeredByPaymentId` | `triggered_by_payment_id` |
| `unassignedBalance` | `unassigned_balance` |
| `updatedAt` | `updated_at` |
| `upiAmount` | `upi_amount` |
| `uploadedByEmployeeId` | `uploaded_by_employee_id` |
| `validUpto` | `valid_upto` |
| `verificationNotes` | `verification_notes` |
| `voidCashMovementId` | `void_cash_movement_id` |
| `voidReason` | `void_reason` |
| `voidedAt` | `voided_at` |

Keys that did **not** change: JWT claim names, the superadmin sidebar header layout (stored as JSON with its existing keys: `logoShape`, `logoWidth`, `titleSize`, `subSize`), and third-party payloads (Razorpay, Surepass, WhatsApp).

## 5. Route table (old → new)

All 338 routes that existed before, plus 1 new one. Rows marked = are unchanged.

| Before | After |
|---|---|
| `CONNECT /admin/whatsapp` | = |
| `DELETE /admin/whatsapp` | = |
| `GET /admin/whatsapp` | = |
| `HEAD /admin/whatsapp` | = |
| `OPTIONS /admin/whatsapp` | = |
| `PATCH /admin/whatsapp` | = |
| `POST /admin/whatsapp` | = |
| `PROPFIND /admin/whatsapp` | = |
| `PUT /admin/whatsapp` | = |
| `REPORT /admin/whatsapp` | = |
| `TRACE /admin/whatsapp` | = |
| `CONNECT /admin/whatsapp/*` | = |
| `DELETE /admin/whatsapp/*` | = |
| `GET /admin/whatsapp/*` | = |
| `HEAD /admin/whatsapp/*` | = |
| `OPTIONS /admin/whatsapp/*` | = |
| `PATCH /admin/whatsapp/*` | = |
| `POST /admin/whatsapp/*` | = |
| `PROPFIND /admin/whatsapp/*` | = |
| `PUT /admin/whatsapp/*` | = |
| `REPORT /admin/whatsapp/*` | = |
| `TRACE /admin/whatsapp/*` | = |
| `GET /api/v1/approval-workflow` | `GET /api/v1/users/:user_id/approval-workflow` |
| `GET /api/v1/approval-workflow/categories` | `GET /api/v1/users/:user_id/approval-workflow/categories` |
| `PUT /api/v1/approval-workflow/categories/:category` | `PATCH /api/v1/users/:user_id/approval-workflow/categories/:category/update` |
| `GET /api/v1/audit-log` | `GET /api/v1/users/:user_id/audit-log` |
| `POST /api/v1/auth/forgot-password` | = |
| `POST /api/v1/auth/login` | = |
| `GET /api/v1/auth/me` | = |
| `POST /api/v1/auth/qr/issue` | = |
| `POST /api/v1/auth/qr/redeem` | = |
| `POST /api/v1/auth/reset-password` | = |
| `POST /api/v1/auth/verify-reset-code` | = |
| `GET /api/v1/banks` | `GET /api/v1/users/:user_id/banks` |
| `POST /api/v1/banks` | `POST /api/v1/users/:user_id/banks` |
| `DELETE /api/v1/banks/:id` | `DELETE /api/v1/users/:user_id/banks/:id/delete` |
| `GET /api/v1/banks/:id` | `GET /api/v1/users/:user_id/banks/:id` |
| `PUT /api/v1/banks/:id` | `PATCH /api/v1/users/:user_id/banks/:id/update` |
| `GET /api/v1/banks/:id/ledger` | `GET /api/v1/users/:user_id/banks/:id/ledger` |
| `POST /api/v1/banks/:id/merge` | `POST /api/v1/users/:user_id/banks/:id/merge` |
| `POST /api/v1/billing/confirm` | `POST /api/v1/users/:user_id/billing/confirm` |
| `GET /api/v1/billing/status` | `GET /api/v1/users/:user_id/billing/status` |
| `POST /api/v1/billing/subscribe` | `POST /api/v1/users/:user_id/billing/subscribe` |
| `GET /api/v1/branches` | `GET /api/v1/users/:user_id/branches` |
| `POST /api/v1/branches` | `POST /api/v1/users/:user_id/branches` |
| `DELETE /api/v1/branches/:id` | `DELETE /api/v1/users/:user_id/branches/:id/delete` |
| `GET /api/v1/branches/:id` | `GET /api/v1/users/:user_id/branches/:id` |
| `PUT /api/v1/branches/:id` | `PATCH /api/v1/users/:user_id/branches/:id/update` |
| `GET /api/v1/branches/quota` | `GET /api/v1/users/:user_id/branches/quota` |
| `GET /api/v1/branches/switchable` | `GET /api/v1/users/:user_id/branches/switchable` |
| `GET /api/v1/branding` | `GET /api/v1/users/:user_id/branding` |
| `POST /api/v1/branding/connect-code` | `POST /api/v1/users/:user_id/branding/connect-code` |
| `GET /api/v1/cash-movements` | `GET /api/v1/users/:user_id/cash-movements` |
| `POST /api/v1/cash-movements` | `POST /api/v1/users/:user_id/cash-movements` |
| `GET /api/v1/cash-movements/:id` | `GET /api/v1/users/:user_id/cash-movements/:id` |
| `PATCH /api/v1/cash-movements/:id/status` | `PATCH /api/v1/users/:user_id/cash-movements/:id/status` |
| `GET /api/v1/cash-movements/cash-ledger` | `GET /api/v1/users/:user_id/cash-movements/cash-ledger` |
| `GET /api/v1/cash-movements/export` | `GET /api/v1/users/:user_id/cash-movements/export` |
| `GET /api/v1/cash-movements/loan-sources` | `GET /api/v1/users/:user_id/cash-movements/loan-sources` |
| `GET /api/v1/cash-movements/mode-ledger` | `GET /api/v1/users/:user_id/cash-movements/mode-ledger` |
| `POST /api/v1/cash-movements/self-transfer` | `POST /api/v1/users/:user_id/cash-movements/self-transfer` |
| `GET /api/v1/cash-movements/transactions/bank/:bankId` | `GET /api/v1/users/:user_id/cash-movements/transactions/bank/:bank_id` |
| `GET /api/v1/cash-movements/transactions/bank/:bankId/export` | `GET /api/v1/users/:user_id/cash-movements/transactions/bank/:bank_id/export` |
| `GET /api/v1/cash-movements/transactions/branch/:id` | `GET /api/v1/users/:user_id/cash-movements/transactions/branch/:id` |
| `GET /api/v1/cash-movements/transactions/branch/:id/export` | `GET /api/v1/users/:user_id/cash-movements/transactions/branch/:id/export` |
| `GET /api/v1/cash-movements/transactions/customer/:customerId` | `GET /api/v1/users/:user_id/cash-movements/transactions/customer/:customer_id` |
| `GET /api/v1/cash-movements/transactions/customer/:customerId/export` | `GET /api/v1/users/:user_id/cash-movements/transactions/customer/:customer_id/export` |
| `GET /api/v1/cash-sources` | `GET /api/v1/users/:user_id/cash-sources` |
| `POST /api/v1/cash-sources` | `POST /api/v1/users/:user_id/cash-sources` |
| `GET /api/v1/cash-sources/:id` | `GET /api/v1/users/:user_id/cash-sources/:id` |
| `GET /api/v1/cash-sources/:id/ledger` | `GET /api/v1/users/:user_id/cash-sources/:id/ledger` |
| `GET /api/v1/cash/opening-balance` | `GET /api/v1/users/:user_id/cash/opening-balance` |
| `POST /api/v1/cash/opening-balance` | `POST /api/v1/users/:user_id/cash/opening-balance` |
| `GET /api/v1/cash/summary` | `GET /api/v1/users/:user_id/cash/summary` |
| `GET /api/v1/categories` | `GET /api/v1/users/:user_id/categories` |
| `POST /api/v1/categories` | `POST /api/v1/users/:user_id/categories` |
| `POST /api/v1/customer/auth/device-login` | = |
| `POST /api/v1/customer/auth/refresh` | = |
| `POST /api/v1/customer/auth/register-device` | = |
| `POST /api/v1/customer/auth/request-otp` | = |
| `POST /api/v1/customer/auth/verify-otp` | = |
| `GET /api/v1/customer/gold-rate/history` | `GET /api/v1/customers/:customer_id/gold-rate/history` |
| `GET /api/v1/customer/gold-rate/latest` | `GET /api/v1/customers/:customer_id/gold-rate/latest` |
| `GET /api/v1/customer/loans` | `GET /api/v1/customers/:customer_id/loans` |
| `GET /api/v1/customer/loans/:id` | `GET /api/v1/customers/:customer_id/loans/:id` |
| `POST /api/v1/customer/loans/:id/extension-request` | `POST /api/v1/customers/:customer_id/loans/:id/extension-request` |
| `POST /api/v1/customer/loans/:id/pay/create-order` | `POST /api/v1/customers/:customer_id/loans/:id/pay/create-order` |
| `POST /api/v1/customer/loans/:id/pay/verify` | `POST /api/v1/customers/:customer_id/loans/:id/pay/verify` |
| `GET /api/v1/customer/loans/:id/payments` | `GET /api/v1/customers/:customer_id/loans/:id/payments` |
| `POST /api/v1/customer/loans/:id/release-request` | `POST /api/v1/customers/:customer_id/loans/:id/release-request` |
| `GET /api/v1/customer/loans/:id/requests` | `GET /api/v1/customers/:customer_id/loans/:id/requests` |
| `GET /api/v1/customer/loans/:id/statement` | `GET /api/v1/customers/:customer_id/loans/:id/statement` |
| `GET /api/v1/customer/notifications` | `GET /api/v1/customers/:customer_id/notifications` |
| `POST /api/v1/customer/notifications/:id/ack` | `POST /api/v1/customers/:customer_id/notifications/:id/ack` |
| `POST /api/v1/customer/notifications/:id/read` | `POST /api/v1/customers/:customer_id/notifications/:id/read` |
| `GET /api/v1/customer/payments` | `GET /api/v1/customers/:customer_id/payments` |
| `GET /api/v1/customer/payments/:paymentId/receipt` | `GET /api/v1/customers/:customer_id/payments/:payment_id/receipt` |
| `GET /api/v1/customer/profile` | `GET /api/v1/customers/:customer_id/profile` |
| `POST /api/v1/customer/profile/aadhaar/start` | `POST /api/v1/customers/:customer_id/profile/aadhaar/start` |
| `GET /api/v1/customer/profile/aadhaar/status` | `GET /api/v1/customers/:customer_id/profile/aadhaar/status` |
| `POST /api/v1/customer/profile/verify-pan` | `POST /api/v1/customers/:customer_id/profile/verify-pan` |
| `GET /api/v1/customer/ws` | = |
| `GET /api/v1/customers` | `GET /api/v1/users/:user_id/customers` |
| `POST /api/v1/customers` | `POST /api/v1/users/:user_id/customers` |
| `GET /api/v1/customers/:id` | `GET /api/v1/users/:user_id/customers/:id` |
| `PUT /api/v1/customers/:id` | `PATCH /api/v1/users/:user_id/customers/:id/update` |
| `GET /api/v1/customers/:id/aadhaar-full` | `GET /api/v1/users/:user_id/customers/:id/aadhaar-full` |
| `GET /api/v1/customers/:id/auction-history` | `GET /api/v1/users/:user_id/customers/:id/auction-history` |
| `GET /api/v1/customers/:id/bank-pledges` | `GET /api/v1/users/:user_id/customers/:id/bank-pledges` |
| `DELETE /api/v1/customers/:id/hard-delete` | `DELETE /api/v1/users/:user_id/customers/:id/hard-delete` |
| `GET /api/v1/customers/:id/investments` | `GET /api/v1/users/:user_id/customers/:id/investments` |
| `GET /api/v1/customers/:id/loans` | `GET /api/v1/users/:user_id/customers/:id/loans` |
| `GET /api/v1/customers/:id/ornaments` | `GET /api/v1/users/:user_id/customers/:id/ornaments` |
| `GET /api/v1/customers/:id/payments` | `GET /api/v1/users/:user_id/customers/:id/payments` |
| `GET /api/v1/customers/:id/personal-loans` | `GET /api/v1/users/:user_id/customers/:id/personal-loans` |
| `GET /api/v1/customers/:id/profile360` | `GET /api/v1/users/:user_id/customers/:id/profile360` |
| `POST /api/v1/customers/:id/verify-aadhaar/check` | `POST /api/v1/users/:user_id/customers/:id/verify-aadhaar/check` |
| `POST /api/v1/customers/:id/verify-aadhaar/start` | `POST /api/v1/users/:user_id/customers/:id/verify-aadhaar/start` |
| `POST /api/v1/customers/:id/verify-pan` | `POST /api/v1/users/:user_id/customers/:id/verify-pan` |
| `GET /api/v1/dashboard/activity` | `GET /api/v1/users/:user_id/dashboard/activity` |
| `GET /api/v1/dashboard/needs-attention` | `GET /api/v1/users/:user_id/dashboard/needs-attention` |
| `GET /api/v1/dashboard/snapshots` | `GET /api/v1/users/:user_id/dashboard/snapshots` |
| `GET /api/v1/dashboard/snapshots/latest` | `GET /api/v1/users/:user_id/dashboard/snapshots/latest` |
| `GET /api/v1/dashboard/summary` | `GET /api/v1/users/:user_id/dashboard/summary` |
| `POST /api/v1/demo/reset` | `POST /api/v1/users/:user_id/demo/reset` |
| `GET /api/v1/employees` | `GET /api/v1/users/:user_id/employees` |
| `POST /api/v1/employees` | `POST /api/v1/users/:user_id/employees` |
| `DELETE /api/v1/employees/:id` | `DELETE /api/v1/users/:user_id/employees/:id/delete` |
| `GET /api/v1/employees/:id` | `GET /api/v1/users/:user_id/employees/:id` |
| `PUT /api/v1/employees/:id` | `PATCH /api/v1/users/:user_id/employees/:id/update` |
| `GET /api/v1/employees/:id/permissions` | `GET /api/v1/users/:user_id/employees/:id/permissions` |
| `PATCH /api/v1/employees/:id/permissions/:role_id` | `PATCH /api/v1/users/:user_id/employees/:id/permissions/:role_id` |
| `PATCH /api/v1/employees/:id/permissions/:role_id/set-all` | `PATCH /api/v1/users/:user_id/employees/:id/permissions/:role_id/set-all` |
| `GET /api/v1/employees/:id/permissions/by-employee` | `GET /api/v1/users/:user_id/employees/:id/permissions/by-employee` |
| `GET /api/v1/expense-categories` | `GET /api/v1/users/:user_id/expense-categories` |
| `POST /api/v1/expense-categories` | `POST /api/v1/users/:user_id/expense-categories` |
| `GET /api/v1/expense-categories/:id/ledger` | `GET /api/v1/users/:user_id/expense-categories/:id/ledger` |
| `GET /api/v1/expenses` | `GET /api/v1/users/:user_id/expenses` |
| `POST /api/v1/expenses` | `POST /api/v1/users/:user_id/expenses` |
| `GET /api/v1/expenses/:id` | `GET /api/v1/users/:user_id/expenses/:id` |
| `PATCH /api/v1/expenses/:id/approve` | `PATCH /api/v1/users/:user_id/expenses/:id/approve` |
| `PATCH /api/v1/expenses/:id/reject` | `PATCH /api/v1/users/:user_id/expenses/:id/reject` |
| `GET /api/v1/expenses/export` | `GET /api/v1/users/:user_id/expenses/export` |
| `GET /api/v1/gold-rates` | `GET /api/v1/users/:user_id/gold-rates` |
| `POST /api/v1/gold-rates` | `POST /api/v1/users/:user_id/gold-rates` |
| `GET /api/v1/gold-rates/:id` | `GET /api/v1/users/:user_id/gold-rates/:id` |
| `GET /api/v1/gold-rates/latest` | `GET /api/v1/users/:user_id/gold-rates/latest` |
| `GET /api/v1/gold-sales` | `GET /api/v1/users/:user_id/gold-sales` |
| `POST /api/v1/gold-sales` | `POST /api/v1/users/:user_id/gold-sales` |
| `GET /api/v1/gold-sales/:id` | `GET /api/v1/users/:user_id/gold-sales/:id` |
| `GET /api/v1/investment-plans` | `GET /api/v1/users/:user_id/investment-plans` |
| `POST /api/v1/investment-plans` | `POST /api/v1/users/:user_id/investment-plans` |
| `GET /api/v1/investment-plans/:id` | `GET /api/v1/users/:user_id/investment-plans/:id` |
| `PUT /api/v1/investment-plans/:id` | `PATCH /api/v1/users/:user_id/investment-plans/:id/update` |
| `GET /api/v1/investments` | `GET /api/v1/users/:user_id/investments` |
| `POST /api/v1/investments` | `POST /api/v1/users/:user_id/investments` |
| `GET /api/v1/investments/:id` | `GET /api/v1/users/:user_id/investments/:id` |
| `POST /api/v1/investments/:id/add-cash` | `POST /api/v1/users/:user_id/investments/:id/add-cash` |
| `GET /api/v1/investments/:id/bond/pdf` | `GET /api/v1/users/:user_id/investments/:id/bond/pdf` |
| `GET /api/v1/investments/:id/ledger` | `GET /api/v1/users/:user_id/investments/:id/ledger` |
| `POST /api/v1/investments/:id/mature` | `POST /api/v1/users/:user_id/investments/:id/mature` |
| `POST /api/v1/investments/:id/payouts/:payoutId/pay` | `POST /api/v1/users/:user_id/investments/:id/payouts/:payout_id/pay` |
| `GET /api/v1/investments/:id/schedule` | `GET /api/v1/users/:user_id/investments/:id/schedule` |
| `GET /api/v1/investments/:id/statement/pdf` | `GET /api/v1/users/:user_id/investments/:id/statement/pdf` |
| `GET /api/v1/investments/:id/transactions` | `GET /api/v1/users/:user_id/investments/:id/transactions` |
| `POST /api/v1/investments/:id/withdraw` | `POST /api/v1/users/:user_id/investments/:id/withdraw` |
| `GET /api/v1/investments/by-number/:number` | `GET /api/v1/users/:user_id/investments/by-number/:number` |
| `GET /api/v1/loans` | `GET /api/v1/users/:user_id/loans` |
| `POST /api/v1/loans` | `POST /api/v1/users/:user_id/loans` |
| `GET /api/v1/loans/:id` | `GET /api/v1/users/:user_id/loans/:id` |
| `PATCH /api/v1/loans/:id` | `PATCH /api/v1/users/:user_id/loans/:id` |
| `GET /api/v1/loans/:id/approvals` | `GET /api/v1/users/:user_id/loans/:id/approvals` |
| `POST /api/v1/loans/:id/approve` | `POST /api/v1/users/:user_id/loans/:id/approve` |
| `GET /api/v1/loans/:id/auction` | `GET /api/v1/users/:user_id/loans/:id/auction` |
| `POST /api/v1/loans/:id/auction/decision` | `POST /api/v1/users/:user_id/loans/:id/auction/decision` |
| `POST /api/v1/loans/:id/auction/eligible` | `POST /api/v1/users/:user_id/loans/:id/auction/eligible` |
| `GET /api/v1/loans/:id/auction/history` | `GET /api/v1/users/:user_id/loans/:id/auction/history` |
| `POST /api/v1/loans/:id/auction/notice` | `POST /api/v1/users/:user_id/loans/:id/auction/notice` |
| `POST /api/v1/loans/:id/auction/sale` | `POST /api/v1/users/:user_id/loans/:id/auction/sale` |
| `POST /api/v1/loans/:id/auction/schedule` | `POST /api/v1/users/:user_id/loans/:id/auction/schedule` |
| `POST /api/v1/loans/:id/auction/settle` | `POST /api/v1/users/:user_id/loans/:id/auction/settle` |
| `POST /api/v1/loans/:id/bank-pledge` | `POST /api/v1/users/:user_id/loans/:id/bank-pledge` |
| `PUT /api/v1/loans/:id/bank-pledge/:pledgeId/release` | `PATCH /api/v1/users/:user_id/loans/:id/bank-pledge/:pledge_id/release` |
| `PUT /api/v1/loans/:id/bank-pledge/:pledgeId/void` | `PATCH /api/v1/users/:user_id/loans/:id/bank-pledge/:pledge_id/void` |
| `GET /api/v1/loans/:id/bank-pledge/history` | `GET /api/v1/users/:user_id/loans/:id/bank-pledge/history` |
| `POST /api/v1/loans/:id/complete-release` | `POST /api/v1/users/:user_id/loans/:id/complete-release` |
| `POST /api/v1/loans/:id/extension-request` | `POST /api/v1/users/:user_id/loans/:id/extension-request` |
| `DELETE /api/v1/loans/:id/hard-delete` | `DELETE /api/v1/users/:user_id/loans/:id/hard-delete` |
| `POST /api/v1/loans/:id/indemnity-bond/esign/start` | `POST /api/v1/users/:user_id/loans/:id/indemnity-bond/esign/start` |
| `GET /api/v1/loans/:id/indemnity-bond/esign/status` | `GET /api/v1/users/:user_id/loans/:id/indemnity-bond/esign/status` |
| `GET /api/v1/loans/:id/indemnity-bond/pdf` | `GET /api/v1/users/:user_id/loans/:id/indemnity-bond/pdf` |
| `GET /api/v1/loans/:id/ledger` | `GET /api/v1/users/:user_id/loans/:id/ledger` |
| `POST /api/v1/loans/:id/ornaments` | `POST /api/v1/users/:user_id/loans/:id/ornaments` |
| `POST /api/v1/loans/:id/payments` | `POST /api/v1/users/:user_id/loans/:id/payments` |
| `GET /api/v1/loans/:id/pledge-slip` | `GET /api/v1/users/:user_id/loans/:id/pledge-slip` |
| `GET /api/v1/loans/:id/release-agreement/pdf` | `GET /api/v1/users/:user_id/loans/:id/release-agreement/pdf` |
| `POST /api/v1/loans/:id/release-request` | `POST /api/v1/users/:user_id/loans/:id/release-request` |
| `GET /api/v1/loans/:id/statement` | `GET /api/v1/users/:user_id/loans/:id/statement` |
| `POST /api/v1/loans/:id/topup` | `POST /api/v1/users/:user_id/loans/:id/topup` |
| `GET /api/v1/loans/:id/topups` | `GET /api/v1/users/:user_id/loans/:id/topups` |
| `GET /api/v1/loans/auctions/concluded` | `GET /api/v1/users/:user_id/loans/auctions/concluded` |
| `GET /api/v1/loans/auctions/decisions/pending` | `GET /api/v1/users/:user_id/loans/auctions/decisions/pending` |
| `GET /api/v1/loans/bank-pledges/history` | `GET /api/v1/users/:user_id/loans/bank-pledges/history` |
| `GET /api/v1/loans/by-number/:loanNumber` | `GET /api/v1/users/:user_id/loans/by-number/:loan_number` |
| `GET /api/v1/loans/drafts` | `GET /api/v1/users/:user_id/loans/drafts` |
| `POST /api/v1/loans/drafts` | `POST /api/v1/users/:user_id/loans/drafts` |
| `DELETE /api/v1/loans/drafts/:draftId` | `DELETE /api/v1/users/:user_id/loans/drafts/:draft_id/delete` |
| `GET /api/v1/loans/drafts/:draftId` | `GET /api/v1/users/:user_id/loans/drafts/:draft_id` |
| `PUT /api/v1/loans/drafts/:draftId` | `PATCH /api/v1/users/:user_id/loans/drafts/:draft_id/update` |
| `POST /api/v1/loans/indemnity-bond/preview-pdf` | `POST /api/v1/users/:user_id/loans/indemnity-bond/preview-pdf` |
| `GET /api/v1/loans/interest-collected` | `GET /api/v1/users/:user_id/loans/interest-collected` |
| `GET /api/v1/loans/next-number` | `GET /api/v1/users/:user_id/loans/next-number` |
| `DELETE /api/v1/loans/ornaments/:ornamentId` | `DELETE /api/v1/users/:user_id/loans/ornaments/:ornament_id/delete` |
| `PUT /api/v1/loans/ornaments/:ornamentId` | `PATCH /api/v1/users/:user_id/loans/ornaments/:ornament_id/update` |
| `POST /api/v1/loans/ornaments/:ornamentId/images` | `POST /api/v1/users/:user_id/loans/ornaments/:ornament_id/images` |
| `POST /api/v1/loans/ornaments/:ornamentId/purity-test` | `POST /api/v1/users/:user_id/loans/ornaments/:ornament_id/purity-test` |
| `GET /api/v1/loans/requests` | `GET /api/v1/users/:user_id/loans/requests` |
| `POST /api/v1/loans/requests/:requestId/approve` | `POST /api/v1/users/:user_id/loans/requests/:request_id/approve` |
| `PUT /api/v1/loans/requests/:requestId/decide` | `PATCH /api/v1/users/:user_id/loans/requests/:request_id/decide` |
| `GET /api/v1/loans/requests/:requestId/partial-release-receipt/pdf` | `GET /api/v1/users/:user_id/loans/requests/:request_id/partial-release-receipt/pdf` |
| `POST /api/v1/loans/requests/:requestId/release-payment` | `POST /api/v1/users/:user_id/loans/requests/:request_id/release-payment` |
| `PUT /api/v1/loans/requests/:requestId/verify` | `PATCH /api/v1/users/:user_id/loans/requests/:request_id/verify` |
| `GET /api/v1/loans/risk-assessment` | `GET /api/v1/users/:user_id/loans/risk-assessment` |
| `POST /api/v1/loans/topups/:topUpId/approve` | `POST /api/v1/users/:user_id/loans/topups/:top_up_id/approve` |
| `GET /api/v1/lockers` | `GET /api/v1/users/:user_id/lockers` |
| `POST /api/v1/lockers` | `POST /api/v1/users/:user_id/lockers` |
| `DELETE /api/v1/lockers/:id` | `DELETE /api/v1/users/:user_id/lockers/:id/delete` |
| `GET /api/v1/lockers/:id` | `GET /api/v1/users/:user_id/lockers/:id` |
| `PUT /api/v1/lockers/:id` | `PATCH /api/v1/users/:user_id/lockers/:id/update` |
| `GET /api/v1/ornament-types` | `GET /api/v1/users/:user_id/ornament-types` |
| `POST /api/v1/ornament-types` | `POST /api/v1/users/:user_id/ornament-types` |
| `GET /api/v1/packets` | `GET /api/v1/users/:user_id/packets` |
| `GET /api/v1/packets/:id` | `GET /api/v1/users/:user_id/packets/:id` |
| `GET /api/v1/packets/:id/movements` | `GET /api/v1/users/:user_id/packets/:id/movements` |
| `POST /api/v1/packets/:id/movements` | `POST /api/v1/users/:user_id/packets/:id/movements` |
| `GET /api/v1/packets/by-code/:code` | `GET /api/v1/users/:user_id/packets/by-code/:code` |
| `GET /api/v1/personal-loans` | `GET /api/v1/users/:user_id/personal-loans` |
| `POST /api/v1/personal-loans` | `POST /api/v1/users/:user_id/personal-loans` |
| `GET /api/v1/personal-loans/:id` | `GET /api/v1/users/:user_id/personal-loans/:id` |
| `GET /api/v1/personal-loans/:id/approvals` | `GET /api/v1/users/:user_id/personal-loans/:id/approvals` |
| `POST /api/v1/personal-loans/:id/approve` | `POST /api/v1/users/:user_id/personal-loans/:id/approve` |
| `GET /api/v1/personal-loans/:id/bond` | `GET /api/v1/users/:user_id/personal-loans/:id/bond` |
| `GET /api/v1/personal-loans/:id/history` | `GET /api/v1/users/:user_id/personal-loans/:id/history` |
| `GET /api/v1/personal-loans/:id/payments` | `GET /api/v1/users/:user_id/personal-loans/:id/payments` |
| `POST /api/v1/personal-loans/:id/payments` | `POST /api/v1/users/:user_id/personal-loans/:id/payments` |
| `POST /api/v1/personal-loans/:id/renew` | `POST /api/v1/users/:user_id/personal-loans/:id/renew` |
| `POST /api/v1/personal-loans/:id/renewal-preview` | `POST /api/v1/users/:user_id/personal-loans/:id/renewal-preview` |
| `GET /api/v1/personal-loans/:id/schedule` | `GET /api/v1/users/:user_id/personal-loans/:id/schedule` |
| `GET /api/v1/personal-loans/by-number/:number` | `GET /api/v1/users/:user_id/personal-loans/by-number/:number` |
| `GET /api/v1/public/branding` | = |
| `GET /api/v1/public/branding/:code` | = |
| `GET /api/v1/public/branding/:code/logo` | = |
| `GET /api/v1/public/connect/:code` | = |
| `GET /api/v1/purity-standards` | `GET /api/v1/users/:user_id/purity-standards` |
| `POST /api/v1/purity-standards` | `POST /api/v1/users/:user_id/purity-standards` |
| `GET /api/v1/reminders` | `GET /api/v1/users/:user_id/reminders` |
| `POST /api/v1/reminders` | `POST /api/v1/users/:user_id/reminders` |
| `DELETE /api/v1/reminders/:id` | `DELETE /api/v1/users/:user_id/reminders/:id/delete` |
| `GET /api/v1/reminders/:id` | `GET /api/v1/users/:user_id/reminders/:id` |
| `PUT /api/v1/reminders/:id` | `PATCH /api/v1/users/:user_id/reminders/:id/update` |
| `PUT /api/v1/reminders/:id/complete` | `PATCH /api/v1/users/:user_id/reminders/:id/complete` |
| `PUT /api/v1/reminders/:id/send-whatsapp` | `PATCH /api/v1/users/:user_id/reminders/:id/send-whatsapp` |
| `GET /api/v1/reminders/calendar` | `GET /api/v1/users/:user_id/reminders/calendar` |
| `GET /api/v1/reports/auctions` | `GET /api/v1/users/:user_id/reports/auctions` |
| `GET /api/v1/reports/balance-sheet` | `GET /api/v1/users/:user_id/reports/balance-sheet` |
| `GET /api/v1/reports/bank-pledge` | `GET /api/v1/users/:user_id/reports/bank-pledge` |
| `GET /api/v1/reports/communication-history` | `GET /api/v1/users/:user_id/reports/communication-history` |
| `GET /api/v1/reports/disbursement` | `GET /api/v1/users/:user_id/reports/disbursement` |
| `GET /api/v1/reports/employee-performance` | `GET /api/v1/users/:user_id/reports/employee-performance` |
| `GET /api/v1/reports/expense-cashflow` | `GET /api/v1/users/:user_id/reports/expense-cashflow` |
| `GET /api/v1/reports/export/:key` | `GET /api/v1/users/:user_id/reports/export/:key` |
| `GET /api/v1/reports/form-g` | `GET /api/v1/users/:user_id/reports/form-g` |
| `GET /api/v1/reports/gold-rate-history` | `GET /api/v1/users/:user_id/reports/gold-rate-history` |
| `GET /api/v1/reports/gold-release` | `GET /api/v1/users/:user_id/reports/gold-release` |
| `GET /api/v1/reports/gold-weight` | `GET /api/v1/users/:user_id/reports/gold-weight` |
| `GET /api/v1/reports/interest-collection` | `GET /api/v1/users/:user_id/reports/interest-collection` |
| `GET /api/v1/reports/investments/deposit-register` | `GET /api/v1/users/:user_id/reports/investments/deposit-register` |
| `GET /api/v1/reports/investments/interest-payout-register` | `GET /api/v1/users/:user_id/reports/investments/interest-payout-register` |
| `GET /api/v1/reports/investments/investor-ledger` | `GET /api/v1/users/:user_id/reports/investments/investor-ledger` |
| `GET /api/v1/reports/investments/maturity-register` | `GET /api/v1/users/:user_id/reports/investments/maturity-register` |
| `GET /api/v1/reports/kyc` | `GET /api/v1/users/:user_id/reports/kyc` |
| `GET /api/v1/reports/loan-extensions` | `GET /api/v1/users/:user_id/reports/loan-extensions` |
| `GET /api/v1/reports/loans/status` | `GET /api/v1/users/:user_id/reports/loans/status` |
| `GET /api/v1/reports/outstanding-principal` | `GET /api/v1/users/:user_id/reports/outstanding-principal` |
| `GET /api/v1/reports/packets` | `GET /api/v1/users/:user_id/reports/packets` |
| `GET /api/v1/reports/payment-collection` | `GET /api/v1/users/:user_id/reports/payment-collection` |
| `GET /api/v1/reports/personal-loans` | `GET /api/v1/users/:user_id/reports/personal-loans` |
| `GET /api/v1/reports/profit-loss` | `GET /api/v1/users/:user_id/reports/profit-loss` |
| `GET /api/v1/roles` | `GET /api/v1/users/:user_id/roles` |
| `POST /api/v1/roles` | `POST /api/v1/users/:user_id/roles` |
| `DELETE /api/v1/roles/:id` | `DELETE /api/v1/users/:user_id/roles/:id/delete` |
| `PATCH /api/v1/roles/:id` | `PATCH /api/v1/users/:user_id/roles/:id` |
| `GET /api/v1/schemes` | `GET /api/v1/users/:user_id/schemes` |
| `POST /api/v1/schemes` | `POST /api/v1/users/:user_id/schemes` |
| `DELETE /api/v1/schemes/:id` | `DELETE /api/v1/users/:user_id/schemes/:id/delete` |
| `GET /api/v1/schemes/:id` | `GET /api/v1/users/:user_id/schemes/:id` |
| `PUT /api/v1/schemes/:id` | `PATCH /api/v1/users/:user_id/schemes/:id/update` |
| `POST /api/v1/schemes/:id/calculate` | `POST /api/v1/users/:user_id/schemes/:id/calculate` |
| `GET /api/v1/schemes/:id/statement` | `GET /api/v1/users/:user_id/schemes/:id/statement` |
| `POST /api/v1/schemes/:id/toggle-active` | `POST /api/v1/users/:user_id/schemes/:id/toggle-active` |
| `GET /api/v1/schemes/active` | `GET /api/v1/users/:user_id/schemes/active` |
| `GET /api/v1/schemes/inactive` | `GET /api/v1/users/:user_id/schemes/inactive` |
| `GET /api/v1/settings/api-keys` | `GET /api/v1/users/:user_id/settings/api-keys` |
| `DELETE /api/v1/settings/api-keys/:category` | `DELETE /api/v1/users/:user_id/settings/api-keys/:category/delete` |
| `GET /api/v1/settings/api-keys/:category` | `GET /api/v1/users/:user_id/settings/api-keys/:category` |
| `PUT /api/v1/settings/api-keys/:category` | `PATCH /api/v1/users/:user_id/settings/api-keys/:category/update` |
| `GET /api/v1/superadmin/audit-log` | `GET /api/v1/superadmin/users/:user_id/audit-log` |
| `GET /api/v1/superadmin/businesses` | `GET /api/v1/superadmin/users/:user_id/businesses` |
| `POST /api/v1/superadmin/businesses` | `POST /api/v1/superadmin/users/:user_id/businesses` |
| `DELETE /api/v1/superadmin/businesses/:id` | `DELETE /api/v1/superadmin/users/:user_id/businesses/:id/delete` |
| `GET /api/v1/superadmin/businesses/:id` | `GET /api/v1/superadmin/users/:user_id/businesses/:id` |
| `GET /api/v1/superadmin/businesses/:id/admin` | `GET /api/v1/superadmin/users/:user_id/businesses/:id/admin` |
| `PUT /api/v1/superadmin/businesses/:id/admin` | `PATCH /api/v1/superadmin/users/:user_id/businesses/:id/admin` |
| `PUT /api/v1/superadmin/businesses/:id/branch-mode` | `PATCH /api/v1/superadmin/users/:user_id/businesses/:id/branch-mode` |
| `PUT /api/v1/superadmin/businesses/:id/branding` | `PATCH /api/v1/superadmin/users/:user_id/businesses/:id/branding` |
| `PUT /api/v1/superadmin/businesses/:id/expiry` | `PATCH /api/v1/superadmin/users/:user_id/businesses/:id/expiry` |
| `PUT /api/v1/superadmin/businesses/:id/languages` | `PATCH /api/v1/superadmin/users/:user_id/businesses/:id/languages` |
| `DELETE /api/v1/superadmin/businesses/:id/logo` | `DELETE /api/v1/superadmin/users/:user_id/businesses/:id/logo` |
| `POST /api/v1/superadmin/businesses/:id/logo` | `POST /api/v1/superadmin/users/:user_id/businesses/:id/logo` |
| `PUT /api/v1/superadmin/businesses/:id/modules` | `PATCH /api/v1/superadmin/users/:user_id/businesses/:id/modules` |
| `GET /api/v1/superadmin/businesses/:id/overview` | `GET /api/v1/superadmin/users/:user_id/businesses/:id/overview` |
| `GET /api/v1/superadmin/businesses/:id/payments` | `GET /api/v1/superadmin/users/:user_id/businesses/:id/payments` |
| `POST /api/v1/superadmin/businesses/:id/payments` | `POST /api/v1/superadmin/users/:user_id/businesses/:id/payments` |
| `DELETE /api/v1/superadmin/businesses/:id/payments/:paymentId` | `DELETE /api/v1/superadmin/users/:user_id/businesses/:id/payments/:payment_id/delete` |
| `PUT /api/v1/superadmin/businesses/:id/profile` | `PATCH /api/v1/superadmin/users/:user_id/businesses/:id/profile` |
| `POST /api/v1/superadmin/businesses/:id/reactivate` | `POST /api/v1/superadmin/users/:user_id/businesses/:id/reactivate` |
| `DELETE /api/v1/superadmin/businesses/:id/signature` | `DELETE /api/v1/superadmin/users/:user_id/businesses/:id/signature` |
| `GET /api/v1/superadmin/businesses/:id/signature` | `GET /api/v1/superadmin/users/:user_id/businesses/:id/signature` |
| `POST /api/v1/superadmin/businesses/:id/signature` | `POST /api/v1/superadmin/users/:user_id/businesses/:id/signature` |
| `POST /api/v1/superadmin/businesses/:id/suspend` | `POST /api/v1/superadmin/users/:user_id/businesses/:id/suspend` |
| `PUT /api/v1/superadmin/businesses/:id/tier` | `PATCH /api/v1/superadmin/users/:user_id/businesses/:id/tier` |
| `GET /api/v1/superadmin/catalogue` | `GET /api/v1/superadmin/users/:user_id/catalogue` |
| `POST /api/v1/superadmin/login` | = |
| `GET /api/v1/superadmin/tiers` | `GET /api/v1/superadmin/users/:user_id/tiers` |
| `PUT /api/v1/superadmin/tiers/:id/price` | `PATCH /api/v1/superadmin/users/:user_id/tiers/:id/price` |
| `POST /api/v1/uploads` | `POST /api/v1/users/:user_id/uploads` |
| `POST /api/v1/webhooks/razorpay` | = |
| `GET /uploads/:key` | = |
| (new) | `GET /api/v1/customers/:customer_id/loans/:id/indemnity-bond/esign/status`, the customer e-sign status poll (frontend plan item C2) |


## 6. Optional compatibility adapter for the apps

`backend/contract/apiContract.ts` is generated from the tables above and tested by `backend/contract/apiContract.test.ts` (run it with `node --experimental-strip-types contract/apiContract.test.ts`). An app can plug it into its HTTP client and keep today's screens and services unchanged:

- Before sending, call `toApi(method, pathWithQuery, body, token)`. It returns the new method, the path with `/users/:id` (or `/customers/:id`, `/superadmin/users/:id`) filled from the token, PATCH `…/update` and DELETE `…/delete`, renamed query parameters with `offset` converted to `page`, and a snake_case JSON body.
- After parsing the response, call `fromApi(json)`. It maps keys back to camelCase and converts the list envelope back to an array (unpaged) or to `{items, hasMore, total, limit, offset, …}` (paged).
- For URL builders that cannot await the token (downloads, uploads), call `rememberToken(token)` whenever the token is read or saved, then call `toApi(...)` without the token argument.

It is not wired into any app yet. The other option is to migrate each app's services and types to snake_case natively.

## Round 4 (authorization fixes)

- New permission `can view all branches` (key `Branch_Management.can_view_all_branches` in `GET …/employees/:id/permissions`, module "Branch Management"). It replaces the hard-coded Administrator/Management check for seeing and switching between branches, including `can_switch` on the switchable-branches list. Existing businesses get it on for Administrator, Management and system roles, off for every other role; new businesses get it on for Administrator and Management.
- `is_system` (boolean) is now on the employee object returned by `POST /api/v1/auth/login`, `GET /api/v1/auth/me` and the QR login redeem. The apps' field map already turns it into `isSystem`.
- 15 permissions are removed, because approvals are decided by the approval workflow chain, not by these grants: `can verify loan`, `can approve branch manager stage`, `can sanction loan`, `can verify the loan extension`, `can approve extension branch manager stage`, `can approve extension management stage`, `can approve release manager stage`, `can approve release management stage`, `can decide auction partial repayment`, `can decide auction shortfall`, `can approve expense`, `can approve top-up branch manager stage`, `can approve top-up management stage`, `can approve personal loan branch manager stage`, `can approve personal loan management stage`. The modules "Loan Sanction", "Loan Extension Approval", "Expense Approval", "Top-Up Approval" and "Personal Loan Approval" no longer appear in the permission matrix. `can verify release checklist` and the auction stage permissions stay. Workflow stage objects no longer carry a `permission` field.
- 401 messages are split: an expired token answers `Session expired, please log in again`, any other bad token answers `Invalid token` (staff, customer and superadmin routes). A staff member whose role is inactive gets **401** `Account is inactive` on every staff route and on login.
- New **403** responses:
  - `PATCH …/employees/:id/update` when the signed-in employee changes their own role: `You cannot change your own role`.
  - `PATCH …/employees/:id/permissions/:role_id` and `…/permissions/:role_id/set-all` when `:role_id` is the signed-in employee's own role: `You cannot change your own role's permissions`.
  - Creating or updating an employee with a system role (such as Administrator) when the signed-in employee's role is not a system role: `You cannot assign a system role`.
- Saving the release checklist or recording a release payment without `can verify release checklist` now answers **403** `Access denied` instead of 400.
- Deleting a role that is still assigned answers 400 `Cannot delete: this role is assigned to N employee(s): a, b, c` (up to 5 names).
- Updating a role without `is_active` keeps its current state instead of re-activating it. Creating or updating a role with an empty or blank `name` answers 400 `name is required`.
- `GET /uploads/:key` with a customer token serves only the customer's own files (photo and KYC documents, ornament photos and signed indemnity bonds of their loans); any other key answers 404 `file not found`.
