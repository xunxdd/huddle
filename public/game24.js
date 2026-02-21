/* ── The 24 Game — Client ───────────────────────────────────────────────── */

const socket = io({ transports: ['websocket'] });

// ── State ──────────────────────────────────────────────────────────────────
let myId         = null;
let myRoomId     = null;
let myUsername   = '';
let timerMax     = 60;
let currentNums  = [];
let roomOwnerId  = null;

// ── Screens ────────────────────────────────────────────────────────────────
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

// ── DOM refs ───────────────────────────────────────────────────────────────
const inpUsername    = document.getElementById('inp-username');
const btnContinue    = document.getElementById('btn-continue');
const lobbyError     = document.getElementById('lobby-error');
const lobbyChoice    = document.getElementById('lobby-choice-step');
const lobbyUser      = document.getElementById('lobby-username-step');
const btnCreate      = document.getElementById('btn-create');
const btnJoin        = document.getElementById('btn-join');
const inpRoomCode    = document.getElementById('inp-room-code');
const inpRounds      = document.getElementById('inp-rounds');
const inpTime        = document.getElementById('inp-time');

const waitingCode    = document.getElementById('waiting-room-code');
const waitingCount   = document.getElementById('waiting-player-count');
const waitingPlayers = document.getElementById('waiting-players');
const btnStart       = document.getElementById('btn-start');
const waitingNotOwner = document.getElementById('waiting-not-owner');
const btnCopyCode    = document.getElementById('btn-copy-code');
const btnCopyLink    = document.getElementById('btn-copy-link');
const linkCopiedMsg  = document.getElementById('link-copied-msg');
const waitingBackLink = document.getElementById('waiting-back-link');

const hudRound       = document.getElementById('hud-round');
const hudTotalRounds = document.getElementById('hud-total-rounds');
const hudTimer       = document.getElementById('hud-timer');
const timerArc       = document.getElementById('timer-arc');

const g24Cards       = document.getElementById('g24-cards');
const exprInput      = document.getElementById('g24-expr-input');
const exprWrap       = document.getElementById('g24-expr-wrap');
const exprResult     = document.getElementById('g24-expr-result');
const submitBtn      = document.getElementById('g24-submit-btn');
const feedbackEl     = document.getElementById('g24-feedback');
const scoreList      = document.getElementById('score-list');
const recapArea      = document.getElementById('recap-area');
const recapContent   = document.getElementById('recap-content');

const overlayRoundEnd  = document.getElementById('overlay-round-end');
const roundEndTitle    = document.getElementById('round-end-title');
const roundEndBody     = document.getElementById('round-end-body');
const roundEndScores   = document.getElementById('round-end-scores');
const roundEndNext     = document.getElementById('round-end-next');

const overlayGameOver  = document.getElementById('overlay-game-over');
const gameOverTitle    = document.getElementById('game-over-title');
const gameOverScores   = document.getElementById('game-over-scores');
const gameOverCountdown = document.getElementById('game-over-countdown');
const btnPlayAgain     = document.getElementById('btn-play-again');

// ── Helpers ────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resetLobby() {
  myRoomId = null;
  currentNums = [];
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

// ── Tabs ────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ── Lobby handlers ─────────────────────────────────────────────────────────
btnContinue.addEventListener('click', () => {
  const name = inpUsername.value.trim();
  if (!name) { showLobbyError('Enter your name first'); return; }
  myUsername = name;
  lobbyUser.classList.add('hidden');
  lobbyChoice.classList.remove('hidden');
});
inpUsername.addEventListener('keydown', e => { if (e.key === 'Enter') btnContinue.click(); });

btnCreate.addEventListener('click', () => {
  socket.emit('g24:create', {
    username:    myUsername,
    rounds:      parseInt(inpRounds.value),
    timePerRound: parseInt(inpTime.value),
  });
});

btnJoin.addEventListener('click', () => {
  const code = inpRoomCode.value.toUpperCase().trim();
  if (!code) { showLobbyError('Enter a room code'); return; }
  socket.emit('g24:join', { code, username: myUsername });
});
inpRoomCode.addEventListener('keydown', e => { if (e.key === 'Enter') btnJoin.click(); });

