package packet

import "testing"

// TestTransitionGraph exercises the packet lifecycle's allowed forward-
// transition graph in isolation (no DB required): valid transitions must be
// allowed, and any skip/backwards jump — most notably PacketGenerated ->
// BankPledged, which skips Locker Stored — must be rejected.
func TestTransitionGraph(t *testing.T) {
	valid := []struct{ from, to string }{
		{StatusPacketGenerated, StatusLockerStored},
		{StatusLockerStored, StatusBankPledged},
		{StatusLockerStored, StatusReleased},
		{StatusBankPledged, StatusReturned},
		{StatusReturned, StatusLockerStored},
		{StatusReturned, StatusReleased},
		{StatusReadyForRelease, StatusReleased}, // legacy status, still terminates the same way
	}
	for _, tc := range valid {
		if !isAllowed(tc.from, tc.to) {
			t.Errorf("expected %q -> %q to be allowed", tc.from, tc.to)
		}
	}

	invalid := []struct{ from, to string }{
		{StatusPacketGenerated, StatusBankPledged}, // skips Locker Stored
		{StatusPacketGenerated, StatusReturned},
		{StatusPacketGenerated, StatusReleased},
		{StatusBankPledged, StatusLockerStored}, // must go through Returned
		{StatusBankPledged, StatusReleased},
		{StatusReadyForRelease, StatusLockerStored},
		{StatusReadyForRelease, StatusBankPledged},
		{StatusReleased, StatusLockerStored}, // terminal
		{StatusReleased, StatusReadyForRelease},
	}
	for _, tc := range invalid {
		if isAllowed(tc.from, tc.to) {
			t.Errorf("expected %q -> %q to be rejected", tc.from, tc.to)
		}
	}
}

// fakeLockerCapacity is a minimal LockerCapacityProvider stub for
// RecordMovement's locker-capacity branch, used by service-level tests that
// don't need a real DB.
type fakeLockerCapacity struct {
	capacity int
	active   bool
	ok       bool
}

func (f fakeLockerCapacity) Capacity(uint) (int, bool, bool, error) {
	return f.capacity, f.active, f.ok, nil
}
