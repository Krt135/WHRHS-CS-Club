// 1. Import your shared instances (adjust the relative path to where your file sits)
import { auth, db } from "./firebase.js"; 

// 2. Import only the modular method functions you actually call in this file
import { onAuthStateChanged } from "firebase/auth";
import { ref, onValue, update, remove, get, set } from "firebase/database";

let currentTab = 'approvals';
let unsubscribe = null;

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
            renderModeration(posts, content);
        });
    }
}

// 4. RENDER APPROVALS
function renderApprovals(list, container) {
    if (!list.length) return container.innerHTML = `<div class="empty-state">No pending approvals.</div>`;
    
    container.innerHTML = list.map(user => `
        <div class="admin-list-item">
            <div class="member-info">
                <div class="member-avatar">${(user.displayName || '?').substring(0,2).toUpperCase()}</div>
                <div>
                    <div class="member-name">${user.displayName}</div>
                    <div class="member-email">${user.email}</div>
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
    
    container.innerHTML = list.map(user => `
        <div class="admin-list-item">
            <div class="member-info">
                <div class="member-avatar">${(user.displayName || '?').substring(0,2).toUpperCase()}</div>
                <div>
                    <div class="member-name">${user.displayName} <span style="color:#ccff00; font-size: 0.8rem;">[${(user.role || 'member').toUpperCase()}]</span></div>
                    <div class="member-email">${user.email}</div>
                </div>
            </div>
            <div class="admin-actions">
                <button class="btn-deny" onclick="window.removeUser('${user.id}')">REMOVE</button>
            </div>
        </div>
    `).join('');
}

// 6. RENDER MODERATION
function renderModeration(list, container) {
    container.innerHTML = list.map(post => `
        <div class="admin-list-item">
            <div class="member-info">
                <div>
                    <div class="member-name">Deleted from: ${post._deletedFrom || 'Unknown'}</div>
                    <div class="member-email">Title: ${post.title || post.name || 'Untitled'}</div>
                </div>
            </div>
            <div class="admin-actions">
                <button class="btn-approve" onclick="window.restorePost('${post.id}')">RESTORE</button>
                <button class="btn-deny" onclick="window.permanentDelete('${post.id}')">DELETE</button>
            </div>
        </div>
    `).join('');
}

// 7. GLOBAL ACTION METHODS
window.updateStatus = (uid, status) => update(ref(db, `users/${uid}`), { status });
window.denyUser = (uid) => confirm("Deny and delete request?") && remove(ref(db, `users/${uid}`));
window.removeUser = (uid) => confirm("Remove member permanently?") && remove(ref(db, `users/${uid}`));

window.restorePost = async (id) => {
    const snap = await get(ref(db, `deleted_posts/${id}`));
    const post = snap.val();
    if (!post._deletedFrom || !post._originalId) return alert("Missing restore data.");
    
    const { _deletedFrom, _originalId, _deletedAt, _deletedBy, _deletedById, ...data } = post;
    await set(ref(db, `${_deletedFrom}/${_originalId}`), data);
    await remove(ref(db, `deleted_posts/${id}`));
};
window.permanentDelete = (id) => confirm("Permanently delete?") && remove(ref(db, `deleted_posts/${id}`));