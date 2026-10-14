'use strict';

/**
 * game-rules.js — the rulebook, as plain functions.
 *
 * Everything here ANSWERS A QUESTION ("what is the rent?", "may this player
 * build here?") and changes nothing. The engine in game-engine.js asks these
 * questions and then applies the answer.
 *
 * Keeping rules separate from actions is what makes the game easy to test and
 * easy to explain. Both files run only on the server.
 */

const properties = require('./properties');

/* ---------------------------------------------------------------------------
   Looking things up
   --------------------------------------------------------------------------- */

function playerById(game, playerId) {
  return game.players.find(function (player) {
    return player.id === playerId;
  }) || null;
}

/* Players still in the game. */
function activePlayers(game) {
  return game.players.filter(function (player) {
    return !player.bankrupt;
  });
}

function buildingOf(game, index) {
  return game.buildings[index] || null;
}

function ownerIdOf(game, index) {
  const building = game.buildings[index];
  return building ? building.ownerId : null;
}

/* Does this player own every property in the neighbourhood? */
function ownsWholeGroup(game, groupId, playerId) {
  const tiles = properties.groupTiles(groupId);
  return tiles.length > 0 && tiles.every(function (tile) {
    return ownerIdOf(game, tile.index) === playerId;
  });
}

/* How many of one special type does a player own? (transports and utilities) */
function countOwnedOfType(game, playerId, type) {
  return properties.TILES.filter(function (tile) {
    return tile.type === type && ownerIdOf(game, tile.index) === playerId;
  }).length;
}

/* ---------------------------------------------------------------------------
   Rent
   ---------------------------------------------------------------------------
   Returns { amount, reason }. A pawned property earns nothing, and owning a
   whole neighbourhood doubles the base rent while it is unimproved — that is
   the reward for collecting a set.
   --------------------------------------------------------------------------- */
function rentFor(game, tile, ownerId, diceTotal) {
  const building = buildingOf(game, tile.index);
  if (!building || building.mortgaged) {
    return { amount: 0, reason: tile.name + ' is pawned, so no rent is due' };
  }

  if (tile.type === 'property') {
    const studios = building.studios || 0;
    if (studios > 0) {
      return {
        amount: tile.rent[studios],
        reason: studios + (studios === 1 ? ' studio on ' : ' studios on ') + tile.name
      };
    }
    const fullSet = ownsWholeGroup(game, tile.group, ownerId);
    return {
      amount: fullSet ? tile.rent[0] * 2 : tile.rent[0],
      reason: fullSet
        ? 'Owning all of ' + properties.GROUPS[tile.group].name + ' doubles the rent'
        : 'Base rent on ' + tile.name
    };
  }

  if (tile.type === 'transport') {
    const count = countOwnedOfType(game, ownerId, 'transport');
    const amount = tile.rent[Math.max(0, count - 1)];
    return {
      amount: amount,
      reason: count + ' of 4 transport lines owned'
    };
  }

  if (tile.type === 'utility') {
    const count = countOwnedOfType(game, ownerId, 'utility');
    const multiplier = count === 2 ? properties.UTILITY_MULTIPLIER.both : properties.UTILITY_MULTIPLIER.one;
    return {
      amount: multiplier * diceTotal,
      reason: multiplier + ' x dice total (' + diceTotal + ')'
    };
  }

  return { amount: 0, reason: 'Nothing to pay here' };
}

/* ---------------------------------------------------------------------------
   Net worth — used for the results screen and two of the three win conditions.
   A pawned property counts at half, because that is what the bank would give.
   --------------------------------------------------------------------------- */
function netWorth(game, player) {
  let total = player.money;

  Object.keys(game.buildings).forEach(function (key) {
    const building = game.buildings[key];
    if (building.ownerId !== player.id) return;

    const tile = properties.tileAt(Number(key));
    if (!tile) return;

    const studios = building.studios || 0;
    const upgradeValue = studios * (tile.studioCost || 0);
    const baseValue = building.mortgaged ? Math.round(tile.price / 2) : tile.price;
    total += baseValue + (building.mortgaged ? 0 : upgradeValue);
  });

  return total;
}

/* ---------------------------------------------------------------------------
   Legality checks. Each returns { ok, reason } so the client can explain a
   refusal instead of silently doing nothing.
   --------------------------------------------------------------------------- */

function canBuy(game, tile, player) {
  if (!properties.isPurchasable(tile)) return { ok: false, reason: 'This space cannot be bought' };
  if (ownerIdOf(game, tile.index)) return { ok: false, reason: tile.name + ' already has an owner' };
  if (player.money < tile.price) {
    return { ok: false, reason: 'You need ' + tile.price + ' to buy ' + tile.name };
  }
  return { ok: true, reason: 'ok' };
}

function canBuild(game, tile, player) {
  if (!game.settings.upgrades) return { ok: false, reason: 'Building is switched off in this game' };
  if (tile.type !== 'property') return { ok: false, reason: 'Only neighbourhood properties can be built on' };
  if (ownerIdOf(game, tile.index) !== player.id) return { ok: false, reason: 'You do not own ' + tile.name };

  const building = buildingOf(game, tile.index);
  if (building.mortgaged) return { ok: false, reason: 'Buy back ' + tile.name + ' before building on it' };
  if (building.studios >= properties.MAX_STUDIOS + 1) {
    return { ok: false, reason: tile.name + ' already has a tower' };
  }
  if (!ownsWholeGroup(game, tile.group, player.id)) {
    return {
      ok: false,
      reason: 'Own all of ' + properties.GROUPS[tile.group].name + ' first'
    };
  }
  /* A neighbourhood has to grow evenly, as in the classic rules. */
  const uneven = properties.groupTiles(tile.group).some(function (other) {
    const otherBuilding = buildingOf(game, other.index);
    const otherStudios = otherBuilding ? otherBuilding.studios || 0 : 0;
    return otherStudios < (building.studios || 0);
  });
  if (uneven) {
    return { ok: false, reason: 'Build evenly across ' + properties.GROUPS[tile.group].name };
  }

  /* A tower is the fifth upgrade and costs two studios' worth. The client shows
     the same number, so the price on the button is the price you pay. */
  const cost = building.studios >= properties.MAX_STUDIOS
    ? tile.studioCost * 2
    : tile.studioCost;

  if (player.money < cost) return { ok: false, reason: 'You need ' + cost + ' to build here' };

  return { ok: true, reason: 'ok', cost: cost };
}

