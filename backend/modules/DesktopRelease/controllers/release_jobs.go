package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/DesktopRelease/models"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

var supportedTargets = []string{"win", "mac", "linux"}

// fileExtFor mirrors scripts/package-win.cjs/package-mac.cjs/package-linux.cjs's own naming:
// Windows builds end in .exe; Mac/Linux binaries have no extension.
func fileExtFor(osTarget string) string {
	if osTarget == "win" {
		return ".exe"
	}
	return ""
}

type triggerRequest struct {
	TenantCode string   `json:"tenant_code"` // "" or "all" = every tenant (ignored for build_type=content)
	Version    string   `json:"version"`
	BuildType  string   `json:"build_type"` // "full" (default) or "content"
	Targets    []string `json:"targets"`    // e.g. ["win"]; defaults to supportedTargets
	Reason     string   `json:"reason"`
}

func currentAdminID(c echo.Context) *uint {
	v, _ := common.Get(c, "superAdminUserId")
	if id, ok := v.(uint); ok && id != 0 {
		return &id
	}
	return nil
}

func parseIDs(raw string) ([]uint, error) {
	var ids []uint
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		n, err := strconv.ParseUint(part, 10, 64)
		if err != nil {
			return nil, err
		}
		ids = append(ids, uint(n))
	}
	return ids, nil
}

func validTarget(os string) bool {
	for _, t := range supportedTargets {
		if t == os {
			return true
		}
	}
	return false
}

// TriggerRelease is the superadmin "Rebuild" endpoint (single tenant or "all").
func TriggerRelease(c echo.Context) error {
	var req triggerRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid input"})
	}
	req.Version = strings.TrimSpace(req.Version)
	if req.Version == "" {
		return common.FailErr(c, common.NewBadRequest("version is required"))
	}
	if req.BuildType == "" {
		req.BuildType = models.BuildTypeFull
	}
	if req.BuildType != models.BuildTypeFull && req.BuildType != models.BuildTypeContent {
		return common.FailErr(c, common.NewBadRequest("build_type must be \"full\" or \"content\""))
	}
	targets := req.Targets
	if len(targets) == 0 {
		targets = supportedTargets
	}
	for _, t := range targets {
		if !validTarget(t) {
			return common.FailErr(c, common.NewBadRequest(fmt.Sprintf("unsupported build target %q", t)))
		}
	}

	ctx := auth.RequestContext(c)
	gh, err := newGitHubClient()
	if err != nil {
		return common.FailErr(c, common.NewBadRequest(err.Error()))
	}

	var tenantCodes []string
	if req.BuildType == models.BuildTypeContent {
		tenantCodes = []string{"common"}
	} else if req.TenantCode == "" || strings.EqualFold(req.TenantCode, "all") {
		tenants, err := common.FindTenants(ctx)
		if err != nil {
			return common.FailErr(c, err)
		}
		for _, t := range tenants {
			tenantCodes = append(tenantCodes, t.Code)
		}
	} else {
		tenantCodes = []string{req.TenantCode}
	}

	// Rejects an equal-or-lower version before wasting a build, per tenant touched.
	for _, code := range tenantCodes {
		current, err := currentLiveVersion(code, req.BuildType)
		if err != nil {
			continue // no feed yet (first release for this tenant) isn't a block
		}
		if current != "" && !semverGreater(req.Version, current) {
			return common.FailErr(c, common.NewBadRequest(
				fmt.Sprintf("version %s is not higher than %s's current version %s", req.Version, code, current)))
		}
	}

	adminID := currentAdminID(c)
	var created []models.ReleaseJob
	for _, code := range tenantCodes {
		for _, osTarget := range targets {
			job := models.ReleaseJob{
				TenantCode:       code,
				OS:               osTarget,
				Version:          req.Version,
				BuildType:        req.BuildType,
				Status:           models.StatusQueued,
				CreatedByAdminID: adminID,
			}
			if err := config.BaseDB.WithContext(ctx).Create(&job).Error; err != nil {
				return common.FailErr(c, err)
			}
			created = append(created, job)

			dispatchTenant := code
			if req.BuildType == models.BuildTypeContent {
				dispatchTenant = ""
			}
			if err := gh.Dispatch(ctx, releaseRef(), dispatchTenant, req.Version, req.BuildType, osTarget); err != nil {
				job.Status = models.StatusFailed
			} else {
				job.Status = models.StatusPreparing
			}
			config.BaseDB.WithContext(ctx).Save(&job)
		}
	}

	return common.Success(c, http.StatusOK, echo.Map{"jobs": created})
}

