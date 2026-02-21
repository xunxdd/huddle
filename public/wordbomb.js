/* ── Word Bomb Client ───────────────────────────────────────────────────── */

const socket = io({ transports: ['websocket'] });

// ── State ──────────────────────────────────────────────────────────────────
let myId        = null;
let myRoomId    = null;
let myUsername  = '';
let gameState   = { timePerTurn: 12, activePlayerId: null };
let timerMax    = 12;
let roomOwnerId = null;

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
const inpUsername  = document.getElementById('inp-username');
const btnContinue  = document.getElementById('btn-continue');
const lobbyError   = document.getElementById('lobby-error');
const lobbyChoice  = document.getElementById('lobby-choice-step');
const lobbyUser    = document.getElementById('lobby-username-step');

const btnCreate    = document.getElementById('btn-create');
const btnJoin      = document.getElementById('btn-join');
const inpRoomCode  = document.getElementById('inp-room-code');
const inpRounds    = document.getElementById('inp-rounds');
const inpTime      = document.getElementById('inp-time');

const waitingCode  = document.getElementById('waiting-room-code');
const waitingCount = document.getElementById('waiting-player-count');
const waitingMax   = document.getElementById('waiting-max-players');
const waitingPlayers = document.getElementById('waiting-players');
const btnStart     = document.getElementById('btn-start');
const waitingNotOwner = document.getElementById('waiting-not-owner');
const btnCopyCode  = document.getElementById('btn-copy-code');
const btnCopyLink  = document.getElementById('btn-copy-link');
const linkCopiedMsg = document.getElementById('link-copied-msg');

const hudRound     = document.getElementById('hud-round');
const hudTotalRounds = document.getElementById('hud-total-rounds');
const hudCombo     = document.getElementById('hud-combo');
const hudTimer     = document.getElementById('hud-timer');
const timerArc     = document.getElementById('timer-arc');
const centerCombo  = document.getElementById('center-combo');
const activeLabel  = document.getElementById('active-label');
const wbInput      = document.getElementById('wb-word-input');
const wbSubmit     = document.getElementById('wb-submit-btn');
const wbFeedback   = document.getElementById('wb-feedback');
const scoreList    = document.getElementById('score-list');
const feedItems    = document.getElementById('feed-items');

const overlayRound = document.getElementById('overlay-round-end');
const roundTitle   = document.getElementById('round-end-title');
const roundScores  = document.getElementById('round-end-scores');
const roundNext    = document.getElementById('round-end-next');

const overlayGame  = document.getElementById('overlay-game-end');
const gameWinner   = document.getElementById('game-end-winner');
const gameScores   = document.getElementById('game-end-scores');
const gameCountdown = document.getElementById('game-end-countdown');
const btnPlayAgain = document.getElementById('btn-play-again');

// ── Tabs ───────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ── Lobby Logic ────────────────────────────────────────────────────────────
function showLobbyError(msg) {
  lobbyError.textContent = msg;
  lobbyError.classList.remove('hidden');
  setTimeout(() => lobbyError.classList.add('hidden'), 4000);
}

btnContinue.addEventListener('click', () => {
  const name = inpUsername.value.trim();
  if (!name) { showLobbyError('Enter your name first'); return; }
  myUsername = name;
  lobbyUser.classList.add('hidden');
  lobbyChoice.classList.remove('hidden');
});

inpUsername.addEventListener('keydown', e => {
  if (e.key === 'Enter') btnContinue.click();
});

btnCreate.addEventListener('click', () => {
  socket.emit('wb:create', {
    username:    myUsername,
    totalRounds: parseInt(inpRounds.value),
    timePerTurn: parseInt(inpTime.value),
    maxPlayers:  8,
  });
});

btnJoin.addEventListener('click', () => {
  const code = inpRoomCode.value.toUpperCase().trim();
  if (!code) { showLobbyError('Enter a room code'); return; }
  socket.emit('wb:join', { username: myUsername, roomId: code });
});

inpRoomCode.addEventListener('keydown', e => {
  if (e.key === 'Enter') btnJoin.click();
});

// ── Waiting Room ───────────────────────────────────────────────────────────
function renderWaiting(room) {
  waitingCode.textContent = room.id;
  waitingCount.textContent = room.players.length;
  waitingMax.textContent = room.maxPlayers;

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
  const link = `${window.location.origin}/wordbomb/join/${waitingCode.textContent}`;
  navigator.clipboard.writeText(link).then(() => {
    linkCopiedMsg.classList.remove('hidden');
    setTimeout(() => linkCopiedMsg.classList.add('hidden'), 2000);
  });
});

btnStart.addEventListener('click', () => {
  socket.emit('wb:start', myRoomId);
});

