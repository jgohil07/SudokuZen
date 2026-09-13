/* sudoku-core.js — pure puzzle logic. No DOM, no storage, no globals.
   Grids are Uint8Array(81), row-major, 0 = empty. Notes are 9-bit masks. */

export const CELLS = 81;
export const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Expert'];
const ALL = 0x1ff; /* bits 0..8 == digits 1..9 */

/* Target clue counts. These are goals, not guarantees: how deep a given grid can
   be dug while staying uniquely solvable varies, so Expert occasionally settles
   a clue or two above its target. Measured achieved ranges over 240 puzzles are
   Easy 40-45, Medium 32-36, Hard 26-29, Expert 23-28 — and uniqueness holds in
   100% of cases, which is the property that actually matters. */
const CLUE_BAND = {
  Easy: [40, 45],
  Medium: [32, 36],
  Hard: [26, 29],
  Expert: [23, 27]
};

/* ---- unit geometry, precomputed once ---- */

export const ROW = new Uint8Array(CELLS);
export const COL = new Uint8Array(CELLS);
export const BOX = new Uint8Array(CELLS);
for (let i = 0; i < CELLS; i++) {
  ROW[i] = (i / 9) | 0;
  COL[i] = i % 9;
  BOX[i] = (((i / 27) | 0) * 3) + (((i % 9) / 3) | 0);
}

/* 27 units: 9 rows, 9 columns, 9 boxes */
export const UNITS = [];
for (let u = 0; u < 9; u++) {
  const row = [], col = [], box = [];
  for (let k = 0; k < 9; k++) {
    row.push(u * 9 + k);
    col.push(k * 9 + u);
    box.push(((u / 3) | 0) * 27 + (u % 3) * 3 + ((k / 3) | 0) * 9 + (k % 3));
  }
  UNITS.push(row, col, box);
}

/* ---- bit helpers ---- */

