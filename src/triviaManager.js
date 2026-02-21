// ── Trivia Manager ─────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 9,  name: 'General Knowledge', emoji: '🧠' },
  { id: 17, name: 'Science & Nature',  emoji: '🔬' },
  { id: 22, name: 'Geography',         emoji: '🌍' },
  { id: 23, name: 'History',           emoji: '📜' },
  { id: 21, name: 'Sports',            emoji: '⚽' },
  { id: 11, name: 'Film',              emoji: '🎬' },
  { id: 12, name: 'Music',             emoji: '🎵' },
  { id: 14, name: 'Television',        emoji: '📺' },
  { id: 18, name: 'Computers',         emoji: '💻' },
  { id: 15, name: 'Video Games',       emoji: '🎮' },
];

const FALLBACK_QUESTIONS = [
  { question: 'What is the largest planet in our solar system?', category: 'Science & Nature', difficulty: 'easy', answers: ['Jupiter', 'Saturn', 'Neptune', 'Earth'], correctIndex: 0, correctAnswer: 'Jupiter' },
  { question: 'In what year did the Titanic sink?', category: 'History', difficulty: 'easy', answers: ['1912', '1905', '1920', '1898'], correctIndex: 0, correctAnswer: '1912' },
  { question: 'What is the capital of Australia?', category: 'Geography', difficulty: 'medium', answers: ['Canberra', 'Sydney', 'Melbourne', 'Brisbane'], correctIndex: 0, correctAnswer: 'Canberra' },
  { question: 'Which element has the chemical symbol "O"?', category: 'Science & Nature', difficulty: 'easy', answers: ['Oxygen', 'Osmium', 'Oganesson', 'Gold'], correctIndex: 0, correctAnswer: 'Oxygen' },
  { question: 'Who painted the Mona Lisa?', category: 'General Knowledge', difficulty: 'easy', answers: ['Leonardo da Vinci', 'Michelangelo', 'Raphael', 'Donatello'], correctIndex: 0, correctAnswer: 'Leonardo da Vinci' },
  { question: 'What is the smallest country in the world?', category: 'Geography', difficulty: 'easy', answers: ['Vatican City', 'Monaco', 'San Marino', 'Liechtenstein'], correctIndex: 0, correctAnswer: 'Vatican City' },
  { question: 'How many strings does a standard guitar have?', category: 'Music', difficulty: 'easy', answers: ['6', '4', '8', '12'], correctIndex: 0, correctAnswer: '6' },
  { question: 'What year was the first iPhone released?', category: 'Computers', difficulty: 'medium', answers: ['2007', '2005', '2008', '2010'], correctIndex: 0, correctAnswer: '2007' },
  { question: 'Which planet is known as the Red Planet?', category: 'Science & Nature', difficulty: 'easy', answers: ['Mars', 'Venus', 'Jupiter', 'Mercury'], correctIndex: 0, correctAnswer: 'Mars' },
  { question: 'In which sport would you perform a slam dunk?', category: 'Sports', difficulty: 'easy', answers: ['Basketball', 'Volleyball', 'Tennis', 'Football'], correctIndex: 0, correctAnswer: 'Basketball' },
];

function decodeHtml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&eacute;/g, 'e')
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&hellip;/g, '...')
    .replace(/&ndash;/g, '-')
    .replace(/&mdash;/g, '-')
    .replace(/&shy;/g, '')
    .replace(/&Uuml;/g, 'U')
    .replace(/&uuml;/g, 'u')
    .replace(/&ouml;/g, 'o')
    .replace(/&auml;/g, 'a');
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function fetchQuestion(categoryId) {
  try {
    const resp = await fetch(`https://opentdb.com/api.php?amount=1&category=${categoryId}&type=multiple`);
    const data = await resp.json();
    if (!data.results || data.results.length === 0) throw new Error('No results');

    const q = data.results[0];
    const correct = decodeHtml(q.correct_answer);
    const answers = shuffle([
      correct,
      ...q.incorrect_answers.map(a => decodeHtml(a)),
    ]);

    return {
      question: decodeHtml(q.question),
      category: decodeHtml(q.category),
      difficulty: q.difficulty,
      answers,
      correctIndex: answers.indexOf(correct),
      correctAnswer: correct,
    };
  } catch (err) {
    console.error('[TV] API fetch failed, using fallback:', err.message);
    return _pickFallback();
  }
}

