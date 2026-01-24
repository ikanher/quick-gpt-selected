const extensionId = 'quick-gpt-selected';
const DEBUG_STREAM = false;

const briefSystemMessage = 'You are a helpful assistant. Your response must be very brief and concise, try not to use more than 100 chars.';
const verboseSystemMessage = 'You are a helpful assistant. Your response must be detailed and comprehensive.';

const defaultOptions = {
    maxTokens: '300',
    temperature: '0.7',
    model: 'gpt-4o-mini'
};

const defaultPrompt = {
    name: 'Explain concept',
    prompt: 'Please, explain this concept to me:'
};

const normalizePrompts = (prompts) => {
    if (!Array.isArray(prompts)) {
        return [];
    }
    return prompts.filter((prompt) => prompt && prompt.name && prompt.prompt);
};

const requests = new Map();
const subscribers = new Map();
const portRequestIds = new Map();
const cleanupTimers = new Map();
const activeInlineByTabId = new Map();
let latestRequestId = null;
let hasLoggedStreamSample = false;
let hasLoggedStreamMeta = false;
let streamEventCount = 0;

const createRequestId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const getOpenAIKey = async () => {
    const res = await browser.storage.local.get('openAIKey');
    return res.openAIKey;
};

const getStoredOptions = async () => {
    const res = await browser.storage.local.get(['maxTokens', 'temperature', 'model']);
    return {
        maxTokens: res.maxTokens || defaultOptions.maxTokens,
        temperature: res.temperature || defaultOptions.temperature,
        model: res.model || defaultOptions.model
    };
};

const ensureInlineOverlay = async (tabId) => {
    try {
        await browser.tabs.sendMessage(tabId, { type: 'inline-ping' });
    } catch (error) {
        try {
            await browser.tabs.executeScript(tabId, { file: 'inlineOverlay.js' });
        } catch (injectError) {
            console.error('Failed to inject inline overlay:', injectError);
        }
    }
};

const extractTextFromContent = (content) => {
    if (!content) {
        return '';
    }
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content.map((part) => {
            if (!part) {
                return '';
            }
            if (typeof part === 'string') {
                return part;
            }
            if (part.type === 'output_text' && typeof part.text === 'string') {
                return part.text;
            }
            return '';
        }).join('');
    }
    return '';
};

const extractTextFromResponse = (response) => {
    if (!response) {
        return '';
    }
    if (typeof response.output_text === 'string') {
        return response.output_text;
    }
    if (Array.isArray(response.output_text)) {
        return response.output_text.join('');
    }
    if (Array.isArray(response.output)) {
        return response.output
            .map((item) => {
                if (!item) {
                    return '';
                }
                if (item.type === 'message' && Array.isArray(item.content)) {
                    return extractTextFromContent(item.content);
                }
                return '';
            })
            .join('');
    }
    return '';
};

const extractTextFromEvent = (event) => {
    if (!event || typeof event.type !== 'string') {
        return '';
    }
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
        return event.delta;
    }
    if (event.type === 'response.text.delta' && typeof event.delta === 'string') {
        return event.delta;
    }
    if (event.type === 'response.output_text.done' && typeof event.text === 'string') {
        return event.text;
    }
    if ((event.type === 'response.output_item.added' || event.type === 'response.output_item.done')
        && event.item) {
        if (event.item.type === 'message' && Array.isArray(event.item.content)) {
            return extractTextFromContent(event.item.content);
        }
        if (Array.isArray(event.item.content)) {
            return extractTextFromContent(event.item.content);
        }
        if (typeof event.item.text === 'string') {
            return event.item.text;
        }
    }
    return '';
};

const broadcast = (requestId, message) => {
    const ports = subscribers.get(requestId);
    if (!ports) {
        return;
    }
    for (const port of ports) {
        try {
            port.postMessage(message);
        } catch (error) {
            // Ignore ports that have disconnected unexpectedly.
        }
    }
};

