(function () {
    function getPreferredTheme() {
        const saved = localStorage.getItem('theme');
        if (saved) return saved;
        if (document.body && document.body.classList.contains('student-mode')) return 'light';
        return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }

    function updateThemeIcon(theme) {
        const icon = document.querySelector('.theme-toggle i');
        if (!icon) return;

        icon.classList.remove('fa-sun', 'fa-moon');
        icon.classList.add(theme === 'light' ? 'fa-moon' : 'fa-sun');
    }

    function applyTheme(theme) {
        const isLight = theme === 'light';
        document.documentElement.setAttribute('data-theme', theme);
        document.body.classList.toggle('light-mode', isLight);
        localStorage.setItem('theme', theme);
        updateThemeIcon(theme);
    }

    window.toggleTheme = function toggleTheme() {
        const currentTheme = localStorage.getItem('theme') || getPreferredTheme();
        const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';

        document.body.style.transition = 'background 0.3s ease, color 0.3s ease';
        applyTheme(nextTheme);

        setTimeout(() => {
            document.body.style.transition = '';
        }, 300);
    };

    document.addEventListener('DOMContentLoaded', () => {
        applyTheme(getPreferredTheme());

        const toggleButton = document.querySelector('.theme-toggle');
        if (toggleButton) toggleButton.addEventListener('click', window.toggleTheme);
    });
})();
