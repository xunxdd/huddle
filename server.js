const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const GameManager = require('./src/gameManager');
const WordBombManager = require('./src/wordBombManager');

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

app.use(express.static(path.join(__dirname, 'public')));

const gm = new GameManager(io);
const wbm = new WordBombManager(io);

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

  socket.on('disconnect', () => {
    console.log(`- disconnected: ${socket.id}`);
    gm.leaveRoom(socket);
    wbm.leaveRoom(socket);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Scribble-O running at http://localhost:${PORT}`);
});
