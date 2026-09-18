/** Byte-level helpers shared by the wire protocol, container and codecs. */

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** XOR `source` into `target` in place; both must have the same length. */
export function xorInto(target: Uint8Array, source: Uint8Array): void {
  if (target.length !== source.length) {
    throw new Error(`xorInto length mismatch: ${target.length} vs ${source.length}`);
  }
  for (let i = 0; i < target.length; i++) target[i] ^= source[i];
}

export function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Returns ArrayBuffer-backed bytes. Web APIs (crypto.subtle, Blob, CompressionStream)
 * reject the SharedArrayBuffer-backed views that TypeScript 5.7's generic
 * `Uint8Array<ArrayBufferLike>` allows, so we copy into a fresh buffer at those
 * boundaries.
 */
export function toArrayBufferBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy;
}
