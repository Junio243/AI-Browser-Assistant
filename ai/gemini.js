// ============================================================
//  AI Browser Assistant — Gemini AI Client
//  Handles: chat sessions, streaming, tool/function calling
// ============================================================

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-2.5-flash-lite-preview-09-2025';


// ── Tool definitions (function declarations for Gemini) ──────
export const TOOL_DECLARATIONS = [
    {
        name: 'read_page',
        description: 'Lê o conteúdo da aba ativa: texto visível, links, botões, inputs e outras informações da página.',
        parameters: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'click_element',
        description: 'Clica em um elemento da página. Pode usar seletor CSS, texto do elemento ou índice.',
        parameters: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'Seletor CSS do elemento' },
                text: { type: 'string', description: 'Texto visível do elemento para busca fuzzy' },
                index: { type: 'number', description: 'Índice numérico entre os elementos interativos' },
            },
        },
    },
    {
        name: 'fill_input',
        description: 'Preenche um campo de texto, textarea ou select com um valor.',
        parameters: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'Seletor CSS do campo' },
                label: { type: 'string', description: 'Label, placeholder ou nome do campo' },
                value: { type: 'string', description: 'Valor a preencher' },
                index: { type: 'number', description: 'Índice do campo entre os inputs da página' },
            },
            required: ['value'],
        },
    },
    {
        name: 'navigate',
        description: 'Navega para uma URL na aba ativa.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL de destino (ex: https://google.com)' },
            },
            required: ['url'],
        },
    },
    {
        name: 'scroll_page',
        description: 'Rola a página na direção especificada ou até um elemento.',
        parameters: {
            type: 'object',
            properties: {
                direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Direção do scroll' },
                amount: { type: 'number', description: 'Quantidade de pixels para rolar' },
                selector: { type: 'string', description: 'Seletor CSS do elemento para rolar até ele' },
            },
        },
    },
    {
        name: 'open_tab',
        description: 'Abre uma nova aba no navegador.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL para abrir na nova aba (opcional)' },
            },
        },
    },
    {
        name: 'close_tab',
        description: 'Fecha uma aba. Se tab_id não informado, fecha a aba ativa.',
        parameters: {
            type: 'object',
            properties: {
                tab_id: { type: 'number', description: 'ID da aba a fechar' },
            },
        },
    },
    {
        name: 'switch_tab',
        description: 'Muda o foco para outra aba.',
        parameters: {
            type: 'object',
            properties: {
                tab_id: { type: 'number', description: 'ID da aba para ativar' },
            },
            required: ['tab_id'],
        },
    },
    {
        name: 'list_tabs',
        description: 'Lista todas as abas abertas no navegador com seus IDs, títulos e URLs.',
        parameters: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'take_screenshot',
        description: 'Captura um screenshot da aba ativa.',
        parameters: {
            type: 'object',
            properties: {
                tab_id: { type: 'number', description: 'ID da aba (opcional, usa aba ativa por padrão)' },
            },
        },
    },
    {
        name: 'get_console_logs',
        description: 'Lê os logs recentes do console do navegador (erros, avisos, network).',
        parameters: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'highlight_element',
        description: 'Destaca visualmente um elemento na página por 3 segundos.',
        parameters: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'Seletor CSS do elemento' },
            },
            required: ['selector'],
        },
    },
    {
        name: 'wait',
        description: 'Aguarda N segundos antes de continuar.',
        parameters: {
            type: 'object',
            properties: {
                seconds: { type: 'number', description: 'Número de segundos para aguardar' },
            },
            required: ['seconds'],
        },
    },
    {
        name: 'replay_workflow',
        description: 'Executa um workflow salvo pelo nome.',
        parameters: {
            type: 'object',
            properties: {
                workflow_name: { type: 'string', description: 'Nome do workflow salvo' },
            },
            required: ['workflow_name'],
        },
    },
    {
        name: 'vision_click',
        description: 'PODEROSO: Captura screenshot e usa visão computacional para localizar e clicar em um elemento pela DESCRIÇÃO VISUAL, independentemente do DOM. Use quando click_element falhar ou para sites com Canvas/WebGL/Shadow DOM.',
        parameters: {
            type: 'object',
            properties: {
                element_description: { type: 'string', description: 'Descrição visual do elemento a clicar (ex: "botão azul com texto Enviar", "ícone de lupa no canto superior direito")' },
            },
            required: ['element_description'],
        },
    },
    {
        name: 'vision_read',
        description: 'Captura screenshot e usa visão computacional para analisar o conteúdo visual da página, incluindo imagens, gráficos e elementos não acessíveis via DOM.',
        parameters: {
            type: 'object',
            properties: {
                question: { type: 'string', description: 'Pergunta específica sobre o conteúdo visual (ex: "Quais são os preços mostrados?", "Descreva os gráficos")' },
            },
        },
    },
];

