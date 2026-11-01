import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { bytesEqual } from "../app/shared/bytes.js";
import type { PatternImage } from "../app/shared/pattern-codec.js";
import { QrCodec } from "../app/shared/patterns/qr-codec.js";
import { createPrng } from "../app/shared/prng.js";
import { parseHeader } from "../app/shared/protocol.js";
import { Receiver, Transmitter } from "../app/shared/session.js";

async function readAll(image: PatternImage, maxSymbols: number): Promise<Uint8Array[]> {
  // zxing-wasm duck-types {data, width, height}; Node has no ImageData.
  const pixels = { data: image.rgba, width: image.width, height: image.height } as unknown as ImageData;
  const results = await readBarcodes(pixels, { formats: ["QRCode"], tryHarder: false, tryInvert: false, maxNumberOfSymbols: maxSymbols });
  return results.filter((r) => r.isValid).map((r) => r.bytes);
}

describe("E2E — vários códigos por quadro com o decoder de produção (zxing-wasm)", () => {
  beforeAll(async () => {
    const wasmPath = createRequire(import.meta.url).resolve("zxing-wasm/reader/zxing_reader.wasm");
    await prepareZXingModule({ overrides: { wasmBinary: new Uint8Array(readFileSync(wasmPath)).buffer }, fireImmediately: true });
  });

  it("lê os 4 QRs de uma grade 2x2 e reconstrói o arquivo com ~K/4 quadros", async () => {
    const payload = new Uint8Array(6000);
    const source = createPrng(0x2b2b2b2b);
    for (let i = 0; i < payload.length; i++) payload[i] = Math.floor(source() * 256);
    const codec = new QrCodec({ version: 10, scale: 3 });
    const transmitter = await Transmitter.forFile(codec, { filename: "grade.bin", mediaType: "application/octet-stream", payload }, { codes: 4 });

    const first = await readAll(transmitter.renderFrame(0), 4);
    expect(first.map((bytes) => parseHeader(bytes).seq).sort()).toEqual([0, 1, 2, 3]);

    const receiver = new Receiver();
    let displayed = 0;
    let codesRead = 0;
    while (!receiver.isComplete && displayed < 100) {
      const read = await readAll(transmitter.renderFrame(displayed), 4);
      codesRead += read.length;
      for (const bytes of read) receiver.offerBytes(bytes);
      displayed++;
    }
    console.log(`2x2 | K=${transmitter.k} | quadros=${displayed} | códigos lidos=${codesRead} | overhead=${(codesRead / transmitter.k).toFixed(2)}x`);
    expect(bytesEqual((await receiver.result()).payload, payload)).toBe(true);
    expect(displayed).toBeLessThanOrEqual(Math.ceil((transmitter.k * 1.15) / 4));
  }, 30000);
});
