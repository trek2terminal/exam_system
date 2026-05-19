/**
 * Modern UI Utilities & Enhancements
 * Professional animations, interactions, and form handling
 */

class FormValidator {
    constructor(formSelector) {
        this.form = document.querySelector(formSelector);
        this.fields = new Map();
    }

    addField(fieldName, validators = []) {
        this.fields.set(fieldName, validators);
    }

    validate() {
        let isValid = true;
        this.fields.forEach((validators, fieldName) => {
            const field = this.form.querySelector(`[name="${fieldName}"]`);
            if (!field) return;

            const hasError = validators.some(validator => !validator.test(field.value));
            if (hasError) {
                this.showError(field);
                isValid = false;
            } else {
                this.clearError(field);
            }
        });
        return isValid;
    }

    showError(field) {
        field.classList.add('error');
        const errorDiv = document.createElement('div');
        errorDiv.className = 'field-error';
        errorDiv.textContent = 'This field is invalid';
        const existing = field.nextElementSibling;
        if (!existing || !existing.classList.contains('field-error')) {
            field.insertAdjacentElement('afterend', errorDiv);
        }
    }

    clearError(field) {
        field.classList.remove('error');
        const errorDiv = field.nextElementSibling;
        if (errorDiv && errorDiv.classList.contains('field-error')) {
            errorDiv.remove();
        }
    }
}

class DataTable {
    constructor(tableSelector) {
        this.table = document.querySelector(tableSelector);
        this.currentSort = { column: 0, direction: 'asc' };
        this.init();
    }

    init() {
        if (!this.table) return;

        const headers = this.table.querySelectorAll('th');
        headers.forEach((header, index) => {
            header.style.cursor = 'pointer';
            header.addEventListener('click', () => this.sort(index));
        });
    }

    sort(columnIndex) {
        const tbody = this.table.querySelector('tbody');
        const rows = Array.from(tbody.querySelectorAll('tr'));

        if (this.currentSort.column === columnIndex) {
            this.currentSort.direction = this.currentSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
            this.currentSort.column = columnIndex;
            this.currentSort.direction = 'asc';
        }

        rows.sort((a, b) => {
            const aValue = a.children[columnIndex].textContent;
            const bValue = b.children[columnIndex].textContent;

            if (!isNaN(aValue) && !isNaN(bValue)) {
                return this.currentSort.direction === 'asc'
                    ? aValue - bValue
                    : bValue - aValue;
            }

            const comparison = aValue.localeCompare(bValue);
            return this.currentSort.direction === 'asc' ? comparison : -comparison;
        });

        tbody.innerHTML = '';
        rows.forEach(row => tbody.appendChild(row));
    }
}

class PageTransition {
    static fadeOut(duration = 300) {
        const page = document.querySelector('.page-wrap');
        if (!page) return Promise.resolve();

        return new Promise(resolve => {
            page.style.animation = `fadeOut ${duration}ms ease forwards`;
            setTimeout(resolve, duration);
        });
    }

    static fadeIn(duration = 300) {
        const page = document.querySelector('.page-wrap');
        if (!page) return;
        page.style.animation = `fadeIn ${duration}ms ease forwards`;
    }
}

class AnimatedCounter {
    constructor(element, target, duration = 1000) {
        this.element = element;
        this.target = parseInt(target);
        this.duration = duration;
        this.current = 0;
        this.increment = this.target / (duration / 16);
    }

    start() {
        const interval = setInterval(() => {
            this.current += this.increment;
            if (this.current >= this.target) {
                this.current = this.target;
                clearInterval(interval);
            }
            this.element.textContent = Math.floor(this.current);
        }, 16);
    }
}

class ProgressRing {
    constructor(element, radius = 45, circumference = null) {
        this.element = element;
        this.radius = radius;
        this.circumference = circumference || radius * 2 * Math.PI;
    }

    setProgress(percent) {
        const offset = this.circumference - (percent / 100) * this.circumference;
        this.element.style.strokeDashoffset = offset;
    }

    animate(fromPercent, toPercent, duration = 1000) {
        const startTime = Date.now();
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const currentPercent = fromPercent + (toPercent - fromPercent) * progress;
            this.setProgress(currentPercent);

            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };
        animate();
    }
}

class SmoothScroll {
    static scrollTo(target, duration = 800) {
        const element = typeof target === 'string'
            ? document.querySelector(target)
            : target;

        if (!element) return;

        const start = window.scrollY;
        const top = element.getBoundingClientRect().top + start;
        const difference = top - start;
        let startTime = Date.now();

        const scroll = () => {
            let elapsed = Date.now() - startTime;
            window.scrollY = this.easeInOutCubic(elapsed, start, difference, duration);

            if (elapsed < duration) {
                requestAnimationFrame(scroll);
            } else {
                window.scrollTo(0, top);
            }
        };

        requestAnimationFrame(scroll);
    }

