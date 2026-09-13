/* sudoku-state.js — game state, undo/redo, stats and localStorage persistence.
   Knows nothing about the DOM. The UI reads `state` and calls these actions. */

import * as Core from './sudoku-core.js';

const KEY = 'sudokuzen.v1';
const SEEN_KEY = 'sudokuzen.seen';      /* sessionStorage: seen the resume prompt already */
const UNDO_CAP = 200;

export const HINT_BUDGET = { Easy: 3, Medium: 4, Hard: 5, Expert: 6 };
export const MISTAKE_LIMIT = 3;

/* ---- storage helpers, all failure-tolerant (private mode, blocked cookies) ---- */

function readRaw(store, k) {
  try { return store.getItem(k); } catch (e) { return null; }
}
function writeRaw(store, k, v) {
  try { store.setItem(k, v); } catch (e) { /* quota or blocked — play on without saving */ }
}
function removeRaw(store, k) {
  try { store.removeItem(k); } catch (e) {}
}

const emptyStats = () => ({
  played: 0, won: 0, best: null, streak: 0, bestStreak: 0, totalTime: 0, flawless: 0
});

function freshStats() {
  const s = {};
  Core.DIFFICULTIES.forEach(d => { s[d] = emptyStats(); });
  return s;
}

/* ---- the live state ---- */

export const state = {
  board: new Uint8Array(81),
  givens: new Uint8Array(81),
  solution: new Uint8Array(81),
  notes: new Uint16Array(81),

  difficulty: 'Medium',
  seed: 0,
  mode: 'normal',          /* 'normal' | 'daily' */
  dailyKey: '',

  elapsed: 0,
  running: false,
  status: 'idle',          /* 'idle' | 'playing' | 'solved' */

  mistakes: 0,
  hintsUsed: 0,
  moveCount: 0,
  overLimitAcknowledged: false,

  selected: -1,
  notesMode: false,
  autoNotesOn: false,

  theme: null,             /* null = follow system */
  undo: [],
  redo: [],
  stats: freshStats()
};

/* ---- serialisation ---- */

const digits = a => Array.from(a).join('');
const fromDigits = (s, Type) => {
  const out = new Type(81);
  if (typeof s === 'string') for (let i = 0; i < 81 && i < s.length; i++) out[i] = +s[i] || 0;
  return out;
};

function snapshot() {
  /* An explicit whitelist, not JSON.stringify(state) — transient fields must
     never leak into storage. */
  return {
    v: 1,
    board: digits(state.board),
    givens: digits(state.givens),
    solution: digits(state.solution),
    notes: Array.from(state.notes),
    difficulty: state.difficulty,
    seed: state.seed,
    mode: state.mode,
    dailyKey: state.dailyKey,
    elapsed: state.elapsed,
    status: state.status,
    mistakes: state.mistakes,
    hintsUsed: state.hintsUsed,
    moveCount: state.moveCount,
    overLimitAcknowledged: state.overLimitAcknowledged,
    selected: state.selected,
    notesMode: state.notesMode,
    autoNotesOn: state.autoNotesOn,
    theme: state.theme,
    undo: state.undo.slice(-UNDO_CAP),
    redo: state.redo.slice(-UNDO_CAP),
    stats: state.stats,
    savedAt: Date.now()
  };
}

/* Reads the saved blob without applying it, so the UI can offer to resume. */
export function peek() {
  const raw = readRaw(localStorage, KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (!s || s.v !== 1) return null;
    return s;
  } catch (e) {
    return null;
  }
}

export function hydrate(s) {
  if (!s) return false;
  try {
    state.board = fromDigits(s.board, Uint8Array);
    state.givens = fromDigits(s.givens, Uint8Array);
    state.solution = fromDigits(s.solution, Uint8Array);
    state.notes = new Uint16Array(81);
    if (Array.isArray(s.notes)) for (let i = 0; i < 81; i++) state.notes[i] = s.notes[i] | 0;

    /* Defaults merged *over* the stored blob, so a field added in a later
       version can never read back undefined for a returning player. */
    state.difficulty = Core.DIFFICULTIES.indexOf(s.difficulty) >= 0 ? s.difficulty : 'Medium';
    state.seed = s.seed | 0;
    state.mode = s.mode === 'daily' ? 'daily' : 'normal';
    state.dailyKey = s.dailyKey || '';
    state.elapsed = Math.max(0, s.elapsed | 0);
    state.status = s.status === 'solved' ? 'solved' : 'playing';
    state.mistakes = Math.max(0, s.mistakes | 0);
    state.hintsUsed = Math.max(0, s.hintsUsed | 0);
    state.moveCount = Math.max(0, s.moveCount | 0);
    state.overLimitAcknowledged = !!s.overLimitAcknowledged;
    state.selected = typeof s.selected === 'number' && s.selected >= 0 && s.selected < 81 ? s.selected : -1;
    state.notesMode = !!s.notesMode;
    state.autoNotesOn = !!s.autoNotesOn;
    state.undo = Array.isArray(s.undo) ? s.undo.slice(-UNDO_CAP) : [];
    state.redo = Array.isArray(s.redo) ? s.redo.slice(-UNDO_CAP) : [];
    state.running = false;
    return true;
  } catch (e) {
    return false;
  }
}

