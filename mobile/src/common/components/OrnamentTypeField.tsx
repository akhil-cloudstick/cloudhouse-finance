import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ComboInput, ConfirmSheet, Field, MenuItem, toast } from "@/common/components/ui";
import { useAuth } from "@/common/providers/AuthProvider";
import { useDebouncedValue } from "@/common/hooks/use-debounced-value";
import { userMessage } from "@/common/services/apiErrors";
import { listOrnamentTypes, createOrnamentType, deleteOrnamentType } from "@/modules/ornament-types/services/ornamentTypeService";
import type { OrnamentType } from "@/modules/ornament-types/types/ornament-type-types";

type OrnamentTypeFieldProps = { value: string; onChange: (v: string) => void };

/** Search-or-create against the shared ornament_types catalog; types can also be removed from it. */
export function OrnamentTypeField({ value, onChange }: OrnamentTypeFieldProps) {
  const canAddType = useAuth().can("Ornament_Type_Management", "can_create_ornament_type");
  const qc = useQueryClient();
  const [focused, setFocused] = useState(false);
  const [toDelete, setToDelete] = useState<OrnamentType | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const dq = useDebouncedValue(value);
  const results = useQuery({ queryKey: ["ornamentTypes", dq], queryFn: () => listOrnamentTypes(dq || undefined), enabled: focused });
  const create = useMutation({
    mutationFn: (name: string) => createOrnamentType(name),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["ornamentTypes"] });
      onChange(t.name);
    },
  });
  // Only the catalog row goes; loans already pledged with the type keep their ornament.
  const remove = useMutation({
    mutationFn: (t: OrnamentType) => deleteOrnamentType(t.id),
    onSuccess: (_r, t) => {
      qc.invalidateQueries({ queryKey: ["ornamentTypes"] });
      if (t.name === value) onChange("");
      toast.success(`Ornament type "${t.name}" deleted`);
      setToDelete(null);
    },
    onError: (e) => setDeleteError(userMessage(e, "Could not delete this ornament type.")),
  });
  const trimmed = value.trim();
  const options = (results.data ?? []).slice(0, 8);
  const exact = options.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());
  return (
    <Field label="Ornament type">
      <ComboInput
        value={value}
        onChangeText={onChange}
        placeholder="e.g. Gold Chain, Bangle, Ring"
        onOpened={() => setFocused(true)}
        onClosed={() => setFocused(false)}
        menu={(close) =>
          options.length > 0 || (trimmed && !exact) ? (
            <>
              {options.map((o) => (
                <MenuItem
                  key={o.id}
                  title={o.name}
                  selected={o.name === value}
                  onPress={() => {
                    onChange(o.name);
                    close();
                  }}
                  onDelete={
                    canAddType
                      ? () => {
                          setDeleteError(null);
                          // after the list and keyboard have closed, so their teardown cannot dismiss the sheet
                          setTimeout(() => setToDelete(o), 150);
                          close();
                        }
                      : undefined
                  }
                />
              ))}
              {trimmed && !exact && canAddType ? (
                <MenuItem
                  accent
                  title={create.isPending ? "Adding…" : `+ Add "${trimmed}"`}
                  onPress={() => {
                    if (create.isPending) return;
                    create.mutate(trimmed);
                    close();
                  }}
                />
              ) : null}
            </>
          ) : null
        }
      />
      <ConfirmSheet
        visible={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Delete Ornament Type"
        danger
        message={`Delete "${toDelete?.name ?? ""}" from the ornament type list? Loans already pledged with it keep their ornament.`}
        confirmLabel="Delete"
        loading={remove.isPending}
        error={deleteError}
        onConfirm={() => toDelete && remove.mutate(toDelete)}
      />
    </Field>
  );
}
