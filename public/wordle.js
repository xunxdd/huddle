/* ── Family Wordle Client ──────────────────────────────────────────────────── */
'use strict';

const socket = io();

// ── State ───────────────────────────────────────────────────────────────────
let myId         = null;
let myRoomId     = null;
let myUsername   = '';
let submitted    = false;      // locked after submitting this round
let inputEnabled = false;
let currentInput = '';         // letters typed so far (max 6)
let timerMax     = 60;
let revealedRows = 0;          // how many grid rows have been revealed
let roomOwnerId  = null;

// Key state: best tile result per letter seen across revealed rows
const keyStates = {};          // letter → 'correct' | 'present' | 'absent'

// ── Screens ─────────────────────────────────────────────────────────────────
const screens = {
  lobby:   document.getElementById('screen-lobby'),
  waiting: document.getElementById('screen-waiting'),
  game:    document.getElementById('screen-game'),
};
function showScreen(name) {
  for (const [k, el] of Object.entries(screens)) {
    if (k === name) { el.classList.remove('hidden'); el.style.display = ''; }
    else            { el.classList.add('hidden');    el.style.display = 'none'; }
  }
}

// ── DOM refs ────────────────────────────────────────────────────────────────
const inpUsername      = document.getElementById('inp-username');
const btnContinue      = document.getElementById('btn-continue');
const lobbyError       = document.getElementById('lobby-error');
const lobbyChoice      = document.getElementById('lobby-choice-step');
const lobbyUser        = document.getElementById('lobby-username-step');
const btnCreate        = document.getElementById('btn-create');
const btnJoin          = document.getElementById('btn-join');
const inpRoomCode      = document.getElementById('inp-room-code');
const inpTime          = document.getElementById('inp-time');
const waitingCode      = document.getElementById('waiting-room-code');
const waitingCount     = document.getElementById('waiting-player-count');
const waitingPlayers   = document.getElementById('waiting-players');
const btnStart         = document.getElementById('btn-start');
const waitingNotOwner  = document.getElementById('waiting-not-owner');
const btnCopyCode      = document.getElementById('btn-copy-code');
const btnCopyLink      = document.getElementById('btn-copy-link');
const linkCopiedMsg    = document.getElementById('link-copied-msg');
const hudGuessNum      = document.getElementById('hud-guess-num');
const hudMaxGuesses    = document.getElementById('hud-max-guesses');
const hudTimer         = document.getElementById('hud-timer');
const fwGrid           = document.getElementById('fw-grid');
const fwFeedback       = document.getElementById('fw-feedback');
const fwPlayersList    = document.getElementById('fw-players-list');
const fwPlayerStrip    = document.getElementById('fw-player-strip');
const fwRecap          = document.getElementById('fw-recap');
const fwHiddenInput    = document.getElementById('fw-hidden-input');
const overlayGameOver  = document.getElementById('overlay-game-over');
const gameOverEmoji    = document.getElementById('game-over-emoji');
const gameOverTitle    = document.getElementById('game-over-title');
const gameOverWord     = document.getElementById('game-over-word');
const gameOverScores   = document.getElementById('game-over-scores');
const gameOverCountdown = document.getElementById('game-over-countdown');
const btnPlayAgain     = document.getElementById('btn-play-again');
const fwConfetti       = document.getElementById('fw-confetti');

// ── Tabs ────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ── Lobby logic ──────────────────────────────────────────────────────────────
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
inpUsername.addEventListener('keydown', e => { if (e.key === 'Enter') btnContinue.click(); });

btnCreate.addEventListener('click', () => {
  socket.emit('fw:create', { username: myUsername, timePerRound: parseInt(inpTime.value) });
});

btnJoin.addEventListener('click', () => {
  const code = inpRoomCode.value.toUpperCase().trim();
  if (!code) { showLobbyError('Enter a room code'); return; }
  socket.emit('fw:join', { username: myUsername, roomId: code });
});
inpRoomCode.addEventListener('keydown', e => { if (e.key === 'Enter') btnJoin.click(); });

