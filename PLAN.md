# Property Trading Board Game — Project Plan (Stage 0)

A free-to-run, multiplayer, browser-based property trading game.
Played by friends on laptops, Android phones and tablets — each on their own device,
all seeing the same board in real time.

Original branding, original fictional place names, original art. Inspired by classic
property board games, but nothing copied from protected logos or artwork.

---

## 1. Architecture (the big picture)

Three parts, and only three:

```
+-------------------+        WebSocket (Socket.IO)        +----------------------+
|  Browser (client) | <----------------------------------> |  Game server (Node)  |
|  HTML/CSS/JS      |        sends INTENTS                 |  the referee / truth |
|  shows the board  |        receives STATE                 |  memory only         |
+-------------------+                                      +----------------------+
        ^                                                             ^
        | served as plain files                                        | runs on a
        |                                                              | free web host
   Static host (Cloudflare Pages)                              Free web service (Render)
```

**Rule number one: the browser is a remote control, not a judge.**

- The client only ever *asks*: "I want to roll", "I want to buy this".
- The server *decides*: dice values, whose turn it is, who can afford what, rent amounts,
  bankruptcy, winner. It then broadcasts the resulting state to everyone in that room.
- A player who edits JavaScript in their browser can at best make a silly request that the
  server rejects. They cannot change dice or money.

**Why in-memory, no database?** Your requirement is temporary sessions, so a database adds
cost and complexity with no benefit. The server keeps a JavaScript object like
`rooms["K7P2QX"] = { players, board, turn, settings, log }`. Rooms are deleted when the
match ends, when the host closes them, or after a short idle timeout. If the server
restarts, all rooms vanish — that is an accepted, documented limitation of this design.

**Why vanilla JS on the front end?** You asked to learn step by step, so no React/Vite.
Plain files mean you can open them, read them, and see the whole picture — and boring
static hosting can serve them for free forever.

---

## 2. Folder and file structure

```
monopoly/
├── client/                      # everything the browser runs (static files)
│   ├── index.html               # home screen: Host / Join / Settings / How to Play
│   ├── room.html                # lobby + the actual game table
│   ├── css/
│   │   ├── base.css             # design tokens (colors, fonts, spacing) + reset
│   │   ├── layout.css           # mobile-first responsive layout, breakpoints
│   │   └── components.css       # buttons, cards, board tiles, dice, modals, toasts
│   ├── js/
│   │   ├── config.js            # the server URL + tunable constants (one place)
│   │   ├── net.js               # the ONLY file that talks to Socket.IO
│   │   ├── store.js             # holds the latest server state snapshot (read-only)
│   │   ├── ui/
│   │   │   ├── home.js          # menu, settings form, join form, rules text
│   │   │   ├── lobby.js         # player list, room code, share link, start button
│   │   │   ├── board.js         # draws the board + player tokens from state
│   │   │   ├── controls.js      # roll / buy / end turn buttons, enable-disable logic
│   │   │   ├── log.js           # the "what just happened" feed
│   │   │   └── results.js       # winner / end-of-game screen
│   │   └── main.js              # decides which page to bootstrap
│   └── assets/                  # original inline SVG icons + optional sounds
│
├── server/                      # the referee (runs on a free Node host)
│   ├── package.json
│   ├── index.js                 # Express + Socket.IO entry point, health check
│   ├── config.js                # port, allowed client origin, limits, timeouts
│   ├── rooms.js                 # create/join/leave/delete rooms, idle reaper
│   ├── game/
│   │   ├── board.js             # the tile list: 40 spaces, fictional names, prices
│   │   ├── state.js             # createGameState(settings) — initial truth
│   │   ├── rules.js             # legal-action checks: rent, tax, buy, bankruptcy
│   │   ├── cards.js             # event decks (Surprise / Community style, original)
│   │   └── dice.js              # server-side random dice (never the client's)
│   └── socket/
│       ├── handlers.js          # socket event -> validated game action -> new state
│       └── broadcast.js         # send state to everyone in one room
├── .gitignore
├── .env.example                 # PORT, CLIENT_ORIGIN — no secrets, just names
├── PLAN.md                      # this file
└── README.md                    # written at the end: setup + deploy instructions
```

Deliberately no `shared/` folder yet: duplicating tile data in two places confuses
beginners. The server owns all game data; the client learns it from the state it receives.

---

## 3. Purpose of each important file

