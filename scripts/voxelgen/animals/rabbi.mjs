import { VoxelGrid } from "../voxel.mjs";

// "rabbi" — first AI-authored HUMAN Bero character, modeled from a ChatGPT
// reference (3-view chunky voxel sheet). Single fused cube body (no legs/arms),
// black coat + top hat, beard + payot (sidelocks), glasses.
// Built CHUNKY (wide body, short hat) to fit the pack's proportion envelope so
// the in-game hitbox stays fair. Authored on the LEFT half (x ≤ 12);
// symmetrizeX() mirrors to the right. Front = +Z (face looks +Z).

const C = {
  black: "#222222",     // coat + hat
  skin: "#e6a96d",      // face
  nose: "#d8884a",      // nose / warm shadow
  beard: "#5e3a22",     // beard + payot + brows
  glass: "#e8dcc0",     // glasses frame
  cream: "#fcf9ec",     // shirt / tzitzit
  blush: "#e2908a",     // cheeks
};

export const name = "rabbi";

export function build() {
  const g = new VoxelGrid(25, 34, 24); // center x = 12, front = +Z

  // Coat (body) — wide black block.
  g.box(3, 21, 0, 15, 4, 19, C.black);
  // Shirt / tzitzit — cream strip down the front center.
  g.box(10, 14, 1, 13, 17, 20, C.cream);

  // Head (skin) on top of the coat.
  g.box(5, 19, 15, 26, 4, 18, C.skin);

  // Beard — brown: lower-face front slab, chin point, side payot.
  g.box(5, 19, 15, 21, 17, 19, C.beard);  // front slab
  g.box(10, 14, 12, 15, 17, 19, C.beard); // chin point (dips onto the coat)
  g.box(3, 5, 16, 25, 15, 19, C.beard);   // left payot (mirror → right)

  // Face (skin shows y 21..26, above the beard).
  g.box(7, 10, 24, 24, 17, 18, C.beard);  // left eyebrow (mirror → right)
  g.box(7, 10, 22, 23, 17, 18, C.black);  // left eye (mirror → right)
  g.box(6, 11, 22, 23, 18, 19, C.glass);  // left glasses lens (mirror → right)
  g.box(11, 13, 23, 23, 18, 19, C.glass); // glasses bridge (center)
  g.box(11, 13, 20, 22, 18, 20, C.nose);  // nose (center, protrudes)
  g.box(6, 8, 20, 21, 17, 18, C.blush);   // left cheek (mirror → right)

  // Hat brim — wide flat black slab (sticks out past the head).
  g.box(1, 23, 26, 27, 2, 21, C.black);
  // Hat crown — short black box on top.
  g.box(7, 17, 27, 31, 7, 16, C.black);

  return g.symmetrizeX();
}
