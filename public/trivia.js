/* ── Trivia Client ──────────────────────────────────────────────────────── */

const socket = io({ transports: ['websocket'] });

// ── State ──────────────────────────────────────────────────────────────────
let myId         = null;
let myRoomId     = null;
let myUsername   = '';
let roomOwnerId  = null;
let timerMax     = 10;
let hasVoted     = false;
let hasAnswered  = false;
let currentPhase = 'lobby'; // lobby, voting, question, reveal, game_end

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
const inpTime      = document.getElementById('inp-time');

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
const tvCenter       = document.getElementById('tv-center');
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
  socket.emit('tv:create', {
    username:        myUsername,
    totalRounds:     parseInt(inpRounds.value),
    timePerQuestion: parseInt(inpTime.value),
  });
});

btnJoin.addEventListener('click', () => {
  const code = inpRoomCode.value.toUpperCase().trim();
  if (!code) { showLobbyError('Enter a room code'); return; }
  socket.emit('tv:join', { username: myUsername, roomId: code });
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
  const link = `${window.location.origin}/trivia/join/${waitingCode.textContent}`;
  navigator.clipboard.writeText(link).then(() => {
    linkCopiedMsg.classList.remove('hidden');
    setTimeout(() => linkCopiedMsg.classList.add('hidden'), 2000);
  });
});

btnStart.addEventListener('click', () => {
  socket.emit('tv:start', myRoomId);
});

// Leave room on back link
document.querySelector('#screen-waiting .back-link').addEventListener('click', e => {
  e.preventDefault();
  socket.emit('tv:leave');
  showScreen('lobby');
  resetLobby();
});

// ── Timer Arc ──────────────────────────────────────────────────────────────
const CIRC = 2 * Math.PI * 22;

function updateTimerArc(timeLeft, max) {
  const frac = Math.max(0, timeLeft / max);
  const offset = CIRC * (1 - frac);
  timerArc.style.strokeDashoffset = offset;

  if (frac > 0.5)       timerArc.style.stroke = '#8b5cf6';
  else if (frac > 0.25) timerArc.style.stroke = 'var(--yellow)';
  else                   timerArc.style.stroke = 'var(--accent)';

  hudTimer.textContent = timeLeft;
}

