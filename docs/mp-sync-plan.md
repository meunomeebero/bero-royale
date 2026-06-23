# Bero Royale — Server-Authoritative Multiplayer Sync Plan

> ✅ **IMPLEMENTED — historical design doc.** Every load-bearing claim here (rng/consts/NetState/
> event-channel substrates, server-authoritative world seed, RemotePlayer interpolation, voice
> TURN) was verified shipped against the code (audit 2026-06-19). Kept for rationale/risk analysis;
> the **current** system shape (incl. post-plan additions like kamehameha, kill feed, server BotSim)
> lives in [`ARCHITECTURE.md`](ARCHITECTURE.md).

_Generated design; implementation agents coded against THIS file (now historical)._

## Full Plan

UNIFIED BUILD-READY PLAN — bero-royale server-authoritative-seed + identical-to-singleplayer multiplayer at 60fps.

GUIDING PRINCIPLE (decides every protocol question): the WS server stays a dumb relay + presence registry EXCEPT for ONE piece of genuinely authoritative shared state — the per-room WORLD SEED. Everything else (pose snapshots, instant events shot/dash/jump/died, voice signaling) rides the existing generic `broadcast` frame, which the server already fans out by opaque event NAME with NO allowlist (server/src/ws/index.ts:128-141 — only frame TYPES join/track/broadcast/leave/ping are allowlisted in protocol.ts:53). So new event names need ZERO server code. The seed is the sole exception because no client can pick it authoritatively and have late-joiners agree.

The six features fold into FOUR shared substrates that every feature reuses, built FIRST so parallel work never collides:
  S1. rng.ts — one mulberry32 + string→uint32 hash (WORLD uses; LocalRoom uses for name-derived seed).
  S2. consts.ts — MOVE_SPEED(6.5), DASH_STRETCH_DURATION(0.5), squash/lean coefficients, JUMP_VELOCITY(6.0), GRAVITY(18.0), FALL_DURATION(0.7), HEARING_RADIUS(5), net TICK_HZ(20), INTERP_DELAY_MS(80), EXTRAP_MAX_MS(180). Shared by Player + RemotePlayer + AudioEngine + Game so MP math == SP math by construction (kills the No.1 drift risk across NETSTATE/AUDIO/NETCODE).
  S3. NetState (Multiplayer.ts) — ONE expanded snapshot shape: id,name,animal,x,y,z,yaw,health,alive,vx,vz,vy,grounded,state. Serves NETSTATE (juice), AUDIO (footstep/jump inference), and NETCODE (dead-reckoning) simultaneously — the three investigations independently asked for overlapping subsets; this is their union, deduped.
  S4. Event channel on Multiplayer — sendShot/sendDash/sendJump/sendDied + setShotHandler/setDashHandler/setJumpHandler/setDiedHandler, all mirroring the existing sendHit/setHitHandler (Multiplayer.ts:86-89,105-111). Serves BULLETS (shot), NETSTATE (dash/jump/died), AUDIO (reuses the same shot event — do NOT add a second shot event), NETCODE (all four).

CRITICAL DE-DUPLICATION across the 6 investigations (resolved here):
  - "shot" event: BULLETS, AUDIO, and NETCODE each proposed it. ONE event. Payload = {id, origin:{x,y,z}, dir:{x,y,z}, color}. BULLETS uses origin+dir+color for the visual bullet; AUDIO uses origin for spatial playShot. NETCODE just lists it. Single sendShot/setShotHandler. Game's shot handler does BOTH bullets.spawnVisual(...) AND audioEngine.playShot(origin,false).
  - "died" event: NETSTATE and NETCODE proposed it. ONE event {id,x,z}. Game's died handler does gore.spawn + force-dead + audioEngine.playDeath. Keep the alive-flag edge (Game.ts:454-459) as a FALLBACK that also triggers gore, with a per-remote dedupe set so gore never double-fires.
  - NetState velocity fields: NETSTATE wanted vx,vz,vy,grounded,state; AUDIO wanted vy,grounded,speed; NETCODE wanted vx,vz,vy,grounded. UNION = vx,vz,vy,grounded,state. AUDIO's "speed" is derived in RemotePlayer as hypot(vx,vz) — do NOT add a redundant speed field.
  - Footsteps/jumps: AUDIO and NETSTATE both say derive client-side in RemotePlayer from grounded/speed transitions, NEVER broadcast per-step (token bucket). Honored — only shot/dash/jump/died are events; jump has BOTH an event (for instant stretch juice) AND is the same edge audio listens to. To avoid double jump-sound, AUDIO's RemotePlayer jump sound fires on the grounded true→false edge OR the jump event (debounced), not both.
  - Tick rate: NETCODE wants 20-30Hz with accumulator subtract (not reset-to-0). Adopt 20Hz (TICK_HZ) — comfortably feeds dead-reckoning, stays far under the 80 msg/s bucket even with shot bursts, so the bucket bump NETCODE suggested (80→120) is OPTIONAL (only matters if rooms grow or fire rate rises); we keep 80 and note headroom. RESOLUTION: keep bucket at 80 (20Hz snapshot + ~8.3Hz autofire + sparse dash/jump = ~30 msg/s per sender). Document the 120 bump as a one-line future toggle.

VOICE is orthogonal (P2P/relay, cannot be server-authoritative without an SFU — explicitly out of the authority refactor). It gets: TURN (the load-bearing cross-network fix), a device modal, and setSinkId/deviceId plumbing. The modal will be styled via /frontend-design after wiring.

WORLD-BUILD TIMING (the subtle ordering fix): today Game ctor builds the entire world (Platform+Decor, Game.ts:158-186) BEFORE mp.connect() (line 208), so a seed could never influence it. Refactor: extract the seed-dependent world build (Platform, Decor, and the bullet obstacle/bounds/worldBlocker wiring at 172-177) into buildWorld(seed). LOCAL mode calls buildWorld(12345) immediately (keeps SP look identical). MULTIPLAYER mode connects FIRST, keeps Index.tsx loading overlay up, and calls buildWorld(serverSeed) when the seed arrives via Multiplayer's seed callback, then start(). The welcome frame (with seed) arrives on the same socket round-trip as connect, already behind the asset-preload spinner, so added latency is one WS RTT. No fallback default-seed-on-timeout (would re-introduce divergence if one client times out) — keep waiting + show "Conectando..." (existing mpConnected=false state already renders this).

