/* ── Apples to Apples Client ────────────────────────────────────────────── */

const socket = io({ transports: ['websocket'] });

// ── State ──────────────────────────────────────────────────────────────────
let myId         = null;
let myRoomId     = null;
let myUsername   = '';
let roomOwnerId  = null;
let timerMax     = 45;
let currentPhase = 'lobby'; // lobby, picking, judging, reveal, game_end
let myHand       = [];
let isJudge      = false;
let hasSubmitted  = false;
let currentJudgeId = null;

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
const inpUsername   = document.getElementById('inp-username');
const btnContinue  = document.getElementById('btn-continue');
const lobbyError   = document.getElementById('lobby-error');
const lobbyChoice  = document.getElementById('lobby-choice-step');
const lobbyUser    = document.getElementById('lobby-username-step');

const btnCreate    = document.getElementById('btn-create');
const btnJoin      = document.getElementById('btn-join');
const inpRoomCode  = document.getElementById('inp-room-code');
const inpRounds    = document.getElementById('inp-rounds');

const waitingCode    = document.getElementById('waiting-room-code');
const waitingCount   = document.getElementById('waiting-player-count');
const waitingPlayers = document.getElementById('waiting-players');
const btnStart       = document.getElementById('btn-start');
const waitingNotOwner = document.getElementById('waiting-not-owner');
const btnCopyCode    = document.getElementById('btn-copy-code');
const btnCopyLink    = document.getElementById('btn-copy-link');
const linkCopiedMsg  = document.getElementById('link-copied-msg');

const hudRound       = document.getElementById('hud-round');
const hudTotalRounds = document.getElementById('hud-total-rounds');
const hudPhase       = document.getElementById('hud-phase');
const hudTimer       = document.getElementById('hud-timer');
const timerArc       = document.getElementById('timer-arc');
const aaCenter       = document.getElementById('aa-center');
const scoreList      = document.getElementById('score-list');

const overlayGame    = document.getElementById('overlay-game-end');
const gameWinner     = document.getElementById('game-end-winner');
const gameScores     = document.getElementById('game-end-scores');
const gameCountdown  = document.getElementById('game-end-countdown');
const btnPlayAgain   = document.getElementById('btn-play-again');

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
  socket.emit('aa:create', {
    username:    myUsername,
    totalRounds: parseInt(inpRounds.value),
  });
});

btnJoin.addEventListener('click', () => {
  const code = inpRoomCode.value.toUpperCase().trim();
  if (!code) { showLobbyError('Enter a room code'); return; }
  socket.emit('aa:join', { username: myUsername, roomId: code });
});

inpRoomCode.addEventListener('keydown', e => {
  if (e.key === 'Enter') btnJoin.click();
});

// ── Waiting Room ───────────────────────────────────────────────────────────
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
    btnStart.disabled = room.players.length < 3;
    btnStart.textContent = room.players.length < 3 ? 'Need 3+ players' : 'Start Game';
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
  const link = `${window.location.origin}/apples/join/${waitingCode.textContent}`;
  navigator.clipboard.writeText(link).then(() => {
    linkCopiedMsg.classList.remove('hidden');
    setTimeout(() => linkCopiedMsg.classList.add('hidden'), 2000);
  });
});

btnStart.addEventListener('click', () => {
  socket.emit('aa:start', myRoomId);
});

// Leave room on back link
document.getElementById('leave-link').addEventListener('click', e => {
  e.preventDefault();
  socket.emit('aa:leave');
  showScreen('lobby');
  resetLobby();
});

// ── Timer Arc ──────────────────────────────────────────────────────────────
const CIRC = 2 * Math.PI * 22;

function updateTimerArc(timeLeft, max) {
  const frac = Math.max(0, timeLeft / max);
  const offset = CIRC * (1 - frac);
  timerArc.style.strokeDashoffset = offset;

  if (frac > 0.5)       timerArc.style.stroke = '#16a34a';
  else if (frac > 0.25) timerArc.style.stroke = 'var(--yellow)';
  else                   timerArc.style.stroke = 'var(--accent)';

  hudTimer.textContent = timeLeft;
}

