// ============================================================
//  AI Browser Assistant — Side Panel Controller v2
//  Full Autonomous Agent: ReAct + Planner + Memory + Vision + Proactivity
// ============================================================

import { GeminiChat, createChatClient } from '../ai/gemini.js';
import { AgentLoop } from '../ai/agent_loop.js';
import { Planner, isComplexTask } from '../ai/planner.js';
import { MemoryEngine, MEMORY_TYPES } from '../ai/memory.js';
import { SafetyInterceptor, riskBadge, RISK } from '../ai/safety.js';


// ── State ─────────────────────────────────────────────────────
let gemini = null;
let agentLoop = null;
let planner = null;
let memory = new MemoryEngine();
let safety = new SafetyInterceptor();
let isProcessing = false;
let autonomousMode = false;
let pendingApproval = null;
let pendingPlan = null;  // resolve fn for plan confirm
let recordedSteps = null;


// ── DOM refs ──────────────────────────────────────────────────
const messagesEl = document.getElementById('messages');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const autonomousToggle = document.getElementById('autonomousToggle');
const autoLabel = document.getElementById('autoLabel');
const approvalModal = document.getElementById('approvalModal');
const approvalBody = document.getElementById('approvalBody');
const approvalApprove = document.getElementById('approvalApprove');
const approvalDeny = document.getElementById('approvalDeny');
const proactiveBanner = document.getElementById('proactiveBanner');
const proactiveText = document.getElementById('proactiveText');
const proactiveIcon = document.getElementById('proactiveIcon');
const planView = document.getElementById('planView');
const planGoal = document.getElementById('planGoal');
const planStepsEl = document.getElementById('planSteps');

// ── Init ──────────────────────────────────────────────────────
async function init() {
    await memory.init();
    await loadSettings();
    await loadWorkflows();
    await loadAlarms();
    await loadMemoryTab();
    setupListeners();

    chrome.runtime.onMessage.addListener(async (msg) => {
        if (msg.type === 'RUN_SCHEDULED_TASK') {
            addMessage('assistant', `⏰ Executando tarefa agendada: **${msg.payload.alarmName}**`);
            processUserMessage(msg.payload.task);
        }
        if (msg.type === 'PROACTIVE_SUGGESTION') {
            showProactiveSuggestion(msg.payload);
        }
        // ── Auto-Workflow: roda automaticamente quando URL bate ───────────
        if (msg.type === 'AUTO_RUN_WORKFLOW') {
            const { name, steps, tabId } = msg.payload;
            showToast(`⚡ Workflow "${name}" iniciado automaticamente`);
            addMessage('assistant', `⚡ Executando workflow **${name}** automaticamente (URL correspondente detectada)...`);
            const resp = await chrome.runtime.sendMessage({
                type: 'REPLAY_WORKFLOW',
                payload: { steps, tabId },
            }).catch(() => null);
            if (resp?.success) {
                addMessage('assistant', `✅ Workflow **${name}** concluído automaticamente.`);
            } else {
                addMessage('assistant', `⚠️ Workflow **${name}** encontrou um problema ao executar.`);
            }
            await loadWorkflows();
        }
        // ── Auto-Memory: armazena páginas reconhecidas silenciosamente ───
        if (msg.type === 'AUTO_STORE_MEMORY') {
            const { memType, content, url, title } = msg.payload;
            await memory.store(memType, content, { url, title, importance: 2 });
            await loadMemoryTab();
            showToast('🧠 Página memorizada automaticamente');
        }
    });
}

// ── Settings ──────────────────────────────────────────────────
async function loadSettings() {
    const data = await chrome.storage.local.get(['apiKey', 'model', 'autonomousMode', 'theme']);
    // Apply saved theme first (no flash)
    applyTheme(data.theme || 'system');
    if (data.apiKey) {
        document.getElementById('apiKeyInput').value = data.apiKey;
        initAI(data.apiKey, data.model || 'gemini-2.5-flash-lite-preview-09-2025', data);
        setStatus('ok', 'Pronto');

    } else {
        setStatus('error', 'API Key não configurada');
    }
    if (data.model) document.getElementById('modelSelect').value = data.model;
    autonomousMode = data.autonomousMode || false;
    autonomousToggle.checked = autonomousMode;
    updateAutoLabel();
    document.querySelectorAll('input[name="execMode"]').forEach(r => {
        r.checked = r.value === (autonomousMode ? 'autonomous' : 'manual');
    });
    // Restore custom endpoint fields
    if (data.customEndpoint) document.getElementById('customEndpoint').value = data.customEndpoint;
    if (data.customModel) document.getElementById('customModel').value = data.customModel;
    if (data.customApiKey) document.getElementById('customApiKey').value = data.customApiKey;
}

