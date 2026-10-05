// SPONSORS tab of the admin panel (admin role only): add, edit, hide and
// remove sponsors, upload their logos, and set the fundraising goal.
import { auth, db, storage } from "./firebase.js";
import { getFunctions, httpsCallable } from "firebase/functions";
import { get, onValue, push, ref, remove, set, update } from "firebase/database";
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import {
    DEFAULT_GOAL,
    FUNDRAISING_PATH,
    SPONSOR_TIERS,
    computeProgress,
    escapeHTML,
    formatCurrency,
    groupByTier,
    safeUrl,
    snapshotToSponsors,
} from "./sponsor-data.js";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
// Where the old exec slider stored progress, used to prefill "Other raised".
const LEGACY_PROGRESS_PATH = "siteSettings/fundraisingProgress";

// Storage rules check a `role` claim on the auth token (see storage.rules).
// Make sure it's there before touching sponsor-logos/.
async function ensureAdminClaim() {
    const user = auth.currentUser;
    if ((await user.getIdTokenResult()).claims.role === "admin") return;

    await httpsCallable(getFunctions(auth.app), "refreshRoleClaim")();
    if ((await user.getIdTokenResult(true)).claims.role !== "admin") {
        throw new Error("Your login token doesn't have the admin role yet. Sign out and back in, then try again.");
    }
}

async function deleteLogo(path) {
    if (!path) return;
    try {
        await ensureAdminClaim();
        await deleteObject(storageRef(storage, path));
    } catch (error) {
        // An orphaned logo file is harmless; don't fail the whole action over it.
        console.warn(`Could not delete old logo ${path}:`, error);
    }
}

function fileExtension(file) {
    const fromName = file.name.includes(".") ? file.name.split(".").pop() : "";
    return (fromName || file.type.split("/").pop() || "img").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
}

const tierOptions = SPONSOR_TIERS
    .map(tier => `<option value="${tier.id}">${tier.label} — $${tier.price}</option>`)
    .join("");

