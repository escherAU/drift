// The gallery: every src/art/pieces/*.txt, read once with fs at module load, sorted by
// filename. Adding a file adds a piece. A file that does not parse is skipped and listed in
// GALLERY_ERRORS (a test insists the list is empty), so one bad file cannot stop the screensaver.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePiece } from './engine.js';

export const PIECES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pieces');

export function loadGallery(dir = PIECES_DIR) {
  const pieces = [];
  const errors = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.txt')).sort();
  } catch (e) {
    errors.push({ file: dir, message: e.message });
  }
  for (const file of files) {
    try {
      const piece = parsePiece(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (piece.cells.length === 0) throw new Error('the drawing is blank');
      piece.file = file;
      pieces.push(piece);
    } catch (e) {
      errors.push({ file, message: e.message });
    }
  }
  return { pieces, errors };
}

const loaded = loadGallery();
export const PIECES = loaded.pieces;
export const GALLERY_ERRORS = loaded.errors;
