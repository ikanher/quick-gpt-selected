const OVERLAY_ID = 'quick-gpt-selected-inline-overlay';
const STYLE_ID = 'quick-gpt-selected-inline-style';

let activeRequestId = null;
let port = null;
let elements = null;
let hasOpenedPopup = false;
let lastSelectionRect = null;

const ensureStyles = () => {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        #${OVERLAY_ID} {
            --qgs-accent: #0f766e;
            --qgs-accent-dark: #0b5b55;
            --qgs-danger: #b42318;
            --qgs-gray: #f2f4f7;
            --qgs-gray-dark: #d0d5dd;
            --qgs-gray-hover: #e8ebef;
            --qgs-gray-active: #dde2e7;
            --qgs-ink: #1f2937;
            --qgs-paper: #ffffff;
            --qgs-muted: #4b5563;
            --qgs-subtle: #6b7280;
            position: fixed;
            z-index: 2147483647;
            max-width: 420px;
            min-width: 280px;
            background: var(--qgs-paper);
            border: 1px solid #d0d5dd;
            box-shadow: 0 10px 26px rgba(0, 0, 0, 0.12);
            border-radius: 14px;
            padding: 14px;
            font-family: "IBM Plex Sans", "Avenir Next", "Trebuchet MS", sans-serif;
            color: var(--qgs-ink);
        }
        #${OVERLAY_ID} .qgs-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--qgs-muted);
        }
        #${OVERLAY_ID} .qgs-status {
            margin-left: 8px;
            font-size: 12px;
            color: var(--qgs-accent);
        }
        #${OVERLAY_ID} .qgs-body {
            margin-top: 10px;
            font-size: 14px;
            line-height: 1.4;
            max-height: 260px;
            overflow-y: auto;
            white-space: pre-wrap;
        }
        #${OVERLAY_ID} .qgs-actions {
            display: flex;
            gap: 8px;
            margin-top: 12px;
            justify-content: flex-end;
        }
        #${OVERLAY_ID} .qgs-btn {
            border: 1px solid transparent;
            background: var(--qgs-gray);
            padding: 8px 12px;
            border-radius: 999px;
            font-size: 12px;
            cursor: pointer;
        }
        #${OVERLAY_ID} .qgs-btn-primary {
            background: var(--qgs-accent);
            border-color: var(--qgs-accent-dark);
            color: #ffffff;
        }
        #${OVERLAY_ID} .qgs-btn-secondary {
            background: var(--qgs-gray);
            border-color: var(--qgs-gray-dark);
            color: var(--qgs-muted);
        }
        #${OVERLAY_ID} .qgs-btn:disabled {
            opacity: 0.6;
            cursor: default;
        }
        #${OVERLAY_ID} .qgs-btn:hover {
            background: var(--qgs-gray-hover);
        }
        #${OVERLAY_ID} .qgs-btn:active {
            background: var(--qgs-gray-active);
        }
        #${OVERLAY_ID} .qgs-btn-primary:hover {
            background: var(--qgs-accent-dark);
        }
        #${OVERLAY_ID} .qgs-btn:focus-visible {
            outline: 2px solid rgba(15, 118, 110, 0.5);
            outline-offset: 2px;
        }
    `;
    document.head.appendChild(style);
};

const positionOverlay = (container) => {
    let left = 16;
    let top = 16;
    const selection = window.getSelection();
    if (selection && selection.rangeCount) {
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        lastSelectionRect = rect;
    }
    if (lastSelectionRect) {
        left = lastSelectionRect.left;
        top = lastSelectionRect.bottom + 8;
    }
    container.style.left = `${Math.max(8, left)}px`;
    container.style.top = `${Math.max(8, top)}px`;

    requestAnimationFrame(() => {
        const rect = container.getBoundingClientRect();
        let nextLeft = rect.left;
        let nextTop = rect.top;
        if (rect.right > window.innerWidth - 8) {
            nextLeft = Math.max(8, window.innerWidth - rect.width - 8);
        }
        if (rect.bottom > window.innerHeight - 8) {
            nextTop = Math.max(8, window.innerHeight - rect.height - 8);
        }
        container.style.left = `${nextLeft}px`;
        container.style.top = `${nextTop}px`;
    });
};

const removeOverlay = () => {
    if (elements && elements.container) {
        elements.container.remove();
    }
    if (elements && elements.resizeObserver) {
        elements.resizeObserver.disconnect();
    }
    if (elements && elements.keyHandler) {
        document.removeEventListener('keydown', elements.keyHandler);
    }
    elements = null;
};

const disconnectPort = () => {
    if (port) {
        port.disconnect();
        port = null;
    }
};

const updateStatus = (text, isError = false) => {
    if (!elements || !elements.status) {
        return;
    }
    elements.status.textContent = text;
    elements.status.style.color = isError ? '#b42318' : '#0f766e';
};

const updateBody = (text) => {
    if (elements && elements.body) {
        elements.body.textContent = text;
        if (elements.container) {
            positionOverlay(elements.container);
        }
    }
};

const appendBody = (delta) => {
    if (elements && elements.body) {
        elements.body.textContent += delta;
        if (elements.container) {
            positionOverlay(elements.container);
        }
    }
};

const buildOverlay = (promptName) => {
    ensureStyles();
    removeOverlay();

    const container = document.createElement('div');
    container.id = OVERLAY_ID;

    const header = document.createElement('div');
    header.className = 'qgs-header';

    const title = document.createElement('span');
    title.textContent = promptName ? `Quick GPT (${promptName})` : 'Quick GPT';

    const status = document.createElement('span');
    status.className = 'qgs-status';
    status.textContent = 'Starting...';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    header.appendChild(title);
    header.appendChild(status);

    const body = document.createElement('div');
    body.className = 'qgs-body';
    body.textContent = '';

    const actions = document.createElement('div');
    actions.className = 'qgs-actions';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'qgs-btn qgs-btn-primary';
    closeButton.textContent = 'Close';

    const moreButton = document.createElement('button');
    moreButton.type = 'button';
    moreButton.className = 'qgs-btn qgs-btn-secondary';
    moreButton.textContent = hasOpenedPopup ? 'Re-open' : 'More';
    moreButton.disabled = false;

    actions.appendChild(closeButton);
    actions.appendChild(moreButton);

    container.appendChild(header);
    container.appendChild(body);
    container.appendChild(actions);
    document.body.appendChild(container);

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
            positionOverlay(container);
        });
        resizeObserver.observe(container);
    }

    const keyHandler = (event) => {
        if (event.key === 'Escape') {
            closeButton.click();
        }
    };
    document.addEventListener('keydown', keyHandler);

    elements = {
        container,
        status,
        body,
        moreButton,
        closeButton,
        keyHandler,
        resizeObserver
    };

    positionOverlay(container);
    closeButton.focus();

    closeButton.addEventListener('click', () => {
        if (activeRequestId) {
            if (port) {
                port.postMessage({ type: 'cancel', requestId: activeRequestId });
            } else {
                browser.runtime.sendMessage({ type: 'cancel', requestId: activeRequestId });
            }
        }
        disconnectPort();
        removeOverlay();
    });

    moreButton.addEventListener('click', () => {
        if (!activeRequestId) {
            return;
        }
        hasOpenedPopup = true;
        moreButton.textContent = 'Re-open';
        moreButton.disabled = false;
        browser.runtime.sendMessage({ type: 'request-verbose', requestId: activeRequestId });
    });
};

const handleStreamMessage = (message) => {
    if (!message || message.requestId !== activeRequestId) {
        return;
    }

    if (message.type === 'stream-start') {
        updateBody('');
        updateStatus('Streaming...');
        if (elements && elements.moreButton) {
            elements.moreButton.textContent = hasOpenedPopup ? 'Re-open' : 'More';
        }
        return;
    }

    if (message.type === 'stream-delta') {
        appendBody(message.delta || '');
        return;
    }

    if (message.type === 'stream-complete') {
        updateStatus('Complete');
        if (elements && elements.moreButton) {
            elements.moreButton.disabled = false;
        }
        if (message.fullText) {
            updateBody(message.fullText);
        }
        return;
    }

    if (message.type === 'stream-error') {
        updateStatus('Error', true);
        updateBody(message.error || 'Request failed.');
        if (elements && elements.moreButton) {
            elements.moreButton.disabled = true;
        }
        return;
    }

    if (message.type === 'stream-abort') {
        updateStatus('Cancelled', true);
        if (elements && elements.moreButton) {
            elements.moreButton.disabled = true;
        }
        return;
    }
};

const subscribeToRequest = (requestId) => {
    disconnectPort();
    port = browser.runtime.connect({ name: 'inline-stream' });
    port.onMessage.addListener(handleStreamMessage);
    port.onDisconnect.addListener(() => {
        port = null;
    });
    port.postMessage({ type: 'subscribe', requestId, target: 'inline' });
};

const startInline = (requestId, promptName) => {
    activeRequestId = requestId;
    hasOpenedPopup = false;
    buildOverlay(promptName);
    subscribeToRequest(requestId);
};

browser.runtime.onMessage.addListener((message) => {
    if (!message || !message.type) {
        return;
    }

    if (message.type === 'inline-ping') {
        return Promise.resolve(true);
    }

    if (message.type === 'inline-start') {
        startInline(message.requestId, message.promptName);
    }
});
