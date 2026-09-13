/* sudoku-ui.js — rendering, input and dialogs. The only module that touches the DOM. */

import * as Core from './sudoku-core.js';
import * as S from './sudoku-state.js';

const state = S.state;
const $ = id => document.getElementById(id);

const el = {
  board: $('board'), boardWrap: $('boardWrap'), pad: $('pad'), stats: $('stats'),
  difficulty: $('difficulty'), dailyBadge: $('dailyBadge'),
  mMistakes: $('mMistakes'), mHints: $('mHints'), mTime: $('mTime'),
  pauseBtn: $('pauseBtn'), pauseIcon: $('pauseIcon'), resumeBtn: $('resumeBtn'),
  notesBtn: $('notesBtn'), autoBtn: $('autoBtn'), hintBtn: $('hintBtn'), hintCnt: $('hintCnt'),
  undoBtn: $('undoBtn'), redoBtn: $('redoBtn'),
  newBtn: $('newBtn'), dailyBtn: $('dailyBtn'), shareBtn: $('shareBtn'),
  themeBtn: $('themeBtn'), themeIcon: $('themeIcon'),
  toast: $('toast'),
  resumeDlg: $('resumeDlg'), resumeMeta: $('resumeMeta'), resumeYes: $('resumeYes'), resumeNo: $('resumeNo'),
  confirmDlg: $('confirmDlg'), confirmBody: $('confirmBody'), confirmYes: $('confirmYes'), confirmNo: $('confirmNo'),
  limitDlg: $('limitDlg'), limitRestart: $('limitRestart'), limitContinue: $('limitContinue'),
  winDlg: $('winDlg'), winSub: $('winSub'), winSummary: $('winSummary'),
  winAgain: $('winAgain'), winClose: $('winClose'), confetti: $('confetti')
};

const cells = [];
const keys = [];

/* ---- helpers ---- */

function fmt(sec) {
  sec = Math.max(0, sec | 0);
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return h + ':' + String(m % 60).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

let toastTimer = null;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.dataset.show = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.dataset.show = '0'; }, 2200);
}

const isPaused = () => state.status === 'playing' && !state.running;

/* ---- dialogs ---- */

let lastFocus = null;
let openDialog = null;

function openDlg(node, focusEl) {
  lastFocus = document.activeElement;
  node.dataset.open = '1';
  openDialog = node;
  if (focusEl) setTimeout(() => focusEl.focus(), 0);
}
function closeDlg(node) {
  node.dataset.open = '0';
  if (openDialog === node) openDialog = null;
  if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  lastFocus = null;
}

/* ---- build the board and pad once ---- */

function buildBoard() {
  const frag = document.createDocumentFragment();
  for (let r = 0; r < 9; r++) {
    const row = document.createElement('div');
    row.className = 'brow';
    row.setAttribute('role', 'row');
    for (let c = 0; c < 9; c++) {
      const i = r * 9 + c;
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.setAttribute('role', 'gridcell');
      cell.tabIndex = -1;
      cell.dataset.i = i;

      const v = document.createElement('span');
      v.className = 'v';
      cell.appendChild(v);

      const notes = document.createElement('div');
      notes.className = 'notes';
      notes.setAttribute('aria-hidden', 'true');
      for (let n = 1; n <= 9; n++) notes.appendChild(document.createElement('span'));
      cell.appendChild(notes);

      row.appendChild(cell);
      cells.push({ root: cell, v: v, notes: notes.children });
    }
    frag.appendChild(row);
  }
  el.board.appendChild(frag);

  el.board.addEventListener('click', ev => {
    const t = ev.target.closest('.cell');
    if (!t) return;
    select(+t.dataset.i);
  });
}

