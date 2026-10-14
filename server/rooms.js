'use strict';

/**
 * rooms.js — temporary game sessions.
 *
 * A room lives in server memory only. When a match ends, the host closes it, or
 * everyone has been gone long enough, the room object is deleted and its data
 * is gone with it. Nothing is written to a database, because there is no
 * database — that is what makes this free to run.
 */

const crypto = require('crypto');
const validation = require('./validation');
const engine = require('./game-engine');

const MAX_ROOMS = Number(process.env.MAX_ROOMS || 50);

/* Every live room, keyed by its code. */
const rooms = new Map();

/* Which socket is sitting in which room, so we can validate each request. */
const socketIndex = new Map();

const limiters = {
  general: validation.createRateLimiter({ burst: 25, refillPerSecond: 5 }),
  create: validation.createRateLimiter({ burst: 4, refillPerSecond: 0.2 })
};

function allRooms() {
  return rooms;
}

function getRoom(code) {
  return rooms.get(code) || null;
}

function countRooms() {
  return rooms.size;
}

function membershipOf(socketId) {
  return socketIndex.get(socketId) || null;
}

/* ---------------------------------------------------------------------------
   Creating and joining
   --------------------------------------------------------------------------- */

function createRoom(rawSettings, hostName, socketId) {
  if (rooms.size >= MAX_ROOMS) {
    return { ok: false, reason: 'The server is busy with other games. Please try again in a minute.' };
  }

  let code = validation.generateCode();
  let guard = 0;
  while (rooms.has(code) && guard < 50) {
    code = validation.generateCode();
    guard += 1;
  }

  const settings = validation.cleanSettings(rawSettings);

  const room = {
    code: code,
    hostId: null,
    status: 'lobby', // lobby -> playing -> finished
    settings: settings,
    players: [],
    game: null,
    actionLog: validation.createActionLog(),
    createdAt: Date.now(),
    lastActivity: Date.now(),
    emptySince: null,
    /* When the host's seat went quiet. The janitor uses this to hand the role
       to somebody who is still here, so a room is never stranded. */
    hostAwaySince: null
  };

  const host = addPlayer(room, hostName, socketId);
  const promoted = promotionNeeded(room);
  if (promoted) room.hostId = promoted.id;

  rooms.set(code, room);

  return { ok: true, room: room, player: host };
}

/* Names are shown to everyone, and the wallet's "money trail" is grouped by
   name, so two people in one room must never share one. "Ana" becomes
   "Ana 2", then "Ana 3", and so on — always inside the name length limit. */
function uniqueName(room, desired, exceptPlayerId) {
  const base = validation.sanitiseName(desired); // already trimmed to NAME_MAX
  let candidate = base;
  let suffix = 2;

  const taken = function (value) {
    return room.players.some(function (player) {
      return player.id !== exceptPlayerId && player.connected && player.name.toLowerCase() === value.toLowerCase();
    });
  };

  while (taken(candidate) && suffix < 100) {
    const tag = ' ' + suffix;
    candidate = base.slice(0, Math.max(1, validation.NAME_MAX - tag.length)) + tag;
    suffix += 1;
  }

  return candidate;
}

function addPlayer(room, name, socketId) {
  const player = {
    /* Two different random values, on purpose:
         id    — PUBLIC. Every player in the room sees it, and the game state
                 (whose turn it is, who owns what) is built on it.
         token — PRIVATE. Sent once, to this seat's own socket, and never
                 included in anything broadcast. It is the key to the seat, so
                 a player cannot present somebody else's public id to reclaim
                 their seat while they are briefly disconnected. */
    id: crypto.randomUUID(),
    token: crypto.randomUUID(),
    name: uniqueName(room, name, null),
    socketId: socketId,
    connected: true,
    joinedAt: Date.now()
  };

  room.players.push(player);
  socketIndex.set(socketId, { code: room.code, playerId: player.id });
  room.lastActivity = Date.now();

  if (!room.hostId) {
    room.hostId = player.id;
    room.hostAwaySince = null;
  }

  return player;
}

/* Who should be host if the current host has gone? Keeps a room usable when the
   host closes their laptop mid-lobby. */
function promotionNeeded(room) {
  const currentHost = room.players.find(function (player) {
    return player.id === room.hostId;
  });

  if (currentHost) return null;

  return room.players.find(function (player) {
    return player.connected;
  }) || room.players[0] || null;
}

/* options may contain:
     tokens: []  private seat keys this device remembers for the room
     reclaim:    true when this is an automatic reclaim (a refresh), not a
                 deliberate join with a name the player just typed

   Only a private token can reclaim a seat. A public player id is refused, even
   when it is correct, because every client in the room can see those.

   The server — not the browser — decides which seat to hand back: the first
   remembered seat that nobody is currently playing. That is what stops two
   tabs on one device from stealing each other's seat after a refresh. */
