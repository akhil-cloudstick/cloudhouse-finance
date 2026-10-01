package workflow

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"

	"cloudhouse/backend/internal/platform/httpx"
)

var (
	ErrUnknownFlow     = httpx.NewNotFound("Unknown approval flow")
	ErrUnknownCategory = httpx.NewNotFound("Unknown approval category")
)

// StageView is one stage of a resolved chain. Enabled is always true for a
// role-chain stage; it is kept so clients written against the on/off
// stages keep reading the same shape.
type StageView struct {
	StageDef
	Enabled bool `json:"enabled"`
}

// FlowView is one flow with this tenant's chain resolved — the shape
// GET /approval-workflow returns, read by every tracker and approve button.
type FlowView struct {
	Key         string      `json:"key"`
	Label       string      `json:"label"`
	ActionLabel string      `json:"actionLabel"`
	Category    string      `json:"category"`
	FinalAction string      `json:"finalAction"`
	OffBehavior string      `json:"offBehavior"`
	MinEnabled  int         `json:"minEnabled"`
	MaxSteps    int         `json:"maxSteps"`
	Stages      []StageView `json:"stages"`
}

// StageKey is the Key (and Pending) value of the role-chain stage of roleID.
func StageKey(roleID uint) string { return "R" + strconv.FormatUint(uint64(roleID), 10) }

// StageRoleID parses a StageKey back to its role ID.
func StageRoleID(key string) (uint, bool) {
	if !strings.HasPrefix(key, "R") {
		return 0, false
	}
	n, err := strconv.ParseUint(key[1:], 10, 64)
	if err != nil || n == 0 {
		return 0, false
	}
	return uint(n), true
}

// Chain is one flow's approver roles in order — what every approval call
// site walks instead of a hardcoded stage list.
type Chain struct {
	Flow   FlowDef
	stages []StageView
}

// NewChain builds a Chain from a flow and its approver roles in order.
// Inactive roles are skipped. Exported for tests.
func NewChain(f FlowDef, roles []roleRow) *Chain {
	c := &Chain{Flow: f, stages: make([]StageView, 0, len(roles))}
	for _, r := range roles {
		if !r.IsActive {
			continue
		}
		key := StageKey(r.ID)
		c.stages = append(c.stages, StageView{StageDef: StageDef{
			Key: key, Pending: key, Label: r.Name, Role: r.Name, Module: f.Label, DefaultEnabled: true, RoleID: r.ID,
		}, Enabled: true})
	}
	return c
}

// Stages returns every stage in approval order.
func (c *Chain) Stages() []StageView { return c.stages }

// Enabled returns the stages in approval order.
func (c *Chain) Enabled() []StageDef {
	out := make([]StageDef, 0, len(c.stages))
	for _, s := range c.stages {
		out = append(out, s.StageDef)
	}
	return out
}

// Off reports whether the chain is empty (no approval needed).
func (c *Chain) Off() bool { return len(c.stages) == 0 }

// First returns the first stage; ok is false when the chain is empty.
func (c *Chain) First() (StageDef, bool) {
	if len(c.stages) == 0 {
		return StageDef{}, false
	}
	return c.stages[0].StageDef, true
}

func (c *Chain) indexBy(match func(StageDef) bool) int {
	for i, s := range c.stages {
		if match(s.StageDef) {
			return i
		}
	}
	return -1
}

