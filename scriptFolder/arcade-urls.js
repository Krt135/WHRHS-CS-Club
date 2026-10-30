// URLs on the `arcade` Cloud Function (functions/arcade.js), which serves
// uploaded games and Windows download builds from its own origin.

// VITE_ARCADE_FUNCTION_URL points a build at the local emulator for testing.
export const ARCADE_FUNCTION_URL = import.meta.env.VITE_ARCADE_FUNCTION_URL
    || "https://us-central1-whrhs-cs-club.cloudfunctions.net/arcade";

export function arcadeGameUrl(gameId) {
    return `${ARCADE_FUNCTION_URL}/game/${encodeURIComponent(gameId)}/index.html`;
}

// Windows download builds. The function checks approval, then redirects to a
// short-lived signed URL; the Storage path never reaches the page.
// review=true is the exec-only variant (needs an ID token, returns JSON).
export function arcadeDownloadUrl(gameId, review = false) {
    return `${ARCADE_FUNCTION_URL}/download/${encodeURIComponent(gameId)}${review ? "?review=1" : ""}`;
}
