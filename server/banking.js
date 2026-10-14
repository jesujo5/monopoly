'use strict';

/**
 * banking.js — the virtual bank.
 *
 * This is play money only. There is no real payment, no card form, no bank
 * connection and never will be. Every movement of money in Property Royale
 * goes through this file, which is what makes the server authoritative.
 *
 * All amounts are whole numbers, so there is no rounding drift.
 */

const properties = require('./properties');

/* A short, readable record of what happened, capped so a long game cannot grow
   the server's memory without limit. */
const MAX_LEDGER_ENTRIES = 300;

function record(game, entry) {
  game.ledger.push({
    at: Date.now(),
    round: game.round,
    from: entry.from || 'Bank',
    to: entry.to || 'Bank',
    amount: entry.amount,
    reason: entry.reason
  });

  if (game.ledger.length > MAX_LEDGER_ENTRIES) {
    game.ledger.splice(0, game.ledger.length - MAX_LEDGER_ENTRIES);
  }
}

function canAfford(player, amount) {
  return player.money >= amount;
}

function give(player, amount) {
  player.money += amount;
}

/* Move money between two players. Caller has already checked affordability. */
function transferBetween(game, from, to, amount, reason) {
  from.money -= amount;
  to.money += amount;
  record(game, { from: from.name, to: to.name, amount: amount, reason: reason });
}

/* Money leaves the game and goes to the bank. */
function payBank(game, player, amount, reason) {
  player.money -= amount;
  record(game, { from: player.name, to: 'Bank', amount: amount, reason: reason });
}

/* The bank pays a player (salary, a card bonus, rent from nobody). */
function payFromBank(game, player, amount, reason) {
  player.money += amount;
  record(game, { from: 'Bank', to: player.name, amount: amount, reason: reason });
}

/* Collect a fixed amount from every other active player (used by some cards). */
function collectFromEach(game, collector, amount, reason) {
  game.players.forEach(function (other) {
    if (other.id === collector.id || other.bankrupt) return;
    const paid = Math.min(amount, other.money);
    if (paid > 0) transferBetween(game, other, collector, paid, reason);
  });
}

/* ---------------------------------------------------------------------------
   Covering a debt you cannot pay
   ---------------------------------------------------------------------------
   Rather than leaving a player stuck in a dead-end screen, the bank sells their
   holdings for them, cheapest first:

     1. Sell studio and tower upgrades back at half price.
     2. Pawn properties for their mortgage value.
     3. If that still is not enough, the player is out of the game.

   Everything is logged, so the player sees exactly what happened and why.
   --------------------------------------------------------------------------- */
function raiseCash(game, player, needed) {
  const owned = game.players.length ? tilesOwnedBy(game, player.id) : [];

  /* Stage 1: sell upgrades (half of what they cost). */
  owned.forEach(function (tile) {
    const building = game.buildings[tile.index];
    if (!building || !building.studios) return;
    while (building.studios > 0 && player.money < needed) {
      building.studios -= 1;
      const refund = Math.round(tile.studioCost / 2);
      give(player, refund);
      record(game, { from: 'Bank', to: player.name, amount: refund, reason: 'Sold a studio on ' + tile.name });
    }
  });

  /* Stage 2: pawn properties. */
  owned.forEach(function (tile) {
    const building = game.buildings[tile.index];
    if (!building || building.mortgaged) return;
    if (player.money >= needed) return;
    building.mortgaged = true;
    building.studios = 0;
    give(player, tile.mortgage);
    record(game, { from: 'Bank', to: player.name, amount: tile.mortgage, reason: 'Pawned ' + tile.name });
  });

  return player.money >= needed;
}

/* Every property a player owns, as tile objects. */
function tilesOwnedBy(game, playerId) {
  const owned = [];
  Object.keys(game.buildings).forEach(function (key) {
    const building = game.buildings[key];
    if (building.ownerId === playerId) {
      owned.push(properties.tileAt(Number(key)));
    }
  });
  return owned.filter(Boolean).sort(function (a, b) {
    return a.price - b.price; // cheapest first
  });
}

module.exports = {
  canAfford: canAfford,
  give: give,
  transferBetween: transferBetween,
  payBank: payBank,
  payFromBank: payFromBank,
  collectFromEach: collectFromEach,
  raiseCash: raiseCash,
  tilesOwnedBy: tilesOwnedBy,
  record: record
};
