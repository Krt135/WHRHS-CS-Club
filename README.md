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

## Arcade hosting

The Arcade is separated from the main site by subdomain at IT's request. There is no school-hours lock: games can be played and downloaded at any time.

- Uploaded game builds in Storage (`games/{uid}/{gameId}/`) are private. Players get them only through the `arcade` Cloud Function (`functions/arcade.js`).
- Builds may only contain web-build files (html, js, css, wasm, data, unityweb, pck, apk, json, images, audio, fonts, txt/xml/fnt, and `.br`/`.gz` versions), each stored with a Content-Type that fits its extension. `storage.rules` enforces this, and the uploader skips other files. Separately, the function refuses (404) executables, scripts and archives (`exe msi bat cmd com scr ps1 vbs jar dll zip 7z rar`) even in older uploads, so `.exe` files only reach players as reviewed Windows downloads.
- Games are served from the Cloud Functions domain (`https://us-central1-whrhs-cs-club.cloudfunctions.net/arcade/game/{gameId}/index.html`), so uploaded game code never runs on the site's own origin. The pages build these URLs with `scriptFolder/arcade-urls.js`.
- `GET arcade/status` (and the `/api/arcade/status` Hosting rewrite in `firebase.json`) always answers `{"open": true, ...}`. It only exists so pages cached from the lock era keep working. **Remove both in the next release.**

### Setup and deploy order

1. Deploy the functions and database rules: `firebase deploy --only functions,database`
2. Test the functions in production (a game file, a download). See Part B of `functions/test/arcade-manual-tests.md`.
3. Deploy the site: `firebase deploy --only hosting`, then load the Projects page and check that a game plays.
4. Only after steps 1–3 pass: `firebase deploy --only storage`
5. Remove public access from the bucket: Google Cloud Console → Cloud Storage → `whrhs-cs-club.firebasestorage.app` → Permissions → remove the **allUsers** principal (Storage Object Viewer). Then confirm an old `storage.googleapis.com/...` game URL returns 403. Sponsor logos and lesson files use Firebase download-token URLs and keep working.

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

- **Review:** new download games are saved with `status: "pending"` and stay hidden from visitors. Admin → ARCADE lists them with DOWNLOAD TO REVIEW, APPROVE and REJECT. APPROVE stays disabled until that build has been downloaded for review in the same session. Approving and rejecting go through the `approveDownload` callable, which checks the caller's role (with token revocation) and, on approval, records the Storage object's `buildGeneration` and real `fileSize`. The approval only goes through if the object is still the generation the exec downloaded. The database rules don't let any client set `approved` or `buildGeneration`. Execs may still set `rejected` directly. Once a download is approved, its author can only change the About, Credits, Known bugs and cover (see below) or delete it; the title, status and everything execs approved stay as they were. Scan every build with Windows Defender or VirusTotal before approving it.
- **Download:** `GET arcade/download/{id}` returns **404** unless the game is an approved download build whose stored object is still the approved `buildGeneration`, and otherwise redirects (**302**) to a V4 signed URL that expires in 5 minutes and downloads as `<title>-windows.zip`. Execs get pending builds with `?review=1` and their ID token.
- **Storage:** the author can create `build.zip` once. Nobody can read, replace or delete it directly, so an approved build can't be swapped later. The `cleanUpDownloadBuild` function deletes it when the game is permanently deleted from Admin → Moderation. Restoring the game keeps it.
- **Known limits:**
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

### Game details and covers

- **Details:** optional `description` ("About this game", up to 1000 characters), `credits` (300) and `knownBugs` (1000). Empty fields are left out of the record. The database rules require each one, when present, to be a non-empty string within its limit. The play page shows them above the game, as plain text only (`textContent`, `white-space: pre-line`, no markdown or links), including for download games.
- **Cover:** optional, at `covers/{uid}/{id}/cover.webp`. The upload modal accepts PNG, JPEG or WebP (no SVG or GIF), center-crops it in the browser to the card's 16:10 shape (at most 1200×750), re-encodes it as WebP at about 0.8 quality, and refuses anything still 1 MB or more. Covers are public to read, and only the owner can write, replace or delete one (WebP, under 1 MB). The record's `coverUrl` must be that object's Firebase Storage download URL; the rules refuse any other URL. On a card, the cover replaces only the engine panel and keeps a small engine badge; cards without one look as before. Permanently deleting a game from Moderation also deletes its cover (`cleanUpDownloadBuild`); restoring keeps it.
- **Editing:** on the play page, the owner and exec/admin see **Edit details**, which reopens the three fields (and, for the owner, the cover, with an option to remove it). On an existing record the database rules let the owner change only `description`, `credits`, `knownBugs` and `coverUrl`; title, engine, format, platform, status, category, authorUid and the rest stay as they are, and owners can't add other fields. That includes approved downloads, which stay approved. Execs keep their usual powers (still not approving; see Windows downloads). Execs can't change someone else's cover, because Storage only lets the owner write `covers/{uid}/`.