    static easeInOutCubic(elapsed, start, distance, duration) {
        elapsed /= duration / 2;
        if (elapsed < 1) return distance / 2 * elapsed * elapsed * elapsed + start;
        elapsed -= 2;
        return distance / 2 * (elapsed * elapsed * elapsed + 2) + start;
    }
}

class Tooltip {
    constructor(element, text, position = 'top') {
        this.element = element;
        this.text = text;
        this.position = position;
        this.tooltip = null;
        this.init();
    }

    init() {
        this.element.addEventListener('mouseenter', () => this.show());
        this.element.addEventListener('mouseleave', () => this.hide());
    }

    show() {
        this.tooltip = document.createElement('div');
        this.tooltip.className = `tooltip-box tooltip-${this.position}`;
        this.tooltip.textContent = this.text;
        this.tooltip.style.opacity = '0';
        document.body.appendChild(this.tooltip);

        const rect = this.element.getBoundingClientRect();
        const tooltipRect = this.tooltip.getBoundingClientRect();

        const positions = {
            'top': {
                left: rect.left + rect.width / 2 - tooltipRect.width / 2,
                top: rect.top - tooltipRect.height - 10
            },
            'bottom': {
                left: rect.left + rect.width / 2 - tooltipRect.width / 2,
                top: rect.bottom + 10
            },
            'left': {
                left: rect.left - tooltipRect.width - 10,
                top: rect.top + rect.height / 2 - tooltipRect.height / 2
            },
            'right': {
                left: rect.right + 10,
                top: rect.top + rect.height / 2 - tooltipRect.height / 2
            }
        };

        const pos = positions[this.position];
        this.tooltip.style.left = pos.left + 'px';
        this.tooltip.style.top = pos.top + 'px';

        setTimeout(() => {
            this.tooltip.style.opacity = '1';
        }, 0);
    }

    hide() {
        if (this.tooltip) {
            this.tooltip.style.opacity = '0';
            setTimeout(() => this.tooltip.remove(), 300);
        }
    }
}

class ExamTimer {
    constructor(containerSelector, totalSeconds) {
        this.container = document.querySelector(containerSelector);
        this.totalSeconds = totalSeconds;
        this.remainingSeconds = totalSeconds;
        this.intervalId = null;
        this.onWarning = null;
        this.onDanger = null;
        this.onExpire = null;
    }

    start() {
        this.intervalId = setInterval(() => {
            this.remainingSeconds--;
            this.updateDisplay();
            this.checkThresholds();

            if (this.remainingSeconds <= 0) {
                this.expire();
            }
        }, 1000);
    }

    updateDisplay() {
        const hours = Math.floor(this.remainingSeconds / 3600);
        const minutes = Math.floor((this.remainingSeconds % 3600) / 60);
        const seconds = this.remainingSeconds % 60;

        const display = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        if (this.container) {
            this.container.textContent = display;
        }
    }

    checkThresholds() {
        const percent = (this.remainingSeconds / this.totalSeconds) * 100;

        if (percent <= 10 && this.onDanger) {
            this.onDanger();
        } else if (percent <= 25 && this.onWarning) {
            this.onWarning();
        }
    }

    expire() {
        clearInterval(this.intervalId);
        if (this.onExpire) this.onExpire();
    }

    pause() {
        clearInterval(this.intervalId);
    }

    resume() {
        this.start();
    }

    getRemaining() {
        return this.remainingSeconds;
    }
}

class FileUploadDropZone {
    constructor(containerSelector, onFilesSelected) {
        this.container = document.querySelector(containerSelector);
        this.onFilesSelected = onFilesSelected;
        if (this.container) this.init();
    }

    init() {
        this.container.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.container.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.container.addEventListener('drop', (e) => this.handleDrop(e));
    }

    handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        this.container.classList.add('drag-active');
    }

    handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        this.container.classList.remove('drag-active');
    }

    handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        this.container.classList.remove('drag-active');
        const files = e.dataTransfer.files;
        if (this.onFilesSelected) this.onFilesSelected(files);
    }
}

// Export for use in other scripts
window.FormValidator = FormValidator;
window.DataTable = DataTable;
window.PageTransition = PageTransition;
window.AnimatedCounter = AnimatedCounter;
window.ProgressRing = ProgressRing;
window.SmoothScroll = SmoothScroll;
window.Tooltip = Tooltip;
window.ExamTimer = ExamTimer;
window.FileUploadDropZone = FileUploadDropZone;

