# Property Royale

An original, free-to-run multiplayer property-trading board game for the browser.
Friends play together from different devices — Windows laptop, Android phone, tablet —
all seeing the same board in real time.

> Inspired by classic property board games, but every name, colour, price and piece of
> artwork here is our own. Nothing is copied from anyone else's branding, and no real
> payments exist anywhere in the project. It is play money, always.

---

## What is built

This is a working game, not a mock-up. A real match between two browsers includes:

- **Hosting a room** with your own rules — starting money, salary, player limit, turn timer,
  the way the match ends, and switches for studios, pawning, trading and event cards — plus
  a 6-character room code and a shareable link.
- **Joining** by code or invitation link, with a lobby listing everyone and their seats.
- **An authoritative server**: dice, turns, rent, purchases, upgrades, pawning, trades,
  bankruptcy and the winner are all decided by `server/`, never by a browser.
- **A 40-space original board** with eight neighbourhoods, four transport lines, two
  utilities, fees, two event decks, the Harbour Hold, Festival Square and the Grand Terminal.
- **Turn flow** with doubles earning another roll and three doubles sending you to the Hold.
- **Studios and towers**, **pawning and buying back at 10% interest**, and **player-to-player
  trading** with accept / decline / withdraw and a 60-second expiry.
- **Three different endings**: last player solvent, first to a net worth target, or highest
  net worth after a set number of rounds.
- **Reconnection**: refresh the page mid-match and you get the same seat, the same money
  and the same turn back — on the same device.
- **Temporary rooms**: rooms are deleted when the match ends, the host closes them, or
  nobody has been connected for a while.
- Phone-friendly controls: a sticky action bar, tap-any-space details, and a "List view"
  that replaces the board with a readable list on a small screen.
- Sound effects generated in the browser (no audio files), three colour themes, and a
  reduced-motion mode that also honours your operating system setting.

Not built, and deliberately advertised as such rather than faked: no accounts, no saved
history, no spectator mode, and no auctions. Every button in the interface does something.

---

## Running it on your computer

You need **Node.js 18 or newer**. Nothing else — no database, no build step, no bundler.

```bash
npm install     # installs express and socket.io (the only dependencies)
npm start       # starts the game server and the website together
```

Then open **http://localhost:3000**.

To play both sides yourself, open a second browser tab. Each tab keeps its own seat, so
you can be the host in one and a guest in the other:

1. In tab 1: **Host a Game** → type a name → **Create room**.
2. Copy the invitation link, or read the 6-character code from the lobby.
3. In tab 2: open the link (or type the code) → type a different name → **Join room**.
4. Back in tab 1: **Start match**.

To try it on your phone, find your computer's local address (`ipconfig` on Windows), then
visit `http://YOUR-IP:3000` on the phone while both are on the same Wi-Fi. The phone will
ask for a name and the room code.

---

## Tests

```bash
npm test                # everything (about 25 seconds)
npm run test:integrity  # the wiring between files
npm run test:rules      # fast: the rulebook only
npm run test:live       # only the multi-client socket test
```

- `tests/integrity.js` checks the things no runtime test catches: every element the
  JavaScript looks up exists in the HTML, no duplicated ids, every stylesheet and script
  path exists, the client and server agree on the setting names, and the room-code
  alphabet matches on both sides.
- `tests/rules.js` drives the engine directly with **fixed dice**, so the rent tables,
  group bonuses, salary, building rules, pawning interest, trading, bankruptcy, the
  Harbour Hold, all three endings, the Festival Square jackpot and the room-cleanup
  decisions are checked every run.
- `tests/smoke.js` starts the **real server** and plays matches between **several real
  socket clients**: host-only powers, out-of-turn actions, repeated clicks, late joins,
  no negative balances, two rooms staying completely independent, a player switching rooms
  without leaking the old one, and closing rooms really removing them from the server.

All three suites pass. There are no TypeScript types or linter configured, on purpose —
the project stays plain JavaScript so every file can be read top to bottom.

---

## Project layout

```
client/                    everything the browser loads
  index.html               the whole interface: menu, lobby, board, results, modals
  css/style.css            colour themes, reset, page shell
  css/components.css       buttons, cards, forms, tables, toasts
  css/board.css            the board ring, spaces, tokens, dice, list view
  css/animations.css       dice, tokens, money, cards — all switched off by reduced motion
  js/config.js             branding, defaults, room-code alphabet, storage keys
  js/state.js              the browser's copy of the server's state (read-only)
  js/notifications.js      toasts, connection banner, Web Audio sound effects
  js/socket-client.js      the ONLY file that talks to the server
  js/navigation.js         screen switching, modals, themes, the rulebook text
  js/lobby.js              host setup, join form, lobby, the settings form
  js/board.js              draws the 40 spaces, tokens, dice and animations
  js/banking-ui.js         your wallet and the money trail
  js/property-ui.js        property details, building, pawning, trading
  js/game-ui.js            turn banner, action bar, players, feed, results
  js/app.js                starts everything and reacts to the server
server/                    the referee — all game truth lives here
  server.js                Express + Socket.IO, serves the site and the sockets
  rooms.js                 rooms, seats, codes, host powers, deletion
  game-engine.js           turn flow and every validated action
  game-rules.js            pure rules: rent, net worth, legality, victory
  properties.js            the 40-space board and money constants
  banking.js               the virtual bank, debt recovery, the ledger
  events.js                the two original card decks
  validation.js            input cleaning, settings limits, rate limiting, duplicate clicks
  cleanup.js               turn timers and temporary room deletion
tests/                     the two test suites described above
```

