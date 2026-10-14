'use strict';

/**
 * game-engine.js — the referee.
 *
 * Every official decision happens in this file, on the server:
 *   • the dice values            • whose turn it is
 *   • what rent is owed          • whether a purchase is legal
 *   • who has gone bankrupt      • who won
 *
 * A browser can only ASK. If a request is not legal, the engine refuses it and
 * answers with a reason. That is why editing the client's JavaScript cannot
 * change the result of a game.
 */

const properties = require('./properties');
const banking = require('./banking');
const rules = require('./game-rules');
const events = require('./events');

/* The six seats. Colours are deliberately distinguishable for colour-blind
   players by their names as well as their hues. */
const SEATS = [
  { colour: '#e05c5c', token: 'A' },
  { colour: '#4fa3e0', token: 'B' },
  { colour: '#5fbf7a', token: 'C' },
  { colour: '#e0a94f', token: 'D' },
  { colour: '#b07fe0', token: 'E' },
  { colour: '#4fc9c0', token: 'F' }
];

const TRADE_LIFETIME_MS = 60 * 1000;
const HISTORY_LIMIT = 60;

/* ---------------------------------------------------------------------------
   Creating a game
   --------------------------------------------------------------------------- */

function createGame(code, settings, players) {
  const game = {
    code: code,
    settings: settings,
    players: players.map(function (player, index) {
      return {
        id: player.id,
        name: player.name,
        colour: SEATS[index % SEATS.length].colour,
        token: SEATS[index % SEATS.length].token,
        order: index,
        money: settings.startingMoney,
        position: 0,
        inHold: false,
        holdTurns: 0,
        holdPasses: 0,
        bankrupt: false
      };
    }),
    buildings: {},
    turnPlayerId: null,
    phase: 'roll',
    dice: null,
    doublesCount: 0,
    round: 1,
    pot: 0,
    trades: [],
    ledger: [],
    history: [],
    decks: events.freshDecks(),
    lastCard: null,
    winnerId: null,
    endReason: null,
    startedAt: Date.now(),
    finishedAt: null,
    turnDeadlineAt: null
  };

  log(game, 'The match begins. Everyone starts with ' + settings.startingMoney + '.', 'system');

  /* The first player in joining order starts. */
  game.turnPlayerId = game.players[0].id;
  armTurnDeadline(game);

  return game;
}

/* ---------------------------------------------------------------------------
   Small internal helpers
   --------------------------------------------------------------------------- */

function log(game, text, kind) {
  game.history.push({
    at: Date.now(),
    round: game.round,
    text: text,
    kind: kind || 'info'
  });
  if (game.history.length > HISTORY_LIMIT) {
    game.history.splice(0, game.history.length - HISTORY_LIMIT);
  }
}

/* Turn timer: the server, not the browser, decides when a turn has taken too
   long. cleanup.js checks this stamp once a second. */
function armTurnDeadline(game) {
  const seconds = game.settings.turnTimerSeconds;
  game.turnDeadlineAt = seconds > 0 ? Date.now() + seconds * 1000 : null;
}

function turnPlayer(game) {
  return rules.playerById(game, game.turnPlayerId);
}

/* Refusals always carry a reason, and the reason is shown to the player. */
function refuse(reason) {
  return { ok: false, reason: reason };
}

function accept(extra) {
  return Object.assign({ ok: true }, extra || {});
}

function rollDie() {
  return Math.floor(Math.random() * 6) + 1;
}

/* ---------------------------------------------------------------------------
   Turn flow
   --------------------------------------------------------------------------- */

function nextTurn(game) {
  if (game.finishedAt) return;

  const total = game.players.length;
  const current = game.players.findIndex(function (player) {
    return player.id === game.turnPlayerId;
  });

  let index = current;
  let wrapped = false;

  for (let step = 1; step <= total; step++) {
    const candidate = (current + step) % total;
    if (candidate <= current) wrapped = true;
    if (!game.players[candidate].bankrupt) {
      index = candidate;
      break;
    }
  }

  game.turnPlayerId = game.players[index].id;
  game.phase = 'roll';
  game.dice = null;
  game.doublesCount = 0;

  if (wrapped) {
    game.round += 1;
    if (game.settings.winningCondition === 'rounds') rules.checkVictory(game);
  }

  armTurnDeadline(game);
  log(game, 'It is now ' + game.players[index].name + "'s turn.", 'turn');
}

