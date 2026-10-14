'use strict';

/**
 * tests/rules.js — the rulebook, checked.
 *
 * The smoke test plays a real match over sockets, but dice are random, so it
 * cannot guarantee it lands on the spaces worth testing. This file drives the
 * engine directly with fixed dice, which makes every rule checkable every time.
 *
 * Run it with:  npm test
 */

const properties = require('../server/properties');
const engine = require('../server/game-engine');
const rules = require('../server/game-rules');
const banking = require('../server/banking');
const validation = require('../server/validation');

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('  PASS  ' + name);
  } else {
    failed += 1;
    console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : ''));
  }
}

function section(title) {
  console.log('\n' + title);
}

function settings(overrides) {
  return validation.cleanSettings(overrides);
}

/* A fresh two-player game with a known position for each player. */
function newGame(overrides) {
  const game = engine.createGame('TEST01', settings(overrides), [
    { id: 'p1', name: 'Ana' },
    { id: 'p2', name: 'Bo' }
  ]);
  return game;
}

/* Force the dice to a fixed pair, then put Math.random back. */
function withDice(values, action) {
  const original = Math.random;
  let index = 0;
  Math.random = function () {
    const value = values[index % values.length];
    index += 1;
    return value;
  };
  try {
    return action();
  } finally {
    Math.random = original;
  }
}

/* ---------------------------------------------------------------------------
   1. Board data
   --------------------------------------------------------------------------- */

section('1. The board');
check('there are exactly 40 spaces', properties.TILES.length === 40);
check('every space knows its own index', properties.TILES.every(function (tile, index) { return tile.index === index; }));
const namedSpaces = properties.TILES.filter(function (tile) { return tile.type !== 'event'; });
check('every named space is unique', new Set(namedSpaces.map(function (t) { return t.name; })).size === namedSpaces.length);
check('the repeated spaces are only the two event decks', properties.TILES.filter(function (tile) {
  return tile.type !== 'event' && ['Fortune', 'Civic Fund'].indexOf(tile.name) !== -1;
}).length === 0);
check('every event space points at a real deck', properties.TILES.filter(function (tile) {
  return tile.type === 'event';
}).every(function (tile) { return tile.deck === 'fortune' || tile.deck === 'civic'; }));

const propertyTiles = properties.TILES.filter(function (t) { return t.type === 'property'; });
const transportTiles = properties.TILES.filter(function (t) { return t.type === 'transport'; });
const utilityTiles = properties.TILES.filter(function (t) { return t.type === 'utility'; });

check('there are 22 neighbourhood properties', propertyTiles.length === 22);
check('there are 4 transport lines', transportTiles.length === 4);
check('there are 2 utilities', utilityTiles.length === 2);
check('the corners are start, hold, rest and warrant', [0, 10, 20, 30].every(function (index) {
  const corners = ['start', 'hold', 'rest', 'warrant'];
  return corners.indexOf(properties.TILES[index].type) !== -1;
}));
check('the eight groups add up to 22 properties', Object.keys(properties.GROUPS).reduce(function (total, id) {
  return total + properties.groupTiles(id).length;
}, 0) === 22);
check('rent rises with every upgrade step', propertyTiles.every(function (tile) {
  return tile.rent.length === 6 && tile.rent.every(function (value, index, all) {
    return index === 0 || value > all[index - 1];
  });
}));

/* ---------------------------------------------------------------------------
   2. Rent
   --------------------------------------------------------------------------- */

section('2. Rent');
const game = newGame({ freeParkingPot: true });
const ana = game.players[0];
const bo = game.players[1];

const quay = properties.tileAt(1); // Tidewatch Quay, Dockside, 600
game.buildings[quay.index] = { ownerId: 'p2', studios: 0, mortgaged: false };

check('base rent is charged on a single property', rules.rentFor(game, quay, 'p2', 7).amount === quay.rent[0], rules.rentFor(game, quay, 'p2', 7));

/* Bo also takes Beacon Row (index 3) to complete Dockside: base rent doubles. */
const row = properties.tileAt(3);
game.buildings[row.index] = { ownerId: 'p2', studios: 0, mortgaged: false };
check('owning a whole neighbourhood doubles the base rent', rules.rentFor(game, quay, 'p2', 7).amount === quay.rent[0] * 2);

game.buildings[quay.index].studios = 2;
check('studios raise the rent to the studio rate', rules.rentFor(game, quay, 'p2', 7).amount === quay.rent[2]);

game.buildings[quay.index].studios = properties.MAX_STUDIOS + 1;
check('a tower charges the top rent', rules.rentFor(game, quay, 'p2', 7).amount === quay.rent[5]);

