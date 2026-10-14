'use strict';

/**
 * server.js — the front door.
 *
 * Two jobs:
 *   1. Send the website files to the browser (the client/ folder).
 *   2. Accept Socket.IO connections and pass every request through validation,
 *      then the room registry, then the game engine.
 *
 * This one service serves BOTH the website and the multiplayer connection. That
 * is deliberate: one free hosting service to deploy, one URL to share, and no
 * cross-origin (CORS) problems to fight with.
 *
 * Run it with:  npm start
 */

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const properties = require('./properties');
const engine = require('./game-engine');
const rooms = require('./rooms');
const validation = require('./validation');
const cleanup = require('./cleanup');

const PORT = Number(process.env.PORT || 3000);
const CLIENT_DIR = path.join(__dirname, '..', 'client');
const VERSION = '1.0.0';

/* Which websites may open a socket to us. In development that is your own
   machine; on a host you set CLIENT_ORIGIN in the service's environment. */
const allowedOrigins = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map(function (item) { return item.trim(); })
  .filter(Boolean);

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    methods: ['GET', 'POST']
  },
  /* Trim the connection lifetime limits a little so dead sockets are noticed. */
  pingInterval: 20000,
  pingTimeout: 25000,
  /* A game message is tiny: an action, a name, a room code. 16 KB is far more
     than any legal message needs, and it stops a single socket sending a
     multi-megabyte blob to a free hosting tier. */
  maxHttpBufferSize: 16 * 1024
});

app.use(express.static(CLIENT_DIR, { extensions: ['html'] }));

/* A tiny health check. Useful for keeping an eye on the server, and for the
   host to confirm the app is awake. */
app.get('/health', function (req, res) {
  let players = 0;
  rooms.allRooms().forEach(function (room) {
    players += room.players.length;
  });

  res.json({
    ok: true,
    version: VERSION,
    rooms: rooms.countRooms(),
    players: players,
    uptimeSeconds: Math.round(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1048576)
  });
});

/* Any other address shows the website, so invite links always work. */
app.use(function (req, res) {
  res.sendFile(path.join(CLIENT_DIR, 'index.html'));
});

/* ---------------------------------------------------------------------------
   Messages the browser receives
   --------------------------------------------------------------------------- */

/* The same payload goes to everyone in the room. Each browser knows its own
   player id (sent once, privately, when it joins). */
function syncPayload(room) {
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    settings: room.settings,
    minPlayers: validation.MIN_PLAYERS,
    maxPlayers: room.settings.maxPlayers,
    players: room.players.map(function (player) {
      return {
        id: player.id,
        name: player.name,
        connected: player.connected,
        isHost: player.id === room.hostId
      };
    }),
    game: room.game ? engine.stateForClient(room.game) : null
  };
}

function broadcast(room) {
  if (!room) return;
  rooms.markFinished(room);
  io.to(room.code).emit('sync', syncPayload(room));
}

function tell(player, kind, message) {
  if (!player || !player.socketId) return;
  io.to(player.socketId).emit('notice', { kind: kind, message: message });
}

/* ---------------------------------------------------------------------------
   Turning socket messages into game actions
   ---------------------------------------------------------------------------
   Each entry is a small wrapper: the engine does the real work and answers
   { ok, reason }.
   --------------------------------------------------------------------------- */
const ACTIONS = {
  roll: function (game, playerId) { return engine.rollDice(game, playerId); },
  buy: function (game, playerId, payload) { return engine.buyProperty(game, playerId, payload.tile); },
  build: function (game, playerId, payload) { return engine.build(game, playerId, payload.tile); },
  sell_studio: function (game, playerId, payload) { return engine.sellStudio(game, playerId, payload.tile); },
  mortgage: function (game, playerId, payload) { return engine.mortgage(game, playerId, payload.tile); },
  unmortgage: function (game, playerId, payload) { return engine.unmortgage(game, playerId, payload.tile); },
  pay_fine: function (game, playerId) { return engine.payHoldFine(game, playerId); },
  end_turn: function (game, playerId) { return engine.endTurn(game, playerId); },
  trade_propose: function (game, playerId, payload) { return engine.proposeTrade(game, playerId, payload); },
  trade_respond: function (game, playerId, payload) { return engine.respondTrade(game, playerId, payload); },
  trade_cancel: function (game, playerId, payload) { return engine.cancelTrade(game, playerId, payload); }
};

