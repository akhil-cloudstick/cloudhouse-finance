package controllers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

type setRequest struct {
	Name  string `json:"name"`
	Value string `json:"value" binding:"required"`
}

type ApiKeyView struct {
	Category  commonModels.Category `json:"category"`
	Name      string                `json:"name"`
	Value     string                `json:"value"`
	IsSet     bool                  `json:"is_set"`
	UpdatedAt string                `json:"updated_at,omitempty"`
}

type SetInput struct {
	Name  string
	Value string
}

func filterApiKeyViews(views []ApiKeyView, q string) []ApiKeyView {
	needle := strings.ToLower(strings.TrimSpace(q))
	if needle == "" {
		return views
	}
	kept := make([]ApiKeyView, 0, len(views))
	for _, v := range views {
		if strings.Contains(strings.ToLower(string(v.Category)), needle) ||
			strings.Contains(strings.ToLower(v.Name), needle) {
			kept = append(kept, v)
		}
	}
	return kept
}

func findAllSettings(ctx context.Context) ([]commonModels.ApiKeySetting, error) {
	var rows []commonModels.ApiKeySetting
	err := config.BaseDB.
		WithContext(ctx).Find(&rows).Error
	return rows, err
}

func findByCategory(ctx context.Context, category commonModels.Category) (*commonModels.ApiKeySetting, error) {
	var row commonModels.ApiKeySetting
	err := config.BaseDB.
		WithContext(ctx).Where("category = ?", string(category)).First(&row).Error
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func upsertSettings(ctx context.Context, row *commonModels.ApiKeySetting) error {
	var existing commonModels.ApiKeySetting
	err := config.BaseDB.
		WithContext(ctx).Where("category = ?", row.Category).First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		return config.BaseDB.
			WithContext(ctx).Create(row).Error
	}
	if err != nil {
		return err
	}
	existing.Name = row.Name
	existing.EncryptedValue = row.EncryptedValue
	return config.BaseDB.
		WithContext(ctx).Save(&existing).Error
}

func deleteByCategory(ctx context.Context, category commonModels.Category) error {
	return config.BaseDB.
		WithContext(ctx).Where("category = ?", string(category)).Delete(&commonModels.ApiKeySetting{}).Error
}

func listSettings(ctx context.Context) ([]ApiKeyView, error) {
	rows, err := findAllSettings(ctx)
	if err != nil {
		return nil, err
	}
	byCategory := make(map[string]commonModels.ApiKeySetting, len(rows))
	for _, r := range rows {
		byCategory[r.Category] = r
	}
	views := make([]ApiKeyView, 0, len(commonModels.AllCategories))
	for _, cat := range commonModels.AllCategories {
		row, ok := byCategory[string(cat)]
		if !ok {
			views = append(views, ApiKeyView{Category: cat, IsSet: false})
			continue
		}
		value, err := config.SettingsCipher.
			Decrypt(row.EncryptedValue)
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

func GetSettings(ctx context.Context, category commonModels.Category) (*ApiKeyView, error) {
	if !validCategory(category) {
		return nil, NewNotFound("unknown settings category")
	}
	row, err := findByCategory(ctx, category)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &ApiKeyView{Category: category, IsSet: false}, nil
	}
	if err != nil {
		return nil, err
	}
	value, err := config.SettingsCipher.
		Decrypt(row.EncryptedValue)
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

func setSettings(ctx context.Context, category commonModels.Category, in SetInput) (*ApiKeyView, error) {
	if !validCategory(category) {
		return nil, NewNotFound("unknown settings category")
	}
	if in.Value == "" {
		return nil, NewBadRequest("value is required")
	}
	encrypted, err := config.SettingsCipher.
		Encrypt(in.Value)
	if err != nil {
		return nil, err
	}
	row := &commonModels.ApiKeySetting{
		Category:       string(category),
		Name:           in.Name,
		EncryptedValue: encrypted,
	}
	if err := upsertSettings(ctx, row); err != nil {
		return nil, err
	}
	return GetSettings(ctx, category)
}

func deleteSettings(ctx context.Context, category commonModels.Category) error {
	if !validCategory(category) {
		return NewNotFound("unknown settings category")
	}
	return deleteByCategory(ctx, category)
}

func ListSettings(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := PageParams(c)
	views, err := listSettings(ctx)
	if err != nil {
		return FailErr(c, err)
	}
	views = filterApiKeyViews(views, c.QueryParam("search"))
	if limit > 0 {
		total := len(views)
		if offset > total {
			offset = total
		}
		end := offset + limit
		if end > total {
			end = total
		}
		return SuccessPage(c, page, limit, int64(total), views[offset:end])
	}
	return SuccessAll(c, views)
}

func GetSetting(c echo.Context) error {
	ctx := auth.RequestContext(c)
	category := commonModels.Category(c.Param("category"))
	view, err := GetSettings(ctx, category)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, view)
}

func SetSetting(c echo.Context) error {
	ctx := auth.RequestContext(c)
	category := commonModels.Category(c.Param("category"))
	var req setRequest
	if err := BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	view, err := setSettings(ctx, category, SetInput{Name: req.Name, Value: req.Value})
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, view)
}

func DeleteSetting(c echo.Context) error {
	ctx := auth.RequestContext(c)
	category := commonModels.Category(c.Param("category"))
	if err := deleteSettings(ctx, category); err != nil {
		return FailErr(c, err)
	}
	return SuccessMessage(c, http.StatusOK, "Setting cleared successfully")
}
