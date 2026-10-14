/* ==========================================================================
   navigation.js — moving between screens.

   Views are the big screens (menu, host, join, lobby, game, results).
   Modals are the pop-ups (rules, settings, properties, trading, cards).
   ========================================================================== */

window.EE = window.EE || {};

EE.nav = (function () {
  'use strict';

  var VIEWS = ['menu', 'host', 'join', 'lobby', 'game', 'results'];
  var currentView = 'menu';
  var lastFocus = null;

  /* ------------------------------------------------------------------ */
  /* Views                                                               */
  /* ------------------------------------------------------------------ */

  function showView(name, options) {
    if (VIEWS.indexOf(name) === -1) name = 'menu';
    currentView = name;

    document.querySelectorAll('[data-view]').forEach(function (section) {
      section.hidden = section.getAttribute('data-view') !== name;
    });

    /* Only the menu-side screens change the address bar. The lobby, game and
       results screens are driven by what the server says we are doing. */
    var options2 = options || {};
    if (options2.updateHash !== false && ['menu', 'host', 'join'].indexOf(name) !== -1) {
      if (window.location.hash !== '#' + name) {
        history.replaceState(null, '', '#' + name);
      }
    }

    window.scrollTo(0, 0);
  }

  function current() {
    return currentView;
  }

  function go(name) {
    if (name === 'menu') {
      /* Leaving for the menu should not leave a half-joined room behind. */
      showView('menu');
      history.replaceState(null, '', '#menu');
      return;
    }
    showView(name);
  }

  /* ------------------------------------------------------------------ */
  /* Modals                                                              */
  /* ------------------------------------------------------------------ */

  function openModal(id) {
    var modal = document.getElementById(id);
    if (!modal) return;

    lastFocus = document.activeElement;
    modal.hidden = false;

    var focusable = modal.querySelector('button, input, select, [tabindex]');
    if (focusable) focusable.focus();

    document.body.style.overflow = 'hidden';
  }

  function closeModal(id) {
    var modal = document.getElementById(id);
    if (!modal) return;

    modal.hidden = true;
    document.body.style.overflow = '';

    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }

  function closeAllModals() {
    document.querySelectorAll('.modal').forEach(function (modal) {
      modal.hidden = true;
    });
    document.body.style.overflow = '';
  }

  function isModalOpen(id) {
    var modal = document.getElementById(id);
    return Boolean(modal && !modal.hidden);
  }

  function bindModals() {
    document.querySelectorAll('[data-close]').forEach(function (button) {
      button.addEventListener('click', function () {
        closeModal(button.getAttribute('data-close'));
      });
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      var open = document.querySelector('.modal:not([hidden])');
      if (open) closeModal(open.id);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Preferences: theme, motion, sound                                   */
   /* ------------------------------------------------------------------ */

  function applyPrefs() {
    var prefs = EE.state.getPrefs();
    document.documentElement.setAttribute('data-theme', prefs.theme);
    document.documentElement.setAttribute('data-motion', prefs.motion);

    var soundButton = document.getElementById('btn-sound');
    if (soundButton) {
      soundButton.setAttribute('aria-pressed', prefs.sound ? 'true' : 'false');
      var wave = document.getElementById('sound-wave');
      if (wave) wave.style.opacity = prefs.sound ? '1' : '0.25';
    }
  }

  var THEMES = ['felt', 'midnight', 'parchment'];

  function bindPrefs() {
    var soundButton = document.getElementById('btn-sound');
    if (soundButton) {
      soundButton.addEventListener('click', function () {
        var prefs = EE.state.getPrefs();
        EE.state.savePrefs({ sound: !prefs.sound });
        applyPrefs();
        EE.notify.toast(prefs.sound ? 'Sound off' : 'Sound on', 'info', 1400);
        if (!prefs.sound) EE.notify.sound('turn');
      });
    }

    var themeButton = document.getElementById('btn-theme');
    if (themeButton) {
      themeButton.addEventListener('click', function () {
        var prefs = EE.state.getPrefs();
        var next = THEMES[(THEMES.indexOf(prefs.theme) + 1) % THEMES.length];
        EE.state.savePrefs({ theme: next });
        applyPrefs();
        EE.notify.toast('Theme: ' + next, 'info', 1400);
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* How to Play                                                         */
  /* ------------------------------------------------------------------ */

  var RULES = [
    {
      title: 'The goal',
      open: true,
      bullets: [
        'Be the last player still solvent. Everyone else runs out of money and is out.',
        'The host can also choose "first to a net worth target" or "highest net worth after a set number of rounds".'
      ]
    },
    {
      title: 'A turn, step by step',
      bullets: [
        'Roll two dice and move that many spaces forward, clockwise around the island.',
        'Resolve the space you land on: buy it, pay rent, pay a fee, or draw a card.',
        'Then manage your holdings — build, pawn, trade — and press End turn.',
        'Roll a double and you roll again. Three doubles in a row and you are escorted to the Harbour Hold.'
      ]
    },
    {
      title: 'Money and rent',
      bullets: [
        'All money is virtual. The server keeps every balance, so nobody can edit their own numbers.',
        'Rent is paid to the owner automatically when you land on their space.',
        'Passing the Grand Terminal pays your salary automatically.',
        'Own every property in a neighbourhood and the base rent doubles.',
        'Studios multiply the rent. Four studios and the next purchase becomes a Tower, which charges the most.'
      ]
    },
    {
      title: 'Transport lines and utilities',
      bullets: [
        'The four transport lines pay more rent the more of them one player owns.',
        'Utilities charge 4 times the dice total, or 10 times if one player owns both.'
      ]
    },
    {
      title: 'The Harbour Hold',
      bullets: [
        'Roll a double to get out, pay the fine, or use a pass from a card.',
        'If you fail three times, the fine is paid for you and you move on.'
      ]
    },
    {
      title: 'Trading and pawning',
      bullets: [
        'On your turn, offer another player properties and money in any combination. They accept or decline, and both sides see the same terms.',
        'A trade is re-checked the moment it is accepted, so nothing can change hands twice.',
        'Pawning a property pays you its mortgage value, but it earns no rent until you buy it back — for 10% more.'
      ]
    },
    {
      title: 'Going broke',
      bullets: [
        'If you cannot pay a debt, the bank sells your studios and pawns your properties for you, cheapest first.',
        'If that still is not enough, you are out of the match and your deeds pass to whoever you owed.',
        'Every one of those steps is written into the feed so you can see exactly what happened.'
      ]
    },
    {
      title: 'Controls on phone, tablet and laptop',
      bullets: [
        'Tap any space to see its name, price and rent.',
        'Your buttons — Roll, Buy, Pay the fine, Trade, Properties, End turn — sit along the bottom of the screen.',
        'On a small phone, "List view" swaps the board for a readable list of every space.'
      ]
    },
    {
      title: 'Connections, and the honest limits',
      bullets: [
        'Refresh the page, or lose signal, and you rejoin the same seat with the same money — in the same browser tab.',
        'Rooms are temporary. When a match ends, or the host closes the room, the server deletes its copy of that game.',
        'Games live in the server\'s memory. A server restart, or a very long idle period, ends an active match. There is no saved history to recover.',
        'We can only speak for our own server. Screenshots, browser history and anything you save yourself are outside our control.'
      ]
    },
    {
      title: 'Free hosting, without the fine print',
      bullets: [
        'The website and the game server run as one free service, so there is no CORS configuration and one address to share.',
        'A free server sleeps when nobody is playing. The first visit after a quiet spell can take up to a minute to wake it.',
        'No paid API, database, domain or subscription is needed at any point.'
      ]
    }
  ];

  function renderRules() {
    var body = document.getElementById('rules-body');
    if (!body) return;

    body.textContent = '';

    RULES.forEach(function (group) {
      var details = document.createElement('details');
      if (group.open) details.open = true;

      var summary = document.createElement('summary');
      summary.textContent = group.title;
      details.appendChild(summary);

      var list = document.createElement('ul');
      group.bullets.forEach(function (line) {
        var item = document.createElement('li');
        item.textContent = line;
        list.appendChild(item);
      });
      details.appendChild(list);

      body.appendChild(details);
    });

    var note = document.createElement('p');
    note.className = 'tiny-note';
    note.textContent = 'Property Royale is an original game. The names, colours and artwork are ours; it is only inspired by classic property board games. It uses play money and never asks for payment details.';
    body.appendChild(note);
  }

  function bindRules() {
    ['btn-rules', 'menu-rules'].forEach(function (id) {
      var button = document.getElementById(id);
      if (button) button.addEventListener('click', function () { openModal('modal-rules'); });
    });
  }

  /* ------------------------------------------------------------------ */

  function init() {
    bindModals();
    bindPrefs();
    bindRules();
    renderRules();
    applyPrefs();

    document.querySelectorAll('[data-goto]').forEach(function (button) {
      button.addEventListener('click', function () {
        go(button.getAttribute('data-goto'));
      });
    });

    document.getElementById('conn-retry').addEventListener('click', function () {
      EE.notify.setConnection('busy');
      EE.net.retry();
    });

    /* The brand in the header is a plain link to #menu, and the phone's back
       button changes the hash too. Both should move between the menu-side
       screens — but never drag somebody out of a live lobby or match. */
    window.addEventListener('hashchange', function () {
      var name = (window.location.hash || '').replace('#', '');
      if (['menu', 'host', 'join'].indexOf(name) === -1) return;
      if (name === currentView) return;
      if (['lobby', 'game', 'results'].indexOf(currentView) !== -1) return;
      showView(name, { updateHash: false });
    });
  }

  return {
    init: init,
    showView: showView,
    current: current,
    go: go,
    openModal: openModal,
    closeModal: closeModal,
    closeAllModals: closeAllModals,
    isModalOpen: isModalOpen,
    applyPrefs: applyPrefs,
    renderRules: renderRules
  };
})();
