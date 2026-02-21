/* ── The 24 Game — Server Manager ───────────────────────────────────────── */

'use strict';

// ── Solver ────────────────────────────────────────────────────────────────

function _solve(items) {
  if (items.length === 1)
    return Math.abs(items[0].val - 24) < 1e-9 ? items[0].expr : null;
  for (let i = 0; i < items.length; i++) {
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      const rest = items.filter((_, k) => k !== i && k !== j);
      const a = items[i], b = items[j];
      const ops = [
        { val: a.val + b.val, expr: `(${a.expr}+${b.expr})` },
        { val: a.val - b.val, expr: `(${a.expr}-${b.expr})` },
        { val: a.val * b.val, expr: `(${a.expr}*${b.expr})` },
      ];
      if (Math.abs(b.val) > 1e-9)
        ops.push({ val: a.val / b.val, expr: `(${a.expr}/${b.expr})` });
      for (const op of ops) {
        const r = _solve([...rest, op]);
        if (r) return r;
      }
    }
  }
  return null;
}

function findSolution(nums) {
  return _solve(nums.map(n => ({ val: n, expr: String(n) })));
}

// ── Puzzle generator ──────────────────────────────────────────────────────

function generatePuzzle() {
  let nums, solution;
  do {
    nums = Array.from({ length: 4 }, () => Math.floor(Math.random() * 9) + 1);
    solution = findSolution(nums);
  } while (!solution);
  return { nums, solution };
}

// ── Expression validator ──────────────────────────────────────────────────

function validateExpression(expr, targetNums) {
  // Normalize
  let cleaned = expr.replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');

  // Whitelist: only digits, operators, parens
  if (!/^[0-9+\-*/().]+$/.test(cleaned)) {
    return { ok: false, reason: 'Invalid characters in expression' };
  }

  // Extract number tokens
  const tokens = cleaned.match(/\d+/g) || [];
  if (tokens.length !== 4) {
    return { ok: false, reason: 'Must use exactly 4 numbers' };
  }

  // Parse tokens as integers and check for multi-digit numbers that aren't in the set
  const tokenNums = tokens.map(Number);
  for (const t of tokenNums) {
    if (t < 1 || t > 9 || String(t).length > 1) {
      return { ok: false, reason: 'Only use the 4 given single digits' };
    }
  }

  // Multiset check: sorted token nums must equal sorted target nums
  const sortedTokens = [...tokenNums].sort((a, b) => a - b);
  const sortedTarget = [...targetNums].sort((a, b) => a - b);
  if (sortedTokens.join(',') !== sortedTarget.join(',')) {
    return { ok: false, reason: 'Must use all 4 numbers exactly once' };
  }

  // Evaluate safely
  let result;
  try {
    // eslint-disable-next-line no-new-func
    result = Function('"use strict"; return (' + cleaned + ')')();
  } catch (e) {
    return { ok: false, reason: 'Invalid expression syntax' };
  }

  if (typeof result !== 'number' || !isFinite(result)) {
    return { ok: false, reason: 'Expression did not produce a valid number' };
  }

  if (Math.abs(result - 24) > 0.0001) {
    return { ok: false, reason: `Expression equals ${result.toFixed(4)}, not 24` };
  }

  return { ok: true };
}

// ── Room ID generator ─────────────────────────────────────────────────────

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
function genId() {
  let id = '';
  for (let i = 0; i < 6; i++) id += CHARS[Math.floor(Math.random() * CHARS.length)];
  return id;
}

// ── Manager class ─────────────────────────────────────────────────────────

