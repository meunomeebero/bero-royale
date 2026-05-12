import * as THREE from "three";

export class InputManager {
  private keys: Set<string> = new Set();
  private spaceJustPressed = false;

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (
      e.code === "Space" ||
      e.code === "ArrowUp" ||
      e.code === "ArrowDown" ||
      e.code === "ArrowLeft" ||
      e.code === "ArrowRight"
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

  /** Movement vector on the XZ plane based on arrow keys. */
  getMoveVector(): THREE.Vector3 {
    const v = new THREE.Vector3(0, 0, 0);
    if (this.keys.has("ArrowLeft")) v.x -= 1;
    if (this.keys.has("ArrowRight")) v.x += 1;
    if (this.keys.has("ArrowUp")) v.z -= 1;
    if (this.keys.has("ArrowDown")) v.z += 1;
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

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }
}
