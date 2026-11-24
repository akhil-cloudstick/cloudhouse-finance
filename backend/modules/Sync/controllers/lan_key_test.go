package controllers

import "testing"

func TestLanKeyIsStablePerBusinessAndSecret(t *testing.T) {
	a1 := lanKeyFor("secret-one", 7)
	if a1 != lanKeyFor("secret-one", 7) {
		t.Fatal("the key must be the same every time for one business, so every PC of it gets the same one")
	}
	if a1 == lanKeyFor("secret-one", 8) {
		t.Fatal("two businesses must not share a key")
	}
	if a1 == lanKeyFor("secret-two", 7) {
		t.Fatal("the key must depend on the server's secret, so a PC cannot compute it itself")
	}
	if len(a1) != 64 {
		t.Fatalf("want a 64 character hex key, got %d", len(a1))
	}
}