// ── Waiting room ──────────────────────────────────────────────────────────────
function renderWaiting(room) {
  waitingCode.textContent  = room.id;
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
  const link = `${window.location.origin}/wordle/join/${waitingCode.textContent}`;
  navigator.clipboard.writeText(link).then(() => {
    linkCopiedMsg.classList.remove('hidden');
    setTimeout(() => linkCopiedMsg.classList.add('hidden'), 2000);
  });
});
btnStart.addEventListener('click', () => { socket.emit('fw:start', myRoomId); });

document.getElementById('btn-leave-waiting').addEventListener('click', e => {
  e.preventDefault();
  socket.emit('fw:leave');
  showScreen('lobby');
  resetLobby();
});

// ── Grid rendering ────────────────────────────────────────────────────────────
function buildGrid(maxGuesses) {
  fwGrid.innerHTML = '';
  revealedRows = 0;
  for (let r = 0; r < maxGuesses; r++) {
    const row = document.createElement('div');
    row.className = 'fw-row';
    row.id = `fw-row-${r}`;
    for (let c = 0; c < 6; c++) {
      const tile = document.createElement('div');
      tile.className = 'fw-tile';
      tile.id = `fw-tile-${r}-${c}`;
      row.appendChild(tile);
    }
    fwGrid.appendChild(row);
  }
}

function renderGuessHistory(guessHistory) {
  for (let r = 0; r < guessHistory.length; r++) {
    const g = guessHistory[r];
    const row = document.getElementById(`fw-row-${r}`);
    if (!row) continue;
    if (!g.word) {
      // Skipped round
      for (let c = 0; c < 6; c++) {
        const tile = document.getElementById(`fw-tile-${r}-${c}`);
        if (tile) { tile.textContent = '?'; tile.className = 'fw-tile skipped'; }
      }
    } else {
      for (let c = 0; c < 6; c++) {
        const tile = document.getElementById(`fw-tile-${r}-${c}`);
        if (tile) {
          tile.textContent = g.word[c].toUpperCase();
          tile.className   = `fw-tile ${g.tiles[c]}`;
          updateKeyState(g.word[c], g.tiles[c]);
        }
      }
    }
  }
  revealedRows = guessHistory.length;
  renderKeyboard();
}

// Animate a row reveal tile-by-tile
function animateRowReveal(rowIndex, word, tiles, onDone) {
  const row = document.getElementById(`fw-row-${rowIndex}`);
  if (!row) { if (onDone) onDone(); return; }

  const delay = 120; // ms per tile
  for (let c = 0; c < 6; c++) {
    const tile = document.getElementById(`fw-tile-${rowIndex}-${c}`);
    if (!tile) continue;
    const tileClass = tiles ? tiles[c] : 'skipped';
    const letter    = word ? word[c].toUpperCase() : '?';

    setTimeout(() => {
      tile.classList.add('flip-in');
      setTimeout(() => {
        tile.textContent = letter;
        tile.className   = `fw-tile ${tileClass} flip-out`;
        if (word && tiles) updateKeyState(word[c], tiles[c]);
        if (c === 5) {
          setTimeout(() => {
            tile.className = `fw-tile ${tileClass}`;
            renderKeyboard();
            if (onDone) onDone();
          }, 200);
        }
      }, 200);
    }, c * delay);
  }
}

// Update current-row tiles as user types
function renderCurrentRow(rowIndex) {
  for (let c = 0; c < 6; c++) {
    const tile   = document.getElementById(`fw-tile-${rowIndex}-${c}`);
    if (!tile) continue;
    const letter = currentInput[c] || '';
    const wasEmpty = tile.textContent === '' && tile.className === 'fw-tile';
    tile.textContent = letter.toUpperCase();
    tile.className   = letter ? 'fw-tile filled' : 'fw-tile';
    if (letter && wasEmpty !== (tile.textContent === '')) {
      tile.classList.add('pop');
      setTimeout(() => tile.classList.remove('pop'), 110);
    }
  }
}

