/* CloudHouse Gold Finance — mock data (frontend-only prototype) */
window.DB = (function(){

  const rates = JSON.parse(localStorage.getItem('agf_rates') || 'null') || {
    date: '2026-07-30',
    k24: 7285, k22: 6690, k18: 5480,
    setBy: 'Rajesh Menon',
  };

  const rateHistory = JSON.parse(localStorage.getItem('agf_rate_history') || 'null') || [
    { date:'2026-07-30', k24:7285, k22:6690, k18:5480, by:'Rajesh Menon' },
    { date:'2026-07-29', k24:7260, k22:6668, k18:5462, by:'Rajesh Menon' },
    { date:'2026-07-28', k24:7292, k22:6697, k18:5486, by:'Anitha K' },
    { date:'2026-07-27', k24:7248, k22:6656, k18:5452, by:'Rajesh Menon' },
    { date:'2026-07-26', k24:7231, k22:6641, k18:5440, by:'Anitha K' },
    { date:'2026-07-25', k24:7214, k22:6625, k18:5427, by:'Rajesh Menon' },
    { date:'2026-07-24', k24:7196, k22:6608, k18:5413, by:'Rajesh Menon' },
  ];

  const schemes = JSON.parse(localStorage.getItem('agf_schemes') || 'null') || [
    { id:'SCH-01', name:'Swarna Classic',  rate:12,   duration:'12 months', ltv:75, method:'Monthly simple interest', penal:2, cond:'Interest payable monthly; penal 2%/m after due', active:true },
    { id:'SCH-02', name:'Swarna Plus',     rate:14.5, duration:'6 months',  ltv:80, method:'Monthly simple interest', penal:2.5, cond:'Higher LTV; bullet repayment allowed', active:true },
    { id:'SCH-03', name:'CloudHouse Express',  rate:16,   duration:'3 months',  ltv:85, method:'Flat monthly',            penal:3, cond:'Short tenure; quick release', active:true },
    { id:'SCH-04', name:'Krishi Gold',     rate:10.5, duration:'12 months', ltv:70, method:'Quarterly simple',        penal:1.5, cond:'Agriculture-purpose concession scheme', active:true },
    { id:'SCH-05', name:'Vyapar Gold',     rate:13,   duration:'9 months',  ltv:78, method:'Monthly simple interest', penal:2, cond:'For registered traders', active:false },
  ];

  const customers = JSON.parse(localStorage.getItem('agf_new_customers') || '[]');
  customers.push(
    { id:'CUST-1001', name:'Suresh Kumar',    phone:'98470 12345', dob:'1978-04-11', addr:'Koratty, Thrissur',   pan:'V', aadhaar:'V', kyc:'Verified',  photo:'SK', branch:'Koratty',  loans:['GL-2041','GL-1968'], since:'2024-02-18' },
    { id:'CUST-1002', name:'Lakshmi Menon',   phone:'94960 22331', dob:'1985-09-02', addr:'Chalakudy, Thrissur', pan:'V', aadhaar:'V', kyc:'Verified',  photo:'LM', branch:'Koratty',  loans:['GL-2044'], since:'2024-06-30' },
    { id:'CUST-1003', name:'Abdul Rasheed',   phone:'99610 77812', dob:'1971-01-23', addr:'Angamaly, Ernakulam', pan:'V', aadhaar:'P', kyc:'Pending',   photo:'AR', branch:'Angamaly', loans:['GL-2046'], since:'2025-01-12' },
    { id:'CUST-1004', name:'Meera Krishnan',  phone:'90728 44120', dob:'1990-12-05', addr:'Mala, Thrissur',      pan:'V', aadhaar:'V', kyc:'Verified',  photo:'MK', branch:'Koratty',  loans:['GL-2038','GL-2049'], since:'2023-11-02' },
    { id:'CUST-1005', name:'Thomas George',   phone:'85900 31576', dob:'1968-07-19', addr:'Kodakara, Thrissur',  pan:'F', aadhaar:'V', kyc:'Failed',    photo:'TG', branch:'Kodakara', loans:['GL-2029'], since:'2025-03-08' },
    { id:'CUST-1006', name:'Priya Nair',      phone:'96334 90218', dob:'1993-05-27', addr:'Koratty, Thrissur',   pan:'V', aadhaar:'V', kyc:'Verified',  photo:'PN', branch:'Koratty',  loans:['GL-2051'], since:'2025-07-21' },
    { id:'CUST-1007', name:'Rahim Sait',      phone:'80869 11402', dob:'1975-10-30', addr:'Perumbavoor, EKM',    pan:'P', aadhaar:'P', kyc:'Pending',   photo:'RS', branch:'Angamaly', loans:[], since:'2026-07-28' },
    { id:'CUST-1008', name:'Ananya Pillai',   phone:'97455 63308', dob:'1988-03-14', addr:'Chalakudy, Thrissur', pan:'V', aadhaar:'V', kyc:'Verified',  photo:'AP', branch:'Kodakara', loans:['GL-2035'], since:'2024-09-15' }
  );

  // backfill for schemes stored before the penal-charges field existed
  schemes.forEach(s => { if (s.penal == null) s.penal = 2; });

  function saveSchemes(){
    localStorage.setItem('agf_schemes', JSON.stringify(schemes));
  }

  function addCustomer(c){
    customers.unshift(c);
    const stored = JSON.parse(localStorage.getItem('agf_new_customers') || '[]');
    stored.unshift(c);
    localStorage.setItem('agf_new_customers', JSON.stringify(stored));
  }

  const storedLoans = JSON.parse(localStorage.getItem('agf_new_loans') || '[]');
  const storedOrns  = JSON.parse(localStorage.getItem('agf_new_ornaments') || '{}');

  const loans = [
    { id:'GL-2051', cust:'CUST-1006', scheme:'SCH-03', opened:'2026-07-28', due:'2026-10-28', principal:118000, outstanding:118472, weight:24.6, status:'Active',   pledge:'Not Pledged', packet:'PKT-2051', locker:'LKR-A2' },
    { id:'GL-2049', cust:'CUST-1004', scheme:'SCH-02', opened:'2026-07-22', due:'2027-01-22', principal:236000, outstanding:237430, weight:44.1, status:'Active',   pledge:'Not Pledged', packet:'PKT-2049', locker:'LKR-A1' },
    { id:'GL-2046', cust:'CUST-1003', scheme:'SCH-01', opened:'2026-07-14', due:'2027-07-14', principal:87500,  outstanding:88010,  weight:17.4, status:'Pending Approval', pledge:'Not Pledged', packet:'—', locker:'—' },
    { id:'GL-2044', cust:'CUST-1002', scheme:'SCH-01', opened:'2026-06-19', due:'2027-06-19', principal:152000, outstanding:153980, weight:30.3, status:'Active',   pledge:'Bank Pledged', packet:'PKT-2044', locker:'Bank: SIB Koratty', bank:'South Indian Bank', bankRef:'SIB/RPL/8821' },
    { id:'GL-2041', cust:'CUST-1001', scheme:'SCH-02', opened:'2026-05-30', due:'2026-11-30', principal:195000, outstanding:199120, weight:36.2, status:'Due Soon', pledge:'Not Pledged', packet:'PKT-2041', locker:'LKR-B1' },
    { id:'GL-2038', cust:'CUST-1004', scheme:'SCH-03', opened:'2026-04-25', due:'2026-07-25', principal:64000,  outstanding:66890,  weight:12.9, status:'Overdue',  pledge:'Not Pledged', packet:'PKT-2038', locker:'LKR-A2' },
    { id:'GL-2035', cust:'CUST-1008', scheme:'SCH-01', opened:'2026-03-12', due:'2027-03-12', principal:143000, outstanding:141200, weight:28.7, status:'Active',   pledge:'Bank Pledged', packet:'PKT-2035', locker:'Bank: Federal Bank', bank:'Federal Bank', bankRef:'FED/RPL/4410' },
    { id:'GL-2029', cust:'CUST-1005', scheme:'SCH-02', opened:'2025-12-04', due:'2026-06-04', principal:98000,  outstanding:109350, weight:19.8, status:'Auction Eligible', pledge:'Not Pledged', packet:'PKT-2029', locker:'LKR-C1' },
    { id:'GL-1968', cust:'CUST-1001', scheme:'SCH-01', opened:'2025-06-10', due:'2026-06-10', principal:75000,  outstanding:0,      weight:15.1, status:'Closed',   pledge:'Released', packet:'Released', locker:'—' },
  ];

  const ornaments = {
    'GL-2051':[ {n:'Gold Chain',   purity:'22K', gross:12.4, net:12.1, qty:1, val:80949}, {n:'Bangle Pair', purity:'22K', gross:12.6, net:12.5, qty:2, val:83625} ],
    'GL-2049':[ {n:'Necklace',     purity:'22K', gross:28.3, net:27.8, qty:1, val:185982}, {n:'Ring',       purity:'22K', gross:8.4,  net:8.2,  qty:2, val:54858},  {n:'Earring Set', purity:'18K', gross:8.5, net:8.1, qty:1, val:44388} ],
    'GL-2046':[ {n:'Bangle',       purity:'22K', gross:17.8, net:17.4, qty:2, val:116406} ],
    'GL-2044':[ {n:'Chain',        purity:'22K', gross:19.1, net:18.7, qty:1, val:125103}, {n:'Pendant',    purity:'22K', gross:12.0, net:11.6, qty:1, val:77604} ],
    'GL-2041':[ {n:'Necklace',     purity:'22K', gross:24.8, net:24.2, qty:1, val:161898}, {n:'Ring',       purity:'22K', gross:6.4,  net:6.2,  qty:3, val:41478} ],
    'GL-2038':[ {n:'Bracelet',     purity:'22K', gross:13.4, net:12.9, qty:1, val:86301} ],
    'GL-2035':[ {n:'Chain',        purity:'22K', gross:16.5, net:16.1, qty:1, val:107709}, {n:'Stud Pair',  purity:'22K', gross:7.2,  net:7.0,  qty:1, val:46830},  {n:'Ring',        purity:'18K', gross:6.0, net:5.6, qty:2, val:30688} ],
    'GL-2029':[ {n:'Chain',        purity:'22K', gross:20.6, net:19.8, qty:1, val:132462} ],
    'GL-1968':[ {n:'Bangle',       purity:'22K', gross:15.6, net:15.1, qty:2, val:101019} ],
  };

  // merge loans created through the New Loan form (persisted in localStorage)
  loans.unshift(...storedLoans);
  Object.assign(ornaments, storedOrns);

  function addLoan(loan, orns){
    loans.unshift(loan);
    storedLoans.unshift(loan);
    ornaments[loan.id] = orns;
    storedOrns[loan.id] = orns;
    try {
      localStorage.setItem('agf_new_loans', JSON.stringify(storedLoans));
      localStorage.setItem('agf_new_ornaments', JSON.stringify(storedOrns));
      return true;
    } catch(e){ return false; }
  }

  const storedLedger = JSON.parse(localStorage.getItem('agf_ledger_extra') || '{}');
  const loanOverrides = JSON.parse(localStorage.getItem('agf_loan_overrides') || '{}');
  loans.forEach(l => { if (loanOverrides[l.id]) Object.assign(l, loanOverrides[l.id]); });

  const ledger = {
    'GL-2041':[
      { d:'2026-05-30', desc:'Loan disbursed', debit:195000, credit:0, mode:'Cash', ref:'DSB-2041' },
      { d:'2026-06-30', desc:'Interest payment', debit:0, credit:2356, mode:'UPI', ref:'PAY-8812' },
      { d:'2026-07-30', desc:'Interest accrued (July)', debit:2356, credit:0, mode:'—', ref:'INT-0726' },
    ],
    'GL-2038':[
      { d:'2026-04-25', desc:'Loan disbursed', debit:64000, credit:0, mode:'Cash', ref:'DSB-2038' },
      { d:'2026-05-25', desc:'Interest payment', debit:0, credit:853, mode:'Cash', ref:'PAY-8571' },
      { d:'2026-07-25', desc:'Penal interest applied', debit:1280, credit:0, mode:'—', ref:'PNL-0311' },
    ],
  };

  // merge payments recorded through the Record Payment modal (persisted in localStorage)
  Object.keys(storedLedger).forEach(id => {
    ledger[id] = (ledger[id] || []).concat(storedLedger[id]);
  });

  function updateLoan(loanId, fields){
    const l = loans.find(x => x.id === loanId);
    if(!l) return false;
    Object.assign(l, fields);
    loanOverrides[loanId] = Object.assign(loanOverrides[loanId] || {}, fields);
    try { localStorage.setItem('agf_loan_overrides', JSON.stringify(loanOverrides)); return true; }
    catch(e){ return false; }
  }

  function addPayment(loanId, entry){
    (ledger[loanId] = ledger[loanId] || []).push(entry);
    (storedLedger[loanId] = storedLedger[loanId] || []).push(entry);
    const l = loans.find(x => x.id === loanId);
    if (l && entry.credit){
      l.outstanding = Math.max(0, (l.outstanding || 0) - entry.credit);
      loanOverrides[loanId] = { outstanding: l.outstanding };
    }
    try {
      localStorage.setItem('agf_ledger_extra', JSON.stringify(storedLedger));
      localStorage.setItem('agf_loan_overrides', JSON.stringify(loanOverrides));
      return true;
    } catch(e){ return false; }
  }

  const packets = [
    { id:'PKT-2051', loan:'GL-2051', cust:'Priya Nair',     items:2, weight:24.6, locker:'LKR-A2', status:'Locker Stored', qr:'AGF-PKT-2051' },
    { id:'PKT-2049', loan:'GL-2049', cust:'Meera Krishnan', items:4, weight:44.1, locker:'LKR-A1', status:'Locker Stored', qr:'AGF-PKT-2049' },
    { id:'PKT-2044', loan:'GL-2044', cust:'Lakshmi Menon',  items:2, weight:30.3, locker:'SIB Koratty', status:'Bank Pledged', qr:'AGF-PKT-2044' },
    { id:'PKT-2041', loan:'GL-2041', cust:'Suresh Kumar',   items:4, weight:36.2, locker:'LKR-B1', status:'Locker Stored', qr:'AGF-PKT-2041' },
    { id:'PKT-2038', loan:'GL-2038', cust:'Meera Krishnan', items:1, weight:12.9, locker:'LKR-A2', status:'Locker Stored', qr:'AGF-PKT-2038' },
    { id:'PKT-2035', loan:'GL-2035', cust:'Ananya Pillai',  items:4, weight:28.7, locker:'Federal Bank', status:'Bank Pledged', qr:'AGF-PKT-2035' },
    { id:'PKT-2029', loan:'GL-2029', cust:'Thomas George',  items:1, weight:19.8, locker:'LKR-C1', status:'Ready for Release', qr:'AGF-PKT-2029' },
  ];

  const lockers = JSON.parse(localStorage.getItem('agf_lockers') || 'null') || [
    { id:'LKR-A1', branch:'Koratty',  packets:1, cap:40, status:'Active' },
    { id:'LKR-A2', branch:'Koratty',  packets:2, cap:40, status:'Active' },
    { id:'LKR-B1', branch:'Angamaly', packets:1, cap:30, status:'Active' },
    { id:'LKR-C1', branch:'Kodakara', packets:1, cap:30, status:'Active' },
  ];

  function saveLockers(){
    localStorage.setItem('agf_lockers', JSON.stringify(lockers));
  }

  const storedExpenses = JSON.parse(localStorage.getItem('agf_expenses') || '[]');

  const expenses = [
    { d:'2026-07-30', cat:'Rent & Utilities', amt:18500, mode:'Bank', payee:'KSEB / Landlord', branch:'Koratty', status:'Approved' },
    { d:'2026-07-29', cat:'Salaries',         amt:96000, mode:'Bank', payee:'Staff payroll',   branch:'All',     status:'Approved' },
    { d:'2026-07-29', cat:'Transportation',   amt:1450,  mode:'Cash', payee:'Gold movement — SIB', branch:'Koratty', status:'Approved' },
    { d:'2026-07-28', cat:'Marketing',        amt:7500,  mode:'UPI',  payee:'Local ads',       branch:'Koratty', status:'Pending' },
    { d:'2026-07-27', cat:'Bank Charges',     amt:820,   mode:'Bank', payee:'SIB',             branch:'Angamaly', status:'Approved' },
    { d:'2026-07-26', cat:'Maintenance',      amt:3200,  mode:'Cash', payee:'AC service',      branch:'Kodakara', status:'Approved' },
  ];

  // merge expenses recorded through the Record Expense modal (persisted in localStorage)
  expenses.unshift(...storedExpenses);

  function addExpense(e){
    expenses.unshift(e);
    storedExpenses.unshift(e);
    try {
      localStorage.setItem('agf_expenses', JSON.stringify(storedExpenses));
      return true;
    } catch(err){
      // receipt image may have overflowed the storage quota — retry without it
      if(e.img){
        delete e.img;
        try { localStorage.setItem('agf_expenses', JSON.stringify(storedExpenses)); return true; } catch(e2){}
      }
      expenses.shift(); storedExpenses.shift();
      return false;
    }
  }

  // cash-in / cash-out movements recorded on the Cash & Expenses page
  const cashMovements = JSON.parse(localStorage.getItem('agf_cash_movements') || '[]');

  function saveCashMovements(){
    localStorage.setItem('agf_cash_movements', JSON.stringify(cashMovements));
  }

  function addCashMovement(m){
    m.id = 'CSH-' + Date.now().toString(36).toUpperCase();
    cashMovements.unshift(m);
    try { saveCashMovements(); return true; } catch(e){ return false; }
  }

  function setCashLoanStatus(id, status){
    const m = cashMovements.find(x => x.id === id);
    if(!m) return false;
    m.status = status;
    try { saveCashMovements(); return true; } catch(e){ return false; }
  }

  const requests = [
    { id:'REQ-311', type:'Extension', loan:'GL-2041', cust:'Suresh Kumar',  detail:'Extend by 3 months', date:'2026-07-29', status:'Pending' },
    { id:'REQ-310', type:'Release',   loan:'GL-2029', cust:'Thomas George', detail:'Full settlement & gold release', date:'2026-07-28', status:'Pending' },
    { id:'REQ-309', type:'Extension', loan:'GL-2038', cust:'Meera Krishnan',detail:'Extend by 1 month',  date:'2026-07-27', status:'Pending' },
    { id:'REQ-305', type:'Release',   loan:'GL-1968', cust:'Suresh Kumar',  detail:'Closure — released 12/06', date:'2026-06-10', status:'Completed' },
  ];

  const approvals = [
    { loan:'GL-2046', cust:'Abdul Rasheed', amt:87500, stage:'Branch Manager', requestedBy:'Deepak (Operator)', date:'2026-07-30' },
  ];

  const auctions = [
    { loan:'GL-2029', cust:'Thomas George', weight:19.8, outstanding:109350, eligible:'2026-07-04', stage:'Notice Issued', notice:'2026-07-18', auctionDate:'—', sale:0 },
  ];

  // apply auction changes made in the UI (persisted in localStorage)
  const auctionUpdates = JSON.parse(localStorage.getItem('agf_auction_updates') || '{}');
  auctions.forEach(a => { if (auctionUpdates[a.loan]) Object.assign(a, auctionUpdates[a.loan]); });

  function updateAuction(loan, fields){
    const a = auctions.find(x => x.loan === loan);
    if(!a) return false;
    Object.assign(a, fields);
    auctionUpdates[loan] = Object.assign(auctionUpdates[loan] || {}, fields);
    try { localStorage.setItem('agf_auction_updates', JSON.stringify(auctionUpdates)); return true; }
    catch(e){ return false; }
  }

  const banks = [
    { name:'South Indian Bank', branch:'Koratty',  ifsc:'SIBL0000221', pledged:1, amt:130000 },
    { name:'Federal Bank',      branch:'Chalakudy',ifsc:'FDRL0001443', pledged:1, amt:98000 },
  ];

  const storedEmployees = JSON.parse(localStorage.getItem('agf_employees') || '[]');

  const employees = [
    { id:'EMP-01', name:'Rajesh Menon', role:'Administrator', branch:'Koratty',  loans:64, collections:842000, followups:38, pending:2 },
    { id:'EMP-02', name:'Anitha K',     role:'Branch Manager', branch:'Koratty', loans:51, collections:611500, followups:52, pending:4 },
    { id:'EMP-03', name:'Deepak S',     role:'Loan Operator', branch:'Angamaly', loans:47, collections:388200, followups:61, pending:6 },
    { id:'EMP-04', name:'Sindhu R',     role:'Cashier',       branch:'Koratty',  loans:0,  collections:912400, followups:12, pending:1 },
    { id:'EMP-05', name:'Vipin T',      role:'Collection Staff', branch:'Kodakara', loans:0, collections:214800, followups:89, pending:9 },
  ];

  // merge employees added through the Add Employee modal (persisted in localStorage)
  employees.push(...storedEmployees);

  function addEmployee(e){
    const nextNum = Math.max(...employees.map(x => +String(x.id).replace('EMP-','') || 0)) + 1;
    e.id = 'EMP-' + String(nextNum).padStart(2,'0');
    employees.push(e);
    storedEmployees.push(e);
    try { localStorage.setItem('agf_employees', JSON.stringify(storedEmployees)); return e.id; }
    catch(err){ employees.pop(); storedEmployees.pop(); return null; }
  }

  const calendarEvents = {
    // day of current month -> events
    2:[{t:'GL-2044 interest due', c:'due'}],
    4:[{t:'GL-2029 auction review', c:'over'}],
    7:[{t:'Follow-up: T George', c:'fup'}],
    12:[{t:'GL-2035 interest due', c:'due'}],
    15:[{t:'PTP: Suresh Kumar', c:'fup'}],
    22:[{t:'GL-2049 interest due', c:'due'}],
    25:[{t:'GL-2038 OVERDUE', c:'over'},{t:'Follow-up: M Krishnan', c:'fup'}],
    28:[{t:'GL-2051 interest due', c:'due'}],
    30:[{t:'GL-2041 interest rcvd', c:'pay'}],
  };

  function saveRates(r){
    localStorage.setItem('agf_rates', JSON.stringify(r));
    rateHistory.unshift({ date:r.date, k24:r.k24, k22:r.k22, k18:r.k18, by:r.setBy });
    localStorage.setItem('agf_rate_history', JSON.stringify(rateHistory.slice(0,30)));
  }

  return { rates, rateHistory, schemes, customers, loans, ornaments, ledger, packets, lockers,
           expenses, requests, approvals, auctions, banks, employees, calendarEvents, saveRates, addCustomer, saveSchemes, addLoan, saveLockers, addPayment,
           cashMovements, addCashMovement, setCashLoanStatus, addExpense, addEmployee, updateLoan, updateAuction };
})();
