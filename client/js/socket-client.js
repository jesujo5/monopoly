/* ==========================================================================
   socket-client.js — the only file that talks to the server.

   Everything else in the browser calls these small functions. If we ever swap
   Socket.IO for something else, this is the single file that changes.

   Two things to notice:
     • Actions carry a unique actionId. If a tap is sent twice, the server
       recognises the second copy and ignores it.
     • When the connection drops and comes back, we re-join with our stored seat
       so the player keeps their money and their turn.
   ========================================================================== */

window.EE = window.EE || {};

EE.net = (function () {
  'use strict';

  var socket = null;
  var handlers = {};
  var actionCounter = 0;
  var pending = false; // true between sending an action and the server answering
  var autoJoin = false; // the last join was an automatic seat reclaim
  var reclaimQueue = []; // private seat keys this tab can prove it holds
  var reclaim = null; // a prepared reclaim, sent once the socket is connected

  function on(event, handler) {
    if (!handlers[event]) handlers[event] = [];
    handlers[event].push(handler);
  }

  function raise(event, payload) {
    (handlers[event] || []).forEach(function (handler) {
      handler(payload);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Connecting                                                          */
  /* ------------------------------------------------------------------ */

  function connect() {
    if (socket) return socket;

    /* No URL means "the same address the page came from". Because this server
       also serves these files, there is nothing to configure — and no
       cross-origin problems in development or in production. */
    socket = window.io({ transports: ['websocket', 'polling'] });

    socket.on('connect', function () {
      EE.notify.setConnection('online');
      raise('connected');

      /* Reclaim the seat exactly once per connection. If a reclaim was already
         prepared (a page load), send that; otherwise use the seat this tab
         remembers. Sending both caused two joins for one connection. */
      if (reclaim) {
        sendReclaim();
      } else if (EE.state.getSeat() && EE.state.getSeat().code) {
        rejoin();
      }
    });

    /* From here on, joins are deliberate, not reclaims. */
    socket.on('welcome', function () {
      autoJoin = false;
      reclaimQueue = [];
      reclaim = null;
    });

    socket.on('disconnect', function () {
      EE.notify.setConnection('offline', 'Lost the connection. Your seat is kept — trying to reconnect…');
      raise('disconnected');
    });

    socket.on('connect_error', function () {
      /* On a free host this usually means the server is waking up. */
      EE.notify.setConnection('busy');
      raise('connection_error');
    });

    socket.on('board', function (board) {
      EE.state.setBoard(board);
      raise('board', board);
    });

    socket.on('welcome', function (welcome) {
      /* playerId is public (the room sees it); token is this seat's private key
         and is never shared with anybody else. */
      EE.state.setSeat({
        playerId: welcome.playerId,
        token: welcome.token,
        code: welcome.code,
        isHost: welcome.isHost
      });
      raise('welcome', welcome);
    });

    socket.on('sync', function (payload) {
      pending = false;
      var previous = EE.state.getSync();
      EE.state.applySync(payload);
      raise('sync', { next: payload, previous: previous });
    });

    socket.on('notice', function (notice) {
      EE.notify.toast(notice.message, notice.kind === 'warn' ? 'warn' : notice.kind === 'good' ? 'good' : 'error');
      raise('notice', notice);
    });

    socket.on('join_failed', function (failure) {
      pending = false;

      /* Was this an automatic seat reclaim rather than a typed-in join? That is
         the app's cue to keep trying and put the player back in their game
         instead of dropping them on the join form. */
      var wasReclaim = autoJoin;
      var previous = EE.state.getSync();
      var hadMatch = Boolean(previous && previous.status && previous.status !== 'lobby');
      var code = reclaim ? reclaim.code : null;

      reclaim = null;

      /* A seat that is merely busy is still OURS: keep the record so a retry can
         ask for it again. Clearing it here is what used to throw away a seat
         that was only a couple of seconds away from being free. */
      if (!failure.seatInUse) EE.state.clearSeat();

      EE.notify.setConnection('online');

      raise('join_failed', Object.assign({}, failure, {
        hadMatch: hadMatch,
        auto: wasReclaim,
        code: code || (previous ? previous.code : null)
      }));
    });

    socket.on('room_closed', function (payload) {
      EE.state.clearSeat();
      EE.notify.toast(payload.reason || 'The room was closed', 'warn');
      raise('room_closed', payload);
    });

    socket.on('left', function () {
      raise('left');
    });

    return socket;
  }

  function retry() {
    if (socket) socket.connect();
  }

  function isOnline() {
    return Boolean(socket && socket.connected);
  }

  /* ------------------------------------------------------------------ */
  /* Joining                                                             */
  /* ------------------------------------------------------------------ */

  function joinHost(name, settings) {
    connect();
    pending = true;
    socket.emit('join', { name: name, settings: settings });
  }

  /* A deliberate join. The seats this device remembers for the room go along
     with it, so a player whose tab forgot its seat (a new tab, a restart) can
     slip back into their old seat — but only if nobody is playing it. */
  function joinRoom(name, code) {
    connect();
    pending = true;
    socket.emit('join', {
      name: name,
      code: code,
      tokens: EE.state.getRememberedSeats(code),
      reused: true
    });
  }

  /* Reclaim a seat. This runs when a page is refreshed, so the player keeps
     their money and their turn instead of starting again.

     code and playerId can be given explicitly, which is how a refresh works
     when the browser has cleared its short-lived tab storage. */
  function rejoin(code) {
    var seat = EE.state.getSeat();
    var roomCode = code || (seat && seat.code);
    if (!roomCode) return false;

    /* ONLY seats this tab can prove are its own. The device-wide list is left
       out on purpose: it spans every tab, so falling back to it automatically
       lets a refresh take a friend's seat whenever their tab has briefly
       dropped out — swapping two players' money, deeds and host role in a
       match that is already running. Asking for a seat we do not own is worse
       than asking for nothing: the join form is a safe place to land. */
    var candidates = EE.state.getOwnSeats(roomCode);
    if (candidates.length === 0) return false;

    connect();

    reclaimQueue = candidates;
    reclaim = { code: roomCode, tokens: reclaimQueue };

    if (socket.connected) sendReclaim();
    return true;
  }

  function sendReclaim() {
    if (!reclaim) return;

    autoJoin = true;
    socket.emit('join', {
      name: EE.state.getPrefs().playerName || 'Player',
      code: reclaim.code,
      tokens: reclaim.tokens,
      auto: true
    });

    reclaim = null; // one attempt per connection
  }

  /* True when the last join was an automatic reclaim rather than a player
     pressing Join. Used to fall back to the join form politely. */
  function wasAutoJoin() {
    return autoJoin;
  }

  function resetAutoJoin() {
    autoJoin = false;
  }

  /* ------------------------------------------------------------------ */
  /* Room controls (validated again on the server)                       */
  /* ------------------------------------------------------------------ */

  function sendSettings(settings) {
    if (!socket) return;
    socket.emit('settings', { settings: settings });
  }

  function start() {
    if (socket) socket.emit('start');
  }

  function rematch() {
    if (socket) socket.emit('rematch');
  }

  function leave() {
    if (!socket) return;
    socket.emit('leave');
    EE.state.clearSeat();
  }

  function close() {
    if (socket) socket.emit('close');
    EE.state.clearSeat();
  }

  /* ------------------------------------------------------------------ */
  /* Game actions                                                        */
  /* ------------------------------------------------------------------ */

  function sendAction(type, extra) {
    if (!socket || !socket.connected) {
      EE.notify.toast('Not connected to the server yet', 'error');
      return false;
    }
    if (pending) return false; // one action at a time, so nothing doubles up

    actionCounter += 1;
    pending = true;

    socket.emit('action', Object.assign({
      type: type,
      actionId: 'a' + Date.now() + '-' + actionCounter
    }, extra || {}));

    /* If the answer never arrives (a dropped connection), stop blocking. */
    window.setTimeout(function () {
      pending = false;
    }, 4000);

    return true;
  }

  return {
    on: on,
    wasAutoJoin: wasAutoJoin,
    resetAutoJoin: resetAutoJoin,
    connect: connect,
    retry: retry,
    isOnline: isOnline,
    joinHost: joinHost,
    joinRoom: joinRoom,
    rejoin: rejoin,
    sendSettings: sendSettings,
    start: start,
    rematch: rematch,
    leave: leave,
    close: close,
    sendAction: sendAction
  };
})();
