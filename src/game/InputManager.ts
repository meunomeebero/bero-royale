import * as THREE from "three";
import {
  AIM_SENSITIVITY_DEFAULT,
  AIM_SENSITIVITY_MAX,
  AIM_SENSITIVITY_MIN,
} from "./consts";

export class InputManager {
  private enabled = true;
  private keys: Set<string> = new Set();
  private spaceJustPressed = false;
  private shiftJustPressed = false;
  private mouseJustPressed = false;
  private mouseHeld = false;
  private tabJustPressed = false; // Tab = cycle weapon slots
  private hotbarJustPressed: number | null = null; // keys 1/2/3 → weapon slot 0/1/2

  // Mobile stick state
  private moveAxis = { x: 0, y: 0 };
  private aimAxis = { x: 0, y: 0 };
  private aiming = false;
  /** True once any touch input is used — keeps aim mobile-driven (never the
   *  absent mouse, whose centered NDC makes the facing jitter while walking). */
  private mobileActive = false;
  /** Last resolved mobile aim yaw, held while idle so facing never trembles. */
  private lastMobileAimYaw = 0;

  /** Normalized device coordinates (-1..1) of the mouse. */
  readonly mouseNDC = new THREE.Vector2(0, 0);
  /** Mouse client position in pixels (for HUD crosshair). */
  readonly mouseClient = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  /**
   * Cursor/aim sensitivity. A center-anchored gain: the effective cursor sits at
   * center + (rawCursor − center) × sensitivity, so it scales how far the aim
   * deflects per unit of cursor offset from screen center (1 = raw 1:1 cursor).
   */
  private aimSensitivity = AIM_SENSITIVITY_DEFAULT;

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("blur", this.onBlur);
  }

  private onBlur = () => {
    // When the window loses focus, the OS may swallow keyup events,
    // leaving keys "stuck". Clear all input state to be safe.
    this.clearKeys();
  };

  /** Force-clear all currently held keys / mouse buttons. Useful on respawn. */
  clearKeys() {
    this.keys.clear();
    this.spaceJustPressed = false;
    this.shiftJustPressed = false;
    this.mouseJustPressed = false;
    this.mouseHeld = false;
    this.moveAxis = { x: 0, y: 0 };
    this.aimAxis = { x: 0, y: 0 };
    this.aiming = false;
    this.tabJustPressed = false;
  }

  /**
   * Enable or disable game-key handling. When disabled (e.g. chat input is
   * focused), all keyboard events are ignored so raw characters reach the
   * input element and no game action (move/jump/dash/voice) fires.
   * Mouse aim/shoot events are unaffected and keep working.
   */
  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.clearKeys();
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    if (
      e.code === "Space" ||
      e.code.startsWith("Arrow") ||
      e.code === "Tab" ||
      e.code === "KeyW" ||
      e.code === "KeyA" ||
      e.code === "KeyS" ||
      e.code === "KeyD"
    ) {
      e.preventDefault();
    }
    if (e.code === "Space" && !this.keys.has("Space")) {
      this.spaceJustPressed = true;
    }
    if (e.code === "Tab" && !this.keys.has("Tab")) {
      this.tabJustPressed = true;
    }
    // Minecraft-style hotbar select: 1/2/3 → weapon slot 0/1/2.
    if (!this.keys.has(e.code)) {
      if (e.code === "Digit1") this.hotbarJustPressed = 0;
      else if (e.code === "Digit2") this.hotbarJustPressed = 1;
      else if (e.code === "Digit3") this.hotbarJustPressed = 2;
    }
    if (
      (e.code === "ShiftLeft" || e.code === "ShiftRight") &&
      !this.keys.has("ShiftLeft") &&
      !this.keys.has("ShiftRight")
    ) {
      this.shiftJustPressed = true;
    }
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    this.keys.delete(e.code);
  };

  /** Clamp + persist the aim sensitivity multiplier (settings slider). */
  setAimSensitivity(s: number) {
    this.aimSensitivity = Math.max(
      AIM_SENSITIVITY_MIN,
      Math.min(AIM_SENSITIVITY_MAX, s),
    );
  }

  /**
   * Apply the sensitivity gain to a raw client point and clamp to the viewport.
   * Single source of truth for both the aim raycast (mouseNDC) and the HUD
   * crosshair, so the reticle always sits exactly where the shot will land.
   */
  gainCursor(clientX: number, clientY: number): { x: number; y: number } {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cx = w / 2;
    const cy = h / 2;
    const s = this.aimSensitivity;
    return {
      x: Math.max(0, Math.min(w, cx + (clientX - cx) * s)),
      y: Math.max(0, Math.min(h, cy + (clientY - cy) * s)),
    };
  }

  private onMouseMove = (e: MouseEvent) => {
    const { x, y } = this.gainCursor(e.clientX, e.clientY);
    this.mouseClient.x = x;
    this.mouseClient.y = y;
    this.mouseNDC.x = (x / window.innerWidth) * 2 - 1;
    this.mouseNDC.y = -(y / window.innerHeight) * 2 + 1;
  };

  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) {
      this.mouseJustPressed = true;
      this.mouseHeld = true;
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) {
      this.mouseHeld = false;
    }
  };

  private onContextMenu = (e: Event) => {
    e.preventDefault();
  };

  // ---------------------------------------------------------------------------
  // Mobile injection API
  // ---------------------------------------------------------------------------

  /**
   * Set the LEFT stick vector from a mobile joystick.
   * x: right=-1..1=left, y: down=-1..1=up (screen space).
   * Call with (0, 0) on release.
   */
  setMoveAxis(x: number, y: number) {
    this.moveAxis = { x, y };
    this.mobileActive = true;
  }

  /**
   * Set the RIGHT stick vector from a mobile joystick (aim).
   * Sets aiming=true when magnitude > 0.2 deadzone.
   */
  setAimAxis(x: number, y: number) {
    this.aimAxis = { x, y };
    const mag = Math.hypot(x, y);
    this.aiming = mag > 0.2;
    this.mobileActive = true;
  }

  /** Called on right stick release — stop aiming. */
  clearAim() {
    this.aiming = false;
    this.aimAxis = { x: 0, y: 0 };
  }

  /**
   * Returns the world aim yaw derived from the right stick while aiming,
   * or null when the mobile aim stick is not active.
   * World convention: atan2(dz, dx) where dz=stickY, dx=stickX.
   */
  getMobileAimYaw(): number | null {
    if (!this.mobileActive) return null; // desktop → mouse-based aim
    if (this.aiming) {
      this.lastMobileAimYaw = Math.atan2(this.aimAxis.y, this.aimAxis.x);
    } else if (Math.hypot(this.moveAxis.x, this.moveAxis.y) > 0.15) {
      // Not aiming → face the WALKING direction (twin-stick feel). Never fall
      // through to the mouse raycast, whose centered NDC points at the player
      // and produces an erratic, trembling yaw while moving.
      this.lastMobileAimYaw = Math.atan2(this.moveAxis.y, this.moveAxis.x);
    }
    return this.lastMobileAimYaw;
  }

  /** Trigger a jump from mobile UI (consumed once via consumeJump). */
  triggerJump() {
    this.spaceJustPressed = true;
    this.mobileActive = true;
  }

  /** Trigger a dash from mobile UI (consumed once via consumeDash). */
  triggerDash() {
    this.shiftJustPressed = true;
    this.mobileActive = true;
  }

  // ---------------------------------------------------------------------------

  /** Movement vector on the XZ plane (mobile left stick when non-zero, else WASD/arrows). */
  getMoveVector(): THREE.Vector3 {
    // Mobile axis takes priority when the stick has been pushed
    const mobileMag = Math.hypot(this.moveAxis.x, this.moveAxis.y);
    if (mobileMag > 0) {
      // Clamp to length 1, map screen-space y-down to world -z (forward)
      const scale = Math.min(1, mobileMag) / mobileMag;
      return new THREE.Vector3(
        this.moveAxis.x * scale,
        0,
        this.moveAxis.y * scale,
      );
    }

    const v = new THREE.Vector3(0, 0, 0);
    if (this.keys.has("ArrowLeft") || this.keys.has("KeyA")) v.x -= 1;
    if (this.keys.has("ArrowRight") || this.keys.has("KeyD")) v.x += 1;
    if (this.keys.has("ArrowUp") || this.keys.has("KeyW")) v.z -= 1;
    if (this.keys.has("ArrowDown") || this.keys.has("KeyS")) v.z += 1;
    if (v.lengthSq() > 0) v.normalize();
    return v;
  }

  /** Returns true exactly once per Space press. */
  consumeJump(): boolean {
    if (this.spaceJustPressed) {
      this.spaceJustPressed = false;
      return true;
    }
    return false;
  }

  /** Returns true exactly once per Shift press (dash). */
  consumeDash(): boolean {
    if (this.shiftJustPressed) {
      this.shiftJustPressed = false;
      return true;
    }
    return false;
  }

  /** Returns true exactly once per left-mouse press. */
  consumeShoot(): boolean {
    if (this.mouseJustPressed) {
      this.mouseJustPressed = false;
      return true;
    }
    return false;
  }

  isShootHeld(): boolean {
    return this.mouseHeld || this.aiming;
  }

  /** Returns true exactly once per Tab press (cycle weapon slots). */
  consumeTab(): boolean {
    if (this.tabJustPressed) {
      this.tabJustPressed = false;
      return true;
    }
    return false;
  }

  /** Returns the weapon slot (0/1/2) selected via keys 1/2/3 since the last call. */
  consumeHotbar(): number | null {
    const v = this.hotbarJustPressed;
    this.hotbarJustPressed = null;
    return v;
  }

  /** Push-to-talk: true while G is held. */
  isVoiceHeld(): boolean {
    return this.keys.has("KeyG");
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("blur", this.onBlur);
  }
}