// resolve finds the stage an item stored with value v is waiting at. v is
// normally a role-chain key; anything else is matched as follows:
//   - a legacy catalogue value (e.g. "PendingBranchManager"): its flow's first
//     legacy stage maps to First; any other maps to the stage of the same
//     role, or First when that role is no longer in the chain;
//   - a role that has since left the chain: First — where in the chain it
//     sat can no longer be known, so it waits at the start.
//
// ok is false when the chain is empty or v is a decided value ("Approved",
// "Rejected").
func (c *Chain) resolve(v string, field func(StageDef) string) (int, bool) {
	if i := c.indexBy(func(s StageDef) bool { return field(s) == v }); i >= 0 {
		return i, true
	}
	if len(c.stages) == 0 {
		return -1, false
	}
	legacy := false
	for li, ls := range c.Flow.Stages {
		if field(ls) != v {
			continue
		}
		legacy = true
		if li == 0 {
			break
		}
		if i := c.indexBy(func(s StageDef) bool { return s.Role == ls.Role }); i >= 0 {
			return i, true
		}
		break
	}
	// Only an unset value (a row from before chains), a legacy value, or a
	// role key whose role has left the chain waits at the first step; a
	// decided value ("Approved", "Rejected") is not waiting anywhere.
	if _, roleKey := StageRoleID(v); v == "" || legacy || roleKey {
		return 0, true
	}
	return -1, false
}

// ByKey returns the stage an item with stored stage key key is waiting at
// (see resolve).
func (c *Chain) ByKey(key string) (StageDef, bool) {
	i, ok := c.resolve(key, func(s StageDef) string { return s.Key })
	if !ok {
		return StageDef{}, false
	}
	return c.stages[i].StageDef, true
}

// ByPending returns the stage an item with stored pending value pending is
// waiting at (see resolve).
func (c *Chain) ByPending(pending string) (StageDef, bool) {
	i, ok := c.resolve(pending, func(s StageDef) string { return s.Pending })
	if !ok {
		return StageDef{}, false
	}
	return c.stages[i].StageDef, true
}

// Exact returns the stage whose key is exactly key — no legacy fallback.
// Authorization uses this so a stale key can never pick a different stage.
func (c *Chain) Exact(key string) (StageDef, bool) {
	if i := c.indexBy(func(s StageDef) bool { return s.Key == key }); i >= 0 {
		return c.stages[i].StageDef, true
	}
	return StageDef{}, false
}

// Next returns the stage after the one current resolves to (see ByKey). ok
// is false when that is the last stage (i.e. the final one).
func (c *Chain) Next(current string) (StageDef, bool) {
	i, ok := c.resolve(current, func(s StageDef) string { return s.Key })
	if !ok || i+1 >= len(c.stages) {
		return StageDef{}, false
	}
	return c.stages[i+1].StageDef, true
}

// IsFinal reports whether acting at current runs the flow's real action.
func (c *Chain) IsFinal(current string) bool {
	_, more := c.Next(current)
	return !more
}

func (c *Chain) view() FlowView {
	return FlowView{
		Key: c.Flow.Key, Label: c.Flow.Label, ActionLabel: c.Flow.ActionLabel, Category: c.Flow.Category,
		FinalAction: c.Flow.FinalAction, OffBehavior: c.Flow.OffBehavior,
		MinEnabled: c.Flow.MinEnabled, MaxSteps: c.Flow.MaxSteps, Stages: c.stages,
	}
}

// Service resolves and updates the per-tenant approval configuration.
type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// snapshot is everything chain resolution reads, loaded once per call.
type snapshot struct {
	shared   map[string]bool
	chains   map[string]string
	legacy   map[string]map[string]bool
	byID     map[uint]roleRow
	byName   map[string]roleRow
	hasChain map[string]bool
}

func (s *Service) load(ctx context.Context) (*snapshot, error) {
	modes, err := s.repo.FindAllModes(ctx)
	if err != nil {
		return nil, err
	}
	chains, err := s.repo.FindAllChains(ctx)
	if err != nil {
		return nil, err
	}
	settings, err := s.repo.FindAll(ctx)
	if err != nil {
		return nil, err
	}
	roles, err := s.repo.ListRoles(ctx)
	if err != nil {
		return nil, err
	}
	snap := &snapshot{
		shared: map[string]bool{}, chains: map[string]string{}, legacy: map[string]map[string]bool{},
		byID: map[uint]roleRow{}, byName: map[string]roleRow{}, hasChain: map[string]bool{},
	}
	for _, m := range modes {
		snap.shared[m.Category] = m.Shared
	}
	for _, c := range chains {
		snap.chains[c.Scope] = c.RoleIDs
		snap.hasChain[c.Scope] = true
	}
	for _, st := range settings {
		if snap.legacy[st.Flow] == nil {
			snap.legacy[st.Flow] = map[string]bool{}
		}
		snap.legacy[st.Flow][st.Stage] = st.Enabled
	}
	for _, r := range roles {
		snap.byID[r.ID] = r
		snap.byName[r.Name] = r
	}
	return snap, nil
}

