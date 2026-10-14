// ARCADE tab of the admin panel (exec and admin): unlock the Arcade for
// everyone until midnight with the override code, or end an override early.
// The setArcadeOverride function checks the caller's role and the code's
// SHA-256 hash on the server (functions/arcade.js); nothing about the code
// lives in this file.
import { auth } from "./firebase.js";
import { getFunctions, httpsCallable } from "firebase/functions";
import { fetchArcadeStatus, CHECKING_MESSAGE, UNREACHABLE_MESSAGE } from "./arcade-lock.js";

const OVERRIDE_ACTIVE_MESSAGE = "Arcade override active until 12:00 AM tonight.";

function describe(status) {
    if (status.reason === "override") return OVERRIDE_ACTIVE_MESSAGE;
    if (!status.open) return "The Arcade is locked for school hours (weekdays 7:30 AM – 2:15 PM). No override is active.";
    return "The Arcade is open. No override is active.";
}

export function mountArcadeTab(container) {
    container.innerHTML = `
        <div class="sponsor-admin">
            <section class="admin-panel">
                <h2 class="member-section-title">ARCADE · SCHOOL-HOURS LOCK</h2>
                <p class="admin-summary" id="arcadeSummary" aria-live="polite">${CHECKING_MESSAGE}</p>
                <form id="arcadeOverrideForm" class="admin-form" autocomplete="off">
                    <label class="admin-form-wide">Override code<input name="code" type="password" maxlength="200" autocomplete="off" required>
                        <small>Unlocks the Arcade for every visitor until 12:00 AM tonight (New York time). It turns off by itself at midnight.</small></label>
                    <div class="admin-actions">
                        <button type="submit" class="btn-approve">UNLOCK FOR TODAY</button>
                        <button type="button" class="btn-neutral" id="arcadeOverrideEnd" hidden>END OVERRIDE</button>
                    </div>
                    <p class="admin-form-status" id="arcadeOverrideStatus" aria-live="polite"></p>
                </form>
            </section>
        </div>
    `;

    const summary = container.querySelector("#arcadeSummary");
    const form = container.querySelector("#arcadeOverrideForm");
    const endBtn = container.querySelector("#arcadeOverrideEnd");
    const formStatus = container.querySelector("#arcadeOverrideStatus");
    const setArcadeOverride = httpsCallable(getFunctions(auth.app), "setArcadeOverride");
    let mounted = true;

    const refresh = async () => {
        try {
            const status = await fetchArcadeStatus();
            if (!mounted) return;
            summary.textContent = describe(status);
            endBtn.hidden = status.reason !== "override";
        } catch (error) {
            console.error("Arcade status unavailable:", error);
            if (mounted) summary.textContent = UNREACHABLE_MESSAGE;
        }
    };

    const run = async (data, pending, done) => {
        const buttons = form.querySelectorAll("button");
        buttons.forEach((b) => { b.disabled = true; });
        formStatus.textContent = pending;
        try {
            await setArcadeOverride(data);
            if (!mounted) return;
            formStatus.textContent = done;
            form.elements.code.value = "";
        } catch (error) {
            console.error("Arcade override failed:", error);
            if (mounted) formStatus.textContent = error.message || "Something went wrong. Try again.";
        } finally {
            buttons.forEach((b) => { b.disabled = false; });
            if (mounted) refresh();
        }
    };

    form.addEventListener("submit", (e) => {
        e.preventDefault();
        const code = form.elements.code.value.trim();
        if (!code) return;
        run({ code }, "Checking code...", OVERRIDE_ACTIVE_MESSAGE);
    });

    endBtn.addEventListener("click", () => {
        if (!confirm("End the override? The Arcade will follow the school-hours schedule again.")) return;
        run({ action: "clear" }, "Ending override...", "Override ended.");
    });

    refresh();
    return () => { mounted = false; };
}
