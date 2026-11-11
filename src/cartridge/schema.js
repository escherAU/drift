// Cartridge schema (DRIFT-4): the ids, the limits, and the validators for manifest.json, skin.json
// and the plain-text assets (label art, boot art). Pure: no file access, no network, no imports of
// cartridge code. Every validator returns { ok: true, <value> } or { ok: false, reason } and never
// throws. Every string and every art character must pass the glyph allow-list (src/glyphs.js).
import { isAllowedGlyph } from '../glyphs.js';
import { PLAYLISTS } from '../scenes/index.js';
import { relLuminance } from './palette.js';
import { parseHex } from '../color.js';
import { knownKeyIds } from '../keymap.js';

export const FORMAT = 1;

// Cartridge and scene ids. Lowercase, digits, hyphen; two to 32 characters; no path separators,
// no drive colons, no dots, so an id can never name a path.
export const ID_RE = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/;
export const RESERVED = Object.freeze([
  'last', 'con', 'prn', 'aux', 'nul',
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => 'com' + n),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => 'lpt' + n),
]);

export const CODE_REASON = 'user cartridges cannot contain code in this version';

export const LIMITS = Object.freeze({
  cartridges: 50,
  scenes: 16,
  programs: 8,
  menuEntries: 8,
  manifestBytes: 16 * 1024,
  skinBytes: 32 * 1024,
  labelBytes: 4 * 1024, labelW: 24, labelH: 10,
  bootBytes: 16 * 1024, bootW: 76, bootH: 18,
  textBytes: 32 * 1024, textCards: 12, textLines: 8, textChars: 60,
  chapterNumeral: 8, chapterPlace: 30, chapterLine: 64, chapterIcon: 5,
  title: 30, author: 30, blurb: 60, sceneTitle: 30, menuLabel: 24,
  facts: 6, factChars: 40,
  sceneSecondsMin: 20, sceneSecondsMax: 3600, fadeSecondsMin: 5, fadeSecondsMax: 60,
  defaultSceneSeconds: 180, defaultFadeSeconds: 15,
  paletteColours: 48, // 16 hue levels + at most 48 extras = 64 entries
  bgLuminance: 0.05,
});

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const CODE_RE = /^[A-Z0-9-]{5}$/;
const KEY_ID_RE = /^[a-z][a-zA-Z0-9-]{0,30}$/;

export const SCENE_KINDS = Object.freeze(['cells', 'sim', 'field', 'text', 'builtin']);
export const CODE_KINDS = Object.freeze(['cells', 'sim', 'field']);
export const MENU_ACTIONS = Object.freeze(['eject']);

const OPEN_KEYS = ['format', 'id', 'title', 'version', 'author', 'blurb', 'runtime', 'locked', 'labelHue', 'scenes', 'programs', 'start', 'menu', 'chapters'];
const LOCKED_KEYS = ['format', 'id', 'title', 'version', 'author', 'blurb', 'locked', 'code', 'facts', 'labelHue'];

const fail = (reason) => ({ ok: false, reason });
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hex4 = (cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');

// First code point of s that is not on the allow-list, or null.
export function firstBadGlyph(s) {
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    if (!isAllowedGlyph(cp)) return cp;
  }
  return null;
}

export function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id) && !RESERVED.includes(id);
}

function idReason(id, what) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return `invalid ${what} id ${JSON.stringify(id)} (2 to 32 characters: lowercase letters, digits and hyphens, starting with a letter)`;
  if (RESERVED.includes(id)) return `${what} id '${id}' is reserved`;
  return null;
}

// A string field: returns an error text or null.
function strErr(v, name, max, min = 1) {
  if (typeof v !== 'string') return `${name} must be text`;
  const n = [...v].length;
  if (n < min) return `${name} must not be empty`;
  if (n > max) return `${name} is ${n} characters, max ${max}`;
  const bad = firstBadGlyph(v);
  if (bad !== null) return `${name} has ${hex4(bad)}, which is not an allowed glyph`;
  return null;
}

