/* ── Countdown Numbers Game — Server Manager ────────────────────────────── */

'use strict';

// ── Number pools ──────────────────────────────────────────────────────────────

const LARGE = [25, 50, 75, 100];
const SMALL  = [1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10];

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateNumbers(numLarge) {
  const large = shuffle([...LARGE]).slice(0, numLarge);
  const small = shuffle([...SMALL]).slice(0, 6 - numLarge);
  return shuffle([...large, ...small]);
}

function generateTarget() {
  return 100 + Math.floor(Math.random() * 900);
}

// ── Solver (closest to target using any subset of numbers) ────────────────────

function findBestSolution(nums, target) {
  let best = null;

  function search(items) {
    // Check all current items against target (handles partial-number usage)
    for (const item of items) {
      const diff = Math.abs(item.val - target);
      if (!best || diff < best.diff ||
          (diff === best.diff && item.expr.length < best.expr.length)) {
        best = { val: item.val, expr: item.expr, diff };
      }
    }
    if (best && best.diff === 0) return; // exact — stop early
    if (items.length < 2) return;

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
        if (b.val > 0 && a.val % b.val === 0)
          ops.push({ val: a.val / b.val, expr: `(${a.expr}/${b.expr})` });
        for (const op of ops)
          if (op.val > 0 && Number.isInteger(op.val))
            search([...rest, op]);
      }
    }
  }

  search(nums.map(n => ({ val: n, expr: String(n) })));
  return best; // { val, expr, diff }
}

// ── Expression validator ───────────────────────────────────────────────────────

function validateExpression(expr, availableNums) {
  const cleaned = expr
    .replace(/\s+/g, '')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-');

  if (!/^[0-9+\-*/().]+$/.test(cleaned))
    return { ok: false, reason: 'Invalid characters in expression' };

  const tokens = cleaned.match(/\d+/g) || [];
  if (tokens.length === 0)
    return { ok: false, reason: 'Expression contains no numbers' };
  if (tokens.length > 6)
    return { ok: false, reason: 'Too many numbers used (max 6)' };

  // Multiset-subset check: each token must come from the available pool
  const pool = [...availableNums];
  for (const t of tokens) {
    const n = parseInt(t, 10);
    const idx = pool.indexOf(n);
    if (idx === -1)
      return { ok: false, reason: `${n} is not one of your six numbers` };
    pool.splice(idx, 1);
  }

  let result;
  try {
    // eslint-disable-next-line no-new-func
    result = Function('"use strict"; return (' + cleaned + ')')();
  } catch {
    return { ok: false, reason: 'Invalid expression syntax' };
  }

  if (typeof result !== 'number' || !isFinite(result))
    return { ok: false, reason: 'Expression does not produce a valid number' };
  if (!Number.isInteger(result) || result <= 0)
    return { ok: false, reason: 'Result must be a positive integer' };

  return { ok: true, result };
}

// ── Scoring ────────────────────────────────────────────────────────────────────

function calcPoints(diff) {
  if (diff === 0)  return 10;
  if (diff <= 5)   return 7;
  if (diff <= 10)  return 5;
  return 0;
}

// ── Room ID generator ──────────────────────────────────────────────────────────

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
function genId() {
  let id = '';
  for (let i = 0; i < 6; i++) id += CHARS[Math.floor(Math.random() * CHARS.length)];
  return id;
}

// ── Manager class ──────────────────────────────────────────────────────────────

class CountdownManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();       // roomId → room
    this.playerRooms = new Map(); // socketId → roomId
  }

  // ── Open Room Listing ────────────────────────────────────────────────────

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

  // ── Helpers ────────────────────────────────────────────────────────────────

  _genUniqueId() {
    let id;
    do { id = genId(); } while (this.rooms.has(id));
    return id;
  }

  _roomToClient(room) {
    return {
      id:           room.id,
      owner:        room.owner,
      state:        room.state,
      rounds:       room.rounds,
      timePerRound: room.timePerRound,
      currentRound: room.currentRound,
      pickerIndex:  room.pickerIndex,
      players:      [...room.players.values()],
    };
  }

  _currentPickerId(room) {
    const keys = [...room.players.keys()];
    if (keys.length === 0) return null;
    return keys[room.pickerIndex % keys.length];
  }

  // ── Socket API ─────────────────────────────────────────────────────────────

  createRoom(socket, data) {
    const { username = 'Player', rounds = 5, timePerRound = 30 } = data;
    if (this.playerRooms.has(socket.id)) this.leaveRoom(socket);

    const id     = this._genUniqueId();
    const player = { id: socket.id, name: username.slice(0, 20), score: 0 };

    const room = {
      id,
      owner:        socket.id,
      players:      new Map([[socket.id, player]]),
      state:        'lobby',
      rounds:       Math.min(10, Math.max(3, parseInt(rounds)       || 5)),
      timePerRound: Math.min(60, Math.max(20, parseInt(timePerRound) || 30)),
      currentRound: 0,
      pickerIndex:  0,
      pickTimeout:  null,
      currentNums:  [],
      currentTarget: 0,
      bestSolution: null,
      submissions:  new Map(),
      timeLeft:     0,
      timer:        null,
      tickTimer:    null,
    };

    this.rooms.set(id, room);
    this.playerRooms.set(socket.id, id);
    socket.join(id);

    socket.emit('cd:joined', { roomId: id, playerId: socket.id, room: this._roomToClient(room) });
  }

  joinRoom(socket, data) {
    const { code, username = 'Player' } = data;
    const roomId = (code || '').toUpperCase().trim();
    const room   = this.rooms.get(roomId);

    if (!room)                  return socket.emit('cd:error', { message: 'Room not found' });
    if (room.state !== 'lobby') return socket.emit('cd:error', { message: 'Game already in progress' });
    if (room.players.size >= 8) return socket.emit('cd:error', { message: 'Room is full' });
    if (this.playerRooms.has(socket.id)) this.leaveRoom(socket);

    const player = { id: socket.id, name: username.slice(0, 20), score: 0 };
    room.players.set(socket.id, player);
    this.playerRooms.set(socket.id, roomId);
    socket.join(roomId);

    socket.emit('cd:joined', { roomId, playerId: socket.id, room: this._roomToClient(room) });
    socket.to(roomId).emit('cd:playerJoined', { player, room: this._roomToClient(room) });
  }

  leaveRoom(socket) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (!room) { this.playerRooms.delete(socket.id); return; }

    const player     = room.players.get(socket.id);
    const playerName = player ? player.name : 'Player';
    const wasPicker  = this._currentPickerId(room) === socket.id;

    room.players.delete(socket.id);
    room.submissions.delete(socket.id);
    this.playerRooms.delete(socket.id);
    socket.leave(roomId);

    // Empty room — clean up
    if (room.players.size === 0) {
      this._clearTimers(room);
      this.rooms.delete(roomId);
      return;
    }

    // Transfer owner if needed
    if (room.owner === socket.id)
      room.owner = room.players.keys().next().value;

    // Too few players to continue active game
    if ((room.state === 'playing' || room.state === 'picking') && room.players.size < 2) {
      this._endGame(room);
      return;
    }

    // Picker disconnected mid-pick → notify then auto-pick
    if (room.state === 'picking' && wasPicker) {
      this.io.to(roomId).emit('cd:playerLeft', { playerId: socket.id, playerName, room: this._roomToClient(room) });
      if (room.pickTimeout) { clearTimeout(room.pickTimeout); room.pickTimeout = null; }
      this._doPick(room, 2);
      return;
    }

    // Player left during round → check if all remaining have submitted
    if (room.state === 'playing') this._checkAllSubmitted(room);

    this.io.to(roomId).emit('cd:playerLeft', { playerId: socket.id, playerName, room: this._roomToClient(room) });
  }

  startGame(socket, roomId) {
    const room = this.rooms.get(roomId);
    if (!room)                    return socket.emit('cd:error', { message: 'Room not found' });
    if (room.owner !== socket.id) return socket.emit('cd:error', { message: 'Only the host can start' });
    if (room.state !== 'lobby')   return socket.emit('cd:error', { message: 'Game already started' });
    if (room.players.size < 2)    return socket.emit('cd:error', { message: 'Need at least 2 players' });

    for (const p of room.players.values()) p.score = 0;
    room.currentRound = 0;
    room.pickerIndex  = 0;

    this.io.to(roomId).emit('cd:started', { room: this._roomToClient(room) });
    this._startPickPhase(room);
  }

  handlePick(socket, data) {
    const { roomId, numLarge } = data;
    const room = this.rooms.get(roomId);

    if (!room || room.state !== 'picking')
      return socket.emit('cd:error', { message: 'Not in pick phase' });
    if (this._currentPickerId(room) !== socket.id)
      return socket.emit('cd:error', { message: "It's not your turn to pick" });

    if (room.pickTimeout) { clearTimeout(room.pickTimeout); room.pickTimeout = null; }

    const n = Math.min(4, Math.max(0, parseInt(numLarge) || 0));
    this._doPick(room, n);
  }

  handleSubmit(socket, data) {
    const { roomId, expr } = data;
    const room   = this.rooms.get(roomId);
    const player = room && room.players.get(socket.id);

    if (!room || room.state !== 'playing')
      return socket.emit('cd:error', { message: 'No active round' });
    if (!player)
      return socket.emit('cd:error', { message: 'Not in this room' });
    if (room.submissions.has(socket.id))
      return socket.emit('cd:error', { message: 'Already submitted for this round' });

    const v = validateExpression(expr || '', room.currentNums);
    if (!v.ok) return socket.emit('cd:error', { message: v.reason });

    const diff   = Math.abs(v.result - room.currentTarget);
    const points = calcPoints(diff);
    room.submissions.set(socket.id, { expr, result: v.result, diff, points });

    this.io.to(room.id).emit('cd:playerSubmitted', {
      playerId:       socket.id,
      playerName:     player.name,
      submittedCount: room.submissions.size,
      totalCount:     room.players.size,
    });

    this._checkAllSubmitted(room);
  }

  // ── Game flow ──────────────────────────────────────────────────────────────

  _clearTimers(room) {
    if (room.timer)       { clearTimeout(room.timer);     room.timer = null; }
    if (room.tickTimer)   { clearInterval(room.tickTimer); room.tickTimer = null; }
    if (room.pickTimeout) { clearTimeout(room.pickTimeout); room.pickTimeout = null; }
  }

  _startPickPhase(room) {
    this._clearTimers(room);
    room.state        = 'picking';
    room.currentRound += 1;
    room.submissions  = new Map();

    const pickerId = this._currentPickerId(room);
    const picker   = room.players.get(pickerId);

    this.io.to(room.id).emit('cd:pickStart', {
      pickerName:  picker ? picker.name : 'Unknown',
      pickerId,
      round:       room.currentRound,
      totalRounds: room.rounds,
    });

    // Auto-pick 2 large after 10 s
    room.pickTimeout = setTimeout(() => {
      room.pickTimeout = null;
      if (room.state === 'picking') this._doPick(room, 2);
    }, 10000);
  }

  _doPick(room, numLarge) {
    room.currentNums   = generateNumbers(numLarge);
    room.currentTarget = generateTarget();
    room.bestSolution  = findBestSolution([...room.currentNums], room.currentTarget);
    room.state         = 'playing';
    room.timeLeft      = room.timePerRound;

    this.io.to(room.id).emit('cd:roundStart', {
      round:       room.currentRound,
      totalRounds: room.rounds,
      nums:        room.currentNums,
      target:      room.currentTarget,
      timeLeft:    room.timeLeft,
    });

    room.tickTimer = setInterval(() => {
      room.timeLeft -= 1;
      this.io.to(room.id).emit('cd:tick', { timeLeft: room.timeLeft });
      if (room.timeLeft <= 0) this._endRound(room);
    }, 1000);

    // Safety timeout
    room.timer = setTimeout(() => {
      if (room.state === 'playing') this._endRound(room);
    }, (room.timePerRound + 2) * 1000);
  }

  _checkAllSubmitted(room) {
    if (room.state === 'playing' && room.submissions.size >= room.players.size)
      this._endRound(room);
  }

  _endRound(room) {
    if (room.state !== 'playing') return;
    room.state = 'round_end';
    this._clearTimers(room);

    // Build per-player results and award points
    const results = [];
    for (const [sid, player] of room.players) {
      const sub = room.submissions.get(sid);
      if (sub) {
        player.score += sub.points;
        results.push({ id: sid, name: player.name, expr: sub.expr, result: sub.result, diff: sub.diff, points: sub.points });
      } else {
        results.push({ id: sid, name: player.name, expr: null, result: null, diff: null, points: 0 });
      }
    }

    // Sort: closest first, no-answer last
    results.sort((a, b) => {
      if (a.diff === null) return 1;
      if (b.diff === null) return -1;
      return a.diff - b.diff;
    });

    const scores = [...room.players.values()]
      .map(p => ({ id: p.id, name: p.name, score: p.score }))
      .sort((a, b) => b.score - a.score);

    this.io.to(room.id).emit('cd:roundEnd', {
      round:        room.currentRound,
      results,
      bestSolution: room.bestSolution,
      target:       room.currentTarget,
      scores,
    });

    // Advance picker index for next round
    room.pickerIndex = (room.pickerIndex + 1) % room.players.size;

    if (room.currentRound >= room.rounds) {
      setTimeout(() => this._endGame(room), 5200);
    } else {
      setTimeout(() => this._startPickPhase(room), 5200);
    }
  }

  _endGame(room) {
    this._clearTimers(room);
    room.state = 'game_over';

    const scores = [...room.players.values()]
      .map(p => ({ id: p.id, name: p.name, score: p.score }))
      .sort((a, b) => b.score - a.score);

    const winner = scores.length > 0 ? scores[0] : null;
    this.io.to(room.id).emit('cd:gameOver', { scores, winner });
  }

  resetRoom(socket, roomId) {
    const room = this.rooms.get(roomId);
    if (!room)                    return socket.emit('cd:error', { message: 'Room not found' });
    if (room.owner !== socket.id) return socket.emit('cd:error', { message: 'Only the host can reset' });

    this._clearTimers(room);
    room.state         = 'lobby';
    room.currentRound  = 0;
    room.pickerIndex   = 0;
    room.currentNums   = [];
    room.currentTarget = 0;
    room.bestSolution  = null;
    room.submissions   = new Map();
    room.timeLeft      = 0;
    for (const p of room.players.values()) p.score = 0;

    this.io.to(roomId).emit('cd:reset', { room: this._roomToClient(room) });
  }
}

module.exports = CountdownManager;
