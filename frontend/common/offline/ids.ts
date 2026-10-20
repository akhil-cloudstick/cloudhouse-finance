/* UUIDv7: 48 bits of millisecond time, then random bits. It begins with the time, so ids sort in the order
 * they were made, and two PCs never need to ask the server for one. */

let lastMs = 0;
let seq = 0;

export function uuid7(): string {
  let ms = Date.now();
  // two ids in the same millisecond still sort in the order they were made
  if (ms <= lastMs) {
    ms = lastMs;
    seq++;
  } else {
    lastMs = ms;
    seq = 0;
  }
  const rnd = new Uint8Array(10);
  crypto.getRandomValues(rnd);
  const hex = (n: number, width: number) => n.toString(16).padStart(width, "0");
  const timeHex = hex(ms, 12);
  const seqHex = hex(seq & 0xfff, 3);
  const variant = hex(0x8 | (rnd[0] & 0x3), 1);
  const tail = Array.from(rnd.slice(1), (b) => hex(b, 2)).join("");
  return `${timeHex.slice(0, 8)}-${timeHex.slice(8, 12)}-7${seqHex}-${variant}${tail.slice(0, 3)}-${tail.slice(3, 15)}`;
}

export function refPath(table: "loans" | "customers", uuid: string): string {
  return `/${table}/uuid:${uuid}`;
}
