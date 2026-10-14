# Arcade lock: manual tests

Automated tests: `cd functions && npm test` (schedule, midnight/DST math,
code hashing, 423 responses, `.br` headers). The steps below exercise the
real function, database rules and Hosting rewrite.

There are two parts:

- **Part A (local emulators)** covers the exact time boundaries and the
  midnight expiry. The emulator accepts a fake clock (`?now=` on HTTP
  requests, `"now"` in the override call). Deployed functions ignore it.
- **Part B (production, after deploy)** uses the real clock.

---

## Part A: local emulators

### A0. One-time setup

Requires Java 11+ (for the database and storage emulators).

1. Pick a throwaway test code (**not** the real override code) and store only
   its hash for the emulator. `functions/.secret.local` is git-ignored
   (`*.local`):

   ```bash
   printf 'ARCADE_OVERRIDE_HASH=%s\n' "$(printf '%s' 'emulator-test-code' | sha256sum | cut -d' ' -f1)" > functions/.secret.local
   ```

2. Build the site so the Hosting emulator has something to serve, pointing the
   game iframe at the local function:

   ```bash
   VITE_ARCADE_FUNCTION_URL=http://127.0.0.1:5001/whrhs-cs-club/us-central1/arcade npm run build
   ```

3. Start the emulators and leave them running:

   ```bash
   firebase emulators:start --only auth,functions,database,storage,hosting
   ```

4. In a second terminal, seed a test game and two test accounts:

   ```bash
   node functions/scripts/arcade-emulator-seed.js
   ```

5. Shortcuts used below:

   ```bash
   F=http://127.0.0.1:5001/whrhs-cs-club/us-central1
   GAME=$F/arcade/game/arcade-test-game
   st() { curl -s "$F/arcade/status?now=$1"; echo; }
   gm() { curl -s -o /dev/null -w "%{http_code}\n" "$GAME/index.html?now=$1"; }
   ```

### A1. Weekday time boundaries (Wednesday 14 Oct 2026)

| Time | Command | Expected |
|---|---|---|
| 7:29 AM | `st 2026-10-14T07:29:00-04:00` then `gm 2026-10-14T07:29:00-04:00` | `"open":true,"reason":"schedule"`, then `200` |
| 7:30 AM | `st 2026-10-14T07:30:00-04:00` then `gm 2026-10-14T07:30:00-04:00` | `"open":false,"reason":"school-hours"`, then `423` |
| 2:14 PM | `st 2026-10-14T14:14:00-04:00` then `gm 2026-10-14T14:14:00-04:00` | `"open":false`, then `423` |
| 2:15 PM | `st 2026-10-14T14:15:00-04:00` then `gm 2026-10-14T14:15:00-04:00` | `"open":true`, then `200` |

### A2. Weekend (any time)

| Time | Command | Expected |
|---|---|---|
| Sat 10:00 AM | `st 2026-10-17T10:00:00-04:00` then `gm 2026-10-17T10:00:00-04:00` | `"open":true`, then `200` |
| Sun 9:00 AM | `st 2026-10-18T09:00:00-04:00` then `gm 2026-10-18T09:00:00-04:00` | `"open":true`, then `200` |

### A3. Locked URLs return no game content

```bash
curl -s -i "$GAME/index.html?now=2026-10-14T09:00:00-04:00"
curl -s -i "$GAME/Build/game.js.br?now=2026-10-14T09:00:00-04:00"
```

