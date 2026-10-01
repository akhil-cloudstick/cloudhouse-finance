package workflow

import (
	"context"
	"fmt"
	"log"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
)

var (
	ErrUnknownFlow  = httpx.NewNotFound("Unknown approval flow")
	ErrUnknownStage = httpx.NewBadRequest("Unknown approval stage")
)

// StageView is a catalogue stage plus this tenant's on/off for it.
type StageView struct {
	StageDef
	Enabled bool `json:"enabled"`
}

// FlowView is a catalogue flow with this tenant's stage settings applied —
// the shape GET /approval-workflow returns.
type FlowView struct {
	Key         string      `json:"key"`
	Label       string      `json:"label"`
	FinalAction string      `json:"finalAction"`
	OffBehavior string      `json:"offBehavior"`
	MinEnabled  int         `json:"minEnabled"`
	Stages      []StageView `json:"stages"`
}

// Chain is one flow's stages with this tenant's settings resolved — what
// every approval call site walks instead of a hardcoded stage list.
type Chain struct {
	Flow   FlowDef
	stages []StageView
}

// Stages returns every stage (enabled or not) in canonical order.
func (c *Chain) Stages() []StageView { return c.stages }

// Enabled returns only the enabled stages, in order.
func (c *Chain) Enabled() []StageDef {
	out := make([]StageDef, 0, len(c.stages))
	for _, s := range c.stages {
		if s.Enabled {
			out = append(out, s.StageDef)
		}
	}
	return out
}

// Off reports whether the flow has no enabled stage (no approval needed).
func (c *Chain) Off() bool { return len(c.Enabled()) == 0 }

// First returns the first enabled stage; ok is false when the flow is off.
func (c *Chain) First() (StageDef, bool) {
	for _, s := range c.stages {
		if s.Enabled {
			return s.StageDef, true
		}
	}
	return StageDef{}, false
}

func (c *Chain) index(key string) int {
	for i, s := range c.stages {
		if s.Key == key {
			return i
		}
	}
	return -1
}

// Next returns the next enabled stage after the stage with key current, in
// canonical order — current itself may since have been disabled, which is
// how an item parked on a switched-off stage still moves forward. ok is
// false when current is the last enabled stage (i.e. the final one).
func (c *Chain) Next(current string) (StageDef, bool) {
	i := c.index(current)
	if i < 0 {
		return c.First()
	}
	for _, s := range c.stages[i+1:] {
		if s.Enabled {
			return s.StageDef, true
		}
	}
	return StageDef{}, false
}

// IsFinal reports whether acting at current runs the flow's real action.
func (c *Chain) IsFinal(current string) bool {
	_, more := c.Next(current)
	return !more
}

// ByKey returns the stage with the given client-facing key.
func (c *Chain) ByKey(key string) (StageDef, bool) {
	if i := c.index(key); i >= 0 {
		return c.stages[i].StageDef, true
	}
	return StageDef{}, false
}

// ByPending returns the stage whose stored pending value is pending.
func (c *Chain) ByPending(pending string) (StageDef, bool) {
	for _, s := range c.stages {
		if s.Pending == pending {
			return s.StageDef, true
		}
	}
	return StageDef{}, false
}

// NewChain builds a Chain from a flow and an explicit enabled map (stage key
// → enabled; missing keys use the stage default). Exported for tests and for
// callers that already hold the settings.
func NewChain(f FlowDef, enabled map[string]bool) *Chain {
	c := &Chain{Flow: f, stages: make([]StageView, 0, len(f.Stages))}
	for _, s := range f.Stages {
		on, ok := enabled[s.Key]
		if !ok {
			on = s.DefaultEnabled
		}
		c.stages = append(c.stages, StageView{StageDef: s, Enabled: on})
	}
	return c
}

func (c *Chain) view() FlowView {
	return FlowView{
		Key: c.Flow.Key, Label: c.Flow.Label, FinalAction: c.Flow.FinalAction,
		OffBehavior: c.Flow.OffBehavior, MinEnabled: c.Flow.MinEnabled, Stages: c.stages,
	}
}