function _pickFallback() {
  const fb = { ...FALLBACK_QUESTIONS[Math.floor(Math.random() * FALLBACK_QUESTIONS.length)] };
  fb.answers = shuffle([...fb.answers]);
  fb.correctIndex = fb.answers.indexOf(fb.correctAnswer);
  return fb;
}

class TriviaManager {
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
      timePerQuestion: room.timePerQuestion,
      maxPlayers: room.maxPlayers,
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

  // ─── Room Management ────────────────────────────────────────────────────

  createRoom(socket, opts = {}) {
    const {
      username = 'Player',
      totalRounds = 10,
      timePerQuestion = 20,
    } = opts;

    this.leaveRoom(socket);

    const roomId = this._generateRoomCode();
    const player = this._makePlayer(socket.id, username);

    const room = {
      id: roomId,
      owner: socket.id,
      players: new Map([[socket.id, player]]),
      state: 'lobby',
      maxPlayers: 12,
      currentRound: 0,
      totalRounds: Math.max(1, Math.min(totalRounds, 15)),
      timePerQuestion: Math.max(10, Math.min(timePerQuestion, 30)),
      // Phase data
      voteOptions: [],
      votes: new Map(),
      currentQuestion: null,
      answers: new Map(),
      questionStartTime: 0,
      // Timers
      voteTimer: null,
      questionTimer: null,
      tickTimer: null,
      autoResetTimer: null,
      timeLeft: 0,
    };

    this.rooms.set(roomId, room);
    this.playerRooms.set(socket.id, roomId);
    socket.join(roomId);

    socket.emit('tv:joined', {
      roomId,
      playerId: socket.id,
      room: this._roomPublic(room),
    });

    console.log(`[TV] Room created: ${roomId} by ${player.name}`);
  }

  joinRoom(socket, opts = {}) {
    const { username = 'Player', roomId } = opts;

    if (!roomId) {
      socket.emit('tv:error', { message: 'Room code required' });
      return;
    }

    const code = roomId.toUpperCase().trim();
    const room = this.rooms.get(code);

    if (!room) {
      socket.emit('tv:error', { message: 'Room not found' });
      return;
    }
    if (room.players.size >= room.maxPlayers) {
      socket.emit('tv:error', { message: 'Room is full' });
      return;
    }
    if (room.state !== 'lobby') {
      socket.emit('tv:error', { message: 'Game already in progress' });
      return;
    }

    this.leaveRoom(socket);

    const player = this._makePlayer(socket.id, username);
    room.players.set(socket.id, player);
    this.playerRooms.set(socket.id, code);
    socket.join(code);

    socket.emit('tv:joined', {
      roomId: code,
      playerId: socket.id,
      room: this._roomPublic(room),
    });

    socket.to(code).emit('tv:playerJoined', {
      player: { id: player.id, name: player.name, score: 0 },
      room: this._roomPublic(room),
    });

    console.log(`[TV] ${player.name} joined room ${code}`);
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
      console.log(`[TV] Room ${roomId} deleted (empty)`);
      return;
    }

    // Transfer ownership if needed
    if (room.owner === socket.id) {
      room.owner = room.players.keys().next().value;
    }

    // Remove from votes/answers if game in progress
    room.votes.delete(socket.id);
    room.answers.delete(socket.id);

    this.io.to(roomId).emit('tv:playerLeft', {
      playerId: socket.id,
      room: this._roomPublic(room),
    });