// ── Waiting room ────────────────────────────────────────────────────────────
function renderWaiting(room) {
  waitingCode.textContent = room.id;
  waitingCount.textContent = room.players.length;

  waitingPlayers.innerHTML = '';
  for (const p of room.players) {
    const div = document.createElement('div');
    div.className = 'player-item';
    const initials = p.name.slice(0, 2).toUpperCase();
    div.innerHTML = `
      <div class="player-avatar">${initials}</div>
      <span>${escHtml(p.name)}${p.id === myId ? ' <span style="color:var(--text-dim);font-size:0.8rem">(you)</span>' : ''}</span>
      ${p.id === room.owner ? '<span class="player-crown" title="Host">👑</span>' : ''}
    `;
    waitingPlayers.appendChild(div);
  }

  if (room.owner === myId) {
    btnStart.classList.remove('hidden');
    waitingNotOwner.classList.add('hidden');
    btnStart.disabled = room.players.length < 2;
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
  const link = `${window.location.origin}/game24/join/${waitingCode.textContent}`;
  navigator.clipboard.writeText(link).then(() => {
    linkCopiedMsg.classList.remove('hidden');
    setTimeout(() => linkCopiedMsg.classList.add('hidden'), 2000);
  });
});
btnStart.addEventListener('click', () => {
  socket.emit('g24:start', myRoomId);
});
waitingBackLink.addEventListener('click', e => {
  e.preventDefault();
  socket.emit('g24:leave');
  showScreen('lobby');
  resetLobby();
});

// ── Timer arc ───────────────────────────────────────────────────────────────
const CIRC = 2 * Math.PI * 22;

function updateTimerArc(timeLeft, max) {
  const frac = Math.max(0, timeLeft / max);
  timerArc.style.strokeDashoffset = CIRC * (1 - frac);
  if (frac > 0.5)       timerArc.style.stroke = 'var(--green)';
  else if (frac > 0.25) timerArc.style.stroke = 'var(--yellow)';
  else                  timerArc.style.stroke = 'var(--accent)';
  hudTimer.textContent = timeLeft;
}

// ── Number cards ────────────────────────────────────────────────────────────
function renderCards(nums) {
  g24Cards.innerHTML = '';
  nums.forEach((n, i) => {
    const card = document.createElement('div');
    card.className = `g24-card color-${i}`;
    card.textContent = n;
    card.addEventListener('click', () => {
      insertAtCursor(String(n));
    });
    g24Cards.appendChild(card);
  });
}

// ── Expression input helpers ────────────────────────────────────────────────
function insertAtCursor(text) {
  const el = exprInput;
  const start = el.selectionStart;
  const end   = el.selectionEnd;
  const val   = el.value;
  el.value = val.slice(0, start) + text + val.slice(end);
  el.selectionStart = el.selectionEnd = start + text.length;
  el.focus();
  onExprChange();
}

// Operator buttons
document.querySelectorAll('.g24-op-btn[data-insert]').forEach(btn => {
  btn.addEventListener('click', () => insertAtCursor(btn.dataset.insert));
});
document.getElementById('op-del').addEventListener('click', () => {
  const el = exprInput;
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
  exprInput.value = '';
  exprInput.focus();
  onExprChange();
});

// ── Live eval ───────────────────────────────────────────────────────────────
function clientValidate(expr) {
  let cleaned = expr.replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  if (!cleaned) return null;
  if (!/^[0-9+\-*/().]+$/.test(cleaned)) return { ok: false, msg: 'Invalid characters' };

  const tokens = cleaned.match(/\d+/g) || [];
  if (tokens.length !== 4) return { ok: false, msg: `Use exactly 4 numbers (${tokens.length} so far)` };

  const tokenNums = tokens.map(Number);
  for (const t of tokenNums) {
    if (String(t).length > 1) return { ok: false, msg: 'Only single digits allowed' };
  }

  const sortedTokens = [...tokenNums].sort((a, b) => a - b);
  const sortedTarget = [...currentNums].sort((a, b) => a - b);
  if (sortedTokens.join(',') !== sortedTarget.join(','))
    return { ok: false, msg: 'Use all 4 given numbers exactly once' };

  let result;
  try {
    // eslint-disable-next-line no-new-func
    result = Function('"use strict"; return (' + cleaned + ')')();
  } catch (e) {
    return { ok: false, msg: 'Invalid syntax' };
  }

  if (typeof result !== 'number' || !isFinite(result))
    return { ok: false, msg: 'Expression is not a valid number' };

  if (Math.abs(result - 24) < 0.0001)
    return { ok: true, msg: `= ${result} ✓` };

  return { ok: false, msg: `= ${result.toFixed(4)} (need 24)` };
}

function onExprChange() {
  const expr = exprInput.value;
  if (!expr.trim()) {
    exprWrap.className = 'g24-expr-wrap';
    exprResult.textContent = '';
    exprResult.className = 'g24-expr-result';
    submitBtn.disabled = true;
    return;
  }

  const res = clientValidate(expr);
  if (!res) {
    exprWrap.className = 'g24-expr-wrap';
    exprResult.textContent = '';
    submitBtn.disabled = true;
  } else if (res.ok) {
    exprWrap.className = 'g24-expr-wrap valid';
    exprResult.textContent = res.msg;
    exprResult.className = 'g24-expr-result ok';
    submitBtn.disabled = false;
  } else {
    exprWrap.className = 'g24-expr-wrap invalid';
    exprResult.textContent = res.msg;
    exprResult.className = 'g24-expr-result err';
    submitBtn.disabled = true;
  }
}

