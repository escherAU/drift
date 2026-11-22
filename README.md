# Drift

A calm, retro screensaver for the terminal (plus three livelier modes). Full-screen ASCII,
slow motion by default, no sound, no status bar. Built for a side monitor.

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
| `--fps N` | `DRIFT_FPS` | 18 | frames per second (8-30; a lower value reads as 8, and a higher one as 30: why 8 is in the **Frame rate range** bullet of the Driftman 9000 section). In 256-colour terminals a full-colour cartridge (the Driftman 9000) is painted at 18 a second at most, whatever you ask for ([why](#driftman-9000-the-full-colour-cartridge)); everything else paints at the rate you ask for |
| `--seed N` | `DRIFT_SEED` | 1 | seed for rain and ripples |
| `--scene NAME` | `DRIFT_SCENE` | squiggle | start scene, in its own mode: squiggle, sunburst, plasma, ripples, rain, glyphrain, swarm, glitch, fireworks, vortex, life, tunnel, wire, maze, blocktype, bounce, sand, waves, pendulum, cloth, artist (a bare number counts calm scenes) |
| `--library` | | off | start in the cartridge library (see [Cartridges](#cartridges)) |
| `--cartridge ID` | | none | insert that cartridge at start; `last` means the one inserted most recently (Drift Classic if none yet). Wins over `--library` |
| | `DRIFT_CONFIG` | see below | full path of the config file |

## Keys

| key | does |
|---|---|
| `m` | next mode: calm, chaos, high contrast, experimental, calm... (remembered) |
| `1` `2` `3` `4` | jump to calm, chaos, high contrast, experimental (the current mode: nothing happens) |
| space | next scene in this mode's playlist, wrapping (calm cross-fades; pressing it mid-fade queues exactly one more) |
| `c` | next colour: calm and experimental cycle the single-hue presets; chaos cycles neon, candy, ocean, fire; high contrast ignores it |
| `i` | high contrast only: invert black on white / white on black (remembered) |
| `+` / `-` | speed up / slow down (0.25x to 4x, clamped) |
| `p` | pause / resume (resumes without a jump) |
| `l` | cartridge library (the Driftman 2000 console); see [Cartridges](#cartridges) |
| `h` | help panel: every key, grouped, with the current mode and scene; Esc or `h` closes it |
| `q` or Ctrl+C | quit; the terminal is restored exactly |

Every key lives in one table, `src/keymap.js`; the help panel and `drift --help` are
generated from it. While the help panel is open the animation is frozen behind it (nothing
is written), only `h`, Esc and `q`/Ctrl+C act, and closing it restores your pause state.
In Classic, unknown keys and arrow keys are ignored (the library and cartridges use the arrows).
There is no status bar. The panel shrinks to fit: roomy at 31 rows or more, compact (no blank
lines between groups) at 25 to 30, tight (the title and the mode line share one row) at 23 to
24, and below that it shows what fits and ends with "(+N more, enlarge window)".

**Minimum window: 40 columns x 10 rows (DRIFT-12).** Classic needs a window of at least 40x10. Below 40 columns, or below 10 rows, it shows a card, "Make the window bigger to see drift.",
centred and word-wrapped to the width, instead of the art, in every mode (the same card the console shows when it is too small, with Classic's last words). The card is in the mode's own
interface colour; in high contrast it is the same two colours as the art (strictly two-tone) and `i` inverts it. While the card shows, Classic's clock stands still (the scene, its
dissolve and the scene timer all wait, as they do under the console), no scene is drawn and nothing is written until something changes, and the help panel stays closed
(`h` still toggles it: it shows when the window is big enough). Make the window bigger and Classic carries on where it left off: grown back to the size it had, it shows the very
same picture it had (the glyphs, which is what the tests compare; the stored colour of a blank cell can differ) and the clock moves on from there; grown to another size, the time is kept and the scenes are rebuilt at the new size, as any resize does. The console
(the library and the cartridges) has its own tiers and is not affected. A terminal that reports no size at all is taken as 80x24.

## Modes

| mode | what it is |
|---|---|
| calm (default) | exactly drift v1: one hue, slow, five scenes, 15 s cross-fade |
| chaos | multi-colour letters, digits and symbols, busy but never strobing |
| high contrast | strictly black and white (two-tone, the background is painted too); `i` inverts |
| experimental | physics and ASCII sketches in the calm single-hue palette |

Calm is the default when nothing is saved; the last-used mode is saved and wins at launch.
In the three new modes, scenes change by a 2 second per-cell dissolve (each cell flips from
the old scene to the new at its own moment; never a whole-screen cut, no blending).
**Photosensitivity guard:** the screen background flips between dark and light at most once
every 3 seconds. A flip asked for sooner (`i`, or a mode change into/out of inverted high
contrast) is deferred, not dropped, and lands exactly once when the window ends.

Playlists (`src/scenes/index.js`, `PLAYLISTS`): calm = squiggle, sunburst, plasma, ripples,
rain; chaos = **glyphrain** (fast, dense multi-colour rain of letters, digits and symbols),
**swarm** (bouncing glyphs with fading trails), **glitch** (words assembling out of noise; streams scale with the screen),
**fireworks** (several rockets at once, bursts that scale with the screen) and **vortex** (a spinning spiral);
high contrast, strictly two-tone = **life** (Conway's Game of Life seeded from gliders,
R-pentomino, acorn, pulsar and friends, half-block pixels; reseeds when it dies or stalls; DRIFT-10: a cell changes on screen at most once every 0.6 s and Life
steps 10 generations a real second at 1x and every faster speed (slower speeds slow it), so the `+` key shortens its turn but does not make it faster),
**tunnel** (a slowly turning checkerboard tunnel from half and full blocks; no shade blocks,
which would read as a third tone; DRIFT-12: the rings flow outwards at 0.55 a second (0.9 before) and the pace does not follow the speed keys, they still shorten the scene's turn), **wire** (a rotating wireframe cube then torus in braille
dots; DRIFT-11: the shape turns in steps, a new clean pose every 0.6 s, at half the old rate, and its pace does not follow the speed keys), **maze** (a seeded maze carved live with box-drawing walls, solved in solid blocks,
held, wiped and regenerated; DRIFT-12: in high contrast it runs at its 1x pace at every faster speed, and the dissolve between two high-contrast scenes lasts 2 real seconds at every speed from 1x up) and **blocktype** (big block capitals spelling short words, with
a wipe, scroll or wave between them; DRIFT-11: each transition is two pictures that hold still while a sweep goes by, and the words keep their own pace at every speed); experimental (the calm single-hue palette, 16 brightness levels, physics sims stepped at a
fixed 1/30 s) = **bounce** (balls with gravity and friction, bounded energy), **sand** (a
falling-sand sim: moving emitters, slopes, a slow wind, ramps and a sieve on some cycles, and a
gradual dim-out when the box is half full; the grain count is conserved), **waves** (the 2D
wave equation with dropped pebbles and, now and then, two driven sources; crests are shade
blocks, troughs braille), **pendulum** (five RK4 double pendula started 0.0015 rad apart, so
they swing together and then fly apart, with fading tip trails; always on screen) and **cloth**
(a pinned Verlet curtain in a gusting wind, poked by a swinging ball; links glow as they
stretch) and **artist** (ASCII pictures sketched stroke by stroke: a bright pen cell leads and
the new strokes fade to the piece's resting brightness; the finished piece is held for 8 s, then
erased, alternating between a wipe in reverse stroke order and a cell-by-cell dissolve, the
screen rests for 1.5 s, and the next piece of the gallery begins, round and round). Later
scenes join a playlist and are picked up by the shared test suites automatically.

### The artist's gallery: adding a piece

Drop a `.txt` file in `src/art/pieces/` and restart: the file is a piece (no code to change).
Pieces are loaded once at start-up and drawn in a fixed order: the ones named in
OPENING_ORDER (src/art/gallery.js: cat, lighthouse, whale) first, then the rest by filename
(the seed rotates which comes first; the default seed 1 opens on the lighthouse). Each visit
to the artist starts at the beginning of a drawing, not part-way through the cycle.

```
title: My Piece
---
 the art, as many lines as it needs
```

The first line is `title: <name>`, the second is `---`, the rest is the raw drawing. CRLF is
fine and trailing spaces are trimmed. Use only the allow-listed glyphs (see below; a test fails
on anything else). Aim for 40-70 columns by 18-26 rows; a piece that does not fit the terminal
is skipped on that screen (80x24 shows the ones up to 80x24, a tiny terminal shows nothing),
and every piece must fit 116x36. The stroke order is worked out automatically: line characters
first, then fills; each connected shape is traced by a pen that keeps going in the direction it
was going, so lines are drawn along their length. A file that does not parse is skipped and the
test suite reports it. `node tools/capture.mjs` writes `captures/artist-<piece>-half.txt` (50%
drawn), `-full.txt`, and `captures/artist-gallery.txt` with every piece.

Glyphs outside calm come from an allow-list (`src/glyphs.js`): ASCII, a few Latin-1
symbols, Greek, arrows 2190-2195, box drawing, blocks, braille, ~20 maths operators and a
hand-picked set of geometric shapes. Ten code points Cascadia Mono lacks (2196-2199, 2205, 2207, 2208, 2227, 2228, 222A) were removed; a test scans src/ so none comes back. Everything is in the Basic Multilingual Plane and
single-width. **Glyph coverage in Cascadia Mono could not be verified from the build
machine** (the font is not installed under C:\Windows\Fonts there); see the unsure list in
the DRIFT-2 report. Arrows 21A0-21FF, the rest of 2200-22FF and the rest of 25A0-25FF are
deliberately not in the list.

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

Config: `%APPDATA%\drift\config.json`, `{"colour":"claude","mode":"calm","chaosPalette":"neon","invert":false}`,
plus `"lastCartridge":"<id>"` once you have inserted a cartridge (until then the file is written exactly as
before, and older builds ignore the extra field).
Each field is checked on its own and falls back to its default if it is wrong; a v1 file
containing only `colour` loads as calm. Missing or corrupt files are ignored. Drift never
writes anywhere else (the user cartridge folder is only ever read). Override the path with `DRIFT_CONFIG`. Saves are atomic (a temp file
in the same folder, then a rename), and each save re-reads the file and changes only the field you
touched, so two windows sharing one file do not undo each other.

## Cartridges

The **Driftman 2000** is a little console built into Drift. You slot **cartridges** into it:
each is a folder of plain files that brings its own look (a skin: colours, frame, menu, help,
boot screen), its own scenes and its own programs (playlists). **Drift Classic** is itself the
first cartridge: it loads the original modes exactly as they are. Plain `drift` always starts
Classic, exactly as before; nothing about the console is on screen until you ask for it.

```
drift --library            # start in the library
drift --cartridge classic  # insert a cartridge at start (boot included)
drift --cartridge last     # the one inserted most recently (Drift Classic if none yet)
```

In Classic press `l` to open the library (Classic's help panel gains just that one `l` row), `Esc` or `l` to go back. A bad id (`--cartridge nope`,
a locked or broken cartridge) prints `drift: ...` to stderr and exits 2 before the terminal is
touched, with no escape bytes. The id of the cartridge you insert is remembered as
`lastCartridge` in the config file (it only sets where the library cursor starts and what
`--cartridge last` means).

### Library and cartridge keys

These come from one table, `SHELL_KEYMAP` in `src/keymap.js`, and the help panel (`h`) on each
console screen is generated from it. A skin may re-word a row's label (`wording.keys`) but
never rebind a key.

| screen | key | does |
|---|---|---|
| library | left, up or `,` | previous cartridge (wraps) |
| library | right, down or `.` | next cartridge (wraps) |
| library | Enter | insert the cartridge (a locked one just says it is not ready) |
| library | Esc, `l` | back to Classic if the library was opened from it; nothing when you started in the library |
| library, running | `h` | show or hide the help panel (the animation is frozen behind it; `h` or Esc closes it) |
| running | Enter | open the menu; with the menu open, choose the highlighted entry |
| running | up or left / down or right | menu: previous / next |
| running | Esc | close the help or the menu (the menu also closes after 20 s idle) |
| running | `e`, `l` | eject: the picture fades to blank (0.3 s), then the insert animation plays backwards (1.6 s) and you are back in the library (Classic has no `e`; it has only the `l` that opens the library) |
| running | space | next scene in the current program |
| running | `p` | pause or resume |
| running | `+` (or `=`) / `-` (or `_`) | faster / slower |
| running | `c` | next season, if the skin has `seasons`: the palette hue eases to the next one |
| every screen | `q`, Ctrl+C | quit (Ctrl+C exits 130); the terminal is restored exactly |

On the shelf every arrow press registers at once and none is ever dropped or delayed: the cursor moves, and the position dots and the console screen (or the list, at 80 x 24) show the new cartridge on the next frame. One press on its own is the 0.36 s slide. When presses come in a hurry the shelf scrubs: every press registers, the shelf is drawn as a dimmed strip while you hold a key (its text colours are capped at a luminance of 0.25 and its block colours at 0.09, so in truecolor no cell of it reads brighter than about 0.09, which `tests/shell-shelf-move.test.js` allows up to 0.0905, and it cannot swing the flash meter's 0.10; in a 256-colour terminal each dim colour snaps to the nearest of the 256 palette entries, which can be brighter than its cap, so the caps are a truecolor guarantee only: what holds in 256 colours is the five-rule meter run on the real app in `tests/shelf-clocks.test.js`, not the caps), and when you stop for 0.3 s the full art dissolves back in once. The art itself changes at full contrast at most twice a second, which is what keeps a held key inside the flash rules, so the dim strip appears about a second after the first press and the dots and the name are what spin until then. The dissolve back to the full picture has its own gate too (DRIFT-9): it waits until the dots and the console screen were last cut to dim at least 1.05 s ago (`SCRUB_GATE_SECONDS`), so after a quick double tap the full picture comes back later than 1.05 s after the first press (no test pins the exact return time; `tests/shelf-gate-mutant.test.js` shows that without this gate the 256-colour taps 0.44 s apart read L2 over 25 % at 40x10 and 81x24 on all three clocks). A lone press is unchanged: `tests/shell-shelf-move.test.js` pins four lone presses frame for frame against the 4d2f8da golden.

Insert, boot and the error card take any key except `q` as "skip". The timeline is: insert
animation 1.5 s (the cartridge lifts, the neighbours slide away, it drops into the slot, the
console takes on the cartridge's skin behind a 6-column band, or is redrawn by the cartridge's console hook), then the boot, drawn on the
console's own screen (a line opens into the screen, boot lines type out, a progress bar that
waits for the scenes to finish loading, the screen zooms to fill the terminal, the title card),
then the menu opens over the first program. If loading fails the console shows the reason for
4 s and returns to the library. Ejecting plays the insert backwards over 1.6 s (the same frames in reverse;
there is no separate shrink animation, and no hint line about the eject key is drawn).

### The library: sizes and codes

The library picks a layout from the window size (`sizeTier` in `src/shell/ui.js`, and the extra-large check in `src/shell/library.js`):

| window | layout |
|---|---|
| 176 x 58 or more (extra-large) | the full layout with two whole neighbours each side, a spine shelf above the cartridges and a desk line under the console's feet. The art is not scaled, only centred |
| 88 x 39 or more (full) | the selected cartridge in the middle, neighbours 4 columns apart, the far ones as slivers at the edges |
| 78 x 24 or more (compact) | one cartridge on the left, the cartridge list and blurb on the right, a mini console under them |
| 40 x 10 or more (list) | text only: the list and a hint |
| smaller | one line, "Make the window bigger to see the cartridges." |

At the extra-large size the slide between cartridges moves in 3 steps (the 0.36 s slide is stepped, not continuous) and the far slots
snap to their place instead of sliding. This is a deliberate cost choice: moving a cartridge rewrites nearly all its cells whatever
the distance, and a continuous slide there wrote about twice the bytes of the full tier.

Each unlocked card shows its manifest `code` on its name plate and on the console screen (a locked card shows SOON there instead). The scheme is DM-00 Classic, DM-01 Delza, DM-02 Night Drive,
DM-03 Arcade and DM-04 Last Fantasy, plus the one deliberate outlier DM-9K, the Driftman 9000; a card only appears when its folder exists. Delza (DM-01), the Driftman 9000 (DM-9K) and Night Drive (DM-02) are installed and playable, so the shelf is Classic, Arcade, Delza, Driftman 9000, Last Fantasy and Night Drive (the loader sorts the folders by name, Classic first); Arcade and Last Fantasy are still coming-soon cards. Any
manifest (including a data-only user cartridge) may set `code` and `facts`.

### What a cartridge is: the folder format

A cartridge is a folder whose name equals its manifest `id`:

```
<id>/manifest.json     required
<id>/label.txt         required: the art on the library card, at most 24 columns x 10 rows, 4 KB
<id>/label-ink.txt     optional: how bright each label cell is (see below), at most 24 columns x 10 rows, 4 KB
<id>/skin.json         optional (32 KB at most): the look
<id>/boot.txt          optional: art for the boot screen, at most 76 x 18, 16 KB (drawn when skin.boot.art is true)
<id>/scenes/<id>.txt   one per scene of kind "text" (32 KB at most)
<id>/scenes/<id>.js    one per scene of kind "cells", "sim" or "field" (install folder only; see the trust rule)
```

**label-ink.txt** sits beside label.txt and shades the card's art. It is a grid of the digits 0 to 3 (and spaces), row for row and
column for column over label.txt: 0 is the dimmest tint of the cartridge, 3 the brightest. The card draws a cell at
`max(0, digit - (3 - level))`, where level is how bright the card is as a whole (3 for the selected card, 1 for every other card; the two ramp between while the shelf slides),
so the selected card shows the file as written and the others show it two steps dimmer, never below 0. A space,
or a cell the ink rows do not reach, keeps the card's own level. Any other character (a 4, a letter) skips the cartridge with a
message naming the file, and so do rows wider than 24 or more than 10 rows. The file is optional. A locked cartridge
is still drawn at its dimmest level whatever the ink says, so the file cannot light one up.

Rules that apply to every file: only allow-listed glyphs (the list in `src/glyphs.js`; tabs,
emoji and wide characters are rejected with the exact code point), LF or CRLF, a link or junction
that is a cartridge folder or one of its files is not followed (the cartridge is skipped), and unknown fields are
errors ("unknown field 'titel'"). A cartridge that cannot be loaded is skipped with a reason
and never stops the others; at most 50 cartridges are read.

**Manifest** (`manifest.json`; `format` greater than 2 gives "needs a newer Drift"):

| field | required | meaning |
|---|---|---|
| `format` | yes | `1`, or `2` for a cartridge with a full-colour (`rgb`) scene or a console hook (a field that needs format 2 in a format 1 manifest gives "needs a newer Drift"). `foil` also needs 2 |
| `id` | yes | 2 to 32 characters: lowercase letters, digits, hyphens, starting with a letter, not ending in a hyphen. Must equal the folder name. Reserved: `last`, `con`, `prn`, `aux`, `nul`, `com1`-`com9`, `lpt1`-`lpt9`; `classic` only in the install folder |
| `title` | yes | up to 30 characters |
| `version` | yes | `1.0.0` form (three whole numbers) |
| `author` | yes | up to 30 characters |
| `blurb` | yes | up to 60 characters |
| `runtime` | unless `locked` | `"cartridge"`; `"classic"` is only for the install folder's `classic` |
| `locked` | no | `true` makes a coming-soon card: it can then hold only `format`, `id`, `title`, `version`, `author`, `blurb`, `labelHue`, `code` and `facts`, and cannot be inserted |
| `code` | any | exactly 5 characters, capitals, digits or hyphen (like `DM-01`): the shelf code shown beside the title |
| `facts` | any | up to 6 lines of up to 40 characters, listed under the blurb on the console screen of an unlocked card (full tier) |
| `labelHue` | no | `#RRGGBB`: the tint of the library card |
| `foil` | no | `{ "hues": [2 to 6 colours like "#3FE8FF"], "style": "sweep" or "holo" }` (needs `format` 2; unlocked cartridges only, a locked card says "locked cartridges cannot have 'foil'"; data only, so any folder): the label on the shelf becomes a shiny foil (see **Foil label** below) |
| `console` | no | `"code"` (the only value; install folder only, needs `format` 2): the cartridge ships `console.js`, a hook that draws the Driftman 2000's body in full colour (see **Console hook** below) |
| `scenes` | yes (1 to 16) | list of `{ id, kind, title?, ref?, rgb? }`. `id` follows the id rule; `kind` is `cells`, `sim`, `field` (code, install only), `text` (a `scenes/<id>.txt` file) or `builtin`; `title` up to 30 characters; `ref` (builtin only) names a Classic **calm** or **experimental** scene, such as `sand` or `plasma`; `rgb` (`true`, on `cells` and `sim` scenes only, install folder only, needs `format` 2 and a `skin.json` with `palette.bg`) marks a full-colour scene: the scene fills `params.fg` and `params.bg` (0xRRGGBB per cell) and the composer pre-fills its colours with 255, which means "this cell's colours are in fg and bg"; the scene module declares `rgb = true` too |
| `programs` | yes (1 to 8) | list of `{ id, title?, transition, scenes, sceneSeconds?, seconds?, fadeSeconds? }`: `transition` is `dissolve` or `crossfade`; `scenes` lists scene ids (1 to 16); `sceneSeconds` 20 to 3600 (default 180); `seconds` (optional) is an object keyed by scene id that gives single scenes their own time, 20 to 3600 each (a key must be a scene in this program; scenes not named use `sceneSeconds`); `fadeSeconds` 5 to 60 (default 15, crossfade only, and shorter than the shortest scene time: `sceneSeconds` or any `seconds` entry). A `crossfade` program holds only `field` scenes and calm builtins; a `dissolve` program holds `cells`, `sim`, `text` and experimental builtins |
| `start` | yes | the id of the program that plays first |
| `menu` | no (1 to 10) | list of entries: `{ label, program, scene?, note?, desc? }` or `{ label, action: "eject", note? }`. `label` up to 24 characters. `scene` (only with `program`) is a scene id in that program: choosing the entry starts the program at that scene, and a scene entry is marked as playing only while that scene plays (choosing the scene that is already playing, or the playing program with no `scene`, changes nothing). `note` up to 16 characters is a short tag at the right of the entry (in the list the box widens to hold it; in the slots layout it sits on the label row; in the grid it is a row under the label; it is left out when there is no room for it as well as the whole label). `desc` up to 76 characters is shown, wrapped to two lines above the hint, for the highlighted entry in the `list` layout (left out when the window is too short, before the title); in the `slots` layout it is the second row of the entry's card, and an entry that names a chapter falls back to the chapter's `line` when it has no `desc`. Without a `menu` the menu is one entry per program plus Eject |
| `chapters` | no (1 to 16) | list of `{ id, numeral, place, line, icon, minutes }` for cartridges that present their scenes as chapters: `id` is a scene id (each at most once), `numeral` up to 8 characters, `place` up to 30, `line` up to 64, `icon` two pieces of text of at most 5 characters each, `minutes` a whole number 1 to 999. The `slots` menu draws it: a menu entry whose `scene` has a chapter shows the chapter's icon (two rows), numeral and place on its card, and the chapter's line when the entry has no `desc` (see the menu layouts below) |

**Foil label** (`"foil"`). A label whose colours drift through your hues, on the shelf. Each hue is read as a hue angle only (its brightness and strength are ignored) and shown as its red-safe colour, so a hue that is too red is mapped to a safe one rather than refused. Brightness comes only from the label's own ink levels (`label-ink.txt`), so the foil is as bright as the plain label would be, and only the hue moves; it takes no palette slots. The cells of the label art that are not blank take the foil, and blank cells stay blank. `holo` carries a diagonal band of the hues across the card every 5 seconds (phase `(x + 2y) / 30 - t / 5`, x and y the cell in the label); `sweep` carries a vertical band left to right every 4 seconds (phase `x / 24 - t / 4`). The hues are joined in a ring (the last blends back into the first), and time moves in 6 steps a second. Only the selected card at rest shimmers: while the shelf moves, or in the insert, every foil shows still, and neighbours always show it still, at their own dimmer level. The compact layout keeps the foil; the list layout shows text only. A shimmering card costs about 22 KB/s of output on a real label (29 KB/s if every cell of the label is inked), so use it for one rare card.

**Skin** (`skin.json`; every section but `palette` is optional and has a default taken from the
Driftman 2000; a cartridge with no `skin.json` uses the Driftman 2000's whole look). Palette indexes 0 to 15 are the hue at 16 brightness levels, exactly as in Classic;
`colours` start at 16.

| section | fields |
|---|---|
| `palette` (required) | `hue` `#RRGGBB`; `colours` up to 48 extra fixed colours (indexes 16 and up); `bg` the background, which must be dark (WCAG relative luminance 0.05 or less, else "background too light"); `ui` `{ text, dim, head, accent }`, palette indexes for the console's own text (defaults 15, 7, 15, 15) |
| `frame` | `show` `never`, `menu` or `always` (when the frame is drawn around the scene); `glyphs` 8 characters; `title` up to 30; `colour` a palette index; `ornament` up to 30 characters, set into the bottom edge, centred (Delza: `Ψ · Δ · Ξ · Φ · Ω`) |
| `console` | restyles the Driftman 2000 itself once the cartridge is in (see below); every field optional |
| `menu` | `layout` `list`, `slots` or `grid`; `anchor` `center`, `left` or `bottom`; `cursor` 1 character; `title` up to 40; `box` 8 characters; `prompt` up to 60 characters, one line above the menu (dropped when it does not fit beside the countdown); `autostartSeconds` 5 to 60, see below |
| `help` | `title` up to 30; `box` 8 characters; `groups` `{ "Cartridge": "...", "Other": "..." }` renames the two headings on the running screen (up to 24 characters each); `modeLabel` and `sceneLabel` up to 12 each, replacing "cartridge" and "scene" on the mode line (which shows the cartridge title and the scene title) |
| `boot` | `lines` up to 8 typed lines of up to 60 characters, typed after the console's own two (`DRIFTMAN 2000 · CORE 2.0`, `MEMORY 64K ..... OK`); the screen has room for six lines in all and 40 columns (so four of yours, up to 40 characters), and text after a run of dots and a space (the `OK` of `MEMORY ..... OK`) is drawn in the accent colour, or in `valueColour` when the skin sets it; `art` true to draw `boot.txt`; `seconds` 0.5 to 10, how long the typed lines take (0.25 s a line; the default 1.5 s is six lines); `valueColour` a palette index (0 up to the size of the palette), the shade of those value words, default the accent |
| `insert` | `text` up to 40: the caption of the insert animation |
| `wording` | `keys` `{ <key id>: "label" }` re-words help rows, ids from the key tables (up to 28 characters each); `menuHint` up to 60 |
| `seasons` | 1 to 4 of `{ name, hue }` (`name` up to 16 characters, `hue` `#RRGGBB`); the `c` key walks the skin's own hue, then each season, then back. The name is checked but not shown yet |

**Console block** (`skin.console`; the console takes this look behind the 6-column band when the cartridge is inserted, and gives it back on eject. A field you leave out keeps the console's own look, so a skin without the block draws exactly as before; Classic never changes).

| field | meaning |
|---|---|
| `frame` | exactly 8 characters (same order as `frame.glyphs`): the console's border and screen bezel. Wins over `frame.glyphs` for the console |
| `grille` | exactly 1 character: the speaker grille (default `▒`) |
| `stripe` | 1 to 24 characters, tiled across the rule on the console's name band (default `═` with a short `╱╱╱╱` run) |
| `ink` | brightness levels 0 to 3 of the cartridge's label colour (`labelHue`), whole numbers, for `frame` (default 2), `grille`, `stripe`, `led` (the CART light; default the accent colour) and `bar` (the name text; default 3). No new colours: the library palette already holds the four levels |
| `title` | the boot's title card: `style` `block` (big letters, default), `spaced` (plain capitals, single-spaced) or `plain` (plain capitals); `ornament` up to 40 characters on the row under the title, revealed with it and left out when there is no room; `colour` and `ornamentColour` are palette indexes of the skin (defaults the head and dim colours) |

Every glyph must be on the allow-list and one cell wide. Unknown fields inside `console`, `ink` and `title` are errors.

```json
"console": {
  "frame": "┏━┓┃┛━┗┃", "grille": "═", "stripe": "▁▂▃▄▅▆▇█",
  "ink": { "frame": 2, "grille": 1, "stripe": 2, "led": 3, "bar": 3 },
  "title": { "style": "spaced", "ornament": "── ◆ ──", "colour": 15, "ornamentColour": 7 }
}
```

The 8-character `glyphs` and `box` strings are the corners and edges in the order
top-left, top, top-right, right, bottom-right, bottom, bottom-left, left (for example
`┌─┐│┘─└│`).

**Console hook** (`"console": "code"`; install folder only, `format` 2). The cartridge ships `console.js`, whose default export is
`{ id, drawConsole(frame, { phase, p, t, rect, screen, tier }) }`, and the Driftman 2000's body is drawn by it in full colour instead of
by the console block above. `drawConsole` is pure and writes only inside `rect`: cells with shade 255 take their colours from
`frame.fg` and `frame.bg` (a bg of `PALETTE_BG` is the palette's background), and the console's own palette shades (below 20) are allowed
too. The shell still draws the screen text and the LEDs on top, so the hook never draws them. `rect` is the console's `{ x, y, w, h }` in
the frame (84 x 18 at tier `full`, 38 x 4 at tier `mini`, the compact layout's console); `screen` is the 46 x 9 screen inside it at `full`
(at local 3, 4) and `null` at `mini`, which has no screen; `phase` is `insert`, `boot` or `eject` (the console is not on screen while a
cartridge runs); `t` is the seconds on that phase's clock; `p` is the morph from the library's console to the cartridge's, 0 to 1. The
loader imports `console.js` only for an install-folder cartridge, checks its export, and smoke-renders it at 84 x 18 and 38 x 4: a throw,
a cell off the allow-list or past 0xFFFFFF, a write outside `rect`, a different picture for the same arguments, or a call over 250 ms
makes the whole cartridge fail to load (the error card). Like scene code, `console.js` may import only what the scene-code scan allows.
`p` is one ramp over the insert and the boot: 0 to 0.55 over the insert's step 5 (1.0 to 1.5 s, in place of the band sweep), then 0.55
to 1 over the first 0.4 s of the boot, then 1; it never decreases. The hook is used for a whole insert or not at all: it takes over
only if its module had finished loading at the first frame at or after 1.0 s. Eject plays the insert backwards, so it folds back from
`p` 0.55 (after the 0.3 s fade) and never shows `p` 1: a known compromise. A cartridge without the field draws exactly as before.

**Text scene** (`scenes/<id>.txt`): line 1 is `title: <name>`, line 2 is `---`, then cards
separated by blank lines (up to 12 cards of 8 lines of 60 characters). A card types out at 24
characters a second, holds 4 s, fades over 1 s, rests 0.5 s, and the scene loops. It uses the
skin's hue only and does not depend on the seed.

**Menu layouts.** A skin picks one of three layouts by name; there are no free-form layouts
(a deliberate narrowing: arbitrary layouts would need a template language to test and keep
flash-safe, and three named ones cover the console well):

| layout | what it draws |
|---|---|
| `list` | a boxed column, one row per entry (the default) |
| `slots` | one 4-row card per entry, collapsing to 2-row cards below 30 rows. Row one is the cursor, the icon's first row, the numeral, the label (and the current mark) and the place at the right; row two is the icon's second row, the description and the note at the right (the note takes row one when there is no place). Cards widen to hold the longest line, stay two columns inside the window, and drop the place or the note, never the label, when there is no room |
| `grid` | 22 x 7 tiles in rows, collapsing to the list below 100 columns |

A layout that does not fit the window (too many entries for the rows) falls back to the list.

**The start-by-itself countdown.** With `menu.autostartSeconds` set, the menu that opens when the cartridge arrives counts down, drawn at the right of the line above the menu (`starts by itself in 15 s`, beside `menu.prompt` when there is one). At zero the menu closes and the program that has been playing behind it carries on; any key at all (even one that does nothing) cancels the countdown, and the menu then stays until its 20 s idle close. A menu the viewer opens with Enter never counts down.

### Delza, the first real cartridge

Delza (DM-01) is a woodsy fantasy: Orrin Thistlewick, a lamplighter's apprentice, crosses the Hollowmere Reach with a moth
named Pim. Everything in it is original. The skin gives it a forest-dark background (#0F1A12), a Greek-rune console
(`◆═◆║◆═◆║` frame, `▒` grille, the stripe `Ψ · Δ · Ξ · Φ · Ω`), the Journal menu (the `slots` layout with chapter cards, a 15 s
countdown and the title in the frame), its own help words (`tale:`, `chapter:`, the groups Chapters and Camp) and four boot lines.
The `c` key walks Greenwood, Autumn and Moonlit: only the pines (the skin's hue) change colour. Its scenes live in
`cartridges/delza/scenes/` and share `cartridges/delza/lib/` (`palette.js` names the colours, `canvas.js` draws and clips,
`sprites.js` holds the pictures, `clock.js` gives a scene its own start time from `params.t0`):

| chapter | scene | kind | what moves |
|---|---|---|---|
| I | `thornwell` The Thornwell Path | cells | forest walk in parallax layers; lantern glow; Pim; a Brambleback every 40 to 60 s; the far ridge is dropped at 80x24 |
| II | `tallow` The Tallow & Tin | sim | the hearth fire (shade drift, never out), sparks, pipe smoke, mugs, the cat's tail; under 1% of the screen changes a frame |
| III | `cinderhorn` The Cinderhorn | cells | a 4 s-a-turn fight, then the calm; a hit glow lights only the creature's own cells two shades, 0.15 s up and 0.45 s down, never closer than 1.5 s |
| IV | `reach` Across the Reach | cells | the map: a dotted route drawn a dot every 0.3 s with a gold marker that rests 2 s at each of four landmarks (the labels fade up), cloud shadows, fog that thins ahead of the marker; redrawn every 90 s |
| V | `highcandle` Highcandle at Dusk | cells | the sky deepens a shade every 6 s (each cell at its own moment), stars, up to 80 windows lit one at a time in a seeded order, three Gloamcrows; the Great Lamp rises at 58 s with a halo |
| VI | `lampwarden` The Lampwarden | cells | the 45 s cut scene: letterbox, portraits, a typed dialogue box (30 characters a second), Pim's flutter, candles, the Ember Lantern climbing the stair. It is a cells scene rather than text because it needs the portraits, speaker names and the room behind the box |

The tale plays the six in order, 75 s each except the cut scene (45 s): 7 minutes, which is what the shelf says.

`tests/delza-*.test.js` check the manifest, skin, palette, Journal at 120x40 and 80x24, help words, boot lines, the countdown, the
seasons and each scene's promises on rendered frames.

To try it (from this folder):

```
node bin\drift.js --library              # the shelf: Classic, Arcade, then Delza (right arrow twice, Enter)
node bin\drift.js --cartridge delza      # straight in: insert, boot, the Journal menu (it starts the tale by itself after 15 s)
```

`q` quits from the library and from inside Delza; `e` ejects Delza back to the library. Both quits, `Ctrl+C` and a crash
inside the running cartridge are checked against the real process in `tests/real-process.test.js` (the terminal is restored each time).

### Night Drive, the second real cartridge

Night Drive (DM-02) is an 80s neon highway: the Vantra Halcyon, a low coupe with the plate NITE86, driving out of the made-up Port Solace
on Shoreline 9, with late-night radio on 88.1 Moonlow FM. Everything in it is original. It is one tape of 8 tracks, sides A and B, about 12 min: the tracks hold 90 s each
(Late Caller 75 s), 705 s or 11:45 in all, and with the 2 s dissolve between tracks the tape loops every 721 s. In tape order:
A1 Midnight On-Ramp (1:30), A2 Velvet Skyline (1:30), A3 Sundown Grid (1:30), A4 Coast Road 86 (1:30),
B1 Red Light, Rain (1:30), B2 Luma's, Open Late (1:30), B3 Late Caller (1:15) and B4 Overdrive (1:30). The scene ids are `onramp`, `skyline`,
`sundown`, `coast`, `redlight`, `diner`, `caller` and `overdrive`; Red Light, Rain and Overdrive are simulations, the other six are cell scenes.
The tape deck keys: Enter opens the deck (and Enter on a track plays on from there), up/down or left/right pick a track, Esc closes it,
space skips to the next track, `e` ejects the tape, `p` pauses, `h` shows the Owner's Manual and `q` quits. The skin gives it a
violet-black background (#0D0820), a heavy-line magenta console (`┏━┓┃┛━┗┃`, a stacked-vent grille, an equaliser
stripe), the tape deck menu (the `list` layout with a 15 s countdown), an Owner's Manual help panel (groups Tracks and Glovebox) and a
cassette on the boot screen. Its colours are in `cartridges/night-drive/lib/palette.js` (eight hues in four shades each, plus text, dim and
two silhouette colours; the library palette is untouched). Midnight On-Ramp is a function of time: a three-lane road in perspective whose dashes
take 1.2 s from the horizon to the car, a street lamp every 2.4 s, one star at a time ramping, the car swaying a column every 7 to 11 s, and
from 41 s a car ahead that closes and slides past. Under 100 columns or 32 rows (80x24) it drops to a one-row ridge, no lamps and the 20x4 car.
Sundown Grid is a half-disc sun on a horizon, cut by gaps that slide down it a half-row a second, over a neon grid whose horizontals arrive every
0.8 s; the sun steps down a row every 15 s for 60 s and back up for 60 s, so the scene loops every 120 s (palms at the edges, a frond swaying every
20 s; under 100 columns or 32 rows a 34x8 sun, four horizontals and no palms; under 24 rows a 24x5 sun with no gaps and two horizontals; on a short
window of the big layout, such as 100x32, four horizontals instead of five). Everything in it moves on a 15 Hz tick (`lib/grid.js`) on a schedule planned for the
window (`capsOf`), so that no frame at 1x changes more than about a tenth of its cells and, because the console can step the clock 2x or 4x a frame (up to four
ticks in one), no four ticks in a row change more than 18% of them (120x40: 11.3%; 80x24: 16.3%; the short windows under 14 rows, where the arriving horizontal alone
is 14% or more of the picture, 23.5% at 41x11). To keep that, each horizontal moves in a few jumps of several rows rather than a row at a time.
Red Light, Rain is a simulation (it steps at 30 a second, so the same seed and step count always draw the same frame): the view from the driver's seat at a red
light in a heavy downpour, with a traffic light blurred by the rain into a bokeh, a pedestrian crossing under an umbrella, slanted speed lines of 2 to 8 cells
falling 27 to 48 cells a second in a gusting wind, in deep red with a few brighter sparks (about 14 to 22% of the glass is rain), and one wiper that sweeps for 0.93 s every 2.4 s, clears a
swath and throws spray off its leading edge; the rain is back within a second. At 58 s the red ramps down and the green ramps up over a
second, never cutting from one to the other, and the rain near the lamp goes red, dark for a moment, then green (the far rain stays red); from 62 s the far buildings slide a column every 0.2 s. Under 100 columns or 32 rows it drops the mirror, shrinks the
bokeh to 9x5 and keeps a two-row dashboard. Its drops, wiper, bokeh and dashboard are in `lib/rain.js`, `lib/bokeh.js` and `lib/dash.js`.
Velvet Skyline is parked at an overlook across the bay from Port Solace: two towers (The Orchid and Solace Tower with a coral beacon on a 4 s cycle), lit windows that change one at a time, a rail bridge with a train from 8 s and every 30 s, and reflections in the bay. Coast Road 86 is a side view of the car on a cliff road above the sea, a moon with a path of glitter, a lighthouse beam on an 8 s turn and a palm passing every 6 to 10 s. Luma's, Open Late is the diner and the Quarterlight Arcade next door across the street: the LUMA'S rooftop sign with a faulty apostrophe that dips, chasing marquee bulbs, a server walking the window, steam from a mug and a customer every 40 s. Late Caller (75 s) is a radio call on 88.1 Moonlow FM, nine cards typed one at a time over a dim road. All four have a compact layout under 100 columns or 32 rows and are blank under 40 columns or 18 rows.
Overdrive is the busy one, also a simulation: A1's road at double pace while a far-silhouette tunnel mouth grows out of the vanishing point (0 to 15 s), then nested rings of
light in perspective with a ceiling light on each, tail lights running away and headlights coming toward us, each with a trail of 4 to 10 cells fading to nothing (15 to 60 s),
then the far end opens and the city is revealed inside it by a dissolve from the centre outward (60 to 62 s), and an elevated freeway with the skyline on both sides, a trail
about every 2 s and the pace easing back to A1's (66 to 90 s). How many cells change in a frame is a function of the step count and of the window size, never of what the last
frame did: rings move on ring slots (at most 2 in any 8 steps at full size, 1 at 80x24 and below), only the rings whose redraw is small enough for the window move at all (the big
ones near the frame stand still), and new trails are born only on spawn slots. The worst frame changes about 13% of the cells or less at every size, at 1x and 4x. Under 100 columns or 32 rows (80x24) it keeps 4
rings, 6 trails and the 20x4 car; under 60x18, 2 rings and 3 trails. Its skyline is in `lib/skyline.js`.
`tests/night-drive-*.test.js` check the skin, palette, label, boot art, manifest, help panel and the scene's promises on rendered frames.

`node bin\drift.js --cartridge night-drive` goes straight in. `q` quits from the library with Night Drive selected, from the playing tape, with the
tape deck open and after a track picked from it (exit 0); `Ctrl+C` from the playing tape exits 130, as everywhere else; all are checked against the real
process in `tests/real-process.test.js`, and the terminal is restored each time.

### Driftman 9000, the full-colour cartridge

The Driftman 9000 (DM-9K, `cartridges/driftman-9000/`, format 2) is the first cartridge whose scenes are full colour (`rgb`): each cell carries its own foreground and
background, sent as 24-bit colour. Its shelf card has a holo `foil` and a symmetric 24x10 label, and it ships a console hook (`console.js`), so inserting it turns the
Driftman 2000 into a 9000. Its code sorts it between Delza and Last Fantasy on the shelf. It is a screen to leave running beside your work, like the rest of Drift:
nothing flashes (the visions, panels and console moves are held to the flash meter, see Tests; so are the dissolves, as set out next). The dissolves are judged on the running app itself, not on a replay of two scenes: `tests/driftman-9000-dissolve-app.test.js` drives the real app, presses `+` four times for the real 4x, and meters every dissolve of the program with the playback-speed rules (L1, L2, L3, R and colour rule C) at 80x24 for all 16 seeds (seeds 1 to 16), in truecolor and in 256 colours (the 256 arm is `tests/flash-256-9000-dissolve-app.test.js`); fewer seeds are run at 120x40 (3) and 61x21 (8), and the same is run at 1x (2 seeds). The worst reading at 4x is 16.2 % against the 25 % limit. At 4x a dissolve lasts its 2 seconds of real time (the hold between dissolves runs on the speed, the dissolve does not), and no Driftman 9000 cartridge dissolve plays faster than real time. Classic is outside this: it is a palette scene, and its dissolves still speed up with the speed key (measured: 1.94 s at 1x against 0.44 s at 4x; the calm one 15.0 s against 3.72 s). For the 9000's dissolves that holds for the speed key pressed before or during a dissolve, the space key, the menu, pause, a resize, the frame rate, and a terminal that falls behind: the app drops frames and keeps real time, and after a stall it moves on at most 0.25 s, never replaying. The meter's 4x view of a dissolve (the same frames shown four times as fast) is therefore not a way the dissolves can be seen, and it is not printed. A viewer who speeds up is the real 4x above.

**The three visions.** The program, "The transmission", plays them in this order with a 2 s dissolve between, 60 s each (about three minutes, then round again).
Each needs a screen of 60 x 20 or more; below that it draws one centred dim line, "This vision needs 60 x 20.".

- **Rosette** (the one that is lit): twelve mirrors turning a field of colour that never repeats. The hue goes round the wheel at 200 degrees a second (on the colour clock, see below) at one lightness
  (always through `safeHue`), the fold count steps 6, 8, 12, 10 every 15 s through a 3 s melt, and thin contour lines mark where the field crosses zero (lightness 0.72, hue
  turned 180 degrees from the field around them).
- **Cortex** (the rest between the loud ones): the machine thinks aloud on four panes of glass (`#0E1426`, edge `#4A6AB0`): a braille icosahedron turning 0.3 rad/s with one
  hue per edge, a scrolling thought trace, a ring of 24 numerals (one re-rolled every 0.5 s) and captions typed at 24 characters a second. The glass slides 2 columns either way
  (a step ripples down its rows over 0.6 s) over content that stays put; an ion pulse runs along one hairline connector every 3 s and the focus edge moves to the next pane
  every 8 s. Under 5 % of the cells change in any frame (3.0 % worst at 120x40, 3.1 % at 80x24, 1.0 % at 240x67) and it is dark (mean luminance 0.007 to 0.03).
- **Bloomfall**: blooms of colour (5 to 9 petals, an envelope that rises over 1.5 s and falls over 2.5 s) open over `lib/huefield.js`, a field of hue that turns about 90 degrees a
  second at one dim lightness, with pollen falling from fading blooms and small pops between.

**The colour clock.** At the `+` key's 2x, 3x and 4x the pictures move two, three and four times as fast, but their colours do not: the hue of every vision turns on `tc`,
the colour time (`colourTime` in `lib/clock.js`; `params.tc` and `params.tc0` from the composer), which runs at `min(speed, 1)` of real time and starts at 0 with each vision,
so a hue that turns 200 degrees a second (Rosette; the field and the bloom turn of Bloomfall; the 4 degrees a second of Cortex's edges) turns at that rate at every speed. The
geometry (the fold, the contour lines, the petals, the icosahedron) keeps scene time. At 1x nothing changes: the frames are byte for byte the old ones
(`tests/colour-clock.test.js`).

**The console.** Insert turns the 2000 into the 9000 in one continuous morph (`lib/morph.js`): the 2000's own cells shed to single dots at hue 200, the edges first (0 to 0.30 of
the morph); the 9000 unfolds outward from the slot (0.10 to 0.55, over the last third of the 1.5 s insert); then the lights open from ion to their resting hue, the centre first
(0.55 to 1, over the first 0.4 s of the boot). The boot types the console's two lines and the cartridge's four, then zooms to the title; the 9000 holds its lines 2.0 s, so Enter
to the running screen takes about 6.3 s. Eject folds the morph back from 0.55. The menu, "THE THREE VISIONS", opens when the cartridge arrives and starts the program by itself after
15 s; the screen carries the chrome border `DRIFTMAN 9000` while it is up.

**Keys.** No new keys: the table is the one every cartridge has, worded by the 9000's skin. Enter opens the index (the menu) or chooses, up/left and down/right move in it,
Esc closes the index or the keys, `e` (or `l`) folds the cartridge away and ejects, space is the next vision, `p` holds the moment, `+` and `-` dream faster and slower, `c` is the
colours key (the 9000 has no seasons, so it does nothing), `h` shows or hides the keys, `q` or Ctrl+C quits.

To try it (from this folder; each command was run for this section, see `tests/real-process-9000.test.js`):

```
node bin\drift.js --cartridge driftman-9000   # straight in: insert, boot, the menu over the Rosette (the program starts by itself after 15 s)
node bin\drift.js --library                   # the shelf: Classic, Arcade, Delza, then the Driftman 9000 (right arrow three times, a second apart, or hold it), Enter inserts it
```

`q` quits from the library with the 9000 selected and from inside each vision (exit 0; Ctrl+C exits 130); a key that is not a quit key leaves the process running. Both arms, and the
terminal restored each time, are checked against the real process. Read what it looks like without a terminal: `captures-ansi/` (below).

**Caveats: what could not be verified, and what differs from the design.**
- Not seen on a real screen: the colours in your terminal, whether the half-block rows meet without seams in your font, how the morph reads at speed, the real-time feel of the
  dissolves and the panels. Everything above was measured on rendered frames and on the bytes written; the pictures in `captures-ansi/` were rebuilt from those bytes and viewed
  as images, which is not the same as a terminal.
- A 256-colour terminal is degraded, not identical: colours go through the renderer's nearest-colour lookup (red-safe, so a safe hue never lands on a saturated red). It passes the
  same flash checks as the Driftman 9000 and the shelf (the arms are in the table from `node tools/flash-table.mjs`), but the pictures differ. Classic and Night Drive are the exceptions to "the same five rules" (Classic's high-contrast mode is held to them since DRIFT-13 by the flash governor, on every scene and on the whole cycle at 1x to 4x, over the sizes, frame rates, speeds and clocks listed under Tests and no further, with what is still not covered set out there; the rest of Classic is not asserted): see **What the five rules do not cover**, under Tests.
- Words changed from the design: the menu hint is `arrows · Enter wakes · e folds · h keys` (it was longer; the longer hint made the 80x24 menu list wide enough to push the console
  flows over the flash limit), and the boot holds its lines 2.0 s (not 1.5 s; a longer hold clears the typed text outside the flash meter's window).
- Looks changed from the design to pass the flash meter, with the numbers in the tests: Rosette's hue rate is 200 degrees a second (the design had 90), and its contours are lightness
  0.70 in truecolor and the fill's lightness on 256 colours (the scene reads the colour mode from `params.cmode`), with the hue turned 180 degrees (0.82 failed the meter in truecolor, 0.78 failed it on the 256-colour cube; the per-pixel brightness range over a 4x run is 0.0585 in truecolor and 0.0665 on 256 colours, tripwire 0.07). The contour share of the Rosette's cells is 4.7 % at the median and
  10 to 14 % at the peak.
- Cortex's content is fixed while its glass slides (the slide is the motion; moving the content too would have been the cost).
- The meter's own 4x view of L2 is neither judged nor printed for the menu and help panels over the visions, the shelf walk and the eject (tests/shell-help-ramp.test.js still judges it for the plain help ramp, and it passes): the shell's flows run in real seconds at every speed (the speed key
  reaches only the scene clock), which tests/shell-clock.test.js times for every flow at all eight speeds. Every other rule (L1, L3, R, and L2 at 1x) is judged at the sizes and speeds each arm lists (the table from `node tools/flash-table.mjs` has them all), not at every size and not every arm at both speeds: the exact-grid arms use between two and eleven sizes (most use 120x40, 80x24, 240x67, 88x39, 176x58 and 78x24), at 1x only for the plain shell flows and the size grid and at 1x and 4x for the console, panels, foil, hook, eject, help-ramp, vision and dissolve arms, and most clock arms use one size (41x11, 78x24, 80x24, 88x39 or 120x40), at the speed the table gives. The sizes do not differ by rule. For the dissolves between visions that statement is made by the app-driven test above (seeds 1 to 16 at 80x24, both colour modes, real 4x); the replay test `tests/driftman-9000-dissolve.test.js` runs every ordered pair from a fresh composer at seed 1 (the scene-to-scene dissolve makes three of the six pairs; the menu reaches the other three through the program-switch dissolve, metered in `tests/driftman-9000-dissolve-app-paths.test.js`) and also judges the meter's 4x view of L2 at 1x, a stricter check than any viewer can reach, kept because it is cheap and passes.
- **Frame rate in 256 colours: a HOUSE RULE, beyond WCAG.** In a 256-colour terminal a full-colour frame (the Driftman 9000's visions, and any console frame that carries full-colour cells, such as the shelf while its holo foil card is on screen) is held to 18 frames a second, whatever `--fps` or `DRIFT_FPS` asks for (the constant is `FULLCOLOUR_256_MAX_FPS` in `src/app.js`; 18 is the rate every flash test meters at). Measured on the real program: 18 a second on average; a late timer can put 19 in one second (gaps between paints as short as about 45 ms); the repaint after a window resize is immediate and is not capped (a drag at 30 resize events a second gave 48 paints in one second). The cap acts only where the 256-colour path is chosen, and that is when neither `COLORTERM` nor `WT_SESSION` is set (`src/color.js`): Windows Terminal sets `WT_SESSION`, so it runs truecolor and the cap never acts there; it matters on the old Windows console or over ssh. Why: the 256-colour output snaps each colour to the nearest of 256, and two close colours that straddle a boundary flip between neighbouring indexes more often the more often the screen is sampled. Asked for 30 frames a second, at 4x, 80x24, the Rosette alone read up to 29.6 % and Bloomfall alone up to 34.7 % on rule C (16 of 80 dissolve windows over seeds 1 to 16 were over the 25 % limit, worst 29.2 %), while the same app at 18 frames reads 16.2 % at worst; truecolor at 30 frames was never a problem (worst 7.2 %). What changes for you: at `--fps 30` (or 24, 20, anything over 18) in a 256-colour terminal, the Driftman 9000 repaints 18 times a second instead of 30, and its time still runs at real speed (the dissolve is still 2 real seconds, the hold still 60 scene seconds). What does not: truecolor at any rate; 256 colours at 18 frames or fewer, which are painted exactly as before; palette cartridges (Night Drive, Delza and the rest) and Classic at any rate (the cap follows the frame on screen: it lifts again as soon as a frame without full-colour cells is shown; leaving the shelf for Classic at `--fps 30` goes straight back to 30 paints a second, measured through both the app's loop and `tick()`). The shelf with the foil card on screen is under the cap too, but it never reaches it: the foil steps 6 times a second and the shelf paints 6 to 10 times a second by itself (measured, `--fps 30`, 256 colours), so the cap does not act there today; `tests/fps-cap.test.js` pins that ceiling, and runs the same shelf on a copy of the tree whose foil steps 30 times a second to show that the cap is what holds it to 18 (and that it paints faster without the cap). `tests/flash-256-fps.test.js` meters the 9000 at 30 and 24 frames in 256 colours (seeds 1 to 16 at 80x24, fewer at 120x40 and 61x21, 1x and 4x, the menu jump) and in truecolor at 30; `tests/fps-cap.test.js` pins the paint rate (at most 18 in any second by `tick()`, and at most 19 by the app's own loop, whose timer is whole milliseconds, and the arms that must not change; the shelf and its return to Classic; time held back by the cap is never lost to a `tick(0)`) and fails the 30-frame arm with the cap taken out.
- **Frame rate range, 8 to 30: the floor.** `--fps` and `DRIFT_FPS` read 8 to 30 (`MIN_FPS` and the help text in `src/app.js`; `tests/app.test.js` pins that 3 reads 8 and `tests/fps-floor.test.js` that anything above 30 reads 30 and the help says 8-30). Why 8: it is a conservative floor, chosen so that at the floor the test harness reads the q156 clock exactly as it reads the grid; it is not a rate below which a viewer sees flicker. The exact grid passes at 5 fps. What fails at 5 to 7 fps on the q156 clock (the timer that fires on the Windows 15.625 ms tick; see the clocks under Tests) is the test harness's sampler: the meter reads one screen every 1 / fps of clock time, and on a 15.625 ms tick some of those readings catch two paints and some catch none. Over 60 s of clock time at clock seed 1, the readings that catch none, one and two paints are 59, 181 and 60 at 5 fps, and 59, 301 and 60 of 420 at 7 fps, against 0, 299 and 1 and 0, 419 and 1 on the exact grid (18 fps on q156 is 119, 841 and 120 of 1080, and passes). At 8 fps, 125 ms is exactly eight ticks, so the q156 readings are those of the exact grid (0, 479 and 1 of 480). A sweep of every whole rate from 5 to 30 on the exact grid, q156 and jitter clocks, at 1x and 4x in 256 colours (61x21 seeds 1 to 8, 78x24 and 120x40 seeds 1 to 3) found 5, 6 and 7 over the 30 % L3 limit on q156 only (31.7, 36.9 and 33.5 %) and 8 to 30 passing; those three numbers are the harness's readings through that sampler, and the sweep was measured in this work with its log not in the repo. The part a test asserts is narrower, and on a clock other than the grid it is thin: `tests/flash-256-fps.test.js` runs the floor at real 4x in 256 colours on the exact grid and on q156 (clock seed 1) at 61x21 seeds 1 to 8, 78x24 and 120x40 seeds 1 to 3, every rule at its own limit, and on the jitter clock (clock seed 3) at 61x21 seed 4 only (a cost cap on the clock arms, not a result), and a control that 7 fails L3 on q156 (61x21, seed 6, 4x), which shows the harness's sampler and not a flicker a viewer sees. Because 125 ms is eight ticks, the q156 floor arms read what the exact-grid arms read (the same worst L3 of 15.3, 13.0 and 12.4 % at the three sizes), so they add no evidence beyond the sampler agreeing; the only evidence at the floor on a clock other than the grid is that one jitter arm and the scene-clock timing in `tests/fps-floor.test.js` (a 40x12 truecolor run of 20 s on q156 and on jitter, clock seed 1, whose scene time must be 20 s within one frame at 8 fps; it is a check on real time, not on flashing). The 1x runs and the other jitter seeds were in the sweep only. A second reason for a floor: the loop clamps one step to 0.25 s, so a terminal that falls behind, or a rate under 4 fps, gets 0.25 s steps by design and loses real time; `tests/fps-floor.test.js` has a control at 3 fps whose scene time reads about 0.75 of real time. No test meters the flashing of a 4 fps run: the 30.5 % L3 a sweep read at 4 fps on the exact grid (61x21, seed 6, 4x) is a finding recorded in the test comments and not asserted. Full-colour scenes in 256 colours stay capped at 18 (the bullet above), so the range 8 to 30 means 8 to 18 there.
- **Colour flicker, rule C: a HOUSE RULE, beyond WCAG.** WCAG counts brightness and saturated red; it calls a change of hue at steady brightness free. The flash meter also
  has a rule of our own for colour, because a whole screen turning hue several times a second is uncomfortable and was about half of the Rosette's field at 4x. Each pixel's
  colour is read in OKLab and four axes are followed (a, b and the diagonals (a + b) / sqrt 2 and (a - b) / sqrt 2; a and b alone are blind to a change along a diagonal). A swing is a
  change of 0.10 or more between turning points on an axis; a pixel is hot at 7 swings in a second on any axis (a hue turning 3.5 cycles a second); the rule fails when more than 25 %
  of a field is hot. It is judged at the speed the viewer sees, at 1x, 2x and 4x, with the **colour clock** the runtime drives (hue turns at its 1x rate at every speed: C3), and
  it is never loosened. It is not a promise of comfort. **Blind spots:** (1) a colour-only change that stays under the swing on every axis passes, which includes grey and teal at equal
  lightness, up to about the chroma of `safeHue`; (2) a pattern that moves fast while each pixel changes slowly passes; (3) the consequence of what it does see: fast rotation of fine
  colour detail FAILS (the kaleidoscope probe, hue 0.15 cycles a second and rotation 0.08 turns a second, reads 44.0 % over 20 s at 120x40 (47.7 % over 30 s) and 59.6 % at 280x70, over the 25 %; the same with the
  Rosette's rotation, ten times slower, reads 0.0 %). The owner's remembered benchmark "1.5 cycles a second" was a misreading: the probe's hue rate was 0.15. Measured at real 4x, the
  Rosette reads 1.5 to 3.7 % in truecolor and 11.5 to 17.7 % on 256 colours (at most 25 %), Bloomfall at most 6.0 % and Cortex under 1 %; the Rosette driven without the colour clock
  at 4x reads 57.9 to 65.0 %, which is why the clock exists.
- Delza's four key labels exceed 23 characters and are pinned as known (`tests/install-key-labels.test.js`); the 9000's are all within 23.
- Deferred, not built: the visions Spindle, Silk Wake, Reverie, Filigree, Tidefield and The Archive; the menu says THE THREE VISIONS for now; `shelf: "last"` (open the library on the
  last cartridge) is not built.

### Where cartridges are read from, and the trust rule

| folder | trusted | may hold |
|---|---|---|
| `cartridges\` in the install (this repository) | yes | everything above, including scene code |
| `%APPDATA%\drift\cartridges\` (next to the config file, so `DRIFT_CONFIG` moves it too) | no | **data only**: `text` and `builtin` scenes, skins, labels, boot art |

Scene code is JavaScript loaded with `import()`, and only ever from the install folder, which is
the git checkout: it is reviewed and committed like `src/`. That is the wall: the code of a user
cartridge is never imported, whatever the folder holds. As a courtesy the scan of the user folder
skips, with "user cartridges cannot contain code in this version", a cartridge in which it finds a
`.js`, `.mjs` or `.cjs` file or that declares a `cells`, `sim` or `field` scene. The scan reads
the folder's own files: it does not follow links (junctions, symbolic links), and does not see
names that end in a dot or hidden NTFS streams, so a file hidden that way is not reported. It
cannot run either, because nothing reads it. There is no environment override. If the same id is
in both folders the install one wins. Cost of the rule: user cartridges can re-skin Drift, add cut scenes and reuse Classic
scenes, but not add new animations.

Every skin background must be dark, which also makes the photosensitivity rule structural:
two allowed backgrounds differ in luminance by at most 0.05, under the 0.10 that WCAG counts as a flash. Opening the library from inverted high
contrast waits for the same 3 s window as any other background flip.

### How to make a cartridge

A data-only cartridge in four small files. Make the folder
`%APPDATA%\drift\cartridges\hello\` (the folder name must be the `id`) and put these in it.

**hello/manifest.json**

```json
{
  "format": 1,
  "id": "hello",
  "title": "Hello",
  "version": "1.0.0",
  "author": "You",
  "blurb": "A tiny cartridge: one note and some falling sand.",
  "runtime": "cartridge",
  "labelHue": "#7FB069",
  "scenes": [
    { "id": "note", "kind": "text", "title": "A note" },
    { "id": "grains", "kind": "builtin", "ref": "sand", "title": "Falling sand" }
  ],
  "programs": [
    { "id": "main", "title": "Play", "transition": "dissolve", "scenes": ["note", "grains"], "sceneSeconds": 30 }
  ],
  "start": "main"
}
```

**hello/label.txt**

```
+--------------------+
|                    |
|       HELLO        |
|                    |
+--------------------+
```

**hello/skin.json**

```json
{
  "palette": { "hue": "#7FB069", "bg": "#0B140C" },
  "menu": { "layout": "list", "title": "HELLO" },
  "boot": { "lines": ["HELLO 1.0", "Warming up ..."], "seconds": 2 }
}
```

**hello/scenes/note.txt**

```
title: A note
---
Hello from a cartridge.
This card types out, holds, and fades.

A second card follows it,
then the scene starts again.
```

Then run `drift --library`: Hello is on the shelf, after the cartridges that ship with Drift. If
it is missing, a problem is the reason (the library does not list skipped cartridges), and
`drift --cartridge hello` names it: `drift: cartridge 'hello' cannot be loaded: ...`, exit 2.
`tests/readme-cartridge.test.js` extracts the four files above from this README and loads them
through the real loader, so the example cannot go stale.

To add code scenes (a new animation) a cartridge must live in the install folder: a
`scenes/<id>.js` whose default export is the scene (a `cells` or `sim` scene as described under
Architecture; a `field` scene is the calm `scene(t, w, h, params)` contract) with `id` equal to the
manifest id. Cartridge scenes may import only `src/scenes/util.js`, `src/scenes/simrng.js`,
`src/glyphs.js` and `src/cells.js`, plus the cartridge's own flat helper files: a scene may import
`../lib/<name>.js`, and a lib file may import those four modules and `./<name>.js` from the same `lib/` (no sub-folders, no other
cartridge's lib, no other scene). Lib files, like scenes, work in the install folder only; a user cartridge
with any `.js` file is skipped, and `tests/cartridge-scenes.test.js` runs every install
cartridge's scenes through the same size, glyph, colour, determinism and flash checks as the
built-in scenes.

## Architecture

Scenes are pure maths: `scene(t, w, h, params) -> Uint8Array(w*h)` (0-255, row
major, a cell is 1 unit wide and 2 tall). Same inputs, same output, any call
order. No terminal access in `src/scenes/`. The contract is documented at the top
of `src/scenes/util.js`. Squiggle may also fill `params.glyphs` with braille dot
masks.

```
src/scenes/*.js   calm scenes (pure fields)   src/compose.js   calm cross-fade, scheduler, field -> cells
src/ramp.js       density ramp + hysteresis   src/renderer.js  diff renderer (one string per frame; palettes may carry a bg)
src/color.js      palettes, SGR, 256 fallback src/term.js      alt screen, raw keys, signal guards
src/config.js     JSON config                 src/app.js       the loop that wires it all together
src/cells.js      cell scenes + sims, dissolve  src/keymap.js    the one key table (help and --help come from it)
src/overlay.js    help panel                  src/glyphs.js    glyph allow-list
src/modes.js      the four modes              src/scenes/*.js  the non-calm scenes (blockfont.js is the blocktype font)
bin/drift.js      entry   bin/drift.cmd  shim  tools/          capture.mjs capture-ansi.mjs measure.mjs calm.mjs
src/cartridge/    schema.js (ids, limits, validators)  loader.js (discover + load)  textscene.js  palette.js
src/shell/        the console: shell.js (screen machine)  runtime.js (a running cartridge)  library.js insert.js
                  boot.js menu.js chrome.js ui.js (pure draw functions)  driftman.js (the console's own skin)
cartridges/       the install cartridges: classic, delza, driftman-9000 and night-drive (manifest, skin, label, scenes/, lib/; night-drive also boot.txt) and the locked ones (label.txt + manifest.json each)
```

Non-calm scene contract (`src/cells.js`): `kind: 'cells'` scenes are `scene(t, w, h, params)`
filling `params.glyphs` (Uint16Array code points) and `params.colours` (Uint8Array palette
indexes), pure in `t`; `kind: 'sim'` scenes are `{init(w,h,seed), step(state) at 1/30 s,
draw(state, params)}` (same seed + same step count = same frame). The cell composer steps
sims from an accumulator, at most 8 steps per frame (enough for 4x speed at 18 fps; a stall
cannot snowball). A cells scene also gets `params.t0`, the clock when it became active.

The colour clock (DRIFT-8): a full-colour scene is pure in `t` and `tc`. The shell's runtime keeps a second clock, `tc`, that runs
at `min(speed, 1)` of real time (it stops with `t` when paused or when the keys are open), and the composer gives the scene
`params.tc` and `params.tc0` (the `tc` when the scene became active, so a vision entered mid-program starts its colour time at 0, as it
starts `t` at 0 with `t0`). `colourTime(t, params)` in a cartridge's `lib/clock.js` returns `tc - tc0`, or the scene time when no `tc`
is given. Every global hue drift reads it and motion keeps `sceneTime`, so at 4x the picture moves four times as fast and the colours
turn at their 1x rate. At 1x `tc` is `t`: a 1x frame is byte for byte what it was before, with or without `tc`. `renderScene` takes
`tc` as its last argument, and the capture tools pass `tc = t`.

The console (`src/shell/`) owns no terminal, timer or exit path. `createApp` still owns the loop, the
renderer, the signal guards and `quit`; while a console screen is up it calls `shell.tick(dt)`,
`shell.key(token)` and `shell.frame()` instead of the Classic composers, so every exit path (q, Ctrl+C,
signals, a thrown scene) restores the terminal exactly, in the library and mid-insert included. A
cartridge's programs run on the same `Scheduler`, field composer and cell composer as Classic.

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

The suite is 3615 tests in `tests/*.test.js` and takes about 14.5 minutes (the last full run, at DRIFT-13 correction 1: 877.7 s, 3615 pass, 0 fail; it was 267.6 s and 3105 tests before the Classic high contrast work of DRIFT-10 to 13) on a 32-thread machine (220 s before the colour rule C: the meter reads colour too now, which costs about twice as much on an animated full-colour scene, and rule C has its own flash-colour files) (test files run in parallel; the longest are the 9000's flash-meter runs over its menu and help, about 2 minutes by themselves, and the real-process arms, which start the real program and wait in real time). The cartridge work is
covered by `cartridge-schema` (validators, text scene, skin palette), `cartridge-loader`
(every way a cartridge can be wrong, and both arms of the trust rule), `cartridge-scenes` (every
install cartridge's scenes through the size, glyph, colour, determinism and flash checks, with controls
that must fail), `cartridges` (glyph and import scans over `cartridges/`), `config-extras`, `shell-app`
(the console at app level on a fake clock), `shell-draw` and `shell-flash` (every screen at every size,
and the photosensitivity checks), `tools-cartridges` (the cartridge captures and `measure.mjs` options),
`readme-cartridge` (the example in this README), `shell-journal` (the Journal menu's engine pieces: chapter cards, the prompt line, the start-by-itself countdown, the frame ornament), `delza-cartridge`, `delza-thornwell`, `delza-tallow`, `delza-cinderhorn`, `delza-reach`, `delza-highcandle` and `delza-lampwarden` (Delza's manifest, skin, Journal, help, boot, seasons and what each scene promises, read off rendered frames), `night-drive-cartridge`, `night-drive-onramp`, `night-drive-skyline`, `night-drive-sundown`, `night-drive-coast`, `night-drive-redlight`, `night-drive-diner`, `night-drive-caller`, `night-drive-overdrive`, `night-drive-menu`, `night-drive-phase`, `night-drive-flash`, `night-drive-matrix-cells`, `night-drive-matrix-dissolve`, `night-drive-matrix-sims`, `night-drive-phase-sizes`, `night-drive-redlight-sizes`, `night-drive-shell-edges`, `night-drive-shell-edges-b`, `night-drive-shell-eject`, `night-drive-shell-keyframes`, `night-drive-skin-contrast` and `night-drive-banned-glyphs`, `driftman-9000-cartridge` (the Driftman 9000: loader, manifest, skin, label, trust arms), `driftman-9000-console`, `-console-rest`, `-console-morph` and `-console-flash` (its console hook: every phase and size writes only inside its rect, the machine at rest, the morph, the flash meter over insert, boot and eject), `driftman-9000-huefield`, `-huefield-flash` (the colour field alone against the flash meter, in truecolor and 256 colours, with a stepped-lightness control that must fail), `driftman-9000-rosette`, `-rosette-flash`, `-rosette-range` (the per-pixel brightness range of the Rosette in each colour mode over a 4x run) and `cells-cmode` (the colour mode reaching the scenes), `colour-clock` (the colour clock: its rate at every speed key step, 1x byte identity against pinned hashes of the old frames, `colourTime`, the hue rate of each vision at 1x, 2x and 4x, motion on scene time) and `colour-clock-mutation` (one-line breakages of it, run in a temp copy, must each fail the checks), `driftman-9000-cortex`, `-cortex-flash`, `driftman-9000-bloomfall` and `-bloomfall-flash` (the three visions: what each promises, the flash meter at 1x and 4x on truecolor and 256-colour output, the phase test, byte and CPU budgets), `driftman-9000-dissolve` (every ordered pair of visions through the real dissolve), `driftman-9000-dissolve-app` (the dissolves on the running app itself: real `+` presses to 4x, the bytes it writes read back, seeds 1 to 16 at 80x24 in truecolor and, through `flash-256-9000-dissolve-app`, in 256 colours, fewer seeds at 120x40 and 61x21, and the 1x arm), `driftman-9000-dissolve-app-mutation` (the same arm with the real-time dissolve taken out of a copy of the tree: it must fail at 4x, seed 8, and pass at 1x), `driftman-9000-dissolve-app-paths` (the dissolve reached by a speed-up inside it, the space key at 4x and the menu jump at 4x, seeds 8, 12 and 16 at 80x24, every rule), `compose-fade-scale` (the Scheduler's fade scale: a dissolve lasts 2 real seconds from 1x up), `driftman-9000-rulef` (the menu, the prompt row, the countdown and the help box over each vision are palette cells with text at 4.5:1 on the skin's background), `driftman-9000-panels-flash` (the meter over the menu and the help box opening and closing over each vision), `driftman-9000-size-mutation` (one-line breakages of the size handling, run in a temp copy, must each fail the size tests), `capture-ansi` (the `.ansi` captures, below) and `real-process-9000` (quitting the 9000 from the library and from inside each vision, with the arms that must not quit), with the helpers `helpers-driftman-console`, `helpers-driftman-panels`, `helpers-ansi` (an independent reader of the terminal bytes) and `helpers-real-process`, `install-key-labels` (every install cartridge words its keys in 23 characters or fewer) and `renderer-256-redsafe` (the 256-colour lookup never turns a red-safe colour into a saturated red), with the helpers `helpers-night-drive`, `helpers-night-drive-matrix` and `helpers-night-drive-shell` (Night Drive's skin, palette, label, boot art, manifest, help panel, the road, sprites and calm bounds of its first track, the sun, grid, loop and calm bounds of Sundown Grid, the purity, light change, wiper, rain, buildings and calm bounds of Red Light, Rain, and the ring schedule, light trails, phases, exit dissolve and changed-cell bounds of Overdrive), and the cartridge arms of `real-process` (below).
The console hook (DRIFT-7) is covered by `console-hook-loader` (the manifest field, the export check, both arms of the trust rule, the smoke render), `console-hook-shell` (the body and overlay split, writes only inside the rect, the insert, boot and eject wiring, the single decision, the morph's seam and the palette remap), `console-hook-flash` (the flash meter over the whole insert, boot and eject at six sizes, with a strobing control) and `console-hook-nohook` (every frame of a whole run of Classic, Night Drive and Delza, hashed against the tree before the hook), with the helper `helpers-console-hook`.
The flash meter reads half-cell pixels (DRIFT-8): `flash-halves` (the top and bottom coverage of every glyph; the pixel field keeps the cell field's area; every rule reports the worse of the pixel grid and the old cell grid and passes only when both pass; must-fail controls in which the two halves of every cell swap white and black, on every frame and at 4 Hz, at four sizes, that the old meter read as 0.0 on every rule; a swap between teal and amber, which no brightness or red rule can see and which rule C below fails), `flash-halves-mutation` (the old blended-halves meter, built in a temporary copy, passes those controls, and the real meter fails them), and `flash-256-foil`, `flash-256-console-hook`, `flash-256-9000-console` and `flash-256-9000-panels`, which run the foil, console-hook, 9000 console and panels flash files again with the shell built for 256 colours and every frame shown to the meter through the 256-colour reducer (`helpers-flash-modes`, `helpers-flash-halves`); the eject and help-ramp fixtures run in both modes in their own files.
The colour-flicker rule (DRIFT-8 C4, a house rule beyond WCAG, see the Driftman 9000 section) is covered by `flash-colour` (must-fail controls at four sizes: an equal-brightness pair with delta a = delta b = 0.09 at 4 and 6 Hz, a hue wobble of 40 degrees either side of three centres, the whole screen turning hue at 3.6 cycles a second against 3.0 and 2.6, teal and amber at one lightness at 4 Hz against 3 Hz, the halves of every cell swapping colour, 256 colours, a sweep of start phases showing where 3.0 sits on the edge, and the kaleidoscope probe that fails because of fast fine detail while its Rosette-speed twin passes), `flash-256-fps` and `fps-cap` (the 9000 at --fps 30 and 24 in 256 colours and 30 in truecolor, and the 18-frame cap on full-colour scenes in 256 colours, with its mutation), `flash-colour-rosette` (the Rosette at real 1x, 2x and 4x, seeds 1, 2, 3 and 7, both colour modes, four sizes; without the colour clock at 4x it must fail), `flash-colour-visions` (Bloomfall, Cortex and the huefield the same way), `flash-colour-mutation` (the meter with the diagonals dropped, with no colour tracker, with a replay that ignores the colour clock, and with a loosened swing or count, each built in a temporary copy, must fail the tests, and the first two must pass the controls the real meter fails) and `flash-colour-docs` (this README and the meter's header say what rule C is and is not, and every flash test judges the shared rule list). The rule list, the shared `failedRules` and `frameAtSpeed` (which drives the colour clock exactly as the runtime does) live in `helpers-flash.js` and `helpers-flash-controls.js`; the Rosette, Bloomfall and Cortex flash files and the dissolve test now judge rule C at every speed they run.
The shelf scrub (DRIFT-7) is covered by `shell-shelf-move` (every press of a held key and a burst lands on the right card; the dots and the console screen answer within a frame; five presses register inside 1.5 s; the flash meter passes at six sizes, four clock phases and random walks; a lone press is frame-for-frame the 4d2f8da golden; the old hard-sliding walk fails the meter), `shell-shelf-scrub-mutation` (nine one-line breakages of the scrub, each killed), `shell-library-bandwidth` (a held key stays inside the 40 KB/s budget) and the helper `helpers-shelf`.
The flash arms' clocks (DRIFT-9) are covered by `clock` and the helper `helpers-clock`: `createApp` takes an optional `timer` ({ set, clear }) for its loop, and every flash arm can run on three clocks (`grid`, the exact timer every arm used before; `q156`, a timer that fires on the next multiple of 15.625 ms, the Windows tick; `jitter`, a seeded 0 to 16 ms late, never early) while the meter reads the screen on the viewer's 18 Hz grid. `clock` pins the seam (default and injected, both arms), each clock with a control that a grid clock fails, the fire times through the seam equal to `ticks()` at 18 and 30 fps, the grid clock reproducing today's reports, and a strobing source failing the meter on every clock.
`shelf-clocks` runs the shelf scrub on the REAL app (`createApp` with the library, its loop on each of the three clocks, both colour modes, sizes 40x10, 81x24, 79x25 and 89x40, a held key and taps 0.3, 0.44, 0.48 and 0.7 s apart) against the five 1x rules, with the helper `helpers-shelf-real` (every case is asserted once, all green; `shelf-gate-mutant` takes the answers' own gate out of a copy of the shell and the 256-colour 0.44 s cases at 40x10 and 81x24 then read L2 over 25 % on all three clocks); each clock's flows also have one arm per file (`helpers-clock-arms` holds them to 15 % of that file's metered frames, by count); `node tools/shelf-matrix.mjs [--clocks ... --modes ... --sizes ... --taps ... --jobs N]` is the reviewer's wide version (41x11, 78x24 to 84x24, 88x39, 89x40, 15 tap intervals from held to 0.7 s, one line per case with the five numbers and the rules that fail; not part of `npm test`).
The remaining clock coverage (DRIFT-9 item 4) is one q156 and one jitter arm in each file that read a step or a replay on the exact grid. The shell-driving step-rule files (`shell-flash`, `shell-flash-sizes`, `shell-flash-skinned`, `shell-insert-dissolve`, `night-drive-flash` group e) run their own flow with the app stepped by the clock (`helpers-clock-app`: the file's own recorder and step rule at their old limits on the clock's real steps, and the screens through the flash meter on the viewer's 18 Hz grid against the five 1x rules); the Night Drive replays (groups a to d) step the clock's paint times against the same strict 30 %, one-shade-step and 25 % rules; `driftman-9000-dissolve` (`pairRun`), `driftman-9000-huefield-flash`, `driftman-9000-rosette-range`, `flash-256-fps`, `fps-cap` and `driftman-9000-dissolve-app-paths` run their flows on the clocks; each arm has a must-fail control on the same clock. `driftman-9000-huefield` has no clock arm because it calls the field with the time as an argument: a trap that throws on every clock, timer and random source shows it never reads one. `shell-insert-dissolve`'s dissolve-shape tests have none either: the insert picture after n clock steps is the picture after one tick of their sum, on every clock.
Classic high contrast's Life scene (DRIFT-10) is held to the five rules on the real app by `life-flash` (1x, the exact grid, seeds 1 to 8, both colour modes, eight sizes (the list 80x24, 120x40, 40x10, 41x11, 78x24, 79x25, 88x39 and 89x40, not a range: nothing between them is run; 20x6 and 10x4, which this test ran as Life boards until DRIFT-12, are below the 40x10 minimum: since DRIFT-12 those runs are the size card, not Life, and are asserted as runs of the card) including the shell's layout breakpoints 40x10, 78x24 and 88x39 and the sizes just above them, inverted, `--fps` 8, 12, 24 and 30 at 80x24, and one q156 and one jitter arm), `life-flash-fps` (the low frame rates on small boards: `--fps` 8, 10, 12 and 15 at the six sizes 10x4, 13x4, 15x5, 20x6, 25x5 and 80x24 (the first five are below the 40x10 minimum: since DRIFT-12 those runs are the size card, not Life, and only 80x24 runs Life), seeds 1 to 8, both colour modes, 1x and 4x, on the exact grid; q156 and jitter arms at the same rates and sizes, 1x, seeds 2 and 5, 12.3 % of the file's grid frames), `life-frame-cap` (the cap on the cells changed in one painted frame, for every step count the composer can hand over, and the count itself), `life-flash-speed` (2x and 4x reached with real `+` presses, 0.5x and 0.25x with `-`, and the same two clock arms) and the helper `helpers-life-app` (`createApp` in contrast mode on a clock, the bytes read back by `helpers-ansi`, the screens through the meter; a run is the whole 30 s of Life). `life-flash-controls` holds the must-fail side: the old Life (the fixture `tests/fixtures/life-before-drift10.js`, `src/scenes/life.js` as it was at a8b63a3, run in a temporary copy of `src/`) fails seed 2 at 1x and 4x on all three clocks and fails the 1x matrix, the first fix (the fixture `tests/fixtures/life-before-fps-fix.js`, `src/scenes/life.js` as it was at 33f8142: the flip gap and a share per step, nothing per painted frame) fails L3 at the low frame rates on small boards, and one-line mutants of the fix (no flip gap, half the gap, no `realClock`, no real-time clock from the app, no share limits, no per-frame cap, no `min(speed, 1)` in the app) each fail. `life-look` pins what Life still is (two-tone, `i`, the board cell for cell the old Life's and a naive Conway reference, a lone glider gliding, lit share, determinism) and the quiet states (empty and tiny grids, a dead board and an idle board reseeding without a flash, 240x67 and 400x100 by counted work; nothing is timed), `tools-life-matrix` the reviewer's tool `node tools/life-matrix.mjs` (before and after tables, `--x4`, `--scene`, `--whole-cycle`), and `flash-colour-docs` and `tools-flash-table` list the new files (a clock-arm cost line each, under 15 %). What this does not reach is in **What the five rules do not cover**.
Classic high contrast's wire and blocktype scenes and its whole cycle (DRIFT-11: the owner decided on 2026-11-21 that the mode must pass the five rules beyond Life) are held to them on the real app by `wire-blocktype-flash` (1x, 2x and 4x with real `+` presses, the exact grid, seeds 1 to 8, both colour modes, 80x24 and 120x40, the whole 30 real seconds of the scene: wire's cube, torus and both switches, blocktype's wipe, scroll and wave; q156 and jitter arms), `wire-blocktype-flash-sizes` (the shell's layout breakpoints 40x10, 41x11, 78x24, 79x25, 88x39 and 89x40 and the small boards 10x4, 13x4, 15x5, 20x6 and 25x5 (below the 40x10 minimum: since DRIFT-12 those runs are the size card, not Life or wire or blocktype), seeds 1 to 8, both colour modes; inverted at 80x24 and 120x40; one run of each scene at the shipped scene length of 180 s), `wire-flash-fps` and `blocktype-flash-fps` (the full cross of `--fps` 8, 10, 12, 15, 18 and 30 with the six sizes 10x4, 13x4, 15x5, 20x6, 25x5 and 80x24 (the first five are the size card since DRIFT-12, asserted as runs of the card; only 80x24 runs the scene), both colour modes, 1x and 4x, seeds 1 to 8 on the exact grid, 1152 runs a scene; q156 and jitter on every rate and size pair of that cross with seed 2 at 1x in 256 colours and seed 5 at 4x in truecolor, 144 runs a scene, 12.5 % of the file's grid frames, so every clock at the lowest rate on every small board is in; the full cross on the clocks is the matrix tool's) and `wire-blocktype-cycle` (all five scenes and the four dissolves, 170 s at a scene length of 30 s, every frame metered, at ten sizes from 40x10 to 120x40, seeds 1 to 3, both colour modes; `--fps` 8 at 80x24, 41x11 and 120x40; q156 and jitter arms; and tunnel, maze and Life each alone, which DRIFT-11 left unchanged). `wire-blocktype-flash-controls` holds the must-fail side: the old wire and blocktype (the fixtures `tests/fixtures/wire-before-drift11.js` and `blocktype-before-drift11.js`, `src/scenes/wire.js` and `blocktype.js` as they were at 7c2f34c, run in a temporary copy of `src/`) fail at 1x, 2x and 4x on the grid and at 1x on q156 and jitter with the numbers pinned (wire L1 37.04 % and L2 93.98 %, blocktype L2 77.78 % at 1x on the grid, seed 1), and one-line mutants of each mechanism each fail against a pair that passes (wire: beat and gap both removed, the gap halved with the beat removed, no per-frame cap, no share limits, no `realClock`; blocktype: a wave that ripples with the front, a scroll that slides, no per-frame cap, no share limits, no `realClock` at 4x on a 10x4 board; since DRIFT-12 those last three small-board mutants are asserted as what is true: the board is the size card, so they cannot fail through the app, and they pass at 40x10, where measured over seeds 1 to 8 none of them fails at any rate or clock tried: the caps' must-fail evidence is on the composer, `life-frame-cap`), a mutant that strobes fails L1, L2 and L3 on both scenes, and a mutation that matches nothing throws. Wire has two limits on how often a cell changes, the beat and the gap, and either alone holds L1 and L2 on every arm measured (pinned both ways: each alone passes, both removed fail, the gap halved with the beat removed fails): they are redundant on purpose, the gap being what holds when the cap defers a cell. `wire-blocktype-look` pins what the scenes still are (two-tone, the glyph allow-lists, every cell written on 0x0, 1x1, 3x2 and 10x4, `i` and the saved invert setting giving the same glyphs with the colours swapped, determinism, a lit-share band at 80x24 and 120x40, wire's shown frame equal to its ideal pose 12 steps after every beat with the cube one connected shape and the torus at most two, blocktype's shown frame equal to its ideal in every hold so the whole word is readable, all eight words and all three transitions reached, 240x67 and 400x100 by counted work), `follow` the follower on its own (the cap for every step count up to the composer's maximum, the gap with a control, a shown cell never changing more often than its target, a quiet board costing nothing; its share and cap equal Life's), `tools-life-matrix` the tool (`--tree before11` runs the old wire and blocktype, `--fps` takes a list) and `flash-colour-docs` and `tools-flash-table` list the new files (a clock-arm cost line each, under 15 %), with the helper `helpers-wb-flash`. The ideal pictures stay pure functions of time (`ideal` in wire.js and blocktype.js), and `contrast-scenes` reads them for the geometry.
Classic high contrast's tunnel scene and its whole cycle at 1x, 2x and 4x (DRIFT-12) are held to the five rules, at the listed sizes and rates, on the real app by `tunnel-flash` (1x, 2x and 4x with real `+` presses, the exact grid, seeds 1 to 8, both colour modes, 80x24 and 120x40, the whole 30 real seconds of the scene; q156 and jitter arms), `tunnel-flash-sizes` (the six layout breakpoint sizes 40x10, 41x11, 78x24, 79x25, 88x39 and 89x40, inverted at 80x24 and 120x40, the shipped 180 s scene length at 1x and 4x, clock arms), `tunnel-flash-fps` (truecolor) and `tunnel-flash-fps-256` (`--fps` 8, 10, 12, 15, 18, 24 and 30 at the eight sizes 40x10, 41x11, 78x24, 79x25, 88x39, 89x40, 80x24 and 120x40, 1x and 4x, seeds 1 to 8 on the exact grid, 896 runs a file; q156 and jitter on every rate and size, 112 runs a file), `tunnel-cycle` (all five scenes and the four dissolves, 170 s at a scene length of 30 s, every frame metered, at 1x, 2x and 4x: the eight sizes, seeds 1 to 3, both colour modes; six frame rates on 40x10, 80x24 and 120x40; inverted; the shipped scene length of 180 s at 1x and 4x; Life, tunnel and maze alone at 2x and 4x at 80x24 and 40x10; q156 and jitter arms), `tunnel-look` (still a tunnel: ring edges round the vanishing point 1.52 times apart, spokes, a clear eye, an outward flow, the bend, a lit share of 40 to 60 %, two-tone, the glyph list, the empty and tiny scene sizes, counted cost at 240x67 and 400x100) and `classic-dissolve-real-time` (Classic high contrast dissolves for 2 real seconds at every speed from 1x up, calm and chaos as before, and the composer's steps counted). `tunnel-flash-controls` is the must-fail side: the old tunnel and the whole old cycle fail at 2x and 4x with the numbers pinned, a one-line mutant of each mechanism (the tunnel's `realClock`, the app's `min(speed, 1)`, the old flow, the cross-fade scaling, the composer's `realTimeIds`, both dissolve mechanisms) fails against a pair that passes, a strobe fails, and a mutation that matches nothing throws. Each file's clock arms read at most 15 % of the frames of its grid arms, by count (each file's last test): `tunnel-flash` 12.3 % (12 runs), `tunnel-flash-sizes` 4.1 % (16 runs), `tunnel-flash-fps` 12.7 % and `tunnel-flash-fps-256` 12.5 % (112 runs each), `tunnel-cycle` 7.4 % (18 runs); `node tools/flash-table.mjs` lists the arms.
`tests/shell-clock.test.js` is the other kind of clock test: it times every flow of the shell (library fade, slide, dip, locked message, shelf scrub-out, insert, boot, eject, error card, menu and help ramps, program-switch dissolve, season ramp) in a real `createApp` on node's mock timers, at all eight speed keys and at `--fps` 8, 12, 18 and 30, and asserts each lasts its constant to within one frame, never shorter. It does not run on the q156 or jitter clocks. `node tools/flash-table.mjs` prints every flash arm with its clock (grid, q156, jitter or none), colour modes, sizes, speeds, fps and seeds, one row per arm, with the test file and line that declares it; `tests/tools-flash-table.test.js` fails if a row names a test file or title that is not there, or if a test file that runs a clock arm has no row. The columns of the table are written by hand in the tool and are only as right as the person who wrote them; the link to the test is what is checked.
**What the clocks do not reach.** Path (a) of `tests/driftman-9000-dissolve-app-paths.test.js` (the speed pressed up inside a dissolve, a 220 s run) has no q156 or jitter arm: one would cost more than the 15 % of the file's metered frames that all the clock arms of a file may use, so it runs on the exact grid only (paths (b) space and (c) menu jump have both clocks). `tests/driftman-9000-huefield.test.js` has none because the field is a function of the time it is given: a trap that throws on every clock, timer and random source shows it never reads one (and the same trap throws on a field that does). `tests/driftman-9000-huefield-flash.test.js` meters the field with the time handed in and runs one 256-colour arm per clock (80x24, L 0.66). The menu jump from Cortex into Rosette runs on q156 only (`tests/flash-menu-cortex-rosette-clock.test.js` and `tests/flash-256-menu-cortex-rosette-clock.test.js`: 80x24, 18 fps, seeds 1 to 16, 1x and 4x, picks at 18.5, 24 and 30 s at 4x and 62, 67.5 and 73.5 s into Cortex at 1x, with a control that a hard-cut jump fails L3).
**What the five rules do not cover.** Classic's chaos mode and Night Drive are not held to the five rules (L1, L2, L3, R, C) by any test, and they do not all meet them.
Classic's high-contrast mode is held to them on all five of its scenes and on the whole cycle with the four dissolves between them, at 1x, 2x and 4x (Life since DRIFT-10, wire and blocktype since DRIFT-11, tunnel and the whole cycle at speed since DRIFT-12, set out below; boards below 40x10 are not reachable: Classic shows the size card there, since DRIFT-12). Since DRIFT-13 a flash governor (`src/governor.js`) sits behind all of it and holds the per-cell and per-read limits by construction; what it covers by construction, what is only measured and over which sizes, rates, speeds and clocks are under "Classic high contrast: the flash governor (DRIFT-13)" below.
What is still not covered is listed under "Not covered for Classic high contrast" below: the x4 views, speeds 0.25x, 0.5x and 0.75x of the whole cycle, seeds above 8, scene lengths other than 30 s (and the shipped 180 s on 80x24), boards below 40x10 (the size card), frame rates outside 8 to 30, the `i` key's own whole-screen flip, and calm, chaos and experimental.
Classic is judged by its background-flip guard and its own checks.
Metered with the five rules, chaos reads over the 25 % limit (the share of cells in the worst field), by hand runs whose scripts are not in the repo; every chaos figure here is 80x24, 18 fps (the default), 256 colours, 1x, a 40 s run, on the exact grid, unless it names another clock, run length or setting.
Chaos reads over on rule R once its second scene, swarm, plays: with the scene length set to 30 s (`--scene-seconds 30`), seed 1 reads R 29.63 % at 36.3 s and seed 2 R 28.24 % at 34.8 s (the app's `tick()` driven by hand), and the real loop on the grid, q156 and jitter clocks reads 29.63 % (seed 1) and 27.78 to 28.70 % (seed 2).
Two measurers first disagreed on chaos, and the cause was scene length: the default is 180 s (`DEFAULTS` in `src/app.js`), so a 40 s run at the default never leaves chaos's first scene, glyphrain, which reads R 19.91 % at 7.1 s (seed 1) and 20.37 % at 13.1 s (seed 2), under the limit; at the default scene length swarm starts at 180 s, and a 200 s run reads R 29.63 % at 186.2 s (seed 1).
With the scene length matched the two measurers read the same.
**Classic high contrast, the Life scene, is asserted since DRIFT-10.** Before it, in the real app (contrast mode, Life first, 80x24, 18 fps, the grid, q156 and jitter clocks; a scene length of 30 s at 1x and 120 s at 4x, so that Life is on for 30 real seconds), seeds 1 to 8 read worst L1 27.78 to 30.56 % and L2 41.67 to 44.44 % at 1x, and L1 32.87 to 38.43 % and L2 78.70 to 83.33 % at real 4x (the `+` key four times from 1 s in); seed 2 alone read L2 34.26 % at 15.4 s and L1 27.78 % at 28.9 s at 1x (the figures this paragraph used to carry) and L2 62.50 % at 4x.
L1 is the WCAG rule (cells with at least 7 transitions in 1 s, `tests/helpers-flash.js`) and L2 the in-house one (3 in 1 s).
What changed is what Life draws (`src/scenes/life.js`): the board is the same (cell for cell the old Life's, asserted), but the picture follows it under two limits, a cell changes on screen at most once every 0.6 s (so none can change three times in the meter's second) and at most 15 % of the cells change between two painted frames, shared over the 1/30 s steps the frame holds and never more than 8 % in one step (so a reseed on a tiny board does not arrive in one frame: at `--fps` 8 to 12 a frame holds three to six steps, and a timer that fires late puts two paints between two reads of the viewer's grid, so the cap is half of L3's 30 %), and Life steps 10 generations a real second at 1x and every faster speed (slower speeds slow it) (it asks the composer for the real-time clock, `realClock` in `src/cells.js`, so the speed keys no longer make it step faster; they still shorten the scene's turn).
Blinkers, the pulsar and the churn of a methuselah shimmer slowly instead of strobing, and a glider still glides, a pixel or two late.
Asserted now, on the real app (`createApp`, the bytes read back through the terminal reader, the five rules at their 1x views, the whole 30 s of Life each time; every arm passes): `life-flash` (1x on the exact grid, seeds 1 to 8, truecolor and 256 colours, at the eight listed sizes 80x24, 120x40, 40x10, 41x11, 78x24, 79x25, 88x39 and 89x40, and 20x6 and 10x4 as runs of the size card (a list, not a range); inverted at 80x24 and 120x40; `--fps` 8, 12, 24 and 30 at 80x24 on seeds 2, 4 and 8; q156 and jitter at 80x24 on seeds 1, 2, 3, 4 and 8 in 256 colours and at 120x40 on seed 2 in truecolor), `life-flash-fps` (`--fps` 8, 10, 12 and 15 at 10x4, 13x4, 15x5, 20x6, 25x5 and 80x24, the first five being the size card since DRIFT-12 and only 80x24 running Life, seeds 1 to 8, both colour modes, 1x and 4x on the exact grid; q156 and jitter at the same rates and sizes at 1x on seeds 2 and 5), `life-flash-speed` (2x and 4x on the exact grid, seeds 1 to 8, both colour modes, 80x24 and 120x40; 4x at 40x10, 78x24 and 88x39 on seeds 1 to 4; 4x at a scene length of 30 s, where Life is on for 7.5 s (the shipped default is 180 s, `DEFAULTS` in `src/app.js`); 0.5x and 0.25x on seeds 1 to 3, where Life moves about half and a quarter as often as at 1x; q156 and jitter at 4x on seeds 2, 4 and 8, at 2x on seed 2, and at 4x in truecolor at 120x40) and `life-flash-controls` (the old Life must fail seed 2 at 1x and at 4x on all three clocks and fail the 1x matrix, the first fix at the low frame rates, and seven one-line mutants of the fix, each of which must fail), with `life-look` (two-tone, `i`, still Conway's Life, gliders, not blank, deterministic, reseeds, tiny and very large boards) and `tools-life-matrix`.
`node tools/life-matrix.mjs` is the reviewer's version (not part of `npm test`): over seeds 1 to 8, both colour modes, the three clocks, 1x, 2x and 4x and the ten sizes above (measured before DRIFT-12; below 40x10 the tool now runs the size card and says so on stderr, so the 20x6 and 10x4 figures here are history and not reachable), its 180 summary lines all pass, with L1, L2, R and C at 0 % and L3 at worst 22.50 % (the 20x6 and 10x4 boards; 4.48 % at 80x24); with `--fps` 8, 10, 12 and 15 at the six small sizes (10x4, 13x4, 15x5, 20x6, 25x5, 80x24; measured before DRIFT-12: the first five are the size card now), both colour modes, the three clocks, 1x and 4x, each rate's 72 lines all pass with L1, L2, R and C at 0 % and L3 at worst 14.40, 28.00, 28.80 and 30.00 % (a q156 clock puts two paints between two reads, so two capped paints read up to the limit: 30.00 % exactly on 10x4 and 20x6 at 15 fps).
Before the per-frame cap the same rows failed L3 (33f8142, 256 colours, 1x, worst of seeds 1 to 8): 30.77 to 32.00 % at `--fps` 8 on 13x4, 15x5 and 25x5 on every clock, and q156 at 45.00 % at 10 fps (10x4 and 20x6), 37.50 % at 12 fps (10x4) and 32.00 % at 15 fps (15x5).
**Classic high contrast's wire and blocktype scenes and its whole cycle are asserted since DRIFT-11.** Before it (7c2f34c, the same real app, the tool's `--tree before11`, 80x24, 18 fps, 1x, 256 colours, the grid clock, seeds 1 to 3), wire read L1 40.74 % and L2 98.61 %, blocktype L2 81.02 % and the 170 s cycle (seeds 1 to 3) L1 43.52 %, L2 99.54 % and L3 21.56 %.
Over the whole matrix below, the old wire failed every one of its 1404 summary lines (worst L1 100.00 %, L2 100.00 %, L3 60.00 %) and the old blocktype 1212 of 1404 (worst L1 25.00 %, L2 100.00 %, L3 75.00 %); the old cycle failed all 60 lines from 40x10 up (worst L1 50.46 %, L2 99.54 %, L3 27.25 %).
What changed is what the two scenes draw (`src/scenes/wire.js`, `src/scenes/blocktype.js`, the shared follower `src/scenes/follow.js`): both are sims on the real-time clock now (kind `sim`, `realClock`, as Life: the speed keys no longer turn the shape or change the words faster, they still shorten the scene's turn), and what they draw follows what they want under limits.
**Wire** works out its picture once every 0.6 s (a beat; the cube and the torus turn in steps, a clean new pose each beat, at half the old turning rate, so it reads as a ratchet rather than a smooth spin) and shows it through a follower in which a cell changes at most once every 0.6 s, at most 8 % of the cells change in one step and at most 15 % between two painted frames (shared over the steps the frame holds, as Life's); twelve steps after a beat the shown frame is the pose, cell for cell (the test asserts it at 80x24, 120x40, 41x11 and, on the scene alone with one step a painted frame, at 20x6 and 10x4, which the app never shows: Classic shows the size card below 40x10). Counted by hand before DRIFT-12 and not asserted, wire at seeds 1 to 3, 46 beats each, a frame holding n steps: 40x10 and 80x24 pass up to n 6 and miss on 6 (n 7) and 12 (n 8) of 46 beats; the shipped `--fps` range puts a frame at 4 steps or fewer, and a late timer can put more. The same count on 10x4 (misses from n 3) and 20x6 (from n 6) is history: those boards are not reachable.
A smoother wire, a continuous picture with the follower alone, read 86 to 89 % equal to its ideal and looked smeared (a moving edge leaves a half-second trail of stale dots).
**Blocktype** keeps its wipe, scroll and wave, but each is two pictures that hold still while a sweep goes by (every pixel changes at most twice in a transition, and transitions are 6 s apart; the old wave and scroll moved letters a pixel at a time and flipped every cell they crossed many times in 1.8 s), shown through the same per-step share and per-frame cap, with no per-cell gap: a gap would leave the wipe's bar standing about 26 columns wide behind the sweep.
The wipe is as it was; the scroll is now a band that sweeps left to right in which the old word is half way up and out and the new word half way up and in; the wave is the new word rippling in a band behind the front and settling.
In the holds the shown frame is the ideal frame, cell for cell.
Asserted now, on the real app (every arm passes; the whole 30 real seconds of the scene each time): the files listed above.
`node tools/life-matrix.mjs` is the reviewer's version (not part of `npm test`): for each of the two scenes, over seeds 1 to 8, both colour modes, the three clocks, 1x, 2x and 4x, `--fps` 8, 10, 12, 15, 18 and 30 and the thirteen sizes 10x4, 13x4, 15x5, 20x6, 25x5, 80x24, 120x40, 40x10, 41x11, 78x24, 79x25, 88x39 and 89x40 (the five below 40x10 were measured before DRIFT-12: the tool now runs them as the size card), its 1404 summary lines all pass, with L1, L2, R and C at 0.00 % and L3 at worst 30.00 % for wire (a q156 clock puts two capped paints between two reads, so two paints of 15 % read the limit exactly, as for Life) and 24.00 % for blocktype (the small boards; 15.52 % at 80x24 and 120x40).
The whole cycle (`--whole-cycle`, seeds 1 to 3, both colour modes, the three clocks, 1x, `--fps` 8 and 18, at 80x24, 120x40, 60x16, 41x11 and 40x10): all 60 lines pass, L1 0.00 %, R 0.00 %, C 0.00 %, L2 21.43 % and L3 24.61 % at worst (at 80x24 and 18 fps L2 15.28 % and L3 19.01 %); what is left in L2 is the tunnel's and the dissolves'.
**The cycle below 40x10: not reachable: Classic shows the size card below 40x10**, so the whole cycle never runs on a board that small. What was measured there before DRIFT-12 is kept as history: at 20x6 and 10x4 the whole cycle failed (worst L2 57.14 % at 20x6, 18 fps, grid; L3 45.00 % at 10x4 at `--fps` 8, every clock), and the cause is not these scenes: tunnel and maze alone, which DRIFT-11 left as they were, read L2 over 25 % on every board from 10x4 to 25x5 on the grid clock at 18 fps (tunnel 37.50 % and maze 50.00 % at 10x4, seeds 1 to 3, measured before DRIFT-12: `tools-life-matrix` now pins that 10x4 is the size card instead) and maze reads L3 45.00 % at 10x4 at `--fps` 8, while Life, wire and blocktype alone pass those boards.
Not covered for Classic high contrast: (1) the x4 views of the Life scene (the same frames played four times as fast, `--x4`; only the 1x views are asserted), which read L1 1.39 % and L2 56.94 % at 80x24 over seeds 1 to 8 (the old Life read 56.02 % and 76.85 %);
(2) the x4 views of wire (80x24, seeds 1 to 8, `--x4`: L1 3.24 % and L2 88.43 %, the poses moving every 0.15 s when the frames are played four times as fast; blocktype reads 0.00 % and 0.00 %; the old wire read 100.00 % and 100.00 %), and of tunnel (80x24, seeds 1 to 8, `--x4`: L1 3.70 % and L2 90.28 %, the rings flowing across the screen four times as fast when the frames are played that way; the old tunnel read 22.22 % and 100.00 %; maze reads 0.00 % and 14.81 %); the 1x, 2x and 4x readings of tunnel and the whole cycle are asserted since DRIFT-12 (below);
(3) speeds other than 0.25x, 0.5x (80x24 only), 1x, 1.5x, 2x, 3x and 4x (0.75 is not pressed; 1.5x and 3x are asserted only by the governor's sweep sample and measured by the matrix tool, see the governor section below), seeds above 8, sizes other than those listed (boards under about 34 cells, which are not reachable: Classic shows the size card below 40x10 (DRIFT-12), so no window that small runs Life, wire or blocktype; what was measured by hand before that, kept as history and not asserted, read over L3: 3x2 reads 33.33 % at the default 18 fps on the grid clock and 50.00 % on q156 and jitter, and at `--fps` 8 to 12 4x4, 8x2, 5x3, 6x3 and 9x2 read 31.25 to 40.00 % and 3x2 up to 83.33 %; boards of 20 to 36 cells spot-checked at 8 to 18 fps pass; and for wire and blocktype (DRIFT-11, seeds 1 to 8, 256 colours, 1x, the three clocks, `--fps` 18, 12, 10 and 8 on 3x2, 4x4, 8x2, 5x3, 6x3 and 9x2: 103 of 144 summary lines pass, and L1, L2, R and C read 0.00 % on all of them, only L3 fails): wire reads L3 33.33 % on 3x2 at 18 fps on the grid and jitter clocks and 50.00 % on q156, 50.00 to 83.33 % at 12 and 10 fps and 66.67 % at 8 fps, blocktype 33.33 % on 3x2 at 18 fps on all three clocks and 50.00 % at 12, 10 and 8 fps, and the other five boards read over L3 only on the q156 clock at `--fps` 10 and 12, 31.25 to 40.00 % for both scenes (and blocktype 5x3 at `--fps` 8 on jitter, 33.33 %) while every one of them passes at 18 fps), `--fps` other than 8, 10, 12, 15, 18, 24 and 30 in the per-scene files (and 8, 10, 12 and 15 only at the six small sizes; the governor's sample adds 9, 21, 26 and 27, and the matrix tool's samples every integer from 8 to 30), a scene length other than 30 s (the shipped default is 180 s), and the `i` key's own whole-screen flip (the screen is read inverted from the start, not at the press; the governor has no part in it and the flip guard bounds how often it happens);
(4) is gone: the failures of the whole cycle at the small sizes that Desmond Hale (the contrarian) found by hand after DRIFT-12 (42x12 at `--fps` 26 and 27, 45x12 at `--fps` 21, 41x12 at `--fps` 9, and 42x12 at 1.5x) were measured, not asserted, and the follow-up, DRIFT-13, fixed them with the flash governor and asserts them (with the two 25.00 % edges and the rest of a sweep sample): set out in "Classic high contrast: the flash governor (DRIFT-13)" below. What is still not covered is (1) to (3) above, and the list at the end of that section.
A fresh plain `drift` with no saved config starts in calm (`DEFAULT_MODE`, `src/modes.js`; the config file remembers the last-used mode, so someone who last left Drift in high contrast starts there), and calm passes: seeds 1 and 2, scene length 30 s, 256 colours and truecolor, grid, q156 and jitter clocks, worst L1 0.23 %, L2 0.69 %, L3 0.29 %, R 0 %, C 0 %.
This is not new: since commit b76f0c4 the only changes under `src/scenes`, `src/modes.js`, `src/compose.js`, `src/cells.js`, `src/config.js`, `src/glyphs.js`, `src/ramp.js` and `src/pixels.js` are Classic high contrast's (DRIFT-10: `src/scenes/life.js` and the `realClock` step in `src/cells.js`; DRIFT-11: wire, blocktype and `src/scenes/follow.js`; DRIFT-12: `src/scenes/tunnel.js` and `realTimeIds` in `src/cells.js`, which only the contrast composer asks for; calm's render-hash cases are byte-identical), and no test asserts calm's readings.
**Classic high contrast at 1x, 2x and 4x: tunnel and the whole cycle pass the five rules at the listed sizes and rates (asserted since DRIFT-12; not at every reachable size or frame rate, see "Not covered" above; since DRIFT-13 also held by the flash governor and measured over the wider sample set out below).**
Before DRIFT-12 they did not at 2x and 4x (kept as history, re-measured on the tree at 1cb2b62 with `node tools/life-matrix.mjs --scene tunnel` and `--whole-cycle`, `--speeds 1x,2x,4x --sizes 80x24,40x10 --modes 256,truecolor --summary-only`, 18 fps, seeds 1 to 8 on the grid, q156 and jitter clocks, the speed pressed from 1 s in and the scene length 30 * speed scene seconds, so each scene is on for 30 real seconds; `--tree before12` runs that tree again).
Worst of everything that ran (L1, L2, L3, R, C, in per cent): tunnel 1x 0.00, 19.64, 21.25, 0.00, 0.00 (passes), 2x 0.46, 57.14, 36.75, 0.00, 0.00 and 4x 17.86, 100.00, 55.50, 0.00, 0.00; whole cycle 1x 0.00, 25.00, 21.00, 0.00, 0.00 (passes), 2x 1.79, 60.71, 34.00, 0.00, 0.00 and 4x 17.86, 100.00, 54.75, 0.00, 0.00 (DRIFT-11's cycle figures, 33.75 and 52.75 for L3, covered seeds 1 to 3 on q156 and jitter). Both colour modes read alike. Tunnel and the cycle failed L2 on all 24 of their lines at 2x and 4x, and L3 on the 4x lines and the 2x q156 lines.
Why tunnel failed: it was a pure function of the scene clock, which the speed keys multiply, so every cell flipped two and four times as often as at 1x (about once a second there: rings at 0.9 a second and the spokes' turn on top); rule L2 (three changes in a second in a quarter of a field) and L3 (30 % of the cells between two reads) read that as hot.
What fixes it, in three parts, each found by measuring what the one before left over:
(1) the tunnel is a sim on the real-time clock now (`realClock`, as Life, wire and blocktype; `src/scenes/tunnel.js`), so its flow is the 1x flow at every speed from 1x up; the speed keys still shorten the scene's turn;
(2) the real-time clock alone was not enough: the old flow left L3 at 34.25 % at 10 fps on the q156 clock on 40x10 (33.48 % on 41x11 and 29.06 % at 78x24, 1x, seeds 1 to 8; the old tunnel fails that at 1x too, 2 of its 56 q156 lines), because a late timer puts two paints between two reads of the viewer's grid and two paints of a flow that fast change over 30 % of the cells; so the flow is slower, 0.55 rings a second and the spokes at 0.08 of a spoke a second (0.9 and 0.12 before), which reads L3 24.50 % at worst. There is no follower, no per-cell hold and no per-frame cap in the tunnel: the slower flow is the design, and the controls pin it (only the flow is a mechanism; the spokes' turn alone is not);
(3) with the tunnel fixed the whole cycle still failed at 2x and 4x, in the dissolves and the maze (L2 39.09 % at 4x on 79x25 and 30.36 % at 2x on 40x10; and the maze alone inside the cycle read L3 31.71 % at 4x on the q156 clock at 18 fps on 41x11, its erase wipe four times as fast): the 2 scene-second dissolve lasted half a real second at 4x, which put a cell's last change in the outgoing scene, its flip and its first change in the incoming one inside one second, and the maze does not ask for `realClock` (its file is left as it was). So in contrast mode only, the scheduler's cross-fade runs in real time (2 real seconds at every speed from 1x up, as the Driftman 9000's dissolve does, `fadeScale` in `src/compose.js`; 4 s at 0.5x as before) and the composer steps the maze, the one sim of the mode that does not ask for `realClock`, from the real-time clock (`realTimeIds`, `src/cells.js`, set in `src/app.js`). At 1x the bytes are unchanged (`render-hash`: 12 tunnel cases moved, nothing else; `captures/contrast-tunnel-1.txt`, `contrast-tunnel-2.txt` and `dissolve-contrast.txt`, the three captures that show the tunnel, were regenerated); calm, chaos and experimental are unchanged (`classic-dissolve-real-time` pins it).
What the owner sees: at 1x the tunnel flows and turns more slowly; at 2x and 4x it no longer speeds up (the `+` key shortens the scene's turn, as for Life); the dissolve between two scenes lasts 2 seconds at any speed; the maze runs at its 1x pace at 2x and 4x.
Asserted now: `tunnel-flash`, `tunnel-flash-sizes`, `tunnel-flash-fps`, `tunnel-flash-fps-256`, `tunnel-cycle`, `tunnel-look` and `classic-dissolve-real-time`, with `tunnel-flash-controls` (listed above; every arm passes).
Measured by script and not part of `npm test` (the reviewer's wide version: one `tools/life-matrix.mjs` process a clock and speed, `--summary-only`, each line the worst of seeds 1 to 8): tunnel alone, grid, q156 and jitter, 256 colours and truecolor, 1x, 2x and 4x, the eight sizes 40x10, 41x11, 78x24, 79x25, 88x39, 89x40, 80x24 and 120x40, `--fps` 8, 10, 12, 15, 18, 24 and 30: 1008 lines, all pass, worst L1 0.00, L2 14.29, L3 24.50 (q156, 10 fps, 40x10), R 0.00, C 0.00 (measured before the cross-fade and composer change, which a run of one scene cannot reach: the run ends when the dissolve starts, and the tunnel was on the real-time clock already); the whole cycle, 256 colours, the same clocks, speeds, sizes and rates: 504 lines, all pass, worst L1 0.00, L2 25.00, L3 27.00 (q156, 4x, 10 fps, 40x10), R 0.00, C 0.00; truecolor, `--fps` 8, 18 and 30: 216 lines, all pass, worst L2 25.00, L3 21.06; inverted (`--invert`, 80x24 and 120x40, both colour modes, 18 fps, three clocks): the cycle 36 lines, all pass, worst L2 12.50, L3 15.15, and the tunnel alone (`--fps` 8, 18 and 30) 108 lines, all pass, worst L2 11.11, L3 16.82.
L2 25.00 is the limit itself (14 of 56 cells; the rule fails above it): 40x10 at `--fps` 30 at 1x and at `--fps` 24 at 4x on the grid clock, in a dissolve (seed 7, 95.2 s, wire to maze, reads the same 25.00 % on the old tree at 1x; seed 8 at 32.8 s, at the end of the dissolve from Life into the tunnel, is new), so there was no margin on that board at those rates at DRIFT-12. Since DRIFT-13 the same three cases read L2 12.50 % on all eight seeds in both colour modes (the governor holds a field to at most 14 hot cells and these boards stay well under it).
The same axes on the old tree (`--tree before12`; the tunnel on all seven rates, the cycle on `--fps` 8, 12, 18 and 30 only, 256 colours): tunnel alone 504 lines of which 338 fail (all 336 at 2x and 4x, and L3 31.25 % at 10 fps on 40x10 and 41x11 on q156 at 1x), worst L1 30.36, L2 100.00, L3 77.75; the cycle 288 lines of which 192 fail (all of 2x and 4x), worst L1 28.57, L2 100.00, L3 70.73. Nothing failed after at those axes at DRIFT-12; Desmond Hale then found failures outside them by hand, and DRIFT-13 fixed them (below).
**Classic high contrast: the flash governor (DRIFT-13). The five rules are held by construction for the cell and the per-read limits, and measured over the stated sample; no sentence here is wider than the run behind it.**
`src/governor.js` sits between what the scenes and the dissolves compose (the help panel already drawn over it) and the renderer, in Classic high contrast only (never calm, chaos, experimental, the console or the size card). It is handed the composed frame and the app's REAL time (never the scene clock: the speed keys change the scene clock, not what the eye reads) and the app's own `--fps`, and returns what is painted: every cell is either what the composer asked for or the pair it already showed, never a third picture, so the two-tone stays two-tone. A cell that is held is asked again at the next paint (it catches up). No meter and no limit was changed: the governor only keeps the picture inside them. It limits two things. (1) A cell may not change a third time within one second (W = `max(1, win1 / fps)` seconds, where `win1` is the meter's window in reads, the rate rounded: one second at every whole-number rate), because the meter calls a cell hot only after three transitions in that window (that is the strict rule; the shipped variant relaxes it by a budget, next paragraph). (2) No more than 25 % of the cells may change inside one read of the meter (the union of every paint a read of 1/fps can see; `READ_CAP`, five points under L3's limit of 30 %).
The shipped variant is `nbhd`. The strict per-cell rule holds more than the meter needs, because the meter fails a field only when more than 25 % of its cells are hot, so a cell MAY make that third change while a budget of such "triple" cells lasts. The screen is cut into blocks the size of the meter's field (a third of the columns and of the rows, rounded up, so at most 3 x 3 blocks); the meter's sliding field lies inside one 2 x 2 neighbourhood of blocks; each neighbourhood may hold at most K triple cells, K being the most cells the meter passes in a field (25 % rounded down: 14 of the 56 cells of a field at 40x10 to 42x12). A hot cell is always a triple cell, so no field holds more than K hot cells, so L2 (and L1, which needs seven transitions) cannot pass 25 % on the cell grid; on the pixel grid (two pixels per cell) a field has at most 2K hot pixels in 2 x its cells, the same 25 %. Rule C and the colour grid are bounded by the same count (a colour swing needs a change of the cell). The derivation is the header of `src/governor.js`; `governor` (unit), `governor-adversarial` (strobes, sweeps, noise and dissolves through the real meter on the grid, q156 and jitter clocks, each with a control that fails without the governor) and `governor-mutation` (ten one-line breakages, each killed) pin it.
**What is covered by construction and what is not.** By construction: L1, L2, C (cell and pixel grid, 1x views) and L3. Not by construction: R holds because the two-tone palette has no saturated red and the governor never invents a colour (a palette with red would need its own care). The x4 views of L1 and L2 (the same frames played four times as fast) are not governed and not asserted. The `i` key swaps the palette, not the cells the governor works on, and the app does reset the governor when it flips: the reset KEEPS the governor's history (every cell's last changes and the per-read ring) and counts the flip as one change of every cell, because the meter saw every cell move (the way back from another mode and from the console are reset the same way). It used to forget the history, and an `i` pressed in the middle of a dissolve then let the cells the dissolve was still moving change a third time inside the second: L2 failed for 0.3 to 0.57 s afterwards (48 of 240 of Desmond's runs, worst 33.93 %; `governor-flip` has the control). The flip FRAME itself is the flip guard's and is not covered (the guard bounds how often a flip happens): a palette swap changes the luminance of every cell at once (L3 reads about 95 % at it in every run), a cell with two changes just before it is hot at it, and no hold on the cells' indices can undo that; those cells stay hot until their oldest change is a second old, so the reads just after it can be over the limit too (in 288 runs the latest over-limit read was 0.22 s after the flip, and 8 of the 288 runs had one at all), and `governor-flip` judges the reads more than 0.25 s after the flip. The first paint after a size change (a terminal resize, the size card) is ungoverned and starts the history again, so it is the same kind of paint; a window dragged to a new size does that on every resize event (an ungoverned whole repaint each) and is NOT covered. fg and bg pass through the governor ungoverned, which is safe only because no high contrast scene has full-colour cells (`rgb: true`); `governor-playlist` fails the day one does. The help panel is governed like any other change, with no exemption: drawn over the scene it can ask for much of the screen in one paint, so it appears over several paints (the loop keeps painting while a cell is held, even with the clock stopped by pause or help). At 18 fps over Life it is whole after 1 paint at 80x24 and 3 at 40x10; over the tunnel, the busiest scene, after 12 paints (0.67 s) at 80x24, 11 (0.61 s) at 40x10 and 10 (0.56 s) at 120x40 (8 paints, 0.67 s, at 61x21 and 12 fps), and after 2 and 4 paints at 80x24 and 40x10 when the clock was paused first; `governor-app` pins the counts and that closing the panel leaves no stale cell. A panel painted whole would change 77 % of a 40x10 screen in one read (`governor-app-mutation` shows it).
**How often it engages, per scene** (`node tools/governor-wired.mjs`, not part of `npm test`; the whole 170 s cycle on the real app with the governor's paint reported, sizes 80x24, 120x40, 40x10 and 41x11, `--fps` 8, 12, 18, 26 and 30, grid and q156 clocks, 1x and 4x, 256 colours, seeds 1 and 2: 160 runs, 1600 scene rows). Per scene, over those runs: the share of paints in which any cell was held, the cells held per 100 cells the scenes changed, how long a held cell waited (p99 and longest, in paints and in seconds), and how far the painted screen differed from the composed one in the paints where anything changed (p99 and largest, in per cent of the screen):

| scene (dis:X is the dissolve out of X) | paints | paints with a held cell | cells held per 100 changed | longest waits (p99, max), paints | (p99, max), seconds | painted screen off the composed one (p99, max), % of the screen |
|---|---:|---:|---:|---|---|---|
| life | 120,488 | 0.21 % | 0.41 | 6, 6 | 0.25, 0.25 | 0.00, 10.80 |
| dis:life | 6,016 | 32.66 % | 10.08 | 13, 23 | 0.50, 0.77 | 4.00, 6.00 |
| tunnel | 90,224 | 17.47 % | 1.56 | 12, 25 | 0.45, 0.89 | 1.20, 4.20 |
| dis:tunnel | 6,016 | 67.20 % | 25.59 | 16, 27 | 0.61, 0.92 | 5.50, 7.30 |
| wire | 90,256 | 0.40 % | 0.14 | 7, 14 | 0.27, 0.50 | 1.10, 4.00 |
| dis:wire | 6,016 | 8.66 % | 2.22 | 11, 13 | 0.39, 0.44 | 3.50, 6.80 |
| maze | 90,240 | 1.82 % | 0.41 | 15, 23 | 0.50, 0.77 | 0.50, 1.80 |
| dis:maze | 6,016 | 9.19 % | 0.98 | 18, 20 | 0.61, 0.67 | 2.00, 3.30 |
| blocktype | 90,232 | 0.00 % | 0.00 | 0, 0 | 0.00, 0.00 | 0.00, 0.00 |
| dis:blocktype | 6,016 | 0.00 % | 0.00 | 0, 0 | 0.00, 0.00 | 0.00, 0.00 |

No cell ever waited a second (the longest wait read 0.923 s, in the dissolve out of the tunnel). Blocktype never engages; Life, wire and maze engage in under 2 % of paints and the tunnel in 17 %; what the governor mostly does is soften the dissolves, above all the one out of the tunnel (67 % of its paints hold a cell, and a quarter of the cells the composer changes there wait a few paints). The largest deviation of any paint in the 160 runs is 10.8 % of the screen, in Life.
**The per-frame cost** at 400x100 (40,000 cells), counted, not timed (`governor-cost` asserts the counts): a paint looks at every cell once (40,000 examined), changes at most the cap (10,000 cells, 25 %), and clears 4,097 histogram buckets for each priority sort (the counting sort that decides which cells wait), at most three sorts a paint (12,291 buckets) and none when every cell that wants to change may; a screen where 1 % of the cells change sorts at most once. The counting runs on a copy of `src/governor.js` with one counting statement, which is checked to paint exactly what the shipped file paints. Informational only, on this 32-thread machine, Node 22: a paint took a median of 1.3 ms when half the cells changed every paint (the slowest of 60 paints took 16 ms) and 0.4 ms when 1 % did.
**Why the cap is 25 % and not 30 %.** With the cap at the meter's own limit, the governor raised L3 toward it wherever a scene made it (the tunnel scene alone on the q156 clock at `--fps` 10, 1x, seeds 1 to 8, read L3 23.73 % at 41x11 and 24.50 % at 40x10 with no governor, 29.71 % and 29.50 % with the governor's cap at 30 % (commit 6784b33), one cell from the limit, and 24.61 % and 24.75 % with the cap at 25 %: `node tools/life-matrix.mjs --scene tunnel --clocks q156 --modes 256 --speeds 1x --sizes 41x11,40x10 --fps 10 --seeds 1,2,3,4,5,6,7,8 --summary-only`, with `--tree before13` for the first). No limit is loosened, and the cap is not a limit of the meter (L3 is still 30 %); it is a margin the governor keeps for itself. In the whole-cycle sweeps A and B the tree with the 30 % cap never came that close (worst L3 27.76 % and 27.64 %, no line within 1 point of 30 %), so the margin is insurance for the sizes and rates those sweeps did not draw, not a fix for a failure they found. It costs nothing at 12 fps and up (the per-scene table at 80x24, 40x10 and 41x11, 12, 18 and 26 fps, grid and q156, 1x and 4x, seeds 1 and 2 reads the same to the last digit at 30 % and at 25 %: the cap never binds there) and little at 8 to 10 fps (tunnel paints with a held cell 2.18 % to 2.28 %, the dissolve out of Life 18.75 % to 19.21 %, the largest deviation in that dissolve 3.1 % to 8.4 % of the screen, blocktype 0 % to 0.015 %), and it leaves L3 at 25.00 % at most over the 20,637 lines of sweeps A8, B, C, D and E on the shipped tree (0 lines within 1 point of 30 %); the same A and B axes on the tree with the cap at 30 % read up to 27.76 % with 0 of their 3,706 lines within 1 point of 30 % (sweeps A and B, `cap030` rows below).
**What is asserted** (each file's last numbers are in the files): `governor-app` (the governor wired in the real app: Desmond's twelve cases (nine fail on the tree before it, three sit exactly on the 25.00 % limit there) all pass with it, the help panel, pause, the size card, resizes, mode changes, the real-time clock, the spy tree that sees every governed paint and checks the bytes written are the same as the shipped app's), `governor-app-mutation` (ten wired one-line breakages, each killed), `governor-flip` (an `i` in the middle of a dissolve, 72 runs at 40x10, 41x11, 42x12 and 80x24, and the way back from another mode and from the console: the five rules judged on the reads more than 0.25 s after the event, with the governor that forgets its history on every reset as the control: it fails), `governor-engage` (counted engagement per scene at three sizes and three rates, held to the baseline in `tests/fixtures/governor-engagement.json` plus 25 % and half a point, blocktype exactly 0; a tunnel made twice as fast fails it), `governor-playlist` (no high contrast scene has `rgb: true`), `governor-sweep` (87 whole-cycle runs on the real app, every frame metered: the 12 cases Desmond found plus the three 25.00 % edges, 68 grid cases rotated so that each of 17 sizes (40x10, 41x10, 42x10, 40x11, 41x11, 42x11, 40x12, 41x12, 42x12, 43x12, 45x12, 46x12, 50x16, 80x24, 120x40, 78x24, 88x39) meets four of the nine frame rates (8, 9, 12, 18, 21, 24, 26, 27, 30), four of the five speeds (1x, 1.5x, 2x, 3x, 4x), both colour modes and four of the eight seeds, and seven q156 and jitter arms; 9 of the 87 fail on the tree before the governor, all of them Desmond's, and none of the other 78), `tunnel-cycle-edge` (the two places the cycle passed AT the limit before the governor, 40x10 at `--fps` 30 seed 7 and at `--fps` 24 seed 8: L2 exactly 25.00 % on the tree before it, as the control, and 10.71 % and 8.93 % with it), `governor-cost` (the counts above) and `tools-contrast-matrix` (the matrix tool below). `render-hash` moved on four cases, all of them Classic high contrast at 41x11 (contrast and contrast-inverted, 256 colours and truecolor): one cell is held for one paint at paint 18 of the 10 s run; the other 392 of its 396 cases are byte for byte as before DRIFT-13, and the pin was regenerated for those four only.
**The matrix tool and what it ran.** `node tools/contrast-matrix.mjs` is the reviewer's version (not part of `npm test`; `tools-contrast-matrix` pins it): the whole Classic high contrast cycle (170 s, every frame metered) on the real app, the five rules at their limits, over `--sizes` (`40-50x10-16` is all 77 pairs; `breakpoints` adds 78x24, 80x24, 88x39 and 120x40), `--fps 8-30`, `--speeds 1x,1.5x,2x,3x,4x` (real `+` presses), `--clocks grid,q156,jitter`, `--modes 256,truecolor`, `--seeds 1-8`, on `--tree after` (this tree), `before13` (this tree with only the governor taken out), `oldscenes` (the governor on but the scene fixes of DRIFT-10 to 12 taken out) or a directory; `--sample N` draws a seeded, stratified sample (every size, rate, speed and clock is met; with N at least sizes x rates, every (size, rate) pair at least N / pairs times); `--jobs K` runs K worker processes; `--out` and `--resume` keep a results file an interrupted run can continue; the summary prints the lines run, the lines failing, the worst of each rule and the failing lines, and always the FULL-FACTORIAL count of the axes given next to the lines actually run. The full cross is 81 sizes x 23 rates x 5 speeds x 3 clocks x 2 modes x 8 seeds = 447,120 lines (425,040 on the 77 sizes 40x10 to 50x16 alone): at the measured 11.3 lines a second on four jobs that is about 11 hours on four jobs, so it was not run, and none of the claims below is about the whole cross. What ran (from a `git archive` export of the tree, four jobs; the numbers are `tests/fixtures/governor-sweeps.json`, which `governor-docs` checks this README against):

| sweep | tree | lines run, of the full factorial of its axes | lines failing | worst L1 | worst L2 | worst L3 | worst R | worst C | lines with L3 within 1 point of 30 % |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| A | after | 2,464 of 2,464 | 0 | 0.00 | 16.67 | 25.00 | 0.00 | 0.00 | 0 |
| A | before13 | 2,464 of 2,464 | 8 | 0.00 | 32.14 | 29.83 | 0.00 | 0.00 | 1 |
| A | oldscenes | 2,464 of 2,464 | 0 | 25.00 | 25.00 | 25.00 | 0.00 | 0.00 | 0 |
| A | cap030 | 2,464 of 2,464 | 0 | 0.00 | 16.67 | 27.76 | 0.00 | 0.00 | 0 |
| A8 | after | 9,856 of 9,856 | 0 | 0.00 | 16.67 | 25.00 | 0.00 | 0.00 | 0 |
| A8 | before13 | 9,856 of 9,856 | 14 | 0.00 | 32.14 | 29.83 | 0.00 | 0.00 | 6 |
| B | after | 1,242 of 49,680 | 0 | 0.00 | 15.69 | 24.59 | 0.00 | 0.00 | 0 |
| B | before13 | 1,242 of 49,680 | 3 | 0.00 | 28.57 | 27.64 | 0.00 | 0.00 | 0 |
| B | oldscenes | 1,242 of 49,680 | 0 | 25.00 | 25.00 | 25.00 | 0.00 | 0.00 | 0 |
| B | cap030 | 1,242 of 49,680 | 0 | 0.00 | 15.69 | 27.64 | 0.00 | 0.00 | 0 |
| C | after | 176 of 176 | 0 | 0.00 | 14.29 | 24.80 | 0.00 | 0.00 | 0 |
| C | before13 | 176 of 176 | 16 | 0.00 | 28.57 | 30.28 | 0.00 | 0.00 | 2 |
| D | after | 9,315 of 447,120 | 0 | 0.00 | 16.67 | 24.95 | 0.00 | 0.00 | 0 |
| D | before13 | 9,315 of 447,120 | 7 | 0.00 | 28.57 | 27.55 | 0.00 | 0.00 | 0 |
| E | after | 48 of 48 | 0 | 0.00 | 5.00 | 14.53 | 0.00 | 0.00 | 0 |
| E | before13 | 48 of 48 | 0 | 0.00 | 7.46 | 14.53 | 0.00 | 0.00 | 0 |
The axes: A: all 77 sizes 40x10 to 50x16, `--fps` 9, 12, 18, 21, 24, 26, 27 and 30, grid and q156, 1x, 256 colours, seeds 1 and 6. A8: sweep A with all eight seeds. B: sizes 40x10, 41x12, 42x12, 45x12, 50x16, 80x24, 120x40, 78x24 and 88x39, every `--fps` from 8 to 30, grid, q156 and jitter, 1x, 1.5x, 2x, 3x and 4x, 256 colours and truecolor, seeds 1 to 8: a stratified sample of 1,242 (`--sample 1242`: every one of the 207 (size, rate) pairs six times). C: Desmond's eleven size, rate, clock and speed combinations (twelve cases: one of them is run in both colour modes), both colour modes, seeds 1 to 8. D: all 81 sizes (the 77 and 78x24, 80x24, 88x39, 120x40), every `--fps` from 8 to 30, 1x, 1.5x, 2x, 3x and 4x, grid, q156 and jitter, 256 colours and truecolor, seeds 1 to 8: a stratified sample of 9,315 (`--sample 9315 --sample-seed 2`: every one of the 1,863 (size, rate) pairs five times). E: sizes 176x58 and 240x67, `--fps` 8, 18 and 30, 1x and 4x, grid and q156, 256 colours, seeds 1 and 2. The `after` rows are this tree, `before13` the same tree with only the governor taken out, `oldscenes` the governor on with the scene fixes of DRIFT-10 to 12 taken out, and `cap030` the tree as it was before the per-read cap became 25 % (the cap at the meter's own 30 %), run on sweeps A and B only.
**Desmond Hale's cases** (found by hand after DRIFT-12 and written down then as measured, not asserted; sweep C above is all of them, eight seeds and both colour modes each, on the tree before the governor and on this one):

| Desmond's combination (whole cycle, 256 colours and truecolor, seeds 1 to 8) | before13: lines failing, worst L2 / L3 | after: lines failing, worst L2 / L3 |
|---|---|---|
| 42x12, grid, 1x, --fps 26 | 2 of 16, 26.79 / 14.48 | 0 of 16, 12.50 / 14.48 |
| 42x12, grid, 1x, --fps 27 | 2 of 16, 28.57 / 14.29 | 0 of 16, 12.50 / 14.29 |
| 45x12, q156, 1x, --fps 21 | 2 of 16, 26.67 / 14.63 | 0 of 16, 11.67 / 14.63 |
| 45x12, q156, 4x, --fps 21 | 2 of 16, 26.67 / 15.37 | 0 of 16, 11.67 / 14.63 |
| 41x12, q156, 2x, --fps 9 | 2 of 16, 14.29 / 30.28 | 0 of 16, 12.50 / 24.80 |
| 42x12, q156, 1.5x, --fps 21 | 2 of 16, 26.79 / 14.29 | 0 of 16, 14.29 / 14.29 |
| 42x12, grid, 1.5x, --fps 23 | 2 of 16, 26.79 / 14.09 | 0 of 16, 12.50 / 14.09 |
| 42x12, grid, 1.5x, --fps 25 | 2 of 16, 26.79 / 11.11 | 0 of 16, 12.50 / 11.11 |
| 42x12, grid, 1x, --fps 24 | 0 of 16, 25.00 / 14.29 | 0 of 16, 12.50 / 14.29 |
| 40x10, grid, 1x, --fps 30 | 0 of 16, 25.00 / 9.00 | 0 of 16, 12.50 / 14.50 |
| 40x10, grid, 4x, --fps 24 | 0 of 16, 25.00 / 15.00 | 0 of 16, 12.50 / 15.00 |

The 42x12 grid readings at 1x pre-date DRIFT-12 (they read the same on the tree before it), and the L2 failures are in one dissolve, the wire into the maze at about 95 s on seed 6 (both as DRIFT-12 recorded them, not re-derived here). The three combinations that read exactly 25.00 % before (the limit itself: 14 of 56 cells, so no margin) read 12.50 % now. The 14 failing lines of sweep A8 on the tree before the governor (all L2) include three of Desmond's and eleven he had not named (for example 42x12 at `--fps` 30, 43x10 at `--fps` 26 and 30 on q156 with seed 8, 45x15 at `--fps` 27 and 30 with seed 5); none of them fails on this tree.
**A finding: the per-scene fixes of DRIFT-10 to 12 are now redundant for pass or fail of the five rules, and they stay.** With the governor on and those fixes taken out (`--tree oldscenes`: the old Life, wire, blocktype and tunnel, the old cross-fade and composer), sweep A ran 2,464 lines with 0 failing (worst L1 25.00, L2 25.00, L3 25.00) and sweep B 1,242 lines with 0 failing (worst L1 25.00, L2 25.00, L3 25.00), so at those axes the governor alone holds the five rules. They are not redundant for margin or for the look: the old scenes sit ON the limits there (L2 within 1 point of its limit of 25 % on 1,359 of the 2,464 lines of sweep A and 732 of the 1,242 of sweep B, and L1 on 4 and 60, worst L1 and L2 exactly 25.00; the shipped scenes read none within 1 point of any limit in either sweep, worst L1 0.00 and L2 16.67), so the governor is the last line, and the scene fixes are what keep a viewer's pictures well inside it, the governor only holds what a scene asks for (a strobing scene is held to the limit, not made calm), and the pictures the fixes made (a Life that shimmers, a wire that holds still between beats, a tunnel on the real-time clock) are what the viewer sees and why the governor engages as little as the table above shows. At 80x24, 4x, seeds 1 and 2 on the grid clock, `tools-contrast-matrix` pins the three trees side by side: no governor and the old scenes (`--tree before12`) L2 100.00 % and L3 31.15 % (fails), the governor and the old scenes L1 24.07 %, L2 25.00 %, L3 25.00 % (passes, on the limits), the shipped tree L2 7.87 % and L3 13.44 %. Nothing was removed.
**Still not covered after DRIFT-13:** seeds above 8; scene lengths other than 30 s of scene time (the shipped 180 s is not run through the matrix: the governor does not read scene time, but this is a statement about the code, not a measurement); boards below 40x10 (the size card); frame rates outside 8 to 30; calm, chaos and experimental (the governor is not built there); the x4 views of L1 and L2; speeds 0.25x, 0.5x and 0.75x of the whole cycle; the `i` key's own flip frame and the 0.25 s after it (the flip guard); a window dragged to a new size (an ungoverned whole repaint per resize event); high contrast scenes with full-colour cells (there are none); sizes above 120x40 other than 176x58 and 240x67 (sweep E: 48 lines); and every (size, rate, speed, clock, mode, seed) cell of the cross that was not drawn. The whole cycle's wall-clock behaviour on a real terminal was not seen (every run is on a fake terminal and a fake clock that fires as the Windows tick or a jittered timer would).
At real 4x (the `+` key pressed four times from 1 s into the run; scene length 30 s; seeds 1 and 2; 256 colours and truecolor; the three clocks), measured by Rosa Delgado (test engineer) and not asserted, contrast reads L2 100 % (before DRIFT-10, and it does not say which scene; the Life scene alone passed at 4x after DRIFT-10 and wire and blocktype pass at 2x and 4x since DRIFT-11, see above; tunnel at 4x and the whole cycle at 4x failed L2 and L3 until DRIFT-12 and are asserted passing since at the listed sizes and rates, see the section above), chaos reads R 80.6 to 81.9 % on an 18 Hz viewer, and calm stays clean (worst L2 0.46 %, L1 0 %, R 0 %).
Night Drive is judged by its own step rules (`tests/night-drive-flash.test.js`: strictly under 30 % of the cells a step, one shade step per frame, at most 25 % bright solid blocks); metered with the five rules on the whole tape at 80x24 (a field of 27x8 = 216 cells, so the limit is 54 cells), independently re-measured by Rosa Delgado (test engineer) with scripts that live outside the repo, in `C:\Users\graem\AppData\Local\Temp\drift9-rosa` (so the figures are not reproducible from the repo alone), it passes every rule at 1x (worst R 16.67 %, L1 7.41 %, L2 12.96 %; a 725 s run) and reads over the limit at real 4x (the `+` key pressed four times; a 200 s run; 256 colours and truecolor read alike; `--fps` 30 and 18; the three clocks; seeds 1 to 4): L1 25.46 % at 124.1 s (seed 1, exact grid), 55 of 216 cells against 54; L2 up to 25.93 % at 146.4 s (seed 2, exact grid), 56 of 216 cells; and R 25.93 to 26.39 % at an 18 Hz viewer on the grid and jitter clocks and 28.24 % at worst with a 30 Hz viewer at `--fps` 30.
Neither is fixed and none of these readings is asserted.
The Driftman 9000, its console and panels, and the shelf are the cartridges the five rules are asserted on.

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
node tools/measure.mjs --seconds 60 --cols 240 --rows 67 [--scene mix|squiggle|sunburst|plasma|ripples|rain|glyphrain|swarm|glitch|fireworks|vortex|life|tunnel|wire|maze|blocktype|bounce|sand|waves|pendulum|cloth|artist|all]
node tools/measure.mjs --library [--cycle N]                      # the cartridge library; N = press right arrow every N seconds
node tools/measure.mjs --cartridge ID [--program P] [--scene S]   # a running cartridge (boot skipped, sampling starts once it runs); prints RESULT load_ms=
node tools/measure.mjs --cartridge all                            # one fresh process per unlocked cartridge scene
```

**Is my terminal keeping up? `tools/tty-probe.mjs`.** Run `node tools/tty-probe.mjs` in the terminal you watch drift on, at the size you run it at (`--seconds 20`, `--fps 18`;
`--cols` and `--rows` override the size). It is not a scene: it enters the alternate screen and raw mode as the app does and writes frames in which EVERY cell changes every
frame (truecolor foreground and background, a different glyph), inside the synchronised-output markers, about 700 KB a frame at 280x70, far more than any scene sends. Like the
app it drops a tick's frame while the stream still says it needs to drain. Once a second it logs the bytes written, how many `write()` calls returned false, how many ticks the
stream still needed to drain, the largest queue and the event-loop delay (p50, p99, max); the lines are printed after the terminal is restored. Press `q` at any moment (or wait
for the end): the time from the key to the moment the restore write is confirmed is `quitMs`. Then it writes 5 frames back to back without waiting and quits again:
`flood5 quitMs` is how long a `q` takes with that much picture queued ahead of it, and `restored=no` means the restore was not confirmed in 15 s. It restores the terminal on
every way out (q, the end of the run, Ctrl+C, SIGTERM, SIGHUP, an uncaught error). Send back the six `PROBE` lines at the end.

The same capture command also writes the mode captures (`<mode>-<scene>-1/-2.txt`, `help-<mode>.txt`,
`dissolve-<mode>.txt`), the artist's gallery and the cartridge console (all plain text, one frame per file):
`cart-library-<id>-120x40.txt` and `-80x24.txt` for every install cartridge (locked ones included),
`cart-library-240x67.txt` and `cart-library-list-60x14.txt` (Classic selected), `cart-insert-<id>-t<ms>.txt` /
`cart-boot-<id>-t<ms>.txt` at 0.4, 0.9, 1.25, 1.6, 2.5, 3.4, 4.2, 5.0 and 5.6 s after Enter (insert before 1.5 s,
boot after; the 80x24 ones carry a `-80x24` before the time), `cart-eject-<id>-t<ms>.txt` (<ms> after `e`, counted from the start of the 0.3 s fade to blank) for a cartridge that runs
in the shell, and `cart-help-classic-120x40.txt` (the help panel while Classic runs). Only the install folder is
captured, so the files do not depend on what is in your user cartridge folder. `node tools/capture.mjs --cartridges`
writes only these.

Delza adds a set of its own, all named `cart-delza-*.txt`: `library-240x67`; `journal-120x40` and `-80x24`; `help-120x40`
and `-80x24` (her own help words); `boot-hint-t3400` (the one boot that shows the first-insert hint `e ejects · h shows the keys`;
every other insert and boot file shows the plain bar); `scene-<id>-t2`, `-t20` and `-t40` for each of the six scenes (seconds of
scene time, reached by choosing the chapter in the Journal); `fight-t<ms>` (five moments of the Cinderhorn's third turn, from the
cursor walking to the stag's charge landing); and `cutscene-t<ms>` (four text states of the Lampwarden). Her eject files are the
usual `cart-eject-delza-...`. A test fails if the folder holds a `cart-*` file the tool no longer writes.

Night Drive adds `cart-night-drive-*.txt`: `scene-<id>-t<s>` for each of its eight tracks (`-80x24` before the time for the compact
console) at 2, 20 and 40 s of scene time (the diner and the on-ramp at 2, 21 and 40), chosen from the tape deck, plus the later moments
where the story moves (sundown 75 s, redlight 9, 11, 61 and 62 s, diner 25 s mid flicker dip, caller 29 s and 70 s, overdrive 64 s); `menu-120x40` and
`-80x24` (the tape deck open over the playing track, the `*` on it and the cursor on the next); `help-120x40` and `-80x24` (the
reskinned help panel); and `console-120x40` and `-80x24` (the console takeover as the tape boots, the only time it is on screen).
Seventy-two files in all, on top of the generic library, insert, boot and eject files it already had.

The Driftman 9000 adds ten text files, `cart-driftman-9000-*.txt`: `menu-120x40` (three tiles, the prompt row and the countdown over the running Rosette) and `menu-80x24` (the list),
`help-120x40` and `-80x24` (its reskinned help box over the Rosette), and `morph-t1000` to `morph-t1500` (the 2000 turning into the 9000, every 0.1 s from 1.0 to 1.5 s after Enter, 120x40).
Its generic insert, boot and eject files are the usual ones. The full capture command prints `wrote 24 calm files, 39 mode files, 19 gallery files and 220 cartridge files`, and
`git status` shows nothing changed after it.

```
node tools/capture-ansi.mjs [--out captures-ansi]     # 32 full-frame truecolor .ansi files of the Driftman 9000 (944,472 bytes), about 5 s
```

Each file in `captures-ansi/` is one frame of the real app, taken with the same drivers as the text captures above and written by the app's own renderer (a fresh
`createRenderer().render(app.screenshot())`, which is what the app writes the first time it paints that frame: clear the screen, then every cell addressed with its 24-bit colours),
plus a tail that resets the colours and puts the cursor on the last row. The renderer never draws the bottom-right cell, so that one cell is blank in every file. They are tracked
in git (`captures-ansi/*.ansi -text`), unlike the git-ignored `captures/*.ansi`. The name carries the size; view one in a truecolor terminal at least that big (it clears the screen and
addresses cells, so a smaller window will scroll):

```
cat captures-ansi/menu-grid-120x40.ansi                                      # Git Bash, WSL, macOS, Linux; then `clear`
type captures-ansi\menu-grid-120x40.ansi                                     # cmd.exe in Windows Terminal, after `chcp 65001`; then `cls`
Get-Content -Raw -Encoding utf8 captures-ansi\menu-grid-120x40.ansi | Write-Host -NoNewline      # PowerShell
```

The 32 files: `library-driftman-9000-selected-120x40`, `label-24x10` (its label cut from that frame, foil and all), `insert-t400`, `-t900`, `-t1250`, `morph-insert-t1000` to `-t1500`,
`morph-boot-t1700` and `-t1800`, `morph-rest-t2000` (all 120x40), `boot-t2500`, `-t4200`, `-t5600` (120x40), `console-rest-120x40` and `-80x24`, `menu-grid-120x40`, `menu-list-80x24`,
`help-120x40`, `help-80x24`, `rosette`, `cortex` and `bloomfall` at `-120x40` and `-80x24` (20 s into each), and `eject-t727`, `-t1260`, `-t1633` (120x40). Twenty-three of them have a
text capture of the same frame in `captures/`, and a test checks the glyphs agree. `tests/capture-ansi.test.js` also rebuilds every file's screen with an independent reader (it knows
nothing of the renderer) and compares every cell's glyph, foreground and background with the frame the renderer was given; and checks that two runs are byte-identical.

`captures/*.ansi` are git-ignored (large) except the calm scenes' and the crossfade's; regenerate with the
capture command and view with `type captures\sunburst-120x40.ansi` in a truecolor terminal.

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
the run mean. A still library draws one frame and then nothing (an empty 18 Hz Node timer already
reads about 0.3% of a core here), so 10 second library runs mostly show that floor and the one-off
first paint; use a longer run for a tighter number.

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
