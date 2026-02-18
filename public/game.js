/* ══════════════════════════════════════════════════════════
   SCRIBBLE-O — Client
══════════════════════════════════════════════════════════ */

// ─── Category names (mirrors server CATEGORIES keys) ───────
const CATEGORY_NAMES = [
  'Mixed', 'Animals', 'Food & Drinks', 'Objects & Tools', 'Nature & Weather',
  'Activities & Sports', 'Places & Buildings', 'People & Jobs', 'Vehicles & Transport',
  'Fantasy & Myths', 'Ocean & Sea Life', 'Space & Science', 'Halloween',
];

// Category emojis for the picker grid
const CATEGORY_EMOJI = {
  'Mixed': '🎲', 'Animals': '🦁', 'Food & Drinks': '🍕', 'Objects & Tools': '🔨',
  'Nature & Weather': '🌊', 'Activities & Sports': '⚽', 'Places & Buildings': '🏰',
  'People & Jobs': '👨‍🔬', 'Vehicles & Transport': '🚀', 'Fantasy & Myths': '🐉',
  'Ocean & Sea Life': '🐙', 'Space & Science': '🔭', 'Halloween': '🎃',
};

// ─── Preset color palette ──────────────────────────────────
const COLORS = [
  '#000000', '#ffffff', '#808080', '#c0c0c0',
  '#ff0000', '#ff8800', '#ffff00', '#00cc00',
  '#0000ff', '#8800ff', '#ff00ff', '#00ccff',
  '#8b4513', '#ff69b4', '#006400', '#1e90ff',
];

// ─── State ────────────────────────────────────────────────
const State = {
  socket: null,
  playerId: null,
  roomId: null,
  room: null,
  isOwner: false,
  isDrawer: false,
  hasGuessed: false,
  currentWord: null,
  wordDisplay: '',
  drawTime: 80,
  timeLeft: 80,

  drawing: {
    active: false,
    tool: 'pencil',
    color: '#000000',
    size: 4,
    lastX: 0,
    lastY: 0,
  },

  canvas: null,
  ctx: null,
  wordChoiceTimer: null,

  // Pre-game category voting
  categoryVotes: {},      // { categoryName: count }
  myVoteCategory: null,   // the category this player voted for
};

// ─── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  buildColorPalette();
  initCanvas();
  initSocket();

  // Enter key on username → focus create button
  document.getElementById('username-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-create').click();
  });
  document.getElementById('join-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onJoinRoom();
  });
});