// legacyIDs is a flow's chain before any was saved: its catalogue stages
// switched on (by the old per-stage setting, else the default), each mapped
// to the tenant role of that name.
func (snap *snapshot) legacyIDs(f FlowDef) []uint {
	var ids []uint
	seen := map[uint]bool{}
	for _, st := range f.Stages {
		on, ok := snap.legacy[f.Key][st.Key]
		if !ok {
			on = st.DefaultEnabled
		}
		r, found := snap.byName[st.Role]
		if !on || !found || seen[r.ID] {
			continue
		}
		seen[r.ID] = true
		ids = append(ids, r.ID)
	}
	return ids
}

// flowIDs is a flow's own (per-action) chain.
func (snap *snapshot) flowIDs(f FlowDef) []uint {
	if snap.hasChain[f.Key] {
		return parseIDs(snap.chains[f.Key])
	}
	return snap.legacyIDs(f)
}

// sharedIDs is a category's shared chain; before one is saved it starts
// from the category's first flow, so switching to shared begins pre-filled.
func (snap *snapshot) sharedIDs(category string) []uint {
	if scope := sharedScope(category); snap.hasChain[scope] {
		return parseIDs(snap.chains[scope])
	}
	if flows := FlowsOf(category); len(flows) > 0 {
		return snap.flowIDs(flows[0])
	}
	return nil
}

// effectiveIDs is the chain a flow actually runs.
func (snap *snapshot) effectiveIDs(f FlowDef) []uint {
	if snap.shared[f.Category] && len(FlowsOf(f.Category)) > 1 {
		return snap.sharedIDs(f.Category)
	}
	return snap.flowIDs(f)
}

func (snap *snapshot) rolesOf(ids []uint) []roleRow {
	out := make([]roleRow, 0, len(ids))
	for _, id := range ids {
		if r, ok := snap.byID[id]; ok {
			out = append(out, r)
		}
	}
	return out
}

func (snap *snapshot) chain(f FlowDef) *Chain {
	return NewChain(f, snap.rolesOf(snap.effectiveIDs(f)))
}

func parseIDs(s string) []uint {
	var out []uint
	for _, part := range strings.Split(s, ",") {
		n, err := strconv.ParseUint(strings.TrimSpace(part), 10, 64)
		if err == nil && n > 0 {
			out = append(out, uint(n))
		}
	}
	return out
}

func joinIDs(ids []uint) string {
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = strconv.FormatUint(uint64(id), 10)
	}
	return strings.Join(parts, ",")
}

// Chain loads one flow's chain for the tenant in ctx. Without a repository
// (tests) it resolves to an empty chain.
func (s *Service) Chain(ctx context.Context, flow string) (*Chain, error) {
	f, ok := FindFlow(flow)
	if !ok {
		return nil, ErrUnknownFlow
	}
	if s == nil || s.repo == nil {
		return NewChain(f, nil), nil
	}
	snap, err := s.load(ctx)
	if err != nil {
		return nil, err
	}
	return snap.chain(f), nil
}

// Config returns every flow with the tenant's chain resolved.
func (s *Service) Config(ctx context.Context) ([]FlowView, error) {
	snap, err := s.load(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]FlowView, 0, len(Catalogue))
	for _, f := range Catalogue {
		out = append(out, snap.chain(f).view())
	}
	return out, nil
}

