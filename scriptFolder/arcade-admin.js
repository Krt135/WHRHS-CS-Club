// Arcade admin page (exec and admin): the pending Windows downloads list.
import { onAuthStateChanged } from "firebase/auth";
import { get, ref } from "firebase/database";
import { auth, db } from "./firebase.js";
import { mountArcadeTab } from "./admin-arcade.js";

onAuthStateChanged(auth, async (user) => {
    if (!user) return window.location.href = "login.html";

    const snap = await get(ref(db, `users/${user.uid}`));
    const userData = snap.val();

    if (!userData || !['exec', 'admin'].includes(userData.role)) {
        alert("ACCESS DENIED: Exec Board authorization required.");
        window.location.href = "projects.html";
    } else {
        mountArcadeTab(document.getElementById("arcade-admin-content"));
    }
});