exprInput.addEventListener('input', onExprChange);
exprInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (!submitBtn.disabled) submitGuess();
  }
});

// ── Submit ──────────────────────────────────────────────────────────────────
function submitGuess() {
  const expr = exprInput.value.trim();
  if (!expr) return;
  submitBtn.disabled = true;
  exprInput.disabled = true;
  socket.emit('g24:submit', { roomId: myRoomId, expr });
}

submitBtn.addEventListener('click', submitGuess);

// ── Scores sidebar ──────────────────────────────────────────────────────────
function renderScores(scores, winnerId) {
  scoreList.innerHTML = '';
  scores.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'score-item' +
      (p.id === myId ? ' is-me' : '') +
      (p.id === winnerId ? ' winner-flash' : '');
    div.innerHTML = `
      <span class="score-rank">${i + 1}</span>
      <span class="score-name">${escHtml(p.name)}</span>
      <span class="score-pts">${p.score}</span>
    `;
    scoreList.appendChild(div);
  });
}

// ── Recap sidebar ────────────────────────────────────────────────────────────
function showRecap(data) {
  recapArea.style.display = '';
  if (data.winner) {
    recapContent.innerHTML = `
      <div class="recap-winner">🏅 ${escHtml(data.winner.name)} +${data.winner.points}</div>
      <div class="recap-expr">${escHtml(data.winner.expr)}</div>
      <div class="recap-solution">Solution: <span>${escHtml(data.solution)}</span></div>
    `;
  } else {
    recapContent.innerHTML = `
      <div style="color:var(--accent);font-weight:600;margin-bottom:0.3rem">⏱ No one solved it!</div>
      <div class="recap-solution">Solution: <span>${escHtml(data.solution)}</span></div>
    `;
  }
}

