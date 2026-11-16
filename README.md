# EMBER YARD v3 — Slagworks

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Chapo1245/threejs-fps-02-chapo124574/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Chapo1245/threejs-fps-02-chapo124574/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical FPS in the browser, built on three.js 0.187.0 — no build step, no network, just static files. Entered on [make.fun](https://make.fun/bounty/threejs-fps-02) for the **threejs-fps-02** bounty.

## The game

You are the Ember Crew attacker carrying the charge. Five versus five, first to five rounds, plant-and-defuse at two sites — with a buy economy between rounds and bots that actually play the map.

- **Three original maps** — Slagworks (dusk foundry yard, 3 lanes), Night Dock (harbour at night, long sniper sightlines), Cinder Pit (compact arena, fast rounds). Pick one on the menu; Slagworks is the default.
- **Gunplay where stopping to aim pays** — headshot bonus damage, recoil bloom, spread that grows with movement and while airborne, acceleration-based movement, crouch, jump, and AABB collision.
- **Tactics** — plant the charge (hold E in a site) or wipe the defenders; money per round for kills, plants and wins, spent in a buy menu (rifle, SMG, shotgun, sniper, frag and smoke grenades, armour, ammo). Bots follow waypoint routes, hold sites, react to sight and sound, strafe in fights, plant, defuse and retake.
- **Feedback for everything** — hitmarkers, kill feed, damage direction, bomb beeps, round banners, a live minimap, and synthesized WebAudio sound (no audio files).
- **Built for heavy firefights** — pooled tracers and particles, instanced map geometry, one small shadow map, capped pixel ratio on touch, and adaptive quality that sheds resolution instead of frames.

## Controls

| Key | Action |
| --- | --- |
| W A S D / mouse | Move / aim (click the game to lock the pointer) |
| Click | Fire · R reload · 1–3 weapons · Q last weapon |
| E (hold) | Plant the charge inside a site |
| G | Grenade (frag / smoke) · B buy menu · Shift walk silent |
| C crouch · Space jump · Esc pause |

## Play it

Serve `game/` with any static server and open `index.html` in desktop Chrome (WebGL 2):

```sh
python3 -m http.server --directory game
# open http://localhost:8000
```

## Layout

- `game/index.html` — HUD, menus, import map
- `game/src/main.js` — boot, fixed-step loop, round state machine
- `game/src/state.js` — the single state store
- `game/src/config.js` — weapons, economy, the three variants
- `game/src/layouts.js` — the three original maps
- `game/src/world.js` — scene build, collision, line of sight
- `game/src/bots.js` — bot AI (routes, holds, vision, hearing, plant/defuse)
- `game/src/combat.js` — hitscan, headshots, grenades, explosions
- `game/src/weapons.js` — arsenal, recoil, spread, reload, buy shop
- `game/src/player.js` — movement physics
- `game/src/input.js` — keyboard, mouse, pointer lock, touch
- `game/src/render.js` — renderer, pooled tracers/particles, viewmodel
- `game/src/audio.js` — synthesized sound effects
- `game/src/hud.js` — HUD, minimap, buy menu, banners
- `main.ts` — the make.fun entry program (copies `game/` + `screenshots/`, writes `dossier.json`)

## License

MIT — see [LICENSE](LICENSE).

<sub>Entered on [make.fun](https://make.fun/?ref=wtacm6ft&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