Expected for both: `HTTP/1.1 423 Locked`, `cache-control: private, no-store`,
no `content-encoding` header, and a body that is only the lock page ("The
Arcade is restricted during school hours…"). Neither body contains
`ARCADE-TEST-GAME`.

### A4. `.br` files keep Content-Encoding

```bash
curl -s -D - -o /dev/null "$GAME/Build/game.js.br?now=2026-10-14T15:00:00-04:00"
curl -s "$GAME/Build/game.js.br?now=2026-10-14T15:00:00-04:00" | node -e "process.stdin.on('data',d=>console.log(require('zlib').brotliDecompressSync(d).toString()))"
```

Expected: `200`, `content-encoding: br`,
`content-type: application/javascript; charset=utf-8`, and the second
command prints `document.title = 'ARCADE-TEST-GAME-SCRIPT loaded';`.

### A5. Hosting rewrite

```bash
curl -s -i http://127.0.0.1:5000/api/arcade/status
```

Expected: `200`, `cache-control: private, no-store`, JSON with `"open"`.

### A6. Override: exec plus code, expiring at midnight

```bash
tok() { curl -s "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"emulator-pass-123\",\"returnSecureToken\":true}" | node -pe "JSON.parse(require('fs').readFileSync(0)).idToken"; }
EXEC=$(tok exectest@example.com); MEMBER=$(tok membertest@example.com)
ov() { curl -s "$F/setArcadeOverride" -H 'Content-Type: application/json' ${1:+-H "Authorization: Bearer $1"} -d "$2"; echo; }
```

| Step | Command | Expected |
|---|---|---|
| Not signed in | `ov "" '{"data":{"code":"emulator-test-code"}}'` | `"status":"UNAUTHENTICATED"` |
| Member, right code | `ov "$MEMBER" '{"data":{"code":"emulator-test-code"}}'` | `"status":"PERMISSION_DENIED"` ("Exec board only.") |
| Exec, wrong code | `ov "$EXEC" '{"data":{"code":"nope","now":"2026-10-14T13:00:00-04:00"}}'` | `"PERMISSION_DENIED"` ("That code is not correct.") |
| Exec, right code at 1:00 PM | `ov "$EXEC" '{"data":{"code":"emulator-test-code","now":"2026-10-14T13:00:00-04:00"}}'` | `{"result":{"overrideUntil":1792036800000}}` (= 15 Oct 2026 12:00 AM EDT) |
| 1:00 PM | `st 2026-10-14T13:00:00-04:00` then `gm 2026-10-14T13:00:00-04:00` | `"reason":"override"`, then `200` |
| 11:59:59 PM | `st 2026-10-14T23:59:59-04:00` | `"reason":"override"` |
| **12:00 AM (expired)** | `st 2026-10-15T00:00:00-04:00` | `"reason":"schedule"`, `"overrideUntil":null` |
| Next day 9:00 AM | `st 2026-10-15T09:00:00-04:00` then `gm 2026-10-15T09:00:00-04:00` | `"open":false`, then `423` |
| End override early | `ov "$EXEC" '{"data":{"action":"clear"}}'` | `{"result":{"overrideUntil":null}}` |

Rate limit: six calls in the same hour from one exec (right or wrong code)
make the sixth return `"RESOURCE_EXHAUSTED"`. A correct code resets the
count.

### A7. Browsers can't read or write the override

```bash
curl -s "http://127.0.0.1:9000/arcadeOverride.json?ns=whrhs-cs-club-default-rtdb&auth=$EXEC"
curl -s -X PUT -d '{"expiresAt":9999999999999}' "http://127.0.0.1:9000/arcadeOverride.json?ns=whrhs-cs-club-default-rtdb&auth=$EXEC"
```

Expected: `"Permission denied"` for both, even for an exec.

### A8. Pages (optional)

Open http://127.0.0.1:5000/projects.html and
`http://127.0.0.1:5000/play.html?id=<a game id>`. Pages use the real clock, so
outside school hours the cards say "Play →". During school hours the notice
appears, the cards say "Locked", and the play page shows the lock message
without loading the game. (The pages read game titles from the production
database, so use a real game id for the play page.)

---

## Part B: production, after deploy

```bash
F=https://us-central1-whrhs-cs-club.cloudfunctions.net
SITE=https://whrhs-cs-club.web.app
ID=-P2PaA-CZbqui2LeRc0F   # Loaded Dice
```

1. **Status and rewrite:** `curl -s -i $F/arcade/status` and
   `curl -s -i $SITE/api/arcade/status`. Both should return `200` with
   `cache-control: private, no-store` and the same `open`/`reason`.
2. **Outside school hours:** `curl -s -D - -o /dev/null $F/arcade/game/$ID/Build/Gambers-Revenge.wasm.br`
   should return `200`, `content-encoding: br`,
   `content-type: application/wasm`, `content-length: 5556196`.
3. **During school hours (weekday 7:30 AM–2:15 PM), no override:**
   `curl -s -i $F/arcade/game/$ID/index.html` should return `423 Locked` with
   the lock page only. Repeat for `Build/Gambers-Revenge.data.br`. There
   should be no `content-encoding`, and the body should be a few hundred
   bytes, not 14.9 MB.
4. **Override in production:** during school hours, open Admin → ARCADE, enter
   the real code, and press UNLOCK FOR TODAY. The panel shows "Arcade override
   active until 12:00 AM tonight." and step 3 now returns `200`. Press END
   OVERRIDE and step 3 returns `423` again. To check the real midnight
   expiry, set the override in the evening and run step 1 after 12:00 AM:
   `reason` should be `"schedule"`.
5. **Direct Storage is closed** (after the storage rules deploy and bucket
   change): the old `embedUrl` for any game
   (`https://storage.googleapis.com/whrhs-cs-club.firebasestorage.app/games/…/index.html`)
   should return `403`.
6. **First-load time:**

   ```bash
   for f in index.html Build/Gambers-Revenge.loader.js Build/Gambers-Revenge.framework.js.br Build/Gambers-Revenge.wasm.br Build/Gambers-Revenge.data.br; do curl -s -o /dev/null -w "%{time_starttransfer}s first byte, %{time_total}s total  $f\n" "$F/arcade/game/$ID/$f"; done
   ```

   Run it once after the function has been idle for 15+ minutes (cold start)
   and again right after (warm).