function shakeRow(rowIndex) {
  const row = document.getElementById(`fw-row-${rowIndex}`);
  if (!row) return;
  row.classList.add('shake');
  setTimeout(() => row.classList.remove('shake'), 400);
}

// ── Keyboard rendering ────────────────────────────────────────────────────────
function updateKeyState(letter, state) {
  const l   = letter.toLowerCase();
  const cur = keyStates[l];
  // Priority: correct > present > absent
  if (!cur || state === 'correct' || (state === 'present' && cur === 'absent')) {
    keyStates[l] = state;
  }
}

function renderKeyboard() {
  document.querySelectorAll('.fw-kb-key[data-key]').forEach(btn => {
    const key = btn.dataset.key;
    if (key.length !== 1) return;
    const state = keyStates[key.toLowerCase()];
    btn.className = 'fw-kb-key' + (state ? ` ${state}` : '');
    btn.disabled  = !inputEnabled;
  });
  // Enter and backspace just follow enabled state
  document.querySelectorAll('.fw-kb-key[data-key="Enter"], .fw-kb-key[data-key="Backspace"]').forEach(btn => {
    btn.disabled = !inputEnabled;
  });
}

// ── Input handling ────────────────────────────────────────────────────────────
function setInputEnabled(enabled, rowIndex) {
  inputEnabled = enabled;
  if (enabled) {
    currentInput = '';
    renderCurrentRow(rowIndex);
    fwHiddenInput.disabled = false;
    fwHiddenInput.focus();
  } else {
    fwHiddenInput.disabled = true;
  }
  renderKeyboard();
}

function handleKey(key) {
  if (!inputEnabled || submitted) return;
  const rowIndex = revealedRows; // current active row

  if (key === 'Backspace') {
    if (currentInput.length > 0) {
      currentInput = currentInput.slice(0, -1);
      renderCurrentRow(rowIndex);
    }
    return;
  }

  if (key === 'Enter') {
    if (currentInput.length < 6) {
      showFeedback('Not enough letters');
      shakeRow(rowIndex);
      return;
    }
    submitGuess(currentInput);
    return;
  }

  if (/^[a-zA-Z]$/.test(key)) {
    if (currentInput.length < 6) {
      currentInput += key.toLowerCase();
      renderCurrentRow(rowIndex);
    }
  }
}

// Physical keyboard
document.addEventListener('keydown', e => {
  if (!inputEnabled) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  handleKey(e.key);
});

// Hidden input (mobile fallback)
fwHiddenInput.addEventListener('input', e => {
  if (!inputEnabled) return;
  const val = (e.target.value || '').replace(/[^a-zA-Z]/g, '').slice(0, 6).toLowerCase();
  currentInput = val;
  renderCurrentRow(revealedRows);
  e.target.value = val; // keep in sync
});

// On-screen keyboard
document.getElementById('fw-keyboard').addEventListener('click', e => {
  const btn = e.target.closest('.fw-kb-key');
  if (!btn || btn.disabled) return;
  handleKey(btn.dataset.key);
  fwHiddenInput.focus();
});

function submitGuess(word) {
  if (submitted) return;
  // Don't lock submitted yet — wait for server confirmation.
  // If the word is rejected the error handler will re-enable input.
  setInputEnabled(false, revealedRows);
  socket.emit('fw:submitGuess', { roomId: myRoomId, word });
}

