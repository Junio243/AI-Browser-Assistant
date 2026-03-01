// ============================================================
//  AI Browser Assistant — Background Service Worker v2.5
//  Flash Lite optimized: JPEG 70% screenshots, Safety gate
// ============================================================

import { VisionEngine } from './ai/vision.js';

let visionEngine = null;
let debuggerAttached = new Set(); // tabIds with attached debugger

// ── Init vision engine from storage ─────────────────────────
async function getVision() {
    if (visionEngine) return visionEngine;
    const data = await chrome.storage.local.get(['apiKey', 'model']);
    if (data.apiKey) {
        visionEngine = new VisionEngine(data.apiKey, data.model || 'gemini-2.5-flash-lite-preview-09-2025');
    }
    return visionEngine;
}

// ── Open side panel on icon click ───────────────────────────
chrome.action.onClicked.addListener(async (tab) => {
    await chrome.sidePanel.open({ tabId: tab.id });
});

// ── Message router ───────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender).then(sendResponse).catch((err) => {
        console.error('[BG] Error:', err);
        sendResponse({ error: err.message });
    });
    return true;
});

async function handleMessage(message, sender) {
    const { type, payload } = message;
    switch (type) {
        case 'EXECUTE_TOOL': return await dispatchTool(payload.tool, payload.args, payload.tabId);
        case 'GET_TABS': return await getTabsList();
        case 'NAVIGATE': return await navigateTab(payload.tabId, payload.url);
        case 'OPEN_TAB': return await openNewTab(payload.url);
        case 'CLOSE_TAB': return await closeTab(payload.tabId);
        case 'SWITCH_TAB': return await switchToTab(payload.tabId);
        case 'TAKE_SCREENSHOT': return await takeScreenshot(payload.tabId);
        case 'SCHEDULE_TASK': return await scheduleTask(payload);
        case 'DELETE_ALARM': return await deleteAlarm(payload.name);
        case 'LIST_ALARMS': return await listAlarms();
        case 'REPLAY_WORKFLOW': return await replayWorkflow(payload.steps, payload.tabId);
        default: return { error: `Unknown type: ${type}` };
    }
}

// ── Tool dispatcher ──────────────────────────────────────────
const CONTENT_TOOLS = ['read_page', 'click_element', 'fill_input', 'scroll_page', 'get_console_logs', 'highlight_element'];

async function dispatchTool(tool, args, tabId) {
    if (CONTENT_TOOLS.includes(tool)) {
        return await runInContentScript(tabId, tool, args);
    }
    switch (tool) {
        case 'navigate': return await navigateTab(tabId, args.url);
        case 'open_tab': return await openNewTab(args.url);
        case 'close_tab': return await closeTab(args.tab_id || tabId);
        case 'switch_tab': return await switchToTab(args.tab_id);
        case 'list_tabs': return await getTabsList();
        case 'take_screenshot': return await takeScreenshot(args.tab_id || tabId);
        case 'vision_click': return await visionClick(args, tabId);
        case 'vision_read': return await visionRead(args, tabId);
        case 'wait':
            await new Promise(r => setTimeout(r, (args.seconds || 1) * 1000));
            return { success: true };
        default: return { error: `Unknown tool: ${tool}` };
    }
}

// ── Content script runner ────────────────────────────────────
async function runInContentScript(tabId, tool, args) {
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: (t, a) => window.__AI_ASSISTANT__?.execute(t, a) || { error: 'Content script not ready' },
            args: [tool, args],
        });
        return results[0]?.result || { error: 'No result' };
    } catch (err) {
        return { error: err.message };
    }
}

// ── Tab management ───────────────────────────────────────────
async function getTabsList() {
    const tabs = await chrome.tabs.query({});
    return { tabs: tabs.map(t => ({ id: t.id, url: t.url, title: t.title, active: t.active, windowId: t.windowId })) };
}