function buildPad() {
  const frag = document.createDocumentFragment();
  for (let n = 1; n <= 9; n++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'key';
    b.dataset.n = n;
    b.setAttribute('aria-label', 'Enter ' + n);
    b.innerHTML = '<span class="d">' + n + '</span><span class="left"></span>';
    frag.appendChild(b);
    keys.push(b);
  }
  const e = document.createElement('button');
  e.type = 'button';
  e.className = 'key';
  e.dataset.erase = '1';
  e.setAttribute('aria-label', 'Erase');
  e.innerHTML = '<svg aria-hidden="true"><use href="#i-erase"></use></svg>';
  frag.appendChild(e);
  el.pad.appendChild(frag);

  el.pad.addEventListener('click', ev => {
    const b = ev.target.closest('.key');
    if (!b) return;
    if (b.dataset.erase) doErase();
    else input(+b.dataset.n);
  });
}

/* ---- render ---- */

function render() {
  const sel = state.selected;
  const conflicts = Core.findConflicts(state.board);
  const selVal = sel >= 0 ? state.board[sel] : 0;
  const sr = sel >= 0 ? Core.ROW[sel] : -1;
  const sc = sel >= 0 ? Core.COL[sel] : -1;
  const sb = sel >= 0 ? Core.BOX[sel] : -1;

  for (let i = 0; i < 81; i++) {
    const c = cells[i];
    const val = state.board[i];
    const note = state.notes[i];
    const cls = ['cell'];

    if (i === sel) cls.push('sel');
    else if (sr >= 0 && (Core.ROW[i] === sr || Core.COL[i] === sc || Core.BOX[i] === sb)) cls.push('peer');
    if (selVal && val === selVal && i !== sel) cls.push('same');

    if (val) {
      cls.push(state.givens[i] ? 'given' : 'entered');
      if (conflicts.has(i)) cls.push('conflict');
      if (c.v.textContent !== String(val)) c.v.textContent = val;
    } else {
      if (c.v.textContent !== '') c.v.textContent = '';
      if (note) {
        cls.push('notes-on');
        for (let n = 1; n <= 9; n++) {
          const on = !!(note & (1 << (n - 1)));
          const span = c.notes[n - 1];
          const txt = on ? String(n) : '';
          if (span.textContent !== txt) span.textContent = txt;
        }
      }
    }

    const next = cls.join(' ');
    if (c.root.className !== next) c.root.className = next;
    c.root.tabIndex = (i === sel || (sel < 0 && i === 0)) ? 0 : -1;

    const rr = Core.ROW[i] + 1, cc = Core.COL[i] + 1;
    let label = 'Row ' + rr + ', column ' + cc + ', ';
    if (val) label += val + (state.givens[i] ? ', given' : '');
    else if (note) label += 'notes ' + Core.maskToDigits(note).join(' ');
    else label += 'empty';
    c.root.setAttribute('aria-label', label);
  }

  /* keypad: how many of each digit are still unplaced */
  const left = Core.remainingCounts(state.board);
  for (let n = 1; n <= 9; n++) {
    const b = keys[n - 1];
    const remaining = Math.max(0, left[n]);
    b.classList.toggle('done', remaining === 0);
    b.querySelector('.left').textContent = remaining || '';
    b.dataset.note = state.notesMode ? 'on' : 'off';
  }

  /* meters */
  el.mMistakes.textContent = state.mistakes + '/' + S.MISTAKE_LIMIT;
  el.mMistakes.classList.toggle('warn', state.mistakes >= S.MISTAKE_LIMIT);
  const hl = S.hintsLeft();
  el.mHints.textContent = hl;
  el.hintCnt.textContent = hl;
  el.mTime.textContent = fmt(state.elapsed);
  el.dailyBadge.hidden = state.mode !== 'daily';

  el.notesBtn.setAttribute('aria-pressed', String(state.notesMode));
  el.autoBtn.setAttribute('aria-pressed', String(state.autoNotesOn));
  el.hintBtn.disabled = hl === 0 || state.status !== 'playing';
  el.undoBtn.disabled = !S.canUndo();
  el.redoBtn.disabled = !S.canRedo();

  el.boardWrap.classList.toggle('paused', isPaused());
  el.pauseIcon.firstElementChild.setAttribute('href', state.running ? '#i-pause' : '#i-play');
  el.pauseBtn.setAttribute('aria-label', state.running ? 'Pause the timer' : 'Resume the timer');

  Array.from(el.difficulty.children).forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.diff === state.difficulty));
  });

  renderStats();
}

