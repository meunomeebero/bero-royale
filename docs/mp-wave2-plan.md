# Bero Royale — Wave 2 Plan

> ✅ **IMPLEMENTED — historical design doc.** All six items (NaN-scrub/buffer-cap remotes, bullet
> max-range, server-authoritative AFK health/grace authority, push-to-talk voice, real-time chat,
> ambient menu background) were verified shipped against the code (audit 2026-06-19). Current system
> shape lives in [`ARCHITECTURE.md`](ARCHITECTURE.md); performance roadmap in [`PERFORMANCE.md`](PERFORMANCE.md).

## Full Plan

WAVE 2 — UNIFIED BUILD-READY PLAN (bero-royale multiplayer)

This plan unifies six investigations. The hard constraint is that src/game/Game.ts is the bottleneck (touched by items 1,2,3,4,5,7,8). It is owned by a SINGLE task (G0) that applies the consolidated gameDotTsPlan below. All other tasks are disjoint-file and may proceed in parallel against their own files; they depend on G0 only where they need a Game.ts method to exist (those deps are listed). The server change is bounded to one feature (AFK authority, item 5) plus a tiny relay reuse for chat (item 7 needs NO server change).

VERIFIED GROUND TRUTH (from reading the code):
- Game.ts:193 registers `mp.setHitHandler((target) => {...})` but Multiplayer.setHitHandler's type is `(targetId, fromId, fromName)`. Both item-3 (flashHit) and item-5 (server-authoritative hit) rewrite this exact callback — CONSOLIDATED in G0.
- RemotePlayer.setState is called at Game.ts:318 (markRemoteDead), :643 (create), :661 (update). Items 1 (NaN guard inside setState) and 5 (add `present`) both edit RemotePlayer — merged in task R0 (single owner of RemotePlayer.ts).
- markRemoteDead already passes state="dead"; RemotePlayer dead-branch fix keys on this — compatible.
- Bullets collision filter is `if (tgt.side === b.owner) continue;` (Bullets.ts:203). Bots all have side="bot", bot bullets owner="bot" → bots never damage bots. Ambient (item 8) needs alternating sides.
- bot.update(dt, this.player) has exactly ONE call site (Game.ts:757). Item 8 changes the signature to (dt, target|null); both the local call and the new ambient call must pass through G0/Bot owner.
- Avatar.applyTint(damage, hitFlash) and setOpacity exist and work (toFlatMaterial sets transparent:true). Confirmed.
- VoiceChat.setTalking lazily acquires mic + toggles track.enabled — voice-mode (item 6) needs no VoiceChat/InputManager change.
- Server "broadcast" fans out by opaque event name with no allowlist (index.ts:128-141) — chat (item 7) rides it with NO server change; only a 200-char client cap.

EXECUTION ORDER:
Phase A (parallel, no cross-deps): R0 (RemotePlayer), B0 (Bullets), I0 (InputManager), V0-HUD (voice toggle Index), C0-comp (ChatPanel component), MP0 (Multiplayer client: chat + present + state/died + sendHit rework), SRV0 (server AFK authority + Room.ts client transport).
Phase B (single owner, after the method-shape it consumes is known): G0 applies ALL Game.ts edits. G0 depends on R0 (flashHit/present API), B0 (no API change but ordering), MP0 (new Multiplayer methods/handlers it wires), and SRV0 (state/died handler shapes). Bot.ts ambient (item 8) is owned by BOT0 and G0 calls into it.
Phase C: Menu.tsx (item 8) MENU0 depends on G0 (ambient GameMode + GameOptions.featuredAnimal exist) and BOT0.

This keeps every non-Game.ts file single-owned and disjoint, and funnels the 7 features that touch Game.ts through one coherent edit pass.

================================================================
ITEM-BY-ITEM (what lands where)
================================================================

ITEM 1 — Invisible remote avatar (RemotePlayer.ts, owner R0; tiny Game.ts hook in G0)
Cause: NaN can latch into body.scale via the squash lerp and THREE silently drops a NaN-matrix mesh while the depthTest:false name Sprite keeps drawing. No guard scrubs it.
Fix (R0): (a) reject non-finite packets at top of setState — `if (![x,y,z,yaw,health,vx,vz,vy].every(Number.isFinite)) return;`. (b) after root.position is set (RemotePlayer.ts ~line 192) finite-guard it; if poisoned, reset to last snapshot and zero posError. (c) sanitize targetScale before the scale lerp (line 250) and clamp body.scale away from <0.05/NaN after it. (d) scrub body.rotation.x/z after the lean updates (lines 246-247). (e) add an explicit dead/!alive early-return branch after the falling branch (~line 210) that mirrors Player.ts:366-377: setOpacity(0), body.scale.setScalar(0.0001), shadow.setVisible(false), runAudioInference(dt), return — so the body is visible on EVERY alive frame and hidden ONLY when truly dead/falling.

ITEM 2 — Janky remote movement (RemotePlayer.ts, owner R0)
Cause: double correction — computeTargetPos interpolates toward newest snapshot AND setState re-seeds posError every 50ms against the RAW snapshot (a different point than the rendered interpolation), so the two fight; buffer cap of 3 (~100ms) barely covers INTERP_DELAY_MS=80, causing per-frame flips between interpolate/extrapolate.
Fix (R0): raise buffer cap 3→8 (line 152). In setState, push the snapshot FIRST, then seed `if (this.hasState) this.posError.copy(this.root.position).sub(this.computeTargetPos());` (computeTargetPos is side-effect-free — returns a fresh Vector3). Keep CORRECTION_HALF_LIFE and INTERP_DELAY_MS unchanged (do NOT raise INTERP_DELAY_MS — the bigger buffer only widens the window, visible latency unchanged).

ITEM 3 — Missing remote damage tint (RemotePlayer.ts owner R0 + Game.ts hook in G0)
Cause: applyTint is always called with hitFlash=false (line 200-203); the victim's white pop is never networked/inferred on observers.
Fix (R0): add `private hitFlashTimer = 0;` + `flashHit(){ this.hitFlashTimer = 0.18; this.targetScale.set(1.35,0.7,1.35); }`. In update step 4: decrement the timer and pass `hitFlash = this.hitFlashTimer > 0` to avatar.applyTint.
Fix (G0): in the hit handler, when a hit names a remote target id, call `this.remotePlayers.get(target)?.flashHit();`. NOTE this handler is the SAME callback that item 5 rewrites server-authoritative — consolidated in G0 (see gameDotTsPlan, "hit handling"). The flash is driven off whatever the hit relay/authority surfaces as the target id.

ITEM 4 — Shots not visible + bullet max range (Bullets.ts owner B0; Game.ts anchor in G0)
Finding: spawnVisual's render path is byte-identical to spawn(); no invisibility defect. Perceived detachment is the 80ms interp offset between the absolute muzzle origin and the interpolated remote gun.
Fix (B0): add `traveled`+`maxRange` to the Bullet interface; `import { HEARING_RADIUS } from "./consts"`; `const BULLET_MAX_RANGE = 2 * HEARING_RADIUS;`; set `traveled:0, maxRange:BULLET_MAX_RANGE` in BOTH spawn() and spawnVisual(); in update(), after the XZ move, accumulate `b.traveled += Math.hypot(b.velocity.x*dt, b.velocity.z*dt)` and `if (b.traveled >= b.maxRange){ this.removeAt(i); continue; }`. Runs unconditionally so local + visual bullets cap identically. (The reverse-loop removeAt+continue is already correct.)
Fix (G0, polish): in the shot handler, if a RemotePlayer exists for e.id, anchor the visual spawn origin to that avatar's rendered x/z (`remotePlayers.get(e.id)?.root.position`) keeping e.origin.y, so the tracer leaves the visible remote gun. Range cap requires no Game.ts change.

