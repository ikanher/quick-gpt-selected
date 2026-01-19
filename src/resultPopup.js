const loader = document.getElementById('loading');
const resultContainer = document.getElementById('result');
const resultText = document.getElementById('verbose-result');
const statusText = document.getElementById('status-text');
const stopButton = document.getElementById('stop-stream');
const closeButton = document.getElementById('close-popup');
const copyButton = document.getElementById('copy-result');

const params = new URLSearchParams(window.location.search);
const requestId = params.get('requestId') || 'latest';

let activeRequestId = requestId;
let port = null;
let rawContent = '';

const escapeHtml = (value) => value.replace(/[&<>"']/g, (char) => {
    switch (char) {
        case '&':
            return '&amp;';
        case '<':
            return '&lt;';
        case '>':
            return '&gt;';
        case '"':
            return '&quot;';
        case "'":
            return '&#39;';
        default:
            return char;
    }
});

const isSafeUrl = (value) => {
    const trimmed = value.trim();
    return /^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed);
};

const renderInlineMarkdown = (text) => {
    const codeSpans = [];
    let output = text.replace(/`([^`]+)`/g, (match, code) => {
        codeSpans.push(code);
        return `@@INLINE_CODE_${codeSpans.length - 1}@@`;
    });

    output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    output = output.replace(/(^|[\s])\*([^*]+)\*/g, '$1<em>$2</em>');
    output = output.replace(/(^|[\s])_([^_]+)_/g, '$1<em>$2</em>');
    output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
        const safeUrl = isSafeUrl(url) ? url : '';
        if (!safeUrl) {
            return label;
        }
        return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });

    return output.replace(/@@INLINE_CODE_(\d+)@@/g, (match, index) => {
        const code = codeSpans[Number(index)] || '';
        return `<code>${code}</code>`;
    });
};

const renderMarkdown = (source) => {
    if (!source) {
        return '';
    }

    const codeBlocks = [];
    let text = source.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
        const index = codeBlocks.length;
        codeBlocks.push({
            lang: lang || '',
            code
        });
        return `@@CODEBLOCK_${index}@@`;
    });

    text = escapeHtml(text);
    const blocks = text.split(/\n{2,}/);

    const renderedBlocks = blocks.map((block) => {
        const trimmed = block.trim();
        const codeMatch = trimmed.match(/^@@CODEBLOCK_(\d+)@@$/);
        if (codeMatch) {
            const codeBlock = codeBlocks[Number(codeMatch[1])];
            if (!codeBlock) {
                return '';
            }
            const className = codeBlock.lang ? ` class="language-${escapeHtml(codeBlock.lang)}"` : '';
            return `<pre><code${className}>${escapeHtml(codeBlock.code)}</code></pre>`;
        }

        const lines = block.split('\n');
        const isUnordered = lines.every((line) => /^\s*[-*+]\s+/.test(line));
        const isOrdered = lines.every((line) => /^\s*\d+\.\s+/.test(line));

        if (isUnordered || isOrdered) {
            const tag = isOrdered ? 'ol' : 'ul';
            const items = lines.map((line) => {
                const item = line.replace(/^(\s*[-*+]\s+|\s*\d+\.\s+)/, '');
                return `<li>${renderInlineMarkdown(item)}</li>`;
            }).join('');
            return `<${tag}>${items}</${tag}>`;
        }

        const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
        if (headingMatch) {
            const level = Math.min(6, headingMatch[1].length);
            const content = renderInlineMarkdown(headingMatch[2]);
            return `<h${level}>${content}</h${level}>`;
        }

        const paragraph = lines.map((line) => renderInlineMarkdown(line)).join('<br>');
        return `<p>${paragraph}</p>`;
    });

    return renderedBlocks.join('');
};

const setStatus = (text, isError = false) => {
    statusText.textContent = text;
    statusText.style.color = isError ? '#b42318' : '#0f766e';
};

const startStream = () => {
    loader.style.display = 'block';
    resultContainer.style.display = 'block';
    rawContent = '';
    resultText.innerHTML = '';
    setStatus('Connecting...');
    stopButton.disabled = false;
    copyButton.disabled = true;

    port = browser.runtime.connect({ name: 'popup-stream' });
    port.onMessage.addListener(handleStreamMessage);
    port.onDisconnect.addListener(() => {
        port = null;
        stopButton.disabled = true;
    });
    port.postMessage({ type: 'subscribe', requestId: activeRequestId, target: 'popup' });
};

const handleStreamMessage = (message) => {
    if (!message || message.requestId !== activeRequestId) {
        return;
    }

    if (message.type === 'stream-start') {
        loader.style.display = 'block';
        rawContent = '';
        resultText.innerHTML = '';
        setStatus('Streaming...');
        stopButton.disabled = false;
        copyButton.disabled = true;
        return;
    }

    if (message.type === 'stream-delta') {
        loader.style.display = 'none';
        rawContent += message.delta || '';
        resultText.innerHTML = renderMarkdown(rawContent);
        copyButton.disabled = rawContent.trim().length === 0;
        return;
    }

    if (message.type === 'stream-complete') {
        loader.style.display = 'none';
        if (message.fullText) {
            rawContent = message.fullText;
            resultText.innerHTML = renderMarkdown(rawContent);
        }
        setStatus('Complete');
        stopButton.disabled = true;
        copyButton.disabled = rawContent.trim().length === 0;
        if (port) {
            port.disconnect();
        }
        return;
    }

    if (message.type === 'stream-error') {
        loader.style.display = 'none';
        setStatus('Error', true);
        resultText.textContent = message.error || 'Request failed.';
        stopButton.disabled = true;
        copyButton.disabled = true;
        if (port) {
            port.disconnect();
        }
        return;
    }

    if (message.type === 'stream-abort') {
        loader.style.display = 'none';
        setStatus('Cancelled', true);
        stopButton.disabled = true;
        copyButton.disabled = rawContent.trim().length === 0;
        if (port) {
            port.disconnect();
        }
        return;
    }
};

stopButton.addEventListener('click', () => {
    if (!port) {
        return;
    }
    port.postMessage({ type: 'cancel', requestId: activeRequestId });
    setStatus('Cancelling...');
    stopButton.disabled = true;
});

closeButton.addEventListener('click', () => {
    window.close();
});

copyButton.addEventListener('click', async () => {
    if (!rawContent.trim()) {
        return;
    }
    try {
        await navigator.clipboard.writeText(rawContent);
        copyButton.textContent = 'Copied';
    } catch (error) {
        const fallback = document.createElement('textarea');
        fallback.value = rawContent;
        fallback.setAttribute('readonly', 'true');
        fallback.style.position = 'absolute';
        fallback.style.left = '-9999px';
        document.body.appendChild(fallback);
        fallback.select();
        document.execCommand('copy');
        document.body.removeChild(fallback);
        copyButton.textContent = 'Copied';
    }
    window.setTimeout(() => {
        copyButton.textContent = 'Copy';
    }, 2000);
});

window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        window.close();
    }
});

startStream();
