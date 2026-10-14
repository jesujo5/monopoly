'use strict';

/**
 * cleanup.js — the janitor.
 *
 * Two jobs, both of which exist so the server's memory stays small and the free
 * hosting tier keeps working:
 *
 *   1. Turn timers. Once a second, if a room has a turn timer and time is up,
 *      the server ends the turn for the player. The browser never decides this.
 *   2. Deleting temporary rooms. When everyone has gone, or a finished match is
 *      abandoned, the room object is thrown away. That is the whole "temporary
 *      game data" promise — there is no copy anywhere else to delete.
 */

const engine = require('./game-engine');
const roomsModule = require('./rooms');

/* How long we keep things around. All of it is temporary by design. */
const EMPTY_LOBBY_GRACE_MS = 60 * 60 * 1000; // 1 hour of nobody being in a lobby
const EMPTY_MATCH_GRACE_MS = 10 * 60 * 1000; // 10 minutes with nobody connected
const FINISHED_GRACE_MS = 5 * 60 * 1000; // 5 minutes to look at the results

/* How long an absent host keeps the role. Long enough that a page refresh, a
   phone locking its screen, or a couple of seconds of bad signal do not hand
   the room to somebody else; short enough that a lobby is never stranded. */
const HOST_HANDOVER_MS = 20 * 1000;

let timer = null;

/* Should this room be deleted, and why?

   A pure function of the room and the clock, so the rules that decide when a
   match is thrown away can be tested without waiting an hour. Returns null when
   the room should be kept. */
function deletionReason(room, now) {
  const nobodyConnected = !room.players.some(function (player) {
    return player.connected;
  });

  if (!nobodyConnected) return null;

  const emptyFor = room.emptySince ? now - room.emptySince : 0;
  const quietFor = now - room.lastActivity;

  if (room.status === 'finished' && emptyFor > FINISHED_GRACE_MS) return 'finished';
  if (room.status === 'playing' && emptyFor > EMPTY_MATCH_GRACE_MS) return 'abandoned-match';
  if (room.status === 'lobby' && (emptyFor > EMPTY_LOBBY_GRACE_MS || quietFor > EMPTY_LOBBY_GRACE_MS)) return 'empty-lobby';

  return null;
}

/* Should the host role move to somebody who is still here?

   A pure function of the room and the clock, so the rule can be tested without
   waiting twenty seconds. Returns false when the room should be left alone:

     • the host's seat is connected (nothing to do);
     • nobody else is connected (nobody to hand it to);
     • the host has only just gone (a refresh is probably on its way).

   If the host's seat has been removed altogether, the role moves at once. */
function hostHandoverDue(room, now) {
  const host = room.players.find(function (player) {
    return player.id === room.hostId;
  });

  if (host && host.connected) return false;

  const someoneElse = room.players.some(function (player) {
    return player.connected && player.id !== room.hostId;
  });

  if (!someoneElse) return false;

  /* The seat is gone entirely: hand over now rather than leave a dead room. */
  if (!host) return true;

  const awaySince = room.hostAwaySince || now;
  return now - awaySince >= HOST_HANDOVER_MS;
}

function start(options) {
  const onChanged = (options && options.onChanged) || function () {};
  const onDeleted = (options && options.onDeleted) || function () {};
  let ticks = 0;

  stop();

  timer = setInterval(function () {
    ticks += 1;
    const now = Date.now();

    roomsModule.allRooms().forEach(function (room) {
      /* ---- 1. A host who never comes back must not strand the room ---- */
      if (hostHandoverDue(room, now) && roomsModule.promoteHost(room)) {
        console.log('Room ' + room.code + ' handed the host role to ' + room.hostId);
        onChanged(room);
      }

      /* ---- 2. Turn timers ---- */
      if (room.status === 'playing' && room.game && !room.game.finishedAt) {
        engine.expireTrades(room.game);

        if (room.game.turnDeadlineAt && now >= room.game.turnDeadlineAt) {
          engine.forceEndTurn(room.game);
        }

        /* If that finished the match, move the room into its "finished" state
           so the results screen and the rematch button appear. */
        if (room.game.finishedAt) {
          roomsModule.markFinished(room);
          onChanged(room);
        }
      }

      /* ---- 3. Deleting temporary rooms (checked less often) ---- */
      if (ticks % 5 !== 0) return;

      /* Start the clock the moment the last player goes. */
      if (!room.players.some(function (player) { return player.connected; }) && room.emptySince === null) {
        room.emptySince = now;
      }

      const reason = deletionReason(room, now);

      if (reason) {
        roomsModule.deleteRoom(room.code);
        onDeleted(room, reason); // the server tells anyone still listening
      }
    });

    /* Rate-limit buckets are per player, so they would otherwise accumulate for
       the life of the process. */
    if (ticks % 60 === 0) roomsModule.pruneLimiters();
  }, 1000);

  /* Do not hold the Node process open just for the janitor. */
  if (timer.unref) timer.unref();

  return stop;
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  start: start,
  stop: stop,
  deletionReason: deletionReason,
  hostHandoverDue: hostHandoverDue,
  EMPTY_LOBBY_GRACE_MS: EMPTY_LOBBY_GRACE_MS,
  EMPTY_MATCH_GRACE_MS: EMPTY_MATCH_GRACE_MS,
  FINISHED_GRACE_MS: FINISHED_GRACE_MS,
  HOST_HANDOVER_MS: HOST_HANDOVER_MS
};
