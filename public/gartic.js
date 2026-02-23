/* ── Gartic Phone Client ───────────────────────────────────────────────── */

const socket = io({ transports: ['websocket'] });

// ── State ──────────────────────────────────────────────────────────────────
let myId         = null;
let myRoomId     = null;
let myUsername    = '';
let roomOwnerId  = null;
let timerMax      = 30;
let currentPhase  = 'lobby';
let hasSubmitted  = false;
let players       = [];

// Canvas state
let canvas = null;
let ctx    = null;
const drawing = {
  active: false,
  tool: 'pencil',  // pencil | eraser | fill
  color: '#000000',
  size: 4,
  lastX: 0,
  lastY: 0,
};
let undoStack = [];
const MAX_UNDO = 30;

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

const waitingCode    = document.getElementById('waiting-room-code');
const waitingCount   = document.getElementById('waiting-player-count');
const waitingPlayers = document.getElementById('waiting-players');
const btnStart       = document.getElementById('btn-start');
const waitingNotOwner = document.getElementById('waiting-not-owner');
const btnCopyCode    = document.getElementById('btn-copy-code');
const btnCopyLink    = document.getElementById('btn-copy-link');
const linkCopiedMsg  = document.getElementById('link-copied-msg');

const hudPhase       = document.getElementById('hud-phase');
const hudTimer       = document.getElementById('hud-timer');
const hudProgress    = document.getElementById('hud-progress');
const timerArc       = document.getElementById('timer-arc');
const gpCenter       = document.getElementById('gp-center');
const sidebarPlayers = document.getElementById('sidebar-players');

const overlayGame    = document.getElementById('overlay-game-end');
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
  socket.emit('gp:create', { username: myUsername });
});

btnJoin.addEventListener('click', () => {
  const code = inpRoomCode.value.toUpperCase().trim();
  if (!code) { showLobbyError('Enter a room code'); return; }
  socket.emit('gp:join', { username: myUsername, roomId: code });
});

inpRoomCode.addEventListener('keydown', e => {
  if (e.key === 'Enter') btnJoin.click();
});

// ── Waiting Room ───────────────────────────────────────────────────────────
function renderWaiting(room) {
  waitingCode.textContent = room.id;
  waitingCount.textContent = room.players.length;
  players = room.players;

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
  const link = `${window.location.origin}/gartic/join/${waitingCode.textContent}`;
  navigator.clipboard.writeText(link).then(() => {
    linkCopiedMsg.classList.remove('hidden');
    setTimeout(() => linkCopiedMsg.classList.add('hidden'), 2000);
  });
});

btnStart.addEventListener('click', () => {
  socket.emit('gp:start', myRoomId);
});

document.getElementById('waiting-back-link').addEventListener('click', e => {
  e.preventDefault();
  socket.emit('gp:leave');
  showScreen('lobby');
  resetLobby();
});

// ── Timer Arc ──────────────────────────────────────────────────────────────
const CIRC = 2 * Math.PI * 22;

function updateTimerArc(timeLeft, max) {
  const frac = Math.max(0, timeLeft / max);
  const offset = CIRC * (1 - frac);
  timerArc.style.strokeDashoffset = offset;

  if (frac > 0.5)       timerArc.style.stroke = '#0891b2';
  else if (frac > 0.25) timerArc.style.stroke = 'var(--yellow)';
  else                   timerArc.style.stroke = 'var(--accent)';

  hudTimer.textContent = timeLeft;
}