| File | What it does | Why it matters |
| --- | --- | --- |
| `server/index.js` | Starts HTTP + Socket.IO, wires handlers | Single entry point; hosts run `node index.js` |
| `server/rooms.js` | `createRoom`, `joinRoom`, `leaveRoom`, `deleteRoom`, idle sweep | Keeps the "many independent rooms" rule in one readable place |
| `server/game/state.js` | Builds the starting game state from host settings | One function = one obvious source of truth |
| `server/game/rules.js` | Answers "is this action legal, and what changes?" | The referee. Unit-testable pure functions |
| `server/game/board.js` | Tile definitions: names, colors, prices, rents | Change the game here, not in 12 places |
| `server/socket/handlers.js` | Turns `roll_dice`, `buy_property`, … into rule checks | The security boundary — nothing else validates input |
| `client/js/net.js` | Connect, emit intents, receive state, reconnect | Only file that knows Socket.IO exists. Easy to swap later |
| `client/js/store.js` | Keeps the last state and notifies UI to redraw | Prevents UI code from inventing its own numbers |
| `client/js/ui/board.js` | Renders board from state | Redraw-on-state-change keeps rendering simple |
| `client/css/layout.css` | Mobile-first rules + landscape/portrait board layout | Board must be usable on a 5-inch phone *and* a laptop |
| `client/js/config.js` | Holds the server URL | One line to change when you deploy |

---

## 4. Recommended free hosting (verified October 2026)

| Need | Choice | Status |
| --- | --- | --- |
| Static frontend | **Cloudflare Pages** | Free, no credit card, unlimited bandwidth for static assets, custom HTTPS domain available free |
| Multiplayer server | **Render** Free Web Service (Node.js) | Free, no credit card for the free path, supports WebSockets |
| Domain | `*.pages.dev` + `*.onrender.com` subdomains | ₹0. A custom domain is optional and separately priced |

**Render free web service — the honest details**

- **WebSockets work**, and WebSocket messages count as "inbound traffic" for idleness.
- **Sleeps after 15 minutes with no traffic**; waking takes about **1 minute**. In an active
  match, players are constantly sending traffic, so mid-game sleeping is unlikely.
- **750 free instance hours per month** per workspace; spun-down services don't consume them.
- **Ephemeral filesystem** and the docs explicitly say Render may restart a free service at
  any time. Since our state is in memory anyway, a restart ends active matches.
- No "keep-alive pings" or fake traffic. That violates the hosting rules you asked me to
  respect, and the workaround is fragile. Instead the UI will say
  "Waking up the game server, this can take a minute…" and retry.

**Verified and rejected as the primary host**

- **Fly.io** — no free tier or monthly allowance for new organizations; trial only.
- **Railway** — 30-day trial with $5 credit, after that roughly $1/month of free credit,
  which is too small to rely on.
- **Glitch** — shut down project hosting in July 2025.
- **Koyeb** — does offer one free web service, but their pricing FAQ requires a credit card
  and a $29 pre-authorization, which conflicts with your "no billing account" rule.
  Usable as a backup only if you accept that trade-off.
- **Render Static Site** (also free) is a fine alternative if you'd rather have one account
  and one dashboard for both the site and the server.

**Free tiers change.** Before we actually deploy, I will re-check each provider's current
terms with you. This plan assumes nothing is permanent.

**Optional paid upgrades** (never required to play): persistent disk or always-on instance
on Render (removes cold starts), custom domain (~₹800–1200/year). Everything else is free.

---

## 5. How hosting, joining, sync and deletion work

**Creating a room (Host a Game)**
1. You pick settings (starting money, max players, rules) on the home screen.
2. The browser sends `create_room` with those settings.
3. The server generates a short room code from an unambiguous alphabet (`ABCDEFGHJKMNPQRSTUVWXYZ23456789` — no `I`, `O`, `0`, `1`), stores the room, and replies.
4. You get a code (e.g. `K7P2QX`) and a share link like
   `https://yoursite.pages.dev/room.html?code=K7P2QX`.
5. You are marked as **host**: you may change settings in the lobby, start the match,
   kick a player, or close the room.

**Joining**
1. Friend opens the link (or types the code on the home screen).
2. Server checks: does the room exist, is it full, has it already started?
3. On success the player is added to the lobby and everyone's lobby list updates.
4. Each browser gets a private **reconnect token**, kept in `sessionStorage`. Refresh or a
   dropped connection → same seat, same money. Losing that token loses the seat (by design).

**Real-time synchronisation**

```
Player clicks "Roll"  ->  client emits { type: "roll_dice" }
Server               ->  checks: your turn? already rolled? game active?
                     ->  rolls dice, moves token, resolves the landed space
                     ->  emits { type: "state", room: {...} } to the whole room
Every browser        ->  redraws from that state
```

The whole room state is small (a few kilobytes for ≤6 players), so we broadcast the full
state on every change. That is the simplest correct thing, and it makes reconnection trivial.
If the game grows, we can switch to sending only the differences.

**Deleting temporary data**
- Match ends → host presses **Close room** → server deletes the room object, tells everyone,
  and each player returns to the home screen. Their reconnect token becomes useless.