function initAI(apiKey, model, opts = {}) {
    const { customEndpoint, customModel, customApiKey } = opts;
    // Use custom endpoint if configured, else Gemini
    gemini = createChatClient(customApiKey || apiKey, model, { customEndpoint, customModel });
    planner = new Planner(apiKey, model);
    safety = new SafetyInterceptor();

    agentLoop = new AgentLoop(gemini, async (tool, args) => {
        // ── Safety Gate ───────────────────────────────────
        const gate = await safety.intercept(tool, args, {
            autonomousMode,
            requestApprovalFn: ({ tool: t, args: a, risk, reason, urgent }) =>
                requestApproval(t, a, risk, reason, urgent),
            onBlock: ({ toolName, args: a, assessment, nonBlocking }) => {
                if (nonBlocking) {
                    const card = addToolCard(toolName, a, 'pending');
                    const badge = riskBadge(assessment.risk);
                    const note = card.querySelector('.tool-card-result');
                    if (note) note.textContent = `${badge.icon} ${badge.label}: ${assessment.reason}`;
                } else {
                    addMessage('assistant', `🛡️ **Ação bloqueada** \`${toolName}\`: ${assessment.reason}`);
                }
            },
        });
        if (!gate.allowed) {
            return { error: `BLOQUEADO: ${gate.reason}`, blocked: true };
        }
        const tab = await getCurrentTab();
        const result = await chrome.runtime.sendMessage({
            type: 'EXECUTE_TOOL',
            payload: { tool, args, tabId: tab.id },
        });
        return result;
    }, handleAgentUpdate);
}


async function saveSettings() {
    const apiKey = document.getElementById('apiKeyInput').value.trim();
    const model = document.getElementById('modelSelect').value;
    await chrome.storage.local.set({ apiKey, model, autonomousMode });
    if (apiKey) {
        const data = await chrome.storage.local.get(['customEndpoint', 'customModel', 'customApiKey']);
        initAI(apiKey, model, data);
        setStatus('ok', 'Pronto');
        showToast('✅ Configurações salvas!');
    }
}