// Leave room on back link
document.querySelector('#screen-waiting .back-link').addEventListener('click', e => {
  e.preventDefault();
  socket.emit('wb:leave');
  showScreen('lobby');
  resetLobby();
});

// ── Game UI ────────────────────────────────────────────────────────────────
const CIRC = 2 * Math.PI * 22; // r=22

function updateTimerArc(timeLeft, max) {
  const frac = Math.max(0, timeLeft / max);
  const offset = CIRC * (1 - frac);
  timerArc.style.strokeDashoffset = offset;

  // Color shift as time runs low
  if (frac > 0.5)      timerArc.style.stroke = 'var(--green)';
  else if (frac > 0.25) timerArc.style.stroke = 'var(--yellow)';
  else                  timerArc.style.stroke = 'var(--accent)';

  hudTimer.textContent = timeLeft;
}

function renderScores(scores) {
  scoreList.innerHTML = '';
  scores.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'score-item' +
      (p.id === gameState.activePlayerId ? ' active-player' : '') +
      (p.id === myId ? ' is-me' : '');
    div.innerHTML = `
      <span class="score-rank">${i + 1}</span>
      <span class="score-name">${escHtml(p.name)}</span>
      <span class="score-pts">${p.score}</span>
    `;
    scoreList.appendChild(div);
  });
}

function addFeedItem(html) {
  const div = document.createElement('div');
  div.className = 'feed-item';
  div.innerHTML = html;
  feedItems.prepend(div);

  // Cap feed at 20 items
  while (feedItems.children.length > 20) {
    feedItems.removeChild(feedItems.lastChild);
  }
}

function setInputActive(active) {
  wbInput.disabled = !active;
  wbSubmit.disabled = !active;
  if (active) {
    wbInput.focus();
    wbInput.value = '';
  }
}

function showFeedback(msg, type) {
  wbFeedback.textContent = msg;
  wbFeedback.className = `wb-feedback ${type}`;
  if (type === 'err') {
    wbInput.classList.add('shake');
    setTimeout(() => wbInput.classList.remove('shake'), 400);
  }
  setTimeout(() => { wbFeedback.textContent = ''; wbFeedback.className = 'wb-feedback'; }, 2000);
}

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

// ── Submit ──────────────────────────────────────────────────────────────────
function submitWord() {
  const word = wbInput.value.trim();
  if (!word) return;
  socket.emit('wb:submitWord', { roomId: myRoomId, word });
  wbInput.value = '';
}

wbSubmit.addEventListener('click', submitWord);
wbInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') submitWord();
});

// ── Play Again ──────────────────────────────────────────────────────────────
btnPlayAgain.addEventListener('click', () => {
  socket.emit('wb:reset', myRoomId);
  // wb:reset from server moves everyone back to the waiting screen
});

// ── Helpers ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resetLobby() {
  myRoomId = null;
  lobbyUser.classList.remove('hidden');
  lobbyChoice.classList.add('hidden');
  lobbyError.classList.add('hidden');
  inpUsername.value = myUsername;
}

// ── Socket Handlers ─────────────────────────────────────────────────────────

socket.on('connect', () => {
  myId = socket.id;
});

socket.on('wb:joined', ({ roomId, playerId, room }) => {
  myId        = playerId;
  myRoomId    = roomId;
  roomOwnerId = room.owner;
  gameState.timePerTurn = room.timePerTurn;
  timerMax    = room.timePerTurn;
  renderWaiting(room);
  showScreen('waiting');
});

socket.on('wb:playerJoined', ({ room }) => {
  renderWaiting(room);
  SFX.join();
});

socket.on('wb:playerLeft', ({ room }) => {
  roomOwnerId = room.owner;
  renderWaiting(room);
  SFX.leave();
});

socket.on('wb:started', ({ room }) => {
  SFX.gameStart();
  gameState.timePerTurn = room.timePerTurn;
  timerMax = room.timePerTurn;
  hudTotalRounds.textContent = room.totalRounds;
  feedItems.innerHTML = '';
  showScreen('game');
  overlayRound.classList.add('hidden');
  overlayGame.classList.add('hidden');
});

socket.on('wb:turnStart', ({ activePlayerId, activePlayerName, combo, timeLeft, round, totalRounds, scores }) => {
  SFX.turnStart();
  gameState.activePlayerId = activePlayerId;
  const isMe = activePlayerId === myId;

  hudRound.textContent = round;
  hudTotalRounds.textContent = totalRounds;
  hudCombo.textContent = combo;
  centerCombo.textContent = combo;
  timerMax = gameState.timePerTurn;
  updateTimerArc(timeLeft, timerMax);

  if (isMe) {
    activeLabel.innerHTML = `<strong>Your turn!</strong> Type a word containing <strong>${escHtml(combo)}</strong>`;
  } else {
    activeLabel.innerHTML = `<strong>${escHtml(activePlayerName)}</strong> is typing…`;
  }

  setInputActive(isMe);
  renderScores(scores);

  // Clear old feedback
  wbFeedback.textContent = '';
  wbFeedback.className = 'wb-feedback';

  // Hide round overlay if showing
  overlayRound.classList.add('hidden');
});