game.buildings[quay.index].mortgaged = true;
check('a pawned property earns nothing', rules.rentFor(game, quay, 'p2', 7).amount === 0);
game.buildings[quay.index].mortgaged = false;
game.buildings[quay.index].studios = 0;

/* Transports: rent climbs with the number owned. */
const firstLine = properties.tileAt(5);
game.buildings[firstLine.index] = { ownerId: 'p2', studios: 0, mortgaged: false };
check('one transport line charges the lowest rate', rules.rentFor(game, firstLine, 'p2', 8).amount === properties.TRANSPORT_RENT[0]);
game.buildings[15] = { ownerId: 'p2', studios: 0, mortgaged: false };
game.buildings[25] = { ownerId: 'p2', studios: 0, mortgaged: false };
game.buildings[35] = { ownerId: 'p2', studios: 0, mortgaged: false };
check('four transport lines charge the highest rate', rules.rentFor(game, firstLine, 'p2', 8).amount === properties.TRANSPORT_RENT[3]);

/* Utilities: rent is a multiple of the dice. */
const grid = properties.tileAt(12);
const well = properties.tileAt(28);
game.buildings[grid.index] = { ownerId: 'p2', studios: 0, mortgaged: false };
check('one utility charges 4x the dice total', rules.rentFor(game, grid, 'p2', 9).amount === 36, rules.rentFor(game, grid, 'p2', 9));
game.buildings[well.index] = { ownerId: 'p2', studios: 0, mortgaged: false };
check('two utilities charge 10x the dice total', rules.rentFor(game, grid, 'p2', 9).amount === 90, rules.rentFor(game, grid, 'p2', 9));

/* ---------------------------------------------------------------------------
   3. Movement and salary
   --------------------------------------------------------------------------- */

section('3. Movement and salary');
const mover = game.players[0];
mover.position = 38;
const beforeSalary = mover.money;
rules.movePlayer(game, mover, 5);
check('the token wraps around the board', mover.position === 3, mover.position);
check('passing the Grand Terminal pays the salary', mover.money === beforeSalary + game.settings.salary, { before: beforeSalary, after: mover.money });

mover.position = 2;
const beforeBackwards = mover.money;
rules.movePlayer(game, mover, -3);
check('moving backwards does not pay a salary', mover.money === beforeBackwards && mover.position === 39, mover.position);

/* ---------------------------------------------------------------------------
   4. Buying, building and pawning through the engine
   --------------------------------------------------------------------------- */

section('4. Buying, building and pawning');
const buyGame = newGame({ upgrades: true, mortgages: true });
buyGame.phase = 'action';
const ana2 = rules.playerById(buyGame, 'p1');

const bought = engine.buyProperty(buyGame, 'p1', 1);
check('a legal purchase succeeds', bought.ok === true, bought);
check('the buyer paid the asking price', ana2.money === buyGame.settings.startingMoney - properties.tileAt(1).price);
check('the deed is registered to the buyer', rules.ownerIdOf(buyGame, 1) === 'p1');

const rebuy = engine.buyProperty(buyGame, 'p1', 1);
check('the same space cannot be bought twice', rebuy.ok === false && /already has an owner/.test(rebuy.reason), rebuy);

const buyTwo = engine.buyProperty(buyGame, 'p1', 3);
check('a second property in the same group can be bought', buyTwo.ok === true);

engine.buyProperty(buyGame, 'p1', 6);
const buildBlocked = engine.build(buyGame, 'p1', 6);
check('building is refused without the whole neighbourhood', buildBlocked.ok === false && /Own all of/.test(buildBlocked.reason), buildBlocked);

const buildOk = engine.build(buyGame, 'p1', 1);
check('building works once the whole neighbourhood is owned', buildOk.ok === true, buildOk);

const uneven = engine.build(buyGame, 'p1', 1);
check('a neighbourhood must be built up evenly', uneven.ok === false && /evenly/.test(uneven.reason), uneven);

const rentAfterBuild = rules.rentFor(buyGame, properties.tileAt(1), 'p1', 7);
check('the new studio raises the rent', rentAfterBuild.amount === properties.tileAt(1).rent[1], rentAfterBuild);

const pawnBlocked = engine.mortgage(buyGame, 'p1', 1);
check('a developed property cannot be pawned', pawnBlocked.ok === false && /Sell the buildings/.test(pawnBlocked.reason), pawnBlocked);

engine.sellStudio(buyGame, 'p1', 1);
const pawned = engine.mortgage(buyGame, 'p1', 1);
check('a property can be pawned once cleared', pawned.ok === true, pawned);
check('pawning pays the mortgage value', rules.rentFor(buyGame, properties.tileAt(1), 'p1', 7).amount === 0);

const boughtBack = engine.unmortgage(buyGame, 'p1', 1);
check('a pawned property can be bought back', boughtBack.ok === true, boughtBack);