function canSellStudio(game, tile, player) {
  if (ownerIdOf(game, tile.index) !== player.id) return { ok: false, reason: 'You do not own ' + tile.name };
  const building = buildingOf(game, tile.index);
  if (!building.studios) return { ok: false, reason: 'There is nothing built on ' + tile.name };
  return { ok: true, reason: 'ok', refund: Math.round(tile.studioCost / 2) };
}

function canMortgage(game, tile, player) {
  if (!game.settings.mortgages) return { ok: false, reason: 'Pawning is switched off in this game' };
  if (ownerIdOf(game, tile.index) !== player.id) return { ok: false, reason: 'You do not own ' + tile.name };
  const building = buildingOf(game, tile.index);
  if (building.mortgaged) return { ok: false, reason: tile.name + ' is already pawned' };
  if (building.studios > 0) {
    return { ok: false, reason: 'Sell the buildings on ' + tile.name + ' first' };
  }
  return { ok: true, reason: 'ok', payout: tile.mortgage };
}

function mortgagePayoff(tile) {
  return Math.round(tile.mortgage * 1.1); // 10% interest to buy it back
}

function canUnmortgage(game, tile, player) {
  if (ownerIdOf(game, tile.index) !== player.id) return { ok: false, reason: 'You do not own ' + tile.name };
  const building = buildingOf(game, tile.index);
  if (!building.mortgaged) return { ok: false, reason: tile.name + ' is not pawned' };
  const cost = mortgagePayoff(tile);
  if (player.money < cost) return { ok: false, reason: 'You need ' + cost + ' to buy back ' + tile.name };
  return { ok: true, reason: 'ok', cost: cost };
}

/* ---------------------------------------------------------------------------
   Movement
   --------------------------------------------------------------------------- */

/* Move forward, paying salary when the Grand Terminal is passed or landed on. */
function movePlayer(game, player, steps) {
  const total = properties.TILES.length;
  const from = player.position;
  const target = ((from + steps) % total + total) % total;
  const passedStart = steps > 0 && from + steps >= total;

  player.position = target;

  if (passedStart) {
    require('./banking').payFromBank(game, player, game.settings.salary, 'Salary for passing the Grand Terminal');
  }

  return { from: from, to: target, passedStart: passedStart };
}

function sendToHold(player, game) {
  player.position = 10; // Harbour Hold
  player.inHold = true;
  player.holdTurns = 0;
  game.history.push({
    at: Date.now(),
    round: game.round,
    text: player.name + ' is held at the Harbour Hold'
  });
}

/* ---------------------------------------------------------------------------
   Ending the game
   --------------------------------------------------------------------------- */

function lastPlayerStanding(game) {
  const active = activePlayers(game);
  return active.length === 1 ? active[0] : null;
}

/* Called after every change that could end the match. Returns true if the game
   just finished. */
function checkVictory(game) {
  if (game.finishedAt) return true;

  const condition = game.settings.winningCondition;

  if (condition === 'last-standing') {
    const winner = lastPlayerStanding(game);
    if (winner) {
      finish(game, winner, 'Last player still solvent');
      return true;
    }
    return false;
  }

  if (condition === 'net-worth') {
    const reached = activePlayers(game).filter(function (player) {
      return netWorth(game, player) >= game.settings.netWorthTarget;
    });
    if (reached.length > 0) {
      const winner = reached.sort(function (a, b) {
        return netWorth(game, b) - netWorth(game, a);
      })[0];
      finish(game, winner, 'Reached a net worth of ' + game.settings.netWorthTarget);
      return true;
    }
    return false;
  }

  if (condition === 'rounds') {
    if (game.round > game.settings.roundLimit) {
      const ranked = activePlayers(game).slice().sort(function (a, b) {
        return netWorth(game, b) - netWorth(game, a);
      });
      if (ranked.length > 0) {
        finish(game, ranked[0], 'Highest net worth after ' + game.settings.roundLimit + ' rounds');
      }
      return true;
    }
    return false;
  }

  return false;
}

function finish(game, winner, reason) {
  game.winnerId = winner ? winner.id : null;
  game.endReason = reason;
  game.finishedAt = Date.now();
  game.phase = 'finished';
}

module.exports = {
  playerById: playerById,
  activePlayers: activePlayers,
  buildingOf: buildingOf,
  ownerIdOf: ownerIdOf,
  ownsWholeGroup: ownsWholeGroup,
  countOwnedOfType: countOwnedOfType,
  rentFor: rentFor,
  netWorth: netWorth,
  canBuy: canBuy,
  canBuild: canBuild,
  canSellStudio: canSellStudio,
  canMortgage: canMortgage,
  canUnmortgage: canUnmortgage,
  mortgagePayoff: mortgagePayoff,
  movePlayer: movePlayer,
  sendToHold: sendToHold,
  lastPlayerStanding: lastPlayerStanding,
  checkVictory: checkVictory,
  finish: finish
};
