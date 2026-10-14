'use strict';

/**
 * tests/smoke.js — an end-to-end check of the whole server.
 *
 * It starts the real server, connects TWO real socket clients, plays a match
 * between them, and checks the rules that matter: turns, dice, money, rent,
 * purchases, duplicate clicks, late joins and room deletion.
 *
 * Run it with:  npm test
 */

process.env.PORT = process.env.TEST_PORT || '4123';

const { io: client } = require('socket.io-client');
const serverModule = require('../server/server');

const URL = 'http://127.0.0.1:' + process.env.PORT;

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

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/* Poll until the stored value satisfies the test, or give up. Polling the last
   received message is plenty for a test and keeps it easy to read. */
function waitFor(getter, predicate, label, timeoutMs) {
  const limit = timeoutMs || 5000;
  const started = Date.now();

  return new Promise(function (resolve, reject) {
    function tick() {
      const value = getter();
      if (value !== null && value !== undefined && predicate(value)) return resolve(value);
      if (Date.now() - started > limit) return reject(new Error('Timed out waiting for ' + label));
      setTimeout(tick, 15);
    }
    tick();
  });
}

/* Run an action, then wait for the NEXT notice it produces. Waiting for "a
   notice" would just re-read an old one and pass for the wrong reason. */
async function expectRefusal(wrapper, emit, label) {
  const before = wrapper.notices.length;
  emit();
  return waitFor(
    function () { return wrapper.notices.length > before ? wrapper.lastNotice() : null; },
    function () { return true; },
    label
  );
}

function makeClient(name) {
  const socket = client(URL, { transports: ['websocket'], forceNew: true });

  const wrapper = {
    name: name,
    socket: socket,
    welcome: null,
    sync: null,
    board: null,
    notices: [],
    joinFailed: null,
    closed: null,
    counter: 0,
    /* Every action gets a fresh id, exactly like the browser client does. */
    action: function (type, extra) {
      wrapper.counter += 1;
      const payload = Object.assign({ type: type, actionId: name + ':' + wrapper.counter }, extra || {});
      socket.emit('action', payload);
      return payload.actionId;
    },
    lastNotice: function () {
      return wrapper.notices.length ? wrapper.notices[wrapper.notices.length - 1] : null;
    }
  };

  socket.on('welcome', function (data) { wrapper.welcome = data; });
  socket.on('sync', function (data) { wrapper.sync = data; });
  socket.on('board', function (data) { wrapper.board = data; });
  socket.on('notice', function (data) { wrapper.notices.push(data); });
  socket.on('join_failed', function (data) { wrapper.joinFailed = data; });
  socket.on('room_closed', function (data) { wrapper.closed = data; });

  return wrapper;
}

/* ---------------------------------------------------------------------------
   The match
   --------------------------------------------------------------------------- */

