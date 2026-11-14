import { redirect } from "next/navigation";

/* Stable public URL for the store listing: cloudhousefinance.com/privacy-policy.
 * The real document lives with the staff app's other legal pages. */
export default function Page() {
  redirect("/staff-app/privacy-policy");
}
