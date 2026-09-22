import { describe, expect, it } from "vitest";
import { bytesEqual } from "./bytes.js";
import { GridCodec } from "./patterns/grid-codec.js";
import { Receiver, Transmitter } from "./session.js";

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
});
