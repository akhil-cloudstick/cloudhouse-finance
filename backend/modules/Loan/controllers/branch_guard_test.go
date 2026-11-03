package controllers

import "testing"

func TestBranchAllows(t *testing.T) {
	one, two := uint(1), uint(2)
	cases := []struct {
		name       string
		loanBranch uint
		scope      *uint
		want       bool
	}{
		{"cross-branch caller (nil scope) sees any branch", 2, nil, true},
		{"same branch is allowed", 1, &one, true},
		{"other branch is denied", 2, &one, false},
		{"other branch is denied (reverse)", 1, &two, false},
	}
	for _, tc := range cases {
		if got := branchAllows(tc.loanBranch, tc.scope); got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}