function joinRoom(code, name, socketId, options) {
  const opts = options || {};
  const room = getRoom(code);
  /* True when this player's remembered seat is being played elsewhere, so they
     are given a fresh seat instead. The server says so out loud. */
  let seatWasBusy = false;

  if (!room) return { ok: false, reason: 'No room with that code. Check the code and try again.' };

  const tokens = (opts.tokens || []).filter(function (token) {
    return typeof token === 'string' && token.length > 10;
  });

  if (tokens.length > 0) {
    const seats = tokens.map(function (token) {
      return room.players.find(function (player) { return player.token === token; }) || null;
    });

    /* A seat that is already being played elsewhere must not be taken over: a
       guessed player id should never be able to push someone out. */
    const free = seats.find(function (seat) {
      return seat && (!seat.connected || seat.socketId === socketId);
    });

    if (free) {
      if (free.socketId && free.socketId !== socketId) socketIndex.delete(free.socketId);
      free.socketId = socketId;
      free.connected = true;

      /* A reclaim keeps the name already on the seat. Only a deliberate join
         may change it. */
      if (name && !opts.reclaim) free.name = uniqueName(room, name, free.id);

      socketIndex.set(socketId, { code: room.code, playerId: free.id });
      room.lastActivity = Date.now();
      room.emptySince = null;

      /* The host is back, so the role stops looking for a new owner. */
      if (free.id === room.hostId) room.hostAwaySince = null;

      return { ok: true, room: room, player: free, rejoined: true };
    }

    /* A seat key that fits nothing, or fits a seat somebody is playing, is a
       hint rather than a demand:

         • an AUTOMATIC reclaim must never quietly become a new player — that
           would abandon the seat, and the money on it — so it is refused;
         • a DELIBERATE join just means "let me in", so it carries on as a new
           player (and is told why, so nobody wonders what happened). */
    const anySeatExists = seats.some(Boolean);

    if (anySeatExists) {
      if (opts.reclaim) {
        return {
          ok: false,
          reason: 'Your seat is already open in another tab or on another device. Type a name to join as a new player.',
          seatInUse: true
        };
      }

      seatWasBusy = true;
    }

    /* Keys from a room that has since been cleared fit nothing at all. Carry on
       and treat this as a fresh join. */
  }

  if (room.status !== 'lobby') {
    return { ok: false, reason: 'That match has already started. Ask the host for a new room.' };
  }

  if (room.players.length >= room.settings.maxPlayers) {
    return { ok: false, reason: 'That room is full.' };
  }

  const player = addPlayer(room, name, socketId);
  room.emptySince = null;

  return { ok: true, room: room, player: player, seatWasBusy: seatWasBusy };
}

/* ---------------------------------------------------------------------------
   Leaving
   --------------------------------------------------------------------------- */

/* A disconnection is not a departure: the seat is kept so a refresh does not
   lose your money. A deliberate "leave" does remove you. */
function markDisconnected(socketId) {
  const membership = socketIndex.get(socketId);
  socketIndex.delete(socketId);

  if (!membership) return null;

  const room = getRoom(membership.code);
  if (!room) return null;

  const player = room.players.find(function (item) {
    return item.id === membership.playerId;
  });

  if (player) {
    player.connected = false;
    player.socketId = null;
  }

  room.lastActivity = Date.now();

  if (!room.players.some(function (item) { return item.connected; })) {
    room.emptySince = Date.now();
  }

  /* Start the clock on an absent host. A refresh takes a second or two, so the
     role is not snatched away instantly — cleanup.js hands it over only after
     a grace period, and only to somebody who is actually here. */
  if (room.hostId === membership.playerId) room.hostAwaySince = Date.now();

  /* A disconnected host in a running match hands over straight away, so play
     can continue without waiting for the janitor. */
  if (room.status === 'playing') promoteHost(room);

  return { room: room, player: player };
}

function leaveRoom(socketId) {
  const membership = socketIndex.get(socketId);
  socketIndex.delete(socketId);

  if (!membership) return null;

  const room = getRoom(membership.code);
  if (!room) return null;

  const player = room.players.find(function (item) {
    return item.id === membership.playerId;
  });

  /* Before the match starts, leaving frees the seat completely. */
  if (room.status === 'lobby') {
    room.players = room.players.filter(function (item) {
      return item.id !== membership.playerId;
    });
  } else if (player) {
    player.connected = false;
    player.socketId = null;
  }

  if (room.hostId === membership.playerId) {
    /* Leaving on purpose is immediate: hand the role to whoever is here. */
    const promoted = promotionNeeded(room);
    room.hostId = promoted ? promoted.id : null;
    room.hostAwaySince = null;
  }

  room.lastActivity = Date.now();

  if (!room.players.some(function (item) { return item.connected; })) {
    room.emptySince = Date.now();
  }

  return { room: room, player: player };
}

