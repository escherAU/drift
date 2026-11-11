// Cartridge discovery and loading (DRIFT-4).
//
//   discoverCartridges({ dirs: [{ dir, trusted }] })   SYNC   -> { cartridges, errors: [{ where, reason }] }
//   loadScenes(cart)                                    ASYNC  -> { scenes, errors }
//
// Discovery reads data only (manifest, label, skin, boot art, text scenes). It never imports code.
// loadScenes imports a cartridge's scene modules, and only when cart.trusted: code runs only from the
// install folder (the git checkout). A user-folder cartridge that holds any .js/.mjs/.cjs file, or
// declares a code scene kind, is skipped with "user cartridges cannot contain code in this version".
// A cartridge folder or scene file that is a link or junction is skipped, and so is anything whose
// real path leaves the cartridge folder. Never throws on bad content: every problem becomes an error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LIMITS, CODE_REASON, CODE_KINDS, validateManifest, validateSkin, parseTextAsset, sceneFamily, builtinClass } from './schema.js';
import { parseTextScene, makeTextScene } from './textscene.js';
import { paletteLength } from './palette.js';
import { PLAYLISTS } from '../scenes/index.js';
import { renderScene, sceneKind } from '../cells.js';
import { isAllowedGlyph } from '../glyphs.js';

// <repo>/cartridges, found from this file's own location.
export const INSTALL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'cartridges');

// <config folder>/cartridges
export function userDir(configPath) {
  return path.join(path.dirname(configPath), 'cartridges');
}

const CODE_EXT = /\.(?:m?js|cjs)$/i;

class Skip extends Error {}
const skip = (reason) => { throw new Skip(reason); };
const errText = (e) => (e && e.message ? String(e.message).split('\n')[0] : String(e));

function readTextFile(file, maxBytes, label) {
  const st = fs.lstatSync(file);
  if (st.isSymbolicLink()) skip(`${label} is a link or junction; links are not followed`);
  if (!st.isFile()) skip(`${label} is not a file`);
  if (st.size > maxBytes) skip(`${label} is ${st.size} bytes, max ${maxBytes}`);
  return fs.readFileSync(file, 'utf8');
}

// A file inside the cartridge folder whose real path stays inside it.
function contained(realDir, file, label) {
  let real;
  try { real = fs.realpathSync.native(file); } catch (e) { skip(`${label} cannot be resolved: ${errText(e)}`); }
  if (real !== realDir && !real.startsWith(realDir + path.sep)) skip(`${label} resolves outside the cartridge folder`);
  return real;
}

// Any .js/.mjs/.cjs file below dir (bounded depth and count), without following links. Anything it
// cannot fully inspect (too deep, too many entries, a folder it cannot read) counts as code: refuse
// rather than guess.
function hasCodeFile(dir, depth = 0, budget = { n: 2000 }) {
  if (depth > 6) return true;
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return true; }
  for (const e of ents) {
    if (budget.n-- <= 0) return true; // too much to inspect: refuse rather than guess
    if (CODE_EXT.test(e.name)) return true;
    if (e.isDirectory() && !e.isSymbolicLink() && hasCodeFile(path.join(dir, e.name), depth + 1, budget)) return true;
  }
  return false;
}