- Last player leaves → room is kept briefly (grace period, ~10 minutes) so an accidental
  refresh doesn't destroy the game, then an internal timer sweeps it.
- Empty/idle rooms are swept on a fixed interval so abandoned games don't leak memory.
- Server restart or spin-down → all rooms are gone. The client says so plainly instead of
  pretending the match can continue.
- Honest wording for players: the server's copy is deleted. Screenshots, browser history,
  and anything a player saved on their own device are outside our control and untouched.

---

## 6. Development stages (in this order)

Each stage ends with something you can actually open in a browser and click.

| Stage | What we build | You can test it by |
| --- | --- | --- |
| 0 | This plan | Reading it (you are here) |
| 1 | Project scaffold + home screen HTML/CSS (no server yet) | Opening `client/index.html`, resizing to phone width |
| 2 | Node + Socket.IO "hello world": connect, show live status | Two tabs both saying "connected" |
| 3 | Rooms: create, join by code, lobby list, host-only Start | Two devices: laptop + phone in the same room |
| 4 | Game state + board rendering + player tokens at "Start" | Seeing the board drawn from server data |
| 5 | Turns and dice: server-side roll, movement, End Turn | Pass-and-play with 2 tabs |
| 6 | Money: buy property, pay rent, tax spaces, salary on the start tile | Balances changing correctly in both tabs |
| 7 | Event cards and the "held" mechanic (original names) | Landing on an event tile |
| 8 | Upgrades, mortgage, player-to-player trade offers | Trades accepted/declined on two devices |
| 9 | Win condition + results screen | Playing a short game to completion |
| 10 | Polish: dice/movement/money animations, sounds, mobile controls, reconnect UX, "server waking" screen | Real playtest on phone + laptop |
| 11 | Deploy: server → Render, frontend → Cloudflare Pages, CORS + env setup | Friends joining from other homes on mobile data |
| 12 | Hardening: input validation, per-room action rate limits, room caps, idle sweeps, README with setup steps | Someone deliberately trying to cheat |

Recommended order of work each stage: server rule first → socket event → client control →
styling → test with two browser tabs → test on a real phone.

---

## 7. Main technical risks, and how we avoid them

1. **Free server sleeps / cold start (15 min idle, ~1 min wake).**
   Avoid: show a clear "waking server" state with a retry; players are active during a match
   so this mostly hits the *first* connection. No keep-alive hacks.

2. **Server restart wipes the match.** Avoid: state it in "How to Play" and in the lobby,
   and keep the design so a lost match is a minor annoyance, not a data-loss event.

3. **A player's browser cannot be trusted.** Avoid: server-only dice, server-only validation
   of every action, never accept a price, balance, or dice value from the client. Validate
   the room code and action shape on every event.

4. **CORS / mixed content when deployed.** Avoid: frontend and backend on HTTPS, server
   allows only the known frontend origin (from an environment variable), Socket.IO
   configured with that origin — get this right in Stage 2, not at deploy time.

5. **Mobile browser quirks.** Avoid: phones throttle background tabs and sleep screens.
   Design so that (a) the server owns all timing, and (b) a reconnect always receives the
   full current state, so nothing has to be replayed.

6. **Abandoned rooms leaking memory.** Avoid: idle sweep timer, max rooms per server, max
   players per room, and a hard cap on action size. Test by opening 20 rooms and closing them.

7. **Race conditions (two players acting at once).** Avoid: per-room action queue — one
   action is fully resolved (state updated + broadcast) before the next is processed.
   Node being single-threaded makes this easy if we never `await` in the middle of a rule.

8. **Reconnection and seat stealing.** Avoid: random reconnect tokens, not just player
   names; a taken seat cannot be claimed by a second connection.

9. **Copyright and trademarks.** Avoid: fully original brand name, tile names, colors,
   icons (hand-written SVG/CSS), and card text. Never reuse classic board-game logotypes.

10. **Free tier terms changing.** Avoid: keep the server to plain Node + `socket.io`
    (portable to any host), keep configuration in `.env`, and re-verify provider terms
    at deploy time rather than trusting this document.

11. **Testing across devices.** Avoid: develop on the same Wi-Fi using your laptop's LAN IP
    (e.g. `http://192.168.1.5:3000`) so your phone and laptop can share one server. A free
    quick tunnel (`cloudflared` / `ngrok`) is fine for temporary testing only — never as a
    permanent keep-alive trick.

12. **Scope creep before the game is playable.** Avoid: Stages 1–6 produce a playable,
    boring-but-working game. Trades, upgrades, and animations come after that.

---

## Naming / branding (placeholder)

Working title: **Estate Empire** (easily changed — it lives in one place, `client/js/config.js`).
Board theme: a fictional island city with invented neighbourhoods and invented street names,
drawn with CSS gradients + hand-written SVG, so the art is unambiguously ours.