ITEM 5 — AFK/laggy/disconnected players persist as killable server-driven avatars (server SRV0 + Room.ts/Multiplayer MP0 + RemotePlayer R0 + Game.ts G0)
This is the one substantial server change; keep it BOUNDED: server owns ONLY existence (grace TTL), health, and alive — NO movement physics. Movement still rides each player's own "s" frames.
Decision (bandwidth): DO NOT add a second 20Hz authoritative "state" fan-out on top of "s" (the risk note flags doubling traffic into the token bucket / Shard Cloud abuse pause). INSTEAD, keep the existing "s" relay as the movement/position channel, and make the server OVERWRITE health/alive on each relayed "s" with its authoritative values, plus a low-frequency authoritative "roster"/grace channel for existence + present flag. Concretely:
 - PROTOCOL (protocol.ts): add ClientMsg `{t:"hit"; target:string}` and add "hit" to CLIENT_TYPES (line 58). The shooter now reports the hit to the SERVER (authority), not via broadcast fan-out. Keep presence for the leaderboard.
 - SERVER STATE (rooms.ts): introduce a per-room Player registry that OUTLIVES the socket: `players: Map<room, Map<id, Player>>` where Player = { id, sock: Sock|null, meta, lastS: NetSnapshot|null, health, alive, deadAt, graceUntil, lastSeen }. join(): if a Player exists for the id (reconnect within grace) REUSE it (keep health/alive/lastS, rebind sock, graceUntil=Infinity); else create fresh (health=10, alive=true). leave(): do NOT delete — set sock=null, graceUntil=now+GRACE_MS, keep lastS. recordState(id, snap): store lastS + lastSeen (server takes health/alive from its OWN fields). applyHit(room, targetId): if target alive → health=max(0,health-1); at 0 → alive=false, deadAt=now; returns {died,x,z}. Owner-respawn: when an owner's "s" reports alive=true after being dead, reset health=10, alive=true (non-adversarial, bounded). Constants MAX_HEALTH=10, GRACE_MS=45000.
 - SERVER LOOP (index.ts): on "broadcast" event "s": call hub.recordState, then OVERWRITE payload.health/alive from the authoritative Player BEFORE fan-out (cheapest path — keeps RemotePlayer's existing "s" handler working while making health authoritative). On new "hit": hub.applyHit; if died, broadcast the existing "died" event (id,x,z) so all observers run the death FX. Replace the old victim-self-damage path. close handler: hub.leave sets grace (no immediate delete, no immediate presence-removal). "leave" msg: set graceUntil=now (graceful quit removes immediately). Add a 1s sweep (NOT on the 30s heartbeat) that deletes players whose graceUntil<now (and dead+no-socket past a short DEAD_TTL) and only THEN broadcasts presence removal. Add "hit" to the token-bucket throttle so a malicious shooter can't spam-kill.
 - PRESENCE→present: presence stays for leaderboard; to mark live-vs-grace, include a `present` boolean in each player's presence meta (sock!=null && OPEN). Client reads it.
 - CLIENT Room.ts (MP0-adjacent, owner SRV0 since it is the transport contract): add a typed send for {t:"hit",target} (or route it through broadcast with a dedicated path); LocalRoom must EMULATE applyHit/grace in-process so ?local=1 two-tab damage/persistence testing still works.
 - CLIENT Multiplayer.ts (MP0): change sendHit to emit {t:"hit",target} instead of broadcast "hit"; REMOVE the onPresence prune loop (lines 160-164) so presence absence no longer deletes avatars; surface `present` on NetState (and on the remote state map). Keep the "died" handler.
 - CLIENT RemotePlayer.ts (R0): add a present flag setter; when present===false, zero vx/vz/vy and freeze dead-reckoning so the avatar stands STILL (no drift/flicker) while remaining a killable BulletTarget (takeHit unchanged → relays the hit, server applies it). When present flips back true, resume normally.
 - CLIENT Game.ts (G0): updateMultiplayer — STOP disposing a RemotePlayer on single-frame absence (loosen lines 696-706): only dispose when the player is truly GONE (server dropped it after grace = not in presence/state at all). For present:false players, feed lastS pos with zero velocity and call rp.setPresent(false). Apply server-authoritative health/alive to the LOCAL player from the self entry (reconcile down / trigger local death if server says alive=false). Drive death FX from the authoritative "died" event (already wired). Rewrite the hit handler: it no longer self-applies damage on the local victim (server owns it) — it routes flashHit to the named remote (item 3) and lets server health flow back. Keep the existing kill-attribution/gore fallback but gate it on server alive flips.

ITEM 6 — Voice starts muted, G=push-to-talk, mic button=always-on (Game.ts G0 + Index.tsx V0-HUD)
Purely additive; default already muted (G not held). NO InputManager/VoiceChat change.
Fix (G0): add `const VOICE_MODE_KEY = "voxelcube:voice:mode";`, `export type VoiceMode = "ptt" | "open";`, a `private voiceMode` field initialized from localStorage (default "ptt", wrapped in try/catch). In updateVoice: `const wantTalk = this.voiceMode === "open" ? true : this.input.isVoiceHeld(); const talk = wantTalk && this.player.isAlive();`. Add getVoiceMode()/setVoiceMode(mode) (persist + call updateVoice() + notifyStats() synchronously so the click gesture satisfies getUserMedia). Add `voiceMode` to GameStats and to BOTH notifyStats emit objects.
Fix (V0-HUD, Index.tsx): import MicOff + type VoiceMode; add voiceMode:"ptt" to INITIAL_STATS; in the voice center-column block make the pill reflect "open" mode ("Microfone ligado", red) and add a toggle button between the pill and the gear that calls gameRef.current.setVoiceMode(toggle) and shows Mic (open) / MicOff (ptt). Mode flows ONLY through GameStats.voiceMode (no separate React state).

ITEM 7 — Remove "VoxelCube" brand text + real-time left-side chat below the player count (Index.tsx V0-HUD + new ChatPanel C0-comp + Multiplayer MP0 + Game.ts G0 + InputManager I0). NO server change.
Fix (V0-HUD, Index.tsx): delete the brand pill (lines 142-150; keep the left column wrapper at 141 and KEEP the Box import — still used by the loading overlay line 375). Mount `{stats.mode === "multiplayer" && <ChatPanel game={gameRef} username={settings.username} />}` inside the left column AFTER the connection badge (after line 170). Guard the existing window keydown (lines 96-101) so Esc/P don't fire while a chat input is focused (check document.activeElement?.tagName !== "INPUT").
Fix (MP0, Multiplayer.ts): add `ChatEvent {id,name,text}`, onChat field, setChatHandler, an onMessage "chat" handler (id-guarded for the LocalRoom path), and sendChat(text) that trims + slices to 200 chars and broadcasts "chat".
Fix (G0, Game.ts): import ChatEvent; add onChatMessage field; in registerNetHandlers wire `this.mp.setChatHandler((e)=>this.onChatMessage?.(e))`; add public setChatListener(cb), sendChat(text) (no-op when mp undefined), setInputEnabled(enabled)→this.input.setEnabled(enabled).
Fix (I0, InputManager.ts): add `private enabled = true;` + `setEnabled(on){ this.enabled = on; if(!on) this.clearKeys(); }`; early-return at the top of onKeyDown AND onKeyUp when !enabled (before any preventDefault) so a focused chat input receives raw characters and no game key fires.
Fix (C0-comp, new src/components/hud/ChatPanel.tsx): scrollable last-~8 message list + input (maxLength 200). Enter sends via game.sendChat and appends own message locally (server never echoes the sender). onFocus→game.setInputEnabled(false), onBlur→game.setInputEnabled(true), Escape blurs. pointer-events-auto root styled like Leaderboard.tsx. Width ~w-56 to match the connection badge column.

ITEM 8 — Dynamic menu: blurred live game bg with bots fighting + a jumping featured avatar (Game.ts G0 + Bot.ts BOT0 + Bullets.ts B0 + Menu.tsx MENU0)
Approach: add an "ambient" GameMode so the menu bg is the REAL game (no visual drift), skipping Player/input/MP/voice/stats.
Fix (G0, Game.ts): add "ambient" to GameMode; add `featuredAnimal?: string` to GameOptions; add an `if (this.mode === "ambient") { this.buildAmbient(); this.markReady(); } else if (...)` branch in the constructor; guard the onWheel listener registration with `if (this.mode !== "ambient")`; add `private featured: Bot | null = null;` + buildAmbient() (buildWorld(seedFromTime), spawn ~6 bots with alternating sides, create the featured Bot in behavior:"ambient"), nearestTargetFor(bot) (closest alive other bot, skip self/featured), updateAmbientCamera(dt) (slow orbit around platform center, never reads this.player), and isolate the ambient path at the TOP of runLoop's loop body so it ONLY runs bots (each fed nearestTargetFor), featured.update(dt,null), particles, gore-on-bot-death, updateAmbientCamera, render — and returns before any player/MP/stats code. dispose(): this.featured?.dispose().
Fix (BOT0, Bot.ts): add optional constructor params `animal?: string` (use in the Avatar ctor) and `behavior: "hunt"|"ambient" = "hunt"`; change update(dt, target) signature from `player: Player` to `target: BulletTarget | null` (the local call site in G0 passes this.player); replace player.position/isAlive references with the passed target; behavior==="ambient" → ignore targets, wander + force periodic jumps, make takeHit/die no-ops (immortal showcase actor); for fighting bots, alternate `side` so bot bullets can damage other bots.
Fix (B0, Bullets.ts): the side filter is `tgt.side === b.owner`. For ambient bot-vs-bot, the bots are assigned alternating sides ("player"/"bot") by BOT0/G0 so their bullets hit the opposite-side bots. No Bullets logic change is strictly required if sides alternate; if a cleaner id-based self-exclusion is preferred, B0 may add it — but the minimal, safe approach is alternating sides (no change to the shared damage path used by real gameplay). Owner B0 confirms the filter and documents the chosen mechanism.
Fix (MENU0, Menu.tsx): useRef + useEffect that ModelLibrary.preload() then news a Game in "ambient" mode into a bgRef div (featuredAnimal: ModelLibrary.randomAnimalName()), g.start(), dispose on cleanup (mirror Index.tsx lifecycle; cap pixelRatio for the ambient instance). Insert a blurred full-bleed `<div ref={bgRef} className="absolute inset-0 -z-10" style={{filter:"blur(7px) saturate(1.05)", transform:"scale(1.06)"}} />` + a translucent gradient tint as the FIRST children of the root div, behind the existing card. Do NOT call setStatsListener/setOnReady.

RISKS/SEQUENCING are summarized in the risks array. The single biggest correctness coupling is the HIT handler at Game.ts:193 — items 3 and 5 BOTH rewrite it; it is owned exclusively by G0.

## Protocol Additions

WS / NetState / event additions (single source of truth = server/src/ws/protocol.ts, mirrored in src/game/net/Room.ts + Multiplayer.ts):

1) CHAT (item 7) — NO protocol/server change. Rides the existing generic `broadcast` fan-out by opaque event name (server/src/ws/index.ts:128-141 has no event allowlist). New event name "chat" with payload `{ id: string; name: string; text: string }` (text client-capped to 200 chars; server never echoes to sender so the sender appends its own message locally). Wired exactly like "shot"/"dash"/"jump"/"died": Multiplayer.sendChat + setChatHandler + onMessage "chat" (id-guarded for LocalRoom). LocalRoom (BroadcastChannel) already relays it.

2) AFK AUTHORITY (item 5) — bounded protocol change:
 ClientMsg additions (protocol.ts):
  - { t: "hit"; target: string }  — shooter reports the hit to the SERVER (server is damage authority). Add "hit" to CLIENT_TYPES (protocol.ts:58) and to the token-bucket throttle in index.ts (so {t:"hit"} cannot be spammed to mass-kill).
 ServerMsg: NO new top-level frame. Decision: do NOT add a separate 20Hz authoritative "state" fan-out (avoids doubling per-tick traffic into the Shard Cloud token bucket). Instead:
  - The existing relayed "s" broadcast carries movement; the server OVERWRITES payload.health and payload.alive with its authoritative Player values BEFORE fan-out. RemotePlayer's existing "s" handler keeps working; health/alive become authoritative with zero new frames.
  - Death uses the EXISTING "died" broadcast event `{ id, x, z }`: when hub.applyHit drops a player to 0, the server emits "died" so every observer runs the death FX. (No new death frame needed.)
  - Existence/grace + present: the player stays in the room's presence roster during the GRACE_MS window after socket close; add a `present: boolean` field into each member's presence meta (true iff sock!=null && OPEN). The client reads `present` from presence to decide live-vs-still avatar. Presence removal is delayed until grace expiry (a 1s sweep), so avatars no longer vanish on socket close.
 Server Player record (rooms.ts, in-memory only): { id, sock: Sock|null, meta, lastS: NetSnapshot|null, health:number, alive:boolean, deadAt:number, graceUntil:number, lastSeen:number }. Constants: MAX_HEALTH=10, GRACE_MS=45000, sweep interval 1000ms, DEAD_TTL ~5000ms.
 Client NetState (Multiplayer.ts) gains `present: boolean`. The onPresence prune loop (Multiplayer.ts:160-164) is REMOVED so presence absence stops deleting render-states; existence is driven by the (now grace-aware) presence + the server's authoritative health/alive on "s".
 Room.ts: add a typed path to send {t:"hit",target}; LocalRoom emulates applyHit + grace in-process for ?local=1 testing.

3) HIT PATH MIGRATION (items 3 + 5 interaction): the OLD broadcast "hit" → victim-self-applies path is REPLACED by {t:"hit"} → server applyHit. The client hit handler at Game.ts:193 stops self-damaging the local victim; the local victim's health/alive now come from the authoritative "s" reconcile. The same handler routes flashHit to the named remote target for instant damage tint (item 3). Ship server + client together (single Shard Cloud node deploy) — mixed old/new clients would mismatch the hit model.

No other protocol changes. Voice (item 6) uses no network at all beyond existing VoiceChat.setTalking.

## Game.ts consolidated edits (single owner)

CONSOLIDATED src/game/Game.ts EDITS — applied by a SINGLE owner (task G0). Grouped; line numbers are from the current file.

A) IMPORTS / TYPES / CONSTANTS (top of file ~lines 21-44)
  - Add `import type { ChatEvent } from "./net/Multiplayer";` (and ensure BulletTarget type is importable from "./Bullets" for nearestTargetFor return type).
  - Line 39: `export type GameMode = "local" | "multiplayer";` → add `| "ambient"`.
  - Line 39 area: `export type VoiceMode = "ptt" | "open";`.
  - GameOptions (41-44): add `featuredAnimal?: string;`.
  - Near TOP_SCORE_KEY (line 33): `const VOICE_MODE_KEY = "voxelcube:voice:mode";`.

