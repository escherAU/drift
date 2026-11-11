// ONE table for every key. The app dispatches from it, the help panel and the
// `--help` text are generated from it, and the tests check it.
//
//   id       unique name
//   keys     what the terminal sends (single characters; Esc is '\x1b')
//   display  how the key is shown to people
//   label    what it does, in plain words
//   group    help section
//   modes    'all' or the list of modes where the key does something
//   action   name of a handler in the app's ACTIONS object
//   arg      optional argument handed to the handler
import { MODES } from './modes.js';

export const GROUPS = ['modes', 'scenes', 'colour', 'speed', 'other'];
export const GROUP_TITLES = { modes: 'Modes', scenes: 'Scenes', colour: 'Colour', speed: 'Speed', other: 'Other' };

export const KEYMAP = [
  { id: 'mode-next', keys: ['m', 'M'], display: 'm', label: 'next mode', group: 'modes', modes: 'all', action: 'modeNext' },
  { id: 'mode-calm', keys: ['1'], display: '1', label: 'calm mode', group: 'modes', modes: 'all', action: 'modeJump', arg: 'calm' },
  { id: 'mode-chaos', keys: ['2'], display: '2', label: 'chaos mode', group: 'modes', modes: 'all', action: 'modeJump', arg: 'chaos' },
  { id: 'mode-contrast', keys: ['3'], display: '3', label: 'high contrast mode', group: 'modes', modes: 'all', action: 'modeJump', arg: 'contrast' },
  { id: 'mode-experimental', keys: ['4'], display: '4', label: 'experimental mode', group: 'modes', modes: 'all', action: 'modeJump', arg: 'experimental' },
  { id: 'scene-next', keys: [' '], display: 'space', label: 'next scene in this mode', group: 'scenes', modes: 'all', action: 'sceneNext' },
  { id: 'colour', keys: ['c', 'C'], display: 'c', label: 'next colour', group: 'colour', modes: ['calm', 'chaos', 'experimental'], action: 'colourNext' },
  { id: 'invert', keys: ['i', 'I'], display: 'i', label: 'invert black and white', group: 'colour', modes: ['contrast'], action: 'invertToggle' },
  { id: 'faster', keys: ['+', '='], display: '+', label: 'faster', group: 'speed', modes: 'all', action: 'speedUp' },
  { id: 'slower', keys: ['-', '_'], display: '-', label: 'slower', group: 'speed', modes: 'all', action: 'speedDown' },
  { id: 'pause', keys: ['p', 'P'], display: 'p', label: 'pause or resume', group: 'other', modes: 'all', action: 'pauseToggle' },
  { id: 'library', keys: ['l', 'L'], display: 'l', label: 'cartridge library', group: 'other', modes: 'all', action: 'libraryOpen' },
  { id: 'help', keys: ['h', 'H'], display: 'h', label: 'show or hide this help', group: 'other', modes: 'all', action: 'helpToggle' },
  { id: 'close', keys: ['\x1b'], display: 'Esc', label: 'close this help', group: 'other', modes: 'all', action: 'helpClose' },
  { id: 'quit', keys: ['q', 'Q', '\x03'], display: 'q or Ctrl+C', label: 'quit', group: 'other', modes: 'all', action: 'quit' },
];

// Keys that still act while the help panel is open.
export const HELP_OPEN_ACTIONS = ['helpToggle', 'helpClose', 'quit'];

// key -> entry; throws if a key is bound twice (also asserted by the tests).
export function buildKeyMap(table = KEYMAP) {
  const map = new Map();
  for (const e of table) {
    for (const k of e.keys) {
      if (map.has(k)) throw new Error(`key ${JSON.stringify(k)} is bound twice (${map.get(k).id}, ${e.id})`);
      map.set(k, e);
    }
  }
  return map;
}
export const KEY_TO_ENTRY = buildKeyMap();

export function activeIn(entry, mode) {
  return entry.modes === 'all' || entry.modes.includes(mode);
}

export const KEY_COL = 14; // width of the key column in help rows
export const NOT_HERE = ' (not in this mode)';

