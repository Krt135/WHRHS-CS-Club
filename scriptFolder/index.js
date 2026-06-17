import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, get } from "firebase/database";

onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Fetch user records from the mainframe database
        const userSnap = await get(ref(db, `users/${user.uid}`));
        const userData = userSnap.val();

        if (userData && userData.status === "pending") {
            // 🚨 INTERCEPT: Alert them and disconnect their session instantly
            alert("Account Pending: An Executive Board member must approve your access before you can log in.");
            await signOut(auth);
            window.location.href = "index.html"; 
            return;
        }
        
        // Otherwise, proceed to load your normal logged-in user experience...
    }
});

const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) e.target.classList.add('in');
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.reveal').forEach(el => {
    observer.observe(el);
    if (el.closest('.hero')) el.classList.add('in');
  });

  
  //JS for Countdown in index.html
  document.addEventListener("DOMContentLoaded", () => {
    // 1. Grab the HTML element where the number lives
    const daysElement = document.getElementById("days");
    
    // Only run if the element actually exists on this page
    if (daysElement) {
        // 2. Set your exact target date and time
        const targetDate = new Date("March 21, 2027 11:00:00").getTime();

        function updateCountdown() {
            const now = new Date().getTime();
            const difference = targetDate - now;

            if (difference > 0) {
                // Calculate days remaining. Math.ceil ensures that even if there is 
                // 0.5 days left, it says "1d" until the actual morning of the event.
                const daysLeft = Math.ceil(difference / (1000 * 60 * 60 * 24));
                daysElement.textContent = daysLeft;
            } else {
                // Event is happening now or has passed
                daysElement.textContent = "0";
            }
        }

        // 3. Run it immediately when the page loads
        updateCountdown();

        // 4. Update it silently in the background (checks once an hour)
        setInterval(updateCountdown, 1000 * 60 * 60);
    }
});