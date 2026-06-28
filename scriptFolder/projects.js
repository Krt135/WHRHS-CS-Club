// scriptFolder/projects.js

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('Projects JS loaded!'); // Debug: check if this appears in console

    const reveals = document.querySelectorAll('.reveal');
    
    if (reveals.length === 0) {
        console.log('No .reveal elements found');
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('in');
                // Optional: unobserve after reveal to improve performance
                // observer.unobserve(entry.target);
            }
        });
    }, { 
        threshold: 0.15,
        rootMargin: '0px 0px -50px 0px' // Triggers slightly before element enters viewport
    });

    reveals.forEach(el => observer.observe(el));
});