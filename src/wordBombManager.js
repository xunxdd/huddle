const { pickCombo, isValidWord } = require('./combos');

class WordBombManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();       // roomId -> room
    this.playerRooms = new Map(); // socketId -> roomId
  }

  // ─── Room Code ─────────────────────────────────────────────────────────────

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

  // ─── Player factory ────────────────────────────────────────────────────────

  _makePlayer(socketId, username) {
    return {
      id: socketId,
      name: username.slice(0, 20).trim() || 'Player',
      score: 0,
      turnsTaken: 0,
    };
  }

  // ─── Public room snapshot (no Set/Map, safe to emit) ──────────────────────

  _roomPublic(room) {
    return {
      id: room.id,
      owner: room.owner,
      state: room.state,
      currentRound: room.currentRound,
      totalRounds: room.totalRounds,
      timePerTurn: room.timePerTurn,
      maxPlayers: room.maxPlayers,
      playerOrder: room.playerOrder,
      activeIndex: room.activeIndex,
      currentCombo: room.currentCombo,
      timeLeft: room.timeLeft,
      players: this._playersPublic(room),
    };
  }

  _playersPublic(room) {
    return Array.from(room.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      turnsTaken: p.turnsTaken,
    }));
  }

  _scores(room) {
    return Array.from(room.players.values())
      .map(p => ({ id: p.id, name: p.name, score: p.score }))
      .sort((a, b) => b.score - a.score);
  }

  // ─── Room Management ───────────────────────────────────────────────────────

  createRoom(socket, opts = {}) {
    const {
      username = 'Player',
      totalRounds = 5,
      timePerTurn = 12,
      maxPlayers = 8,
    } = opts;

    // Leave any current room first
    this.leaveRoom(socket);

    const roomId = this._generateRoomCode();
    const player = this._makePlayer(socket.id, username);

    const room = {
      id: roomId,
      owner: socket.id,
      players: new Map([[socket.id, player]]),
      state: 'lobby',
      currentRound: 0,
      totalRounds: Math.max(1, Math.min(totalRounds, 10)),
      timePerTurn: Math.max(8, Math.min(timePerTurn, 30)),
      maxPlayers: Math.max(2, Math.min(maxPlayers, 12)),
      playerOrder: [],
      activeIndex: -1,
      currentCombo: '',
      usedWords: new Set(),
      timer: null,
      timeLeft: 0,
      // Track how many players have gone this round
      turnsThisRound: 0,
    };

    this.rooms.set(roomId, room);
    this.playerRooms.set(socket.id, roomId);
    socket.join(roomId);

    socket.emit('wb:joined', {
      roomId,
      playerId: socket.id,
      room: this._roomPublic(room),
    });

    console.log(`[WB] Room created: ${roomId} by ${player.name}`);
  }

  joinRoom(socket, opts = {}) {
    const { username = 'Player', roomId } = opts;

    if (!roomId) {
      socket.emit('wb:error', { message: 'Room code required' });
      return;
    }

    const code = roomId.toUpperCase().trim();
    const room = this.rooms.get(code);

    if (!room) {
      socket.emit('wb:error', { message: 'Room not found' });
      return;
    }
    if (room.players.size >= room.maxPlayers) {
      socket.emit('wb:error', { message: 'Room is full' });
      return;
    }
    if (room.state !== 'lobby') {
      socket.emit('wb:error', { message: 'Game already in progress' });
      return;
    }

    // Leave any current room first
    this.leaveRoom(socket);

    const player = this._makePlayer(socket.id, username);
    room.players.set(socket.id, player);
    this.playerRooms.set(socket.id, code);
    socket.join(code);

    socket.emit('wb:joined', {
      roomId: code,
      playerId: socket.id,
      room: this._roomPublic(room),
    });

    socket.to(code).emit('wb:playerJoined', {
      player: { id: player.id, name: player.name, score: 0, turnsTaken: 0 },
      room: this._roomPublic(room),
    });

    console.log(`[WB] ${player.name} joined room ${code}`);
  }

  leaveRoom(socket) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    this.playerRooms.delete(socket.id);

    if (!room) return;

    room.players.delete(socket.id);
    socket.leave(roomId);

    if (room.players.size === 0) {
      this._clearTimer(room);
      this.rooms.delete(roomId);
      console.log(`[WB] Room ${roomId} deleted (empty)`);
      return;
    }

    // Transfer ownership if needed
    if (room.owner === socket.id) {
      room.owner = room.players.keys().next().value;
    }

    // If game is in progress and active player left, advance turn
    if (room.state === 'playing') {
      const activeId = room.playerOrder[room.activeIndex];
      if (activeId === socket.id) {
        // Remove from playerOrder too
        room.playerOrder = room.playerOrder.filter(id => id !== socket.id);
        if (room.playerOrder.length === 0) {
          this._endGame(room);
          return;
        }
        room.activeIndex = Math.max(0, room.activeIndex - 1);
        this._clearTimer(room);
        this._afterTurn(room);
      } else {
        room.playerOrder = room.playerOrder.filter(id => id !== socket.id);
      }
    }

    this.io.to(roomId).emit('wb:playerLeft', {
      playerId: socket.id,
      room: this._roomPublic(room),
    });

    console.log(`[WB] Player left room ${roomId}, remaining: ${room.players.size}`);
  }

  // ─── Game Flow ──────────────────────────────────────────────────────────────

  startGame(socket, roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      socket.emit('wb:error', { message: 'Room not found' });
      return;
    }
    if (room.owner !== socket.id) {
      socket.emit('wb:error', { message: 'Only the owner can start the game' });
      return;
    }
    if (room.state !== 'lobby') {
      socket.emit('wb:error', { message: 'Game already in progress' });
      return;
    }
    if (room.players.size < 2) {
      socket.emit('wb:error', { message: 'Need at least 2 players to start' });
      return;
    }

    // Reset scores
    for (const p of room.players.values()) {
      p.score = 0;
      p.turnsTaken = 0;
    }

    // Shuffle player order
    room.playerOrder = this._shuffle([...room.players.keys()]);
    room.activeIndex = -1;
    room.currentRound = 0;
    room.turnsThisRound = 0;
    room.usedWords = new Set();
    room.state = 'playing';

    this.io.to(roomId).emit('wb:started', { room: this._roomPublic(room) });
    console.log(`[WB] Game started in room ${roomId}`);

    this._nextTurn(room);
  }

  _nextTurn(room) {
    room.activeIndex = (room.activeIndex + 1) % room.playerOrder.length;
    room.turnsThisRound++;

    // Check if we completed a round
    if (room.turnsThisRound > room.playerOrder.length) {
      room.turnsThisRound = 1;
      room.currentRound++;
    } else if (room.currentRound === 0) {
      room.currentRound = 1;
    }

    const combo = pickCombo();
    room.currentCombo = combo;
    room.timeLeft = room.timePerTurn;
    room.state = 'playing';

    const activePlayerId = room.playerOrder[room.activeIndex];
    const activeName = room.players.get(activePlayerId)?.name || 'Unknown';

    this.io.to(room.id).emit('wb:turnStart', {
      activePlayerId,
      activePlayerName: activeName,
      combo,
      timeLeft: room.timeLeft,
      round: room.currentRound,
      totalRounds: room.totalRounds,
      scores: this._scores(room),
    });

    this._startTick(room);
  }

  _startTick(room) {
    this._clearTimer(room);
    room.timer = setInterval(() => this._tick(room), 1000);
  }

  _tick(room) {
    room.timeLeft--;
    this.io.to(room.id).emit('wb:tick', { timeLeft: room.timeLeft });

    if (room.timeLeft <= 0) {
      this._clearTimer(room);
      const activePlayerId = room.playerOrder[room.activeIndex];

      this.io.to(room.id).emit('wb:turnEnd', {
        playerId: activePlayerId,
        timedOut: true,
        scores: this._scores(room),
      });

      setTimeout(() => this._afterTurn(room), 2000);
    }
  }

  _clearTimer(room) {
    if (room.timer) {
      clearInterval(room.timer);
      room.timer = null;
    }
  }

  handleSubmitWord(socket, data) {
    const { roomId, word } = data;
    const room = this.rooms.get(roomId);

    if (!room || room.state !== 'playing') return;

    const activePlayerId = room.playerOrder[room.activeIndex];
    if (socket.id !== activePlayerId) {
      socket.emit('wb:error', { message: 'Not your turn' });
      return;
    }

    const result = isValidWord(word, room.currentCombo, room.usedWords);

    if (!result.ok) {
      socket.emit('wb:wordRejected', { reason: result.reason });
      return;
    }

    // Valid word — stop timer, score it
    this._clearTimer(room);
    const w = word.toLowerCase().trim();
    room.usedWords.add(w);

    const player = room.players.get(socket.id);
    const timeBonus   = Math.round(100 * room.timeLeft / room.timePerTurn);
    const lengthBonus = Math.max(0, w.length - 3) * 15;
    const points      = 100 + timeBonus + lengthBonus;

    player.score += points;
    player.turnsTaken++;

    this.io.to(room.id).emit('wb:wordAccepted', {
      playerId: socket.id,
      playerName: player.name,
      word: w,
      points,
      breakdown: { base: 100, timeBonus, lengthBonus },
      scores: this._scores(room),
    });

    setTimeout(() => this._afterTurn(room), 1500);
  }

  _afterTurn(room) {
    if (!room) return;

    // Increment turn counter for the active player
    const activePlayer = room.players.get(room.playerOrder[room.activeIndex]);
    if (activePlayer && activePlayer.turnsTaken === 0) {
      // player timed out, mark as having taken a turn
      activePlayer.turnsTaken++;
    }

    // Check if round is over (all players have gone)
    const roundOver = room.turnsThisRound >= room.playerOrder.length;

    if (roundOver) {
      this._endRound(room);
    } else {
      this._nextTurn(room);
    }
  }

  _endRound(room) {
    if (!room) return;

    const isLastRound = room.currentRound >= room.totalRounds;

    this.io.to(room.id).emit('wb:roundEnd', {
      round: room.currentRound,
      totalRounds: room.totalRounds,
      scores: this._scores(room),
      isLastRound,
    });

    // Reset per-round counters
    room.turnsThisRound = 0;
    for (const p of room.players.values()) {
      p.turnsTaken = 0;
    }

    if (isLastRound) {
      setTimeout(() => this._endGame(room), 3000);
    } else {
      setTimeout(() => {
        room.currentRound++;
        this._nextTurn(room);
      }, 3000);
    }
  }

  _endGame(room) {
    if (!room) return;

    this._clearTimer(room);
    room.state = 'game_end';

    const scores = this._scores(room);
    const winner = scores[0] || null;

    this.io.to(room.id).emit('wb:ended', {
      scores,
      winner: winner ? { id: winner.id, name: winner.name, score: winner.score } : null,
    });

    console.log(`[WB] Game ended in room ${room.id}. Winner: ${winner?.name}`);

    // Auto-reset to lobby after 15s
    setTimeout(() => {
      if (!room || !this.rooms.has(room.id)) return;
      room.state = 'lobby';
      room.currentRound = 0;
      room.activeIndex = -1;
      room.playerOrder = [];
      room.currentCombo = '';
      room.usedWords = new Set();
      room.turnsThisRound = 0;
      for (const p of room.players.values()) {
        p.score = 0;
        p.turnsTaken = 0;
      }
      this.io.to(room.id).emit('wb:reset', { room: this._roomPublic(room) });
    }, 15000);
  }

  // ─── Utilities ─────────────────────────────────────────────────────────────

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

module.exports = WordBombManager;
