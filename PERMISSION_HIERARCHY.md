# Permission Hierarchy: How a Parent Blocks Its Lower Permissions

Permissions now form a parent/child tree. You can't turn on a child permission while its parent is off, and turning off a parent also turns off everything under it.

This rule is enforced in three places:

| Layer | Where | What it does |
|---|---|---|
| Hierarchy definition | [backend/internal/authz/dependencies.go](backend/internal/authz/dependencies.go) | Decides who is the parent of whom |
| Save / API (the real guard) | `UpdateRolePermissions` in [backend/internal/authz/repository.go](backend/internal/authz/repository.go) | Cascades revokes, refuses orphan grants (HTTP 409) |
| Boot repair | `EnforceDependencies` in [repository.go](backend/internal/authz/repository.go), called from [migrate.go](backend/internal/migrate/migrate.go) | Fixes existing DB rows that break the rule |
| Roles screen (UX) | [RolesPermissions.tsx](frontend/product/pages/roles/components/RolesPermissions.tsx) | Greys out blocked children, confirms cascade-off |

---

## 1. How parents are decided

There are two sources, combined once at startup in `loadHierarchy()`.

### a) Derived module parent (automatic)
Every module has one view permission named **`can view <noun> module`**. Any `can create / update / delete / hard delete <noun>` automatically gets it as its parent:

```
can view scheme module
 ├── can create scheme
 ├── can update scheme
 └── can delete scheme
```

When you add a new CRUD permission to `Catalogue`, it is wired in with no extra code.

### b) `extraParents` (explicit overrides)
This handles cross-module needs and deeper nesting. **If a permission has an `extraParents` entry, that entry *replaces* the derived parent.** Examples:

| Permission | Parents (all must be ON) |
|---|---|
| `can create loan` | loan module, customer module, scheme module, gold rate module, purity standard module, ornament type module |
| `can hard delete loan` | `can delete loan` (which itself sits under loan module) |
| `can verify release checklist`, `can schedule auction`, `can settle auction`, … | `can update loan` |
| `can view bank pledge module` | `can view loan module` |
| `can update packet` | packet module + locker module |
| `can create / update / delete role` | `can view role and permission module` |

The chain runs through every level, so `can hard delete loan` needs **delete loan → loan module**, all ON.

If a parent named here no longer exists in the catalogue, it is skipped and blocks nothing.

### c) `softParents` (warning only, never blocks)
Some features still work without a permission, but a dropdown or panel comes up empty. These are only shown as a hint, e.g. *"Works best with Bank module, Cash module"*. They **never** block a toggle and are never cascaded.

---

## 2. Enabling a child: blocked

**Frontend (`toggle` → `missingParents`)**
- Each row from `GET .../permissions` includes `parents[]` with a `granted` flag for this role.
- If any parent is off (counting unsaved edits in `pending`), the checkbox is **disabled**, the row gets the `blocked` class, and the tooltip/toast says:
  > `Enable Scheme module, Customer module first`
- Parent state comes from the server's full grant set, so the block still works when a search hides the parent's row.

**Backend (`UpdateRolePermissions`), the actual enforcement**
1. Load the role's current grants (`before`) and apply the PATCH on top (`after`).
2. For every permission ON in `after`, check each direct parent. If any parent is OFF, the **whole transaction is rejected**:
   ```
   409 Conflict
   "Scheme module is disabled, cannot enable create scheme"
   ```
   (`ParentDisabledError` → `IsParentDisabled` → handler returns `http.StatusConflict`.)
3. It's all-or-nothing: none of the updates in that PATCH are saved.

Checking direct parents is enough here, because every parent is itself checked against *its* parents in the same pass.

So calling the API directly (Postman, a stale UI) still can't create an orphan grant.

---

## 3. Disabling a parent: cascades down

**Frontend**
- `toggle` on an ON row collects `row.dependents[]` that are currently on.
- If there are any, a **confirmation modal** (`CascadeOffModalContent`) lists them, with a button reading *"Turn off N"*.
- On confirm, the parent and all those dependents are marked `false` in `pending`.

**Backend**
- For every update setting a permission to `false`, `Dependents(name)` walks the tree **transitively** (`walk()`), and every descendant is forced to `false` in `after`.
- So even if the client only sends the parent's revoke, the children are revoked in the same transaction.

```
Turn OFF "can view loan module"
  → can create/update/delete loan
  → can hard delete loan               (via delete loan)
  → can verify release checklist, auction steps (via update loan)
  → can view bank pledge module        (cross-module child)
```

---

## 4. Existing data: repaired on boot

`EnforceDependencies` runs on every migrate/boot after all the grant/seed steps:
- For every role, every granted permission whose **ancestors** (`AllParents`, transitive) are not all granted is set to `permission = false`.
- It only revokes and never grants. It logs `authz: revoked N grant(s) whose parent permission was off`.

This means databases from before the hierarchy existed start out consistent.

---

## 5. Paths that don't hit the check (and why that's fine)

| Path | Behaviour |
|---|---|
| **Set all** (`PATCH .../set-all?permission=true\|false`) → `SetEveryGrant` | Sets every permission to the same value, so a parent can never be off while a child is on |
| **Create role** | Grants everything, so it's consistent |
| **System roles** | Can't be edited (403 before any hierarchy logic) |

---

## 6. Request flow summary

```
User clicks child checkbox
   │
   ├─ parent OFF? ──yes──► checkbox disabled / toast "Enable X first"   (UI)
   │
   └─ no ──► pending[child]=true ──► Save ──► PATCH
                                              │
                                   UpdateRolePermissions (tx)
                                     ├─ apply updates → after
                                     ├─ revoked items → force all Dependents OFF
                                     ├─ any ON item with OFF parent? → 409, rollback
                                     └─ write changed rows, commit
```

## 7. Adding a new permission

- **Plain CRUD** (`can create foo`): add it to `Catalogue`. If `can view foo module` exists, it becomes the parent automatically.
- **Needs another module's data for a required field**: add an `extraParents` entry, and **include its own module view too**, because the entry replaces the derived parent.
- **Only makes a picker nicer**: add it to `softParents`.
- Tests: [backend/internal/authz/dependencies_test.go](backend/internal/authz/dependencies_test.go).
