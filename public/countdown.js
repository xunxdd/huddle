/* ── Countdown Numbers Game — Client ─────────────────────────────────────── */

const socket = io({ transports: ['websocket'] });

// ── State ──────────────────────────────────────────────────────────────────────
let myId          = null;
let myRoomId      = null;
let myUsername    = '';
let timerMax      = 30;
let currentNums   = [];
let currentTarget = 0;
let hasSubmitted  = false;
let currentPlayers = [];          // [{id, name, score}]
let submittedSet  = new Set();    // socket IDs that submitted this round
let pickAutoTimer = null;         // client-side auto-pick countdown
let roomOwnerId   = null;         // tracks who can reset the room

// ── Screens ────────────────────────────────────────────────────────────────────
const screens = {
  lobby:   document.getElementById('screen-lobby'),
  waiting: document.getElementById('screen-waiting'),
  game:    document.getElementById('screen-game'),
};

function showScreen(name) {
  for (const [k, el] of Object.entries(screens)) {
    if (k === name) {
      el.classList.remove('hidden');
      el.style.display = '';
    } else {
      el.classList.add('hidden');
      el.style.display = 'none';
    }
  }
}

// ── DOM refs ───────────────────────────────────────────────────────────────────
const inpUsername     = document.getElementById('inp-username');
const btnContinue     = document.getElementById('btn-continue');
const lobbyError      = document.getElementById('lobby-error');
const lobbyChoice     = document.getElementById('lobby-choice-step');
const lobbyUser       = document.getElementById('lobby-username-step');
const btnCreate       = document.getElementById('btn-create');
const btnJoin         = document.getElementById('btn-join');
const inpRoomCode     = document.getElementById('inp-room-code');
const inpRounds       = document.getElementById('inp-rounds');
const inpTime         = document.getElementById('inp-time');

const waitingCode     = document.getElementById('waiting-room-code');
const waitingCount    = document.getElementById('waiting-player-count');
const waitingPlayers  = document.getElementById('waiting-players');
const btnStart        = document.getElementById('btn-start');
const waitingNotOwner = document.getElementById('waiting-not-owner');
const btnCopyCode     = document.getElementById('btn-copy-code');
const btnCopyLink     = document.getElementById('btn-copy-link');
const linkCopiedMsg   = document.getElementById('link-copied-msg');
const waitingBackLink = document.getElementById('waiting-back-link');

const hudRound        = document.getElementById('hud-round');
const hudTotalRounds  = document.getElementById('hud-total-rounds');
const hudTimer        = document.getElementById('hud-timer');
const timerArc        = document.getElementById('timer-arc');

const cdTarget         = document.getElementById('cd-target');
const cdCards          = document.getElementById('cd-cards');
const exprInput        = document.getElementById('cd-expr-input');
const exprWrap         = document.getElementById('cd-expr-wrap');
const exprResult       = document.getElementById('cd-expr-result');
const submitBtn        = document.getElementById('cd-submit-btn');
const feedbackEl       = document.getElementById('cd-feedback');
const playerStatusList = document.getElementById('cd-player-status-list');
const cdRecap          = document.getElementById('cd-recap');
const cdRecapContent   = document.getElementById('cd-recap-content');

const overlayPick      = document.getElementById('overlay-pick');
const pickMyTurn       = document.getElementById('pick-my-turn');
const pickWaiting      = document.getElementById('pick-waiting');
const pickPickerName   = document.getElementById('pick-picker-name');
const pickRoundInfo    = document.getElementById('pick-round-info');
const pickAutoSecs     = document.getElementById('pick-auto-secs');

const overlayRoundEnd  = document.getElementById('overlay-round-end');
const roundEndTitle    = document.getElementById('round-end-title');
const roundEndTarget   = document.getElementById('round-end-target');
const roundEndTbody    = document.getElementById('round-end-tbody');
const roundEndBestExpr = document.getElementById('round-end-best-expr');
const roundEndNext     = document.getElementById('round-end-next');

const overlayGameOver   = document.getElementById('overlay-game-over');
const gameOverTitle     = document.getElementById('game-over-title');
const gameOverScores    = document.getElementById('game-over-scores');
const gameOverCountdown = document.getElementById('game-over-countdown');
const btnPlayAgain      = document.getElementById('btn-play-again');

