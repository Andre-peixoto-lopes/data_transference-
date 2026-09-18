import { concatBytes } from "./bytes.js";

/**
 * Self-describing frame header. A receiver can lock onto a stream mid-flight and
 * a new `sessionId` resets it — there is no handshake on a one-way optical link.
 *
 * Layout (big-endian), 24 bytes:
 *   0  u8   magic 0xD1
 *   1  u8   magic 0xC3
 *   2  u8   version
 *   3  u8   flags
 *   4  u16  sessionId
 *   6  u32  seq
 *   10 u16  k          (source block count)
 *   12 u16  blockLen
 *   14 u32  totalLen   (original payload length)
 *   18 u8   patternId  (which PatternCodec produced this stream)
 *   19 u8   reserved x5
 */
export const FRAME_MAGIC_0 = 0xd1;
export const FRAME_MAGIC_1 = 0xc3;
export const PROTOCOL_VERSION = 1;
export const FRAME_HEADER_LENGTH = 24;

export interface FrameHeader {
  readonly version: number;
  readonly flags: number;
  readonly sessionId: number;
  readonly seq: number;
  readonly k: number;
  readonly blockLen: number;
  readonly totalLen: number;
  readonly patternId: number;
}

export function packHeader(header: FrameHeader): Uint8Array {
  const buffer = new Uint8Array(FRAME_HEADER_LENGTH);
  const view = new DataView(buffer.buffer);
  buffer[0] = FRAME_MAGIC_0;
  buffer[1] = FRAME_MAGIC_1;
  buffer[2] = header.version;
  buffer[3] = header.flags;
  view.setUint16(4, header.sessionId);
  view.setUint32(6, header.seq);
  view.setUint16(10, header.k);
  view.setUint16(12, header.blockLen);
  view.setUint32(14, header.totalLen);
  buffer[18] = header.patternId;
  return buffer;
}

export function parseHeader(bytes: Uint8Array): FrameHeader {
  if (bytes.length < FRAME_HEADER_LENGTH) {
    throw new Error("frame shorter than header");
  }
  if (bytes[0] !== FRAME_MAGIC_0 || bytes[1] !== FRAME_MAGIC_1) {
    throw new Error("not a Farol frame");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[2];
  if (version !== PROTOCOL_VERSION) {
    throw new Error(`unsupported protocol version ${version}`);
  }
  return {
    version,
    flags: bytes[3],
    sessionId: view.getUint16(4),
    seq: view.getUint32(6),
    k: view.getUint16(10),
    blockLen: view.getUint16(12),
    totalLen: view.getUint32(14),
    patternId: bytes[18],
  };
}

export function packFrame(header: FrameHeader, symbol: Uint8Array): Uint8Array {
  return concatBytes([packHeader(header), symbol]);
}

export interface ParsedFrame {
  readonly header: FrameHeader;
  readonly symbol: Uint8Array;
}

export function parseFrame(bytes: Uint8Array): ParsedFrame {
  return { header: parseHeader(bytes), symbol: bytes.subarray(FRAME_HEADER_LENGTH) };
}

/** Fields that must stay constant for frames to belong to the same stream. */
export function streamIdentity(header: FrameHeader): string {
  return [
    header.version,
    header.sessionId,
    header.k,
    header.blockLen,
    header.totalLen,
    header.patternId,
  ].join(":");
}
