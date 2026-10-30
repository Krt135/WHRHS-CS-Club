# Agent rules

## Credentials and emulators

- Never cat, grep, or print *-debug.log or any file that may contain credentials.
- Emulators run only with --project demo-* and functions/.secret.local present.

  `functions/.secret.local` (git-ignored) holds dummy values for every secret the functions declare (`SENDGRID_API_KEY`). Without it, a logged-in Firebase CLI fetches the real values from Secret Manager. `functions/.env.local` (git-ignored) supplies `SENDGRID_FROM_EMAIL`, which has no default.

## Arcade

- The Arcade is separated from the main site by subdomain at IT's request; there is no school-hours lock.
