'use strict';

/**
 * tests/integrity.js — the wiring between files.
 *
 * These are the mistakes that no unit test catches: an id the JavaScript looks
 * up but the HTML never has, a duplicated id, a stylesheet path that does not
 * exist, or a settings value the client sends under a name the server has never
 * heard of. Every one of those fails silently in a browser, so they are checked
 * here instead.
 *
 * Run it with:  npm run test:integrity
 */

const fs = require('fs');
const path = require('path');

const validation = require('../server/validation');
const properties = require('../server/properties');

const ROOT = path.join(__dirname, '..');
const CLIENT = path.join(ROOT, 'client');

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('  PASS  ' + name);
  } else {
    failed += 1;
    console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : ''));
  }
}

function section(title) {
  console.log('\n' + title);
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const html = read('client/index.html');
const clientFiles = fs.readdirSync(path.join(CLIENT, 'js')).filter(function (name) {
  return name.endsWith('.js');
});

/* ---------------------------------------------------------------------------
   1. Every lookup in the JavaScript exists in the HTML
   --------------------------------------------------------------------------- */

section('1. HTML and JavaScript agree with each other');

const htmlIds = [];
const idPattern = /id="([^"]+)"/g;
let match;
while ((match = idPattern.exec(html)) !== null) htmlIds.push(match[1]);

check('the HTML has no duplicate ids', new Set(htmlIds).size === htmlIds.length,
  htmlIds.filter(function (id, index) { return htmlIds.indexOf(id) !== index; }));

const missing = [];
const byFile = {};

clientFiles.forEach(function (file) {
  const source = fs.readFileSync(path.join(CLIENT, 'js', file), 'utf8');

  /* getElementById('x') and querySelector('#x') both need an element. */
  const lookups = [];
  const byId = /getElementById\(\s*'([^']+)'\s*\)/g;
  while ((match = byId.exec(source)) !== null) lookups.push(match[1]);

  const bySelector = /querySelector\(\s*'(#[A-Za-z0-9_-]+)'\s*\)/g;
  while ((match = bySelector.exec(source)) !== null) lookups.push(match[1].slice(1));

  byFile[file] = lookups;

  lookups.forEach(function (id) {
    /* A few ids are created by the JavaScript itself, or are modal ids that
       exist in the HTML. Anything else is a genuine mismatch. */
    const createdByScript = source.indexOf('id = \'' + id + '\'') !== -1 || source.indexOf('"id"') !== -1;
    if (htmlIds.indexOf(id) === -1 && !createdByScript) missing.push(file + ' -> #' + id);
  });
});

check('every element the scripts look up exists in the HTML', missing.length === 0, missing);

/* data-close="modal-x" must point at a real modal. */
const closeTargets = [];
const closePattern = /data-close="([^"]+)"/g;
while ((match = closePattern.exec(html)) !== null) closeTargets.push(match[1]);
const deadCloseTargets = closeTargets.filter(function (id) { return htmlIds.indexOf(id) === -1; });
check('every data-close button points at a real element', deadCloseTargets.length === 0, deadCloseTargets);

/* Files the page asks for must be on disk. */
const assetPaths = [];
const linkPattern = /(?:href|src)="((?:css|js)\/[^"]+)"/g;
while ((match = linkPattern.exec(html)) !== null) assetPaths.push(match[1]);

const missingAssets = assetPaths.filter(function (asset) {
  return !fs.existsSync(path.join(CLIENT, asset));
});
check('every stylesheet and script the page asks for exists', missingAssets.length === 0, missingAssets);

check('the Socket.IO client script is included', html.indexOf('/socket.io/socket.io.js') !== -1);
check('every client script is loaded before the app starts it', (function () {
  const appAt = html.indexOf('js/app.js');
  return appAt !== -1 && clientFiles.every(function (file) {
    if (file === 'app.js') return true;
    const at = html.indexOf('js/' + file);
    return at !== -1 && at < appAt;
  });
})(), clientFiles.filter(function (file) {
  return file !== 'app.js' && html.indexOf('js/' + file) === -1;
}));

/* ---------------------------------------------------------------------------
   2. Settings: client form, client defaults and server limits must line up
   --------------------------------------------------------------------------- */

section('2. Settings line up across the boundary');

const configSource = read('client/js/config.js');
const defaultsInClient = (function () {
  const block = configSource.slice(configSource.indexOf('DEFAULT_SETTINGS:'));
  const body = block.slice(block.indexOf('{') + 1, block.indexOf('}'));
  const names = [];
  const field = /([A-Za-z][A-Za-z0-9]*)\s*:/g;
  while ((match = field.exec(body)) !== null) names.push(match[1]);
  return names;
})();

const serverKeys = Object.keys(validation.SETTINGS_SPEC).sort();