B) FIELDS (near lines 75, 113)
  - `private voiceMode: VoiceMode = (() => { try { return localStorage.getItem(VOICE_MODE_KEY) === "open" ? "open" : "ptt"; } catch { return "ptt"; } })();`
  - `private onChatMessage?: (e: ChatEvent) => void;`
  - `private featured: Bot | null = null;`  (item 8 showcase actor)

C) CONSTRUCTOR mode branch (180-226)
  - Make it `if (this.mode === "ambient") { this.buildAmbient(); this.markReady(); } else if (this.mode === "multiplayer") { ... } else { ... }`.
  - Guard the wheel listener (230-232): wrap in `if (this.mode !== "ambient") { ... addEventListener("wheel", ...) }`.

D) HIT HANDLING — THE CRITICAL CONSOLIDATION (currently lines 193-197)
  Replace the existing `this.mp.setHitHandler((target) => {...})` with the unified callback that serves items 3 AND 5:
   - Match Multiplayer.setHitHandler's real signature `(targetId, fromId, fromName)` (today's 1-arg callback is wrong).
   - Do NOT self-apply damage on the local victim anymore (server is authority, item 5). The local player's health/alive now come from the authoritative "s" reconcile in updateMultiplayer.
   - When `targetId` names a remote, call `this.remotePlayers.get(targetId)?.flashHit();` (item 3 instant tint).
  (After item 5 lands, the shooter sends {t:"hit"} to the server; the server emits "died" for kills. The flashHit cue is driven from the hit relay/echo the client still observes. If the chosen design no longer echoes "hit" to observers, surface the instant flash from the recentHits set the shooter already records at line 640-641, and/or from the authoritative health drop — but the primary, instant path is flashHit on the hit event.)

E) registerNetHandlers (287-305)
  - Add `this.mp.setChatHandler((e) => { this.onChatMessage?.(e); });` (item 7).
  - SHOT handler (289-294): anchor the visual tracer to the receiver-visible remote gun (item 4 polish):
      `const rp = this.remotePlayers.get(e.id); const ox = rp ? rp.root.position.x : e.origin.x; const oz = rp ? rp.root.position.z : e.origin.z; const origin = new THREE.Vector3(ox, e.origin.y, oz);` then spawnVisual(origin, dir, e.color); keep audio.playShot.

F) VOICE MODE (item 6)
  - updateVoice (560): replace `const talk = this.input.isVoiceHeld() && this.player.isAlive();` with `const wantTalk = this.voiceMode === "open" ? true : this.input.isVoiceHeld(); const talk = wantTalk && this.player.isAlive();`.
  - Add near setVoiceInputDevice (533): `getVoiceMode(): VoiceMode { return this.voiceMode; }` and `setVoiceMode(mode: VoiceMode) { this.voiceMode = mode; try { localStorage.setItem(VOICE_MODE_KEY, mode); } catch {} this.updateVoice(); this.notifyStats(); }`.

G) CHAT + INPUT BRIDGE (item 7) — public methods near setVoiceInputDevice (533)
  - `setChatListener(cb?: (e: ChatEvent) => void) { this.onChatMessage = cb; }`
  - `sendChat(text: string) { this.mp?.sendChat(text); }`  (no-op in local/ambient since mp is undefined)
  - `setInputEnabled(enabled: boolean) { this.input.setEnabled(enabled); }`

H) GameStats (949-966) + notifyStats (442-487)
  - Add `voiceMode: VoiceMode;` to GameStats.
  - Add `voiceMode: this.voiceMode,` to BOTH emit objects (the no-player neutral snapshot ~462 and the full snapshot ~482).

I) updateMultiplayer — AFK authority reconcile (item 5) (585-707)
  - Pass `present` into RemotePlayer: on create (643-655) and update (661-673) call rp.setState with the new present arg; for present===false also call `rp.setPresent(false)` (and setPresent(true) when present).
  - REMOVE/loosen the disposal loop (696-706): only dispose a RemotePlayer when the server has truly dropped the player (absent from presence AND state after grace), NOT on a single-frame "s" gap. Keep cleanup of recentHits/deadFx/remoteAlivePrev only on true removal.
  - Apply server-authoritative health/alive to `this.player` from the self entry the server reflects (reconcile health DOWN; if server alive=false → trigger local death). Keep client-side prediction for movement only.
  - Keep the existing "died"-driven FX (301-304) and the alive-flip gore fallback (684-690), now gated on the authoritative alive flips.

J) AMBIENT (item 8) — new private methods + runLoop isolation
  - `private buildAmbient()`: this.buildWorld(seedFromTime); spawn ~6 fighting bots (alternating side so bot-vs-bot damage works) via a small variant of spawnBot; create `this.featured = new Bot(id, platform, audio, dust, bullets, opts.featuredAnimal, "ambient")`, setSmoke, add to scene + this.bots-or-separate (keep featured OUT of nearestTargetFor candidates).
  - `private nearestTargetFor(bot: Bot): BulletTarget | null`: closest alive bot !== bot and !== featured; null if none.
  - `private updateAmbientCamera(dt: number)`: slow orbit around platform center; never reads this.player.
  - runLoop (753 loop body): at the very top, `if (this.mode === "ambient") { const dt = ...; for (const bot of this.bots) bot.update(dt, this.nearestTargetFor(bot)); this.featured?.update(dt, null); this.dust.update(dt); this.bullets.update(dt); this.smoke.update(dt); this.grassPoof.update(dt); this.fog?.update(dt); this.rain?.update(dt); this.decor?.update(dt); this.butterflies?.update(dt); this.gore.update(dt); /* gore on bot death */ for (const bot of this.bots) if (bot.consumeJustDied()) { const gy = this.platform.surfaceY(bot.root.position.x, bot.root.position.z); this.gore.spawn(bot.root.position, gy); } this.updateAmbientCamera(dt); this.renderer.render(this.scene, this.camera); this.rafId = requestAnimationFrame(loop); return; }` — fully isolated from player/MP/stats.
  - LOCAL bot call site (757): `for (const bot of this.bots) bot.update(dt, this.player);` must compile against the new `(dt, target: BulletTarget|null)` signature — this.player is a BulletTarget, so it is passed as-is (the local game keeps targeting the player).

K) dispose() (912-946)
  - Add `this.featured?.dispose();`.

Coupling notes for the G0 owner: section D is the one place items 3 and 5 collide — apply it once, as the unified server-authoritative + flashHit callback. Section I depends on RemotePlayer exposing setPresent and a present param on setState (delivered by R0). Section J depends on Bot's new (animal, behavior) ctor params and (dt, target) update (delivered by BOT0).

## Work Breakdown

### [R0] RemotePlayer: NaN-scrub + dead-branch + smooth interp + flashHit + present
- deps: none | serverChange: false | files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/RemotePlayer.ts

Item 1: reject non-finite packets at top of setState; finite-guard root.position after line 192 (reset to last snapshot + zero posError if poisoned); sanitize targetScale + clamp body.scale>=0.05 around the lerp at line 250; scrub body.rotation.x/z after 246-247; add explicit dead/!alive early-return branch after the falling branch (~210) mirroring Player.ts:366-377 (setOpacity(0), body.scale.setScalar(0.0001), shadow off, runAudioInference, return). Item 2: raise snaps cap 3->8 (line 152); in setState push snapshot FIRST then seed posError against computeTargetPos() (not the raw snapshot); leave INTERP_DELAY_MS/CORRECTION_HALF_LIFE unchanged. Item 3: add hitFlashTimer field + flashHit() (0.18s, targetScale 1.35/0.7/1.35); decrement in update step 4 and pass hitFlash=hitFlashTimer>0 to avatar.applyTint. Item 5: add present flag + setPresent(b) and a present param on setState; when present===false zero vx/vz/vy and freeze dead-reckoning (still, non-drifting, still killable). Owns RemotePlayer.ts exclusively.

### [B0] Bullets: max-range cap (= 2*HEARING_RADIUS) + confirm/define bot-vs-bot side mechanism
- deps: none | serverChange: false | files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Bullets.ts

Item 4: add `import { HEARING_RADIUS } from './consts'`; `const BULLET_MAX_RANGE = 2 * HEARING_RADIUS`; add traveled+maxRange to the Bullet interface; set traveled:0,maxRange:BULLET_MAX_RANGE in BOTH spawn() (~97) and spawnVisual() (~125); in update() after the XZ move accumulate b.traveled += Math.hypot(b.velocity.x*dt, b.velocity.z*dt) and `if (b.traveled >= b.maxRange){ this.removeAt(i); continue; }` (runs for ALL bullets). Item 8 support: confirm the collision filter is `tgt.side === b.owner` (line 203) — document that ambient bot-vs-bot is achieved by alternating bot `side` (no change to the shared damage path); only add id-based self-exclusion if you deliberately choose that route. Do NOT dispose BULLET_GEOM. Owns Bullets.ts exclusively.

### [I0] InputManager: enabled flag so chat input gets raw keys
- deps: none | serverChange: false | files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/InputManager.ts

Item 7: add `private enabled = true;` and `setEnabled(on){ this.enabled = on; if(!on) this.clearKeys(); }`. Early-return at the TOP of onKeyDown (line 40) AND onKeyUp (line 64) when !enabled, before any preventDefault/keys mutation, so a focused chat <input> receives W/A/S/D/G/Space/Enter as text and no game key fires; clearKeys on disable prevents stuck keys. Owns InputManager.ts exclusively.

### [MP0] Multiplayer client: chat event + present + sendHit rework + remove presence prune
- deps: SRV0 | serverChange: false | files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/net/Multiplayer.ts

Item 7: add ChatEvent {id,name,text}, onChat field, setChatHandler, onMessage 'chat' (id-guarded), sendChat(text) (trim + slice 200, broadcast 'chat'). Item 5: add `present:boolean` to NetState and populate it from presence; REMOVE the onPresence prune loop (lines 160-164) so presence absence no longer deletes remote render-states; change sendHit(target) to emit the new {t:'hit',target} control frame instead of broadcast 'hit'; keep the 'died' handler. Owns Multiplayer.ts exclusively. NOTE: depends on SRV0 for the Room.ts {t:'hit'} send path + present-in-presence contract.

### [SRV0] SERVER + transport: server-authoritative health/alive/existence (AFK authority)
- deps: none | serverChange: true | files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/server/src/ws/protocol.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/server/src/ws/rooms.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/server/src/ws/index.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/net/Room.ts

