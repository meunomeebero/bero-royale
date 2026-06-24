import { VoxelGrid } from "../voxel.mjs";

// "owl" — first AI-authored Bero character. Built BLOCKY (rectangular boxes) to
// match the pack's Crossy-Road-style animals: flat slabs greedy-mesh down to a
// handful of quads (~pack size), not the stair-stepped ellipsoid look.
// Authored on the LEFT half only (x ≤ 12); symmetrizeX() mirrors to the right.
// Front = +Z (eyes face +Z).

const C = {
  body: "#8a5236",   // warm brown
  dark: "#653b22",   // wings / tuft tips / eye rings
  cream: "#efe2c0",  // belly
  disc: "#f3ead2",   // facial disc (a touch lighter)
  eye: "#fbf6ea",    // eye whites
  pupil: "#15110d",  // pupils
  beak: "#e59a2b",   // beak + feet (orange)
};

export const name = "owl";

export function build() {
  const g = new VoxelGrid(25, 31, 25); // center x = 12, front = +Z

  // Upright body, slightly tapered (owls have no neck): wider head over body.
  g.box(6, 18, 1, 13, 6, 18, C.body);   // lower body
  g.box(5, 19, 13, 23, 5, 19, C.body);  // head (a bit wider)

  // Wings: thin darker slabs down each side. (mirror handles the right)
  g.box(4, 5, 4, 17, 8, 16, C.dark);

  // Cream belly slab + lighter facial disc on the front face.
  g.box(8, 16, 2, 13, 17, 18, C.cream);
  g.box(6, 18, 14, 21, 18, 19, C.disc);

  // Big blocky owl eye: dark ring -> white -> pupil. Authored on the left.
  g.box(6, 10, 15, 20, 19, 20, C.dark);  // ring
  g.box(7, 9, 16, 19, 20, 20, C.eye);    // white
  g.box(7, 8, 17, 18, 21, 21, C.pupil);  // pupil

  // Beak: small orange wedge between the eyes (center column).
  g.box(11, 13, 15, 17, 19, 20, C.beak);
  g.box(12, 12, 13, 16, 20, 21, C.beak); // tip forward + down

  // Ear tufts: tall narrow blocks on the top corners.
  g.box(5, 7, 23, 27, 10, 13, C.body);
  g.box(5, 7, 26, 27, 10, 13, C.dark);   // dark tip

  // Feet: little orange nubs at the front bottom.
  g.box(8, 10, 0, 1, 16, 18, C.beak);

  // Short tail bump at the back bottom.
  g.box(11, 13, 1, 4, 4, 5, C.body);

  return g.symmetrizeX();
}