export const SYSTEM_PROMPT = `Você é um AGENTE DE IA AUTÔNOMO integrado ao navegador Chrome. Você possui capacidades avançadas de percepção, raciocínio, planejamento e memória.

CAPACIDADES:
- Ler, clicar, preencher formulários e navegar em qualquer site
- Percepção visual via screenshot (vision_click, vision_read) para sites com Canvas, WebGL ou Shadow DOM
- Gerenciar múltiplas abas simultaneamente
- Executar tarefas multi-step complexas com planejamento hierárquico
- Auto-recuperação: se uma ação falhar, analise o erro e tente rota alternativa
- Memória de contexto da sessão atual

ESTRATÉGIA DE EXECUÇÃO:
1. Para tarefas simples: execute diretamente com as ferramentas DOM
2. Para tarefas complexas: leia a página primeiro, planeje os passos mentalmente, execute sequencialmente
3. Sempre confirme o resultado após cada ação importante com read_page ou take_screenshot
4. Se click_element falhar 2x no mesmo elemento → tente vision_click
5. Se o DOM não contiver a informação → use vision_read para analisar visualmente

REGRAS:
- Comunique o que está fazendo antes de cada ação
- Responda SEMPRE em português do Brasil
- Seja proativo: após completar uma tarefa, sugira próximos passos relevantes
- Respeite privacidade: não acesse dados sensíveis sem permissão explícita
- Informe claramente quando não conseguir concluir uma tarefa e por quê`;

// ── GeminiChat class ──────────────────────────────────────────
export class GeminiChat {
    constructor(apiKey, model = DEFAULT_MODEL) {
        this.apiKey = apiKey;
        this.model = model;
        this.history = []; // [{role, parts:[{text}]}]
    }

    reset() { this.history = []; }

    async sendMessage(userText, onChunk) {
        // Add user turn
        this.history.push({ role: 'user', parts: [{ text: userText }] });

        const body = {
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: this.history,
            tools: [{ function_declarations: TOOL_DECLARATIONS }],
            tool_config: { function_calling_config: { mode: 'AUTO' } },
            generation_config: {
                temperature: 0.7,
                max_output_tokens: 8192,
            },
        };

        const url = `${GEMINI_API_BASE}/models/${this.model}:generateContent?key=${this.apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error?.message || `API error ${response.status}`);
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        if (!candidate) throw new Error('No response from Gemini');

        const parts = candidate.content?.parts || [];

        // Collect text parts and function calls
        const textParts = [];
        const toolCalls = [];

        for (const part of parts) {
            if (part.text) {
                textParts.push(part.text);
                onChunk?.({ type: 'text', text: part.text });
            }
            if (part.functionCall) {
                toolCalls.push(part.functionCall);
                onChunk?.({ type: 'tool_call', tool: part.functionCall.name, args: part.functionCall.args });
            }
        }

        // Add assistant turn to history
        this.history.push({ role: 'model', parts });

        return {
            text: textParts.join(''),
            toolCalls,
            finishReason: candidate.finishReason,
        };
    }

    // Submit tool results back to Gemini
    async submitToolResults(toolResults, onChunk) {
        const functionResponses = toolResults.map(r => ({
            functionResponse: {
                name: r.name,
                response: r.result,
            }
        }));

        this.history.push({ role: 'user', parts: functionResponses });

        const body = {
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: this.history,
            tools: [{ function_declarations: TOOL_DECLARATIONS }],
            tool_config: { function_calling_config: { mode: 'AUTO' } },
            generation_config: { temperature: 0.7, max_output_tokens: 8192 },
        };

        const url = `${GEMINI_API_BASE}/models/${this.model}:generateContent?key=${this.apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error?.message || `API error ${response.status}`);
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        const parts = candidate?.content?.parts || [];

        const textParts = [];
        const toolCalls = [];

        for (const part of parts) {
            if (part.text) {
                textParts.push(part.text);
                onChunk?.({ type: 'text', text: part.text });
            }
            if (part.functionCall) {
                toolCalls.push(part.functionCall);
                onChunk?.({ type: 'tool_call', tool: part.functionCall.name, args: part.functionCall.args });
            }
        }

        this.history.push({ role: 'model', parts });

        return { text: textParts.join(''), toolCalls, finishReason: candidate?.finishReason };
    }
}

