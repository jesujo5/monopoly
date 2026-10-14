'use strict';

/**
 * events.js — the two card decks.
 *
 * Cards are DATA, not code. Each card says what happens in a small, boring
 * object, and game-engine.js is the only place that acts on it. That keeps the
 * interesting part (the wording) separate from the risky part (moving money).
 *
 * Effect kinds the engine understands:
 *   { kind: 'money',        amount }            receive from the bank
 *   { kind: 'pay',          amount }            pay the bank
 *   { kind: 'collectEach',  amount }            every other player pays you
 *   { kind: 'payEach',      amount }            you pay every other player
 *   { kind: 'move',         spaces }            move forward (or back if negative)
 *   { kind: 'moveTo',       index }             jump to a space, no salary
 *   { kind: 'advanceTo',    type }              move to the next space of a type
 *   { kind: 'perStudio',    amount }            pay per studio you own
 *   { kind: 'hold' }                            go to the Harbour Hold
 *   { kind: 'holdPass' }                        keep a pass that gets you out free
 */

/* All place names below exist on our own board, so every card is checkable. */

const FORTUNE = [
  { text: 'A film crew books your street for a week. Collect 500.', effect: { kind: 'money', amount: 500 } },
  { text: 'Your ferry pass expires. Move to the Ferry Terminal.', effect: { kind: 'advanceTo', type: 'transport' } },
  { text: 'Survey work finds a fault in your foundations. Pay 250 for every studio you own.', effect: { kind: 'perStudio', amount: 250 } },
  { text: 'You win the Lantern Row window competition. Collect 300.', effect: { kind: 'money', amount: 300 } },
  { text: 'A delivery van clips your gate. Pay 400.', effect: { kind: 'pay', amount: 400 } },
  { text: 'The night market succeeds and every resident chips in. Collect 100 from each player.', effect: { kind: 'collectEach', amount: 100 } },
  { text: 'A warrant is issued over unpaid mooring fees. Go to the Harbour Hold.', effect: { kind: 'hold' } },
  { text: 'Your ticket is torn up by a friendly inspector. Keep this pass to leave the Harbour Hold free.', effect: { kind: 'holdPass' } },
  { text: 'Maintenance on the Solar Grid runs long. Move back 3 spaces.', effect: { kind: 'move', spaces: -3 } },
  { text: 'Investors tour the island and pay for the view. Advance to Royale Plaza.', effect: { kind: 'moveTo', index: 39 } },
  { text: 'A leak in the Deep Well costs you 150 per studio.', effect: { kind: 'perStudio', amount: 150 } },
  { text: 'You sell a sketch of the skyline to a gallery. Collect 900.', effect: { kind: 'money', amount: 900 } },
  { text: 'Roadworks block the Cable Car Loop. Move to the nearest transport line.', effect: { kind: 'advanceTo', type: 'transport' } },
  { text: 'Storm damage across the island. Pay 500.', effect: { kind: 'pay', amount: 500 } }
];

const CIVIC = [
  { text: 'The town fund pays out for your flood defences. Collect 750.', effect: { kind: 'money', amount: 750 } },
  { text: 'Free shuttle week. Move to the Grand Terminal and collect your salary.', effect: { kind: 'moveTo', index: 0 } },
  { text: 'A civic award for tidying the promenade. Collect 200.', effect: { kind: 'money', amount: 200 } },
  { text: 'The island audit finds an unpaid levy. Pay 600.', effect: { kind: 'pay', amount: 600 } },
  { text: 'Neighbours help repaint every studio you own. Collect 200 per studio.', effect: { kind: 'perStudio', amount: 200 } },
  { text: 'A quiet week for everyone. Collect 150 from each player for the festival.', effect: { kind: 'collectEach', amount: 150 } },
  { text: 'You sponsor the island clean-up. Pay 150 to each player.', effect: { kind: 'payEach', amount: 150 } },
  { text: 'The council promotes evening power. Move to the Solar Grid.', effect: { kind: 'advanceTo', type: 'utility' } },
  { text: 'A festival donation lands on your doorstep. Collect 400.', effect: { kind: 'money', amount: 400 } },
  { text: 'A stray crate damages your sign. Pay 300.', effect: { kind: 'pay', amount: 300 } },
  { text: 'Your garden wins the Vertwood prize. Collect 1,000.', effect: { kind: 'money', amount: 1000 } },
  { text: 'Repair bills after the storm. Pay 250 for every studio you own.', effect: { kind: 'perStudio', amount: 250 } },
  { text: 'The Blue Ribbon ferry is delayed. Move back 2 spaces.', effect: { kind: 'move', spaces: -2 } },
  { text: 'A legal mix-up clears your name. Keep this pass to leave the Harbour Hold free.', effect: { kind: 'holdPass' } }
];

/* A shuffled copy of a deck, so the server never reorders the original. */
function shuffled(cards) {
  const copy = cards.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = copy[i];
    copy[i] = copy[j];
    copy[j] = swap;
  }
  return copy;
}

/* Draw the next card, reshuffling the discard pile when the deck runs out. */
function draw(game, deckName) {
  const deck = game.decks[deckName];
  if (!deck || deck.length === 0) {
    game.decks[deckName] = shuffled(deckName === 'fortune' ? FORTUNE : CIVIC);
  }
  return game.decks[deckName].shift();
}

function freshDecks() {
  return {
    fortune: shuffled(FORTUNE),
    civic: shuffled(CIVIC)
  };
}

module.exports = {
  FORTUNE: FORTUNE,
  CIVIC: CIVIC,
  draw: draw,
  freshDecks: freshDecks
};