// ── Helpers ────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resetLobby() {
  myRoomId      = null;
  currentNums   = [];
  currentTarget = 0;
  hasSubmitted  = false;
  currentPlayers = [];
  submittedSet.clear();
  lobbyUser.classList.remove('hidden');
  lobbyChoice.classList.add('hidden');
  lobbyError.classList.add('hidden');
  inpUsername.value = myUsername;
}

function showLobbyError(msg) {
  lobbyError.textContent = msg;
  lobbyError.classList.remove('hidden');
  setTimeout(() => lobbyError.classList.add('hidden'), 4000);
}

// ── Tabs ───────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ── Lobby handlers ─────────────────────────────────────────────────────────────
btnContinue.addEventListener('click', () => {
  const name = inpUsername.value.trim();
  if (!name) { showLobbyError('Enter your name first'); return; }
  myUsername = name;
  lobbyUser.classList.add('hidden');
  lobbyChoice.classList.remove('hidden');
});
inpUsername.addEventListener('keydown', e => { if (e.key === 'Enter') btnContinue.click(); });

btnCreate.addEventListener('click', () => {
  socket.emit('cd:create', {
    username:     myUsername,
    rounds:       parseInt(inpRounds.value),
    timePerRound: parseInt(inpTime.value),
  });
});

btnJoin.addEventListener('click', () => {
  const code = inpRoomCode.value.toUpperCase().trim();
  if (!code) { showLobbyError('Enter a room code'); return; }
  socket.emit('cd:join', { code, username: myUsername });
});
inpRoomCode.addEventListener('keydown', e => { if (e.key === 'Enter') btnJoin.click(); });

// ── Waiting room ───────────────────────────────────────────────────────────────
function renderWaiting(room) {
  waitingCode.textContent  = room.id;
  waitingCount.textContent = room.players.length;

  waitingPlayers.innerHTML = '';
  for (const p of room.players) {
    const div = document.createElement('div');
    div.className = 'player-item';
    const initials = p.name.slice(0, 2).toUpperCase();
    div.innerHTML = `
      <div class="player-avatar">${escHtml(initials)}</div>
      <span>${escHtml(p.name)}${p.id === myId ? ' <span style="color:var(--text-dim);font-size:0.8rem">(you)</span>' : ''}</span>
      ${p.id === room.owner ? '<span class="player-crown" title="Host">👑</span>' : ''}
    `;
    waitingPlayers.appendChild(div);
  }

  if (room.owner === myId) {
    btnStart.classList.remove('hidden');
    waitingNotOwner.classList.add('hidden');
    btnStart.disabled    = room.players.length < 2;
    btnStart.textContent = room.players.length < 2 ? 'Need 2+ players' : 'Start Game';
  } else {
    btnStart.classList.add('hidden');
    waitingNotOwner.classList.remove('hidden');
  }
}

btnCopyCode.addEventListener('click', () => {
  navigator.clipboard.writeText(waitingCode.textContent).then(() => {
    btnCopyCode.textContent = 'Copied!';
    setTimeout(() => btnCopyCode.textContent = 'Copy Code', 2000);
  });
});
btnCopyLink.addEventListener('click', () => {
  const link = `${window.location.origin}/countdown/join/${waitingCode.textContent}`;
  navigator.clipboard.writeText(link).then(() => {
    linkCopiedMsg.classList.remove('hidden');
    setTimeout(() => linkCopiedMsg.classList.add('hidden'), 2000);
  });
});
btnStart.addEventListener('click', () => {
  socket.emit('cd:start', myRoomId);
});
waitingBackLink.addEventListener('click', e => {
  e.preventDefault();
  socket.emit('cd:leave');
  showScreen('lobby');
  resetLobby();
});

// ── Timer arc ──────────────────────────────────────────────────────────────────
const CIRC = 2 * Math.PI * 22;