// Service resolves and updates the per-tenant approval configuration.
type Service struct {
	repo        *Repository
	permChecker platform.PermissionChecker
}

func NewService(repo *Repository, permChecker platform.PermissionChecker) *Service {
	return &Service{repo: repo, permChecker: permChecker}
}

// Chain loads one flow's configuration for the tenant in ctx.
func (s *Service) Chain(ctx context.Context, flow string) (*Chain, error) {
	f, ok := FindFlow(flow)
	if !ok {
		return nil, ErrUnknownFlow
	}
	if s == nil || s.repo == nil {
		return NewChain(f, nil), nil
	}
	rows, err := s.repo.FindByFlow(ctx, flow)
	if err != nil {
		return nil, err
	}
	enabled := make(map[string]bool, len(rows))
	for _, r := range rows {
		enabled[r.Stage] = r.Enabled
	}
	return NewChain(f, enabled), nil
}

// Config returns every flow with the tenant's settings applied.
func (s *Service) Config(ctx context.Context) ([]FlowView, error) {
	rows, err := s.repo.FindAll(ctx)
	if err != nil {
		return nil, err
	}
	byFlow := map[string]map[string]bool{}
	for _, r := range rows {
		if byFlow[r.Flow] == nil {
			byFlow[r.Flow] = map[string]bool{}
		}
		byFlow[r.Flow][r.Stage] = r.Enabled
	}
	out := make([]FlowView, 0, len(Catalogue))
	for _, f := range Catalogue {
		out = append(out, NewChain(f, byFlow[f.Key]).view())
	}
	return out, nil
}

// Update stores the on/off of the given stages of one flow. Stages left out
// of the map keep their current setting.
func (s *Service) Update(ctx context.Context, flow string, stages map[string]bool) (*FlowView, error) {
	current, err := s.Chain(ctx, flow)
	if err != nil {
		return nil, err
	}
	merged := map[string]bool{}
	for _, st := range current.Stages() {
		merged[st.Key] = st.Enabled
	}
	for k, v := range stages {
		if _, ok := current.ByKey(k); !ok {
			return nil, ErrUnknownStage
		}
		merged[k] = v
	}
	next := NewChain(current.Flow, merged)
	if n := len(next.Enabled()); n < current.Flow.MinEnabled {
		return nil, httpx.NewBadRequest(fmt.Sprintf("%s needs at least %d approval stage switched on", current.Flow.Label, current.Flow.MinEnabled))
	}
	for k, v := range merged {
		if err := s.repo.Upsert(ctx, flow, k, v); err != nil {
			return nil, err
		}
	}
	v := next.view()
	return &v, nil
}

// CanAct reports whether roleID holds the permission of stage in flow. It
// fails closed: an unknown flow/stage or a lookup error denies.
func (s *Service) CanAct(ctx context.Context, roleID uint, flow, stageKey string) bool {
	f, ok := FindFlow(flow)
	if !ok || s == nil || s.permChecker == nil {
		return false
	}
	for _, st := range f.Stages {
		if st.Key != stageKey {
			continue
		}
		allowed, err := s.permChecker.IsAllowed(ctx, roleID, st.Permission)
		if err != nil {
			return false
		}
		return allowed
	}
	return false
}

// RecordAction writes one audit row. Best-effort: a failure is logged, not
// returned, since the decision it describes has already been applied.
func (s *Service) RecordAction(ctx context.Context, a *ApprovalAction) {
	if s == nil || s.repo == nil {
		return
	}
	if err := s.repo.CreateAction(ctx, a); err != nil {
		log.Printf("approval action audit (%s #%d) failed: %v", a.Flow, a.EntityID, err)
	}
}

// ListActions returns one item's audit trail.
func (s *Service) ListActions(ctx context.Context, flow string, entityID uint) ([]ApprovalAction, error) {
	if s == nil || s.repo == nil {
		return []ApprovalAction{}, nil
	}
	return s.repo.ListActions(ctx, flow, entityID)
}