const attachSubscriber = (requestId, port) => {
    if (!subscribers.has(requestId)) {
        subscribers.set(requestId, new Set());
    }
    subscribers.get(requestId).add(port);
    portRequestIds.set(port, requestId);

    const request = requests.get(requestId);
    if (request) {
        port.postMessage({
            type: 'stream-start',
            requestId,
            promptName: request.promptName,
            query: request.query
        });
        if (request.fullText) {
            port.postMessage({
                type: 'stream-delta',
                requestId,
                delta: request.fullText,
                replay: true
            });
        }
        if (request.status === 'complete') {
            port.postMessage({
                type: 'stream-complete',
                requestId,
                fullText: request.fullText
            });
        } else if (request.status === 'error') {
            port.postMessage({
                type: 'stream-error',
                requestId,
                error: request.error || 'Request failed.'
            });
        } else if (request.status === 'aborted') {
            port.postMessage({
                type: 'stream-abort',
                requestId,
                reason: request.abortReason || 'Request cancelled.'
            });
        }
    }
};

const detachSubscriber = (port) => {
    const requestId = portRequestIds.get(port);
    if (!requestId) {
        return;
    }
    portRequestIds.delete(port);
    const ports = subscribers.get(requestId);
    if (ports) {
        ports.delete(port);
        if (!ports.size) {
            subscribers.delete(requestId);
        }
    }
};

const scheduleCleanup = (requestId) => {
    if (cleanupTimers.has(requestId)) {
        clearTimeout(cleanupTimers.get(requestId));
    }
    cleanupTimers.set(requestId, setTimeout(() => {
        requests.delete(requestId);
        subscribers.delete(requestId);
        cleanupTimers.delete(requestId);
    }, 5 * 60 * 1000));
};

const abortRequest = (requestId, reason) => {
    const request = requests.get(requestId);
    if (!request) {
        return;
    }
    if (request.controller) {
        request.controller.abort();
    }
    request.status = 'aborted';
    request.abortReason = reason;
    broadcast(requestId, { type: 'stream-abort', requestId, reason });
    scheduleCleanup(requestId);
};

const openPopup = async (requestId, parentTabId) => {
    const popupURL = browser.runtime.getURL(`resultPopup.html?requestId=${encodeURIComponent(requestId)}`);
    const createData = {
        url: popupURL,
        type: 'popup',
        width: 680,
        height: 540
    };

    let windowInfo = null;
    if (parentTabId != null) {
        try {
            const tab = await browser.tabs.get(parentTabId);
            windowInfo = await browser.windows.get(tab.windowId);
        } catch (error) {
            windowInfo = null;
        }
    }
    if (!windowInfo) {
        try {
            windowInfo = await browser.windows.getCurrent();
        } catch (error) {
            windowInfo = null;
        }
    }

    if (windowInfo && Number.isFinite(windowInfo.width) && Number.isFinite(windowInfo.height)) {
        const baseWidth = windowInfo.width;
        const baseHeight = windowInfo.height;
        const targetWidth = Math.min(baseWidth, Math.max(360, Math.round(baseWidth * 0.5)));
        const targetHeight = Math.max(360, baseHeight);
        const baseLeft = Number.isFinite(windowInfo.left) ? windowInfo.left : 0;
        const baseTop = Number.isFinite(windowInfo.top) ? windowInfo.top : 0;

        createData.width = targetWidth;
        createData.height = targetHeight;
        createData.left = baseLeft + Math.max(0, baseWidth - targetWidth);
        createData.top = baseTop;
    }

    try {
        await browser.windows.create(createData);
    } catch (error) {
        console.error('Failed to open popup:', error);
    }
};

