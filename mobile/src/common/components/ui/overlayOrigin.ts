// Where the next top overlay should grow from — the centre of the control
// that opened it (e.g. the header's search icon), in window coordinates.
// Set just before opening; read and cleared by TopModal as it opens.
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