function unknownKey(obj, allowed, where) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) return `unknown field '${k}'${where ? ' in ' + where : ''}`;
  return null;
}

// How a classic scene id is classed: 'calm', 'experimental', 'chaos', 'contrast' or null.
export function builtinClass(ref) {
  for (const mode of Object.keys(PLAYLISTS)) if (PLAYLISTS[mode].some((s) => s.id === ref)) return mode;
  return null;
}

// 'field' scenes are crossfaded (values 0..255, ramped to glyphs); 'cells' scenes are dissolved.
export function sceneFamily(entry) {
  if (entry.kind === 'field') return 'field';
  if (entry.kind === 'builtin') return builtinClass(entry.ref) === 'calm' ? 'field' : 'cells';
  return 'cells';
}

function validateScene(s, i, trusted) {
  const where = `scenes[${i}]`;
  if (!isObj(s)) return fail(`${where} must be an object`);
  const uk = unknownKey(s, ['id', 'kind', 'title', 'ref'], where);
  if (uk) return fail(uk);
  const ir = idReason(s.id, 'scene');
  if (ir) return fail(`${where}: ${ir}`);
  if (!SCENE_KINDS.includes(s.kind)) return fail(`${where} ('${s.id}'): kind must be one of ${SCENE_KINDS.join(', ')}`);
  if (CODE_KINDS.includes(s.kind) && !trusted) return fail(`${where} ('${s.id}'): ${CODE_REASON}`);
  if (s.title !== undefined) { const e = strErr(s.title, `${where}.title`, LIMITS.sceneTitle); if (e) return fail(e); }
  if (s.kind === 'builtin') {
    if (typeof s.ref !== 'string') return fail(`${where} ('${s.id}'): a builtin scene needs a 'ref'`);
    const cls = builtinClass(s.ref);
    if (cls === null) return fail(`${where} ('${s.id}'): unknown builtin scene '${s.ref}'`);
    if (cls !== 'calm' && cls !== 'experimental') return fail(`${where} ('${s.id}'): builtin '${s.ref}' is a ${cls} scene; cartridges may only use calm or experimental scenes`);
  } else if (s.ref !== undefined) {
    return fail(`${where} ('${s.id}'): only builtin scenes take a 'ref'`);
  }
  const out = { id: s.id, kind: s.kind, title: s.title === undefined ? s.id : s.title };
  if (s.kind === 'builtin') out.ref = s.ref;
  return { ok: true, scene: out };
}