class Game24Manager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();       // roomId → room
    this.playerRooms = new Map(); // socketId → roomId
  }

  // ── Open Room Listing ──────────────────────────────────────────────────

  getOpenRooms() {
    const result = [];
    for (const room of this.rooms.values()) {
      if (room.state === 'lobby' && room.players.size < 8) {
        const owner = room.players.get(room.owner);
        result.push({
          id: room.id,
          ownerName: owner ? owner.name : 'Unknown',
          playerCount: room.players.size,
          maxPlayers: 8,
        });
      }
    }
    return result;
  }

  // ── Room helpers ──────────────────────────────────────────────────────

  _genUniqueId() {
    let id;
    do { id = genId(); } while (this.rooms.has(id));
    return id;
  }

  _roomToClient(room) {
    return {
      id: room.id,
      owner: room.owner,
      state: room.state,
      rounds: room.rounds,
      timePerRound: room.timePerRound,
      currentRound: room.currentRound,
      players: [...room.players.values()],
    };
  }

  _getPlayer(room, socketId) {
    return room.players.get(socketId);
  }

  // ── Socket API ────────────────────────────────────────────────────────

  createRoom(socket, data) {
    const { username = 'Player', rounds = 5, timePerRound = 60 } = data;

    if (this.playerRooms.has(socket.id)) {
      this.leaveRoom(socket);
    }

    const id = this._genUniqueId();
    const player = { id: socket.id, name: username.slice(0, 20), score: 0 };

    const room = {
      id,
      owner: socket.id,
      players: new Map([[socket.id, player]]),
      state: 'lobby',
      rounds: Math.min(10, Math.max(3, parseInt(rounds) || 5)),
      timePerRound: Math.min(90, Math.max(30, parseInt(timePerRound) || 60)),
      currentRound: 0,
      currentNums: [],
      currentSolution: '',
      timeLeft: 0,
      timer: null,
      tickTimer: null,
    };

    this.rooms.set(id, room);
    this.playerRooms.set(socket.id, id);
    socket.join(id);

    socket.emit('g24:joined', { roomId: id, playerId: socket.id, room: this._roomToClient(room) });
  }

  joinRoom(socket, data) {
    const { code, username = 'Player' } = data;
    const roomId = (code || '').toUpperCase().trim();
    const room = this.rooms.get(roomId);

    if (!room) {
      socket.emit('g24:error', { message: 'Room not found' });
      return;
    }
    if (room.state !== 'lobby') {
      socket.emit('g24:error', { message: 'Game already in progress' });
      return;
    }
    if (room.players.size >= 8) {
      socket.emit('g24:error', { message: 'Room is full' });
      return;
    }

    if (this.playerRooms.has(socket.id)) {
      this.leaveRoom(socket);
    }

    const player = { id: socket.id, name: username.slice(0, 20), score: 0 };
    room.players.set(socket.id, player);
    this.playerRooms.set(socket.id, roomId);
    socket.join(roomId);

    socket.emit('g24:joined', { roomId, playerId: socket.id, room: this._roomToClient(room) });
    socket.to(roomId).emit('g24:playerJoined', { player, room: this._roomToClient(room) });
  }

  leaveRoom(socket) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (!room) { this.playerRooms.delete(socket.id); return; }

    const player = room.players.get(socket.id);
    const playerName = player ? player.name : 'Player';

    room.players.delete(socket.id);
    this.playerRooms.delete(socket.id);
    socket.leave(roomId);

    if (room.players.size === 0) {
      this._clearTimers(room);
      this.rooms.delete(roomId);
      return;
    }

    // Transfer ownership if needed
    if (room.owner === socket.id) {
      room.owner = room.players.keys().next().value;
    }

    // If game in progress and only 1 player left, end it
    if (room.state === 'playing' && room.players.size < 2) {
      this._endGame(room);
      return;
    }

    this.io.to(roomId).emit('g24:playerLeft', {
      playerId: socket.id,
      playerName,
      room: this._roomToClient(room),
    });
  }

  startGame(socket, roomId) {
    const room = this.rooms.get(roomId);
    if (!room) { socket.emit('g24:error', { message: 'Room not found' }); return; }
    if (room.owner !== socket.id) { socket.emit('g24:error', { message: 'Only the host can start' }); return; }
    if (room.state !== 'lobby') { socket.emit('g24:error', { message: 'Game already started' }); return; }
    if (room.players.size < 2) { socket.emit('g24:error', { message: 'Need at least 2 players' }); return; }

    // Reset scores
    for (const p of room.players.values()) p.score = 0;

    room.state = 'playing';
    room.currentRound = 0;

    this.io.to(roomId).emit('g24:started', { room: this._roomToClient(room) });
    this._startNextRound(room);
  }

  handleSubmit(socket, data) {
    const { roomId, expr } = data;
    const room = this.rooms.get(roomId);

    if (!room || room.state !== 'playing') {
      socket.emit('g24:error', { message: 'No active game' });
      return;
    }

    const player = room.players.get(socket.id);
    if (!player) {
      socket.emit('g24:error', { message: 'Not in this room' });
      return;
    }

    const validation = validateExpression(expr || '', room.currentNums);
    if (!validation.ok) {
      socket.emit('g24:error', { message: validation.reason });
      return;
    }

    // Correct answer — end round with this winner
    this._endRound(room, {
      id: socket.id,
      name: player.name,
      expr: expr,
      timeLeft: room.timeLeft,
    });
  }

  // ── Game flow ──────────────────────────────────────────────────────────

  _clearTimers(room) {
    if (room.timer) { clearTimeout(room.timer); room.timer = null; }
    if (room.tickTimer) { clearInterval(room.tickTimer); room.tickTimer = null; }
  }

  _startNextRound(room) {
    this._clearTimers(room);
    room.currentRound += 1;

    const { nums, solution } = generatePuzzle();
    room.currentNums = nums;
    room.currentSolution = solution;
    room.timeLeft = room.timePerRound;
    room.state = 'playing';

    this.io.to(room.id).emit('g24:roundStart', {
      round: room.currentRound,
      totalRounds: room.rounds,
      nums,
      timeLeft: room.timeLeft,
    });

    // Tick every second
    room.tickTimer = setInterval(() => {
      room.timeLeft -= 1;
      this.io.to(room.id).emit('g24:tick', { timeLeft: room.timeLeft });

      if (room.timeLeft <= 0) {
        this._endRound(room, null); // timeout — no winner
      }
    }, 1000);

    // Safety timeout (timePerRound + 2s buffer)
    room.timer = setTimeout(() => {
      if (room.state === 'playing') this._endRound(room, null);
    }, (room.timePerRound + 2) * 1000);
  }

  _endRound(room, winner) {
    if (room.state !== 'playing') return;
    room.state = 'round_end';
    this._clearTimers(room);

    let winnerPayload = null;
    if (winner) {
      const points = 100 + Math.round(50 * winner.timeLeft / room.timePerRound);
      const player = room.players.get(winner.id);
      if (player) player.score += points;
      winnerPayload = { id: winner.id, name: winner.name, expr: winner.expr, points };
    }

    const scores = [...room.players.values()]
      .map(p => ({ id: p.id, name: p.name, score: p.score }))
      .sort((a, b) => b.score - a.score);

    this.io.to(room.id).emit('g24:roundEnd', {
      round: room.currentRound,
      winner: winnerPayload,
      solution: room.currentSolution,
      nums: room.currentNums,
      scores,
    });

    if (room.currentRound >= room.rounds) {
      // Slight delay so clients can process roundEnd first
      setTimeout(() => this._endGame(room), 4200);
    } else {
      // Start next round after recap delay
      setTimeout(() => this._startNextRound(room), 4200);
    }
  }

  _endGame(room) {
    this._clearTimers(room);
    room.state = 'game_over';

    const scores = [...room.players.values()]
      .map(p => ({ id: p.id, name: p.name, score: p.score }))
      .sort((a, b) => b.score - a.score);

    const winner = scores.length > 0 ? scores[0] : null;

    this.io.to(room.id).emit('g24:gameOver', { scores, winner });
  }

  resetRoom(socket, roomId) {
    const room = this.rooms.get(roomId);
    if (!room) { socket.emit('g24:error', { message: 'Room not found' }); return; }
    if (room.owner !== socket.id) { socket.emit('g24:error', { message: 'Only the host can reset' }); return; }

    this._clearTimers(room);
    room.state = 'lobby';
    room.currentRound = 0;
    room.currentNums = [];
    room.currentSolution = '';
    room.timeLeft = 0;
    for (const p of room.players.values()) p.score = 0;

    this.io.to(roomId).emit('g24:reset', { room: this._roomToClient(room) });
  }
}

module.exports = Game24Manager;
