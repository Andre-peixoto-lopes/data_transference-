import type { FileContainer } from "../shared/container.js";

export interface Example {
  id: string;
  title: string;
  description: string;
  downloadUrl?: string;
  load: () => Promise<FileContainer>;
}

function fileExample(id: string, filename: string, description: string, mediaType: string): Example {
  const downloadUrl = `/examples/${encodeURIComponent(filename)}`;
  return {
    id, title: filename, description, downloadUrl,
    load: async () => {
      const response = await fetch(downloadUrl);
      if (!response.ok) throw new Error(`Não foi possível carregar ${filename}. Tente novamente.`);
      return { filename, mediaType, payload: new Uint8Array(await response.arrayBuffer()) };
    },
  };
}

export const examples: readonly Example[] = [
  fileExample("artigo-modelo-tcc", "Artigo_Modelo TCC_Anchieta.docx", "Documento Word · Modelo de artigo para o TCC da Anchieta.", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
  fileExample("unianchieta", "UniAnchieta.png", "Imagem PNG · UniAnchieta — 85 anos.", "image/png"),
  fileExample("vai-corinthians", "Vai Corinthians!.jpg", "Imagem JPG · Vai Corinthians!", "image/jpeg"),
];

export async function selectedExample(): Promise<FileContainer | undefined> {
  const id = new URLSearchParams(location.search).get("example");
  return examples.find((example) => example.id === id)?.load();
}
