import { concatBytes } from "./bytes.js";

/**
 * Self-describing frame header. A receiver can lock onto a stream mid-flight and
 * a new `sessionId` resets it — there is no handshake on a one-way optical link.
 *
 * Layout (big-endian), 24 bytes:
 *   0  u8   magic 0xD1
 *   1  u8   magic 0xC3
 *   2  u8   version    (gates parsing wholesale)
 *   3  u8   flags      (low nibble: must-understand; high nibble: safe to ignore)
 *   4  u16  sessionId
 *   6  u32  seq
 *   10 u16  k          (source block count)
 *   12 u16  blockLen
 *   14 u32  totalLen   (original payload length)
 *   18 u8   patternId  (which PatternCodec produced this stream)
 *   19 u8   codes      (codes tiled per displayed frame; informational)
 *   20 u8   reserved x4
 */
export const FRAME_MAGIC_0 = 0xd1;
export const FRAME_MAGIC_1 = 0xc3;
/** v2: deterministic soliton CDF (detLn/detSqrt) + flags rule + `codes` byte. */
export const PROTOCOL_VERSION = 2;
export const FRAME_HEADER_LENGTH = 24;
const MUST_UNDERSTAND_FLAGS = 0x0f;
const KNOWN_MUST_UNDERSTAND = 0x00; // no must-understand feature defined yet

export interface FrameHeader {
  readonly version: number;
  readonly flags: number;
  readonly sessionId: number;
  readonly seq: number;
  readonly k: number;
  readonly blockLen: number;
  readonly totalLen: number;
  readonly patternId: number;
  readonly codes: number;
}

/** A Farol frame this build cannot read (newer/older version or an unknown must-understand flag). */
export class UnsupportedFrameError extends Error {
  constructor(
    readonly reason: "version" | "flags",
    readonly value: number,
  ) {
    super(reason === "version" ? `unsupported protocol version ${value}` : `unsupported must-understand flags 0x${value.toString(16)}`);
  }
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
  buffer[19] = header.codes;
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
  if (version !== PROTOCOL_VERSION) throw new UnsupportedFrameError("version", version);
  const flags = bytes[3];
  const unknownRequired = flags & MUST_UNDERSTAND_FLAGS & ~KNOWN_MUST_UNDERSTAND;
  if (unknownRequired !== 0) throw new UnsupportedFrameError("flags", unknownRequired);
  return {
    version,
    flags,
    sessionId: view.getUint16(4),
    seq: view.getUint32(6),
    k: view.getUint16(10),
    blockLen: view.getUint16(12),
    totalLen: view.getUint32(14),
    patternId: bytes[18],
    codes: Math.max(1, bytes[19]),
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
