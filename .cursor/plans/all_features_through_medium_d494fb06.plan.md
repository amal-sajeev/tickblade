---
name: All Features Through Medium
overview: "Implement all 17 features categorized as Trivial, Small, and Medium: combo scoring, sound variety, pause menu, survival mode, difficulty presets, rematch/best-of-3, screen effects, smooth camera, settings screen, variable pendulum patterns, parallax backgrounds, procedural music, tutorial flow, mobile optimization, emotes, power-ups, and announcer callouts."
todos:
  - id: combo-scoring
    content: "Combo scoring: track comboMultiplier on players, multiply PERFECT score, display in HUD and judgment popup"
    status: completed
  - id: sound-variety
    content: "Hit/perfect sound variety: add pitch randomization and streak-based frequency scaling in audio.js"
    status: completed
  - id: pause-menu
    content: "Pause menu: add pause-screen HTML, 'paused' phase, Escape key handler, time offset on resume"
    status: completed
  - id: survival-mode
    content: "Survival mode: new menu button, no BPM cap, first-hit death, localStorage high score, results display"
    status: completed
  - id: difficulty-presets
    content: "Difficulty presets: Easy/Normal/Hard CFG overrides, difficulty selector sub-menu, mutator toggles"
    status: completed
  - id: rematch-best-of-3
    content: "Rematch / best-of-3: series win tracking, round display on results, online sync"
    status: completed
  - id: screen-effects
    content: "Screen effects at high BPM: vignette overlay, red pulse on miss, blade trail particles"
    status: completed
  - id: smooth-camera
    content: "Smooth camera: lerped Y offset based on jump, slight zoom-out at high BPM"
    status: completed
  - id: settings-screen
    content: "Settings screen: volume sliders, toggle shake/camera, GainNode in audio.js, localStorage persistence"
    status: completed
  - id: variable-patterns
    content: "Variable pendulum patterns: double-swing, syncopation, pause patterns above 140 BPM"
    status: completed
  - id: parallax-bg
    content: "Parallax background layers: split bg into 3 depth layers, offset by pendulum angle"
    status: completed
  - id: procedural-music
    content: "Procedural music: kick/snare/hihat drum loop synced to BPM via Web Audio scheduling"
    status: completed
  - id: tutorial-flow
    content: "Tutorial / first-time flow: guided overlay sequence with highlighted regions, localStorage flag"
    status: completed
  - id: mobile-optimization
    content: "Mobile optimization: haptic feedback, larger touch targets, portrait mode support"
    status: completed
  - id: emotes
    content: "Emotes / taunts: key-triggered text bubbles, online sync, rendered above character"
    status: completed
  - id: power-ups
    content: "Power-ups / hazards: spawn system, shield/slow/double-points pickups, spike hazard, canvas rendering"
    status: completed
  - id: announcer
    content: "Announcer callouts: synthesized arpeggio/chord sounds for PERFECT, STREAK, DANGER, GAME OVER"
    status: completed
isProject: false
---

# Implement All Features Through Medium Tier

17 features across 4 files (`game.js`, `renderer.js`, `audio.js`, `index.html`/`style.css`), grouped by dependency order.

---

## Phase 1: Trivial (minutes each)

### 1. Combo Scoring
In `game.js`, track a `comboMultiplier` on each player. Consecutive PERFECTs increment it (2x, 3x, 4x...). GOOD or MISS resets to 1x. Score award becomes `2 * comboMultiplier` for PERFECT, `1` for GOOD. Display multiplier in HUD (`updateHUD`) and on judgment popup in `renderer.js`.

### 2. Hit/Perfect Sound Variety
In `audio.js`, add pitch randomization to `playHit()` and `playPerfect()`. Use `detune` on oscillators with slight random offset (+/- 50 cents). For streak-based escalation, shift base frequency up slightly with combo count (passed as parameter).

### 3. Pause Menu
- New HTML overlay `#pause-screen` in `index.html` with Resume and Quit buttons
- New phase `'paused'` in `game.js`. Escape key toggles pause (only in `playing` phase, not online mode)
- On pause: store `pauseStartTime`, cancel RAF. On resume: adjust `gameStartTime` by pause duration, restart RAF
- CSS styled like other screens

### 4. Survival / Endless Mode
- New menu button "SURVIVAL" in `index.html`
- `mode = 'survival'` -- single player, no `MAX_BPM` cap, no `MAX_HITS` end (first hit = game over, or configurable)
- Track elapsed time and score. On death, save high score to `localStorage`
- Results screen shows time survived, final BPM, score, and local best

---

## Phase 2: Small (hour or less each)

### 5. Difficulty Presets
- Add a difficulty selector sub-menu that appears after clicking Practice/Local/Survival
- Presets modify `CFG` values:
  - **Easy**: START_BPM=40, MAX_BPM=120, PERFECT_WINDOW=0.10, GOOD_WINDOW=0.14, MAX_HITS=5
  - **Normal**: current defaults
  - **Hard**: START_BPM=80, MAX_BPM=220, PERFECT_WINDOW=0.05, GOOD_WINDOW=0.07, MAX_HITS=2, BPM_STEP=8
- Mutators as toggleable options: "One-Hit KO" (MAX_HITS=1), "Double Ramp" (BPM_STEP*2), "Invisible Blade" (renderer hides blade at high BPM)

### 6. Rematch / Best-of-3
- Track `seriesWins = [0, 0]` and `seriesRound` (persists across rematches until back-to-menu)
- Results screen shows series score (e.g., "Round 2 of 3 -- P1 leads 1-0")
- "PLAY AGAIN" becomes "NEXT ROUND" if series incomplete, "REMATCH" if series finished
- Online: sync series state via `MP.send({ type: 'start', series: true })`

