package localstore

// Seal protects a value for the current Windows user (DPAPI on Windows), so a copy of the file on another PC or under
// another account cannot be read. The LAN business key is kept this way.
func Seal(plain []byte) ([]byte, error) { return protect(plain) }

// Unseal reverses Seal for the same Windows user.
func Unseal(sealed []byte) ([]byte, error) { return unprotect(sealed) }
