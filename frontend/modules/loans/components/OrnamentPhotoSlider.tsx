"use client";

import { useEffect, useState } from "react";
import { SafeImage } from "@/common/components/ui/SafeImage";

type OrnamentPhotoSliderProps = {
  title: string;
  urls: string[];
  onClose: () => void;
  // When given, a "Remove this photo" button appears (New Loan form only);
  // the slider drops the photo from its own list and closes once it's empty.
  onRemove?: (url: string) => void;
};

/* Modal body that pages through every photo of one ornament — one large
 * image with prev/next, a counter, and a thumbnail strip. Open it with
 * openModal(<OrnamentPhotoSlider … />, true). */
export function OrnamentPhotoSlider({ title, urls, onClose, onRemove }: OrnamentPhotoSliderProps) {
  const [list, setList] = useState(urls);
  const [i, setI] = useState(0);
  const many = list.length > 1;
  const go = (d: number) => setI((c) => (c + d + list.length) % list.length);

  useEffect(() => {
    if (!many) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [many, list.length]);

  function removeCurrent() {
    const url = list[i];
    const next = list.filter((_, idx) => idx !== i);
    onRemove?.(url);
    if (!next.length) { onClose(); return; }
    setList(next);
    setI(Math.min(i, next.length - 1));
  }

  const navBtn = (side: "left" | "right", label: string, d: number) => (
    <button
      type="button"
      className="btn plain sm"
      aria-label={label}
      onClick={() => go(d)}
      style={{ position: "absolute", top: "50%", [side]: 6, transform: "translateY(-50%)", width: 34, height: 34, padding: 0, borderRadius: "50%", background: "var(--card, #fff)", border: "1px solid var(--line)" }}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );

  return (
    <>
      <div className="hd"><h3>{title}</h3><div className="sp" />{many && <span className="chip">{i + 1} / {list.length}</span>}<button className="x" onClick={onClose}>×</button></div>
      <div className="bd bd-scroll" style={{ textAlign: "center" }}>
        <div style={{ position: "relative" }}>
          <SafeImage src={list[i]} style={{ maxWidth: "100%", maxHeight: "60vh", borderRadius: 8 }} alt={`${title} ${i + 1}`} />
          {many && navBtn("left", "Previous photo", -1)}
          {many && navBtn("right", "Next photo", 1)}
        </div>
        {many && (
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 12 }}>
            {list.map((u, idx) => (
              <span key={u} style={{ borderRadius: 6, outline: idx === i ? "2px solid var(--brand, #2b4a8c)" : "none", outlineOffset: 1, display: "inline-flex" }}>
                <SafeImage src={u} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)", cursor: "pointer" }} title={`Photo ${idx + 1}`} onClick={() => setI(idx)} />
              </span>
            ))}
          </div>
        )}
        {onRemove && (
          <div style={{ marginTop: 12 }}>
            <button type="button" className="btn danger sm" onClick={removeCurrent}>Remove this photo</button>
          </div>
        )}
      </div>
    </>
  );
}