function updateTimerArc(timeLeft, max) {
  const frac = Math.max(0, timeLeft / max);
  timerArc.style.strokeDashoffset = CIRC * (1 - frac);
  if (frac > 0.5)       timerArc.style.stroke = 'var(--cd-amber)';
  else if (frac > 0.25) timerArc.style.stroke = 'var(--yellow)';
  else                  timerArc.style.stroke = 'var(--accent)';
  hudTimer.textContent = timeLeft;
}

// ── Number cards ───────────────────────────────────────────────────────────────
function renderCards(nums) {
  cdCards.innerHTML = '';
  nums.forEach((n, i) => {
    const card = document.createElement('div');
    card.className       = `cd-card c-${i}`;
    card.textContent     = n;
    card.dataset.index   = i;
    card.addEventListener('click', () => {
      if (!hasSubmitted) insertAtCursor(String(n));
    });
    cdCards.appendChild(card);
  });
}

// ── Expression input helpers ───────────────────────────────────────────────────
function insertAtCursor(text) {
  const el    = exprInput;
  const start = el.selectionStart;
  const end   = el.selectionEnd;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  el.selectionStart = el.selectionEnd = start + text.length;
  el.focus();
  onExprChange();
}

document.querySelectorAll('.cd-op-btn[data-insert]').forEach(btn => {
  btn.addEventListener('click', () => { if (!hasSubmitted) insertAtCursor(btn.dataset.insert); });
});
document.getElementById('op-del').addEventListener('click', () => {
  if (hasSubmitted) return;
  const el    = exprInput;
  const start = el.selectionStart;
  const end   = el.selectionEnd;
  if (start !== end) {
    el.value = el.value.slice(0, start) + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start;
  } else if (start > 0) {
    el.value = el.value.slice(0, start - 1) + el.value.slice(start);
    el.selectionStart = el.selectionEnd = start - 1;
  }
  el.focus();
  onExprChange();
});
document.getElementById('op-clear').addEventListener('click', () => {
  if (hasSubmitted) return;
  exprInput.value = '';
  exprInput.focus();
  onExprChange();
});

// ── Live eval ──────────────────────────────────────────────────────────────────
function liveEval(expr) {
  const cleaned = expr
    .replace(/\s+/g, '')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-');

  if (!cleaned) return null;
  if (!/^[0-9+\-*/().]+$/.test(cleaned)) return { ok: false, msg: 'Invalid characters' };

  const tokens = cleaned.match(/\d+/g) || [];
  if (tokens.length === 0) return null;
  if (tokens.length > 6)   return { ok: false, msg: 'Too many numbers (max 6)' };

  const pool = [...currentNums];
  for (const t of tokens) {
    const n   = parseInt(t, 10);
    const idx = pool.indexOf(n);
    if (idx === -1) return { ok: false, msg: `${n} is not one of your numbers` };
    pool.splice(idx, 1);
  }

  let result;
  try {
    // eslint-disable-next-line no-new-func
    result = Function('"use strict"; return (' + cleaned + ')')();
  } catch {
    return { ok: false, msg: 'Invalid syntax' };
  }

  if (typeof result !== 'number' || !isFinite(result)) return { ok: false, msg: 'Not a valid number' };
  if (!Number.isInteger(result) || result <= 0)        return { ok: false, msg: `= ${result} (must be a positive integer)` };

  const diff = Math.abs(result - currentTarget);
  if (diff === 0) return { ok: true, diff: 0, msg: `= ${result}  ✓ Exact!`,              cls: 'exact' };
  if (diff <= 5)  return { ok: true, diff,    msg: `= ${result}  —  ${diff} away`,        cls: 'close' };
  return          { ok: true, diff,            msg: `= ${result}  —  ${diff} away`,        cls: 'far'   };
}

function onExprChange() {
  const expr = exprInput.value;
  if (!expr.trim()) {
    exprWrap.className     = 'cd-expr-wrap';
    exprResult.textContent = '';
    exprResult.className   = 'cd-expr-result';
    submitBtn.disabled     = true;
    return;
  }
  const res = liveEval(expr);
  if (!res) {
    exprWrap.className     = 'cd-expr-wrap';
    exprResult.textContent = '';
    submitBtn.disabled     = true;
  } else if (res.ok) {
    exprWrap.className     = 'cd-expr-wrap valid';
    exprResult.textContent = res.msg;
    exprResult.className   = `cd-expr-result ${res.cls}`;
    submitBtn.disabled     = false;
  } else {
    exprWrap.className     = 'cd-expr-wrap invalid';
    exprResult.textContent = res.msg;
    exprResult.className   = 'cd-expr-result err';
    submitBtn.disabled     = true;
  }
}