/* Give the host role to a connected player when the seat that held it has gone.
   Returns the new host, or null when nothing changed. Only cleanup.js calls
   this, and only when its grace period has passed. */
function promoteHost(room) {
  const replacement = room.players.find(function (player) {
    return player.connected && player.id !== room.hostId;
  });

  if (!replacement) return null;

  room.hostId = replacement.id;
  room.hostAwaySince = null;
  return replacement;
}

/* Called by the sweeper now and then so the rate-limit maps do not grow for
   the life of the process. */
function pruneLimiters() {
  let removed = 0;
  Object.keys(limiters).forEach(function (name) {
    if (typeof limiters[name].prune === 'function') {
      removed += limiters[name].prune();
    }
  });
  return removed;
}

function deleteRoom(code) {
  const room = getRoom(code);
  if (!room) return null;

  room.players.forEach(function (player) {
    if (player.socketId) socketIndex.delete(player.socketId);
  });

  rooms.delete(code);
  return room;
}

/* ---------------------------------------------------------------------------
   Settings and starting
   --------------------------------------------------------------------------- */

function updateSettings(socketId, rawSettings) {
  const membership = socketIndex.get(socketId);
  const room = membership ? getRoom(membership.code) : null;
  if (!room) return { ok: false, reason: 'You are not in a room' };
  if (room.hostId !== membership.playerId) return { ok: false, reason: 'Only the host can change settings' };
  if (room.status !== 'lobby') return { ok: false, reason: 'Settings are locked once the match starts' };

  const cleaned = validation.cleanSettings(Object.assign({}, room.settings, rawSettings));

  /* Never let the room shrink below the number of people already seated. */
  cleaned.maxPlayers = Math.max(cleaned.maxPlayers, room.players.length);

  room.settings = cleaned;
  room.lastActivity = Date.now();

  return { ok: true, room: room };
}

function startGame(socketId) {
  const membership = socketIndex.get(socketId);
  const room = membership ? getRoom(membership.code) : null;
  if (!room) return { ok: false, reason: 'You are not in a room' };
  if (room.hostId !== membership.playerId) return { ok: false, reason: 'Only the host can start the match' };
  if (room.status === 'playing') return { ok: false, reason: 'The match has already started' };

  const seated = room.players.filter(function (player) {
    return player.connected;
  });

  if (seated.length < validation.MIN_PLAYERS) {
    return { ok: false, reason: 'You need at least ' + validation.MIN_PLAYERS + ' players to start' };
  }

  /* Only connected players take seats. Someone who wandered off is not dealt in. */
  room.players = seated;
  room.game = engine.createGame(room.code, room.settings, room.players);
  room.status = 'playing';
  room.lastActivity = Date.now();

  return { ok: true, room: room };
}

/* After a finished match the host can run it back with the same people. */
function rematch(socketId) {
  const membership = socketIndex.get(socketId);
  const room = membership ? getRoom(membership.code) : null;
  if (!room) return { ok: false, reason: 'You are not in a room' };
  if (room.hostId !== membership.playerId) return { ok: false, reason: 'Only the host can start a rematch' };
  if (room.status !== 'finished') return { ok: false, reason: 'This match is still being played' };

  room.players = room.players.filter(function (player) {
    return player.connected;
  });

  if (room.players.length < validation.MIN_PLAYERS) {
    return { ok: false, reason: 'Not enough players are still here for a rematch' };
  }

  room.game = null;
  room.status = 'lobby';
  room.actionLog = validation.createActionLog();
  room.lastActivity = Date.now();

  return { ok: true, room: room };
}

function markFinished(room) {
  if (room.status === 'playing' && room.game && room.game.finishedAt) {
    room.status = 'finished';
    room.lastActivity = Date.now();
  }
}

module.exports = {
  allRooms: allRooms,
  getRoom: getRoom,
  countRooms: countRooms,
  membershipOf: membershipOf,
  limiters: limiters,
  createRoom: createRoom,
  joinRoom: joinRoom,
  uniqueName: uniqueName,
  promoteHost: promoteHost,
  markDisconnected: markDisconnected,
  leaveRoom: leaveRoom,
  deleteRoom: deleteRoom,
  pruneLimiters: pruneLimiters,
  updateSettings: updateSettings,
  startGame: startGame,
  rematch: rematch,
  markFinished: markFinished
};