// ══════════════════════════════════════════════════════════
//  SOCKET.IO
// ══════════════════════════════════════════════════════════
function initSocket() {
  State.socket = io();
  const s = State.socket;

  s.on('connect', () => {
    State.playerId = s.id;
    console.log('Connected:', s.id);
  });

  s.on('room:joined', ({ roomId, playerId, room, categoryVotes, myVoteCategory }) => {
    State.playerId = playerId;
    State.roomId = roomId;
    State.room = room;
    State.isOwner = room.owner === playerId;
    State.categoryVotes = categoryVotes || {};
    State.myVoteCategory = myVoteCategory || null;
    showScreen('waiting');
    renderWaitingRoom();
  });

  s.on('room:playerJoined', ({ player, room }) => {
    State.room = room;
    renderWaitingRoom();
    addChatMsg({ type: 'system', message: `${player.name} joined the room.` });
  });

  s.on('room:playerLeft', ({ playerId, playerName, newOwner, room }) => {
    State.room = room;
    if (newOwner) {
      State.isOwner = newOwner === State.playerId;
    }
    addChatMsg({ type: 'system', message: `${playerName || 'A player'} left the game.` });
    if (currentScreen() === 'waiting') {
      renderWaitingRoom();
    } else if (currentScreen() === 'game') {
      renderPlayerList();
    }
  });

  s.on('room:error', ({ message }) => {
    showError(message);
  });

  s.on('room:categoryVoteUpdate', ({ categoryVotes, playerVotes }) => {
    State.categoryVotes = categoryVotes || {};
    // Update my own vote in case server toggled it off
    State.myVoteCategory = playerVotes[State.playerId] || null;
    renderCategoryPicker();
  });

  // ── Game events ──
  s.on('game:started', ({ room, selectedCategory }) => {
    State.room = room;
    State.hasGuessed = false;
    State.currentWord = null;
    showScreen('game');
    clearCanvas();
    clearChat();
    hideAllOverlays();
    renderPlayerList();
    document.getElementById('top-round').textContent = room.currentRound || 1;
    document.getElementById('top-totalrounds').textContent = room.totalRounds;
    const catMsg = selectedCategory && selectedCategory !== 'Mixed'
      ? `Game started! Category: ${selectedCategory}`
      : 'Game started! Good luck!';
    addChatMsg({ type: 'system', message: catMsg });
  });

  s.on('game:turnStart', ({ drawer, drawerName, round, totalRounds, state }) => {
    State.isDrawer = drawer === State.playerId;
    State.hasGuessed = false;
    State.currentWord = null;
    State.wordDisplay = '';

    hideAllOverlays();
    document.getElementById('top-round').textContent = round;
    document.getElementById('top-totalrounds').textContent = totalRounds;

    if (State.isDrawer) {
      updateWordDisplay('Choose a word…');
      setCanvasOverlay('');
    } else {
      updateWordDisplay('Waiting for drawer…');
      setCanvasOverlay(`${drawerName} is choosing a word…`);
    }

    setDrawingEnabled(false);
    addChatMsg({ type: 'system', message: `${drawerName} is drawing!` });
    renderPlayerList();
  });

  s.on('game:wordChoices', ({ words, timeLimit }) => {
    showWordChoiceOverlay(words, timeLimit);
  });

  s.on('game:drawingStart', ({ drawer, drawerName, wordDisplay, wordLength, timeLeft }) => {
    State.isDrawer = drawer === State.playerId;
    State.wordDisplay = wordDisplay;
    State.timeLeft = timeLeft;

    hideAllOverlays();
    setCanvasOverlay('');
    clearCanvas();

    if (!State.isDrawer) {
      // Show blank display + letter count
      updateWordDisplay(wordDisplay + `  (${wordLength} letters)`);
      setDrawingEnabled(false);
      setChatEnabled(true);
    }

    updateTimer(State.timeLeft, State.drawTime);
  });

  s.on('game:yourWord', ({ word }) => {
    State.currentWord = word;
    updateWordDisplay(word);
    setDrawingEnabled(true);
    setToolbarVisible(true);
    setChatEnabled(false);
    setCanvasOverlay('');
  });

  s.on('game:hint', ({ wordDisplay, hintNumber }) => {
    State.wordDisplay = wordDisplay;
    if (!State.isDrawer && !State.hasGuessed) {
      updateWordDisplay(wordDisplay);
    }
    addChatMsg({ type: 'system', message: `Hint ${hintNumber}: ${wordDisplay}` });
  });

  s.on('game:timerTick', ({ timeLeft }) => {
    State.timeLeft = timeLeft;
    updateTimer(timeLeft, State.drawTime);
  });

  s.on('game:correctGuess', ({ playerId, playerName, points, totalScore, correctCount, totalGuessers }) => {
    addChatMsg({
      type: 'correct',
      message: `${playerName} guessed correctly! (+${points} pts)`,
    });
    // Update that player's hasGuessed in local room state
    if (State.room) {
      const p = State.room.players.find(p => p.id === playerId);
      if (p) {
        p.hasGuessed = true;
        p.score = totalScore;
      }
    }
    renderPlayerList();
  });

  s.on('game:youGuessed', ({ word }) => {
    State.hasGuessed = true;
    State.currentWord = word;
    updateWordDisplay(word);
    setChatEnabled(false);
    addChatMsg({ type: 'correct', message: `You got it! The word was "${word}".` });
  });

  s.on('game:turnEnd', ({ word, drawer, drawerName, drawerPoints, correctGuessers, scores }) => {
    setDrawingEnabled(false);
    setToolbarVisible(false);
    updateTimer(0, State.drawTime);
    showTurnEndOverlay(word, scores, drawer === State.playerId ? drawerPoints : null);
    // Update scores in room
    if (State.room) {
      scores.forEach(s => {
        const p = State.room.players.find(p => p.id === s.id);
        if (p) p.score = s.score;
      });
    }
    renderPlayerList();
  });

  s.on('game:roundEnd', ({ round, totalRounds, scores }) => {
    hideAllOverlays();
    const isLast = round >= totalRounds;
    showRoundEndOverlay(round, totalRounds, scores, isLast);
    if (State.room) {
      scores.forEach(s => {
        const p = State.room.players.find(p => p.id === s.id);
        if (p) p.score = s.score;
      });
    }
    renderPlayerList();
  });

  s.on('game:ended', ({ scores, winner }) => {
    hideAllOverlays();
    showGameEndOverlay(scores, winner);
  });

  s.on('game:reset', ({ room, categoryVotes }) => {
    State.room = room;
    State.isOwner = room.owner === State.playerId;
    State.hasGuessed = false;
    State.currentWord = null;
    State.isDrawer = false;
    State.categoryVotes = categoryVotes || {};
    State.myVoteCategory = null;
    hideAllOverlays();
    showScreen('waiting');
    renderWaitingRoom();
    clearChat();
  });

  // ── Draw events (received from other players) ──
  s.on('draw:stroke', (data) => {
    if (!State.ctx) return;
    replayStroke(data);
  });

  s.on('draw:fill', ({ nx, ny, color }) => {
    if (!State.ctx || !State.canvas) return;
    const x = nx * State.canvas.width;
    const y = ny * State.canvas.height;
    floodFill(State.ctx, x, y, color);
  });

  s.on('draw:cleared', () => {
    clearCanvas();
  });

  // ── Chat ──
  s.on('chat:message', (data) => {
    addChatMsg(data);
  });

  s.on('chat:close', ({ message }) => {
    addChatMsg({ type: 'close', message });
  });

}

