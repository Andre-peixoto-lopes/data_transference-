import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { decodeContainer, encodeContainer } from "../shared/container.js";
import { examples } from "./examples.js";

afterEach(() => vi.unstubAllGlobals());

it("preloaded examples produce files that survive the real container pipeline", async () => {
  expect(examples.map((example) => example.title)).toEqual(["Artigo_Modelo TCC_Anchieta.docx", "UniAnchieta.png", "Vai Corinthians!.jpg"]);
  vi.stubGlobal("fetch", async (url: string) => {
    const bytes = await readFile(resolve("public", `.${decodeURIComponent(url)}`));
    return new Response(new Uint8Array(bytes));
  });
  for (const example of examples) {
    const file = await example.load();
    expect(file.payload.length).toBeGreaterThan(0);
    const restored = await decodeContainer(await encodeContainer(file));
    expect(restored).toEqual(file);
    if (example.downloadUrl) {
      expect(file.filename).toBe(example.title);
      expect(decodeURIComponent(example.downloadUrl)).toBe(`/examples/${file.filename}`);
    }
  }
});

it("reports missing example files instead of transmitting an HTTP error as the file", async () => {
  vi.stubGlobal("fetch", async () => new Response("Not found", { status: 404 }));
  await expect(examples.find((example) => example.downloadUrl)!.load()).rejects.toThrow("Não foi possível carregar");
});
