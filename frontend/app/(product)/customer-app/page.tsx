import { redirect } from "next/navigation";

/* The per-app index is just its privacy policy — the document stores ask for first. */
export default function Page() {
  redirect("/customer-app/privacy-policy");
}
