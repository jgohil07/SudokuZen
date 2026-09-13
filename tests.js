/* Browser test suite. No tooling: open tests.html and read the results. */

import * as Core from './sudoku-core.js';

const out = document.getElementById('out');
let pass = 0, fail = 0;

function group(name) {
  const h = document.createElement('h2');
  h.textContent = name;
  out.appendChild(h);
}
function ok(cond, msg) {
  const p = document.createElement('p');
  if (cond) { pass++; p.className = 'ok'; p.textContent = 'PASS  ' + msg; }
  else { fail++; p.className = 'bad'; p.textContent = 'FAIL  ' + msg; }
  out.appendChild(p);
}
function note(msg) {
  const p = document.createElement('p');
  p.className = 'note';
  p.textContent = msg;
  out.appendChild(p);
}

const BAND = { Easy: [40, 45], Medium: [32, 36], Hard: [26, 29], Expert: [23, 28] };
const PER = +(new URLSearchParams(location.search).get('n') || 25);

group('Generator — uniqueness is the invariant');
for (const d of Core.DIFFICULTIES) {
  let multi = 0, outOfBand = 0, lo = 99, hi = 0, worst = 0;
  const t0 = performance.now();
  for (let k = 0; k < PER; k++) {
    const s0 = performance.now();
    const g = Core.generate(d, 90000 + k);
    worst = Math.max(worst, performance.now() - s0);
    if (Core.countSolutions(g.puzzle, 2) !== 1) multi++;
    let clues = 0;
    for (let i = 0; i < 81; i++) if (g.puzzle[i]) clues++;
    lo = Math.min(lo, clues); hi = Math.max(hi, clues);
    if (clues < BAND[d][0] || clues > BAND[d][1]) outOfBand++;
  }
  const avg = (performance.now() - t0) / PER;
  ok(multi === 0, d + ': ' + PER + ' puzzles, all uniquely solvable');
  ok(outOfBand === 0, d + ': clue counts ' + lo + '–' + hi + ' within ' + BAND[d].join('–'));
  note('   ' + d + ' — avg ' + avg.toFixed(1) + ' ms, worst ' + worst.toFixed(1) + ' ms');
}

group('Generator — structure');
{
  const g = Core.generate('Medium', 4242);
  ok(Core.isSolved(g.solution), 'the solution is a complete, conflict-free grid');
  let agree = true;
  for (let i = 0; i < 81; i++) if (g.puzzle[i] && g.puzzle[i] !== g.solution[i]) agree = false;
  ok(agree, 'every clue agrees with the solution');
  let centreEmpty = 0;
  for (let k = 0; k < 20; k++) if (!Core.generate('Medium', 500 + k).puzzle[40]) centreEmpty++;
  ok(centreEmpty === 20, 'the centre cell is left empty (20/20)');
}

group('Determinism — daily puzzles and share links depend on it');
{
  const a = Core.generate('Hard', 777), b = Core.generate('Hard', 777), c = Core.generate('Hard', 778);
  ok(a.puzzle.join() === b.puzzle.join(), 'the same seed reproduces the same puzzle');
  ok(a.puzzle.join() !== c.puzzle.join(), 'a different seed gives a different puzzle');
  const d1 = Core.dailySeed(new Date(Date.UTC(2026, 8, 13)));
  const d2 = Core.dailySeed(new Date(Date.UTC(2026, 8, 13)));
  const d3 = Core.dailySeed(new Date(Date.UTC(2026, 8, 14)));
  ok(d1.seed === d2.seed && d1.key === '2026-09-13', 'the daily seed is stable within a day');
  ok(d1.seed !== d3.seed, 'the daily seed changes the next day');
}

group('Conflicts — independent of any stored solution');
{
  let g = new Uint8Array(81); g[0] = 5; g[8] = 5;
  ok(Core.findConflicts(g).size === 2, 'a repeated digit in a row flags both cells');
  g = new Uint8Array(81); g[0] = 5; g[72] = 5;
  ok(Core.findConflicts(g).size === 2, 'a repeated digit in a column flags both cells');
  g = new Uint8Array(81); g[0] = 5; g[10] = 5;
  ok(Core.findConflicts(g).size === 2, 'a repeated digit in a box flags both cells');
  g = new Uint8Array(81); g[0] = 5; g[40] = 5;
  ok(Core.findConflicts(g).size === 0, 'unrelated cells are left alone');

  const sol = Core.generate('Easy', 11).solution;
  ok(Core.findConflicts(sol).size === 0 && Core.isSolved(sol), 'a finished grid wins');
  const broken = Uint8Array.from(sol);
  broken[0] = broken[0] === 1 ? 2 : 1;
  ok(!Core.isSolved(broken), 'a corrupted grid does not win');
  const partial = Uint8Array.from(sol); partial[5] = 0;
  ok(!Core.isSolved(partial) && !Core.isComplete(partial), 'an unfinished grid does not win');
}

group('Hints');
{
  const g = Core.generate('Easy', 31);
  const h = Core.findHint(g.puzzle, g.solution);
  ok(h && h.value === g.solution[h.index], 'a hint places the right digit');
  ok(h && !g.puzzle[h.index], 'a hint targets an empty cell');
  ok(h && ['Naked single', 'Hidden single', 'Revealed'].includes(h.technique),
     'a hint names its technique (' + (h && h.technique) + ')');

  const dirty = Uint8Array.from(g.puzzle);
  let e = -1;
  for (let i = 0; i < 81; i++) if (!dirty[i]) { e = i; break; }
  dirty[e] = g.solution[e] === 9 ? 8 : 9;
  const h2 = Core.findHint(dirty, g.solution);
  ok(h2 && h2.value === g.solution[h2.index],
     'a hint stays correct even when a wrong digit is already on the board');
}

group('Candidates and counts');
{
  const g = Core.generate('Medium', 55);
  const notes = Core.autoNotes(g.puzzle);
  let allContainTruth = true;
  for (let i = 0; i < 81; i++) {
    if (!g.puzzle[i] && !(notes[i] & (1 << (g.solution[i] - 1)))) allContainTruth = false;
  }
  ok(allContainTruth, 'auto pencil marks always include the true answer');
  ok(Core.candidateMask(new Uint8Array(81), 0) === 0x1ff, 'an empty grid allows every digit');
  ok(Core.maskToDigits(0x1ff).length === 9, 'maskToDigits expands a full mask');

  const left = Core.remainingCounts(g.solution);
  let zero = true;
  for (let v = 1; v <= 9; v++) if (left[v] !== 0) zero = false;
  ok(zero, 'a full grid has nothing remaining');
}

group('Storage round-trip');
{
  const KEY = 'sudokuzen.__test';
  try {
    const blob = { v: 1, board: '0'.repeat(81), notes: new Array(81).fill(0), difficulty: 'Hard' };
    localStorage.setItem(KEY, JSON.stringify(blob));
    const back = JSON.parse(localStorage.getItem(KEY));
    ok(back.board.length === 81 && back.difficulty === 'Hard', 'localStorage round-trips the blob');
    localStorage.removeItem(KEY);
    ok(localStorage.getItem(KEY) === null, 'cleanup works');
  } catch (e) {
    ok(false, 'localStorage unavailable: ' + e.message);
  }
}

const sum = document.getElementById('summary');
sum.className = fail === 0 ? 'ok' : 'bad';
sum.textContent = fail === 0
  ? 'ALL PASS — ' + pass + ' assertions'
  : fail + ' FAILED, ' + pass + ' passed';
document.title = (fail === 0 ? 'PASS' : 'FAIL') + ' — Sudoku Zen tests';