async function navigateTab(tabId, url) {
    if (!url.startsWith('http')) url = 'https://' + url;
    await chrome.tabs.update(tabId, { url });
    await new Promise((resolve) => {
        const listener = (id, info) => {
            if (id === tabId && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(resolve, 8000);
    });

    // Re-inject orange border on the new page (agent is still in control)
    await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.__AI_ASSISTANT__?.execute('agent_start', {}),
    }).catch(() => { });

    return { success: true, url };
}

async function openNewTab(url) {
    if (url && !url.startsWith('http')) url = 'https://' + url;
    const tab = await chrome.tabs.create({ url: url || 'chrome://newtab' });
    return { success: true, tabId: tab.id };
}

async function closeTab(tabId) {
    await chrome.tabs.remove(tabId);
    return { success: true };
}

async function switchToTab(tabId) {
    await chrome.tabs.update(tabId, { active: true });
    return { success: true };
}

async function takeScreenshot(tabId) {
    try {
        const tab = await chrome.tabs.get(tabId);
        // JPEG 70%: ~60% smaller than PNG, optimal for Flash Lite latency
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
        return { success: true, screenshot: dataUrl };
    } catch (err) {
        return { error: err.message };
    }
}

// ── Vision Tools ─────────────────────────────────────────────

// vision_click: take screenshot → find coordinates → click via debugger
async function visionClick(args, tabId) {
    const { element_description } = args;
    if (!element_description) return { error: 'element_description é obrigatório' };

    // 1. Screenshot
    const shot = await takeScreenshot(tabId);
    if (shot.error) return { error: `Screenshot falhou: ${shot.error}` };

    // 2. Get viewport size
    const viewportResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({ width: window.innerWidth, height: window.innerHeight }),
    });
    const viewport = viewportResults[0]?.result || { width: 1280, height: 800 };

    // 3. Vision: find coordinates
    const vision = await getVision();
    if (!vision) return { error: 'Vision engine não inicializado (verifique API Key)' };

    const coords = await vision.getClickCoordinates(
        shot.screenshot, element_description, viewport.width, viewport.height
    );
    if (coords.error) return coords;

    // 4. Animate cursor on the page before clicking
    await chrome.scripting.executeScript({
        target: { tabId },
        func: (x, y) => window.__AI_ASSISTANT__?.execute('animate_cursor', { x, y }),
        args: [coords.x, coords.y],
    }).catch(() => { });
    // Wait for animation to complete (~650ms)
    await new Promise(r => setTimeout(r, 700));

    // 5. Click via Chrome Debugger API
    return await clickViaDebugger(tabId, coords.x, coords.y, coords.description);
}

async function clickViaDebugger(tabId, x, y, description) {
    try {
        // Attach debugger if not already
        if (!debuggerAttached.has(tabId)) {
            await chrome.debugger.attach({ tabId }, '1.3');
            debuggerAttached.add(tabId);
        }

        // Dispatch mouse events: move → press → release
        const baseEvent = { button: 'left', buttons: 1, clickCount: 1, x, y };

        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { ...baseEvent, type: 'mouseMoved' });
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { ...baseEvent, type: 'mousePressed' });
        await new Promise(r => setTimeout(r, 80));
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { ...baseEvent, type: 'mouseReleased' });

        // Detach after use
        await chrome.debugger.detach({ tabId });
        debuggerAttached.delete(tabId);

        return {
            success: true,
            coordinates: { x, y },
            element: description,
            method: 'vision+debugger',
        };
    } catch (err) {
        debuggerAttached.delete(tabId);
        return { error: `Debugger click falhou: ${err.message}` };
    }
}

// vision_read: screenshot → extract structured data via vision
async function visionRead(args, tabId) {
    const shot = await takeScreenshot(tabId);
    if (shot.error) return { error: shot.error };

    const vision = await getVision();
    if (!vision) return { error: 'Vision engine não inicializado' };

    const question = args.question || 'Descreva o conteúdo visível nesta página de forma detalhada.';
    const result = await vision.analyzeScreenshot(shot.screenshot, question);
    return { success: true, analysis: result };
}