/* ---------------------------------------------------------------------------
   Rolling and resolving
   --------------------------------------------------------------------------- */

function rollDice(game, playerId) {
  if (game.finishedAt) return refuse('The match has finished');
  if (game.turnPlayerId !== playerId) return refuse('It is not your turn');
  if (game.phase !== 'roll') return refuse('You have already rolled this turn');

  const player = rules.playerById(game, playerId);
  if (!player || player.bankrupt) return refuse('You are no longer in this match');

  /* Held at the Harbour Hold: a double sets you free, otherwise you wait. */
  if (player.inHold) return attemptHoldEscape(game, player);

  const a = rollDie();
  const b = rollDie();
  const doubles = a === b;

  game.dice = { a: a, b: b, total: a + b, doubles: doubles };

  if (doubles) game.doublesCount += 1;

  if (game.doublesCount >= 3) {
    log(game, player.name + ' rolled a third double and is escorted to the Harbour Hold.', 'bad');
    rules.sendToHold(player, game);
    game.dice = null;
    nextTurn(game);
    return accept({ moved: false });
  }

  log(game, player.name + ' rolled ' + a + ' + ' + b + (doubles ? ' (doubles)' : '') + '.', 'dice');

  rules.movePlayer(game, player, a + b);
  return finishResolution(game, player, resolveTile(game, player, a + b, 1));
}

/* After a space is resolved, decide whose turn it is now.
   If the player went out of the match, or the space moved the turn on (a
   warrant, say), the next player must be left ready to ROLL. Setting the phase
   to "action" here would silently cost them their go. */
function finishResolution(game, player, outcome) {
  if (game.finishedAt) return accept({ moved: true });

  const turnMovedOn = game.turnPlayerId !== player.id;

  if (outcome.endTurnNow || turnMovedOn || player.bankrupt) {
    if (!turnMovedOn && !game.finishedAt) nextTurn(game);
    return accept({ moved: true });
  }

  game.phase = 'action';
  return accept({ moved: true });
}

/* Getting out of the Harbour Hold: roll a double, spend a pass, or serve time. */
function attemptHoldEscape(game, player) {
  const a = rollDie();
  const b = rollDie();
  game.dice = { a: a, b: b, total: a + b, doubles: a === b };

  if (a === b) {
    player.inHold = false;
    player.holdTurns = 0;
    log(game, player.name + ' rolled a double and leaves the Harbour Hold.', 'good');
    rules.movePlayer(game, player, a + b);
    return finishResolution(game, player, resolveTile(game, player, a + b, 1));
  }

  player.holdTurns += 1;
  log(game, player.name + ' rolled ' + a + ' + ' + b + ' and stays at the Harbour Hold (attempt ' + player.holdTurns + ').', 'warn');

  if (player.holdTurns >= properties.MAX_HOLD_TURNS) {
    if (player.money >= properties.HOLD_FINE) {
      banking.payBank(game, player, properties.HOLD_FINE, 'Harbour Hold fine');
      if (game.settings.freeParkingPot) game.pot += properties.HOLD_FINE;
      player.inHold = false;
      player.holdTurns = 0;
      log(game, player.name + ' paid the ' + properties.HOLD_FINE + ' fine and is released.', 'warn');
      rules.movePlayer(game, player, a + b);
      return finishResolution(game, player, resolveTile(game, player, a + b, 1));
    }
    log(game, player.name + ' cannot afford the fine.', 'bad');
    const finePaid = settleDebt(game, player, null, properties.HOLD_FINE, 'Harbour Hold fine');
    if (finePaid && game.settings.freeParkingPot) game.pot += properties.HOLD_FINE;
    if (!game.finishedAt && game.turnPlayerId === player.id) nextTurn(game);
    return accept({ moved: false });
  }

  game.phase = 'action';
  return accept({ moved: false });
}