/* ---------------------------------------------------------------------------
   Socket connections
   --------------------------------------------------------------------------- */

io.on('connection', function (socket) {
  /* Everyone gets a copy of the board so it can be drawn immediately. */
  socket.emit('board', properties.boardForClient());

  socket.on('join', function (payload) {
    const data = payload && typeof payload === 'object' ? payload : {};
    const name = validation.sanitiseName(data.name);
    const wantsToCreate = !data.code;

    /* One socket belongs to one room at a time. Without this, a player who went
       back to the menu and started another room would keep receiving the old
       room's updates, and the old room would still list them as connected. */
    const existing = rooms.membershipOf(socket.id);
    const targetCode = wantsToCreate ? null : validation.normaliseCode(data.code);

    if (existing && (!targetCode || targetCode !== existing.code)) {
      const previous = rooms.getRoom(existing.code);
      rooms.leaveRoom(socket.id);
      socket.leave(existing.code);
      if (previous) broadcast(previous);
    }

    if (wantsToCreate) {
      if (!rooms.limiters.create.allow(socket.id)) {
        socket.emit('join_failed', { reason: 'Too many rooms created from this device. Please wait a moment.' });
        return;
      }

      const created = rooms.createRoom(data.settings, name, socket.id);
      if (!created.ok) {
        socket.emit('join_failed', { reason: created.reason });
        return;
      }

      enterRoom(socket, created.room, created.player, false);
      return;
    }

    const code = validation.normaliseCode(data.code);
    if (!validation.isValidCode(code)) {
      socket.emit('join_failed', { reason: 'A room code is ' + validation.CODE_LENGTH + ' characters long.' });
      return;
    }

    if (!rooms.limiters.general.allow('join:' + socket.id)) {
      socket.emit('join_failed', { reason: 'Please slow down and try again in a second.' });
      return;
    }

    /* Private seat keys, and only those. A public player id is not a key:
       every client in a room can see everyone else's id, so accepting one here
       would let a player take over a seat that is briefly disconnected. */
    const tokens = [];
    if (Array.isArray(data.tokens)) tokens.push.apply(tokens, data.tokens);
    if (typeof data.token === 'string') tokens.push(data.token);

    const joined = rooms.joinRoom(code, name, socket.id, {
      tokens: tokens,
      reclaim: data.auto === true
    });

    if (!joined.ok) {
      socket.emit('join_failed', { reason: joined.reason, seatInUse: Boolean(joined.seatInUse) });
      return;
    }

    enterRoom(socket, joined.room, joined.player, Boolean(joined.rejoined), Boolean(joined.seatWasBusy));
  });

  /* Settings can only be changed by the host, in the lobby, before the start. */
  socket.on('settings', function (payload) {
    const data = payload && typeof payload === 'object' ? payload : {};
    const result = rooms.updateSettings(socket.id, data.settings);

    if (!result.ok) {
      socket.emit('notice', { kind: 'error', message: result.reason });
      return;
    }

    broadcast(result.room);
  });

  socket.on('start', function () {
    const result = rooms.startGame(socket.id);

    if (!result.ok) {
      socket.emit('notice', { kind: 'error', message: result.reason });
      return;
    }

    engine.log(result.room.game, result.room.players[0].name + ' starts the match.', 'system');
    broadcast(result.room);
  });

  socket.on('rematch', function () {
    const result = rooms.rematch(socket.id);

    if (!result.ok) {
      socket.emit('notice', { kind: 'error', message: result.reason });
      return;
    }

    broadcast(result.room);
  });

  /* Every game action arrives here, one at a time. */
  socket.on('action', function (payload) {
    const data = payload && typeof payload === 'object' ? payload : {};
    const membership = rooms.membershipOf(socket.id);

    if (!membership) {
      socket.emit('notice', { kind: 'error', message: 'You are not in a room' });
      return;
    }

    const room = rooms.getRoom(membership.code);
    if (!room || !room.game) {
      socket.emit('notice', { kind: 'error', message: 'There is no match to act on' });
      return;
    }

    if (!rooms.limiters.general.allow('action:' + membership.playerId)) {
      socket.emit('notice', { kind: 'error', message: 'Too many actions at once. Take a breath.' });
      return;
    }

    /* A repeated click or a retried message must not apply twice. */
    if (room.actionLog.isDuplicate(data.actionId)) return;
    room.actionLog.remember(data.actionId);

    /* ACTIONS is a plain object, so a client could send a built-in name like
       "hasOwnProperty". Only our OWN keys count as actions — nothing inherited
       from Object.prototype can ever be called. */
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, data.type)) {
      socket.emit('notice', { kind: 'error', message: 'Unknown action' });
      return;
    }

    let result;

    try {
      result = ACTIONS[data.type](room.game, membership.playerId, data);
    } catch (error) {
      /* A malformed message must never take the whole server down with it. The
         player gets a plain refusal; the details stay in the server log. */
      console.error('Action "' + data.type + '" failed:', error && error.message);
      result = { ok: false, reason: 'That action could not be processed' };
    }

    if (!result || !result.ok) {
      socket.emit('notice', { kind: 'warn', message: result.reason });
      broadcast(room); // keep the sender's screen in step with the truth
      return;
    }

    room.lastActivity = Date.now();
    broadcast(room);
  });

  /* Leaving on purpose frees the seat. */
  socket.on('leave', function () {
    const membership = rooms.membershipOf(socket.id);
    if (!membership) return;

    const room = rooms.getRoom(membership.code);
    const result = rooms.leaveRoom(socket.id);

    socket.leave(membership.code);
    socket.emit('left');

    if (room && result) broadcast(room);
  });

  /* The host can close the room, which deletes it for good. */
  socket.on('close', function () {
    const membership = rooms.membershipOf(socket.id);
    if (!membership) return;

    const room = rooms.getRoom(membership.code);
    if (!room) return;

    if (room.hostId !== membership.playerId) {
      socket.emit('notice', { kind: 'error', message: 'Only the host can close the room' });
      return;
    }

    io.to(room.code).emit('room_closed', { reason: 'The host closed the room' });
    io.socketsLeave(room.code);
    rooms.deleteRoom(room.code);
  });

  socket.on('disconnect', function () {
    const result = rooms.markDisconnected(socket.id);
    if (result && result.room) broadcast(result.room);
  });
});