exprInput.addEventListener('input', onExprChange);
exprInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); if (!submitBtn.disabled) lockSubmit(); }
});

// ── Submit & Lock In ───────────────────────────────────────────────────────────
function lockSubmit() {
  const expr = exprInput.value.trim();
  if (!expr || hasSubmitted) return;
  const res = liveEval(expr);
  if (!res || !res.ok) return;

  hasSubmitted           = true;
  exprInput.disabled     = true;
  submitBtn.disabled     = true;
  submitBtn.classList.add('locked-in');
  submitBtn.textContent  = res.diff === 0
    ? `✓ Locked: ${res.msg}`
    : `🔒 Locked: ${res.msg}`;
  exprWrap.className     = 'cd-expr-wrap locked';
  exprResult.textContent = res.msg;
  exprResult.className   = 'cd-expr-result locked';

  SFX.submit();
  if (res.diff === 0) SFX.correct();

  socket.emit('cd:submit', { roomId: myRoomId, expr });
}

submitBtn.addEventListener('click', lockSubmit);

// ── Player status sidebar ──────────────────────────────────────────────────────
function buildPlayerStatus(players, submitted) {
  playerStatusList.innerHTML = '';
  for (const p of players) {
    const isSubmitted = submitted.has(p.id);
    const div = document.createElement('div');
    div.className        = 'cd-player-status-item';
    div.dataset.playerId = p.id;
    div.innerHTML = `
      <span class="cd-player-status-name${p.id === myId ? ' is-me' : ''}">${escHtml(p.name)}</span>
      <span class="cd-player-status-pts">${p.score}</span>
      <span class="cd-player-status-check${isSubmitted ? '' : ' waiting'}">✓</span>
    `;
    playerStatusList.appendChild(div);
  }
}

function markPlayerSubmitted(playerId) {
  const item = playerStatusList.querySelector(`[data-player-id="${playerId}"]`);
  if (item) {
    const check = item.querySelector('.cd-player-status-check');
    if (check) check.classList.remove('waiting');
  }
}

// ── Scores sidebar (used after round ends) ────────────────────────────────────
function renderScores(scores) {
  playerStatusList.innerHTML = '';
  scores.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'score-item' + (p.id === myId ? ' is-me' : '');
    div.innerHTML = `
      <span class="score-rank">${i + 1}</span>
      <span class="score-name">${escHtml(p.name)}</span>
      <span class="score-pts">${p.score}</span>
    `;
    playerStatusList.appendChild(div);
  });
}

// ── Recap sidebar ──────────────────────────────────────────────────────────────
function showSidebarRecap(data) {
  cdRecap.style.display = '';
  let html = `<div style="font-size:0.75rem;color:var(--text-dim);margin-bottom:0.4rem">Target: <strong style="color:var(--cd-amber)">${data.target}</strong></div>`;

  for (const r of data.results) {
    const isMe = r.id === myId;
    let detail;
    if (r.expr === null) {
      detail = `<span style="color:var(--text-dim)">no answer — 0pt</span>`;
    } else if (r.diff === 0) {
      detail = `<span style="color:var(--cd-amber)">${escHtml(r.expr)} = ${r.result} ✓ — 10pt</span>`;
    } else {
      const pts = r.points > 0 ? `${r.points}pt` : '0pt';
      detail = `<span style="color:var(--text-dim);font-family:monospace;font-size:0.75rem">${escHtml(r.expr)}</span>` +
               ` <span style="color:var(--text-dim)">= ${r.result} (${r.diff} off) — ${pts}</span>`;
    }
    html += `<div class="cd-recap-row">
      <div class="cd-recap-name">${escHtml(r.name)}${isMe ? ' <span style="color:var(--text-dim);font-size:0.72rem">(you)</span>' : ''}</div>
      <div style="font-size:0.78rem;margin-top:0.1rem">${detail}</div>
    </div>`;
  }

  if (data.bestSolution) {
    html += `<div class="cd-recap-solution" style="margin-top:0.5rem">
      Best: <span>${escHtml(data.bestSolution.expr)} = ${data.bestSolution.val}</span>
    </div>`;
  }
  cdRecapContent.innerHTML = html;
}

