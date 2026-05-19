/**
 * Theme Toggle Script
 * Handles light/dark mode switching with localStorage persistence
 */

(function() {
    // Initialize theme on page load
    const theme = localStorage.getItem('theme') || 'dark';
    applyTheme(theme);

    // Listen for theme toggle button clicks
    document.addEventListener('DOMContentLoaded', function() {
        const toggleButton = document.querySelector('.theme-toggle');
        if (toggleButton) {
            toggleButton.addEventListener('click', toggleTheme);
        }
    });

    function applyTheme(theme) {
        const isDark = theme === 'dark';
        document.documentElement.setAttribute('data-theme', theme);
        document.body.classList.toggle('light-mode', !isDark);
        localStorage.setItem('theme', theme);
        updateThemeIcon(!isDark);
    }

    function updateThemeIcon(isLight) {
        const icon = document.querySelector('.theme-toggle i');
        if (icon) {
            icon.classList.remove('fa-sun', 'fa-moon');
            icon.classList.add(isLight ? 'fa-moon' : 'fa-sun');
        }
    }
})();

function toggleTheme() {
    const currentTheme = localStorage.getItem('theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    const body = document.body;
    const isDark = newTheme === 'dark';

    // Add transition class for smooth theme change
    body.style.transition = 'background 0.3s ease, color 0.3s ease';

    document.documentElement.setAttribute('data-theme', newTheme);
    body.classList.toggle('light-mode', !isDark);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(!isDark);

    // Remove transition after completion
    setTimeout(() => {
        body.style.transition = '';
    }, 300);
}

function updateThemeIcon(isLight) {
    const icon = document.querySelector('.theme-toggle i');
    if (icon) {
        icon.classList.remove('fa-sun', 'fa-moon');
        icon.classList.add(isLight ? 'fa-moon' : 'fa-sun');
    }
}

// Respect system theme preference if no saved theme
function initSystemTheme() {
    if (!localStorage.getItem('theme')) {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        applyTheme(prefersDark ? 'dark' : 'light');
    }
}

window.addEventListener('load', initSystemTheme);

