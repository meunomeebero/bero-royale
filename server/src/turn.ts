import { createHmac } from "node:crypto";

import { TURN_SECRET, TURN_HOST } from "./env";

/**
 * ICE server configuration for the voice WebRTC peer connections.
 *
 * Voice is intentionally OUTSIDE the WS protocol / server-authority refactor —
 * ICE servers are pure {@link RTCPeerConnection} config, fetched once over a
 * plain HTTP route (GET /api/turn). Cross-network voice behind symmetric /
 * carrier-grade NAT needs a TURN relay (STUN-only ICE goes to `failed` with no
 * relay candidate); this handler mints time-limited TURN REST credentials so
 * the long-lived `TURN_SECRET` never ships to the client.
 */

/** A single STUN/TURN entry as the browser's RTCPeerConnection expects it. */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Shape returned by GET /api/turn. `ttl` is the credential lifetime (seconds). */
export interface TurnCredentials {
  iceServers: IceServer[];
  ttl: number;
}

/** Public STUN server — always returned, even when TURN is not configured. */
const STUN: IceServer = { urls: "stun:stun.l.google.com:19302" };

/** TURN REST credentials are valid for this window before the client refetches. */
const TURN_TTL_SECONDS = 24 * 60 * 60;

/**
 * Build the ICE server list, including time-limited TURN REST credentials when
 * `TURN_SECRET` + `TURN_HOST` are configured.
 *
 * TURN REST (the coturn `use-auth-secret` scheme): the username is
 * `${expiryUnix}:bero` and the credential is `base64(HMAC-SHA1(secret, username))`.
 * The TURN server recomputes the same HMAC from its shared secret, so no
 * per-user state is stored anywhere.
 *
 * When `TURN_SECRET` (or `TURN_HOST`) is unset we degrade gracefully to a
 * STUN-only list — identical to the pre-TURN behavior (cross-network may still
 * fail behind symmetric NAT, but the app never crashes).
 */
export function getTurnCredentials(): TurnCredentials {
  if (!TURN_SECRET || !TURN_HOST) {
    return { iceServers: [STUN], ttl: 0 };
  }

  const expiry = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS;
  const username = `${expiry}:bero`;
  const credential = createHmac("sha1", TURN_SECRET)
    .update(username)
    .digest("base64");

  const turn: IceServer = {
    urls: [
      `turn:${TURN_HOST}:3478?transport=udp`,
      `turn:${TURN_HOST}:3478?transport=tcp`,
      `turns:${TURN_HOST}:5349?transport=tcp`,
    ],
    username,
    credential,
  };

  return { iceServers: [STUN, turn], ttl: TURN_TTL_SECONDS };
}
