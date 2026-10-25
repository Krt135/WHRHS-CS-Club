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
- `GET https://us-central1-whrhs-cs-club.cloudfunctions.net/arcade/status` tells the Projects page and play page whether to show the lock message. The pages call the function URL directly (`scriptFolder/arcade-lock.js`), because the `/api/arcade/status` Hosting rewrite doesn't exist on Vercel. The rewrite still works on Firebase Hosting.
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
4. Deploy the site: `firebase deploy --only hosting`, then load the Projects page and check that the lock notice matches `https://us-central1-whrhs-cs-club.cloudfunctions.net/arcade/status`.
5. Only after steps 2–4 pass: `firebase deploy --only storage`
6. Remove public access from the bucket: Google Cloud Console → Cloud Storage → `whrhs-cs-club.firebasestorage.app` → Permissions → remove the **allUsers** principal (Storage Object Viewer). Then confirm an old `storage.googleapis.com/...` game URL returns 403. Sponsor logos and lesson files use Firebase download-token URLs and keep working.

Tests: `cd functions && npm test`, plus the manual steps in `functions/test/arcade-manual-tests.md`. Run the emulators only under `--project demo-whrhs-cs-club`, with dummy secrets in `functions/.secret.local` (see `AGENTS.md`).

## Arcade deployment formats

Each game record in `games/{id}` stores `format`:

| `format` | What's stored | How it's played |
|---|---|---|
| `webgl` | Unzipped build in `games/{uid}/{id}/` (private) | In the browser, through `arcade/game/{id}/…` |
| `external` | An `https://` link (`embedUrl`) | The link loads in the play page |
| `download` | One zip at `downloads/{uid}/{id}/build.zip` (private), plus `platform: "windows"`, `fileSize`, `status` | Downloaded and run on Windows |

Records from before `format` existed are read as `webgl` when `type` is `"game"` and `external` otherwise (`scriptFolder/arcade-games.js`), so older games need no migration. Engines are stored as `unity`, `godot`, `phaser`, `pygame` or `other`; older values like `"Unity"` or `"JSCanvas"` are normalized when read, and anything unknown shows as Other / Web.

### Windows downloads

Use this when a game can't run in a browser, for example a Godot .NET (C#) project, which has no Web export. The member zips the whole Windows export folder (the `.exe` plus its data folder or `.pck`), up to 500 MB.

- **Review:** new download games are saved with `status: "pending"` and stay hidden from visitors. Admin → ARCADE lists them with DOWNLOAD TO REVIEW, APPROVE and REJECT. APPROVE stays disabled until that build has been downloaded for review in the same session. Approving and rejecting go through the `approveDownload` callable, which checks the caller's role (with token revocation) and, on approval, records the Storage object's `buildGeneration` and real `fileSize`. The approval only goes through if the object is still the generation the exec downloaded. The database rules don't let any client set `approved` or `buildGeneration`. Execs may still set `rejected` directly. Scan every build with Windows Defender or VirusTotal before approving it.
- **Download:** `GET arcade/download/{id}` checks the school-hours lock first (**423**, no URL). It then returns **404** unless the game is an approved download build whose stored object is still the approved `buildGeneration`, and otherwise redirects (**302**) to a V4 signed URL that expires in 5 minutes and downloads as `<title>-windows.zip`. Execs get pending builds with `?review=1` and their ID token; that still returns 423 during school hours unless the override is on.
- **Storage:** the author can create `build.zip` once. Nobody can read, replace or delete it directly, so an approved build can't be swapped later. The `cleanUpDownloadBuild` function deletes it when the game is permanently deleted from Admin → Moderation. Restoring the game keeps it.
- **Known limits:**
  - Once a build is downloaded, the school-hours lock can't apply to it.
  - A signed URL issued just before 7:30 AM stays valid for up to 5 minutes.
  - Windows may show a SmartScreen "unknown publisher" warning, and school computers may block downloads or `.exe` files.

**Signing setup (one time, before the first download):** the function signs URLs as its runtime service account. The account is the default compute service account, since the `arcade` function doesn't set `serviceAccount`. It needs permission to sign as itself:

```bash
gcloud services enable iamcredentials.googleapis.com --project=whrhs-cs-club
gcloud iam service-accounts add-iam-policy-binding \
  110216471172-compute@developer.gserviceaccount.com \
  --member="serviceAccount:110216471172-compute@developer.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project=whrhs-cs-club
```

Check the account first with `gcloud functions describe arcade --region=us-central1 --project=whrhs-cs-club --format="value(serviceConfig.serviceAccountEmail)"`. If it prints a different account, use that one in both places. Without this, `/download` returns 500.