/* What happens on the space you landed on. */
function resolveTile(game, player, diceTotal, depth) {
  const tile = properties.tileAt(player.position);
  if (!tile) return { endTurnNow: false };

  if (tile.type === 'start') {
    log(game, player.name + ' rests at the Grand Terminal.', 'info');
    return { endTurnNow: false };
  }

  if (tile.type === 'hold') {
    log(game, player.name + ' is only visiting the Harbour Hold.', 'info');
    return { endTurnNow: false };
  }

  if (tile.type === 'rest') {
    if (game.settings.freeParkingPot && game.pot > 0) {
      const pot = game.pot;
      game.pot = 0;
      banking.payFromBank(game, player, pot, 'Festival Square jackpot');
      log(game, player.name + ' collects the Festival Square jackpot of ' + pot + '.', 'good');
    } else {
      log(game, player.name + ' takes a free rest at Festival Square.', 'info');
    }
    return { endTurnNow: false };
  }

  if (tile.type === 'warrant') {
    log(game, 'A warrant sends ' + player.name + ' to the Harbour Hold.', 'bad');
    rules.sendToHold(player, game);
    return { endTurnNow: true };
  }

  if (tile.type === 'tax') {
    log(game, player.name + ' owes the ' + tile.name + ' of ' + tile.amount + '.', 'warn');
    const paid = settleDebt(game, player, null, tile.amount, tile.name);
    /* The Festival Square jackpot only grows from money the bank actually
       received, so a fee nobody could pay never invents money. */
    if (paid && game.settings.freeParkingPot) game.pot += tile.amount;
    return { endTurnNow: false };
  }

  if (tile.type === 'event') {
    if (!game.settings.events) {
      log(game, 'The event decks are switched off in this room.', 'info');
      return { endTurnNow: false };
    }
    return applyCard(game, player, tile, depth);
  }

  /* property, transport, utility */
  const ownerId = rules.ownerIdOf(game, tile.index);

  if (!ownerId) {
    log(game, tile.name + ' is available for ' + tile.price + '.', 'info');
    return { endTurnNow: false };
  }

  if (ownerId === player.id) {
    log(game, player.name + ' already owns ' + tile.name + '.', 'info');
    return { endTurnNow: false };
  }

  const owner = rules.playerById(game, ownerId);
  if (!owner || owner.bankrupt) return { endTurnNow: false };

  const rent = rules.rentFor(game, tile, ownerId, diceTotal);
  if (rent.amount <= 0) {
    log(game, tile.name + ' earns nothing right now.', 'info');
    return { endTurnNow: false };
  }

  log(game, player.name + ' pays ' + rent.amount + ' rent to ' + owner.name + ' — ' + rent.reason + '.', 'warn');
  settleDebt(game, player, owner.id, rent.amount, 'Rent on ' + tile.name);
  return { endTurnNow: false };
}

/* Drawing and applying an event card. */
function applyCard(game, player, tile, depth) {
  const deckName = tile.deck;
  const card = events.draw(game, deckName);
  if (!card) return { endTurnNow: false };

  game.lastCard = { deck: deckName, text: card.text, playerId: player.id, at: Date.now() };
  log(game, player.name + ' draws: "' + card.text + '"', 'card');

  const effect = card.effect;

  if (effect.kind === 'money') {
    banking.payFromBank(game, player, effect.amount, 'Card: ' + tile.name);
    return { endTurnNow: false };
  }

  if (effect.kind === 'pay') {
    settleDebt(game, player, null, effect.amount, 'Card: ' + tile.name);
    return { endTurnNow: false };
  }

  if (effect.kind === 'collectEach') {
    banking.collectFromEach(game, player, effect.amount, 'Card: ' + tile.name);
    rules.checkVictory(game);
    return { endTurnNow: false };
  }

  if (effect.kind === 'payEach') {
    game.players.forEach(function (other) {
      if (other.id === player.id || other.bankrupt) return;
      /* Once the payer is out of the match, stop: an eliminated player cannot
         keep paying, and must not be eliminated a second time. */
      if (player.bankrupt) return;
      settleDebt(game, player, other.id, effect.amount, 'Card: ' + tile.name);
    });
    return { endTurnNow: false };
  }

  if (effect.kind === 'perStudio') {
    const owned = banking.tilesOwnedBy(game, player.id);
    const studios = owned.reduce(function (total, ownedTile) {
      const building = rules.buildingOf(game, ownedTile.index);
      return total + (building ? building.studios || 0 : 0);
    }, 0);
    const amount = studios * effect.amount;
    log(game, player.name + ' owns ' + studios + ' studio(s) and owes ' + amount + '.', 'warn');
    if (amount > 0) settleDebt(game, player, null, amount, 'Card: ' + tile.name);
    return { endTurnNow: false };
  }

  if (effect.kind === 'move') {
    rules.movePlayer(game, player, effect.spaces);
    return resolveTile(game, player, game.dice ? game.dice.total : 0, 2);
  }

  if (effect.kind === 'moveTo') {
    const passGo = effect.index < player.position;
    player.position = effect.index;
    if (passGo) {
      banking.payFromBank(game, player, game.settings.salary, 'Salary for passing the Grand Terminal');
    }
    log(game, player.name + ' moves to ' + properties.tileAt(effect.index).name + '.', 'info');
    return resolveTile(game, player, game.dice ? game.dice.total : 0, 2);
  }

  if (effect.kind === 'advanceTo') {
    const candidates = properties.TILES.filter(function (candidate) {
      return candidate.type === effect.type;
    });
    let target = null;
    for (let step = 1; step <= properties.TILES.length; step++) {
      const index = (player.position + step) % properties.TILES.length;
      const match = candidates.find(function (candidate) {
        return candidate.index === index;
      });
      if (match) {
        target = match;
        break;
      }
    }
    if (!target) return { endTurnNow: false };
    if (target.index < player.position) {
      banking.payFromBank(game, player, game.settings.salary, 'Salary for passing the Grand Terminal');
    }
    player.position = target.index;
    log(game, player.name + ' advances to ' + target.name + '.', 'info');
    return resolveTile(game, player, game.dice ? game.dice.total : 0, (depth || 1) + 1);
  }

  if (effect.kind === 'hold') {
    rules.sendToHold(player, game);
    return { endTurnNow: true };
  }

  if (effect.kind === 'holdPass') {
    player.holdPasses += 1;
    log(game, player.name + ' keeps a Harbour Hold pass.', 'good');
    return { endTurnNow: false };
  }

  return { endTurnNow: false };
}