// ── Sidebar: players ──────────────────────────────────────────────────────────
function renderPlayers(scores, submittedIds = new Set()) {
  fwPlayersList.innerHTML = '';
  fwPlayerStrip.innerHTML = '';
  for (const p of scores) {
    const submitted = submittedIds.has(p.id);
    const isMe = p.id === myId;

    // Sidebar row
    const div = document.createElement('div');
    div.className = 'fw-player-row' + (isMe ? ' is-me' : '');
    div.id = `fw-player-${p.id}`;
    div.innerHTML = `
      <span class="fw-player-name">${escHtml(p.name)}</span>
      <span class="fw-submitted-badge" style="opacity:${submitted ? 1 : 0}">✓</span>
      <span class="fw-player-score">${p.score}</span>
    `;
    fwPlayersList.appendChild(div);

    // Mobile strip chip
    const chip = document.createElement('div');
    chip.className = 'fw-strip-chip' + (isMe ? ' is-me' : '') + (submitted ? ' submitted' : '');
    chip.dataset.playerId = p.id;
    chip.innerHTML = `
      <span class="fw-strip-avatar">${escHtml(p.name[0].toUpperCase())}</span>
      <span class="fw-strip-name">${escHtml(p.name)}${isMe ? ' (you)' : ''}</span>
      <span class="fw-strip-score">${p.score}</span>
      <span class="fw-strip-check">✓</span>
    `;
    fwPlayerStrip.appendChild(chip);
  }
}

// ── Sidebar: recap ────────────────────────────────────────────────────────────
function renderRecap(bestWord, tiles, playerName, pointsAwarded, allSubmissions) {
  fwRecap.innerHTML = '<div class="fw-sidebar-title">Round recap</div>';

  if (!bestWord) {
    fwRecap.innerHTML += '<div class="fw-recap-empty">No submissions this round.</div>';
    return;
  }

  // Best word summary
  const tileHtml = tiles
    ? tiles.map((t, i) => `<div class="fw-mini-tile ${t}">${bestWord[i].toUpperCase()}</div>`).join('')
    : Array(6).fill('<div class="fw-mini-tile skipped">?</div>').join('');

  fwRecap.innerHTML += `
    <div class="fw-recap-row">
      <div class="fw-recap-label">Best guess — <span class="fw-recap-word">${escHtml(bestWord)}</span> by <strong>${escHtml(playerName)}</strong></div>
      <div class="fw-recap-tiles">${tileHtml}</div>
      <div class="fw-recap-pts">+${pointsAwarded} pts</div>
    </div>
  `;

  if (allSubmissions && allSubmissions.length > 1) {
    fwRecap.innerHTML += '<div class="fw-recap-sub">';
    for (const sub of allSubmissions) {
      const miniTiles = sub.tiles
        ? sub.tiles.map((t, i) => `<div class="fw-mini-tile ${t}">${sub.word[i].toUpperCase()}</div>`).join('')
        : '';
      fwRecap.innerHTML += `
        <div class="fw-recap-sub-item">
          <span style="flex:1;font-weight:600">${escHtml(sub.playerName)}</span>
          <span style="font-family:monospace;font-size:0.9rem">${escHtml(sub.word)}</span>
          <div style="display:flex;gap:2px">${miniTiles}</div>
          <span style="color:var(--yellow);font-size:0.78rem">${sub.points > 0 ? '+' + sub.points : ''}</span>
        </div>
      `;
    }
    fwRecap.innerHTML += '</div>';
  }
}

// ── Timer display ─────────────────────────────────────────────────────────────
function updateTimer(timeLeft) {
  hudTimer.textContent = `⏱ ${timeLeft}`;
  if (timeLeft > timerMax * 0.5) {
    hudTimer.className = 'fw-timer';
  } else if (timeLeft > timerMax * 0.25) {
    hudTimer.className = 'fw-timer warn';
  } else {
    hudTimer.className = 'fw-timer danger';
  }
}

// ── Feedback ──────────────────────────────────────────────────────────────────
let feedbackTimer = null;
function showFeedback(msg, type) {
  fwFeedback.textContent  = msg;
  fwFeedback.style.color  = type === 'ok' ? 'var(--green)' : 'var(--accent)';
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => { fwFeedback.textContent = ''; }, 2500);
}

