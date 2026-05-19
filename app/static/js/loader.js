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

        const loaderHTML = this._getLoaderHTML(loaderType);
        content.innerHTML = loaderHTML;

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

    _getLoaderHTML(type) {
        const loaders = {
            'ring': `
                <div class="loader-ring">
                    <div></div>
                    <div></div>
                    <div></div>
                </div>
            `,
            'dots': `
                <div class="loader-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            `,
            'wave': `
                <div class="loader-wave">
                    <span></span>
                    <span></span>
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            `,
            'grid': `
                <div class="loader-grid">
                    ${Array(9).fill(0).map(() => '<span></span>').join('')}
                </div>
            `,
            'bar': `
                <div class="loader-bar"></div>
            `
        };

        return loaders[type] || loaders['ring'];
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

        dialog.innerHTML = `
            <div class="confirm-dialog modal-enter">
                <div class="confirm-header">
                    <h2>${this.title}</h2>
                    <button class="confirm-close">&times;</button>
                </div>
                <div class="confirm-body">
                    <p>${this.message}</p>
                </div>
                <div class="confirm-footer">
                    <button class="btn btn-secondary confirm-cancel">Cancel</button>
                    <button class="btn btn-primary confirm-ok">Confirm</button>
                </div>
            </div>
        `;

        const closeBtn = dialog.querySelector('.confirm-close');
        const cancelBtn = dialog.querySelector('.confirm-cancel');
        const okBtn = dialog.querySelector('.confirm-ok');

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

        const toast = document.createElement('div');
        toast.className = `toast toast-${type} animate-slide-in-right`;
        toast.innerHTML = `
            <i class="fas fa-${this._getIcon(type)}"></i>
            <span>${message}</span>
            <button class="toast-close">&times;</button>
        `;

        container.appendChild(toast);

        const closeBtn = toast.querySelector('.toast-close');
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
}

// Global convenience functions
window.showLoader = (msg, sub, type) => {
    window._loader = new LoadingOverlay(msg, sub);
    window._loader.show(type || 'ring');
};

window.hideLoader = () => {
    if (window._loader) window._loader.hide();
};

window.confirm = (title, msg, onOk, onCancel) => {
    const dialog = new ConfirmDialog(title, msg, onOk, onCancel);
    dialog.show();
};

window.toast = (msg, type, duration) => {
    Toast.show(msg, type || 'info', duration);
};

