'use strict';
const { pickSecretWord, isValidGuess } = require('./wordleWords');

// ── Wordle evaluation ────────────────────────────────────────────────────────

function evaluateGuess(guess, secret) {
  const result = Array(6).fill('absent');
  const sec    = secret.split('');
  const gue    = guess.split('');

  // Pass 1: exact matches (green)
  for (let i = 0; i < 6; i++) {
    if (gue[i] === sec[i]) {
      result[i] = 'correct';
      sec[i] = gue[i] = null;
    }
  }

  // Pass 2: present-but-wrong-position (yellow)
  for (let i = 0; i < 6; i++) {
    if (!gue[i]) continue;
    const j = sec.indexOf(gue[i]);
    if (j !== -1) {
      result[i] = 'present';
      sec[j] = null;
    }
  }

  return result; // array of 'correct' | 'present' | 'absent'
}

function tileScore(tiles) {
  return tiles.filter(t => t === 'correct').length * 10
       + tiles.filter(t => t === 'present').length;
}

// ── Manager ──────────────────────────────────────────────────────────────────

class WordleManager {
  constructor(io) {
    this.io          = io;
    this.rooms       = new Map(); // roomId → room
    this.playerRooms = new Map(); // socketId → roomId
  }

  // ── Open Room Listing ──────────────────────────────────────────────────────

  getOpenRooms() {
    const result = [];
    for (const room of this.rooms.values()) {
      if (room.state === 'lobby' && room.players.size < 12) {
        const owner = room.players.get(room.owner);
        result.push({
          id: room.id,
          ownerName: owner ? owner.name : 'Unknown',
          playerCount: room.players.size,
          maxPlayers: 12,
        });
      }
    }
    return result;
  }

  // ── Room code ──────────────────────────────────────────────────────────────

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

  // ── Snapshot helpers ───────────────────────────────────────────────────────

  _playersPublic(room) {
    return Array.from(room.players.values()).map(p => ({
      id:    p.id,
      name:  p.name,
      score: p.score,
    }));
  }

  _roomPublic(room) {
    return {
      id:           room.id,
      owner:        room.owner,
      state:        room.state,
      maxGuesses:   room.maxGuesses,
      timePerRound: room.timePerRound,
      currentGuess: room.currentGuess,
      guessHistory: room.guessHistory,
      timeLeft:     room.timeLeft,
      players:      this._playersPublic(room),
    };
  }

  _scores(room) {
    return Array.from(room.players.values())
      .map(p => ({ id: p.id, name: p.name, score: p.score }))
      .sort((a, b) => b.score - a.score);
  }

  // ── Room management ────────────────────────────────────────────────────────

  createRoom(socket, opts = {}) {
    const {
      username     = 'Player',
      timePerRound = 60,
    } = opts;

    this.leaveRoom(socket);

    const roomId = this._generateRoomCode();
    const player = { id: socket.id, name: username.slice(0, 20).trim() || 'Player', score: 0 };

    const room = {
      id:              roomId,
      owner:           socket.id,
      players:         new Map([[socket.id, player]]),
      state:           'lobby',
      secretWord:      '',
      maxGuesses:      6,
      timePerRound:    Math.max(30, Math.min(timePerRound, 120)),
      currentGuess:    0,
      guessHistory:    [],       // [{ word, tiles, playerId, playerName, points }]
      submissions:     new Map(),// socketId → { word, submittedAt }
      timer:           null,
      timeLeft:        0,
      autoResetTimer:  null,
    };

    this.rooms.set(roomId, room);
    this.playerRooms.set(socket.id, roomId);
    socket.join(roomId);

    socket.emit('fw:joined', {
      roomId,
      playerId: socket.id,
      room: this._roomPublic(room),
    });

    console.log(`[wordle] Room created: ${roomId} by ${player.name}`);
  }

  joinRoom(socket, opts = {}) {
    const { username = 'Player', roomId } = opts;

    if (!roomId) {
      socket.emit('fw:error', { message: 'Room code required' });
      return;
    }

    const code = roomId.toUpperCase().trim();
    const room  = this.rooms.get(code);

    if (!room) {
      socket.emit('fw:error', { message: 'Room not found' });
      return;
    }
    if (room.state !== 'lobby') {
      socket.emit('fw:error', { message: 'Game already in progress' });
      return;
    }
    if (room.players.size >= 12) {
      socket.emit('fw:error', { message: 'Room is full' });
      return;
    }

    this.leaveRoom(socket);

    const player = { id: socket.id, name: username.slice(0, 20).trim() || 'Player', score: 0 };
    room.players.set(socket.id, player);
    this.playerRooms.set(socket.id, code);
    socket.join(code);

    socket.emit('fw:joined', {
      roomId: code,
      playerId: socket.id,
      room: this._roomPublic(room),
    });

    socket.to(code).emit('fw:playerJoined', {
      player: { id: player.id, name: player.name, score: 0 },
      room:   this._roomPublic(room),
    });

    console.log(`[wordle] ${player.name} joined room ${code}`);
  }

