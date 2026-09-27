import { useEffect } from "react";
import { useRouter } from "expo-router";

// Reset password is now a phase of the single (auth)/login.tsx screen, not
// a separate route — see that file's comment. This file stays only so an
// old link/bookmark to this path (or a stale nav state restored from
// before this change) still lands somewhere sane instead of a 404. It
// can't resume mid-flow (the OTP was only ever requested through the
// in-app "Forgot password" step, never via a link to this path), so this
// just returns to sign-in rather than pretend to.
export default function ResetPasswordRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/login");
  }, [router]);
  return null;
}