func releaseRef() string {
	if v := strings.TrimSpace(os.Getenv("GITHUB_RELEASE_REF")); v != "" {
		return v
	}
	return "Develop_v2"
}

// ListReleaseJobs refreshes each non-terminal job (by id, from the ids this
// release's trigger response returned) from GitHub before returning.
func ListReleaseJobs(c echo.Context) error {
	ids, err := parseIDs(c.QueryParam("ids"))
	if err != nil || len(ids) == 0 {
		return common.FailErr(c, common.NewBadRequest("ids is required, as a comma-separated list"))
	}
	ctx := auth.RequestContext(c)

	var jobs []models.ReleaseJob
	if err := config.BaseDB.WithContext(ctx).Where("id IN ?", ids).Order("id").Find(&jobs).Error; err != nil {
		return common.FailErr(c, err)
	}

	gh, ghErr := newGitHubClient()
	for i := range jobs {
		refreshJob(ctx, gh, ghErr, &jobs[i])
	}
	return common.Success(c, http.StatusOK, jobs)
}

func refreshJob(ctx context.Context, gh *githubClient, ghErr error, job *models.ReleaseJob) {
	if job.Status == models.StatusDone || job.Status == models.StatusFailed || job.Status == models.StatusCancelled {
		return
	}
	if ghErr != nil || gh == nil {
		return
	}
	if job.GitHubRunID == nil {
		run, err := gh.FindRecentRun(ctx, job.CreatedAt.Add(-30*time.Second))
		if err != nil || run == nil {
			return
		}
		id := run.ID
		job.GitHubRunID = &id
		config.BaseDB.WithContext(ctx).Save(job)
	}

	status, err := gh.CurrentStatus(ctx, *job.GitHubRunID)
	if err != nil {
		return
	}
	wasDone := job.Status == models.StatusDone
	job.Status = status
	config.BaseDB.WithContext(ctx).Save(job)
	if job.Status == models.StatusDone && !wasDone && job.BuildType == models.BuildTypeFull {
		pruneHistory(ctx, job.TenantCode, job.OS)
	}
}

// keepHistory mirrors scripts/prune.js's KEEP constant, so B2 and this table agree.
const keepHistory = 5

func pruneHistory(ctx context.Context, tenantCode, osTarget string) {
	var done []models.ReleaseJob
	if err := config.BaseDB.WithContext(ctx).
		Where("tenant_code = ? AND os = ? AND build_type = ? AND status = ?", tenantCode, osTarget, models.BuildTypeFull, models.StatusDone).
		Find(&done).Error; err != nil {
		return
	}
	if len(done) <= keepHistory {
		return
	}
	sort.Slice(done, func(i, j int) bool { return semverGreater(done[i].Version, done[j].Version) })
	for _, old := range done[keepHistory:] {
		config.BaseDB.WithContext(ctx).Delete(&old)
	}
}

type historyEntry struct {
	TenantCode  string `json:"tenant_code"`
	OS          string `json:"os"`
	Version     string `json:"version"`
	DownloadURL string `json:"download_url"`
}

// ListReleaseHistory is the plain "versions currently kept in the drive" list.
func ListReleaseHistory(c echo.Context) error {
	tenantCode := strings.TrimSpace(c.QueryParam("tenant_code"))
	if tenantCode == "" {
		return common.FailErr(c, common.NewBadRequest("tenant_code is required"))
	}
	ctx := auth.RequestContext(c)

	var done []models.ReleaseJob
	if err := config.BaseDB.WithContext(ctx).
		Where("tenant_code = ? AND build_type = ? AND status = ?", tenantCode, models.BuildTypeFull, models.StatusDone).
		Find(&done).Error; err != nil {
		return common.FailErr(c, err)
	}
	sort.Slice(done, func(i, j int) bool { return semverGreater(done[i].Version, done[j].Version) })

	base := bucketPublicBase()
	out := make([]historyEntry, 0, len(done))
	for _, job := range done {
		file := fmt.Sprintf("%s-finance-%s-%s%s", job.TenantCode, job.Version, job.OS, fileExtFor(job.OS))
		url := ""
		if base != "" {
			url = strings.Join(filterNonEmpty([]string{base, job.TenantCode, file}), "/")
		}
		out = append(out, historyEntry{TenantCode: job.TenantCode, OS: job.OS, Version: job.Version, DownloadURL: url})
	}
	return common.Success(c, http.StatusOK, out)
}

