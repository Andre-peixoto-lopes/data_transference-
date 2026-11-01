import { mkdir, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { relative, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import {
  DIAGNOSTICS_PATH,
  type DiagnosticsMessage,
  MAX_DIAGNOSTICS_BYTES,
  parseDiagnosticsMessage,
} from "./app/shared/diagnostics.js";
import type { SenderAnnouncement } from "./app/shared/telemetry.js";

const root = import.meta.dirname;
const MAX_SAVED_REPORTS = 500; // per dev-server run: bounds disk use if a public tunnel URL leaks
const MAX_TRACKED_SENDERS = 64;

function readBody(request: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

/**
 * Dev-only collector for the diagnostics rig: receiver reports land in
 * analysis/reports/ (merged with the sender's announced settings by sessionId),
 * sender settings and display stalls are logged in this terminal.
 */
function diagnosticsEndpoint(): Plugin {
  const reportsDir = resolve(root, "analysis/reports");
  const senders = new Map<number, SenderAnnouncement>();
  let saved = 0;

  return {
    name: "farol-diagnostics",
    apply: "serve",
    configureServer(server) {
      const log = (line: string): void => server.config.logger.info(`[farol] ${line}`, { timestamp: true });

      server.middlewares.use(DIAGNOSTICS_PATH, (request, response) => {
        const reply = (status: number): void => {
          response.statusCode = status;
          response.end();
        };
        if (request.method !== "POST") return reply(405);
        if (!request.headers["content-type"]?.startsWith("application/json")) return reply(415);

        void (async () => {
          let body: string;
          try {
            body = await readBody(request, MAX_DIAGNOSTICS_BYTES);
          } catch {
            return reply(413);
          }
          let message: DiagnosticsMessage | null;
          try {
            message = parseDiagnosticsMessage(JSON.parse(body));
          } catch {
            message = null;
          }
          if (!message) return reply(400);

          const tag = (sessionId: number): string => `0x${sessionId.toString(16).padStart(4, "0")}`;
          if (message.kind === "sender-announce") {
            const a = message.announcement;
            if (senders.size >= MAX_TRACKED_SENDERS) senders.delete(senders.keys().next().value!);
            senders.set(a.sessionId, { ...a, stalls: 0 });
            log(
              `emissor ${tag(a.sessionId)} • ${a.fileName} (${(a.fileBytes / 1024).toFixed(0)} KB) • K=${a.k} • ` +
                `QR v${a.qrVersion}-${a.ecc} × ${a.codes} • ${a.displayFps.toFixed(1)} fps (${a.refreshHz.toFixed(0)} Hz)`,
            );
            return reply(204);
          }
          if (message.kind === "sender-stall") {
            const sender = senders.get(message.sessionId);
            if (sender) senders.set(message.sessionId, { ...sender, stalls: (sender.stalls ?? 0) + 1 });
            log(`emissor ${tag(message.sessionId)} travou ${message.seconds.toFixed(1)} s (aba oculta/minimizada?)`);
            return reply(204);
          }

          if (saved >= MAX_SAVED_REPORTS) return reply(429);
          const report = message.report;
          const sender = senders.get(report.sessionId);
          const path = resolve(reportsDir, `farol-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
          try {
            await mkdir(reportsDir, { recursive: true });
            await writeFile(path, JSON.stringify(sender ? { ...report, sender } : report, null, 2) + "\n", { flag: "wx" });
          } catch {
            return reply(500);
          }
          saved++;
          log(
            `relatório ${relative(root, path)} • ${report.goodputKBs.toFixed(1)} KB/s • ` +
              `catch ${(report.catchRate * 100).toFixed(0)}% • overhead ${report.overhead.toFixed(2)}x` +
              (sender ? "" : " • (sem anúncio do emissor)"),
          );
          return reply(204);
        })();
      });
    },
  };
}

export default defineConfig({
  plugins: [diagnosticsEndpoint()],
  server: {
    host: true, // listen on all interfaces (LAN + VS Code port forwarding)
    port: 5173,
    strictPort: true,
    allowedHosts: true, // accept VS Code devtunnel / ngrok hosts (dev only)
    watch: { ignored: ["**/analysis/.venv/**"] }, // the Python harness venv ships HTML files
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        send: resolve(root, "send/index.html"),
        receive: resolve(root, "receive/index.html"),
        demo: resolve(root, "demo/index.html"),
      },
    },
  },
});