// ── Confetti ──────────────────────────────────────────────────────────────────
function launchConfetti() {
  fwConfetti.classList.remove('hidden');
  fwConfetti.innerHTML = '';
  const colors = ['#e94560','#a78bfa','#60a5fa','#34d399','#fbbf24'];
  for (let i = 0; i < 80; i++) {
    const dot = document.createElement('div');
    dot.className = 'fw-confetti-dot';
    dot.style.left     = `${Math.random() * 100}%`;
    dot.style.background = colors[Math.floor(Math.random() * colors.length)];
    dot.style.animationDuration = `${1.5 + Math.random() * 2}s`;
    dot.style.animationDelay   = `${Math.random() * 0.8}s`;
    dot.style.width  = dot.style.height = `${6 + Math.random() * 8}px`;
    fwConfetti.appendChild(dot);
  }
  setTimeout(() => { fwConfetti.classList.add('hidden'); fwConfetti.innerHTML = ''; }, 4000);
}

// ── Game over overlay ─────────────────────────────────────────────────────────
function renderGameOver(won, secretWord, scores, winner) {
  if (won) {
    gameOverEmoji.textContent = '🎉';
    const isMe = winner && winner.id === myId;
    gameOverTitle.textContent = isMe ? 'You nailed it!' : (winner ? `${winner.name} leads!` : 'You got it!');
  } else {
    gameOverEmoji.textContent = '😔';
    gameOverTitle.textContent = 'Game Over!';
  }
  gameOverWord.textContent = `The word was: ${secretWord.toUpperCase()}`;

  gameOverScores.innerHTML = '';
  scores.forEach((p, i) => {
    const medals = ['🥇', '🥈', '🥉'];
    const div = document.createElement('div');
    div.className = 'overlay-score-row';
    div.innerHTML = `
      <span class="overlay-rank">${medals[i] || (i+1)+'.'}</span>
      <span class="overlay-name">${escHtml(p.name)}${p.id === myId ? ' (you)' : ''}</span>
      <span class="overlay-pts">${p.score} pts</span>
    `;
    gameOverScores.appendChild(div);
  });

  overlayGameOver.classList.remove('hidden');

  const amOwner = myId === roomOwnerId;
  btnPlayAgain.style.display    = amOwner ? '' : 'none';
  gameOverCountdown.textContent = amOwner ? '' : 'Waiting for host to start a new game…';
}

btnPlayAgain.addEventListener('click', () => {
  socket.emit('fw:reset', myRoomId);
  // fw:reset from server moves everyone back to the waiting screen
});

// ── Utilities ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function resetLobby() {
  myRoomId = null; submitted = false; inputEnabled = false; currentInput = '';
  Object.keys(keyStates).forEach(k => delete keyStates[k]);
  lobbyUser.classList.remove('hidden');
  lobbyChoice.classList.add('hidden');
  lobbyError.classList.add('hidden');
  inpUsername.value = myUsername;
}

// ── Socket handlers ───────────────────────────────────────────────────────────
socket.on('connect', () => { myId = socket.id; });

socket.on('fw:joined', ({ roomId, playerId, room }) => {
  myId        = playerId;
  myRoomId    = roomId;
  roomOwnerId = room.owner;
  timerMax    = room.timePerRound;
  renderWaiting(room);
  showScreen('waiting');
});

socket.on('fw:playerJoined', ({ room }) => { renderWaiting(room); SFX.join(); });
socket.on('fw:playerLeft',   ({ room }) => { roomOwnerId = room.owner; renderWaiting(room); SFX.leave(); });

socket.on('fw:started', ({ room }) => {
  SFX.gameStart();
  timerMax = room.timePerRound;
  hudMaxGuesses.textContent = room.maxGuesses;
  overlayGameOver.classList.add('hidden');
  Object.keys(keyStates).forEach(k => delete keyStates[k]);
  buildGrid(room.maxGuesses);
  showScreen('game');
});

socket.on('fw:roundStart', ({ guessNumber, maxGuesses, timeLeft, guessHistory, scores }) => {
  submitted = false;
  SFX.turnStart();
  hudGuessNum.textContent  = guessNumber;
  hudMaxGuesses.textContent = maxGuesses;
  updateTimer(timeLeft);

  // Re-render any historical rows (in case of reconnect)
  renderGuessHistory(guessHistory);

  renderPlayers(scores, new Set());
  setInputEnabled(true, revealedRows);
  showFeedback('');
});

