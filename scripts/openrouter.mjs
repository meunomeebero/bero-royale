#!/usr/bin/env node
/**
 * Minimal OpenRouter client for Mega Brain councils (docs/mega-brain.md §7.2).
 *
 * Lets a workflow / the main agent add NON-Claude council members (e.g. GLM 5.2)
 * by calling OpenRouter from the shell. Key is read from $OPENROUTER_API_KEY or
 * the gitignored .env — never passed on the command line.
 *
 * Usage:
 *   echo "<prompt>" | node scripts/openrouter.mjs <model> [--system "..."] [--json] [--temp 0.7]
 *   node scripts/openrouter.mjs z-ai/glm-5.2 --system "You are a UI designer." < brief.txt
 *
 * Prints the assistant message text to stdout (or the raw JSON content if --json
 * and the model returns JSON). Exits non-zero with a message on error.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  try {
    const env = readFileSync(join(__dirname, "..", ".env"), "utf8");
    const line = env.split(/\r?\n/).find((l) => l.startsWith("OPENROUTER_API_KEY="));
    if (line) return line.slice("OPENROUTER_API_KEY=".length).trim();
  } catch {
    /* no .env */
  }
  return null;
}

function parseArgs(argv) {
  const out = { model: argv[0], system: null, json: false, temp: 0.7, maxTokens: null };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--system") out.system = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--temp") out.temp = Number(argv[++i]);
    // accept both spellings: --max (this session) and --max-tokens (origin/main)
    else if (a === "--max" || a === "--max-tokens") out.maxTokens = Number(argv[++i]);
  }
  return out;
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

const args = parseArgs(process.argv.slice(2));
if (!args.model) {
  console.error("usage: node scripts/openrouter.mjs <model> [--system ...] [--json] [--temp N] < prompt");
  process.exit(2);
}
const key = loadKey();
if (!key) {
  console.error("OPENROUTER_API_KEY not found in env or .env");
  process.exit(2);
}
const prompt = await readStdin();
if (!prompt.trim()) {
  console.error("empty prompt on stdin");
  process.exit(2);
}

const messages = [];
if (args.system) messages.push({ role: "system", content: args.system });
messages.push({ role: "user", content: prompt });

const body = {
  model: args.model,
  messages,
  temperature: args.temp,
};
if (args.maxTokens && Number.isFinite(args.maxTokens)) body.max_tokens = args.maxTokens;
if (args.json) body.response_format = { type: "json_object" };

const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://bero-royale.local",
    "X-Title": "Bero Royale Mega Brain",
  },
  body: JSON.stringify(body),
});

if (!res.ok) {
  const txt = await res.text();
  console.error(`OpenRouter ${res.status}: ${txt.slice(0, 500)}`);
  process.exit(1);
}
const data = await res.json();
const content = data?.choices?.[0]?.message?.content;
if (content == null) {
  console.error("no content in response: " + JSON.stringify(data).slice(0, 500));
  process.exit(1);
}
process.stdout.write(typeof content === "string" ? content : JSON.stringify(content));