export function mountSponsorsTab(container) {
    container.innerHTML = `
        <div class="sponsor-admin">
            <section class="admin-panel">
                <h2 class="member-section-title">FUNDRAISING · HILLSHACKS 2027</h2>
                <form id="fundraisingForm" class="admin-form">
                    <label>Goal ($)<input name="goal" type="number" min="1" step="1" required></label>
                    <label>Other raised ($)<input name="otherRaised" type="number" min="0" step="1" value="0">
                        <small>Money that isn't from a sponsor on the board (e.g. anonymous gifts).</small></label>
                    <p class="admin-summary" id="fundraisingSummary"></p>
                    <div class="admin-actions"><button type="submit" class="btn-approve">SAVE FUNDRAISING</button></div>
                    <p class="admin-form-status" id="fundraisingStatus" aria-live="polite"></p>
                </form>
            </section>

            <section class="admin-panel">
                <h2 class="member-section-title" id="sponsorFormTitle">ADD SPONSOR</h2>
                <form id="sponsorForm" class="admin-form">
                    <label>Name<input name="name" maxlength="100" required></label>
                    <label>Tier<select name="tier">${tierOptions}</select></label>
                    <label>Amount ($)<input name="amount" type="number" min="0" step="1" required></label>
                    <label>Website<input name="websiteUrl" type="url" placeholder="https://example.com"></label>
                    <label class="admin-form-wide">Logo<input name="logo" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif">
                        <small>PNG, JPG, SVG or WebP under 2 MB. Shown on the board for Platinum and Diamond, and on the arcade splash for Diamond.</small></label>
                    <div class="admin-form-wide" id="logoPreview"></div>
                    <label class="admin-check admin-form-wide"><input name="active" type="checkbox" checked> Active: shown on the site and counted toward the goal</label>
                    <div class="admin-actions admin-form-wide">
                        <button type="submit" class="btn-approve">SAVE SPONSOR</button>
                        <button type="button" class="btn-neutral" id="sponsorFormCancel" hidden>CANCEL EDIT</button>
                    </div>
                    <p class="admin-form-status admin-form-wide" id="sponsorStatus" aria-live="polite"></p>
                </form>
            </section>

            <div class="member-groups" id="sponsorList"><div class="empty-state">Loading sponsors...</div></div>
        </div>
    `;

    const fundraisingForm = container.querySelector("#fundraisingForm");
    const fundraisingSummary = container.querySelector("#fundraisingSummary");
    const fundraisingStatus = container.querySelector("#fundraisingStatus");
    const sponsorForm = container.querySelector("#sponsorForm");
    const sponsorFormTitle = container.querySelector("#sponsorFormTitle");
    const sponsorFormCancel = container.querySelector("#sponsorFormCancel");
    const sponsorStatus = container.querySelector("#sponsorStatus");
    const logoPreview = container.querySelector("#logoPreview");
    const sponsorList = container.querySelector("#sponsorList");
    const fundraisingFields = fundraisingForm.elements;
    const sponsorFields = sponsorForm.elements;

    let sponsors = [];
    let fundraisingLoaded = false;
    let fundraisingDirty = false;
    let editingId = null;
    let removeLogo = false;

    // ---------- FUNDRAISING ----------

    const formFundraising = () => ({
        goal: Number(fundraisingFields.goal.value),
        otherRaised: Number(fundraisingFields.otherRaised.value) || 0,
    });

    const renderSummary = () => {
        const { goal, raised, sponsorTotal, otherRaised, percent } = computeProgress(sponsors, formFundraising());
        fundraisingSummary.textContent =
            `${formatCurrency(sponsorTotal)} from active sponsors + ${formatCurrency(otherRaised)} other = ` +
            `${formatCurrency(raised)} raised · ${percent}% of ${formatCurrency(goal)}`;
    };

    const fillFundraising = async (data) => {
        if (fundraisingDirty) return;
        if (data) {
            fundraisingFields.goal.value = data.goal;
            fundraisingFields.otherRaised.value = data.otherRaised || 0;
        } else if (!fundraisingLoaded) {
            const legacy = Number((await get(ref(db, LEGACY_PROGRESS_PATH))).val()) || 0;
            fundraisingFields.goal.value = DEFAULT_GOAL;
            fundraisingFields.otherRaised.value = legacy;
            fundraisingStatus.textContent = legacy
                ? `Not saved yet. "Other raised" is prefilled with the old progress value (${formatCurrency(legacy)}); lower it as you add sponsors who are part of that total.`
                : "Not saved yet. The public pages use a $1,500 goal until you save.";
        }
        fundraisingLoaded = true;
        renderSummary();
    };

    fundraisingForm.addEventListener("input", () => {
        fundraisingDirty = true;
        renderSummary();
    });

    fundraisingForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const { goal, otherRaised } = formFundraising();
        if (!(goal > 0) || otherRaised < 0) {
            fundraisingStatus.textContent = "Goal must be above $0 and other raised can't be negative.";
            return;
        }
        fundraisingStatus.textContent = "Saving...";
        try {
            await set(ref(db, FUNDRAISING_PATH), { goal, otherRaised, updatedAt: Date.now() });
            fundraisingDirty = false;
            fundraisingStatus.textContent = "Saved. The Sponsors and home pages update live.";
        } catch (error) {
            console.error("Unable to save fundraising:", error);
            fundraisingStatus.textContent = "Could not save. Check that your account has the admin role.";
        }
    });

    // ---------- SPONSOR FORM ----------

    const renderLogoPreview = (sponsor) => {
        const logo = !removeLogo && safeUrl(sponsor?.logoUrl);
        logoPreview.innerHTML = logo
            ? `<div class="sponsor-logo-current">
                   <img src="${escapeHTML(logo)}" alt="Current logo">
                   <div class="admin-actions"><button type="button" class="btn-deny" data-action="remove-logo">REMOVE LOGO</button></div>
               </div>`
            : "";
    };

    const resetSponsorForm = () => {
        editingId = null;
        removeLogo = false;
        sponsorForm.reset();
        sponsorFormTitle.textContent = "ADD SPONSOR";
        sponsorFormCancel.hidden = true;
        renderLogoPreview(null);
    };

    const startEditing = (sponsor) => {
        editingId = sponsor.id;
        removeLogo = false;
        sponsorFields.name.value = sponsor.name || "";
        sponsorFields.tier.value = sponsor.tier || "silver";
        sponsorFields.amount.value = sponsor.amount ?? "";
        sponsorFields.websiteUrl.value = sponsor.websiteUrl || "";
        sponsorFields.logo.value = "";
        sponsorFields.active.checked = sponsor.active === true;
        sponsorFormTitle.textContent = `EDIT SPONSOR · ${sponsor.name || "Untitled"}`;
        sponsorFormCancel.hidden = false;
        sponsorStatus.textContent = "";
        renderLogoPreview(sponsor);
        sponsorForm.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    sponsorFormCancel.addEventListener("click", () => {
        resetSponsorForm();
        sponsorStatus.textContent = "";
    });

    logoPreview.addEventListener("click", (event) => {
        if (event.target.closest('[data-action="remove-logo"]')) {
            removeLogo = true;
            renderLogoPreview(null);
            sponsorStatus.textContent = "Logo will be removed when you save.";
        }
    });

    sponsorForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const name = sponsorFields.name.value.trim();
        const amount = Number(sponsorFields.amount.value);
        const websiteInput = sponsorFields.websiteUrl.value.trim();
        const websiteUrl = websiteInput ? safeUrl(websiteInput) : "";
        const file = sponsorFields.logo.files[0];

        if (!name) return (sponsorStatus.textContent = "Name is required.");
        if (!(amount >= 0)) return (sponsorStatus.textContent = "Amount must be $0 or more.");
        if (websiteInput && !websiteUrl) return (sponsorStatus.textContent = "Website must start with http:// or https://");
        if (file && !file.type.startsWith("image/")) return (sponsorStatus.textContent = "Logo must be an image file.");
        if (file && file.size >= MAX_LOGO_BYTES) return (sponsorStatus.textContent = "Logo must be under 2 MB.");

        const submitButton = sponsorForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        sponsorStatus.textContent = "Saving...";

        try {
            const id = editingId || push(ref(db, "sponsors")).key;
            const existing = sponsors.find(sponsor => sponsor.id === id);
            const now = Date.now();
            const record = {
                name,
                tier: sponsorFields.tier.value,
                amount,
                active: sponsorFields.active.checked,
                websiteUrl,
                logoUrl: removeLogo ? "" : existing?.logoUrl || "",
                logoPath: removeLogo ? "" : existing?.logoPath || "",
                createdAt: existing?.createdAt || now,
                updatedAt: now,
            };

            if (file) {
                sponsorStatus.textContent = "Uploading logo...";
                await ensureAdminClaim();
                const path = `sponsor-logos/${id}-${now}.${fileExtension(file)}`;
                const logoRef = storageRef(storage, path);
                await uploadBytes(logoRef, file, { contentType: file.type, cacheControl: "public, max-age=31536000" });
                record.logoUrl = await getDownloadURL(logoRef);
                record.logoPath = path;
            }

            await set(ref(db, `sponsors/${id}`), record);

            // Only clean up the old file once the record no longer points at it.
            if (existing?.logoPath && existing.logoPath !== record.logoPath) await deleteLogo(existing.logoPath);

            sponsorStatus.textContent = `${existing ? "Updated" : "Added"} ${name}.`;
            resetSponsorForm();
        } catch (error) {
            console.error("Unable to save sponsor:", error);
            sponsorStatus.textContent = `Could not save: ${error.message}`;
        } finally {
            submitButton.disabled = false;
        }
    });

    // ---------- SPONSOR LIST ----------

    const renderSponsorRow = (sponsor) => {
        const logo = safeUrl(sponsor.logoUrl);
        const website = safeUrl(sponsor.websiteUrl);
        const avatar = logo
            ? `<div class="member-avatar sponsor-logo-thumb"><img src="${escapeHTML(logo)}" alt=""></div>`
            : `<div class="member-avatar">${escapeHTML((sponsor.name || "?").substring(0, 2).toUpperCase())}</div>`;

        return `
            <div class="admin-list-item member-row${sponsor.active ? "" : " is-inactive"}">
                <div class="member-info">
                    ${avatar}
                    <div class="member-details">
                        <div class="member-name">${escapeHTML(sponsor.name)}
                            ${sponsor.active ? "" : '<span class="role-pill">HIDDEN</span>'}</div>
                        <div class="member-email">${formatCurrency(sponsor.amount)}${website ? ` · ${escapeHTML(website)}` : ""}</div>
                    </div>
                </div>
                <div class="admin-actions">
                    <button class="btn-neutral" data-action="edit" data-id="${sponsor.id}">EDIT</button>
                    <button class="btn-neutral" data-action="toggle" data-id="${sponsor.id}">${sponsor.active ? "HIDE" : "SHOW"}</button>
                    <button class="btn-deny" data-action="remove" data-id="${sponsor.id}">REMOVE</button>
                </div>
            </div>
        `;
    };

    const renderList = () => {
        if (!sponsors.length) {
            sponsorList.innerHTML = `<div class="empty-state">No sponsors yet. Add your first one above.</div>`;
            return;
        }
        sponsorList.innerHTML = groupByTier(sponsors).map(tier => `
            <section class="member-section">
                <h2 class="member-section-title">${tier.label.toUpperCase()} (${tier.sponsors.length})</h2>
                ${tier.sponsors.length
                    ? tier.sponsors.map(renderSponsorRow).join("")
                    : `<div class="empty-state small">No ${tier.label} sponsors.</div>`}
            </section>
        `).join("");
    };

    sponsorList.addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-action]");
        const sponsor = button && sponsors.find(item => item.id === button.dataset.id);
        if (!sponsor) return;

        try {
            if (button.dataset.action === "edit") {
                startEditing(sponsor);
            } else if (button.dataset.action === "toggle") {
                await update(ref(db, `sponsors/${sponsor.id}`), { active: !sponsor.active, updatedAt: Date.now() });
            } else if (button.dataset.action === "remove") {
                if (!confirm(`Remove ${sponsor.name} permanently? To take them off the site but keep the record, use HIDE instead.`)) return;
                await remove(ref(db, `sponsors/${sponsor.id}`));
                await deleteLogo(sponsor.logoPath);
                if (editingId === sponsor.id) resetSponsorForm();
            }
        } catch (error) {
            console.error("Sponsor action failed:", error);
            alert(`Could not update sponsor: ${error.message}`);
        }
    });

    // ---------- LIVE DATA ----------

    const stopSponsors = onValue(ref(db, "sponsors"), (snapshot) => {
        sponsors = snapshotToSponsors(snapshot);
        renderList();
        if (fundraisingLoaded) renderSummary();
    }, (error) => {
        console.error("Unable to load sponsors:", error);
        sponsorList.innerHTML = `<div class="empty-state">Could not load sponsors. Check that your account has the admin role and the database rules are deployed.</div>`;
    });

    const stopFundraising = onValue(ref(db, FUNDRAISING_PATH), (snapshot) => {
        fillFundraising(snapshot.val()).catch(error => console.error("Unable to load fundraising:", error));
    }, (error) => console.error("Unable to load fundraising:", error));

    return () => {
        stopSponsors();
        stopFundraising();
    };
}