/* ---------------------------------------------------------------------------
   Paying a debt — the only place a player can go bankrupt
   --------------------------------------------------------------------------- */

/* Returns true when the debt was paid in full, false when the player has gone
   out of the match. Callers use that to avoid charging a fee the bank never
   received (the Festival Square jackpot). */
function settleDebt(game, player, creditorId, amount, reason) {
  if (amount <= 0) return true;

  const creditor = creditorId ? rules.playerById(game, creditorId) : null;

  if (player.money < amount) {
    log(game, player.name + ' is short of ' + amount + ' and the bank sells holdings to cover it.', 'warn');
    banking.raiseCash(game, player, amount);
  }

  if (player.money >= amount) {
    if (creditor && !creditor.bankrupt) {
      banking.transferBetween(game, player, creditor, amount, reason);
    } else {
      banking.payBank(game, player, amount, reason);
    }
    rules.checkVictory(game);
    return true;
  }

  /* Still short: out of the game. */
  log(game, player.name + ' cannot pay ' + amount + ' and is out of the match.', 'bad');
  bankrupt(game, player, creditor);
  return false;
}

function bankrupt(game, player, creditor) {
  const owned = banking.tilesOwnedBy(game, player.id);

  owned.forEach(function (tile) {
    const building = game.buildings[tile.index];
    if (!building) return;

    if (creditor && !creditor.bankrupt) {
      /* The creditor takes the property, pawned status and all. */
      building.ownerId = creditor.id;
      building.studios = 0;
    } else {
      /* No creditor: the property returns to the bank and can be bought again. */
      delete game.buildings[tile.index];
    }
  });

  if (creditor && !creditor.bankrupt && player.money > 0) {
    banking.transferBetween(game, player, creditor, player.money, 'Remaining cash after bankruptcy');
  }

  player.money = 0;
  player.bankrupt = true;
  player.inHold = false;

  game.trades = game.trades.filter(function (trade) {
    return trade.fromId !== player.id && trade.toId !== player.id;
  });

  rules.checkVictory(game);

  /* If the bankrupt player was mid-turn, play continues with the next player. */
  if (!game.finishedAt && game.turnPlayerId === player.id) {
    nextTurn(game);
  }
}

/* ---------------------------------------------------------------------------
   Player actions (each one validated, then applied)
   --------------------------------------------------------------------------- */

function requireTurn(game, playerId) {
  if (game.finishedAt) return refuse('The match has finished');
  if (game.turnPlayerId !== playerId) return refuse('It is not your turn');
  const player = rules.playerById(game, playerId);
  if (!player || player.bankrupt) return refuse('You are no longer in this match');
  return accept({ player: player });
}

