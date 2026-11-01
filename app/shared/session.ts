import { decodeContainer, encodeContainer, type FileContainer } from "./container.js";
import { LtDecoder, LtEncoder, splitIntoBlocks, type FountainConfig } from "./fountain.js";
import { composeGrid, gridColumns } from "./layout.js";
import type { PatternCodec, PatternImage } from "./pattern-codec.js";
import {
  FRAME_HEADER_LENGTH,
  type FrameHeader,
  packFrame,
  parseHeader,
  PROTOCOL_VERSION,
  streamIdentity,
  UnsupportedFrameError,
} from "./protocol.js";

export interface TransmitterOptions {
  /** Codes tiled per displayed frame; each is an independent fountain frame (consecutive seqs). */
  readonly codes?: number;
}

/**
 * Turns a file into an endless stream of optical patterns. `render(seq)` is
 * deterministic and stateless per call, so a page can drive it at any frame rate.
 */
export class Transmitter {
  readonly k: number;
  readonly codes: number;
  readonly sessionId: number;
  readonly blockLen: number;
  readonly payloadBytes: number; // container bytes the fountain carries (after gzip)
  private readonly encoder: LtEncoder;

  constructor(
    private readonly codec: PatternCodec,
    containerBytes: Uint8Array,
    options: TransmitterOptions = {},
  ) {
    this.blockLen = codec.bytesPerFrame() - FRAME_HEADER_LENGTH;
    if (this.blockLen <= 0) throw new Error("codec capacity too small for a frame header");
    this.payloadBytes = containerBytes.length;
    this.k = Math.max(1, Math.ceil(containerBytes.length / this.blockLen));
    if (this.k > 0xffff) {
      throw new RangeError(`K=${this.k} blocks exceeds the u16 header field — use a denser QR or a smaller file`);
    }
    this.codes = options.codes ?? 1;
    this.sessionId = Math.floor(Math.random() * 0x10000);
    const config: FountainConfig = { k: this.k, blockLen: this.blockLen, totalLen: this.payloadBytes };
    this.encoder = new LtEncoder(splitIntoBlocks(containerBytes, this.blockLen), config);
  }

  static async forFile(codec: PatternCodec, file: FileContainer, options: TransmitterOptions = {}): Promise<Transmitter> {
    return new Transmitter(codec, await encodeContainer(file), options);
  }

  render(seq: number): PatternImage {
    const header: FrameHeader = {
      version: PROTOCOL_VERSION,
      flags: 0,
      sessionId: this.sessionId,
      seq,
      k: this.k,
      blockLen: this.blockLen,
      totalLen: this.payloadBytes,
      patternId: this.codec.id,
      codes: this.codes,
    };
    return this.codec.encode(packFrame(header, this.encoder.encodeSymbol(seq)));
  }

  /** Displayed frame `index`: `codes` consecutive seqs tiled in one grid. */
  renderFrame(index: number): PatternImage {
    if (this.codes === 1) return this.render(index);
    const tiles: PatternImage[] = [];
    for (let i = 0; i < this.codes; i++) tiles.push(this.render(index * this.codes + i));
    return composeGrid(tiles, gridColumns(this.codes));
  }
}

export interface ReceiverProgress {
  readonly locked: boolean;
  readonly progress: number; // rank estimate; 1 only once the payload is recovered
  readonly solvedFraction: number;
  readonly framesDecoded: number; // distinct seqs fed to the fountain
  readonly framesDuplicate: number; // re-reads of a seq already fed
  readonly framesRedundant: number; // new seqs that carried no new information
  readonly seqSpan: number; // seqs the sender emitted while we watched
  readonly k: number;
  readonly totalLen: number;
  readonly blockLen: number;
  readonly sessionId: number;
  readonly codes: number;
}

/**
 * Collects captured images, locks onto the first Farol stream it recognises, and
 * peels the file out. A new `sessionId` resets it, so the receiver recovers when
 * the sender restarts.
 */
export class Receiver {
  private decoder: LtDecoder | null = null;
  private identity: string | null = null;
  private readonly seen = new Set<number>(); // seqs already fed, so duplicate frames are free
  private k = 0;
  private totalLen = 0;
  private blockLen = 0;
  private sessionId = 0;
  private codes = 1;
  private framesDecoded = 0;
  private framesDuplicate = 0;
  private minSeq = Infinity;
  private maxSeq = -Infinity;
  private lastIncompatible: UnsupportedFrameError | null = null;

  constructor(private readonly codec?: PatternCodec) {}

  /** Offers one captured image, decoding it with the codec (used by tests and the loopback demo). */
  offer(image: PatternImage): boolean {
    if (!this.codec) throw new Error("offer(image) needs a codec; use offerBytes with an external decoder");
    const decoded = this.codec.decode(image);
    if (decoded.kind !== "symbol") return this.isComplete;
    return this.offerBytes(decoded.bytes);
  }

  /** Offers frame bytes already decoded by an external reader (e.g. zxing-wasm on the camera page). */
  offerBytes(frameBytes: Uint8Array): boolean {
    let header: FrameHeader;
    try {
      header = parseHeader(frameBytes);
    } catch (error) {
      if (error instanceof UnsupportedFrameError) this.lastIncompatible = error;
      return this.isComplete; // not a frame this build can read
    }

    const symbol = frameBytes.subarray(FRAME_HEADER_LENGTH, FRAME_HEADER_LENGTH + header.blockLen);
    if (symbol.length !== header.blockLen) return this.isComplete;

    this.lockOnto(header);
    if (this.seen.has(header.seq)) {
      this.framesDuplicate++;
      return this.isComplete;
    }
    this.seen.add(header.seq);
    this.framesDecoded++;
    this.minSeq = Math.min(this.minSeq, header.seq);
    this.maxSeq = Math.max(this.maxSeq, header.seq);
    this.decoder!.addSymbol(header.seq, symbol);
    return this.isComplete;
  }

  private lockOnto(header: FrameHeader): void {
    const identity = streamIdentity(header);
    if (identity === this.identity) return;
    this.identity = identity;
    this.k = header.k;
    this.totalLen = header.totalLen;
    this.blockLen = header.blockLen;
    this.sessionId = header.sessionId;
    this.codes = header.codes;
    this.framesDecoded = 0;
    this.framesDuplicate = 0;
    this.minSeq = Infinity;
    this.maxSeq = -Infinity;
    this.seen.clear();
    this.decoder = new LtDecoder({ k: header.k, blockLen: header.blockLen, totalLen: header.totalLen });
  }

  get isComplete(): boolean {
    return this.decoder?.isComplete ?? false;
  }

  /** The last Farol frame this build could not read (other protocol version) — for the UI. */
  get incompatible(): UnsupportedFrameError | null {
    return this.lastIncompatible;
  }

  progress(): ReceiverProgress {
    return {
      locked: this.decoder !== null,
      progress: this.decoder?.progress ?? 0,
      solvedFraction: this.decoder?.solvedFraction ?? 0,
      framesDecoded: this.framesDecoded,
      framesDuplicate: this.framesDuplicate,
      framesRedundant: this.decoder?.redundantSymbols ?? 0,
      seqSpan: this.framesDecoded > 0 ? this.maxSeq - this.minSeq + 1 : 0,
      k: this.k,
      totalLen: this.totalLen,
      blockLen: this.blockLen,
      sessionId: this.sessionId,
      codes: this.codes,
    };
  }

  async result(): Promise<FileContainer> {
    if (!this.decoder?.isComplete) throw new Error("decode incomplete");
    return decodeContainer(this.decoder.getPayload());
  }
}