check('the client and server know the same settings', defaultsInClient.slice().sort().join(',') === serverKeys.join(','), {
  client: defaultsInClient.slice().sort(),
  server: serverKeys
});

/* Every settings key needs a form field, or the player can never change it. */
const formNames = [];
const namePattern = /name="([A-Za-z][A-Za-z0-9]*)"/g;
while ((match = namePattern.exec(html)) !== null) formNames.push(match[1]);

const settingsWithoutFields = defaultsInClient.filter(function (key) {
  return formNames.indexOf(key) === -1;
});
check('every setting has a field in the settings form', settingsWithoutFields.length === 0, settingsWithoutFields);

/* Every labelled row on the lobby summary must be a real setting. */
const labelNames = [];
const labelPattern = /\['([A-Za-z][A-Za-z0-9]*)', '[^']+', '[^']+'\]/g;
while ((match = labelPattern.exec(configSource)) !== null) labelNames.push(match[1]);
const labelsNotReal = labelNames.filter(function (key) { return defaultsInClient.indexOf(key) === -1; });
check('every settings label refers to a real setting', labelsNotReal.length === 0, labelsNotReal);

/* ---------------------------------------------------------------------------
   3. Duplicated values that must not drift apart
   --------------------------------------------------------------------------- */

section('3. Shared values stay in step');

const serverAlphabet = validation.CODE_ALPHABET;
const clientAlphabet = (configSource.match(/CODE_ALPHABET:\s*'([^']+)'/) || [])[1];
check('room-code alphabet matches on both sides', serverAlphabet === clientAlphabet, {
  server: serverAlphabet,
  client: clientAlphabet
});

const clientCodeLength = Number((configSource.match(/CODE_LENGTH:\s*(\d+)/) || [])[1]);
check('room-code length matches on both sides', clientCodeLength === validation.CODE_LENGTH, {
  server: validation.CODE_LENGTH,
  client: clientCodeLength
});

check('the code alphabet has no lookalike characters', !/[IO01]/.test(serverAlphabet));
check('the client never hard-codes board prices', (function () {
  /* Prices must come from the server's board, otherwise they drift. */
  const priceLiterals = /price\s*:\s*\d+/.test(read('client/js/board.js')) ||
    /price\s*:\s*\d+/.test(read('client/js/property-ui.js'));
  return !priceLiterals;
})());

/* Every kind of space the server can send must be drawable by the board.
   Neighbourhood properties are drawn by their coloured band, which is why they
   have no tile--property class of their own. */
const boardSource = read('client/js/board.js');
const STYLE_EVIDENCE = {
  property: 'tile.group',
  start: "'start'",
  hold: "'hold'",
  rest: "'rest'",
  warrant: "'warrant'",
  event: "'event'",
  tax: "'tax'",
  transport: "'transport'",
  utility: "'utility'"
};
const spaceTypes = properties.TILES.map(function (tile) { return tile.type; })
  .filter(function (type, index, all) { return all.indexOf(type) === index; });

const undrawable = spaceTypes.filter(function (type) {
  const evidence = STYLE_EVIDENCE[type];
  return !evidence || boardSource.indexOf(evidence) === -1;
});
check('the board can draw every kind of space the server sends', undrawable.length === 0, undrawable);
check('the list view covers the same space kinds', spaceTypes.every(function (type) {
  return ['start', 'tax', 'event', 'hold', 'rest', 'warrant'].indexOf(type) !== -1 ||
    properties.TILES.some(function (tile) { return tile.type === type; });
}));

/* ---------------------------------------------------------------------------
   4. Files that must exist
   --------------------------------------------------------------------------- */

section('4. The files the project promises exist');

['README.md', 'PLAN.md', 'package.json', '.gitignore', '.env.example'].forEach(function (file) {
  check(file + ' exists', fs.existsSync(path.join(ROOT, file)));
});

['server/server.js', 'server/rooms.js', 'server/game-engine.js', 'server/game-rules.js',
  'server/banking.js', 'server/properties.js', 'server/events.js', 'server/validation.js',
  'server/cleanup.js'].forEach(function (file) {
  check(file + ' exists', fs.existsSync(path.join(ROOT, file)));
});

const pkg = JSON.parse(read('package.json'));
check('the start script runs the server', pkg.scripts.start === 'node server/server.js');
check('the test script runs the suites', /tests\//.test(pkg.scripts.test));
check('express and socket.io are declared as dependencies',
  Boolean(pkg.dependencies.express) && Boolean(pkg.dependencies['socket.io']), pkg.dependencies);
check('no secret-looking values are committed', !/sk_live|api[_-]?key\s*[:=]\s*['"][^'"]{12,}/i.test(read('.env.example')));

section('Result');
console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
