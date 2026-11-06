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

export { MODES };