// ── Overlay score rows ───────────────────────────────────────────────────────
function renderOverlayScores(container, scores) {
  container.innerHTML = '';
  scores.forEach((p, i) => {
    const medals = ['🥇', '🥈', '🥉'];
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

// ── Feedback ─────────────────────────────────────────────────────────────────
function showFeedback(msg, type) {
  feedbackEl.textContent = msg;
  feedbackEl.className = `g24-feedback ${type}`;
  setTimeout(() => { feedbackEl.textContent = ''; feedbackEl.className = 'g24-feedback'; }, 3000);
}

// ── Re-enable input ───────────────────────────────────────────────────────────
function enableInput() {
  exprInput.disabled = false;
  exprInput.focus();
  onExprChange();
}

// ── Play again ────────────────────────────────────────────────────────────────
btnPlayAgain.addEventListener('click', () => {
  socket.emit('g24:reset', myRoomId);
  // g24:reset from server moves everyone back to the waiting screen
});

// ── Socket handlers ───────────────────────────────────────────────────────────

socket.on('connect', () => { myId = socket.id; });

socket.on('g24:joined', ({ roomId, playerId, room }) => {
  myId = playerId;
  myRoomId = roomId;
  roomOwnerId = room.owner;
  timerMax = room.timePerRound;
  renderWaiting(room);
  showScreen('waiting');
});

socket.on('g24:playerJoined', ({ room }) => {
  renderWaiting(room);
  SFX.join();
});

socket.on('g24:playerLeft', ({ room }) => {
  roomOwnerId = room.owner;
  renderWaiting(room);
  SFX.leave();
});

socket.on('g24:started', ({ room }) => {
  SFX.gameStart();
  timerMax = room.timePerRound;
  hudTotalRounds.textContent = room.rounds;
  recapArea.style.display = 'none';
  overlayRoundEnd.classList.add('hidden');
  overlayGameOver.classList.add('hidden');
  showScreen('game');
});

socket.on('g24:roundStart', ({ round, totalRounds, nums, timeLeft }) => {
  SFX.turnStart();
  currentNums = nums;

  hudRound.textContent = round;
  hudTotalRounds.textContent = totalRounds;
  updateTimerArc(timeLeft, timerMax);

  renderCards(nums);

  // Reset expression input
  exprInput.value = '';
  exprInput.disabled = false;
  exprWrap.className = 'g24-expr-wrap';
  exprResult.textContent = '';
  exprResult.className = 'g24-expr-result';
  submitBtn.disabled = true;
  feedbackEl.textContent = '';
  feedbackEl.className = 'g24-feedback';

  overlayRoundEnd.classList.add('hidden');
  exprInput.focus();
});

socket.on('g24:tick', ({ timeLeft }) => {
  updateTimerArc(timeLeft, timerMax);
  if (timeLeft <= 10 && timeLeft > 0) SFX.tick();
});

socket.on('g24:roundEnd', ({ round, winner, solution, nums, scores }) => {
  const isWinner = winner && winner.id === myId;
  if (winner) {
    if (isWinner) SFX.correct(); else SFX.otherCorrect();
  } else {
    SFX.roundEnd();
  }

  // Disable input
  exprInput.disabled = true;
  submitBtn.disabled = true;

  // Update scores in sidebar
  renderScores(scores, winner ? winner.id : null);

  // Show recap in sidebar
  showRecap({ winner, solution });

  // Show overlay
  if (winner) {
    const isMe = winner.id === myId;
    roundEndTitle.textContent = isMe ? '🎉 You got it!' : `🏅 ${winner.name} solved it!`;
    roundEndBody.innerHTML = `
      <div style="font-family:monospace;color:var(--green);font-size:1rem;margin-bottom:0.3rem">${escHtml(winner.expr)}</div>
      <div style="color:var(--text-dim)">+${winner.points} points</div>
    `;
  } else {
    roundEndTitle.textContent = '⏱ Time\'s Up!';
    roundEndBody.innerHTML = `<div style="color:var(--text-dim)">Nobody solved this one!</div>`;
  }
  roundEndBody.innerHTML += `<div style="margin-top:0.5rem;color:var(--text-dim);font-size:0.82rem">One solution: <span style="font-family:monospace;color:var(--yellow)">${escHtml(solution)}</span></div>`;

  renderOverlayScores(roundEndScores, scores);
  roundEndNext.textContent = 'Next round starting soon…';
  overlayRoundEnd.classList.remove('hidden');
});

socket.on('g24:gameOver', ({ scores, winner }) => {
  overlayRoundEnd.classList.add('hidden');

  const isMe = winner && winner.id === myId;
  if (winner) {
    if (isMe) SFX.win(); else SFX.lose();
    gameOverTitle.textContent = isMe ? '🎉 You won!' : `🏆 ${winner.name} wins!`;
  } else {
    gameOverTitle.textContent = 'Game Over!';
  }

  renderOverlayScores(gameOverScores, scores);
  overlayGameOver.classList.remove('hidden');

  const amOwner = myId === roomOwnerId;
  btnPlayAgain.style.display    = amOwner ? '' : 'none';
  gameOverCountdown.textContent = amOwner ? '' : 'Waiting for host to start a new game…';
});

socket.on('g24:reset', ({ room }) => {
  overlayGameOver.classList.add('hidden');
  overlayRoundEnd.classList.add('hidden');
  myRoomId    = room.id;
  roomOwnerId = room.owner;
  timerMax    = room.timePerRound;
  renderWaiting(room);
  showScreen('waiting');
});

socket.on('g24:error', ({ message }) => {
  // Re-enable input on submission error
  enableInput();
  showFeedback(message, 'err');
  showLobbyError(message);
});

// ── Invite link / direct join ─────────────────────────────────────────────────
const lobbyDirectJoin    = document.getElementById('lobby-direct-join');
const inpUsernameDirect  = document.getElementById('inp-username-direct');
const btnDirectJoin      = document.getElementById('btn-direct-join');
const btnBackToLobby     = document.getElementById('btn-back-to-lobby');
let _inviteCode = null;

function checkInviteUrl() {
  // Check both path-based and query-string invites
  const pathMatch = window.location.pathname.match(/^\/game24\/join\/([A-Z0-9]{6})$/i);
  const params = new URLSearchParams(window.location.search);
  const qCode = params.get('join');

  const code = pathMatch ? pathMatch[1].toUpperCase() : (qCode ? qCode.toUpperCase() : null);
  if (!code) return;

  _inviteCode = code;
  lobbyUser.classList.add('hidden');
  lobbyChoice.classList.add('hidden');
  lobbyDirectJoin.classList.remove('hidden');
  inpUsernameDirect.focus();
  history.replaceState(null, '', '/game24');
}

btnDirectJoin.addEventListener('click', () => {
  const name = inpUsernameDirect.value.trim();
  if (!name) { showLobbyError('Enter your name first'); return; }
  myUsername = name;
  socket.emit('g24:join', { code: _inviteCode, username: myUsername });
  _inviteCode = null;
  lobbyDirectJoin.classList.add('hidden');
});
inpUsernameDirect.addEventListener('keydown', e => {
  if (e.key === 'Enter') btnDirectJoin.click();
});
btnBackToLobby.addEventListener('click', () => {
  _inviteCode = null;
  lobbyDirectJoin.classList.add('hidden');
  lobbyUser.classList.remove('hidden');
  inpUsername.focus();
});

// ── Init ────────────────────────────────────────────────────────────────────
showScreen('lobby');
checkInviteUrl();
if (!_inviteCode) inpUsername.focus();