// ══════════════════════════════════════════════════════════
//  CANVAS
// ══════════════════════════════════════════════════════════
function initCanvas() {
  State.canvas = document.getElementById('game-canvas');
  State.ctx = State.canvas.getContext('2d');

  // White background
  clearCanvas();

  // Pointer events for drawing
  State.canvas.addEventListener('pointerdown',  onPointerDown);
  State.canvas.addEventListener('pointermove',  onPointerMove);
  State.canvas.addEventListener('pointerup',    onPointerUp);
  State.canvas.addEventListener('pointerout',   onPointerUp);
  State.canvas.addEventListener('pointercancel',onPointerUp);

  // Color picker change
  document.getElementById('color-picker').addEventListener('input', (e) => {
    selectColor(e.target.value);
  });
}

function clearCanvas() {
  if (!State.ctx || !State.canvas) return;
  State.ctx.fillStyle = '#ffffff';
  State.ctx.fillRect(0, 0, State.canvas.width, State.canvas.height);
}

// ── Drawing Handlers ──

let lastEmit = 0;
const EMIT_INTERVAL = 16; // ~60fps throttle

function getPos(e) {
  const rect = State.canvas.getBoundingClientRect();
  const scaleX = State.canvas.width  / rect.width;
  const scaleY = State.canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top)  * scaleY,
  };
}

function norm(x, y) {
  return {
    nx: x / State.canvas.width,
    ny: y / State.canvas.height,
  };
}