RESULT: world is byte-identical across clients (same seed → same mulberry32 stream → same hills/fields/decor/spawns); remotes run the EXACT Player.update deformation pipeline fed by expanded NetState + instant events; bullets, gore, and procedural spatial SFX are visible/audible to all, gated by the unified HEARING_RADIUS ring; render is decoupled from a 20Hz net tick with velocity extrapolation + smooth correction; voice connects cross-network via TURN with a device modal.

## WS Protocol / NetState Additions

WS PROTOCOL ADDITIONS — server holds authoritative state for exactly ONE thing: the per-room world seed. Everything else is app-level over the existing generic `broadcast` frame (fan-out by opaque event name; server already relays unknown event names with no allowlist — index.ts:128-141, protocol.ts:53 allowlists only frame TYPES).

=== A) SERVER-AUTHORITATIVE: world seed (the ONLY server/protocol change) ===
1. server/src/ws/protocol.ts — extend the `welcome` ServerMsg variant ONLY:
     | { t: "welcome"; id: string; room: string; seed: number }
   seed is a uint32 world seed, stable for the room's lifetime. Do NOT touch NetState/presence (presence churns every track(); seed is room metadata, delivered once).

2. server/src/ws/rooms.ts — store one seed per room, generated when the room map is first created in join():
   - Change `private rooms = new Map<string, Map<string, Sock>>()` to also hold a seed. Simplest non-invasive: add a parallel `private seeds = new Map<string, number>()`.
   - In join(), in the `if (!inner)` branch (rooms.ts:24-27), after creating the inner map: `this.seeds.set(room, (Math.floor(Math.random() * 0x100000000)) >>> 0)`.
   - In leave() where an empty room is deleted (rooms.ts:42 `this.rooms.delete(s.room)`), also `this.seeds.delete(s.room)` (empty room → fresh arena next cohort; acceptable per WORLD risks).
   - Add: `seedOf(room: string): number { return this.seeds.get(room) ?? 0 }`.

3. server/src/ws/index.ts:108 — include the seed on the welcome frame:
     const welcome: ServerMsg = { t: "welcome", id, room, seed: hub.seedOf(room) };
   welcome is sent immediately on connection (before any client world build can finish), so timing is safe.

=== B) CLIENT TRANSPORT SEAM for the seed ===
4. src/game/net/Room.ts:
   - RoomHandlers (line 20-26): add `onSeed?: (seed: number) => void`.
   - ServerRoom welcome handler (line 98-101): after onStatus("online")+track, read `msg.seed` and call `this.handlers.onSeed?.(msg.seed as number)` (guard typeof number).
   - LocalRoom.connect() (line 207): derive a deterministic uint32 from the room NAME via the shared hash (rng.ts) and call `h.onSeed?.(hashStringToUint32(this.name))` once (covers ?local=1 / BroadcastChannel two-tab parity — both tabs hash the same name → same world).

5. src/game/net/Multiplayer.ts:
   - Add `private seed: number | null = null` and `private seedHandler?: (seed: number) => void`.
   - In connect()'s handler object, add `onSeed: (s) => { this.seed = s; this.seedHandler?.(s); }`.
   - Add `getSeed(): number | null { return this.seed }` and `setSeedHandler(cb: (seed: number) => void) { this.seedHandler = cb; if (this.seed != null) cb(this.seed); }` (the if-already-have guard handles a seed that arrived before Game registered).

=== C) APP-LEVEL (NO SERVER CHANGE): expanded NetState + instant events ===
6. NetState (Multiplayer.ts:6-16) — expanded shape (the UNION of all three netty investigations):
     export interface NetState {
       id: string; name: string; animal: string;
       x: number; y: number; z: number; yaw: number;
       health: number; alive: boolean;
       vx: number; vz: number; vy: number;     // velocity for dead-reckoning + speed-distort + lean + jump/fall arc
       grounded: boolean;                        // ground-squash vs airborne lerp; footstep/jump audio inference
       state: "alive" | "falling" | "dead";    // remote fall tumble animation
     }
   broadcast() (95-102) spreads these through unchanged (Omit<NetState,"id"|"name"|"animal"> picks them up automatically). 's' handler (82-85) stores the wider object as-is.

7. INSTANT EVENTS on the existing `broadcast` frame (fire the exact frame they happen, BYPASSING the 20Hz throttle). Each is fan-out (no `to` field) so ServerRoom.broadcast leaves it as fan-out (Room.ts:161-164). All mirror sendHit/setHitHandler.
   - "shot":  payload { id: string, origin:{x:number;y:number;z:number}, dir:{x:number;y:number;z:number}, color: string }
              (color = shooter's own "#fff8b0" so every human's bullets look like player bullets everywhere; origin = world muzzle so geometry matches SP; speed omitted — shared BULLET_SPEED const)
   - "dash":  payload { id: string, dir: number }   (dir = dashYaw = atan2(dz,dx))
   - "jump":  payload { id: string }
   - "died":  payload { id: string, x: number, z: number }   (carry pos so gore spawns at the death spot, not a stale lerp pos)
   Multiplayer additions (all guard p.id !== this.id):
     sendShot(origin, dir, color) -> room.broadcast("shot", {id:this.id, origin, dir, color})
     sendDash(dir:number)         -> room.broadcast("dash", {id:this.id, dir})
     sendJump()                    -> room.broadcast("jump", {id:this.id})
     sendDied(x:number,z:number)  -> room.broadcast("died", {id:this.id, x, z})
     setShotHandler/setDashHandler/setJumpHandler/setDiedHandler(cb)
     connect() onMessage map gains: shot/dash/jump/died handlers that filter self then call the registered cb.

=== D) NOT in the WS protocol: voice TURN ===
8. ICE servers (incl. TURN) are pure RTCPeerConnection config — they do NOT ride WS. New small HTTP route GET /api/turn (Elysia, registered in server/src/index.ts BEFORE the SPA catch-all, next to /api/leaderboard) returns time-limited TURN REST creds (HMAC over env TURN_SECRET) or proxies a hosted provider. The "sig" unicast path (Room.ts:161-164, index.ts:137-138) already relays arbitrary SDP/ICE unchanged — no change there.

