// Synthetic WS client — regression oracle for the hit↔tracer sync fix
// (docs/systems/netcode-hit-sync-plan.md, Phases 0/1/4).
//
// Connects to a RUNNING dev server (pnpm dev:server, ws://localhost:3000/ws),
// joins the FFA room as a stationary victim, lets the server bots shoot/super it,
// and for every landed hit measures:
//   delta = t_hit_received - expectedArrival
//   where expectedArrival = (normal) t_shot + dist/BULLET_SPEED*1000
//                         = (super)  t_kame + SUPER_REVEAL_MS
//   delta < 0  => damage lands BEFORE the visible projectile/beam (the bug)
//   delta ~ 0  => damage lands WITH it (fixed; <= one 50ms drain tick)
// Use the per-kind MEDIAN of seq-correlated samples.
//
// LIMITATION (per Codex review): this only proves SERVER SEND SPACING as seen by
// a client. It does NOT prove the rendered tracer/beam reached the avatar — that
// is the client impact gate (Phase 3), which needs in-browser instrumentation.
//
// Run:  pnpm dev:server                                  (one shell)
//       RUN_MS=45000 node server/test/hit-sync-harness.mjs   (another; longer = more supers)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WebSocket = require("ws"); // resolves server/node_modules/ws

const PORT = process.env.PORT || 3000;
const ME = "harness-victim-" + (process.env.RUN_TAG || "x");
const URL = `ws://localhost:${PORT}/ws?room=voxelcube-ffa&id=${ME}`;
const BULLET_SPEED = 22;   // MUST match src/game/Bullets.ts + server bots.ts BULLET_SPEED
const SUPER_REVEAL_MS = 120; // MUST match server bots.ts SUPER_REVEAL_MS
const RUN_MS = Number(process.env.RUN_MS || 24000);
const POS = { x: 0, z: 0 };

const evBySeq = new Map();     // seq -> {t, kind:'shot'|'super', dist}
const recentByBot = new Map(); // botId -> {t, kind, dist}  (fallback when no seq)
const deltas = [];
let myId = ME, deadUntil = 0, shotCount = 0, kameCount = 0;

const ws = new WebSocket(URL);
const snap = () => JSON.stringify({
  t: "broadcast", event: "s",
  payload: { x: POS.x, y: 0.75, z: POS.z, yaw: 0, vx: 0, vy: 0, vz: 0, grounded: true, health: 10, alive: Date.now() >= deadUntil, state: "idle", name: "HARNESS", animal: "fox" },
});
ws.on("open", () => { ws.send(JSON.stringify({ t: "join", meta: { name: "HARNESS", animal: "fox" } })); ws.send(snap()); });
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
    const rec = { t: Date.now(), kind: "shot", dist };
    if (p.seq != null) evBySeq.set(p.seq, rec);
    recentByBot.set(m.from, rec);
  } else if (ev === "kame" && m.from && m.from !== myId) {
    kameCount++;
    const rec = { t: Date.now(), kind: "super", dist: 0 };
    if (p.seq != null) evBySeq.set(p.seq, rec);
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
  const rec = (seq != null && evBySeq.get(seq)) || recentByBot.get(botId);
  if (!rec) return;
  const expected = rec.kind === "super" ? rec.t + SUPER_REVEAL_MS : rec.t + (rec.dist / BULLET_SPEED) * 1000;
  deltas.push({ delta: Math.round(Date.now() - expected), kind: rec.kind, dist: +rec.dist.toFixed(1), seq: seq ?? null });
}
const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
const stat = (kind) => {
  const ds = deltas.filter((d) => d.kind === kind && d.seq != null).map((d) => d.delta).sort((a, b) => a - b);
  return { n: ds.length, median: med(ds), min: ds[0] ?? null, max: ds[ds.length - 1] ?? null };
};
setTimeout(() => {
  const shot = stat("shot"), sup = stat("super");
  const verdict = (s) => s.median == null ? "no samples" : s.median < -80 ? `BUG ${-s.median}ms early` : s.median <= 60 ? "OK (with projectile)" : `partial ${s.median}ms`;
  console.log(JSON.stringify({
    observed: { shots: shotCount, kames: kameCount, hits: deltas.length },
    normalShot_seqCorrelated: { ...shot, verdict: verdict(shot) },
    super_seqCorrelated: { ...sup, verdict: verdict(sup) },
    samples: deltas.slice(0, 14),
  }, null, 2));
  try { ws.close(); } catch {}
  clearInterval(hb);
  process.exit(0);
}, RUN_MS);
