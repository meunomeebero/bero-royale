import { createRoom, type Room } from "./Room";
import { VOICE_MUTED_KEY } from "../consts";

/**
 * Proximity push-to-talk voice for online multiplayer.
 *
 * - Signaling rides a pluggable {@link Room} (BroadcastChannel locally, the
 *   bundled WebSocket backend cross-machine); audio flows P2P over WebRTC (one
 *   RTCPeerConnection per peer).
 * - Uses the "perfect negotiation" pattern (polite/impolite by id) so offers /
 *   renegotiation (mic added lazily on first talk) never deadlock on glare.
 * - The mic is captured on the first talk and kept disabled except while the
 *   player holds the talk key (push-to-talk).
 * - Each peer's incoming volume is attenuated by world distance, so you only
 *   hear players within the voice radius.
 *
 * If mic permission is denied the player can still HEAR others (receive-only).
 */

const ROOM = "voxelcube-voice";
const ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

/** localStorage keys for the persisted device selection (shared with the modal). */
const LS_MIC = "voxelcube:voice:mic";
const LS_SPK = "voxelcube:voice:spk";

/** Shape of the GET /api/turn response (mirrors server/src/turn.ts). */
interface TurnResponse {
  iceServers?: RTCIceServer[];
}

interface PeerPos {
  x: number;
  z: number;
}

interface SignalPayload {
  from: string;
  to: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

interface Peer {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  audio: HTMLAudioElement;
  volume: number;
  /** ICE candidates received before remoteDescription was set (flushed later). */
  pendingCandidates: RTCIceCandidateInit[];
}

export class VoiceChat {
  active = false;
  private myId: string;
  private room: Room;
  private peers = new Map<string, Peer>();
  private localStream: MediaStream | null = null;
  private micRequested = false;
  private talking = false;
  /** Persisted device selection (applied to getUserMedia / setSinkId). */
  private inputDeviceId: string | null = null;
  private outputDeviceId: string | null = null;
  /** Merged ICE list (STUN + any TURN servers fetched from /api/turn). */
  private iceServers: RTCIceServer[] = ICE;
  private turnFetched = false;
  /** When true, every peer's audio element is hard-muted (Settings → mute voice). */
  private outputMuted = false;

  constructor(myId: string) {
    this.myId = myId;
    this.room = createRoom(ROOM, myId);
    // Restore the user's previously chosen devices so they apply from the very
    // first mic capture / first inbound stream.
    try {
      this.inputDeviceId = localStorage.getItem(LS_MIC);
      this.outputDeviceId = localStorage.getItem(LS_SPK);
      this.outputMuted = localStorage.getItem(VOICE_MUTED_KEY) === "1";
    } catch {
      /* storage may be unavailable (private mode) — defaults are fine */
    }
  }

  /**
   * Mute/unmute INCOMING proximity voice (you stop hearing teammates) and
   * persist the choice. Independent of the mic / push-to-talk: the player can
   * still transmit. Applied to every existing peer's audio element immediately.
   */
  setOutputMuted(muted: boolean) {
    this.outputMuted = muted;
    try {
      localStorage.setItem(VOICE_MUTED_KEY, muted ? "1" : "0");
    } catch {
      /* storage unavailable — in-memory flag still applies */
    }
    for (const peer of this.peers.values()) peer.audio.muted = muted;
  }

  connect() {
    void this.init();
  }

  /**
   * Bring-up: fetch TURN/ICE config FIRST so peer connections are created with
   * relay servers (not STUN-only). Creating peers before TURN arrives is the #1
   * cause of inaudible cross-network voice (symmetric NAT needs a relay). Then
   * join the signaling room.
   */
  private async init() {
    await this.fetchIceServers();
    this.room.track({ id: this.myId });
    this.room.connect({
      onStatus: (s) => {
        const wasActive = this.active;
        this.active = s === "online";
        // Transport just came back online after a reconnect window: any ICE /
        // offer frames sent while offline were dropped, leaving peers
        // half-negotiated. Recover only on the false->true transition.
        if (!wasActive && this.active) this.recoverPeers();
      },
      onPresence: (members) => this.syncPeers(members),
      onMessage: {
        sig: (payload) => void this.onSignal(payload as SignalPayload),
      },
    });
  }

  /** Push-to-talk: enable/disable the outgoing mic track (acquires mic lazily). */
  async setTalking(on: boolean) {
    this.talking = on;
    if (on && !this.micRequested) {
      this.micRequested = true;
      await this.acquireMic();
    }
    if (this.localStream) {
      for (const t of this.localStream.getAudioTracks()) t.enabled = on;
    }
  }

  isTalking() {
    return this.talking;
  }

