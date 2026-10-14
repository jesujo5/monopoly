/* ==========================================================================
   state.js — everything the browser knows.

   The rule here is simple: the server owns the truth, and this file is just a
   copy of the last message it sent. No screen invents its own numbers. When a
   new message arrives, applySync() replaces the copy and every listener
   redraws from it.
   ========================================================================== */

window.EE = window.EE || {};

EE.state = (function () {
  'use strict';

  var CONFIG = EE.CONFIG;

  var board = null; // sent once by the server: the 40 spaces and the groups
  var sync = null; // the latest room + game state
  /* The last game we saw, kept so the results screen can still be drawn after
     the server marks the room finished. */
  var lastGame = null;
  var seat = null; // who this tab is: { playerId, code, isHost }
  var settings = Object.assign({}, CONFIG.DEFAULT_SETTINGS);
  var prefs = Object.assign({}, CONFIG.DEFAULT_PREFS);

  var listeners = [];

  /* ------------------------------------------------------------------ */
  /* Storage that never throws                                          */
  /* ------------------------------------------------------------------ */

  function readStore(store, key) {
    try {
      var raw = store.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeStore(store, key, value) {
    try {
      store.setItem(key, JSON.stringify(value));
    } catch (error) {
      /* Private mode or a full quota: losing a saved preference is acceptable. */
    }
  }

  function dropFromStore(store, key) {
    try {
      store.removeItem(key);
    } catch (error) {
      /* ignore */
    }
  }

  /* Keep only keys we know, so old or edited saved data cannot leak in. */
  function tidy(raw, defaults) {
    var clean = Object.assign({}, defaults);
    if (!raw || typeof raw !== 'object') return clean;

    Object.keys(defaults).forEach(function (key) {
      var value = raw[key];
      if (value === undefined || value === null) return;

      if (typeof defaults[key] === 'number') {
        var number = Number(value);
        if (!Number.isNaN(number)) clean[key] = number;
      } else if (typeof defaults[key] === 'boolean') {
        clean[key] = value === true;
      } else if (typeof value === 'string') {
        clean[key] = value;
      }
    });

    return clean;
  }

  /* ------------------------------------------------------------------ */
  /* Loading and saving                                                  */
  /* ------------------------------------------------------------------ */

  settings = tidy(readStore(window.localStorage, CONFIG.STORAGE.settings), CONFIG.DEFAULT_SETTINGS);
  prefs = tidy(readStore(window.localStorage, CONFIG.STORAGE.prefs), CONFIG.DEFAULT_PREFS);
  seat = readStore(window.sessionStorage, CONFIG.STORAGE.seat);

  if (prefs.theme !== 'felt' && prefs.theme !== 'midnight' && prefs.theme !== 'parchment') {
    prefs.theme = CONFIG.DEFAULT_PREFS.theme;
  }
  if (prefs.motion !== 'full' && prefs.motion !== 'reduced') {
    prefs.motion = CONFIG.DEFAULT_PREFS.motion;
  }

  /* ------------------------------------------------------------------ */
  /* Listening for changes                                               */
  /* ------------------------------------------------------------------ */

  function subscribe(listener) {
    listeners.push(listener);
    return function unsubscribe() {
      listeners = listeners.filter(function (item) {
        return item !== listener;
      });
    };
  }

  function announce() {
    listeners.forEach(function (listener) {
      listener();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Board and room state                                                */
  /* ------------------------------------------------------------------ */

  function setBoard(newBoard) {
    board = newBoard;
    announce();
  }

  function getBoard() {
    return board;
  }

  function applySync(newSync) {
    sync = newSync;
    if (sync && sync.status === 'lobby') {
      /* Leaving the lobby clears any half-finished game view. */
      lastGame = null;
    } else if (sync && sync.game) {
      lastGame = sync.game;
    }
    announce();
  }

  function getSync() {
    return sync;
  }

  function getGame() {
    return sync && sync.game ? sync.game : null;
  }

  /* ------------------------------------------------------------------ */
  /* Who I am                                                            */
  /* ------------------------------------------------------------------ */

  /* window.name belongs to this tab alone: it survives a reload, and the other
     tabs on the same device cannot see it. That makes it the most reliable
     answer to "which seat was I?" after a refresh.

     Only the private seat key is stored here, never the player id: the key is
     what gets a seat back, and the id is public information.

     A seat here is { playerId, token, code }. playerId is who you are in the
     room; token is the private key to your seat. */
  function readTabSeat() {
    try {
      var raw = window.name;
      if (!raw || raw.charAt(0) !== '{') return null;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed.token === 'string' && typeof parsed.code === 'string') return parsed;
    } catch (error) {
      /* A name we did not write, or one that got mangled. Ignore it. */
    }
    return null;
  }

  function writeTabSeat(newSeat) {
    try {
      window.name = JSON.stringify({ token: newSeat.token, code: newSeat.code });
    } catch (error) {
      /* ignore */
    }
  }

  function setSeat(newSeat) {
    seat = newSeat;

    if (newSeat) {
      writeStore(window.sessionStorage, CONFIG.STORAGE.seat, newSeat);
      writeTabSeat(newSeat);
      /* Also remember the key per room, so a refresh can reclaim the seat. */
      if (newSeat.code && newSeat.token) {
        rememberSeat(newSeat.code, newSeat.token);
      }
    } else {
      dropFromStore(window.sessionStorage, CONFIG.STORAGE.seat);
      try {
        window.name = '';
      } catch (error) {
        /* ignore */
      }
    }

    announce();
  }

  /* The seat this exact tab was using, if any. */
  function getTabSeat() {
    return readTabSeat();
  }

  /* Seat KEYS this device has held in a room, most recent first.
     A list rather than a single value, because two people can play from the
     same device in two tabs — each should get their own seat back. */
  function rememberSeat(code, token) {
    if (!code || !token) return;

    var list = getRememberedSeats(code).filter(function (id) {
      return id !== token;
    });

    list.unshift(token);
    writeStore(window.localStorage, CONFIG.STORAGE.seatPrefix + code, list.slice(0, 3));
  }

  /* Every seat key this DEVICE has used in a room. Shared by all the tabs of
     this browser, which is exactly why it is used to fill in the join form but
     never to reclaim a seat automatically. */
  function getRememberedSeats(code) {
    if (!code) return [];

    var remembered = readStore(window.localStorage, CONFIG.STORAGE.seatPrefix + code);

    if (typeof remembered === 'string' && remembered.length > 10) return [remembered]; /* older format */
    if (!Array.isArray(remembered)) return [];

    return remembered.filter(function (id) {
      return typeof id === 'string' && id.length > 10;
    });
  }

  /* The seat KEYS this tab can prove it held: the tab's own record in
     window.name first, then the seat this tab saved in sessionStorage. Both of
     those live per tab, so neither can belong to somebody else playing on the
     same device.

     The device-wide list from getRememberedSeats() is deliberately NOT part of
     this: it spans every tab, so using it automatically would let a refresh
     grab a friend's seat while their tab is briefly disconnected — which would
     swap two players' money, deeds and host role mid-match. */
  function getOwnSeats(code) {
    var own = [];
    var tabSeat = readTabSeat();

    if (tabSeat && tabSeat.code === code && tabSeat.token) own.push(tabSeat.token);
    if (seat && seat.code === code && seat.token) own.push(seat.token);

    return own.filter(function (id, index) {
      return id && own.indexOf(id) === index;
    });
  }

  function getSeat() {
    return seat;
  }

  function clearSeat() {
    setSeat(null);
  }

  function me() {
    if (!seat || !sync) return null;
    return sync.players.find(function (player) {
      return player.id === seat.playerId;
    }) || null;
  }

  function isHost() {
    return Boolean(sync && seat && sync.hostId === seat.playerId);
  }

  /* My player inside the running match (money, position, and so on). */
  function myGamePlayer() {
    var game = getGame();
    if (!game || !seat) return null;
    return game.players.find(function (player) {
      return player.id === seat.playerId;
    }) || null;
  }

  function gamePlayer(id) {
    var game = getGame();
    if (!game) return null;
    return game.players.find(function (player) {
      return player.id === id;
    }) || null;
  }

  function currentPlayer() {
    var game = getGame();
    return game ? gamePlayer(game.turnPlayerId) : null;
  }

  function isMyTurn() {
    var game = getGame();
    return Boolean(game && seat && game.turnPlayerId === seat.playerId);
  }

  /* ------------------------------------------------------------------ */
  /* Board lookups                                                       */
  /* ------------------------------------------------------------------ */

  function tileAt(index) {
    if (!board || !board.tiles) return null;
    return board.tiles[index] || null;
  }

  function buildingAt(index) {
    var game = getGame();
    if (!game || !game.buildings) return null;
    return game.buildings[index] || null;
  }

  function ownerAt(index) {
    var building = buildingAt(index);
    return building ? building.ownerId : null;
  }

  function groupTiles(groupId) {
    if (!board) return [];
    return board.tiles.filter(function (tile) {
      return tile.group === groupId;
    });
  }

  function ownsWholeGroup(groupId, playerId) {
    var tiles = groupTiles(groupId);
    return tiles.length > 0 && tiles.every(function (tile) {
      return ownerAt(tile.index) === playerId;
    });
  }

  function tilesOwnedBy(playerId) {
    if (!board) return [];
    return board.tiles.filter(function (tile) {
      return ownerAt(tile.index) === playerId;
    });
  }

  function isBuyable(tile) {
    return Boolean(tile) && ['property', 'transport', 'utility'].indexOf(tile.type) !== -1;
  }

  /* ------------------------------------------------------------------ */
  /* Settings and preferences                                            */
  /* ------------------------------------------------------------------ */

  function getSettings() {
    return Object.assign({}, settings);
  }

  function saveSettings(patch) {
    settings = tidy(Object.assign({}, settings, patch), CONFIG.DEFAULT_SETTINGS);
    writeStore(window.localStorage, CONFIG.STORAGE.settings, settings);
    announce();
  }

  function resetSettings() {
    settings = Object.assign({}, CONFIG.DEFAULT_SETTINGS);
    writeStore(window.localStorage, CONFIG.STORAGE.settings, settings);
    announce();
  }

  function getPrefs() {
    return Object.assign({}, prefs);
  }

  function savePrefs(patch) {
    prefs = tidy(Object.assign({}, prefs, patch), CONFIG.DEFAULT_PREFS);
    if (prefs.motion !== 'reduced') prefs.motion = 'full';
    writeStore(window.localStorage, CONFIG.STORAGE.prefs, prefs);
    announce();
  }

  /* ------------------------------------------------------------------ */
  /* Formatting shared by every screen                                   */
  /* ------------------------------------------------------------------ */

  function money(value) {
    return CONFIG.CURRENCY + Number(value || 0).toLocaleString('en-IN');
  }

  function getFinishedGame() {
    return getGame() || lastGame;
  }

  return {
    subscribe: subscribe,
    setBoard: setBoard,
    getBoard: getBoard,
    applySync: applySync,
    getSync: getSync,
    getGame: getGame,
    getFinishedGame: getFinishedGame,
    setSeat: setSeat,
    getSeat: getSeat,
    getTabSeat: getTabSeat,
    getOwnSeats: getOwnSeats,
    getRememberedSeats: getRememberedSeats,
    clearSeat: clearSeat,
    me: me,
    isHost: isHost,
    myGamePlayer: myGamePlayer,
    gamePlayer: gamePlayer,
    currentPlayer: currentPlayer,
    isMyTurn: isMyTurn,
    tileAt: tileAt,
    buildingAt: buildingAt,
    ownerAt: ownerAt,
    groupTiles: groupTiles,
    ownsWholeGroup: ownsWholeGroup,
    tilesOwnedBy: tilesOwnedBy,
    isBuyable: isBuyable,
    getSettings: getSettings,
    saveSettings: saveSettings,
    resetSettings: resetSettings,
    getPrefs: getPrefs,
    savePrefs: savePrefs,
    money: money
  };
})();
