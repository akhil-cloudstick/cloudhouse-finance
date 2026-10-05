"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/product/components/Icon";

/**
 * Takes a still photo from the computer's webcam and hands it back as a
 * JPEG `File` — the same shape a file `<input>` produces — so callers can
 * push it through their existing upload path unchanged (customer photo,
 * ornament photo, …).
 *
 * Portalled to <body> as its own stacked `.modal-bg` (same approach as
 * PaymentModal's confirm popup) rather than going through `openModal`,
 * because it's usually opened from INSIDE another modal (Register/Edit
 * Customer) and `openModal` would replace that modal's content, losing
 * everything already typed into the form.
 *
 * getUserMedia only works in a secure context — https or localhost. Over a
 * plain-http LAN address the browser hides the camera API entirely, so that
 * case gets its own message instead of a generic failure.
 */
export function WebcamCapture({
  title = "Take Photo",
  onCapture,
  onClose,
}: {
  title?: string;
  onCapture: (f: File) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  // `requestedId` drives the stream (only changes when the user picks a
  // camera); `deviceId` is just what the picker shows — filling it in from
  // the default stream must not restart that stream.
  const [requestedId, setRequestedId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  // Only ever mounted from a click, so `navigator` always exists here.
  const unsupported = !navigator.mediaDevices?.getUserMedia;
  const [error, setError] = useState(
    unsupported ? "Camera access needs a secure connection (https or localhost). Use the file picker instead." : ""
  );
  const [ready, setReady] = useState(false);
  const [shot, setShot] = useState<{ url: string; blob: Blob } | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  function switchCamera(id: string) {
    setDeviceId(id);
    setRequestedId(id);
    setReady(false);
    setError("");
  }

  // (Re)opens the stream whenever the chosen camera changes, and always
  // releases it on unmount so the webcam light goes off with the dialog.
  useEffect(() => {
    if (unsupported) return;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        video: requestedId ? { deviceId: { exact: requestedId } } : { width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      })
      .then(async (stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        stopStream();
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        // Device labels are only populated after permission is granted,
        // so the camera list is read here rather than up front.
        const all = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const cams = all.filter((d) => d.kind === "videoinput");
        setDevices(cams);
        const active = stream.getVideoTracks()[0]?.getSettings().deviceId;
        if (active) setDeviceId(active);
        setReady(true);
      })
      .catch((e: DOMException) => {
        if (cancelled) return;
        if (e.name === "NotAllowedError") setError("Camera permission was denied. Allow camera access for this site in the browser's address bar, then try again.");
        else if (e.name === "NotFoundError" || e.name === "OverconstrainedError") setError("No webcam was found on this computer.");
        else if (e.name === "NotReadableError") setError("The webcam is in use by another application. Close it and try again.");
        else setError("Could not start the webcam.");
      });
    return () => { cancelled = true; };
  }, [requestedId, stopStream, unsupported]);

  useEffect(() => () => {
    stopStream();
  }, [stopStream]);

  useEffect(() => () => {
    if (shot) URL.revokeObjectURL(shot.url);
  }, [shot]);

  function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) setShot({ url: URL.createObjectURL(blob), blob });
    }, "image/jpeg", 0.9);
  }

  function acceptPhoto() {
    if (!shot) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    onCapture(new File([shot.blob], `webcam-${stamp}.jpg`, { type: "image/jpeg" }));
    stopStream();
    onClose();
  }

  function close() {
    stopStream();
    onClose();
  }

  return createPortal(
    <div
      className="modal-bg open pay-confirm-bg"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      // Portalled, but React still bubbles events up the component tree —
      // without stopPropagation, Enter here reaches the host modal/page's
      // Enter-to-submit handler and fires ITS primary button (Register,
      // Create Loan, …) behind this dialog.
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") close(); }}
    >
      <div className="modal wide" role="dialog" aria-modal="true">
        <div className="hd"><h3>{title}</h3><button className="x" onClick={close}>×</button></div>
        <div className="bd bd-scroll">
          {error ? (
            <div className="notice">{error}</div>
          ) : (
            <>
              {devices.length > 1 && !shot && (
                <div style={{ marginBottom: 10 }}>
                  <label className="f">Camera</label>
                  <select className="inp" value={deviceId} onChange={(e) => switchCamera(e.target.value)}>
                    {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
                  </select>
                </div>
              )}
              <div className="cam-stage">
                <video ref={videoRef} playsInline muted style={{ display: shot ? "none" : "block" }} />
                {shot && <img src={shot.url} alt="Captured" />}
                {!ready && !shot && <div className="cam-wait">Starting camera…</div>}
              </div>
            </>
          )}
        </div>
        <div className="ft">
          <button className="btn ghost" onClick={close}>Cancel</button>
          {!error && (shot ? (
            <>
              <button className="btn ghost" onClick={() => setShot(null)}>Retake</button>
              <button className="btn" onClick={acceptPhoto}>Use Photo</button>
            </>
          ) : (
            <button className="btn" onClick={capture} disabled={!ready}><Icon name="camera" /> Capture</button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
