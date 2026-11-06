# Drift

A calm, retro screensaver for the terminal. Full-screen ASCII, one colour, slow
motion, no sound, no status bar. Built for a side monitor.

Zero dependencies. Node 20+ (developed on Node 22). Windows 11, Windows Terminal.

## Run

```
drift                      # after the PATH step below
bin\drift.cmd              # the shim: finds its own folder, then runs node bin\drift.js
node bin\drift.js          # same thing
drift --help
```

Options (also available as environment variables):

| flag | env | default | meaning |
|---|---|---|---|
| `--scene-seconds N` | `DRIFT_SCENE_SECONDS` | 180 | seconds per scene (scene time, so `+` speeds this up too) |
| `--fade-seconds N` | `DRIFT_FADE_SECONDS` | 15 | length of the cross-fade between scenes |
| `--fps N` | `DRIFT_FPS` | 18 | frames per second (1-30) |
| `--seed N` | `DRIFT_SEED` | 1 | seed for rain and ripples |
| `--scene NAME` | `DRIFT_SCENE` | squiggle | start scene: squiggle, sunburst, plasma, ripples, rain |
| | `DRIFT_CONFIG` | see below | full path of the config file |

## Keys

| key | does |
|---|---|
| space | next scene (cross-fades; pressing it mid-fade queues exactly one more) |
| `+` / `-` | speed up / slow down (0.25x to 4x, clamped) |
| `p` | pause / resume (resumes without a jump) |
| `c` | next colour; the choice is remembered |
| `q` or Ctrl+C | quit; the terminal is restored exactly |

Unknown keys and arrow keys are ignored. There is no status bar and no hint overlay.

## Scenes

Five, about three minutes each, joined by a 15 second cross-fade that blends the
two intensity fields continuously (never a hard cut). They loop in order:

1. **Squiggle** - a long soft fading trail on a slowly morphing Lissajous/spirograph. The line is drawn in braille dots; a faint block glow follows the head.
2. **Sunburst** - slow rays turning around a drifting centre, with a gentle pulse.
3. **Plasma** - a rolling sine field.
4. **Ripples** - overlapping rings spreading from random (seeded) points.
5. **Rain** - sparse, slow, soft falling streaks; much calmer than Matrix rain.

Density ramp: `' ' · : ░ ▒ ▓ █`, 7 bands. Glyph bands and colour brightness (16
levels) both use hysteresis so a value wobbling at a boundary does not flicker.

## Colours

`c` cycles, in order, and wraps: Claude orange `#D97757` (default), amber
phosphor, green phosphor, ice blue, violet, white, then a slow orange/violet blend
(2-minute loop). Truecolor is used when `COLORTERM` is `truecolor`/`24bit` or
`WT_SESSION` is set (Windows Terminal); otherwise a 256-colour fallback.

Config: `%APPDATA%\drift\config.json`, containing only `{"colour": "<name>"}`.
Missing or corrupt files are ignored. Drift never writes anywhere else. Override
the path with `DRIFT_CONFIG`.

## Architecture

Scenes are pure maths: `scene(t, w, h, params) -> Uint8Array(w*h)` (0-255, row
major, a cell is 1 unit wide and 2 tall). Same inputs, same output, any call
order. No terminal access in `src/scenes/`. The contract is documented at the top
of `src/scenes/util.js`. Squiggle may also fill `params.glyphs` with braille dot
masks.

```
src/scenes/*.js   five pure scenes            src/compose.js   cross-fade, scheduler, field -> cells
src/ramp.js       density ramp + hysteresis   src/renderer.js  diff renderer (one string per frame)
src/color.js      presets, SGR, 256 fallback  src/term.js      alt screen, raw keys, signal guards
src/config.js     JSON config                 src/app.js       the loop that wires it all together
bin/drift.js      entry   bin/drift.cmd  shim  tools/          capture.mjs measure.mjs calm.mjs
```

Terminal handling: alternate screen, hidden cursor, raw mode; restored on `q`,
Ctrl+C (byte 0x03), SIGINT/SIGTERM, uncaught exceptions, unhandled rejections and
scene errors. Enter is `ESC[?1049h ESC[?25l`; leave is exactly `ESC[?25h ESC[?1049l ESC[0m`.
Only changed cells are written, as a single `stdout.write` per frame; unchanged
frames write nothing; the bottom-right cell is never drawn. If stdin or stdout is
not a TTY, drift prints a message and exits 0 without emitting any escape sequence.

## Tests

```
npm test            # node --test, no dependencies
```

Test hooks (inert unless `DRIFT_TEST_FORCE_TTY` is exactly `1`; used by
`tests/real-process.test.js`, which spawns the real `bin/drift.js` with piped stdio):

| env | effect |
|---|---|
| `DRIFT_TEST_FORCE_TTY=1` | treat piped stdin/stdout as a TTY (raw mode is skipped when unavailable) |
| `DRIFT_TEST_COLS`, `DRIFT_TEST_ROWS` | fake size when stdout has none (default 80x24) |
| `DRIFT_TEST_THROW_AFTER_MS=N` | throw an uncaught error after N ms, to prove the terminal is restored |