function onPointerDown(e) {
  if (!State.isDrawer) return;
  if (e.button !== undefined && e.button !== 0) return;

  State.canvas.setPointerCapture(e.pointerId);
  const { x, y } = getPos(e);
  const { drawing } = State;

  if (drawing.tool === 'fill') {
    floodFill(State.ctx, x, y, drawing.color);
    const { nx, ny } = norm(x, y);
    State.socket.emit('draw:fill', { nx, ny, color: drawing.color });
    return;
  }

  drawing.active = true;
  drawing.lastX = x;
  drawing.lastY = y;

  // Start path
  applyStrokeStyle(State.ctx, drawing);
  State.ctx.beginPath();
  State.ctx.moveTo(x, y);

  const { nx, ny } = norm(x, y);
  State.socket.emit('draw:stroke', {
    type: 'start', nx, ny,
    color: drawing.tool === 'eraser' ? '#ffffff' : drawing.color,
    size: drawing.size, tool: drawing.tool,
  });
}

function onPointerMove(e) {
  if (!State.isDrawer || !State.drawing.active) return;
  if (State.drawing.tool === 'fill') return;

  const { x, y } = getPos(e);
  const { drawing } = State;

  applyStrokeStyle(State.ctx, drawing);
  State.ctx.lineTo(x, y);
  State.ctx.stroke();
  State.ctx.beginPath();
  State.ctx.moveTo(x, y);

  drawing.lastX = x;
  drawing.lastY = y;

  // Throttle emissions
  const now = Date.now();
  if (now - lastEmit >= EMIT_INTERVAL) {
    lastEmit = now;
    const { nx, ny } = norm(x, y);
    State.socket.emit('draw:stroke', {
      type: 'move', nx, ny,
      color: drawing.tool === 'eraser' ? '#ffffff' : drawing.color,
      size: drawing.size, tool: drawing.tool,
    });
  }
}

function onPointerUp(e) {
  if (!State.drawing.active) return;
  State.drawing.active = false;
  State.ctx.beginPath(); // reset path
  const { nx, ny } = norm(State.drawing.lastX, State.drawing.lastY);
  State.socket.emit('draw:stroke', {
    type: 'end', nx, ny,
    color: State.drawing.tool === 'eraser' ? '#ffffff' : State.drawing.color,
    size: State.drawing.size, tool: State.drawing.tool,
  });
}

function applyStrokeStyle(ctx, drawing) {
  ctx.strokeStyle = drawing.tool === 'eraser' ? '#ffffff' : drawing.color;
  ctx.lineWidth   = drawing.size;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
}

// ── Replay received strokes ──

const remoteCtx = {}; // track per-player path state (not needed since server relays same stroke)
// We track a single remote drawing path
let remotePathActive = false;

function replayStroke({ type, nx, ny, color, size, tool }) {
  const ctx = State.ctx;
  const x = nx * State.canvas.width;
  const y = ny * State.canvas.height;

  ctx.strokeStyle = color;
  ctx.lineWidth   = size;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';

  if (type === 'start') {
    ctx.beginPath();
    ctx.moveTo(x, y);
    remotePathActive = true;
  } else if (type === 'move' && remotePathActive) {
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  } else if (type === 'end') {
    ctx.beginPath();
    remotePathActive = false;
  }
}

// ── Flood Fill ──
function floodFill(ctx, startX, startY, fillColorHex) {
  const canvas = ctx.canvas;
  const { width, height } = canvas;
  const x0 = Math.floor(startX);
  const y0 = Math.floor(startY);

  if (x0 < 0 || x0 >= width || y0 < 0 || y0 >= height) return;

  const fillR = parseInt(fillColorHex.slice(1, 3), 16);
  const fillG = parseInt(fillColorHex.slice(3, 5), 16);
  const fillB = parseInt(fillColorHex.slice(5, 7), 16);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const startIdx = (y0 * width + x0) * 4;
  const tR = data[startIdx],   tG = data[startIdx + 1];
  const tB = data[startIdx + 2], tA = data[startIdx + 3];

  // Same color? Nothing to do
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
  const stack = [x0 + y0 * width]; // linear index

  while (stack.length) {
    const idx = stack.pop();
    if (visited[idx]) continue;
    const pixelIdx = idx * 4;
    if (!match(pixelIdx)) continue;

    visited[idx] = 1;
    paint(pixelIdx);

    const x = idx % width;
    const y = Math.floor(idx / width);
    if (x > 0)         stack.push(idx - 1);
    if (x < width - 1) stack.push(idx + 1);
    if (y > 0)         stack.push(idx - width);
    if (y < height - 1) stack.push(idx + width);
  }

  ctx.putImageData(imageData, 0, 0);
}

