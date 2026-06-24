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
  payot: "#6f4a2e",     // sidelock curls (a touch lighter, to read as separate)
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

  // PAYOT — thick sidelock down the SIDE of the head (in front of the ear),
  // protruding outward so it reads from the side/3-4 view, with a forward curl at
  // the bottom. Authored on the left; symmetrizeX() builds the right one.
  g.box(2, 5, 22, 24, 11, 17, C.payot);   // temple anchor on the head's side
  g.box(1, 4, 13, 23, 12, 17, C.payot);   // sidelock hanging down the side (juts out)
  g.box(2, 5, 12, 15, 15, 19, C.payot);   // bottom curl (hooks toward the front)

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
