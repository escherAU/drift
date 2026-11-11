// The Driftman 2000 console's own skin. Same schema as a cartridge skin.json (validateSkin accepts
// it, and a test checks that), so the library, the insert animation, the console boot and the
// console help all draw through the same code as a cartridge.
//
// Palette: 0-15 the hue at 16 levels, then 16 amber (LED, accent), 17 red (error), 18 housing grey,
// 19 dark housing. The background is near black, as every skin's must be.
export const DRIFTMAN_COLOURS = Object.freeze({ amber: 16, red: 17, housing: 18, dark: 19 });

export const driftmanSkin = Object.freeze({
  palette: {
    hue: '#9DB8A8',
    colours: ['#FFB000', '#E8553A', '#56655C', '#2A332E'],
    bg: '#080C0A',
    ui: { text: 13, dim: 7, head: 15, accent: 16 },
  },
  frame: { show: 'always', glyphs: '┌─┐│┘─└│', title: 'DRIFTMAN 2000', colour: 18 },
  menu: { layout: 'list', anchor: 'center', cursor: '▶', title: 'DRIFTMAN 2000', box: '┌─┐│┘─└│' },
  help: { title: 'DRIFTMAN 2000  keys', box: '╔═╗║╝═╚║' },
  boot: { lines: ['DRIFTMAN 2000 BIOS 1.0', 'Reading cartridge ...', 'Checking memory ... ok', 'Loading scenes ...'], art: false, seconds: 1.5 },
  insert: { text: 'Inserting cartridge' },
  wording: { menuHint: 'Up and down choose, Enter selects, Esc closes' },
});

// What the Classic cartridge boots with: the console's own skin and a one-line boot.
export const classicBootSkin = Object.freeze({
  ...driftmanSkin,
  boot: { lines: ['DRIFT CLASSIC'], art: false, seconds: 0.5 },
});