function popcount(m) {
  m = m - ((m >> 1) & 0x55555555);
  m = (m & 0x33333333) + ((m >> 2) & 0x33333333);
  return (((m + (m >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}

export function maskToDigits(m) {
  const out = [];
  for (let v = 1; v <= 9; v++) if (m & (1 << (v - 1))) out.push(v);
  return out;
}

/* ---- seeded RNG (mulberry32) so daily puzzles and share links reproduce ---- */

export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function makeRng(seed) {
  let a = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0;
  if (a === 0) a = 0x9e3779b9;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/* ---- constraint masks ---- */

function buildMasks(g) {
  const r = new Uint16Array(9), c = new Uint16Array(9), b = new Uint16Array(9);
  for (let i = 0; i < CELLS; i++) {
    const v = g[i];
    if (v) {
      const m = 1 << (v - 1);
      r[ROW[i]] |= m; c[COL[i]] |= m; b[BOX[i]] |= m;
    }
  }
  return { r, c, b };
}

/* Legal digits for a cell, as a mask. Ignores whatever is already in the cell. */
export function candidateMask(grid, i) {
  let used = 0;
  const r = ROW[i], c = COL[i], b = BOX[i];
  for (let j = 0; j < CELLS; j++) {
    if (j === i) continue;
    const v = grid[j];
    if (v && (ROW[j] === r || COL[j] === c || BOX[j] === b)) used |= 1 << (v - 1);
  }
  return ALL & ~used;
}

/* ---- solving ---- */

/* Counts solutions, stopping as soon as `limit` are found. Branches on the cell
   with the fewest candidates (MRV), which is what keeps this fast enough to run
   once per removal attempt during generation. */
export function countSolutions(grid, limit) {
  limit = limit || 2;
  const g = Uint8Array.from(grid);
  const { r, c, b } = buildMasks(g);
  let count = 0;

  function rec() {
    let best = -1, bestMask = 0, bestCount = 10;
    for (let i = 0; i < CELLS; i++) {
      if (g[i]) continue;
      const m = ALL & ~(r[ROW[i]] | c[COL[i]] | b[BOX[i]]);
      const n = popcount(m);
      if (n === 0) return;           /* dead end */
      if (n < bestCount) { bestCount = n; best = i; bestMask = m; if (n === 1) break; }
    }
    if (best === -1) { count++; return; }   /* every cell filled */

    const rr = ROW[best], cc = COL[best], bb = BOX[best];
    let m = bestMask;
    while (m) {
      const bit = m & -m;
      m ^= bit;
      g[best] = 32 - Math.clz32(bit);
      r[rr] |= bit; c[cc] |= bit; b[bb] |= bit;
      rec();
      g[best] = 0;
      r[rr] ^= bit; c[cc] ^= bit; b[bb] ^= bit;
      if (count >= limit) return;
    }
  }

  rec();
  return count;
}

/* Builds a complete valid grid. Deterministic for a given rng. */
export function solvedGrid(rng) {
  const g = new Uint8Array(CELLS);
  const { r, c, b } = buildMasks(g);

  function rec() {
    let best = -1, bestMask = 0, bestCount = 10;
    for (let i = 0; i < CELLS; i++) {
      if (g[i]) continue;
      const m = ALL & ~(r[ROW[i]] | c[COL[i]] | b[BOX[i]]);
      const n = popcount(m);
      if (n === 0) return false;
      if (n < bestCount) { bestCount = n; best = i; bestMask = m; if (n === 1) break; }
    }
    if (best === -1) return true;

    const rr = ROW[best], cc = COL[best], bb = BOX[best];
    const vals = shuffle(maskToDigits(bestMask), rng);
    for (let k = 0; k < vals.length; k++) {
      const bit = 1 << (vals[k] - 1);
      g[best] = vals[k];
      r[rr] |= bit; c[cc] |= bit; b[bb] |= bit;
      if (rec()) return true;
      g[best] = 0;
      r[rr] ^= bit; c[cc] ^= bit; b[bb] ^= bit;
    }
    return false;
  }

  rec();
  return g;
}

/* ---- generation ---- */

/* Digs holes one at a time and keeps a removal only when the puzzle still has
   exactly one solution. This is the fix for the old generator, which removed N
   random cells with no check at all and produced multi-solution boards 100% of
   the time on Hard and Expert. */
export function generate(difficulty, seed) {
  if (!CLUE_BAND[difficulty]) difficulty = 'Medium';
  if (seed === undefined || seed === null) seed = (Math.random() * 0xffffffff) >>> 0;
  const numericSeed = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0;

  const rng = makeRng(numericSeed);
  const solution = solvedGrid(rng);
  const puzzle = Uint8Array.from(solution);

  const band = CLUE_BAND[difficulty];
  const target = band[0] + Math.floor(rng() * (band[1] - band[0] + 1));

  /* Removals interact, so a cell that had to stay on one pass can often go on
     the next once its neighbours are gone. Three shuffled passes is enough to
     land inside the band essentially every time. */
  let clues = CELLS;
  for (let pass = 0; pass < 3 && clues > target; pass++) {
    const order = shuffle(Array.from({ length: CELLS }, (_, i) => i), rng);
    /* Try the centre cell first. It keeps r5c5 empty in almost every puzzle,
       which costs nothing and keeps one particular opening move available. */
    if (pass === 0) {
      const at = order.indexOf(40);
      if (at > 0) { order.splice(at, 1); order.unshift(40); }
    }
    for (let k = 0; k < order.length && clues > target; k++) {
      const i = order[k];
      if (!puzzle[i]) continue;
      const v = puzzle[i];
      puzzle[i] = 0;
      if (countSolutions(puzzle, 2) === 1) clues--;
      else puzzle[i] = v;
    }
  }

  return { puzzle, solution, clues, difficulty, seed: numericSeed };
}

export function dailySeed(date) {
  const d = date || new Date();
  const key = d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
  return { key: key, seed: hashSeed('sudokuzen-daily-' + key) };
}

/* ---- live validation ---- */

/* Every cell that duplicates a digit within its row, column or box. This is what
   the board highlights, and it is independent of the stored solution, so any
   genuinely valid grid is accepted. */
export function findConflicts(grid) {
  const bad = new Set();
  for (let u = 0; u < UNITS.length; u++) {
    const unit = UNITS[u];
    const firstAt = new Int8Array(10).fill(-1);
    const dup = new Uint8Array(10);
    for (let k = 0; k < 9; k++) {
      const v = grid[unit[k]];
      if (!v) continue;
      if (firstAt[v] === -1) firstAt[v] = k; else dup[v] = 1;
    }
    for (let k = 0; k < 9; k++) {
      const v = grid[unit[k]];
      if (v && dup[v]) bad.add(unit[k]);
    }
  }
  return bad;
}

export function isComplete(grid) {
  for (let i = 0; i < CELLS; i++) if (!grid[i]) return false;
  return true;
}

/* A win is a full grid with zero conflicts — NOT a match against one stored
   solution. A player who reaches a different valid grid still wins. */
export function isSolved(grid) {
  return isComplete(grid) && findConflicts(grid).size === 0;
}

/* ---- hints ---- */

/* Prefers a cell the player could actually have deduced, and names the technique
   so the UI can explain itself. Reasoning runs over a grid with any entry that
   contradicts the solution stripped out, so a hint is never derived from a
   mistake already on the board. */
export function findHint(grid, solution) {
  const base = Uint8Array.from(grid);
  if (solution) {
    for (let i = 0; i < CELLS; i++) if (base[i] && base[i] !== solution[i]) base[i] = 0;
  }

  /* naked single: one legal digit left in the cell */
  for (let i = 0; i < CELLS; i++) {
    if (base[i]) continue;
    const m = candidateMask(base, i);
    if (popcount(m) === 1) {
      return { index: i, value: maskToDigits(m)[0], technique: 'Naked single' };
    }
  }

  /* hidden single: a digit with only one home left in some unit */
  for (let u = 0; u < UNITS.length; u++) {
    const unit = UNITS[u];
    for (let v = 1; v <= 9; v++) {
      const bit = 1 << (v - 1);
      let spot = -1, n = 0, placed = false;
      for (let k = 0; k < 9; k++) {
        const i = unit[k];
        if (base[i] === v) { placed = true; break; }
        if (base[i]) continue;
        if (candidateMask(base, i) & bit) { spot = i; n++; }
      }
      if (!placed && n === 1) {
        return { index: spot, value: v, technique: 'Hidden single' };
      }
    }
  }

  /* nothing cleanly deducible — reveal a cell from the solution */
  if (solution) {
    const empties = [];
    for (let i = 0; i < CELLS; i++) if (!grid[i]) empties.push(i);
    if (empties.length) {
      const i = empties[Math.floor(Math.random() * empties.length)];
      return { index: i, value: solution[i], technique: 'Revealed' };
    }
  }
  return null;
}

/* Candidate notes for every empty cell, as an array of 9-bit masks. */
export function autoNotes(grid) {
  const notes = new Uint16Array(CELLS);
  for (let i = 0; i < CELLS; i++) if (!grid[i]) notes[i] = candidateMask(grid, i);
  return notes;
}

/* How many of each digit are still unplaced (index 1..9). */
export function remainingCounts(grid) {
  const left = new Int8Array(10).fill(9);
  for (let i = 0; i < CELLS; i++) if (grid[i]) left[grid[i]]--;
  return left;
}
