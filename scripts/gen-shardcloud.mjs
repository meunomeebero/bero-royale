// Generate deploy/.shardcloud from the committed deploy.shardcloud template,
// injecting the secret DATABASE_URL from the gitignored root .env. Keeps the
// connection string out of git (deploy/ and **/.shardcloud are gitignored).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");
const templatePath = resolve(root, "deploy.shardcloud");
const outPath = resolve(root, "deploy", ".shardcloud");

if (!existsSync(envPath)) {
  console.error("[gen-shardcloud] missing .env — cannot inject DATABASE_URL");
  process.exit(1);
}
const env = readFileSync(envPath, "utf8");
const m = env.match(/^DATABASE_URL=(.*)$/m);
if (!m) {
  console.error("[gen-shardcloud] DATABASE_URL not found in .env");
  process.exit(1);
}
const dbUrl = m[1].trim().replace(/^['"]|['"]$/g, "");
const template = readFileSync(templatePath, "utf8");
const out = template.replace("__DATABASE_URL__", dbUrl);
writeFileSync(outPath, out);

// Ship a MINIMAL package.json: the tsup bundle (server.js) inlines every
// dependency, so the container needs no install step. package.json only marks
// the app as a Node ESM app; the .shardcloud CUSTOM_COMMAND runs `node server.js`.
const pkgPath = resolve(root, "deploy", "package.json");
writeFileSync(
  pkgPath,
  JSON.stringify(
    {
      name: "bero-royale",
      version: "1.0.0",
      private: true,
      type: "module",
      main: "server.js",
    },
    null,
    2,
  ) + "\n",
);
console.log("[gen-shardcloud] wrote", pkgPath, "(minimal, self-contained bundle)");

// Guard: Shard Cloud caps CUSTOM_COMMAND at 250 chars.
const cmdLine = out.split("\n").find((l) => l.startsWith("CUSTOM_COMMAND=")) ?? "";
const cmdVal = cmdLine.slice("CUSTOM_COMMAND=".length);
console.log(
  `[gen-shardcloud] wrote ${outPath} (CUSTOM_COMMAND ${cmdVal.length} chars)`,
);
if (cmdVal.length > 250) {
  console.error("[gen-shardcloud] CUSTOM_COMMAND exceeds the 250-char limit!");
  process.exit(1);
}
