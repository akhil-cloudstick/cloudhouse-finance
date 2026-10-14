"use client";

/* The validation message for one form field, shown right under that field. Renders nothing when
 * there is no message, so it can sit under every input without taking space. */
export function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <div role="alert" style={{ color: "var(--red)", fontSize: 12, marginTop: 4 }}>{msg}</div>;
}

/* Puts a server/validation message on the field it is about, by the words it uses. `fields` maps a
 * field key to the words that identify it; the first match wins and a message that matches none
 * falls back to the general one. */
export function fieldForMessage(msg: string, fields: Record<string, RegExp>): string {
  for (const [key, re] of Object.entries(fields)) if (re.test(msg)) return key;
  return "";
}