socket.on('wb:tick', ({ timeLeft }) => {
  updateTimerArc(timeLeft, timerMax);
  if (timeLeft <= 5 && timeLeft > 0) SFX.tick();
});

socket.on('wb:wordAccepted', ({ playerId, playerName, word, points, breakdown, scores }) => {
  const isMe = playerId === myId;
  if (isMe) { showFeedback(`+${points} pts!`, 'ok'); SFX.correct(); }
  else SFX.otherCorrect();

  addFeedItem(`
    <span class="feed-name">${escHtml(playerName)}</span>
    → <span class="feed-word">"${escHtml(word)}"</span>
    <span class="feed-pts">+${points}</span>
    <span style="color:var(--text-dim);font-size:0.75rem">(${breakdown.base}+${breakdown.timeBonus}+${breakdown.lengthBonus})</span>
  `);

  renderScores(scores);
  setInputActive(false);
});

socket.on('wb:wordRejected', ({ reason }) => {
  showFeedback(reason, 'err');
});

socket.on('wb:turnEnd', ({ playerId, timedOut, scores }) => {
  if (timedOut) {
    const p = scores.find(s => s.id === playerId);
    const name = p ? p.name : 'Player';
    addFeedItem(`<span class="feed-name">${escHtml(name)}</span> <span class="feed-timeout">✗ timed out</span>`);
    if (playerId === myId) showFeedback('Time\'s up!', 'err');
  }
  renderScores(scores);
  setInputActive(false);
  updateTimerArc(0, timerMax);
});

socket.on('wb:roundEnd', ({ round, totalRounds, scores, isLastRound }) => {
  if (isLastRound) return; // game end overlay will show
  SFX.roundEnd();
  roundTitle.textContent = `Round ${round} Complete!`;
  renderOverlayScores(roundScores, scores);
  roundNext.textContent = `Round ${round + 1} starting in 3 seconds…`;
  overlayRound.classList.remove('hidden');
});

socket.on('wb:ended', ({ scores, winner }) => {
  overlayRound.classList.add('hidden');

  if (winner) {
    const isMe = winner.id === myId;
    if (isMe) SFX.win(); else SFX.lose();
    gameWinner.textContent = isMe ? '🎉 You won!' : `🏆 ${winner.name} wins!`;
  } else {
    gameWinner.textContent = 'Game Over!';
  }

  renderOverlayScores(gameScores, scores);
  overlayGame.classList.remove('hidden');

  const amOwner = myId === roomOwnerId;
  btnPlayAgain.style.display = amOwner ? '' : 'none';
  gameCountdown.textContent  = amOwner ? '' : 'Waiting for host to start a new game…';
});

socket.on('wb:reset', ({ room }) => {
  overlayGame.classList.add('hidden');
  overlayRound.classList.add('hidden');
  myRoomId    = room.id;
  roomOwnerId = room.owner;
  gameState.timePerTurn = room.timePerTurn;
  timerMax    = room.timePerTurn;
  renderWaiting(room);
  showScreen('waiting');
});

socket.on('wb:error', ({ message }) => {
  showLobbyError(message);
});

// ── Invite Link / Direct Join ─────────────────────────────────────────────────
const lobbyDirectJoin = document.getElementById('lobby-direct-join');
const inpUsernameDirect = document.getElementById('inp-username-direct');
const btnDirectJoin = document.getElementById('btn-direct-join');
const btnBackToLobby = document.getElementById('btn-back-to-lobby');
let _inviteCode = null;

function checkInviteUrl() {
  const match = window.location.pathname.match(/^\/wordbomb\/join\/([A-Z0-9]{6})$/i);
  if (!match) return;
  _inviteCode = match[1].toUpperCase();

  // Show direct-join panel, hide normal username step
  lobbyUser.classList.add('hidden');
  lobbyChoice.classList.add('hidden');
  lobbyDirectJoin.classList.remove('hidden');
  inpUsernameDirect.focus();

  // Clear the invite path from the URL without reloading
  history.replaceState(null, '', '/wordbomb');
}

btnDirectJoin.addEventListener('click', () => {
  const name = inpUsernameDirect.value.trim();
  if (!name) { showLobbyError('Enter your name first'); return; }
  myUsername = name;
  socket.emit('wb:join', { username: myUsername, roomId: _inviteCode });
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

// ── Init ─────────────────────────────────────────────────────────────────────
showScreen('lobby');
checkInviteUrl();
if (!_inviteCode) inpUsername.focus();