// One help row for an entry. Inactive rows in high contrast get a suffix (two-tone has no
// dim); in the other modes they are returned with style 'dim'.
export function rowFor(entry, mode) {
  const active = activeIn(entry, mode);
  const base = entry.display.padEnd(KEY_COL) + entry.label;
  if (active) return { text: base, style: 'text' };
  if (mode === 'contrast') return { text: base + NOT_HERE, style: 'text' };
  return { text: base, style: 'dim' };
}

// The body of the help panel (no title, no box): group headings and one row per entry.
export function helpLines(mode) {
  const lines = [];
  for (const g of GROUPS) {
    const entries = KEYMAP.filter((e) => e.group === g);
    if (!entries.length) continue;
    if (lines.length) lines.push({ text: '', style: 'text' });
    lines.push({ text: GROUP_TITLES[g], style: 'head' });
    for (const e of entries) lines.push(rowFor(e, mode));
  }
  return lines;
}

// The "keys" block of `drift --help`, from the same table.
export function cliKeysText() {
  const rows = KEYMAP.map((e) => `  ${e.display.padEnd(KEY_COL)}${e.label}`);
  return ['keys:', ...rows].join('\n') + '\n';
}

// ---- the console (cartridge library and running cartridges)
//
// SHELL_KEYMAP is the console's own table. A row can serve several screens; ONE key map is built per
// screen and a key may be bound once per screen (buildShellKeyMaps throws otherwise). Keys are single
// characters or tokens: up down left right enter esc. Skins relabel rows by id (wording.keys) but never
// rebind them.
//
//   id       unique name (shared with KEYMAP only where the meaning is the same: help, quit, pause...)
//   keys     characters, or the tokens above
//   display  how the key is shown to people
//   label    what it does
//   group    help section title
//   screens  library | insert | boot | error | eject | running
//   action   name of a handler in the shell's actions object
export const SHELL_SCREENS = ['library', 'insert', 'boot', 'error', 'eject', 'running'];
const ALL_SCREENS = SHELL_SCREENS;

export const SHELL_KEYMAP = [
  { id: 'lib-prev', keys: ['left', 'up', ','], display: 'left, up or ,', label: 'previous cartridge', group: 'Cartridges', screens: ['library'], action: 'libPrev' },
  { id: 'lib-next', keys: ['right', 'down', '.'], display: 'right, down or .', label: 'next cartridge', group: 'Cartridges', screens: ['library'], action: 'libNext' },
  { id: 'lib-insert', keys: ['enter'], display: 'Enter', label: 'insert the cartridge', group: 'Cartridges', screens: ['library'], action: 'libInsert' },
  { id: 'lib-back', keys: ['esc', 'l', 'L'], display: 'Esc or l', label: 'back', group: 'Cartridges', screens: ['library'], action: 'libBack' },
  { id: 'menu', keys: ['enter'], display: 'Enter', label: 'open the menu, or choose', group: 'Cartridge', screens: ['running'], action: 'menuEnter' },
  { id: 'menu-prev', keys: ['up', 'left'], display: 'up or left', label: 'menu: previous', group: 'Cartridge', screens: ['running'], action: 'menuPrev' },
  { id: 'menu-next', keys: ['down', 'right'], display: 'down or right', label: 'menu: next', group: 'Cartridge', screens: ['running'], action: 'menuNext' },
  { id: 'close', keys: ['esc'], display: 'Esc', label: 'close the menu or help', group: 'Cartridge', screens: ['running'], action: 'closeTop' },
  { id: 'eject', keys: ['e', 'E', 'l', 'L'], display: 'e or l', label: 'eject the cartridge', group: 'Cartridge', screens: ['running'], action: 'eject' },
  { id: 'scene-next', keys: [' '], display: 'space', label: 'next scene', group: 'Cartridge', screens: ['running'], action: 'sceneNext' },
  { id: 'pause', keys: ['p', 'P'], display: 'p', label: 'pause or resume', group: 'Cartridge', screens: ['running'], action: 'pauseToggle' },
  { id: 'faster', keys: ['+', '='], display: '+', label: 'faster', group: 'Cartridge', screens: ['running'], action: 'speedUp' },
  { id: 'slower', keys: ['-', '_'], display: '-', label: 'slower', group: 'Cartridge', screens: ['running'], action: 'speedDown' },
  { id: 'seasons', keys: ['c', 'C'], display: 'c', label: 'next season (if the cartridge has them)', group: 'Cartridge', screens: ['running'], action: 'seasonsNext' },
  { id: 'help', keys: ['h', 'H'], display: 'h', label: 'show or hide this help', group: 'Other', screens: ['library', 'running'], action: 'helpToggle' },
  { id: 'quit', keys: ['q', 'Q', '\x03'], display: 'q or Ctrl+C', label: 'quit', group: 'Other', screens: ALL_SCREENS, action: 'quit' },
];