// ── Pick overlay ───────────────────────────────────────────────────────────────
function showPickOverlay(data) {
  overlayRoundEnd.classList.add('hidden');
  overlayPick.classList.remove('hidden');

  if (data.pickerId === myId) {
    pickMyTurn.classList.remove('hidden');
    pickWaiting.classList.add('hidden');
    // Countdown display
    let secsLeft = 10;
    pickAutoSecs.textContent = secsLeft;
    if (pickAutoTimer) clearInterval(pickAutoTimer);
    pickAutoTimer = setInterval(() => {
      secsLeft = Math.max(0, secsLeft - 1);
      pickAutoSecs.textContent = secsLeft;
      if (secsLeft <= 0) { clearInterval(pickAutoTimer); pickAutoTimer = null; }
    }, 1000);
  } else {
    pickMyTurn.classList.add('hidden');
    pickWaiting.classList.remove('hidden');
    pickPickerName.textContent = data.pickerName;
    pickRoundInfo.textContent  = `Round ${data.round} of ${data.totalRounds}`;
    if (pickAutoTimer) { clearInterval(pickAutoTimer); pickAutoTimer = null; }
  }
}

document.querySelectorAll('.cd-pick-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const numLarge = parseInt(btn.dataset.large);
    if (pickAutoTimer) { clearInterval(pickAutoTimer); pickAutoTimer = null; }
    socket.emit('cd:pick', { roomId: myRoomId, numLarge });
  });
});

// ── Round end overlay ──────────────────────────────────────────────────────────
function showRoundEndOverlay(data) {
  overlayRoundEnd.classList.remove('hidden');
  roundEndTitle.textContent  = `Round ${data.round} — Results`;
  roundEndTarget.textContent = `Target: ${data.target}`;

  roundEndTbody.innerHTML = '';
  for (const r of data.results) {
    const tr = document.createElement('tr');
    if (r.diff === 0) tr.classList.add('row-exact');
    tr.innerHTML = `
      <td class="td-name">${escHtml(r.name)}${r.id === myId ? ' <span style="font-size:0.7rem;color:var(--text-dim)">(you)</span>' : ''}</td>
      <td class="td-expr">${r.expr !== null ? escHtml(r.expr) : '—'}</td>
      <td class="td-val">${r.result !== null ? r.result : '—'}</td>
      <td class="td-diff">${r.diff !== null ? (r.diff === 0 ? '✓' : r.diff) : '—'}</td>
      <td class="td-pts">${r.points}</td>
    `;
    roundEndTbody.appendChild(tr);
  }

  if (data.bestSolution) {
    const bs = data.bestSolution;
    roundEndBestExpr.textContent = `${bs.expr} = ${bs.val}${bs.diff > 0 ? ` (${bs.diff} away)` : ' ✓'}`;
  } else {
    roundEndBestExpr.textContent = '—';
  }

  roundEndNext.textContent = 'Next round starting soon…';
}

// ── Overlay score rows ─────────────────────────────────────────────────────────
function renderOverlayScores(container, scores) {
  container.innerHTML = '';
  scores.forEach((p, i) => {
    const medals  = ['🥇', '🥈', '🥉'];
    const rankStr = medals[i] || `${i + 1}.`;
    const div = document.createElement('div');
    div.className = 'overlay-score-row';
    div.innerHTML = `
      <span class="overlay-rank">${rankStr}</span>
      <span class="overlay-name">${escHtml(p.name)}${p.id === myId ? ' (you)' : ''}</span>
      <span class="overlay-pts">${p.score} pts</span>
    `;
    container.appendChild(div);
  });
}

// ── Feedback ───────────────────────────────────────────────────────────────────
function showFeedback(msg, type) {
  feedbackEl.textContent = msg;
  feedbackEl.className   = `cd-feedback ${type}`;
  setTimeout(() => { feedbackEl.textContent = ''; feedbackEl.className = 'cd-feedback'; }, 3500);
}

