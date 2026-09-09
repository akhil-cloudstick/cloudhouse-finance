package platform

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"log"
)

// settingsDevFallbackSeed derives a fixed (not secret) dev-only encryption
// key when SETTINGS_ENCRYPTION_KEY isn't set, so encrypted values stay
// decryptable across restarts in local development. Never rely on this in
// production — set a real SETTINGS_ENCRYPTION_KEY there.
//
// FROZEN STRING — do not "fix" the old brand name here. This is not a label:
// it is hashed into the AES key that encrypted every value already sitting in
// a dev database. Change it and integration API keys stored through the
// Settings page stop decrypting, with no way back. Same for the Aadhaar seed
// below. Rebranding these is a data migration, not a rename.
const settingsDevFallbackSeed = "ambikagold-dev-only-settings-key-do-not-use-in-production"

// aadhaarDevFallbackSeed is the equivalent dev-only fallback for
// AADHAAR_ENCRYPTION_KEY (see NewAadhaarCipher). Deliberately a different
// seed from Settings' — the two ciphers must never share a key, even the
// dev fallback, since customer-PII and integration-API-key encryption have
// independent rotation needs.
//
// Frozen for the same reason as settingsDevFallbackSeed: this one guards
// stored customer Aadhaar numbers.
const aadhaarDevFallbackSeed = "ambikagold-dev-only-aadhaar-key-do-not-use-in-production"

// Cipher provides AES-256-GCM encrypt/decrypt for secrets at rest (see
// internal/settings, which stores integration API keys this way, and
// internal/customer, which stores each customer's Aadhaar number this way).
type Cipher struct {
	gcm cipher.AEAD
}

// NewCipher builds a Cipher from a base64-encoded 32-byte key. If keyB64 is
// empty, a fixed dev-only key derived from devFallbackSeed is used instead
// (with a loud warning) so values stay decryptable across restarts in local
// development — callers should pass a distinct devFallbackSeed per use case
// so two unconfigured ciphers never accidentally share a key.
func NewCipher(keyB64, devFallbackSeed string) (*Cipher, error) {
	var key []byte
	if keyB64 == "" {
		log.Println("WARNING: encryption key is not set — using a fixed, publicly-known dev-only key. Set a real one before storing real secrets.")
		sum := sha256.Sum256([]byte(devFallbackSeed))
		key = sum[:]
	} else {
		decoded, err := base64.StdEncoding.DecodeString(keyB64)
		if err != nil {
			return nil, errors.New("encryption key must be valid base64")
		}
		if len(decoded) != 32 {
			return nil, errors.New("encryption key must decode to exactly 32 bytes (AES-256)")
		}
		key = decoded
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Cipher{gcm: gcm}, nil
}

// NewSettingsCipher builds the Cipher used by internal/settings to encrypt
// integration API keys at rest, keyed from SETTINGS_ENCRYPTION_KEY.
func NewSettingsCipher(keyB64 string) (*Cipher, error) {
	return NewCipher(keyB64, settingsDevFallbackSeed)
}

// NewAadhaarCipher builds the Cipher used by internal/customer to encrypt
// each customer's Aadhaar number at rest, keyed from AADHAAR_ENCRYPTION_KEY.
// Deliberately a separate key from Settings' — customer-PII encryption and
// integration-API-key encryption should be rotatable independently.
func NewAadhaarCipher(keyB64 string) (*Cipher, error) {
	return NewCipher(keyB64, aadhaarDevFallbackSeed)
}

// Encrypt returns a base64-encoded "nonce || ciphertext" string.
func (c *Cipher) Encrypt(plaintext string) (string, error) {
	nonce := make([]byte, c.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := c.gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// Decrypt reverses Encrypt.
func (c *Cipher) Decrypt(encoded string) (string, error) {
	if encoded == "" {
		return "", nil
	}
	sealed, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	nonceSize := c.gcm.NonceSize()
	if len(sealed) < nonceSize {
		return "", errors.New("ciphertext too short")
	}
	nonce, ciphertext := sealed[:nonceSize], sealed[nonceSize:]
	plaintext, err := c.gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}