// ── Sidebar Players ────────────────────────────────────────────────────────
function renderSidebarPlayers() {
  sidebarPlayers.innerHTML = '';
  for (const p of players) {
    const div = document.createElement('div');
    div.className = 'gp-player-item' + (p.id === myId ? ' is-me' : '');
    div.innerHTML = `
      <span class="gp-player-dot"></span>
      <span class="gp-player-name">${escHtml(p.name)}</span>
    `;
    sidebarPlayers.appendChild(div);
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  PHASE RENDERING
// ══════════════════════════════════════════════════════════════════════════

// ── Write Phase ────────────────────────────────────────────────────────────
function showWritePhase(data) {
  currentPhase = 'writing';
  hasSubmitted = false;
  hudPhase.textContent = 'Write a prompt';
  timerMax = data.timeLeft;
  updateTimerArc(data.timeLeft, timerMax);
  hudProgress.textContent = '';

  gpCenter.innerHTML = `
    <div style="font-size:1.5rem;font-weight:900">✏️ Write a prompt!</div>
    <p style="color:var(--text-dim);font-size:0.9rem">Write something funny for someone to draw</p>
    <div class="gp-write-area">
      <textarea id="write-input" placeholder="e.g. A cat riding a unicorn through a rainbow..." maxlength="200" rows="3"></textarea>
      <button id="btn-submit-write" class="btn btn-primary btn-full" style="margin-top:0.75rem">Submit</button>
    </div>
  `;

  const inp = document.getElementById('write-input');
  const btn = document.getElementById('btn-submit-write');

  btn.addEventListener('click', () => {
    if (hasSubmitted) return;
    const text = inp.value.trim();
    if (!text) return;
    hasSubmitted = true;
    socket.emit('gp:submitText', { text });
    btn.disabled = true;
    btn.textContent = 'Submitted!';
    inp.disabled = true;
  });

  inp.focus();
}

// ── Draw Phase ─────────────────────────────────────────────────────────────
function showDrawPhase(data) {
  currentPhase = 'drawing';
  hasSubmitted = false;
  hudPhase.textContent = 'Draw it!';
  timerMax = data.timeLeft;
  updateTimerArc(data.timeLeft, timerMax);
  hudProgress.textContent = '';

  gpCenter.innerHTML = `
    <div class="gp-prompt-display" id="draw-prompt">${escHtml(data.prompt)}</div>
    <div class="gp-canvas-wrap">
      <canvas id="gp-canvas" class="gp-canvas" width="800" height="500"></canvas>
    </div>
    <div class="gp-toolbar" id="gp-toolbar"></div>
    <button id="btn-submit-draw" class="btn btn-primary" style="margin-top:0.5rem">Done</button>
  `;

  initCanvas();
  buildToolbar();

  document.getElementById('btn-submit-draw').addEventListener('click', () => {
    if (hasSubmitted) return;
    submitDrawing();
  });
}

function submitDrawing() {
  hasSubmitted = true;
  const dataUrl = canvas.toDataURL('image/png');
  socket.emit('gp:submitDrawing', { drawing: dataUrl });
  const btn = document.getElementById('btn-submit-draw');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitted!'; }
}

// ── Guess Phase ────────────────────────────────────────────────────────────
function showGuessPhase(data) {
  currentPhase = 'guessing';
  hasSubmitted = false;
  hudPhase.textContent = 'Guess the drawing!';
  timerMax = data.timeLeft;
  updateTimerArc(data.timeLeft, timerMax);
  hudProgress.textContent = '';

  gpCenter.innerHTML = `
    <div style="font-size:1.3rem;font-weight:900">🤔 What is this?</div>
    <div class="gp-guess-area">
      <img class="gp-guess-drawing" id="guess-image" src="${data.drawing}" alt="Drawing to guess" />
      <input class="gp-guess-input" id="guess-input" type="text" placeholder="Type your guess..." maxlength="200" autocomplete="off" />
      <button id="btn-submit-guess" class="btn btn-primary btn-full" style="margin-top:0.75rem">Submit Guess</button>
    </div>
  `;

  const inp = document.getElementById('guess-input');
  const btn = document.getElementById('btn-submit-guess');

  btn.addEventListener('click', () => {
    if (hasSubmitted) return;
    const text = inp.value.trim();
    if (!text) return;
    hasSubmitted = true;
    socket.emit('gp:submitText', { text });
    btn.disabled = true;
    btn.textContent = 'Submitted!';
    inp.disabled = true;
  });

  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') btn.click();
  });

  inp.focus();
}

// ── Waiting ────────────────────────────────────────────────────────────────
function showWaiting() {
  gpCenter.innerHTML = `
    <div style="font-size:2rem">⏳</div>
    <div class="gp-waiting-msg">Waiting for others...</div>
    <div class="gp-progress" id="waiting-progress"></div>
  `;
}

// ── Reveal Phase ───────────────────────────────────────────────────────────
let revealChainData = null;