function validateProgram(p, i, scenesById) {
  const where = `programs[${i}]`;
  if (!isObj(p)) return fail(`${where} must be an object`);
  const uk = unknownKey(p, ['id', 'title', 'transition', 'scenes', 'sceneSeconds', 'fadeSeconds'], where);
  if (uk) return fail(uk);
  const ir = idReason(p.id, 'program');
  if (ir) return fail(`${where}: ${ir}`);
  if (p.title !== undefined) { const e = strErr(p.title, `${where}.title`, LIMITS.title); if (e) return fail(e); }
  if (p.transition !== 'dissolve' && p.transition !== 'crossfade') return fail(`${where} ('${p.id}'): transition must be 'dissolve' or 'crossfade'`);
  if (!Array.isArray(p.scenes) || p.scenes.length < 1 || p.scenes.length > LIMITS.scenes) return fail(`${where} ('${p.id}'): scenes must list 1 to ${LIMITS.scenes} scene ids`);
  const want = p.transition === 'crossfade' ? 'field' : 'cells';
  for (const sid of p.scenes) {
    const sc = typeof sid === 'string' ? scenesById.get(sid) : undefined;
    if (!sc) return fail(`${where} ('${p.id}'): unknown scene ${JSON.stringify(sid)}`);
    if (sceneFamily(sc) !== want) {
      const what = sc.kind === 'builtin' ? `${sc.kind} (${sc.ref}) scene` : `${sc.kind} scene`;
      return fail(want === 'field'
        ? `${where} ('${p.id}'): a crossfade program holds only field scenes or calm builtins, but '${sid}' is a ${what}`
        : `${where} ('${p.id}'): a dissolve program holds only cells, sim, text or experimental builtin scenes, but '${sid}' is a ${what}`);
    }
  }
  let sceneSeconds = LIMITS.defaultSceneSeconds;
  if (p.sceneSeconds !== undefined) {
    if (!Number.isFinite(p.sceneSeconds) || p.sceneSeconds < LIMITS.sceneSecondsMin || p.sceneSeconds > LIMITS.sceneSecondsMax) return fail(`${where} ('${p.id}'): sceneSeconds must be ${LIMITS.sceneSecondsMin} to ${LIMITS.sceneSecondsMax}`);
    sceneSeconds = p.sceneSeconds;
  }
  const out = { id: p.id, title: p.title === undefined ? p.id : p.title, transition: p.transition, scenes: p.scenes.slice(), sceneSeconds };
  if (p.transition === 'crossfade') {
    let fadeSeconds = LIMITS.defaultFadeSeconds;
    if (p.fadeSeconds !== undefined) {
      if (!Number.isFinite(p.fadeSeconds) || p.fadeSeconds < LIMITS.fadeSecondsMin || p.fadeSeconds > LIMITS.fadeSecondsMax) return fail(`${where} ('${p.id}'): fadeSeconds must be ${LIMITS.fadeSecondsMin} to ${LIMITS.fadeSecondsMax}`);
      fadeSeconds = p.fadeSeconds;
    }
    if (fadeSeconds >= sceneSeconds) return fail(`${where} ('${p.id}'): fadeSeconds must be shorter than sceneSeconds`);
    out.fadeSeconds = fadeSeconds;
  } else if (p.fadeSeconds !== undefined) {
    return fail(`${where} ('${p.id}'): fadeSeconds only applies to crossfade programs`);
  }
  return { ok: true, program: out };
}

function validateMenu(menu, programIds) {
  if (!Array.isArray(menu) || menu.length < 1 || menu.length > LIMITS.menuEntries) return fail(`menu must list 1 to ${LIMITS.menuEntries} entries`);
  const out = [];
  for (let i = 0; i < menu.length; i++) {
    const m = menu[i];
    const where = `menu[${i}]`;
    if (!isObj(m)) return fail(`${where} must be an object`);
    const uk = unknownKey(m, ['label', 'program', 'action'], where);
    if (uk) return fail(uk);
    const e = strErr(m.label, `${where}.label`, LIMITS.menuLabel);
    if (e) return fail(e);
    if ((m.program === undefined) === (m.action === undefined)) return fail(`${where}: give exactly one of 'program' or 'action'`);
    if (m.program !== undefined && !programIds.has(m.program)) return fail(`${where}: unknown program ${JSON.stringify(m.program)}`);
    if (m.action !== undefined && !MENU_ACTIONS.includes(m.action)) return fail(`${where}: action must be one of ${MENU_ACTIONS.join(', ')}`);
    out.push(m.program !== undefined ? { label: m.label, program: m.program } : { label: m.label, action: m.action });
  }
  return { ok: true, menu: out };
}

