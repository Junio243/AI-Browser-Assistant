// Popup controller
(async () => {
    const dot = document.getElementById('dot');
    const statusMsg = document.getElementById('statusMsg');

    // Check API key status
    const data = await chrome.storage.local.get(['apiKey', 'autonomousMode']);

    if (data.apiKey) {
        dot.className = 'dot ok';
        statusMsg.textContent = `✓ Configurado · ${data.autonomousMode ? 'Modo Autônomo 🚀' : 'Modo Manual 🔒'}`;
    } else {
        dot.className = 'dot error';
        statusMsg.textContent = '⚠️ API Key não configurada';
    }

    // Open side panel
    document.getElementById('openPanel').addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.sidePanel.open({ tabId: tab.id });
        window.close();
    });

    // Open settings tab in side panel
    document.getElementById('openSettings').addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.sidePanel.open({ tabId: tab.id });
        // Post message to side panel to navigate to settings
        setTimeout(() => {
            chrome.runtime.sendMessage({ type: 'OPEN_SETTINGS_TAB' });
        }, 300);
        window.close();
    });
})();
