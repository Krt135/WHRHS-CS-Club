# WHRHS-CS-Club
The computer science club repository of their website for WHRHS

To-Do List:

1. Projects Page -- Almost Done
2. About Us Page
3. Events Page -- Done
4. Resources Page -- Done
5. Sponsors Page
6. Account creation and sign in (I will do personally since I have experience) -- Done

If you're adding a page, make sure to use the cs-footer and cs-header tags instead of copy and pasting for the navigation and footer, 
it'll save you time and make adjusting it in the future easier

## Managing sponsors

Sponsors and fundraising live in the Realtime Database and are edited from the **SPONSORS** tab on `admin.html` (only visible to accounts with the `admin` role).

- `sponsors/{id}`: name, tier (`diamond` / `platinum` / `gold` / `silver`), amount, active, websiteUrl, logoUrl, logoPath, createdAt, updatedAt. Logos are uploaded to Storage under `sponsor-logos/`.
- `fundraising/hillshacks2027`: goal, otherRaised. "Raised" is never stored: it is the sum of active sponsors' amounts plus `otherRaised` (money not tied to a sponsor on the board). The percentage is computed from raised / goal.
- Unchecking **Active** (or HIDE) takes a sponsor off the board, out of the arcade splash, and out of the raised total, without deleting the record.
- Diamond sponsors appear on the "Thanks to our sponsors" splash shown for ~3s when any arcade game loads (`scriptFolder/sponsor-splash.js`).
- Storage rules can't read the database, so logo uploads check a `role` claim on the login token. The `onRoleChange` / `refreshRoleClaim` Cloud Functions keep that claim in sync with `users/{uid}/role`.

## Arcade lock (school hours)

The Arcade is locked on weekdays from 7:30 AM to 2:15 PM (America/New_York) and open at all other times and all weekend. The server enforces it, not the browser:

- Uploaded game builds in Storage (`games/{uid}/{gameId}/`) are private. Players get them only through the `arcade` Cloud Function (`functions/arcade.js`), which checks the lock on every file request and answers **423 Locked** with only a lock message, never game bytes.
- Games are served from the Cloud Functions domain (`https://us-central1-whrhs-cs-club.cloudfunctions.net/arcade/game/{gameId}/index.html`), so uploaded game code never runs on the site's own origin.
- `GET /api/arcade/status` (a Hosting rewrite to the same function) tells the Projects page and play page whether to show the lock message.
- **External-link games** (GitHub Pages, etc.) are hosted elsewhere. The site disables their Play links while locked, but anyone with the direct link can still open them.

**Override:** on Admin → ARCADE, an exec or admin enters the override code. The `setArcadeOverride` function checks the caller's role and compares the SHA-256 of the code with the `ARCADE_OVERRIDE_HASH` secret, then stores `arcadeOverride/expiresAt` (next midnight, New York time) in the database. It unlocks the Arcade for every visitor and expires by itself at midnight. Five attempts per exec per hour. The code itself is never stored anywhere, only its hash.

**A game already running when the lock starts keeps running** until the tab is reloaded or closed. Any file it requests after 7:30 AM is refused, and the Projects page disables Play links within a minute. The play page itself checks the lock only when it opens.

### Setup and deploy order

1. Set the hash secret (the code never touches a file or your shell history):
   ```bash
   read -rs CODE && printf '%s' "$CODE" | sha256sum | cut -d' ' -f1; unset CODE
   firebase functions:secrets:set ARCADE_OVERRIDE_HASH   # paste the hash
   ```
   Use a long code (four or more random words). Changing the code later means setting a new hash and redeploying the functions.
2. Deploy the functions and database rules: `firebase deploy --only functions,database`
3. Test the functions in production (status, a game file, the override). See Part B of `functions/test/arcade-manual-tests.md`.
4. Deploy the site: `firebase deploy --only hosting`, then check `https://whrhs-cs-club.web.app/api/arcade/status`.
5. Only after steps 2–4 pass: `firebase deploy --only storage`
6. Remove public access from the bucket: Google Cloud Console → Cloud Storage → `whrhs-cs-club.firebasestorage.app` → Permissions → remove the **allUsers** principal (Storage Object Viewer). Then confirm an old `storage.googleapis.com/...` game URL returns 403. Sponsor logos and lesson files use Firebase download-token URLs and keep working.

Tests: `cd functions && npm test`, plus the manual steps in `functions/test/arcade-manual-tests.md`.
