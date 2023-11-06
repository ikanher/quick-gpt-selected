const extensionId = 'quick-gpt-selected';
const notificationId = `${extensionId}-notification`;
const translationURL = 'https://translate.googleapis.com';

const briefSystemMessage = 'You are a helpful assistant. Your response must be very brief and concise, try not to use more than 100 chars.';
const verboseSystemMessage = 'You are a helpful assistant. Your response must be detailed and comprehensive.';

const callGPTAPI = async (query, prompt, systemMessage, maxTokens, temperature) => {
    const openAIKey = await getOpenAIKey();
    if (!openAIKey) {
        notify('Error: OpenAI API key is not set.');
        return null;
    }

    const data = {
        model: "gpt-3.5-turbo",
        messages: [
            {"role": "system", "content": systemMessage},
            {"role": "user", "content": `${prompt}\n\n${query}`}
        ],
        max_tokens: parseInt(maxTokens, 10),
        temperature: parseFloat(temperature)
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openAIKey}`
        },
        body: JSON.stringify(data)
    });

    if (!response.ok) {
        throw new Error(`Network response was not ok: ${response.status}`);
    }

    return response.json();
};

const getOpenAIKey = async () => {
    const res = await browser.storage.local.get('openAIKey');
    return res.openAIKey;
};

const displayResult = async (query, prompt) => {
    // Show loading notification
    notify('Fetching result...', '', true);

    try {
        const res = await browser.storage.local.get(['maxTokens', 'temperature']);
        const responseData = await callGPTAPI(query, prompt, briefSystemMessage, res.maxTokens, res.temperature);

        // Hide loading notification
        browser.notifications.clear(notificationId);

        if (responseData && responseData.choices && responseData.choices.length > 0) {
            const briefResult = responseData.choices[0].message.content.trim();
            notificationMsg = briefResult + '\n' + 'Click for more...'
            notify(notificationMsg, query, prompt); // Update with the result
        } else {
            notify('Error: No result from GPT.'); // Update with the error message
        }
    } catch (error) {
        console.error('Error fetching result from GPT:', error);
        notify('Error fetching result from GPT.'); // Update with the error message
    }
};

const displayVerboseResult = async (query, prompt, windowId) => {
    try {
        const res = await browser.storage.local.get(['maxTokens', 'temperature']);
        const responseData = await callGPTAPI(query, prompt, verboseSystemMessage, res.maxTokens, res.temperature);

        if (responseData && responseData.choices && responseData.choices.length > 0) {
            console.log('displayVerboseResult we got responseData:', responseData);
            const verboseResult = responseData.choices[0].message.content.trim();

            // Find the tab within the created window
            const tabs = await browser.tabs.query({ windowId: windowId });
            if (tabs.length > 0) {
                // Send the message to the content script of the tab
                browser.tabs.sendMessage(tabs[0].id, { verboseResult: verboseResult }).catch(error => {
                    console.error('Error sending message to popup tab:', error);
                });
            }
        } else {
            console.error('Error: No verbose result from GPT.');
        }
    } catch (error) {
        console.error('Error fetching verbose result from GPT:', error);
    }
};

const notify = (message, isLoading = false) => {
    const title = isLoading ? 'Loading data...' : 'GPT Result';

    browser.notifications.create(notificationId, {
        'type': 'basic',
        'title': title,
        'message': message
    });
};

browser.notifications.onClicked.addListener(async (id) => {
    if (id === notificationId) {
        // Open the resultPopup.html immediately
        const popupURL = browser.runtime.getURL('resultPopup.html');
        const window = await browser.windows.create({
            url: popupURL,
            type: 'popup',
            width: 600,
            height: 300
        });

        // Retrieve the query and prompt from storage
        const storedData = await browser.storage.local.get(notificationId);
        const { query, prompt } = storedData[notificationId];

        // Call the function to fetch verbose result and send to the popup
        displayVerboseResult(query, prompt, window.id);
    }
});

const updateContextMenu = (prompts) => {
    // Remove all existing menu items to avoid duplicates
    browser.contextMenus.removeAll(() => {
        if (browser.runtime.lastError) {
            console.error(`Error removing context menus: ${browser.runtime.lastError}`);
        }

        if (prompts.length === 1) {
            // If there is only one prompt, create a single menu item
            browser.contextMenus.create({
                id: extensionId,
                title: 'Quick GPT Selected',
                contexts: ['selection'],
                onclick: (info, tab) => displayResult(info.selectionText, prompts[0].prompt)
            }, () => {
                if (browser.runtime.lastError) {
                    console.error(`Error creating context menu: ${browser.runtime.lastError}`);
                }
            });
        } else if (prompts.length > 1) {
            // If there are multiple prompts, create a parent item with children
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
                        onclick: (info, tab) => displayResult(info.selectionText, prompt.prompt)
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

// Load prompts from storage and update the context menu accordingly
browser.storage.local.get('prompts').then((res) => {
    const prompts = res.prompts || [];
    updateContextMenu(prompts);
});
