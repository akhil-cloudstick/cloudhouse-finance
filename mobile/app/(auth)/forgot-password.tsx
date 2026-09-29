import { useEffect } from "react";
import { useRouter } from "expo-router";

// Forgot password is now a phase of the single (auth)/login.tsx screen, not
// a separate route — see that file's comment. This file stays only so an
// old link/bookmark to this path (or a stale nav state restored from
// before this change) still lands somewhere sane instead of a 404.
export default function ForgotPasswordRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/login");
  }, [router]);
  return null;
}