  /** Set each peer's playback volume from world distance to the local player. */
  updateProximity(
    myPos: { x: number; z: number },
    getPeerPos: (id: string) => PeerPos | null,
    radius: number,
  ) {
    for (const [id, peer] of this.peers) {
      const p = getPeerPos(id);
      let vol = 0;
      if (p) {
        const d = Math.hypot(p.x - myPos.x, p.z - myPos.z);
        vol = d >= radius ? 0 : 1 - d / radius;
        vol = Math.max(0, Math.min(1, vol * 1.3));
      }
      peer.volume = vol;
      peer.audio.volume = vol;
    }
  }

  /** Mic constraints honoring the persisted device id (when one is selected). */
  private micConstraints(): MediaStreamConstraints {
    const audio: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
    };
    if (this.inputDeviceId) audio.deviceId = { exact: this.inputDeviceId };
    return { audio };
  }

  private async acquireMic() {
    try {
      this.localStream = await this.getUserMediaWithFallback();
      for (const t of this.localStream.getAudioTracks()) t.enabled = this.talking;
      // Add the mic track to every existing peer and force a fresh offer so the
      // remote side actually receives the track (onnegotiationneeded may be
      // skipped in some browsers when the connection is already in a non-stable
      // state — calling restartIce() is the safest way to guarantee a new offer).
      for (const [id, peer] of this.peers) {
        const added = this.addLocalTracks(peer.pc);
        // addTrack's implicit renegotiation can be skipped (non-stable state) or
        // its offer dropped while offline — send the offer EXPLICITLY so the
        // remote actually receives our audio track. restartIce() alone never
        // sends SDP, so it cannot deliver a newly-added track.
        if (added) void this.sendOffer(id, peer);
      }
    } catch {
      // Denied/unavailable: stay receive-only (can still hear others).
      this.localStream = null;
    }
  }

