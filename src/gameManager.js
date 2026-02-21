const { pickWords, CATEGORIES, getHintMask, getRevealableIndices } = require('./wordList');

const ALL_CATEGORY_NAMES = ['Mixed', ...Object.keys(CATEGORIES)];

class GameManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();       // roomId -> room
    this.playerRooms = new Map(); // socketId -> roomId
    this.disconnectTimers = new Map(); // socketId -> { timer, roomId, playerData }
  }

  // ─── Room Code ────────────────────────────────────────────────────────────

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
      code = Array.from({ length: 6 }, () =>
        chars[Math.floor(Math.random() * chars.length)]
      ).join('');
    } while (this.rooms.has(code));
    return code;
  }

  // ─── Room Management ─────────────────────────────────────────────────────

  createRoom(socket, opts = {}) {
    const {
      username = 'Player',
      maxPlayers = 8,
      rounds = 3,
      drawTime = 80,
      customWords = [],
      customOnly = false,
    } = opts;

    const roomId = this.generateRoomCode();
    const player = this._makePlayer(socket.id, username);

    const sanitizedCustom = customWords
      .map(w => String(w).trim().toLowerCase())
      .filter(w => w.length >= 2 && w.length <= 50)
      .slice(0, 100);

    const room = {
      id: roomId,
      owner: socket.id,
      players: new Map([[socket.id, player]]),
      state: 'lobby',
      currentRound: 0,
      totalRounds: Math.max(1, Math.min(rounds, 10)),
      drawTime: Math.max(30, Math.min(drawTime, 180)),
      maxPlayers: Math.max(2, Math.min(maxPlayers, 20)),
      customWords: sanitizedCustom,
      customOnly,
      currentWord: null,
      wordDisplay: '',
      currentDrawer: null,
      drawerOrder: [],
      drawerIndex: -1,
      correctGuessers: [],
      timer: null,
      timeLeft: 0,
      hintRevealed: [],
      pendingWordChoices: null,
      // Pre-game category voting
      categoryVotes: {},    // { categoryName: count }
      playerVotes: {},      // { socketId: categoryName }
      selectedCategory: null,
    };

    this.rooms.set(roomId, room);
    this.playerRooms.set(socket.id, roomId);
    socket.join(roomId);

    socket.emit('room:joined', {
      roomId,
      playerId: socket.id,
      room: this._roomPublic(room),
      categoryVotes: room.categoryVotes,
      myVoteCategory: null,
    });

    console.log(`Room ${roomId} created by ${player.name}`);
    return roomId;
  }

  joinRoom(socket, { roomId = '', username = 'Player' } = {}) {
    const code = roomId.trim().toUpperCase();
    const room = this.rooms.get(code);

    if (!room) {
      socket.emit('room:error', { message: 'Room not found. Check the code and try again.' });
      return;
    }
    if (room.players.size >= room.maxPlayers) {
      socket.emit('room:error', { message: 'Room is full.' });
      return;
    }
    if (room.players.has(socket.id)) {
      socket.emit('room:error', { message: 'Already in this room.' });
      return;
    }

    // Cancel pending disconnect timer for the same player (reconnecting)
    for (const [oldSocketId, pending] of this.disconnectTimers) {
      if (pending.roomId === code && pending.playerName === username) {
        clearTimeout(pending.timer);
        this.disconnectTimers.delete(oldSocketId);
        // Clean up the old player entry
        room.players.delete(oldSocketId);
        this.playerRooms.delete(oldSocketId);
        console.log(`${username} reconnected to room ${code}, cancelled disconnect timer`);
        break;
      }
    }

    const player = this._makePlayer(socket.id, username);
    room.players.set(socket.id, player);
    this.playerRooms.set(socket.id, code);
    socket.join(code);

    const midGame = room.state !== 'lobby' && room.state !== 'game_end';

    socket.emit('room:joined', {
      roomId: code,
      playerId: socket.id,
      room: this._roomPublic(room),
      categoryVotes: room.categoryVotes,
      myVoteCategory: room.playerVotes[socket.id] || null,
      midGame: midGame ? {
        currentDrawer: room.currentDrawer,
        drawerName: room.players.get(room.currentDrawer)?.name || 'Unknown',
        wordDisplay: room.wordDisplay || '',
        wordLength: room.currentWord ? room.currentWord.length : 0,
        timeLeft: room.timeLeft,
      } : null,
    });

    socket.to(code).emit('room:playerJoined', {
      player: this._playerPublic(player),
      room: this._roomPublic(room),
    });

    console.log(`${player.name} joined room ${code}`);
  }

  // Called when a socket disconnects — uses a grace period during active games
  handleDisconnect(socket) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (!room) {
      this.playerRooms.delete(socket.id);
      return;
    }

    const inGame = room.state !== 'lobby' && room.state !== 'game_end';
    if (inGame) {
      const player = room.players.get(socket.id);
      console.log(`${player?.name} disconnected from room ${roomId}, waiting 15s for reconnect`);
      this.disconnectTimers.set(socket.id, {
        timer: setTimeout(() => {
          this.disconnectTimers.delete(socket.id);
          this._removePlayer(socket, roomId);
        }, 15000),
        roomId,
        playerName: player?.name,
      });
      return;
    }

    this._removePlayer(socket, roomId);
  }

  // Called when a player intentionally leaves (room:leave button)
  leaveRoom(socket) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;

    // Cancel any pending disconnect timer
    this._cancelDisconnectTimer(socket.id);

    this._removePlayer(socket, roomId);
  }

  _cancelDisconnectTimer(socketId) {
    const pending = this.disconnectTimers.get(socketId);
    if (pending) {
      clearTimeout(pending.timer);
      this.disconnectTimers.delete(socketId);
    }
  }

  _removePlayer(socket, roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      this.playerRooms.delete(socket.id);
      return;
    }

    const wasOwner = room.owner === socket.id;
    const wasDrawer = room.currentDrawer === socket.id;
    const leavingPlayer = room.players.get(socket.id);

    // Remove this player's category vote
    const prevVote = room.playerVotes[socket.id];
    if (prevVote && room.categoryVotes[prevVote]) {
      room.categoryVotes[prevVote] = Math.max(0, room.categoryVotes[prevVote] - 1);
      if (room.categoryVotes[prevVote] === 0) delete room.categoryVotes[prevVote];
    }
    delete room.playerVotes[socket.id];

    room.players.delete(socket.id);
    this.playerRooms.delete(socket.id);
    socket.leave(roomId);

    if (room.players.size === 0) {
      this._clearTimer(room);
      this.rooms.delete(roomId);
      console.log(`Room ${roomId} deleted (empty)`);
      return;
    }

    // Transfer ownership
    if (wasOwner) {
      room.owner = room.players.keys().next().value;
    }

    this.io.to(roomId).emit('room:playerLeft', {
      playerId: socket.id,
      playerName: leavingPlayer?.name,
      newOwner: wasOwner ? room.owner : null,
      room: this._roomPublic(room),
    });

    // Broadcast updated vote counts after player leaves
    if (prevVote) {
      this.io.to(roomId).emit('room:categoryVoteUpdate', {
        categoryVotes: room.categoryVotes,
        playerVotes: room.playerVotes,
      });
    }

    // If drawer left mid-game, end the turn
    if (wasDrawer && (room.state === 'drawing' || room.state === 'choosing')) {
      this._clearTimer(room);
      if (room.players.size < 2) {
        this._endGame(room);
      } else {
        this._endTurn(room);
      }
    }

    console.log(`${leavingPlayer?.name} left room ${roomId}`);
  }

  // ─── Category Voting (pre-game, in waiting room) ──────────────────────────

  handlePreGameCategoryVote(socket, { roomId, categoryName } = {}) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (room.state !== 'lobby') return;
    if (!ALL_CATEGORY_NAMES.includes(categoryName)) return;

    // Remove previous vote
    const prevVote = room.playerVotes[socket.id];
    if (prevVote) {
      room.categoryVotes[prevVote] = Math.max(0, (room.categoryVotes[prevVote] || 0) - 1);
      if (room.categoryVotes[prevVote] === 0) delete room.categoryVotes[prevVote];
    }

    // Toggle off if same category clicked again
    if (prevVote === categoryName) {
      delete room.playerVotes[socket.id];
    } else {
      room.playerVotes[socket.id] = categoryName;
      room.categoryVotes[categoryName] = (room.categoryVotes[categoryName] || 0) + 1;
    }

    this.io.to(roomId).emit('room:categoryVoteUpdate', {
      categoryVotes: room.categoryVotes,
      playerVotes: room.playerVotes,
    });
  }

  _getWinningCategory(room) {
    const votes = room.categoryVotes;
    if (!votes || Object.keys(votes).length === 0) return 'Mixed';

    let maxVotes = 0;
    let winners = [];
    for (const [cat, count] of Object.entries(votes)) {
      if (count > maxVotes) {
        maxVotes = count;
        winners = [cat];
      } else if (count === maxVotes) {
        winners.push(cat);
      }
    }

    return winners[Math.floor(Math.random() * winners.length)];
  }

  // ─── Game Flow ────────────────────────────────────────────────────────────

  startGame(socket, roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (room.owner !== socket.id) {
      socket.emit('room:error', { message: 'Only the room owner can start the game.' });
      return;
    }
    if (room.state !== 'lobby' && room.state !== 'game_end') {
      socket.emit('room:error', { message: 'Game already running.' });
      return;
    }
    if (room.players.size < 2) {
      socket.emit('room:error', { message: 'Need at least 2 players to start.' });
      return;
    }

    this._clearTimer(room);

    // Determine winning category from pre-game votes
    room.selectedCategory = this._getWinningCategory(room);

    // Reset all player scores
    for (const player of room.players.values()) {
      player.score = 0;
      player.roundScore = 0;
      player.hasGuessed = false;
    }

    room.currentRound = 1;
    room.drawerOrder = [...room.players.keys()];
    room.drawerIndex = -1;

    this.io.to(roomId).emit('game:started', {
      room: this._roomPublic(room),
      selectedCategory: room.selectedCategory,
    });

    this._startNextTurn(room);
  }

  _startNextTurn(room) {
    room.drawerIndex++;

    // Skip players who disconnected
    while (
      room.drawerIndex < room.drawerOrder.length &&
      !room.players.has(room.drawerOrder[room.drawerIndex])
    ) {
      room.drawerIndex++;
    }

    // End of round
    if (room.drawerIndex >= room.drawerOrder.length) {
      this._endRound(room);
      return;
    }

    room.currentDrawer = room.drawerOrder[room.drawerIndex];
    room.correctGuessers = [];
    room.hintRevealed = [];
    room.currentWord = null;
    room.pendingWordChoices = null;
    room.state = 'choosing';

    // Reset guessed status
    for (const player of room.players.values()) {
      player.hasGuessed = false;
    }

    const wordChoices = pickWords(3, room.customWords, room.customOnly, room.selectedCategory);
    room.pendingWordChoices = wordChoices;

    // Notify all: choosing phase
    this.io.to(room.id).emit('game:turnStart', {
      drawer: room.currentDrawer,
      drawerName: room.players.get(room.currentDrawer)?.name || 'Unknown',
      round: room.currentRound,
      totalRounds: room.totalRounds,
      state: 'choosing',
      scores: this._getScores(room),
    });

    // Send word choices only to drawer
    const drawerSocket = this.io.sockets.sockets.get(room.currentDrawer);
    if (drawerSocket) {
      drawerSocket.emit('game:wordChoices', {
        words: wordChoices,
        timeLimit: 15,
      });
    }

    // Auto-pick word after 15s
    this._clearTimer(room);
    room.timer = setTimeout(() => {
      if (room.state === 'choosing' && room.currentDrawer) {
        const word = wordChoices[Math.floor(Math.random() * wordChoices.length)];
        this._startDrawing(room, word);
      }
    }, 15000);
  }

  handleWordChoice(socket, { roomId, word } = {}) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (room.state !== 'choosing') return;
    if (room.currentDrawer !== socket.id) return;
    if (!room.pendingWordChoices || !room.pendingWordChoices.includes(word)) return;

    this._clearTimer(room);
    this._startDrawing(room, word);
  }

  _startDrawing(room, word) {
    room.state = 'drawing';
    room.currentWord = word;
    room.timeLeft = room.drawTime;
    room.hintRevealed = [];
    room.wordDisplay = getHintMask(word, []);

    // Clear canvas for everyone
    this.io.to(room.id).emit('draw:cleared', { bySystem: true });

    // Notify all players drawing started
    this.io.to(room.id).emit('game:drawingStart', {
      drawer: room.currentDrawer,
      drawerName: room.players.get(room.currentDrawer)?.name || 'Unknown',
      wordDisplay: room.wordDisplay,
      wordLength: word.length,
      timeLeft: room.timeLeft,
    });

    // Give drawer the actual word
    const drawerSocket = this.io.sockets.sockets.get(room.currentDrawer);
    if (drawerSocket) {
      drawerSocket.emit('game:yourWord', { word });
    }

    this._startTimer(room);
  }

  _startTimer(room) {
    this._clearTimer(room);

    const tick = () => {
      if (room.state !== 'drawing') return;

      room.timeLeft--;
      this.io.to(room.id).emit('game:timerTick', { timeLeft: room.timeLeft });

      // Progressive hints
      const timeRatio = room.timeLeft / room.drawTime;
      const revealable = getRevealableIndices(room.currentWord);

      if (timeRatio <= 0.66 && room.hintRevealed.length === 0 && revealable.length > 0) {
        const available = revealable.filter(i => !room.hintRevealed.includes(i));
        if (available.length > 0) {
          const idx = available[Math.floor(Math.random() * available.length)];
          room.hintRevealed.push(idx);
          room.wordDisplay = getHintMask(room.currentWord, room.hintRevealed);
          this.io.to(room.id).emit('game:hint', {
            wordDisplay: room.wordDisplay,
            hintNumber: 1,
          });
        }
      }

      if (timeRatio <= 0.33 && room.hintRevealed.length === 1 && revealable.length > 1) {
        const available = revealable.filter(i => !room.hintRevealed.includes(i));
        if (available.length > 0) {
          const idx = available[Math.floor(Math.random() * available.length)];
          room.hintRevealed.push(idx);
          room.wordDisplay = getHintMask(room.currentWord, room.hintRevealed);
          this.io.to(room.id).emit('game:hint', {
            wordDisplay: room.wordDisplay,
            hintNumber: 2,
          });
        }
      }

      if (room.timeLeft <= 0) {
        this._endTurn(room);
        return;
      }

      room.timer = setTimeout(tick, 1000);
    };

    room.timer = setTimeout(tick, 1000);
  }

  // ─── Guess / Chat Handling ────────────────────────────────────────────────

  handleChatMessage(socket, { roomId, message } = {}) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    const text = String(message).trim().slice(0, 200);
    if (!text) return;

    // Non-drawing states: relay as chat
    if (room.state !== 'drawing') {
      this.io.to(roomId).emit('chat:message', {
        type: 'chat',
        playerId: socket.id,
        playerName: player.name,
        message: text,
      });
      return;
    }

    // Drawer can't chat during drawing (avoid hinting)
    if (socket.id === room.currentDrawer) return;

    // Already guessed correctly
    if (player.hasGuessed) return;

    const guess = text.toLowerCase();
    const word = room.currentWord.toLowerCase();

    if (guess === word) {
      // Correct!
      player.hasGuessed = true;
      room.correctGuessers.push(socket.id);

      const correctCount = room.correctGuessers.length;
      const totalGuessers = room.players.size - 1;
      const points =
        500 +
        Math.floor((room.timeLeft / room.drawTime) * 300) +
        Math.max(0, (totalGuessers - correctCount) * 20);

      player.score += points;
      player.roundScore = (player.roundScore || 0) + points;

      this.io.to(roomId).emit('game:correctGuess', {
        playerId: socket.id,
        playerName: player.name,
        points,
        totalScore: player.score,
        correctCount,
        totalGuessers,
      });

      // Tell guesser the word (they can see it now)
      socket.emit('game:youGuessed', { word: room.currentWord });

      // All guessers done?
      if (correctCount >= totalGuessers) {
        this._clearTimer(room);
        this._endTurn(room);
      }
    } else {
      // Relay wrong guess as a chat message
      this.io.to(roomId).emit('chat:message', {
        type: 'guess',
        playerId: socket.id,
        playerName: player.name,
        message: text,
      });

      // Close guess hint (only to that player)
      if (this._isClose(guess, word)) {
        socket.emit('chat:close', { message: `"${text}" is very close!` });
      }
    }
  }

  _isClose(a, b) {
    if (Math.abs(a.length - b.length) > 2) return false;
    return this._levenshtein(a, b) <= 2;
  }

  _levenshtein(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) =>
      Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] =
          a[i - 1] === b[j - 1]
            ? dp[i - 1][j - 1]
            : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[a.length][b.length];
  }

  // ─── Turn / Round / Game End ──────────────────────────────────────────────

  _endTurn(room) {
    this._clearTimer(room);
    room.state = 'turn_end';

    // Drawer score: 50 per correct guesser
    const drawerPoints = room.correctGuessers.length * 50;
    const drawer = room.players.get(room.currentDrawer);
    if (drawer) {
      drawer.score += drawerPoints;
      drawer.roundScore = (drawer.roundScore || 0) + drawerPoints;
    }

    this.io.to(room.id).emit('game:turnEnd', {
      word: room.currentWord,
      drawer: room.currentDrawer,
      drawerName: drawer?.name || 'Unknown',
      drawerPoints,
      correctGuessers: room.correctGuessers,
      scores: this._getScores(room),
    });

    // Reset per-turn round scores
    for (const player of room.players.values()) {
      player.roundScore = 0;
    }

    room.timer = setTimeout(() => {
      this._startNextTurn(room);
    }, 3000);
  }

  _endRound(room) {
    this._clearTimer(room);
    room.state = 'round_end';

    this.io.to(room.id).emit('game:roundEnd', {
      round: room.currentRound,
      totalRounds: room.totalRounds,
      scores: this._getScores(room),
    });

    if (room.currentRound >= room.totalRounds) {
      // Final round — brief pause then game over
      room.timer = setTimeout(() => this._endGame(room), 4000);
    } else {
      // Mid-game round — short pause then continue
      room.timer = setTimeout(() => {
        room.currentRound++;
        room.drawerOrder = [...room.players.keys()];
        room.drawerIndex = -1;
        this._startNextTurn(room);
      }, 3000);
    }
  }

  _endGame(room) {
    this._clearTimer(room);
    room.state = 'game_end';

    const scores = this._getScores(room);
    this.io.to(room.id).emit('game:ended', {
      scores,
      winner: scores[0] || null,
    });

    // Auto-reset to lobby after 15 seconds
    room.timer = setTimeout(() => {
      if (room.state === 'game_end') {
        room.state = 'lobby';
        // Reset category votes for the next game
        room.categoryVotes = {};
        room.playerVotes = {};
        room.selectedCategory = null;
        for (const player of room.players.values()) {
          player.score = 0;
          player.roundScore = 0;
          player.hasGuessed = false;
        }
        this.io.to(room.id).emit('game:reset', {
          room: this._roomPublic(room),
          categoryVotes: {},
        });
      }
    }, 15000);
  }

  // ─── Draw Event Relay ─────────────────────────────────────────────────────

  handleDrawStroke(socket, data) {
    const room = this._getPlayerRoom(socket);
    if (!room || room.currentDrawer !== socket.id || room.state !== 'drawing') return;
    socket.to(room.id).emit('draw:stroke', data);
  }

  handleFill(socket, data) {
    const room = this._getPlayerRoom(socket);
    if (!room || room.currentDrawer !== socket.id || room.state !== 'drawing') return;
    socket.to(room.id).emit('draw:fill', data);
  }

  handleClear(socket) {
    const room = this._getPlayerRoom(socket);
    if (!room || room.currentDrawer !== socket.id || room.state !== 'drawing') return;
    socket.to(room.id).emit('draw:cleared', {});
  }

  handleRestore(socket, data) {
    const room = this._getPlayerRoom(socket);
    if (!room || room.currentDrawer !== socket.id || room.state !== 'drawing') return;
    socket.to(room.id).emit('draw:restore', data);
  }

  handleShape(socket, data) {
    const room = this._getPlayerRoom(socket);
    if (!room || room.currentDrawer !== socket.id || room.state !== 'drawing') return;
    socket.to(room.id).emit('draw:shape', data);
  }

  handleReaction(socket, { roomId, emoji } = {}) {
    const room = this.rooms.get(roomId);
    if (!room || room.state !== 'drawing') return;
    if (room.currentDrawer === socket.id) return; // drawer can't react
    const allowed = ['👍','👎','😐','🔥','😂'];
    if (!allowed.includes(emoji)) return;
    this.io.to(roomId).emit('reaction:broadcast', { emoji });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _getPlayerRoom(socket) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return null;
    return this.rooms.get(roomId) || null;
  }

  _getScores(room) {
    return [...room.players.values()]
      .map(p => ({ id: p.id, name: p.name, score: p.score }))
      .sort((a, b) => b.score - a.score);
  }

  _clearTimer(room) {
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }
  }

  _makePlayer(id, username) {
    return {
      id,
      name: String(username).trim().slice(0, 20) || 'Player',
      score: 0,
      roundScore: 0,
      hasGuessed: false,
    };
  }

  _roomPublic(room) {
    return {
      id: room.id,
      owner: room.owner,
      players: [...room.players.values()].map(p => this._playerPublic(p)),
      state: room.state,
      currentRound: room.currentRound,
      totalRounds: room.totalRounds,
      drawTime: room.drawTime,
      maxPlayers: room.maxPlayers,
      currentDrawer: room.currentDrawer,
    };
  }

  _playerPublic(player) {
    return {
      id: player.id,
      name: player.name,
      score: player.score,
      hasGuessed: player.hasGuessed,
    };
  }
}

module.exports = GameManager;