// ══════════════════════════════════════════════════════════
//  UI — LOBBY
// ══════════════════════════════════════════════════════════
function switchTab(tab) {
  document.getElementById('tab-create').classList.toggle('active', tab === 'create');
  document.getElementById('tab-join').classList.toggle('active',   tab === 'join');
  document.getElementById('panel-create').classList.toggle('hidden', tab !== 'create');
  document.getElementById('panel-join').classList.toggle('hidden',   tab !== 'join');
}

function showError(msg) {
  // Show the error on whichever screen is currently visible
  const screen = currentScreen();
  const errorId = screen === 'waiting' ? 'waiting-error' : 'lobby-error';
  const el = document.getElementById(errorId);
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

function showLobbyError(msg) {
  showError(msg);
}

function getUsername() {
  return document.getElementById('username-input').value.trim() || 'Player';
}

function onCreateRoom() {
  const username = getUsername();
  if (!username) { showLobbyError('Please enter a name.'); return; }

  const rounds      = parseInt(document.getElementById('set-rounds').value);
  const drawTime    = parseInt(document.getElementById('set-drawtime').value);
  const maxPlayers  = parseInt(document.getElementById('set-maxplayers').value);
  const customOnly  = document.getElementById('set-customonly').checked;
  const rawWords    = document.getElementById('set-customwords').value;
  const customWords = rawWords.split('\n').map(w => w.trim()).filter(Boolean);

  State.socket.emit('room:create', { username, rounds, drawTime, maxPlayers, customWords, customOnly });
}

function onJoinRoom() {
  const username = getUsername();
  if (!username) { showLobbyError('Please enter a name.'); return; }
  const roomId = document.getElementById('join-code').value.trim().toUpperCase();
  if (!roomId) { showLobbyError('Please enter a room code.'); return; }

  State.socket.emit('room:join', { username, roomId });
}

function copyRoomCode() {
  const code = document.getElementById('waiting-room-code').textContent;
  navigator.clipboard.writeText(code).catch(() => {});
}

// ══════════════════════════════════════════════════════════
//  UI — WAITING ROOM
// ══════════════════════════════════════════════════════════
function renderWaitingRoom() {
  const room = State.room;
  if (!room) return;

  document.getElementById('waiting-room-code').textContent = room.id;
  document.getElementById('waiting-info').textContent =
    `${room.players.length} / ${room.maxPlayers} players · ${room.totalRounds} rounds · ${room.drawTime}s draw time`;

  const list = document.getElementById('waiting-player-list');
  list.innerHTML = '';
  room.players.forEach(p => {
    const li = document.createElement('li');
    const isOwner = p.id === room.owner;
    const isMe = p.id === State.playerId;
    li.textContent = `${isOwner ? '👑 ' : ''}${p.name}${isMe ? ' (you)' : ''}`;
    list.appendChild(li);
  });

  State.isOwner = room.owner === State.playerId;
  const startBtn = document.getElementById('btn-start');
  const statusEl = document.getElementById('waiting-status');

  if (State.isOwner) {
    startBtn.classList.remove('hidden');
    statusEl.classList.add('hidden');
  } else {
    startBtn.classList.add('hidden');
    statusEl.classList.remove('hidden');
  }

  renderCategoryPicker();
}

function renderCategoryPicker() {
  const grid = document.getElementById('cat-picker-grid');
  if (!grid) return;

  // Find leading category
  const votes = State.categoryVotes;
  let maxVotes = 0;
  for (const count of Object.values(votes)) {
    if (count > maxVotes) maxVotes = count;
  }
  const leadingCats = maxVotes > 0
    ? Object.entries(votes).filter(([, c]) => c === maxVotes).map(([k]) => k)
    : [];

  // Update winner badge
  const badge = document.getElementById('cat-winner-badge');
  if (badge) {
    if (leadingCats.length === 1) {
      badge.textContent = leadingCats[0];
    } else if (leadingCats.length > 1) {
      badge.textContent = 'Tied — random tiebreak';
    } else {
      badge.textContent = 'Mixed (default)';
    }
  }

  // Rebuild grid
  grid.innerHTML = '';
  CATEGORY_NAMES.forEach(cat => {
    const count = votes[cat] || 0;
    const isMyVote = State.myVoteCategory === cat;
    const isLeading = leadingCats.includes(cat);

    const btn = document.createElement('button');
    btn.className = 'cat-btn'
      + (isMyVote ? ' my-vote' : '')
      + (isLeading && maxVotes > 0 ? ' leading' : '');
    btn.title = cat;
    btn.onclick = () => onCategoryVote(cat);

    const emoji = CATEGORY_EMOJI[cat] || '';
    btn.innerHTML = `${emoji} ${escHtml(cat)}${count > 0 ? ` <span class="cat-vote-pill">${count}</span>` : ''}`;
    grid.appendChild(btn);
  });
}

function onCategoryVote(categoryName) {
  State.socket.emit('room:categoryVote', { roomId: State.roomId, categoryName });
}

function onStartGame() {
  State.socket.emit('game:start', State.roomId);
}

function onLeaveRoom() {
  State.socket.emit('room:leave');
  State.roomId = null;
  State.room = null;
  State.isOwner = false;
  State.isDrawer = false;
  State.hasGuessed = false;
  State.currentWord = null;
  hideAllOverlays();
  showScreen('lobby');
  clearChat();
}

// ══════════════════════════════════════════════════════════
//  UI — GAME SCREEN
// ══════════════════════════════════════════════════════════
function renderPlayerList() {
  const room = State.room;
  if (!room) return;

  const list = document.getElementById('player-list');
  list.innerHTML = '';

  const sorted = [...room.players].sort((a, b) => b.score - a.score);

  sorted.forEach((p, i) => {
    const li = document.createElement('li');
    const isDrawer  = p.id === room.currentDrawer;
    const isMe      = p.id === State.playerId;

    if (isDrawer)    li.classList.add('is-drawer');
    if (p.hasGuessed) li.classList.add('has-guessed');

    li.innerHTML = `
      <span class="player-rank">${i + 1}</span>
      <span class="player-name">${escHtml(p.name)}${isMe ? ' <em style="font-style:normal;opacity:.5">(you)</em>' : ''}</span>
      <span class="player-score">${p.score}</span>
      ${isDrawer ? '<span class="player-drawing-badge">✏️</span>' : ''}
      ${p.hasGuessed && !isDrawer ? '<span class="player-guessed-badge">✓</span>' : ''}
    `;
    list.appendChild(li);
  });
}

function updateWordDisplay(text) {
  document.getElementById('word-display').textContent = text;
}

function updateTimer(timeLeft, drawTime) {
  document.getElementById('timer-number').textContent = Math.max(0, timeLeft);

  const arc = document.getElementById('timer-arc');
  const ratio = drawTime > 0 ? Math.max(0, timeLeft / drawTime) : 0;
  // stroke-dasharray="100" so dashoffset = 100 - (ratio * 100)
  const circumference = 100; // matches CSS
  arc.style.strokeDashoffset = `${circumference * (1 - ratio)}`;

  arc.classList.toggle('critical', timeLeft <= 10 && timeLeft > 0);
}

function setCanvasOverlay(msg) {
  const el = document.getElementById('canvas-overlay-msg');
  if (msg) {
    el.textContent = msg;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function setDrawingEnabled(enabled) {
  State.isDrawer = enabled;
  const canvas = State.canvas;
  if (enabled) {
    canvas.classList.remove('not-drawing');
    canvas.style.cursor = State.drawing.tool === 'fill' ? 'crosshair' : 'crosshair';
  } else {
    canvas.classList.add('not-drawing');
    canvas.style.cursor = 'default';
  }
}

function setToolbarVisible(visible) {
  document.getElementById('toolbar').classList.toggle('hidden', !visible);
}

function setChatEnabled(enabled) {
  const input = document.getElementById('chat-input');
  input.disabled = !enabled;
  input.placeholder = enabled ? 'Type to guess…' : (State.isDrawer ? 'You are drawing…' : 'Waiting…');
}

// ── Drawing Tools ──
function selectTool(tool) {
  State.drawing.tool = tool;
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
  State.canvas.style.cursor = 'crosshair';
}

function selectColor(hex) {
  State.drawing.color = hex;
  document.getElementById('color-picker').value = hex;
  document.querySelectorAll('.swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.color === hex);
  });
}

function selectSize(size) {
  State.drawing.size = size;
  document.querySelectorAll('.size-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.size) === size);
  });
}

function onClearCanvas() {
  clearCanvas();
  State.socket.emit('draw:clear');
}

function buildColorPalette() {
  const palette = document.getElementById('color-palette');
  COLORS.forEach((color, i) => {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (i === 0 ? ' active' : '');
    sw.dataset.color = color;
    sw.style.backgroundColor = color;
    sw.style.border = color === '#ffffff' ? '2px solid #555' : '2px solid transparent';
    sw.title = color;
    sw.onclick = () => selectColor(color);
    palette.appendChild(sw);
  });
}

// ── Chat ──
function onSendChat() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  State.socket.emit('chat:message', { roomId: State.roomId, message });
}

