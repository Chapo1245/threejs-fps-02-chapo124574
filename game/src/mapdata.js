// mapdata.js — "Brickline": an original low-poly brick-city district at dusk.
// Pure data: solids, sites, spawns, the bot waypoint graph and props.
// Nothing here is copied from any commercial map. Coordinates are metres,
// x east, z south, y up. A solid is {x0, z0, x1, z1, h, kind, tone} where
// kind picks the look (brick / container / crate / barrel / van / leg) and
// tone picks a palette tint. All solids are full-height for movement.

export const MAP = {
  bounds: { x0: -44, z0: -32, x1: 44, z1: 32 },

  // --- buildings: brick apartment blocks closing the streets ---
  solids: [
    // north edge row (behind A-long)
    { x0: -40, z0: -32, x1: -20, z1: -26, h: 11, kind: 'brick', tone: 0 },
    { x0: -18, z0: -32, x1: 2, z1: -26, h: 8, kind: 'brick', tone: 1 },
    { x0: 4, z0: -32, x1: 24, z1: -26, h: 13, kind: 'brick', tone: 2 },
    { x0: 26, z0: -32, x1: 40, z1: -26, h: 9, kind: 'brick', tone: 3 },
    // south edge row (behind B-long)
    { x0: -40, z0: 26, x1: -22, z1: 32, h: 10, kind: 'brick', tone: 1 },
    { x0: -20, z0: 26, x1: 0, z1: 32, h: 12, kind: 'brick', tone: 2 },
    { x0: 2, z0: 26, x1: 22, z1: 32, h: 8, kind: 'brick', tone: 0 },
    { x0: 24, z0: 26, x1: 40, z1: 32, h: 11, kind: 'brick', tone: 3 },
    // west edge
    { x0: -44, z0: -26, x1: -40, z1: -5, h: 10, kind: 'brick', tone: 2 },
    { x0: -44, z0: 5, x1: -40, z1: 26, h: 10, kind: 'brick', tone: 0 },
    // corners (close the map so no void shows past the edge)
    { x0: -44, z0: -32, x1: -40, z1: -26, h: 10, kind: 'brick', tone: 1 },
    { x0: 40, z0: -32, x1: 44, z1: -26, h: 9, kind: 'brick', tone: 2 },
    { x0: -44, z0: 26, x1: -40, z1: 32, h: 10, kind: 'brick', tone: 3 },
    { x0: 40, z0: 26, x1: 44, z1: 32, h: 9, kind: 'brick', tone: 0 },
    // east edge
    { x0: 40, z0: -26, x1: 44, z1: -5, h: 9, kind: 'brick', tone: 1 },
    { x0: 40, z0: 5, x1: 44, z1: 26, h: 9, kind: 'brick', tone: 3 },
    // north blocks (between A-long and mid)
    { x0: -36, z0: -16, x1: -18, z1: -5, h: 12, kind: 'brick', tone: 3 },
    { x0: -8, z0: -16, x1: 8, z1: -5, h: 14, kind: 'brick', tone: 0 },
    { x0: 18, z0: -16, x1: 24, z1: -5, h: 8, kind: 'brick', tone: 1 },
    // south blocks (between mid and B-long)
    { x0: -36, z0: 5, x1: -18, z1: 16, h: 9, kind: 'brick', tone: 2 },
    { x0: -8, z0: 5, x1: 8, z1: 16, h: 11, kind: 'brick', tone: 1 },
    { x0: 18, z0: 5, x1: 24, z1: 16, h: 7, kind: 'brick', tone: 0 },

    // --- Site A container yard (Depot) ---
    { x0: 26, z0: -24, x1: 32, z1: -21, h: 2.6, kind: 'container', tone: 0 },
    { x0: 33, z0: -24, x1: 38, z1: -22.5, h: 2.6, kind: 'container', tone: 1 },
    { x0: 27, z0: -20, x1: 31, z1: -17.5, h: 5.2, kind: 'container', tone: 2 },
    { x0: 35, z0: -19, x1: 39, z1: -16, h: 2.6, kind: 'container', tone: 3 },
    // crane legs over the yard (visual + solid)
    { x0: 38.7, z0: -24.8, x1: 39.3, z1: -24.2, h: 18, kind: 'leg', tone: 0 },
    { x0: 38.7, z0: -13.8, x1: 39.3, z1: -13.2, h: 18, kind: 'leg', tone: 0 },

    // --- crates, barrels, van: street cover ---
    { x0: 9.2, z0: 2.2, x1: 10.8, z1: 3.8, h: 1.2, kind: 'crate', tone: 0 },
    { x0: -11, z0: -9, x1: -9, z1: -7, h: 1.8, kind: 'crate', tone: 1 },
    { x0: 27.1, z0: 19.1, x1: 28.9, z1: 20.9, h: 1.2, kind: 'crate', tone: 2 },
    { x0: -27, z0: 2, x1: -25, z1: 4, h: 2.4, kind: 'crate', tone: 3 },
    { x0: -20.8, z0: -21.8, x1: -19.2, z1: -20.2, h: 1.2, kind: 'crate', tone: 1 },
    { x0: 19, z0: -21.8, x1: 21, z1: -20.2, h: 1.2, kind: 'crate', tone: 0 },
    { x0: 15.6, z0: 2.6, x1: 16.5, z1: 3.5, h: 1.1, kind: 'barrel', tone: 0 },
    { x0: 16.6, z0: 3.6, x1: 17.5, z1: 4.5, h: 1.1, kind: 'barrel', tone: 1 },
    { x0: -16.5, z0: 11.6, x1: -15.6, z1: 12.5, h: 1.1, kind: 'barrel', tone: 2 },
    { x0: 29.6, z0: -14.6, x1: 30.5, z1: -13.7, h: 1.1, kind: 'barrel', tone: 3 },
    { x0: -27, z0: -25.5, x1: -22.5, z1: -23.5, h: 2.2, kind: 'van', tone: 0 },
  ],

  // --- bomb sites (plant zones) ---
  sites: {
    A: { name: 'DEPOT', x0: 26, z0: -24, x1: 38, z1: -14 },
    B: { name: 'ARCADE', x0: 26, z0: 17, x1: 38, z1: 24 },
  },

  spawns: {
    azure: { x: -39, z: 0, yaw: 0 },          // attackers, west, facing east
    rust: { x: 39, z: 0, yaw: Math.PI },      // defenders, east, facing west
  },

  // --- bot waypoint graph: nodes on street centrelines, edges hand-checked
  // so no edge crosses a solid (container C3 blocks the straight A-long
  // line, so the site-A approach runs through node 23 instead). ---
  waypoints: [
    [-39, 0], [-30, 0], [-13, 0], [0, 0], [13, 0], [30, 0], [39, 0],
    [-30, -21], [-13, -21], [0, -21], [13, -21], [26, -21], [34, -14],
    [-30, 21], [-13, 21], [0, 21], [13, 21], [26, 21], [32, 18],
    [-13, -10], [-13, 10], [13, -10], [13, 10], [22, -18], [22, 18],
  ],
  edges: [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6],
    [1, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 23], [23, 12],
    [1, 13], [13, 14], [14, 15], [15, 16], [16, 17], [17, 24], [24, 18],
    [2, 19], [19, 8], [2, 20], [20, 14],
    [4, 21], [21, 10], [4, 22], [22, 16],
  ],

  // Attacker lane routes (waypoint id lists) toward each site.
  routes: {
    A: [0, 1, 7, 8, 9, 10, 11, 23, 12],
    Amid: [0, 1, 2, 3, 4, 21, 10, 11, 23, 12],
    Bmid: [0, 1, 2, 3, 4, 22, 16, 17, 24, 18],
    B: [0, 1, 13, 14, 15, 16, 17, 24, 18],
  },

  // Defender hold points: [x, z, yaw] — two per site plus mid.
  holds: {
    A: [[34, -14, 2.6], [28, -15, 1.8], [30, -24.5, 0.4]],
    B: [[32, 18, 2.6], [27, 21, 1.2], [37, 20, 3.6]],
    mid: [[13, 0, 3.14]],
  },

  // --- visual-only props (no collision): lamps, planters, crane jib ---
  lamps: [[-13, -4.2], [13, -4.2], [-13, 4.2], [13, 4.2], [0, -16.8],
    [0, 16.8], [26, -16.8], [26, 16.8], [-30, -16.8], [-30, 16.8]],
  planters: [[-4, 6.5], [4, 6.5], [-4, -6.5], [4, -6.5], [30, 6.5], [30, -6.5]],
  // Crane jib: a long beam over site A, high up (pure visual).
  craneJib: { x0: 39, z0: -24.5, x1: 39, z1: -13.5, y: 17.4 },
};

// Breadth-first shortest path over the waypoint graph. Returns an array
// of waypoint ids from `from` to `to` (inclusive), or null when unreachable.
export function bfsPath(from, to) {
  const n = MAP.waypoints.length;
  const prev = new Array(n).fill(-1);
  const seen = new Array(n).fill(false);
  const queue = [from];
  seen[from] = true;
  while (queue.length) {
    const cur = queue.shift();
    if (cur === to) break;
    for (const [a, b] of MAP.edges) {
      const nxt = a === cur ? b : b === cur ? a : -1;
      if (nxt >= 0 && !seen[nxt]) {
        seen[nxt] = true; prev[nxt] = cur; queue.push(nxt);
      }
    }
  }
  if (!seen[to]) return null;
  const path = [to];
  let cur = to;
  while (cur !== from) { cur = prev[cur]; path.unshift(cur); }
  return path;
}

// Nearest waypoint id to (x, z).
export function nearestNode(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < MAP.waypoints.length; i++) {
    const [wx, wz] = MAP.waypoints[i];
    const d = (wx - x) * (wx - x) + (wz - z) * (wz - z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