function renderStats() {
  const s = state.stats[state.difficulty] || { played: 0, won: 0, best: null, streak: 0 };
  const rate = s.played > 0 ? Math.round((s.won / s.played) * 100) : 0;
  const tiles = [
    [s.won, 'Solved'],
    [rate + '%', 'Win rate'],
    [s.best === null ? '—' : fmt(s.best), 'Best'],
    [s.streak, 'Streak']
  ];
  el.stats.innerHTML = tiles
    .map(t => '<div class="stat"><span class="v">' + t[0] + '</span><span class="l">' + t[1] + '</span></div>')
    .join('');
}

/* ---- interaction ---- */

function select(i) {
  if (i < 0 || i > 80) return;
  state.selected = i;
  render();
  cells[i].root.focus({ preventScroll: true });
  S.save();
}

function shake() {
  el.board.classList.remove('shake');
  void el.board.offsetWidth;
  el.board.classList.add('shake');
  setTimeout(() => el.board.classList.remove('shake'), 320);
}

function flash(i) {
  const c = cells[i].root;
  c.classList.remove('flash');
  void c.offsetWidth;
  c.classList.add('flash');
  setTimeout(() => c.classList.remove('flash'), 900);
}

function input(n) {
  if (state.status !== 'playing' || isPaused()) return;
  const i = state.selected;
  if (i < 0) { toast('Pick a cell first'); return; }
  if (state.givens[i]) { shake(); return; }

  const res = state.notesMode ? S.toggleNote(i, n) : S.place(i, n);
  if (!res.ok) { if (res.reason === 'given' || res.reason === 'filled') shake(); render(); return; }

  render();

  if (res.egg && window.__zenEgg) window.__zenEgg();
  if (res.solved) { win(); return; }
  if (res.overLimit) {
    state.overLimitAcknowledged = true;
    openDlg(el.limitDlg, el.limitContinue);
  }
}

function doErase() {
  if (state.status !== 'playing' || isPaused()) return;
  const i = state.selected;
  if (i < 0) return;
  const res = S.erase(i);
  if (!res.ok && res.reason === 'given') shake();
  render();
}

function doHint() {
  if (state.status !== 'playing' || isPaused()) return;
  const h = S.hint();
  if (!h) return;
  if (h.exhausted) { toast('No hints left on ' + state.difficulty); return; }
  state.selected = h.index;
  render();
  flash(h.index);
  toast(h.technique === 'Revealed' ? 'Revealed ' + h.value : h.technique + ' — ' + h.value);
  if (h.solved) win();
}

/* ---- timer ---- */

let tick = null;
let persistTick = null;

function startClock() {
  if (tick) return;
  tick = setInterval(() => {
    if (!state.running) return;
    state.elapsed++;
    el.mTime.textContent = fmt(state.elapsed);
  }, 1000);
  /* The old build wrote the whole board to localStorage once a second. The
     timer now rides along on a slow heartbeat plus the lifecycle events. */
  persistTick = setInterval(() => { if (state.running) S.flush(); }, 15000);
}

function setRunning(on) {
  state.running = !!on && state.status === 'playing';
  if (!state.running) S.flush();
  render();
}

/* ---- game lifecycle ---- */

function startGame(difficulty, opts) {
  S.newGame(difficulty, opts);
  state.selected = -1;
  S.markSeen();
  setRunning(true);
  render();
}

