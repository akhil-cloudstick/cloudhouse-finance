package bank

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"gorm.io/gorm"

	"ambikagold/backend/internal/platform/httpx"
)

var ErrNameRequired = httpx.NewBadRequest("name is required")
var ErrPhoneInvalid = httpx.NewBadRequest("phone number must be exactly 10 digits")

var phoneRe = regexp.MustCompile(`^\d{10}$`)

// CreateInput mirrors the fields an admin supplies via the "Add Bank" form.
type CreateInput struct {
	Name      string
	Branch    string
	Ifsc      string
	AccountNo string
	Phone     string
}

// Service implements bank business rules on top of the Repository.
type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) List(ctx context.Context, query string, limit, offset int) ([]Bank, int64, error) {
	return s.repo.FindAll(ctx, query, limit, offset)
}

// FindOrCreate trims the given name, rejects it if empty, and returns the
// existing row with a case-insensitive matching name if one exists;
// otherwise it creates and returns a new row (using Branch/Ifsc from in if
// a new row is created — they're ignored when reusing an existing bank).
// The bool result reports whether a new row was created (true) or an
// existing one was reused (false), so the handler can pick the right HTTP
// status.
func (s *Service) FindOrCreate(ctx context.Context, in CreateInput) (*Bank, bool, error) {
	trimmed := strings.TrimSpace(in.Name)
	if trimmed == "" {
		return nil, false, ErrNameRequired
	}
	phone := strings.TrimSpace(in.Phone)
	if phone != "" && !phoneRe.MatchString(phone) {
		return nil, false, ErrPhoneInvalid
	}

	existing, err := s.repo.FindByName(ctx, trimmed)
	if err == nil {
		return existing, false, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, err
	}

	rec := &Bank{Name: trimmed, Branch: strings.TrimSpace(in.Branch), Ifsc: strings.TrimSpace(in.Ifsc), AccountNo: strings.TrimSpace(in.AccountNo), Phone: phone}
	if err := s.repo.Create(ctx, rec); err != nil {
		return nil, false, err
	}
	return rec, true, nil
}
