/* ==========================================================================
   notifications.js — small messages, the connection light, and sound.

   Sounds are generated in the browser with the Web Audio API. That means no
   sound files to download, nothing to license, and nothing to pay for.
   ========================================================================== */

window.EE = window.EE || {};

EE.notify = (function () {
  'use strict';

  var stack = null;
  var connChip = null;
  var connBanner = null;
  var connBannerText = null;
  var audioContext = null;

  function init() {
    stack = document.getElementById('toast-stack');
    connChip = document.getElementById('conn-state');
    connBanner = document.getElementById('conn-banner');
    connBannerText = document.getElementById('conn-banner-text');
  }

  /* ------------------------------------------------------------------ */
  /* Toasts                                                              */
  /* ------------------------------------------------------------------ */

  function toast(message, kind, timeoutMs) {
    if (!stack || !message) return;

    var element = document.createElement('div');
    element.className = 'toast toast--' + (kind || 'info');
    element.textContent = message;
    stack.appendChild(element);

    window.setTimeout(function () {
      if (element.parentNode) element.parentNode.removeChild(element);
    }, timeoutMs || 3200);
  }

  /* ------------------------------------------------------------------ */
  /* Connection light                                                    */
  /* ------------------------------------------------------------------ */

  /* state is 'online', 'offline' or 'busy' (usually a free host waking up). */
  function setConnection(state, message) {
    if (connChip) {
      connChip.className = 'conn conn--' + state;
      connChip.textContent = state === 'online' ? 'connected' : state === 'busy' ? 'waking up' : 'offline';
    }

    if (!connBanner) return;

    if (state === 'online') {
      connBanner.hidden = true;
      return;
    }

    connBanner.hidden = false;
    if (connBannerText) {
      connBannerText.textContent = message || (state === 'busy'
        ? 'Waking the game server. A free server goes to sleep when idle, and can take up to a minute to start.'
        : 'Lost the connection to the game server. Trying again…');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Sound                                                               */
  /* ------------------------------------------------------------------ */

  function audio() {
    if (!audioContext) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      audioContext = new Ctor();
    }
    return audioContext;
  }

  /* A short little blip. Each game event gets its own note. */
  function beep(frequency, duration, type, volume) {
    var context = audio();
    if (!context) return;

    var oscillator = context.createOscillator();
    var gain = context.createGain();

    oscillator.type = type || 'triangle';
    oscillator.frequency.value = frequency;

    var level = volume === undefined ? 0.06 : volume;
    gain.gain.setValueAtTime(level, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }

  var SOUNDS = {
    dice: function () { beep(320, 0.09, 'square', 0.05); window.setTimeout(function () { beep(240, 0.09, 'square', 0.05); }, 90); },
    buy: function () { beep(520, 0.12); window.setTimeout(function () { beep(780, 0.16); }, 100); },
    rent: function () { beep(300, 0.18, 'sawtooth', 0.05); },
    money: function () { beep(660, 0.12); },
    trade: function () { beep(440, 0.1); window.setTimeout(function () { beep(660, 0.14); }, 90); },
    bad: function () { beep(180, 0.22, 'sawtooth', 0.07); },
    turn: function () { beep(600, 0.1); },
    win: function () {
      [523, 659, 784, 1046].forEach(function (note, index) {
        window.setTimeout(function () { beep(note, 0.28); }, index * 140);
      });
    }
  };

  function sound(name) {
    if (!EE.state.getPrefs().sound) return;
    var player = SOUNDS[name];
    if (!player) return;
    try {
      player();
    } catch (error) {
      /* Browsers only allow sound after a tap. Staying silent is fine. */
    }
  }

  /* ------------------------------------------------------------------ */
  /* The event card overlay                                              */
  /* ------------------------------------------------------------------ */

  var lastCardShown = null;

  function showCard(card, closeHandler) {
    if (!card) return;

    /* The same card can be listed many times; only announce a new one. */
    var key = card.playerId + ':' + card.at;
    if (key === lastCardShown) return;
    lastCardShown = key;

    var modal = document.getElementById('modal-card');
    var deck = document.getElementById('card-deck');
    var title = document.getElementById('card-title');
    var text = document.getElementById('card-text');
    if (!modal) return;

    if (deck) deck.textContent = card.deck === 'civic' ? 'Civic Fund' : 'Fortune';
    if (title) {
      var game = EE.state.getFinishedGame();
      var player = game ? game.players.find(function (item) { return item.id === card.playerId; }) : null;
      title.textContent = player ? player.name + ' draws' : 'A card is drawn';
    }
    if (text) text.textContent = card.text;

    if (closeHandler) closeHandler(modal);
    sound('money');
  }

  return {
    init: init,
    toast: toast,
    setConnection: setConnection,
    sound: sound,
    showCard: showCard
  };
})();
