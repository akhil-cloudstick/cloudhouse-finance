//go:build !windows

package localstore

// Off Windows the file is stored as is: the folder is private to the user (mode 0700) and the exe is only
// shipped for Windows today.
func protect(plain []byte) ([]byte, error)    { return plain, nil }
func unprotect(sealed []byte) ([]byte, error) { return sealed, nil }
