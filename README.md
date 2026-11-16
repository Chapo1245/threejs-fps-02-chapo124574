[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Chapo1245/threejs-fps-02-chapo124574/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Chapo1245/threejs-fps-02-chapo124574/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

# COPPERLINE — 5v5 plant-and-defuse tactical FPS

A complete, original, Counter-Strike-style tactical FPS that runs offline in a
browser on three.js. Two teams of five fight round-based matches in an old
copper works on a canal: **RIVETS** (attack) must plant the spike at Site A or
Site B and hold it until it blows, or clear every **WARDEN** (defend). First
team to 5 rounds takes the yard.

## The game

- **Complete round loop** — buy phase (12 s) → live round (100 s) → round end
  → next round, first to 5. Rounds end by elimination, spike detonation,
  defuse, or timeout.
- **Gunplay that rewards stopping to aim** — 5 weapons (P9 sidearm, VK-9 SMG,
  AR-77 rifle, DMR-12 marksman, M590 breacher) with per-weapon damage, RPM,
  spread, recoil and bloom; headshots pay 1.6–2.5×; spread grows while moving
  or airborne and shrinks when crouched or aiming down sights; raycast hits
  against head sphere + body capsule, with damage falloff and kevlar halving.
- **Tactics** — buy economy ($800 start, $300/kill, $3,250/win, loss streak
  bonus, plant/defuse bonuses), frag / smoke / flash grenades, kevlar and
  defuse kits, and bots that follow waypoint routes, hold lanes, react to
  gunfire they hear, call out kills and plants on the radio, throw frags at
  grouped enemies, smoke a site entrance to cover a plant, and retake +
  defuse when the spike goes down.
- **Map + look** — an original canal-side works yard: kiln block, container
  stacks, furnace mid, drainage canal, brick + copper + teal palette in bright
  daylight, with a circular minimap (A/B sites, live dots, view cone), score
  bar, HP/armor, ammo, money, killfeed, radio log, buy menu and Tab
  scoreboard.
- **Code** — one job per module (`state` is the single store, `sim` ticks at
  a fixed 60 Hz apart from rendering, `world` owns collision/LOS/nav,
  `combat` resolves shots, `bots` decides, `hud` draws, `audio` synthesises,
  `render` syncs meshes), pooled tracers/particles/smoke, no per-frame
  allocation in the hot loops.

## Play it

```sh
node serve.ts        # serves game/ at http://localhost:8080
```

or open `game/index.html` from any static file server. Click **CLICK TO PLAY**,
then: WASD move · mouse aim · click fire · right-click aim · R reload ·
C crouch · Shift walk · Space jump · 1–3 weapons · Q throw grenade ·
E plant/defuse (hold) · B buy menu · Tab scoreboard.

## Entry

`main.ts` (Node 22, standard library only) copies `game/` and `screenshots/`
into the output directory and writes `dossier.json` with `buildDossier` from
`vendor/makefun-threejs.ts`. Run it with:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Entered on [make.fun](https://make.fun/bounty/threejs-fps-02) in the
**Make the best three.js tactical FPS** bounty. Licensed under the MIT License
(see `LICENSE`) — an original map, original art, original names, no copied
assets.

<sub>Entered on [make.fun](https://make.fun/?ref=wtacm6ft&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