function addChatMsg({ type = 'chat', playerId, playerName, message }) {
  const container = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = `chat-msg type-${type}`;

  if (playerName && type !== 'system' && type !== 'correct' && type !== 'close') {
    const nameSpan = document.createElement('span');
    nameSpan.className = 'msg-name';
    nameSpan.style.color = playerColor(playerId);
    nameSpan.textContent = playerName + ':';
    el.appendChild(nameSpan);
    el.appendChild(document.createTextNode(' ' + message));
  } else {
    el.textContent = message;
  }

  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function clearChat() {
  document.getElementById('chat-messages').innerHTML = '';
}

// Simple hash-based color for player names in chat
function playerColor(playerId) {
  const colors = ['#60a5fa','#f472b6','#34d399','#facc15','#a78bfa','#fb923c','#4ade80','#f87171'];
  if (!playerId) return '#aaa';
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) hash = playerId.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

// ══════════════════════════════════════════════════════════
//  OVERLAYS
// ══════════════════════════════════════════════════════════
function hideAllOverlays() {
  document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden'));
  if (State.wordChoiceTimer) {
    clearInterval(State.wordChoiceTimer);
    State.wordChoiceTimer = null;
  }
}

function showWordChoiceOverlay(words, timeLimit) {
  const overlay = document.getElementById('overlay-word-choice');
  const buttons = document.getElementById('word-choice-buttons');
  const timerEl = document.getElementById('word-choice-timer');

  buttons.innerHTML = '';
  words.forEach(word => {
    const btn = document.createElement('button');
    btn.className = 'word-choice-btn';
    btn.textContent = word;
    btn.onclick = () => {
      State.socket.emit('game:chooseWord', { roomId: State.roomId, word });
      hideAllOverlays();
    };
    buttons.appendChild(btn);
  });

  let remaining = timeLimit;
  timerEl.textContent = `${remaining} seconds to choose`;
  State.wordChoiceTimer = setInterval(() => {
    remaining--;
    timerEl.textContent = `${remaining} seconds to choose`;
    if (remaining <= 0) {
      clearInterval(State.wordChoiceTimer);
      State.wordChoiceTimer = null;
    }
  }, 1000);

  overlay.classList.remove('hidden');
}

function showTurnEndOverlay(word, scores, myDrawerPoints) {
  document.getElementById('turn-end-word').textContent = word;

  const list = document.getElementById('turn-end-scores');
  list.innerHTML = '';
  scores.slice(0, 6).forEach((p, i) => {
    const li = document.createElement('li');
    li.className = i === 0 ? 'first' : i === 1 ? 'second' : i === 2 ? 'third' : '';
    li.innerHTML = `<span class="score-rank">#${i+1}</span><span class="score-name">${escHtml(p.name)}</span><span class="score-pts">${p.score}</span>`;
    list.appendChild(li);
  });

  document.getElementById('overlay-turn-end').classList.remove('hidden');
}

function showRoundEndOverlay(round, totalRounds, scores, isLast) {
  const title = isLast
    ? 'Final Round Complete!'
    : `Round ${round} Complete!`;
  document.getElementById('round-end-title').textContent = title;

  const list = document.getElementById('round-end-scores');
  list.innerHTML = '';
  scores.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = i === 0 ? 'first' : i === 1 ? 'second' : i === 2 ? 'third' : '';
    li.innerHTML = `<span class="score-rank">#${i+1}</span><span class="score-name">${escHtml(p.name)}</span><span class="score-pts">${p.score}</span>`;
    list.appendChild(li);
  });

  document.getElementById('overlay-round-end').classList.remove('hidden');
}