function win() {
  setRunning(false);
  const s = state.stats[state.difficulty];
  const flawless = state.mistakes === 0 && state.hintsUsed === 0;
  el.winSub.textContent = flawless
    ? 'No mistakes, no hints. Clean solve.'
    : 'Nicely done.';
  el.winSummary.innerHTML = [
    ['Time', fmt(state.elapsed)],
    ['Mistakes', state.mistakes],
    ['Hints', state.hintsUsed],
    ['Best', s && s.best !== null ? fmt(s.best) : '—']
  ].map(t => '<div><span class="v">' + t[1] + '</span><span class="l">' + t[0] + '</span></div>').join('');

  confettiBurst();
  openDlg(el.winDlg, el.winAgain);
  render();
}

function confettiBurst() {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const hues = [168, 172, 158, 186, 150];
  let html = '';
  for (let i = 0; i < 80; i++) {
    const h = hues[i % hues.length] + Math.round(Math.random() * 24 - 12);
    html += '<i style="left:' + (Math.random() * 100).toFixed(2) + '%;'
      + 'animation-delay:' + (Math.random() * .7).toFixed(2) + 's;'
      + 'animation-duration:' + (1.5 + Math.random() * 1.4).toFixed(2) + 's;'
      + 'background:hsl(' + h + ',62%,' + (44 + Math.random() * 22).toFixed(0) + '%)"></i>';
  }
  el.confetti.innerHTML = html;
  setTimeout(() => { el.confetti.innerHTML = ''; }, 3400);
}

/* Asks before throwing away a game in progress, instead of silently binning it. */
let confirmAction = null;
function guard(action, body) {
  if (state.status === 'playing' && state.moveCount > 0) {
    confirmAction = action;
    el.confirmBody.textContent = body || 'You have a puzzle in progress. Starting a new one will lose it.';
    openDlg(el.confirmDlg, el.confirmYes);
  } else {
    action();
  }
}

/* ---- share links and the daily puzzle ---- */

function puzzleHash() {
  return state.mode === 'daily'
    ? '#daily'
    : '#p=' + state.difficulty + '-' + (state.seed >>> 0).toString(36);
}

