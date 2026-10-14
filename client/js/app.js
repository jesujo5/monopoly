/* ==========================================================================
   app.js — the starting point.

   It starts every screen, listens to the server, and decides which screen to
   show based on what the server says is happening. The server is always the
   authority: this file only reacts to it.
   ========================================================================== */

window.EE = window.EE || {};

(function () {
  'use strict';

  var state = EE.state;
  var nav = EE.nav;

  /* A room code in the address bar means an invitation link was opened. */
  function roomCodeFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var code = (params.get('room') || '').toUpperCase();
    var kept = '';

    for (var i = 0; i < code.length; i++) {
      if (EE.CONFIG.CODE_ALPHABET.indexOf(code.charAt(i)) !== -1) kept += code.charAt(i);
    }

    return kept.slice(0, EE.CONFIG.CODE_LENGTH);
  }

  /* Which screen the current server state belongs to. */
  function viewForStatus(status) {
    if (status === 'playing') return 'game';
    if (status === 'finished') return 'results';
    if (status === 'lobby') return 'lobby';
    return null;
  }

  function renderAll() {
    var sync = state.getSync();
    if (!sync) return;

    var previous = lastSync;
    lastSync = sync;

    var view = viewForStatus(sync.status);

    if (view === 'game') {
      EE.board.render(sync, previous);
      EE.bankingUI.render();
      EE.gameUI.render(sync, previous);
      EE.propertyUI.renderTrade();
      EE.propertyUI.syncTrades(sync, previous);
    } else if (view === 'results') {
      EE.gameUI.render(sync, previous);
      EE.board.render(sync, previous);
    } else if (view === 'lobby') {
      EE.lobby.renderLobby();
    }

    if (view && nav.current() !== view) nav.showView(view, { updateHash: false });
  }

  var lastSync = null;
  var reconnectAttempts = 0;

  /* ------------------------------------------------------------------ */
  /* Server messages                                                     */
  /* ------------------------------------------------------------------ */

  function wireServer() {
    EE.net.on('welcome', function (welcome) {
      reconnectAttempts = 0;

      if (welcome.rejoined) {
        EE.notify.toast('Welcome back — your seat and money are waiting', 'good');
      }

      /* Put the room code in the address bar. This is what makes a refresh able
         to reclaim the seat, even if the browser cleared its tab storage. */
      var url = new URL(window.location.href);
      if (url.searchParams.get('room') !== welcome.code) {
        url.searchParams.set('room', welcome.code);
        window.history.replaceState(null, '', url.toString());
      }
    });

    EE.net.on('sync', function () {
      renderAll();
    });

    EE.net.on('board', function () {
      renderAll();
    });

    EE.net.on('join_failed', function (failure) {
      var recoveringFromRefresh = EE.net.wasAutoJoin() || failure.auto === true;
      EE.net.resetAutoJoin();

      /* A seat that is merely busy is the one case worth waiting for: the socket
         that held it can take a moment to be noticed as gone. Anything else
         (no such room, a finished match, a room that is full) will not fix
         itself, so the player goes straight to the join form. */
      if (recoveringFromRefresh && failure.code && failure.seatInUse) {
        if (reconnectAttempts < 3) {
          reconnectAttempts += 1;
          EE.notify.toast('Getting your seat back…', 'warn', 3000);
          EE.notify.setConnection('busy', 'Getting your seat back…');
          window.setTimeout(function () {
            EE.net.rejoin(failure.code);
          }, 2500 * reconnectAttempts);
          return;
        }

        /* Still not free. Do not invent a new player and leave the old seat
           holding money: explain, and put the player somewhere they can act. */
        reconnectAttempts = 0;
        EE.notify.toast(failure.reason, 'error', 7000);

        var blockedCode = failure.code || roomCodeFromUrl();
        if (blockedCode) document.getElementById('join-code').value = blockedCode;

        var blockedNote = document.getElementById('join-note');
        blockedNote.hidden = false;
        blockedNote.textContent = 'Your seat is still open in another tab or on another device. Close that one and press Join room to take it back — or type a different name to join as a new player.';

        nav.showView('join');
        return;
      }

      /* An automatic reclaim that cannot succeed — the room was cleared away, or
         the match has already started — lands on the join form with the code
         ready, instead of retrying something that will never work. */
      if (recoveringFromRefresh && failure.code) {
        reconnectAttempts = 0;
        EE.notify.toast(failure.reason, 'warn', 6000);
        document.getElementById('join-code').value = failure.code;

        var goneNote = document.getElementById('join-note');
        goneNote.hidden = false;
        goneNote.textContent = failure.reason + ' Press Join room to start again, or use the menu to host a fresh room.';

        nav.showView('join');
        return;
      }

      EE.notify.toast(failure.reason, 'error', 4200);

      if (nav.current() === 'host' || nav.current() === 'join') {
        var target = nav.current() === 'join' ? document.getElementById('join-note') : document.getElementById('host-note');
        if (target) {
          target.hidden = false;
          target.textContent = failure.reason;
        }
      } else {
        nav.showView('menu');
      }
    });

    EE.net.on('room_closed', function () {
      lastSync = null;
      nav.showView('menu');
    });

    EE.net.on('left', function () {
      lastSync = null;
      nav.showView('menu');
      EE.notify.toast('You left the room', 'info', 2000);
    });

    EE.net.on('disconnected', function () {
      /* Nothing to do: the banner already explains it. */
    });

    EE.net.on('connected', function () {
      if (!state.getSeat()) EE.notify.toast('Connected to the game server', 'good', 2000);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Start                                                               */
  /* ------------------------------------------------------------------ */

  function start() {
    EE.notify.init();
    nav.init();
    EE.lobby.init();
    EE.board.init();
    EE.bankingUI.init();
    EE.propertyUI.init();
    EE.gameUI.init();

    document.getElementById('version-line').textContent = EE.CONFIG.GAME_NAME + ' · v' + EE.CONFIG.VERSION;
    document.getElementById('footer-version').textContent = EE.CONFIG.GAME_NAME + ' v' + EE.CONFIG.VERSION;

    /* The welcome note names the version too, so a stale tab is easy to spot. */
    document.getElementById('menu-note').textContent =
      'Free to run, no accounts, no ads. Rooms are temporary — the server deletes a match when it ends.';

    wireServer();
    EE.net.connect();
    EE.notify.setConnection('busy', 'Connecting to the game server…');

    /* Someone opened an invitation link, or refreshed a page with a room code
       in the address. If this device already held a seat in that room, reclaim
       it; otherwise show the join form with the code filled in. */
    var invitedCode = roomCodeFromUrl();

    /* Only a seat this tab can prove it held is reclaimed automatically. The
       seats the device remembers are offered to the JOIN form instead, where a
       person chooses to use them. */
    var ownSeats = invitedCode ? state.getOwnSeats(invitedCode) : [];
    var deviceSeats = invitedCode ? state.getRememberedSeats(invitedCode) : [];

    if (invitedCode && ownSeats.length > 0) {
      nav.showView('menu');
      EE.net.rejoin(invitedCode);
    } else if (invitedCode) {
      document.getElementById('join-code').value = invitedCode;
      document.getElementById('join-note').hidden = false;
      document.getElementById('join-note').textContent = deviceSeats.length > 0
        ? 'Type your name and press Join room. This device remembers your seat in this room — you will get it back if nobody is using it.'
        : 'Type your name and press Join room. The code is already filled in.';
      nav.showView('join');
    } else if (state.getSeat() && state.getSeat().code) {
      /* The tab still remembers its seat key: ask to be put back in it. */
      nav.showView('menu');
      EE.net.rejoin(state.getSeat().code);
    } else {
      nav.showView('menu');
    }

    /* Open a section straight from the address bar, e.g. #host. */
    var hash = (window.location.hash || '').replace('#', '');
    if (!invitedCode && ['host', 'join'].indexOf(hash) !== -1) nav.showView(hash);
  }

  document.addEventListener('DOMContentLoaded', start);
})();
