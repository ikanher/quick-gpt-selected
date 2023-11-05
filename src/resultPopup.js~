document.addEventListener('DOMContentLoaded', () => {
    // Retrieve the result from local storage
    browser.storage.local.get('lastResult').then((res) => {
        const { briefSummary, fullResult } = res.lastResult || {};
        document.getElementById('briefSummary').textContent = briefSummary || 'No brief summary available.';
        document.getElementById('verboseResult').textContent = fullResult || 'No detailed response available.';
    });
});
