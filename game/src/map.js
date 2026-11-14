// map.js — "Yard 7", an original freight yard at dusk. The shipped map:
// open, long sightlines, rifle-friendly. It won the variant comparison
// against a tighter warehouse map ("Depot"): Yard 7's three lanes read at
// a glance, its crane-yard sightlines reward stopping to aim, and its
// screenshots show the game instead of a wall.
//
// Coordinates: x east, z south, metres, y up. The yard is 64 x 48 m.
// Attackers (VANGUARD, the player) spawn south-west and push north up
// A-long (west), mid doors (centre) or B-long (east) to the two sites:
//   A — the crane yard, north-west, a maze of stacked containers
//   B — the warehouse, north-east, a roofed room with two doors
// Defenders (JACKALS) spawn north-centre, between the sites.
//
// Solids are collision boxes AND rendered boxes: {x0,z0,x1,z1,top,color,
// shape}. A solid with top <= 1.2 is low cover: it blocks movement but a
// standing shooter can fire over it. Decor is render-only.

export const MAP = {
  name: 'Yard 7',
  variant: 'A',
  bounds: { minX: -32, maxX: 32, minZ: -24, maxZ: 24 },

  sites: {
    A: { x0: -29, x1: -15, z0: -21, z1: -9, cx: -22, cz: -15, label: 'A — CRANE YARD' },
    B: { x0: 13, x1: 27, z0: -21, z1: -9, cx: 20, cz: -15, label: 'B — WAREHOUSE' },
  },

  // [x, z, yaw] — yaw 0 faces north (-z), PI faces south.
  spawns: {
    V: [[-21, 19, 0], [-25, 20, 0], [-17, 20, 0], [-23, 16, 0.3], [-19, 16, -0.3]],
    J: [[5, -19, Math.PI], [1, -20, Math.PI], [9, -20, Math.PI], [3, -17, Math.PI - 0.4], [7, -17, Math.PI + 0.4]],
  },

  solids: [
    // Outer walls (height 6, thickness 1).
    { x0: -32, z0: -24, x1: 32, z1: -23, top: 6, color: 0x4a4f5c },
    { x0: -32, z0: 23, x1: 32, z1: 24, top: 6, color: 0x4a4f5c },
    { x0: -32, z0: -24, x1: -31, z1: 24, top: 6, color: 0x4a4f5c },
    { x0: 31, z0: -24, x1: 32, z1: 24, top: 6, color: 0x4a4f5c },
    // Mid building (the "mid doors" connector), walls with two door gaps.
    { x0: -6, z0: -7, x1: -1.5, z1: -6, top: 4, color: 0x333845 },
    { x0: 1.5, z0: -7, x1: 6, z1: -6, top: 4, color: 0x333845 },
    { x0: -6, z0: 6, x1: -1.5, z1: 7, top: 4, color: 0x333845 },
    { x0: 1.5, z0: 6, x1: 6, z1: 7, top: 4, color: 0x333845 },
    { x0: -6, z0: -7, x1: -5, z1: 7, top: 4, color: 0x333845 },
    { x0: 5, z0: -7, x1: 6, z1: 7, top: 4, color: 0x333845 },
    // Warehouse B: room with a south door and a west door.
    { x0: 12, z0: -22, x1: 28, z1: -21, top: 5, color: 0x3d4350 },
    { x0: 12, z0: -9, x1: 18, z1: -8, top: 5, color: 0x3d4350 },
    { x0: 22, z0: -9, x1: 28, z1: -8, top: 5, color: 0x3d4350 },
    { x0: 12, z0: -22, x1: 13, z1: -16, top: 5, color: 0x3d4350 },
    { x0: 12, z0: -12, x1: 13, z1: -8, top: 5, color: 0x3d4350 },
    { x0: 27, z0: -22, x1: 28, z1: -8, top: 5, color: 0x3d4350 },
    // Site A container stack: tall cover, a corner to plant behind.
    { x0: -28, z0: -20, x1: -22, z1: -17.6, top: 2.6, color: 0xb4552d, shape: 'box' },
    { x0: -28, z0: -20, x1: -25, z1: -17.6, top: 5.2, color: 0x2e7f7a, shape: 'box' },
    { x0: -19, z0: -20, x1: -16, z1: -13, top: 2.6, color: 0x35598c, shape: 'box' },
    { x0: -19, z0: -13, x1: -16, z1: -10, top: 2.6, color: 0xc98a2e, shape: 'box' },
    { x0: -27, z0: -13, x1: -21, z1: -10.6, top: 2.6, color: 0x2e7f7a, shape: 'box' },
    // A-long crates and low cover.
    { x0: -29, z0: 7, x1: -27, z1: 9, top: 1.1, color: 0x8a6b42, shape: 'box' },
    { x0: -29, z0: -5, x1: -26.5, z1: -3, top: 2.4, color: 0x35598c, shape: 'box' },
    { x0: -30, z0: -11, x1: -28, z1: -9, top: 1.1, color: 0x8a6b42, shape: 'box' },
    // Mid crates — the crossfire corner.
    { x0: -3, z0: 10, x1: -1, z1: 12, top: 1.1, color: 0x8a6b42, shape: 'box' },
    { x0: 2, z0: -12, x1: 4, z1: -10, top: 1.1, color: 0x8a6b42, shape: 'box' },
    { x0: -9, z0: -3, x1: -7, z1: -1, top: 2.4, color: 0xb4552d, shape: 'box' },
    { x0: 7, z0: 2, x1: 9, z1: 4, top: 2.4, color: 0xc98a2e, shape: 'box' },
    // B-long cover.
    { x0: 25, z0: 9, x1: 27, z1: 11, top: 1.1, color: 0x8a6b42, shape: 'box' },
    { x0: 25, z0: -3, x1: 28, z1: -1, top: 2.4, color: 0x2e7f7a, shape: 'box' },
    { x0: 29, z0: 15, x1: 30.5, z1: 17, top: 1.1, color: 0x8a6b42, shape: 'box' },
    // Warehouse B interior crates.
    { x0: 15, z0: -19, x1: 17, z1: -17, top: 1.1, color: 0x8a6b42, shape: 'box' },
    { x0: 23, z0: -19, x1: 26, z1: -16.5, top: 2.4, color: 0xb4552d, shape: 'box' },
    { x0: 15, z0: -12, x1: 17.5, z1: -10, top: 2.4, color: 0x35598c, shape: 'box' },
    // Spawn cover.
    { x0: -14, z0: 14, x1: -12, z1: 16, top: 1.1, color: 0x8a6b42, shape: 'box' },
    { x0: -2, z0: -15, x1: 0, z1: -13, top: 1.1, color: 0x8a6b42, shape: 'box' },
    // Barrels (cylinders, collided as their square footprint).
    { x0: -10, z0: 16, x1: -9, z1: 17, top: 1.2, color: 0x7a3b2e, shape: 'cyl' },
    { x0: 10, z0: 14, x1: 11, z1: 15, top: 1.2, color: 0x7a3b2e, shape: 'cyl' },
    { x0: -24, z0: -6, x1: -23, z1: -5, top: 1.2, color: 0x7a3b2e, shape: 'cyl' },
    { x0: 21, z0: 6, x1: 22, z1: 7, top: 1.2, color: 0x7a3b2e, shape: 'cyl' },
  ],

  // Render-only dressing: crane gantry over A, lamps, site floor marks.
  decor: [
    { kind: 'crane', x: -22, z: -18, span: 10, height: 7.5 },
    { kind: 'lamp', x: -22, z: -15, h: 5.5 },
    { kind: 'lamp', x: 20, z: -15, h: 5 },
    { kind: 'lamp', x: 0, z: 0, h: 5 },
    { kind: 'lamp', x: -27, z: 12, h: 4.5 },
    { kind: 'lamp', x: 27, z: 12, h: 4.5 },
    { kind: 'sitemark', site: 'A' },
    { kind: 'sitemark', site: 'B' },
  ],

  waypoints: [
    { id: 'spawnV', x: -21, z: 19, links: ['aLong1', 'midSouth', 'bLong1'] },
    { id: 'aLong1', x: -27, z: 12, links: ['spawnV', 'aLong2'] },
    { id: 'aLong2', x: -27, z: 2, links: ['aLong1', 'aLong3'] },
    { id: 'aLong3', x: -26, z: -8, links: ['aLong2', 'aSite', 'aHold2'] },
    { id: 'aSite', x: -22, z: -15, links: ['aLong3', 'aHold1', 'connectorA'] },
    { id: 'midSouth', x: 0, z: 14, links: ['spawnV', 'midDoorS'] },
    { id: 'midDoorS', x: 0, z: 8, links: ['midSouth', 'midInside'] },
    { id: 'midInside', x: 0, z: 0, links: ['midDoorS', 'midDoorN'] },
    { id: 'midDoorN', x: 0, z: -8, links: ['midInside', 'midNorth'] },
    { id: 'midNorth', x: 0, z: -14, links: ['midDoorN', 'connectorA', 'connectorB', 'midHold'] },
    { id: 'bLong1', x: 27, z: 14, links: ['spawnV', 'bLong2'] },
    { id: 'bLong2', x: 27, z: 4, links: ['bLong1', 'bLong3'] },
    { id: 'bLong3', x: 26, z: -5, links: ['bLong2', 'bSite', 'bHold2'] },
    { id: 'bSite', x: 20, z: -15, links: ['bLong3', 'bHold1', 'connectorB'] },
    { id: 'jSpawn', x: 5, z: -19, links: ['aHold1', 'bHold1', 'midHold'] },
    { id: 'aHold1', x: -18, z: -12, links: ['aSite', 'jSpawn', 'connectorA'] },
    { id: 'aHold2', x: -26, z: -18, links: ['aLong3', 'aSite'] },
    { id: 'bHold1', x: 16, z: -12, links: ['bSite', 'jSpawn', 'connectorB'] },
    { id: 'bHold2', x: 24, z: -18, links: ['bLong3', 'bSite'] },
    { id: 'midHold', x: 3, z: -10, links: ['midNorth', 'jSpawn'] },
    { id: 'connectorA', x: -13, z: -6, links: ['aSite', 'midNorth', 'aHold1'] },
    { id: 'connectorB', x: 10, z: -4, links: ['bSite', 'midNorth', 'bHold1'] },
  ],

  // Named lane routes, waypoint ids in order.
  routes: {
    along: ['spawnV', 'aLong1', 'aLong2', 'aLong3', 'aSite'],
    mid: ['spawnV', 'midSouth', 'midDoorS', 'midInside', 'midDoorN', 'midNorth', 'aSite'],
    midB: ['spawnV', 'midSouth', 'midDoorS', 'midInside', 'midDoorN', 'midNorth', 'bSite'],
    blong: ['spawnV', 'bLong1', 'bLong2', 'bLong3', 'bSite'],
  },

  // Where defenders hold, per site.
  holds: {
    A: ['aHold1', 'aHold2'],
    B: ['bHold1', 'bHold2'],
    mid: ['midHold'],
  },
};