SERVER CHANGE (item 5, bounded). protocol.ts: add ClientMsg {t:'hit';target:string}; add 'hit' to CLIENT_TYPES (line 58); add `present` semantics to presence meta. rooms.ts: introduce a per-room Player registry that outlives the socket (players: Map<room,Map<id,Player>> with sock|null, meta, lastS, health, alive, deadAt, graceUntil, lastSeen); join reuses on reconnect within grace (rebind sock, keep health/alive/lastS) else fresh health=10; leave sets sock=null + graceUntil=now+GRACE_MS (no delete, no immediate presence removal); recordState(id,snap); applyHit(room,target)->{died,x,z} (-1 dmg, alive=false at 0); owner-respawn resets health=10 on alive=true transition; sweepExpired (delete when graceUntil<now, or dead+no-socket past DEAD_TTL); buildPresence includes present=sock!=null&&OPEN. index.ts: on 's' broadcast call recordState then OVERWRITE payload.health/alive from the authoritative Player before fan-out; add case 'hit' -> applyHit + emit existing 'died' broadcast when died; add 'hit' to the token-bucket throttle; close handler -> leave sets grace (no instant presence removal); 'leave' msg -> graceUntil=now; add a 1s sweep timer (NOT the 30s heartbeat) that removes expired players then broadcasts presence. Constants MAX_HEALTH=10, GRACE_MS=45000. Room.ts (client transport): add a typed send for {t:'hit',target}; LocalRoom must EMULATE applyHit + grace + present in-process so ?local=1 two-tab testing of damage/persistence still works. SERVER + CLIENT ship together (single deploy). Owns these 4 files exclusively.

### [C0-comp] ChatPanel React component (new file)
- deps: G0 | serverChange: false | files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/components/hud/ChatPanel.tsx

