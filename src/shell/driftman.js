// The Driftman 2000 console's own skin. Same schema as a cartridge skin.json (validateSkin accepts
// it, and a test checks that), so the library, the insert animation, the console boot and the
// console help all draw through the same code as a cartridge.
//
// Palette (the designer's library colours, DRIFT-4-3 section 9): the hue is silver #c8ccd4 at 16 levels
// (entries 0-15), then 16 amber #ffb000 (LED, accent), 17 cyan #39d0ff (LINK LED), 18 graphite #5d6474
// (shells, grille, console frame; not for text), 19 dim #8b93a1 (hints, plates; 6.3:1 on the background).
// The background #0a0c10 is near black, as every skin's must be. 20 entries; each cartridge adds 4.
export const DRIFTMAN_COLOURS = Object.freeze({
  amber: 16, cyan: 17, housing: 18, dim: 19,
  dark: 3, // silver level 3: darker than graphite, for the empty slot mouth
});

// The boot text is the console's voice. boot.lines of the console skin are the CORE lines every cartridge starts
// with; the boot draws core lines first and then the cartridge's own skin.boot.lines (bootLines in boot.js).
// Text after a run of three or more dots and a space ('OK') is drawn in the accent colour.
export const CORE_BOOT_LINES = Object.freeze(['DRIFTMAN 2000 · CORE 2.0', 'MEMORY 64K ..... OK']);

export const driftmanSkin = Object.freeze({
  palette: {
    hue: '#C8CCD4',
    colours: ['#FFB000', '#39D0FF', '#5D6474', '#8B93A1'],
    bg: '#0A0C10',
    ui: { text: 15, dim: 19, head: 15, accent: 16 },
  },
  frame: { show: 'always', glyphs: '┌─┐│┘─└│', title: 'DRIFTMAN 2000', colour: 18 },
  menu: { layout: 'list', anchor: 'center', cursor: '▶', title: 'DRIFTMAN 2000', box: '┌─┐│┘─└│' },
  help: { title: 'DRIFTMAN 2000  keys', box: '╔═╗║╝═╚║' },
  boot: { lines: CORE_BOOT_LINES.slice(), art: false, seconds: 0.5 },
  insert: { text: 'Inserting cartridge' },
  wording: { menuHint: 'Up and down choose, Enter selects, Esc closes' },
});

// What the Classic cartridge boots with: the console's own skin and its three lines after the core ones. Five lines
// at 0.25 s each: boot.seconds is the time the lines take to type.
export const classicBootSkin = Object.freeze({
  ...driftmanSkin,
  boot: { lines: ['CARTRIDGE ...... DRIFT CLASSIC', 'SIGNAL ......... CALM', 'Nothing to do. Watch it drift.'], art: false, seconds: 1.25 },
});

// What a cartridge with no skin boots with: the console's skin and one line naming the cartridge. No boot.seconds,
// so the timeline is the normal 5.8 s.
export function plainBootSkin(title) {
  return Object.freeze({ ...driftmanSkin, boot: { lines: cartridgeLines(title), art: false } });
}

// The line that names a cartridge in the boot text (none without a title); 40 characters at most.
export function cartridgeLines(title) {
  const name = [...String(title || '').toUpperCase()].slice(0, 22).join('');
  return name ? [`CARTRIDGE ...... ${name}`] : [];
}