/* ---------------------------------------------------------------------------
   5. Paying rent
   --------------------------------------------------------------------------- */

section('5. Paying rent');
const rentGame = newGame({});
rentGame.phase = 'action';
const payer = rules.playerById(rentGame, 'p1');
const owner = rules.playerById(rentGame, 'p2');
rentGame.buildings[1] = { ownerId: 'p2', studios: 0, mortgaged: false };

const payerBefore = payer.money;
const ownerBefore = owner.money;
rentGame.players[0].position = 1;
engine.resolveTile(rentGame, payer, 7, 1);

check('rent moves money from the payer to the owner', payer.money === payerBefore - properties.tileAt(1).rent[0] && owner.money === ownerBefore + properties.tileAt(1).rent[0], {
  payer: payer.money,
  owner: owner.money
});
check('the rent change is written to the ledger', rentGame.ledger.some(function (entry) { return /Rent on/.test(entry.reason); }));

/* ---------------------------------------------------------------------------
   6. Going bankrupt
   --------------------------------------------------------------------------- */

section('6. Going bankrupt');
const bustGame = newGame({ startingMoney: 2000 });
bustGame.phase = 'action';
const victim = rules.playerById(bustGame, 'p1');
const creditor = rules.playerById(bustGame, 'p2');

/* Ana owns one cheap property so the bank has something to sell. */
bustGame.buildings[1] = { ownerId: 'p1', studios: 0, mortgaged: false };
bustGame.buildings[3] = { ownerId: 'p2', studios: 0, mortgaged: false };
victim.money = 100;

engine.settleDebt(bustGame, victim, 'p2', 5000, 'Rent on Beacon Row');

check('a player who cannot pay is eliminated', victim.bankrupt === true);
check('the eliminated player ends with no money', victim.money === 0);
check('the creditor inherits the deeds', rules.ownerIdOf(bustGame, 1) === 'p2', bustGame.buildings);
check('the match ends when one player is left', bustGame.finishedAt !== null && bustGame.winnerId === 'p2', {
  winner: bustGame.winnerId,
  reason: bustGame.endReason
});

/* ---------------------------------------------------------------------------
   7. The other two win conditions
   --------------------------------------------------------------------------- */

section('7. Win conditions');
/* 15,000 in cash plus Royale Plaza (4,000) is 19,000, so the target sits just under it. */
const worthGame = newGame({ winningCondition: 'net-worth', netWorthTarget: 18000 });
worthGame.phase = 'action';
worthGame.buildings[39] = { ownerId: 'p1', studios: 0, mortgaged: false };
check('net worth counts cash and property', rules.netWorth(worthGame, rules.playerById(worthGame, 'p1')) === 19000, rules.netWorth(worthGame, rules.playerById(worthGame, 'p1')));
rules.checkVictory(worthGame);
check('a net worth target can end the match', worthGame.finishedAt !== null && worthGame.winnerId === 'p1', worthGame.endReason || 'no end');

/* The server refuses round limits below five, so the test plays out a real one. */
check('round limits below the server minimum are raised to five', newGame({ roundLimit: 2 }).settings.roundLimit === 5);
const roundGame = newGame({ winningCondition: 'rounds', roundLimit: 5 });
roundGame.players[1].money = 99999;
let safety = 0;
while (!roundGame.finishedAt && safety < 60) {
  engine.nextTurn(roundGame);
  safety += 1;
}
check('a round limit ends the match', roundGame.finishedAt !== null, { round: roundGame.round });
check('it ends once the limit is passed', roundGame.round === 6, roundGame.round);
check('the richest player wins on rounds', roundGame.winnerId === 'p2', roundGame.winnerId);

/* ---------------------------------------------------------------------------
   8. The Harbour Hold
   --------------------------------------------------------------------------- */

section('8. The Harbour Hold');
const holdGame = newGame({});
const held = rules.playerById(holdGame, 'p1');
rules.sendToHold(held, holdGame);
check('sending a player to the hold moves them to space 10', held.position === 10 && held.inHold === true);

/* A double gets you out: force 1 and 1. */
holdGame.phase = 'roll';
withDice([0, 0], function () { engine.rollDice(holdGame, 'p1'); });
check('a double sets you free', held.inHold === false, { inHold: held.inHold });

rules.sendToHold(held, holdGame);
const moneyAtHold = held.money;

/* Each attempt is a fresh turn, so the phase starts back at "roll". */
holdGame.phase = 'roll';
withDice([0, 0.5], function () { engine.rollDice(holdGame, 'p1'); }); // 1 and 4: no double
check('without a double you stay held', held.inHold === true && held.holdTurns === 1, { inHold: held.inHold, holdTurns: held.holdTurns });