// CurrentVersion is what the superadmin "New version" field checks itself
// against — so a lower-or-equal entry can't even be submitted, not just
// rejected server-side after a wasted trip.
func CurrentVersion(c echo.Context) error {
	tenantCode := strings.TrimSpace(c.QueryParam("tenant_code"))
	if tenantCode == "" {
		return common.FailErr(c, common.NewBadRequest("tenant_code is required"))
	}
	buildType := c.QueryParam("build_type")
	if buildType == "" {
		buildType = models.BuildTypeFull
	}
	version, _ := currentLiveVersion(tenantCode, buildType)
	return common.Success(c, http.StatusOK, echo.Map{"version": version})
}

func bucketPublicBase() string {
	endpoint := strings.TrimRight(strings.TrimSpace(os.Getenv("S3_ENDPOINT")), "/")
	bucket := strings.TrimSpace(os.Getenv("S3_BUCKET"))
	folder := strings.Trim(strings.TrimSpace(os.Getenv("S3_FOLDER")), "/")
	if endpoint == "" || bucket == "" {
		return ""
	}
	return strings.Join(filterNonEmpty([]string{endpoint, bucket, folder}), "/")
}

// CancelReleaseJob cancels one row only; other rows in the same batch are untouched.
func CancelReleaseJob(c echo.Context) error {
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	ctx := auth.RequestContext(c)

	var job models.ReleaseJob
	if err := config.BaseDB.WithContext(ctx).First(&job, id).Error; err != nil {
		return common.FailErr(c, common.NewNotFound("release job not found"))
	}
	if job.Status == models.StatusDone || job.Status == models.StatusFailed || job.Status == models.StatusCancelled {
		return common.Success(c, http.StatusOK, job)
	}
	if job.GitHubRunID != nil {
		if gh, err := newGitHubClient(); err == nil {
			_ = gh.Cancel(ctx, *job.GitHubRunID)
		}
	}
	job.Status = models.StatusCancelled
	if err := config.BaseDB.WithContext(ctx).Save(&job).Error; err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, job)
}

// currentLiveVersion reads the public manifest straight from the bucket, no credentials needed.
func currentLiveVersion(tenantCode, buildType string) (string, error) {
	endpoint := strings.TrimRight(strings.TrimSpace(os.Getenv("S3_ENDPOINT")), "/")
	bucket := strings.TrimSpace(os.Getenv("S3_BUCKET"))
	folder := strings.Trim(strings.TrimSpace(os.Getenv("S3_FOLDER")), "/")
	if endpoint == "" || bucket == "" {
		return "", fmt.Errorf("S3_ENDPOINT/S3_BUCKET not set")
	}
	feedName := "latest.json"
	if buildType == "content" {
		feedName = "latest-content.json"
		tenantCode = "common"
	}
	parts := []string{endpoint, bucket, folder, tenantCode, feedName}
	url := strings.Join(filterNonEmpty(parts), "/")

	res, err := http.Get(url)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("feed returned %d", res.StatusCode)
	}
	var manifest struct {
		Version string `json:"version"`
	}
	if err := json.NewDecoder(res.Body).Decode(&manifest); err != nil {
		return "", err
	}
	return manifest.Version, nil
}

func filterNonEmpty(parts []string) []string {
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// semverGreater mirrors frontend/desktop/update/update.go's SemverGreater (separate Go modules).
func semverGreater(a, b string) bool {
	ac, ap := splitSemver(a)
	bc, bp := splitSemver(b)
	for i := 0; i < 3; i++ {
		if ac[i] != bc[i] {
			return ac[i] > bc[i]
		}
	}
	switch {
	case ap == bp:
		return false
	case ap == "":
		return true
	case bp == "":
		return false
	}
	return ap > bp
}

func splitSemver(v string) ([3]int, string) {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	pre := ""
	if i := strings.IndexByte(v, '-'); i >= 0 {
		v, pre = v[:i], v[i+1:]
	}
	var core [3]int
	for i, part := range strings.SplitN(v, ".", 3) {
		if i >= 3 {
			break
		}
		core[i], _ = strconv.Atoi(part)
	}
	return core, pre
}