/* Put a socket in the room's channel and tell it who it is. */
function enterRoom(socket, room, player, rejoined, seatWasBusy) {
  socket.join(room.code);

  socket.emit('welcome', {
    playerId: player.id,
    /* The seat key. It goes to this socket and nowhere else — it is what the
       browser uses to get this seat back after a refresh. */
    token: player.token,
    code: room.code,
    isHost: room.hostId === player.id,
    rejoined: rejoined,
    version: VERSION
  });

  if (rejoined) {
    tell(player, 'good', 'Welcome back — your seat and your money are waiting.');
  } else if (seatWasBusy) {
    tell(player, 'warn', 'Your earlier seat in this room is still open in another tab or on another device, so you have joined as a new player.');
  }

  broadcast(room);
}

/* ---------------------------------------------------------------------------
   Start
   --------------------------------------------------------------------------- */

const stopCleanup = cleanup.start({
  onChanged: function (room) {
    broadcast(room);
  },
  onDeleted: function (room, reason) {
    io.to(room.code).emit('room_closed', {
      reason: reason === 'finished'
        ? 'The finished match was cleared away.'
        : 'The room was empty for a while, so it was cleared away.'
    });
    io.socketsLeave(room.code);
    console.log('Deleted room ' + room.code + ' (' + reason + ')');
  }
});

server.listen(PORT, function () {
  console.log('Property Royale server listening on http://localhost:' + PORT);
  console.log('Health check: http://localhost:' + PORT + '/health');
});

/* Shut down tidily when the host stops the process. */
['SIGINT', 'SIGTERM'].forEach(function (signal) {
  process.on(signal, function () {
    console.log('\nShutting down. Active rooms are held in memory, so this ends them.');
    stopCleanup();
    io.close();
    server.close(function () {
      process.exit(0);
    });
  });
});

module.exports = { app: app, server: server, io: io };
