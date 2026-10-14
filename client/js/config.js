/* ==========================================================================
   config.js — every constant the browser needs, in one place.

   If you want to rename the game, change the money symbol, or adjust the
   defaults a new player sees, this is the only file you need to touch.
   ========================================================================== */

window.EE = window.EE || {};

EE.CONFIG = {
  GAME_NAME: 'Property Royale',
  VERSION: '1.0.0',

  /* Room codes: no I, O, 0 or 1, so they can never be misread. Must match the
     server's list in server/validation.js. */
  CODE_LENGTH: 6,
  CODE_ALPHABET: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',

  CURRENCY: '\u20B9', // ₹
  MAX_NAME: 16,

  /* The defaults a first-time visitor sees. The server clamps these again, so
     a tampered-with browser cannot create a strange game. */
  DEFAULT_SETTINGS: {
    startingMoney: 15000,
    salary: 2000,
    maxPlayers: 4,
    winningCondition: 'last-standing',
    netWorthTarget: 40000,
    roundLimit: 20,
    turnTimerSeconds: 0,
    upgrades: true,
    mortgages: true,
    trading: true,
    events: true,
    freeParkingPot: false
  },

  /* How each setting is described on the lobby and host screens.
     [setting name, label, formatting function] */
  SETTING_LABELS: [
    ['startingMoney', 'Starting money', 'money'],
    ['salary', 'Salary per lap', 'money'],
    ['maxPlayers', 'Maximum players', 'players'],
    ['winningCondition', 'Match ends', 'win'],
    ['netWorthTarget', 'Net worth target', 'money'],
    ['roundLimit', 'Round limit', 'rounds'],
    ['turnTimerSeconds', 'Turn timer', 'timer'],
    ['upgrades', 'Studios and towers', 'onoff'],
    ['mortgages', 'Pawning', 'onoff'],
    ['trading', 'Trading', 'onoff'],
    ['events', 'Event spaces', 'onoff'],
    ['freeParkingPot', 'Festival jackpot', 'onoff']
  ],

  WIN_LABELS: {
    'last-standing': 'Last player solvent',
    'net-worth': 'First to a net worth target',
    rounds: 'Highest worth after a set number of rounds'
  },

  /* Where things are remembered. The seat (who you are in a room) lives in
     sessionStorage, which is per browser tab — that is why you can open two
     tabs and play both sides while testing. */
  STORAGE: {
    settings: 'property-royale:settings:v1',
    prefs: 'property-royale:prefs:v1',
    /* This tab's seat. sessionStorage is per tab, which is why two tabs can be
       two different players while testing. */
    seat: 'property-royale:seat:v1',
    /* A backup of the seat, per room, in localStorage. It lets a refresh
       reclaim your seat even if the browser cleared sessionStorage. */
    seatPrefix: 'property-royale:room:'
  },

  DEFAULT_PREFS: {
    sound: true,
    theme: 'felt',
    motion: 'full',
    playerName: ''
  }
};
