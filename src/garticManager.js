// ── Gartic Phone Manager ──────────────────────────────────────────────────

const SETTINGS = {
  minPlayers: 3,
  maxPlayers: 8,
  writeTime: 30,
  drawTime: 60,
  guessTime: 30,
};

class GarticManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();       // roomId -> room
    this.playerRooms = new Map(); // socketId -> roomId
  }

  // ─── Open Room Listing ──────────────────────────────────────────────────

  getOpenRooms() {
    const result = [];
    for (const room of this.rooms.values()) {
      if (room.state === 'lobby' && room.players.size < SETTINGS.maxPlayers) {
        const owner = room.players.get(room.owner);
        result.push({
          id: room.id,
          ownerName: owner ? owner.name : 'Unknown',
          playerCount: room.players.size,
          maxPlayers: SETTINGS.maxPlayers,
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
    };
  }

  // ─── Public room snapshot ───────────────────────────────────────────────

  _roomPublic(room) {
    return {
      id: room.id,
      owner: room.owner,
      state: room.state,
      maxPlayers: SETTINGS.maxPlayers,
      players: this._playersPublic(room),
    };
  }

  _playersPublic(room) {
    return Array.from(room.players.values()).map(p => ({
      id: p.id,
      name: p.name,
    }));
  }

  // ─── Room Management ────────────────────────────────────────────────────

  createRoom(socket, opts = {}) {
    const { username = 'Player' } = opts;

    this.leaveRoom(socket);

    const roomId = this._generateRoomCode();
    const player = this._makePlayer(socket.id, username);

    const room = {
      id: roomId,
      owner: socket.id,
      players: new Map([[socket.id, player]]),
      state: 'lobby',
      // Game data (set on start)
      playerOrder: [],
      chains: [],
      currentStep: 0,
      totalSteps: 0,
      submissions: new Map(),
      // Timers
      phaseTimer: null,
      tickTimer: null,
      timeLeft: 0,
      // Reveal
      revealChainIdx: 0,
      revealStepIdx: 0,
    };

    this.rooms.set(roomId, room);
    this.playerRooms.set(socket.id, roomId);
    socket.join(roomId);

    socket.emit('gp:joined', {
      roomId,
      playerId: socket.id,
      room: this._roomPublic(room),
    });

    console.log(`[GP] Room created: ${roomId} by ${player.name}`);
  }

  joinRoom(socket, opts = {}) {
    const { username = 'Player', roomId } = opts;

    if (!roomId) {
      socket.emit('gp:error', { message: 'Room code required' });
      return;
    }

    const code = roomId.toUpperCase().trim();
    const room = this.rooms.get(code);

    if (!room) {
      socket.emit('gp:error', { message: 'Room not found' });
      return;
    }
    if (room.players.size >= SETTINGS.maxPlayers) {
      socket.emit('gp:error', { message: 'Room is full' });
      return;
    }
    if (room.state !== 'lobby') {
      socket.emit('gp:error', { message: 'Game already in progress' });
      return;
    }

    this.leaveRoom(socket);

    const player = this._makePlayer(socket.id, username);
    room.players.set(socket.id, player);
    this.playerRooms.set(socket.id, code);
    socket.join(code);

    socket.emit('gp:joined', {
      roomId: code,
      playerId: socket.id,
      room: this._roomPublic(room),
    });

    socket.to(code).emit('gp:playerJoined', {
      player: { id: player.id, name: player.name },
      room: this._roomPublic(room),
    });

    console.log(`[GP] ${player.name} joined room ${code}`);
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
      this._clearTimers(room);
      this.rooms.delete(roomId);
      console.log(`[GP] Room ${roomId} deleted (empty)`);
      return;
    }

    // Transfer ownership if needed
    if (room.owner === socket.id) {
      room.owner = room.players.keys().next().value;
    }

    // If game is in progress, auto-fill this player's pending submissions
    if (room.state !== 'lobby' && room.state !== 'game_end') {
      this._autoFillForPlayer(room, socket.id);
    }

    this.io.to(roomId).emit('gp:playerLeft', {
      playerId: socket.id,
      room: this._roomPublic(room),
    });

    console.log(`[GP] Player left room ${roomId}, remaining: ${room.players.size}`);
  }

  // ─── Game Flow ──────────────────────────────────────────────────────────

  startGame(socket, roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      socket.emit('gp:error', { message: 'Room not found' });
      return;
    }
    if (room.owner !== socket.id) {
      socket.emit('gp:error', { message: 'Only the host can start the game' });
      return;
    }
    if (room.state !== 'lobby') {
      socket.emit('gp:error', { message: 'Game already in progress' });
      return;
    }
    if (room.players.size < SETTINGS.minPlayers) {
      socket.emit('gp:error', { message: `Need at least ${SETTINGS.minPlayers} players to start` });
      return;
    }

    // Shuffle player order
    room.playerOrder = shuffle(Array.from(room.players.keys()));
    const n = room.playerOrder.length;
    room.totalSteps = n; // Each chain gets N contributions
    room.currentStep = 0;

    // Initialize empty chains — one per player
    room.chains = room.playerOrder.map(pid => {
      const p = room.players.get(pid);
      return {
        originId: pid,
        originName: p ? p.name : 'Player',
        steps: [],
      };
    });

    room.submissions = new Map();

    this.io.to(roomId).emit('gp:started', { room: this._roomPublic(room) });
    console.log(`[GP] Game started in room ${roomId} with ${n} players`);

    this._startWritePhase(room);
  }

  // ─── Write Phase ────────────────────────────────────────────────────────

  _startWritePhase(room) {
    room.state = 'writing';
    room.currentStep = 0;
    room.submissions = new Map();

    this.io.to(room.id).emit('gp:writePhase', {
      timeLeft: SETTINGS.writeTime,
    });

    this._startTick(room, SETTINGS.writeTime, () => {
      this._autoFillMissing(room, 'text', '(no response)');
      this._advanceStep(room);
    });
  }

  // ─── Draw Phase ─────────────────────────────────────────────────────────

  _startDrawPhase(room) {
    room.state = 'drawing';
    room.submissions = new Map();
    const n = room.playerOrder.length;

    // Each player draws the prompt from the chain they're assigned to
    for (const pid of room.playerOrder) {
      const chainIdx = this._getChainIndexForPlayer(room, pid);
      const chain = room.chains[chainIdx];
      const lastStep = chain.steps[chain.steps.length - 1];
      const prompt = lastStep ? lastStep.content : '(no prompt)';

      const sock = this.io.sockets.sockets.get(pid);
      if (sock) {
        sock.emit('gp:drawPhase', {
          prompt,
          timeLeft: SETTINGS.drawTime,
        });
      }
    }

    this._startTick(room, SETTINGS.drawTime, () => {
      this._autoFillMissing(room, 'drawing', '');
      this._advanceStep(room);
    });
  }

  // ─── Guess Phase ────────────────────────────────────────────────────────

  _startGuessPhase(room) {
    room.state = 'guessing';
    room.submissions = new Map();
    const n = room.playerOrder.length;

    // Each player guesses what another player's drawing shows
    for (const pid of room.playerOrder) {
      const chainIdx = this._getChainIndexForPlayer(room, pid);
      const chain = room.chains[chainIdx];
      const lastStep = chain.steps[chain.steps.length - 1];
      const drawing = lastStep ? lastStep.content : '';

      const sock = this.io.sockets.sockets.get(pid);
      if (sock) {
        sock.emit('gp:guessPhase', {
          drawing,
          timeLeft: SETTINGS.guessTime,
        });
      }
    }

    this._startTick(room, SETTINGS.guessTime, () => {
      this._autoFillMissing(room, 'text', '(no guess)');
      this._advanceStep(room);
    });
  }

  // ─── Chain Rotation ─────────────────────────────────────────────────────

  // For step k, player at playerOrder index j works on chain (j - k) mod N
  // This ensures every player touches every chain exactly once.
  _getChainIndexForPlayer(room, playerId) {
    const n = room.playerOrder.length;
    const playerIdx = room.playerOrder.indexOf(playerId);
    // chain index = (playerIdx - currentStep) mod N
    return ((playerIdx - room.currentStep) % n + n) % n;
  }

  // ─── Advance Step ───────────────────────────────────────────────────────

  _advanceStep(room) {
    this._clearTimers(room);

    const n = room.playerOrder.length;
    const isDrawStep = room.state === 'drawing';
    const stepType = isDrawStep ? 'drawing' : 'text';

    // Record submissions into chains
    for (const pid of room.playerOrder) {
      const chainIdx = this._getChainIndexForPlayer(room, pid);
      const chain = room.chains[chainIdx];
      const content = room.submissions.get(pid) || (stepType === 'drawing' ? '' : '(no response)');
      const player = room.players.get(pid);

      chain.steps.push({
        type: stepType,
        content,
        playerId: pid,
        playerName: player ? player.name : 'Player',
      });
    }

    room.currentStep++;

    // Check if all chains are complete
    if (room.currentStep >= room.totalSteps) {
      this._startReveal(room);
      return;
    }

    // Alternate: odd steps are drawing, even steps are guessing
    // Step 0 = writing (already done), step 1 = drawing, step 2 = guessing, etc.
    if (room.currentStep % 2 === 1) {
      this._startDrawPhase(room);
    } else {
      this._startGuessPhase(room);
    }
  }

  // ─── Handle Submissions ─────────────────────────────────────────────────

  handleSubmitText(socket, data) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (room.state !== 'writing' && room.state !== 'guessing') return;
    if (room.submissions.has(socket.id)) return;

    const text = (data.text || '').slice(0, 200).trim() || (room.state === 'writing' ? '(no response)' : '(no guess)');
    room.submissions.set(socket.id, text);

    this._emitProgress(room);

    // All submitted? Advance early
    if (room.submissions.size >= room.playerOrder.length) {
      this._advanceStep(room);
    }
  }

  handleSubmitDrawing(socket, data) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room || room.state !== 'drawing') return;
    if (room.submissions.has(socket.id)) return;

    const drawing = data.drawing || '';
    room.submissions.set(socket.id, drawing);

    this._emitProgress(room);

    if (room.submissions.size >= room.playerOrder.length) {
      this._advanceStep(room);
    }
  }

  _emitProgress(room) {
    this.io.to(room.id).emit('gp:progress', {
      submitted: room.submissions.size,
      total: room.playerOrder.length,
    });
  }

  // ─── Reveal ─────────────────────────────────────────────────────────────

  _startReveal(room) {
    this._clearTimers(room);
    room.state = 'reveal';
    room.revealChainIdx = 0;
    room.revealStepIdx = -1; // Will start at 0 on first advance

    // Send the first chain
    this._sendRevealChain(room);
  }

  _sendRevealChain(room) {
    const chain = room.chains[room.revealChainIdx];
    if (!chain) return;

    this.io.to(room.id).emit('gp:revealChain', {
      chainIndex: room.revealChainIdx,
      totalChains: room.chains.length,
      originName: chain.originName,
      steps: chain.steps,
    });
  }

  handleRevealNext(socket, roomId) {
    const room = this.rooms.get(roomId);
    if (!room || room.state !== 'reveal') return;
    if (room.owner !== socket.id) return;

    room.revealChainIdx++;

    if (room.revealChainIdx >= room.chains.length) {
      this._endGame(room);
      return;
    }

    this._sendRevealChain(room);
  }

  // ─── Game End ───────────────────────────────────────────────────────────

  _endGame(room) {
    this._clearTimers(room);
    room.state = 'game_end';

    this.io.to(room.id).emit('gp:gameOver', {
      players: this._playersPublic(room),
    });

    console.log(`[GP] Game ended in room ${room.id}`);
  }

  _doReset(room) {
    this._clearTimers(room);
    room.state = 'lobby';
    room.playerOrder = [];
    room.chains = [];
    room.currentStep = 0;
    room.totalSteps = 0;
    room.submissions = new Map();
    room.revealChainIdx = 0;
    room.revealStepIdx = -1;

    this.io.to(room.id).emit('gp:reset', { room: this._roomPublic(room) });
  }

  resetRoom(socket, roomId) {
    const room = this.rooms.get(roomId);
    if (!room) { socket.emit('gp:error', { message: 'Room not found' }); return; }
    if (room.owner !== socket.id) { socket.emit('gp:error', { message: 'Only the host can reset' }); return; }
    this._doReset(room);
  }

  // ─── Auto-fill helpers ──────────────────────────────────────────────────

  _autoFillMissing(room, type, fallback) {
    for (const pid of room.playerOrder) {
      if (!room.submissions.has(pid)) {
        room.submissions.set(pid, fallback);
      }
    }
  }

  _autoFillForPlayer(room, playerId) {
    if (!room.submissions.has(playerId) && room.playerOrder.includes(playerId)) {
      const fallback = room.state === 'drawing' ? '' : '(disconnected)';
      room.submissions.set(playerId, fallback);

      // Check if all submitted now
      if (room.submissions.size >= room.playerOrder.length) {
        this._advanceStep(room);
      }
    }
  }

  // ─── Timers ─────────────────────────────────────────────────────────────

  _startTick(room, duration, onExpire) {
    this._clearTimers(room);
    room.timeLeft = duration;

    room.tickTimer = setInterval(() => {
      room.timeLeft--;
      this.io.to(room.id).emit('gp:tick', { timeLeft: room.timeLeft });

      if (room.timeLeft <= 0) {
        this._clearTimers(room);
        onExpire();
      }
    }, 1000);
  }

  _clearTimers(room) {
    if (room.tickTimer) { clearInterval(room.tickTimer); room.tickTimer = null; }
    if (room.phaseTimer) { clearTimeout(room.phaseTimer); room.phaseTimer = null; }
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = GarticManager;