    console.log(`[TV] Player left room ${roomId}, remaining: ${room.players.size}`);
  }

  // ─── Game Flow ──────────────────────────────────────────────────────────

  startGame(socket, roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      socket.emit('tv:error', { message: 'Room not found' });
      return;
    }
    if (room.owner !== socket.id) {
      socket.emit('tv:error', { message: 'Only the host can start the game' });
      return;
    }
    if (room.state !== 'lobby') {
      socket.emit('tv:error', { message: 'Game already in progress' });
      return;
    }
    if (room.players.size < 2) {
      socket.emit('tv:error', { message: 'Need at least 2 players to start' });
      return;
    }

    // Reset scores
    for (const p of room.players.values()) {
      p.score = 0;
    }

    room.currentRound = 0;
    room.state = 'voting';

    this.io.to(roomId).emit('tv:started', { room: this._roomPublic(room) });
    console.log(`[TV] Game started in room ${roomId}`);

    this._startVotePhase(room);
  }

  // ─── Vote Phase ─────────────────────────────────────────────────────────

  _startVotePhase(room) {
    room.currentRound++;
    room.state = 'voting';
    room.votes = new Map();

    // Pick 6 random categories
    const shuffled = shuffle([...CATEGORIES]);
    room.voteOptions = shuffled.slice(0, 6).map(c => ({
      id: c.id,
      name: c.name,
      emoji: c.emoji,
    }));

    room.timeLeft = 10;

    this.io.to(room.id).emit('tv:voteStart', {
      round: room.currentRound,
      totalRounds: room.totalRounds,
      categories: room.voteOptions,
      timeLeft: room.timeLeft,
      scores: this._scores(room),
    });

    this._startTick(room, 10, () => this._resolveVote(room));
  }

  handleVote(socket, data) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room || room.state !== 'voting') return;

    const { categoryId } = data;
    if (room.votes.has(socket.id)) return; // already voted

    // Validate category is one of the options
    if (!room.voteOptions.find(c => c.id === categoryId)) return;

    room.votes.set(socket.id, categoryId);

    this.io.to(room.id).emit('tv:playerVoted', {
      playerId: socket.id,
      voteCount: room.votes.size,
      totalPlayers: room.players.size,
    });

    // All voted? Resolve immediately
    if (room.votes.size >= room.players.size) {
      this._resolveVote(room);
    }
  }

  _resolveVote(room) {
    if (room.state !== 'voting') return;
    this._clearTimers(room);

    // Tally votes
    const tally = new Map();
    for (const catId of room.votes.values()) {
      tally.set(catId, (tally.get(catId) || 0) + 1);
    }

    let winnerCat;
    if (tally.size === 0) {
      // No votes — pick random from options
      winnerCat = room.voteOptions[Math.floor(Math.random() * room.voteOptions.length)];
    } else {
      // Find max vote count, random tiebreak
      const maxVotes = Math.max(...tally.values());
      const tied = [...tally.entries()].filter(([, v]) => v === maxVotes);
      const winnerId = tied[Math.floor(Math.random() * tied.length)][0];
      winnerCat = room.voteOptions.find(c => c.id === winnerId);
    }

    room.state = 'question'; // transitioning

    this.io.to(room.id).emit('tv:voteResult', {
      category: winnerCat,
    });

    // Brief delay for vote result display, then fetch question
    setTimeout(() => {
      if (room.state !== 'question') return;
      this._fetchAndStartQuestion(room, winnerCat.id);
    }, 2000);
  }

  // ─── Question Phase ─────────────────────────────────────────────────────

  async _fetchAndStartQuestion(room, categoryId) {
    const q = await fetchQuestion(categoryId);

    room.currentQuestion = q;
    room.answers = new Map();
    room.questionStartTime = Date.now();
    room.timeLeft = room.timePerQuestion;

    // Send question without correctIndex
    this.io.to(room.id).emit('tv:questionStart', {
      round: room.currentRound,
      totalRounds: room.totalRounds,
      question: q.question,
      category: q.category,
      difficulty: q.difficulty,
      answers: q.answers,
      timeLeft: room.timePerQuestion,
    });

    this._startTick(room, room.timePerQuestion, () => this._resolveQuestion(room));
  }

  handleAnswer(socket, data) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room || room.state !== 'question') return;

    const { answerIndex } = data;
    if (room.answers.has(socket.id)) return; // already answered
    if (typeof answerIndex !== 'number' || answerIndex < 0 || answerIndex > 3) return;

    room.answers.set(socket.id, {
      index: answerIndex,
      time: Date.now(),
    });

    this.io.to(room.id).emit('tv:playerAnswered', {
      playerId: socket.id,
      answerCount: room.answers.size,
      totalPlayers: room.players.size,
    });

    // All answered? Resolve immediately
    if (room.answers.size >= room.players.size) {
      this._resolveQuestion(room);
    }
  }

  _resolveQuestion(room) {
    if (room.state !== 'question') return;
    this._clearTimers(room);
    room.state = 'reveal';

    const q = room.currentQuestion;
    const playerResults = [];

    for (const [pid, ans] of room.answers.entries()) {
      const player = room.players.get(pid);
      if (!player) continue;

      const correct = ans.index === q.correctIndex;
      let points = 0;
      if (correct) {
        const elapsed = (ans.time - room.questionStartTime) / 1000;
        const timeFraction = Math.max(0, 1 - elapsed / room.timePerQuestion);
        const speedBonus = Math.round(50 * timeFraction);
        points = 100 + speedBonus;
        player.score += points;
      }

      playerResults.push({
        id: pid,
        name: player.name,
        answerIndex: ans.index,
        correct,
        points,
      });
    }

    // Players who didn't answer
    for (const [pid, player] of room.players.entries()) {
      if (!room.answers.has(pid)) {
        playerResults.push({
          id: pid,
          name: player.name,
          answerIndex: -1,
          correct: false,
          points: 0,
        });
      }
    }

    this.io.to(room.id).emit('tv:reveal', {
      correctIndex: q.correctIndex,
      correctAnswer: q.correctAnswer,
      playerResults,
      scores: this._scores(room),
      round: room.currentRound,
      totalRounds: room.totalRounds,
    });

    // After reveal, proceed to next round or game end
    setTimeout(() => {
      if (room.state !== 'reveal') return;
      if (room.currentRound >= room.totalRounds) {
        this._endGame(room);
      } else {
        this._startVotePhase(room);
      }
    }, 5000);
  }

  // ─── Game End ───────────────────────────────────────────────────────────

  _endGame(room) {
    this._clearTimers(room);
    room.state = 'game_end';

    const scores = this._scores(room);
    const winner = scores[0] || null;

    this.io.to(room.id).emit('tv:gameOver', {
      scores,
      winner: winner ? { id: winner.id, name: winner.name, score: winner.score } : null,
    });

    console.log(`[TV] Game ended in room ${room.id}. Winner: ${winner?.name}`);

    // Auto-reset to lobby after 15s
    room.autoResetTimer = setTimeout(() => {
      if (!room || !this.rooms.has(room.id)) return;
      this._doReset(room);
    }, 15000);
  }

  _doReset(room) {
    this._clearTimers(room);
    room.state = 'lobby';
    room.currentRound = 0;
    room.voteOptions = [];
    room.votes = new Map();
    room.currentQuestion = null;
    room.answers = new Map();
    room.questionStartTime = 0;
    for (const p of room.players.values()) {
      p.score = 0;
    }
    this.io.to(room.id).emit('tv:reset', { room: this._roomPublic(room) });
  }

  resetRoom(socket, roomId) {
    const room = this.rooms.get(roomId);
    if (!room) { socket.emit('tv:error', { message: 'Room not found' }); return; }
    if (room.owner !== socket.id) { socket.emit('tv:error', { message: 'Only the host can reset' }); return; }
    this._doReset(room);
  }

  // ─── Timers ─────────────────────────────────────────────────────────────

  _startTick(room, duration, onExpire) {
    this._clearTimers(room);
    room.timeLeft = duration;

    room.tickTimer = setInterval(() => {
      room.timeLeft--;
      this.io.to(room.id).emit('tv:tick', { timeLeft: room.timeLeft });

      if (room.timeLeft <= 0) {
        this._clearTimers(room);
        onExpire();
      }
    }, 1000);
  }

  _clearTimers(room) {
    if (room.tickTimer) { clearInterval(room.tickTimer); room.tickTimer = null; }
    if (room.voteTimer) { clearTimeout(room.voteTimer); room.voteTimer = null; }
    if (room.questionTimer) { clearTimeout(room.questionTimer); room.questionTimer = null; }
    if (room.autoResetTimer) { clearTimeout(room.autoResetTimer); room.autoResetTimer = null; }
  }
}

module.exports = TriviaManager;