function loadOne(dir, name, trusted) {
  const cartDir = path.join(dir, name);
  const st = fs.lstatSync(cartDir);
  if (st.isSymbolicLink()) skip('cartridge folder is a link or junction; links are not followed');
  if (!st.isDirectory()) return null;
  const realRoot = fs.realpathSync.native(dir);
  const realDir = fs.realpathSync.native(cartDir);
  if (realDir !== path.join(realRoot, name)) skip('cartridge folder resolves somewhere else; links are not followed');

  let mtext;
  try { mtext = readTextFile(path.join(cartDir, 'manifest.json'), LIMITS.manifestBytes, 'manifest.json'); } catch (e) {
    if (e instanceof Skip) throw e;
    skip(e && e.code === 'ENOENT' ? 'manifest.json is missing' : `manifest.json cannot be read: ${errText(e)}`);
  }
  let obj;
  try { obj = JSON.parse(mtext.charCodeAt(0) === 0xfeff ? mtext.slice(1) : mtext); } catch (e) { skip(`manifest.json is not valid JSON: ${errText(e)}`); }
  const v = validateManifest(obj, { trusted });
  if (!v.ok) skip(v.reason);
  const manifest = v.manifest;
  if (manifest.id !== name) skip(`folder name '${name}' does not match the manifest id '${manifest.id}'`);
  if (!trusted && hasCodeFile(cartDir)) skip(CODE_REASON);

  let label;
  try { label = readTextFile(path.join(cartDir, 'label.txt'), LIMITS.labelBytes, 'label.txt'); } catch (e) {
    if (e instanceof Skip) throw e;
    skip(e && e.code === 'ENOENT' ? 'label.txt is missing' : `label.txt cannot be read: ${errText(e)}`);
  }
  contained(realDir, path.join(cartDir, 'label.txt'), 'label.txt');
  const lr = parseTextAsset(label, { maxW: LIMITS.labelW, maxH: LIMITS.labelH, maxBytes: LIMITS.labelBytes });
  if (!lr.ok) skip(`label.txt: ${lr.reason}`);

  // label-ink.txt (optional): a 0-3 brightness digit per label cell; read before the locked early return
  let labelInk = null;
  const inkFile = path.join(cartDir, 'label-ink.txt');
  let inkSt = null;
  try { inkSt = fs.lstatSync(inkFile); } catch (e) { if (!e || e.code !== 'ENOENT') skip(`label-ink.txt cannot be read: ${errText(e)}`); }
  if (inkSt) {
    let itext;
    try { itext = readTextFile(inkFile, LIMITS.labelBytes, 'label-ink.txt'); } catch (e) { if (e instanceof Skip) throw e; skip(`label-ink.txt cannot be read: ${errText(e)}`); }
    contained(realDir, inkFile, 'label-ink.txt');
    const ir = parseTextAsset(itext, { maxW: LIMITS.labelW, maxH: LIMITS.labelH, maxBytes: LIMITS.labelBytes });
    if (!ir.ok) skip(`label-ink.txt: ${ir.reason}`);
    for (let r = 0; r < ir.lines.length; r++) {
      const m = /[^0-3 ]/u.exec(ir.lines[r]);
      if (m) skip(`label-ink.txt: row ${r + 1} has '${m[0]}', but only the digits 0 to 3 and spaces are allowed`);
    }
    labelInk = ir.lines;
  }

  const cart = {
    id: manifest.id, title: manifest.title, manifest, dir: cartDir, trusted,
    locked: manifest.locked === true, runtime: manifest.runtime || null,
    label: lr.lines, labelInk, boot: null, skin: null, texts: {}, sceneFiles: {},
  };
  if (cart.locked || manifest.runtime === 'classic') return cart;

  // skin.json (optional)
  const skinFile = path.join(cartDir, 'skin.json');
  if (fs.existsSync(skinFile)) {
    let stext;
    try { stext = readTextFile(skinFile, LIMITS.skinBytes, 'skin.json'); } catch (e) { if (e instanceof Skip) throw e; skip(`skin.json cannot be read: ${errText(e)}`); }
    contained(realDir, skinFile, 'skin.json');
    let sobj;
    try { sobj = JSON.parse(stext.charCodeAt(0) === 0xfeff ? stext.slice(1) : stext); } catch (e) { skip(`skin.json is not valid JSON: ${errText(e)}`); }
    const sr = validateSkin(sobj);
    if (!sr.ok) skip(`skin.json: ${sr.reason}`);
    cart.skin = sr.skin;
  }
  // boot.txt (optional)
  const bootFile = path.join(cartDir, 'boot.txt');
  if (fs.existsSync(bootFile)) {
    let btext;
    try { btext = readTextFile(bootFile, LIMITS.bootBytes, 'boot.txt'); } catch (e) { if (e instanceof Skip) throw e; skip(`boot.txt cannot be read: ${errText(e)}`); }
    contained(realDir, bootFile, 'boot.txt');
    const br = parseTextAsset(btext, { maxW: LIMITS.bootW, maxH: LIMITS.bootH, maxBytes: LIMITS.bootBytes });
    if (!br.ok) skip(`boot.txt: ${br.reason}`);
    cart.boot = br.lines;
  }
  // scene files: their names come from validated ids only, so an id is the whole attack surface
  for (const sc of manifest.scenes) {
    if (sc.kind === 'builtin') continue;
    const rel = path.join('scenes', sc.id + (sc.kind === 'text' ? '.txt' : '.js'));
    const file = path.join(cartDir, rel);
    if (sc.kind === 'text') {
      let ttext;
      try { ttext = readTextFile(file, LIMITS.textBytes, rel.replace(/\\/g, '/')); } catch (e) {
        if (e instanceof Skip) throw e;
        skip(e && e.code === 'ENOENT' ? `${rel.replace(/\\/g, '/')} is missing` : `${rel.replace(/\\/g, '/')} cannot be read: ${errText(e)}`);
      }
      contained(realDir, file, rel.replace(/\\/g, '/'));
      const tr = parseTextScene(ttext);
      if (!tr.ok) skip(`${rel.replace(/\\/g, '/')}: ${tr.reason}`);
      cart.texts[sc.id] = tr;
    } else {
      let fst;
      try { fst = fs.lstatSync(file); } catch (e) { skip(e && e.code === 'ENOENT' ? `${rel.replace(/\\/g, '/')} is missing` : `${rel.replace(/\\/g, '/')} cannot be read: ${errText(e)}`); }
      if (fst.isSymbolicLink()) skip(`${rel.replace(/\\/g, '/')} is a link or junction; links are not followed`);
      if (!fst.isFile()) skip(`${rel.replace(/\\/g, '/')} is not a file`);
      cart.sceneFiles[sc.id] = contained(realDir, file, rel.replace(/\\/g, '/'));
    }
  }
  return cart;
}

