"use client";

import { useEffect, useRef } from "react";

type ScrollSentinelProps = { enabled: boolean; onVisible: () => void; watch?: unknown };

/* Invisible marker at the end of a card-mode list: when it scrolls into view
 * (and there is more to load) it calls onVisible. `watch` re-arms the observer
 * after each load so a still-visible marker keeps loading until the list
 * overflows or runs out. */
export function ScrollSentinel({ enabled, onVisible, watch }: ScrollSentinelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); cb.current(); }
    }, { rootMargin: "240px" });
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, watch]);

  return <div ref={ref} className="scroll-sentinel" aria-hidden="true" />;
}