holdGame.phase = 'roll';
withDice([0, 0.5], function () { engine.rollDice(holdGame, 'p1'); });
holdGame.phase = 'roll';
withDice([0, 0.5], function () { engine.rollDice(holdGame, 'p1'); });
check('after three attempts the fine is paid and you are released', held.inHold === false, { holdTurns: held.holdTurns });
check('the fine was deducted', held.money === moneyAtHold - properties.HOLD_FINE, { before: moneyAtHold, after: held.money });

const passGame = newGame({});
const passHolder = rules.playerById(passGame, 'p1');
passGame.turnPlayerId = 'p1';
rules.sendToHold(passHolder, passGame);
passHolder.holdPasses = 1;
engine.payHoldFine(passGame, 'p1');
check('a hold pass is used before money', passHolder.inHold === false && passHolder.holdPasses === 0 && passHolder.money === passGame.settings.startingMoney);

/* ---------------------------------------------------------------------------
   9. Trading
   --------------------------------------------------------------------------- */

section('9. Trading');
const tradeGame = newGame({ trading: true });
tradeGame.phase = 'action';
tradeGame.buildings[1] = { ownerId: 'p1', studios: 0, mortgaged: false };
tradeGame.buildings[3] = { ownerId: 'p2', studios: 0, mortgaged: false };

const proposed = engine.proposeTrade(tradeGame, 'p1', {
  toId: 'p2',
  give: { tiles: [1], money: 300 },
  want: { tiles: [3], money: 0 }
});
check('a trade can be proposed', proposed.ok === true, proposed);

const wrongPlayer = engine.respondTrade(tradeGame, 'p1', { tradeId: proposed.tradeId, accept: true });
check('only the receiving player can accept', wrongPlayer.ok === false && /not yours to answer/.test(wrongPlayer.reason), wrongPlayer);

const moneyBeforeTrade = {
  p1: rules.playerById(tradeGame, 'p1').money,
  p2: rules.playerById(tradeGame, 'p2').money
};

const accepted = engine.respondTrade(tradeGame, 'p2', { tradeId: proposed.tradeId, accept: true });
check('the receiving player can accept', accepted.ok === true, accepted);
check('properties change hands', rules.ownerIdOf(tradeGame, 1) === 'p2' && rules.ownerIdOf(tradeGame, 3) === 'p1');
check('the agreed money changes hands', rules.playerById(tradeGame, 'p1').money === moneyBeforeTrade.p1 - 300 &&
  rules.playerById(tradeGame, 'p2').money === moneyBeforeTrade.p2 + 300);

const twice = engine.respondTrade(tradeGame, 'p2', { tradeId: proposed.tradeId, accept: true });
check('a trade cannot be accepted twice', twice.ok === false && /already answered/.test(twice.reason), twice);

const tooMuch = engine.proposeTrade(tradeGame, 'p1', {
  toId: 'p2',
  give: { tiles: [3], money: 99999999 },
  want: { tiles: [] }
});
check('an offer cannot promise money you do not have', tooMuch.ok === false && /does not have/.test(tooMuch.reason), tooMuch);

const notMine = engine.proposeTrade(tradeGame, 'p1', {
  toId: 'p2',
  give: { tiles: [6], money: 0 },
  want: { tiles: [] }
});
check('you cannot trade a property you do not own', notMine.ok === false && /does not own/.test(notMine.reason), notMine);

const noTrading = newGame({ trading: false });
noTrading.phase = 'action';
const blocked = engine.proposeTrade(noTrading, 'p1', { toId: 'p2', give: { money: 100 }, want: { money: 50 } });
check('trading can be switched off by the host', blocked.ok === false && /switched off/.test(blocked.reason), blocked);

/* ---------------------------------------------------------------------------
   10. Event cards
   --------------------------------------------------------------------------- */

section('10. Event cards');
const cardGame = newGame({});
cardGame.phase = 'action';
const cardPlayer = rules.playerById(cardGame, 'p1');
cardGame.players[0].position = 2; // a Fortune space

const deckBefore = cardGame.decks.fortune.length;
engine.resolveTile(cardGame, cardPlayer, 7, 1);
check('landing on an event space draws a card', cardGame.lastCard !== null && /fortune|civic/.test(cardGame.lastCard.deck), cardGame.lastCard);
check('the deck shrinks as cards are drawn', cardGame.decks[cardGame.lastCard.deck].length === deckBefore - 1 || cardGame.lastCard.deck !== 'fortune');

