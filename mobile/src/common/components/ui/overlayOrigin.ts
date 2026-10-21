// Point the next top overlay grows from; set before opening, read and cleared by TopModal.
export type OverlayOrigin = { x: number; y: number };

let origin: OverlayOrigin | null = null;

export function setOverlayOrigin(o: OverlayOrigin | null) {
  origin = o;
}

export function takeOverlayOrigin(): OverlayOrigin | null {
  const o = origin;
  origin = null;
  return o;
}
