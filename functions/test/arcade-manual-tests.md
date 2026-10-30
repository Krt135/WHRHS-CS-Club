# Arcade: manual tests

Automated tests: `cd functions && npm test` (paths, `.br` headers, blocked
file types, large-file redirects, downloads and review). The steps below
exercise the real function, database rules and Hosting rewrite.

There are two parts:

- **Part A (local emulators)** runs everything against the demo project.
- **Part B (production, after deploy)** checks the live function and site.

---

## Part A: local emulators

### A0. One-time setup

Requires Java 11+ (for the database and storage emulators).

Always run the emulators under the **demo** project `demo-whrhs-cs-club`, which
can't reach production services, and only with `functions/.secret.local`
present. Without it, a logged-in Firebase CLI fetches the real secret values
from Secret Manager. Never print `*-debug.log` (see `AGENTS.md`).

1. Store a dummy value for every secret the functions declare
   (`SENDGRID_API_KEY`), plus `SENDGRID_FROM_EMAIL`, which has no default.
   Both files are git-ignored (`*.local`):

   ```bash
   printf 'SENDGRID_API_KEY=dummy-emulator-key\n' > functions/.secret.local
   printf 'SENDGRID_FROM_EMAIL=emulator@example.invalid\n' > functions/.env.local
   ```

2. Build the site so the Hosting emulator has something to serve, pointing the
   game iframe at the local function:

   ```bash
   VITE_ARCADE_FUNCTION_URL=http://127.0.0.1:5001/demo-whrhs-cs-club/us-central1/arcade npm run build
   ```

3. Start the emulators and leave them running:

   ```bash
   firebase emulators:start --project demo-whrhs-cs-club --only auth,functions,database,storage,hosting
   ```

4. In a second terminal, seed a test game and two test accounts:

   ```bash
   node functions/scripts/arcade-emulator-seed.js
   ```

5. Shortcuts used below:

   ```bash
   F=http://127.0.0.1:5001/demo-whrhs-cs-club/us-central1
   GAME=$F/arcade/game/arcade-test-game
   gm() { curl -s -o /dev/null -w "%{http_code}\n" "$GAME/$1"; }
   tok() { curl -s "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"emulator-pass-123\",\"returnSecureToken\":true}" | node -pe "JSON.parse(require('fs').readFileSync(0)).idToken"; }
   EXEC=$(tok exectest@example.com); MEMBER=$(tok membertest@example.com)
   ```

### A1. Game files serve at any time

| Command | Expected |
|---|---|
| `gm index.html` | `200` |
| `gm Build/game.js.br` | `200` |
| `gm missing.js` | `404` |
| `gm setup.exe` | `404` (blocked type, never looked up) |

### A2. `.br` files keep Content-Encoding

```bash
curl -s -D - -o /dev/null "$GAME/Build/game.js.br"
curl -s "$GAME/Build/game.js.br" | node -e "process.stdin.on('data',d=>console.log(require('zlib').brotliDecompressSync(d).toString()))"
```

Expected: `200`, `content-encoding: br`,
`content-type: application/javascript; charset=utf-8`, and the second
command prints `document.title = 'ARCADE-TEST-GAME-SCRIPT loaded';`.

### A3. Status shim (one release only)

```bash
curl -s -i "$F/arcade/status"
curl -s -i http://127.0.0.1:5000/api/arcade/status
```

Expected for both: `200`, `cache-control: private, no-store`, JSON with
`"open":true,"reason":"schedule","overrideUntil":null`. This route only
exists so pages cached from before the lock was removed keep working; it
goes away next release.

### A4. Windows downloads

The seed adds `arcade-test-download` (approved) and
`arcade-test-download-pending`, each with a tiny zip. Signing a URL needs a
service-account key even in the emulator. Give the emulators a throwaway key
for the demo project, kept **outside the repo** and valid for nothing:

```bash
K=$(mktemp -d); openssl genrsa 2048 2>/dev/null | node -e 'process.stdout.write(JSON.stringify({type:"service_account",project_id:"demo-whrhs-cs-club",private_key_id:"fake",private_key:require("fs").readFileSync(0,"utf8"),client_email:"fake@demo-whrhs-cs-club.iam.gserviceaccount.com",client_id:"0",token_uri:"https://oauth2.googleapis.com/token"}))' > $K/sa.json
GOOGLE_APPLICATION_CREDENTIALS=$K/sa.json firebase emulators:start --project demo-whrhs-cs-club --only auth,functions,database,storage,hosting
dl() { curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "$F/arcade/download/$1"; }
```

The restart clears the emulators, so run the seed again and repeat the
`EXEC=`/`MEMBER=` line from A0 step 5.