## Capture, calmness, measure

```
node tools/capture.mjs [--out captures]     # .txt (chars only) and .ansi, 5 scenes + crossfade, 120x40 and 240x67; scenes at t = 0, 5, 10, 20 s, crossfade at 0, 25, 50, 75, 100% of the 15 s default fade
node tools/calm.mjs [--seconds 60]          # calmness table (cells changing per frame, mean intensity change) plus cross-fade rows at the shipped fade
node tools/measure.mjs --seconds 60 --cols 240 --rows 67 [--scene mix|squiggle|sunburst|plasma|ripples|rain|all]
```

`captures/*.ansi` are git-ignored (large); regenerate with the capture command and
view with `type captures\sunburst-120x40.ansi` in a truecolor terminal.

Fade calmness is measured, not assumed. Across a sweep of seeds 1-3, start times
8/40/100 s, all five adjacent scene pairs and both sizes (120x40, 240x67), the
15 second fade changes at most about 7.1% of cells in any one frame (worst case
plasma > ripples at 120x40); the mean is about 1-3%. `tests/tools.test.js` fails
above 7.5%, and checks that a 1 second fade is clearly busier on every pair.

`measure.mjs` runs the real app loop (same compose, hysteresis, diff renderer, string
build and fps timer) against a fake TTY whose `write` only counts bytes, and samples
process CPU and RSS each second. It includes scene maths, cross-fade, diff, string
build, the timer and Node/V8 itself. It excludes the cost of Windows Terminal parsing
and drawing the bytes (another process) and any real console write. `process.cpuUsage`
has about 15 ms granularity on Windows, so single one-second samples are lumpy; trust
the run mean.

## Windows Terminal: full-screen profile (paste, do not auto-install)

Open Windows Terminal, Ctrl+Shift+, (or Settings, Open JSON file) and add this object
to the `profiles.list` array in `settings.json`. Drift does not edit that file.

```json
{
  "guid": "{dad089bb-7bb4-4dd4-ae86-1fdb6b8b82f4}",
  "name": "Drift",
  "commandline": "node C:\\Projects\\drift\\bin\\drift.js",
  "startingDirectory": "C:\\Projects\\drift",
  "tabTitle": "drift",
  "suppressApplicationTitle": true,
  "closeOnExit": "always",
  "padding": "0",
  "scrollbarState": "hidden",
  "useAcrylic": false,
  "font": { "face": "Cascadia Mono", "size": 14 }
}
```

If `drift` is on PATH you can use `"commandline": "C:\\Projects\\drift\\bin\\drift.cmd"` instead.

Launching full-screen: `launchMode` is a global Windows Terminal setting (top level of
`settings.json`, not inside a profile), and it would make every launch full-screen, so
prefer the command-line flag for this one window:

```
wt.exe --fullscreen -p "Drift"
```

(`-F` is the short form.) On a second monitor, move the window there first; Windows
Terminal remembers the monitor it was last on. Braille and block characters render
best in Cascadia Mono / Cascadia Code.

## App Hub entry (suggestion only; apps.json is not touched)

```json
{
  "id": "drift",
  "project": "drift",
  "name": "Drift",
  "description": "Calm ASCII screensaver for the side monitor (full-screen Windows Terminal).",
  "dir": "C:/Projects/drift",
  "launch": "wt.exe --fullscreen -p \"Drift\""
}
```

This follows the shape of the existing `launch` entries in App Hub's `apps.json`. Whether
App Hub passes arguments in `launch` through unchanged is unknown; check before relying on it.

## Delivery (proposal only, nothing here has been executed)

The code lives in the `work` worktree (`C:\Projects\drift\.worktrees\work`) until it is
merged into `main`. After the merge, `C:\Projects\drift\bin` holds `drift.js` and
`drift.cmd`, and every command below refers to that merged location, not the worktree.

### Option A: put `C:\Projects\drift\bin` on the user PATH

```powershell
$bin = 'C:\Projects\drift\bin'
$cur = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @($cur -split ';' | Where-Object { $_ -ne '' })
if ($parts -notcontains $bin) {
  [Environment]::SetEnvironmentVariable('Path', (($parts + $bin) -join ';'), 'User')
  'added'
} else { 'already present' }
```

Verify: open a NEW terminal (existing ones keep the old PATH), then

```powershell
where.exe drift      # expect C:\Projects\drift\bin\drift.cmd
drift                # runs; q quits
```

Rollback: remove that one entry from User PATH (Settings, Environment Variables).

### Option B: `npm link`

```powershell
cd C:\Projects\drift
npm link
```

Verify in a new terminal: `where.exe drift` (expect a shim under the npm global bin
folder, `npm prefix -g`), then `drift`. Rollback:

```powershell
cd C:\Projects\drift
npm unlink -g drift
```
