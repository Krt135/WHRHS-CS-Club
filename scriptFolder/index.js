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

  document.getElementById('menu-btn').addEventListener('click', () => {
    document.getElementById('mobile-nav').classList.toggle('open');
  });

  document.querySelectorAll('.mobile-nav a').forEach(link => {
    link.addEventListener('click', () => {
      document.getElementById('mobile-nav').classList.remove('open');
    });
  });