// ── Scoreboard ─────────────────────────────────────────────────────────────
function renderScores(scores) {
  scoreList.innerHTML = '';
  scores.forEach((p, i) => {
    const div = document.createElement('div');
    let cls = 'score-item';
    if (p.id === myId) cls += ' is-me';
    if (p.id === currentJudgeId) cls += ' is-judge';
    div.className = cls;
    div.innerHTML = `
      <span class="score-rank">${i + 1}</span>
      <span class="score-name">${escHtml(p.name)}</span>
      <span class="score-pts">${p.score}</span>
    `;
    scoreList.appendChild(div);
  });
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

// ── Picking Phase UI ──────────────────────────────────────────────────────
function renderPickingPhase(data) {
  currentPhase = 'picking';
  hasSubmitted = false;
  isJudge = data.isJudge;
  myHand = data.hand || [];
  currentJudgeId = data.judgeId;
  hudPhase.textContent = 'Pick a Card';
  hudRound.textContent = data.round;
  hudTotalRounds.textContent = data.totalRounds;
  timerMax = data.timeLeft;
  updateTimerArc(data.timeLeft, timerMax);

  // Update scoreboard from player list
  renderScores(data.players);

  if (isJudge) {
    aaCenter.innerHTML = `
      <div class="aa-judge-label">You are the Judge this round</div>
      <div class="aa-card aa-card-green aa-green-prompt">${escHtml(data.greenCard)}</div>
      <p class="aa-status-text">Waiting for other players to pick their cards…</p>
      <div class="aa-status-text" id="submit-count"></div>
    `;
  } else {
    aaCenter.innerHTML = `
      <div class="aa-judge-label">Judge: ${escHtml(data.judgeName)}</div>
      <div class="aa-card aa-card-green aa-green-prompt">${escHtml(data.greenCard)}</div>
      <p class="aa-status-text">Pick a red card from your hand!</p>
      <div class="aa-hand" id="hand-container"></div>
      <div class="aa-status-text" id="submit-count"></div>
    `;

    const handEl = document.getElementById('hand-container');
    myHand.forEach((card, idx) => {
      const cardEl = document.createElement('div');
      cardEl.className = 'aa-hand-card';
      cardEl.textContent = card;
      cardEl.addEventListener('click', () => {
        if (hasSubmitted) return;
        hasSubmitted = true;
        socket.emit('aa:submit', { cardIndex: idx });
        // Highlight selected, disable others
        handEl.querySelectorAll('.aa-hand-card').forEach((c, ci) => {
          if (ci === idx) {
            c.classList.add('selected');
          } else {
            c.classList.add('disabled');
          }
        });
        const statusP = aaCenter.querySelector('.aa-status-text');
        if (statusP) statusP.textContent = 'Card submitted! Waiting for others…';
      });
      handEl.appendChild(cardEl);
    });
  }
}

// ── Judging Phase UI ──────────────────────────────────────────────────────
function renderJudgingPhase(data) {
  currentPhase = 'judging';
  currentJudgeId = data.judgeId;
  hudPhase.textContent = 'Judge Picks';
  timerMax = data.timeLeft;
  updateTimerArc(data.timeLeft, timerMax);

  const amJudge = data.judgeId === myId;

  aaCenter.innerHTML = `
    <div class="aa-judge-label">${amJudge ? 'You are the Judge — pick the best match!' : `Judge: ${escHtml(data.judgeName)} is picking…`}</div>
    <div class="aa-card aa-card-green aa-green-prompt">${escHtml(data.greenCard)}</div>
    <div class="aa-judge-cards" id="judge-cards"></div>
    <p class="aa-status-text" id="judging-status">${amJudge ? 'Click the funniest card!' : 'Waiting for the judge to decide…'}</p>
  `;

  const cardsEl = document.getElementById('judge-cards');
  data.cards.forEach((c) => {
    const cardEl = document.createElement('div');
    cardEl.className = 'aa-judge-card' + (amJudge ? ' clickable' : '');
    cardEl.textContent = c.card;
    if (amJudge) {
      cardEl.addEventListener('click', () => {
        socket.emit('aa:judge', { cardIndex: c.index });
        // Disable further clicks
        cardsEl.querySelectorAll('.aa-judge-card').forEach(el => {
          el.classList.remove('clickable');
        });
        cardEl.classList.add('winner');
        const status = document.getElementById('judging-status');
        if (status) status.textContent = 'You picked! Revealing…';
      });
    }
    cardsEl.appendChild(cardEl);
  });
}

// ── Reveal Phase UI ───────────────────────────────────────────────────────
function renderReveal(data) {
  currentPhase = 'reveal';
  hudPhase.textContent = 'Reveal';
  renderScores(data.scores);

  aaCenter.innerHTML = `
    <div class="aa-card aa-card-green aa-green-prompt">${escHtml(data.greenCard)}</div>
    <div style="text-align:center">
      <span style="font-size:1.1rem;font-weight:800;color:#facc15">🏆 ${escHtml(data.winnerName)} wins this round!</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:0.5rem;max-width:500px;width:100%" id="reveal-list"></div>
  `;

  const list = document.getElementById('reveal-list');
  for (const sub of data.allSubmissions) {
    const div = document.createElement('div');
    div.className = 'aa-reveal-sub' + (sub.isWinner ? ' is-winner' : '');
    div.innerHTML = `
      <span class="aa-reveal-name">${escHtml(sub.playerName)}${sub.playerId === myId ? ' (you)' : ''}</span>
      <span class="aa-reveal-card-text">${escHtml(sub.card)}</span>
      ${sub.isWinner ? '<span class="aa-reveal-winner-badge">WINNER</span>' : ''}
    `;
    list.appendChild(div);
  }

  // Sound
  if (data.winnerId === myId) {
    SFX.win();
  } else {
    SFX.turnStart();
  }
}

// ── Play Again ──────────────────────────────────────────────────────────────
btnPlayAgain.addEventListener('click', () => {
  socket.emit('aa:reset', myRoomId);
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

socket.on('aa:joined', ({ roomId, playerId, room }) => {
  myId        = playerId;
  myRoomId    = roomId;
  roomOwnerId = room.owner;
  renderWaiting(room);
  showScreen('waiting');
});

socket.on('aa:playerJoined', ({ room }) => {
  renderWaiting(room);
  SFX.join();
});

socket.on('aa:playerLeft', ({ room }) => {
  roomOwnerId = room.owner;
  if (room.state === 'lobby') {
    renderWaiting(room);
  }
  SFX.leave();
});

socket.on('aa:started', ({ room }) => {
  SFX.gameStart();
  hudTotalRounds.textContent = room.totalRounds;
  showScreen('game');
  overlayGame.classList.add('hidden');
});

socket.on('aa:tick', ({ timeLeft }) => {
  updateTimerArc(timeLeft, timerMax);
  if (timeLeft <= 5 && timeLeft > 0) SFX.tick();
});

socket.on('aa:roundStart', (data) => {
  SFX.turnStart();
  renderPickingPhase(data);
});

socket.on('aa:submitted', ({ card }) => {
  // Confirmation that our card was accepted - already handled in click handler
});

socket.on('aa:submitCount', ({ count, total }) => {
  const el = document.getElementById('submit-count');
  if (el) el.textContent = `${count} / ${total} cards submitted`;
});

socket.on('aa:judgingStart', (data) => {
  renderJudgingPhase(data);
});

socket.on('aa:reveal', (data) => {
  renderReveal(data);
});

socket.on('aa:gameOver', ({ scores, winner }) => {
  currentPhase = 'game_end';

  if (winner) {
    const isMe = winner.id === myId;
    if (isMe) SFX.win(); else SFX.lose();
    gameWinner.textContent = isMe ? '🎉 You won!' : `🍎 ${winner.name} wins!`;
  } else {
    gameWinner.textContent = 'Game Over!';
  }

  renderOverlayScores(gameScores, scores);
  overlayGame.classList.remove('hidden');

  const amOwner = myId === roomOwnerId;
  btnPlayAgain.style.display = amOwner ? '' : 'none';
  gameCountdown.textContent  = amOwner ? '' : 'Waiting for host to start a new game…';
});

socket.on('aa:reset', ({ room }) => {
  overlayGame.classList.add('hidden');
  myRoomId    = room.id;
  roomOwnerId = room.owner;
  renderWaiting(room);
  showScreen('waiting');
});

socket.on('aa:error', ({ message }) => {
  showLobbyError(message);
});

// ── Invite Link / Direct Join ─────────────────────────────────────────────
const lobbyDirectJoin    = document.getElementById('lobby-direct-join');
const inpUsernameDirect  = document.getElementById('inp-username-direct');
const btnDirectJoin      = document.getElementById('btn-direct-join');
const btnBackToLobby     = document.getElementById('btn-back-to-lobby');
let _inviteCode = null;

function checkInviteUrl() {
  const match = window.location.pathname.match(/^\/apples\/join\/([A-Z0-9]{6})$/i);
  if (!match) return;
  _inviteCode = match[1].toUpperCase();

  lobbyUser.classList.add('hidden');
  lobbyChoice.classList.add('hidden');
  lobbyDirectJoin.classList.remove('hidden');
  inpUsernameDirect.focus();

  history.replaceState(null, '', '/apples');
}

btnDirectJoin.addEventListener('click', () => {
  const name = inpUsernameDirect.value.trim();
  if (!name) { showLobbyError('Enter your name first'); return; }
  myUsername = name;
  socket.emit('aa:join', { username: myUsername, roomId: _inviteCode });
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