// ── Scoreboard ─────────────────────────────────────────────────────────────
function renderScores(scores) {
  scoreList.innerHTML = '';
  scores.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'score-item' + (p.id === myId ? ' is-me' : '');
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

// ── Vote UI ────────────────────────────────────────────────────────────────
function renderVotePhase(data) {
  currentPhase = 'voting';
  hasVoted = false;
  hudPhase.textContent = 'Vote';
  hudRound.textContent = data.round;
  hudTotalRounds.textContent = data.totalRounds;
  timerMax = 10;
  updateTimerArc(data.timeLeft, timerMax);
  if (data.scores) renderScores(data.scores);

  tvCenter.innerHTML = `
    <div class="tv-vote-label">Vote for a category</div>
    <div class="tv-vote-grid" id="vote-grid"></div>
    <div class="tv-vote-status" id="vote-status">0 / ? voted</div>
  `;

  const grid = document.getElementById('vote-grid');
  for (const cat of data.categories) {
    const btn = document.createElement('button');
    btn.className = 'tv-vote-btn';
    btn.innerHTML = `<span class="tv-vote-emoji">${cat.emoji}</span>${escHtml(cat.name)}`;
    btn.addEventListener('click', () => {
      if (hasVoted) return;
      hasVoted = true;
      socket.emit('tv:vote', { categoryId: cat.id });
      // Disable all vote buttons, highlight chosen
      grid.querySelectorAll('.tv-vote-btn').forEach(b => {
        b.disabled = true;
        if (b === btn) b.classList.add('voted');
      });
    });
    grid.appendChild(btn);
  }
}

// ── Vote Result ────────────────────────────────────────────────────────────
function showVoteResult(data) {
  hudPhase.textContent = 'Loading...';
  tvCenter.innerHTML = `
    <div style="font-size:2.5rem;margin-bottom:0.5rem">${data.category.emoji}</div>
    <div style="font-size:1.3rem;font-weight:800">${escHtml(data.category.name)}</div>
    <div style="color:var(--text-dim);font-size:0.9rem;margin-top:0.25rem">Category selected!</div>
  `;
}

// ── Question UI ────────────────────────────────────────────────────────────
function renderQuestionPhase(data) {
  currentPhase = 'question';
  hasAnswered = false;
  hudPhase.textContent = 'Answer';
  hudRound.textContent = data.round;
  hudTotalRounds.textContent = data.totalRounds;
  timerMax = data.timeLeft;
  updateTimerArc(data.timeLeft, timerMax);

  const diffClass = data.difficulty === 'easy' ? 'tv-diff-easy' :
                    data.difficulty === 'medium' ? 'tv-diff-medium' : 'tv-diff-hard';

  const letters = ['A', 'B', 'C', 'D'];

  tvCenter.innerHTML = `
    <div>
      <span class="tv-question-category">${escHtml(data.category)}</span>
      <span class="tv-question-difficulty ${diffClass}">${escHtml(data.difficulty)}</span>
    </div>
    <div class="tv-question-text">${escHtml(data.question)}</div>
    <div class="tv-answers-grid" id="answers-grid"></div>
    <div class="tv-answer-status" id="answer-status"></div>
  `;

  const grid = document.getElementById('answers-grid');
  data.answers.forEach((ans, idx) => {
    const btn = document.createElement('button');
    btn.className = 'tv-answer-btn';
    btn.dataset.index = idx;
    btn.innerHTML = `
      <span class="tv-answer-letter">${letters[idx]}</span>
      <span class="tv-answer-text">${escHtml(ans)}</span>
    `;
    btn.addEventListener('click', () => {
      if (hasAnswered) return;
      hasAnswered = true;
      socket.emit('tv:answer', { answerIndex: idx });
      // Disable all, highlight chosen
      grid.querySelectorAll('.tv-answer-btn').forEach(b => {
        b.disabled = true;
        if (b === btn) b.classList.add('selected');
      });
      const status = document.getElementById('answer-status');
      if (status) status.textContent = 'Answer locked in!';
    });
    grid.appendChild(btn);
  });
}

// ── Reveal UI ──────────────────────────────────────────────────────────────
function renderReveal(data) {
  currentPhase = 'reveal';
  hudPhase.textContent = 'Reveal';
  if (data.scores) renderScores(data.scores);

  // Update answer buttons to show correct/wrong
  const grid = document.getElementById('answers-grid');
  if (grid) {
    grid.querySelectorAll('.tv-answer-btn').forEach(btn => {
      const idx = parseInt(btn.dataset.index);
      btn.classList.add('revealed');
      btn.disabled = true;
      if (idx === data.correctIndex) {
        btn.classList.add('correct');
      } else {
        btn.classList.add('wrong');
      }
    });
  }

  // Show player results below answers
  const status = document.getElementById('answer-status');
  if (status) {
    const myResult = data.playerResults.find(r => r.id === myId);
    if (myResult) {
      if (myResult.correct) {
        status.innerHTML = `<span style="color:var(--green);font-weight:700">Correct! +${myResult.points} pts</span>`;
        SFX.correct();
      } else if (myResult.answerIndex === -1) {
        status.innerHTML = `<span style="color:var(--text-dim)">No answer</span>`;
      } else {
        status.innerHTML = `<span style="color:#ef4444;font-weight:700">Wrong!</span>`;
        SFX.lose();
      }
    }
  }

  // Render player result chips
  const existing = document.getElementById('reveal-results');
  if (existing) existing.remove();

  const resultsDiv = document.createElement('div');
  resultsDiv.id = 'reveal-results';
  resultsDiv.className = 'tv-reveal-results';
  resultsDiv.style.marginTop = '0.75rem';

  for (const r of data.playerResults) {
    const chip = document.createElement('span');
    chip.className = `tv-reveal-player ${r.correct ? 'correct' : 'wrong'}`;
    chip.textContent = r.correct ? `${r.name} +${r.points}` : `${r.name} ✗`;
    resultsDiv.appendChild(chip);
  }

  tvCenter.appendChild(resultsDiv);
}

// ── Play Again ──────────────────────────────────────────────────────────────
btnPlayAgain.addEventListener('click', () => {
  socket.emit('tv:reset', myRoomId);
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

socket.on('tv:joined', ({ roomId, playerId, room }) => {
  myId        = playerId;
  myRoomId    = roomId;
  roomOwnerId = room.owner;
  renderWaiting(room);
  showScreen('waiting');
});

socket.on('tv:playerJoined', ({ room }) => {
  renderWaiting(room);
  SFX.join();
});

socket.on('tv:playerLeft', ({ room }) => {
  roomOwnerId = room.owner;
  renderWaiting(room);
  SFX.leave();
});

socket.on('tv:started', ({ room }) => {
  SFX.gameStart();
  hudTotalRounds.textContent = room.totalRounds;
  showScreen('game');
  overlayGame.classList.add('hidden');
});

socket.on('tv:voteStart', (data) => {
  renderVotePhase(data);
});

socket.on('tv:playerVoted', ({ voteCount, totalPlayers }) => {
  const status = document.getElementById('vote-status');
  if (status) status.textContent = `${voteCount} / ${totalPlayers} voted`;
});

socket.on('tv:tick', ({ timeLeft }) => {
  updateTimerArc(timeLeft, timerMax);
  if (timeLeft <= 5 && timeLeft > 0) SFX.tick();
});

socket.on('tv:voteResult', (data) => {
  showVoteResult(data);
});

socket.on('tv:questionStart', (data) => {
  SFX.turnStart();
  renderQuestionPhase(data);
});

socket.on('tv:playerAnswered', ({ answerCount, totalPlayers }) => {
  const status = document.getElementById('answer-status');
  if (status && !hasAnswered) {
    status.textContent = `${answerCount} / ${totalPlayers} answered`;
  }
});

socket.on('tv:reveal', (data) => {
  renderReveal(data);
});

socket.on('tv:gameOver', ({ scores, winner }) => {
  currentPhase = 'game_end';

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

socket.on('tv:reset', ({ room }) => {
  overlayGame.classList.add('hidden');
  myRoomId    = room.id;
  roomOwnerId = room.owner;
  renderWaiting(room);
  showScreen('waiting');
});

socket.on('tv:error', ({ message }) => {
  showLobbyError(message);
});

// ── Invite Link / Direct Join ─────────────────────────────────────────────────
const lobbyDirectJoin    = document.getElementById('lobby-direct-join');
const inpUsernameDirect  = document.getElementById('inp-username-direct');
const btnDirectJoin      = document.getElementById('btn-direct-join');
const btnBackToLobby     = document.getElementById('btn-back-to-lobby');
let _inviteCode = null;

function checkInviteUrl() {
  const match = window.location.pathname.match(/^\/trivia\/join\/([A-Z0-9]{6})$/i);
  if (!match) return;
  _inviteCode = match[1].toUpperCase();

  lobbyUser.classList.add('hidden');
  lobbyChoice.classList.add('hidden');
  lobbyDirectJoin.classList.remove('hidden');
  inpUsernameDirect.focus();

  history.replaceState(null, '', '/trivia');
}

btnDirectJoin.addEventListener('click', () => {
  const name = inpUsernameDirect.value.trim();
  if (!name) { showLobbyError('Enter your name first'); return; }
  myUsername = name;
  socket.emit('tv:join', { username: myUsername, roomId: _inviteCode });
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