// ChainRole is one approver step as the admin screen edits it. Active is
// false for a role deactivated since it was put in the chain — it is
// skipped when the chain runs.
type ChainRole struct {
	RoleID uint   `json:"roleId"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
}

// CategoryFlowView is one flow's per-action chain on the admin screen.
type CategoryFlowView struct {
	Key         string      `json:"key"`
	Label       string      `json:"label"`
	ActionLabel string      `json:"actionLabel"`
	FinalAction string      `json:"finalAction"`
	OffBehavior string      `json:"offBehavior"`
	MinEnabled  int         `json:"minEnabled"`
	MaxSteps    int         `json:"maxSteps"`
	Steps       []ChainRole `json:"steps"`
}

// CategoryView is one category on the admin screen —
// GET /approval-workflow/categories. MinEnabled/MaxSteps are the strictest
// of its flows', which is what a shared chain must satisfy.
type CategoryView struct {
	CategoryDef
	Shared      bool               `json:"shared"`
	SharedSteps []ChainRole        `json:"sharedSteps"`
	MinEnabled  int                `json:"minEnabled"`
	MaxSteps    int                `json:"maxSteps"`
	Flows       []CategoryFlowView `json:"flows"`
}

func (snap *snapshot) steps(ids []uint) []ChainRole {
	out := make([]ChainRole, 0, len(ids))
	for _, r := range snap.rolesOf(ids) {
		out = append(out, ChainRole{RoleID: r.ID, Name: r.Name, Active: r.IsActive})
	}
	return out
}

// limits returns the strictest MinEnabled and MaxSteps across flows.
func limits(flows []FlowDef) (minSteps, maxSteps int) {
	for _, f := range flows {
		if f.MinEnabled > minSteps {
			minSteps = f.MinEnabled
		}
		if f.MaxSteps > 0 && (maxSteps == 0 || f.MaxSteps < maxSteps) {
			maxSteps = f.MaxSteps
		}
	}
	return minSteps, maxSteps
}

func (snap *snapshot) category(c CategoryDef) CategoryView {
	flows := FlowsOf(c.Key)
	minSteps, maxSteps := limits(flows)
	v := CategoryView{
		CategoryDef: c, Shared: snap.shared[c.Key] && len(flows) > 1,
		SharedSteps: snap.steps(snap.sharedIDs(c.Key)),
		MinEnabled:  minSteps, MaxSteps: maxSteps,
		Flows: make([]CategoryFlowView, 0, len(flows)),
	}
	for _, f := range flows {
		v.Flows = append(v.Flows, CategoryFlowView{
			Key: f.Key, Label: f.Label, ActionLabel: f.ActionLabel, FinalAction: f.FinalAction,
			OffBehavior: f.OffBehavior, MinEnabled: f.MinEnabled, MaxSteps: f.MaxSteps,
			Steps: snap.steps(snap.flowIDs(f)),
		})
	}
	return v
}

// Categories returns every category with its chains, for the admin screen.
func (s *Service) Categories(ctx context.Context) ([]CategoryView, error) {
	snap, err := s.load(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]CategoryView, 0, len(Categories))
	for _, c := range Categories {
		out = append(out, snap.category(c))
	}
	return out, nil
}

// UpdateCategoryInput is the body of PUT /approval-workflow/categories/:category.
// Steps is the shared chain (used when Shared); Flows holds per-action
// chains by flow key (used when not Shared). Each list is role IDs in
// approval order. Chains left out are kept as they are.
type UpdateCategoryInput struct {
	Shared bool              `json:"shared"`
	Steps  []uint            `json:"steps"`
	Flows  map[string][]uint `json:"flows"`
}

func (snap *snapshot) validate(label string, ids []uint, minSteps, maxSteps int) error {
	seen := map[uint]bool{}
	for _, id := range ids {
		r, ok := snap.byID[id]
		if !ok {
			return httpx.NewBadRequest(fmt.Sprintf("%s: one of the selected roles no longer exists", label))
		}
		if !r.IsActive {
			return httpx.NewBadRequest(fmt.Sprintf("%s: role %q is inactive — remove it or reactivate it first", label, r.Name))
		}
		if seen[id] {
			return httpx.NewBadRequest(fmt.Sprintf("%s: role %q is in the chain twice", label, r.Name))
		}
		seen[id] = true
	}
	if len(ids) < minSteps {
		return httpx.NewBadRequest(fmt.Sprintf("%s needs at least %d approver", label, minSteps))
	}
	if maxSteps > 0 && len(ids) > maxSteps {
		return httpx.NewBadRequest(fmt.Sprintf("%s allows at most %d approver", label, maxSteps))
	}
	return nil
}

// UpdateCategory stores one category's mode and chains.
func (s *Service) UpdateCategory(ctx context.Context, category string, in UpdateCategoryInput) (*CategoryView, error) {
	c, ok := FindCategory(category)
	if !ok {
		return nil, ErrUnknownCategory
	}
	snap, err := s.load(ctx)
	if err != nil {
		return nil, err
	}
	flows := FlowsOf(category)
	shared := in.Shared && len(flows) > 1
	chains := map[string]string{}
	if shared {
		minSteps, maxSteps := limits(flows)
		if err := snap.validate(c.Label, in.Steps, minSteps, maxSteps); err != nil {
			return nil, err
		}
		chains[sharedScope(category)] = joinIDs(in.Steps)
	} else {
		for key, ids := range in.Flows {
			f, ok := FindFlow(key)
			if !ok || f.Category != category {
				return nil, ErrUnknownFlow
			}
			if err := snap.validate(f.Label, ids, f.MinEnabled, f.MaxSteps); err != nil {
				return nil, err
			}
			chains[key] = joinIDs(ids)
		}
	}
	if err := s.repo.SaveCategory(ctx, category, shared, chains); err != nil {
		return nil, err
	}
	if snap, err = s.load(ctx); err != nil {
		return nil, err
	}
	v := snap.category(c)
	return &v, nil
}

// CanAct reports whether roleID may act at stageKey of flow: the stage's own
// role, or the system (Administrator) role. It fails closed — an unknown
// flow/stage/role or a lookup error denies.
func (s *Service) CanAct(ctx context.Context, roleID uint, flow, stageKey string) bool {
	if s == nil || s.repo == nil || roleID == 0 {
		return false
	}
	role, err := s.repo.FindRole(ctx, roleID)
	if err != nil {
		return false
	}
	if role.IsSystem {
		return true
	}
	c, err := s.Chain(ctx, flow)
	if err != nil {
		return false
	}
	st, ok := c.Exact(stageKey)
	return ok && st.RoleID == roleID
}

// RoleName returns the name of the role a role-chain stage key stands for,
// or "" when key is not one or the role is gone.
func (s *Service) RoleName(ctx context.Context, key string) string {
	id, ok := StageRoleID(key)
	if !ok || s == nil || s.repo == nil {
		return ""
	}
	r, err := s.repo.FindRole(ctx, id)
	if err != nil {
		return ""
	}
	return r.Name
}

// RoleInUse returns the label of the first flow whose stored or effective
// chain includes roleID — the guard against deleting a role a workflow
// still needs. ok is false when the role is in no chain.
func (s *Service) RoleInUse(ctx context.Context, roleID uint) (string, bool, error) {
	snap, err := s.load(ctx)
	if err != nil {
		return "", false, err
	}
	has := func(ids []uint) bool {
		for _, id := range ids {
			if id == roleID {
				return true
			}
		}
		return false
	}
	for _, c := range Categories {
		if has(snap.sharedIDs(c.Key)) && snap.shared[c.Key] {
			return c.Label, true, nil
		}
		for _, f := range FlowsOf(c.Key) {
			if has(snap.flowIDs(f)) {
				return f.Label, true, nil
			}
		}
	}
	return "", false, nil
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
