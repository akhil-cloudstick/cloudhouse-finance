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

type ornamentTypeRequest struct {
	Name string `json:"name"`
}

func insertOrnamentType(ctx context.Context, o *commonModels.OrnamentType) error {
	return config.DB.
		WithContext(ctx).Create(o).Error
}

func findOrnamentTypes(ctx context.Context, query string) ([]commonModels.OrnamentType, error) {
	var types []commonModels.OrnamentType
	q := config.DB.
		WithContext(ctx).Order("name asc")
	if query != "" {
		q = q.Where("name ILIKE ?", "%"+query+"%")
	}
	err := q.Find(&types).Error
	return types, err
}

func findOrnamentTypeByName(ctx context.Context, name string) (*commonModels.OrnamentType, error) {
	var o commonModels.OrnamentType
	if err := config.DB.
		WithContext(ctx).Where("name ILIKE ?", name).First(&o).Error; err != nil {
		return nil, err
	}
	return &o, nil
}

func listOrnamentTypes(ctx context.Context, query string) ([]commonModels.OrnamentType, error) {
	return findOrnamentTypes(ctx, query)
}

func FindOrnamentTypeOrCreate(ctx context.Context, name string) (*commonModels.OrnamentType, bool, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return nil, false, NewBadRequest("name is required")
	}
	existing, err := findOrnamentTypeByName(ctx, trimmed)
	if err == nil {
		return existing, false, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, err
	}
	rec := &commonModels.OrnamentType{Name: trimmed}
	if err := insertOrnamentType(ctx, rec); err != nil {
		return nil, false, err
	}
	return rec, true, nil
}

func ListOrnamentTypes(c echo.Context) error {
	ctx := auth.RequestContext(c)
	rec, err := listOrnamentTypes(ctx, c.QueryParam("search"))
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

func CreateOrnamentType(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req ornamentTypeRequest
	if err := BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	rec, created, err := FindOrnamentTypeOrCreate(ctx, req.Name)
	if err != nil {
		return FailErr(c, err)
	}
	if created {
		return Success(c, http.StatusOK, rec)
	}
	return Success(c, http.StatusOK, rec)
}
