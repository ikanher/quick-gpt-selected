const extensionId = 'quick-gpt-selected';
const notificationId = `${extensionId}-notification`;
const translationURL = 'https://translate.googleapis.com';

const briefSystemMessage = 'You are a helpful assistant. Your response must be very brief and concise, try not to use more than 100 chars.';
const verboseSystemMessage = 'You are a helpful assistant. Your response must be detailed and comprehensive.';

const callGPTAPI = async (query, prompt, systemMessage, maxTokens, temperature, model) => {
    const openAIKey = await getOpenAIKey();
    if (!openAIKey) {
        notify('Error: OpenAI API key is not set.');
        return null;
    }

    const data = {
        model,
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
    notify('Fetching result...', query, prompt, true);

    try {
        const res = await browser.storage.local.get(['maxTokens', 'temperature', 'model']);
        const responseData = await callGPTAPI(query, prompt, briefSystemMessage, res.maxTokens, res.temperature, res.model);

        // Hide loading notification
        browser.notifications.clear(notificationId);

        if (responseData && responseData.choices && responseData.choices.length > 0) {
            const briefResult = responseData.choices[0].message.content.trim();
            notificationMsg = `${briefResult}\n\n---\nCLICK FOR MORE...`;
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
        const res = await browser.storage.local.get(['maxTokens', 'temperature', 'model']);
        const responseData = await callGPTAPI(query, prompt, verboseSystemMessage, res.maxTokens, res.temperature, res.model);

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

const notify = (message, query, prompt, isLoading = false) => {
    const title = isLoading ? 'Loading data...' : 'GPT Result';

    browser.notifications.create(notificationId, {
        'type': 'basic',
        'title': title,
        'message': message
    }).then(() => {
        if (!isLoading) {
            // Store the query and prompt in local storage for later retrieval
            browser.storage.local.set({ [notificationId]: { query, prompt } });
        }
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
    console.log('BUILDING MENU FROM PROMPTS:', prompts)
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
                    console.log(`Adding submenu: ${extensionId}-${index}`);
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

// This function is called when there is a change in the storage
function handleStorageChange(changes, area) {
  if (area === 'local' && changes.prompts) {
    // If there is a change in the prompts, update the context menu
    updateContextMenu(changes.prompts.newValue);
  }
}

// Add the storage change listener
browser.storage.onChanged.addListener(handleStorageChange);

// Load prompts from storage and update the context menu accordingly
browser.storage.local.get('prompts').then((res) => {
    const prompts = res.prompts || [];
    updateContextMenu(prompts);
});
