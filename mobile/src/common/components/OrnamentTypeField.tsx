import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ComboInput, Field, MenuItem } from "@/common/components/ui";
import { useAuth } from "@/common/providers/AuthProvider";
import { useDebouncedValue } from "@/common/hooks/use-debounced-value";
import { listOrnamentTypes, createOrnamentType } from "@/modules/ornament-types/services/ornamentTypeService";

type OrnamentTypeFieldProps = { value: string; onChange: (v: string) => void };

/** Search-or-create against the shared ornament_types catalog. */
export function OrnamentTypeField({ value, onChange }: OrnamentTypeFieldProps) {
  const canAddType = useAuth().can("Ornament_Type_Management", "can_create_ornament_type");
  const qc = useQueryClient();
  const [focused, setFocused] = useState(false);
  const dq = useDebouncedValue(value);
  const results = useQuery({ queryKey: ["ornamentTypes", dq], queryFn: () => listOrnamentTypes(dq || undefined), enabled: focused });
  const create = useMutation({
    mutationFn: (name: string) => createOrnamentType(name),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["ornamentTypes"] });
      onChange(t.name);
    },
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
    </Field>
  );
}