const streamChatCompletion = async (requestId) => {
    const request = requests.get(requestId);
    if (!request) {
        return;
    }

    const openAIKey = await getOpenAIKey();
    if (!openAIKey) {
        request.status = 'error';
        request.error = 'OpenAI API key is not set.';
        broadcast(requestId, { type: 'stream-error', requestId, error: request.error });
        scheduleCleanup(requestId);
        return;
    }

    const maxTokens = parseInt(request.maxTokens, 10);
    const temperature = parseFloat(request.temperature);
    const resolvedMaxTokens = Number.isFinite(maxTokens) ? maxTokens : parseInt(defaultOptions.maxTokens, 10);
    const resolvedTemperature = Number.isFinite(temperature) ? temperature : parseFloat(defaultOptions.temperature);

    const supportsStreaming = typeof ReadableStream !== 'undefined' && typeof TextDecoder !== 'undefined';

    const data = {
        model: request.model,
        instructions: request.systemMessage,
        input: [
            { role: 'user', content: `${request.prompt}\n\n${request.query}` }
        ],
        text: {
            format: { type: 'text' }
        },
        stream: supportsStreaming,
        max_output_tokens: resolvedMaxTokens
    };

    request.status = 'streaming';
    broadcast(requestId, {
        type: 'stream-start',
        requestId,
        promptName: request.promptName,
        query: request.query
    });

    if (DEBUG_STREAM) {
        hasLoggedStreamSample = false;
        hasLoggedStreamMeta = false;
        streamEventCount = 0;
    }

    const controller = new AbortController();
    request.controller = controller;

    try {
        const response = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openAIKey}`
            },
            body: JSON.stringify(data),
            signal: controller.signal
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            const parsedError = (() => {
                try {
                    return JSON.parse(errorText || '{}');
                } catch (parseError) {
                    return null;
                }
            })();
            const parsedMessage = parsedError && parsedError.error && parsedError.error.message;
            throw new Error(`OpenAI error ${response.status}: ${parsedMessage || errorText || response.statusText}`);
        }

        return handleResponseStream(response, request, supportsStreaming, requestId);
    } catch (error) {
        if (controller.signal.aborted) {
            request.status = 'aborted';
            request.abortReason = 'Request cancelled.';
            broadcast(requestId, { type: 'stream-abort', requestId, reason: request.abortReason });
        } else {
            request.status = 'error';
            request.error = error.message || 'Request failed.';
            broadcast(requestId, { type: 'stream-error', requestId, error: request.error });
        }
        scheduleCleanup(requestId);
    }
};

const handleResponseStream = async (response, request, supportsStreaming, requestId) => {
    const contentType = response.headers.get('content-type') || '';
    const isEventStream = contentType.includes('text/event-stream');
    if (DEBUG_STREAM && !hasLoggedStreamMeta) {
        hasLoggedStreamMeta = true;
        console.log('Stream meta:', {
            status: response.status,
            contentType,
            supportsStreaming,
            hasBody: Boolean(response.body),
            isEventStream
        });
    }
    if (!supportsStreaming || !response.body || !isEventStream) {
        request.status = 'error';
        request.error = 'Streaming unavailable for this response.';
        broadcast(requestId, { type: 'stream-error', requestId, error: request.error });
        scheduleCleanup(requestId);
        return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let doneStreaming = false;

    while (!doneStreaming) {
        const { value, done } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) {
                continue;
            }
            const dataLine = trimmed.slice(5).trim();
            if (dataLine === '[DONE]') {
                doneStreaming = true;
                break;
            }
            let parsed;
            try {
                parsed = JSON.parse(dataLine);
            } catch (error) {
                continue;
            }
            if (DEBUG_STREAM && !hasLoggedStreamSample) {
                hasLoggedStreamSample = true;
                console.log('Stream sample payload:', parsed);
                console.log('Stream sample line:', dataLine.slice(0, 800));
            }
            if (DEBUG_STREAM) {
                streamEventCount += 1;
                if (streamEventCount <= 20) {
                    console.log('Stream event type:', parsed && parsed.type);
                }
                if (streamEventCount === 20) {
                    console.log('Stream event log capped at 20 events.');
                }
                if (parsed && (parsed.type === 'response.output_item.added' || parsed.type === 'response.output_item.done')) {
                    console.log('Stream output item:', parsed.item);
                }
                if (parsed && parsed.type === 'response.incomplete') {
                    console.log('Stream incomplete payload:', parsed);
                }
            }
            let delta = '';
            if (parsed && typeof parsed.type === 'string') {
                if (parsed.type === 'response.completed') {
                    const fullText = extractTextFromResponse(parsed.response).trim();
                    if (fullText) {
                        request.fullText = fullText;
                        broadcast(requestId, { type: 'stream-delta', requestId, delta: fullText });
                    }
                } else if (parsed.type === 'response.incomplete') {
                    const fullText = extractTextFromResponse(parsed.response).trim();
                    if (fullText) {
                        request.fullText = fullText;
                        broadcast(requestId, { type: 'stream-delta', requestId, delta: fullText });
                    } else {
                        const reason = parsed.response &&
                            parsed.response.incomplete_details &&
                            parsed.response.incomplete_details.reason
                            ? parsed.response.incomplete_details.reason
                            : 'unknown';
                        request.status = 'error';
                        request.error = `Response incomplete: ${reason}. Try increasing max output tokens.`;
                        broadcast(requestId, { type: 'stream-error', requestId, error: request.error });
                        scheduleCleanup(requestId);
                        return;
                    }
                } else if (parsed.type === 'error') {
                    request.status = 'error';
                    request.error = parsed.error && parsed.error.message ? parsed.error.message : 'Request failed.';
                    broadcast(requestId, { type: 'stream-error', requestId, error: request.error });
                    scheduleCleanup(requestId);
                    return;
                } else {
                    delta = extractTextFromEvent(parsed);
                }
            }
            if (parsed && parsed.type === 'response.output_item.done' && request.fullText) {
                delta = '';
            }
            if (delta) {
                request.fullText += delta;
                broadcast(requestId, {
                    type: 'stream-delta',
                    requestId,
                    delta
                });
            }
        }
    }

    if (!request.fullText) {
        request.status = 'error';
        request.error = 'No output returned from the model.';
        broadcast(requestId, { type: 'stream-error', requestId, error: request.error });
        scheduleCleanup(requestId);
        return;
    }

    request.status = 'complete';
    broadcast(requestId, { type: 'stream-complete', requestId, fullText: request.fullText });
    if (DEBUG_STREAM) {
        console.log('Stream complete. Text length:', request.fullText.length);
    }
    scheduleCleanup(requestId);
};

const startInlineRequest = async (query, prompt, promptName, tabId) => {
    if (tabId == null) {
        return;
    }
    const options = await getStoredOptions();
    const requestId = createRequestId();

    if (activeInlineByTabId.has(tabId)) {
        abortRequest(activeInlineByTabId.get(tabId), 'Replaced by a new request.');
    }
    activeInlineByTabId.set(tabId, requestId);

    requests.set(requestId, {
        id: requestId,
        query,
        prompt,
        promptName,
        systemMessage: briefSystemMessage,
        model: options.model,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        fullText: '',
        status: 'pending',
        createdAt: Date.now(),
        tabId
    });
    latestRequestId = requestId;

    await ensureInlineOverlay(tabId);
    try {
        await browser.tabs.sendMessage(tabId, {
            type: 'inline-start',
            requestId,
            promptName
        });
    } catch (error) {
        console.error('Failed to start inline overlay:', error);
    }

    streamChatCompletion(requestId);
};

const startVerboseRequest = async (parentRequestId) => {
    const parentRequest = requests.get(parentRequestId);
    if (!parentRequest) {
        console.error('Unable to start verbose request without a parent.');
        return;
    }

    const requestId = createRequestId();
    requests.set(requestId, {
        id: requestId,
        query: parentRequest.query,
        prompt: parentRequest.prompt,
        promptName: parentRequest.promptName,
        systemMessage: verboseSystemMessage,
        model: parentRequest.model,
        maxTokens: parentRequest.maxTokens,
        temperature: parentRequest.temperature,
        fullText: '',
        status: 'pending',
        createdAt: Date.now(),
        parentId: parentRequestId
    });
    latestRequestId = requestId;

    await openPopup(requestId, parentRequest.tabId);
    streamChatCompletion(requestId);
};

browser.runtime.onConnect.addListener((port) => {
    port.onMessage.addListener((message) => {
        if (!message || !message.type) {
            return;
        }

        if (message.type === 'subscribe') {
            const resolvedRequestId = message.requestId === 'latest' ? latestRequestId : message.requestId;
            if (!resolvedRequestId) {
                port.postMessage({
                    type: 'stream-error',
                    requestId: message.requestId || 'latest',
                    error: 'No active request found.'
                });
                return;
            }
            attachSubscriber(resolvedRequestId, port);
            return;
        }

        if (message.type === 'cancel' && message.requestId) {
            abortRequest(message.requestId, 'Cancelled by user.');
        }
    });

    port.onDisconnect.addListener(() => {
        detachSubscriber(port);
    });
});

browser.runtime.onMessage.addListener((message, sender) => {
    if (!message || !message.type) {
        return;
    }

    if (message.type === 'refresh-context-menu' && Array.isArray(message.prompts)) {
        const prompts = normalizePrompts(message.prompts);
        updateContextMenu(prompts.length ? prompts : [defaultPrompt]);
        return;
    }

    if (message.type === 'request-verbose') {
        startVerboseRequest(message.requestId);
        return;
    }

    if (message.type === 'cancel' && message.requestId) {
        abortRequest(message.requestId, 'Cancelled by user.');
    }
});

const updateContextMenu = (prompts) => {
    browser.contextMenus.removeAll(() => {
        if (browser.runtime.lastError) {
            console.error(`Error removing context menus: ${browser.runtime.lastError}`);
        }

        if (prompts.length === 1) {
            browser.contextMenus.create({
                id: extensionId,
                title: 'Quick GPT Selected',
                contexts: ['selection'],
                onclick: (info, tab) => startInlineRequest(info.selectionText, prompts[0].prompt, prompts[0].name, tab.id)
            }, () => {
                if (browser.runtime.lastError) {
                    console.error(`Error creating context menu: ${browser.runtime.lastError}`);
                }
            });
        } else if (prompts.length > 1) {
            browser.contextMenus.create({
                id: extensionId,
                title: 'Quick GPT Selected',
                contexts: ['selection']
            }, () => {
                if (browser.runtime.lastError) {
                    console.error(`Error creating parent context menu: ${browser.runtime.lastError}`);
                }

                prompts.forEach((prompt, index) => {
                    browser.contextMenus.create({
                        id: `${extensionId}-${index}`,
                        parentId: extensionId,
                        title: prompt.name,
                        contexts: ['selection'],
                        onclick: (info, tab) => startInlineRequest(info.selectionText, prompt.prompt, prompt.name, tab.id)
                    }, () => {
                        if (browser.runtime.lastError) {
                            console.error(`Error creating child context menu: ${browser.runtime.lastError}`);
                        }
                    });
                });
            });
        }
    });
};

function handleStorageChange(changes, area) {
    if (area === 'local' && changes.prompts) {
        const nextPrompts = normalizePrompts(changes.prompts.newValue);
        updateContextMenu(nextPrompts.length ? nextPrompts : [defaultPrompt]);
    }
}

browser.storage.onChanged.addListener(handleStorageChange);

const loadPrompts = async () => {
    const local = await browser.storage.local.get('prompts');
    const localPrompts = normalizePrompts(local.prompts);
    if (localPrompts.length) {
        return localPrompts;
    }
    try {
        if (browser.storage && browser.storage.sync) {
            const synced = await browser.storage.sync.get('prompts');
            const syncedPrompts = normalizePrompts(synced.prompts);
            if (syncedPrompts.length) {
                await browser.storage.local.set({ prompts: syncedPrompts });
                return syncedPrompts;
            }
        }
    } catch (error) {
        console.error('Failed to read synced prompts:', error);
    }
    await browser.storage.local.set({ prompts: [defaultPrompt] });
    return [defaultPrompt];
};

const initContextMenus = async () => {
    try {
        const prompts = await loadPrompts();
        updateContextMenu(prompts);
    } catch (error) {
        console.error('Failed to initialize context menu:', error);
        updateContextMenu([defaultPrompt]);
    }
};

initContextMenus();
