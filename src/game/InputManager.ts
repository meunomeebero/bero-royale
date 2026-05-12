import * as THREE from "three";

export class InputManager {
  private keys: Set<string> = new Set();
  private spaceJustPressed = false;
  private mouseJustPressed = false;
  private mouseHeld = false;

  /** Normalized device coordinates (-1..1) of the mouse. */
  readonly mouseNDC = new THREE.Vector2(0, 0);
  /** Mouse client position in pixels (for HUD crosshair). */
  readonly mouseClient = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("contextmenu", this.onContextMenu);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (
      e.code === "Space" ||
      e.code.startsWith("Arrow") ||
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
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent) => {
    this.mouseClient.x = e.clientX;
    this.mouseClient.y = e.clientY;
    this.mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
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

  /** Movement vector on the XZ plane (arrows or WASD). */
  getMoveVector(): THREE.Vector3 {
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

  /** Returns true exactly once per left-mouse press. */
  consumeShoot(): boolean {
    if (this.mouseJustPressed) {
      this.mouseJustPressed = false;
      return true;
    }
    return false;
  }

  isShootHeld(): boolean {
    return this.mouseHeld;
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("contextmenu", this.onContextMenu);
  }
}