  leaveRoom(socket) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    this.playerRooms.delete(socket.id);

    if (!room) return;

    room.players.delete(socket.id);
    room.submissions.delete(socket.id);
    socket.leave(roomId);

    if (room.players.size === 0) {
      this._clearTimer(room);
      this.rooms.delete(roomId);
      console.log(`[wordle] Room ${roomId} deleted (empty)`);
      return;
    }

    if (room.owner === socket.id) {
      room.owner = room.players.keys().next().value;
    }

    // If game is running and all remaining players have now submitted, resolve early
    if (room.state === 'submitting' && room.players.size > 0) {
      const submitted = [...room.players.keys()].every(id => room.submissions.has(id));
      if (submitted) {
        this._clearTimer(room);
        this._resolveRound(room);
        return;
      }
    }

    this.io.to(roomId).emit('fw:playerLeft', {
      playerId: socket.id,
      room: this._roomPublic(room),
    });

    console.log(`[wordle] Player left room ${roomId}, remaining: ${room.players.size}`);
  }

  // ── Game flow ──────────────────────────────────────────────────────────────

  startGame(socket, roomId) {
    const room = this.rooms.get(roomId);

    if (!room) {
      socket.emit('fw:error', { message: 'Room not found' });
      return;
    }
    if (room.owner !== socket.id) {
      socket.emit('fw:error', { message: 'Only the owner can start the game' });
      return;
    }
    if (room.state !== 'lobby') {
      socket.emit('fw:error', { message: 'Game already in progress' });
      return;
    }
    if (room.players.size < 2) {
      socket.emit('fw:error', { message: 'Need at least 2 players to start' });
      return;
    }

    // Reset state
    for (const p of room.players.values()) p.score = 0;
    room.secretWord   = pickSecretWord();
    room.currentGuess = 0;
    room.guessHistory = [];

    this.io.to(roomId).emit('fw:started', { room: this._roomPublic(room) });
    console.log(`[wordle] Game started in room ${roomId} (word: ${room.secretWord})`);

    this._startRound(room);
  }

  _startRound(room) {
    room.state       = 'submitting';
    room.submissions = new Map();
    room.timeLeft    = room.timePerRound;

    this.io.to(room.id).emit('fw:roundStart', {
      guessNumber:  room.currentGuess + 1,
      maxGuesses:   room.maxGuesses,
      timeLeft:     room.timeLeft,
      guessHistory: room.guessHistory,
      scores:       this._scores(room),
    });

    this._startTick(room);
  }

  _startTick(room) {
    this._clearTimer(room);
    room.timer = setInterval(() => this._tick(room), 1000);
  }

  _tick(room) {
    room.timeLeft--;
    this.io.to(room.id).emit('fw:tick', { timeLeft: room.timeLeft });

    if (room.timeLeft <= 0) {
      this._clearTimer(room);
      this._resolveRound(room);
    }
  }

  _clearTimer(room) {
    if (room.timer) {
      clearInterval(room.timer);
      room.timer = null;
    }
  }

  handleSubmitGuess(socket, data) {
    const { roomId, word } = data;
    const room = this.rooms.get(roomId);

    if (!room || room.state !== 'submitting') {
      socket.emit('fw:error', { message: 'Not accepting guesses right now' });
      return;
    }
    if (!room.players.has(socket.id)) {
      socket.emit('fw:error', { message: 'You are not in this room' });
      return;
    }
    if (room.submissions.has(socket.id)) {
      socket.emit('fw:error', { message: 'Already submitted for this round' });
      return;
    }

    const w = (word || '').toLowerCase().trim();

    if (w.length !== 6) {
      socket.emit('fw:error', { message: 'Must be 6 letters' });
      return;
    }
    if (!/^[a-z]{6}$/.test(w)) {
      socket.emit('fw:error', { message: 'Letters only' });
      return;
    }
    if (!isValidGuess(w)) {
      socket.emit('fw:error', { message: 'Not a valid word' });
      return;
    }

    room.submissions.set(socket.id, { word: w, submittedAt: Date.now() });

    const player = room.players.get(socket.id);
    this.io.to(room.id).emit('fw:playerSubmitted', {
      playerId:   socket.id,
      playerName: player.name,
    });

    // Resolve immediately if everyone has submitted
    const allSubmitted = [...room.players.keys()].every(id => room.submissions.has(id));
    if (allSubmitted) {
      this._clearTimer(room);
      this._resolveRound(room);
    }
  }

  _resolveRound(room) {
    // Guard: only resolve once per round
    if (room.state !== 'submitting') return;
    room.state = 'revealing';

    console.log(`[wordle] Resolving round ${room.currentGuess + 1} in ${room.id} — ${room.submissions.size} submission(s)`);

    if (room.submissions.size === 0) {
      // Nobody submitted — skip round
      room.guessHistory.push({ word: null, tiles: null, playerId: null, playerName: null, points: 0 });
      room.currentGuess++;

      this.io.to(room.id).emit('fw:roundEnd', {
        guessNumber:    room.currentGuess,
        bestWord:       null,
        tiles:          null,
        playerId:       null,
        playerName:     null,
        allSubmissions: [],
        pointsAwarded:  0,
        scores:         this._scores(room),
        won:            false,
      });

      this._nextOrEnd(room, false);
      return;
    }

    // Score ALL submissions — points based on correctness, time bonus for speed
    const scored = [];
    const earliest = Math.min(...[...room.submissions.values()].map(s => s.submittedAt));
    const latest   = Math.max(...[...room.submissions.values()].map(s => s.submittedAt));
    const timeSpan = latest - earliest || 1; // avoid div-by-zero

    let best = null;
    let bestTileScore = -1;

    for (const [socketId, sub] of room.submissions) {
      const tiles  = evaluateGuess(sub.word, room.secretWord);
      const greens  = tiles.filter(t => t === 'correct').length;
      const yellows = tiles.filter(t => t === 'present').length;
      const won     = greens === 6;
      const ts      = tileScore(tiles);

      // Base points from correctness
      let pts = 50 + greens * 30 + yellows * 10;
      // Time bonus: faster submitters get more (up to 20 extra)
      const speedRatio = 1 - (sub.submittedAt - earliest) / timeSpan;
      pts += Math.round(20 * speedRatio);
      if (won) pts += 500;

      if (room.players.has(socketId)) {
        room.players.get(socketId).score += pts;
      }

      scored.push({ socketId, sub, tiles, ts, pts, greens, yellows, won });

      // Track the best word for the shared guess history row
      if (ts > bestTileScore || (ts === bestTileScore && sub.submittedAt < best.sub.submittedAt)) {
        best = { socketId, sub, tiles, ts, pts, greens, yellows, won };
        bestTileScore = ts;
      }
    }

    const bestPlayer = room.players.get(best.socketId) || { name: 'Unknown', score: 0 };
    const won = best.won;

    // All submissions summary — every player gets their own points
    const allSubmissions = scored.map(s => {
      const p = room.players.get(s.socketId) || { name: 'Unknown' };
      return { playerId: s.socketId, playerName: p.name, word: s.sub.word, tiles: s.tiles, points: s.pts };
    });

    room.guessHistory.push({
      word:       best.sub.word,
      tiles:      best.tiles,
      playerId:   best.socketId,
      playerName: bestPlayer.name,
      points:     best.pts,
    });

    room.currentGuess++;

    this.io.to(room.id).emit('fw:roundEnd', {
      guessNumber:    room.currentGuess,
      bestWord:       best.sub.word,
      tiles:          best.tiles,
      playerId:       best.socketId,
      playerName:     bestPlayer.name,
      allSubmissions,
      pointsAwarded:  best.pts,
      scores:         this._scores(room),
      won,
    });

    this._nextOrEnd(room, won);
  }

  _nextOrEnd(room, won) {
    if (won) {
      setTimeout(() => this._endGame(room, true), 2000);
    } else if (room.currentGuess >= room.maxGuesses) {
      setTimeout(() => this._endGame(room, false), 3000);
    } else {
      setTimeout(() => this._startRound(room), 3000);
    }
  }

  _endGame(room, won) {
    this._clearTimer(room);
    room.state = 'game_over';

    const scores = this._scores(room);
    const winner = scores[0] || null;

    this.io.to(room.id).emit('fw:gameOver', {
      won,
      secretWord: room.secretWord,
      scores,
      winner: winner ? { id: winner.id, name: winner.name, score: winner.score } : null,
    });

    console.log(`[wordle] Game over in ${room.id}. Won: ${won}, word: ${room.secretWord}`);

    // Auto-reset to lobby after 15s
    room.autoResetTimer = setTimeout(() => {
      if (!this.rooms.has(room.id)) return;
      this._doReset(room);
    }, 15000);
  }

  _doReset(room) {
    if (room.autoResetTimer) { clearTimeout(room.autoResetTimer); room.autoResetTimer = null; }
    room.state        = 'lobby';
    room.secretWord   = '';
    room.currentGuess = 0;
    room.guessHistory = [];
    room.submissions  = new Map();
    for (const p of room.players.values()) p.score = 0;
    this.io.to(room.id).emit('fw:reset', { room: this._roomPublic(room) });
  }

  resetRoom(socket, roomId) {
    const room = this.rooms.get(roomId);
    if (!room) { socket.emit('fw:error', { message: 'Room not found' }); return; }
    if (room.owner !== socket.id) { socket.emit('fw:error', { message: 'Only the host can reset' }); return; }
    this._doReset(room);
  }
}

module.exports = WordleManager;