function buyProperty(game, playerId, tileIndex) {
  const turn = requireTurn(game, playerId);
  if (!turn.ok) return turn;

  const tile = properties.tileAt(Number(tileIndex));
  const allowed = rules.canBuy(game, tile, turn.player);
  if (!allowed.ok) return refuse(allowed.reason);

  banking.payBank(game, turn.player, tile.price, 'Bought ' + tile.name);
  game.buildings[tile.index] = { ownerId: turn.player.id, studios: 0, mortgaged: false };
  log(game, turn.player.name + ' buys ' + tile.name + ' for ' + tile.price + '.', 'good');

  return accept();
}

function build(game, playerId, tileIndex) {
  const turn = requireTurn(game, playerId);
  if (!turn.ok) return turn;

  const tile = properties.tileAt(Number(tileIndex));
  const allowed = rules.canBuild(game, tile, turn.player);
  if (!allowed.ok) return refuse(allowed.reason);

  banking.payBank(game, turn.player, allowed.cost, 'Built on ' + tile.name);
  const building = game.buildings[tile.index];
  building.studios += 1;

  log(
    game,
    turn.player.name + ' adds ' + (building.studios > properties.MAX_STUDIOS ? 'a tower on ' : 'a studio on ') + tile.name + ' for ' + allowed.cost + '.',
    'good'
  );
  return accept();
}

function sellStudio(game, playerId, tileIndex) {
  const turn = requireTurn(game, playerId);
  if (!turn.ok) return turn;

  const tile = properties.tileAt(Number(tileIndex));
  const allowed = rules.canSellStudio(game, tile, turn.player);
  if (!allowed.ok) return refuse(allowed.reason);

  game.buildings[tile.index].studios -= 1;
  banking.payFromBank(game, turn.player, allowed.refund, 'Sold a studio on ' + tile.name);
  log(game, turn.player.name + ' sells a studio on ' + tile.name + ' for ' + allowed.refund + '.', 'warn');
  return accept();
}

function mortgage(game, playerId, tileIndex) {
  const turn = requireTurn(game, playerId);
  if (!turn.ok) return turn;

  const tile = properties.tileAt(Number(tileIndex));
  const allowed = rules.canMortgage(game, tile, turn.player);
  if (!allowed.ok) return refuse(allowed.reason);

  game.buildings[tile.index].mortgaged = true;
  banking.payFromBank(game, turn.player, allowed.payout, 'Pawned ' + tile.name);
  log(game, turn.player.name + ' pawns ' + tile.name + ' for ' + allowed.payout + '.', 'warn');
  return accept();
}

function unmortgage(game, playerId, tileIndex) {
  const turn = requireTurn(game, playerId);
  if (!turn.ok) return turn;

  const tile = properties.tileAt(Number(tileIndex));
  const allowed = rules.canUnmortgage(game, tile, turn.player);
  if (!allowed.ok) return refuse(allowed.reason);

  banking.payBank(game, turn.player, allowed.cost, 'Bought back ' + tile.name);
  game.buildings[tile.index].mortgaged = false;
  log(game, turn.player.name + ' buys back ' + tile.name + ' for ' + allowed.cost + '.', 'good');
  return accept();
}

function payHoldFine(game, playerId) {
  const turn = requireTurn(game, playerId);
  if (!turn.ok) return turn;

  const player = turn.player;
  if (!player.inHold) return refuse('You are not at the Harbour Hold');

  if (player.holdPasses > 0) {
    player.holdPasses -= 1;
    player.inHold = false;
    player.holdTurns = 0;
    log(game, player.name + ' uses a Harbour Hold pass to leave.', 'good');
    return accept();
  }

  if (player.money < properties.HOLD_FINE) {
    return refuse('You need ' + properties.HOLD_FINE + ' to pay the fine');
  }

  banking.payBank(game, player, properties.HOLD_FINE, 'Harbour Hold fine');
  if (game.settings.freeParkingPot) game.pot += properties.HOLD_FINE;
  player.inHold = false;
  player.holdTurns = 0;
  log(game, player.name + ' pays the ' + properties.HOLD_FINE + ' fine and is released.', 'warn');
  return accept();
}

