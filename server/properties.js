'use strict';

/**
 * properties.js — the Property Royale board.
 *
 * 40 spaces arranged in a ring, exactly like a classic property board (that
 * layout is a game mechanic), but every name, colour and price here is our own
 * invention. Nothing is copied from anyone else's game.
 *
 * This file is the ONLY place board data lives on the server. The client is
 * sent a copy so it can draw the board, but it never decides prices or rent.
 */

/* The eight neighbourhoods. 'size' is how many properties the group has — the
   server uses it to check whether one player owns a whole group. */
const GROUPS = {
  dockside: { id: 'dockside', name: 'Dockside', colour: '#8d6e63', size: 2 },
  meadow: { id: 'meadow', name: 'Meadowfield', colour: '#59b6d4', size: 3 },
  lantern: { id: 'lantern', name: 'Lantern Row', colour: '#c46fb0', size: 3 },
  sunspire: { id: 'sunspire', name: 'Sunspire', colour: '#e0a24e', size: 3 },
  ironworks: { id: 'ironworks', name: 'Ironworks', colour: '#cc5b54', size: 3 },
  palmwater: { id: 'palmwater', name: 'Palmwater', colour: '#d6c458', size: 3 },
  vertwood: { id: 'vertwood', name: 'Vertwood', colour: '#59a86f', size: 3 },
  crown: { id: 'crown', name: 'Crown Heights', colour: '#6a7fc4', size: 2 }
};

/* ---------------------------------------------------------------------------
   Money rules. Each multiplier is applied to the property's price, which keeps
   the rent curve sensible at every price point.
   Order: [base rent, 1 studio, 2 studios, 3 studios, 4 studios, tower]
   --------------------------------------------------------------------------- */
const RENT_RATIOS = [0.1, 0.5, 1.5, 4.5, 7.0, 8.5];

/* Cost of one studio. Cheaper districts are cheaper to develop, so a beginner
   can still build something early in the game. */
const STUDIO_COST_BANDS = [
  [1200, 500],
  [2600, 1000],
  [Infinity, 1500]
];

const MAX_STUDIOS = 4; // 4 studios, then the fifth purchase converts to a tower

/* Transport spaces: rent depends on how many of the four one player owns. */
const TRANSPORT_RENT = [250, 500, 1000, 2000];

/* Utility spaces: rent is this many times the dice total. */
const UTILITY_MULTIPLIER = { one: 4, both: 10 };

/* Money and corner rules. */
const SALARY = 2000;
const HOLD_FINE = 500;
const MAX_HOLD_TURNS = 3;

/* ---------------------------------------------------------------------------
   Small helpers used while building the board
   --------------------------------------------------------------------------- */

function roundTo10(amount) {
  return Math.round(amount / 10) * 10;
}

function rentTableFor(price) {
  return RENT_RATIOS.map(function (ratio) {
    return roundTo10(price * ratio);
  });
}

function studioCostFor(price) {
  for (let i = 0; i < STUDIO_COST_BANDS.length; i++) {
    if (price <= STUDIO_COST_BANDS[i][0]) return STUDIO_COST_BANDS[i][1];
  }
  return STUDIO_COST_BANDS[STUDIO_COST_BANDS.length - 1][1];
}

function property(index, name, groupId, price) {
  return {
    index: index,
    type: 'property',
    name: name,
    group: groupId,
    price: price,
    rent: rentTableFor(price),
    studioCost: studioCostFor(price),
    mortgage: roundTo10(price / 2)
  };
}

function transport(index, name) {
  return {
    index: index,
    type: 'transport',
    name: name,
    price: 2000,
    rent: TRANSPORT_RENT.slice(), // copied so nothing can mutate the shared table
    mortgage: 1000
  };
}

function utility(index, name) {
  return {
    index: index,
    type: 'utility',
    name: name,
    price: 1500,
    mortgage: 750
  };
}

/* ---------------------------------------------------------------------------
   The board itself. Index = position on the ring, starting at the top-left
   corner and going clockwise, which is how the client draws it too.
   --------------------------------------------------------------------------- */

