/* ==========================================================================
   banking-ui.js — your wallet and the money trail.

   This is display only. Every balance comes from the server, and this panel
   never tries to change one. It is play money: there is no real payment
   anything in this game, by design.
   ========================================================================== */

window.EE = window.EE || {};

EE.bankingUI = (function () {
  'use strict';

  var els = {};

  function render() {
    var state = EE.state;
    var game = state.getGame();
    var card = els.card;
    var body = els.walletBody;

    if (!game) {
      if (card) card.hidden = true;
      return;
    }

    if (card) card.hidden = false;
    body.textContent = '';

    var mine = state.myGamePlayer();
    if (!mine) {
      var note = document.createElement('p');
      note.className = 'feed-empty';
      note.textContent = 'You are watching this match from the lobby.';
      body.appendChild(note);
      return;
    }

    addRow(body, 'Cash', state.money(mine.money), mine.money < 0 ? 'bad' : '');
    addRow(body, 'Net worth', state.money(mine.netWorth), '');
    addRow(body, state.tilesOwnedBy(mine.id).length === 1 ? 'Property' : 'Properties', String(state.tilesOwnedBy(mine.id).length), '');

    if (mine.holdPasses > 0) {
      addRow(body, 'Harbour Hold passes', String(mine.holdPasses), 'good');
    }

    if (mine.bankrupt) {
      addRow(body, 'Status', 'Out of the match', 'bad');
    }

    /* What this player has paid and received, newest first. */
    var mineName = mine.name;
    var entries = game.ledger.filter(function (entry) {
      return entry.from === mineName || entry.to === mineName;
    }).slice(-12).reverse();

    var heading = document.createElement('h4');
    heading.className = 'subhead';
    heading.textContent = 'Money trail';
    body.appendChild(heading);

    if (entries.length === 0) {
      var empty = document.createElement('p');
      empty.className = 'feed-empty';
      empty.textContent = 'Nothing has moved yet.';
      body.appendChild(empty);
      return;
    }

    var list = document.createElement('div');
    list.className = 'ledger';

    entries.forEach(function (entry) {
      var row = document.createElement('div');
      row.className = 'ledger-row';

      var label = document.createElement('span');
      label.textContent = entry.reason;

      var amount = document.createElement('span');
      amount.className = 'ledger-amount';
      var incoming = entry.to === mineName;
      amount.textContent = (incoming ? '+' : '−') + state.money(entry.amount).replace(EE.CONFIG.CURRENCY, '');
      amount.style.color = incoming ? 'var(--ok)' : 'var(--danger)';

      row.appendChild(label);
      row.appendChild(amount);
      list.appendChild(row);
    });

    body.appendChild(list);
  }

  function addRow(body, label, value, tone) {
    var row = document.createElement('div');
    row.className = 'ledger-row';

    var name = document.createElement('span');
    name.textContent = label;

    var amount = document.createElement('span');
    amount.className = 'ledger-amount';
    amount.textContent = value;
    if (tone === 'good') amount.style.color = 'var(--ok)';
    if (tone === 'bad') amount.style.color = 'var(--danger)';

    row.appendChild(name);
    row.appendChild(amount);
    body.appendChild(row);
  }

  function init() {
    els = {
      card: document.getElementById('banking-card'),
      walletBody: document.getElementById('wallet-body')
    };
  }

  return { init: init, render: render };
})();