### 7. Screen Effects at High BPM
In `renderer.js`, after world rendering in `render()`:
- **Vignette**: radial gradient overlay, opacity scales with `bpm / MAX_BPM`
- **Red pulse**: on MISS, flash red overlay (`globalAlpha` fading)
- **Blade trail**: store last N blade tip positions, draw fading line trail
- Pass `bpm` and `maxBpm` in the render state object from `game.js`

### 8. Smooth Camera
In `renderArena()`, replace the static view with a gentle lerped camera:
- Track `cameraOffsetY` that eases toward a target based on player jump height
- At high BPM (>120), slight zoom-out (scale 0.95) to give more visual breathing room
- Lerp factor ~0.05 per frame for smooth feel
- State passed from `game.js`: `bpm`, player `jumpY`

### 9. Settings Screen
- New HTML screen `#settings-screen` with: Master Volume slider, SFX Volume slider, Music Volume slider, Toggle Screen Shake, Toggle Camera Sway
- "SETTINGS" button on main menu
- `audio.js`: add master `GainNode` between sounds and `ctx.destination`; expose `setVolume(val)` / `setMusicVolume(val)`
- Persist all settings to `localStorage`, load on init
- `renderer.js`: read shake toggle from settings

---

## Phase 3: Medium

### 10. Variable Pendulum Patterns
After BPM exceeds a threshold (e.g., 140+), introduce pattern variations:
- **Double-swing**: two quick swings (half period) then a pause
- **Syncopation**: off-beat emphasis (shift beat by half)
- **Pause**: hold at apex for one beat then resume
- Implemented by modifying the `pendulumAngle` formula with a pattern function that maps `totalBeats` to a modified phase

### 11. Parallax Background Layers
In `renderer.js`:
- Split `buildBackground()` into 3 cached layers: far sky+stars, mid wall+torches, near decorative elements
- Each layer shifts horizontally based on `pendulumAngle * depthFactor` (far=0.02, mid=0.05, near=0.1)
- Draw layers in order with offsets in `render()` before arena content
- Subtle vertical parallax on player jump for near layer

### 12. Procedural Music / Drum Loop
In `audio.js`:
- New `MusicEngine` sub-module: schedule kick (low osc), snare (noise burst), hihat (high noise) on beat subdivisions
- Tempo-sync to game BPM: on each beat tick from `game.js`, call `SFX.musicBeat(beatIdx, bpm)`
- Kick on beats 0,2; snare on 1,3; hihat on every beat (4/4 pattern)
- Volume controlled by settings music slider
- `startMusic()` / `stopMusic()` exposed; called from `beginGame` / `endGame`

### 13. Tutorial / First-Time Flow
- Check `localStorage.getItem('tutorialDone')` on init
- If not done, show a guided overlay sequence before first practice game:
  1. "The blade swings like a pendulum" (highlight blade)
  2. "Press SPACE to jump over it" (show key prompt, wait for press)
  3. "Time it right for PERFECT!" (wait for successful jump)
  4. "Survive as long as you can!" (dismiss, set flag)
- Render as canvas overlays with highlighted regions and text boxes
- Skip button available

### 14. Mobile Optimization
- Larger touch target: full-screen tap area (already mostly there via canvas touch)
- Haptic feedback: `navigator.vibrate(50)` on hit, `navigator.vibrate(20)` on jump
- CSS: ensure buttons have min 44px touch targets, add `touch-action: manipulation` where needed
- Responsive font sizes already exist; verify HUD readability at 375px width
- Add portrait mode support: if `window.innerHeight > window.innerWidth`, rotate layout hint or letterbox

### 15. Emotes / Taunts
- Key bindings: 1-4 trigger emotes during gameplay (only cosmetic, no game effect)
- Emote appears as pixel text bubble above character, fades after 1.5s
- Options: "!" (taunt), "GG", "Nice!", "..." 
- Online: send via `MP.send({ type: 'emote', emote: idx })`, render on remote player
- Rendered in `renderCharacter()` in `renderer.js`

### 16. Power-ups / Hazards
- Spawn system: every N beats (configurable), chance to spawn an item on the platform
- Items rendered as small colored squares with icons (canvas drawn)
- Player collects by being at item position when grounded
- Power-ups: **Shield** (absorb 1 hit, gold glow on character), **Slow** (halve BPM for 5 beats), **Double Points** (2x score for 5 beats)
- Hazards: **Spike** (floor area that damages if standing on it for 1 beat -- forces jump)
- State tracked per-player, rendered in `renderArena()`
- Not available in online mode initially (sync complexity)

### 17. Announcer / Voice Callouts
In `audio.js`:
- Synthesize robotic voice-like sounds using rapid oscillator sequences
- Callouts: "PERFECT" (ascending arpeggio), "STREAK" (at 5x+, triumphant chord), "DANGER" (low pulsing when 1 heart left), "GAME OVER" (descending)
- Triggered from `game.js` at appropriate moments
- Volume tied to SFX volume setting

---

## File Change Summary

- **[game.js](game.js)**: Combo scoring, pause phase, survival mode, difficulty presets, rematch state, variable patterns, tutorial flow, emote input, power-up logic, announcer triggers
- **[renderer.js](renderer.js)**: Screen effects, smooth camera, parallax layers, emote rendering, power-up/hazard rendering, tutorial overlays
- **[audio.js](audio.js)**: Sound variety, music engine, volume control (GainNode), announcer sounds
- **[index.html](index.html)**: Pause overlay, survival button, difficulty sub-menu, settings screen, tutorial markup
- **[style.css](style.css)**: Styles for all new screens/overlays, mobile responsive updates