| Check | Command | Expected |
|---|---|---|
| Approved | `dl arcade-test-download` | `302` to a URL with `X-Goog-Expires=300` and `response-content-disposition=attachment; filename="Download-Test-approved-windows.zip"` |
| Pending | `dl arcade-test-download-pending` | `404` |
| WebGL game | `dl arcade-test-game` | `404` |
| Exec review | `curl -s -H "Authorization: Bearer $EXEC" "$F/arcade/download/arcade-test-download-pending?review=1"` | `{"url":"..."}` |
| Member review | same with `$MEMBER` | `403` |

Storage rules: as the member, a `build.zip` upload to
`downloads/memberTestUser/{id}/` works once (`application/zip` or
`application/x-zip-compressed`), and a second upload, a delete, a direct read,
another user's folder and other content types are all refused.

### A5. Pages (optional)

Open http://127.0.0.1:5000/projects.html and
`http://127.0.0.1:5000/play.html?id=<a game id>`. The cards always say
"Play →" (or "Download for Windows" for approved downloads), there is no
lock notice, and the play page loads the game. (The pages read game titles
from the production database, so use a real game id for the play page.)

---

## Part B: production, after deploy

```bash
F=https://us-central1-whrhs-cs-club.cloudfunctions.net
SITE=https://whrhs-cs-club.web.app
ID=-P4KwU6SWlzTxRDgS-pj   # Loaded Dice
```

1. **Status shim and rewrite:** `curl -s -i $F/arcade/status` and
   `curl -s -i $SITE/api/arcade/status`. Both should return `200` with
   `cache-control: private, no-store` and `"open":true`.
2. **Game files:** `curl -s -D - -o /dev/null $F/arcade/game/$ID/Build/Gambers-Revenge.wasm.br`
   should return `200`, `content-encoding: br`,
   `content-type: application/wasm`, `content-length: 5556196`, on a
   weekday morning as well as any other time.
3. **Direct Storage is closed** (after the storage rules deploy and bucket
   change): the old `embedUrl` for any game
   (`https://storage.googleapis.com/whrhs-cs-club.firebasestorage.app/games/…/index.html`)
   should return `403`.
4. **First-load time:**

   ```bash
   for f in index.html Build/Gambers-Revenge.loader.js Build/Gambers-Revenge.framework.js.br Build/Gambers-Revenge.wasm.br Build/Gambers-Revenge.data.br; do curl -s -o /dev/null -w "%{time_starttransfer}s first byte, %{time_total}s total  $f\n" "$F/arcade/game/$ID/$f"; done
   ```

   Run it once after the function has been idle for 15+ minutes (cold start)
   and again right after (warm).
5. **Windows downloads** (after a member uploads one and an exec approves it
   in Admin → ARCADE; `DL` is its game id):
   - `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" $F/arcade/download/$DL`
     returns `302` to `https://storage.googleapis.com/...` with
     `X-Goog-Expires=300`. If it returns `500`, the function's service
     account can't sign URLs; see the IAM step in the README.
   - A pending build's id: `404`.
   - `curl -s -o /dev/null -w "%{http_code}\n" "https://firebasestorage.googleapis.com/v0/b/whrhs-cs-club.firebasestorage.app/o/downloads%2F<uid>%2F$DL%2Fbuild.zip?alt=media"`
     returns `403`.
6. **Game details are plain text** (browser, signed in as a test member):
   upload a small external-link game whose "About this game" is
   `<img src=x onerror=alert(1)>` and whose "Known bugs" has two lines. Open
   its play page. The About section shows the tag as literal text, no
   broken image appears, no alert fires, and the two bug lines stay on
   separate lines. Loaded Dice's play page shows no details block at all.
   Delete the test game afterwards. (The emulator seed's
   `arcade-test-game` carries the same description, for pages pointed at
   the emulator.)
7. **Editing details and covers** (browser, a test member's own game):
   - Upload a game with a cover (PNG or JPEG, any size). The modal shows a
     16:10 preview; an SVG or GIF is refused, and so is a file that's still
     over 1 MB as WebP. The card shows the cover with a small engine badge;
     its title, author, delete and play/download row look unchanged.
   - On its play page, **Edit details** appears for the owner and for an
     exec, not for another member or when signed out. Change Known bugs,
     save, reload: the new text shows. Replace the cover and check the
     card updates; tick "Remove the current cover" and check the card goes
     back to the engine panel.
   - An approved download game can still be edited this way and stays
     approved and downloadable.
   - Permanently delete the test game in Admin → Moderation and check
     `covers/<uid>/<id>/` is gone from Storage. Restoring a game instead
     keeps its cover.
