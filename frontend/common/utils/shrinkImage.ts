/* Ported from legacy/app.js's `shrinkImage(file, cb)` (legacy/app.js:31-45) —
 * reads an image file, downscales it to <=900px on its longest side, and
 * re-encodes as a JPEG data-URL (keeps localStorage small). Converted to a
 * Promise so React callers can `await` it instead of passing a callback. */
export function shrinkImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, 900 / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * sc);
        cv.height = Math.round(img.height * sc);
        const ctx = cv.getContext("2d");
        if (!ctx) { reject(new Error("canvas unavailable")); return; }
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    rd.onerror = reject;
    rd.readAsDataURL(file);
  });
}
