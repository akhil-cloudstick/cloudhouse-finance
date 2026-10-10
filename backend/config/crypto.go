package config

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"log"
)

var (
	AadhaarCipher  *Cipher
	SettingsCipher *Cipher
)

type Cipher struct {
	gcm cipher.AEAD
	key []byte
}

func (c *Cipher) Fingerprint(plaintext string) string {
	m := hmac.New(sha256.New, c.key)
	m.Write([]byte(plaintext))
	return hex.EncodeToString(m.Sum(nil))
}

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
	return &Cipher{gcm: gcm, key: key}, nil
}

func NewSettingsCipher(keyB64 string) (*Cipher, error) {
	return NewCipher(keyB64, "ambikagold-dev-only-settings-key-do-not-use-in-production")
}

func NewAadhaarCipher(keyB64 string) (*Cipher, error) {
	return NewCipher(keyB64, "ambikagold-dev-only-aadhaar-key-do-not-use-in-production")
}

func (c *Cipher) Encrypt(plaintext string) (string, error) {
	nonce := make([]byte, c.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := c.gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

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
