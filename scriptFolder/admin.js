// 1. Import your shared instances (adjust the relative path to where your file sits)
import { auth, db } from "./firebase.js"; 

// 2. Import only the modular method functions you actually call in this file
import { onAuthStateChanged } from "firebase/auth";
import { ref, onValue, update, remove, get, set } from "firebase/database";

let currentTab = 'approvals';
let unsubscribe = null;
let memberSearch = '';

// 3. STRICT AUTHENTICATION GUARD
onAuthStateChanged(auth, async (user) => {
    if (!user) return window.location.href = "login.html";

    const snap = await get(ref(db, `users/${user.uid}`));
    const userData = snap.val();

    if (!userData || userData.role !== 'exec') {
        alert("ACCESS DENIED: Exec Board authorization required.");
        window.location.href = "account.html";
    } else {
        setupTabs();
        loadData();
    }
});

// ... Keep the rest of your admin.js tabs and rendering logic exactly the same ...

// 2. TAB NAVIGATION
function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            currentTab = e.target.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            loadData();
        });
    });
}

// 3. FETCH DATA BASED ON TAB
function loadData() {
    const content = document.getElementById('tab-content');
    content.innerHTML = `<div class="empty-state">Fetching data from mainframe...</div>`;

    if (unsubscribe) { unsubscribe(); unsubscribe = null; }

    if (currentTab === 'approvals' || currentTab === 'members') {
        unsubscribe = onValue(ref(db, 'users'), (snapshot) => {
            const data = snapshot.val();
            const pendingCount = document.getElementById('count-pending');

            if (!data) return content.innerHTML = `<div class="empty-state">No records found.</div>`;

            const users = Object.entries(data).map(([id, val]) => ({ id, ...val }));
            const pending = users.filter(u => u.status === 'pending');
            pendingCount.innerText = pending.length;

            if (currentTab === 'approvals') renderApprovals(pending, content);
            else renderMembers(users.filter(u => u.status === 'approved'), content);
        });
    } else if (currentTab === 'moderation') {
        unsubscribe = onValue(ref(db, 'deleted_posts'), (snapshot) => {
            const data = snapshot.val();
            if (!data) return content.innerHTML = `<div class="empty-state">Recycling bin is empty.</div>`;
            
            const posts = Object.entries(data).map(([id, val]) => ({ id, ...val }));
            posts.sort((a, b) => (b._deletedAt || 0) - (a._deletedAt || 0));
            renderModeration(posts, content);
        });
    }
}

