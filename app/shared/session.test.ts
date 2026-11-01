import { describe, expect, it } from "vitest";
import { bytesEqual } from "./bytes.js";
import type { PatternImage } from "./pattern-codec.js";
import { GridCodec } from "./patterns/grid-codec.js";
import { QrCodec } from "./patterns/qr-codec.js";
import { parseHeader } from "./protocol.js";
import { Receiver, Transmitter } from "./session.js";

function crop(image: PatternImage, x0: number, y0: number, width: number, height: number): PatternImage {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = ((y0 + y) * image.width + x0) * 4;
    rgba.set(image.rgba.subarray(from, from + width * 4), y * width * 4);
  }
  return { width, height, rgba };
}

describe("Transmitter/Receiver session", () => {
  it("carries a file end-to-end through a codec loopback", async () => {
    const codec = new GridCodec({ cols: 32, rows: 32, cellSize: 4, margin: 8 });
    const payload = new Uint8Array(3000);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 91 + 5) & 0xff;

    const transmitter = await Transmitter.forFile(codec, {
      filename: "x.bin",
      mediaType: "application/octet-stream",
      payload,
    });
    const receiver = new Receiver(codec);

    for (let seq = 0; seq < transmitter.k * 5 && !receiver.isComplete; seq++) {
      receiver.offer(transmitter.render(seq));
    }

    expect(receiver.isComplete).toBe(true);
    expect(bytesEqual((await receiver.result()).payload, payload)).toBe(true);
  });

  it("tiles `codes` consecutive frames per displayed frame (2x2 grid of independent QRs)", async () => {
    const codec = new QrCodec({ bytesPerFrame: 96, scale: 4 });
    const payload = new Uint8Array(2000).map((_, i) => (i * 7) & 0xff);
    const transmitter = await Transmitter.forFile(codec, { filename: "g.bin", mediaType: "", payload }, { codes: 4 });
    const tile = transmitter.render(0);
    const frame = transmitter.renderFrame(3);
    expect([frame.width, frame.height]).toEqual([tile.width * 2, tile.height * 2]);

    const seqs: number[] = [];
    for (const [col, row] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const decoded = codec.decode(crop(frame, col * tile.width, row * tile.height, tile.width, tile.height));
      if (decoded.kind !== "symbol") throw new Error("tile did not decode");
      const header = parseHeader(decoded.bytes);
      expect(header.codes).toBe(4);
      seqs.push(header.seq);
    }
    expect(seqs).toEqual([12, 13, 14, 15]);
  });

  it("counts duplicates and the seq span it watched", async () => {
    const codec = new QrCodec({ bytesPerFrame: 96, scale: 4 });
    const payload = new Uint8Array(1500).map((_, i) => (i * 13) & 0xff);
    const transmitter = await Transmitter.forFile(codec, { filename: "d.bin", mediaType: "", payload });
    const receiver = new Receiver(codec);

    receiver.offer(transmitter.render(10));
    receiver.offer(transmitter.render(10));
    receiver.offer(transmitter.render(14));
    const info = receiver.progress();
    expect(info.framesDecoded).toBe(2);
    expect(info.framesDuplicate).toBe(1);
    expect(info.seqSpan).toBe(5);
    expect(info.sessionId).toBe(transmitter.sessionId);
  });
});