Item 7: NEW component. Props { game: React.RefObject<Game|null>; username: string }. State: messages (cap last ~8) + draft. useEffect subscribes via game.current?.setChatListener(e => append) and cleans up with setChatListener(undefined) on unmount. Render a scrollable bubble list (auto-scroll to bottom) showing <b>{name}</b>: {text}; an <input maxLength=200>: Enter -> game.current?.sendChat(draft) + append own message locally (server doesn't echo sender; use the username prop) + clear; Escape -> blur. onFocus -> game.current?.setInputEnabled(false); onBlur -> game.current?.setInputEnabled(true). Root pointer-events-auto, styled like Leaderboard.tsx (rounded-[12px] border-[1.5px] border-game-border bg-game-panel/95 cozy-shadow + paper-grain), width ~w-56. New file, no overlap. Depends on G0 for setChatListener/sendChat/setInputEnabled to exist.

### [BOT0] Bot: target generalization + ambient/featured behavior + chosen animal
- deps: none | serverChange: false | files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Bot.ts

Item 8: add optional ctor params `animal?: string` (pass into the Avatar ctor at 87-91) and `behavior: 'hunt'|'ambient' = 'hunt'`. Change update() signature from (dt, player: Player) to (dt, target: BulletTarget|null); replace player.position/player.isAlive() references (250-253) with the passed target (aim/approach/shoot any entity = bot-vs-bot). behavior==='ambient': ignore targets, wander + force periodic jumps (reuse the jump block on a timer), make takeHit/die no-ops (immortal showcase). Support alternating `side` for fighting bots so bot bullets damage opposite-side bots (coordinate the concrete mechanism with B0). Owns Bot.ts exclusively. NOTE: the local call site (Game.ts:757) and the ambient call site both live in G0 — coordinate signature with G0.

### [G0] Game.ts SINGLE OWNER — applies the entire consolidated gameDotTsPlan
- deps: R0, B0, MP0, SRV0, BOT0 | serverChange: false | files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Game.ts

BOTTLENECK FILE — touched by items 1,2(hooks),3,4,5,6,7,8. Apply ALL edits in gameDotTsPlan: (A) imports/types (GameMode +ambient, VoiceMode, GameOptions.featuredAnimal, VOICE_MODE_KEY, ChatEvent import); (B) fields (voiceMode, onChatMessage, featured); (C) constructor ambient branch + guard wheel listener; (D) UNIFIED hit handler at 193-197 (server-authoritative: stop local self-damage; route flashHit to named remote) — the one place items 3 and 5 collide; (E) registerNetHandlers: setChatHandler wiring + anchor visual shot origin to remote gun (item 4 polish); (F) updateVoice voiceMode gating + getVoiceMode/setVoiceMode; (G) setChatListener/sendChat/setInputEnabled bridges; (H) GameStats.voiceMode + both notifyStats emits; (I) updateMultiplayer AFK reconcile (pass present to rp.setState/setPresent, stop single-frame disposal, apply server health/alive to local player); (J) ambient buildAmbient/nearestTargetFor/updateAmbientCamera + isolated runLoop ambient path + keep local bot.update(dt,this.player) compiling against new signature; (K) dispose featured. MUST be applied as ONE coherent pass by a single owner. FLAG: touches src/game/Game.ts (bottleneck) and consumes server contract from SRV0.

### [V0-HUD] Index.tsx: remove brand, mount ChatPanel, voice toggle button, voiceMode stat, chat-focus guard
- deps: G0, C0-comp | serverChange: false | files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/pages/Index.tsx

Item 7: delete the brand pill (lines 142-150; KEEP the left column wrapper at 141 and KEEP the Box import — still used by loading overlay line 375); mount {stats.mode==='multiplayer' && <ChatPanel game={gameRef} username={settings.username}/>} inside the left column after the connection badge (after line 170); import ChatPanel; guard the existing window keydown (96-101) so Esc/P don't fire while a chat <input> is focused (document.activeElement?.tagName !== 'INPUT'). Item 6: import MicOff + type VoiceMode; add voiceMode:'ptt' to INITIAL_STATS; in the voice center-column block (228-250) make the pill reflect open mode ('Microfone ligado', red) and insert a toggle button between the pill and the gear calling gameRef.current.setVoiceMode(toggle) showing Mic(open)/MicOff(ptt). Owns Index.tsx exclusively. Depends on G0 (setVoiceMode/setInputEnabled, GameStats.voiceMode) and C0-comp (ChatPanel exists).

### [MENU0] Menu.tsx: blurred ambient live-game background
- deps: G0, BOT0 | serverChange: false | files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/pages/Menu.tsx

Item 8: add useRef + useEffect that ModelLibrary.preload() then news a Game in 'ambient' mode into a bgRef div with featuredAnimal: ModelLibrary.randomAnimalName(), g.start(), dispose on cleanup (mirror Index.tsx lifecycle; cap pixelRatio for the ambient instance; do NOT call setStatsListener/setOnReady). Insert a blurred full-bleed <div ref={bgRef} className='absolute inset-0 -z-10' style={{filter:'blur(7px) saturate(1.05)', transform:'scale(1.06)'}}/> + a translucent gradient tint overlay as the FIRST children of the root div (54), behind the existing card. Owns Menu.tsx exclusively. Depends on G0 (ambient GameMode + GameOptions.featuredAnimal) and BOT0 (ambient behavior).

## Risks

- GAME.TS BOTTLENECK: items 1(hook),3,4,5,6,7,8 all edit src/game/Game.ts. Single owner (G0) must apply the consolidated gameDotTsPlan as ONE pass. The sharpest collision is the hit handler at Game.ts:193-197 — item 3 (flashHit on remote) and item 5 (server-authoritative, stop local self-damage) BOTH rewrite it. Today's callback also uses the wrong arity (1 arg vs the (targetId,fromId,fromName) type). Get this single callback right or you double-apply or drop damage.
- SERVER+CLIENT MUST SHIP TOGETHER (item 5): the hit model flips from victim-self-applies (broadcast 'hit') to server-authoritative ({t:'hit'} -> applyHit -> 'died'). A mixed deploy double-applies or never-applies damage. It is a single Shard Cloud node, so one combined deploy is feasible. SRV0 + MP0 + the G0 reconcile must land in lockstep.
- BANDWIDTH (item 5): the chosen design deliberately AVOIDS a second 20Hz authoritative 'state' fan-out (that would double per-tick traffic and risk the 80/s token bucket / Shard Cloud network-abuse pause). It instead overwrites health/alive on the existing 's' relay + uses a 1s grace sweep + the existing 'died' event. If a reviewer prefers a full 'state' frame, re-evaluate the bucket budget first.
- GRACE SWEEP TIMING (item 5): player-expiry MUST run on a dedicated ~1s timer, NOT the 30s heartbeat, or disconnected avatars linger up to 30s past GRACE_MS. Add 'hit' to the token bucket so a malicious shooter cannot spam {t:'hit'} to mass-kill (the bucket currently throttles only 'broadcast').
- RECONNECT IDENTITY (item 5): grace-window reuse relies on the client reusing its id across reconnect (ServerRoom already reuses this.id from the ws URL; id is generated once per session at Game.ts:185-188). A client that regenerated its id would orphan its grace avatar until timeout (brief double). Verify id persistence.
- BOT.UPDATE SIGNATURE (item 8): changing (dt, player) -> (dt, target: BulletTarget|null) affects the ONE existing call site (Game.ts:757) plus the new ambient call site — both inside G0. this.player satisfies BulletTarget so the local game keeps passing it; ensure it still compiles and the local game still targets the player.
- BOT-VS-BOT DAMAGE (item 8): Bullets filters `tgt.side === b.owner`; all bots share side='bot' so bot bullets never hit bots. The minimal, SAFE mechanism is alternating bot `side` for ambient fighters (no change to the shared damage path used by real gameplay). If id-based self-exclusion is chosen instead (B0), make sure it does not regress player-vs-bot or remote hit logic.
- AMBIENT DEREFERENCES this.player (item 8): buildWorld still constructs a Player; the ambient runLoop path MUST NOT touch this.player (use updateAmbientCamera, never updateCamera which copies this.player.root.position). InputManager is still constructed and attaches global listeners on the Menu — either skip InputManager wiring in ambient or rely on its key handlers being harmless on the menu (note Menu's username input: ambient InputManager preventDefault on WASD/Space could interfere with typing — verify or gate listener registration in ambient).
- AMBIENT AUDIO (item 8): ambient bots call audio.playShot/playJump/etc. After the first user gesture on the menu the AudioContext resumes and gunfire could blare behind the menu. Recommend a muted/no-op audio path for ambient, or accept silence-until-gesture; do not let the menu become loud.
- TWO RENDERERS (item 8): the ambient Game on the Menu plus the real Game on /play must not coexist — Menu's useEffect cleanup must dispose the ambient Game before navigate('/play'). Confirm dispose() fully tears down the ambient WebGLRenderer/canvas (Game.dispose 912-946 removes the canvas) to avoid context leaks across menu<->play.
- CHAT INPUT FOCUS (item 7): InputManager listens on window and preventDefaults WASD/Space; without I0's setEnabled guard, typing in chat both moves the player AND swallows the characters. Also Index's own window keydown (Esc/P -> pause, lines 96-101) must be gated on chat focus or Esc pauses instead of blurring. Verify W/A/S/D/G/Space/Enter type into the input and movement resumes (clearKeys) after blur.
- CHAT LOCAL ECHO (item 7): the server never echoes a broadcast to its sender (index.ts:140), so ChatPanel MUST append the local user's own message client-side on send (use the username prop) or sending looks like a no-op. LocalRoom path: the id-guard in the 'chat' handler prevents self-receipt there too.
- VOICE OPEN-MODE GESTURE (item 6): enabling always-on triggers VoiceChat.acquireMic on the first setTalking(true). setVoiceMode must run synchronously from the toggle onClick (which calls updateVoice -> setTalking) so the click gesture satisfies getUserMedia; do not defer to a later frame. Persisted 'open' auto-unmutes a returning user as soon as the world builds — intended, but the red pill + lit mic must make it visible. Wrap the localStorage read in try/catch (private mode).
- RENDER NaN ROOT CAUSE (item 1) is inferred from static analysis (headless WebGL renders blank per project memory). The defensive scrubbing fixes the symptom regardless of which upstream value goes non-finite, but confirm with a live two-tab repro + a console assert on body.scale/root.position finiteness; also confirm seeding posError against computeTargetPos() requires pushing the snapshot FIRST (computeTargetPos is side-effect-free — returns a fresh Vector3).
- ITEM 4 (a) HAS NO CODE DEFECT: spawnVisual is byte-identical to the working spawn(); shots ARE created/rendered. The perceived 'can't see shots' is the 80ms interp offset (tracer detached from the interpolated remote gun) + a tiny fast tracer. The anchor-to-remote-gun polish + the range cap address perception; do not chase a phantom invisibility bug. Confirm a 10u cap (=2*HEARING_RADIUS, HEARING_RADIUS=5) feels right vs the old ~35u BULLET_LIFE reach.

## Investigation details

### render
Three independent bugs, all in src/game/RemotePlayer.ts.

(1) INVISIBLE BODY — DEFINITIVE CAUSE: a NaN poisons body.scale via the deformation lerp, and only the body (not the name Sprite) is affected because the Sprite does NOT inherit body's local transform.
- Key deduction: the name Sprite is added to root at RemotePlayer.ts:113-114 and renders fine. It shares root's transform, so root.position is finite and on-screen. The body is also under root, so its WORLD position is fine. Therefore the body vanishes due to its OWN local transform (body.scale/rotation) — exactly what the Sprite escapes. That points at body.scale.
- The NaN source is computeTargetPos()/posError feeding root.position, then the body deformation reading stale/NaN-adjacent values. Concretely the fragile chain: setState (RemotePlayer.ts:147-149) seeds posError = root.position - newSnapshot. On the VERY FIRST setState before any update() has run (the create path in Game.ts:643-655 calls setState while root.position is still the THREE default (0,0,0), and hasState flips true), and computeTargetPos with n===1 returns the snapshot, so root.position = snapshot + posError. If any of vx/vz/vy or a snapshot field is ever non-finite (or two snapshots share an identical performance.now() t in a way the span guard mishandles), the position and then the speed-squash targetScale (RemotePlayer.ts:227-241) go NaN; body.scale.lerp(targetScale, SQUASH_LERP) at line 250 latches NaN PERMANENTLY (NaN propagates through every subsequent lerp), and THREE silently skips drawing a mesh with a NaN matrix while the depthTest:false / renderOrder:999 Sprite keeps drawing. There is no guard anywhere that scrubs NaN out of position/scale/rotation, so once poisoned the body never recovers. This is the robustness hole the prompt asks to close.
- Ruled OUT: (b) state never arrives 'dead'/'falling' on a normally-walking remote (local Player broadcasts state='alive'); (c) setOpacity is NOT a no-op — toFlatMaterial sets transparent:true (ModelLibrary.ts:205) so opacity works; (e) Y/ground is correct (footY=-HALF_HEIGHT mirrors Player; body feet land on surfaceY).

(2) JANK / 'travado' — DEFINITIVE CAUSE: double correction fighting. computeTargetPos (RemotePlayer.ts:332-370) already interpolates toward the newest snapshot. setState ALSO re-seeds posError every 50ms (line 147-149) as (renderedPos - rawNewestSnapshot), but rendered = interpolatedTarget + oldOffset references a DIFFERENT point than the raw snapshot, so the two corrections pull against each other; with CORRECTION_HALF_LIFE=0.1 the offset never settles before the next 20Hz snapshot re-seeds it -> continuous tug = stutter even at constant velocity. Also the snapshot buffer cap of 3 (line 152) only covers ~100ms while INTERP_DELAY_MS=80, so renderT frequently sits at the very edge / past the window and flips between interpolate and extrapolate branches each frame, adding micro-jitter.

(3) NO VISIBLE DAMAGE — DEFINITIVE CAUSE: applyTint is ALWAYS called with hitFlash=false (RemotePlayer.ts:200-203). The bright hit-flash that the victim shows locally (Player.takeHit sets hitFlashTimer, Player.updateColor passes hitFlash=true) is never networked and never inferred on observers. The only remote damage cue is a slow red drift from the health field, which lerps just 0.7*0.1 per HP and arrives 20Hz-delayed -> imperceptible. A 'hit' event already fans out through the relay (Multiplayer.sendHit/onHit, Multiplayer.ts:205-211) but RemotePlayer never consumes it to flash.

FIX:
FIX 1 — invisible body (defensive NaN scrubbing + never-hide-unless-truly-dead/falling):

In RemotePlayer.update(), right after computing root.position (after line 192), add a finite-guard that resets a poisoned transform to the last good snapshot instead of letting NaN latch:
  const p = this.root.position;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
    const last = this.snaps[this.snaps.length - 1];
    if (last) p.set(last.x, last.y, last.z);
    this.posError.set(0, 0, 0);
  }
And before the body.scale.lerp at line 250, sanitize targetScale and clamp body.scale away from zero/NaN:
  if (!Number.isFinite(this.targetScale.x) || !Number.isFinite(this.targetScale.y) || !Number.isFinite(this.targetScale.z)) this.targetScale.set(1,1,1);
  this.body.scale.lerp(this.targetScale, SQUASH_LERP);
  if (!Number.isFinite(this.body.scale.x) || this.body.scale.x < 0.05 ||
      !Number.isFinite(this.body.scale.y) || this.body.scale.y < 0.05 ||
      !Number.isFinite(this.body.scale.z) || this.body.scale.z < 0.05) {
    this.body.scale.set(1,1,1);
  }
Also scrub body.rotation after the lean updates (after line 247):
  if (!Number.isFinite(this.body.rotation.x)) this.body.rotation.x = 0;
  if (!Number.isFinite(this.body.rotation.z)) this.body.rotation.z = 0;
And guard setState inputs so bad packets can never enter the buffer (top of setState, before line 142):
  if (![x,y,z,yaw,health,vx,vz,vy].every(Number.isFinite)) return;
Finally, make the dead state explicit so the body is hidden ONLY when truly dead/falling: add a branch in update() before the alive deformation (after the falling branch ~line 210):
  if (this.state === "dead" || !this.alive) { this.avatar.setOpacity(0); this.body.scale.setScalar(0.0001); this.shadow.setVisible(false); this.runAudioInference(dt); return; }
This mirrors Player.update()'s dead branch (Player.ts:366-377) and removes the current half-rendered fallthrough; the body is now visible on EVERY alive frame regardless of upstream NaN.

FIX 2 — jank: stop the double correction. In computeTargetPos, raise the snapshot buffer cap from 3 to e.g. 8 (RemotePlayer.ts:152: `if (this.snaps.length > 8) this.snaps.shift()`) so the interpolation window comfortably exceeds INTERP_DELAY_MS. Then make posError seed against the value computeTargetPos WILL produce for the new buffer, not the raw snapshot: in setState (line 147-149) compute the new interpolated target AFTER pushing the snapshot and subtract THAT, i.e. push first, then `if (this.hasState) this.posError.copy(this.root.position).sub(this.computeTargetPos());` (move the push above the posError calc). This makes rendered==target at the seam (offset is exactly the interpolation discontinuity) so the two systems stop fighting. Keep CORRECTION_HALF_LIFE but it now decays a small, consistent offset -> smooth.

FIX 3 — damage feedback: drive a hit-flash on observers from the existing 'hit' relay.
- Add to RemotePlayer a `private hitFlashTimer = 0;` and a `flashHit()` method: `this.hitFlashTimer = 0.18; this.targetScale.set(1.35, 0.7, 1.35);` (mirrors Player.takeHit juice).
- In update step 4 (RemotePlayer.ts:199-203) decrement the timer and pass it: `if (this.hitFlashTimer > 0) this.hitFlashTimer -= dt; this.avatar.applyTint(Math.min(1,Math.max(0,1 - this.targetHealth/10)), this.hitFlashTimer > 0);`
- Wire it in Game.registerNetHandlers / setHitHandler: when a 'hit' event names a remote target, call `this.remotePlayers.get(target)?.flashHit();` so every observer sees the white pop the instant the shooter relays the hit (the hit event already fans out via Multiplayer, Room.ts broadcast). This makes remote damage instantly visible and is independent of the delayed health field.

files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/RemotePlayer.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Game.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/net/Multiplayer.ts
serverChange: false

### shots
BUG (a): I could NOT reproduce a code defect that makes the visual bullet invisible — the spawnVisual render path is functionally identical to the working local spawn(). Verified end-to-end:
- WIRE PROVEN: wrote a 2-client WS test against BOTH the local Elysia relay (ws://localhost:3000/ws?room=voxelcube-ffa) and PRODUCTION (wss://beroroyale.shardweb.app). In both cases client B received the relayed `shot` event with the payload fully intact: {origin:{x,y,z}, dir:{x,y,z}, color:"#fff8b0"}, stamped from the sender. The server (server/src/ws/index.ts:128-141) fans out by opaque event name with no allowlist; the token-bucket only drops sustained >80/s bursts (an isolated shot is never dropped).
- HANDLER PROVEN: Multiplayer.ts:174-176 routes `shot`→onShot when e.id !== this.id; Game.ts:289-294 setShotHandler builds Vector3s from the intact payload and calls this.bullets.spawnVisual(origin, dir, e.color) BEFORE audio.playShot, so even an audio throw can't un-spawn it. Handler is registered once (Game.ts:198) before mp.connect(); never overwritten.
- RENDER PATH PROVEN IDENTICAL: Bullets.spawnVisual (Bullets.ts:113-134) is byte-for-byte the same as spawn() (81-106) except `damaging:false` and the color source — same shared BULLET_GEOM, same MeshBasicMaterial opacity:1, same this.group.add(mesh) (group added to scene at Game.ts:172). The `if (b.damaging)` guard in update() (Bullets.ts:194-225) wraps ONLY the collision loop; movement (145-149), opacity (148-149), bounds (152-164), worldBlocker (167-173) and obstacle (176-190) checks ALL run unconditionally, so visual bullets DO move and render. flightY=origin.y (≈surfaceY+0.27, above terrain) so worldBlocker/blocksAt never kills it on frame 1; deterministic same-seed terrain on both clients. dir is always a clean horizontal unit vector (getAimDirection, Player.ts:353-356) so no NaN. BULLET_LIFE=1.6s → ~48 frames, never instant-expiry. bullets.update(dt) runs every unpaused frame (Game.ts:759).
Conclusion on (a): the visual bullet IS created and rendered. The remaining real-world cause of "can't see my shots" is a POSITION/INTERPOLATION MISMATCH, not invisibility: the shot is spawned at the shooter's true instantaneous muzzle (absolute coords sent over the wire), but the receiver draws the remote shooter avatar ~INTERP_DELAY_MS(80ms) in the past at an interpolated position (RemotePlayer.ts), so the bullet appears detached from / ahead of the visible remote gun. Combined with a tiny 0.1³ tracer flying 35 units (22 u/s × 1.6 s) it is very easy to miss at distance. The explicit fix is to anchor the visual bullet to the receiver-visible remote muzzle and to cap range (feature b), which also shortens far-away tracers so they read clearly.

FEATURE (b): cap ALL bullets to maxRange = 2 * HEARING_RADIUS (=10 world units). Track distance travelled from origin and expire at the cap, in both spawn() and spawnVisual() via the shared update() loop.

FIX:
src/game/Bullets.ts:
1) Add to the Bullet interface (after `damaging: boolean;`, ~line 13):
   `  /** XZ distance travelled so far. */
  traveled: number;
  /** Max XZ distance before forced expiry (= 2 * HEARING_RADIUS). */
  maxRange: number;`
2) Add the import at top: `import { HEARING_RADIUS } from "./consts";` and a module const near the other consts (~line 19): `const BULLET_MAX_RANGE = 2 * HEARING_RADIUS;`
3) In spawn() (the this.bullets.push at ~97-104) add `traveled: 0,` and `maxRange: BULLET_MAX_RANGE,` to the pushed object.
4) In spawnVisual() (the this.bullets.push at ~125-132) add `traveled: 0,` and `maxRange: BULLET_MAX_RANGE,` likewise.
5) In update() (after the per-frame XZ move at ~145-147, before/with the life check), accumulate and enforce range. Replace the move block:
   `      b.mesh.position.x += b.velocity.x * dt;
      b.mesh.position.z += b.velocity.z * dt;
      b.mesh.position.y = b.flightY;`
   with the same three lines plus:
   `      const stepX = b.velocity.x * dt;
      const stepZ = b.velocity.z * dt;
      b.traveled += Math.hypot(stepX, stepZ);
      if (b.traveled >= b.maxRange) { this.removeAt(i); continue; }`
   (compute stepX/stepZ before applying them to position, or recompute hypot from velocity*dt — both equivalent).

