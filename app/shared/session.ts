import { decodeContainer, encodeContainer, type FileContainer } from "./container.js";
import { LtDecoder, LtEncoder, splitIntoBlocks, type FountainConfig } from "./fountain.js";
import type { PatternCodec, PatternImage } from "./pattern-codec.js";
import {
  FRAME_HEADER_LENGTH,
  type FrameHeader,
  packFrame,
  parseHeader,
  PROTOCOL_VERSION,
  streamIdentity,
} from "./protocol.js";

/**
 * Turns a file into an endless stream of optical patterns. `render(seq)` is
 * deterministic and stateless per call, so a page can drive it at any frame rate.
 */
export class Transmitter {
  readonly k: number;
  private readonly encoder: LtEncoder;
  private readonly blockLen: number;
  private readonly totalLen: number;
  private readonly sessionId: number;

  constructor(
    private readonly codec: PatternCodec,
    containerBytes: Uint8Array,
  ) {
    this.blockLen = codec.bytesPerFrame() - FRAME_HEADER_LENGTH;
    if (this.blockLen <= 0) throw new Error("codec capacity too small for a frame header");
    this.totalLen = containerBytes.length;
    this.k = Math.max(1, Math.ceil(containerBytes.length / this.blockLen));
    this.sessionId = Math.floor(Math.random() * 0x10000);
    const config: FountainConfig = { k: this.k, blockLen: this.blockLen, totalLen: this.totalLen };
    this.encoder = new LtEncoder(splitIntoBlocks(containerBytes, this.blockLen), config);
  }

  static async forFile(codec: PatternCodec, file: FileContainer): Promise<Transmitter> {
    return new Transmitter(codec, await encodeContainer(file));
  }

  render(seq: number): PatternImage {
    const header: FrameHeader = {
      version: PROTOCOL_VERSION,
      flags: 0,
      sessionId: this.sessionId,
      seq,
      k: this.k,
      blockLen: this.blockLen,
      totalLen: this.totalLen,
      patternId: this.codec.id,
    };
    return this.codec.encode(packFrame(header, this.encoder.encodeSymbol(seq)));
  }
}

export interface ReceiverProgress {
  readonly locked: boolean;
  readonly progress: number;
  readonly framesDecoded: number;
  readonly k: number;
}

/**
 * Collects captured images, locks onto the first Farol stream it recognises, and
 * peels the file out. A new `sessionId` resets it, so the receiver recovers when
 * the sender restarts.
 */
export class Receiver {
  private decoder: LtDecoder | null = null;
  private identity: string | null = null;
  private k = 0;
  private framesDecoded = 0;

  constructor(private readonly codec: PatternCodec) {}

  /** Offers one captured image; returns true once the payload is complete. */
  offer(image: PatternImage): boolean {
    const decoded = this.codec.decode(image);
    if (decoded.kind !== "symbol") return this.isComplete;

    let header: FrameHeader;
    try {
      header = parseHeader(decoded.bytes);
    } catch {
      return this.isComplete; // not a Farol frame
    }

    const symbol = decoded.bytes.subarray(FRAME_HEADER_LENGTH, FRAME_HEADER_LENGTH + header.blockLen);
    if (symbol.length !== header.blockLen) return this.isComplete;

    this.lockOnto(header);
    this.framesDecoded++;
    this.decoder!.addSymbol(header.seq, symbol);
    return this.isComplete;
  }

  private lockOnto(header: FrameHeader): void {
    const identity = streamIdentity(header);
    if (identity === this.identity) return;
    this.identity = identity;
    this.k = header.k;
    this.framesDecoded = 0;
    this.decoder = new LtDecoder({ k: header.k, blockLen: header.blockLen, totalLen: header.totalLen });
  }

  get isComplete(): boolean {
    return this.decoder?.isComplete ?? false;
  }

  progress(): ReceiverProgress {
    return {
      locked: this.decoder !== null,
      progress: this.decoder?.progress ?? 0,
      framesDecoded: this.framesDecoded,
      k: this.k,
    };
  }

  async result(): Promise<FileContainer> {
    if (!this.decoder?.isComplete) throw new Error("decode incomplete");
    return decodeContainer(this.decoder.getPayload());
  }
}