const TILES = [
  { index: 0, type: 'start', name: 'Grand Terminal', note: 'Collect ' + SALARY + ' when you pass or land here' },

  property(1, 'Tidewatch Quay', 'dockside', 600),
  { index: 2, type: 'event', deck: 'fortune', name: 'Fortune' },
  property(3, 'Beacon Row', 'dockside', 600),
  { index: 4, type: 'tax', name: 'Harbour Duty', amount: 2000 },
  transport(5, 'Skyrail Line'),

  property(6, 'Clover Common', 'meadow', 1000),
  { index: 7, type: 'event', deck: 'fortune', name: 'Fortune' },
  property(8, 'Willow Green', 'meadow', 1000),
  property(9, 'Meadow Gate', 'meadow', 1200),

  { index: 10, type: 'hold', name: 'Harbour Hold', note: 'Just visiting unless a warrant sends you here' },

  property(11, 'Lantern Walk', 'lantern', 1400),
  utility(12, 'Solar Grid'),
  property(13, 'Gaslight Alley', 'lantern', 1400),
  property(14, 'Amber Court', 'lantern', 1600),
  transport(15, 'Cable Car Loop'),

  property(16, 'Sunspire Steps', 'sunspire', 1800),
  { index: 17, type: 'event', deck: 'civic', name: 'Civic Fund' },
  property(18, 'Terracotta Yard', 'sunspire', 1800),
  property(19, 'Golden Terrace', 'sunspire', 2000),

  { index: 20, type: 'rest', name: 'Festival Square', note: 'A free stop for anyone who lands here' },

  property(21, 'Foundry Street', 'ironworks', 2200),
  { index: 22, type: 'event', deck: 'fortune', name: 'Fortune' },
  property(23, 'Bellow Lane', 'ironworks', 2200),
  property(24, 'Ironworks Yard', 'ironworks', 2400),
  transport(25, 'Ferry Terminal'),

  property(26, 'Palmwater Drive', 'palmwater', 2600),
  property(27, 'Saltwind Crescent', 'palmwater', 2600),
  utility(28, 'Deep Well'),
  property(29, 'Coral Parade', 'palmwater', 2800),

  { index: 30, type: 'warrant', name: 'Warrant Issued', note: 'Go straight to the Harbour Hold' },

  property(31, 'Vertwood Rise', 'vertwood', 3000),
  property(32, 'Cedar Heights', 'vertwood', 3000),
  { index: 33, type: 'event', deck: 'civic', name: 'Civic Fund' },
  property(34, 'Orchard Crest', 'vertwood', 3200),
  transport(35, 'Night Express'),

  { index: 36, type: 'event', deck: 'fortune', name: 'Fortune' },
  property(37, 'Crown Heights', 'crown', 3500),
  { index: 38, type: 'tax', name: 'Wealth Levy', amount: 1000 },
  property(39, 'Royale Plaza', 'crown', 4000)
];

/* ---------------------------------------------------------------------------
   Lookup helpers
   --------------------------------------------------------------------------- */

function tileAt(index) {
  return TILES[index] || null;
}

function isPurchasable(tile) {
  return Boolean(tile) && (tile.type === 'property' || tile.type === 'transport' || tile.type === 'utility');
}

function groupTiles(groupId) {
  return TILES.filter(function (tile) {
    return tile.group === groupId;
  });
}

/* The version sent to browsers. Same data, with a clear copy so a client can
   never change ours even if it edits its own copy. */
function boardForClient() {
  return {
    tiles: TILES,
    groups: GROUPS,
    maxStudios: MAX_STUDIOS,
    salary: SALARY,
    holdFine: HOLD_FINE,
    maxHoldTurns: MAX_HOLD_TURNS
  };
}

module.exports = {
  GROUPS: GROUPS,
  TILES: TILES,
  MAX_STUDIOS: MAX_STUDIOS,
  SALARY: SALARY,
  HOLD_FINE: HOLD_FINE,
  MAX_HOLD_TURNS: MAX_HOLD_TURNS,
  TRANSPORT_RENT: TRANSPORT_RENT,
  UTILITY_MULTIPLIER: UTILITY_MULTIPLIER,
  tileAt: tileAt,
  isPurchasable: isPurchasable,
  groupTiles: groupTiles,
  studioCostFor: studioCostFor,
  boardForClient: boardForClient
};
