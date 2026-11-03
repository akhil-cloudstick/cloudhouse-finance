package controllers

import "testing"

func TestCapacityHoldsPackets(t *testing.T) {
	if err := capacityHoldsPackets(15, 16); err == nil {
		t.Error("capacity 15 with 16 packets stored must be rejected")
	}
	if err := capacityHoldsPackets(16, 16); err != nil {
		t.Errorf("capacity equal to the stored packets is fine, got %v", err)
	}
	if err := capacityHoldsPackets(30, 16); err != nil {
		t.Errorf("capacity above the stored packets is fine, got %v", err)
	}
}
