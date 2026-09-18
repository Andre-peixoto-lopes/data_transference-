import { describe, expect, it } from "vitest";
import { bytesEqual } from "./bytes.js";
import { decodeContainer, encodeContainer } from "./container.js";

describe("file container", () => {
  it("round-trips a file and preserves its metadata", async () => {
    const payload = new Uint8Array(2000);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 7) & 0xff;

    const encoded = await encodeContainer({
      filename: "nota.txt",
      mediaType: "text/plain",
      payload,
    });
    const decoded = await decodeContainer(encoded);

    expect(decoded.filename).toBe("nota.txt");
    expect(decoded.mediaType).toBe("text/plain");
    expect(bytesEqual(decoded.payload, payload)).toBe(true);
  });

  it("compresses a highly compressible payload", async () => {
    const zeros = new Uint8Array(4096);
    const encoded = await encodeContainer({
      filename: "z.bin",
      mediaType: "application/octet-stream",
      payload: zeros,
    });
    expect(encoded.length).toBeLessThan(zeros.length);
    expect(bytesEqual((await decodeContainer(encoded)).payload, zeros)).toBe(true);
  });

  it("detects corruption via SHA-256", async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const encoded = await encodeContainer({ filename: "a", mediaType: "b", payload });
    encoded[encoded.length - 1] ^= 0xff;
    await expect(decodeContainer(encoded)).rejects.toThrow();
  });
});