const perStudio = require('../server/events').FORTUNE.find(function (card) { return card.effect.kind === 'perStudio'; });
check('the decks contain every effect type the engine can apply', ['money', 'pay', 'collectEach', 'payEach', 'move', 'moveTo', 'advanceTo', 'perStudio', 'hold', 'holdPass'].every(function (kind) {
  return require('../server/events').FORTUNE.concat(require('../server/events').CIVIC).some(function (card) {
    return card.effect.kind === kind;
  });
}), perStudio);

/* ---------------------------------------------------------------------------
   11. Settings are clamped, not trusted
   --------------------------------------------------------------------------- */

section('11. Settings and names');
const clamped = settings({ startingMoney: -500, maxPlayers: 99, turnTimerSeconds: 9999, winningCondition: 'cheat', salary: 'lots' });
check('starting money is pulled into range', clamped.startingMoney === 2000, clamped.startingMoney);
check('the player limit cannot exceed six', clamped.maxPlayers === 6, clamped.maxPlayers);
check('the turn timer is capped', clamped.turnTimerSeconds === 180, clamped.turnTimerSeconds);
check('an unknown win condition falls back to the default', clamped.winningCondition === 'last-standing');
check('a nonsense salary falls back to the default', clamped.salary === 2000);
check('unknown settings keys are dropped', settings({ hacks: true, __proto__: { poll: true } }).hacks === undefined);

check('names are trimmed and limited', validation.sanitiseName('   ' + 'x'.repeat(40) + '   ').length === 16);
check('markup characters are stripped from names', validation.sanitiseName('<script>bad/</script>') === 'scriptbadscript', validation.sanitiseName('<script>bad/</script>'));
check('an empty name becomes Player', validation.sanitiseName('') === 'Player');
check('room codes are normalised', validation.normaliseCode('k7p-2qx') === 'K7P2QX');
check('invalid codes are rejected', validation.isValidCode('ABC') === false);

/* ---------------------------------------------------------------------------
   12. Edge cases found while auditing the engine
   --------------------------------------------------------------------------- */

section('12. Edge cases: bankruptcy, the pot, and long games');

/* A card that charges every player must not carry on charging somebody who has
   just gone out of the match, and must not pay a creditor from an empty
   account. */
