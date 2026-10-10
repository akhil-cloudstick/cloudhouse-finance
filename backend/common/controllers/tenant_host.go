package controllers

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"net/url"
	"strings"

	"gorm.io/gorm"
)

var BaseDomain = "cloudhousefinance.com"

var ReservedHostLabels = map[string]bool{
	"www":        true,
	"api":        true,
	"admin":      true,
	"superadmin": true,
}

func NormalizeHost(v string) string {
	v = strings.TrimSpace(strings.ToLower(v))
	if v == "" {
		return ""
	}
	if strings.Contains(v, "//") {
		if u, err := url.Parse(v); err == nil && u.Host != "" {
			v = u.Host
		}
	}
	v = strings.TrimSuffix(v, "/")
	if i := strings.IndexAny(v, "/?#"); i >= 0 {
		v = v[:i]
	}
	if !strings.HasPrefix(v, "[") {
		if i := strings.LastIndex(v, ":"); i >= 0 && !strings.Contains(v[i+1:], ":") {
			v = v[:i]
		}
	}
	return strings.TrimSuffix(v, ".")
}

func SetBaseDomain(domain string) {
	domain = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(domain)), ".")
	if domain != "" {
		BaseDomain = domain
	}
}

func SubdomainLabel(host string) (label string, ok bool) {
	h := NormalizeHost(host)
	if h == "" || BaseDomain == "" {
		return "", false
	}
	suffix := "." + BaseDomain
	if !strings.HasSuffix(h, suffix) {
		return "", false
	}
	candidate := strings.TrimSuffix(h, suffix)
	if candidate == "" || strings.Contains(candidate, ".") {
		return "", false
	}
	if ReservedHostLabels[candidate] {
		return "", false
	}
	return candidate, true
}

func FindByAppURL(ctx context.Context, host string) (*commonModels.Tenant, error) {
	h := NormalizeHost(host)
	if h == "" {
		return nil, gorm.ErrRecordNotFound
	}
	var all []commonModels.Tenant
	if err := config.BaseDB.
		WithContext(config.AllowCrossTenant(ctx)).
		Where("app_url <> ''").Find(&all).Error; err != nil {
		return nil, err
	}
	for i := range all {
		if NormalizeHost(all[i].AppURL) == h {
			return &all[i], nil
		}
	}
	return nil, gorm.ErrRecordNotFound
}

func TenantIDForHost(ctx context.Context, host string) (uint, bool) {
	t, err := FindByAppURL(ctx, host)
	if err != nil || t == nil {
		return 0, false
	}
	return t.ID, true
}