function escapeHTML(value = '') {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function initialsFor(user) {
    const name = user.displayName || user.email || '?';
    return escapeHTML(name.substring(0, 2).toUpperCase());
}

function roleLabel(user) {
    return escapeHTML((user.role || 'member').toUpperCase());
}

// 4. RENDER APPROVALS
function renderApprovals(list, container) {
    if (!list.length) return container.innerHTML = `<div class="empty-state">No pending approvals.</div>`;
    
    container.innerHTML = list.map(user => `
        <div class="admin-list-item">
            <div class="member-info">
                <div class="member-avatar">${initialsFor(user)}</div>
                <div>
                    <div class="member-name">${escapeHTML(user.displayName || 'Unnamed member')}</div>
                    <div class="member-email">${escapeHTML(user.email || 'No email')}</div>
                </div>
            </div>
            <div class="admin-actions">
                <button class="btn-approve" onclick="window.updateStatus('${user.id}', 'approved')">APPROVE</button>
                <button class="btn-deny" onclick="window.denyUser('${user.id}')">DENY</button>
            </div>
        </div>
    `).join('');
}

// 5. RENDER MEMBERS
function renderMembers(list, container) {
    if (!list.length) return container.innerHTML = `<div class="empty-state">No members found.</div>`;

    const normalizedSearch = memberSearch.trim().toLowerCase();
    const filtered = normalizedSearch
        ? list.filter(user => {
            const searchable = `${user.displayName || ''} ${user.email || ''} ${user.role || ''}`.toLowerCase();
            return searchable.includes(normalizedSearch);
        })
        : list;

    const execs = filtered.filter(user => ['exec', 'admin'].includes(user.role || 'member'));
    const members = filtered.filter(user => !['exec', 'admin'].includes(user.role || 'member'));
    
    container.innerHTML = `
        <input
            id="memberSearch"
            class="member-search"
            type="search"
            placeholder="Search members..."
            value="${escapeHTML(memberSearch)}"
            autocomplete="off"
        >
        <div class="member-groups">
            ${renderMemberSection('EXEC ACCOUNTS', execs, true)}
            ${renderMemberSection('MEMBERS', members, false)}
        </div>
    `;

    const searchInput = document.getElementById('memberSearch');
    searchInput?.addEventListener('input', (event) => {
        memberSearch = event.target.value;
        renderMembers(list, container);
        document.getElementById('memberSearch')?.focus();
    });
}

function renderMemberSection(title, users, isExecSection) {
    return `
        <section class="member-section">
            <h2 class="member-section-title">${title} (${users.length})</h2>
            ${users.length
                ? users.map(user => renderMemberRow(user, isExecSection)).join('')
                : `<div class="empty-state small">No ${title.toLowerCase()} found.</div>`
            }
        </section>
    `;
}

function renderMemberRow(user, isExecSection) {
    const name = escapeHTML(user.displayName || 'Unnamed member');
    const email = escapeHTML(user.email || 'No email');
    const bio = user.bio ? `<div class="member-bio">${escapeHTML(user.bio)}</div>` : '';

    return `
        <div class="admin-list-item member-row">
            <div class="member-info">
                <div class="member-avatar">${initialsFor(user)}</div>
                <div class="member-details">
                    <div class="member-name">${name} <span class="role-pill">${roleLabel(user)}</span></div>
                    <div class="member-email">${email}</div>
                    ${bio}
                </div>
            </div>
            <div class="admin-actions">
                ${isExecSection
                    ? `<button class="btn-neutral" onclick="window.updateRole('${user.id}', 'member')">DEMOTE</button>`
                    : `<button class="btn-approve" onclick="window.updateRole('${user.id}', 'exec')">PROMOTE</button>`
                }
                <button class="btn-deny" onclick="window.removeUser('${user.id}')">REMOVE</button>
            </div>
        </div>
    `;
}

// 6. RENDER MODERATION
function renderModeration(list, container) {
    container.innerHTML = `
        <div class="moderation-summary">
            <span>${list.length} deleted post${list.length === 1 ? '' : 's'} - restore or permanently delete below.</span>
            <button class="btn-deny" onclick="window.deleteAllDeletedPosts()">DELETE ALL</button>
        </div>
        ${list.map(post => renderDeletedPost(post)).join('')}
    `;
}

function renderDeletedPost(post) {
    const source = escapeHTML(post._sourceLabel || post._deletedFrom || 'Unknown');
    const title = escapeHTML(post.title || post.name || 'Untitled');
    const author = escapeHTML(post._deletedBy || 'Unknown exec');
    const deletedAt = post._deletedAt ? new Date(post._deletedAt).toLocaleString() : 'Unknown time';
    const preview = post.content || post.result || post.url || post.meta || '';

    return `
        <div class="deleted-post">
            <div class="deleted-post-main">
                <div class="source-pill">${source}</div>
                <div class="member-name">${title}</div>
                <div class="member-email">Deleted by ${author} - ${escapeHTML(deletedAt)}</div>
                ${preview ? `<div class="deleted-preview">${escapeHTML(preview)}</div>` : ''}
            </div>
            <div class="admin-actions">
                <button class="btn-approve" onclick="window.restorePost('${post.id}')">RESTORE</button>
                <button class="btn-deny" onclick="window.permanentDelete('${post.id}')">DELETE</button>
            </div>
        </div>
    `;
}

// 7. GLOBAL ACTION METHODS
window.updateStatus = (uid, status) => update(ref(db, `users/${uid}`), { status });
window.updateRole = (uid, role) => {
    const action = role === 'exec' ? 'Promote this member to exec?' : 'Demote this exec to member?';
    return confirm(action) && update(ref(db, `users/${uid}`), { role });
};
window.denyUser = (uid) => confirm("Deny and delete request?") && remove(ref(db, `users/${uid}`));
window.removeUser = (uid) => confirm("Remove member permanently?") && remove(ref(db, `users/${uid}`));

window.restorePost = async (id) => {
    const snap = await get(ref(db, `deleted_posts/${id}`));
    const post = snap.val();
    if (!post._deletedFrom || !post._originalId) return alert("Missing restore data.");
    
    const { id: originalStoredId, _deletedFrom, _originalId, _sourceLabel, _deletedAt, _deletedBy, _deletedById, ...data } = post;
    await set(ref(db, `${_deletedFrom}/${_originalId}`), data);
    await remove(ref(db, `deleted_posts/${id}`));
};
window.permanentDelete = (id) => confirm("Permanently delete?") && remove(ref(db, `deleted_posts/${id}`));
window.deleteAllDeletedPosts = () => confirm("Permanently delete every item in moderation?") && remove(ref(db, "deleted_posts"));