  /**
   * getUserMedia honoring the saved input device, with an OverconstrainedError
   * fallback: a previously-saved device that's now unplugged would throw, so we
   * clear the stale id and retry with the system default rather than failing.
   */
  private async getUserMediaWithFallback(): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia(this.micConstraints());
    } catch (err) {
      if (err instanceof Error && err.name === "OverconstrainedError" && this.inputDeviceId) {
        this.inputDeviceId = null;
        try {
          localStorage.removeItem(LS_MIC);
        } catch {
          /* ignore */
        }
        return await navigator.mediaDevices.getUserMedia(this.micConstraints());
      }
      throw err;
    }
  }

  /**
   * Fetch ICE servers (STUN + time-limited TURN) from the backend once and
   * merge them into the config used for new peer connections. On any failure we
   * keep the existing STUN-only {@link ICE} fallback so voice still attempts to
   * connect (works on the same network / non-symmetric NAT).
   */
  private async fetchIceServers() {
    if (this.turnFetched) return;
    this.turnFetched = true;
    try {
      const res = await fetch("/api/turn");
      if (!res.ok) return;
      const data = (await res.json()) as TurnResponse;
      if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
        this.iceServers = data.iceServers;
      }
    } catch {
      // Network/route error: keep the STUN fallback already in this.iceServers.
    }
  }

  /**
   * Switch the active microphone. Re-captures from the new device, swaps the
   * outgoing track on every peer via replaceTrack (addTrack if a sender doesn't
   * exist yet), preserves the push-to-talk enabled state, and persists the id.
   * Falls back to the default device on OverconstrainedError (unplugged device).
   */
  async setInputDevice(deviceId: string) {
    this.inputDeviceId = deviceId;
    try {
      localStorage.setItem(LS_MIC, deviceId);
    } catch {
      /* ignore */
    }
    let stream: MediaStream;
    try {
      stream = await this.getUserMediaWithFallback();
    } catch {
      return; // denied/unavailable — keep the previous stream (if any)
    }
    const oldStream = this.localStream;
    this.localStream = stream;
    this.micRequested = true;
    const newTrack = stream.getAudioTracks()[0] ?? null;
    if (newTrack) newTrack.enabled = this.talking;

    for (const [id, peer] of this.peers) {
      const sender = peer.pc
        .getSenders()
        .find((s) => s.track && s.track.kind === "audio");
      if (sender) {
        try {
          await sender.replaceTrack(newTrack);
        } catch {
          /* ignore — renegotiation will recover */
        }
      } else if (this.addLocalTracks(peer.pc)) {
        void this.sendOffer(id, peer); // a brand-new sender needs a fresh offer
      }
    }

    if (oldStream) {
      for (const t of oldStream.getAudioTracks()) t.stop();
    }
  }

  /**
   * Route playback to a specific speaker via HTMLMediaElement.setSinkId. Feature
   * -detected (unsupported in Firefox / older Safari → no-op). Applied to every
   * existing peer's audio element and persisted so future peers inherit it.
   */
  async setOutputDevice(deviceId: string) {
    this.outputDeviceId = deviceId;
    try {
      localStorage.setItem(LS_SPK, deviceId);
    } catch {
      /* ignore */
    }
    for (const peer of this.peers.values()) {
      await this.applySinkId(peer.audio);
      // A device switch can re-suspend playback — nudge it back.
      void peer.audio.play().catch(() => {});
    }
  }

  /** Apply the saved output device to one audio element (feature-detected). */
  private async applySinkId(audio: HTMLAudioElement) {
    if (!this.outputDeviceId) return;
    const el = audio as HTMLAudioElement & {
      setSinkId?: (id: string) => Promise<void>;
    };
    if (typeof el.setSinkId !== "function") return;
    try {
      await el.setSinkId(this.outputDeviceId);
    } catch {
      /* unsupported device / not permitted — keep default output */
    }
  }

  /**
   * Play a remote audio element, recovering from autoplay blocks by hooking the
   * next user-gesture event. Re-applies setSinkId before play so device changes
   * that happened while the element was paused are honoured immediately.
   */
  private async playAudio(audio: HTMLAudioElement) {
    await this.applySinkId(audio);
    try {
      await audio.play();
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        // Autoplay blocked by browser policy — wait for the next user gesture.
        console.warn("[VoiceChat] autoplay blocked; waiting for user gesture");
        const resume = () => {
          void audio.play().catch(() => {});
          document.removeEventListener("click", resume, true);
          document.removeEventListener("keydown", resume, true);
          document.removeEventListener("pointerdown", resume, true);
        };
        document.addEventListener("click", resume, { capture: true, once: true });
        document.addEventListener("keydown", resume, { capture: true, once: true });
        document.addEventListener("pointerdown", resume, { capture: true, once: true });
      } else {
        console.warn("[VoiceChat] audio.play() error:", err);
      }
    }
  }

  /**
   * Lighter restart: send an ICE restart offer for every peer whose connection
   * is not fully healthy. Cheaper than a full reconnect; good first attempt when
   * audio stops mid-session (e.g. network hiccup).
   */
  iceRestart() {
    for (const peer of this.peers.values()) {
      peer.pc.restartIce();
    }
  }

  /**
   * Full audio restart: stop the mic, close every peer connection, re-acquire
   * the mic (with the currently selected device), then reconnect the signaling
   * room so fresh peers are created for everyone present.
   *
   * This is the nuclear fix for "configured but inaudible":
   * - catches late getUserMedia + no renegotiation
   * - refreshes autoplay-blocked audio elements
   * - re-applies setSinkId to all new elements
   *
   * Exposed for the "Reiniciar áudio" button in VoiceSettingsModal.
   */
  async restart() {
    // Remember whether the mic was ever granted so we rebuild a SEND-capable
    // connection (not receive-only) even when the user isn't holding PTT.
    const hadMic = this.micRequested;

    // 1. Tear down existing mic tracks.
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) t.stop();
      this.localStream = null;
    }
    this.micRequested = false;

    // 2. Close every peer (audio elements included) so fresh connections form.
    for (const peer of this.peers.values()) {
      peer.pc.close();
      peer.audio.pause();
      peer.audio.srcObject = null;
      peer.audio.remove();
    }
    this.peers.clear();

    // 3. Force a FRESH TURN fetch + reset the signaling room so presence re-fires
    //    and peers are recreated with up-to-date relay servers.
    this.turnFetched = false;
    this.room.dispose();
    this.room = createRoom(ROOM, this.myId);
    this.active = false;
    this.connect();

    // 4. Re-acquire the mic if it was ever granted (or we're talking) so the
    //    rebuilt peers are sendrecv-ready instead of receive-only.
    if (hadMic || this.talking) {
      this.micRequested = true;
      await this.acquireMic();
    }
  }

  /** Currently selected device ids (for the settings modal to reflect state). */
  getDeviceIds(): { input: string | null; output: string | null } {
    return { input: this.inputDeviceId, output: this.outputDeviceId };
  }

  /**
   * Attach local mic tracks to a peer connection, skipping duplicates.
   * Returns true if at least one new track was added (caller can use this to
   * know whether renegotiation is needed).
   */
  private addLocalTracks(pc: RTCPeerConnection): boolean {
    const stream = this.localStream;
    if (!stream) return false;
    let added = false;
    for (const t of stream.getAudioTracks()) {
      if (!pc.getSenders().some((s) => s.track === t)) {
        pc.addTrack(t, stream);
        added = true;
      }
    }
    return added;
  }

  /**
   * Explicitly create + send an SDP offer to one peer. Needed after a local
   * track is added: addTrack's implicit `negotiationneeded` can be skipped while
   * the signaling state is non-stable, or its offer dropped while the room is
   * briefly offline, leaving the remote never hearing our audio. Glare-guarded.
   */
  private async sendOffer(remoteId: string, peer: Peer) {
    if (peer.makingOffer || peer.pc.signalingState !== "stable") return;
    try {
      peer.makingOffer = true;
      await peer.pc.setLocalDescription();
      if (peer.pc.localDescription) {
        this.send(remoteId, { description: peer.pc.localDescription });
      }
    } catch {
      /* ignore */
    } finally {
      peer.makingOffer = false;
    }
  }

  /**
   * After the transport returns to "online", restart ICE for any peer that
   * isn't fully connected. restartIce() re-fires onnegotiationneeded, so a
   * fresh offer is sent now that {@link active} is true again.
   */
  private recoverPeers() {
    for (const [id, peer] of this.peers) {
      const pc = peer.pc;
      const connected =
        pc.connectionState === "connected" ||
        pc.iceConnectionState === "connected" ||
        pc.iceConnectionState === "completed";
      if (!connected) {
        // Re-offer when we have a local track to send (an earlier offer may have
        // been dropped while the room was offline); otherwise just restart ICE.
        const sending = pc
          .getSenders()
          .some((s) => s.track && s.track.kind === "audio");
        if (sending) void this.sendOffer(id, peer);
        else pc.restartIce();
      }
      // A reconnect can leave the audio element paused / on the wrong sink — the
      // old recoverPeers only restarted ICE and never re-armed playback. Fix it.
      void this.applySinkId(peer.audio);
      void this.playAudio(peer.audio);
    }
  }

  private syncPeers(members: Map<string, unknown>) {
    const ids = new Set<string>(members.keys());
    ids.delete(this.myId);
    for (const id of ids) if (!this.peers.has(id)) this.createPeer(id);
    for (const id of [...this.peers.keys()]) if (!ids.has(id)) this.removePeer(id);
  }

  private createPeer(remoteId: string) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const audio = new Audio();
    audio.autoplay = true;
    audio.volume = 0;
    audio.muted = this.outputMuted; // honor Settings → mute voice for new peers
    audio.style.display = "none";
    document.body.appendChild(audio); // helps browsers honor autoplay of the stream
    void this.applySinkId(audio); // route to the saved speaker (feature-detected)
    const peer: Peer = {
      pc,
      polite: this.myId < remoteId, // deterministic polite/impolite
      makingOffer: false,
      ignoreOffer: false,
      audio,
      volume: 0,
      pendingCandidates: [],
    };
    this.peers.set(remoteId, peer);

    // Be ready to receive even before our mic exists; upgraded to sendrecv when
    // addTrack runs after acquireMic().
    if (this.localStream) this.addLocalTracks(pc);
    else pc.addTransceiver("audio", { direction: "recvonly" });

    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      audio.volume = peer.volume;
      void this.applySinkId(audio);
      void this.playAudio(audio);
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send(remoteId, { candidate: e.candidate.toJSON() });
    };
    pc.onnegotiationneeded = () => void this.sendOffer(remoteId, peer);
  }

  private removePeer(id: string) {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.pc.close();
    peer.audio.pause();
    peer.audio.srcObject = null;
    peer.audio.remove();
    this.peers.delete(id);
  }

  private async onSignal(payload: SignalPayload) {
    if (!payload || payload.to !== this.myId) return;
    let peer = this.peers.get(payload.from);
    if (!peer) {
      this.createPeer(payload.from);
      peer = this.peers.get(payload.from);
    }
    if (!peer) return;
    const pc = peer.pc;
    try {
      if (payload.description) {
        const offerCollision =
          payload.description.type === "offer" &&
          (peer.makingOffer || pc.signalingState !== "stable");
        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(payload.description);
        // remoteDescription is set — flush any ICE that arrived early.
        for (const c of peer.pendingCandidates.splice(0)) {
          try {
            await pc.addIceCandidate(c);
          } catch {
            /* ignore */
          }
        }
        if (payload.description.type === "offer") {
          await pc.setLocalDescription();
          if (pc.localDescription) {
            this.send(payload.from, { description: pc.localDescription });
          }
        }
      } else if (payload.candidate) {
        // Candidates can race ahead of the offer/answer — queue until ready.
        if (!pc.remoteDescription) {
          peer.pendingCandidates.push(payload.candidate);
          return;
        }
        try {
          await pc.addIceCandidate(payload.candidate);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore transient negotiation errors */
    }
  }

  private send(to: string, data: Record<string, unknown>) {
    if (!this.active) return; // not connected yet → would be dropped
    this.room.broadcast("sig", { from: this.myId, to, ...data });
  }

  dispose() {
    for (const [, peer] of this.peers) {
      peer.pc.close();
      peer.audio.pause();
      peer.audio.srcObject = null;
      peer.audio.remove();
    }
    this.peers.clear();
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) t.stop();
      this.localStream = null;
    }
    this.room.dispose();
    this.active = false;
  }
}
