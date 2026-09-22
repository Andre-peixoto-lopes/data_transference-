import { describe, expect, it } from "vitest";
import { bytesEqual } from "../app/shared/bytes.js";
import type { FileContainer } from "../app/shared/container.js";
import { createPrng } from "../app/shared/prng.js";
import { QrCodec } from "../app/shared/patterns/qr-codec.js";
import { Receiver, Transmitter } from "../app/shared/session.js";

describe("E2E — pipeline QR (arquivo -> QR renderizado -> jsQR -> arquivo)", () => {
  it("reconstrói via QR real mesmo com 15% de frames perdidos", async () => {
    const codec = new QrCodec({ bytesPerFrame: 96 });
    const payload = new Uint8Array(2500);
    const source = createPrng(0x51515151);
    for (let i = 0; i < payload.length; i++) payload[i] = Math.floor(source() * 256);
    const file: FileContainer = { filename: "doc.bin", mediaType: "application/octet-stream", payload };

    const transmitter = await Transmitter.forFile(codec, file);
    const receiver = new Receiver(codec);
    const loss = createPrng(0xd0d0d0d0);

    for (let seq = 0; seq < transmitter.k * 4 && !receiver.isComplete; seq++) {
      const image = transmitter.render(seq);
      if (loss() < 0.15) continue; // simulate a missed frame
      receiver.offer(image);
    }

    expect(receiver.isComplete).toBe(true);
    expect(bytesEqual((await receiver.result()).payload, payload)).toBe(true);
  }, 30000);
});
