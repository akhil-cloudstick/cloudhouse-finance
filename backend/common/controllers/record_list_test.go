package controllers

import "testing"

func TestRecordListNamesTheFirstFewAndCountsTheRest(t *testing.T) {
	cases := []struct {
		items []string
		total int64
		want  string
	}{
		{[]string{"LN-1", "LN-2"}, 2, "LN-1, LN-2"},
		{[]string{"LN-1", "LN-2", "LN-3", "LN-4", "LN-5"}, 5, "LN-1, LN-2, LN-3, LN-4, LN-5"},
		{[]string{"LN-1", "LN-2", "LN-3", "LN-4", "LN-5"}, 12, "LN-1, LN-2, LN-3, LN-4, LN-5 and 7 more"},
		{[]string{"LN-1", "LN-2", "LN-3", "LN-4", "LN-5", "LN-6", "LN-7"}, 7, "LN-1, LN-2, LN-3, LN-4, LN-5 and 2 more"},
		{nil, 3, "3 more"},
	}
	for _, c := range cases {
		if got := RecordList(c.items, c.total); got != c.want {
			t.Errorf("RecordList(%v, %d) = %q, want %q", c.items, c.total, got, c.want)
		}
	}
}