// ── Play again ─────────────────────────────────────────────────────────────────
btnPlayAgain.addEventListener('click', () => {
  socket.emit('cd:reset', myRoomId);
  // cd:reset event from server will move everyone to the waiting screen
});

// ── Socket handlers ────────────────────────────────────────────────────────────

socket.on('connect', () => { myId = socket.id; });

socket.on('cd:joined', ({ roomId, playerId, room }) => {
  myId        = playerId;
  myRoomId    = roomId;
  timerMax    = room.timePerRound;
  roomOwnerId = room.owner;
  renderWaiting(room);
  showScreen('waiting');
});

socket.on('cd:playerJoined', ({ room }) => {
  renderWaiting(room);
  SFX.join();
});

socket.on('cd:playerLeft', ({ room }) => {
  roomOwnerId = room.owner; // ownership may have transferred
  const waitingVisible = !screens.waiting.classList.contains('hidden');
  if (waitingVisible) renderWaiting(room);
  SFX.leave();
});

socket.on('cd:started', ({ room }) => {
  SFX.gameStart();
  timerMax    = room.timePerRound;
  roomOwnerId = room.owner;
  currentPlayers = room.players;
  hudTotalRounds.textContent = room.rounds;
  cdRecap.style.display = 'none';
  overlayRoundEnd.classList.add('hidden');
  overlayGameOver.classList.add('hidden');
  overlayPick.classList.add('hidden');
  showScreen('game');
});

socket.on('cd:pickStart', (data) => {
  hudRound.textContent       = data.round;
  hudTotalRounds.textContent = data.totalRounds;

  // Reset round state
  hasSubmitted = false;
  submittedSet.clear();

  // Reset expression input
  exprInput.value        = '';
  exprInput.disabled     = false;
  exprWrap.className     = 'cd-expr-wrap';
  exprResult.textContent = '';
  exprResult.className   = 'cd-expr-result';
  submitBtn.disabled     = true;
  submitBtn.classList.remove('locked-in');
  submitBtn.textContent  = 'Submit & Lock In';
  feedbackEl.textContent = '';

  // Reset timer display (fill timer)
  updateTimerArc(timerMax, timerMax);
  hudTimer.textContent = timerMax;

  // Rebuild player status (no one submitted yet)
  buildPlayerStatus(currentPlayers, submittedSet);

  showPickOverlay(data);
  SFX.turnStart();
});

socket.on('cd:roundStart', ({ round, totalRounds, nums, target, timeLeft }) => {
  currentNums   = nums;
  currentTarget = target;

  hudRound.textContent       = round;
  hudTotalRounds.textContent = totalRounds;
  cdTarget.textContent       = target;

  renderCards(nums);
  buildPlayerStatus(currentPlayers, submittedSet);
  updateTimerArc(timeLeft, timerMax);

  // Hide pick overlay
  overlayPick.classList.add('hidden');
  if (pickAutoTimer) { clearInterval(pickAutoTimer); pickAutoTimer = null; }

  exprInput.focus();
});

socket.on('cd:tick', ({ timeLeft }) => {
  updateTimerArc(timeLeft, timerMax);
  if (timeLeft <= 10 && timeLeft > 0) SFX.tick();
});

socket.on('cd:playerSubmitted', ({ playerId, submittedCount, totalCount }) => {
  submittedSet.add(playerId);
  markPlayerSubmitted(playerId);
  if (playerId !== myId) {
    showFeedback(`${submittedCount} / ${totalCount} locked in`, 'ok');
  }
});

socket.on('cd:roundEnd', (data) => {
  SFX.roundEnd();

  const myResult = data.results.find(r => r.id === myId);
  if (myResult && myResult.diff === 0) SFX.correct();

  // Disable input
  exprInput.disabled = true;
  submitBtn.disabled = true;
  if (!hasSubmitted) submitBtn.textContent = 'Round ended';

  // Update local player scores from server data
  currentPlayers = data.scores.map(s => ({ id: s.id, name: s.name, score: s.score }));

  renderScores(data.scores);
  showSidebarRecap(data);
  showRoundEndOverlay(data);

  // Auto-dismiss overlay — also dismissed by incoming cd:pickStart / cd:gameOver
  setTimeout(() => overlayRoundEnd.classList.add('hidden'), 5000);
});