// ── Event listeners ───────────────────────────────────────────
function setupListeners() {
    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
            if (btn.dataset.tab === 'memory') loadMemoryTab();
        });
    });

    document.getElementById('settingsBtn').addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-tab="settings"]').classList.add('active');
        document.getElementById('tab-settings').classList.add('active');
    });

    // Chat
    sendBtn.addEventListener('click', handleSend);
    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });
    userInput.addEventListener('input', () => {
        userInput.style.height = 'auto';
        userInput.style.height = Math.min(userInput.scrollHeight, 120) + 'px';
    });
    document.querySelectorAll('.suggestion-btn').forEach(btn => {
        btn.addEventListener('click', () => { userInput.value = btn.dataset.prompt; handleSend(); });
    });

    // Autonomous toggle (header)
    autonomousToggle.addEventListener('change', async () => {
        autonomousMode = autonomousToggle.checked;
        updateAutoLabel();
        document.querySelectorAll('input[name="execMode"]').forEach(r => { r.checked = r.value === (autonomousMode ? 'autonomous' : 'manual'); });
        await chrome.storage.local.set({ autonomousMode });
        showToast(autonomousMode ? '🚀 Modo Autônomo ativado' : '🔒 Modo Aprovação ativado');
    });

    // Settings radio
    document.querySelectorAll('input[name="execMode"]').forEach(radio => {
        radio.addEventListener('change', async () => {
            autonomousMode = radio.value === 'autonomous';
            autonomousToggle.checked = autonomousMode;
            updateAutoLabel();
            await chrome.storage.local.set({ autonomousMode });
            showToast(autonomousMode ? '🚀 Modo Autônomo' : '🔒 Modo Aprovação');
        });
    });

    // Approval modal
    approvalApprove.addEventListener('click', () => { pendingApproval?.(true); pendingApproval = null; approvalModal.classList.add('hidden'); });
    approvalDeny.addEventListener('click', () => { pendingApproval?.(false); pendingApproval = null; approvalModal.classList.add('hidden'); });

    // Proactive suggestion
    document.getElementById('proactiveYes').addEventListener('click', () => {
        const task = proactiveBanner.dataset.task;
        proactiveBanner.classList.add('hidden');
        if (task) { userInput.value = task; handleSend(); }
    });
    document.getElementById('proactiveNo').addEventListener('click', () => {
        proactiveBanner.classList.add('hidden');
    });

    // Plan view
    document.getElementById('planCancel').addEventListener('click', () => {
        pendingPlan?.(false); pendingPlan = null;
        planView.classList.add('hidden');
    });
    document.getElementById('planExecute').addEventListener('click', () => {
        pendingPlan?.(true); pendingPlan = null;
        planView.classList.add('hidden');
    });

    // settings actions
    document.getElementById('saveApiKey').addEventListener('click', saveSettings);
    document.getElementById('modelSelect').addEventListener('change', saveSettings);
    // Theme toggle 🌙/☀️
    document.getElementById('themeBtn').addEventListener('click', async () => {
        const current = document.documentElement.dataset.theme || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        await chrome.storage.local.set({ theme: next });
    });
    // Custom OpenAI endpoint
    document.getElementById('saveCustomEndpoint').addEventListener('click', async () => {
        const customEndpoint = document.getElementById('customEndpoint').value.trim();
        const customModel = document.getElementById('customModel').value.trim();
        const customApiKey = document.getElementById('customApiKey').value.trim();
        await chrome.storage.local.set({ customEndpoint, customModel, customApiKey });
        const data = await chrome.storage.local.get(['apiKey', 'model']);
        if (data.apiKey) initAI(data.apiKey, data.model, { customEndpoint, customModel, customApiKey });
        showToast(customEndpoint ? `🔌 Endpoint salvo: ${new URL(customEndpoint).hostname}` : '🔌 Voltando ao Gemini');
    });
    document.getElementById('clearChatBtn').addEventListener('click', () => {
        if (gemini) gemini.reset();
        if (agentLoop) agentLoop.reset();
        messagesEl.innerHTML = '';
        addWelcomeCard();
        showToast('Chat limpo');
    });
    document.getElementById('clearAllBtn').addEventListener('click', async () => {
        await chrome.storage.local.clear();
        await memory.clear();
        gemini = agentLoop = planner = null;
        setStatus('error', 'API Key não configurada');
        messagesEl.innerHTML = '';
        addWelcomeCard();
        showToast('Tudo limpo');
    });

    // Memory tab
    document.getElementById('clearMemoryBtn').addEventListener('click', async () => {
        await memory.clear();
        await loadMemoryTab();
        showToast('🧠 Memória limpa');
    });

    // Workflow tab
    document.getElementById('recordBtn').addEventListener('click', startRecording);
    document.getElementById('stopRecordBtn').addEventListener('click', stopRecording);
    document.getElementById('cancelSave').addEventListener('click', () => { document.getElementById('saveModal').classList.add('hidden'); recordedSteps = null; });
    document.getElementById('confirmSave').addEventListener('click', saveWorkflow);

    // Scheduler tab
    document.getElementById('newTaskBtn').addEventListener('click', () => { document.getElementById('schedulerForm').classList.toggle('hidden'); });
    document.getElementById('cancelTask').addEventListener('click', () => { document.getElementById('schedulerForm').classList.add('hidden'); });
    document.getElementById('saveTask').addEventListener('click', scheduleNewTask);
}

function updateAutoLabel() {
    autoLabel.textContent = autonomousMode ? 'Auto' : 'Manual';
    autoLabel.style.color = autonomousMode ? 'var(--accent)' : 'var(--text-3)';
}

// ── PROACTIVE SUGGESTION ──────────────────────────────────────
const PROACTIVE_TASKS = {
    email: 'Analise meu e-mail e me mostre as mensagens mais importantes',
    calendar: 'Verifique minha agenda de hoje e me mostre os próximos eventos',
    drive: 'Liste os arquivos recentes no meu Google Drive',
    spreadsheet: 'Extraia os dados desta planilha e me faça um resumo',
    invoice: 'Extraia os dados das notas fiscais desta página e organize em formato de tabela',
    code: 'Analise este repositório e me faça um resumo do projeto',
    linkedin: 'Analise este perfil/vaga do LinkedIn',
    ecommerce: 'Compare os preços e avaliações dos produtos desta página',
    youtube: 'Descreva o vídeo atual e extraia os pontos principais',
    meeting: 'Registre os pontos importantes desta reunião',
    bank: 'Analise o extrato e me mostre um resumo das movimentações',
};

const PROACTIVE_ICONS = {
    email: '📧', calendar: '📅', drive: '📁', spreadsheet: '📊', invoice: '🧾',
    code: '💻', linkedin: '💼', ecommerce: '🛒', youtube: '▶️', meeting: '🎤', bank: '🏦',
};

