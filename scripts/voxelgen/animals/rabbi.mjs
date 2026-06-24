import { VoxelGrid } from "../voxel.mjs";

// "rabbi" — AI-authored HUMAN Bero character, modeled from a ChatGPT reference
// (3-view chunky voxel sheet). Single fused cube body (no legs/arms), black coat
// + top hat, big beard, thick PAYOT (sidelock curls) framing the face, glasses,
// and a cream SHIRT (collar + placket) showing inside the coat.
// Chunked to fit the pack's proportion envelope (fair hitbox). Authored on the
// LEFT half (x ≤ 12); symmetrizeX() mirrors to the right. Front = +Z.

const C = {
  black: "#222222",     // coat + hat
  skin: "#e6a96d",      // face
  nose: "#d8884a",      // nose / warm shadow
  beard: "#5e3a22",     // beard + brows
  payot: "#3a2414",     // sidelock curls — darker than the beard, on the head sides
  glass: "#e8dcc0",     // glasses frame
  cream: "#f6f0df",     // shirt (collar + placket)
  blush: "#e2908a",     // cheeks
};

export const name = "rabbi";

export function build() {
  const g = new VoxelGrid(25, 34, 24); // center x = 12, front = +Z

  // Coat (body) — wide black block.
  g.box(3, 21, 0, 15, 4, 19, C.black);

  // Shirt inside the coat — cream collar band + placket down the chest.
  g.box(9, 15, 9, 12, 19, 20, C.cream);  // collar (under the beard)
  g.box(10, 14, 1, 9, 19, 21, C.cream);  // placket strip

  // Head (skin) on top of the coat.
  g.box(5, 19, 15, 26, 4, 18, C.skin);

  // Beard — brown: lower-face front slab + a rounded chin point.
  g.box(5, 19, 15, 19, 17, 19, C.beard);  // front slab (tops at y19, leaving the face clear)
  g.box(7, 17, 13, 16, 17, 20, C.beard);  // rounder lower beard
  g.box(10, 14, 11, 14, 17, 20, C.beard); // chin point (dips onto the coat)

  // PAYOT — thick dark sidelock on the SIDE of the head (in front of the ear),
  // set BACK from the beard (lower z) and protruding outward, so it reads as a
  // separate lock instead of merging with the beard. Left only; mirror does right.
  g.box(3, 5, 22, 24, 10, 14, C.payot);   // temple anchor (joins the head side)
  g.box(2, 4, 13, 22, 10, 14, C.payot);   // sidelock — thinner, a touch shorter
  g.box(2, 4, 13, 15, 13, 16, C.payot);   // small curl at the bottom (stays off the beard)

  // Face (skin shows y 20..26, above the beard). Eyes sit IN FRONT of the cream
  // frame so the dark pupils stay visible (glasses = thin bridge + temple, not a
  // solid lens). All authored on the left; symmetrizeX() mirrors to the right.
  g.box(7, 10, 24, 24, 17, 18, C.beard);  // eyebrow
  g.box(6, 9, 22, 23, 18, 19, C.black);   // eye (prominent, frontmost)
  g.box(5, 5, 22, 23, 18, 19, C.glass);   // glasses temple (outer rim)
  g.box(10, 13, 23, 23, 18, 19, C.glass); // glasses bridge (center)
  g.box(11, 13, 20, 22, 18, 20, C.nose);  // nose (center, protrudes)
  g.box(6, 8, 21, 21, 18, 19, C.blush);   // cheek (on skin, above the beard)

  // Hat brim — wide flat black slab (sticks out past the head).
  g.box(1, 23, 26, 27, 2, 21, C.black);
  // Hat crown — short black box on top.
  g.box(7, 17, 27, 31, 7, 16, C.black);

  return g.symmetrizeX();
}