export function discoverCartridges({ dirs = [] } = {}) {
  const cartridges = [];
  const errors = [];
  const seen = new Map(); // id -> dir it came from
  for (const { dir, trusted } of dirs) {
    let names;
    try {
      names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.') && (e.isDirectory() || e.isSymbolicLink())).map((e) => e.name).sort();
    } catch (e) {
      if (!e || e.code !== 'ENOENT') errors.push({ where: dir, reason: `cartridge folder cannot be read: ${errText(e)}` });
      continue; // a missing folder (the user folder, usually) is not an error
    }
    for (const name of names) {
      const where = path.join(dir, name);
      try {
        if (cartridges.length >= LIMITS.cartridges) skip(`more than ${LIMITS.cartridges} cartridges; this one is ignored`);
        const cart = loadOne(dir, name, !!trusted);
        if (!cart) continue;
        if (seen.has(cart.id)) skip(`duplicate id '${cart.id}': the cartridge in ${seen.get(cart.id)} wins`);
        seen.set(cart.id, dir);
        cartridges.push(cart);
      } catch (e) {
        errors.push({ where, reason: e instanceof Skip ? e.message : `unexpected problem: ${errText(e)}` });
      }
    }
  }
  cartridges.sort((a, b) => (a.id === 'classic' ? -1 : b.id === 'classic' ? 1 : 0)); // Classic first; the rest keep their order
  return { cartridges, errors };
}

// ---- scene loading

function classicScene(ref) {
  for (const mode of ['calm', 'experimental']) {
    const s = PLAYLISTS[mode].find((x) => x.id === ref);
    if (s) return s;
  }
  return null;
}

