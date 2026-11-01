// Downloads the reports collected by the deployed site (api/diagnostics.ts) into analysis/reports/.
// Usage: npm run reports:pull  (FAROL_URL and FAROL_KEY in .env.local or the environment)
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const base = process.env.FAROL_URL;
const key = process.env.FAROL_KEY;
if (!base || !key) {
  console.error("defina FAROL_URL (ex.: https://farol.vercel.app) e FAROL_KEY em .env.local");
  process.exit(1);
}

const folder = join(import.meta.dirname, "..", "analysis", "reports");
const REPORT_NAME = /^farol-report-[\w-]+\.json$/; // never trust a name as a path
const headers = { "x-farol-key": key };

const index = await fetch(new URL("/api/diagnostics", base), { headers });
if (!index.ok) {
  console.error(`falhou: HTTP ${index.status}${index.status === 401 ? " (FAROL_KEY confere com DIAGNOSTICS_KEY?)" : ""}`);
  process.exit(1);
}
const { names } = await index.json();
const missing = names.filter((name) => REPORT_NAME.test(name) && !existsSync(join(folder, name)));

await mkdir(folder, { recursive: true });
for (const name of missing) {
  const response = await fetch(new URL(`/api/diagnostics?name=${encodeURIComponent(name)}`, base), { headers });
  if (!response.ok) {
    console.error(`  ${name}: HTTP ${response.status}`);
    continue;
  }
  await writeFile(join(folder, name), await response.text());
  console.log(`  + ${name}`);
}
console.log(`${missing.length} relatorio(s) novo(s); ${names.length} no servidor.`);
