import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AccRow,
  C,
  FabCorner,
  FlatHeader,
  NoticeBanner,
  PrimaryButton,
  Screen,
  SearchInput,
  SelectField,
  ServerFlatList,
  Sheet,
  TextField,
  Txt,
} from "../../../src/components/ui";
import { useServerList } from "../../../src/hooks/useServerList";
import { deleteApiKey, listApiKeysPage, setApiKey } from "../../../src/api/settings";
import { API_KEY_CATEGORIES, type ApiKeyCategory, type ApiKeyView } from "../../../src/types/apiKey";
import { ApiError } from "../../../src/api/client";
import { dmy } from "../../../src/lib/format";

// Settings (API keys) — not drawn in the prototype; built from its list
// language (FlatHeader back, SearchInput, server-paged AccRows, Sheets).
// Administrator-only: the route is hidden from More for everyone else and
// the backend's RBAC 403s regardless. Raw key values are never returned —
// only whether a category is configured.

const label = (c: string) => c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

/** Add / replace a category's key. `category` null = pick one (FAB). */
function ApiKeySheet({ visible, onClose, item }: { visible: boolean; onClose: () => void; item: ApiKeyView | null }) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<ApiKeyCategory>(API_KEY_CATEGORIES[0]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setCategory(item?.category ?? API_KEY_CATEGORIES[0]);
    setName(item?.name ?? "");
    setValue("");
    setError(null);
  }, [visible, item]);

  const save = useMutation({
    mutationFn: () => setApiKey(category, value, name.trim() || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  return (
    <Sheet visible={visible} onClose={onClose} title={item ? `Edit ${label(item.category)}` : "Add API Key"} maxHeightPct={80}>
      {item ? null : (
        <SelectField label="Category" value={category} options={API_KEY_CATEGORIES} onChange={setCategory} labels={Object.fromEntries(API_KEY_CATEGORIES.map((c) => [c, label(c)]))} />
      )}
      <TextField label="Name (optional)" value={name} onChangeText={setName} placeholder="e.g. Provider account" />
      <TextField label="New value" value={value} onChangeText={setValue} secureTextEntry placeholder="Paste the key" autoCapitalize="none" autoCorrect={false} />
      {item?.configured ? <NoticeBanner>Saving replaces the stored key. The current value is never shown.</NoticeBanner> : null}
      {error ? <Txt style={{ color: C.red, fontSize: 12, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton label="Save Key" onPress={() => save.mutate()} loading={save.isPending} disabled={!value} />
    </Sheet>
  );
}

/** Clear a category's stored key. */
function DeleteKeySheet({ item, onClose }: { item: ApiKeyView | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const del = useMutation({
    mutationFn: () => deleteApiKey(item!.category),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      onClose();
    },
  });
  useEffect(() => del.reset(), [item]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet visible={item != null} onClose={onClose} title="Remove API Key" maxHeightPct={50}>
      <Txt style={{ fontSize: 13, color: C.muted, marginBottom: 14 }}>
        The stored {item ? label(item.category) : ""} key will be cleared. Features using it stop working until a new key is saved.
      </Txt>
      {del.isError ? (
        <Txt style={{ color: C.red, fontSize: 12, marginBottom: 10 }}>{del.error instanceof ApiError ? del.error.message : "Could not remove."}</Txt>
      ) : null}
      <PrimaryButton label="Remove Key" variant="danger" loading={del.isPending} onPress={() => del.mutate()} />
    </Sheet>
  );
}

export default function SettingsScreen() {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ApiKeyView | null>(null);
  const [deleting, setDeleting] = useState<ApiKeyView | null>(null);

  const list = useServerList<ApiKeyView>({ key: ["api-keys", "list"], fetchPage: (p) => listApiKeysPage(p) });

  return (
    <Screen
      header={<FlatHeader title="Settings" subtitle="API keys & integrations" />}
      floating={
        <FabCorner
          label="Add API key"
          onPress={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        />
      }
    >
      <ServerFlatList
        list={list}
        items={list.items}
        keyOf={(k) => k.category}
        emptyText={list.search ? "No API keys match your search." : "No categories found."}
        header={<SearchInput value={list.search} onChangeText={list.setSearch} placeholder="Search by category or name" style={{ paddingTop: 14 }} />}
        renderItem={(k) => (
          <AccRow
            name={label(k.category)}
            sub={k.name || undefined}
            status={k.configured ? "Configured" : "Not configured"}
            statusTone={k.configured ? "active" : "closed"}
            details={[
              { k: "Name", v: k.name || "—" },
              { k: "Last updated", v: k.updatedAt ? dmy(k.updatedAt) : "—" },
            ]}
            actions={[
              ...(k.configured ? [{ label: "Remove", danger: true, onPress: () => setDeleting(k) }] : []),
              {
                label: k.configured ? "Edit Key" : "Add Key",
                primary: true,
                onPress: () => {
                  setEditing(k);
                  setFormOpen(true);
                },
              },
            ]}
          />
        )}
      />

      <ApiKeySheet visible={formOpen} onClose={() => setFormOpen(false)} item={editing} />
      <DeleteKeySheet item={deleting} onClose={() => setDeleting(null)} />
    </Screen>
  );
}
