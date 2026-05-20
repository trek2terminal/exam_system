// UI Interactions Module
// Theme toggle, toast notifications, and other UI enhancements

// Theme Management
function toggleTheme() {
    const body = document.body;
    const themeToggle = document.querySelector('.theme-toggle');
    
    body.classList.toggle('light-mode');
    
    if (body.classList.contains('light-mode')) {
        themeToggle.textContent = '☀️';
        localStorage.setItem('theme', 'light');
    } else {
        themeToggle.textContent = '🌙';
        localStorage.setItem('theme', 'dark');
    }
}

// Load saved theme on page load
function loadTheme() {
    const savedTheme = localStorage.getItem('theme');
    const themeToggle = document.querySelector('.theme-toggle');
    
    if (savedTheme === 'light') {
        document.body.classList.add('light-mode');
        if (themeToggle) themeToggle.textContent = '☀️';
    }
}

// Toast Notifications
function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span>${getToastIcon(type)}</span>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function getToastIcon(type) {
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };
    return icons[type] || icons.info;
}

// Flash messages rendered after redirects
function initFlashAutoDismiss() {
    const messages = document.querySelectorAll('.flash-message');

    messages.forEach((message, index) => {
        const isImportant = message.classList.contains('flash-danger') || message.classList.contains('flash-warning');
        const delay = (isImportant ? 4500 : 2600) + (index * 180);

        setTimeout(() => {
            message.classList.add('flash-hiding');
            setTimeout(() => {
                message.remove();

                const stack = document.querySelector('.flash-stack');
                if (stack && !stack.querySelector('.flash-message')) {
                    stack.remove();
                }
            }, 320);
        }, delay);
    });
}

// Auto-save indicator
function updateAutoSaveStatus(status) {
    const indicator = document.querySelector('.auto-save-indicator');
    if (!indicator) return;
    
    indicator.classList.remove('saving', 'saved');
    
    if (status === 'saving') {
        indicator.classList.add('saving');
        indicator.innerHTML = '💾 Saving...';
    } else if (status === 'saved') {
        indicator.classList.add('saved');
        indicator.innerHTML = '✓ Saved';
        setTimeout(() => {
            indicator.classList.remove('saved');
            indicator.innerHTML = '';
        }, 2000);
    }
}

// Word counter for text areas
function initWordCounter(textarea, maxLength) {
    const counter = document.createElement('div');
    counter.className = 'word-counter';
    textarea.parentNode.insertBefore(counter, textarea.nextSibling);
    
    function updateCount() {
        const length = textarea.value.length;
        const remaining = maxLength - length;
        
        counter.textContent = `${length}/${maxLength} characters`;
        
        counter.classList.remove('warning', 'danger');
        
        if (remaining < 50) {
            counter.classList.add('danger');
        } else if (remaining < 100) {
            counter.classList.add('warning');
        }
    }
    
    textarea.addEventListener('input', updateCount);
    updateCount();
}

// Question palette management
function initQuestionPalette(totalQuestions) {
    const palette = document.createElement('div');
    palette.className = 'question-palette';
    palette.id = 'questionPalette';
    
    for (let i = 1; i <= totalQuestions; i++) {
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.textContent = i;
        item.dataset.question = i;
        item.onclick = () => scrollToQuestion(i);
        palette.appendChild(item);
    }
    
    return palette;
}

function updatePaletteStatus(questionNum, status) {
    const item = document.querySelector(`.palette-item[data-question="${questionNum}"]`);
    if (!item) return;
    
    item.classList.remove('answered', 'review', 'current', 'visited');
    
    if (status) {
        item.classList.add(status);
    }
}

function scrollToQuestion(questionNum) {
    const question = document.querySelector(`[data-question-number="${questionNum}"]`);
    if (question) {
        question.scrollIntoView({ behavior: 'smooth', block: 'center' });
        updatePaletteStatus(questionNum, 'current');
    }
}

// Timer color coding
function updateTimerColor(remainingSeconds, totalSeconds) {
    const timerBox = document.querySelector('.timer-box');
    if (!timerBox) return;
    
    const percentage = (remainingSeconds / totalSeconds) * 100;
    
    timerBox.classList.remove('warning', 'danger');
    
    if (percentage <= 10) {
        timerBox.classList.add('danger');
    } else if (percentage <= 25) {
        timerBox.classList.add('warning');
    }
}

// Modal management
function openModal(content) {
    let overlay = document.querySelector('.modal-overlay');
    
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h3>Confirm</h3>
                    <button class="modal-close" onclick="closeModal()">✕</button>
                </div>
                <div class="modal-body"></div>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    
    overlay.querySelector('.modal-body').innerHTML = content;
    overlay.classList.add('active');
}

function closeModal() {
    const overlay = document.querySelector('.modal-overlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
}

// Dropdown management
function initDropdown(button) {
    const dropdown = button.closest('.dropdown');
    const menu = dropdown.querySelector('.dropdown-menu');
    
    button.onclick = (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('active');
    };
    
    document.onclick = () => {
        dropdown.classList.remove('active');
    };
}

// Tab management
function initTabs(container) {
    const tabs = container.querySelectorAll('.tab');
    const contents = container.querySelectorAll('.tab-content');
    
    tabs.forEach((tab, index) => {
        tab.onclick = () => {
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            if (contents[index]) {
                contents[index].classList.add('active');
            }
        };
    });
}

// Progress bar animation
function animateProgressBar(element, targetPercentage) {
    const fill = element.querySelector('.progress-fill');
    if (!fill) return;
    
    fill.style.width = targetPercentage + '%';
}

// Form validation feedback
function showFieldError(field, message) {
    field.style.borderColor = 'var(--danger)';
    
    let error = field.parentNode.querySelector('.field-error');
    if (!error) {
        error = document.createElement('div');
        error.className = 'field-error';
        error.style.color = 'var(--danger)';
        error.style.fontSize = '0.85rem';
        error.style.marginTop = '4px';
        field.parentNode.appendChild(error);
    }
    error.textContent = message;
}

function clearFieldError(field) {
    field.style.borderColor = '';
    const error = field.parentNode.querySelector('.field-error');
    if (error) error.remove();
}

// Skeleton loading
function showSkeleton(container, count = 3) {
    container.innerHTML = '';
    
    for (let i = 0; i < count; i++) {
        const skeleton = document.createElement('div');
        skeleton.className = 'skeleton skeleton-card';
        container.appendChild(skeleton);
    }
}

function hideSkeleton(container, content) {
    container.innerHTML = content;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
    initFlashAutoDismiss();
    
    // Initialize all dropdowns
    document.querySelectorAll('.dropdown').forEach(dropdown => {
        const button = dropdown.querySelector('.dropdown-toggle');
        if (button) initDropdown(button);
    });
    
    // Initialize all tabs
    document.querySelectorAll('.tabs').forEach(initTabs);
    
    // Add page transition class removal after animation
    setTimeout(() => {
        document.body.classList.remove('page-transition');
    }, 400);
});
