package controllers

import (
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"math"
	"regexp"
	"strconv"
)

var (
	karatRe    = regexp.MustCompile(`^(\d+)K$`)
	finenessRe = regexp.MustCompile(`^(\d+(?:\.\d+)?)%$`)
)

func ParsePurity(purity string) (karat *int, finenessPercent *float64, err error) {
	if m := karatRe.FindStringSubmatch(purity); m != nil {
		k, convErr := strconv.Atoi(m[1])
		if convErr != nil {
			return nil, nil, common.NewBadRequest("purity must be a karat like \"22K\" (10-24) or a fineness percentage like \"91.6%\" (0-100)")
		}
		if vErr := common.ValidateKarat(k); vErr != nil {
			return nil, nil, common.NewBadRequest("purity must be a karat like \"22K\" (10-24) or a fineness percentage like \"91.6%\" (0-100)")
		}
		return &k, nil, nil
	}
	if m := finenessRe.FindStringSubmatch(purity); m != nil {
		f, convErr := strconv.ParseFloat(m[1], 64)
		if convErr != nil {
			return nil, nil, common.NewBadRequest("purity must be a karat like \"22K\" (10-24) or a fineness percentage like \"91.6%\" (0-100)")
		}
		if vErr := common.ValidateFineness(f); vErr != nil {
			return nil, nil, common.NewBadRequest("purity must be a karat like \"22K\" (10-24) or a fineness percentage like \"91.6%\" (0-100)")
		}
		return nil, &f, nil
	}
	return nil, nil, common.NewBadRequest("purity must be a karat like \"22K\" (10-24) or a fineness percentage like \"91.6%\" (0-100)")
}

func rateForPurity(gr *commonModels.GoldRate, purity string) (float64, error) {
	karat, fineness, err := ParsePurity(purity)
	if err != nil {
		return 0, err
	}
	switch {
	case karat != nil:
		switch *karat {
		case 24:
			return math.Round(gr.K24), nil
		case 22:
			if gr.K22 > 0 {
				return math.Round(gr.K22), nil
			}
			return math.Round(gr.K24 * 22 / 24), nil
		case 18:
			if gr.K18 > 0 {
				return math.Round(gr.K18), nil
			}
			return math.Round(gr.K24 * 18 / 24), nil
		default:
			return math.Round(gr.K24 * float64(*karat) / 24), nil
		}
	case fineness != nil:
		return math.Round(gr.K24 * *fineness / 100), nil
	default:
		return 0, common.NewBadRequest("purity must be a karat like \"22K\" (10-24) or a fineness percentage like \"91.6%\" (0-100)")
	}
}