export function loadStats() {
  const s = peek();
  const stats = freshStats();
  if (s && s.stats) {
    Core.DIFFICULTIES.forEach(d => {
      const v = s.stats[d];
      if (v) Object.assign(stats[d], v);
    });
  }
  state.stats = stats;
  if (s && (s.theme === 'light' || s.theme === 'dark')) state.theme = s.theme;
  return stats;
}

/* ---- writing: debounced, never once per timer tick ---- */

let pending = null;

export function flush() {
  if (pending) { clearTimeout(pending); pending = null; }
  writeRaw(localStorage, KEY, JSON.stringify(snapshot()));
}

export function save() {
  if (pending) return;
  pending = setTimeout(() => { pending = null; flush(); }, 500);
}

export function clearGame() {
  state.status = 'idle';
  flush();
}

/* The resume prompt should appear when the site is genuinely reopened, but not
   nag on an in-session refresh. */
export function markSeen() { writeRaw(sessionStorage, SEEN_KEY, '1'); }
export function wasSeen() { return readRaw(sessionStorage, SEEN_KEY) === '1'; }

/* ---- new game ---- */

export function newGame(difficulty, opts) {
  opts = opts || {};
  const mode = opts.mode === 'daily' ? 'daily' : 'normal';
  let seed = opts.seed;
  let dailyKey = '';

  if (mode === 'daily') {
    const d = Core.dailySeed();
    dailyKey = d.key;
    seed = Core.hashSeed(d.key + ':' + difficulty);
  }

  const g = Core.generate(difficulty, seed);

  state.board = Uint8Array.from(g.puzzle);
  state.solution = g.solution;
  state.givens = new Uint8Array(81);
  for (let i = 0; i < 81; i++) state.givens[i] = g.puzzle[i] ? 1 : 0;
  state.notes = new Uint16Array(81);

  state.difficulty = g.difficulty;
  state.seed = g.seed;
  state.mode = mode;
  state.dailyKey = dailyKey;

  state.elapsed = 0;
  state.running = false;
  state.status = 'playing';
  state.mistakes = 0;
  state.hintsUsed = 0;
  state.moveCount = 0;
  state.overLimitAcknowledged = false;
  state.selected = -1;
  state.notesMode = false;
  state.undo = [];
  state.redo = [];

  if (state.autoNotesOn) state.notes = Core.autoNotes(state.board);

  flush();
  return g;
}

/* ---- moves ---- */

/* One undo entry covers a set of cells, so a single move and a bulk auto-notes
   fill share the same shape. */
function pushUndo(cells) {
  if (!cells.length) return;
  state.undo.push(cells);
  if (state.undo.length > UNDO_CAP) state.undo.shift();
  state.redo.length = 0;
}

function cellBefore(i) {
  return { i: i, v0: state.board[i], n0: state.notes[i] };
}
function cellAfter(rec) {
  rec.v1 = state.board[rec.i];
  rec.n1 = state.notes[rec.i];
  return rec;
}

/* Placing a digit clears that digit from the notes of every peer. */
function pruneNotes(i, v, touched) {
  const bit = 1 << (v - 1);
  const r = Core.ROW[i], c = Core.COL[i], b = Core.BOX[i];
  for (let j = 0; j < 81; j++) {
    if (j === i || !state.notes[j]) continue;
    if (Core.ROW[j] !== r && Core.COL[j] !== c && Core.BOX[j] !== b) continue;
    if (state.notes[j] & bit) {
      const rec = cellBefore(j);
      state.notes[j] &= ~bit;
      touched.push(cellAfter(rec));
    }
  }
}

export function place(i, v) {
  if (state.status !== 'playing') return { ok: false, reason: 'not-playing' };
  if (state.givens[i]) return { ok: false, reason: 'given' };
  if (v < 1 || v > 9) return { ok: false, reason: 'range' };

  /* Tapping the digit already in the cell clears it. */
  if (state.board[i] === v) return erase(i);

  const wasFirstMove = state.moveCount === 0;
  const touched = [];
  const rec = cellBefore(i);
  state.board[i] = v;
  state.notes[i] = 0;
  touched.push(cellAfter(rec));

  if (state.autoNotesOn) pruneNotes(i, v, touched);
  pushUndo(touched);
  state.moveCount++;

  /* Uniqueness is now guaranteed by the generator, so the stored solution is
     the only correct answer and comparing against it is sound. */
  const mistake = v !== state.solution[i];
  if (mistake) state.mistakes++;

  const solved = Core.isSolved(state.board);
  if (solved) {
    state.status = 'solved';
    state.running = false;
    recordWin();
  }

  /* the still point: a 5 dropped into the exact centre as the opening move */
  const egg = wasFirstMove && i === 40 && v === 5;

  save();
  return { ok: true, mistake, solved, egg, overLimit: state.mistakes >= MISTAKE_LIMIT && !state.overLimitAcknowledged };
}

