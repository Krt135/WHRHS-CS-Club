// Arcade lock: the server decides whether games can be played (weekday school
// hours in New York, or an exec override until midnight). See
// functions/arcade.js. Pages only display what the server says; the game
// files themselves are refused by the server while locked.

// VITE_ARCADE_FUNCTION_URL points a build at the local emulator for testing.
export const ARCADE_FUNCTION_URL = import.meta.env.VITE_ARCADE_FUNCTION_URL
    || "https://us-central1-whrhs-cs-club.cloudfunctions.net/arcade";

// Firebase Hosting rewrites /api/arcade/status to the function. The Vite dev
// server has no rewrites, so it calls the function directly.
const STATUS_URL = import.meta.env.DEV ? `${ARCADE_FUNCTION_URL}/status` : "/api/arcade/status";

export const LOCK_MESSAGE = "The Arcade is restricted during school hours and cannot be played right now. It unlocks at 2:15 PM on school days.";
export const CHECKING_MESSAGE = "Checking Arcade status…";
export const UNREACHABLE_MESSAGE = "Couldn't reach the Arcade server. Try again in a moment.";

// Resolves to {open, reason, overrideUntil, serverTime}; throws when the
// server can't be reached, and callers treat that as locked.
export async function fetchArcadeStatus() {
    const res = await fetch(STATUS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Arcade status HTTP ${res.status}`);
    const status = await res.json();
    if (typeof status.open !== "boolean") throw new Error("Malformed Arcade status");
    return status;
}

export function arcadeGameUrl(gameId) {
    return `${ARCADE_FUNCTION_URL}/game/${encodeURIComponent(gameId)}/index.html`;
}
