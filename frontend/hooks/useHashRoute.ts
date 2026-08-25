"use client";

import { useEffect, useState } from "react";

export type HashRoute = { route: string; arg?: string };

function readHash(): HashRoute {
  if (typeof window === "undefined") return { route: "dashboard" };
  const hash = window.location.hash.replace("#", "") || "dashboard";
  const [route, arg] = hash.split("/");
  return { route, arg };
}

/**
 * Mirrors legacy/app.js's `router()` — reads `location.hash`, splits it into
 * `route/arg`, and re-reads on every `hashchange`. Kept as plain hash-based
 * navigation (not a router library) so in-app links (`#loan/GL-1001`, etc.)
 * stay exactly as shareable/bookmarkable as they are today.
 */
export function useHashRoute(): HashRoute {
  const [state, setState] = useState<HashRoute>(() => readHash());

  useEffect(() => {
    const update = () => setState(readHash());
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  return state;
}