function showReveal(data) {
  currentPhase = 'reveal';
  hudPhase.textContent = 'Reveal';
  hudTimer.textContent = '';
  timerArc.style.strokeDashoffset = 0;
  hudProgress.textContent = `Chain ${data.chainIndex + 1} / ${data.totalChains}`;

  revealChainData = data;

  gpCenter.innerHTML = `
    <div class="gp-reveal-wrap">
      <div class="gp-reveal-header">
        <div class="gp-reveal-chain-label">Chain ${data.chainIndex + 1} of ${data.totalChains}</div>
        <div class="gp-reveal-origin">Started by <span class="gp-accent">${escHtml(data.originName)}</span></div>
      </div>
      <div class="gp-reveal-timeline" id="reveal-timeline"></div>
      <div class="gp-reveal-nav" id="reveal-nav"></div>
    </div>
  `;

  const timeline = document.getElementById('reveal-timeline');

  // Render all steps
  data.steps.forEach((step, i) => {
    const div = document.createElement('div');
    div.className = 'gp-reveal-step';

    const typeLabel = step.type === 'drawing' ? '🎨 Drew' : (i === 0 ? '✏️ Wrote' : '🤔 Guessed');

    let contentHtml = '';
    if (step.type === 'drawing' && step.content) {
      contentHtml = `<img class="gp-reveal-drawing" src="${step.content}" alt="Drawing" />`;
    } else {
      contentHtml = `<div class="gp-reveal-text">"${escHtml(step.content)}"</div>`;
    }

    div.innerHTML = `
      <div class="gp-reveal-step-header">
        <div class="gp-reveal-step-icon">${i + 1}</div>
        <span>${typeLabel} &mdash; <strong>${escHtml(step.playerName)}</strong></span>
      </div>
      ${contentHtml}
    `;
    timeline.appendChild(div);
  });

  // Nav buttons (host only)
  const nav = document.getElementById('reveal-nav');
  if (myId === roomOwnerId) {
    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-primary';
    const isLast = data.chainIndex + 1 >= data.totalChains;
    nextBtn.textContent = isLast ? 'Finish' : 'Next Chain →';
    nextBtn.addEventListener('click', () => {
      socket.emit('gp:revealNext', myRoomId);
    });
    nav.appendChild(nextBtn);
  } else {
    nav.innerHTML = '<p style="color:var(--text-dim);font-size:0.85rem">Host will advance to next chain...</p>';
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  DRAWING CANVAS
// ══════════════════════════════════════════════════════════════════════════

function initCanvas() {
  canvas = document.getElementById('gp-canvas');
  ctx = canvas.getContext('2d');
  undoStack = [];

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Save initial state
  saveUndo();

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerout', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
}

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function onPointerDown(e) {
  if (hasSubmitted) return;
  if (e.button !== undefined && e.button !== 0) return;

  canvas.setPointerCapture(e.pointerId);
  const { x, y } = getPos(e);

  if (drawing.tool === 'fill') {
    floodFill(ctx, x, y, drawing.color);
    saveUndo();
    return;
  }

  drawing.active = true;
  drawing.lastX = x;
  drawing.lastY = y;

  applyStroke();
  ctx.beginPath();
  ctx.moveTo(x, y);
}

function onPointerMove(e) {
  if (!drawing.active || hasSubmitted) return;
  if (drawing.tool === 'fill') return;

  const { x, y } = getPos(e);

  applyStroke();
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y);

  drawing.lastX = x;
  drawing.lastY = y;
}

function onPointerUp(e) {
  if (!drawing.active) return;
  drawing.active = false;
  ctx.beginPath();
  saveUndo();
}

function applyStroke() {
  ctx.strokeStyle = drawing.tool === 'eraser' ? '#ffffff' : drawing.color;
  ctx.lineWidth = drawing.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

function saveUndo() {
  if (!canvas || !ctx) return;
  undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function doUndo() {
  if (undoStack.length <= 1) return; // Keep at least the blank canvas
  undoStack.pop(); // Remove current state
  const prev = undoStack[undoStack.length - 1];
  ctx.putImageData(prev, 0, 0);
}

function doClear() {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  saveUndo();
}

// ── Flood Fill ─────────────────────────────────────────────────────────────
function floodFill(ctx, startX, startY, fillColorHex) {
  const { width, height } = ctx.canvas;
  const x0 = Math.floor(startX);
  const y0 = Math.floor(startY);

  if (x0 < 0 || x0 >= width || y0 < 0 || y0 >= height) return;

  const fillR = parseInt(fillColorHex.slice(1, 3), 16);
  const fillG = parseInt(fillColorHex.slice(3, 5), 16);
  const fillB = parseInt(fillColorHex.slice(5, 7), 16);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const startIdx = (y0 * width + x0) * 4;
  const tR = data[startIdx],     tG = data[startIdx + 1];
  const tB = data[startIdx + 2], tA = data[startIdx + 3];

  if (tR === fillR && tG === fillG && tB === fillB) return;

  const match = (i) =>
    data[i]     === tR &&
    data[i + 1] === tG &&
    data[i + 2] === tB &&
    data[i + 3] === tA;

  const paint = (i) => {
    data[i]     = fillR;
    data[i + 1] = fillG;
    data[i + 2] = fillB;
    data[i + 3] = 255;
  };

  const visited = new Uint8Array(width * height);
  const stack = [x0 + y0 * width];

  while (stack.length) {
    const idx = stack.pop();
    if (visited[idx]) continue;
    const pixelIdx = idx * 4;
    if (!match(pixelIdx)) continue;

    visited[idx] = 1;
    paint(pixelIdx);

    const x = idx % width;
    const y = Math.floor(idx / width);
    if (x > 0)          stack.push(idx - 1);
    if (x < width - 1)  stack.push(idx + 1);
    if (y > 0)          stack.push(idx - width);
    if (y < height - 1) stack.push(idx + width);
  }

  ctx.putImageData(imageData, 0, 0);
}

// ── Toolbar ────────────────────────────────────────────────────────────────
const COLORS = [
  '#000000', '#ffffff', '#808080', '#c0c0c0',
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
  '#92400e', '#be185d', '#1e3a5f', '#166534',
];

const SIZES = [4, 8, 16, 28];

function buildToolbar() {
  const toolbar = document.getElementById('gp-toolbar');
  toolbar.innerHTML = '';

  // Tool buttons
  const tools = [
    { id: 'pencil', icon: '✏️', label: 'Pencil' },
    { id: 'eraser', icon: '🧹', label: 'Eraser' },
    { id: 'fill',   icon: '🪣', label: 'Fill' },
  ];

  for (const t of tools) {
    const btn = document.createElement('button');
    btn.className = 'gp-tool-btn' + (drawing.tool === t.id ? ' active' : '');
    btn.title = t.label;
    btn.textContent = t.icon;
    btn.dataset.tool = t.id;
    btn.addEventListener('click', () => selectTool(t.id));
    toolbar.appendChild(btn);
  }

  // Separator
  toolbar.appendChild(createSeparator());

  // Undo + Clear
  const undoBtn = document.createElement('button');
  undoBtn.className = 'gp-tool-btn';
  undoBtn.title = 'Undo';
  undoBtn.textContent = '↩';
  undoBtn.addEventListener('click', doUndo);
  toolbar.appendChild(undoBtn);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'gp-tool-btn';
  clearBtn.title = 'Clear';
  clearBtn.textContent = '🗑';
  clearBtn.addEventListener('click', doClear);
  toolbar.appendChild(clearBtn);

  // Separator
  toolbar.appendChild(createSeparator());

  // Size buttons
  for (const s of SIZES) {
    const btn = document.createElement('button');
    btn.className = 'gp-size-btn' + (drawing.size === s ? ' active' : '');
    btn.title = `Size ${s}`;
    btn.dataset.size = s;

    // Dot inside
    const dot = document.createElement('span');
    dot.style.cssText = `width:${Math.min(s, 20)}px;height:${Math.min(s, 20)}px;border-radius:50%;background:var(--text);display:block`;
    btn.appendChild(dot);

    btn.addEventListener('click', () => selectSize(s));
    toolbar.appendChild(btn);
  }

  // Separator
  toolbar.appendChild(createSeparator());

  // Color palette
  for (const c of COLORS) {
    const btn = document.createElement('button');
    btn.className = 'gp-color-btn' + (drawing.color === c ? ' active' : '');
    btn.style.background = c;
    if (c === '#ffffff') btn.style.border = '2px solid var(--border)';
    btn.dataset.color = c;
    btn.addEventListener('click', () => selectColor(c));
    toolbar.appendChild(btn);
  }

  // Custom color picker
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = drawing.color;
  picker.style.cssText = 'width:28px;height:28px;border:none;padding:0;cursor:pointer;border-radius:50%;background:none';
  picker.addEventListener('input', e => selectColor(e.target.value));
  toolbar.appendChild(picker);
}

function createSeparator() {
  const sep = document.createElement('div');
  sep.className = 'gp-separator';
  return sep;
}

function selectTool(tool) {
  drawing.tool = tool;
  document.querySelectorAll('.gp-tool-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });
}

function selectColor(color) {
  drawing.color = color;
  drawing.tool = 'pencil'; // Switch to pencil when picking a color
  document.querySelectorAll('.gp-color-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.color === color);
  });
  document.querySelectorAll('.gp-tool-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === 'pencil');
  });
}

function selectSize(size) {
  drawing.size = size;
  document.querySelectorAll('.gp-size-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.size) === size);
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  PLAY AGAIN
// ══════════════════════════════════════════════════════════════════════════
btnPlayAgain.addEventListener('click', () => {
  socket.emit('gp:reset', myRoomId);
});

// ══════════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════════════════════
//  SOCKET HANDLERS
// ══════════════════════════════════════════════════════════════════════════

socket.on('connect', () => {
  myId = socket.id;
});

socket.on('gp:joined', ({ roomId, playerId, room }) => {
  myId        = playerId;
  myRoomId    = roomId;
  roomOwnerId = room.owner;
  players     = room.players;
  renderWaiting(room);
  showScreen('waiting');
});

socket.on('gp:playerJoined', ({ room }) => {
  players = room.players;
  renderWaiting(room);
  if (typeof SFX !== 'undefined') SFX.join();
});

socket.on('gp:playerLeft', ({ room }) => {
  roomOwnerId = room.owner;
  players = room.players;
  renderWaiting(room);
  if (typeof SFX !== 'undefined') SFX.leave();
});

socket.on('gp:started', ({ room }) => {
  if (typeof SFX !== 'undefined') SFX.gameStart();
  players = room.players;
  showScreen('game');
  renderSidebarPlayers();
  overlayGame.classList.add('hidden');
});

socket.on('gp:tick', ({ timeLeft }) => {
  updateTimerArc(timeLeft, timerMax);
  if (timeLeft <= 5 && timeLeft > 0 && typeof SFX !== 'undefined') SFX.tick();
});

socket.on('gp:progress', ({ submitted, total }) => {
  hudProgress.textContent = `${submitted}/${total}`;
  const wp = document.getElementById('waiting-progress');
  if (wp) wp.textContent = `${submitted} / ${total} submitted`;
});

socket.on('gp:writePhase', (data) => {
  if (typeof SFX !== 'undefined') SFX.turnStart();
  showWritePhase(data);
});

socket.on('gp:drawPhase', (data) => {
  if (typeof SFX !== 'undefined') SFX.turnStart();
  showDrawPhase(data);
});

socket.on('gp:guessPhase', (data) => {
  if (typeof SFX !== 'undefined') SFX.turnStart();
  showGuessPhase(data);
});

socket.on('gp:revealChain', (data) => {
  showReveal(data);
});

socket.on('gp:gameOver', (data) => {
  currentPhase = 'game_end';
  overlayGame.classList.remove('hidden');

  const amOwner = myId === roomOwnerId;
  btnPlayAgain.style.display = amOwner ? '' : 'none';
});

socket.on('gp:reset', ({ room }) => {
  overlayGame.classList.add('hidden');
  myRoomId    = room.id;
  roomOwnerId = room.owner;
  players     = room.players;
  renderWaiting(room);
  showScreen('waiting');
});

socket.on('gp:error', ({ message }) => {
  showLobbyError(message);
});

// ── Invite Link / Direct Join ─────────────────────────────────────────────
const lobbyDirectJoin    = document.getElementById('lobby-direct-join');
const inpUsernameDirect  = document.getElementById('inp-username-direct');
const btnDirectJoin      = document.getElementById('btn-direct-join');
const btnBackToLobby     = document.getElementById('btn-back-to-lobby');
let _inviteCode = null;

function checkInviteUrl() {
  const match = window.location.pathname.match(/^\/gartic\/join\/([A-Z0-9]{6})$/i);
  if (!match) return;
  _inviteCode = match[1].toUpperCase();

  lobbyUser.classList.add('hidden');
  lobbyChoice.classList.add('hidden');
  lobbyDirectJoin.classList.remove('hidden');
  inpUsernameDirect.focus();

  history.replaceState(null, '', '/gartic');
}

btnDirectJoin.addEventListener('click', () => {
  const name = inpUsernameDirect.value.trim();
  if (!name) { showLobbyError('Enter your name first'); return; }
  myUsername = name;
  socket.emit('gp:join', { username: myUsername, roomId: _inviteCode });
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

// ── Init ─────────────────────────────────────────────────────────────────
showScreen('lobby');
checkInviteUrl();
if (!_inviteCode) inpUsername.focus();