src/game/Game.ts (recommended fix for the perceived (a) detachment — anchor the visual tracer to the receiver-visible remote muzzle): in setShotHandler (~289-294), if a RemotePlayer for e.id exists, offset the spawn origin to that avatar's current rendered position/height instead of the raw e.origin (or lerp toward it), e.g. use this.remotePlayers.get(e.id) to read root.position for x/z and keep e.origin.y. Minimal version: keep e.origin but document the 80ms offset. This is optional polish; the range cap is the required change.

files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Bullets.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Game.ts
serverChange: false

### afk
Three independent failures, all rooted in "presence == live socket" + "victim-applies-own-damage":

1) DISAPPEAR. server/src/ws/index.ts:160-164 `ws.on("close")` calls `hub.leave(ws)` (rooms.ts:46-55) which deletes the socket from the room map immediately, then `broadcastPresence`. The client (Multiplayer.ts:155-164 onPresence) prunes `this.remote` for any id not in presence, and Game.ts:696-706 destroys any RemotePlayer whose id is absent from `getRemoteStates()`. So a socket close -> instant avatar removal. There is NO server-side concept of a player; presence IS the live socket set (rooms.ts:14-15 `Map<room, Map<id, Sock>>`).

2) FLICKER/TELEPORT. The server is a pure relay: it never stores the last NetState ("s" rides the opaque `broadcast` fan-out, protocol.ts:28-29). A laggy 20Hz sender produces sparse snapshots; RemotePlayer.ts dead-reckons (EXTRAP_MAX_MS=180ms cap, consts) then stalls — and if presence drops between snapshots the avatar is pruned and re-created (snap() at Game.ts:643-656), causing the teleport/flicker.

3) INVINCIBLE. Damage is fully trust-based: a shooter's RemotePlayer.takeHit (RemotePlayer.ts:122-126) only RELAYS `mp.sendHit` (Multiplayer.ts:205-211); the VICTIM applies its own damage in its own client (Game.ts:193-197 setHitHandler -> this.player.takeHit). A gone/laggy/AFK victim's client never processes the "hit", never decrements health, never broadcasts alive=false -> it can never die. Each hit = 1 dmg, MAX_HEALTH=10 (Player.ts:26,279-289).

APPROACH: Promote the server from a stateless relay to a per-room player registry that (a) stores the last NetState per player, (b) keeps the player present for a GRACE window after socket close as a still avatar, (c) tracks authoritative health/alive and applies "hit" itself so a player can die even with its client absent. Keep it bounded: server still does NO physics/movement — connection DRIVES movement via the player's own "s" frames; the server only OWNS existence (grace TTL), health, and alive, and re-emits the last snapshot so the avatar persists. Client stops pruning on presence/state absence and trusts server health/alive.

FIX:
PROTOCOL (server/src/ws/protocol.ts)
- Add ClientMsg type `"hit"`: `{ t: "hit"; target: string }` and add "hit" to CLIENT_TYPES set (line 58). The shooter now reports the hit to the SERVER instead of fan-out; server is the damage authority. (Keep relaying the old broadcast "hit" path off — see migration note in risks.)
- Add ServerMsg `"state"`: `{ t: "state"; states: PlayerState[] }` where PlayerState = `{ id, x, y, z, yaw, vx, vy, vz, grounded, name, animal, health, alive, state: "alive"|"falling"|"dead", present: boolean }`. This is the authoritative per-player snapshot fan-out (replaces trusting raw "s" for health/alive). Add `present` to indicate live-socket vs grace-window (still avatar).
- Add ServerMsg `"died"`: `{ t: "died"; id: string; x: number; z: number; by?: string }` — authoritative death broadcast.
- Extend `welcome` is unchanged. Presence stays for leaderboard meta but is NO LONGER the avatar-existence source.

SERVER STATE (server/src/ws/rooms.ts)
- New interface `Player { id; sock: Sock | null; meta; last: NetSnapshot | null; health: number; alive: boolean; deadAt: number; graceUntil: number; lastSeen: number }`. NetSnapshot = the 11 movement fields from "s".
- Replace `rooms: Map<room, Map<id, Sock>>` semantics: keep a `players: Map<room, Map<id, Player>>` that OUTLIVES the socket. `join()` sets `player.sock = s, graceUntil = Infinity`; if a Player already exists for that id (reconnect within grace), REUSE it (keep health/last/alive) and just rebind sock — this is what makes a laggy reconnect seamless (no re-spawn, no teleport).
- `leave(s)` (called on close): do NOT delete the Player. Set `player.sock = null; graceUntil = Date.now() + GRACE_MS`. Keep `last` so the avatar stays as a still snapshot.
- New method `recordState(id, room, snap)`: store `player.last = snap; lastSeen = now`. Server takes health/alive from its OWN fields, NOT the client's reported health (client health becomes advisory only).
- New method `applyHit(room, targetId, byId)`: if target Player exists and alive, `health = max(0, health-1)`; if `health<=0 && alive` -> `alive=false; deadAt=now; state="dead"`, return {died:true,x,z}. Server-authoritative: works even if target's sock is null/laggy.
- New method `respawn` trigger: when the OWNER's "s" frame reports `state==="alive"` with full intent OR an explicit respawn event, reset `health=MAX(10); alive=true`. Simplest: trust the owner's alive=true transition in their "s" to reset health to 10 (owner respawn is non-adversarial here; keep it bounded). Define `MAX_HEALTH = 10` server-side.
- `roster()`/presence unchanged for leaderboard.

SERVER TIMERS (server/src/ws/index.ts)
- New `setInterval` STATE_TICK at 20Hz per process: for each room, build PlayerState[] from `players` (present = sock!=null && readyState OPEN) and fan out one `{t:"state",states}` frame to all live sockets. This makes the server re-emit the last snapshot so silent/laggy players' avatars persist for everyone.
- Extend the existing heartbeat (index.ts:171-181): also sweep `players` and DELETE any whose `graceUntil < now` (socket gone AND grace expired) -> only then broadcast presence removal. Also delete on explicit `leave` after grace=0 (graceful quit removes immediately: in the "leave" client msg case set graceUntil = now).
- DEAD cleanup: a player dead for > DEAD_TTL (e.g. 5s) with no socket can be removed; a dead player WITH socket stays (they'll respawn).
- Constants: `GRACE_MS = 45_000`, `STATE_TICK_MS = 50`.

SERVER MESSAGE HANDLING (index.ts ws.on("message"))
- case "broadcast" event "s": call `hub.recordState(ws.id, ws.room, payload)` AND still fan out for low-latency (or rely solely on STATE_TICK; recommend: keep fanning the raw "s" for the local-feel low latency, but mark health/alive in it as server values by overwriting payload.health/alive from the Player before fan-out — cheapest path that keeps RemotePlayer's existing "s" handler working while making health authoritative).
- case "hit" (new): `const r = hub.applyHit(ws.room, m.target, ws.id); if (r?.died) hub.fanout died + the state tick will carry alive=false`. Remove reliance on the old broadcast "hit" -> victim path.

CLIENT — Multiplayer.ts
- Add `onMessage.state` handler consuming `{t:"broadcast"...}`? No — `state` is a top-level ServerMsg, so Room.ts must surface it. Add to Room.ts ServerRoom.onmessage switch a `case "state": this.handlers.onState?.(msg.states)` and add `onState?` + `onDied?` to RoomHandlers. Multiplayer registers `onState` -> rebuild `this.remote` map from authoritative states (id, x..., health, alive, present). KEY: stop pruning `this.remote` in onPresence (remove Multiplayer.ts:160-164 prune loop); avatar existence is now driven by `state` frames, not presence.
- `sendHit` (Multiplayer.ts:205-211): change to send `{t:"hit",target}` via a new Room method `sendControl`/dedicated path, instead of broadcast "hit". Drop setHitHandler trust path (Game.ts:193-197) — the victim no longer self-applies; server owns health and the local player's health comes from the authoritative `state` frame for self (add: server includes self in state; local Player.takeHit replaced by reading server health for the local player, OR keep local prediction but reconcile to server health/alive).
- Add `present` to NetState (Multiplayer.ts:5-24) and expose it.

CLIENT — Game.ts updateMultiplayer (585-707)
- Reconcile loop: build/update RemotePlayer from authoritative `state` frames. STOP destroying avatars when absent from a single frame (remove/loosen Game.ts:696-706): only dispose a RemotePlayer when the server says the player is GONE (not in the latest `state` set at all, i.e. grace expired). A `present:false` player stays rendered as a still avatar (feed last x/y/z with zero velocity so RemotePlayer holds position; RemotePlayer already handles a stale buffer, but force vx/vz/vy=0 so dead-reckoning doesn't drift).
- Local self: apply server-authoritative health/alive to `this.player` from the self entry in `state` (so a hit applied server-side while we were laggy actually kills us on reconnect). Reconcile: if server health < local health, snap local health down; on server alive=false -> trigger local death.
- Death: drive spawnDeathFx/markRemoteDead from the authoritative `t:"died"` frame instead of inferring from alive flag flips.

CLIENT — RemotePlayer.ts
- Add a `setStill()` / present flag: when `present===false`, zero velocities and freeze the buffer so the avatar is a still, KILLABLE target (takeHit still relays a hit -> now server applies damage even though owner is silent). No change to BulletTarget — still hittable.

files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/server/src/ws/protocol.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/server/src/ws/rooms.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/server/src/ws/index.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/net/Room.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/net/Multiplayer.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Game.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/RemotePlayer.ts
serverChange: true

### voice
Today voice is always push-to-talk: Game.updateVoice (src/game/Game.ts:558-564) computes `talk = this.input.isVoiceHeld() && this.player.isAlive()` and there is no way to make it persistently on. Default is already "muted" because G is not held at start (verified: InputManager.isVoiceHeld at src/game/InputManager.ts:135-137 just reads `keys.has("KeyG")`, and VoiceChat.setTalking at src/game/net/VoiceChat.ts:103-112 disables the mic track unless told otherwise). So the feature is purely additive: introduce a `voiceMode = "ptt" | "open"` on Game (default "ptt", persisted to localStorage), drive `talk` from the mode in updateVoice, expose getVoiceMode/setVoiceMode, surface the current mode in GameStats, and add a mic toggle button in the HUD next to the existing mic pill + gear. InputManager needs NO changes (G already works for PTT; in "open" mode G is simply ignored because talk is forced true). VoiceChat needs NO changes (setTalking already does exactly the right thing for both modes).

FIX:
EXACT CHANGES:

=== src/game/Game.ts ===
1) Add a localStorage key constant near the top (next to TOP_SCORE_KEY at line 33):
   `const VOICE_MODE_KEY = "voxelcube:voice:mode";`

2) Add a field + type next to `private lastTalking = false;` (line 75):
   ```
   private voiceMode: VoiceMode =
     (typeof localStorage !== "undefined" &&
       localStorage.getItem(VOICE_MODE_KEY) === "open")
       ? "open"
       : "ptt";
   ```
   (Wrap the read in try/catch-free guard as shown, or a small try/catch — private mode safe. Default "ptt" => muted.)

3) Export the type near GameMode (line 39):
   `export type VoiceMode = "ptt" | "open";`

