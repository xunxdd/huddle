// ── Apples to Apples Manager ────────────────────────────────────────────────

const { GREEN_CARDS, RED_CARDS } = require('./applesCards');

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const HAND_SIZE = 7;
const PICK_TIME = 45;
const JUDGE_TIME = 30;
const REVEAL_TIME = 5;

class ApplesManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();       // roomId -> room
    this.playerRooms = new Map(); // socketId -> roomId
  }

  // ─── Open Room Listing ──────────────────────────────────────────────────

  getOpenRooms() {
    const result = [];
    for (const room of this.rooms.values()) {
      if (room.state === 'lobby' && room.players.size < room.maxPlayers) {
        const owner = room.players.get(room.owner);
        result.push({
          id: room.id,
          ownerName: owner ? owner.name : 'Unknown',
          playerCount: room.players.size,
          maxPlayers: room.maxPlayers,
        });
      }
    }
    return result;
  }

  // ─── Room Code ──────────────────────────────────────────────────────────

  _generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
      code = Array.from({ length: 6 }, () =>
        chars[Math.floor(Math.random() * chars.length)]
      ).join('');
    } while (this.rooms.has(code));
    return code;
  }

  // ─── Player factory ─────────────────────────────────────────────────────

  _makePlayer(socketId, username) {
    return {
      id: socketId,
      name: username.slice(0, 20).trim() || 'Player',
      score: 0,
    };
  }

  // ─── Public room snapshot ───────────────────────────────────────────────

  _roomPublic(room) {
    return {
      id: room.id,
      owner: room.owner,
      state: room.state,
      currentRound: room.currentRound,
      totalRounds: room.totalRounds,
      maxPlayers: room.maxPlayers,
      judgeId: room.judgeId,
      players: this._playersPublic(room),
    };
  }

  _playersPublic(room) {
    return Array.from(room.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
    }));
  }

  _scores(room) {
    return Array.from(room.players.values())
      .map(p => ({ id: p.id, name: p.name, score: p.score }))
      .sort((a, b) => b.score - a.score);
  }

  // ─── Deck helpers ───────────────────────────────────────────────────────

  _initDecks(room) {
    room.greenDeck = shuffle([...GREEN_CARDS]);
    room.redDeck = shuffle([...RED_CARDS]);
    room.hands = new Map(); // socketId -> array of red cards
  }

  _drawGreen(room) {
    if (room.greenDeck.length === 0) {
      room.greenDeck = shuffle([...GREEN_CARDS]);
    }
    return room.greenDeck.pop();
  }

  _drawRed(room, count = 1) {
    const cards = [];
    for (let i = 0; i < count; i++) {
      if (room.redDeck.length === 0) {
        room.redDeck = shuffle([...RED_CARDS]);
      }
      cards.push(room.redDeck.pop());
    }
    return cards;
  }

  _dealHands(room) {
    for (const pid of room.players.keys()) {
      room.hands.set(pid, this._drawRed(room, HAND_SIZE));
    }
  }

  _refillHand(room, playerId) {
    const hand = room.hands.get(playerId);
    if (!hand) return;
    while (hand.length < HAND_SIZE) {
      hand.push(...this._drawRed(room, 1));
    }
  }

  // ─── Judge rotation ─────────────────────────────────────────────────────

  _nextJudge(room) {
    const ids = Array.from(room.players.keys());
    if (ids.length === 0) return null;

    if (!room.judgeId || !room.players.has(room.judgeId)) {
      room.judgeId = ids[0];
    } else {
      const idx = ids.indexOf(room.judgeId);
      room.judgeId = ids[(idx + 1) % ids.length];
    }
    return room.judgeId;
  }

  // ─── Room Management ────────────────────────────────────────────────────

  createRoom(socket, opts = {}) {
    const {
      username = 'Player',
      totalRounds = 8,
    } = opts;

    this.leaveRoom(socket);

    const roomId = this._generateRoomCode();
    const player = this._makePlayer(socket.id, username);

    const room = {
      id: roomId,
      owner: socket.id,
      players: new Map([[socket.id, player]]),
      state: 'lobby',
      maxPlayers: 8,
      currentRound: 0,
      totalRounds: Math.max(5, Math.min(totalRounds, 15)),
      // Decks & hands
      greenDeck: [],
      redDeck: [],
      hands: new Map(),
      // Round state
      judgeId: null,
      judgeOrder: [],
      greenCard: null,
      submissions: new Map(), // socketId -> red card text
      shuffledSubs: [],       // [{id, card}] shuffled for anonymous display
      // Timers
      tickTimer: null,
      autoResetTimer: null,
      timeLeft: 0,
    };

    this.rooms.set(roomId, room);
    this.playerRooms.set(socket.id, roomId);
    socket.join(roomId);

    socket.emit('aa:joined', {
      roomId,
      playerId: socket.id,
      room: this._roomPublic(room),
    });

    console.log(`[AA] Room created: ${roomId} by ${player.name}`);
  }

  joinRoom(socket, opts = {}) {
    const { username = 'Player', roomId } = opts;

    if (!roomId) {
      socket.emit('aa:error', { message: 'Room code required' });
      return;
    }

    const code = roomId.toUpperCase().trim();
    const room = this.rooms.get(code);

    if (!room) {
      socket.emit('aa:error', { message: 'Room not found' });
      return;
    }
    if (room.players.size >= room.maxPlayers) {
      socket.emit('aa:error', { message: 'Room is full' });
      return;
    }
    if (room.state !== 'lobby') {
      socket.emit('aa:error', { message: 'Game already in progress' });
      return;
    }

    this.leaveRoom(socket);

    const player = this._makePlayer(socket.id, username);
    room.players.set(socket.id, player);
    this.playerRooms.set(socket.id, code);
    socket.join(code);

    socket.emit('aa:joined', {
      roomId: code,
      playerId: socket.id,
      room: this._roomPublic(room),
    });

    socket.to(code).emit('aa:playerJoined', {
      player: { id: player.id, name: player.name, score: 0 },
      room: this._roomPublic(room),
    });

    console.log(`[AA] ${player.name} joined room ${code}`);
  }

  leaveRoom(socket) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    this.playerRooms.delete(socket.id);

    if (!room) return;

    room.players.delete(socket.id);
    room.hands.delete(socket.id);
    room.submissions.delete(socket.id);
    socket.leave(roomId);

    if (room.players.size === 0) {
      this._clearTimers(room);
      this.rooms.delete(roomId);
      console.log(`[AA] Room ${roomId} deleted (empty)`);
      return;
    }

    // Transfer ownership if needed
    if (room.owner === socket.id) {
      room.owner = room.players.keys().next().value;
    }

    // If the judge left mid-round, auto-resolve or skip
    if (room.judgeId === socket.id && (room.state === 'picking' || room.state === 'judging')) {
      this._nextJudge(room);
      // Skip to next round
      this._clearTimers(room);
      if (room.currentRound >= room.totalRounds) {
        this._endGame(room);
      } else {
        this._startNextRound(room);
      }
    }

    // If a player left during picking, check if all remaining have submitted
    if (room.state === 'picking') {
      this._checkAllSubmitted(room);
    }

    this.io.to(roomId).emit('aa:playerLeft', {
      playerId: socket.id,
      room: this._roomPublic(room),
    });

    console.log(`[AA] Player left room ${roomId}, remaining: ${room.players.size}`);
  }

  // ─── Game Flow ──────────────────────────────────────────────────────────

  startGame(socket, roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      socket.emit('aa:error', { message: 'Room not found' });
      return;
    }
    if (room.owner !== socket.id) {
      socket.emit('aa:error', { message: 'Only the host can start the game' });
      return;
    }
    if (room.state !== 'lobby') {
      socket.emit('aa:error', { message: 'Game already in progress' });
      return;
    }
    if (room.players.size < 3) {
      socket.emit('aa:error', { message: 'Need at least 3 players to start' });
      return;
    }

    // Reset scores
    for (const p of room.players.values()) {
      p.score = 0;
    }

    room.currentRound = 0;
    room.judgeId = null;
    this._initDecks(room);
    this._dealHands(room);

    this.io.to(roomId).emit('aa:started', { room: this._roomPublic(room) });
    console.log(`[AA] Game started in room ${roomId}`);

    this._startNextRound(room);
  }

  // ─── Picking Phase ──────────────────────────────────────────────────────

  _startNextRound(room) {
    room.currentRound++;
    room.state = 'picking';
    room.submissions = new Map();
    room.shuffledSubs = [];

    this._nextJudge(room);
    room.greenCard = this._drawGreen(room);

    // Refill hands for non-judge players
    for (const pid of room.players.keys()) {
      if (pid !== room.judgeId) {
        this._refillHand(room, pid);
      }
    }

    // Send round start to each player individually (private hand data)
    for (const [pid, player] of room.players.entries()) {
      const sock = this.io.sockets.sockets.get(pid);
      if (!sock) continue;

      sock.emit('aa:roundStart', {
        round: room.currentRound,
        totalRounds: room.totalRounds,
        greenCard: room.greenCard,
        judgeId: room.judgeId,
        judgeName: room.players.get(room.judgeId)?.name || 'Unknown',
        hand: pid !== room.judgeId ? (room.hands.get(pid) || []) : [],
        isJudge: pid === room.judgeId,
        timeLeft: PICK_TIME,
        players: this._playersPublic(room),
      });
    }

    this._startTick(room, PICK_TIME, () => this._autoSubmit(room));
  }

  handleSubmit(socket, data) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room || room.state !== 'picking') return;

    // Judge can't submit
    if (socket.id === room.judgeId) return;
    // Already submitted
    if (room.submissions.has(socket.id)) return;

    const { cardIndex } = data;
    const hand = room.hands.get(socket.id);
    if (!hand || typeof cardIndex !== 'number' || cardIndex < 0 || cardIndex >= hand.length) return;

    const card = hand.splice(cardIndex, 1)[0];
    room.submissions.set(socket.id, card);

    socket.emit('aa:submitted', { card });

    // Notify everyone how many have submitted
    const expected = room.players.size - 1; // everyone except judge
    this.io.to(room.id).emit('aa:submitCount', {
      count: room.submissions.size,
      total: expected,
    });

    this._checkAllSubmitted(room);
  }

  _checkAllSubmitted(room) {
    const expected = room.players.size - 1; // everyone except judge
    if (room.submissions.size >= expected) {
      this._startJudging(room);
    }
  }

  _autoSubmit(room) {
    if (room.state !== 'picking') return;

    // Auto-submit random card for players who haven't submitted
    for (const [pid] of room.players.entries()) {
      if (pid === room.judgeId) continue;
      if (room.submissions.has(pid)) continue;

      const hand = room.hands.get(pid);
      if (hand && hand.length > 0) {
        const idx = Math.floor(Math.random() * hand.length);
        const card = hand.splice(idx, 1)[0];
        room.submissions.set(pid, card);
      }
    }

    this._startJudging(room);
  }

  // ─── Judging Phase ────────────────────────────────────────────────────

  _startJudging(room) {
    if (room.state === 'judging') return;
    this._clearTimers(room);
    room.state = 'judging';

    // Shuffle submissions for anonymous display
    const entries = Array.from(room.submissions.entries()).map(([pid, card]) => ({
      id: pid,
      card,
    }));
    shuffle(entries);
    room.shuffledSubs = entries;

    // Send anonymous cards (no player IDs) to everyone
    const anonymousCards = entries.map((e, i) => ({ index: i, card: e.card }));

    this.io.to(room.id).emit('aa:judgingStart', {
      greenCard: room.greenCard,
      judgeId: room.judgeId,
      judgeName: room.players.get(room.judgeId)?.name || 'Unknown',
      cards: anonymousCards,
      timeLeft: JUDGE_TIME,
    });

    this._startTick(room, JUDGE_TIME, () => this._autoJudge(room));
  }

  handleJudge(socket, data) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room || room.state !== 'judging') return;

    // Only judge can pick
    if (socket.id !== room.judgeId) return;

    const { cardIndex } = data;
    if (typeof cardIndex !== 'number' || cardIndex < 0 || cardIndex >= room.shuffledSubs.length) return;

    this._resolveRound(room, cardIndex);
  }

  _autoJudge(room) {
    if (room.state !== 'judging') return;
    const idx = Math.floor(Math.random() * room.shuffledSubs.length);
    this._resolveRound(room, idx);
  }

  // ─── Reveal Phase ───────────────────────────────────────────────────────

  _resolveRound(room, winnerIndex) {
    this._clearTimers(room);
    room.state = 'reveal';

    const winner = room.shuffledSubs[winnerIndex];
    if (!winner) return;

    const winnerPlayer = room.players.get(winner.id);
    if (winnerPlayer) {
      winnerPlayer.score += 1;
    }

    // Build reveal data: all submissions with player names
    const allSubmissions = room.shuffledSubs.map((e, i) => ({
      card: e.card,
      playerName: room.players.get(e.id)?.name || 'Unknown',
      playerId: e.id,
      isWinner: i === winnerIndex,
    }));

    this.io.to(room.id).emit('aa:reveal', {
      greenCard: room.greenCard,
      winnerCard: winner.card,
      winnerId: winner.id,
      winnerName: winnerPlayer?.name || 'Unknown',
      winnerIndex,
      allSubmissions,
      scores: this._scores(room),
      round: room.currentRound,
      totalRounds: room.totalRounds,
    });

    // After reveal pause, proceed
    setTimeout(() => {
      if (room.state !== 'reveal') return;
      if (room.currentRound >= room.totalRounds) {
        this._endGame(room);
      } else {
        this._startNextRound(room);
      }
    }, REVEAL_TIME * 1000);
  }

  // ─── Game End ─────────────────────────────────────────────────────────

  _endGame(room) {
    this._clearTimers(room);
    room.state = 'game_end';

    const scores = this._scores(room);
    const winner = scores[0] || null;

    this.io.to(room.id).emit('aa:gameOver', {
      scores,
      winner: winner ? { id: winner.id, name: winner.name, score: winner.score } : null,
    });

    console.log(`[AA] Game ended in room ${room.id}. Winner: ${winner?.name}`);

    room.autoResetTimer = setTimeout(() => {
      if (!room || !this.rooms.has(room.id)) return;
      this._doReset(room);
    }, 15000);
  }

  _doReset(room) {
    this._clearTimers(room);
    room.state = 'lobby';
    room.currentRound = 0;
    room.judgeId = null;
    room.greenCard = null;
    room.submissions = new Map();
    room.shuffledSubs = [];
    room.hands = new Map();
    room.greenDeck = [];
    room.redDeck = [];
    for (const p of room.players.values()) {
      p.score = 0;
    }
    this.io.to(room.id).emit('aa:reset', { room: this._roomPublic(room) });
  }

  resetRoom(socket, roomId) {
    const room = this.rooms.get(roomId);
    if (!room) { socket.emit('aa:error', { message: 'Room not found' }); return; }
    if (room.owner !== socket.id) { socket.emit('aa:error', { message: 'Only the host can reset' }); return; }
    this._doReset(room);
  }

  // ─── Timers ───────────────────────────────────────────────────────────

  _startTick(room, duration, onExpire) {
    this._clearTimers(room);
    room.timeLeft = duration;

    room.tickTimer = setInterval(() => {
      room.timeLeft--;
      this.io.to(room.id).emit('aa:tick', { timeLeft: room.timeLeft });

      if (room.timeLeft <= 0) {
        this._clearTimers(room);
        onExpire();
      }
    }, 1000);
  }

  _clearTimers(room) {
    if (room.tickTimer) { clearInterval(room.tickTimer); room.tickTimer = null; }
    if (room.autoResetTimer) { clearTimeout(room.autoResetTimer); room.autoResetTimer = null; }
  }
}

module.exports = ApplesManager;