function showGameEndOverlay(scores, winner) {
  const winnerEl = document.getElementById('game-end-winner');
  winnerEl.textContent = winner
    ? `🏆 ${winner.name} wins with ${winner.score} points!`
    : 'Game over!';

  const list = document.getElementById('game-end-scores');
  list.innerHTML = '';
  scores.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = i === 0 ? 'first' : i === 1 ? 'second' : i === 2 ? 'third' : '';
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`;
    li.innerHTML = `<span class="score-rank">${medal}</span><span class="score-name">${escHtml(p.name)}</span><span class="score-pts">${p.score}</span>`;
    list.appendChild(li);
  });

  // Show play again only for owner
  document.getElementById('btn-play-again').classList.toggle('hidden', !State.isOwner);
  document.getElementById('overlay-game-end').classList.remove('hidden');
}

function onPlayAgain() {
  hideAllOverlays();
  State.socket.emit('game:start', State.roomId);
}

// ══════════════════════════════════════════════════════════
//  SCREEN MANAGEMENT
// ══════════════════════════════════════════════════════════
function showScreen(name) {
  document.getElementById('lobby-screen').classList.add('hidden');
  document.getElementById('waiting-screen').classList.add('hidden');
  document.getElementById('game-screen').classList.add('hidden');

  if (name === 'lobby')   document.getElementById('lobby-screen').classList.remove('hidden');
  if (name === 'waiting') document.getElementById('waiting-screen').classList.remove('hidden');
  if (name === 'game')    document.getElementById('game-screen').classList.remove('hidden');

  if (name !== 'game') {
    setDrawingEnabled(false);
    setToolbarVisible(false);
  }

  if (name === 'game') {
    State.drawTime = State.room?.drawTime || 80;
    updateTimer(State.drawTime, State.drawTime);
    setToolbarVisible(false);
  }
}

function currentScreen() {
  if (!document.getElementById('lobby-screen').classList.contains('hidden'))   return 'lobby';
  if (!document.getElementById('waiting-screen').classList.contains('hidden')) return 'waiting';
  if (!document.getElementById('game-screen').classList.contains('hidden'))    return 'game';
  return null;
}

// ── Utilities ──
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