BANDWIDTH/THROTTLE: 20Hz snapshot + ~8.3Hz autofire shot + sparse dash/jump ≈ 30 msg/s per sender, well under the 80 msg/s/socket bucket (index.ts:22-23). Inbound fan-out is per-receiver and unaffected by the per-sender bucket. The bucket bump to 120 (index.ts:22-23) is OPTIONAL future headroom for larger rooms / higher fire rate; ship at 80.

## Server Changes

### /Users/robertojunior/Documents/dev/me/bero/bero-royale/server/src/ws/protocol.ts
Extend the `welcome` ServerMsg variant (line 38) to `{ t: "welcome"; id: string; room: string; seed: number }`. This is the ONLY wire-protocol change — seed is the single piece of server-authoritative shared state. NetState/presence/ClientMsg untouched. Optionally update the file-top doc comment to note 'shot'/'dash'/'jump'/'died' as known fan-out game events (clarity only; CLIENT_TYPES allowlist at line 53 already permits them since it allowlists frame TYPES not event names).

### /Users/robertojunior/Documents/dev/me/bero/bero-royale/server/src/ws/rooms.ts
Add a per-room seed. Add `private seeds = new Map<string, number>()`. In join() inside the `if (!inner)` new-room branch (lines 24-27), generate `this.seeds.set(room, Math.floor(Math.random() * 0x100000000) >>> 0)`. In leave() where the empty room is deleted (line 42), also `this.seeds.delete(s.room)`. Add public `seedOf(room: string): number { return this.seeds.get(room) ?? 0 }`. Seed is stable for the room's lifetime so late joiners get the same world.

### /Users/robertojunior/Documents/dev/me/bero/bero-royale/server/src/ws/index.ts
Line 108: include the seed on the welcome frame — `const welcome: ServerMsg = { t: "welcome", id, room, seed: hub.seedOf(room) };`. No other change required for any feature. (OPTIONAL future headroom only: bump BUCKET_CAPACITY/BUCKET_REFILL_PER_SEC 80→120 at lines 22-23 if rooms grow or fire rate rises — NOT needed to ship; 20Hz + autofire ≈ 30 msg/s/sender.)

