import { describe, expect, it } from "vitest";
import { bytesEqual } from "../app/shared/bytes.js";
import { decodeContainer, encodeContainer, type FileContainer } from "../app/shared/container.js";
import { LtDecoder, LtEncoder, splitIntoBlocks, type FountainConfig } from "../app/shared/fountain.js";
import { packFrame, parseFrame, PROTOCOL_VERSION, type FrameHeader } from "../app/shared/protocol.js";
import { createPrng } from "../app/shared/prng.js";

const BLOCK_LEN = 256;

function syntheticFile(byteCount: number): FileContainer {
  // Incompressible pseudo-random payload so gzip does not mask the real block count.
  const payload = new Uint8Array(byteCount);
  const prng = createPrng(0x1234abcd);
  for (let i = 0; i < byteCount; i++) payload[i] = Math.floor(prng() * 256);
  return { filename: "relatorio.pdf", mediaType: "application/pdf", payload };
}

interface ChannelOptions {
  readonly dropRate: number;
  readonly seed: number;
}

/**
 * Stand-in for the screen->camera link: frames are shown in order, some are lost
 * (erasure), and survivors arrive in arbitrary order. When a real PatternCodec
 * lands, encode/decode-through-image slots in exactly here.
 */
function simulateOpticalChannel(frames: Uint8Array[], options: ChannelOptions): Uint8Array[] {
  const prng = createPrng(options.seed);
  const survivors = frames.filter(() => prng() >= options.dropRate);
  for (let i = survivors.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    const swap = survivors[i];
    survivors[i] = survivors[j];
    survivors[j] = swap;
  }
  return survivors;
}

interface TransferResult {
  readonly k: number;
  readonly displayed: number;
  readonly delivered: number;
  readonly framesUsed: number;
  readonly restored: FileContainer;
}

async function runTransfer(file: FileContainer, dropRate: number, seed: number): Promise<TransferResult> {
  // --- sender: container -> fountain -> framed stream ---
  const containerBytes = await encodeContainer(file);
  const k = Math.max(1, Math.ceil(containerBytes.length / BLOCK_LEN));
  const config: FountainConfig = { k, blockLen: BLOCK_LEN, totalLen: containerBytes.length };
  const encoder = new LtEncoder(splitIntoBlocks(containerBytes, BLOCK_LEN), config);

  const sessionId = 0x0042;
  const framesToDisplay = Math.ceil((k * 3) / Math.max(0.1, 1 - dropRate)) + 50;
  const displayed: Uint8Array[] = [];
  for (let seq = 0; seq < framesToDisplay; seq++) {
    const header: FrameHeader = {
      version: PROTOCOL_VERSION,
      flags: 0,
      sessionId,
      seq,
      k,
      blockLen: BLOCK_LEN,
      totalLen: containerBytes.length,
      patternId: 0,
    };
    displayed.push(packFrame(header, encoder.encodeSymbol(seq)));
  }

  // --- channel: loss + reordering ---
  const received = simulateOpticalChannel(displayed, { dropRate, seed });

  // --- receiver: frames -> fountain peel -> container verify ---
  const decoder = new LtDecoder(config);
  let framesUsed = 0;
  for (const frameBytes of received) {
    const { header, symbol } = parseFrame(frameBytes);
    framesUsed++;
    if (decoder.addSymbol(header.seq, symbol)) break;
  }
  if (!decoder.isComplete) throw new Error(`decode incomplete at dropRate ${dropRate}`);

  return { k, displayed: displayed.length, delivered: received.length, framesUsed, restored: await decodeContainer(decoder.getPayload()) };
}

describe("E2E — pipeline de transporte (arquivo -> frames -> canal com perdas -> arquivo)", () => {
  const file = syntheticFile(16 * 1024);

  for (const dropRate of [0, 0.2, 0.4]) {
    it(`reconstrói o arquivo com ${Math.round(dropRate * 100)}% de perda de frames`, async () => {
      const result = await runTransfer(file, dropRate, 0xc0ffee + Math.round(dropRate * 100));

      expect(result.restored.filename).toBe(file.filename);
      expect(result.restored.mediaType).toBe(file.mediaType);
      expect(bytesEqual(result.restored.payload, file.payload)).toBe(true);

      const overhead = (result.framesUsed / result.k).toFixed(2);
      console.log(
        `perda ${String(Math.round(dropRate * 100)).padStart(2)}% | K=${result.k} | ` +
          `exibidos=${result.displayed} entregues=${result.delivered} usados=${result.framesUsed} | ` +
          `overhead=${overhead}x | SHA-256 OK`,
      );
    });
  }
});
