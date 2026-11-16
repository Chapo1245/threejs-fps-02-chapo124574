// layouts.js — three original maps. No imports.
// Data format per layout:
//   bounds {x,z} half-extents of the playable rectangle.
//   walls / crates: {x, z, w, d, h, c} — centre, footprint, height, colour key.
//   sites: A and B plant zones {x, z, r}.
//   spawns: atk / def arrays {x, z, yaw} — yaw 0 faces north (-z).
//   nodes: waypoint graph [x, z]; routes are index lists into it.
//   holds: defender hold node ids. lamps: point-light positions.
const C = {
  wall: 0x3d454e, dark: 0x2a3036, rust: 0x8a4a28, olive: 0x5a5c3a,
  amber: 0xb06a1e, steel: 0x4a5560, crate: 0x6b4a2a, blue: 0x2e4a66,
  container: 0x7a3b22, navy: 0x24344a, sand: 0x8a7a55,
};

export const LAYOUTS = {
  slagworks: {
    id: 'slagworks', bounds: { x: 30, z: 22 },
    walls: [
      { x: 0, z: -22, w: 62, d: 1, h: 5, c: 'wall' },
      { x: 0, z: 22, w: 62, d: 1, h: 5, c: 'wall' },
      { x: -30, z: 0, w: 1, d: 45, h: 5, c: 'wall' },
      { x: 30, z: 0, w: 1, d: 45, h: 5, c: 'wall' },
      // Furnace room (site A) — entries south-east and east
      { x: -26, z: -13, w: 1, d: 12, h: 4, c: 'dark' },
      { x: -20, z: -19, w: 13, d: 1, h: 4, c: 'dark' },
      { x: -14, z: -17, w: 1, d: 5, h: 4, c: 'dark' },
      { x: -24, z: -7, w: 6, d: 1, h: 4, c: 'rust' },
      // Lane walls
      { x: -8, z: -4, w: 1, d: 10, h: 3.2, c: 'steel' },
      { x: 8, z: 4, w: 1, d: 10, h: 3.2, c: 'steel' },
      // Slag pit low walls
      { x: 0, z: -8, w: 10, d: 1, h: 1.1, c: 'amber' },
      { x: 0, z: 8, w: 10, d: 1, h: 1.1, c: 'amber' },
      // Cooling yard (site B)
      { x: 14, z: 13, w: 1, d: 9, h: 3.2, c: 'steel' },
      { x: 24, z: 7, w: 9, d: 1, h: 3.2, c: 'dark' },
      // Conveyor + lane blocks
      { x: 16, z: -6, w: 10, d: 2, h: 1.4, c: 'rust' },
      { x: -18, z: 2, w: 6, d: 2, h: 2.2, c: 'olive' },
      { x: 18, z: -2, w: 6, d: 2, h: 2.2, c: 'olive' },
      { x: 0, z: 0, w: 3, d: 3, h: 4, c: 'amber' },
      // Spawn cover
      { x: -10, z: 16, w: 8, d: 1, h: 2.4, c: 'dark' },
      { x: 10, z: 16, w: 8, d: 1, h: 2.4, c: 'dark' },
      { x: 0, z: -16, w: 10, d: 1, h: 2.4, c: 'dark' },
    ],
    crates: [
      { x: -17, z: -10, w: 2, d: 2, h: 1.2, c: 'crate' },
      { x: -23, z: -16, w: 2, d: 2, h: 1.2, c: 'crate' },
      { x: -20, z: -8.5, w: 3, d: 1.5, h: 1.1, c: 'crate' },
      { x: -4, z: 2, w: 2, d: 2, h: 1.3, c: 'crate' },
      { x: 4, z: -2, w: 2, d: 2, h: 1.3, c: 'crate' },
      { x: -2, z: 10, w: 2, d: 2, h: 1.2, c: 'crate' },
      { x: 3, z: -10, w: 2, d: 2, h: 1.2, c: 'crate' },
      { x: 18, z: 16, w: 2, d: 2, h: 1.2, c: 'crate' },
      { x: 23, z: 10, w: 2, d: 2, h: 1.3, c: 'crate' },
      { x: 17, z: 12, w: 3, d: 1.5, h: 1.1, c: 'crate' },
      { x: -14, z: 8, w: 2, d: 2, h: 1.2, c: 'crate' },
      { x: 14, z: -8, w: 2, d: 2, h: 1.2, c: 'crate' },
    ],
    sites: { A: { x: -20, z: -13, r: 5.5 }, B: { x: 20, z: 13, r: 5.5 } },
    spawns: {
      atk: [
        { x: 0, z: 18.5, yaw: 0 }, { x: -12, z: 19, yaw: 0 }, { x: -4, z: 19, yaw: 0 },
        { x: 4, z: 19, yaw: 0 }, { x: 12, z: 19, yaw: 0 },
      ],
      def: [
        { x: 0, z: -19, yaw: Math.PI }, { x: -12, z: -19, yaw: Math.PI },
        { x: -4, z: -19, yaw: Math.PI }, { x: 4, z: -19, yaw: Math.PI },
        { x: 12, z: -19, yaw: Math.PI },
      ],
    },
    nodes: [
      [0, 18], [-10, 18], [10, 18], [-14, 8], [0, 10], [14, 8],
      [-14, -2], [0, -2], [14, -2], [-20, -7], [-20, -13], [20, 13],
      [20, 4], [0, -14], [-8, -14], [8, -14], [-24, 2], [24, -8],
    ],
    routes: {
      atkA: [1, 3, 6, 9, 10], atkB: [2, 5, 12, 11], atkMid: [0, 4, 7, 13],
      defA: [14, 6, 9, 10], defB: [15, 8, 12, 11], defMid: [13, 7, 4],
      retakeA: [13, 7, 6, 9, 10], retakeB: [13, 7, 8, 12, 11],
    },
    holds: [10, 11, 7, 6, 8],
    lamps: [
      { x: -20, y: 4.2, z: -13, color: 0xff7a1e, i: 26 },
      { x: 20, y: 4.2, z: 13, color: 0x4fc3ff, i: 22 },
      { x: 0, y: 5, z: 0, color: 0xffb347, i: 20 },
    ],
  },

  nightdock: {
    id: 'nightdock', bounds: { x: 28, z: 20 },
    walls: [
      { x: 0, z: -20, w: 58, d: 1, h: 5, c: 'navy' },
      { x: 0, z: 20, w: 58, d: 1, h: 5, c: 'navy' },
      { x: -28, z: 0, w: 1, d: 41, h: 5, c: 'navy' },
      { x: 28, z: 0, w: 1, d: 41, h: 5, c: 'navy' },
      // Container rows make the lanes
      { x: -14, z: -6, w: 9, d: 2.4, h: 2.6, c: 'container' },
      { x: 14, z: -6, w: 9, d: 2.4, h: 2.6, c: 'blue' },
      { x: -14, z: 4, w: 6, d: 2.4, h: 2.6, c: 'blue' },
      { x: 14, z: 4, w: 6, d: 2.4, h: 2.6, c: 'container' },
      { x: -22, z: 2, w: 2.4, d: 8, h: 2.6, c: 'rust' },
      { x: 22, z: 2, w: 2.4, d: 8, h: 2.6, c: 'rust' },
      // Crane base (site B yard) and warehouse (site A yard)
      { x: 0, z: -14, w: 10, d: 2, h: 3.6, c: 'dark' },
      { x: -20, z: -16, w: 8, d: 1, h: 3.4, c: 'dark' },
      { x: 24, z: -14, w: 1, d: 8, h: 3.4, c: 'dark' },
      // Mid container block (sniper cover, not sightline)
      { x: 0, z: 8, w: 4, d: 4, h: 2.6, c: 'olive' },
      { x: -8, z: 14, w: 7, d: 1, h: 2.2, c: 'dark' },
      { x: 8, z: 14, w: 7, d: 1, h: 2.2, c: 'dark' },
      { x: 0, z: -8, w: 2, d: 2, h: 6, c: 'amber' },
    ],
    crates: [
      { x: -18, z: -11, w: 2, d: 2, h: 1.2, c: 'crate' },
      { x: -22, z: -8, w: 2, d: 2, h: 1.2, c: 'crate' },
      { x: 18, z: -11, w: 2, d: 2, h: 1.3, c: 'crate' },
      { x: 22, z: -9, w: 2, d: 2, h: 1.2, c: 'crate' },
      { x: -4, z: -2, w: 2, d: 2, h: 1.2, c: 'crate' },
      { x: 4, z: 2, w: 2, d: 2, h: 1.2, c: 'crate' },
      { x: -6, z: 12, w: 2, d: 2, h: 1.2, c: 'crate' },
      { x: 6, z: 12, w: 2, d: 2, h: 1.2, c: 'crate' },
      { x: 0, z: -3, w: 3, d: 1.5, h: 1.1, c: 'crate' },
    ],
    sites: { A: { x: -20, z: -12, r: 5.5 }, B: { x: 20, z: -12, r: 5.5 } },
    spawns: {
      atk: [
        { x: 0, z: 17, yaw: 0 }, { x: -10, z: 17, yaw: 0 }, { x: -4, z: 17, yaw: 0 },
        { x: 4, z: 17, yaw: 0 }, { x: 10, z: 17, yaw: 0 },
      ],
      def: [
        { x: 0, z: -17, yaw: Math.PI }, { x: -10, z: -17, yaw: Math.PI },
        { x: -4, z: -17, yaw: Math.PI }, { x: 4, z: -17, yaw: Math.PI },
        { x: 10, z: -17, yaw: Math.PI },
      ],
    },
    nodes: [
      [0, 17], [-10, 17], [10, 17], [-12, 8], [0, 12], [12, 8],
      [-12, -2], [0, 0], [12, -2], [-20, -12], [20, -12], [0, -11],
      [-6, -11], [6, -11], [-18, -2], [18, -2], [0, 16],
    ],
    routes: {
      atkA: [1, 3, 6, 14, 9], atkB: [2, 5, 8, 15, 10], atkMid: [0, 4, 7, 11],
      defA: [12, 6, 14, 9], defB: [13, 8, 15, 10], defMid: [11, 7, 4],
      retakeA: [11, 7, 6, 14, 9], retakeB: [11, 7, 8, 15, 10],
    },
    holds: [9, 10, 7, 6, 8],
    lamps: [
      { x: -20, y: 4, z: -12, color: 0xffb020, i: 24 },
      { x: 20, y: 4, z: -12, color: 0xffb020, i: 24 },
      { x: 0, y: 6.5, z: -8, color: 0xffc46b, i: 26 },
      { x: 0, y: 4, z: 10, color: 0x6fb7ff, i: 18 },
    ],
  },

  cinderpit: {
    id: 'cinderpit', bounds: { x: 22, z: 17 },
    walls: [
      { x: 0, z: -17, w: 46, d: 1, h: 5, c: 'wall' },
      { x: 0, z: 17, w: 46, d: 1, h: 5, c: 'wall' },
      { x: -22, z: 0, w: 1, d: 35, h: 5, c: 'wall' },
      { x: 22, z: 0, w: 1, d: 35, h: 5, c: 'wall' },
      // Central pit walls (low, fight around them)
      { x: 0, z: -5, w: 8, d: 1, h: 1.2, c: 'amber' },
      { x: 0, z: 5, w: 8, d: 1, h: 1.2, c: 'amber' },
      { x: -5, z: 0, w: 1, d: 9, h: 1.2, c: 'amber' },
      { x: 5, z: 0, w: 1, d: 9, h: 1.2, c: 'amber' },
      // Site screens
      { x: -14, z: -13, w: 6, d: 1, h: 3, c: 'dark' },
      { x: 14, z: -13, w: 6, d: 1, h: 3, c: 'dark' },
      { x: -18, z: -6, w: 1, d: 6, h: 2.6, c: 'rust' },
      { x: 18, z: -6, w: 1, d: 6, h: 2.6, c: 'rust' },
      { x: -10, z: 8, w: 6, d: 1.5, h: 2.2, c: 'olive' },
      { x: 10, z: 8, w: 6, d: 1.5, h: 2.2, c: 'olive' },
      { x: 0, z: -11, w: 6, d: 1, h: 2.4, c: 'dark' },
      { x: 0, z: 12, w: 6, d: 1, h: 2.4, c: 'dark' },
    ],
    crates: [
      { x: -12, z: -8, w: 2, d: 2, h: 1.2, c: 'crate' },
      { x: 12, z: -8, w: 2, d: 2, h: 1.2, c: 'crate' },
      { x: -8, z: 2, w: 2, d: 2, h: 1.3, c: 'crate' },
      { x: 8, z: -2, w: 2, d: 2, h: 1.3, c: 'crate' },
      { x: 0, z: 0, w: 2.5, d: 2.5, h: 1.4, c: 'rust' },
      { x: -16, z: 8, w: 2, d: 2, h: 1.2, c: 'crate' },
      { x: 16, z: 8, w: 2, d: 2, h: 1.2, c: 'crate' },
    ],
    sites: { A: { x: -14, z: -10, r: 5 }, B: { x: 14, z: -10, r: 5 } },
    spawns: {
      atk: [
        { x: 0, z: 14, yaw: 0 }, { x: -9, z: 14, yaw: 0 }, { x: -4, z: 14, yaw: 0 },
        { x: 4, z: 14, yaw: 0 }, { x: 9, z: 14, yaw: 0 },
      ],
      def: [
        { x: 0, z: -14, yaw: Math.PI }, { x: -9, z: -14, yaw: Math.PI },
        { x: -4, z: -14, yaw: Math.PI }, { x: 4, z: -14, yaw: Math.PI },
        { x: 9, z: -14, yaw: Math.PI },
      ],
    },
    nodes: [
      [0, 14], [-9, 14], [9, 14], [-12, 6], [0, 9], [12, 6],
      [-12, -3], [0, -6], [12, -3], [-14, -10], [14, -10], [0, -12],
      [-6, -12], [6, -12], [-18, 0], [18, 0],
    ],
    routes: {
      atkA: [1, 3, 6, 9], atkB: [2, 5, 8, 10], atkMid: [0, 4, 7, 11],
      defA: [12, 6, 9], defB: [13, 8, 10], defMid: [11, 7, 4],
      retakeA: [11, 7, 6, 9], retakeB: [11, 7, 8, 10],
    },
    holds: [9, 10, 7, 6, 8],
    lamps: [
      { x: -14, y: 3.6, z: -10, color: 0xff6a2e, i: 24 },
      { x: 14, y: 3.6, z: -10, color: 0xff6a2e, i: 24 },
      { x: 0, y: 4, z: 0, color: 0xffb347, i: 22 },
    ],
  },
};

export const COLOR_KEYS = C;
