const extensionId = 'quick-gpt-selected';
const notificationId = `${extensionId}-notification`;
const translationURL = 'https://translate.googleapis.com';

const briefSystemMessage = 'You are a helpful assistant. Your response must be very brief and concise. Use the following response format: {"response": "<RESPONSE HERE>"};
const verboseSystemMessage = 'You are a helpful assistant. Your response must be detailed and comprehensive. Use the following response format: {"response": "<RESPONSE HERE>"};

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
    try {
        const res = await browser.storage.local.get(['maxTokens', 'temperature']);
        const responseData = await callGPTAPI(query, prompt, briefSystemMessage, res.maxTokens, res.temperature);
        if (responseData && responseData.choices && responseData.choices.length > 0) {
            const briefResult = responseData.choices[0].message.content.trim();
            notify(briefResult, query, prompt); // Pass the original query and prompt for later use
        } else {
            notify('Error: No result from GPT.');
        }
    } catch (error) {
        console.error('Error fetching result from GPT:', error);
        notify('Error fetching result from GPT.');
    }
};

const displayVerboseResult = async (query, prompt, notificationId) => {
    try {
        const res = await browser.storage.local.get(['maxTokens', 'temperature']);
        const responseData = await callGPTAPI(query, prompt, verboseSystemMessage, res.maxTokens, res.temperature);
        if (responseData && responseData.choices && responseData.choices.length > 0) {
            const verboseResult = responseData.choices[0].message.content.trim();
            // Open the resultPopup.html with the brief summary and verbose result
            browser.windows.create({
                url: browser.runtime.getURL('resultPopup.html'),
                type: 'popup',
                width: 400,
                height: 300
            }).then((window) => {
                // Communicate the results to the popup
                const resultData = { briefSummary, verboseResult };
                browser.runtime.sendMessage(window.id, resultData);
            });
        } else {
            notify('Error: No verbose result from GPT.');
        }
    } catch (error) {
        console.error('Error fetching verbose result from GPT:', error);
        notify('Error fetching verbose result from GPT.');
    }
};

const notify = (briefSummary, prompt) => {
    console.log(`Notify with message ${briefSummary}`);
    browser.notifications.create(notificationId, {
        'type': 'basic',
        'title': 'GPT Result',
        'message': briefSummary
    }).then(() => {
        // Store the brief summary and prompt in local storage for later retrieval
        browser.storage.local.set({ [notificationId]: { briefSummary, prompt } });
    });
};

browser.notifications.onClicked.addListener((id) => {
    if (id === notificationId) {
        // Retrieve the brief summary and prompt from storage
        browser.storage.local.get(notificationId).then((res) => {
            const { briefSummary, prompt } = res[notificationId];
            if (briefSummary && prompt) {
                // Fetch the verbose response using the prompt
                callGPTAPI(briefSummary, prompt, verboseSystemMessage)
                    .then(verboseResponse => {
                        // Open the popup window with the brief summary and verbose response
                        browser.windows.create({
                            url: browser.runtime.getURL('resultPopup.html'),
                            type: 'popup',
                            width: 400,
                            height: 300
                        }).then((window) => {
                            // You may need to communicate with the popup to pass the data
                            // This can be done using messaging or by setting the data in storage
                        });
                    })
                    .catch(error => {
                        console.error('Error fetching verbose result from GPT:', error);
                        // Handle error, maybe show a different notification
                    });
            }
        });
    }
});

const translateSelection = () => {
    browser.tabs.executeScript({ code: 'window.getSelection().toString();' })
        .then((selection) => {
            if (selection[0]) {
                displayResult(selection[0]);
            }
        });
};

const updateContextMenu = (prompts) => {
    // Remove all existing menu items to avoid duplicates
    console.log('!!!!!!!!!!!!! UPDATECONTEXTMENU CALLED, PROMPTS:', prompts)
    browser.contextMenus.removeAll(() => {
        if (browser.runtime.lastError) {
            console.error(`Error removing context menus: ${browser.runtime.lastError}`);
        }

        if (prompts.length === 1) {
            // If there is only one prompt, create a single menu item
            browser.contextMenus.create({
                id: extensionId,
                title: prompts[0].name,
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
