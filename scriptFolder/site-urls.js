// The main site and the Arcade are separate deployments on separate hosts.
// Links within a site stay relative; links to the other site need these.
export const MAIN_SITE_URL = "https://www.whrhs-cs-club.com";

// vite.arcade.config.js sets VITE_SITE_TARGET for the Arcade build.
export const isArcadeBuild = import.meta.env.VITE_SITE_TARGET === "arcade";

export function mainPage(path) {
    return isArcadeBuild ? `${MAIN_SITE_URL}/${path}` : path;
}