function endTurn(game, playerId) {
  const turn = requireTurn(game, playerId);
  if (!turn.ok) return turn;

  if (game.phase === 'roll') return refuse('Roll the dice first');

  const player = turn.player;
  const rolledDoubles = game.dice && game.dice.doubles;

  if (rolledDoubles && !player.inHold && game.doublesCount < 3) {
    game.dice = null;
    game.phase = 'roll';
    armTurnDeadline(game);
    log(game, player.name + ' rolled doubles and rolls again.', 'card');
    return accept({ again: true });
  }

  nextTurn(game);
  return accept();
}

/* ---------------------------------------------------------------------------
   Trading
   --------------------------------------------------------------------------- */

function validateTradeSide(game, player, side) {
  if (!side) return 'An offer needs both sides';

  const tiles = side.tiles || [];
  for (let i = 0; i < tiles.length; i++) {
    const tile = properties.tileAt(Number(tiles[i]));
    if (!tile || !properties.isPurchasable(tile)) return 'That item cannot be traded';
    if (rules.ownerIdOf(game, tile.index) !== player.id) return player.name + ' does not own ' + tile.name;
  }

  const money = Number(side.money) || 0;
  if (money < 0) return 'An offer cannot contain negative money';
  if (money > player.money) return player.name + ' does not have ' + money + ' in cash';

  return null;
}

function proposeTrade(game, playerId, payload) {
  const turn = requireTurn(game, playerId);
  if (!turn.ok) return turn;
  if (!game.settings.trading) return refuse('Trading is switched off in this game');

  const toPlayer = rules.playerById(game, payload.toId);
  if (!toPlayer || toPlayer.bankrupt) return refuse('That player is not in the match');
  if (toPlayer.id === turn.player.id) return refuse('You cannot trade with yourself');

  const giveProblem = validateTradeSide(game, turn.player, payload.give);
  if (giveProblem) return refuse(giveProblem);

  const wantProblem = validateTradeSide(game, toPlayer, payload.want);
  if (wantProblem) return refuse(wantProblem);

  const giveEmpty = !(payload.give.tiles || []).length && !(Number(payload.give.money) || 0);
  const wantEmpty = !(payload.want.tiles || []).length && !(Number(payload.want.money) || 0);
  if (giveEmpty && wantEmpty) return refuse('An empty offer is not a trade');

  game.trades = game.trades.filter(function (trade) {
    return trade.fromId !== turn.player.id || trade.toId !== toPlayer.id;
  });

  const trade = {
    id: 'trade_' + Math.random().toString(36).slice(2, 10),
    fromId: turn.player.id,
    toId: toPlayer.id,
    give: { money: Number(payload.give.money) || 0, tiles: (payload.give.tiles || []).map(Number) },
    want: { money: Number(payload.want.money) || 0, tiles: (payload.want.tiles || []).map(Number) },
    status: 'pending',
    createdAt: Date.now(),
    expiresAt: Date.now() + TRADE_LIFETIME_MS
  };

  game.trades.push(trade);
  log(game, turn.player.name + ' offers ' + toPlayer.name + ' a trade.', 'info');
  return accept({ tradeId: trade.id });
}

function respondTrade(game, playerId, payload) {
  /* Once the results are on screen, nothing may move money or deeds: doing so
     would change a finished match's net worth after the winner was decided. */
  if (game.finishedAt) return refuse('The match has finished');

  const trade = game.trades.find(function (item) {
    return item.id === payload.tradeId;
  });
  if (!trade) return refuse('That offer is no longer available');
  if (trade.status !== 'pending') return refuse('That offer was already answered');
  if (trade.toId !== playerId) return refuse('That offer is not yours to answer');
  if (Date.now() > trade.expiresAt) {
    trade.status = 'expired';
    return refuse('That offer has expired');
  }

  /* Answering does not need to be your turn, but you must still be in the match. */
  const player = rules.playerById(game, playerId);
  const proposer = rules.playerById(game, trade.fromId);
  if (!player || player.bankrupt || !proposer || proposer.bankrupt) {
    trade.status = 'cancelled';
    return refuse('One of the players has left the match');
  }

  if (!payload.accept) {
    trade.status = 'rejected';
    log(game, player.name + ' declines the trade from ' + proposer.name + '.', 'info');
    return accept();
  }

  /* Re-check everything at the moment of acceptance: ownership may have changed
     since the offer was made, and money may have been spent. */
  const giveProblem = validateTradeSide(game, proposer, trade.give);
  const wantProblem = validateTradeSide(game, player, trade.want);
  if (giveProblem || wantProblem) {
    trade.status = 'cancelled';
    return refuse(giveProblem || wantProblem);
  }

  applyTrade(game, trade, proposer, player);
  trade.status = 'accepted';
  log(game, proposer.name + ' and ' + player.name + ' complete a trade.', 'good');
  return accept();
}