// chapters: an optional list that names scenes for the cartridge's own screens (a chapter select).
// Each chapter points at a scene id; the other fields are short allow-listed text.
function validateChapters(chapters, scenesById) {
  if (!Array.isArray(chapters) || chapters.length < 1 || chapters.length > LIMITS.scenes) return fail(`'chapters' must list 1 to ${LIMITS.scenes} chapters`);
  const out = [];
  const seen = new Set();
  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i];
    const where = `chapters[${i}]`;
    if (!isObj(c)) return fail(`${where} must be an object`);
    const uk = unknownKey(c, ['id', 'numeral', 'place', 'line', 'icon', 'minutes'], where);
    if (uk) return fail(uk);
    if (typeof c.id !== 'string' || !scenesById.has(c.id)) return fail(`${where}: unknown scene ${JSON.stringify(c.id)}`);
    if (seen.has(c.id)) return fail(`${where}: duplicate chapter '${c.id}'`);
    seen.add(c.id);
    for (const [k, max] of [['numeral', LIMITS.chapterNumeral], ['place', LIMITS.chapterPlace], ['line', LIMITS.chapterLine]]) {
      const e = strErr(c[k], `${where}.${k}`, max);
      if (e) return fail(e);
    }
    if (!Array.isArray(c.icon) || c.icon.length !== 2) return fail(`${where}.icon must be two pieces of text`);
    for (let k = 0; k < 2; k++) { const e = strErr(c.icon[k], `${where}.icon[${k}]`, LIMITS.chapterIcon); if (e) return fail(e); }
    if (!Number.isInteger(c.minutes) || c.minutes < 1 || c.minutes > 999) return fail(`${where}.minutes must be a whole number from 1 to 999`);
    out.push({ id: c.id, numeral: c.numeral, place: c.place, line: c.line, icon: c.icon.slice(), minutes: c.minutes });
  }
  return { ok: true, chapters: out };
}

