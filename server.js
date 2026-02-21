const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const GameManager = require('./src/gameManager');
const WordBombManager = require('./src/wordBombManager');
const WordleManager = require('./src/wordleManager');
const Game24Manager      = require('./src/game24Manager');
const CountdownManager   = require('./src/countdownManager');
const TriviaManager      = require('./src/triviaManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

// Browse open rooms page
app.get('/join', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'join.html'));
});

// Game page
app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'play.html'));
});

// Invite links — serve the game page so client JS can read the room code
app.get('/join/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'play.html'));
});

// Word Bomb page + invite links
app.get('/wordbomb', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'wordbomb.html'));
});
app.get('/wordbomb/join/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'wordbomb.html'));
});

// Family Wordle page + invite links
app.get('/wordle', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'wordle.html'));
});
app.get('/wordle/join/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'wordle.html'));
});

// The 24 Game page + invite links
app.get('/game24', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'game24.html'));
});
app.get('/game24/join/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'game24.html'));
});

// Countdown Numbers page + invite links
app.get('/countdown', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'countdown.html'));
});
app.get('/countdown/join/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'countdown.html'));
});

// Trivia page + invite links
app.get('/trivia', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'trivia.html'));
});
app.get('/trivia/join/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'trivia.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

const gm  = new GameManager(io);
const wbm = new WordBombManager(io);
const wm  = new WordleManager(io);
const g24 = new Game24Manager(io);
const cdm = new CountdownManager(io);
const tvm = new TriviaManager(io);

function broadcastRoomList() {
  const rooms = gm.getOpenRooms();
  console.log('Broadcasting room list:', rooms.length, 'rooms', JSON.stringify(rooms));
  io.emit('room:list', rooms);
}

function getLobbyList() {
  const list = [];

  for (const r of gm.getOpenRooms()) {
    list.push({ id: r.id, game: 'Scribble-O', gameIcon: '🎨', joinUrl: `/join/${r.id}`, ownerName: r.ownerName, playerCount: r.playerCount, maxPlayers: r.maxPlayers });
  }
  for (const r of wbm.getOpenRooms()) {
    list.push({ id: r.id, game: 'Word Bomb', gameIcon: '💣', joinUrl: `/wordbomb/join/${r.id}`, ownerName: r.ownerName, playerCount: r.playerCount, maxPlayers: r.maxPlayers });
  }
  for (const r of wm.getOpenRooms()) {
    list.push({ id: r.id, game: 'Family Wordle', gameIcon: '🟩', joinUrl: `/wordle/join/${r.id}`, ownerName: r.ownerName, playerCount: r.playerCount, maxPlayers: r.maxPlayers });
  }
  for (const r of g24.getOpenRooms()) {
    list.push({ id: r.id, game: 'The 24 Game', gameIcon: '🔢', joinUrl: `/game24/join/${r.id}`, ownerName: r.ownerName, playerCount: r.playerCount, maxPlayers: r.maxPlayers });
  }
  for (const r of cdm.getOpenRooms()) {
    list.push({ id: r.id, game: 'Countdown', gameIcon: '🎯', joinUrl: `/countdown/join/${r.id}`, ownerName: r.ownerName, playerCount: r.playerCount, maxPlayers: r.maxPlayers });
  }
  for (const r of tvm.getOpenRooms()) {
    list.push({ id: r.id, game: 'Trivia', gameIcon: '🧠', joinUrl: `/trivia/join/${r.id}`, ownerName: r.ownerName, playerCount: r.playerCount, maxPlayers: r.maxPlayers });
  }

  return list;
}

function broadcastLobbyList() {
  io.emit('lobby:list', getLobbyList());
}

gm.onRoomListChanged = () => { broadcastRoomList(); broadcastLobbyList(); };

io.on('connection', (socket) => {
  console.log(`+ connected: ${socket.id}`);

  socket.on('room:list', () => {
    socket.emit('room:list', gm.getOpenRooms());
  });

  socket.on('lobby:list', () => {
    socket.emit('lobby:list', getLobbyList());
  });

  socket.on('room:create', (data) => {
    gm.createRoom(socket, data || {});
    broadcastRoomList();
    broadcastLobbyList();
  });

  socket.on('room:join', (data) => {
    gm.joinRoom(socket, data || {});
    broadcastRoomList();
    broadcastLobbyList();
  });

  socket.on('room:leave', () => {
    gm.leaveRoom(socket);
    broadcastRoomList();
    broadcastLobbyList();
  });

  socket.on('game:start', (roomId) => {
    gm.startGame(socket, roomId);
    broadcastRoomList();
    broadcastLobbyList();
  });

  socket.on('game:chooseWord', (data) => {
    gm.handleWordChoice(socket, data || {});
  });

  socket.on('chat:message', (data) => {
    gm.handleChatMessage(socket, data || {});
  });

  socket.on('draw:stroke', (data) => {
    gm.handleDrawStroke(socket, data);
  });

  socket.on('draw:fill', (data) => {
    gm.handleFill(socket, data);
  });

  socket.on('draw:clear', () => {
    gm.handleClear(socket);
  });

  socket.on('draw:restore', (data) => {
    gm.handleRestore(socket, data);
  });

  socket.on('draw:shape', (data) => {
    gm.handleShape(socket, data);
  });

  socket.on('reaction:send', (data) => {
    gm.handleReaction(socket, data || {});
  });

  socket.on('room:categoryVote', (data) => {
    gm.handlePreGameCategoryVote(socket, data || {});
  });

  // ── Word Bomb ────────────────────────────────────────────────────────────
  socket.on('wb:create',     (d)  => { wbm.createRoom(socket, d || {}); broadcastLobbyList(); });
  socket.on('wb:join',       (d)  => { wbm.joinRoom(socket, d || {}); broadcastLobbyList(); });
  socket.on('wb:leave',      ()   => { wbm.leaveRoom(socket); broadcastLobbyList(); });
  socket.on('wb:start',      (id) => { wbm.startGame(socket, id); broadcastLobbyList(); });
  socket.on('wb:submitWord', (d)  => wbm.handleSubmitWord(socket, d || {}));
  socket.on('wb:reset',      (id) => { wbm.resetRoom(socket, id); broadcastLobbyList(); });

  // ── Family Wordle ─────────────────────────────────────────────────────────
  socket.on('fw:create',      d  => { wm.createRoom(socket, d || {}); broadcastLobbyList(); });
  socket.on('fw:join',        d  => { wm.joinRoom(socket, d || {}); broadcastLobbyList(); });
  socket.on('fw:leave',       () => { wm.leaveRoom(socket); broadcastLobbyList(); });
  socket.on('fw:start',       id => { wm.startGame(socket, id); broadcastLobbyList(); });
  socket.on('fw:submitGuess', d  => wm.handleSubmitGuess(socket, d || {}));
  socket.on('fw:reset',       id => { wm.resetRoom(socket, id); broadcastLobbyList(); });

  // ── The 24 Game ───────────────────────────────────────────────────────────
  socket.on('g24:create', d  => { g24.createRoom(socket, d || {}); broadcastLobbyList(); });
  socket.on('g24:join',   d  => { g24.joinRoom(socket, d || {}); broadcastLobbyList(); });
  socket.on('g24:leave',  () => { g24.leaveRoom(socket); broadcastLobbyList(); });
  socket.on('g24:start',  id => { g24.startGame(socket, id); broadcastLobbyList(); });
  socket.on('g24:submit', d  => g24.handleSubmit(socket, d || {}));
  socket.on('g24:reset',  id => { g24.resetRoom(socket, id); broadcastLobbyList(); });

  // ── Countdown Numbers ─────────────────────────────────────────────────────
  socket.on('cd:create', d  => { cdm.createRoom(socket, d || {}); broadcastLobbyList(); });
  socket.on('cd:join',   d  => { cdm.joinRoom(socket, d || {}); broadcastLobbyList(); });
  socket.on('cd:leave',  () => { cdm.leaveRoom(socket); broadcastLobbyList(); });
  socket.on('cd:start',  id => { cdm.startGame(socket, id); broadcastLobbyList(); });
  socket.on('cd:pick',   d  => cdm.handlePick(socket, d || {}));
  socket.on('cd:submit', d  => cdm.handleSubmit(socket, d || {}));
  socket.on('cd:reset',  id => { cdm.resetRoom(socket, id); broadcastLobbyList(); });

  // ── Trivia ──────────────────────────────────────────────────────────────
  socket.on('tv:create', d  => { tvm.createRoom(socket, d || {}); broadcastLobbyList(); });
  socket.on('tv:join',   d  => { tvm.joinRoom(socket, d || {}); broadcastLobbyList(); });
  socket.on('tv:leave',  () => { tvm.leaveRoom(socket); broadcastLobbyList(); });
  socket.on('tv:start',  id => { tvm.startGame(socket, id); broadcastLobbyList(); });
  socket.on('tv:vote',   d  => tvm.handleVote(socket, d || {}));
  socket.on('tv:answer', d  => tvm.handleAnswer(socket, d || {}));
  socket.on('tv:reset',  id => { tvm.resetRoom(socket, id); broadcastLobbyList(); });

  socket.on('disconnect', () => {
    console.log(`- disconnected: ${socket.id}`);
    gm.handleDisconnect(socket);
    broadcastRoomList();
    wbm.leaveRoom(socket);
    wm.leaveRoom(socket);
    g24.leaveRoom(socket);
    cdm.leaveRoom(socket);
    tvm.leaveRoom(socket);
    broadcastLobbyList();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Scribble-O running at http://localhost:${PORT}`);
});