/* Moving money and deeds across in one go: either all of it happens or none. */
function applyTrade(game, trade, proposer, accepter) {
  if (trade.give.money > 0) {
    banking.transferBetween(game, proposer, accepter, trade.give.money, 'Trade payment');
  }
  if (trade.want.money > 0) {
    banking.transferBetween(game, accepter, proposer, trade.want.money, 'Trade payment');
  }

  trade.give.tiles.forEach(function (index) {
    const building = game.buildings[index];
    if (building) building.ownerId = accepter.id;
  });

  trade.want.tiles.forEach(function (index) {
    const building = game.buildings[index];
    if (building) building.ownerId = proposer.id;
  });
}

function cancelTrade(game, playerId, payload) {
  if (game.finishedAt) return refuse('The match has finished');

  const trade = game.trades.find(function (item) {
    return item.id === payload.tradeId;
  });
  if (!trade) return refuse('That offer is no longer available');
  if (trade.fromId !== playerId && trade.toId !== playerId) return refuse('That offer is not yours');
  if (trade.status !== 'pending') return refuse('That offer was already answered');

  trade.status = 'cancelled';
  log(game, 'A trade offer was withdrawn.', 'info');
  return accept();
}

/* Offered trades time out after a minute so a lobby never gets stuck. */
function expireTrades(game) {
  game.trades.forEach(function (trade) {
    if (trade.status === 'pending' && Date.now() > trade.expiresAt) {
      trade.status = 'expired';
    }
  });
}

/* ---------------------------------------------------------------------------
   Turn timer expiry (called once a second by cleanup.js)
   --------------------------------------------------------------------------- */

function forceEndTurn(game) {
  if (game.finishedAt) return;
  const player = turnPlayer(game);
  if (!player) return;

  log(game, 'Time ran out for ' + player.name + '.', 'warn');

  if (game.phase === 'roll') {
    nextTurn(game);
    return;
  }

  game.dice = null;
  nextTurn(game);
}

/* ---------------------------------------------------------------------------
   What the browser is allowed to see
   --------------------------------------------------------------------------- */

function stateForClient(game) {
  return {
    code: game.code,
    settings: game.settings,
    players: game.players.map(function (player) {
      return {
        id: player.id,
        name: player.name,
        colour: player.colour,
        token: player.token,
        money: player.money,
        position: player.position,
        inHold: player.inHold,
        holdTurns: player.holdTurns,
        holdPasses: player.holdPasses,
        bankrupt: player.bankrupt,
        netWorth: rules.netWorth(game, player)
      };
    }),
    buildings: game.buildings,
    turnPlayerId: game.turnPlayerId,
    phase: game.phase,
    dice: game.dice,
    doublesCount: game.doublesCount,
    round: game.round,
    pot: game.pot,
    trades: game.trades.filter(function (trade) {
      return trade.status === 'pending';
    }),
    ledger: game.ledger.slice(-40),
    history: game.history.slice(-40),
    lastCard: game.lastCard,
    winnerId: game.winnerId,
    endReason: game.endReason,
    finishedAt: game.finishedAt,
    turnDeadlineAt: game.turnDeadlineAt
  };
}

module.exports = {
  SEATS: SEATS,
  createGame: createGame,
  stateForClient: stateForClient,
  rollDice: rollDice,
  buyProperty: buyProperty,
  build: build,
  sellStudio: sellStudio,
  mortgage: mortgage,
  unmortgage: unmortgage,
  payHoldFine: payHoldFine,
  endTurn: endTurn,
  proposeTrade: proposeTrade,
  respondTrade: respondTrade,
  cancelTrade: cancelTrade,
  expireTrades: expireTrades,
  forceEndTurn: forceEndTurn,
  /* Exported so tests can drive a single space landing or card draw directly.
     Sockets never call these: the browser can only send the actions above. */
  resolveTile: resolveTile,
  applyCard: applyCard,
  nextTurn: nextTurn,
  settleDebt: settleDebt,
  log: log
};