// Keys that still act while the console help panel is open.
export const SHELL_HELP_OPEN_ACTIONS = ['helpToggle', 'closeTop', 'libBack', 'quit'];

// screen -> Map(key -> entry); throws when a key is bound twice on one screen.
export function buildShellKeyMaps(table = SHELL_KEYMAP) {
  const maps = {};
  for (const s of SHELL_SCREENS) maps[s] = new Map();
  for (const e of table) {
    for (const s of e.screens) {
      for (const k of e.keys) {
        if (maps[s].has(k)) throw new Error(`key ${JSON.stringify(k)} is bound twice on screen ${s} (${maps[s].get(k).id}, ${e.id})`);
        maps[s].set(k, e);
      }
    }
  }
  return maps;
}
export const SHELL_KEYS = buildShellKeyMaps();

// Every key id a skin may relabel (both tables).
export function knownKeyIds() {
  return new Set([...KEYMAP.map((e) => e.id), ...SHELL_KEYMAP.map((e) => e.id)]);
}

// The group names the running screen's help shows (a skin may rename them with help.groups).
export function shellGroupIds() {
  return [...new Set(SHELL_KEYMAP.filter((e) => e.screens.includes('running')).map((e) => e.group))];
}

// Help lines for a console screen. A skin may relabel rows (skin.wording.keys[id]) and group headings (skin.help.groups).
export function shellHelpLines(screen, skin) {
  const words = (skin && skin.wording && skin.wording.keys) || {};
  const groups = (skin && skin.help && skin.help.groups) || {};
  const rows = SHELL_KEYMAP.filter((e) => e.screens.includes(screen === 'running' ? 'running' : 'library'));
  const lines = [];
  let group = null;
  for (const e of rows) {
    if (e.group !== group) {
      if (lines.length) lines.push({ text: '', style: 'text' });
      lines.push({ text: groups[e.group] ?? e.group, style: 'head' });
      group = e.group;
    }
    lines.push({ text: e.display.padEnd(KEY_COL) + (words[e.id] || e.label), style: 'text' });
  }
  return lines;
}

// Terminal input -> console tokens. Arrow keys (ESC [ A-D and ESC O A-D) become up/down/right/left,
// carriage return and line feed become enter, a lone ESC is esc, every other escape sequence is dropped,
// anything else is passed through one character at a time.
const ARROWS = { A: 'up', B: 'down', C: 'right', D: 'left' };
export function shellTokens(s) {
  const out = [];
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '\x1b') {
      const n = str[i + 1];
      if (n === undefined) { out.push('esc'); continue; }
      if (n === '[') {
        let j = i + 2;
        while (j < str.length && str.charCodeAt(j) >= 0x30 && str.charCodeAt(j) <= 0x3f) j++; // parameter bytes
        while (j < str.length && str.charCodeAt(j) >= 0x20 && str.charCodeAt(j) <= 0x2f) j++; // intermediate bytes
        const fin = str[j];
        if (j === i + 2 && ARROWS[fin]) out.push(ARROWS[fin]);
        i = fin === undefined ? str.length : j;
        continue;
      }
      if (n === 'O') {
        const fin = str[i + 2];
        if (ARROWS[fin]) out.push(ARROWS[fin]);
        i = fin === undefined ? str.length : i + 2;
        continue;
      }
      i += 1; // ESC plus one character (Alt+key): dropped
      continue;
    }
    if (c === '\r') { if (str[i + 1] === '\n') i++; out.push('enter'); continue; }
    if (c === '\n') { out.push('enter'); continue; }
    out.push(c);
  }
  return out;
}

export { MODES };
