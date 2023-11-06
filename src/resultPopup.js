// resultPopup.js
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const loader = document.getElementById('loading');
  const resultContainer = document.getElementById('result');
  const verboseResultContainer = document.getElementById('verbose-result');

  // Check if there is an error message
  if (message.error) {
    loader.style.display = 'none';
    resultContainer.textContent = message.error;
  } else {
    // Hide the loader and show the result container
    loader.style.display = 'none';
    resultContainer.style.display = 'block';

    // Display the verbose response
    verboseResultContainer.textContent = message.verboseResult || 'No verbose response available.';
  }

  // Indicate that the message has been processed
  sendResponse({ status: 'Result displayed' });
  return true; // Keep the message channel open in case you need to send a response asynchronously
});
