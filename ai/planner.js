// ============================================================
//  AI Browser Assistant — Hierarchical Planner
//  Decomposes complex goals into ordered sub-tasks
// ============================================================

const PLANNER_SYSTEM_PROMPT = `Você é um planejador de tarefas para um agente de IA que controla um navegador Chrome.

Sua função é APENAS decompor o objetivo do usuário em sub-tarefas claras e sequenciais.

REGRAS:
1. Quebre o objetivo em passos ATÔMICOS (uma ação por passo)
2. Cada passo deve ter uma ferramenta sugerida (tool_hint)
3. Identifique dependências entre passos (depends_on)
4. Máximo de 10 passos por plano
5. Responda SOMENTE com JSON válido, sem texto adicional

FERRAMENTAS DISPONÍVEIS: read_page, click_element, fill_input, navigate, scroll_page, open_tab, close_tab, switch_tab, list_tabs, take_screenshot, get_console_logs, wait, vision_click, vision_read

FORMATO DE RESPOSTA:
{
  "goal": "objetivo resumido",
  "estimated_duration": "~X minutos",
  "steps": [
    {
      "id": 1,
      "description": "Descrição clara do que fazer",
      "tool_hint": "nome_da_ferramenta",
      "depends_on": [],
      "reversible": true
    }
  ]
}`;

// Palavras-chave que indicam tarefa complexa (requer planejamento)
const COMPLEX_KEYWORDS = [
    'organize', 'agendar', 'reunião', 'pesquise e', 'compare',
    'extraia', 'preencha o formulário', 'compre', 'faça uma pesquisa',
    'abra', 'várias', 'múltiplas', 'após', 'depois', 'então',
    'e depois', 'finalmente', 'primeiro', 'em seguida', 'viagem',
    'flight', 'voo', 'hotel', 'relatório', 'planilha', 'email e',
    'gmail', 'calendar', 'drive', 'organize', 'todos os',
];

export function isComplexTask(userMessage) {
    const lower = userMessage.toLowerCase();
    const matchCount = COMPLEX_KEYWORDS.filter(k => lower.includes(k)).length;
    // Complex if: matches 2+ keywords OR message is long (>100 chars) and has 1 keyword
    return matchCount >= 2 || (userMessage.length > 100 && matchCount >= 1);
}

export class Planner {
    constructor(apiKey, model = 'gemini-2.0-flash') {
        this.apiKey = apiKey;
        this.model = model;
    }

    async createPlan(userGoal) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
        const body = {
            system_instruction: { parts: [{ text: PLANNER_SYSTEM_PROMPT }] },
            contents: [{ role: 'user', parts: [{ text: `Crie um plano de execução para: "${userGoal}"` }] }],
            generation_config: { temperature: 0.3, max_output_tokens: 2048 },
        };

        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!resp.ok) throw new Error(`Planner API error ${resp.status}`);

        const data = await resp.json();
        let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // Strip markdown fences if any
        text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        try {
            return JSON.parse(text);
        } catch {
            // Fallback: simple single-step plan
            return {
                goal: userGoal,
                estimated_duration: '~1 minuto',
                steps: [{
                    id: 1,
                    description: userGoal,
                    tool_hint: 'read_page',
                    depends_on: [],
                    reversible: true,
                }],
            };
        }
    }

    // Execute plan steps respecting dependencies
    async executePlan(plan, executeStep, onStepUpdate) {
        const results = {};
        const completed = new Set();
        const failed = new Set();

        for (const step of plan.steps) {
            // Check all dependencies are met
            const depsOk = step.depends_on.every(dep => completed.has(dep) && !failed.has(dep));
            if (!depsOk) {
                onStepUpdate?.({ step, status: 'skipped', reason: 'dependência falhou' });
                failed.add(step.id);
                continue;
            }

            onStepUpdate?.({ step, status: 'running' });

            try {
                const result = await executeStep(step);
                results[step.id] = result;

                if (result?.error) {
                    failed.add(step.id);
                    onStepUpdate?.({ step, status: 'failed', result });
                } else {
                    completed.add(step.id);
                    onStepUpdate?.({ step, status: 'done', result });
                }
            } catch (err) {
                failed.add(step.id);
                onStepUpdate?.({ step, status: 'failed', result: { error: err.message } });
            }
        }

        return {
            results,
            completed: [...completed],
            failed: [...failed],
            successRate: `${completed.size}/${plan.steps.length}`,
        };
    }
}