// Detach debugger if tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
    if (debuggerAttached.has(tabId)) {
        chrome.debugger.detach({ tabId }).catch(() => { });
        debuggerAttached.delete(tabId);
    }
});

// ── Proactive Intent Detection ────────────────────────────────

// Map of URL patterns to intent types + suggestions
const INTENT_PATTERNS = [
    { pattern: /mail\.google\.com|outlook\.com|webmail/i, intent: 'email', suggestion: 'Percebi que você está no seu e-mail. Posso ajudar a organizar mensagens, redigir respostas ou agendar reuniões.' },
    { pattern: /calendar\.google\.com/i, intent: 'calendar', suggestion: 'Você está no Google Calendar. Posso verificar sua agenda, criar eventos ou encontrar horários livres.' },
    { pattern: /drive\.google\.com/i, intent: 'drive', suggestion: 'Você está no Google Drive. Posso organizar arquivos, criar pastas temáticas ou identificar duplicatas.' },
    { pattern: /docs\.google\.com\/spreadsheets/i, intent: 'spreadsheet', suggestion: 'Detectei uma planilha. Posso extrair os dados, analisá-los ou preencher informações automaticamente.' },
    { pattern: /nota.*fiscal|nfe\.|sefaz|nfce|receita\.federal/i, intent: 'invoice', suggestion: 'Você está num portal fiscal. Posso extrair dados das notas fiscais e organizá-los numa planilha.' },
    { pattern: /github\.com|gitlab\.com/i, intent: 'code', suggestion: 'Você está num repositório de código. Posso resumir issues, revisar PRs ou buscar informações no código.' },
    { pattern: /linkedin\.com/i, intent: 'linkedin', suggestion: 'Você está no LinkedIn. Posso pesquisar perfis, redigir mensagens ou analisar vagas.' },
    { pattern: /amazon\.com|mercadolivre|shopee|magalu/i, intent: 'ecommerce', suggestion: 'Você está numa loja. Posso comparar preços, ler avaliações ou adicionar itens ao carrinho.' },
    { pattern: /youtube\.com/i, intent: 'youtube', suggestion: 'Você está no YouTube. Posso transcrever vídeos, resumir conteúdos ou buscar vídeos específicos.' },
    { pattern: /meet\.google\.com|zoom\.us|teams\.microsoft/i, intent: 'meeting', suggestion: 'Você está numa plataforma de reunião. Posso registrar anotações, criar pauta ou enviar invites.' },
];

let lastProactiveUrl = '';
let lastProactiveTime = 0;
const PROACTIVE_COOLDOWN = 5 * 60 * 1000; // 5 min between same-URL suggestions

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url || !tab.active) return;
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

    const now = Date.now();

    // ── 1. Proactive suggestion (intent-based) ────────────────────
    if (!(tab.url === lastProactiveUrl && now - lastProactiveTime < PROACTIVE_COOLDOWN)) {
        for (const { pattern, intent, suggestion } of INTENT_PATTERNS) {
            if (pattern.test(tab.url)) {
                const cfg = await chrome.storage.local.get('proactiveMode');
                if (cfg.proactiveMode === false) break;
                lastProactiveUrl = tab.url;
                lastProactiveTime = now;
                chrome.runtime.sendMessage({
                    type: 'PROACTIVE_SUGGESTION',
                    payload: { intent, suggestion, url: tab.url, tabId },
                }).catch(() => { });
                break;
            }
        }
    }

    // ── 2. Auto-Workflow trigger ──────────────────────────────────
    // Check if any saved workflow has an autoTrigger matching current URL
    const wfData = await chrome.storage.local.get('workflows');
    const wfs = wfData.workflows || {};
    for (const [name, wf] of Object.entries(wfs)) {
        if (wf.autoTrigger && tab.url.includes(wf.autoTrigger)) {
            // Only once per tab navigation (avoid loops)
            const runKey = `wf_autorun_${tabId}_${name}`;
            const ran = await chrome.storage.session?.get?.(runKey).catch(() => ({})) || {};
            if (ran[runKey]) continue;
            await chrome.storage.session?.set?.({ [runKey]: true }).catch(() => { });

            chrome.runtime.sendMessage({
                type: 'AUTO_RUN_WORKFLOW',
                payload: { name, steps: wf.steps, tabId },
            }).catch(() => { });
            break;
        }
    }

    // ── 3. Auto-Memory capture ────────────────────────────────────
    // Silently read the page and store a summary for recognized pages
    for (const { pattern, intent } of INTENT_PATTERNS) {
        if (pattern.test(tab.url)) {
            // Cooldown: only capture once per URL per session
            const memKey = `mem_autocap_${tabId}`;
            const memData = await chrome.storage.session?.get?.(memKey).catch(() => ({})) || {};
            if (memData[memKey] === tab.url) break;
            await chrome.storage.session?.set?.({ [memKey]: tab.url }).catch(() => { });

            // Wait 2.5s for page to fully render, then read
            setTimeout(async () => {
                try {
                    const results = await chrome.scripting.executeScript({
                        target: { tabId },
                        func: () => window.__AI_ASSISTANT__?.execute('read_page', {}),
                    });
                    const page = results?.[0]?.result;
                    if (page?.title && page?.bodyText) {
                        chrome.runtime.sendMessage({
                            type: 'AUTO_STORE_MEMORY',
                            payload: {
                                memType: 'page_summary',
                                content: `[${intent}] ${page.title}\n${page.bodyText.slice(0, 500)}`,
                                url: tab.url,
                                title: page.title,
                            },
                        }).catch(() => { });
                    }
                } catch { }
            }, 2500);
            break;
        }
    }
});


