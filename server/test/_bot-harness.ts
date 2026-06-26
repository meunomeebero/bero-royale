import { BotSim } from "../src/ws/bots.ts";

export const ROOM = "voxelcube-ffa";
export interface FakePlayer { id: string; x: number; z: number; grounded?: boolean; }
export interface Captured { event: string; payload: unknown; from: string; }

export function makeHarness(opts: { players?: FakePlayer[] } = {}) {
  let players: FakePlayer[] = opts.players ?? [];
  const fanned: Captured[] = [];
  const pending: { applyAt: number; resolve: () => void }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hub: any = {
    playerTargets: () => players.map((p) => ({ id: p.id, x: p.x, z: p.z, grounded: p.grounded ?? true })),
    liveSizeOf: () => players.length,
    isPlayer: (_r: string, id: string) => players.some((p) => p.id === id),
    fanout: (_r: string, msg: { event: string; payload: unknown; from: string }) => fanned.push({ event: msg.event, payload: msg.payload, from: msg.from }),
    damagePlayer: (_r: string, targetId: string) => {
      const p = players.find((x) => x.id === targetId);
      return p ? { died: false, x: p.x, z: p.z, byId: "", victimName: targetId } : null;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    enqueueHit: (_r: string, hit: any) => pending.push(hit),
    broadcastPresence: () => {},
    powerupSim: { botItemTargets: () => [] },
  };
  const sim = new BotSim(hub);
  return {
    sim,
    setPlayers: (ps: FakePlayer[]) => { players = ps; },
    fanned,
    drainHits: () => { const now = Date.now(); for (let i = pending.length - 1; i >= 0; i--) { if (pending[i].applyAt <= now) { pending[i].resolve(); pending.splice(i, 1); } } },
    inspect: () => sim.inspect(ROOM),
  };
}