socket.on('fw:tick', ({ timeLeft }) => {
  updateTimer(timeLeft);
  if (timeLeft <= 10 && timeLeft > 0) SFX.tick();
});

socket.on('fw:playerSubmitted', ({ playerId }) => {
  // Server confirmed our word — now lock input
  if (playerId === myId) {
    submitted = true;
    showFeedback('Submitted! Waiting for others…', 'ok');
    SFX.submit();
  }
  // Add ✓ badge to sidebar row
  const row = document.getElementById(`fw-player-${playerId}`);
  if (row) {
    const badge = row.querySelector('.fw-submitted-badge');
    if (badge) badge.style.opacity = '1';
  }
  // Add ✓ to mobile strip chip
  const chip = fwPlayerStrip.querySelector(`[data-player-id="${playerId}"]`);
  if (chip) chip.classList.add('submitted');
});

socket.on('fw:roundEnd', ({ guessNumber, bestWord, tiles, playerId, playerName, allSubmissions, pointsAwarded, scores, won }) => {
  setInputEnabled(false, revealedRows);
  SFX.reveal();

  const rowIndex = guessNumber - 1;
  animateRowReveal(rowIndex, bestWord, tiles, () => {
    revealedRows = guessNumber;
    renderPlayers(scores, new Set());
    renderRecap(bestWord, tiles, playerName, pointsAwarded, allSubmissions);
    if (won) { SFX.correct(); launchConfetti(); }
    else SFX.roundEnd();
  });

  hudGuessNum.textContent = guessNumber;
});

socket.on('fw:gameOver', ({ won, secretWord, scores, winner }) => {
  if (won) SFX.win(); else SFX.lose();
  setTimeout(() => {
    renderGameOver(won, secretWord, scores, winner);
  }, won ? 1500 : 500);
});

socket.on('fw:reset', ({ room }) => {
  overlayGameOver.classList.add('hidden');
  myRoomId    = room.id;
  roomOwnerId = room.owner;
  timerMax    = room.timePerRound;
  renderWaiting(room);
  showScreen('waiting');
});

socket.on('fw:error', ({ message }) => {
  // If on game screen, show feedback; otherwise show lobby error
  const gameVisible = !screens.game.classList.contains('hidden');
  if (gameVisible) {
    showFeedback(message);
    shakeRow(revealedRows);
    // Re-enable input on validation errors so user can retype
    if (!submitted) setInputEnabled(true, revealedRows);
  } else {
    showLobbyError(message);
  }
});

// ── Invite link / direct join ─────────────────────────────────────────────────
const lobbyDirectJoin   = document.getElementById('lobby-direct-join');
const inpUsernameDirect = document.getElementById('inp-username-direct');
const btnDirectJoin     = document.getElementById('btn-direct-join');
const btnBackToLobby    = document.getElementById('btn-back-to-lobby');
let _inviteCode = null;

function checkInviteUrl() {
  const match = window.location.pathname.match(/^\/wordle\/join\/([A-Z0-9]{6})$/i);
  if (!match) return;
  _inviteCode = match[1].toUpperCase();
  lobbyUser.classList.add('hidden');
  lobbyChoice.classList.add('hidden');
  lobbyDirectJoin.classList.remove('hidden');
  inpUsernameDirect.focus();
  history.replaceState(null, '', '/wordle');
}

btnDirectJoin.addEventListener('click', () => {
  const name = inpUsernameDirect.value.trim();
  if (!name) { showLobbyError('Enter your name first'); return; }
  myUsername = name;
  socket.emit('fw:join', { username: myUsername, roomId: _inviteCode });
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

// ── Init ──────────────────────────────────────────────────────────────────────
showScreen('lobby');
checkInviteUrl();
if (!_inviteCode) inpUsername.focus();
