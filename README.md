# EMBER YARD — tactical FPS (make.fun threejs-fps-02)

A round-based tactical FPS in the Counter-Strike style, built on
three.js 0.187.0. Static files only — no build step, no network.

## Play

Serve `game/` with any static server and open `index.html` in desktop
Chrome (WebGL 2):

```sh
npx serve game   # or: python3 -m http.server -d game 8080
```

Click to play. You are VANGUARD (attackers, blue) against the JACKALS
(defenders, amber) on **Yard 7**, a freight yard at dusk. Plant the bomb
at site A (crane yard) or B (warehouse), or eliminate the enemy team.
First to 8 rounds takes the match.

- **WASD** move · **Mouse** aim · **Click** fire · **Right click** aim down sights
- **Shift** sprint · **Ctrl / C** crouch · **Space** jump · **R** reload
- **1 / 2** weapons · **4 / 5 / 6 / Q / G** grenades · **E** plant the bomb
- **B** buy menu (buy phase) · **Esc** pause

## The game

- **Gunplay:** hitscan against body/head spheres (headshots deal 3x),
  recoil that kicks the view, spread that blooms per shot and grows while
  moving or airborne — stopping to aim pays. Five weapons (P9, VK-47,
  Hornet SMG, Longbow DMR, Breacher shotgun) plus frag, smoke and flash
  grenades, kevlar, and a per-round economy with a buy menu.
- **Bots:** four teammates and five enemies with a state machine — lane
  routes over a waypoint graph, hold angles, peek, react to gunfire they
  hear, push or fall back, plant and defuse. They see through line of
  sight and field of view; smoke blocks their sight.
- **Rounds:** 100-second rounds, 15-second buy phases, bomb timer,
  elimination / plant / defuse / timeout endings, loss-streak bonuses,
  first to 8.
- **Map:** an original freight yard — A-long, mid doors, B-long, a crane
  yard and a warehouse, built from one data file (`game/src/map.js`).

## Code

One job per module under `game/src/`: `state` (the single store),
`config` (all tuning), `map` (the map data), `world` (three.js scene +
collision/LOS), `player` (movement + look), `weapons` (spread, recoil,
reload, buying), `combat` (hits, damage, grenades), `bots` (AI),
`rounds` (match clock + economy), `hud` (DOM + minimap), `audio`
(synthesized sounds), `util` (math + collision primitives). The
simulation runs at a fixed 60 Hz step, apart from rendering, with no
per-frame allocations in the hot loops.

## Entry program

`main.ts` (Node 22, stdlib only) copies `game/` and `screenshots/` to
the output directory and writes `dossier.json` with the kit's
`buildDossier`:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## License

MIT — see `LICENSE`.
