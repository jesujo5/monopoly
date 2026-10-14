/* ==========================================================================
   property-ui.js — properties and trading.

   Every button here sends a request to the server, which checks it and answers
   with either a change or a reason. The disabled states below are a kindness to
   the player, not a security measure: the server refuses anything illegal even
   if a button is somehow enabled.
   ========================================================================== */

window.EE = window.EE || {};

EE.propertyUI = (function () {
  'use strict';

  var state = EE.state;
  var els = {};

  /* ------------------------------------------------------------------ */
  /* Property details                                                    */
  /* ------------------------------------------------------------------ */

  function showTile(index) {
    var tile = state.tileAt(index);
    if (!tile) return;

    var body = els.propertyBody;
    body.textContent = '';

    document.getElementById('property-title').textContent = tile.name;

    var game = state.getGame();
    var building = state.buildingAt(index);
    var owner = building ? state.gamePlayer(building.ownerId) : null;

    body.appendChild(line('Type', describeType(tile)));

    if (tile.group && state.getBoard().groups[tile.group]) {
      var group = state.getBoard().groups[tile.group];
      body.appendChild(line('Neighbourhood', group.name, group.colour));
      var mine = state.myGamePlayer();
      if (mine) {
        body.appendChild(line('You own all of it', state.ownsWholeGroup(tile.group, mine.id) ? 'Yes — base rent doubles' : 'Not yet'));
      }
    }

    if (tile.price) body.appendChild(line('Price', state.money(tile.price)));
    if (tile.studioCost) body.appendChild(line('Studio cost', state.money(tile.studioCost)));
    if (tile.mortgage) body.appendChild(line('Pawn value', state.money(tile.mortgage)));

    if (tile.rent) body.appendChild(rentTable(tile, building));

    if (tile.amount) body.appendChild(line('You pay', state.money(tile.amount)));
    if (tile.note) body.appendChild(line('Note', tile.note));

    if (game) {
      if (owner) {
        body.appendChild(line('Owner', owner.name + (building.mortgaged ? ' (pawned)' : '')));
        if (building.studios) {
          body.appendChild(line('Built', building.studios > state.getBoard().maxStudios ? 'A tower' : building.studios + ' studio(s)'));
        }
      } else if (state.isBuyable(tile)) {
        body.appendChild(line('Owner', 'Nobody — it can be bought'));
      }
    }

    body.appendChild(actionsFor(tile, building));

    EE.nav.openModal('modal-property');
  }

  function describeType(tile) {
    var names = {
      property: 'Neighbourhood property',
      transport: 'Transport line',
      utility: 'Utility',
      start: 'Starting corner',
      tax: 'Fee',
      event: 'Event space',
      hold: 'Corner',
      rest: 'Corner',
      warrant: 'Corner'
    };
    return names[tile.type] || tile.type;
  }

  function line(label, value, swatchColour) {
    var row = document.createElement('div');
    row.className = 'summary-row';

    var term = document.createElement('dt');
    if (swatchColour) {
      var swatch = document.createElement('span');
      swatch.className = 'group-swatch';
      swatch.style.background = swatchColour;
      term.appendChild(swatch);
      term.appendChild(document.createTextNode(' ' + label));
    } else {
      term.textContent = label;
    }

    var detail = document.createElement('dd');
    detail.textContent = value;

    row.appendChild(term);
    row.appendChild(detail);
    return row;
  }

  /* The rent schedule for this space. Neighbourhood properties have six levels;
     transport lines and utilities charge by how many the owner holds. */
  function rentTable(tile, building) {
    var list = document.createElement('div');
    list.className = 'tile-list';
    var current = building ? (building.studios || 0) : -1;

    if (tile.type === 'utility') {
      addRentRow(list, 'If the owner holds one utility', '4 × the dice total');
      addRentRow(list, 'If the owner holds both', '10 × the dice total');
      return list;
    }

    if (tile.type === 'transport') {
      tile.rent.forEach(function (amount, index) {
        addRentRow(list, (index + 1) + (index === 0 ? ' line owned' : ' lines owned'), state.money(amount));
      });
      return list;
    }

    var levels = ['Base rent', '1 studio', '2 studios', '3 studios', '4 studios', 'Tower'];
    tile.rent.forEach(function (amount, index) {
      addRentRow(list, levels[index] + (current === index ? '  ← now' : ''), state.money(amount));
    });

    return list;
  }

  function addRentRow(list, label, value) {
    var row = document.createElement('div');
    row.className = 'summary-row';

    var term = document.createElement('dt');
    term.textContent = label;

    var detail = document.createElement('dd');
    detail.textContent = value;

    row.appendChild(term);
    row.appendChild(detail);
    list.appendChild(row);
  }

  /* Which buttons to offer for this space. */
  function actionsFor(tile, building) {
    var wrap = document.createElement('div');
    wrap.className = 'stack';
    wrap.style.marginTop = '14px';

    var game = state.getGame();
    var mine = state.myGamePlayer();
    var settings = game ? game.settings : state.getSettings();
    var myTurn = state.isMyTurn() && game && !game.finishedAt && game.phase !== 'roll';
    var myId = mine ? mine.id : null;

    if (game && state.isBuyable(tile) && !building) {
      var buy = document.createElement('button');
      buy.className = 'btn btn-primary btn-block';
      buy.textContent = 'Buy ' + tile.name + ' for ' + state.money(tile.price);
      buy.disabled = !myTurn || !mine || mine.money < tile.price;
      buy.addEventListener('click', function () {
        if (EE.net.sendAction('buy', { tile: tile.index })) EE.nav.closeModal('modal-property');
      });
      wrap.appendChild(buy);
    }

    if (building && building.ownerId === myId && tile.type === 'property') {
      /* A tower costs two studios' worth, and the server calculates it the same way. */
      var isTower = building.studios >= state.getBoard().maxStudios;
      var cost = isTower ? tile.studioCost * 2 : tile.studioCost;

      var build = document.createElement('button');
      build.className = 'btn btn-primary btn-block';
      build.textContent = (isTower ? 'Build a tower for ' : 'Build a studio for ') + state.money(cost);
      build.disabled = !myTurn || !settings.upgrades || building.mortgaged ||
        !state.ownsWholeGroup(tile.group, myId) || (mine ? mine.money < cost : true);
      build.addEventListener('click', function () {
        EE.net.sendAction('build', { tile: tile.index });
      });
      wrap.appendChild(build);

      if (building.studios) {
        var sell = document.createElement('button');
        sell.className = 'btn btn-ghost btn-block';
        sell.textContent = 'Sell a studio for ' + state.money(Math.round(tile.studioCost / 2));
        sell.disabled = !myTurn;
        sell.addEventListener('click', function () {
          EE.net.sendAction('sell_studio', { tile: tile.index });
        });
        wrap.appendChild(sell);
      }
    }

    if (building && building.ownerId === myId && tile.mortgage) {
      if (building.mortgaged) {
        var back = document.createElement('button');
        back.className = 'btn btn-block';
        back.textContent = 'Buy it back for ' + state.money(Math.round(tile.mortgage * 1.1));
        back.disabled = !myTurn || !settings.mortgages || !mine || mine.money < Math.round(tile.mortgage * 1.1);
        back.addEventListener('click', function () {
          EE.net.sendAction('unmortgage', { tile: tile.index });
        });
        wrap.appendChild(back);
      } else {
        var pawn = document.createElement('button');
        pawn.className = 'btn btn-block';
        pawn.textContent = 'Pawn it for ' + state.money(tile.mortgage);
        pawn.disabled = !myTurn || !settings.mortgages || building.studios > 0;
        pawn.addEventListener('click', function () {
          EE.net.sendAction('mortgage', { tile: tile.index });
        });
        wrap.appendChild(pawn);
      }
    }

    if (wrap.children.length === 0) {
      var note = document.createElement('p');
      note.className = 'feed-empty';
      note.textContent = game ? 'Nothing to do here right now.' : 'Start a match to buy and build.';
      wrap.appendChild(note);
    }

    return wrap;
  }

  /* ------------------------------------------------------------------ */
  /* My properties                                                       */
  /* ------------------------------------------------------------------ */

  function showProperties() {
    var body = els.propsBody;
    body.textContent = '';

    var mine = state.myGamePlayer();
    if (!mine) {
      body.innerHTML = '<p class="feed-empty">Join a match to see your properties.</p>';
      EE.nav.openModal('modal-props');
      return;
    }

    var owned = state.tilesOwnedBy(mine.id).sort(function (a, b) { return a.price - b.price; });

    var summary = document.createElement('p');
    summary.textContent = owned.length === 0
      ? 'You do not own anything yet. Land on a space and buy it.'
      : owned.length + ' propert' + (owned.length === 1 ? 'y' : 'ies') + ' · net worth ' + state.money(mine.netWorth);
    body.appendChild(summary);

    var list = document.createElement('div');
    list.className = 'tile-list';

    owned.forEach(function (tile) {
      var building = state.buildingAt(tile.index);
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'tile-row tile-row--mine';
      if (building.mortgaged) row.className += ' tile-row--pawned';

      if (tile.group && state.getBoard().groups[tile.group]) {
        var band = document.createElement('span');
        band.className = 'tile-band';
        band.style.background = state.getBoard().groups[tile.group].colour;
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
      sub.textContent = building.mortgaged
        ? 'Pawned · no rent'
        : building.studios > state.getBoard().maxStudios
          ? 'Tower · rent ' + state.money(tile.rent[5])
          : building.studios
            ? building.studios + ' studio(s) · rent ' + state.money(tile.rent[building.studios])
            : state.ownsWholeGroup(tile.group, mine.id)
              ? 'Full neighbourhood · rent ' + state.money(tile.rent[0] * 2)
              : 'Base rent ' + state.money(tile.rent[0]);
      main.appendChild(sub);

      row.appendChild(main);

      var price = document.createElement('span');
      price.className = 'tile-row-price';
      price.textContent = building.mortgaged ? 'pawned' : state.money(tile.price);
      row.appendChild(price);

      row.addEventListener('click', function () {
        EE.nav.closeModal('modal-props');
        showTile(tile.index);
      });

      list.appendChild(row);
    });

    body.appendChild(list);
    EE.nav.openModal('modal-props');
  }

  /* ------------------------------------------------------------------ */
  /* Trading                                                             */
  /* ------------------------------------------------------------------ */

  var draft = { toId: '', giveTiles: [], wantTiles: [], giveMoney: 0, wantMoney: 0 };

  function openTrade() {
    var game = state.getGame();
    var mine = state.myGamePlayer();

    if (!game || !mine) {
      EE.notify.toast('Join a match to trade', 'warn');
      return;
    }
    if (!game.settings.trading) {
      EE.notify.toast('Trading is switched off in this room', 'warn');
      return;
    }

    draft = { toId: '', giveTiles: [], wantTiles: [], giveMoney: 0, wantMoney: 0 };

    /* Open first, then draw. renderTrade() only draws into a dialog that is
       already open (so a sync cannot yank an unopened dialog around), which
       means drawing before opening would leave an empty dialog until the next
       server update arrived. */
    EE.nav.openModal('modal-trade');
    renderTrade();
  }

  function renderTrade() {
    var body = els.tradeBody;
    if (!body || EE.nav.isModalOpen('modal-trade') === false) return;

    var game = state.getGame();
    var mine = state.myGamePlayer();
    if (!game || !mine) {
      body.textContent = '';
      return;
    }

    body.textContent = '';

    /* Offers waiting for an answer from me. */
    var incoming = game.trades.filter(function (trade) {
      return trade.toId === mine.id;
    });

    incoming.forEach(function (trade) {
      var row = document.createElement('div');
      row.className = 'offer-row';

      var text = document.createElement('span');
      text.textContent = describeTrade(trade, mine);
      row.appendChild(text);

      var accept = document.createElement('button');
      accept.className = 'btn btn-primary btn-sm';
      accept.textContent = 'Accept';
      accept.addEventListener('click', function () {
        EE.net.sendAction('trade_respond', { tradeId: trade.id, accept: true });
      });

      var decline = document.createElement('button');
      decline.className = 'btn btn-ghost btn-sm';
      decline.textContent = 'Decline';
      decline.addEventListener('click', function () {
        EE.net.sendAction('trade_respond', { tradeId: trade.id, accept: false });
      });

      row.appendChild(accept);
      row.appendChild(decline);
      body.appendChild(row);
    });

    /* Offers I have sent. */
    game.trades.filter(function (trade) { return trade.fromId === mine.id; }).forEach(function (trade) {
      var row = document.createElement('div');
      row.className = 'offer-row';

      var text = document.createElement('span');
      text.textContent = 'Waiting for an answer: ' + describeTrade(trade, mine);
      row.appendChild(text);

      var cancel = document.createElement('button');
      cancel.className = 'btn btn-ghost btn-sm';
      cancel.textContent = 'Withdraw';
      cancel.addEventListener('click', function () {
        EE.net.sendAction('trade_cancel', { tradeId: trade.id });
      });
      row.appendChild(cancel);
      body.appendChild(row);
    });

    /* The builder. */
    var others = game.players.filter(function (player) {
      return player.id !== mine.id && !player.bankrupt;
    });

    if (others.length === 0) {
      var note = document.createElement('p');
      note.className = 'feed-empty';
      note.textContent = 'Nobody else is left to trade with.';
      body.appendChild(note);
      return;
    }

    if (!draft.toId) draft.toId = others[0].id;

    var heading = document.createElement('h3');
    heading.className = 'subhead';
    heading.textContent = 'Make an offer';
    body.appendChild(heading);

    var select = document.createElement('select');
    select.setAttribute('aria-label', 'Who to trade with');
    others.forEach(function (player) {
      var option = document.createElement('option');
      option.value = player.id;
      option.textContent = player.name;
      if (player.id === draft.toId) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener('change', function () {
      draft.toId = select.value;
      draft.wantTiles = [];
      renderTrade();
    });
    body.appendChild(select);

    body.appendChild(tradeSide('You give', mine, 'give'));
    body.appendChild(tradeSide('You receive', state.gamePlayer(draft.toId), 'want'));

    var send = document.createElement('button');
    send.className = 'btn btn-primary btn-block';
    send.textContent = 'Send offer';
    send.addEventListener('click', function () {
      EE.net.sendAction('trade_propose', {
        toId: draft.toId,
        give: { tiles: draft.giveTiles, money: draft.giveMoney },
        want: { tiles: draft.wantTiles, money: draft.wantMoney }
      });
      EE.nav.closeModal('modal-trade');
    });
    body.appendChild(send);
  }

  function tradeSide(title, player, side) {
    var wrap = document.createElement('div');
    wrap.className = 'trade-side';

    var heading = document.createElement('h4');
    heading.textContent = title + (player ? ' — ' + player.name : '');
    wrap.appendChild(heading);

    if (!player) return wrap;

    var picks = document.createElement('div');
    picks.className = 'trade-picks';

    var owned = state.tilesOwnedBy(player.id);

    if (owned.length === 0) {
      var empty = document.createElement('span');
      empty.className = 'feed-empty';
      empty.textContent = 'No properties';
      picks.appendChild(empty);
    }

    owned.forEach(function (tile) {
      var label = document.createElement('label');
      label.className = 'trade-pick';

      var box = document.createElement('input');
      box.type = 'checkbox';
      box.value = tile.index;
      box.checked = (side === 'give' ? draft.giveTiles : draft.wantTiles).indexOf(tile.index) !== -1;
      box.addEventListener('change', function () {
        var list = side === 'give' ? draft.giveTiles : draft.wantTiles;
        var at = list.indexOf(tile.index);
        if (box.checked && at === -1) list.push(tile.index);
        if (!box.checked && at !== -1) list.splice(at, 1);
      });

      label.appendChild(box);
      label.appendChild(document.createTextNode(tile.name + ' (' + state.money(tile.price) + ')'));
      picks.appendChild(label);
    });

    wrap.appendChild(picks);

    var moneyField = document.createElement('div');
    moneyField.className = 'field';
    moneyField.style.marginTop = '8px';

    var moneyLabel = document.createElement('label');
    moneyLabel.textContent = 'Money included (' + (player.money ? 'they hold ' + state.money(player.money) : '') + ')';
    moneyLabel.setAttribute('for', 'trade-money-' + side);

    var moneyInput = document.createElement('input');
    moneyInput.type = 'number';
    moneyInput.id = 'trade-money-' + side;
    moneyInput.min = '0';
    moneyInput.max = String(player.money);
    moneyInput.step = '500';
    moneyInput.value = side === 'give' ? draft.giveMoney : draft.wantMoney;

    moneyInput.addEventListener('change', function () {
      var value = Math.max(0, Math.min(player.money, parseInt(moneyInput.value, 10) || 0));
      moneyInput.value = value;
      if (side === 'give') draft.giveMoney = value;
      else draft.wantMoney = value;
    });

    moneyField.appendChild(moneyLabel);
    moneyField.appendChild(moneyInput);
    wrap.appendChild(moneyField);

    return wrap;
  }

  function describeTrade(trade, mine) {
    var game = state.getGame();
    var nameOf = function (id) {
      var player = game.players.find(function (item) { return item.id === id; });
      return player ? player.name : 'Someone';
    };
    var tilesText = function (tiles) {
      return tiles.map(function (index) {
        var tile = state.tileAt(index);
        return tile ? tile.name : 'a property';
      }).join(', ');
    };

    var give = [tilesText(trade.give.tiles), trade.give.money ? state.money(trade.give.money) : ''].filter(Boolean).join(' + ');
    var want = [tilesText(trade.want.tiles), trade.want.money ? state.money(trade.want.money) : ''].filter(Boolean).join(' + ');

    return nameOf(trade.fromId) + ' offers ' + (give || 'nothing') + ' for ' + (want || 'nothing');
  }

  /* ------------------------------------------------------------------ */
  /* Offers that are waiting for me                                      */
  /* ------------------------------------------------------------------ */

  /* A trade offer is easy to miss: it arrives while you are watching the board
     and it expires after a minute. So an offer puts a count on the Trade
     button and raises a toast, once — not on every redraw. */
  function offersForMe() {
    var game = state.getGame();
    var mine = state.myGamePlayer();
    if (!game || !mine || !game.trades) return [];
    return game.trades.filter(function (trade) {
      return trade.toId === mine.id && trade.status === 'pending';
    });
  }

  function updateTradeBadge() {
    var badge = els.tradeBadge;
    if (!badge) return;

    var count = offersForMe().length;
    badge.hidden = count === 0;
    badge.textContent = count === 0 ? '' : String(count);
  }

  /* Called on every sync, with the previous state so a genuinely new offer can
     be told apart from one that has simply been listed again. */
  function syncTrades(sync, previous) {
    updateTradeBadge();

    var game = sync && sync.game;
    if (!game || !game.trades) return;

    var mine = state.myGamePlayer();
    if (!mine) return;

    var before = previous && previous.game && previous.game.trades ? previous.game.trades : [];
    var known = {};
    before.forEach(function (trade) { known[trade.id] = true; });

    offersForMe().forEach(function (trade) {
      if (known[trade.id]) return;
      var from = state.gamePlayer(trade.fromId);
      EE.notify.toast((from ? from.name : 'Someone') + ' offers you a trade — open Trade to answer', 'info', 6000);
    });
  }

  /* ------------------------------------------------------------------ */

  function init() {
    els = {
      propertyBody: document.getElementById('property-body'),
      propsBody: document.getElementById('props-body'),
      tradeBody: document.getElementById('trade-body'),
      tradeBadge: document.getElementById('trade-badge')
    };

    document.getElementById('btn-props').addEventListener('click', showProperties);
    document.getElementById('btn-trade').addEventListener('click', openTrade);
  }

  return {
    init: init,
    showTile: showTile,
    showProperties: showProperties,
    openTrade: openTrade,
    renderTrade: renderTrade,
    syncTrades: syncTrades,
    updateTradeBadge: updateTradeBadge
  };
})();
