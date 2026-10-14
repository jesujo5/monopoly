# Property Royale — architecture and status

This file explains how the project is put together and what is left to do.
For how to run, test and deploy it, see [README.md](README.md).

---

## 1. The shape of it

```
                 one free service (Render)
   +---------------------------------------------------------+
   |  Node + Express               Socket.IO                  |
   |  serves client/ files   <-->  real-time game messages    |
   |                                                           |
   |  rooms.js      temporary rooms, seats, codes, host powers |
   |  game-engine.js  turns, dice, and every valid action      |
   |  game-rules.js   pure rules: rent, legality, net worth    |
   |  banking.js      virtual money, debt recovery, ledger     |
   |  properties.js   the 40-space board                       |
   |  events.js       the two card decks                       |
   |  validation.js   input cleaning + limits + rate limiting  |
   |  cleanup.js      turn timers + deleting old rooms         |
   +---------------------------------------------------------+
                     ^                  |
        asks (actions) |                  | broadcasts (full state)
                     |                  v
   +---------------------------------------------------------+
   |  Browser: plain HTML/CSS/JS. Draws what it is told.       |
   +---------------------------------------------------------+
```

**The one rule that shapes everything: the browser is a remote control, not a judge.**
It sends intents, the server decides, and the resulting state is broadcast back. Editing
the JavaScript in a browser at worst produces a request that gets refused with a reason.

## 2. Why these choices

- **No database.** The requirement is temporary sessions, so rooms are plain objects in
  memory. A database would add cost and complexity for nothing.
- **One service, not two.** Serving the site from the same Node process means one free
  account, one shared URL, and no CORS configuration. A CDN for the static files stays
  possible later, at the cost of configuring `CLIENT_ORIGIN`.
- **Vanilla JavaScript, classic scripts.** No build step, no bundler, no framework. Every
  file can be opened and read. The scripts are loaded in dependency order from
  `index.html`, with one namespace (`window.EE`).
- **Rules separate from actions.** `game-rules.js` answers questions and changes nothing;
  `game-engine.js` applies the answers. That is why the rulebook can be tested with fixed
  dice in `tests/rules.js`.
- **Sound and artwork from code.** Sounds are generated with the Web Audio API and the
  board is drawn with CSS and inline SVG: nothing to download, nothing to license, ₹0.

## 3. What is done

| Area | State |
| --- | --- |
| Main menu, How to Play, three themes, sound and motion settings | Done |
| Host setup, room codes, invitation links, lobby, host powers | Done |
| Authoritative engine: dice, turns, movement, salary, rent, fees, cards | Done |
| Buying, studios and towers, pawning and buying back, bankruptcy | Done |
| Player-to-player trading with accept, decline, withdraw, expiry | Done |
| Three endings, results screen, rematch, close room | Done |
| Reconnection: refresh reclaims your seat, server refuses seat hijacking | Done |
| Temporary rooms: deletion on end, on close, and after idle sweeps | Done |
| House rules that can all be switched off, including event cards | Done |
| Three test suites (`npm test`: integrity, rules, live sockets), all passing | Done |
| Card overlay, dice, token, money and claim animations | Done |
| Phone layout, sticky action bar, list view for small screens | Done |

## 4. What is left, in order of value

1. **Deploy it.** Push to GitHub, create the Render web service, check `/health`, play a
   real match with a friend over mobile data. Everything else is a nice-to-have until this
   has been done once end to end.
2. **A 5–6 player shakedown.** The engine handles six, but only two-player matches have
   been played so far. Watch for long feeds, tiny tokens and long waits between turns.
3. **A real auction rule** for declined properties (currently they simply stay unsold).
4. **Turn timer polish**: a visible countdown and a warning beep in the last ten seconds.
5. **Better mobile board gestures**: pinch to zoom a district, or tap a space to centre it.
6. **Optional: persistent rooms** behind a flag, if you ever want a match to survive a
   server restart. That needs a database, and this project deliberately does not have one.
7. **Optional: spectators**, which needs a read-only state projection so hidden data is
   never leaked.

## 5. Risks, and how they are handled

| Risk | Handling |
| --- | --- |
| A player's browser cannot be trusted | Dice, money, ownership and victory are server-side only; every action is validated and every refusal carries a reason |
| Clicking twice | Each action has an `actionId`; the server remembers recent ids and ignores repeats |
| Spamming a free hosting tier | Token-bucket rate limits per player, a 50-room cap, and a cap on message size |
| Free server sleeping (15 min idle, ~1 min wake) | A clear "waking the game server" banner and a retry button. No keep-alive tricks |
| Server restart ending a match | Documented in the rules and the README instead of being hidden. State is memory-only, by design |
| Two tabs fighting over one seat | The client tries this tab's own seat first, then the seats this device remembers; the server hands back the first one nobody is connected to, and refuses to take over a live seat |
| One socket in two rooms | Joining a room leaves the previous one first, so a player stops receiving the old room's updates |
| Going out mid-turn freezing the table | After a space resolves, the engine checks whose turn it is before setting the phase, so the next player always gets their roll |
| Money invented from nothing | The Festival Square jackpot only grows from fees the bank actually received; a multi-player card stops charging a player who has just gone out |
| An abandoned room leaking memory | Sweeper: finished matches after 5 minutes, abandoned matches after 10, empty lobbies after an hour. Rate-limit buckets are pruned too |
| Race conditions | Node is single-threaded and no rule awaits mid-action, so one action resolves fully before the next |
| Copyright | Original board, names, colours, artwork and card text. Play money only |
| Free tiers changing | Only `express` and `socket.io` are needed, so the server can move to any Node host that supports WebSockets |
