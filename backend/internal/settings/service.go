package settings

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/platform/httpx"
)

var (
	ErrInvalidCategory = httpx.NewNotFound("unknown settings category")
	ErrValueRequired   = httpx.NewBadRequest("value is required")
)

// ApiKeyView is what the API returns per category — the decrypted value is
// included, per the admin's "full value retrievable" requirement (see
// api_documentation.md). IsSet distinguishes "configured with an empty-ish
// value" from "never configured".
type ApiKeyView struct {
	Category  Category `json:"category"`
	Name      string   `json:"name"`
	Value     string   `json:"value"`
	IsSet     bool     `json:"isSet"`
	UpdatedAt string   `json:"updatedAt,omitempty"`
}

// SetInput mirrors the fields the admin supplies via the Settings page.
type SetInput struct {
	Name  string
	Value string
}

// Service implements settings business rules on top of the Repository,
// encrypting/decrypting values via the injected Cipher.
type Service struct {
	repo   *Repository
	cipher *platform.Cipher
}

func NewService(repo *Repository, cipher *platform.Cipher) *Service {
	return &Service{repo: repo, cipher: cipher}
}

// List returns a view for every known category, whether or not it has been
// configured yet, so the Settings page can render all 6 integrations.
func (s *Service) List(ctx context.Context) ([]ApiKeyView, error) {
	rows, err := s.repo.FindAll(ctx)
	if err != nil {
		return nil, err
	}
	byCategory := make(map[string]ApiKeySetting, len(rows))
	for _, r := range rows {
		byCategory[r.Category] = r
	}

	views := make([]ApiKeyView, 0, len(AllCategories))
	for _, cat := range AllCategories {
		row, ok := byCategory[string(cat)]
		if !ok {
			views = append(views, ApiKeyView{Category: cat, IsSet: false})
			continue
		}
		value, err := s.cipher.Decrypt(row.EncryptedValue)
		if err != nil {
			return nil, err
		}
		views = append(views, ApiKeyView{
			Category:  cat,
			Name:      row.Name,
			Value:     value,
			IsSet:     true,
			UpdatedAt: row.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
		})
	}
	return views, nil
}

func (s *Service) Get(ctx context.Context, category Category) (*ApiKeyView, error) {
	if !category.Valid() {
		return nil, ErrInvalidCategory
	}
	row, err := s.repo.FindByCategory(ctx, category)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &ApiKeyView{Category: category, IsSet: false}, nil
	}
	if err != nil {
		return nil, err
	}
	value, err := s.cipher.Decrypt(row.EncryptedValue)
	if err != nil {
		return nil, err
	}
	return &ApiKeyView{
		Category:  category,
		Name:      row.Name,
		Value:     value,
		IsSet:     true,
		UpdatedAt: row.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}, nil
}

func (s *Service) Set(ctx context.Context, category Category, in SetInput) (*ApiKeyView, error) {
	if !category.Valid() {
		return nil, ErrInvalidCategory
	}
	if in.Value == "" {
		return nil, ErrValueRequired
	}
	encrypted, err := s.cipher.Encrypt(in.Value)
	if err != nil {
		return nil, err
	}
	row := &ApiKeySetting{
		Category:       string(category),
		Name:           in.Name,
		EncryptedValue: encrypted,
	}
	if err := s.repo.Upsert(ctx, row); err != nil {
		return nil, err
	}
	return s.Get(ctx, category)
}

func (s *Service) Delete(ctx context.Context, category Category) error {
	if !category.Valid() {
		return ErrInvalidCategory
	}
	return s.repo.DeleteByCategory(ctx, category)
}
