package demo

var branchFixtures = []branchFixture{
	{"Thrissur", "BR-02", "Round South, Thrissur, Kerala 680001", "9000010002", true},
	{"Kochi", "BR-03", "MG Road, Ernakulam, Kochi 682011", "9000010003", true},
	{"Kozhikode", "BR-04", "Mavoor Road, Kozhikode 673004", "9000010004", true},
	{"Kannur", "BR-05", "Fort Road, Kannur 670001", "9000010005", true},
	{"Palakkad", "BR-06", "Coimbatore Road, Palakkad 678001", "9000010006", true},
	{"Alappuzha", "BR-07", "Beach Road, Alappuzha 688012", "9000010007", true},
	{"Kollam", "BR-08", "Chinnakada, Kollam 691001", "9000010008", true},
	{"Thiruvananthapuram", "BR-09", "Statue Junction, Thiruvananthapuram 695001", "9000010009", true},
	{"Malappuram", "BR-10", "Up Hill, Malappuram 676505", "9000010010", false},
}

var employeeFixtures = []employeeFixture{
	{"Manoj Menon", "Management", "manoj.m", "9000020001"},
	{"Priya Nair", "Branch Manager", "priya.bm", "9000020002"},
	{"Rajesh Kumar", "Branch Manager", "rajesh.bm", "9000020003"},
	{"Anoop Krishnan", "Loan Operator", "anoop.lo", "9000020004"},
	{"Divya Pillai", "Loan Operator", "divya.lo", "9000020005"},
	{"Sreejith Varma", "Cashier", "sreejith.c", "9000020006"},
	{"Lakshmi Devi", "Cashier", "lakshmi.c", "9000020007"},
	{"Thomas Joseph", "Accountant", "thomas.a", "9000020008"},
	{"Faisal Rahman", "Collection Staff", "faisal.cs", "9000020009"},
	{"Geetha Mohan", "Auction Administrator", "geetha.aa", "9000020010"},
	{"Suresh Babu", "Auditor", "suresh.au", "9000020011"},
}

var customerFixtures = []customerFixture{
	{"Ramesh Chandran", "9000030001", "Kizhakke Veedu, Ollur, Thrissur", "ABCPR1234A", "Thrissur", "Thrissur", "Ollur", 44, "Sunitha Ramesh", "Wife", "900000000001", false, "", "", ""},
	{"Ayesha Beevi", "9000030002", "Pallipuram House, Chalakudy, Thrissur", "ABCPA2345B", "Thrissur", "Mukundapuram", "Chalakudy", 38, "Abdul Salam", "Husband", "900000000002", false, "", "", ""},
	{"Joseph Mathew", "9000030003", "Thekkethil, Angamaly, Ernakulam", "ABCPJ3456C", "Ernakulam", "Aluva", "Angamaly", 51, "Mary Joseph", "Wife", "900000000003", false, "", "", ""},
	{"Sindhu Rajan", "9000030004", "Nandanam, Perumbavoor, Ernakulam", "ABCPS4567D", "Ernakulam", "Kunnathunad", "Perumbavoor", 35, "Rajan Nair", "Husband", "900000000004", false, "", "", ""},
	{"Kunhi Muhammed", "9000030005", "Valiya Parambu, Tirur, Malappuram", "ABCPK5678E", "Malappuram", "Tirur", "Tirur", 60, "Zainaba", "Wife", "900000000005", false, "", "", ""},
	{"Bindu Sasi", "9000030006", "Sreelakam, Kodungallur, Thrissur", "ABCPB6789F", "Thrissur", "Mukundapuram", "Kodungallur", 41, "Sasidharan", "Husband", "900000000006", false, "", "", ""},
	{"Vijayan Pillai", "9000030007", "Ambadi, Cherthala, Alappuzha", "ABCPV7890G", "Alappuzha", "Cherthala", "Cherthala", 57, "Radha Vijayan", "Wife", "", false, "", "", ""},
	{"Nisha Thomas", "9000030008", "Palathinkal, Kothamangalam, Ernakulam", "ABCPN8901H", "Ernakulam", "Kothamangalam", "Kothamangalam", 33, "Thomas Kurian", "Husband", "", false, "", "", ""},
	{"Abdul Latheef", "9000030009", "Kadavu Road, Ponnani, Malappuram", "ABCPA9012I", "Malappuram", "Ponnani", "Ponnani", 47, "Suhara", "Wife", "", false, "", "", ""},
	{"Krishnankutty Nair", "9000030010", "Vadakke Madom, Guruvayur, Thrissur", "ABCPK0123J", "Thrissur", "Chavakkad", "Guruvayur", 66, "Saraswathi", "Wife", "900000000010", true, "Krishnankutty Nair", "10120030040050", "SBIN0001234"},
	{"Mariamma Varkey", "9000030011", "Puthenpurayil, Muvattupuzha, Ernakulam", "ABCPM1234K", "Ernakulam", "Muvattupuzha", "Muvattupuzha", 58, "Varkey Joseph", "Husband", "900000000011", true, "Mariamma Varkey", "10120030040051", "FDRL0002345"},
	{"Hariharan Iyer", "9000030012", "Agraharam, Palakkad", "ABCPH2345L", "Palakkad", "Palakkad", "Kalpathy", 62, "Meenakshi", "Wife", "900000000012", true, "Hariharan Iyer", "10120030040052", "CNRB0003456"},
}

