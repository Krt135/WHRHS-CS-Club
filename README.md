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
