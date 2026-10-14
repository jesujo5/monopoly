/* ==========================================================================
   lobby.js — the host setup screen, the join form, and the room lobby.

   This file also owns the one settings form, used both before hosting and (by
   the host) inside the lobby. The server re-validates whatever it is sent, so
   nothing here is trusted — these checks exist to give friendly messages.
   ========================================================================== */

window.EE = window.EE || {};

EE.lobby = (function () {
  'use strict';

  var CONFIG = EE.CONFIG;
  var state = EE.state;

  var els = {};
  var settingsScope = 'local'; // 'local' = this device, 'room' = the live room

  /* ------------------------------------------------------------------ */
  /* Shared helpers                                                      */
  /* ------------------------------------------------------------------ */

  function describe(key, value) {
    var money = function (amount) { return state.money(amount); };
    var onoff = function (flag) { return flag ? 'On' : 'Off'; };

    switch (key) {
      case 'startingMoney':
      case 'salary':
      case 'netWorthTarget':
        return money(value);
      case 'maxPlayers':
        return value + ' players';
      case 'winningCondition':
        return CONFIG.WIN_LABELS[value] || value;
      case 'roundLimit':
        return value + ' rounds';
      case 'turnTimerSeconds':
        return value === 0 ? 'Off' : value + ' seconds';
      default:
        return onoff(value);
    }
  }

  /* Which summary rows matter for the chosen ending. */
  function visibleRows(settings) {
    return CONFIG.SETTING_LABELS.filter(function (row) {
      if (row[0] === 'netWorthTarget') return settings.winningCondition === 'net-worth';
      if (row[0] === 'roundLimit') return settings.winningCondition === 'rounds';
      return true;
    });
  }

  function renderSummary(container, settings) {
    if (!container) return;
    container.textContent = '';

    visibleRows(settings).forEach(function (row) {
      var wrapper = document.createElement('div');
      wrapper.className = 'summary-row';

      var term = document.createElement('dt');
      term.textContent = row[1];

      var value = document.createElement('dd');
      value.textContent = describe(row[0], settings[row[0]]);

      wrapper.appendChild(term);
      wrapper.appendChild(value);
      container.appendChild(wrapper);
    });
  }

  function renderSummaries() {
    var local = state.getSettings();
    renderSummary(els.hostSummary, local);

    var roomSettings = state.getSync() ? state.getSync().settings : null;
    renderSummary(els.lobbySummary, roomSettings || local);
  }

  /* ------------------------------------------------------------------ */
  /* Names                                                               */
  /* ------------------------------------------------------------------ */

  /* Remember the name so nobody has to type it twice. */
  function bindNames() {
    var prefs = state.getPrefs();
    if (els.hostName) els.hostName.value = prefs.playerName || '';
    if (els.joinName) els.joinName.value = prefs.playerName || '';

    [els.hostName, els.joinName].forEach(function (input) {
      if (!input) return;
      input.addEventListener('change', function () {
        state.savePrefs({ playerName: input.value.trim().slice(0, CONFIG.MAX_NAME) });
      });
    });
  }

  /* Read the name from the form the player actually used. Both fields are
     prefilled with the last name you typed, so looking at the wrong one used to
     send the host's name when joining. */
  function currentName(which) {
    var preferred = which === 'join' ? els.joinName : els.hostName;
    var other = which === 'join' ? els.hostName : els.joinName;

    var typed = (preferred && preferred.value) || (other && other.value) || '';
    var name = typed.trim().slice(0, CONFIG.MAX_NAME) || state.getPrefs().playerName || 'Player';

    state.savePrefs({ playerName: name });

    /* Keep both boxes in step, so the next visit shows the same name. */
    if (els.hostName) els.hostName.value = name;
    if (els.joinName) els.joinName.value = name;

    return name;
  }

  /* ------------------------------------------------------------------ */
  /* Host and join                                                       */
  /* ------------------------------------------------------------------ */

  function bindHost() {
    els.hostCreate.addEventListener('click', function () {
      var note = els.hostNote;
      note.hidden = true;

      if (!EE.net.isOnline()) {
        note.hidden = false;
        note.textContent = 'The game server is not connected yet. If it has been idle it can take up to a minute to wake — this note will clear when it is ready.';
        return;
      }

      els.hostCreate.disabled = true;
      window.setTimeout(function () { els.hostCreate.disabled = false; }, 1500);

      EE.net.joinHost(currentName('host'), state.getSettings());
    });

    els.hostEdit.addEventListener('click', function () {
      openSettings('local');
    });
  }

  function bindJoin() {
    /* Keep the code box tidy: capitals and allowed characters only. */
    els.joinCode.addEventListener('input', function () {
      var typed = els.joinCode.value.toUpperCase();
      var kept = '';
      var removed = false;

      for (var i = 0; i < typed.length; i++) {
        var character = typed.charAt(i);
        if (CONFIG.CODE_ALPHABET.indexOf(character) !== -1) kept += character;
        else if (typed.charAt(i).trim() !== '') removed = true;
      }

      els.joinCode.value = kept.slice(0, CONFIG.CODE_LENGTH);
      if (removed) EE.notify.toast('Room codes never use I, O, 0 or 1', 'warn', 1800);
      els.joinError.hidden = true;
    });

    els.joinForm.addEventListener('submit', function (event) {
      event.preventDefault();

      var code = els.joinCode.value.trim().toUpperCase();
      els.joinError.hidden = true;
      els.joinNote.hidden = true;

      if (code.length === 0) {
        showJoinError('Type the room code your friend sent you.');
        return;
      }
      if (code.length !== CONFIG.CODE_LENGTH) {
        showJoinError('A room code is ' + CONFIG.CODE_LENGTH + ' characters long.');
        return;
      }
      if (!EE.net.isOnline()) {
        els.joinNote.hidden = false;
        els.joinNote.textContent = 'The game server is not connected yet. If it has been idle it can take up to a minute to wake, then try again.';
        return;
      }

      EE.net.joinRoom(currentName('join'), code);
    });
  }

  function showJoinError(message) {
    els.joinError.textContent = message;
    els.joinError.hidden = false;
    els.joinCode.focus();
  }

  /* ------------------------------------------------------------------ */
  /* The lobby screen                                                    */
  /* ------------------------------------------------------------------ */

  function inviteLink(code) {
    return window.location.origin + window.location.pathname + '?room=' + code;
  }

  function renderLobby() {
    var sync = state.getSync();
    if (!sync) return;

    els.lobbyCode.textContent = sync.code;
    els.lobbyLink.value = inviteLink(sync.code);
    els.lobbySeats.textContent = sync.players.length + '/' + sync.maxPlayers;

    els.lobbyPlayers.textContent = '';
    sync.players.forEach(function (player) {
      var item = document.createElement('li');
      item.className = 'player-row';

      var swatch = document.createElement('span');
      swatch.className = 'player-swatch';
      var game = sync.game;
      var seatColour = '#8fa39c';
      if (game) {
        var gamePlayer = game.players.find(function (entry) { return entry.id === player.id; });
        if (gamePlayer) seatColour = gamePlayer.colour;
      }
      swatch.style.background = seatColour;

      var name = document.createElement('span');
      name.className = 'player-name';
      name.textContent = player.name;

      item.appendChild(swatch);
      item.appendChild(name);

      if (player.isHost) {
        var hostTag = document.createElement('span');
        hostTag.className = 'chip';
        hostTag.textContent = 'host';
        item.appendChild(hostTag);
      }

      if (!player.connected) {
        var goneTag = document.createElement('span');
        goneTag.className = 'chip chip--bad';
        goneTag.textContent = 'away';
        item.appendChild(goneTag);
      }

      els.lobbyPlayers.appendChild(item);
    });

    renderSummaries();

    var host = state.isHost();
    els.lobbyEdit.hidden = !host;
    els.lobbyStart.hidden = !host;

    /* Count only players who are actually here. The server deals in connected
       players only, so counting everyone listed would enable the button on a
       room where somebody has wandered off and the start would then fail. */
    var here = sync.players.filter(function (player) { return player.connected; });
    var enough = here.length >= sync.minPlayers;
    var away = sync.players.length - here.length;

    if (host) {
      els.lobbyStart.disabled = !enough;
      els.lobbyStart.textContent = enough ? 'Start match' : 'Waiting for players (' + here.length + '/' + sync.minPlayers + ')';

      if (enough) {
        els.lobbyHint.textContent = 'Everyone is here. Start the match whenever you are ready.';
      } else {
        els.lobbyHint.textContent = 'You need at least ' + sync.minPlayers + ' players who are connected. Share the link above.';
      }

      if (away > 0) {
        els.lobbyHint.textContent += ' ' + away + ' player' + (away === 1 ? ' is' : 's are') + ' marked "away" and will not be dealt in.';
      }
    } else {
      els.lobbyHint.textContent = 'Waiting for the host to start the match…';
    }
  }

  function bindLobby() {
    els.lobbyCopy.addEventListener('click', function () {
      var link = els.lobbyLink.value;
      var done = function () { EE.notify.toast('Invitation link copied', 'good', 1600); };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(done, function () {
          els.lobbyLink.select();
          document.execCommand('copy');
          done();
        });
      } else {
        els.lobbyLink.select();
        document.execCommand('copy');
        done();
      }
    });

    els.lobbyStart.addEventListener('click', function () {
      EE.net.start();
    });

    [els.lobbyLeave, els.lobbyLeaveTop].forEach(function (button) {
      if (!button) return;
      button.addEventListener('click', function () {
        EE.net.leave();
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* The settings form                                                   */
  /* ------------------------------------------------------------------ */

  function readField(input) {
    if (input.type === 'checkbox') return input.checked;

    var type = input.getAttribute('data-type');

    if (type === 'choice' || type === 'choice-number') {
      var selected = input.value;
      if (type === 'choice-number') return parseInt(selected, 10) || 0;
      return selected;
    }

    var number = parseInt(input.value, 10);
    var min = input.min === '' ? null : parseInt(input.min, 10);
    var max = input.max === '' ? null : parseInt(input.max, 10);
    if (Number.isNaN(number)) number = state.getSettings()[input.name];

    if (min !== null && number < min) number = min;
    if (max !== null && number > max) number = max;
    return number;
  }

  function fillForm(values) {
    els.form.querySelectorAll('[name]').forEach(function (input) {
      var value = values[input.name];
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else if (value !== undefined) input.value = value;
    });
    updateConditionalFields();
  }

  /* The target and the round limit only matter for their own endings. */
  function updateConditionalFields() {
    var condition = els.form.querySelector('[name="winningCondition"]').value;
    var target = document.getElementById('field-netWorthTarget');
    var rounds = document.getElementById('field-roundLimit');
    if (target) target.hidden = condition !== 'net-worth';
    if (rounds) rounds.hidden = condition !== 'rounds';
  }

  function openSettings(scope) {
    settingsScope = scope;

    var values = scope === 'room' && state.getSync() ? state.getSync().settings : state.getSettings();
    fillForm(values);
    renderPrefs();

    els.settingsScope.textContent = scope === 'room'
      ? 'These are the live rules of this room. Changes apply straight away, and the server checks every value.'
      : 'These values are used when you host. They are saved in this browser only.';

    EE.nav.openModal('modal-settings');
  }

  function applySettingsChange(input) {
    var patch = {};
    patch[input.name] = readField(input);

    if (patch.winningCondition !== undefined) updateConditionalFields();

    /* Always remember locally, so the next room you host starts here. */
    state.saveSettings(patch);

    /* If the host is changing a live room, tell the server too. */
    if (settingsScope === 'room' && state.isHost() && state.getSync() && state.getSync().status === 'lobby') {
      EE.net.sendSettings(state.getSettings());
    } else {
      renderSummaries();
    }

    els.settingsHint.classList.add('is-flash');
    window.setTimeout(function () { els.settingsHint.classList.remove('is-flash'); }, 500);
  }

  function bindSettingsForm() {
    els.form.querySelectorAll('[name]').forEach(function (input) {
      input.addEventListener('input', function () { applySettingsChange(input); });
      input.addEventListener('change', function () { applySettingsChange(input); });
    });

    document.getElementById('settings-reset').addEventListener('click', function () {
      if (settingsScope === 'room') {
        EE.notify.toast('A live room keeps its rules — reset them before hosting instead.', 'warn');
        return;
      }
      state.resetSettings();
      fillForm(state.getSettings());
      renderSummaries();
      EE.notify.toast('Settings restored to defaults', 'info', 1600);
    });

    bindPrefs();
  }

  /* ------------------------------------------------------------------ */
  /* This device: sound and motion                                       */
  /* ------------------------------------------------------------------ */

  /* These two sit in the same dialog as the rules but are NOT rules: they are
     saved on this device and never sent to the server. Keeping them out of the
     room settings is what stops one player muting everybody else. */
  function renderPrefs() {
    var prefs = state.getPrefs();
    if (els.prefSound) els.prefSound.checked = prefs.sound !== false;
    if (els.prefMotion) els.prefMotion.checked = prefs.motion === 'reduced';
  }

  function bindPrefs() {
    if (els.prefSound) {
      els.prefSound.addEventListener('change', function () {
        state.savePrefs({ sound: els.prefSound.checked });
        EE.nav.applyPrefs();
        /* Play a tone when switching on, so it is obvious it worked. */
        if (els.prefSound.checked) EE.notify.sound('turn');
        EE.notify.toast(els.prefSound.checked ? 'Sound on' : 'Sound off', 'info', 1400);
      });
    }

    if (els.prefMotion) {
      els.prefMotion.addEventListener('change', function () {
        state.savePrefs({ motion: els.prefMotion.checked ? 'reduced' : 'full' });
        EE.nav.applyPrefs();
        EE.notify.toast(els.prefMotion.checked ? 'Animations reduced' : 'Animations on', 'info', 1400);
      });
    }
  }

  /* ------------------------------------------------------------------ */

  function init() {
    els = {
      hostName: document.getElementById('host-name'),
      hostCreate: document.getElementById('host-create'),
      hostEdit: document.getElementById('host-edit'),
      hostSummary: document.getElementById('host-summary'),
      hostNote: document.getElementById('host-note'),
      joinForm: document.getElementById('join-form'),
      joinName: document.getElementById('join-name'),
      joinCode: document.getElementById('join-code'),
      joinError: document.getElementById('join-error'),
      joinNote: document.getElementById('join-note'),
      lobbyCode: document.getElementById('lobby-code'),
      lobbyLink: document.getElementById('lobby-link'),
      lobbyCopy: document.getElementById('lobby-copy'),
      lobbyPlayers: document.getElementById('lobby-players'),
      lobbySeats: document.getElementById('lobby-seats'),
      lobbySummary: document.getElementById('lobby-summary'),
      lobbyEdit: document.getElementById('lobby-edit'),
      lobbyStart: document.getElementById('lobby-start'),
      lobbyLeave: document.getElementById('lobby-leave'),
      lobbyLeaveTop: document.getElementById('lobby-leave-2'),
      lobbyHint: document.getElementById('lobby-hint'),
      form: document.getElementById('settings-form'),
      settingsScope: document.getElementById('settings-scope'),
      settingsHint: document.getElementById('settings-hint'),
      prefSound: document.getElementById('pref-sound'),
      prefMotion: document.getElementById('pref-motion')
    };

    bindNames();
    bindHost();
    bindJoin();
    bindLobby();
    bindSettingsForm();
    bindMenuSettingsButton();

    renderSummaries();
    renderPrefs();
  }

  function bindMenuSettingsButton() {
    var menuButton = document.getElementById('menu-settings');
    if (menuButton) menuButton.addEventListener('click', function () { openSettings('local'); });

    var lobbyButton = document.getElementById('lobby-edit');
    if (lobbyButton) lobbyButton.addEventListener('click', function () { openSettings('room'); });
  }

  return {
    init: init,
    renderLobby: renderLobby,
    renderSummaries: renderSummaries,
    openSettings: openSettings,
    inviteLink: inviteLink
  };
})();
