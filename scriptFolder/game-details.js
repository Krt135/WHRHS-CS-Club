// Optional Arcade game details: what the game is, who helped, known bugs.
// Shared by the upload modal (projects.js) and the play page (play.js).
// No Firebase imports, so the rules tests can use it too.
//
// The limits are also enforced in database.rules.json (games/$gameId).

export const DETAIL_FIELDS = [
    { key: "description", label: "About", max: 1000 },
    { key: "credits", label: "Credits", max: 300 },
    { key: "knownBugs", label: "Known bugs", max: 1000 },
];

// Trimmed values keyed by field; empty fields are null, so they're saved as
// absent rather than as empty strings. Over-long values are cut to the
// limit (textareas have maxlength, so this only matters if that's bypassed).
export function cleanDetails(raw) {
    const out = {};
    for (const { key, max } of DETAIL_FIELDS) {
        const value = String(raw?.[key] ?? "").trim().slice(0, max);
        out[key] = value || null;
    }
    return out;
}

// Only the fields that have a value, for spreading into a new record.
export function presentDetails(details) {
    return Object.fromEntries(Object.entries(details).filter(([, v]) => v !== null));
}

// Live "123 / 1000" counter under a textarea.
export function attachCounter(textarea, output, max) {
    const update = () => { output.textContent = `${textarea.value.length} / ${max}`; };
    textarea.addEventListener("input", update);
    update();
    return update;
}

// Fills `container` with a section per present field. Text only: values go
// in through textContent, never innerHTML, and line breaks are kept by CSS
// (white-space: pre-line). Hides the container when there's nothing.
export function renderDetails(container, game) {
    if (!container) return;
    container.replaceChildren();
    for (const { key, label } of DETAIL_FIELDS) {
        const value = typeof game?.[key] === "string" ? game[key].trim() : "";
        if (!value) continue;
        const section = document.createElement("section");
        section.className = "play-details-section";
        const heading = document.createElement("h2");
        heading.className = "play-details-label";
        heading.textContent = label;
        const body = document.createElement("p");
        body.className = "play-details-text";
        body.textContent = value;
        section.append(heading, body);
        container.append(section);
    }
    container.hidden = container.childElementCount === 0;
}