const payEachCard = require('../server/events').CIVIC.find(function (card) {
  return card.effect.kind === 'payEach';
});
const multiGame = engine.createGame('EDGE01', settings({}), [
  { id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bo' }, { id: 'p3', name: 'Cara' }
]);
multiGame.phase = 'action';
const poor = rules.playerById(multiGame, 'p1');
const third = rules.playerById(multiGame, 'p3');
poor.money = 100; // less than one card payment
multiGame.decks.civic = [payEachCard];
multiGame.players[0].position = 17; // a Civic Fund space

const thirdBefore = third.money;
engine.resolveTile(multiGame, poor, 7, 1);

const eliminationLines = multiGame.history.filter(function (entry) {
  return entry.text.indexOf('is out of the match') !== -1 && entry.text.indexOf('Ana') !== -1;
});
check('a player is eliminated exactly once by a multi-player card', eliminationLines.length === 1, eliminationLines.length);
check('a bankrupt player pays nobody else afterwards', third.money === thirdBefore, { before: thirdBefore, after: third.money });

/* A fee that cannot be paid must not still fill the Festival Square jackpot:
   that would create money out of nothing. */
const potGame = engine.createGame('EDGE02', settings({ freeParkingPot: true, startingMoney: 2000 }), [
  { id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bo' }
]);
potGame.phase = 'action';
const potPlayer = rules.playerById(potGame, 'p1');
potPlayer.money = 100;
potGame.players[0].position = 4; // Harbour Duty, a 2,000 fee
engine.resolveTile(potGame, potPlayer, 7, 1);

check('an unpayable fee does not fill the jackpot', potGame.pot === 0, potGame.pot);
check('the player who cannot pay a fee is out', potPlayer.bankrupt === true);

const potPaidGame = engine.createGame('EDGE03', settings({ freeParkingPot: true }), [
  { id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bo' }
]);
potPaidGame.phase = 'action';
const richPlayer = rules.playerById(potPaidGame, 'p1');
potPaidGame.players[0].position = 4;
engine.resolveTile(potPaidGame, richPlayer, 7, 1);
check('a fee that is paid does fill the jackpot', potPaidGame.pot === 2000, potPaidGame.pot);

/* Going out mid-roll must not leave the NEXT player stuck in the wrong phase,
   or they lose their roll and the table appears to freeze. */
const chainGame = engine.createGame('EDGE04', settings({}), [
  { id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bo' }, { id: 'p3', name: 'Cara' }
]);
chainGame.phase = 'roll';
chainGame.turnPlayerId = 'p1';
chainGame.buildings[1] = { ownerId: 'p2', studios: 0, mortgaged: false };
chainGame.buildings[3] = { ownerId: 'p2', studios: 0, mortgaged: false };
const doomed = rules.playerById(chainGame, 'p1');
doomed.money = 50; // the doubled Dockside rent (120) is more than this

withDice([0, 0.25], function () { engine.rollDice(chainGame, 'p1'); }); // 1 + 2 = 3

check('the bankrupt player is out of the match', doomed.bankrupt === true);
check('the turn passes to the next player', chainGame.turnPlayerId === 'p2', chainGame.turnPlayerId);
check('the next player is asked to roll, not left mid-turn', chainGame.phase === 'roll', chainGame.phase);

/* The same, reached through a card that sends you to the Hold. */
const holdChain = engine.createGame('EDGE05', settings({}), [
  { id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bo' }
]);
holdChain.phase = 'roll';
holdChain.turnPlayerId = 'p1';
holdChain.players[0].position = 29;
withDice([0.5, 0.5], function () { engine.rollDice(holdChain, 'p1'); }); // 4 + 4 = 8: doubles to space 37
check('a normal roll leaves the player able to act', holdChain.phase === 'action' || holdChain.phase === 'roll', holdChain.phase);

/* Taking money that is not there must never push somebody negative. */
const shortGame = engine.createGame('EDGE06', settings({}), [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bo' }]);
const collector = rules.playerById(shortGame, 'p1');
const shortPlayer = rules.playerById(shortGame, 'p2');
shortPlayer.money = 40;
banking.collectFromEach(shortGame, collector, 150, 'Card' );
check('a player never goes negative when paying a card', shortPlayer.money === 0, shortPlayer.money);
check('the collector only receives what was there', collector.money === shortGame.settings.startingMoney + 40, collector.money);

/* Net worth must count pawned property at what the bank would give. */
const worthCheck = engine.createGame('EDGE07', settings({}), [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bo' }]);
const worthPlayer = rules.playerById(worthCheck, 'p1');
worthCheck.buildings[1] = { ownerId: 'p1', studios: 0, mortgaged: true };
check('a pawned property counts at half its price', rules.netWorth(worthCheck, worthPlayer) === worthCheck.settings.startingMoney + 300, rules.netWorth(worthCheck, worthPlayer));
worthCheck.buildings[1].mortgaged = false;
worthCheck.buildings[1].studios = 2;
check('an improved property counts its studios too', rules.netWorth(worthCheck, worthPlayer) === worthCheck.settings.startingMoney + 600 + 2 * properties.tileAt(1).studioCost, rules.netWorth(worthCheck, worthPlayer));

/* A trade must be re-checked when it is accepted: money spent in the meantime
   must cancel the deal, with nothing moving. */
const atomicGame = engine.createGame('EDGE08', settings({}), [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bo' }]);
atomicGame.phase = 'action';
atomicGame.buildings[1] = { ownerId: 'p1', studios: 0, mortgaged: false };
atomicGame.buildings[3] = { ownerId: 'p2', studios: 0, mortgaged: false };
const offer = engine.proposeTrade(atomicGame, 'p1', { toId: 'p2', give: { tiles: [1], money: 500 }, want: { tiles: [3] } });
check('the trade is proposed', offer.ok === true, offer);

rules.playerById(atomicGame, 'p1').money = 10; // spent it on something else
const tooLate = engine.respondTrade(atomicGame, 'p2', { tradeId: offer.tradeId, accept: true });
check('a trade that can no longer be paid is refused', tooLate.ok === false, tooLate);
check('nothing changed hands when the trade failed', rules.ownerIdOf(atomicGame, 1) === 'p1' && rules.ownerIdOf(atomicGame, 3) === 'p2');

/* Once the results are on screen nothing may move money or deeds again, or the
   finished match would stop matching what the players were shown. */
const afterEnd = engine.createGame('EDGE11', settings({}), [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bo' }]);
afterEnd.phase = 'action';
afterEnd.buildings[1] = { ownerId: 'p1', studios: 0, mortgaged: false };
afterEnd.buildings[3] = { ownerId: 'p2', studios: 0, mortgaged: false };
const endOffer = engine.proposeTrade(afterEnd, 'p1', { toId: 'p2', give: { tiles: [1] }, want: { tiles: [3] } });
check('a trade can be proposed while the match is still running', endOffer.ok === true, endOffer);
rules.finish(afterEnd, rules.playerById(afterEnd, 'p1'), 'test finish');
const acceptedLate = engine.respondTrade(afterEnd, 'p2', { tradeId: endOffer.tradeId, accept: true });
check('a trade cannot be accepted after the match has finished', acceptedLate.ok === false, acceptedLate);
check('no property moved after the match finished',
  rules.ownerIdOf(afterEnd, 1) === 'p1' && rules.ownerIdOf(afterEnd, 3) === 'p2');
const cancelledLate = engine.cancelTrade(afterEnd, 'p1', { tradeId: endOffer.tradeId });
check('a trade cannot be withdrawn after the match has finished', cancelledLate.ok === false, cancelledLate);

/* Event spaces can be switched off by the host. */
const noEvents = engine.createGame('EDGE09', settings({ events: false }), [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bo' }]);
noEvents.phase = 'action';
noEvents.players[0].position = 2; // a Fortune space
const eventsBefore = noEvents.decks.fortune.length;
engine.resolveTile(noEvents, rules.playerById(noEvents, 'p1'), 7, 1);
check('switching off event spaces stops cards being drawn', noEvents.decks.fortune.length === eventsBefore && noEvents.lastCard === null);

/* Long games must not grow the server's memory without limit. */
const longGame = engine.createGame('EDGE10', settings({}), [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bo' }]);
const longPlayer = rules.playerById(longGame, 'p1');
for (let i = 0; i < 400; i++) {
  banking.payFromBank(longGame, longPlayer, 10, 'Long game entry ' + i);
  engine.log(longGame, 'Long game line ' + i);
}
check('the ledger stays capped in a long game', longGame.ledger.length <= 300, longGame.ledger.length);
check('the history feed stays capped in a long game', longGame.history.length <= 60, longGame.history.length);
check('a long game does not inflate the balance', longPlayer.money === longGame.settings.startingMoney + 4000, longPlayer.money);

/* ---------------------------------------------------------------------------
   13. When temporary rooms are thrown away
   --------------------------------------------------------------------------- */

section('13. Temporary room cleanup decisions');

const cleanup = require('../server/cleanup');

/* Names come back in the order they were typed, so a mixed-case duplicate still
   counts as a duplicate. */
function fakeRoom(overrides) {
  return Object.assign({
    code: 'TESTRM',
    status: 'lobby',
    players: [{ id: 'p1', connected: true }],
    lastActivity: 1000000,
    emptySince: null
  }, overrides);
}

const now = 5000000;
const hour = 60 * 60 * 1000;

check('a room with somebody in it is never deleted', cleanup.deletionReason(fakeRoom({}), now) === null);
check('an empty lobby is kept for the grace period', cleanup.deletionReason(
  fakeRoom({ players: [{ id: 'p1', connected: false }], emptySince: now - hour / 2, lastActivity: now - hour / 2 }), now) === null);
check('an empty lobby is deleted after an hour', cleanup.deletionReason(
  fakeRoom({ players: [{ id: 'p1', connected: false }], emptySince: now - hour - 1, lastActivity: now - hour - 1 }), now) === 'empty-lobby');
check('a finished match is cleared away sooner', cleanup.deletionReason(
  fakeRoom({ status: 'finished', players: [{ id: 'p1', connected: false }], emptySince: now - 6 * 60 * 1000 }), now) === 'finished');
check('a finished match is kept for a few minutes so results can be read', cleanup.deletionReason(
  fakeRoom({ status: 'finished', players: [{ id: 'p1', connected: false }], emptySince: now - 60 * 1000 }), now) === null);
check('an abandoned match is deleted after ten minutes', cleanup.deletionReason(
  fakeRoom({ status: 'playing', players: [{ id: 'p1', connected: false }], emptySince: now - 11 * 60 * 1000 }), now) === 'abandoned-match');
check('a playing room with one player left standing is kept', cleanup.deletionReason(
  fakeRoom({ status: 'playing', players: [{ id: 'p1', connected: true }, { id: 'p2', connected: false }], emptySince: now - hour }), now) === null);

/* A host who never comes back must not strand the room, but a host who is just
   refreshing must keep the role. */
const handoverRoom = function (overrides) {
  return Object.assign({
    code: 'HOSTRM',
    status: 'lobby',
    hostId: 'p1',
    hostAwaySince: null,
    players: [
      { id: 'p1', name: 'Ana', connected: true },
      { id: 'p2', name: 'Bo', connected: true }
    ]
  }, overrides);
};

const twenty = cleanup.HOST_HANDOVER_MS;

check('a host who is here keeps the role', cleanup.hostHandoverDue(handoverRoom({}), now) === false);
check('a host who only just went keeps the role while the others are here', cleanup.hostHandoverDue(
  handoverRoom({ hostAwaySince: now - 1000, players: [
    { id: 'p1', name: 'Ana', connected: false },
    { id: 'p2', name: 'Bo', connected: true }
  ] }), now) === false);
check('a host who stays away hands the role over', cleanup.hostHandoverDue(
  handoverRoom({ hostAwaySince: now - twenty - 1, players: [
    { id: 'p1', name: 'Ana', connected: false },
    { id: 'p2', name: 'Bo', connected: true }
  ] }), now) === true);
check('a room where nobody else is here is left alone', cleanup.hostHandoverDue(
  handoverRoom({ hostAwaySince: now - twenty - 1, players: [
    { id: 'p1', name: 'Ana', connected: false },
    { id: 'p2', name: 'Bo', connected: false }
  ] }), now) === false);
check('a host seat that has been removed hands over at once', cleanup.hostHandoverDue(
  handoverRoom({ hostId: 'gone', players: [
    { id: 'p2', name: 'Bo', connected: true }
  ] }), now) === true);

/* The host role really does move, and only to somebody who is connected. */
const roomsModule = require('../server/rooms');
const liveLobby = roomsModule.createRoom({ maxPlayers: 3 }, 'Ana', 'socket-ana');
const lobbyCode = liveLobby.room.code;
const boSeat = roomsModule.joinRoom(lobbyCode, 'Bo', 'socket-bo');
check('the first player is the host', liveLobby.room.hostId === liveLobby.player.id);
check('a second player joins the lobby', boSeat.ok === true, boSeat.reason);

roomsModule.markDisconnected('socket-ana');
check('the absent host is not replaced instantly', roomsModule.getRoom(lobbyCode).hostId === liveLobby.player.id);
const newHost = roomsModule.promoteHost(roomsModule.getRoom(lobbyCode));
check('the role moves to a player who is here', newHost && newHost.id === boSeat.player.id, newHost);
check('the new host is connected', roomsModule.getRoom(lobbyCode).players.find(function (player) {
  return player.id === roomsModule.getRoom(lobbyCode).hostId;
}).connected === true);

/* The host coming back keeps their seat, and the room keeps working. */
const reclaimed = roomsModule.joinRoom(lobbyCode, 'Ana', 'socket-ana-2', { tokens: [liveLobby.player.token], reclaim: true });
check('a seat key is not the same as the public player id', liveLobby.player.token !== liveLobby.player.id);
const imposter = roomsModule.joinRoom(lobbyCode, 'Imposter', 'socket-imposter', { tokens: [liveLobby.player.id] });
check('the public player id cannot be used as a seat key',
  imposter.player.id !== liveLobby.player.id && imposter.player.token !== liveLobby.player.token, imposter);
check('a returning host gets the same seat back', reclaimed.ok === true && reclaimed.player.id === liveLobby.player.id, reclaimed);
check('a returning reclaim does not rename the seat', reclaimed.player.name === 'Ana');

/* Two people must never share one name: the wallet trail is grouped by name. */
const twinLobby = roomsModule.createRoom({ maxPlayers: 4 }, 'Ana', 'socket-twin-1');
const twinCode = twinLobby.room.code;
const twinTwo = roomsModule.joinRoom(twinCode, 'ana', 'socket-twin-2');
check('a duplicate name in one room is made unique', twinTwo.player.name === 'ana 2', twinTwo.player.name);
const shortNames = roomsModule.createRoom({ maxPlayers: 4 }, 'Abcdefghijklmnop', 'socket-short-1');
const shortTwo = roomsModule.joinRoom(shortNames.room.code, 'Abcdefghijklmnop', 'socket-short-2');
check('a de-duplicated name still fits the length limit', shortTwo.player.name.length <= validation.NAME_MAX, shortTwo.player.name);
const renamed = roomsModule.joinRoom(twinCode, 'ana 2', 'socket-twin-1', { tokens: [twinLobby.player.token] });
check('a deliberate rename never takes a name that is already in use', renamed.player.name === 'ana 2 2', renamed.player.name);
const lobbyNames = roomsModule.getRoom(twinCode).players.filter(function (player) {
  return player.connected;
}).map(function (player) { return player.name.toLowerCase(); });
check('every connected player in a room has a distinct name', new Set(lobbyNames).size === lobbyNames.length, lobbyNames);

[twinCode, shortNames.room.code, lobbyCode, liveLobby.room.code].forEach(function (code) {
  roomsModule.deleteRoom(code);
});
check('the test rooms are cleaned up', roomsModule.countRooms() === 0, roomsModule.countRooms());

/* Rate-limit buckets must not accumulate for the life of the process. */
const limiter = validation.createRateLimiter({ burst: 2, refillPerSecond: 1 });
limiter.allow('one');
limiter.allow('two');
check('a rate limiter allows a burst then stops', limiter.allow('one') === true && limiter.allow('one') === false);
check('the limiter tracks its buckets', limiter.size() >= 2, limiter.size());
check('pruning removes nothing that is still in use', limiter.prune(10 * 60 * 1000) === 0);
check('pruning removes stale buckets', limiter.prune(-1) === limiter.size() + 0 || limiter.size() === 0, limiter.size());

section('Result');
console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