---

## How multiplayer works

**The server is the only authority.** A browser can ask (`roll`, `buy`, `build`,
`trade_propose`, …) and gets either a change or a reason it was refused. Dice are rolled on
the server: `tests/smoke.js` verifies two dice appear with a correct total after a roll, and
no client can supply one.

**Every action carries an `actionId`.** A double tap, or a message a flaky connection retried,
is recognised as the same action and ignored — so a purchase can never charge you twice.

**State is broadcast, not patched.** After each accepted action the whole room state (a few
kilobytes for six players) goes to everyone in that room. It is the simplest thing that is
correct, and it makes reconnection trivial: on reconnect you receive the current state and
nothing needs replaying.

**Seats, not logins.** The server hands each player a private random id. It is remembered
in three places, in this order of trust: this tab's own memory (`window.name`, which
survives a reload and is invisible to other tabs), the tab's `sessionStorage`, and a
per-room list in `localStorage`. The room code goes into the address bar, e.g.
`?room=7XQ4KM`, so a refresh knows which room to ask about. Trying the tab's own seat
first is what stops a refresh from picking up a friend's seat instead of your own.

**A seat cannot be hijacked.** The server refuses to hand back a seat that is currently
connected elsewhere, and it never lets a *reclaim* rename an existing seat. If a refresh
cannot get your seat back, you are politely dropped on the join form with the code filled in.

---

## Deploying for free

The website and the multiplayer server are **one service**. That is a deliberate choice:
one free account, one URL to share, and no cross-origin (CORS) problems to fight — the
browser talks to the same address it loaded the page from.

**Render free web service (verified October 2026).**

1. Push this folder to a GitHub repository.
2. On Render: **New → Web Service**, connect the repository.
3. Build command `npm install`, start command `npm start`.
4. Environment: set `CLIENT_ORIGIN` to your Render URL once you know it (optional — without
   it the server accepts same-origin connections, which is what this setup uses), and leave
   `PORT` alone. Render provides it automatically.
5. Visit `https://your-service.onrender.com/health` — a healthy server answers with JSON.

**What is genuinely free, and what is not.** The free instance needs no credit card for the
free path, supports WebSockets (WebSocket messages count as activity), and gives 750
instance hours per calendar month. Be aware of the honest limits:

- It **sleeps after 15 minutes with no traffic** and takes **about a minute to wake**. The
  interface says "Waking the game server…" instead of pretending the tap worked. No
  keep-alive pings: that is against the host's rules and it is fragile.
- It **may restart at any time**, and its filesystem is temporary.
- Outbound bandwidth and build minutes are capped monthly; if they run out and no card is
  attached, free services are suspended until the month turns over.

**Things that cost money — all optional.** A persistent disk or an always-on instance (both
remove the cold start), or a custom domain (~₹800–1200/year). None of them is needed to play.

**Verified and rejected as the primary host:** Fly.io (no free tier for new accounts),
Railway (about $1/month of free credit — too small), Glitch (hosting shut down in July 2025),
Koyeb (free instance, but requires a credit card and a $29 pre-authorisation). Free tiers
change, so check the provider's current terms before you rely on them.

If you ever want the static files on a CDN instead, `client/` is plain files and works on
Cloudflare Pages as-is — but you would then need `CLIENT_ORIGIN` set on the server, and the
two halves would be on different addresses.

---

## Honest limits

- **Game state lives in the server's memory.** Restart the server (or let the free host
  sleep it away for long enough that the room is swept) and active matches end. There is no
  saved history to recover, by design.
- **Rooms are temporary.** A finished match is swept a few minutes after everyone leaves, an
  abandoned match after ten minutes with nobody connected, and an empty lobby after an hour.
  Closing a room deletes it immediately.
- **Saying "deleted" means our copy.** When a room is deleted, the server's data for it is
  gone. Screenshots, browser history, and anything a player saved themselves are outside our
  control, and this README will not pretend otherwise.
- **One device, two seats, one name.** Two tabs on the same device each keep their own seat,
  but the "your name" field is shared, so after a refresh the reclaim prefers the seat that
  nobody is using. If it cannot work out which seat was yours, it asks you to press Join.
- **Not hardened for the open internet.** There is rate limiting and strict validation, but
  no accounts, no abusive-content filtering beyond name cleaning, and a 50-room cap. It is
  built for playing with friends, which is what it is good at.
