document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('options-form').addEventListener('submit', saveOptions);
document.getElementById('add-prompt').addEventListener('click', () => addPrompt());
document.getElementById('toggle-key').addEventListener('click', toggleKeyVisibility);

const saveStatus = document.getElementById('save-status');
const saveMessage = document.getElementById('save-message');
const modelSelect = document.getElementById('model');
const modelStatus = document.getElementById('model-status');
let saveTimeout = null;

// Define a default prompt
const defaultPrompt = {
    name: 'Explain concept',
    prompt: 'Please, explain this concept to me:'
};

const fallbackModels = [
    'gpt-4o-mini',
    'gpt-4o',
    'gpt-4.1-mini',
    'gpt-4.1'
];

function saveOptions(e) {
    e.preventDefault();
    const openAIKey = document.querySelector('#openai-key').value;
    const maxTokens = document.querySelector('#max-tokens').value;
    const temperature = document.querySelector('#temperature').value;
    const prompts = Array.from(document.querySelectorAll('.prompt-entry')).map(entry => ({
        name: entry.querySelector('.prompt-name').value,
        prompt: entry.querySelector('.prompt-text').value
    }));

    browser.storage.local.set({
        openAIKey,
        maxTokens,
        temperature,
        model: document.querySelector('#model').value,
        prompts
    }).then(() => {
        updateSaveStatus('Saved');
        browser.runtime.sendMessage({ type: 'refresh-context-menu', prompts }).catch(() => {});
    }).catch(error => {
        updateSaveStatus('Save failed', true);
        console.error('Error saving options:', error);
    });

    restoreOptions();
}

function restoreOptions() {
    browser.storage.local.get({
        openAIKey: '',
        maxTokens: '300',
        temperature: '0.7',
        model: 'gpt-4o-mini',
        prompts: []
    }).then((res) => {
        document.querySelector('#openai-key').value = res.openAIKey;
        document.querySelector('#max-tokens').value = res.maxTokens;
        document.querySelector('#temperature').value = res.temperature;
        loadModels(res.openAIKey, res.model);

        // Clear existing prompts before adding new ones
        document.getElementById('prompts-container').replaceChildren();

        if (!res.prompts.length) {
            addPrompt(defaultPrompt);
        } else {
            res.prompts.forEach(addPrompt);
        }
    }).catch(error => {
        updateSaveStatus('Failed to load settings', true);
        console.error('Error restoring options:', error);
    });
}

function addPrompt(prompt = { name: '', prompt: '' }) {
    const container = document.getElementById('prompts-container');
    const div = document.createElement('div');
    div.className = 'prompt-entry';
    const nameField = document.createElement('div');
    nameField.className = 'field';

    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Prompt name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'prompt-name';
    nameInput.placeholder = 'Explain concept';
    nameInput.value = prompt.name;

    nameField.appendChild(nameLabel);
    nameField.appendChild(nameInput);

    const textField = document.createElement('div');
    textField.className = 'field';

    const textLabel = document.createElement('label');
    textLabel.textContent = 'Prompt text';
    const textArea = document.createElement('textarea');
    textArea.className = 'prompt-text';
    textArea.placeholder = 'Please, explain this concept to me...';
    textArea.value = prompt.prompt;

    textField.appendChild(textLabel);
    textField.appendChild(textArea);

    const actions = document.createElement('div');
    actions.className = 'prompt-actions';

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn btn-danger remove-prompt';
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => {
        div.remove();
    });

    actions.appendChild(removeButton);
    div.appendChild(nameField);
    div.appendChild(textField);
    div.appendChild(actions);
    container.appendChild(div);
}

function toggleKeyVisibility() {
    const keyInput = document.getElementById('openai-key');
    const toggleButton = document.getElementById('toggle-key');
    if (keyInput.type === 'password') {
        keyInput.type = 'text';
        toggleButton.textContent = 'Hide';
    } else {
        keyInput.type = 'password';
        toggleButton.textContent = 'Show';
    }
}

async function loadModels(openAIKey, selectedModel) {
    if (!modelSelect || !modelStatus) {
        return;
    }

    modelStatus.textContent = openAIKey
        ? 'Loading fast, non-reasoning models...'
        : 'Add an API key to load curated models. Showing defaults.';

    if (!openAIKey) {
        setModelOptions(fallbackModels, selectedModel);
        return;
    }

    try {
        const response = await fetch('https://api.openai.com/v1/models', {
            headers: {
                Authorization: `Bearer ${openAIKey}`
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to load models (${response.status})`);
        }

        const data = await response.json();
        const ids = Array.isArray(data.data)
            ? data.data
                  .map((item) => item && item.id)
                  .filter((id) => typeof id === 'string' && isModernModelId(id))
            : [];

        const uniqueIds = Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
        if (uniqueIds.length) {
            const hasSelected = setModelOptions(uniqueIds, selectedModel);
            modelStatus.textContent = hasSelected
                ? `Loaded ${uniqueIds.length} curated models from OpenAI.`
                : `Loaded ${uniqueIds.length} curated models. Updated selection to ${modelSelect.value}.`;
            return;
        }

        {
            const hasSelected = setModelOptions(fallbackModels, selectedModel);
            modelStatus.textContent = hasSelected
                ? 'No curated models returned. Showing defaults.'
                : `No curated models returned. Updated selection to ${modelSelect.value}.`;
        }
    } catch (error) {
        {
            const hasSelected = setModelOptions(fallbackModels, selectedModel);
            modelStatus.textContent = hasSelected
                ? 'Could not load models. Showing defaults.'
                : `Could not load models. Updated selection to ${modelSelect.value}.`;
        }
        console.error('Error loading models:', error);
    }
}

function isModernModelId(modelId) {
    const normalized = modelId.toLowerCase();
    return normalized.startsWith('gpt-4o')
        || normalized.startsWith('gpt-4.1');
}

function setModelOptions(models, selectedModel) {
    modelSelect.replaceChildren();
    const normalized = models.filter(Boolean);
    const hasSelected = Boolean(selectedModel && normalized.includes(selectedModel));

    normalized.forEach((model) => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        modelSelect.appendChild(option);
    });

    const nextValue = selectedModel || normalized[0] || '';
    modelSelect.value = nextValue;
    if (!hasSelected) {
        modelSelect.value = normalized[0] || '';
    }
    return hasSelected;
}

function updateSaveStatus(text, isError = false) {
    if (saveStatus) {
        saveStatus.textContent = text;
        saveStatus.style.background = isError ? '#fdeceb' : '#e6f4f1';
        saveStatus.style.color = isError ? '#b42318' : '#0b5b55';
    }
    if (saveMessage) {
        saveMessage.textContent = text;
        saveMessage.style.color = isError ? '#b42318' : '#4b5563';
    }
    if (saveTimeout) {
        window.clearTimeout(saveTimeout);
    }
    saveTimeout = window.setTimeout(() => {
        if (saveMessage) {
            saveMessage.textContent = 'Changes are local to this browser.';
            saveMessage.style.color = '#4b5563';
        }
    }, 3000);
}

document.getElementById('openai-key').addEventListener('change', (event) => {
    loadModels(event.target.value, modelSelect.value);
});
