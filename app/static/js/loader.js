/**
 * Modern Loader & Modal Components
 * Professional loading indicators and modal dialogs
 */

class LoadingOverlay {
    constructor(message = 'Loading...', subMessage = '') {
        this.message = message;
        this.subMessage = subMessage;
        this.overlay = null;
    }

    show(loaderType = 'ring') {
        if (this.overlay) return; // Already showing

        const overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        overlay.id = 'loadingOverlay';

        const content = document.createElement('div');
        content.className = 'loading-overlay-content';

        content.appendChild(this._createLoader(loaderType));

        const heading = document.createElement('h2');
        heading.textContent = this.message;
        content.appendChild(heading);

        if (this.subMessage) {
            const subMsg = document.createElement('p');
            subMsg.textContent = this.subMessage;
            content.appendChild(subMsg);
        }

        overlay.appendChild(content);
        document.body.appendChild(overlay);
        this.overlay = overlay;
    }

    hide() {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
    }

    _createLoader(type) {
        const safeType = ['ring', 'dots', 'wave', 'grid', 'bar'].includes(type) ? type : 'ring';
        const loader = document.createElement('div');
        loader.className = `loader-${safeType}`;
        const childTag = safeType === 'ring' ? 'div' : 'span';
        const counts = { ring: 3, dots: 3, wave: 5, grid: 9, bar: 0 };
        for (let index = 0; index < counts[safeType]; index += 1) {
            loader.appendChild(document.createElement(childTag));
        }
        return loader;
    }
}

class ConfirmDialog {
    constructor(title, message, onConfirm, onCancel = null) {
        this.title = title;
        this.message = message;
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
        this.dialog = null;
    }

    show() {
        const dialog = document.createElement('div');
        dialog.className = 'confirm-dialog-overlay';
        dialog.id = 'confirmDialog';

        const panel = document.createElement('div');
        panel.className = 'confirm-dialog modal-enter';
        const header = document.createElement('div');
        header.className = 'confirm-header';
        const title = document.createElement('h2');
        title.textContent = String(this.title || '');
        const closeBtn = document.createElement('button');
        closeBtn.className = 'confirm-close';
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.textContent = '\u00d7';
        header.append(title, closeBtn);

        const body = document.createElement('div');
        body.className = 'confirm-body';
        const message = document.createElement('p');
        message.textContent = String(this.message || '');
        body.appendChild(message);

        const footer = document.createElement('div');
        footer.className = 'confirm-footer';
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-secondary confirm-cancel';
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Cancel';
        const okBtn = document.createElement('button');
        okBtn.className = 'btn btn-primary confirm-ok';
        okBtn.type = 'button';
        okBtn.textContent = 'Confirm';
        footer.append(cancelBtn, okBtn);
        panel.append(header, body, footer);
        dialog.appendChild(panel);

        const cleanup = () => {
            dialog.remove();
            this.dialog = null;
        };

        closeBtn.addEventListener('click', () => {
            if (this.onCancel) this.onCancel();
            cleanup();
        });

        cancelBtn.addEventListener('click', () => {
            if (this.onCancel) this.onCancel();
            cleanup();
        });

        okBtn.addEventListener('click', () => {
            this.onConfirm();
            cleanup();
        });

        document.body.appendChild(dialog);
        this.dialog = dialog;
    }

    hide() {
        if (this.dialog) {
            this.dialog.remove();
            this.dialog = null;
        }
    }
}

class Toast {
    static show(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toastContainer') || this._createContainer();
        const safeType = this._getType(type);

        const toast = document.createElement('div');
        toast.className = `toast toast-${safeType} animate-slide-in-right`;
        const icon = document.createElement('i');
        icon.className = `fas fa-${this._getIcon(safeType)}`;
        icon.setAttribute('aria-hidden', 'true');
        const messageText = document.createElement('span');
        messageText.textContent = String(message || '');
        const closeBtn = document.createElement('button');
        closeBtn.className = 'toast-close';
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Close notification');
        closeBtn.textContent = '\u00d7';
        toast.append(icon, messageText, closeBtn);

        container.appendChild(toast);

        const remove = () => toast.remove();

        closeBtn.addEventListener('click', remove);
        setTimeout(remove, duration);
    }

    static _createContainer() {
        const container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
        return container;
    }

    static _getIcon(type) {
        const icons = {
            'success': 'check-circle',
            'error': 'exclamation-circle',
            'warning': 'warning',
            'info': 'info-circle'
        };
        return icons[type] || 'info-circle';
    }

    static _getType(type) {
        return ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info';
    }
}

// Global convenience functions
window.showLoader = (msg, sub, type) => {
    window._loader = new LoadingOverlay(msg, sub);
    window._loader.show(type || 'ring');
};

window.hideLoader = () => {
    if (window._loader) window._loader.hide();
};

window.confirmDialog = (title, msg, onOk, onCancel) => {
    const dialog = new ConfirmDialog(title, msg, onOk, onCancel);
    dialog.show();
};

window.toast = (msg, type, duration) => {
    Toast.show(msg, type || 'info', duration);
};

