import { Capacitor, registerPlugin } from "@capacitor/core";

interface FarolFilesPlugin {
  save(options: { name: string; data: string }): Promise<{ location: string }>;
}

// The Android app's WebView ignores <a download>: android/.../FarolFilesPlugin.java writes the file instead.
const FarolFiles = registerPlugin<FarolFilesPlugin>("FarolFiles");

function base64Of(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Saves `blob` as `name`. In a browser it is a regular download (resolves null: the browser
 * shows it); in the Android app it goes to Downloads (resolves with where it was saved).
 */
export async function saveFile(blob: Blob, name: string): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    const { location } = await FarolFiles.save({ name, data: await base64Of(blob) });
    return location;
  }
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000); // Safari may read the blob after click() returns
  return null;
}
