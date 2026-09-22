import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = import.meta.dirname;

export default defineConfig({
  server: {
    host: true, // listen on all interfaces (LAN + VS Code port forwarding)
    port: 5173,
    strictPort: true,
    allowedHosts: true, // accept VS Code devtunnel / ngrok hosts (dev only)
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        send: resolve(root, "send/index.html"),
        receive: resolve(root, "receive/index.html"),
      },
    },
  },
});
