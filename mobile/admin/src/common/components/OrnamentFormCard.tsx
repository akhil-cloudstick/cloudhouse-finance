import { View } from "react-native";
import { C, ChipToggle, ComboInput, Field, FieldRow, Input, MenuItem, OrnamentCard, Txt } from "@/common/components/ui";
import { UploadField } from "./UploadField";
import { OrnamentTypeField } from "./OrnamentTypeField";
import { UploadImage } from "./BillSheet";
import { formatPurity, isFinenessInRange, isKaratInRange, parsePurity, type PurityUnit } from "@/common/utils/purity";

// The ornament card shared by Create New Loan and Edit Loan, so both forms capture ornaments identically:
// purity as Karat / Fineness, quantity, gross / less / net weight (net is gross − less) and photos.
export type OrnFormRow = { name: string; purityUnit: PurityUnit; purityValue: string; grossWeight: string; lessWeight: string; quantity: string; imgs: string[]; netText?: string };
export const MAX_ORNAMENT_PHOTOS = 3;
export const emptyOrnRow: OrnFormRow = { name: "", purityUnit: "karat", purityValue: "22", grossWeight: "", lessWeight: "", quantity: "1", imgs: [] };
const KARATS = ["24", "23", "22", "21", "20", "18", "16", "14", "12", "10"];
const FINENESS = ["99.9", "99.5", "91.6", "87.5", "83.3", "75", "58.5", "41.7"];

export const netOf = (r: Pick<OrnFormRow, "grossWeight" | "lessWeight">) => Math.max(0, (Number(r.grossWeight) || 0) - (Number(r.lessWeight) || 0));
export const trim3 = (n: number) => String(+n.toFixed(3));

/** The row's purity as the "22K" / "91.6%" string the backend takes, or null while it is blank / out of range. */
export function rowPurity(r: Pick<OrnFormRow, "purityUnit" | "purityValue">): string | null {
  const n = Number(r.purityValue);
  if (!r.purityValue.trim() || !(n > 0)) return null;
  if (r.purityUnit === "karat" && !isKaratInRange(n)) return null;
  if (r.purityUnit === "fineness" && !isFinenessInRange(n)) return null;
  return formatPurity(r.purityUnit, n);
}

/** Purity / weights of a stored ornament, shaped for the form (less = gross − net). */
export function ornFormFields(o: { purity: string; grossWeight: number; netWeight: number; quantity: number }): Omit<OrnFormRow, "name" | "imgs"> {
  const p = parsePurity(o.purity || "22K");
  return {
    purityUnit: p?.unit ?? "karat",
    purityValue: String(p?.value ?? 22),
    grossWeight: o.grossWeight ? String(o.grossWeight) : "",
    lessWeight: o.grossWeight > o.netWeight ? trim3(o.grossWeight - o.netWeight) : "",
    quantity: String(o.quantity || 1),
  };
}

type PurityInputProps = { unit: PurityUnit; value: string; onChange: (v: string) => void };

/** Karat / fineness entry: type any value, or pick a standard one. */
function PurityInput({ unit, value, onChange }: PurityInputProps) {
  const opts = unit === "karat" ? KARATS : FINENESS;
  return (
    <ComboInput
      value={value}
      onChangeText={(v) => onChange(v.replace(/[^0-9.]/g, ""))}
      keyboardType="decimal-pad"
      placeholder={unit === "karat" ? "22" : "91.6"}
      menu={(close) => (
        <>
          {opts.map((o) => (
            <MenuItem
              key={o}
              title={unit === "karat" ? `${o}K` : `${o}%`}
              selected={o === value}
              onPress={() => {
                onChange(o);
                close();
              }}
            />
          ))}
        </>
      )}
    />
  );
}

type OrnamentFormCardProps = {
  title: string;
  row: OrnFormRow;
  onChange: (patch: Partial<OrnFormRow>) => void;
  onRemove?: () => void;
  /** Photos already saved on the ornament (Edit Loan) — shown as thumbnails and counted against the limit. */
  savedPhotos?: string[];
};

