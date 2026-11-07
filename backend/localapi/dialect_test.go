package localapi

import "testing"

func TestRewriteTurnsPostgresFormsIntoSQLite(t *testing.T) {
	cases := map[string]string{
		`name ILIKE ?`:       `name LIKE ?`,
		`updated_at < NOW()`: `updated_at < CURRENT_TIMESTAMP`,
		`ROUND(fineness_percent::numeric, 1) = ?`:     `ROUND(fineness_percent, 1) = ?`,
		`SELECT * FROM loans WHERE id = 1 FOR UPDATE`: `SELECT * FROM loans WHERE id = 1`,
		`to_char(occurred_on, 'DD-MM-YYYY') LIKE ?`:   `strftime('%d-%m-%Y', occurred_on) LIKE ?`,
		`to_char(opened_date, 'YYYY-MM') AS month`:    `strftime('%Y-%m', opened_date) AS month`,
		`SUM(EXTRACT(EPOCH FROM paid_on))`:            `SUM(CAST(strftime('%s', paid_on) AS INTEGER))`,
		`SELECT 1 FROM loans WHERE status = 'Active'`: `SELECT 1 FROM loans WHERE status = 'Active'`,
		`SELECT time FROM t WHERE x = '12:30'`:        `SELECT time FROM t WHERE x = '12:30'`,
	}
	for in, want := range cases {
		if got := rewrite(in); got != want {
			t.Errorf("rewrite(%q)\n got  %q\n want %q", in, got, want)
		}
	}
}
