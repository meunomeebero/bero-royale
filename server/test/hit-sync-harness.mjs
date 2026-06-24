// Synthetic WS client — regression oracle for the hit↔tracer sync fix
// (docs/systems/netcode-hit-sync-plan.md, Phase 0/1).
//
// Connects to a RUNNING dev server (pnpm dev:server, ws://localhost:3000/ws),
// joins the FFA room as a stationary victim, lets the server bots shoot it, and
// for every landed hit measures:
//   delta = t_hit_received - (t_shot_received + dist/BULLET_SPEED*1000)
//   delta < 0  => damage lands BEFORE the visible tracer arrives (the bug)
//   delta ~ 0  => damage lands WITH the tracer (fixed; <= one 50ms drain tick)
// Use the MEDIAN of seq-correlated samples — the mean is skewed by the still-
// synchronous super path (seq:null fallbacks) until Phase 4 lands.
//
// LIMITATION (per Codex review): this only proves SERVER SEND SPACING as seen by
// a client. It does NOT prove the rendered tracer mesh reached the avatar — that
// is the client impact gate (Phase 3), which needs in-browser instrumentation.
//
// Run:  pnpm dev:server   (in one shell)
//       node server/test/hit-sync-harness.mjs   (in another)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WebSocket = require("ws"); // resolves server/node_modules/ws

const PORT = process.env.PORT || 3000;
const ME = "harness-victim-" + (process.env.RUN_TAG || "x");
const URL = `ws://localhost:${PORT}/ws?room=voxelcube-ffa&id=${ME}`;
const BULLET_SPEED = 22; // MUST match src/game/Bullets.ts + server bots.ts BULLET_SPEED
const RUN_MS = Number(process.env.RUN_MS || 24000);
const POS = { x: 0, z: 0 };

const shotsBySeq = new Map();
const recentByBot = new Map();
const deltas = [];
let myId = ME;
let deadUntil = 0;
let shotCount = 0;

const ws = new WebSocket(URL);
const snap = () => JSON.stringify({
  t: "broadcast", event: "s",
  payload: { x: POS.x, y: 0.75, z: POS.z, yaw: 0, vx: 0, vy: 0, vz: 0, grounded: true, health: 10, alive: Date.now() >= deadUntil, state: "idle", name: "HARNESS", animal: "fox" },
});
ws.on("open", () => {
  ws.send(JSON.stringify({ t: "join", meta: { name: "HARNESS", animal: "fox" } }));
  ws.send(snap());
});
const hb = setInterval(() => { if (ws.readyState === 1) ws.send(snap()); }, 50);
ws.on("error", (e) => console.log("WS ERROR:", e.message));
ws.on("message", (raw) => {
  let m; try { m = JSON.parse(raw.toString()); } catch { return; }
  if (m.t === "welcome") { myId = m.id; return; }
  if (m.t !== "broadcast") return;
  const ev = m.event, p = m.payload || {};
  if (ev === "shot" && m.from && m.from !== myId) {
    shotCount++;
    const dist = Math.hypot((p.origin?.x ?? 0) - POS.x, (p.origin?.z ?? 0) - POS.z);
    const rec = { tShot: Date.now(), dist };
    if (p.seq != null) shotsBySeq.set(p.seq, rec);
    recentByBot.set(m.from, rec);
  } else if (ev === "hit" && p.target === myId) {
    record(m.from, p.seq);
  } else if (ev === "died" && p.id === myId) {
    record(p.by, p.seq);
    deadUntil = Date.now() + 350;
    ws.send(JSON.stringify({ t: "broadcast", event: "s", payload: { x: 0, y: 0.75, z: 0, yaw: 0, vx: 0, vy: 0, vz: 0, grounded: true, health: 0, alive: false, state: "dead", name: "HARNESS", animal: "fox" } }));
  }
});
function record(botId, seq) {
  const rec = (seq != null && shotsBySeq.get(seq)) || recentByBot.get(botId);
  if (!rec) return;
  deltas.push({ delta: Math.round(Date.now() - (rec.tShot + (rec.dist / BULLET_SPEED) * 1000)), dist: +rec.dist.toFixed(1), seq: seq ?? null });
}
setTimeout(() => {
  const corr = deltas.filter((d) => d.seq != null).map((d) => d.delta).sort((a, b) => a - b);
  const all = deltas.map((d) => d.delta).sort((a, b) => a - b);
  const med = (a) => (a.length ? a[Math.floor(a.length / 2)] : null);
  console.log(JSON.stringify({
    shotsObserved: shotCount,
    hitsMeasured: deltas.length,
    seqCorrelated: corr.length,
    delta_ms_seqCorrelated: { median: med(corr), min: corr[0] ?? null, max: corr[corr.length - 1] ?? null },
    delta_ms_all: { median: med(all), min: all[0] ?? null, max: all[all.length - 1] ?? null },
    verdict: med(corr) == null ? "NO CORRELATED HITS — rerun / longer RUN_MS"
      : med(corr) < -80 ? `BUG: damage lands ~${-med(corr)}ms BEFORE the tracer`
      : med(corr) <= 60 ? "OK: damage lands with the tracer (median <= one drain tick)"
      : `PARTIAL: median ${med(corr)}ms`,
    samples: deltas.slice(0, 12),
  }, null, 2));
  try { ws.close(); } catch {}
  clearInterval(hb);
  process.exit(0);
}, RUN_MS);