export function OrnamentFormCard({ title, row: r, onChange, onRemove, savedPhotos = [] }: OrnamentFormCardProps) {
  const bad = Number(r.lessWeight) > Number(r.grossWeight);
  const room = MAX_ORNAMENT_PHOTOS - savedPhotos.length;
  return (
    <OrnamentCard title={title} onRemove={onRemove}>
      <OrnamentTypeField value={r.name} onChange={(v) => onChange({ name: v })} />
      <Field label="Purity unit">
        <ChipToggle
          options={["karat", "fineness"] as const}
          labels={{ karat: "Karat", fineness: "Fineness" }}
          value={r.purityUnit}
          onChange={(u) => onChange({ purityUnit: u, purityValue: u === "karat" ? "22" : "91.6" })}
        />
      </Field>
      <FieldRow>
        <Field label={r.purityUnit === "karat" ? "Karat" : "Fineness %"}>
          <PurityInput key={r.purityUnit} unit={r.purityUnit} value={r.purityValue} onChange={(v) => onChange({ purityValue: v })} />
        </Field>
        <Field label="Quantity">
          <Input keyboardType="number-pad" value={r.quantity} onChangeText={(v) => onChange({ quantity: v })} />
        </Field>
      </FieldRow>
      <FieldRow>
        <Field label="Gross Wt (g)">
          <Input keyboardType="decimal-pad" placeholder="0.0" value={r.grossWeight} onChangeText={(v) => onChange({ grossWeight: v, netText: undefined })} />
        </Field>
        <Field label="Less Wt (g)">
          <Input keyboardType="decimal-pad" placeholder="0.0" value={r.lessWeight} onChangeText={(v) => onChange({ lessWeight: v, netText: undefined })} style={bad ? { borderColor: C.red } : undefined} />
        </Field>
      </FieldRow>
      {bad ? <Txt style={{ fontSize: 11, color: C.red, marginTop: -6, marginBottom: 8 }}>Less Wt cannot be greater than Gross Wt</Txt> : null}
      <Field label="Net Wt (g)">
        <Input
          keyboardType="decimal-pad"
          placeholder="Auto"
          value={r.netText ?? (r.grossWeight ? trim3(netOf(r)) : "")}
          onChangeText={(v) => {
            // Net is gross − less, so editing it sets the less weight.
            const g = Number(r.grossWeight) || 0;
            const net = Math.min(Number(v) || 0, g);
            onChange({ netText: v, lessWeight: v === "" || !g ? r.lessWeight : trim3(Math.max(0, g - net)) });
          }}
        />
      </Field>
      {savedPhotos.length ? (
        <>
          <Txt style={{ fontSize: 11.5, color: C.muted, marginBottom: 6 }}>{savedPhotos.length} saved photo{savedPhotos.length > 1 ? "s" : ""}</Txt>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            {savedPhotos.map((p) => (
              <UploadImage key={p} path={p} title={`${r.name || "Ornament"} photo`} style={{ width: 72, height: 72, borderRadius: 8 }} />
            ))}
          </View>
        </>
      ) : null}
      {r.imgs.map((url, k) => (
        <UploadField
          key={`${k}-${url}`}
          label={savedPhotos.length ? `New photo ${k + 1}` : r.imgs.length > 1 ? `Ornament photo ${k + 1}` : "Ornament photo"}
          value={url}
          onChange={(u) => onChange({ imgs: u ? r.imgs.map((x, xi) => (xi === k ? u : x)) : r.imgs.filter((_, xi) => xi !== k) })}
          allowPdf={false}
        />
      ))}
      {r.imgs.length < room ? (
        <UploadField
          key={`add-${r.imgs.length}`}
          label={r.imgs.length || savedPhotos.length ? "Add another photo" : "Ornament photo"}
          value=""
          onChange={(u) => u && onChange({ imgs: [...r.imgs, u].slice(0, room) })}
          maxFiles={room - r.imgs.length}
          onAddMany={(urls) => onChange({ imgs: [...r.imgs, ...urls].slice(0, room) })}
          allowPdf={false}
        />
      ) : null}
    </OrnamentCard>
  );
}
