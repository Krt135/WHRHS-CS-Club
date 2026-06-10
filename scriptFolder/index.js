const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) e.target.classList.add('in');
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.reveal').forEach(el => {
    observer.observe(el);
    if (el.closest('.hero')) el.classList.add('in');
  });

  function updateCountdown() {
    const target = new Date('2026-03-21T11:00:00');
    const diff = target - new Date();
    const el = document.getElementById('days');
    if (!el) return;
    el.textContent = diff <= 0 ? '0' : Math.floor(diff / 86400000);
  }
  updateCountdown();
  setInterval(updateCountdown, 60000);

  const menuBtn = document.getElementById('menu-btn');
  const mobileNav = document.getElementById('mobile-nav');

  if (menuBtn && mobileNav) {
    menuBtn.addEventListener('click', () => {
      mobileNav.classList.toggle('open');
    });

    mobileNav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileNav.classList.remove('open');
      });
    });
  }