const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const GameManager = require('./src/gameManager');
const WordBombManager = require('./src/wordBombManager');
const WordleManager = require('./src/wordleManager');
const Game24Manager      = require('./src/game24Manager');
const CountdownManager   = require('./src/countdownManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
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

app.use(express.static(path.join(__dirname, 'public')));

const gm  = new GameManager(io);
const wbm = new WordBombManager(io);
const wm  = new WordleManager(io);
const g24 = new Game24Manager(io);
const cdm = new CountdownManager(io);

io.on('connection', (socket) => {
  console.log(`+ connected: ${socket.id}`);

  socket.on('room:create', (data) => {
    gm.createRoom(socket, data || {});
  });

  socket.on('room:join', (data) => {
    gm.joinRoom(socket, data || {});
  });

  socket.on('room:leave', () => {
    gm.leaveRoom(socket);
  });

  socket.on('game:start', (roomId) => {
    gm.startGame(socket, roomId);
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
  socket.on('wb:create',     (d)  => wbm.createRoom(socket, d || {}));
  socket.on('wb:join',       (d)  => wbm.joinRoom(socket, d || {}));
  socket.on('wb:leave',      ()   => wbm.leaveRoom(socket));
  socket.on('wb:start',      (id) => wbm.startGame(socket, id));
  socket.on('wb:submitWord', (d)  => wbm.handleSubmitWord(socket, d || {}));

  // ── Family Wordle ─────────────────────────────────────────────────────────
  socket.on('fw:create',      d  => wm.createRoom(socket, d || {}));
  socket.on('fw:join',        d  => wm.joinRoom(socket, d || {}));
  socket.on('fw:leave',       () => wm.leaveRoom(socket));
  socket.on('fw:start',       id => wm.startGame(socket, id));
  socket.on('fw:submitGuess', d  => wm.handleSubmitGuess(socket, d || {}));

  // ── The 24 Game ───────────────────────────────────────────────────────────
  socket.on('g24:create', d  => g24.createRoom(socket, d || {}));
  socket.on('g24:join',   d  => g24.joinRoom(socket, d || {}));
  socket.on('g24:leave',  () => g24.leaveRoom(socket));
  socket.on('g24:start',  id => g24.startGame(socket, id));
  socket.on('g24:submit', d  => g24.handleSubmit(socket, d || {}));

  // ── Countdown Numbers ─────────────────────────────────────────────────────
  socket.on('cd:create', d  => cdm.createRoom(socket, d || {}));
  socket.on('cd:join',   d  => cdm.joinRoom(socket, d || {}));
  socket.on('cd:leave',  () => cdm.leaveRoom(socket));
  socket.on('cd:start',  id => cdm.startGame(socket, id));
  socket.on('cd:pick',   d  => cdm.handlePick(socket, d || {}));
  socket.on('cd:submit', d  => cdm.handleSubmit(socket, d || {}));
  socket.on('cd:reset',  id => cdm.resetRoom(socket, id));

  socket.on('disconnect', () => {
    console.log(`- disconnected: ${socket.id}`);
    gm.leaveRoom(socket);
    wbm.leaveRoom(socket);
    wm.leaveRoom(socket);
    g24.leaveRoom(socket);
    cdm.leaveRoom(socket);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Scribble-O running at http://localhost:${PORT}`);
});