function parseHash() {
  const h = (location.hash || '').replace(/^#/, '');
  if (h === 'daily') return { mode: 'daily' };
  const m = /^p=(Easy|Medium|Hard|Expert)-([0-9a-z]+)$/i.exec(h);
  if (m) {
    const diff = Core.DIFFICULTIES.find(d => d.toLowerCase() === m[1].toLowerCase());
    const seed = parseInt(m[2], 36);
    if (diff && isFinite(seed)) return { difficulty: diff, seed: seed >>> 0 };
  }
  return null;
}

async function share() {
  const hash = puzzleHash();
  history.replaceState(null, '', location.pathname + location.search + hash);
  const url = location.href;
  const text = state.mode === 'daily'
    ? "Today's Sudoku Zen daily puzzle"
    : 'A ' + state.difficulty + ' Sudoku Zen puzzle';
  try {
    if (navigator.share) { await navigator.share({ title: 'Sudoku Zen', text: text, url: url }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch (e) {
    /* clipboard is blocked on insecure origins and in some embeds */
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px';
    document.body.appendChild(ta);
    ta.select();
    let done = false;
    try { done = document.execCommand('copy'); } catch (e2) {}
    document.body.removeChild(ta);
    toast(done ? 'Link copied' : 'Copy the address bar to share');
  }
}

/* ---- theme ---- */

function applyTheme() {
  const root = document.documentElement;
  if (state.theme === 'light' || state.theme === 'dark') root.dataset.theme = state.theme;
  else root.removeAttribute('data-theme');

  const dark = state.theme === 'dark' ||
    (!state.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  el.themeIcon.firstElementChild.setAttribute('href', dark ? '#i-sun' : '#i-moon');
  el.themeBtn.setAttribute('aria-label', dark ? 'Switch to the light theme' : 'Switch to the dark theme');
}

/* ---- keyboard ---- */

function moveSel(dr, dc) {
  let i = state.selected;
  if (i < 0) { select(40); return; }
  let r = Core.ROW[i] + dr, c = Core.COL[i] + dc;
  r = (r + 9) % 9; c = (c + 9) % 9;
  select(r * 9 + c);
}

function onKey(ev) {
  const tag = (ev.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || ev.target.isContentEditable) return;

  if (ev.key === 'Escape') {
    if (openDialog) {
      if (openDialog === el.resumeDlg) { el.resumeYes.click(); return; }
      closeDlg(openDialog);
      ev.preventDefault();
    } else if (state.selected >= 0) {
      state.selected = -1;
      render();
    }
    return;
  }
  if (openDialog) return;

  const k = ev.key;

  if (k >= '1' && k <= '9') {
    ev.preventDefault();
    const n = +k;
    if (ev.shiftKey) {
      const i = state.selected;
      if (i >= 0 && !state.givens[i] && !isPaused()) { S.toggleNote(i, n); render(); }
    } else {
      input(n);
    }
    return;
  }

  switch (k) {
    case '0': case 'Backspace': case 'Delete':
      ev.preventDefault(); doErase(); return;
    case 'ArrowUp': case 'w': case 'W': ev.preventDefault(); moveSel(-1, 0); return;
    case 'ArrowDown': case 's': case 'S': ev.preventDefault(); moveSel(1, 0); return;
    case 'ArrowLeft': case 'a': case 'A': ev.preventDefault(); moveSel(0, -1); return;
    case 'ArrowRight': case 'd': case 'D': ev.preventDefault(); moveSel(0, 1); return;
    case 'n': case 'N':
      ev.preventDefault(); state.notesMode = !state.notesMode; render(); S.save(); return;
    case 'm': case 'M': ev.preventDefault(); toggleAuto(); return;
    case 'h': case 'H': ev.preventDefault(); doHint(); return;
    case ' ':
      ev.preventDefault();
      if (state.status === 'playing') setRunning(!state.running);
      return;
  }

  if ((ev.metaKey || ev.ctrlKey) && (k === 'z' || k === 'Z')) {
    ev.preventDefault();
    if (ev.shiftKey) S.redo(); else S.undo();
    render();
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && (k === 'y' || k === 'Y')) {
    ev.preventDefault(); S.redo(); render(); return;
  }
  if (k === 'u' || k === 'U') { ev.preventDefault(); S.undo(); render(); return; }
  if (k === 'r' || k === 'R') { ev.preventDefault(); S.redo(); render(); return; }
}

function toggleAuto() {
  state.autoNotesOn = !state.autoNotesOn;
  if (state.autoNotesOn) { S.fillAutoNotes(); toast('Pencil marks filled in'); }
  else { S.clearAllNotes(); toast('Pencil marks cleared'); }
  render();
}

/* ---- wiring ---- */

function wire() {
  el.difficulty.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-diff]');
    if (!b) return;
    const d = b.dataset.diff;
    if (d === state.difficulty && state.status === 'playing') return;
    guard(() => startGame(d, { mode: state.mode === 'daily' ? 'daily' : 'normal' }),
      'You have a puzzle in progress. Switching difficulty will lose it.');
  });

  el.newBtn.addEventListener('click', () => {
    guard(() => startGame(state.difficulty, { mode: 'normal' }));
  });

  el.dailyBtn.addEventListener('click', () => {
    guard(() => startGame(state.difficulty, { mode: 'daily' }),
      'You have a puzzle in progress. Loading the daily puzzle will lose it.');
  });

  el.shareBtn.addEventListener('click', share);

  el.pauseBtn.addEventListener('click', () => {
    if (state.status !== 'playing') return;
    setRunning(!state.running);
  });
  el.resumeBtn.addEventListener('click', () => setRunning(true));

  el.notesBtn.addEventListener('click', () => { state.notesMode = !state.notesMode; render(); S.save(); });
  el.autoBtn.addEventListener('click', toggleAuto);
  el.hintBtn.addEventListener('click', doHint);
  el.undoBtn.addEventListener('click', () => { S.undo(); render(); });
  el.redoBtn.addEventListener('click', () => { S.redo(); render(); });

  el.themeBtn.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    state.theme = dark ? 'light' : 'dark';
    applyTheme();
    S.flush();
  });

  el.resumeYes.addEventListener('click', () => {
    closeDlg(el.resumeDlg);
    S.markSeen();
    setRunning(true);
    render();
  });
  el.resumeNo.addEventListener('click', () => {
    closeDlg(el.resumeDlg);
    S.recordAbandon();
    startGame(state.difficulty, { mode: 'normal' });
  });

  el.confirmYes.addEventListener('click', () => {
    closeDlg(el.confirmDlg);
    S.recordAbandon();
    const a = confirmAction; confirmAction = null;
    if (a) a();
  });
  el.confirmNo.addEventListener('click', () => { confirmAction = null; closeDlg(el.confirmDlg); });

  el.limitRestart.addEventListener('click', () => {
    closeDlg(el.limitDlg);
    /* same seed rebuilds the identical puzzle */
    startGame(state.difficulty, { seed: state.seed, mode: state.mode });
  });
  el.limitContinue.addEventListener('click', () => closeDlg(el.limitDlg));

  el.winAgain.addEventListener('click', () => {
    closeDlg(el.winDlg);
    startGame(state.difficulty, { mode: 'normal' });
  });
  el.winClose.addEventListener('click', () => closeDlg(el.winDlg));

  document.addEventListener('keydown', onKey);

  /* Leaving the tab pauses the clock; coming back resumes it, but only if the
     player had not paused deliberately. */
  let autoPaused = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state.running) { autoPaused = true; setRunning(false); }
      S.flush();
    } else if (autoPaused) {
      autoPaused = false;
      setRunning(true);
    }
  });
  window.addEventListener('pagehide', () => S.flush());
  window.addEventListener('beforeunload', () => S.flush());

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!state.theme) applyTheme();
  });

  window.addEventListener('hashchange', () => {
    const h = parseHash();
    if (!h) return;
    if (h.mode === 'daily') startGame(state.difficulty, { mode: 'daily' });
    else startGame(h.difficulty, { seed: h.seed, mode: 'normal' });
  });
}