// manifest.json. `trusted` is true only for the install folder (the git checkout).
export function validateManifest(obj, { trusted = false } = {}) {
  if (!isObj(obj)) return fail('manifest.json must hold an object');
  if (obj.format !== undefined) {
    if (!Number.isInteger(obj.format) || obj.format < 1) return fail("'format' must be a whole number, 1 or more");
    if (obj.format > FORMAT) return fail(`needs a newer Drift (this cartridge is format ${obj.format}; this Drift reads format ${FORMAT})`);
  }
  if (obj.locked !== undefined && typeof obj.locked !== 'boolean') return fail("'locked' must be true or false");
  const locked = obj.locked === true;
  const allowed = locked ? LOCKED_KEYS : OPEN_KEYS;
  for (const k of Object.keys(obj)) {
    if (allowed.includes(k)) continue;
    if (locked && OPEN_KEYS.includes(k)) return fail(`locked cartridges cannot have '${k}'`);
    return fail(`unknown field '${k}'`);
  }
  for (const k of ['format', 'id', 'title', 'version', 'author', 'blurb']) if (obj[k] === undefined) return fail(`missing required field '${k}'`);
  const ir = idReason(obj.id, 'cartridge');
  if (ir) return fail(ir);
  for (const [k, max] of [['title', LIMITS.title], ['author', LIMITS.author], ['blurb', LIMITS.blurb]]) {
    const e = strErr(obj[k], k, max);
    if (e) return fail(e);
  }
  if (typeof obj.version !== 'string' || !VERSION_RE.test(obj.version)) return fail("'version' must look like 1.0.0");
  if (obj.labelHue !== undefined && (typeof obj.labelHue !== 'string' || !HEX_RE.test(obj.labelHue))) return fail("'labelHue' must be a colour like #7FB069");

  const out = { format: obj.format, id: obj.id, title: obj.title, version: obj.version, author: obj.author, blurb: obj.blurb };
  if (obj.labelHue !== undefined) out.labelHue = obj.labelHue;

  if (locked) {
    if (obj.id === 'classic') return fail("id 'classic' is reserved for the Drift Classic cartridge");
    out.locked = true;
    if (obj.code !== undefined) {
      if (typeof obj.code !== 'string' || !CODE_RE.test(obj.code)) return fail("'code' must be exactly 5 characters, capitals, digits or hyphen (like DM-01)");
      out.code = obj.code;
    }
    if (obj.facts !== undefined) {
      if (!Array.isArray(obj.facts) || obj.facts.length > LIMITS.facts) return fail(`'facts' must list at most ${LIMITS.facts} lines`);
      for (let i = 0; i < obj.facts.length; i++) { const e = strErr(obj.facts[i], `facts[${i}]`, LIMITS.factChars); if (e) return fail(e); }
      out.facts = obj.facts.slice();
    }
    return { ok: true, manifest: out };
  }

  out.locked = false;
  if (obj.runtime !== 'cartridge' && obj.runtime !== 'classic') return fail(obj.runtime === undefined ? "missing required field 'runtime'" : "'runtime' must be 'cartridge' or 'classic'");
  out.runtime = obj.runtime;

  if (obj.runtime === 'classic') {
    if (!trusted) return fail("runtime 'classic' is only for the install folder");
    if (obj.id !== 'classic') return fail("runtime 'classic' belongs to the cartridge with id 'classic'");
    for (const k of ['scenes', 'programs', 'start', 'menu', 'chapters']) if (obj[k] !== undefined) return fail(`the classic cartridge cannot have '${k}'`);
    return { ok: true, manifest: out };
  }
  if (obj.id === 'classic') return fail("id 'classic' is reserved for the Drift Classic cartridge");

  for (const k of ['scenes', 'programs']) if (obj[k] === undefined) return fail(`missing required field '${k}'`);
  if (!Array.isArray(obj.scenes) || obj.scenes.length < 1 || obj.scenes.length > LIMITS.scenes) return fail(`'scenes' must list 1 to ${LIMITS.scenes} scenes`);
  const scenes = [];
  const byId = new Map();
  for (let i = 0; i < obj.scenes.length; i++) {
    const r = validateScene(obj.scenes[i], i, trusted);
    if (!r.ok) return r;
    if (byId.has(r.scene.id)) return fail(`scenes[${i}]: duplicate scene id '${r.scene.id}'`);
    byId.set(r.scene.id, r.scene);
    scenes.push(r.scene);
  }
  if (!Array.isArray(obj.programs) || obj.programs.length < 1 || obj.programs.length > LIMITS.programs) return fail(`'programs' must list 1 to ${LIMITS.programs} programs`);
  const programs = [];
  const programIds = new Set();
  for (let i = 0; i < obj.programs.length; i++) {
    const r = validateProgram(obj.programs[i], i, byId);
    if (!r.ok) return r;
    if (programIds.has(r.program.id)) return fail(`programs[${i}]: duplicate program id '${r.program.id}'`);
    programIds.add(r.program.id);
    programs.push(r.program);
  }
  if (typeof obj.start !== 'string' || !programIds.has(obj.start)) return fail(obj.start === undefined ? "missing required field 'start'" : `'start' names no program: ${JSON.stringify(obj.start)}`);
  out.scenes = scenes;
  out.programs = programs;
  out.start = obj.start;
  if (obj.menu !== undefined) {
    const r = validateMenu(obj.menu, programIds);
    if (!r.ok) return r;
    out.menu = r.menu;
  }
  if (obj.chapters !== undefined) {
    const r = validateChapters(obj.chapters, byId);
    if (!r.ok) return r;
    out.chapters = r.chapters;
  }
  return { ok: true, manifest: out };
}

// ---- skin.json

const SHOW = ['never', 'menu', 'always'];
const LAYOUTS = ['list', 'slots', 'grid'];
const ANCHORS = ['center', 'left', 'bottom'];

function exactChars(v, name, n) {
  if (typeof v !== 'string' || [...v].length !== n) return `${name} must be exactly ${n} characters`;
  const bad = firstBadGlyph(v);
  if (bad !== null) return `${name} has ${hex4(bad)}, which is not an allowed glyph`;
  return null;
}

export const CONSOLE_INK_KEYS = Object.freeze(['frame', 'grille', 'stripe', 'led', 'bar']);
export const TITLE_STYLES = Object.freeze(['block', 'spaced', 'plain']);

