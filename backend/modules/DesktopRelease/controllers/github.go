package controllers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// githubClient starts and watches .github/workflows/release.yml on demand.
type githubClient struct {
	owner, repo, workflowFile, token string
}

func newGitHubClient() (*githubClient, error) {
	owner := strings.TrimSpace(os.Getenv("GITHUB_REPO_OWNER"))
	repo := strings.TrimSpace(os.Getenv("GITHUB_REPO_NAME"))
	token := strings.TrimSpace(os.Getenv("GITHUB_RELEASE_TOKEN"))
	workflow := strings.TrimSpace(os.Getenv("GITHUB_RELEASE_WORKFLOW_FILE"))
	if workflow == "" {
		workflow = "release.yml"
	}
	if owner == "" || repo == "" || token == "" {
		return nil, fmt.Errorf("GITHUB_REPO_OWNER, GITHUB_REPO_NAME and GITHUB_RELEASE_TOKEN must be set to trigger a desktop release")
	}
	return &githubClient{owner: owner, repo: repo, workflowFile: workflow, token: token}, nil
}

func (g *githubClient) do(ctx context.Context, method, url string, body any) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Authorization", "Bearer "+g.token)
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	client := &http.Client{Timeout: 20 * time.Second}
	return client.Do(req)
}

// Dispatch starts release.yml; GitHub returns no run ID, so correlate via FindRecentRun after.
func (g *githubClient) Dispatch(ctx context.Context, ref, tenant, version, buildType string) error {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/actions/workflows/%s/dispatches", g.owner, g.repo, g.workflowFile)
	body := map[string]any{
		"ref": ref,
		"inputs": map[string]string{
			"tenant":     tenant,
			"version":    version,
			"build_type": buildType,
		},
	}
	res, err := g.do(ctx, http.MethodPost, url, body)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		b, _ := io.ReadAll(res.Body)
		return fmt.Errorf("github dispatch failed: %s: %s", res.Status, string(b))
	}
	return nil
}

type workflowRun struct {
	ID         int64     `json:"id"`
	Status     string    `json:"status"` // queued | in_progress | completed
	Conclusion string    `json:"conclusion"`
	CreatedAt  time.Time `json:"created_at"`
	Event      string    `json:"event"`
}

type workflowRunsResponse struct {
	WorkflowRuns []workflowRun `json:"workflow_runs"`
}

// FindRecentRun finds the workflow_dispatch run that started after `since`.
func (g *githubClient) FindRecentRun(ctx context.Context, since time.Time) (*workflowRun, error) {
	url := fmt.Sprintf(
		"https://api.github.com/repos/%s/%s/actions/workflows/%s/runs?event=workflow_dispatch&per_page=5",
		g.owner, g.repo, g.workflowFile,
	)
	res, err := g.do(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(res.Body)
		return nil, fmt.Errorf("github list runs failed: %s: %s", res.Status, string(b))
	}
	var parsed workflowRunsResponse
	if err := json.NewDecoder(res.Body).Decode(&parsed); err != nil {
		return nil, err
	}
	for _, run := range parsed.WorkflowRuns {
		if !run.CreatedAt.Before(since) {
			return &run, nil
		}
	}
	return nil, nil
}

type runJobStep struct {
	Name       string `json:"name"`
	Status     string `json:"status"`
	Conclusion string `json:"conclusion"`
	Number     int    `json:"number"`
}

type runJob struct {
	Steps []runJobStep `json:"steps"`
}

type runJobsResponse struct {
	Jobs []runJob `json:"jobs"`
}

// stageFor collapses release.yml's real step list into the four plain UI stages.
func stageFor(stepName string) string {
	switch {
	case strings.Contains(stepName, "checkout") || strings.Contains(stepName, "setup"):
		return "preparing"
	case strings.Contains(stepName, "npm ci"):
		return "preparing"
	case strings.Contains(stepName, "dist"):
		return "building"
	case strings.Contains(stepName, "upload"):
		return "uploading"
	case strings.Contains(stepName, "download"):
		return "verifying"
	default:
		return "preparing"
	}
}

// CurrentStatus returns the run's single collapsed status (preparing/building/uploading/verifying/done/failed).
func (g *githubClient) CurrentStatus(ctx context.Context, runID int64) (string, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/actions/runs/%d/jobs", g.owner, g.repo, runID)
	res, err := g.do(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(res.Body)
		return "", fmt.Errorf("github list jobs failed: %s: %s", res.Status, string(b))
	}
	var parsed runJobsResponse
	if err := json.NewDecoder(res.Body).Decode(&parsed); err != nil {
		return "", err
	}
	if len(parsed.Jobs) == 0 {
		return "preparing", nil
	}
	job := parsed.Jobs[0]
	last := "preparing"
	for _, step := range job.Steps {
		last = stageFor(strings.ToLower(step.Name))
		if step.Conclusion == "failure" {
			return "failed", nil
		}
		if step.Status != "completed" {
			return last, nil
		}
	}
	return "done", nil
}

func (g *githubClient) Cancel(ctx context.Context, runID int64) error {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/actions/runs/%d/cancel", g.owner, g.repo, runID)
	res, err := g.do(ctx, http.MethodPost, url, nil)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusAccepted {
		b, _ := io.ReadAll(res.Body)
		return fmt.Errorf("github cancel run failed: %s: %s", res.Status, string(b))
	}
	return nil
}
