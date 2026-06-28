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

const renderKatex = (tex, displayMode, originalText) => {
    if (!window.katex || typeof window.katex.renderToString !== 'function') {
        return escapeHtml(originalText);
    }

    try {
        return window.katex.renderToString(tex.trim(), {
            displayMode,
            output: 'html',
            strict: 'ignore',
            throwOnError: false,
            trust: false
        });
    } catch (error) {
        return escapeHtml(originalText);
    }
};

const isLikelyDollarMath = (tex) => /[A-Za-z\\_^{}=<>+\-*/]/.test(tex);

const renderInlineMarkdown = (text) => {
    const protectedSpans = [];
    const protect = (html) => {
        const token = `@@QGS_INLINE_${protectedSpans.length}@@`;
        protectedSpans.push(html);
        return token;
    };

    let output = text.replace(/`([^`]+)`/g, (match, code) => {
        return protect(`<code>${escapeHtml(code)}</code>`);
    });

    output = output.replace(/\\\[([\s\S]+?)\\\]/g, (match, tex) => {
        return protect(renderKatex(tex, true, match));
    });
    output = output.replace(/\$\$([\s\S]+?)\$\$/g, (match, tex) => {
        return protect(renderKatex(tex, true, match));
    });
    output = output.replace(/\\\(([\s\S]+?)\\\)/g, (match, tex) => {
        return protect(renderKatex(tex, false, match));
    });
    output = output.replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (match, prefix, tex) => {
        if (!isLikelyDollarMath(tex)) {
            return match;
        }
        return `${prefix}${protect(renderKatex(tex, false, `$${tex}$`))}`;
    });

    output = escapeHtml(output);
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

    return output.replace(/@@QGS_INLINE_(\d+)@@/g, (match, index) => {
        return protectedSpans[Number(index)] || '';
    });
};

const parseMarkdownBlocks = (source) => {
    const blocks = [];
    let textLines = [];
    let codeLines = null;
    let codeLang = '';

    const flushText = () => {
        if (textLines.length) {
            blocks.push({
                type: 'text',
                text: textLines.join('\n')
            });
            textLines = [];
        }
    };

    source.replace(/\r\n?/g, '\n').split('\n').forEach((line) => {
        if (codeLines) {
            if (/^\s*```\s*$/.test(line)) {
                blocks.push({
                    type: 'code',
                    lang: codeLang,
                    code: codeLines.join('\n')
                });
                codeLines = null;
                codeLang = '';
            } else {
                codeLines.push(line);
            }
            return;
        }

        const fenceMatch = line.match(/^\s*```([^`]*)$/);
        if (fenceMatch) {
            flushText();
            codeLines = [];
            codeLang = (fenceMatch[1].trim().split(/\s+/)[0] || '');
            return;
        }

        textLines.push(line);
    });

    if (codeLines) {
        blocks.push({
            type: 'code',
            lang: codeLang,
            code: codeLines.join('\n')
        });
    }
    flushText();

    return blocks;
};

const renderTextMarkdown = (source) => {
    const blocks = source.split(/\n{2,}/);

    const renderedBlocks = blocks.map((block) => {
        const trimmed = block.trim();
        if (!trimmed) {
            return '';
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

const renderMarkdown = (source) => {
    if (!source) {
        return '';
    }

    return parseMarkdownBlocks(source).map((block) => {
        if (block.type === 'code') {
            const className = block.lang ? ` class="language-${escapeHtml(block.lang)}"` : '';
            return `<pre><code${className}>${escapeHtml(block.code)}</code></pre>`;
        }
        return renderTextMarkdown(block.text);
    }).join('');
};

const setResultHtml = (html) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    resultText.replaceChildren(...doc.body.childNodes);
};

const setStatus = (text, isError = false) => {
    statusText.textContent = text;
    statusText.style.color = isError ? '#b42318' : '#0f766e';
};

const startStream = () => {
    loader.style.display = 'block';
    resultContainer.style.display = 'block';
    rawContent = '';
    resultText.textContent = '';
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
        resultText.textContent = '';
        setStatus('Streaming...');
        stopButton.disabled = false;
        copyButton.disabled = true;
        return;
    }

    if (message.type === 'stream-delta') {
        loader.style.display = 'none';
        rawContent += message.delta || '';
        setResultHtml(renderMarkdown(rawContent));
        copyButton.disabled = rawContent.trim().length === 0;
        return;
    }

    if (message.type === 'stream-complete') {
        loader.style.display = 'none';
        if (!rawContent && message.fullText) {
            rawContent = message.fullText;
        }
        setResultHtml(renderMarkdown(rawContent));
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