export function toggleNote(i, v) {
  if (state.status !== 'playing') return { ok: false };
  if (state.givens[i] || state.board[i]) return { ok: false, reason: 'filled' };
  if (v < 1 || v > 9) return { ok: false };
  const rec = cellBefore(i);
  state.notes[i] ^= 1 << (v - 1);
  pushUndo([cellAfter(rec)]);
  save();
  return { ok: true };
}

export function erase(i) {
  if (state.status !== 'playing') return { ok: false, reason: 'not-playing' };
  if (state.givens[i]) return { ok: false, reason: 'given' };
  if (!state.board[i] && !state.notes[i]) return { ok: false, reason: 'empty' };
  const rec = cellBefore(i);
  state.board[i] = 0;
  state.notes[i] = 0;
  pushUndo([cellAfter(rec)]);
  save();
  return { ok: true, erased: true };
}

export function hint() {
  if (state.status !== 'playing') return null;
  if (state.hintsUsed >= (HINT_BUDGET[state.difficulty] || 3)) return { exhausted: true };

  const h = Core.findHint(state.board, state.solution);
  if (!h) return null;

  const touched = [];
  const rec = cellBefore(h.index);
  state.board[h.index] = h.value;
  state.notes[h.index] = 0;
  touched.push(cellAfter(rec));
  if (state.autoNotesOn) pruneNotes(h.index, h.value, touched);
  pushUndo(touched);

  state.hintsUsed++;
  state.moveCount++;

  const solved = Core.isSolved(state.board);
  if (solved) { state.status = 'solved'; state.running = false; recordWin(); }

  save();
  return { index: h.index, value: h.value, technique: h.technique, solved };
}

export function fillAutoNotes() {
  const want = Core.autoNotes(state.board);
  const touched = [];
  for (let i = 0; i < 81; i++) {
    if (state.notes[i] !== want[i]) {
      const rec = cellBefore(i);
      state.notes[i] = want[i];
      touched.push(cellAfter(rec));
    }
  }
  pushUndo(touched);
  save();
  return touched.length;
}

export function clearAllNotes() {
  const touched = [];
  for (let i = 0; i < 81; i++) {
    if (state.notes[i]) {
      const rec = cellBefore(i);
      state.notes[i] = 0;
      touched.push(cellAfter(rec));
    }
  }
  pushUndo(touched);
  save();
  return touched.length;
}

function applyEntry(cells, dir) {
  for (let k = 0; k < cells.length; k++) {
    const c = cells[k];
    state.board[c.i] = dir === 'undo' ? (c.v0 | 0) : (c.v1 | 0);
    state.notes[c.i] = dir === 'undo' ? (c.n0 | 0) : (c.n1 | 0);
  }
  /* Stepping back out of a solved board must revert the status too — the old
     implementation set the board directly and left the game stuck as solved. */
  state.status = Core.isSolved(state.board) ? 'solved' : 'playing';
  save();
}

export function undo() {
  if (!state.undo.length) return false;
  const entry = state.undo.pop();
  state.redo.push(entry);
  applyEntry(entry, 'undo');
  return true;
}

export function redo() {
  if (!state.redo.length) return false;
  const entry = state.redo.pop();
  state.undo.push(entry);
  applyEntry(entry, 'redo');
  return true;
}

export const canUndo = () => state.undo.length > 0;
export const canRedo = () => state.redo.length > 0;

/* ---- stats ---- */

function statsFor(d) {
  if (!state.stats[d]) state.stats[d] = emptyStats();
  return state.stats[d];
}

/* Counted on completion, not at the start — starting a puzzle and walking away
   should not drag the win rate down. */
export function recordWin() {
  const s = statsFor(state.difficulty);
  s.played++;
  s.won++;
  s.totalTime += state.elapsed;
  s.streak++;
  if (s.streak > s.bestStreak) s.bestStreak = s.streak;
  if (s.best === null || state.elapsed < s.best) s.best = state.elapsed;
  if (state.mistakes === 0 && state.hintsUsed === 0) s.flawless++;
  flush();
}

export function recordAbandon() {
  if (state.status !== 'playing' || state.moveCount === 0) return;
  const s = statsFor(state.difficulty);
  s.played++;
  s.streak = 0;
  flush();
}

export function filledCount() {
  let n = 0;
  for (let i = 0; i < 81; i++) if (state.board[i]) n++;
  return n;
}

export function hintsLeft() {
  return Math.max(0, (HINT_BUDGET[state.difficulty] || 3) - state.hintsUsed);
}
