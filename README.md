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
| `--fps N` | `DRIFT_FPS` | 18 | frames per second (1-30) |
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
R-pentomino, acorn, pulsar and friends, half-block pixels; reseeds when it dies or stalls),
**tunnel** (a slowly turning checkerboard tunnel from half and full blocks; no shade blocks,
which would read as a third tone), **wire** (a rotating wireframe cube then torus in braille
dots), **maze** (a seeded maze carved live with box-drawing walls, solved in solid blocks,
held, wiped and regenerated) and **blocktype** (big block capitals spelling short words, with
a wipe, scroll or wave between them); experimental (the calm single-hue palette, 16 brightness levels, physics sims stepped at a
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
| running | `e`, `l` | eject: the insert animation plays backwards and you are back in the library (Classic has no `e`; it has only the `l` that opens the library) |
| running | space | next scene in the current program |
| running | `p` | pause or resume |
| running | `+` (or `=`) / `-` (or `_`) | faster / slower |
| running | `c` | next season, if the skin has `seasons`: the palette hue eases to the next one |
| every screen | `q`, Ctrl+C | quit (Ctrl+C exits 130); the terminal is restored exactly |

Insert, boot and the error card take any key except `q` as "skip". The timeline is: insert
animation 1.5 s (the cartridge lifts, the neighbours slide away, it drops into the slot, the
console takes on the cartridge's skin behind a 6-column band), then the boot, drawn on the
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
DM-03 Arcade and DM-04 Last Fantasy; a card only appears when its folder exists. Delza (DM-01) and Night Drive (DM-02) are installed and playable, so the shelf is Classic, Arcade, Delza, Last Fantasy and Night Drive (the loader sorts the folders by name, Classic first); Arcade and Last Fantasy are still coming-soon cards. Any
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

**Manifest** (`manifest.json`; `format` greater than 1 gives "needs a newer Drift"):

| field | required | meaning |
|---|---|---|
| `format` | yes | `1` |
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
| `scenes` | yes (1 to 16) | list of `{ id, kind, title?, ref? }`. `id` follows the id rule; `kind` is `cells`, `sim`, `field` (code, install only), `text` (a `scenes/<id>.txt` file) or `builtin`; `title` up to 30 characters; `ref` (builtin only) names a Classic **calm** or **experimental** scene, such as `sand` or `plasma` |
| `programs` | yes (1 to 8) | list of `{ id, title?, transition, scenes, sceneSeconds?, seconds?, fadeSeconds? }`: `transition` is `dissolve` or `crossfade`; `scenes` lists scene ids (1 to 16); `sceneSeconds` 20 to 3600 (default 180); `seconds` (optional) is an object keyed by scene id that gives single scenes their own time, 20 to 3600 each (a key must be a scene in this program; scenes not named use `sceneSeconds`); `fadeSeconds` 5 to 60 (default 15, crossfade only, and shorter than the shortest scene time: `sceneSeconds` or any `seconds` entry). A `crossfade` program holds only `field` scenes and calm builtins; a `dissolve` program holds `cells`, `sim`, `text` and experimental builtins |
| `start` | yes | the id of the program that plays first |
| `menu` | no (1 to 10) | list of entries: `{ label, program, scene?, note?, desc? }` or `{ label, action: "eject", note? }`. `label` up to 24 characters. `scene` (only with `program`) is a scene id in that program: choosing the entry starts the program at that scene, and a scene entry is marked as playing only while that scene plays (choosing the scene that is already playing, or the playing program with no `scene`, changes nothing). `note` up to 16 characters is a short tag at the right of the entry (in the list the box widens to hold it; in the slots layout it sits on the label row; in the grid it is a row under the label; it is left out when there is no room for it as well as the whole label). `desc` up to 76 characters is shown, wrapped to two lines above the hint, for the highlighted entry in the `list` layout (left out when the window is too short, before the title); in the `slots` layout it is the second row of the entry's card, and an entry that names a chapter falls back to the chapter's `line` when it has no `desc`. Without a `menu` the menu is one entry per program plus Eject |
| `chapters` | no (1 to 16) | list of `{ id, numeral, place, line, icon, minutes }` for cartridges that present their scenes as chapters: `id` is a scene id (each at most once), `numeral` up to 8 characters, `place` up to 30, `line` up to 64, `icon` two pieces of text of at most 5 characters each, `minutes` a whole number 1 to 999. The `slots` menu draws it: a menu entry whose `scene` has a chapter shows the chapter's icon (two rows), numeral and place on its card, and the chapter's line when the entry has no `desc` (see the menu layouts below) |

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

### Night Drive, the second real cartridge (in progress)

Night Drive (DM-02) is an 80s neon highway: the Vantra Halcyon, a low coupe with the plate NITE86, driving out of the made-up Port Solace
on Shoreline 9, with late-night radio on 88.1 Moonlow FM. Everything in it is original. It is built as one tape of eight tracks (sides A
and B, 90 s each, about 12 minutes), added a few at a time; today the tape holds track A1, `onramp` Midnight On-Ramp, track A3, `sundown` Sundown Grid, track B1, `redlight` Red Light, Rain, and track B4, `overdrive` Overdrive. The skin gives it a
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
light in the rain, with a traffic light blurred by the rain into a bokeh, a pedestrian crossing under an umbrella, drops landing about seven a second (3 in 10
send a trickle down) and one wiper that sweeps for 1.2 s every 4.2 s and clears the drops it crosses. At 58 s the red ramps down and the green ramps up over a
second, never cutting from one to the other; from 62 s the far buildings slide a column every 0.2 s. Under 100 columns or 32 rows it drops the mirror, shrinks the
bokeh to 9x5 and keeps a two-row dashboard. Its drops, wiper, bokeh and dashboard are in `lib/rain.js`, `lib/bokeh.js` and `lib/dash.js`.
Overdrive is the busy one, also a simulation: A1's road at double pace while a far-silhouette tunnel mouth grows out of the vanishing point (0 to 15 s), then nested rings of
light in perspective with a ceiling light on each, tail lights running away and headlights coming toward us, each with a trail of 4 to 10 cells fading to nothing (15 to 60 s),
then the far end opens and the city is revealed inside it by a dissolve from the centre outward (60 to 62 s), and an elevated freeway with the skyline on both sides, a trail
about every 2 s and the pace easing back to A1's (66 to 90 s). How many cells change in a frame is a function of the step count and of the window size, never of what the last
frame did: rings move on ring slots (at most 2 in any 8 steps at full size, 1 at 80x24 and below), only the rings whose redraw is small enough for the window move at all (the big
ones near the frame stand still), and new trails are born only on spawn slots. The worst frame changes about 13% of the cells or less at every size, at 1x and 4x. Under 100 columns or 32 rows (80x24) it keeps 4
rings, 6 trails and the 20x4 car; under 60x18, 2 rings and 3 trails. Its skyline is in `lib/skyline.js`.
`tests/night-drive-*.test.js` check the skin, palette, label, boot art, manifest, help panel and the scene's promises on rendered frames.

`node bin\drift.js --cartridge night-drive` goes straight in.

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
bin/drift.js      entry   bin/drift.cmd  shim  tools/          capture.mjs measure.mjs calm.mjs
src/cartridge/    schema.js (ids, limits, validators)  loader.js (discover + load)  textscene.js  palette.js
src/shell/        the console: shell.js (screen machine)  runtime.js (a running cartridge)  library.js insert.js
                  boot.js menu.js chrome.js ui.js (pure draw functions)  driftman.js (the console's own skin)
cartridges/       the install cartridges: classic, delza and night-drive (manifest, skin, label, scenes/, lib/; night-drive also boot.txt) and the locked ones (label.txt + manifest.json each)
```

Non-calm scene contract (`src/cells.js`): `kind: 'cells'` scenes are `scene(t, w, h, params)`
filling `params.glyphs` (Uint16Array code points) and `params.colours` (Uint8Array palette
indexes), pure in `t`; `kind: 'sim'` scenes are `{init(w,h,seed), step(state) at 1/30 s,
draw(state, params)}` (same seed + same step count = same frame). The cell composer steps
sims from an accumulator, at most 8 steps per frame (enough for 4x speed at 18 fps; a stall
cannot snowball). A cells scene also gets `params.t0`, the clock when it became active.

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

The suite is 1280 tests in `tests/*.test.js` and takes 45 to 80 seconds depending on the machine (test files run in parallel; the real-process arms start the real program and wait in real time, about 28 s of that). The cartridge work is
covered by `cartridge-schema` (validators, text scene, skin palette), `cartridge-loader`
(every way a cartridge can be wrong, and both arms of the trust rule), `cartridge-scenes` (every
install cartridge's scenes through the size, glyph, colour, determinism and flash checks, with controls
that must fail), `cartridges` (glyph and import scans over `cartridges/`), `config-extras`, `shell-app`
(the console at app level on a fake clock), `shell-draw` and `shell-flash` (every screen at every size,
and the photosensitivity checks), `tools-cartridges` (the cartridge captures and `measure.mjs` options),
`readme-cartridge` (the example in this README), `shell-journal` (the Journal menu's engine pieces: chapter cards, the prompt line, the start-by-itself countdown, the frame ornament), `delza-cartridge`, `delza-thornwell`, `delza-tallow`, `delza-cinderhorn`, `delza-reach`, `delza-highcandle` and `delza-lampwarden` (Delza's manifest, skin, Journal, help, boot, seasons and what each scene promises, read off rendered frames), `night-drive-cartridge`, `night-drive-onramp`, `night-drive-sundown`, `night-drive-redlight`, `night-drive-overdrive` and `night-drive-flash` (Night Drive's skin, palette, label, boot art, manifest, help panel, the road, sprites and calm bounds of its first track, the sun, grid, loop and calm bounds of Sundown Grid, the purity, light change, wiper, rain, buildings and calm bounds of Red Light, Rain, and the ring schedule, light trails, phases, exit dissolve and changed-cell bounds of Overdrive), and the cartridge arms of `real-process` (below).

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

The same capture command also writes the mode captures (`<mode>-<scene>-1/-2.txt`, `help-<mode>.txt`,
`dissolve-<mode>.txt`), the artist's gallery and the cartridge console (all plain text, one frame per file):
`cart-library-<id>-120x40.txt` and `-80x24.txt` for every install cartridge (locked ones included),
`cart-library-240x67.txt` and `cart-library-list-60x14.txt` (Classic selected), `cart-insert-<id>-t<ms>.txt` /
`cart-boot-<id>-t<ms>.txt` at 0.4, 0.9, 1.25, 1.6, 2.5, 3.4, 4.2, 5.0 and 5.6 s after Enter (insert before 1.5 s,
boot after; the 80x24 ones carry a `-80x24` before the time), `cart-eject-<id>-t<ms>.txt` for a cartridge that runs
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
where the story moves (sundown 75 s, redlight 62 s, diner 25 s mid flicker dip, caller 29 s and 70 s, overdrive 64 s); `menu-120x40` and
`-80x24` (the tape deck open over the playing track, the `*` on it and the cursor on the next); `help-120x40` and `-80x24` (the
reskinned help panel); and `console-120x40` and `-80x24` (the console takeover as the tape boots, the only time it is on screen).
Sixty-six files in all, on top of the generic library, insert, boot and eject files it already had.

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