### /Users/robertojunior/Documents/dev/me/bero/bero-royale/server/src/turn.ts
NEW (voice only; not WS protocol). Export an Elysia-route factory or a handler `getTurnCredentials()` returning { iceServers: [{urls:[...stun...]}, {urls:[turn:HOST:3478?transport=udp, turn:...?transport=tcp, turns:HOST:5349?transport=tcp], username, credential}], ttl }. Use time-limited TURN REST: username = `${expiryUnix}:bero`, credential = base64(HMAC-SHA1(TURN_SECRET, username)). Read TURN_SECRET + TURN_HOST from env (server/src/env.ts). If TURN_SECRET unset, return only the STUN server (graceful degrade to today's behavior). If proxying a hosted provider (Cloudflare/Twilio/metered), fetch their REST token here so the secret stays server-side.

### /Users/robertojunior/Documents/dev/me/bero/bero-royale/server/src/index.ts
Register `GET /api/turn` on the Elysia app BEFORE the SPA static catch-all (next to the existing /api/leaderboard at the `.get("/api/leaderboard", ...)` chain), returning the turn.ts handler result as JSON. Pattern mirrors the existing /api endpoints.

### /Users/robertojunior/Documents/dev/me/bero/bero-royale/server/src/env.ts
Add `export const TURN_SECRET: string | undefined = process.env.TURN_SECRET;` and `export const TURN_HOST: string | undefined = process.env.TURN_HOST;` (and any hosted-provider keys). Voice still works STUN-only when unset (cross-network may fail behind symmetric NAT — that is the pre-existing behavior).

## Client Changes

### /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/rng.ts
NEW shared module. Export `mulberry32(seed:number): () => number` (move verbatim from Decor.ts:177-184) and `hashStringToUint32(s:string): number` (simple FNV-1a or `for(c of s) h=Math.imul(h^c.charCodeAt(0),0x01000193); return h>>>0`). Imported by Platform, Decor, and Room (LocalRoom name-derived seed). Single implementation eliminates the dual-PRNG drift risk.

### /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/consts.ts
NEW shared constants module (single source of truth so RemotePlayer/AudioEngine math == Player math). Export: MOVE_SPEED=6.5, JUMP_VELOCITY=6.0, GRAVITY=18.0, FALL_DURATION=0.7, DASH_STRETCH_DURATION=0.5, SQUASH_LERP=0.22, plus the squash/lean coefficients used in Player.update (stretch 0.18 / squish 0.1 / lean 0.35 / lerp 0.18 / airborne 0.06), HEARING_RADIUS=5, NET_TICK_HZ=20, INTERP_DELAY_MS=80, EXTRAP_MAX_MS=180. Player.ts re-exports/imports these (keep its local names) so existing SP tuning is preserved; RemotePlayer + AudioEngine import them.

### /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Platform.ts
WORLD seed. Import mulberry32 from ./rng. Constructor `constructor(seed: number = 12345)`: build `this.terrainRng = mulberry32(seed)` and `this.spawnRng = mulberry32((seed ^ 0x9e3779b9) >>> 0)` (separate spawn sub-stream so respawns never perturb terrain layout). Replace `const rand = () => Math.random()` in carveHills (line 79) and carveGrassFields (line 122) with `const rand = this.terrainRng` (call order carveHills→carveGrassFields is already fixed in ctor lines 58-63 — keep it). Replace the two Math.random() in randomSpawn (lines 296-297) with `this.spawnRng()`. Keep carve order; do NOT feed any window/device value into the rng.

### /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Decor.ts
WORLD seed. Replace the private mulberry32 (lines 177-184) with `import { mulberry32 } from "./rng"`. Keep ctor signature `constructor(platform, seed = 12345)` but seed the PRNG from a decor sub-stream: `const rand = mulberry32((seed ^ 0x85ebca6b) >>> 0)` (so decor and terrain don't share/shift each other's stream). All downstream rand() usage unchanged. Game will pass the real world seed.

### /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/net/Room.ts
Add `onSeed?: (seed: number) => void` to RoomHandlers (after line 25). ServerRoom welcome case (lines 98-101): after onStatus/track, `if (typeof msg.seed === "number") this.handlers.onSeed?.(msg.seed)`. LocalRoom.connect() (after line 209): `import { hashStringToUint32 } from "./rng"` and call `h.onSeed?.(hashStringToUint32(this.name))` once so two same-browser tabs build the identical world.

### /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/net/Multiplayer.ts
(1) WORLD: add seed storage + onSeed in connect() handler + getSeed()/setSeedHandler(cb) (cb fires immediately if seed already present). (2) NetState (6-16): expand with vx,vz,vy,grounded,state (broadcast()/'s' handler carry them automatically). (3) EVENTS: add ShotEvent/DashEvent/JumpEvent/DiedEvent interfaces; sendShot/sendDash/sendJump/sendDied helpers and setShotHandler/setDashHandler/setJumpHandler/setDiedHandler setters mirroring sendHit/setHitHandler; register shot/dash/jump/died in connect() onMessage, each filtering p.id!==this.id then invoking its handler. (4) VOICE: no change here (VoiceChat owns its own room).

### /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Player.ts
(1) NetState getters for broadcast: getVx()/getVz()/getVy() returning this.velocity components (isGrounded() exists line 156, getState() exists line 215, getAimYaw() exists). (2) One-shot consume flags mirroring Bot.consumeJustDied: add private justDashed/justJumped/justDied booleans; set justJumped=true in the jump branch (line 354-357), justDashed=true + capture this.dashYaw in dash() (line 552), justDied=true in die() (234) AND killByHazard() (195); expose consumeJustDashed()/getDashYaw(), consumeJustJumped(), consumeJustDied(). (3) FIRE callback for bullets+audio: add private onFire?:(origin:THREE.Vector3,dir:THREE.Vector3,color:string)=>void + setOnFire(cb); call it in shoot() (after line 585) with muzzle.clone(), dir.clone(), "#fff8b0". (4) AUDIO: change this.audio type from AudioManager to AudioEngine; at every existing audio.*() call (198,227,237,357,425,446,520,564,586) pass this.root.position as the source + isLocal=true (e.g. audio.playJump(this.root.position,true)). (5) Import shared consts from ./consts (keep local const names; can re-assign from imports). GC (optional, NETCODE): reuse scratch Raycaster/Plane in updateAim (278-281) and avoid per-frame new Vector3 lerp targets (459,464,467,484).

### /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/RemotePlayer.ts
FULL rewrite to mirror Player.update deformation + dead-reckoning + instant juice + spatial audio triggers. (a) Constructor gains an AudioEngine ref. (b) setState widened to (x,y,z,yaw,health,alive,vx,vz,vy,grounded,state) — push a TIMESTAMPED snapshot (perf.now()) into a 3-entry ring buffer; store latest vx,vz,vy,grounded,state. (c) update(dt,groundY): compute renderTime=now-INTERP_DELAY_MS; if bracketed by two snapshots interpolate position, else EXTRAPOLATE pos=latest+vel*(renderTime-latestT) clamped to EXTRAP_MAX_MS; SMOOTH error-correct current rendered pos toward target over ~100ms (no snap); shortest-arc yaw lerp. (d) Deformation on avatar.group (the squash/stretch node, = Player.body): speedRatio=min(1,hypot(vx,vz)/MOVE_SPEED), ground-squash lerp toward (squish,stretch*0.95,squish) else airborne lerp to 1; lean avatar.group.rotation.x/z from vz/-vx; dashStretchTimer elastic amt=cos((1-frac)*PI*4)*0.6*frac + faceYaw(dashYaw) + setDashStretch(amt); jump stretch (0.7,1.4,0.7) on grounded true→false OR jump event; landing squash (1.4,0.6,1.4) on false→true; if state==="falling" run tumble (rot.x+=dt*6, rot.z+=dt*4), shrink, opacity fade. (e) Instant-event methods: triggerDash(dir) sets dashYaw+dashStretchTimer (+optional smoke/dust for parity), triggerJump() kicks targetScale to (0.7,1.4,0.7). (f) AUDIO inference (isLocal=false at this.root.position): grounded false→true land sound, true→false (or jump event, debounced) jump sound, grounded&&speed>0.6 footstep cadence timer (port Player.ts 516-520), alive→dead death sound (dedupe vs died event). Import MOVE_SPEED/DASH_STRETCH_DURATION/etc from ./consts. Keep health tint, opacity, shadow, BulletTarget side='bot' + onHit relay.

### /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Bullets.ts
BULLETS visual-only path. Add `damaging: boolean` to the Bullet interface (lines 5-12); spawn() (79) sets damaging:true. Add `spawnVisual(origin, direction, color: string)` building a mesh exactly like spawn() (same BULLET_GEOM/SPEED/LIFE/fade) but with caller-supplied color and damaging:false; never registerTarget. In update(), wrap the ENTIRE target-collision block (lines 161-191, from `const direction = ...` through the `if(hit) removeAt`) in `if (b.damaging) { ... }` so visual bullets respect bounds/worldBlocker/obstacles + expire but NEVER apply damage (damage stays on the trust 'hit' path). GC (optional, NETCODE): pool meshes+materials instead of per-spawn alloc; reuse a scratch Vector3 for the per-frame hit direction (line 162); preserve the module-level BULLET_GEOM singleton + dispose semantics.

### /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/AudioEngine.ts
NEW spatial Web-Audio SFX engine (procedural, no assets) superseding AudioManager. Single lazy AudioContext + master GainNode; resume() (call on first gesture); setListener(x,z); radius=HEARING_RADIUS. gainFor(worldPos): d=hypot(dx,dz); g=isLocal?1:(d>=radius?0:1-d/radius); early-return if g<=0 (skip remote nodes beyond ring BEFORE allocating). Port blip()/step() synthesis from AudioManager (squsquare/saw/triangle), routing osc->gain(volume*spatialGain)->master. Methods (worldPos,isLocal): playShot (noise burst + lowpass sweep + blip), playJump(220→520), playLand(320→110), playFall(180→60), playHit, playDeath, playFootstep(randomized triangle). dispose() closes ctx. Same amplitudes as AudioManager so SP sounds identical (local = full gain always).

### /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/AudioManager.ts
DELETE after migration (its blip()/step() are folded into AudioEngine). Update all importers: Player.ts (4,57 type) and Bot.ts (import + ctor param type) switch to AudioEngine. (If preferred, keep AudioManager temporarily and have AudioEngine import its primitives — but the clean end-state is one engine.)

### /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Bot.ts
AUDIO only (local-only, no network). Change the audio param/field type from AudioManager to AudioEngine; at each existing audio.*() call (165,176,281,351,365,427,443) pass the bot's world position (this.root.position) + isLocal=true so bot SFX stay full-volume in SP (do NOT attenuate bots by the player ring). No net changes — bots don't exist in MP.

### /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/net/VoiceChat.ts
VOICE. (1) TURN: fetch /api/turn once at construct/connect, merge into ICE (keep STUN as fallback); store iceServers and use in new RTCPeerConnection({iceServers}) (line 159). (2) Persisted devices: read localStorage 'voxelcube:voice:mic'/':spk' in constructor; pass deviceId:{exact} into getUserMedia in acquireMic (114-116) with OverconstrainedError fallback (clear stale id, retry default). (3) async setInputDevice(id): re-getUserMedia with the new deviceId, stop old tracks, for each peer RTCRtpSender.replaceTrack(newTrack) (addTrack if no sender yet), keep track.enabled=this.talking, persist. (4) async setOutputDevice(id): store + for each peer.audio.setSinkId(id) (feature-detect; no-op if unsupported), apply in createPeer/ontrack for future peers, persist, retry play(). (5) Autoplay: retry audio.play() in setOutputDevice and after device changes. (6) getter getDeviceIds(). updateProximity already uses clamp(1-d/radius) keyed to the radius param (104) — keep; it will receive HEARING_RADIUS from Game (unchanged call, renamed const).

### /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/components/hud/VoiceSettingsModal.tsx
NEW React modal. On open: getUserMedia({audio:true}) once to unlock device labels, then enumerateDevices(); two <select>s (audioinput, audiooutput); persist chosen ids to localStorage (same keys as VoiceChat); listen mediaDevices.ondevicechange to refresh; feature-detect setSinkId and disable the speaker dropdown with a note if absent (Firefox/older Safari); optional mic-level meter (AnalyserNode) + 'test speaker' button (setSinkId+play a sample). Calls back onSelectInput(id)/onSelectOutput(id). Plain functional structure now; visual styling deferred to /frontend-design.

### /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/pages/Index.tsx
(1) WORLD timing: keep the loading overlay up in multiplayer until the seed-gated world build completes — Game.start() should resolve/callback only after buildWorld runs (add a ready callback param to start() or a Game 'onReady' that flips setLoading(false)); for local mode it resolves immediately. (2) VOICE modal: add voiceSettingsOpen state + a settings/gear button next to the mic pill (lines 215-227, multiplayer only); mount <VoiceSettingsModal> (z-50, pointer-events-auto) wired to gameRef.current.setVoiceInputDevice/OutputDevice; opening it is the autoplay-unlock gesture.

### /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Game.ts
THE INTEGRATION HUB. (A) WORLD: extract Platform+Decor+bullet obstacle/bounds/worldBlocker wiring (lines 158-186 minus pure-cosmetic systems that don't need the seed) into `private buildWorld(seed:number)`. Local mode: call buildWorld(12345) in ctor then start. MP: move mp construction+connect BEFORE world build; register this.mp.setSeedHandler(seed=>{ this.buildWorld(seed); this.onReady?.(); }); do NOT build until seed arrives. Add an onReady hook Index uses to drop the loading overlay. (B) AUDIO: line 152 construct AudioEngine instead of AudioManager; rename VOICE_RADIUS→HEARING_RADIUS (38, used 376/404); each frame audioEngine.setListener(player.x,player.z) before remote updates; audioEngine.resume() on first gesture (hook InputManager mousedown/keydown or a one-time pointerdown); line 673 audioEngine.dispose(). (C) NETSTATE+NETCODE broadcast: in updateMultiplayer change the gate to a fixed-step accumulator at NET_TICK_HZ (mpBroadcastAccum -= 1/TICK, while-loop, NOT reset-to-0); add vx,vz,vy,grounded,state to the broadcast payload (427-434) via Player getters; each frame (OUTSIDE the throttle) consume Player one-shot flags and call mp.sendDash(getDashYaw())/sendJump()/sendDied(x,z); wire Player.setOnFire((o,d,c)=>this.mp?.sendShot({x:o.x,y:o.y,z:o.z},{x:d.x,y:d.y,z:d.z},c)). (D) EVENT handlers: mp.setShotHandler(s=>{ this.bullets.spawnVisual(origin,dir,s.color); this.audioEngine.playShot(origin,false); }); mp.setDashHandler(p=>rp(p.id)?.triggerDash(p.dir)); mp.setJumpHandler(p=>rp(p.id)?.triggerJump()); mp.setDiedHandler(p=>{ if(!this.deadFx.has(p.id)){ this.deadFx.add(p.id); this.gore.spawn(new Vector3(p.x,gy,p.z),24); this.audioEngine.playDeath(...,false);} markRemoteDead(p.id); }). (E) pass new NetState fields through rp.setState (445,451) and pass audioEngine into RemotePlayer ctor (441). (F) GORE fallback + dedupe: keep the alive-flag edge (454-459) but route its gore through the SAME deadFx-dedupe set so the explosion fires once whether via 'died' event or alive flag; clear deadFx[id] on respawn (state alive again). (G) VOICE bridge: add public setVoiceInputDevice(id)/setVoiceOutputDevice(id) forwarding to this.voice; optionally surface voiceSupported/device ids via GameStats (702-719).

## Voice Modal Plan

VOICE = device modal + WebRTC bridge + TURN. Voice is intentionally OUTSIDE the server-authority refactor (audio is P2P/relay; making it server-authoritative needs an SFU). Styling of the modal is deferred to /frontend-design after wiring.

DOMINANT FIX — TURN (without it, cross-network voice fails behind symmetric/carrier-grade NAT regardless of the modal; today ICE is STUN-only at VoiceChat.ts:20):
  - server/src/turn.ts (NEW) + GET /api/turn route in server/src/index.ts (before the SPA catch-all, beside /api/leaderboard). Returns time-limited TURN REST creds (username=`${expiry}:bero`, credential=base64(HMAC-SHA1(TURN_SECRET, username))) over env TURN_SECRET/TURN_HOST, OR proxies a hosted provider (Cloudflare Calls / Twilio NTS / metered.ca) so the secret never ships. Include turns:HOST:5349?transport=tcp as the firewall-proof fallback. If TURN_SECRET is unset, return STUN-only (graceful degrade to current behavior). Document TURN_SECRET/TURN_HOST in .env.example.
  - VoiceChat.ts: fetch /api/turn once at connect, merge into ICE, feed into new RTCPeerConnection (line 159). Optionally pc.setConfiguration on mid-session rotation (no WS change).

DEVICE MODAL (src/components/hud/VoiceSettingsModal.tsx, NEW):
  - On open: getUserMedia({audio:true}) ONCE (unlocks device labels — empty until a permission grant) → enumerateDevices() → two <select>s (audioinput, audiooutput). Persist chosen ids to localStorage ('voxelcube:voice:mic' / ':spk'). Subscribe mediaDevices.ondevicechange to refresh. Feature-detect setSinkId; if absent (Firefox / older Safari) disable the speaker dropdown with a note (input still works). Handle mic-denied gracefully (output selection + listen-only still function). Optional: AnalyserNode mic-level meter + 'test speaker' button (setSinkId+play sample) so users self-verify failures 2-4.

WIRING (VoiceChat new public methods, called from Game via Index):
  - setInputDevice(id): re-getUserMedia({audio:{deviceId:{exact:id},echoCancellation,noiseSuppression}}) with OverconstrainedError fallback (clear stale localStorage id → default); stop old tracks; per peer RTCRtpSender.replaceTrack(newTrack) (addTrack + let perfect-negotiation offer if no sender yet); keep track.enabled=this.talking.
  - setOutputDevice(id): store; per peer.audio.setSinkId(id); apply in createPeer/ontrack for future peers; retry play().
  - Constructor reads persisted ids and applies (deviceId into acquireMic, setSinkId after each new Audio()).

BRIDGE (the only missing React↔Game channel for config):
  - Game: public setVoiceInputDevice(id)/setVoiceOutputDevice(id) → this.voice. Optionally GameStats gains voiceSupported flag.
  - Index.tsx: voiceSettingsOpen state + a gear/mic-settings button beside the existing mic pill (lines 215-227, gated to stats.mode==='multiplayer'); mount <VoiceSettingsModal> (z-50, pointer-events-auto like the pause overlay) wired to gameRef.current.setVoiceInputDevice/OutputDevice. Opening the modal is itself the autoplay-unlock user gesture; after open, retry play() on all peer audio elements.

AUTOPLAY HARDENING: a pure listener who never opens the modal nor presses G may have inbound audio blocked — the modal-open gesture mitigates; also retry play() in setOutputDevice and document that talking once unlocks playback.

## Work Breakdown

### [T0-shared] Shared substrates FIRST (rng + consts) — everything depends on these
- deps: none
- files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/rng.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/consts.ts

Create rng.ts (mulberry32 moved verbatim from Decor.ts:177-184 + hashStringToUint32). Create consts.ts with MOVE_SPEED/JUMP_VELOCITY/GRAVITY/FALL_DURATION/DASH_STRETCH_DURATION/SQUASH_LERP + squash/lean coefficients + HEARING_RADIUS=5 + NET_TICK_HZ=20/INTERP_DELAY_MS=80/EXTRAP_MAX_MS=180. No behavior change yet. Pure new files — zero conflict surface.

### [T1-protocol] Shared protocol/types: WS welcome.seed + expanded NetState + event interfaces/helpers
- deps: T0-shared
- files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/server/src/ws/protocol.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/server/src/ws/rooms.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/server/src/ws/index.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/net/Room.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/net/Multiplayer.ts

THE CONTRACT — do FIRST, before all client feature work. Server: add seed to welcome (protocol.ts), per-room seed in rooms.ts (seeds map + seedOf), emit on welcome (index.ts:108). Client transport: Room.ts onSeed handler + ServerRoom read + LocalRoom name-hash seed. Multiplayer.ts: seed storage+getSeed+setSeedHandler; EXPAND NetState with vx,vz,vy,grounded,state; ADD ShotEvent/DashEvent/JumpEvent/DiedEvent interfaces + sendShot/sendDash/sendJump/sendDied + setShotHandler/setDashHandler/setJumpHandler/setDiedHandler + register shot/dash/jump/died in connect() onMessage. This file is the shared seam — single owner, lands before T2-T6 so all consumers compile against the final shapes.

### [T2-world] WORLD determinism: seed-thread Platform + Decor
- deps: T0-shared
- files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Platform.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Decor.ts

Platform: import mulberry32 from ./rng; ctor(seed=12345); terrainRng + spawnRng(seed^0x9e3779b9); replace Math.random in carveHills(79)/carveGrassFields(122)/randomSpawn(296-297). Decor: import mulberry32 from ./rng (delete local copy 177-184); seed decor sub-stream (seed^0x85ebca6b). Disjoint files; depends only on rng. Game ctor wiring of buildWorld is owned by T6 — these two just accept the seed param.

### [T3-player] Player getters + one-shot flags + onFire + AudioEngine source param
- deps: T0-shared, T1-protocol
- files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Player.ts

Add getVx/getVz/getVy; add justDashed/justJumped/justDied flags (set in jump branch 354, dash() 552, die() 234, killByHazard() 195) + consumeJustDashed/getDashYaw/consumeJustJumped/consumeJustDied; add onFire callback + setOnFire, fire in shoot() (585) with muzzle/dir/'#fff8b0'; switch audio type to AudioEngine and pass this.root.position+isLocal=true at all audio.*() calls; import consts. Single-owner file; the AudioEngine TYPE comes from T5 (interface-compatible) — coordinate signature with T5. Optional GC scratch-vectors here.

### [T4-remoteplayer] RemotePlayer rewrite: dead-reckoning + full deformation + instant juice + spatial audio triggers
- deps: T0-shared, T1-protocol, T5-audio
- files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/RemotePlayer.ts

Rewrite per the clientChanges spec: widen setState (vx,vz,vy,grounded,state) into a timestamped 3-snapshot buffer; interpolate-or-extrapolate position with smooth correction + shortest-arc yaw; replicate Player.update squash/stretch/lean on avatar.group; dashStretch elastic; jump/land squash on grounded edges; falling tumble; triggerDash/triggerJump; AudioEngine ctor ref + grounded-edge land/jump, footstep cadence, death triggers (isLocal=false); import consts. Single-owner file. Depends on T1 (NetState shape), T5 (AudioEngine type), T0 (consts).

### [T5-audio] AudioEngine (NEW) + migrate Bot + retire AudioManager
- deps: T0-shared
- files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/AudioEngine.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/AudioManager.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Bot.ts

Create AudioEngine.ts (spatial procedural SFX; setListener/resume/gainFor + play* methods; import HEARING_RADIUS from consts). Migrate Bot.ts audio type→AudioEngine, pass bot world position+isLocal=true at calls (165,176,281,351,365,427,443). Delete AudioManager.ts (or keep as primitives). PUBLISH the AudioEngine method signatures early (playShot/playJump/playLand/playFall/playHit/playDeath/playFootstep/playStep, setListener, resume) so T3/T4 code against them. Owns Bot.ts + AudioEngine + AudioManager; disjoint from T3/T4 files.

### [T6-bullets] Bullets visual-only spawn path
- deps: T1-protocol
- files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Bullets.ts

Add damaging flag; spawnVisual(origin,dir,color); guard the entire target-collision block (161-191) with if(b.damaging). Optional GC pooling + scratch vector. Single-owner file, no cross-deps beyond THREE. Can run in parallel with T2-T5.

### [T7-game] Game integration hub: buildWorld timing, broadcast tick, event handlers, gore dedupe, audio listener, voice bridge
- deps: T1-protocol, T2-world, T3-player, T4-remoteplayer, T5-audio, T6-bullets
- files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Game.ts

Integrate ALL features (see clientChanges Game.ts entry): extract buildWorld(seed); MP connect-before-build + setSeedHandler + onReady; AudioEngine construct/setListener/resume/dispose + VOICE_RADIUS→HEARING_RADIUS; fixed-step 20Hz accumulator + broadcast vx,vz,vy,grounded,state; consume Player one-shot flags → sendDash/sendJump/sendDied; setOnFire→sendShot; setShotHandler (spawnVisual + playShot), setDashHandler/setJumpHandler (rp.trigger*), setDiedHandler (gore+playDeath via deadFx dedupe, also gating the alive-flag fallback through the same set); pass new fields + AudioEngine into RemotePlayer; setVoiceInputDevice/OutputDevice. SOLE owner of Game.ts; lands LAST after T1-T6 export their seams.

### [T8-voice] VOICE: TURN endpoint + VoiceChat device/TURN wiring + modal + Index bridge
- deps: T1-protocol
- files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/server/src/turn.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/server/src/env.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/net/VoiceChat.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/components/hud/VoiceSettingsModal.tsx, /Users/robertojunior/Documents/dev/me/bero/bero-royale/.env.example

Server: turn.ts handler + env TURN_SECRET/TURN_HOST + register GET /api/turn in index.ts (NOTE: index.ts route registration is a 1-line addition — coordinate with T1 which also touches server/src/index.ts:108; sequence T8's index.ts edit after T1 or do both in the same pass). VoiceChat: TURN fetch+merge, deviceId persistence, setInputDevice (replaceTrack), setOutputDevice (setSinkId), autoplay retries. NEW VoiceSettingsModal.tsx. .env.example doc. Index.tsx voice-modal button+mount is shared with T9 (Index owns both timing + modal) — assign Index.tsx edits to T9 to keep Index single-owner. Largely independent of gameplay tasks (voice is its own room).

### [T9-index] Index.tsx: loading-until-seed-build + voice settings button/modal mount
- deps: T7-game, T8-voice
- files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/pages/Index.tsx

Keep loading overlay up in MP until Game.onReady (seed-gated buildWorld) fires; add voiceSettingsOpen state + settings button beside mic pill (215-227, MP only) + mount <VoiceSettingsModal> wired to gameRef.current.setVoiceInputDevice/OutputDevice. SOLE owner of Index.tsx (avoids T8 touching it). Depends on T7 (Game onReady + setVoiceInputDevice/OutputDevice) and T8 (VoiceSettingsModal component).

## Verify Plan

Per-feature manual + automated verification (two browser tabs = two clients; use the headed-browser WebGL screenshot setup from memory; ?local=1 forces LocalRoom for same-browser two-tab testing, real server for cross-network).

PRE: `pnpm -C server check` (tsc) and root `pnpm build`/typecheck must pass after T1 (protocol) and again after T7 (integration). Server: `pnpm -C server dev`; client: `pnpm dev` on :8080.

1. WORLD identical (server seed): open two tabs into the SAME online room. Screenshot both at spawn; overlay/compare hill + grass-field + decor layout — must be pixel-identical terrain. Confirm a remote avatar standing on a hill is on the SAME hill locally (no floating-rock). Then ?local=1 two tabs: same name-derived world. Reload one tab mid-session into the still-populated room → same world (late-joiner seed parity). Empty the room, rejoin → new arena (expected). Single-player: confirm SP world == the seed-12345 world (unchanged look).

2. BULLETS both ways: tab A fires (hold LMB autofire) while B watches — B sees yellow #fff8b0 bullets travel from A's muzzle along A's aim, fading + stopping on hills/trees. Reverse. Confirm damage still applies (health drops) AND that visual bullets cause NO extra damage (the trust 'hit' path is the only damage source — verify health decrements once per real hit, not doubled).

3. NetState juice (dash/jump/fall/speed): B watches A run (speed-stretch squash on avatar), jump (up-stretch then landing squash), dash (Shift → elastic horizontal stretch along dash dir + facing turn), and run off an edge (tumble+shrink+fade). All must match what A sees locally. Compare side-by-side screenshots A-local vs B-remote for the same action.

4. GORE on death visible to all: A dies (walk into a hit until 0 HP, or off-edge) → B sees the 24-chunk red gore burst at A's death spot, A's avatar vanishes immediately (not waiting on the 12Hz alive flag). Kill the 'died' event in devtools (block the broadcast) to confirm the alive-flag FALLBACK still spawns gore exactly once (dedupe: never two bursts).

5. VOICE + device modal + TURN: cross-NETWORK test (two machines / phone tethered vs wifi) — hold G on A, hear A on B (this is the TURN proof; STUN-only fails here today). Open the settings modal: enumerate mic+speaker, switch mic (partner hears the new device), switch speaker (setSinkId routes output; verify with a 'test speaker' button), confirm Firefox/Safari disables speaker dropdown gracefully. Unplug the saved mic → OverconstrainedError falls back to default, no crash. Confirm chrome://webrtc-internals shows a relay candidate pair when both are behind NAT.

6. Spatial audio gated by ring: B's avatar walks toward A. Outside the red ring (HEARING_RADIUS=5) A hears NOTHING from B (shots/jumps/footsteps/voice all silent). Crossing the ring, B's sounds fade in with distance; voice and SFX share the same radius. Confirm SP bots are always audible at full volume regardless of distance (isLocal/full-gain path). Confirm AudioContext resumes on first gesture (remote sounds not stuck suspended).

7. Latency + 60fps: with two clients moving, confirm remote avatars are smooth (dead-reckoning, no rubber-band on each packet, no freeze-then-jump on a dropped snapshot). Run the /benchmark or a perf trace while firing heavily — confirm steady ~60fps (GC pooling in Bullets if implemented). Verify the 20Hz accumulator (mpBroadcastAccum -= 1/TICK) holds cadence at varying frame rates.

8. Regression: SP mode fully unchanged (world, audio, gore, bullets, no voice/leaderboard). MP loading overlay stays up until seed arrives then world appears once (no terrain pop). Disconnect mid-session → 'Conectando...' shows, no stuck blank canvas. Run /qa or /code-review on the diff before landing.

## Risks

- WORLD stream-ordering coupling: carveHills, carveGrassFields, decor, and spawns MUST draw from separated PRNG sub-streams (terrain / seed^0x9e3779b9 spawn / seed^0x85ebca6b decor) — the plan does this. The variable-count rng draws in the while/tries loops (Platform.ts:108 early-continue) are identical across clients ONLY if seed AND grid are identical; ensure no window-size/device value ever feeds the rng.
- WORLD timing/reconnect: deferring MP build until welcome.seed adds one WS RTT before first paint; if the socket errors/reconnects (Room.ts backoff to 5s) the player sits on 'Conectando...'. We deliberately do NOT use a default-seed timeout (it would re-introduce divergence if only one client times out) — accept a longer connecting state over a divergent world.
- SHOT/DIED event de-dup is load-bearing: shot is ONE event consumed by BOTH bullets.spawnVisual and audioEngine.playShot; died is ONE event consumed by gore+playDeath+force-dead. If implemented as separate events per investigation, you'd double-spawn/double-play. The plan mandates single events + a deadFx dedupe set shared by the 'died' handler AND the alive-flag fallback so gore fires exactly once.
- Math drift MP vs SP: RemotePlayer must use the SAME consts (consts.ts) and deformation math as Player; if Player tuning later changes and RemotePlayer copy isn't updated they diverge. Mitigated by shared consts; a shared deform helper would be even safer but is optional. Apply scale/lean to avatar.group (NOT root) so faceYaw's inner facing group + root shadow/label stay correct.
- Dead-reckoning overshoot: extrapolating a remote that suddenly stops/turns overshoots; clamp extrapolation to EXTRAP_MAX_MS(180) and smooth-correct on the next snapshot (no snap). Jump/land/death inferred from 20Hz grounded/state edges can miss a hop+land within ~50ms or double-fire on jitter — debounce edges with a small cooldown; prefer the explicit jump/died EVENTS for the instant juice and treat the sampled edges only for audio (debounced) so a missed edge self-heals from the next snapshot.
- Trust model unchanged = goal only PARTIALLY met: 's' still carries client-authoritative position and 'hit' is still victim-self-applied; adding vx/vz widens what a cheating client can forge (teleport/speed). TRUE server authority (server simulates positions) is NOT in this scope — only the WORLD SEED is genuinely server-authoritative. Full position authority is a separate larger phase; flag this explicitly so 'fully server-authoritative' is not over-claimed.
- VOICE TURN is the load-bearing cross-network fix — the modal alone is insufficient; behind symmetric/CGNAT, STUN-only ICE goes to failed with no relay. Adds coturn ops/cost (or a hosted-TURN external dependency + per-GB egress). setSinkId is unsupported in Firefox/older Safari (feature-detect+disable); device labels are empty until a getUserMedia grant (modal must request mic first); getUserMedia({deviceId:{exact}}) throws OverconstrainedError if the saved device is unplugged (fall back to default + clear stale localStorage).
- AudioContext autoplay: AudioEngine must resume() on a real user gesture or remote sounds (which can fire before the local player ever clicks) stay suspended/silent — hook InputManager mousedown/keydown. NEVER broadcast per-footstep/per-frame events (80 msg/s/socket bucket) — derive footsteps/jumps client-side from NetState. Performance: gate spatial nodes by gainFor()>0 (skip allocating beyond the ring) and cap concurrent voices for many players.
- VOICE is P2P/relay and cannot be made server-authoritative without an SFU — keep it explicitly out of the authority refactor to avoid conflating goals. AudioManager removal must update every importer (Player.ts, Bot.ts) in the same pass or the build breaks; Bot SFX must stay isLocal=true/full-gain so single-player is unchanged.
- Parallel-work seam hazards: server/src/index.ts is touched by BOTH T1 (welcome seed line 108) and T8 (GET /api/turn route) — sequence or co-edit. Index.tsx and Game.ts are each single-owner (T9 and T7) by design; Player.ts (T3) and RemotePlayer.ts (T4) both depend on the AudioEngine signatures from T5 — publish those signatures before T3/T4 start. NetState shape (T1) must land before any of T3/T4/T6/T7 compile.
