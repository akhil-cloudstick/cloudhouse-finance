import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AsyncSelect, ChipToggle, Field, Input, PrimaryButton, Sheet, toast } from "@/common/components/ui";
import { FieldErr } from "@/common/components/ErrorText";
import { useAuth } from "@/common/providers/AuthProvider";
import { ApiError } from "@/common/services/httpClient";
import { createLocker, updateLocker } from "@/modules/lockers/services/lockerService";
import { listBranchesPage } from "@/modules/branches/services/branchService";
import type { Locker } from "@/modules/lockers/types/locker-types";
import type { Branch } from "@/modules/branches/types/branch-types";
import { useShowBranch } from "@/common/hooks/use-branch-switch";

const CODE_RE = /^[A-Za-z0-9-]*$/;
const ACTIVE_OPTIONS = ["Active", "Inactive"] as const;
type LockerFormSheetProps = { visible: boolean; editing: Locker | null; onClose: () => void };

/** Add / edit locker. `editing` null = create. */
export function LockerFormSheet({ visible, editing, onClose }: LockerFormSheetProps) {
  const qc = useQueryClient();
  const { employee } = useAuth();
  const [code, setCode] = useState("");
  const [capacity, setCapacity] = useState("");
  const [branch, setBranch] = useState<{ id: number; name?: string } | null>(null);
  const [active, setActive] = useState<(typeof ACTIVE_OPTIONS)[number]>("Active");
  const [tried, setTried] = useState(false);
  // Single-branch plans never show a branch — the locker just takes the business's one branch.
  const showBranch = useShowBranch();

  useEffect(() => {
    if (!visible) return;
    setTried(false);
    if (editing) {
      setCode(editing.code);
      setCapacity(String(editing.capacity));
      setBranch({ id: editing.branchId, name: editing.branch?.name });
      setActive(editing.isActive ? "Active" : "Inactive");
    } else {
      setCode("");
      setCapacity("");
      setBranch(employee?.branchId ? { id: employee.branchId, name: undefined } : null);
      setActive("Active");
    }
  }, [visible, editing, employee?.branchId]);

  // Hidden picker: fall back to the first active branch (web does the same).
  useEffect(() => {
    if (!visible || showBranch || editing || branch) return;
    listBranchesPage({ active: true, limit: 1, offset: 0 }).then((r) => { const b = r.items?.[0]; if (b) setBranch({ id: b.id, name: b.name }); }).catch(() => {});
  }, [visible, showBranch, editing, branch]);

  const codeValid = CODE_RE.test(code.trim());
  const capacityNum = Number(capacity);
  const capacityValid = Number.isInteger(capacityNum) && capacityNum > 0;
  // Shrinking below what's already stored would strand packets.
  const belowOccupied = !!editing && capacityValid && capacityNum < (editing.occupied ?? 0);
  const errs: Record<string, string> = {};
  if (!code.trim()) errs.code = "Enter the locker code.";
  else if (!codeValid) errs.code = "Locker code may only contain letters, numbers and hyphens.";
  if (!capacityValid) errs.capacity = "Enter a capacity greater than zero.";
  else if (belowOccupied) errs.capacity = `Capacity can't be lower than the ${editing!.occupied} packets already stored.`;
  if (branch == null) errs.branch = "Select a branch.";
  const fe = (k: string) => (tried ? errs[k] : undefined);

  const save = useMutation({
    mutationFn: () => {
      const input = { code: code.trim().toUpperCase(), branchId: branch!.id, capacity: capacityNum };
      return editing ? updateLocker(editing.id, { ...input, isActive: active === "Active" }) : createLocker(input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lockers"] });
      qc.invalidateQueries({ queryKey: ["locker"] });
      onClose();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not save."),
  });

  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? `Edit Locker ${editing.code}` : "Add Locker"} maxHeightPct={80}>
      <Field label="Locker code">
        <Input value={code} onChangeText={(v) => setCode(v.toUpperCase())} autoCapitalize="characters" autoCorrect={false} placeholder="e.g. LKR-04" />
      </Field>
      <FieldErr m={fe("code")} />
      <Field label={editing ? `Capacity (holds ${editing.occupied ?? 0} now)` : "Capacity"}>
        <Input value={capacity} onChangeText={(v) => setCapacity(v.replace(/[^0-9]/g, ""))} keyboardType="number-pad" placeholder="e.g. 40" />
      </Field>
      <FieldErr m={fe("capacity")} />
      {showBranch ? (
      <AsyncSelect<Branch>
        label="Branch"
        placeholder="Search branch"
        queryKey={["branches", "locker-picker"]}
        fetcher={async (q) => (await listBranchesPage({ q: q || undefined, active: true, limit: 20, offset: 0 })).items ?? []}
        selectedLabel={branch ? branch.name ?? (branch.id === employee?.branchId ? "Your branch" : `Branch #${branch.id}`) : undefined}
        onSelect={(b) => setBranch({ id: b.id, name: b.name })}
        keyOf={(b) => b.id}
        renderItem={(b) => ({ title: b.name, sub: b.code })}
      />
      ) : null}
      {showBranch ? <FieldErr m={fe("branch")} /> : null}
      {editing ? (
        <Field label="Status">
          <ChipToggle options={ACTIVE_OPTIONS} value={active} onChange={setActive} />
        </Field>
      ) : null}
      <PrimaryButton label={editing ? "Save Changes" : "Create Locker"} onPress={() => (Object.keys(errs).length ? setTried(true) : save.mutate())} loading={save.isPending} />
    </Sheet>
  );
}