4) In updateVoice (line 560) replace:
   `const talk = this.input.isVoiceHeld() && this.player.isAlive();`
   with:
   `const wantTalk = this.voiceMode === "open" ? true : this.input.isVoiceHeld();`
   `const talk = wantTalk && this.player.isAlive();`
   (In "open" mode, G is irrelevant; talk still gated on isAlive so dead players don't transmit, matching current behavior.)

5) Add public bridge methods next to setVoiceInputDevice (line 533-540):
   ```
   getVoiceMode(): VoiceMode {
     return this.voiceMode;
   }
   setVoiceMode(mode: VoiceMode) {
     this.voiceMode = mode;
     try { localStorage.setItem(VOICE_MODE_KEY, mode); } catch { /* ignore */ }
     // Apply immediately so the mic enables/disables without waiting a frame
     // and so the next stats emit reflects the new mode.
     this.updateVoice();
     this.notifyStats();
   }
   ```

6) Add `voiceMode` to the GameStats interface (after `talking: boolean;` at line 963):
   `voiceMode: VoiceMode;`

7) In notifyStats add `voiceMode: this.voiceMode,` to BOTH emitted objects (after `talking:` at lines 462 and 482).

=== src/game/InputManager.ts ===
NO CHANGE. isVoiceHeld (line 135-137) stays as the PTT source; ignored in "open" mode.

=== src/game/net/VoiceChat.ts ===
NO CHANGE. setTalking (line 103-112) already lazily acquires the mic and toggles track.enabled, which serves both modes.

=== src/pages/Index.tsx ===
1) Import the type and a "mic off" icon — change line 13-14 imports to include `MicOff` and update the Game import (line 17) to also import `VoiceMode`:
   `import { Game, type GameStats, type GameMode, type VoiceMode } from "@/game/Game";`
   and add `MicOff,` to the lucide-react import block (lines 2-15).

2) Add `voiceMode: "ptt",` to INITIAL_STATS (after `talking: false,` at line 41).

3) In the center-column voice block (lines 228-250), update the mic PILL label to reflect mode and add a toggle BUTTON between the pill and the gear. Replace the pill text logic (lines 238-239):
   - When `stats.voiceMode === "open"`: show "Microfone ligado" and treat as talking-styled (red) regardless of G.
   - When "ptt": keep existing "Falando..." / "Segure G para falar".
   Add a new toggle button right after the pill `</div>` (before the gear `<button>` at line 241):
   ```
   <button
     type="button"
     onClick={() => {
       const g = gameRef.current;
       if (!g) return;
       const next: VoiceMode = stats.voiceMode === "open" ? "ptt" : "open";
       g.setVoiceMode(next);
     }}
     aria-label={stats.voiceMode === "open" ? "Desligar microfone" : "Ligar microfone"}
     aria-pressed={stats.voiceMode === "open"}
     className={cn(
       "pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full border-[1.5px] cozy-shadow hover:bg-game-accent/10",
       stats.voiceMode === "open"
         ? "border-[#ff4d5e] bg-[#ff4d5e]/15 text-[#d83048]"
         : "border-game-border bg-game-panel/90 text-game-muted hover:text-game-accent",
     )}
   >
     {stats.voiceMode === "open"
       ? <Mic className="h-3.5 w-3.5" strokeWidth={2.5} />
       : <MicOff className="h-3.5 w-3.5" strokeWidth={2.5} />}
   </button>
   ```
   The existing gear button (lines 241-248) stays as-is, after this new toggle.

4) (Optional polish) In the control-hint line (lines 258-263) the "G falar" hint can be conditionally suppressed when `stats.voiceMode === "open"`, since G is irrelevant in that mode. Not required.

PERSISTENCE: handled in Game.setVoiceMode via VOICE_MODE_KEY; the HUD reads mode purely from GameStats.voiceMode (single source of truth), so no separate localStorage read in React is needed. On reload, Game's field initializer restores the saved mode and the first notifyStats propagates it to the HUD.

DEFAULT MUTED: voiceMode defaults to "ptt"; with G not held, talk is false => mic track disabled. Pill shows "Segure G para falar".

files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Game.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/pages/Index.tsx, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/InputManager.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/net/VoiceChat.ts
serverChange: false

### hud
FEATURE, not a bug. Two parts.

(a) Brand removal: the "VoxelCube" brand pill renders in src/pages/Index.tsx in the top-left "Brand + connection" column. The `<Box>` icon + the `<div>VoxelCube</div>` are at Index.tsx lines 142-150 (the text literal "VoxelCube" is at line 148). The online-players badge is the sibling block right below it at Index.tsx lines 151-170 (rendered only when stats.mode === "multiplayer"; shows `Online · N jogadores`). The left column is `<div className="flex flex-col items-start gap-2">` opening at line 141.

(b) Chat: the existing event-broadcast plumbing already supports adding a new event with NO server change. server/src/ws/index.ts case "broadcast" (lines 128-140) fans out any event by opaque name with no allowlist (confirmed by comment protocol.ts:41-42 "relays by opaque event name with no allowlist"); only the room NAME is allowlisted, not event names. So a new "chat" event rides the generic broadcast exactly like "shot"/"dash"/"jump"/"died". (Note: server applies a per-socket token bucket ~80 broadcasts/sec in ws/index.ts:18-20; chat is low-frequency so this is irrelevant, but client should still cap message length.)

The bridge pattern to mirror is the existing send*/set*Handler pairs in src/game/net/Multiplayer.ts (e.g. sendShot lines 214-220 / setShotHandler lines 114-116 / onMessage "shot" lines 174-177) and the Game wiring in registerNetHandlers (src/game/Game.ts lines 287-305). React reaches Game via gameRef in Index.tsx; Game already exposes imperative bridge methods (setVoiceInputDevice Game.ts:534, setStatsListener Game.ts:421, setOnReady Game.ts:431). I will follow the SAME imperative-callback bridge (Game.setChatListener(cb) for inbound + Game.sendChat(text) for outbound) rather than threading chat through the 20Hz GameStats snapshot — keeping chat off the per-frame stats object avoids re-rendering the whole HUD on every frame and avoids unbounded growth of the stats payload.

CRITICAL input-focus coordination: src/game/InputManager.ts attaches keydown/keyup to `window` (lines 16-17) and calls e.preventDefault() for Space/Arrows/WASD (lines 41-50); getMoveVector reads WASD (lines 95-98) and isVoiceHeld reads KeyG (line 136). Index.tsx also adds a window keydown for Escape/KeyP -> togglePause (lines 96-101). So while the chat <input> is focused, typing W/A/S/D/G/Space would (1) move/talk/jump and (2) be swallowed by preventDefault so the characters never reach the input. Fix: add an `enabled` flag to InputManager (default true) with setEnabled(b); when disabled, onKeyDown/onKeyUp early-return AND clearKeys() is called on disable so no key stays "stuck". Game exposes setInputEnabled(b) -> input.setEnabled(b) (and Game must also pause its own Esc/P handling, or simpler: Index guards its keydown handler with a `chatFocusedRef`). The React chat input's onFocus calls game.setInputEnabled(false) + sets chatFocusedRef=true; onBlur calls game.setInputEnabled(true) + chatFocusedRef=false. Use Enter to send + blur (or keep focus), Escape to blur.

FIX:
FILE 1 — src/pages/Index.tsx (brand removal): delete the brand pill `<div className="flex items-center gap-2.5 ...">...VoxelCube...</div>` (lines 142-150). Keep the wrapping left column `<div className="flex flex-col items-start gap-2">` (line 141) — it now holds the connection badge (151-170) and, below it, the new chat panel. Remove the now-unused `Box` import ONLY if no longer referenced — Box is still used by the loading overlay (lines 375) and was used by brand; after removal it is still used at line 375, so KEEP the Box import. Verify with grep before removing any import.

FILE 1 — src/pages/Index.tsx (chat mount): inside the left column `<div className="flex flex-col items-start gap-2">`, AFTER the connection badge block (after line 170, before the column closes at line 171), add `{stats.mode === "multiplayer" && <ChatPanel game={gameRef} />}`. Import the new component at top (near line 24): `import { ChatPanel } from "@/components/hud/ChatPanel";`. The top-left HUD wrapper has `pointer-events-none` (line 138); ChatPanel root must set `pointer-events-auto` so its input is interactive (same trick the Pause button uses at line 183). Add a `chatFocusedRef = useRef(false)` and guard the existing onKey handler (lines 96-101) with `if (chatFocusedRef.current) return;` so Esc closes/blurs chat instead of toggling pause while typing — pass a setter or the ref into ChatPanel. Simpler: ChatPanel manages focus and calls game.setInputEnabled, and Index's onKey checks document.activeElement?.tagName !== "INPUT" before handling Esc/P.

FILE 2 — src/game/net/Multiplayer.ts: add `export interface ChatEvent { id: string; name: string; text: string }` near the other event interfaces (after DiedEvent, ~line 50). Add private field `private onChat?: (e: ChatEvent) => void;` (~line 86). Add `setChatHandler(cb: (e: ChatEvent) => void) { this.onChat = cb; }` (next to setDiedHandler ~line 126). In connect() onMessage map (after the "died" handler, ~line 189) add: `chat: (payload) => { const e = payload as ChatEvent; if (e && e.id !== this.id) this.onChat?.(e); },` (note: server never echoes to sender per ws/index.ts:140, but the id-guard mirrors the other handlers for the LocalRoom path). Add method `sendChat(text: string) { const t = text.trim().slice(0, 200); if (!t) return; this.room.broadcast("chat", { id: this.id, name: this.name, text: t }); }` (next to sendDied ~line 233).