/* ---- boot ---- */

function boot() {
  buildBoard();
  buildPad();
  wire();

  S.loadStats();
  applyTheme();
  startClock();

  const link = parseHash();
  const saved = S.peek();

  /* A shared link normally wins, but not when it names the very puzzle already
     saved in progress — that is just a reload, and should still offer to resume. */
  const linkIsSavedGame = !!(link && saved && saved.status === 'playing' && (
    link.mode === 'daily'
      ? saved.mode === 'daily'
      : saved.mode !== 'daily' && saved.difficulty === link.difficulty && (saved.seed >>> 0) === link.seed
  ));

  if (link && !linkIsSavedGame) {
    if (link.mode === 'daily') startGame(state.difficulty, { mode: 'daily' });
    else startGame(link.difficulty, { seed: link.seed, mode: 'normal' });
    return;
  }

  if (saved && saved.status === 'playing' && S.hydrate(saved)) {
    render();
    if (S.wasSeen()) {
      /* an in-session refresh should not nag */
      setRunning(true);
    } else {
      const filled = S.filledCount();
      el.resumeMeta.textContent =
        state.difficulty + ' · ' + fmt(state.elapsed) + ' · ' + filled + ' of 81 filled';
      openDlg(el.resumeDlg, el.resumeYes);
    }
    return;
  }

  startGame(state.difficulty, { mode: 'normal' });
}

boot();

/* offline shell — registered relatively so the /SudokuZen/ scope resolves */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
