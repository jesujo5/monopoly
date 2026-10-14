/* ==========================================================================
   board.js — drawing the board.

   The board is an 11x11 grid. The outer ring is the 40 spaces; the middle holds
   the dice. Ring order, clockwise on screen:

     0  bottom-left  → 10 bottom-right
     11 bottom-right → 20 top-right
     21 top-right    → 30 top-left
     31 top-left     → 39 (which leads back to 0)

   Tiles are built ONCE and then only updated, which keeps redraws quick even on
   a phone. Nothing here decides anything: it draws what the server said.
   ========================================================================== */

window.EE = window.EE || {};

EE.board = (function () {
  'use strict';

  var els = {};
  var tiles = {}; // index -> the tile element
  var built = false;
  var listMode = false;
  var lastState = null;

  /* Which row and column each space sits in. */
  function place(index) {
    if (index <= 10) return { row: 11, col: index + 1 };
    if (index <= 20) return { row: 11 - (index - 10), col: 11 };
    if (index <= 30) return { row: 1, col: 11 - (index - 20) };
    return { row: (index - 30) + 1, col: 1 };
  }

  function isCorner(tile) {
    return ['start', 'hold', 'rest', 'warrant'].indexOf(tile.type) !== -1;
  }

  /* ------------------------------------------------------------------ */
  /* Building the board once                                             */
  /* ------------------------------------------------------------------ */

  function build() {
    var board = EE.state.getBoard();
    if (!board || built) return;

    /* The dice and the card sit in the middle of the board, inside it in the
       HTML. Clearing the board would throw them away, so keep that piece and
       put it back after the spaces are drawn. */
    var centre = els.board.querySelector('.board-centre');

    els.board.textContent = '';
    tiles = {};

    board.tiles.forEach(function (tile) {
      var spot = place(tile.index);

      var element = document.createElement('button');
      element.type = 'button';
      element.className = 'tile';
      element.style.gridRow = spot.row;
      element.style.gridColumn = spot.col;
      element.setAttribute('data-index', tile.index);
      element.setAttribute('aria-label', tile.name + (tile.price ? ', ' + EE.state.money(tile.price) : ''));
      element.addEventListener('click', function () {
        EE.propertyUI.showTile(tile.index);
      });

      if (isCorner(tile)) element.className += ' tile--corner tile--' + tile.type;
      if (tile.type === 'event') element.className += ' tile--event';
      if (tile.type === 'tax') element.className += ' tile--tax';
      if (tile.type === 'transport' || tile.type === 'utility') element.className += ' tile--service';

      if (tile.group && board.groups[tile.group]) {
        var band = document.createElement('span');
        band.className = 'tile-band';
        band.style.background = board.groups[tile.group].colour;
        element.appendChild(band);
      }

      var name = document.createElement('span');
      name.className = 'tile-name';
      name.textContent = tile.name;
      element.appendChild(name);

      if (tile.price) {
        var price = document.createElement('span');
        price.className = 'tile-price';
        price.textContent = EE.state.money(tile.price).replace(EE.CONFIG.CURRENCY, '');
        element.appendChild(price);
      }

      var upgrades = document.createElement('span');
      upgrades.className = 'tile-upgrades';
      element.appendChild(upgrades);

      var tokens = document.createElement('span');
      tokens.className = 'tile-tokens';
      element.appendChild(tokens);

      els.board.appendChild(element);
      tiles[tile.index] = element;
    });

    if (centre) els.board.appendChild(centre);

    built = true;
  }

  /* ------------------------------------------------------------------ */
  /* Dice and the middle of the board                                    */
  /* ------------------------------------------------------------------ */

  function renderDice(game) {
    var dice = game ? game.dice : null;

    if (!dice) {
      els.dieA.setAttribute('data-value', '1');
      els.dieB.setAttribute('data-value', '1');
      els.diceText.textContent = game && game.phase === 'roll' ? 'Roll to begin' : '—';
      return;
    }

    els.dieA.setAttribute('data-value', dice.a);
    els.dieB.setAttribute('data-value', dice.b);
    els.diceText.textContent = dice.a + ' + ' + dice.b + ' = ' + dice.total + (dice.doubles ? ' · doubles!' : '');
  }

  function rollAnimation() {
    [els.dieA, els.dieB].forEach(function (die) {
      die.classList.remove('die--rolling');
      /* Reading offsetWidth restarts the animation from the beginning. */
      void die.offsetWidth;
      die.classList.add('die--rolling');
    });
  }

  /* ------------------------------------------------------------------ */
  /* Tokens                                                             */
  /* ------------------------------------------------------------------ */

  function renderTokens(game) {
    Object.keys(tiles).forEach(function (index) {
      var holder = tiles[index].querySelector('.tile-tokens');
      if (holder) holder.textContent = '';
    });

    if (!game) return;

    game.players.forEach(function (player) {
      var tile = tiles[player.position];
      if (!tile) return;

      var holder = tile.querySelector('.tile-tokens');
      var token = document.createElement('span');
      token.className = 'token';
      token.textContent = player.token;
      token.style.background = player.colour;
      token.title = player.name;
      if (player.id === game.turnPlayerId) token.className += ' token--turn';
      if (player.inHold) token.className += ' token--held';
      if (player.bankrupt) token.className += ' token--out';
      holder.appendChild(token);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Ownership, upgrades and the active space                            */
  /* ------------------------------------------------------------------ */

  function renderTiles(game) {
    var board = EE.state.getBoard();
    if (!board) return;

    var mine = EE.state.getSeat() ? EE.state.getSeat().playerId : null;
    var current = game ? game.players.find(function (p) { return p.id === game.turnPlayerId; }) : null;

    board.tiles.forEach(function (tile) {
      var element = tiles[tile.index];
      if (!element) return;

      var building = game ? game.buildings[tile.index] : null;

      element.className = element.className
        .replace(/ tile--owned| tile--mine| tile--pawned| tile--active| tile--claimed/g, '');

      if (building) {
        element.className += ' tile--owned';
        if (building.ownerId === mine) element.className += ' tile--mine';
        if (building.mortgaged) element.className += ' tile--pawned';
      }

      if (current && current.position === tile.index) element.className += ' tile--active';

      var upgrades = element.querySelector('.tile-upgrades');
      upgrades.textContent = '';
      if (building && building.studios) {
        var studios = Math.min(building.studios, board.maxStudios);
        for (var i = 0; i < studios; i++) {
          var dot = document.createElement('span');
          dot.className = 'tile-upgrade';
          upgrades.appendChild(dot);
        }
        if (building.studios > board.maxStudios) {
          var tower = document.createElement('span');
          tower.className = 'tile-upgrade tile-upgrade--tower';
          upgrades.appendChild(tower);
        }
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Animations driven by comparing with the previous state              */
  /* ------------------------------------------------------------------ */

  function spotAnimations(previous, next) {
    if (!previous || !next || !next.game) return;
    if (EE.state.getPrefs().motion === 'reduced') return;

    var before = previous.game;
    var after = next.game;
    var seat = EE.state.getSeat();
    var myId = seat ? seat.playerId : null;

    /* A new owner: flash the space. */
    Object.keys(after.buildings).forEach(function (index) {
      var now = after.buildings[index];
      var then = before ? before.buildings[index] : null;
      if (!then || then.ownerId !== now.ownerId) {
        var element = tiles[index];
        if (element) {
          element.classList.add('tile--claimed');
          window.setTimeout(function () { element.classList.remove('tile--claimed'); }, 700);
        }
        if (!then && myId && now.ownerId === myId) EE.notify.sound('buy');
      }
    });

    /* Tokens: hop the player who moved, and float the money that changed. */
    after.players.forEach(function (player) {
      var beforePlayer = before ? before.players.find(function (p) { return p.id === player.id; }) : null;

      if (beforePlayer && beforePlayer.position !== player.position) {
        var tile = tiles[player.position];
        if (tile) {
          var token = tile.querySelector('.token');
          if (token) {
            token.classList.add('token--landed');
            window.setTimeout(function () { token.classList.remove('token--landed'); }, 1100);
          }
        }
      }

      if (beforePlayer && beforePlayer.money !== player.money) {
        var difference = player.money - beforePlayer.money;
        floatMoney(player.position, difference);
      }
    });
  }

  /* A little +500 / -200 that rises off the space. */
  function floatMoney(index, amount) {
    var tile = tiles[index];
    if (!tile) return;

    var float = document.createElement('span');
    float.className = 'money-float ' + (amount > 0 ? 'money-float--in' : 'money-float--out');
    float.textContent = (amount > 0 ? '+' : '−') + EE.state.money(Math.abs(amount)).replace(EE.CONFIG.CURRENCY, '');
    float.style.left = '50%';
    float.style.top = '50%';
    float.style.transform = 'translate(-50%, -50%)';
    tile.appendChild(float);
    window.setTimeout(function () {
      if (float.parentNode) float.parentNode.removeChild(float);
    }, 1200);
  }

  /* ------------------------------------------------------------------ */
  /* The list view (a readable alternative to a tiny board)              */
  /* ------------------------------------------------------------------ */

  function renderList(game) {
    var board = EE.state.getBoard();
    if (!board || !els.list) return;

    els.list.textContent = '';

    var myId = EE.state.getSeat() ? EE.state.getSeat().playerId : null;

    /* Group the neighbourhoods first, then the special spaces. */
    var order = ['dockside', 'meadow', 'lantern', 'sunspire', 'ironworks', 'palmwater', 'vertwood', 'crown'];

    order.forEach(function (groupId) {
      var group = board.groups[groupId];
      if (!group) return;
      addListSection(group.name, group.colour, EE.state.groupTiles(groupId), game, myId);
    });

    var services = board.tiles.filter(function (tile) {
      return tile.type === 'transport' || tile.type === 'utility';
    });
    addListSection('Transport and utilities', '#8fa39c', services, game, myId);

    var specials = board.tiles.filter(function (tile) {
      return ['start', 'tax', 'event', 'hold', 'rest', 'warrant'].indexOf(tile.type) !== -1;
    });
    addListSection('Special spaces', '#8fa39c', specials, game, myId);
  }

  function addListSection(title, colour, tileList, game, myId) {
    var section = document.createElement('div');
    section.className = 'board-list-group';

    var heading = document.createElement('p');
    heading.className = 'group-heading';
    if (colour) {
      var swatch = document.createElement('span');
      swatch.className = 'group-swatch';
      swatch.style.background = colour;
      heading.appendChild(swatch);
    }
    heading.appendChild(document.createTextNode(title));
    section.appendChild(heading);

    tileList.forEach(function (tile) {
      var building = game ? game.buildings[tile.index] : null;
      var owner = building ? (game.players.find(function (p) { return p.id === building.ownerId; }) || {}).name : null;

      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'tile-row';
      if (building && building.ownerId === myId) row.className += ' tile-row--mine';
      if (building && building.mortgaged) row.className += ' tile-row--pawned';

      if (tile.group && EE.state.getBoard().groups[tile.group]) {
        var band = document.createElement('span');
        band.className = 'tile-band';
        band.style.background = EE.state.getBoard().groups[tile.group].colour;
        row.appendChild(band);
      }

      var main = document.createElement('span');
      main.className = 'tile-row-main';

      var name = document.createElement('span');
      name.className = 'tile-row-name';
      name.textContent = tile.name;
      main.appendChild(name);

      var sub = document.createElement('span');
      sub.className = 'tile-row-sub';
      sub.textContent = owner
        ? 'Owned by ' + owner + (building.mortgaged ? ' · pawned' : building.studios ? ' · ' + describeUpgrades(building.studios) : '')
        : tile.note || (tile.price ? 'Unowned' : '');
      main.appendChild(sub);

      row.appendChild(main);

      if (tile.price) {
        var price = document.createElement('span');
        price.className = 'tile-row-price';
        price.textContent = EE.state.money(tile.price);
        row.appendChild(price);
      }

      row.addEventListener('click', function () { EE.propertyUI.showTile(tile.index); });
      section.appendChild(row);
    });

    els.list.appendChild(section);
  }

  function describeUpgrades(studios) {
    var max = EE.state.getBoard().maxStudios;
    if (studios > max) return 'tower';
    return studios + (studios === 1 ? ' studio' : ' studios');
  }

  /* ------------------------------------------------------------------ */
  /* Showing the board or the list                                       */
  /* ------------------------------------------------------------------ */

  function setListMode(on) {
    listMode = on;
    els.wrap.hidden = on;
    els.list.hidden = !on;
    els.toggle.textContent = on ? 'Board view' : 'List view';
    if (on) renderList(EE.state.getGame());
  }

  /* ------------------------------------------------------------------ */
  /* Main render                                                         */
  /* ------------------------------------------------------------------ */

  function render(sync, previous) {
    var game = sync ? sync.game : null;

    build();
    renderTiles(game);
    renderTokens(game);
    renderDice(game);
    renderCentre(game);

    if (listMode) renderList(game);

    if (previous) spotAnimations(previous, sync);
    if (previous && previous.game && sync.game && previous.game.dice !== sync.game.dice) rollAnimation();

    lastState = sync;
  }

  function renderCentre(game) {
    var card = game ? game.lastCard : null;
    var cardBox = document.getElementById('centre-card');
    if (!cardBox) return;

    if (!card) {
      cardBox.hidden = true;
      return;
    }

    cardBox.hidden = false;
    document.getElementById('centre-card-title').textContent = card.deck === 'civic' ? 'Civic Fund' : 'Fortune';
    document.getElementById('centre-card-text').textContent = card.text;
  }

  function init() {
    els = {
      board: document.getElementById('board'),
      wrap: document.getElementById('board-wrap'),
      list: document.getElementById('board-list'),
      toggle: document.getElementById('board-toggle'),
      dieA: document.getElementById('die-a'),
      dieB: document.getElementById('die-b'),
      diceText: document.getElementById('dice-text')
    };

    els.toggle.addEventListener('click', function () {
      setListMode(!listMode);
    });
  }

  return {
    init: init,
    render: render,
    rollAnimation: rollAnimation,
    floatMoney: floatMoney,
    setListMode: setListMode
  };
})();