socket.on('cd:gameOver', ({ scores, winner }) => {
  overlayRoundEnd.classList.add('hidden');
  overlayPick.classList.add('hidden');
  if (pickAutoTimer) { clearInterval(pickAutoTimer); pickAutoTimer = null; }

  const isMe = winner && winner.id === myId;
  if (winner) {
    if (isMe) SFX.win(); else SFX.lose();
    gameOverTitle.textContent = isMe ? '🎉 You won!' : `🏆 ${winner.name} wins!`;
  } else {
    gameOverTitle.textContent = 'Game Over!';
  }

  renderOverlayScores(gameOverScores, scores);

  // Host sees Play Again; others wait for host to restart
  const amOwner = myId === roomOwnerId;
  btnPlayAgain.style.display    = amOwner ? '' : 'none';
  gameOverCountdown.textContent = amOwner ? '' : 'Waiting for host to start a new game…';

  overlayGameOver.classList.remove('hidden');
});

socket.on('cd:reset', ({ room }) => {
  overlayGameOver.classList.add('hidden');
  overlayRoundEnd.classList.add('hidden');
  overlayPick.classList.add('hidden');
  if (pickAutoTimer) { clearInterval(pickAutoTimer); pickAutoTimer = null; }
  myRoomId       = room.id;
  timerMax       = room.timePerRound;
  roomOwnerId    = room.owner;
  currentPlayers = room.players;
  renderWaiting(room);
  showScreen('waiting');
});

socket.on('cd:error', ({ message }) => {
  showFeedback(message, 'err');
  showLobbyError(message);
  // Re-enable input if submit was rejected
  if (hasSubmitted) {
    hasSubmitted           = false;
    exprInput.disabled     = false;
    submitBtn.disabled     = false;
    submitBtn.classList.remove('locked-in');
    submitBtn.textContent  = 'Submit & Lock In';
    exprWrap.className     = 'cd-expr-wrap';
    onExprChange();
  }
});

// ── Invite link / direct join ──────────────────────────────────────────────────
const lobbyDirectJoin   = document.getElementById('lobby-direct-join');
const inpUsernameDirect = document.getElementById('inp-username-direct');
const btnDirectJoin     = document.getElementById('btn-direct-join');
const btnBackToLobby    = document.getElementById('btn-back-to-lobby');
let _inviteCode = null;

function checkInviteUrl() {
  const pathMatch = window.location.pathname.match(/^\/countdown\/join\/([A-Z0-9]{6})$/i);
  const params    = new URLSearchParams(window.location.search);
  const qCode     = params.get('join');
  const code      = pathMatch ? pathMatch[1].toUpperCase() : (qCode ? qCode.toUpperCase() : null);
  if (!code) return;

  _inviteCode = code;
  lobbyUser.classList.add('hidden');
  lobbyChoice.classList.add('hidden');
  lobbyDirectJoin.classList.remove('hidden');
  inpUsernameDirect.focus();
  history.replaceState(null, '', '/countdown');
}

btnDirectJoin.addEventListener('click', () => {
  const name = inpUsernameDirect.value.trim();
  if (!name) { showLobbyError('Enter your name first'); return; }
  myUsername  = name;
  socket.emit('cd:join', { code: _inviteCode, username: myUsername });
  _inviteCode = null;
  lobbyDirectJoin.classList.add('hidden');
});
inpUsernameDirect.addEventListener('keydown', e => { if (e.key === 'Enter') btnDirectJoin.click(); });
btnBackToLobby.addEventListener('click', () => {
  _inviteCode = null;
  lobbyDirectJoin.classList.add('hidden');
  lobbyUser.classList.remove('hidden');
  inpUsername.focus();
});

// ── Init ───────────────────────────────────────────────────────────────────────
showScreen('lobby');
checkInviteUrl();
if (!_inviteCode) inpUsername.focus();
