package controllers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

type StageView struct {
	StageDef
	Enabled bool `json:"enabled"`
}

type FlowView struct {
	Key         string      `json:"key"`
	Label       string      `json:"label"`
	ActionLabel string      `json:"action_label"`
	Category    string      `json:"category"`
	FinalAction string      `json:"final_action"`
	OffBehavior string      `json:"off_behavior"`
	MinEnabled  int         `json:"min_enabled"`
	MaxSteps    int         `json:"max_steps"`
	Stages      []StageView `json:"stages"`
}

type Chain struct {
	Flow   FlowDef
	stages []StageView
}

type snapshot struct {
	shared   map[string]bool
	chains   map[string]string
	legacy   map[string]map[string]bool
	byID     map[uint]commonModels.RoleRow
	byName   map[string]commonModels.RoleRow
	hasChain map[string]bool
}

type ChainRole struct {
	RoleID uint   `json:"role_id"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
}

type CategoryFlowView struct {
	Key         string      `json:"key"`
	Label       string      `json:"label"`
	ActionLabel string      `json:"action_label"`
	FinalAction string      `json:"final_action"`
	OffBehavior string      `json:"off_behavior"`
	MinEnabled  int         `json:"min_enabled"`
	MaxSteps    int         `json:"max_steps"`
	Steps       []ChainRole `json:"steps"`
}

type CategoryView struct {
	CategoryDef
	Shared      bool               `json:"shared"`
	SharedSteps []ChainRole        `json:"shared_steps"`
	MinEnabled  int                `json:"min_enabled"`
	MaxSteps    int                `json:"max_steps"`
	Flows       []CategoryFlowView `json:"flows"`
}

type UpdateCategoryInput struct {
	Shared bool              `json:"shared"`
	Steps  []uint            `json:"steps"`
	Flows  map[string][]uint `json:"flows"`
}

func sharedScope(category string) string { return "cat:" + category }

func findWorkflows(ctx context.Context) ([]commonModels.ApprovalStageSetting, error) {
	var rows []commonModels.ApprovalStageSetting
	err := config.DB.
		WithContext(ctx).Find(&rows).Error
	return rows, err
}

func findAllChains(ctx context.Context) ([]commonModels.ApprovalChain, error) {
	var rows []commonModels.ApprovalChain
	err := config.DB.
		WithContext(ctx).Find(&rows).Error
	return rows, err
}

func findAllModes(ctx context.Context) ([]commonModels.ApprovalCategoryMode, error) {
	var rows []commonModels.ApprovalCategoryMode
	err := config.DB.
		WithContext(ctx).Find(&rows).Error
	return rows, err
}

func listRoles(ctx context.Context) ([]commonModels.RoleRow, error) {
	var rows []commonModels.RoleRow
	err := config.DB.
		WithContext(ctx).Order("name asc").Find(&rows).Error
	return rows, err
}

func findRole(ctx context.Context, id uint) (*commonModels.RoleRow, error) {
	var row commonModels.RoleRow
	if err := config.DB.
		WithContext(ctx).First(&row, id).Error; err != nil {
		return nil, err
	}
	return &row, nil
}

func saveCategory(ctx context.Context, category string, shared bool, chains map[string]string) error {
	return config.DB.
		WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var mode commonModels.ApprovalCategoryMode
		err := tx.Where("category = ?", category).First(&mode).Error
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			mode = commonModels.ApprovalCategoryMode{Category: category, Shared: shared}
			if err := tx.Create(&mode).Error; err != nil {
				return err
			}
		case err != nil:
			return err
		default:
			mode.Shared = shared
			if err := tx.Save(&mode).Error; err != nil {
				return err
			}
		}
		for scope, ids := range chains {
			var rec commonModels.ApprovalChain
			err := tx.Where("scope = ?", scope).First(&rec).Error
			switch {
			case errors.Is(err, gorm.ErrRecordNotFound):
				rec = commonModels.ApprovalChain{Scope: scope, RoleIDs: ids}
				if err := tx.Create(&rec).Error; err != nil {
					return err
				}
			case err != nil:
				return err
			default:
				rec.RoleIDs = ids
				if err := tx.Save(&rec).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func createAction(ctx context.Context, a *commonModels.ApprovalAction) error {
	return config.DB.
		WithContext(ctx).Create(a).Error
}

func listActions(ctx context.Context, flow string, entityID uint) ([]commonModels.ApprovalAction, error) {
	var rows []commonModels.ApprovalAction
	err := config.DB.
		WithContext(ctx).Where("flow = ? AND entity_id = ?", flow, entityID).Order("created_at ASC, id ASC").Find(&rows).Error
	return rows, err
}

func StageKey(roleID uint) string { return "R" + strconv.FormatUint(uint64(roleID), 10) }

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

func NewChain(f FlowDef, roles []commonModels.RoleRow) *Chain {
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

func (c *Chain) Stages() []StageView { return c.stages }

func (c *Chain) Enabled() []StageDef {
	out := make([]StageDef, 0, len(c.stages))
	for _, s := range c.stages {
		out = append(out, s.StageDef)
	}
	return out
}

func (c *Chain) Off() bool { return len(c.stages) == 0 }

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
	if _, roleKey := StageRoleID(v); v == "" || legacy || roleKey {
		return 0, true
	}
	return -1, false
}

func (c *Chain) ByKey(key string) (StageDef, bool) {
	i, ok := c.resolve(key, func(s StageDef) string { return s.Key })
	if !ok {
		return StageDef{}, false
	}
	return c.stages[i].StageDef, true
}

func (c *Chain) ByPending(pending string) (StageDef, bool) {
	i, ok := c.resolve(pending, func(s StageDef) string { return s.Pending })
	if !ok {
		return StageDef{}, false
	}
	return c.stages[i].StageDef, true
}

func (c *Chain) Exact(key string) (StageDef, bool) {
	if i := c.indexBy(func(s StageDef) bool { return s.Key == key }); i >= 0 {
		return c.stages[i].StageDef, true
	}
	return StageDef{}, false
}

func (c *Chain) Next(current string) (StageDef, bool) {
	i, ok := c.resolve(current, func(s StageDef) string { return s.Key })
	if !ok || i+1 >= len(c.stages) {
		return StageDef{}, false
	}
	return c.stages[i+1].StageDef, true
}

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

func loadWorkflow(ctx context.Context) (*snapshot, error) {
	modes, err := findAllModes(ctx)
	if err != nil {
		return nil, err
	}
	chains, err := findAllChains(ctx)
	if err != nil {
		return nil, err
	}
	settings, err := findWorkflows(ctx)
	if err != nil {
		return nil, err
	}
	roles, err := listRoles(ctx)
	if err != nil {
		return nil, err
	}
	snap := &snapshot{
		shared: map[string]bool{}, chains: map[string]string{}, legacy: map[string]map[string]bool{},
		byID: map[uint]commonModels.RoleRow{}, byName: map[string]commonModels.RoleRow{}, hasChain: map[string]bool{},
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

func (snap *snapshot) flowIDs(f FlowDef) []uint {
	if snap.hasChain[f.Key] {
		return parseIDs(snap.chains[f.Key])
	}
	return snap.legacyIDs(f)
}

func (snap *snapshot) sharedIDs(category string) []uint {
	if scope := sharedScope(category); snap.hasChain[scope] {
		return parseIDs(snap.chains[scope])
	}
	if flows := FlowsOf(category); len(flows) > 0 {
		return snap.flowIDs(flows[0])
	}
	return nil
}

func (snap *snapshot) effectiveIDs(f FlowDef) []uint {
	if snap.shared[f.Category] && len(FlowsOf(f.Category)) > 1 {
		return snap.sharedIDs(f.Category)
	}
	return snap.flowIDs(f)
}

func (snap *snapshot) rolesOf(ids []uint) []commonModels.RoleRow {
	out := make([]commonModels.RoleRow, 0, len(ids))
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

func WorkflowChain(ctx context.Context, flow string) (*Chain, error) {
	f, ok := FindFlow(flow)
	if !ok {
		return nil, NewNotFound("Unknown approval flow")
	}
	snap, err := loadWorkflow(ctx)
	if err != nil {
		return nil, err
	}
	return snap.chain(f), nil
}

func workflowConfig(ctx context.Context) ([]FlowView, error) {
	snap, err := loadWorkflow(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]FlowView, 0, len(WorkflowCatalogue))
	for _, f := range WorkflowCatalogue {
		out = append(out, snap.chain(f).view())
	}
	return out, nil
}

func (snap *snapshot) steps(ids []uint) []ChainRole {
	out := make([]ChainRole, 0, len(ids))
	for _, r := range snap.rolesOf(ids) {
		out = append(out, ChainRole{RoleID: r.ID, Name: r.Name, Active: r.IsActive})
	}
	return out
}

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

func workflowCategories(ctx context.Context) ([]CategoryView, error) {
	snap, err := loadWorkflow(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]CategoryView, 0, len(Categories))
	for _, c := range Categories {
		out = append(out, snap.category(c))
	}
	return out, nil
}

func (snap *snapshot) validate(label string, ids []uint, minSteps, maxSteps int) error {
	seen := map[uint]bool{}
	for _, id := range ids {
		r, ok := snap.byID[id]
		if !ok {
			return NewBadRequest(fmt.Sprintf("%s: one of the selected roles no longer exists", label))
		}
		if !r.IsActive {
			return NewBadRequest(fmt.Sprintf("%s: role %q is inactive — remove it or reactivate it first", label, r.Name))
		}
		if seen[id] {
			return NewBadRequest(fmt.Sprintf("%s: role %q is in the chain twice", label, r.Name))
		}
		seen[id] = true
	}
	if len(ids) < minSteps {
		return NewBadRequest(fmt.Sprintf("%s needs at least %d approver", label, minSteps))
	}
	if maxSteps > 0 && len(ids) > maxSteps {
		return NewBadRequest(fmt.Sprintf("%s allows at most %d approver", label, maxSteps))
	}
	return nil
}

func updateCategory(ctx context.Context, category string, in UpdateCategoryInput) (*CategoryView, error) {
	c, ok := FindCategory(category)
	if !ok {
		return nil, NewNotFound("Unknown approval category")
	}
	snap, err := loadWorkflow(ctx)
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
				return nil, NewNotFound("Unknown approval flow")
			}
			if err := snap.validate(f.Label, ids, f.MinEnabled, f.MaxSteps); err != nil {
				return nil, err
			}
			chains[key] = joinIDs(ids)
		}
	}
	if err := saveCategory(ctx, category, shared, chains); err != nil {
		return nil, err
	}
	if snap, err = loadWorkflow(ctx); err != nil {
		return nil, err
	}
	v := snap.category(c)
	return &v, nil
}

func CanAct(ctx context.Context, roleID uint, flow, stageKey string) bool {
	if roleID == 0 {
		return false
	}
	role, err := findRole(ctx, roleID)
	if err != nil {
		return false
	}
	if role.IsSystem {
		return true
	}
	c, err := WorkflowChain(ctx, flow)
	if err != nil {
		return false
	}
	st, ok := c.Exact(stageKey)
	return ok && st.RoleID == roleID
}

func RoleName(ctx context.Context, key string) string {
	id, ok := StageRoleID(key)
	if !ok {
		return ""
	}
	r, err := findRole(ctx, id)
	if err != nil {
		return ""
	}
	return r.Name
}

func RoleInUse(ctx context.Context, roleID uint) (string, bool, error) {
	snap, err := loadWorkflow(ctx)
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

func RecordAction(ctx context.Context, a *commonModels.ApprovalAction) {
	if err := createAction(ctx, a); err != nil {
		log.Printf("approval action audit (%s #%d) failed: %v", a.Flow, a.EntityID, err)
	}
}

func ListActions(ctx context.Context, flow string, entityID uint) ([]commonModels.ApprovalAction, error) {
	return listActions(ctx, flow, entityID)
}

func ListWorkflows(c echo.Context) error {
	ctx := auth.RequestContext(c)
	flows, err := workflowConfig(ctx)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, flows)
}

func ListWorkflowCategories(c echo.Context) error {
	ctx := auth.RequestContext(c)
	cats, err := workflowCategories(ctx)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, cats)
}

func UpdateWorkflowCategory(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req UpdateCategoryInput
	if err := BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	view, err := updateCategory(ctx, c.Param("category"), req)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, view)
}