function showProactiveSuggestion({ intent, suggestion }) {
    proactiveBanner.dataset.task = PROACTIVE_TASKS[intent] || '';
    proactiveIcon.textContent = PROACTIVE_ICONS[intent] || '💡';
    proactiveText.textContent = suggestion;
    proactiveBanner.classList.remove('hidden');

    // Auto-hide after 20s
    setTimeout(() => proactiveBanner.classList.add('hidden'), 20000);
}

// ── CHAT HANDLER ──────────────────────────────────────────────
async function handleSend() {
    const text = userInput.value.trim();
    if (!text || isProcessing) return;
    if (!gemini) {
        addMessage('assistant', '⚠️ Configure sua **API Key** em ⚙️ Config primeiro.');
        document.querySelector('[data-tab="settings"]').click();
        return;
    }
    userInput.value = '';
    userInput.style.height = 'auto';
    addMessage('user', text);
    await processUserMessage(text);
}

async function processUserMessage(userGoal) {
    isProcessing = true;
    sendBtn.disabled = true;
    setStatus('busy', 'Pensando...');

    // Inject long-term memory context
    await injectMemoryContext(userGoal);

    // Detect complex task → show Plan View
    if (isComplexTask(userGoal) && planner) {
        const approved = await showPlanView(userGoal);
        if (!approved) {
            addMessage('assistant', 'Ok, cancelei o plano. Como posso ajudar de outra forma?');
            isProcessing = false;
            sendBtn.disabled = false;
            setStatus('ok', 'Pronto');
            return;
        }
    }

    // ── Capture tab before run ──────────────────────────────────
    const _activeTab = await getCurrentTab().catch(() => null);

    // Helper: send border cmd
    const _border = async (cmd) => {
        if (!_activeTab?.id) return;
        chrome.runtime.sendMessage({
            type: 'EXECUTE_TOOL',
            payload: { tool: cmd, args: {}, tabId: _activeTab.id },
        }).catch(() => { });
    };

    // ── Auto-start workflow recording ───────────────────────────
    if (_activeTab?.id) {
        chrome.tabs.sendMessage(_activeTab.id, { type: 'START_RECORDING' }).catch(() => { });
    }

    try {
        await _border('agent_start');
        await agentLoop.run(userGoal);

        // Auto-save memory from interaction
        const tab = await getCurrentTab().catch(() => _activeTab);
        await memory.extractAndStore(userGoal, '', tab?.url || '', tab?.title || '');
        await loadMemoryTab();

        const summary = agentLoop.getSummary();
        if (summary.selfHealed > 0) {
            addMessage('assistant', `✅ Tarefa concluída com **auto-recuperação** (${summary.selfHealed} erro(s) resolvido(s), ${summary.iterations} iterações)`);
        }
    } catch (err) {
        addMessage('assistant', `❌ Erro: ${err.message}`);
    } finally {
        await _border('agent_stop');

        // ── Auto-stop recording → save workflow + memory ────────
        if (_activeTab?.id) {
            try {
                const recResp = await chrome.tabs.sendMessage(
                    _activeTab.id, { type: 'STOP_RECORDING' }
                ).catch(() => null);

                const steps = recResp?.steps || [];

                if (steps.length > 0) {
                    // Build workflow name from goal (truncated)
                    const wfName = `⚡ ${userGoal.slice(0, 45)}${userGoal.length > 45 ? '…' : ''}`;
                    const autoTrigger = (_activeTab.url && !_activeTab.url.startsWith('chrome'))
                        ? new URL(_activeTab.url).hostname : '';

                    // Save as workflow
                    const wfData = await chrome.storage.local.get('workflows');
                    const wfs = wfData.workflows || {};
                    wfs[wfName] = {
                        name: wfName,
                        steps,
                        autoTrigger,
                        createdAt: new Date().toISOString(),
                        autoGenerated: true,  // flag: created by agent, not manually
                    };
                    await chrome.storage.local.set({ workflows: wfs });
                    await loadWorkflows();

                    // Save as workflow_learning memory
                    await memory.store(
                        MEMORY_TYPES.WORKFLOW,
                        `Sequência aprendida: "${userGoal.slice(0, 80)}" — ${steps.length} ação(ões) em ${autoTrigger || 'pagina desconhecida'}`,
                        { url: _activeTab.url || '', title: _activeTab.title || '', importance: 3 }
                    );
                    await loadMemoryTab();

                    showToast(`⚡ ${steps.length} ação(ões) memorizada(s) automaticamente`);
                }
            } catch { /* recording may fail on restricted pages */ }
        }

        isProcessing = false;
        sendBtn.disabled = false;
        setStatus('ok', 'Pronto');
    }
}


