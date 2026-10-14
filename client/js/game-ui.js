/* ==========================================================================
   game-ui.js — the controls and readouts around the board.

   The action bar only ever sends requests. If a button is enabled when it
   should not be, the server still refuses the action and the reason appears as
   a toast — that is the whole point of an authoritative server.
   ========================================================================== */

window.EE = window.EE || {};

EE.gameUI = (function () {
  'use strict';

  var state = EE.state;
  var els = {};
  var timerHandle = null;

  /* ------------------------------------------------------------------ */
  /* The turn banner and action bar                                      */
  /* ------------------------------------------------------------------ */

  function renderTurn(sync) {
    var game = sync.game;
    var current = game.players.find(function (player) { return player.id === game.turnPlayerId; });
    var mine = state.myGamePlayer();

    els.turnDot.style.background = current ? current.colour : 'var(--muted)';
    els.turnRound.textContent = 'Round ' + game.round;

    if (game.pot > 0 && game.settings.freeParkingPot) {
      els.turnPot.hidden = false;
      els.turnPot.textContent = 'Jackpot ' + state.money(game.pot);
    } else {
      els.turnPot.hidden = true;
    }

    var isMine = current && mine && current.id === mine.id;

    if (game.finishedAt) {
      els.turnText.textContent = 'The match is over';
    } else if (isMine) {
      els.turnText.textContent = game.phase === 'roll' ? 'Your turn — roll the dice' : 'Your turn — buy, build or end your turn';
    } else {
      els.turnText.textContent = (current ? current.name : 'Someone') + ' is playing' + (game.phase === 'roll' ? ' — rolling' : ' — deciding');
    }

    renderActionBar(game, current, mine);
    renderTimer(game);
  }

  function renderActionBar(game, current, mine) {
    var myTurn = Boolean(mine && current && current.id === mine.id && !game.finishedAt);
    var tile = mine ? state.tileAt(mine.position) : null;
    var building = mine ? state.buildingAt(mine.position) : null;

    /* Roll */
    var canRoll = myTurn && game.phase === 'roll';
    els.roll.hidden = false;
    els.roll.disabled = !canRoll;
    els.roll.textContent = mine && mine.inHold ? 'Try to leave the Hold' : game.doublesCount > 0 && myTurn ? 'Roll again' : 'Roll dice';

    /* Buy the space I am standing on */
    var canBuy = myTurn && game.phase !== 'roll' && tile && state.isBuyable(tile) && !building && mine.money >= tile.price;
    els.buy.hidden = !(tile && state.isBuyable(tile) && !building);
    if (!els.buy.hidden) {
      els.buy.disabled = !canBuy;
      els.buy.textContent = 'Buy ' + tile.name + ' for ' + state.money(tile.price);
    }

    /* Fine at the Harbour Hold */
    var canPay = myTurn && mine && mine.inHold && (mine.money >= state.getBoard().holdFine || mine.holdPasses > 0);
    els.fine.hidden = !(mine && mine.inHold);
    if (!els.fine.hidden) {
      els.fine.disabled = !canPay;
      els.fine.textContent = mine.holdPasses > 0
        ? 'Use a Hold pass'
        : 'Pay the fine (' + state.money(state.getBoard().holdFine) + ')';
    }

    /* End turn */
    els.end.disabled = !(myTurn && game.phase !== 'roll');
    els.end.textContent = game.doublesCount > 0 && myTurn ? 'End turn (no re-roll)' : 'End turn';

    /* Trade and properties */
    els.trade.disabled = !mine || !game.settings.trading || game.finishedAt;
    els.props.disabled = !mine;
  }

  function renderTimer(game) {
    if (timerHandle) {
      window.clearInterval(timerHandle);
      timerHandle = null;
    }

    if (!game.turnDeadlineAt || game.finishedAt) {
      els.turnTimer.hidden = true;
      return;
    }

    els.turnTimer.hidden = false;

    var tick = function () {
      var remaining = Math.max(0, Math.round((game.turnDeadlineAt - Date.now()) / 1000));
      els.turnTimer.textContent = remaining + 's';
      if (remaining <= 0) {
        els.turnTimer.textContent = 'time up';
        window.clearInterval(timerHandle);
        timerHandle = null;
      }
    };

    tick();
    timerHandle = window.setInterval(tick, 1000);
  }

  /* ------------------------------------------------------------------ */
  /* Players panel                                                       */
  /* ------------------------------------------------------------------ */

  function renderPlayers(sync) {
    var game = sync.game;
    els.players.textContent = '';
    els.players.className = 'player-list';

    game.players.forEach(function (player) {
      var row = document.createElement('div');
      row.className = 'player-row';
      if (player.id === game.turnPlayerId) row.className += ' player-row--turn';
      if (player.bankrupt) row.className += ' player-row--out';

      var swatch = document.createElement('span');
      swatch.className = 'player-swatch';
      swatch.style.background = player.colour;
      row.appendChild(swatch);

      var name = document.createElement('span');
      name.className = 'player-name';
      name.textContent = player.name;
      row.appendChild(name);

      var tags = document.createElement('span');
      tags.className = 'player-tags';
      if (player.inHold) tags.appendChild(chip('hold', 'bad'));
      if (player.bankrupt) tags.appendChild(chip('out', 'bad'));
      else tags.appendChild(chip(state.tilesOwnedBy(player.id).length + ' props'));
      row.appendChild(tags);

      var money = document.createElement('span');
      money.className = 'player-money';
      money.textContent = state.money(player.money);
      row.appendChild(money);

      els.players.appendChild(row);
    });
  }

  function chip(text, tone) {
    var element = document.createElement('span');
    element.className = 'chip' + (tone ? ' chip--' + tone : '');
    element.textContent = text;
    return element;
  }

  /* ------------------------------------------------------------------ */
  /* The feed                                                            */
  /* ------------------------------------------------------------------ */

  function renderFeed(sync) {
    var game = sync.game;
    els.feed.textContent = '';

    var entries = game.history.slice(-24).reverse();

    if (entries.length === 0) {
      var empty = document.createElement('p');
      empty.className = 'feed-empty';
      empty.textContent = 'Nothing has happened yet.';
      els.feed.appendChild(empty);
      return;
    }

    entries.forEach(function (entry) {
      var element = document.createElement('div');
      element.className = 'feed-entry feed-entry--' + (entry.kind || 'info');
      element.textContent = entry.text;
      els.feed.appendChild(element);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Sound cues for what changed                                         */
  /* ------------------------------------------------------------------ */

  function cueSounds(sync, previous) {
    if (!previous || !previous.game || !sync.game) return;

    var before = previous.game;
    var after = sync.game;

    if (before.turnPlayerId !== after.turnPlayerId) EE.notify.sound('turn');
    if (before.dice !== after.dice) EE.notify.sound('dice');

    if (after.ledger.length > before.ledger.length) {
      var mine = state.myGamePlayer();
      var newest = after.ledger[after.ledger.length - 1];
      if (mine && newest.from === mine.name) EE.notify.sound(newest.reason.indexOf('Rent') === 0 ? 'rent' : 'bad');
      else if (mine && newest.to === mine.name) EE.notify.sound('money');
    }

    if (after.lastCard && (!before.lastCard || before.lastCard.at !== after.lastCard.at)) {
      EE.notify.showCard(after.lastCard, function (modal) {
        /* A card is shown on top of everything, then closed by the player. */
        EE.nav.openModal(modal.id);
        modal.querySelector('[data-close]').addEventListener('click', function (event) {
          event.stopPropagation();
        });
      });
    }

    if (!before.finishedAt && after.finishedAt) {
      EE.notify.sound('win');
      EE.nav.closeAllModals();
    }

    if (after.trades.length > before.trades.length) EE.notify.sound('trade');
  }

  /* ------------------------------------------------------------------ */
  /* Results                                                             */
  /* ------------------------------------------------------------------ */

  function renderResults(sync) {
    var game = sync.game;
    var body = els.resultsBody;
    body.textContent = '';

    var winner = game.players.find(function (player) { return player.id === game.winnerId; });

    document.getElementById('results-reason').textContent = game.endReason || 'Match over';
    document.getElementById('results-winner').textContent = winner ? winner.name : 'Nobody';
    document.getElementById('results-dot').style.background = winner ? winner.colour : 'var(--muted)';

    var ranked = game.players.slice().sort(function (a, b) {
      if (a.bankrupt !== b.bankrupt) return a.bankrupt ? 1 : -1;
      return b.netWorth - a.netWorth;
    });

    ranked.forEach(function (player) {
      var row = document.createElement('tr');

      var name = document.createElement('td');
      name.textContent = player.name + (player.id === game.winnerId ? ' 🏆' : '');

      var worth = document.createElement('td');
      worth.textContent = state.money(player.netWorth);

      var props = document.createElement('td');
      props.textContent = String(state.tilesOwnedBy(player.id).length);

      var status = document.createElement('td');
      status.textContent = player.bankrupt ? 'Out' : player.id === game.winnerId ? 'Winner' : 'Solvent';

      row.appendChild(name);
      row.appendChild(worth);
      row.appendChild(props);
      row.appendChild(status);
      body.appendChild(row);
    });

    var host = state.isHost();
    els.resultsRematch.hidden = !host;
    els.resultsClose.hidden = !host;
    els.resultsRematch.disabled = sync.players.length < sync.minPlayers;

    if (!host) {
      var note = document.querySelector('#results-rematch');
      if (note) note.textContent = 'Play again';
    }
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */

  function bindActions() {
    els.roll.addEventListener('click', function () {
      EE.net.sendAction('roll');
    });

    els.buy.addEventListener('click', function () {
      var mine = state.myGamePlayer();
      if (mine) EE.net.sendAction('buy', { tile: mine.position });
    });

    els.fine.addEventListener('click', function () {
      EE.net.sendAction('pay_fine');
    });

    els.end.addEventListener('click', function () {
      EE.net.sendAction('end_turn');
    });

    els.leave.addEventListener('click', function () {
      var game = state.getGame();
      var playing = game && !game.finishedAt;
      if (playing && !window.confirm('Leave this match? Your seat stays open so you can come back, but the others carry on without you.')) {
        return;
      }
      EE.net.leave();
    });

    els.resultsRematch.addEventListener('click', function () {
      EE.net.rematch();
    });

    els.resultsClose.addEventListener('click', function () {
      if (window.confirm('Close the room? This deletes the match for everyone.')) EE.net.close();
    });

    els.resultsMenu.addEventListener('click', function () {
      EE.net.leave();
    });
  }

  function init() {
    els = {
      turnText: document.getElementById('turn-text'),
      turnDot: document.getElementById('turn-dot'),
      turnRound: document.getElementById('turn-round'),
      turnPot: document.getElementById('turn-pot'),
      turnTimer: document.getElementById('turn-timer'),
      players: document.getElementById('players-panel'),
      feed: document.getElementById('history-feed'),
      roll: document.getElementById('btn-roll'),
      buy: document.getElementById('btn-buy'),
      fine: document.getElementById('btn-fine'),
      trade: document.getElementById('btn-trade'),
      props: document.getElementById('btn-props'),
      end: document.getElementById('btn-end'),
      leave: document.getElementById('btn-leave'),
      resultsBody: document.getElementById('results-body'),
      resultsRematch: document.getElementById('results-rematch'),
      resultsClose: document.getElementById('results-close'),
      resultsMenu: document.getElementById('results-menu')
    };

    bindActions();
  }

  function render(sync, previous) {
    if (!sync.game) return;
    renderTurn(sync);
    renderPlayers(sync);
    renderFeed(sync);
    renderResults(sync);
    cueSounds(sync, previous);
  }

  return { init: init, render: render };
})();