FILE 3 — src/game/Game.ts: add private field `private onChatMessage?: (e: ChatEvent) => void;` near onStatsChange (~line 113); import ChatEvent type from net/Multiplayer. In registerNetHandlers() (lines 287-305) add `this.mp.setChatHandler((e) => { this.onChatMessage?.(e); });`. Add public bridge methods near setVoiceInputDevice (~line 533): `setChatListener(cb?: (e: ChatEvent) => void) { this.onChatMessage = cb; }`, `sendChat(text: string) { this.mp?.sendChat(text); }`, and `setInputEnabled(enabled: boolean) { this.input.setEnabled(enabled); }`. (sendChat is a no-op in local/non-mp mode since this.mp is undefined — safe.)

FILE 4 — src/game/InputManager.ts: add `private enabled = true;`. Add `setEnabled(on: boolean) { this.enabled = on; if (!on) this.clearKeys(); }`. In onKeyDown (line 40) and onKeyUp (line 64) early-return `if (!this.enabled) return;` BEFORE any preventDefault / keys mutation, so a focused chat input receives raw characters and no game key fires.

FILE 5 (NEW) — src/components/hud/ChatPanel.tsx: new React component. Props: `{ game: React.RefObject<Game | null> }`. State: `messages: {id,name,text,key}[]` (cap last ~6-8 via slice), `draft: string`, `open` optional. useEffect registers `game.current?.setChatListener(e => setMessages(m => [...m, {...e, key: crypto.randomUUID()}].slice(-8)))` and cleans up with `setChatListener(undefined)` on unmount. Render: a scrollable column (max-h, overflow-y-auto, auto-scroll to bottom via a ref + scrollIntoView/scrollTop on messages change) of bubbles showing `<b>{name}</b>: {text}`; below it an `<input>` (maxLength=200) with onChange -> setDraft, onKeyDown handling Enter (preventDefault, game.current?.sendChat(draft); also locally append own message since server doesn't echo — push {id:'me',name:'Você'?,text} or read game id; clear draft) and Escape (blur). onFocus -> game.current?.setInputEnabled(false). onBlur -> game.current?.setInputEnabled(true). Root container `pointer-events-auto` + styling mirroring Leaderboard.tsx (rounded-[12px] border-[1.5px] border-game-border bg-game-panel/95 cozy-shadow, paper-grain overlay, w-56/w-64, font sizes [11-12px], text-game-ink / text-game-muted). Width to match the connection badge column width (~w-56). Because the local sender is not echoed by the server, append the local user's own message client-side on send (use game's own name; optionally expose game.getMyName() or pass settings.username down from Index via a prop).

NOTE on local echo for own messages: simplest is to pass the username into ChatPanel as a prop (Index already has settings.username) and append {name: username} locally on send. Avoids needing a getId/getName getter on Game.

files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/pages/Index.tsx, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/net/Multiplayer.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Game.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/InputManager.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/components/hud/ChatPanel.tsx
serverChange: false

### menu
Feature, not a bug. Recommended approach: add an "ambient" GameMode to the existing Game class so the menu background is the REAL game (same scene/sky/lighting/Platform/Decor/Bot/Avatar/particles/shadows/smoke/gore), guaranteeing it looks exactly like gameplay. Do NOT build a separate scene — that would drift visually. The blockers in the current code: (1) Game's constructor and runLoop are hard-wired to a controllable Player + camera-follow + HUD stats + (in MP) Multiplayer/Voice; (2) Bot.update(dt, player) ONLY targets the single Player and never fights other bots; (3) there is no auto-jumping showcase avatar. So the work is: branch Game into an ambient path that skips Player/input/MP/voice/stats, spawns extra bots, makes bots target the nearest entity (so they fight each other), drives one featured avatar via a tiny AI that walks+auto-jumps, frames a slow orbiting camera, and renders into a canvas that Menu blurs with CSS. Bot must gain a target-resolution hook so it attacks the nearest BulletTarget instead of only the player. Key files confirmed: Game.ts mode branch at lines 180-226, buildWorld 244-284, runLoop 742-897 (player.update at 756, bot loop 757, updateCamera 811, camera-follows-player 709-718), Bot AI/target logic 215-303 (dx/dz vs player.position at 250-253, aim 257-259, approach 261-267, shoot 270-274), Player auto-jump hook (input.consumeJump at 414). Bullets already supports registerTarget/spawn and bots vs player friendly-fire is by `side`, so bot-vs-bot needs the targeting change plus allowing bots to damage each other.

FIX:
1) src/game/Game.ts — extend the mode type and add an ambient branch.
- Line 39: `export type GameMode = "local" | "multiplayer";` -> add `| "ambient"`. (Menu's ModeCard list stays only local/multiplayer; ambient is set programmatically, never shown as a selectable card.)
- Constructor mode branch (currently `if (this.mode === "multiplayer") {...} else {...}` at 180-226): add a leading `if (this.mode === "ambient") { this.buildAmbient(); this.markReady(); }` and make the existing local/MP branches `else if`. buildAmbient() calls buildWorld(seedFromTime) then spawns ~6 bots via spawnBot() and creates the featured avatar (see below). Do NOT create Multiplayer/Voice/leaderboard timers in ambient.
- Add a private field `private featured: Bot | null = null;` (reuse Bot as the showcase actor — it already has Avatar + shadow + squash + jump + smoke + gore-on-death; simplest way to get "exactly like the game"). In buildAmbient, build the featured Bot from a chosen animal and store it; give it an "ambient" behavior flag so it wanders + auto-jumps and is immortal (never targeted, never shot, just performs). To force a specific animal, add an optional `animal?: string` param to the Bot constructor and pass it into `new Avatar(animal ?? ModelLibrary.randomAnimalName(), ...)` (Bot.ts line 87-91). Pass opts.featuredAnimal through GameOptions.
- runLoop (742-897): guard the player/MP/stats-heavy sections with `if (this.mode !== "ambient")`. Specifically: skip `this.player.update` (756), skip `if (this.mp) this.updateMultiplayer` (767), skip the kill-counting/lava-player/death-respawn/notifyStats blocks (775-889) — in ambient only run: bots update, dust/bullets/smoke/grassPoof/fog/rain/decor/butterflies/gore update (757-766), featured.update, gore on bot death (776-785) for the fighting juice, and updateCamera. Add `if (this.mode === "ambient") { for (const bot of this.bots) bot.update(dt, this.nearestTargetFor(bot)); this.featured?.update(dt, null); this.updateAmbientCamera(); this.renderer.render(...); this.rafId = requestAnimationFrame(loop); return; }` near the top of the loop body so the ambient path is fully isolated and never touches this.player (which is still constructed by buildWorld but parked off-screen / simply not updated; alternatively skip building Player in ambient by extracting the non-Player parts of buildWorld — see risks).
- Camera: add `private updateAmbientCamera(dt)` that slowly orbits a fixed look-at point at platform center (e.g. angle += dt*0.05; camera.position = center + offsetRadius*(cos,_,sin), camera.lookAt(center)). Reuse cameraOffset magnitude (106) for framing parity; do NOT call updateCamera() (709-718) since it follows this.player.
- start() (737-740): in ambient, this.platform exists synchronously after buildAmbient, so the existing `if (this.platform) this.runLoop()` already starts the loop — no change needed.
- dispose() (912-946): add `this.featured?.dispose();` and guard voice/mp/leaderboard cleanup (already null-safe via optional chaining).

2) src/game/Bot.ts — make bots fight each other + support an ambient/featured behavior + a chosen animal.
- Constructor: add optional 5th/6th params `animal?: string`, `behavior: "hunt" | "ambient" = "hunt"`. Use animal in the Avatar ctor (line 87-91). Store this.behavior.
- update(dt, target) (215): change the signature from `player: Player` to `target: BulletTarget | null` (the nearest enemy Game passes in). Replace `player.position` / `player.isAlive()` references (250-253) with `target?.position` / a generic alive check (add `isAlive()` to BulletTarget or pass only alive targets). The existing aim (257-259), approach (261-267) and shoot (270-274) logic then works against any entity, so bots shoot whichever entity Game hands them = bot-vs-bot fighting. For behavior==="ambient" (the featured avatar): ignore targets entirely, just wander (286-303 path) and force periodic jumps (reuse the jump block 277-285 unconditionally on a timer), and make takeHit a no-op / never die so the showcase actor is always present.
- Bullets friendly-fire: bots currently don't damage bots because Game only registers player+bots and bullets filter by side. Confirm Bullets target filtering: bot bullets must be allowed to hit other bots. If Bullets excludes same-side, add a check that bot bullets can damage bots whose id differs (or give ambient bots distinct sides like "red"/"blue"). Game.nearestTargetFor(bot) returns the closest OTHER registered, alive Bot (skip self, skip featured).

3) Game.nearestTargetFor(bot): iterate this.bots, compute XZ distance to bot.position, return the nearest alive one !== bot. Returns null if none (bot then wanders).

4) src/pages/Menu.tsx — mount the ambient Game behind the card and blur it.
- Add imports: `useRef`, `Game`, `ModelLibrary` (mirror Index.tsx lines 1-18).
- Add `const bgRef = useRef<HTMLDivElement>(null);` and a `useEffect` (copy the lifecycle shape from Index.tsx 61-120): `ModelLibrary.preload().then(() => { const g = new Game(bgRef.current!, { mode: "ambient", featuredAnimal: ModelLibrary.randomAnimalName() }); g.start(); })`; on cleanup `g.dispose()`. Guard with a cancelled flag exactly like Index. Do NOT call setStatsListener/setOnReady.
- In the JSX (currently the root div at 54), insert as the FIRST child, behind everything: `<div ref={bgRef} className="absolute inset-0 -z-10" style={{ filter: "blur(7px) saturate(1.05)", transform: "scale(1.06)" }} />` plus a soft tint overlay `<div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-[#ffe9f6]/55 via-[#ffd9ee]/45 to-[#f6e7d2]/60" />` so the existing card (z-auto, already has bg-game-panel/95) stays legible over the live blurred game. Keep the existing floating Box decorations and card untouched. The `transform: scale(1.06)` hides blur edge bleed.

Notes for correctness: ambient mode must NOT add the wheel-zoom listener behavior interfering with page scroll — guard onWheel registration (230-232) with `if (this.mode !== "ambient")`. Audio: ambient bots call audio.playShot/playJump etc.; the AudioContext stays suspended until a user gesture (armAudioResume 337-347 already handles this), so the menu is silent until the user interacts — acceptable; optionally pass a `muted` flag to skip audio entirely in ambient for a quiet menu.

files: /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Game.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Bot.ts, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/pages/Menu.tsx, /Users/robertojunior/Documents/dev/me/bero/bero-royale/src/game/Bullets.ts
serverChange: false