// ── Inject memory as context to Gemini ───────────────────────
async function injectMemoryContext(userGoal) {
    try {
        const tab = await getCurrentTab();

        // ── Semantic Cache: use cached page instead of re-processing ──
        if (tab?.url) {
            const cached = await memory.getCachedPage(tab.url);
            if (cached) {
                await gemini.sendMessage(
                    `[CACHE SEMÂNTICO - página já visitada]\nURL: ${tab.url}\nResumo em cache:\n${cached}\n(use este resumo se o usuário perguntar sobre a página atual)`,
                    null
                ).catch(() => { });
            }
        }

        // Inject long-term memory context as before
        const { contextBlock } = await memory.getContext(tab?.url || '', userGoal);
        if (contextBlock && gemini) {
            await gemini.sendMessage(
                `[CONTEXTO DE MEMÓRIA - não responda, apenas registre]\n${contextBlock}`,
                null
            );
        }
    } catch { }
}

// ── Plan View ─────────────────────────────────────────────────
async function showPlanView(userGoal) {
    setStatus('busy', 'Planejando...');
    try {
        const plan = await planner.createPlan(userGoal);
        planGoal.textContent = plan.goal?.slice(0, 60) || userGoal.slice(0, 60);
        planStepsEl.innerHTML = plan.steps.map(s => `
      <div class="plan-step pending" id="pstep-${s.id}" data-id="${s.id}">
        <div class="plan-step-num">${s.id}</div>
        <div class="plan-step-desc">${s.description}</div>
        <div class="plan-step-tool">${s.tool_hint || ''}</div>
      </div>
    `).join('');
        planView.classList.remove('hidden');
        // Store plan for later reference
        window.__currentPlan = plan;
    } catch {
        planView.classList.add('hidden');
        return true; // proceed anyway if planning fails
    }
    setStatus('ok', 'Pronto para executar');

    return new Promise(resolve => { pendingPlan = resolve; });
}

// ── AgentLoop UI callback ─────────────────────────────────────
function handleAgentUpdate(event) {
    switch (event.type) {
        case 'text':
            if (event.text?.trim()) addMessage('assistant', event.text);
            break;

        case 'tool_attempt': {
            const cardEl = addToolCard(event.tool, event.args, event.attempt > 1 ? 'healing' : 'pending');
            window.__lastToolCard = cardEl;
            setStatus('busy', `Executando: ${event.tool}...`);
            break;
        }

        case 'tool_result':
            if (window.__lastToolCard) {
                const status = event.result?.error ? 'error' : 'success';
                updateToolCard(window.__lastToolCard, status, event.result);

                // Handle screenshot inline display
                if (event.tool === 'take_screenshot' && event.result?.screenshot) {
                    const img = document.createElement('img');
                    img.src = event.result.screenshot;
                    img.className = 'screenshot-img';
                    window.__lastToolCard.appendChild(img);
                }
            }
            break;

        case 'tool_error':
            if (window.__lastToolCard) {
                window.__lastToolCard.className = 'tool-card healing';
            }
            break;

        case 'done': {
            const s = agentLoop.getSummary();
            const badge = document.createElement('div');
            badge.className = 'iter-badge';
            badge.textContent = `⚡ ${s.toolCalls} ações · ${s.iterations} iterações`;
            messagesEl.appendChild(badge);
            break;
        }

        case 'max_iterations':
            addMessage('assistant', `⚠️ Limite de iterações atingido (${event.iterations}). A tarefa pode estar incompleta.`);
            break;

        case 'error':
            addMessage('assistant', `❌ ${event.error}`);
            break;
    }
}

// ── Tool execution (for autonomous/approval modes) ────────────
const DESTRUCTIVE_TOOLS = ['navigate', 'close_tab', 'fill_input', 'click_element', 'vision_click'];

const TOOL_NAMES_PT = {
    read_page: 'Ler página', click_element: 'Clicar em elemento', fill_input: 'Preencher campo',
    navigate: 'Navegar', scroll_page: 'Rolar', open_tab: 'Nova aba', close_tab: 'Fechar aba',
    switch_tab: 'Trocar aba', list_tabs: 'Listar abas', take_screenshot: 'Screenshot',
    get_console_logs: 'Ler console', highlight_element: 'Destacar', wait: 'Aguardar',
    replay_workflow: 'Executar workflow', vision_click: 'Clique Visual (IA)', vision_read: 'Ler Visual (IA)',
};

