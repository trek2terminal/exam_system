// Shared UI helpers for notifications, dialogs, and small interactions.

function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const safeType = ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info';

    const toast = document.createElement('div');
    toast.className = `toast ${safeType}`;

    const iconWrap = document.createElement('span');
    iconWrap.className = 'toast-icon';
    const icon = document.createElement('i');
    icon.className = getToastIcon(safeType);
    icon.setAttribute('aria-hidden', 'true');
    iconWrap.appendChild(icon);

    const messageText = document.createElement('span');
    messageText.textContent = String(message || '');

    toast.append(iconWrap, messageText);

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function getToastIcon(type) {
    const icons = {
        success: 'fas fa-check-circle',
        error: 'fas fa-circle-xmark',
        warning: 'fas fa-triangle-exclamation',
        info: 'fas fa-circle-info',
    };
    return icons[type] || icons.info;
}

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
                if (stack && !stack.querySelector('.flash-message')) stack.remove();
            }, 320);
        }, delay);
    });
}

function updateAutoSaveStatus(status, message = '') {
    const indicator = document.querySelector('.auto-save-indicator');
    if (!indicator) return;

    const states = ['saving', 'saved', 'error'];
    indicator.classList.remove(...states);

    const content = {
        idle: ['fa-cloud', message || 'Answers ready'],
        saving: ['fa-cloud-arrow-up', message || 'Saving...'],
        saved: ['fa-check-circle', message || 'Saved'],
        error: ['fa-triangle-exclamation', message || 'Save failed'],
    };
    const [icon, text] = content[status] || content.idle;

    if (states.includes(status)) indicator.classList.add(status);
    indicator.replaceChildren();
    const iconNode = document.createElement('i');
    iconNode.className = `fas ${icon}`;
    iconNode.setAttribute('aria-hidden', 'true');
    const textNode = document.createElement('span');
    textNode.textContent = text;
    indicator.append(iconNode, textNode);
}

function initWordCounter(textarea, maxLength) {
    const counter = document.createElement('div');
    counter.className = 'word-counter';
    textarea.parentNode.insertBefore(counter, textarea.nextSibling);

    function updateCount() {
        const length = textarea.value.length;
        const remaining = maxLength - length;

        counter.textContent = `${length}/${maxLength} characters`;
        counter.classList.toggle('danger', remaining < 50);
        counter.classList.toggle('warning', remaining >= 50 && remaining < 100);
    }

    textarea.addEventListener('input', updateCount);
    updateCount();
}

function initQuestionPalette(totalQuestions) {
    const palette = document.createElement('div');
    palette.className = 'question-palette';
    palette.id = 'questionPalette';

    for (let i = 1; i <= totalQuestions; i++) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'palette-item';
        item.textContent = i;
        item.dataset.question = i;
        item.addEventListener('click', () => scrollToQuestion(i));
        palette.appendChild(item);
    }

    return palette;
}

function updatePaletteStatus(questionNum, status) {
    const item = document.querySelector(`.palette-item[data-question="${questionNum}"]`);
    if (!item) return;

    item.classList.remove('answered', 'review', 'current', 'visited');
    if (status) item.classList.add(status);
}

function scrollToQuestion(questionNum) {
    const question = document.querySelector(`[data-question-number="${questionNum}"]`);
    if (question) {
        question.scrollIntoView({ behavior: 'smooth', block: 'center' });
        updatePaletteStatus(questionNum, 'current');
    }
}

function updateTimerColor(remainingSeconds, totalSeconds) {
    const timerBox = document.querySelector('.timer-box');
    if (!timerBox || !totalSeconds) return;

    const percentage = (remainingSeconds / totalSeconds) * 100;
    timerBox.classList.toggle('danger', percentage <= 10);
    timerBox.classList.toggle('warning', percentage > 10 && percentage <= 25);
}

function openModal(content) {
    let overlay = document.querySelector('.modal-overlay');

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const modal = document.createElement('div');
        modal.className = 'modal';
        const header = document.createElement('div');
        header.className = 'modal-header';
        const title = document.createElement('h3');
        title.textContent = 'Confirm';
        const close = document.createElement('button');
        close.className = 'modal-close';
        close.type = 'button';
        close.setAttribute('aria-label', 'Close');
        close.textContent = '\u00d7';
        close.addEventListener('click', closeModal);
        header.append(title, close);
        const body = document.createElement('div');
        body.className = 'modal-body';
        modal.append(header, body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    }

    const body = overlay.querySelector('.modal-body');
    body.replaceChildren();
    if (content instanceof Node) {
        body.appendChild(content);
    } else {
        body.textContent = String(content || '');
    }
    overlay.classList.add('active');
}

function closeModal() {
    const overlay = document.querySelector('.modal-overlay');
    if (overlay) overlay.classList.remove('active');
}

function initDropdown(button) {
    const dropdown = button.closest('.dropdown');
    if (!dropdown) return;

    button.onclick = (event) => {
        event.stopPropagation();
        dropdown.classList.toggle('active');
    };

    document.onclick = () => dropdown.classList.remove('active');
}

function initTabs(container) {
    const tabs = container.querySelectorAll('.tab');
    const contents = container.querySelectorAll('.tab-content');

    tabs.forEach((tab, index) => {
        tab.onclick = () => {
            tabs.forEach((item) => item.classList.remove('active'));
            contents.forEach((item) => item.classList.remove('active'));
            tab.classList.add('active');
            if (contents[index]) contents[index].classList.add('active');
        };
    });
}

function animateProgressBar(element, targetPercentage) {
    const fill = element.querySelector('.progress-fill');
    if (fill) fill.style.width = `${targetPercentage}%`;
}

function showFieldError(field, message) {
    field.classList.add('error');

    let error = field.parentNode.querySelector('.field-error');
    if (!error) {
        error = document.createElement('div');
        error.className = 'field-error';
        field.parentNode.appendChild(error);
    }
    error.textContent = message;
}

function clearFieldError(field) {
    field.classList.remove('error');
    const error = field.parentNode.querySelector('.field-error');
    if (error) error.remove();
}

function showSkeleton(container, count = 3) {
    container.replaceChildren();

    for (let i = 0; i < count; i++) {
        const skeleton = document.createElement('div');
        skeleton.className = 'skeleton skeleton-card';
        container.appendChild(skeleton);
    }
}

function hideSkeleton(container, content) {
    container.replaceChildren();
    if (content instanceof Node) {
        container.appendChild(content);
    } else {
        container.textContent = String(content || '');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initFlashAutoDismiss();

    document.querySelectorAll('.dropdown').forEach((dropdown) => {
        const button = dropdown.querySelector('.dropdown-toggle');
        if (button) initDropdown(button);
    });

    document.querySelectorAll('.tabs').forEach(initTabs);

    setTimeout(() => {
        document.body.classList.remove('page-transition');
    }, 400);
});