// skin.console: how the cartridge restyles the Driftman console itself. Every field is optional; a missing one
// keeps the console's own look. Ink values are brightness levels 0 to 3 of the cartridge's label tint (the library
// palette has them already); title colours are palette indexes of the skin. `idx` is the skin's palette-index check.
function validateConsole(c, idx) {
  if (!isObj(c)) return fail('console must be an object');
  const k = unknownKey(c, ['frame', 'grille', 'stripe', 'ink', 'title'], 'console');
  if (k) return fail(k);
  const o = {};
  if (c.frame !== undefined) { const e = exactChars(c.frame, 'console.frame', 8); if (e) return fail(e); o.frame = c.frame; }
  if (c.grille !== undefined) { const e = exactChars(c.grille, 'console.grille', 1); if (e) return fail(e); o.grille = c.grille; }
  if (c.stripe !== undefined) { const e = strErr(c.stripe, 'console.stripe', 24); if (e) return fail(e); o.stripe = c.stripe; }
  if (c.ink !== undefined) {
    if (!isObj(c.ink)) return fail('console.ink must be an object');
    const ik = unknownKey(c.ink, CONSOLE_INK_KEYS, 'console.ink');
    if (ik) return fail(ik);
    o.ink = {};
    for (const key of CONSOLE_INK_KEYS) {
      if (c.ink[key] === undefined) continue;
      if (!Number.isInteger(c.ink[key]) || c.ink[key] < 0 || c.ink[key] > 3) return fail(`console.ink.${key} must be 0 to 3`);
      o.ink[key] = c.ink[key];
    }
  }
  if (c.title !== undefined) {
    const t = c.title;
    if (!isObj(t)) return fail('console.title must be an object');
    const tk = unknownKey(t, ['style', 'ornament', 'colour', 'ornamentColour'], 'console.title');
    if (tk) return fail(tk);
    o.title = {};
    if (t.style !== undefined) { if (!TITLE_STYLES.includes(t.style)) return fail(`console.title.style must be one of ${TITLE_STYLES.join(', ')}`); o.title.style = t.style; }
    if (t.ornament !== undefined) { const e = strErr(t.ornament, 'console.title.ornament', 40); if (e) return fail(e); o.title.ornament = t.ornament; }
    for (const key of ['colour', 'ornamentColour']) {
      if (t[key] === undefined) continue;
      const e = idx(t[key], `console.title.${key}`);
      if (e) return fail(e);
      o.title[key] = t[key];
    }
  }
  return { ok: true, console: o };
}