function requestApproval(toolName, args, risk = RISK.MEDIUM, reason = '', urgent = false) {
    return new Promise(resolve => {
        pendingApproval = resolve;
        const badge = riskBadge(risk);
        const isDestructive = urgent || risk === RISK.CRITICAL || risk === RISK.HIGH;
        approvalBody.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="font-size:18px">${badge.icon}</span>
            <span style="font-size:11px;padding:2px 10px;border-radius:10px;background:${badge.color}22;color:${badge.color};font-weight:700;">${badge.label}</span>
          </div>
          <strong>${TOOL_NAMES_PT[toolName] || toolName}</strong><br/>
          <span style="font-size:11px;color:var(--text-3);">${reason}</span>
          <pre style="margin-top:8px;font-size:11px;color:var(--text-3);overflow:auto;max-height:100px;">${JSON.stringify(args, null, 2)}</pre>`;
        document.querySelector('.approval-warning').style.display = isDestructive ? '' : 'none';
        approvalModal.classList.remove('hidden');
    });
}


// ── Memory tab ────────────────────────────────────────────────
async function loadMemoryTab() {
    const all = await memory.getAll();
    const count = all.length;
    document.getElementById('memCount').textContent = `${count} memória(s) armazenada(s)`;

    const list = document.getElementById('memoryList');
    if (count === 0) {
        list.innerHTML = '<div class="empty-state">Nenhuma memória ainda.<br/>O agente aprende conforme você usa.</div>';
        return;
    }

    const typeIcons = { preference: '💡', extracted_data: '📊', page_summary: '📄', workflow_learning: '⚡', conversation: '💬' };

    list.innerHTML = all.reverse().map(m => `
    <div class="memory-item">
      <div class="memory-meta">
        <span class="memory-type-badge">${typeIcons[m.type] || '📝'} ${m.type.replace('_', ' ')}</span>
        <span class="memory-date">${new Date(m.created).toLocaleDateString('pt-BR')}</span>
      </div>
      <div class="memory-content">${m.content.slice(0, 200)}${m.content.length > 200 ? '…' : ''}</div>
      ${m.url ? `<div class="memory-url">🌐 ${m.url.slice(0, 60)}</div>` : ''}
      <button class="memory-del" data-id="${m.id}">🗑 remover</button>
    </div>
  `).join('');

    list.querySelectorAll('.memory-del').forEach(btn => {
        btn.addEventListener('click', async () => {
            await memory.forget(Number(btn.dataset.id));
            await loadMemoryTab();
        });
    });
}

// ── UI helpers ────────────────────────────────────────────────
function addMessage(role, text) {
    const div = document.createElement('div');
    div.className = `message ${role}`;
    const welcome = messagesEl.querySelector('.welcome-card');
    if (welcome) welcome.remove();

    const formatted = text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/`(.*?)`/g, '<code style="background:rgba(99,102,241,0.15);padding:1px 5px;border-radius:4px;font-size:12px;">$1</code>');

    div.innerHTML = `<div class="msg-bubble">${formatted}</div><span class="msg-time">${now()}</span>`;
    messagesEl.appendChild(div);
    div.scrollIntoView({ block: 'nearest' });
    return div;
}

function addTypingIndicator() {
    const div = document.createElement('div');
    div.className = 'message assistant typing-indicator';
    div.innerHTML = `<div class="msg-bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>`;
    messagesEl.appendChild(div);
    div.scrollIntoView({ block: 'nearest' });
    return div;
}

function addToolCard(tool, args, status = 'pending') {
    const icons = {
        read_page: '📄', click_element: '🖱️', fill_input: '⌨️', navigate: '🌐', scroll_page: '↕️',
        open_tab: '➕', close_tab: '✕', switch_tab: '🔄', list_tabs: '📑', take_screenshot: '📸',
        get_console_logs: '🔍', highlight_element: '💡', wait: '⏳', replay_workflow: '▶️',
        vision_click: '👁', vision_read: '🎨'
    };

    const div = document.createElement('div');
    div.className = `tool-card ${status}`;
    const argsStr = Object.keys(args || {}).length ? JSON.stringify(args, null, 2) : '(sem parâmetros)';
    div.innerHTML = `
    <div class="tool-card-header">${icons[tool] || '🔧'} ${TOOL_NAMES_PT[tool] || tool}</div>
    <div class="tool-card-args">${argsStr}</div>
    <div class="tool-card-result"></div>
  `;
    messagesEl.appendChild(div);
    div.scrollIntoView({ block: 'nearest' });
    return div;
}

function updateToolCard(cardEl, status, result) {
    cardEl.className = `tool-card ${status}`;
    const resultEl = cardEl.querySelector('.tool-card-result');
    if (result?.error) {
        resultEl.textContent = `Erro: ${result.error}`;
        resultEl.style.color = 'var(--danger)';
    } else if (result?.tabs) {
        resultEl.innerHTML = result.tabs.map(t => `<div>📑 <strong>${t.title?.slice(0, 40)}</strong></div>`).join('');
    } else if (result?.analysis) {
        resultEl.textContent = result.analysis.slice(0, 120);
    } else if (result?.coordinates) {
        resultEl.textContent = `Clique em (${result.coordinates.x}, ${result.coordinates.y}) — ${result.element}`;
    } else {
        resultEl.textContent = result?.bodyText
            ? `Lido: ${result.title} (${result.totalElements || 0} elementos)`
            : '✓ Concluído';
        resultEl.style.color = 'var(--success)';
    }
}

function addWelcomeCard() {
    messagesEl.innerHTML = `
    <div class="welcome-card">
      <div class="welcome-icon">🤖</div>
      <h2>Agente de IA Autônomo</h2>
      <p>Posso planejar, navegar, ver a tela, preencher formulários e lembrar de sessões anteriores.</p>
    </div>`;
}

function setStatus(type, text) { statusDot.className = `status-dot ${type}`; statusText.textContent = text; }
function now() { return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }

// ── Theme helper ───────────────────────────────────────────────
function applyTheme(themeName) {
    const isDark = themeName === 'dark' || (themeName === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const themeBtn = document.getElementById('themeBtn');

    if (isDark) {
        document.documentElement.classList.remove('theme-light');
        document.documentElement.dataset.theme = 'dark';
        if (themeBtn) themeBtn.textContent = '☀️';
    } else {
        document.documentElement.classList.add('theme-light');
        document.documentElement.dataset.theme = 'light';
        if (themeBtn) themeBtn.textContent = '🌙';
    }
}

// ── Helpers ───────────────────────────────────────────────────
function showToast(msg) {
    const toast = document.createElement('div');
    toast.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--bg-card);border:1px solid var(--border-hi);color:var(--text-1);padding:8px 16px;border-radius:20px;font-size:12px;z-index:999;animation:fadeSlide 0.3s ease;`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

async function getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
}

// ── Workflow recorder ─────────────────────────────────────────
async function startRecording() {
    const tab = await getCurrentTab();
    await chrome.tabs.sendMessage(tab.id, { type: 'START_RECORDING' });
    document.getElementById('recorderStatus').classList.remove('hidden');
    document.getElementById('recordBtn').disabled = true;
}

async function stopRecording() {
    const tab = await getCurrentTab();
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'STOP_RECORDING' });
    document.getElementById('recorderStatus').classList.add('hidden');
    document.getElementById('recordBtn').disabled = false;
    document.getElementById('stepCount').textContent = '0';
    recordedSteps = resp?.steps || [];
    if (recordedSteps.length === 0) { showToast('Nenhuma ação gravada'); return; }
    document.getElementById('saveStepsInfo').textContent = `${recordedSteps.length} ação(ões) gravada(s)`;
    document.getElementById('workflowName').value = '';
    document.getElementById('saveModal').classList.remove('hidden');
}

async function saveWorkflow() {
    const name = document.getElementById('workflowName').value.trim();
    if (!name) { showToast('Digite um nome'); return; }

    // Capture current tab URL as autoTrigger (hostname only for safety)
    let autoTrigger = '';
    try {
        const tab = await getCurrentTab();
        if (tab?.url && !tab.url.startsWith('chrome')) {
            autoTrigger = new URL(tab.url).hostname; // e.g. "mail.google.com"
        }
    } catch { }

    const data = await chrome.storage.local.get('workflows');
    const wfs = data.workflows || {};
    wfs[name] = {
        name,
        steps: recordedSteps,
        autoTrigger,          // ← URL trigger automático
        createdAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({ workflows: wfs });
    document.getElementById('saveModal').classList.add('hidden');
    recordedSteps = null;
    await loadWorkflows();
    const triggerMsg = autoTrigger ? ` (auto-execução em: ${autoTrigger})` : '';
    showToast(`✅ "${name}" salvo!${triggerMsg}`);
    await memory.store(MEMORY_TYPES.WORKFLOW,
        `Workflow criado: "${name}" com ${wfs[name].steps.length} passos${triggerMsg}`,
        { importance: 2 }
    );
}

async function loadWorkflows() {
    const data = await chrome.storage.local.get('workflows');
    const wfs = data.workflows || {};
    const list = document.getElementById('workflowList');
    const items = Object.values(wfs);
    if (items.length === 0) { list.innerHTML = '<div class="empty-state">Nenhum workflow salvo ainda.</div>'; return; }
    list.innerHTML = items.map(wf => `
    <div class="workflow-item">
      <div class="wf-icon">⚡</div>
      <div class="wf-info">
        <div class="wf-name">${wf.name}</div>
        <div class="wf-meta">${wf.steps.length} passo(s)${wf.autoTrigger ? ` · <span style="color:var(--accent)">🤖 auto: ${wf.autoTrigger}</span>` : ''}</div>
      </div>
      <div class="wf-actions">
        <button class="btn-run" data-wf="${wf.name}">▶ Executar</button>
        <button class="btn-toggle-auto" data-wf="${wf.name}" title="${wf.autoTrigger ? 'Desativar auto-execução' : 'Sem URL de trigger'}">${wf.autoTrigger ? '🤖' : '⏸'}</button>
        <button class="btn-del" data-wfdel="${wf.name}">🗑</button>
      </div>
    </div>
  `).join('');
    list.querySelectorAll('.btn-run').forEach(btn => {
        btn.addEventListener('click', async () => {
            const tab = await getCurrentTab();
            const wf = wfs[btn.dataset.wf];
            const resp = await chrome.runtime.sendMessage({ type: 'REPLAY_WORKFLOW', payload: { steps: wf.steps, tabId: tab.id } });
            showToast(resp?.success ? '✅ Workflow concluído' : '❌ Erro');
        });
    });
    list.querySelectorAll('.btn-toggle-auto').forEach(btn => {
        btn.addEventListener('click', async () => {
            const wf = wfs[btn.dataset.wf];
            if (!wf) return;
            wf.autoTrigger = wf.autoTrigger ? '' : ''; // toggle off (user can re-save to re-enable)
            await chrome.storage.local.set({ workflows: wfs });
            showToast(wf.autoTrigger ? `🤖 Auto-execução ativada` : `⏸ Auto-execução desativada`);
            await loadWorkflows();
        });
    });
    list.querySelectorAll('.btn-del').forEach(btn => {
        btn.addEventListener('click', async () => {
            delete wfs[btn.dataset.wfdel];
            await chrome.storage.local.set({ workflows: wfs });
            await loadWorkflows();
        });

    });
}

// ── Scheduler ─────────────────────────────────────────────────
async function scheduleNewTask() {
    const name = document.getElementById('taskName').value.trim();
    const task = document.getElementById('taskPrompt').value.trim();
    const freq = document.getElementById('taskFrequency').value;
    const time = document.getElementById('taskTime').value;
    if (!name || !task) { showToast('Preencha nome e tarefa'); return; }
    const [h, m] = time.split(':').map(Number);
    const when = new Date(); when.setHours(h, m, 0, 0);
    if (when <= new Date()) when.setDate(when.getDate() + 1);
    const periodInMinutes = { daily: 1440, weekly: 10080, monthly: 43200 }[freq];
    await chrome.runtime.sendMessage({ type: 'SCHEDULE_TASK', payload: { name, task, when: when.getTime(), periodInMinutes } });
    document.getElementById('schedulerForm').classList.add('hidden');
    document.getElementById('taskName').value = document.getElementById('taskPrompt').value = '';
    await loadAlarms();
    showToast(`✅ "${name}" agendada!`);
}

async function loadAlarms() {
    const resp = await chrome.runtime.sendMessage({ type: 'LIST_ALARMS', payload: {} });
    const list = document.getElementById('alarmList');
    if (!resp?.alarms?.length) { list.innerHTML = '<div class="empty-state">Nenhuma tarefa agendada.</div>'; return; }
    list.innerHTML = resp.alarms.map(a => `
    <div class="alarm-item">
      <div class="alarm-info">
        <div class="alarm-name">⏰ ${a.name}</div>
        <div class="alarm-time">${a.scheduledTime}${a.periodInMinutes ? ` · cada ${(a.periodInMinutes / 60).toFixed(0)}h` : ''}</div>
        <div class="alarm-task">${a.task?.slice(0, 60)}</div>
      </div>
      <button class="btn-del" data-alarm="${a.name}">🗑</button>
    </div>
  `).join('');
    list.querySelectorAll('.btn-del').forEach(btn => {
        btn.addEventListener('click', async () => {
            await chrome.runtime.sendMessage({ type: 'DELETE_ALARM', payload: { name: btn.dataset.alarm } });
            await loadAlarms();
        });
    });
}

// ── Start ─────────────────────────────────────────────────────
init().catch(console.error);