var customerKYCPlan = []customerKYCState{
	{"Verified", "Verified", "Verified"},
	{"Verified", "Verified", "Verified"},
	{"Verified", "Verified", "Verified"},
	{"Verified", "Verified", "Verified"},
	{"Pending", "Pending", "Pending"},
	{"Pending", "Pending", "Pending"},
	{"Pending", "Pending", "Pending"},
	{"Pending", "Verified", "Pending"},
	{"Pending", "Verified", "Pending"},
	{"Pending", "Name Mismatch", "Pending"},
	{"Pending", "Name Mismatch", "Pending"},
	{"Failed", "Verified", "Failed"},
}

var schemeFixtures = []schemeFixture{
	{"Gold Standard 12M", 12, 12, 75, "Monthly simple interest", 2, true},
	{"Gold Express 3M", 18, 3, 70, "Monthly simple interest", 3, true},
	{"Gold Saver 6M", 14, 6, 72, "Flat monthly", 2, true},
	{"Gold Plus 9M", 16, 9, 70, "Quarterly simple", 2.5, true},
	{"Gold Premium 24M", 13, 24, 75, "Compound monthly", 2, true},
	{"Agri Gold 6M", 11, 6, 68, "Monthly simple interest", 1.5, true},
	{"Micro Gold 3M", 24, 3, 65, "Flat monthly", 4, true},
	{"Business Gold 12M", 15, 12, 73, "Monthly simple interest", 2.5, true},
	{"Festival Gold 6M", 20, 6, 70, "Quarterly simple", 3, true},
	{"Legacy Gold 18M", 30, 18, 60, "Monthly simple interest", 4, false},
}

var goldRateFixtures = []float64{
	7180, 7215, 7190, 7240, 7265, 7230, 7255, 7290, 7310, 7285,
	7320, 7345, 7330, 7360, 7385, 7370, 7395, 7410, 7390, 7420,
}

var bankFixtures = []struct {
	Name, Branch, Ifsc, AccountNo, Phone string
}{
	{"State Bank of India", "Thrissur Main", "SBIN0001234", "30012345678", "9000040001"},
	{"Federal Bank", "Aluva", "FDRL0002345", "30012345679", "9000040002"},
	{"South Indian Bank", "Kochi", "SIBL0003456", "30012345680", "9000040003"},
	{"Canara Bank", "Palakkad", "CNRB0004567", "30012345681", "9000040004"},
	{"Union Bank of India", "Kollam", "UBIN0005678", "30012345682", "9000040005"},
	{"Bank of Baroda", "Kannur", "BARB0006789", "30012345683", "9000040006"},
	{"Punjab National Bank", "Kozhikode", "PUNB0007890", "30012345684", "9000040007"},
	{"Indian Overseas Bank", "Alappuzha", "IOBA0008901", "30012345685", "9000040008"},
	{"Kerala Gramin Bank", "Malappuram", "KLGB0009012", "30012345686", "9000040009"},
	{"ESAF Small Finance Bank", "Thrissur", "ESMF0000123", "30012345687", "9000040010"},
}

var ornamentTypeFixtures = []string{
	"Bangle", "Necklace", "Chain", "Ring", "Bracelet", "Ear Stud",
	"Pendant", "Anklet", "Coin", "Waist Belt", "Nose Pin", "Thali Chain",
}

var ornamentFixtures = []ornamentFixture{
	{"Bangle", "22K", 18.5, 0.5, 2},
	{"Necklace", "22K", 32.0, 1.0, 1},
	{"Chain", "22K", 12.4, 0.3, 1},
	{"Ring", "18K", 4.2, 0.1, 3},
	{"Bracelet", "22K", 9.8, 0.2, 1},
	{"Ear Stud", "18K", 3.6, 0.1, 2},
	{"Pendant", "22K", 6.5, 0.2, 1},
	{"Anklet", "22K", 22.3, 0.6, 2},
	{"Coin", "24K", 8.0, 0.0, 4},
	{"Thali Chain", "22K", 15.7, 0.4, 1},
}

var lockerFixtures = []struct {
	Code     string
	Capacity int
}{
	{"LKR-01", 40}, {"LKR-02", 40}, {"LKR-03", 30}, {"LKR-04", 30},
	{"LKR-05", 25}, {"LKR-06", 25}, {"LKR-07", 20}, {"LKR-08", 20},
	{"LKR-09", 15}, {"LKR-10", 15},
}

