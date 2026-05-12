import * as THREE from "three";
import type { Platform } from "./Platform";
import type { InputManager } from "./InputManager";
import type { AudioManager } from "./AudioManager";
import type { DustParticles } from "./DustParticles";

const PLAYER_SIZE = 0.9;
const MOVE_SPEED = 4.5; // units per second
const JUMP_VELOCITY = 7.0;
const GRAVITY = 18.0;

const SQUASH_LERP = 0.18;
const FALL_DURATION = 0.7; // seconds before respawn

type State = "alive" | "falling";

export class Player {
  readonly mesh: THREE.Mesh;
  private platform: Platform;
  private input: InputManager;
  private audio: AudioManager;
  private dust: DustParticles;

  private velocity = new THREE.Vector3(0, 0, 0);
  private grounded = true;
  private state: State = "alive";
  private fallTimer = 0;
  private targetScale = new THREE.Vector3(1, 1, 1);
  private material: THREE.MeshLambertMaterial;

  private spawnPos: THREE.Vector3;

  constructor(
    platform: Platform,
    input: InputManager,
    audio: AudioManager,
    dust: DustParticles,
  ) {
    this.platform = platform;
    this.input = input;
    this.audio = audio;
    this.dust = dust;

    const geom = new THREE.BoxGeometry(PLAYER_SIZE, PLAYER_SIZE, PLAYER_SIZE);
    this.material = new THREE.MeshLambertMaterial({
      color: new THREE.Color("#7b2fff"),
      emissive: new THREE.Color("#3a0ea0"),
      emissiveIntensity: 0.5,
      transparent: true,
    });
    this.mesh = new THREE.Mesh(geom, this.material);

    this.spawnPos = new THREE.Vector3(
      0,
      this.platform.topY + PLAYER_SIZE / 2,
      0,
    );
    this.respawn();
  }

  private respawn() {
    this.mesh.position.copy(this.spawnPos);
    this.velocity.set(0, 0, 0);
    this.mesh.scale.set(1, 1, 1);
    this.targetScale.set(1, 1, 1);
    this.material.opacity = 1;
    this.grounded = true;
    this.state = "alive";
    this.fallTimer = 0;
  }

  update(dt: number) {
    if (this.state === "falling") {
      this.fallTimer += dt;
      // accelerate downward, fade out, shrink
      this.velocity.y -= GRAVITY * dt * 0.5;
      this.mesh.position.addScaledVector(this.velocity, dt);
      this.mesh.rotation.x += dt * 6;
      this.mesh.rotation.z += dt * 4;
      const t = 1 - this.fallTimer / FALL_DURATION;
      this.material.opacity = Math.max(0, t);
      const s = Math.max(0.1, t);
      this.mesh.scale.set(s, s, s);
      if (this.fallTimer >= FALL_DURATION) {
        this.mesh.rotation.set(0, 0, 0);
        this.respawn();
      }
      return;
    }

    // Horizontal movement
    const move = this.input.getMoveVector();
    this.velocity.x = move.x * MOVE_SPEED;
    this.velocity.z = move.z * MOVE_SPEED;

    // Jump
    if (this.grounded && this.input.consumeJump()) {
      this.velocity.y = JUMP_VELOCITY;
      this.grounded = false;
      this.audio.jump();
      // Stretch on jump
      this.targetScale.set(0.75, 1.35, 0.75);
    } else {
      this.input.consumeJump(); // discard if not grounded
    }

    // Gravity
    this.velocity.y -= GRAVITY * dt;

    // Apply velocity
    this.mesh.position.addScaledVector(this.velocity, dt);

    // Ground collision
    const groundY = this.platform.topY + PLAYER_SIZE / 2;
    const bounds = this.platform.getBounds();
    const onPlatform =
      this.mesh.position.x >= bounds.minX &&
      this.mesh.position.x <= bounds.maxX &&
      this.mesh.position.z >= bounds.minZ &&
      this.mesh.position.z <= bounds.maxZ;

    if (onPlatform && this.mesh.position.y <= groundY) {
      const wasAirborne = !this.grounded;
      this.mesh.position.y = groundY;
      this.velocity.y = 0;
      if (wasAirborne) {
        this.grounded = true;
        this.audio.land();
        // Squash on land
        this.targetScale.set(1.35, 0.6, 1.35);
        // Spawn dust
        const dustPos = new THREE.Vector3(
          this.mesh.position.x,
          this.platform.topY + 0.05,
          this.mesh.position.z,
        );
        this.dust.spawnBurst(dustPos, 10);
      }
    } else if (!onPlatform && this.mesh.position.y < this.platform.topY) {
      // Started falling off the edge
      if (this.state === "alive") {
        this.state = "falling";
        this.audio.fall();
        this.grounded = false;
      }
    } else {
      this.grounded = false;
    }

    // Air control: gradually return to neutral while flying
    if (!this.grounded) {
      this.targetScale.lerp(new THREE.Vector3(1, 1, 1), 0.05);
    } else {
      // Rest -> back to neutral
      this.targetScale.lerp(new THREE.Vector3(1, 1, 1), 0.12);
    }

    // Smooth scale lerp toward target
    this.mesh.scale.lerp(this.targetScale, SQUASH_LERP);
  }

  dispose() {
    this.material.dispose();
    (this.mesh.geometry as THREE.BufferGeometry).dispose();
  }
}