// ============================================================
//  OpenAI-Compatible Client
//  Works with: OpenAI, Colab+ngrok, LM Studio, Groq, Together
// ============================================================
export class OpenAIChat {
    constructor(apiKey, model, endpoint) {
        this.apiKey = apiKey;
        this.model = model || 'gpt-4o-mini';
        this.endpoint = endpoint.replace(/\/$/, ''); // remove trailing slash
        this.history = [{ role: 'system', content: SYSTEM_PROMPT }];

        // Convert Gemini tool declarations → OpenAI function format
        this.tools = TOOL_DECLARATIONS.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
            },
        }));
    }

    reset() { this.history = [{ role: 'system', content: SYSTEM_PROMPT }]; }

    async sendMessage(userMessage, onChunk) {
        this.history.push({ role: 'user', content: userMessage });
        return this._call(onChunk);
    }

    async submitToolResults(toolResults, onChunk) {
        // Add assistant message with tool_calls (required by OpenAI protocol)
        const toolCallMessages = toolResults.map(r => ({
            id: `call_${r.name}_${Date.now()}`,
            type: 'function',
            function: { name: r.name, arguments: JSON.stringify(r.args || {}) },
        }));
        this.history.push({ role: 'assistant', content: null, tool_calls: toolCallMessages });

        // Add tool results
        for (const r of toolResults) {
            this.history.push({
                role: 'tool',
                tool_call_id: `call_${r.name}_${Date.now()}`,
                content: typeof r.result === 'string' ? r.result : JSON.stringify(r.result),
            });
        }
        return this._call(onChunk);
    }

    async _call(onChunk) {
        const body = {
            model: this.model,
            messages: this.history,
            tools: this.tools,
            tool_choice: 'auto',
            temperature: 0.7,
            max_tokens: 4096,
        };

        const resp = await fetch(`${this.endpoint}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error?.message || `OpenAI endpoint error ${resp.status}`);
        }

        const data = await resp.json();
        const choice = data.choices?.[0];
        const msg = choice?.message || {};
        const text = msg.content || '';
        const calls = msg.tool_calls || [];

        if (text) {
            onChunk?.({ type: 'text', text });
            this.history.push({ role: 'assistant', content: text });
        }

        const toolCalls = calls.map(c => ({
            name: c.function.name,
            args: (() => { try { return JSON.parse(c.function.arguments || '{}'); } catch { return {}; } })(),
        }));

        if (calls.length) {
            this.history.push({ role: 'assistant', content: null, tool_calls: calls });
        }

        return { text, toolCalls, finishReason: choice?.finish_reason };
    }
}

// ── Factory: pick the right client based on settings ────────────
export function createChatClient(apiKey, model, { customEndpoint, customModel } = {}) {
    if (customEndpoint && customEndpoint.trim()) {
        // OpenAI-compatible endpoint (Colab, LM Studio, Groq, etc.)
        return new OpenAIChat(apiKey, customModel || model, customEndpoint.trim());
    }
    return new GeminiChat(apiKey, model);
}
