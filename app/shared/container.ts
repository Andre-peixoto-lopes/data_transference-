import { bytesEqual, concatBytes, toArrayBufferBytes } from "./bytes.js";

/**
 * The container wraps the file that travels inside the fountain payload: it
 * preserves the filename and media type, gzips the bytes only when that shrinks
 * them, and carries the SHA-256 of the original so the receiver can verify a
 * bit-exact reconstruction before offering anything.
 *
 * Layout (big-endian):
 *   0  u8    flags (bit0 = gzip)
 *   1  u16   filename length
 *   3  u16   mediaType length
 *   5  u32   original payload length
 *   9  [32]  SHA-256 of the original payload
 *   41 ...   filename | mediaType | body (gzipped or raw)
 */
const CONTAINER_FLAG_GZIP = 0x01;
const CONTAINER_HEADER_LENGTH = 41;

export interface FileContainer {
  readonly filename: string;
  readonly mediaType: string;
  readonly payload: Uint8Array;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBufferBytes(data)));
}

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([toArrayBufferBytes(data)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([toArrayBufferBytes(data)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Serialises a file (+ metadata + hash) into the bytes handed to the fountain. */
export async function encodeContainer(file: FileContainer): Promise<Uint8Array> {
  const hash = await sha256(file.payload);
  const compressed = await gzip(file.payload);
  const useGzip = compressed.length < file.payload.length;
  const body = useGzip ? compressed : file.payload;

  const filenameBytes = textEncoder.encode(file.filename);
  const mediaTypeBytes = textEncoder.encode(file.mediaType);

  const header = new Uint8Array(CONTAINER_HEADER_LENGTH);
  const view = new DataView(header.buffer);
  header[0] = useGzip ? CONTAINER_FLAG_GZIP : 0;
  view.setUint16(1, filenameBytes.length);
  view.setUint16(3, mediaTypeBytes.length);
  view.setUint32(5, file.payload.length);
  header.set(hash, 9);

  return concatBytes([header, filenameBytes, mediaTypeBytes, body]);
}

/** Reverses {@link encodeContainer}, verifying the SHA-256 before returning. */
export async function decodeContainer(bytes: Uint8Array): Promise<FileContainer> {
  if (bytes.length < CONTAINER_HEADER_LENGTH) {
    throw new Error("container shorter than header");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = bytes[0];
  const filenameLength = view.getUint16(1);
  const mediaTypeLength = view.getUint16(3);
  const originalLength = view.getUint32(5);
  const expectedHash = bytes.subarray(9, 41);

  let offset = CONTAINER_HEADER_LENGTH;
  const filename = textDecoder.decode(bytes.subarray(offset, offset + filenameLength));
  offset += filenameLength;
  const mediaType = textDecoder.decode(bytes.subarray(offset, offset + mediaTypeLength));
  offset += mediaTypeLength;
  const body = bytes.subarray(offset);

  const payload = (flags & CONTAINER_FLAG_GZIP) === CONTAINER_FLAG_GZIP
    ? await gunzip(body)
    : body.slice();

  if (payload.length !== originalLength) {
    throw new Error("container length mismatch after decode");
  }
  if (!bytesEqual(await sha256(payload), expectedHash)) {
    throw new Error("SHA-256 verification failed");
  }
  return { filename, mediaType, payload };
}
