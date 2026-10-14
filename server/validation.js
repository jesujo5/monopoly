'use strict';

/**
 * validation.js — the bouncer.
 *
 * Nothing a browser sends is trusted. Every value is checked, trimmed, clamped
 * or replaced before the rest of the server sees it. This file is short on
 * purpose: one obvious place to review for security.
 */

/* Room codes use only these characters, so a code can never be confused with a
   similar-looking one when it is read aloud or typed. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

const NAME_MAX = 16;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

/* The settings a host may change, with hard limits. Anything outside these is
   pulled back into range rather than rejected, so a bad client cannot break a
   room, and a confused player still gets a usable game. */
const SETTINGS_SPEC = {
  startingMoney: { type: 'int', min: 2000, max: 100000, fallback: 15000 },
  salary: { type: 'int', min: 0, max: 10000, fallback: 2000 },
  maxPlayers: { type: 'int', min: MIN_PLAYERS, max: MAX_PLAYERS, fallback: 4 },
  turnTimerSeconds: { type: 'int', min: 0, max: 180, fallback: 0 },
  winningCondition: { type: 'choice', choices: ['last-standing', 'net-worth', 'rounds'], fallback: 'last-standing' },
  netWorthTarget: { type: 'int', min: 10000, max: 500000, fallback: 40000 },
  roundLimit: { type: 'int', min: 5, max: 100, fallback: 20 },
  upgrades: { type: 'bool', fallback: true },
  mortgages: { type: 'bool', fallback: true },
  trading: { type: 'bool', fallback: true },
  events: { type: 'bool', fallback: true },
  freeParkingPot: { type: 'bool', fallback: false }
};

function clampInt(value, min, max, fallback) {
  const number = parseInt(value, 10);
  if (Number.isNaN(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/* Names are shown to other people, so strip anything that is not a normal
   printable character and keep the length sane. */
function sanitiseName(raw) {
  if (typeof raw !== 'string') return 'Player';

  const cleaned = raw
    .replace(/[<>{}[\]\\/|]/g, '') // no markup-ish characters
    .replace(/[\u0000-\u001f\u007f]/g, '') // no control characters
    .trim()
    .slice(0, NAME_MAX);

  return cleaned.length > 0 ? cleaned : 'Player';
}

function normaliseCode(raw) {
  if (typeof raw !== 'string') return '';

  const upper = raw.toUpperCase();
  let code = '';

  for (let i = 0; i < upper.length; i++) {
    if (CODE_ALPHABET.indexOf(upper.charAt(i)) !== -1) code += upper.charAt(i);
  }

  return code.slice(0, CODE_LENGTH);
}

function isValidCode(code) {
  return typeof code === 'string' && code.length === CODE_LENGTH;
}

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length));
  }
  return code;
}

/* Turn whatever arrived into a complete, safe settings object. Unknown keys are
   dropped; known keys are clamped. */
function cleanSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const settings = {};

  Object.keys(SETTINGS_SPEC).forEach(function (key) {
    const spec = SETTINGS_SPEC[key];
    const value = input[key];

    if (spec.type === 'int') {
      settings[key] = clampInt(value, spec.min, spec.max, spec.fallback);
    } else if (spec.type === 'bool') {
      settings[key] = typeof value === 'boolean' ? value : spec.fallback;
    } else if (spec.type === 'choice') {
      settings[key] = spec.choices.indexOf(value) !== -1 ? value : spec.fallback;
    }
  });

  return settings;
}

function defaultSettings() {
  return cleanSettings({});
}

/* ---------------------------------------------------------------------------
   Rate limiting — a simple token bucket per player.
   Spamming the server is the easiest way to hurt a free hosting tier, so every
   player gets a small allowance that refills over time.
   --------------------------------------------------------------------------- */
function createRateLimiter(options) {
  const burst = (options && options.burst) || 20;
  const refillPerSecond = (options && options.refillPerSecond) || 4;
  const buckets = new Map();

  return {
    /* Returns true when the action is allowed. */
    allow: function (key) {
      const now = Date.now();
      const bucket = buckets.get(key) || { tokens: burst, last: now };

      bucket.tokens = Math.min(burst, bucket.tokens + ((now - bucket.last) / 1000) * refillPerSecond);
      bucket.last = now;

      if (bucket.tokens < 1) {
        buckets.set(key, bucket);
        return false;
      }

      bucket.tokens -= 1;
      buckets.set(key, bucket);
      return true;
    },
    forget: function (key) {
      buckets.delete(key);
    },
    size: function () {
      return buckets.size;
    },
    /* Drop buckets that have not been used for a while. Without this the map
       grows for the life of the process, because every player id and socket id
       that ever connects gets one. */
    prune: function (maxIdleMs) {
      const idleLimit = maxIdleMs || 10 * 60 * 1000;
      const now = Date.now();
      let removed = 0;

      buckets.forEach(function (bucket, key) {
        if (now - bucket.last > idleLimit) {
          buckets.delete(key);
          removed += 1;
        }
      });

      return removed;
    }
  };
}

/* ---------------------------------------------------------------------------
   Duplicate-action protection.
   If a click is sent twice (double tap, a flaky connection retrying), the
   second copy is ignored. This is what stops "buy" charging you twice.
   --------------------------------------------------------------------------- */
function createActionLog(limit) {
  const seen = new Set();
  const order = [];
  const max = limit || 200;

  return {
    isDuplicate: function (actionId) {
      if (!actionId || typeof actionId !== 'string') return false;
      return seen.has(actionId);
    },
    remember: function (actionId) {
      if (!actionId || typeof actionId !== 'string') return;
      if (seen.has(actionId)) return;
      seen.add(actionId);
      order.push(actionId);
      if (order.length > max) {
        seen.delete(order.shift());
      }
    },
    clear: function () {
      seen.clear();
      order.length = 0;
    }
  };
}

module.exports = {
  CODE_ALPHABET: CODE_ALPHABET,
  CODE_LENGTH: CODE_LENGTH,
  NAME_MAX: NAME_MAX,
  MIN_PLAYERS: MIN_PLAYERS,
  MAX_PLAYERS: MAX_PLAYERS,
  SETTINGS_SPEC: SETTINGS_SPEC,
  clampInt: clampInt,
  sanitiseName: sanitiseName,
  normaliseCode: normaliseCode,
  isValidCode: isValidCode,
  generateCode: generateCode,
  cleanSettings: cleanSettings,
  defaultSettings: defaultSettings,
  createRateLimiter: createRateLimiter,
  createActionLog: createActionLog
};