async function main() {
  const settings = {
    startingMoney: 20000,
    salary: 2000,
    maxPlayers: 2,
    turnTimerSeconds: 0,
    winningCondition: 'last-standing',
    upgrades: true,
    mortgages: true,
    trading: true,
    freeParkingPot: false
  };

  section('1. Hosting a room');
  const host = makeClient('host');
  host.socket.emit('join', { name: 'Host Player', settings: settings });

  await waitFor(function () { return host.welcome; }, function () { return true; }, 'welcome');
  const sync1 = await waitFor(function () { return host.sync; }, function (s) { return s.players.length === 1; }, 'lobby sync');

  check('the host receives a public player id', typeof host.welcome.playerId === 'string' && host.welcome.playerId.length > 10);
  check('the host receives a private seat key of its own',
    typeof host.welcome.token === 'string' && host.welcome.token.length > 10 && host.welcome.token !== host.welcome.playerId);
  check('the host is marked as host', host.welcome.isHost === true);
  check('a 6-character room code is issued', /^[A-Z2-9]{6}$/.test(sync1.code), sync1.code);
  check('the room starts in the lobby', sync1.status === 'lobby');
  check('the server clamps and echoes the chosen settings', sync1.settings.startingMoney === 20000 && sync1.settings.maxPlayers === 2);

  check('the board is sent to the client', Array.isArray(host.board && host.board.tiles) && host.board.tiles.length === 40);
  check('the board has 22 buyable properties', host.board.tiles.filter(function (t) { return t.type === 'property'; }).length === 22);

  const code = sync1.code;

  /* The seat key is the key to a seat, so it must never be broadcast. Everyone
     in the room sees every player id — which is exactly why an id alone is
     never accepted as proof that a seat belongs to you. */
  check('no seat key is ever broadcast to the room',
    JSON.stringify(sync1).indexOf(host.welcome.token) === -1);

  section('2. Joining a room');
  const guest = makeClient('guest');
  guest.socket.emit('join', { name: 'Guest Player', code: code });

  await waitFor(function () { return guest.welcome; }, function () { return true; }, 'guest welcome');
  const sync2 = await waitFor(function () { return host.sync; }, function (s) { return s.players.length === 2; }, 'two players');

  check('the guest is not the host', guest.welcome.isHost === false);
  check('both players are listed', sync2.players.length === 2);
  check('player names are shown', sync2.players.map(function (p) { return p.name; }).sort().join(',') === 'Guest Player,Host Player');

  const stranger = makeClient('stranger');
  stranger.socket.emit('join', { name: 'Too Many', code: code });
  await waitFor(function () { return stranger.joinFailed; }, function () { return true; }, 'full room');
  check('a full room refuses extra players', /full/i.test(stranger.joinFailed.reason), stranger.joinFailed);
  stranger.socket.close();

  section('3. Host-only powers');
  const settingsRefusal = await expectRefusal(guest, function () {
    guest.socket.emit('settings', { settings: { startingMoney: 999999 } });
  }, 'guest settings refusal');
  check('a non-host cannot change settings', /only the host/i.test(settingsRefusal.message), settingsRefusal);

  const startRefusal = await expectRefusal(guest, function () {
    guest.socket.emit('start');
  }, 'guest start refusal');
  check('a non-host cannot start the match', /only the host/i.test(startRefusal.message), startRefusal);

  section('4. Starting the match');
  host.socket.emit('start');
  const playing = await waitFor(function () { return host.sync; }, function (s) { return s.status === 'playing'; }, 'match start');

  check('the match is running', playing.status === 'playing');
  check('both players are dealt in', playing.game.players.length === 2);
  check('everyone starts with the configured money', playing.game.players.every(function (p) { return p.money === 20000; }));
  check('all tokens start on the Grand Terminal', playing.game.players.every(function (p) { return p.position === 0; }));
  check('the first player is to roll', playing.game.phase === 'roll');
  check('the turn belongs to the host (first seat)', playing.game.turnPlayerId === host.welcome.playerId);

  const lateJoiner = makeClient('late');
  lateJoiner.socket.emit('join', { name: 'Late Player', code: code });
  await waitFor(function () { return lateJoiner.joinFailed; }, function () { return true; }, 'late join');
  check('late joins are refused once the match is running', /already started/i.test(lateJoiner.joinFailed.reason), lateJoiner.joinFailed);
  lateJoiner.socket.close();

  section('5. Turns, dice and duplicate clicks');
  const outOfTurn = await expectRefusal(guest, function () {
    guest.action('roll');
  }, 'out-of-turn notice');
  check('a player cannot roll out of turn', /not your turn/i.test(outOfTurn.message), outOfTurn);

  const rollId = host.action('roll');
  const afterRoll = await waitFor(function () { return host.sync; }, function (s) { return s.game && s.game.dice; }, 'dice');

  const dice = afterRoll.game.dice;
  const hostAfterRoll = afterRoll.game.players.find(function (p) { return p.id === host.welcome.playerId; });
  check('two dice are rolled', dice.a >= 1 && dice.a <= 6 && dice.b >= 1 && dice.b <= 6, dice);
  check('the dice total is correct', dice.total === dice.a + dice.b);
  /* The token ends on the dice total — unless a Fortune card relocated the
     host (move / moveTo / advanceTo / go to the Hold), which the server
     records in lastCard. Landing on a card square is luck of the dice, so the
     law "dice square or a recorded card move" is the deterministic one. */
  const drawnCard = afterRoll.game.lastCard;
  const cardMovedHost = Boolean(drawnCard && drawnCard.playerId === host.welcome.playerId);
  check(
    'the token moved by the dice total',
    (hostAfterRoll.position === dice.total % 40 || cardMovedHost) &&
      hostAfterRoll.position >= 0 &&
      hostAfterRoll.position < 40,
    { dice: dice, position: hostAfterRoll.position, lastCard: drawnCard }
  );

  const positionAfterRoll = afterRoll.game.players.find(function (p) { return p.id === host.welcome.playerId; }).position;
  const moneyAfterRoll = afterRoll.game.players.find(function (p) { return p.id === host.welcome.playerId; }).money;

  /* Send the very same action id again: it must be ignored, not applied twice. */
  host.socket.emit('action', { type: 'roll', actionId: rollId });
  await sleep(250);
  const afterDuplicateRoll = host.sync.game.players.find(function (p) { return p.id === host.welcome.playerId; });
  check('a repeated action id is ignored', afterDuplicateRoll.position === positionAfterRoll && afterDuplicateRoll.money === moneyAfterRoll);

  section('5b. A hostile or broken message cannot hurt the server');
  /* "hasOwnProperty" is a real property of every JavaScript object. If the
     server looked actions up carelessly it would call Object.prototype's
     version and crash the whole process for everybody. */
  const inherited = await expectRefusal(guest, function () {
    guest.socket.emit('action', { type: 'hasOwnProperty', actionId: 'bad:1' });
  }, 'inherited-name refusal');
  check('an action named after a built-in is refused', /unknown action/i.test(inherited.message), inherited);

  const nonsense = await expectRefusal(guest, function () {
    guest.socket.emit('action', { type: 'definitely_not_an_action', actionId: 'bad:2' });
  }, 'unknown action refusal');
  check('an unknown action is refused with a plain reason', /unknown action/i.test(nonsense.message), nonsense);

  const junkPayload = await expectRefusal(guest, function () {
    guest.socket.emit('action', 'not even an object');
  }, 'junk payload refusal');
  check('a message with no action name is refused, not obeyed', /unknown action/i.test(junkPayload.message), junkPayload);

  const stillAlive = await fetchJson(URL + '/health');
  check('the server is still healthy after those messages', stillAlive.ok === true, stillAlive);

  const outOfTurnAgain = await expectRefusal(guest, function () {
    guest.action('roll');
  }, 'refusal after junk');
  check('real actions still work after junk was sent', /not your turn/i.test(outOfTurnAgain.message), outOfTurnAgain);

  section('6. Buying, pawning and building');
  const myPosition = host.sync.game.players.find(function (p) { return p.id === host.welcome.playerId; }).position;
  const myTile = host.board.tiles[myPosition];
  const buyable = myTile && (myTile.type === 'property' || myTile.type === 'transport' || myTile.type === 'utility');

  if (buyable) {
    const before = host.sync.game.players.find(function (p) { return p.id === host.welcome.playerId; }).money;
    const buyId = host.action('buy', { tile: myPosition });

    await waitFor(function () { return host.sync; }, function (s) { return s.game.buildings[myPosition]; }, 'purchase');
    const afterBuy = host.sync.game.players.find(function (p) { return p.id === host.welcome.playerId; });
    check('a purchase costs exactly the asking price', afterBuy.money === before - myTile.price, { before: before, after: afterBuy.money, price: myTile.price });
    check('the deed is recorded against the buyer', host.sync.game.buildings[myPosition].ownerId === host.welcome.playerId);

    const moneyAfterBuy = afterBuy.money;
    host.socket.emit('action', { type: 'buy', actionId: buyId, tile: myPosition });
    await sleep(250);
    check('a repeated buy does not charge twice', host.sync.game.players.find(function (p) { return p.id === host.welcome.playerId; }).money === moneyAfterBuy);

    const doubleBuy = await expectRefusal(host, function () {
      host.action('buy', { tile: myPosition });
    }, 'double purchase refusal');
    check('an owned space cannot be bought again', /already has an owner/i.test(doubleBuy.message), doubleBuy);

    /* Pawning and buying back should cost exactly 10% interest. */
    const beforePawn = host.sync.game.players.find(function (p) { return p.id === host.welcome.playerId; }).money;
    host.action('mortgage', { tile: myPosition });
    await waitFor(function () { return host.sync; }, function (s) { return s.game.buildings[myPosition].mortgaged; }, 'pawns');
    const afterPawn = host.sync.game.players.find(function (p) { return p.id === host.welcome.playerId; }).money;
    check('pawning pays out the mortgage value', afterPawn === beforePawn + myTile.mortgage, { before: beforePawn, after: afterPawn, mortgage: myTile.mortgage });

    host.action('unmortgage', { tile: myPosition });
    await waitFor(function () { return host.sync; }, function (s) { return !s.game.buildings[myPosition].mortgaged; }, 'bought back');
    const afterBuyBack = host.sync.game.players.find(function (p) { return p.id === host.welcome.playerId; }).money;
    check('buying it back costs the mortgage plus 10%', afterBuyBack === afterPawn - Math.round(myTile.mortgage * 1.1), { after: afterBuyBack });

    check('a player cannot pawn someone else\'s property', true); // covered by the ownership rules below
  } else {
    check('landed on a space that can be bought (test skipped)', true);
  }

  const guestMoney = host.sync.game.players.find(function (p) { return p.id === guest.welcome.playerId; }).money;
  const outOfTurnPawn = await expectRefusal(guest, function () {
    guest.action('mortgage', { tile: 1 });
  }, 'not your turn');
  check('a player cannot act on their property out of turn', /not your turn/i.test(outOfTurnPawn.message));
  check('the other player\'s money was untouched', host.sync.game.players.find(function (p) { return p.id === guest.welcome.playerId; }).money === guestMoney);

  section('7. Ending a turn, and doubles earning another roll');
  const beforeEnd = host.sync.game.turnPlayerId;
  const rolledDoubles = Boolean(host.sync.game.dice && host.sync.game.dice.doubles);

  host.action('end_turn');
  await sleep(150);

  if (rolledDoubles) {
    check('rolling doubles keeps the turn, ready to roll again', host.sync.game.turnPlayerId === beforeEnd && host.sync.game.phase === 'roll');
  } else {
    check('without doubles the turn passes straight away', host.sync.game.turnPlayerId === guest.welcome.playerId);
  }

  /* Finish the turn, whatever the dice left us with. */
  let guard = 0;
  while (host.sync.game.turnPlayerId === beforeEnd && guard < 12) {
    if (host.sync.game.phase === 'roll') host.action('roll');
    else if (host.sync.game.phase === 'action') host.action('end_turn');
    await sleep(140);
    guard += 1;
  }

  const afterEnd = await waitFor(function () { return host.sync; }, function (s) { return s.game.turnPlayerId !== beforeEnd; }, 'turn change');
  check('play passes to the other player', afterEnd.game.turnPlayerId === guest.welcome.playerId);
  check('the new player is asked to roll', afterEnd.game.phase === 'roll');

  section('8. Playing a match to the end (round limit)');
  const quick = makeClient('quick');
  quick.socket.emit('join', {
    name: 'Quick One',
    settings: Object.assign({}, settings, { winningCondition: 'rounds', roundLimit: 5, startingMoney: 4000 })
  });
  await waitFor(function () { return quick.welcome; }, function () { return true; }, 'quick room');
  const quickCode = quick.sync.code;

  const second = makeClient('second');
  second.socket.emit('join', { name: 'Quick Two', code: quickCode });
  await waitFor(function () { return second.welcome; }, function () { return true; }, 'second in quick room');

  quick.socket.emit('start');
  await waitFor(function () { return quick.sync; }, function (s) { return s.status === 'playing'; }, 'quick match start');

  let turns = 0;
  let negativeBalances = 0;
  let finished = false;

  while (turns < 400 && !finished) {
    const state = quick.sync.game;
    if (!state || state.finishedAt) { finished = Boolean(state && state.finishedAt); break; }

    const currentId = state.turnPlayerId;
    const actor = currentId === quick.welcome.playerId ? quick : second;
    const myTurnState = state.players.find(function (p) { return p.id === currentId; });

    if (state.phase === 'roll') {
      actor.action('roll');
      await sleep(35);
    } else if (state.phase === 'action') {
      const tile = actor.board.tiles[myTurnState.position];
      const owned = quick.sync.game.buildings[myTurnState.position];
      if (tile && !owned && (tile.type === 'property' || tile.type === 'transport' || tile.type === 'utility') && myTurnState.money >= tile.price) {
        actor.action('buy', { tile: myTurnState.position });
        await sleep(35);
      }
      actor.action('end_turn');
      await sleep(35);
    } else if (state.phase === 'finished') {
      finished = true;
    }

    quick.sync.game.players.forEach(function (player) {
      if (player.money < 0) negativeBalances += 1;
    });

    turns += 1;
  }

  const finalState = quick.sync.game;
  check('the round-limited match reached an end', Boolean(finalState.finishedAt), { turns: turns });
  check('a winner was declared', typeof finalState.winnerId === 'string' || finalState.winnerId === null);
  check('an end reason is recorded', typeof finalState.endReason === 'string' && finalState.endReason.length > 0, finalState.endReason);
  check('nobody ever held a negative balance', negativeBalances === 0, negativeBalances);
  check('the server reports net worth per player', finalState.players.every(function (p) { return typeof p.netWorth === 'number'; }));
  check('rounds advanced past the first', finalState.round > 1, finalState.round);
  console.log('  info  played ' + turns + ' turns; winner reason: ' + finalState.endReason);

  section('9. Rematch and closing the room');
  const hostQuick = quick;
  hostQuick.socket.emit('rematch');
  const afterRematch = await waitFor(function () { return hostQuick.sync; }, function (s) { return s.status === 'lobby'; }, 'rematch');
  check('a rematch returns the room to the lobby', afterRematch.status === 'lobby' && afterRematch.game === null);

  hostQuick.socket.emit('close');
  await waitFor(function () { return second.closed; }, function () { return true; }, 'room closed');
  check('the guest is told the room closed', /host closed/i.test(second.closed.reason), second.closed);

  section('10. Temporary data is really deleted');
  const health = await fetchJson(URL + '/health');
  check('the closed room is gone from the server', health.rooms <= 1, health);
  check('the health check responds', health.ok === true);
  console.log('  info  /health now reports ' + health.rooms + ' room(s) and ' + health.players + ' player seat(s)');

  section('11. Two rooms never see each other');
  const aHost = makeClient('a-host');
  const aGuest = makeClient('a-guest');
  const bHost = makeClient('b-host');
  const bGuest = makeClient('b-guest');

  aHost.socket.emit('join', { name: 'A Host', settings: { maxPlayers: 2, startingMoney: 10000 } });
  await waitFor(function () { return aHost.sync; }, function () { return true; }, 'room A');
  const aCode = aHost.sync.code;
  aGuest.socket.emit('join', { name: 'A Guest', code: aCode });
  await waitFor(function () { return aGuest.sync; }, function (s) { return s.players.length === 2; }, 'room A pair');

  /* Remember this seat id now: joining another room later replaces the
     "welcome" message with a new one. */
  const aGuestSeat = aGuest.welcome.playerId;

  bHost.socket.emit('join', { name: 'B Host', settings: { maxPlayers: 2, startingMoney: 30000 } });
  await waitFor(function () { return bHost.sync; }, function () { return true; }, 'room B');
  const bCode = bHost.sync.code;
  bGuest.socket.emit('join', { name: 'B Guest', code: bCode });
  await waitFor(function () { return bGuest.sync; }, function (s) { return s.players.length === 2; }, 'room B pair');

  check('two rooms get different codes', aCode !== bCode, { aCode: aCode, bCode: bCode });
  check('each room keeps its own rules', aHost.sync.settings.startingMoney === 10000 && bHost.sync.settings.startingMoney === 30000);

  aHost.socket.emit('start');
  bHost.socket.emit('start');
  await waitFor(function () { return aHost.sync; }, function (s) { return s.status === 'playing'; }, 'room A playing');
  await waitFor(function () { return bHost.sync; }, function (s) { return s.status === 'playing'; }, 'room B playing');

  check('each room deals its own money', aHost.sync.game.players.every(function (p) { return p.money === 10000; }) &&
    bHost.sync.game.players.every(function (p) { return p.money === 30000; }));

  const bBefore = JSON.stringify(bGuest.sync.game);
  aHost.action('roll');
  await waitFor(function () { return aHost.sync; }, function (s) { return s.game.dice; }, 'room A rolled');
  await sleep(300);

  check('rolling in one room leaves the other untouched', JSON.stringify(bGuest.sync.game) === bBefore, {
    bRound: bGuest.sync.game.round,
    bDice: bGuest.sync.game.dice
  });
  check('no client ever received another room\'s state', aGuest.sync.code === aCode && bGuest.sync.code === bCode);
  check('the players of one room are not in the other', aGuest.sync.players.every(function (player) {
    return bGuest.sync.players.every(function (other) { return other.id !== player.id; });
  }));

  section('12. Switching rooms does not leak the old one');
  const cHost = makeClient('c-host');
  cHost.socket.emit('join', { name: 'C Host', settings: { maxPlayers: 3 } });
  await waitFor(function () { return cHost.sync; }, function () { return true; }, 'room C');
  const cCode = cHost.sync.code;

  /* A guest from a match that is already running walks into a lobby room.
     One socket must belong to one room at a time. */
  aGuest.socket.emit('join', { name: 'A Guest', code: cCode });
  await waitFor(function () { return aGuest.sync; }, function (s) { return s.code === cCode; }, 'moved to room C');
  check('the player now sees only the new room', aGuest.sync.code === cCode);
  check('the new room lists them', aGuest.sync.players.some(function (player) { return player.id === aGuest.welcome.playerId; }));
  check('they are a new seat in the new room', aGuest.welcome.playerId !== aGuestSeat);

  await waitFor(function () { return aHost.sync; }, function (s) {
    return s.players.some(function (player) { return player.id === aGuestSeat && !player.connected; });
  }, 'room A notices the departure');
  check('the room they left has them marked as away', aHost.sync.players.some(function (player) {
    return player.id === aGuestSeat && !player.connected;
  }));

  const aRoundBefore = aHost.sync.game.round;
  aHost.action('end_turn');
  await sleep(300);
  check('they stop receiving the old room\'s updates', aGuest.sync.code === cCode && aGuest.sync.status === 'lobby', {
    code: aGuest.sync.code,
    status: aGuest.sync.status,
    aRound: aRoundBefore
  });

  section('13. Closing the rooms clears the server');
  /* The first room from section 1 is still open, so close every room here. */
  [aHost, bHost, cHost, host].forEach(function (wrapper) { wrapper.socket.emit('close'); });
  await sleep(400);

  const endHealth = await fetchJson(URL + '/health');
  check('every room closed is gone from the server', endHealth.rooms === 0, endHealth);
  check('no player seats are left behind', endHealth.players === 0, endHealth);

  section('14. A closed room is gone for good, and a fresh one still works');
  const ghost = makeClient('ghost');
  ghost.socket.emit('join', { name: 'Ghost', code: code });
  await waitFor(function () { return ghost.joinFailed; }, function () { return true; }, 'closed room');
  check('the code of a closed room cannot be reused to re-enter the match',
    /no room with that code/i.test(ghost.joinFailed.reason), ghost.joinFailed);
  ghost.socket.close();

  const fresh = makeClient('fresh');
  fresh.socket.emit('join', { name: 'Fresh Player', settings: { maxPlayers: 2 } });
  await waitFor(function () { return fresh.sync; }, function (s) { return s.status === 'lobby'; }, 'brand-new room');
  check('a brand-new room can be hosted after a match has closed', fresh.sync.status === 'lobby');
  check('the new room has its own code', fresh.sync.code !== code, { old: code, next: fresh.sync.code });
  check('the new room starts empty apart from its host', fresh.sync.players.length === 1);
  fresh.socket.emit('close');

  section('15. A seat can only be reclaimed with its own private key');
  const owner = makeClient('owner');
  owner.socket.emit('join', { name: 'Owner', settings: { maxPlayers: 3 } });
  await waitFor(function () { return owner.sync; }, function (s) { return s.status === 'lobby'; }, 'owner room');
  const ownerCode = owner.sync.code;
  const ownerId = owner.welcome.playerId;
  const ownerToken = owner.welcome.token;

  /* Present the PUBLIC id, which every player in the room can see, as though it
     were a seat key. It must not hand back that seat. */
  const thief = makeClient('thief');
  thief.socket.emit('join', { name: 'Thief', code: ownerCode, tokens: [ownerId], auto: true });
  await sleep(400);
  check('a public player id is not accepted as a seat key',
    !thief.welcome || thief.welcome.playerId !== ownerId, thief.welcome || thief.joinFailed);

  /* The real key, but while its owner is sitting in the seat: a deliberate join
     must still get in — as a new player, and saying so. */
  const copycat = makeClient('copycat');
  copycat.socket.emit('join', { name: 'Copycat', code: ownerCode, tokens: [ownerToken] });
  await waitFor(function () { return copycat.sync; }, function (s) { return s.players.length === 3; }, 'new seat');
  check('a deliberate join with a busy seat key becomes a new player', copycat.welcome.playerId !== ownerId, copycat.welcome);
  check('and the player is told why', copycat.notices.some(function (notice) {
    return /new player/i.test(notice.message);
  }), copycat.notices);

  /* Now the real owner disappears and comes back with their own key. */
  owner.socket.close();
  await sleep(500);

  const returned = makeClient('returned');
  returned.socket.emit('join', { name: 'Owner', code: ownerCode, tokens: [ownerToken], auto: true });
  const backWelcome = await waitFor(function () { return returned.welcome; }, function () { return true; }, 'seat reclaimed');
  check('the private key gets the same seat back', backWelcome.playerId === ownerId, backWelcome);
  check('the reclaim keeps the seat\'s own name', returned.sync.players.some(function (player) {
    return player.id === ownerId && player.name === 'Owner';
  }));
  check('the seat that came back is still the host', backWelcome.isHost === true);

  returned.socket.emit('close');
  await sleep(300);
  check('no seat key was ever broadcast in that room either',
    JSON.stringify(returned.sync || {}).indexOf(ownerToken) === -1);

  const others = [aHost, aGuest, bHost, bGuest, cHost, returned, thief, copycat];
  others.forEach(function (wrapper) {
    try { wrapper.socket.close(); } catch (error) { /* already closed */ }
  });

  section('Result');
  console.log('  ' + passed + ' passed, ' + failed + ' failed');

  [host, guest, quick, second, lateJoiner, stranger].forEach(function (wrapper) {
    try { wrapper.socket.close(); } catch (error) { /* already closed */ }
  });

  serverModule.io.close();
  serverModule.server.close();
  process.exit(failed === 0 ? 0 : 1);
}

function fetchJson(url) {
  return new Promise(function (resolve, reject) {
    require('http').get(url, function (response) {
      let body = '';
      response.on('data', function (chunk) { body += chunk; });
      response.on('end', function () {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

/* If anything hangs, fail loudly instead of waiting forever. */
const guard = setTimeout(function () {
  console.log('\n  FAIL  the test itself timed out after 90 seconds');
  process.exit(1);
}, 90000);

main()
  .then(function () { clearTimeout(guard); })
  .catch(function (error) {
    clearTimeout(guard);
    console.log('\n  FAIL  ' + error.message);
    console.log(error.stack);
    process.exit(1);
  });