var expenseFixtures = []expenseFixture{
	{"Rent", "Bank Transfer", "Koratty Estates", "Monthly branch rent", 45000},
	{"Salary", "Bank Transfer", "Payroll", "Staff salary disbursement", 285000},
	{"Electricity", "UPI", "KSEB", "Bi-monthly electricity bill", 12400},
	{"Stationery", "Cash", "Sree Traders", "Printing and stationery", 3200},
	{"Travel", "Cash", "Anoop Krishnan", "Field collection travel", 2800},
	{"Maintenance", "UPI", "CoolAir Services", "AC servicing", 6500},
	{"Marketing", "Bank Transfer", "Prime Media", "Local newspaper insert", 18000},
	{"Insurance", "Bank Transfer", "New India Assurance", "Vault insurance premium", 52000},
	{"Bank Charges", "Bank Transfer", "State Bank of India", "Quarterly account charges", 1850},
	{"Security", "Bank Transfer", "Sentinel Guards", "Security guard deployment", 34000},
	{"Software", "UPI", "CloudHouse Systems", "Software subscription", 15000},
	{"Printing", "Cash", "Anitha Printers", "Pledge form printing", 4400},
	{"Fuel", "UPI", "IndianOil", "Two-wheeler fuel reimbursement", 3600},
	{"Audit Fee", "Bank Transfer", "Menon and Associates", "Statutory audit fee", 60000},
	{"Misc", "Cash", "Petty cash", "Miscellaneous branch expense", 1500},
}

var investmentPlanFixtures = []investmentPlanFixture{
	{"Monthly Income 12M", "Simple", 9.500, "Monthly", 12, 50000, true},
	{"Monthly Income 24M", "Simple", 10.000, "Monthly", 24, 100000, true},
	{"Monthly Income 36M", "Simple", 10.500, "Monthly", 36, 100000, true},
	{"Annual Growth 12M", "Compound", 9.750, "Yearly", 12, 50000, true},
	{"Annual Growth 24M", "Compound", 10.250, "Yearly", 24, 200000, true},
	{"Annual Growth 60M", "Compound", 11.000, "Yearly", 60, 500000, true},
	{"Senior Citizen 24M", "Simple", 11.000, "Monthly", 24, 25000, true},
	{"Short Term 12M", "Simple", 8.750, "Monthly", 12, 25000, true},
	{"Wealth Builder 36M", "Compound", 10.750, "Yearly", 36, 300000, true},
	{"Legacy Plan 60M", "Simple", 8.000, "Yearly", 60, 100000, false},
}

var reminderFixtures = []reminderFixture{
	{"Follow-Up", "Customer promised to visit branch with interest", -3},
	{"Promise-to-Pay", "Will settle interest after harvest payment", -1},
	{"Follow-Up", "Called; requested a week of time", 0},
	{"Custom", "Verify updated address proof", 1},
	{"Follow-Up", "Interest overdue, second reminder", 2},
	{"Promise-to-Pay", "Committed part payment of 10,000", 3},
	{"Follow-Up", "Discuss extension options before due date", 5},
	{"Custom", "Collect nominee KYC document", 7},
	{"Promise-to-Pay", "Agreed to close loan this month", 10},
	{"Follow-Up", "Pre-due courtesy call", 14},
	{"Custom", "Re-appraise ornaments for top-up request", 21},
	{"Follow-Up", "Quarterly relationship check-in", 30},
}

var customRoleFixtures = []struct{ Name, Description string }{
	{"Regional Manager", "Oversees several branches in one region"},
	{"Front Desk", "Reception and customer enquiries only"},
}

type branchFixture struct {
	Name, Code, Address, Phone string
	Active                     bool
}

type employeeFixture struct {
	Name, Role, Username, Phone string
}

type customerFixture struct {
	Name, Phone, Address, PAN, District, Taluk, Village string
	Age                                                 int
	NomineeName, NomineeRelation                        string
	Aadhaar                                             string
	Investor                                            bool
	BankAccountName, BankAccountNumber, BankIFSC        string
}

type customerKYCState struct {
	KYC, PAN, Aadhaar string
}

type schemeFixture struct {
	Name           string
	InterestRate   float64
	DurationMonths int
	LTVPercent     float64
	InterestMethod string
	PenalRate      float64
	Active         bool
}

type ornamentFixture struct {
	Name, Purity     string
	Gross, Deduction float64
	Quantity         int
}

type expenseFixture struct {
	Category, Mode, Payee, Remarks string
	Amount                         float64
}

type investmentPlanFixture struct {
	Name            string
	RateType        string
	RatePercent     float64
	PayoutFrequency string
	TenureMonths    int
	MinPrincipal    float64
	Active          bool
}

type reminderFixture struct {
	Type, Note string
	DueInDays  int
}
