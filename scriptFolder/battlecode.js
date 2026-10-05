// Battlecode section on events.html (#battlecode).
//
// ── FILL THESE IN ──────────────────────────────────────────────────────────
// Every value below that says "TBA" is a placeholder. Replace it with the real
// info once it's confirmed; anything still "TBA" shows on the page with a
// dashed "placeholder" style so it's easy to spot.
export const BATTLECODE = {
    dates: "TBA",       // e.g. the competition window and any club deadlines
    format: "TBA",      // e.g. online, in person, which tournaments we enter
    teamSize: "TBA",    // e.g. how many students per team
    howToJoin: "TBA",   // e.g. who to talk to, sign-up form, meeting time
    officialUrl: "https://battlecode.org",
};
// ───────────────────────────────────────────────────────────────────────────

const PLACEHOLDER = "TBA";

const DETAILS = [
    { key: "dates", label: "Dates" },
    { key: "format", label: "Format" },
    { key: "teamSize", label: "Team size" },
];

function fillValue(element, value) {
    const text = String(value ?? "").trim() || PLACEHOLDER;
    element.textContent = text;
    element.classList.toggle("is-tba", text === PLACEHOLDER);
}

function render() {
    const list = document.getElementById("bcDetails");
    if (list) {
        list.replaceChildren(...DETAILS.map(({ key, label }) => {
            const row = document.createElement("div");
            row.className = "bc-detail";
            const term = document.createElement("dt");
            term.textContent = label;
            const value = document.createElement("dd");
            fillValue(value, BATTLECODE[key]);
            row.append(term, value);
            return row;
        }));
    }

    const join = document.getElementById("bcJoin");
    if (join) fillValue(join, BATTLECODE.howToJoin);

    const link = document.getElementById("bcOfficialLink");
    if (link) link.href = BATTLECODE.officialUrl;
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render, { once: true });
else render();