function checkExport(mod, sc, file) {
  const s = mod && mod.default;
  const name = `scenes/${sc.id}.js`;
  if (!s || (typeof s !== 'function' && typeof s !== 'object')) return `${name}: the default export must be the scene`;
  if (s.id !== sc.id) return `${name}: the scene's id is ${JSON.stringify(s.id)} but the manifest says '${sc.id}'`;
  const kind = sceneKind(s);
  if (sc.kind === 'field') {
    if (typeof s !== 'function' || s.kind !== undefined) return `${name}: the manifest says 'field' but the scene has kind ${JSON.stringify(sceneKind(s))}`;
    return null;
  }
  if (kind !== sc.kind) return `${name}: the manifest says '${sc.kind}' but the scene has kind ${JSON.stringify(kind)}`;
  if (sc.kind === 'cells' && typeof s !== 'function') return `${name}: a cells scene must be a function`;
  if (sc.kind === 'sim') for (const f of ['init', 'step', 'draw']) if (typeof s[f] !== 'function') return `${name}: a sim scene needs a '${f}' function`;
  return null;
}

// Render at 20x8, t=0 and t=1: every glyph allow-listed, every colour inside the palette.
function smoke(scene, sc, palLen) {
  const name = `scenes/${sc.id}.js`;
  try {
    if (sc.kind === 'field') {
      for (const t of [0, 1]) {
        const out = scene(t, 20, 8, { seed: 1 });
        if (!(out instanceof Uint8Array) || out.length !== 160) return `${name}: smoke render did not return 160 values in a Uint8Array`;
      }
      return null;
    }
    for (const t of [0, 1]) {
      const f = renderScene(scene, t, 20, 8, 1);
      for (let i = 0; i < f.glyphs.length; i++) {
        if (!isAllowedGlyph(f.glyphs[i])) return `${name}: smoke render drew U+${f.glyphs[i].toString(16).toUpperCase().padStart(4, '0')}, which is not an allowed glyph`;
        if (f.colours[i] >= palLen) return `${name}: smoke render used colour ${f.colours[i]} but the palette has ${palLen} entries`;
      }
    }
  } catch (e) {
    return `${name}: smoke render threw: ${errText(e)}`;
  }
  return null;
}

// -> { scenes: [{ id, kind, title, ref?, scene }] in manifest order, errors }. Any error fails the
// whole cartridge: scenes is then empty.
export async function loadScenes(cart) {
  const errors = [];
  const scenes = [];
  const m = cart && cart.manifest;
  if (!m || !Array.isArray(m.scenes)) return { scenes, errors: [{ where: cart && cart.dir, reason: 'this cartridge has no scenes' }] };
  const palLen = paletteLength(cart.skin);
  for (const sc of m.scenes) {
    const where = cart.dir;
    let scene = null;
    let reason = null;
    if (sc.kind === 'builtin') {
      scene = classicScene(sc.ref);
      if (!scene) reason = `builtin '${sc.ref}' is not a calm or experimental scene (${builtinClass(sc.ref) || 'unknown'})`;
    } else if (sc.kind === 'text') {
      const parsed = cart.texts && cart.texts[sc.id];
      if (!parsed) reason = `scenes/${sc.id}.txt was not loaded`;
      else scene = makeTextScene(parsed, { id: sc.id });
    } else if (CODE_KINDS.includes(sc.kind)) {
      if (!cart.trusted) reason = CODE_REASON; // the second wall: nothing is imported unless the install folder owns it
      else if (!cart.sceneFiles || !cart.sceneFiles[sc.id]) reason = `scenes/${sc.id}.js was not found`;
      else {
        try {
          const mod = await import(pathToFileURL(cart.sceneFiles[sc.id]).href);
          reason = checkExport(mod, sc);
          if (!reason) { scene = mod.default; reason = smoke(scene, sc, palLen); }
        } catch (e) {
          reason = `scenes/${sc.id}.js cannot be loaded: ${errText(e)}`;
        }
      }
    }
    if (reason) errors.push({ where, reason });
    else scenes.push({ id: sc.id, kind: sc.kind, title: sc.title, ...(sc.ref ? { ref: sc.ref } : {}), family: sceneFamily(sc), scene });
  }
  return errors.length ? { scenes: [], errors } : { scenes, errors };
}
