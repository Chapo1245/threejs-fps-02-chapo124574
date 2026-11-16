// maps.js — COPPERLINE (variant A): a canal-side copper works yard in bright
// daylight. One original map: two bomb sites, three lanes (A-long, mid, B-long),
// a drainage canal down the east edge, container stacks for cover. All geometry
// is data: world.js builds meshes + collision from it, bots.js navigates it.
export const MAP = {
  id: 'copperline',
  name: 'COPPERLINE',
  subtitle: 'Canal-side copper works — bright day',
  size: { w: 64, d: 48 },            // playable ground, x in [-32,32], z in [-24,24]
  palette: {
    sky: 0xbfd9e2, fog: 0xc4d3d6, ground: 0x84796a, groundAlt: 0x756a5c,
    canal: 0x2e7f8a, brick: 0xa8623f, brickDark: 0x8a4f31, brickLight: 0xc07a52,
    copper: 0xb87333, copperDark: 0x8a5a26, teal: 0x2f7f7a, tealDark: 0x256862,
    rust: 0x9c4a26, wood: 0x8a6b45, woodDark: 0x6e5436, wall: 0x6f6a63,
    wallDark: 0x54504a, roof: 0x4a4640, lamp: 0xf5d76e, pipe: 0x5d6d7e,
    accentA: 0xe0653a, accentB: 0x2f9e8f,
  },
  sun: { color: 0xfff2d8, intensity: 2.6, pos: [28, 42, 18], shadow: true },
  hemi: { sky: 0xcfe8f2, ground: 0x6b5a48, intensity: 0.9 },
  // Solid boxes: {x, z, w, d, h, c} — c is a palette key. y is ground (0) unless set.
  boxes: [
    // perimeter walls (h 3.2) — the yard fence
    { x: 0, z: -24.6, w: 66, d: 1.2, h: 3.4, c: 'wall' },
    { x: 0, z: 24.6, w: 66, d: 1.2, h: 3.4, c: 'wall' },
    { x: -32.6, z: 0, w: 1.2, d: 50, h: 3.4, c: 'wall' },
    { x: 32.6, z: 0, w: 1.2, d: 50, h: 3.4, c: 'wall' },
    // north works hall (defender base backdrop, h 9)
    { x: -14, z: -21, w: 18, d: 5, h: 9, c: 'brick' },
    { x: 12, z: -21.5, w: 16, d: 4, h: 7, c: 'brickDark' },
    { x: 12, z: -21.5, w: 16, d: 4.6, h: 0.7, c: 'copper', y: 7 },
    { x: -14, z: -21, w: 18, d: 5.6, h: 0.7, c: 'copperDark', y: 9 },
    // south gatehouse (attacker spawn backdrop)
    { x: 0, z: 22, w: 20, d: 4, h: 6, c: 'brickLight' },
    { x: 0, z: 22, w: 20, d: 4.6, h: 0.6, c: 'roof', y: 6 },
    // A site structures (east, around 20,-12): kiln block + container stack
    { x: 24, z: -14, w: 8, d: 7, h: 5.5, c: 'brick' },
    { x: 24, z: -14, w: 8.6, d: 7.6, h: 0.6, c: 'copper', y: 5.5 },
    { x: 15, z: -17, w: 6, d: 2.4, h: 2.6, c: 'teal' },
    { x: 15, z: -17, w: 6, d: 2.4, h: 2.6, c: 'rust', y: 2.6 },
    { x: 18, z: -6, w: 3, d: 3, h: 1.2, c: 'wood' },
    { x: 21, z: -7.5, w: 2, d: 2, h: 2.4, c: 'tealDark' },
    // B site structures (west, around -20,-12): warehouse corner + crates
    { x: -24, z: -15, w: 8, d: 6, h: 6.5, c: 'brickDark' },
    { x: -24, z: -15, w: 8.6, d: 6.6, h: 0.6, c: 'roof', y: 6.5 },
    { x: -15, z: -16, w: 5, d: 2.4, h: 2.6, c: 'rust' },
    { x: -18, z: -6, w: 3, d: 3, h: 1.2, c: 'wood' },
    { x: -21, z: -8, w: 2, d: 2, h: 2.4, c: 'teal' },
    // mid: furnace block + pipe gantry (the crossfire heart)
    { x: -2, z: -2, w: 7, d: 5, h: 4.2, c: 'brick' },
    { x: -2, z: -2, w: 7.6, d: 5.6, h: 0.5, c: 'copperDark', y: 4.2 },
    { x: 6, z: 2, w: 2.2, d: 2.2, h: 3.4, c: 'rust' },
    { x: -8, z: 4, w: 2.4, d: 2.4, h: 1.2, c: 'wood' },
    // A-long cover (east lane)
    { x: 24, z: 6, w: 4, d: 2.4, h: 2.6, c: 'teal' },
    { x: 26, z: 12, w: 2, d: 2, h: 1.2, c: 'wood' },
    { x: 20, z: 14, w: 3, d: 3, h: 2.6, c: 'rust' },
    // B-long cover (west lane)
    { x: -24, z: 6, w: 4, d: 2.4, h: 2.6, c: 'rust' },
    { x: -26, z: 12, w: 2, d: 2, h: 1.2, c: 'wood' },
    { x: -20, z: 14, w: 3, d: 3, h: 2.6, c: 'teal' },
    // mid-south scattered cover for the attackers' push
    { x: 8, z: 12, w: 3, d: 2, h: 1.2, c: 'wood' },
    { x: -8, z: 13, w: 3, d: 2, h: 1.2, c: 'wood' },
    { x: 0, z: 16, w: 4, d: 2.4, h: 2.6, c: 'tealDark' },
    // canal-side crates (east edge)
    { x: 28, z: -4, w: 2, d: 2, h: 1.2, c: 'wood' },
    { x: 28, z: 2, w: 2, d: 2, h: 2.4, c: 'copper' },
  ],
  // Decorative props (no collision unless solid:true): barrels, lamps, pipes.
  props: [
    { kind: 'barrel', x: 10, z: -10, c: 'rust' }, { kind: 'barrel', x: 10.9, z: -10.4, c: 'teal' },
    { kind: 'barrel', x: -10, z: -10, c: 'teal' }, { kind: 'barrel', x: 4, z: -8, c: 'rust' },
    { kind: 'barrel', x: -4, z: 8, c: 'rust' }, { kind: 'barrel', x: 26, z: -10, c: 'tealDark' },
    { kind: 'barrel', x: -26, z: -10, c: 'rust' },
    { kind: 'lamp', x: 0, z: 0 }, { kind: 'lamp', x: 12, z: -12 }, { kind: 'lamp', x: -12, z: -12 },
    { kind: 'lamp', x: 0, z: 18 }, { kind: 'lamp', x: 0, z: -18 },
    { kind: 'pipe', x: -6, z: -4.8, w: 5, c: 'pipe' }, { kind: 'pipe', x: 10, z: -4.8, w: 4, c: 'pipe' },
  ],
  // Drainage canal: shallow water strip down the east edge (visual ground paint).
  canal: { x0: 27.5, x1: 32, z0: -24, z1: 24 },
  sites: {
    A: { x: 19, z: -13, r: 4.5, color: 'accentA' },
    B: { x: -19, z: -13, r: 4.5, color: 'accentB' },
  },
  spawns: {
    A: [ // RIVETS (attackers), south gate, facing north (-z, yaw 0)
      { x: -6, z: 20, yaw: 0 }, { x: -3, z: 21, yaw: 0 }, { x: 0, z: 20, yaw: 0 },
      { x: 3, z: 21, yaw: 0 }, { x: 6, z: 20, yaw: 0 },
    ],
    B: [ // WARDENS (defenders), north hall, facing south (+z, yaw PI)
      { x: -6, z: -19, yaw: Math.PI }, { x: -3, z: -18, yaw: Math.PI }, { x: 0, z: -19, yaw: Math.PI },
      { x: 3, z: -18, yaw: Math.PI }, { x: 6, z: -19, yaw: Math.PI },
    ],
  },
  // Waypoint graph: bots walk node -> node (BFS). Nodes sit on lanes and in sites.
  nodes: [
    { x: 0, z: 20 },    // 0 atk spawn
    { x: 0, z: 12 },    // 1 mid south
    { x: 0, z: 4 },     // 2 mid south fork
    { x: 0, z: -4 },    // 3 mid furnace west side
    { x: 0, z: -10 },   // 4 mid north
    { x: 0, z: -18 },   // 5 def spawn
    { x: 12, z: 8 },    // 6 A-long south
    { x: 18, z: 2 },    // 7 A-long mid
    { x: 19, z: -8 },   // 8 A approach
    { x: 19, z: -13 },  // 9 site A
    { x: 24, z: -8 },   // 10 A kiln corner
    { x: -12, z: 8 },   // 11 B-long south
    { x: -18, z: 2 },   // 12 B-long mid
    { x: -19, z: -8 },  // 13 B approach
    { x: -19, z: -13 }, // 14 site B
    { x: -24, z: -8 },  // 15 B warehouse corner
    { x: 8, z: -6 },    // 16 mid-east cut
    { x: -8, z: -6 },   // 17 mid-west cut
  ],
  links: [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5],
    [1, 6], [6, 7], [7, 8], [8, 9], [8, 10], [9, 10],
    [1, 11], [11, 12], [12, 13], [13, 14], [13, 15], [14, 15],
    [2, 16], [16, 8], [2, 17], [17, 13], [3, 16], [3, 17],
    [4, 8], [4, 13], [4, 9], [4, 14],
  ],
  // Defender hold positions per site: {node, yaw} — bots sit here and watch lanes.
  holds: {
    A: [{ node: 10, yaw: Math.PI / 2 }, { node: 8, yaw: Math.PI }, { node: 4, yaw: Math.PI * 0.75 }],
    B: [{ node: 15, yaw: -Math.PI / 2 }, { node: 13, yaw: Math.PI }, { node: 4, yaw: Math.PI * 0.25 }],
  },
};