export function validateSkin(obj) {
  if (!isObj(obj)) return fail('skin.json must hold an object');
  const uk = unknownKey(obj, ['palette', 'frame', 'console', 'menu', 'help', 'boot', 'insert', 'wording', 'seasons'], '');
  if (uk) return fail(uk);
  const out = {};

  // palette (required)
  const pal = obj.palette;
  if (!isObj(pal)) return fail("missing required field 'palette'");
  const pk = unknownKey(pal, ['hue', 'colours', 'bg', 'ui'], 'palette');
  if (pk) return fail(pk);
  if (typeof pal.hue !== 'string' || !HEX_RE.test(pal.hue)) return fail("palette.hue must be a colour like #7FB069");
  const colours = pal.colours === undefined ? [] : pal.colours;
  if (!Array.isArray(colours) || colours.length > LIMITS.paletteColours) return fail(`palette.colours must list at most ${LIMITS.paletteColours} colours`);
  for (let i = 0; i < colours.length; i++) if (typeof colours[i] !== 'string' || !HEX_RE.test(colours[i])) return fail(`palette.colours[${i}] must be a colour like #7FB069`);
  const total = 16 + colours.length;
  const palette = { hue: pal.hue, colours: colours.slice() };
  if (pal.bg !== undefined) {
    if (typeof pal.bg !== 'string' || !HEX_RE.test(pal.bg)) return fail('palette.bg must be a colour like #0B140C');
    const lum = relLuminance(parseHex(pal.bg));
    if (lum > LIMITS.bgLuminance) return fail(`background too light (luminance ${lum.toFixed(3)}, limit ${LIMITS.bgLuminance})`);
    palette.bg = pal.bg;
  }
  const idx = (v, name) => (Number.isInteger(v) && v >= 0 && v < total ? null : `${name} must be a palette index from 0 to ${total - 1}`);
  if (pal.ui !== undefined) {
    if (!isObj(pal.ui)) return fail('palette.ui must be an object');
    const uik = unknownKey(pal.ui, ['text', 'dim', 'head', 'accent'], 'palette.ui');
    if (uik) return fail(uik);
    palette.ui = {};
    for (const k of Object.keys(pal.ui)) { const e = idx(pal.ui[k], `palette.ui.${k}`); if (e) return fail(e); palette.ui[k] = pal.ui[k]; }
  }
  out.palette = palette;

  if (obj.frame !== undefined) {
    const f = obj.frame;
    if (!isObj(f)) return fail('frame must be an object');
    const k = unknownKey(f, ['show', 'glyphs', 'title', 'colour'], 'frame');
    if (k) return fail(k);
    const o = {};
    if (f.show !== undefined) { if (!SHOW.includes(f.show)) return fail(`frame.show must be one of ${SHOW.join(', ')}`); o.show = f.show; }
    if (f.glyphs !== undefined) { const e = exactChars(f.glyphs, 'frame.glyphs', 8); if (e) return fail(e); o.glyphs = f.glyphs; }
    if (f.title !== undefined) { const e = strErr(f.title, 'frame.title', 30); if (e) return fail(e); o.title = f.title; }
    if (f.colour !== undefined) { const e = idx(f.colour, 'frame.colour'); if (e) return fail(e); o.colour = f.colour; }
    out.frame = o;
  }
  if (obj.console !== undefined) {
    const r = validateConsole(obj.console, idx);
    if (!r.ok) return r;
    out.console = r.console;
  }
  if (obj.menu !== undefined) {
    const m = obj.menu;
    if (!isObj(m)) return fail('menu must be an object');
    const k = unknownKey(m, ['layout', 'anchor', 'cursor', 'title', 'box'], 'menu');
    if (k) return fail(k);
    const o = {};
    if (m.layout !== undefined) { if (!LAYOUTS.includes(m.layout)) return fail(`menu.layout must be one of ${LAYOUTS.join(', ')}`); o.layout = m.layout; }
    if (m.anchor !== undefined) { if (!ANCHORS.includes(m.anchor)) return fail(`menu.anchor must be one of ${ANCHORS.join(', ')}`); o.anchor = m.anchor; }
    if (m.cursor !== undefined) { const e = exactChars(m.cursor, 'menu.cursor', 1); if (e) return fail(e); o.cursor = m.cursor; }
    if (m.title !== undefined) { const e = strErr(m.title, 'menu.title', 40); if (e) return fail(e); o.title = m.title; }
    if (m.box !== undefined) { const e = exactChars(m.box, 'menu.box', 8); if (e) return fail(e); o.box = m.box; }
    out.menu = o;
  }
  if (obj.help !== undefined) {
    const h = obj.help;
    if (!isObj(h)) return fail('help must be an object');
    const k = unknownKey(h, ['title', 'box'], 'help');
    if (k) return fail(k);
    const o = {};
    if (h.title !== undefined) { const e = strErr(h.title, 'help.title', 30); if (e) return fail(e); o.title = h.title; }
    if (h.box !== undefined) { const e = exactChars(h.box, 'help.box', 8); if (e) return fail(e); o.box = h.box; }
    out.help = o;
  }
  if (obj.boot !== undefined) {
    const b = obj.boot;
    if (!isObj(b)) return fail('boot must be an object');
    const k = unknownKey(b, ['lines', 'art', 'seconds'], 'boot');
    if (k) return fail(k);
    const o = {};
    if (b.lines !== undefined) {
      if (!Array.isArray(b.lines) || b.lines.length > 8) return fail('boot.lines must list at most 8 lines');
      for (let i = 0; i < b.lines.length; i++) { const e = strErr(b.lines[i], `boot.lines[${i}]`, 60, 0); if (e) return fail(e); }
      o.lines = b.lines.slice();
    }
    if (b.art !== undefined) { if (typeof b.art !== 'boolean') return fail('boot.art must be true or false'); o.art = b.art; }
    if (b.seconds !== undefined) { if (!Number.isFinite(b.seconds) || b.seconds < 0.5 || b.seconds > 10) return fail('boot.seconds must be 0.5 to 10'); o.seconds = b.seconds; }
    out.boot = o;
  }
  if (obj.insert !== undefined) {
    const n = obj.insert;
    if (!isObj(n)) return fail('insert must be an object');
    const k = unknownKey(n, ['text'], 'insert');
    if (k) return fail(k);
    const o = {};
    if (n.text !== undefined) { const e = strErr(n.text, 'insert.text', 40); if (e) return fail(e); o.text = n.text; }
    out.insert = o;
  }
  if (obj.wording !== undefined) {
    const w = obj.wording;
    if (!isObj(w)) return fail('wording must be an object');
    const k = unknownKey(w, ['keys', 'menuHint'], 'wording');
    if (k) return fail(k);
    const o = {};
    if (w.keys !== undefined) {
      if (!isObj(w.keys)) return fail('wording.keys must be an object');
      o.keys = {};
      for (const id of Object.keys(w.keys)) {
        if (!KEY_ID_RE.test(id)) return fail(`wording.keys: '${id}' is not a key id`);
        if (!knownKeyIds().has(id)) return fail(`wording.keys: '${id}' is not a key of the console or of Drift Classic`);
        const e = strErr(w.keys[id], `wording.keys.${id}`, 28);
        if (e) return fail(e);
        o.keys[id] = w.keys[id];
      }
    }
    if (w.menuHint !== undefined) { const e = strErr(w.menuHint, 'wording.menuHint', 60); if (e) return fail(e); o.menuHint = w.menuHint; }
    out.wording = o;
  }
  if (obj.seasons !== undefined) {
    // optional: up to 4 named hues the c key cycles through while the cartridge runs
    if (!Array.isArray(obj.seasons) || obj.seasons.length < 1 || obj.seasons.length > 4) return fail('seasons must list 1 to 4 seasons');
    out.seasons = [];
    for (let i = 0; i < obj.seasons.length; i++) {
      const s = obj.seasons[i];
      if (!isObj(s)) return fail(`seasons[${i}] must be an object`);
      const k = unknownKey(s, ['name', 'hue'], `seasons[${i}]`);
      if (k) return fail(k);
      const e = strErr(s.name, `seasons[${i}].name`, 16);
      if (e) return fail(e);
      if (typeof s.hue !== 'string' || !HEX_RE.test(s.hue)) return fail(`seasons[${i}].hue must be a colour like #7FB069`);
      out.seasons.push({ name: s.name, hue: s.hue });
    }
  }
  return { ok: true, skin: out };
}

// ---- plain-text assets (label art, boot art)

// Lines of art: CRLF or LF, trailing spaces trimmed, trailing blank lines dropped. Every character
// must be on the allow-list (so no tabs, emoji or controls); at most maxH rows of maxW columns.
export function parseTextAsset(text, { maxW = Infinity, maxH = Infinity, maxBytes = Infinity } = {}) {
  if (typeof text !== 'string') return fail('file is not text');
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > maxBytes) return fail(`file is ${bytes} bytes, max ${maxBytes}`);
  let s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = s.split(/\r?\n/).map((l) => l.replace(/ +$/, ''));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (let r = 0; r < lines.length; r++) {
    const bad = firstBadGlyph(lines[r]);
    if (bad !== null) return fail(`row ${r + 1} has ${hex4(bad)}, which is not an allowed glyph`);
  }
  if (lines.length > maxH) return fail(`art is ${lines.length} rows, max ${maxH}`);
  for (let r = 0; r < lines.length; r++) {
    const n = [...lines[r]].length;
    if (n > maxW) return fail(`row ${r + 1} is ${n} columns, max ${maxW}`);
  }
  return { ok: true, lines };
}
