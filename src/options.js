document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('options-form').addEventListener('submit', saveOptions);
document.getElementById('add-prompt').addEventListener('click', () => addPrompt());

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
        prompts
    }).then(() => {
        console.log('Options saved.');
    }).catch(error => {
        console.error('Error saving options:', error);
    });
}

function restoreOptions() {
    browser.storage.local.get({
        openAIKey: '',
        maxTokens: '300',
        temperature: '0.7',
        prompts: []
    }).then((res) => {
        document.querySelector('#openai-key').value = res.openAIKey;
        document.querySelector('#max-tokens').value = res.maxTokens;
        document.querySelector('#temperature').value = res.temperature;
        res.prompts.forEach(addPrompt);
    }).catch(error => {
        console.error('Error restoring options:', error);
    });
}

function addPrompt(prompt = { name: '', prompt: '' }) {
    const container = document.getElementById('prompts-container');
    const div = document.createElement('div');
    div.className = 'prompt-entry';
    div.innerHTML = `
        <input type="text" class="prompt-name" placeholder="Prompt Name" value="${prompt.name}">
        <textarea class="prompt-text" placeholder="Prompt...">${prompt.prompt}</textarea>
        <button type="button" class="remove-prompt">Remove</button>
    `;
    div.querySelector('.remove-prompt').addEventListener('click', function() {
        this.closest('.prompt-entry').remove();
    });
    container.appendChild(div);
}

// Call restoreOptions to populate the form when the page is loaded
restoreOptions();