// ── Scheduler (Chrome Alarms) ────────────────────────────────
async function scheduleTask({ name, task, periodInMinutes, when }) {
    await chrome.storage.local.set({ [`alarm_task_${name}`]: { task, name } });
    const alarmInfo = {};
    if (when) alarmInfo.when = when;
    if (periodInMinutes) alarmInfo.periodInMinutes = periodInMinutes;
    if (!when && !periodInMinutes) alarmInfo.when = Date.now() + 60000;
    await chrome.alarms.create(name, alarmInfo);
    return { success: true, name };
}

async function deleteAlarm(name) {
    await chrome.alarms.clear(name);
    await chrome.storage.local.remove(`alarm_task_${name}`);
    return { success: true };
}

async function listAlarms() {
    const alarms = await chrome.alarms.getAll();
    const storage = await chrome.storage.local.get(null);
    return {
        alarms: alarms.map(a => ({
            name: a.name,
            scheduledTime: new Date(a.scheduledTime).toLocaleString(),
            periodInMinutes: a.periodInMinutes,
            task: storage[`alarm_task_${a.name}`]?.task || '',
        }))
    };
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
    const data = await chrome.storage.local.get(`alarm_task_${alarm.name}`);
    const taskData = data[`alarm_task_${alarm.name}`];
    if (!taskData) return;

    // ── Auto-open side panel so task executes even if panel was closed ──
    try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab?.id) {
            await chrome.sidePanel.open({ tabId: activeTab.id });
        }
    } catch { }

    // Give panel 1.5s to initialize, then send the task
    setTimeout(() => {
        chrome.runtime.sendMessage({
            type: 'RUN_SCHEDULED_TASK',
            payload: { task: taskData.task, alarmName: alarm.name }
        }).catch(() => { });
    }, 1500);
});

// ── Workflow replay ──────────────────────────────────────────
async function replayWorkflow(steps, tabId) {
    for (const step of steps) {
        await new Promise(r => setTimeout(r, step.delay || 500));
        if (step.type === 'click') await runInContentScript(tabId, 'click_element', { selector: step.selector });
        else if (step.type === 'input') await runInContentScript(tabId, 'fill_input', { selector: step.selector, value: step.value });
        else if (step.type === 'navigate') await navigateTab(tabId, step.url);
    }
    return { success: true, stepsExecuted: steps.length };
}

console.log('[AI Browser Assistant v2.5 Flash Lite] Background worker started');

