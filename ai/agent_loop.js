// ============================================================
//  AI Browser Assistant — Agent Loop (ReAct Pattern)
//  Reason → Act → Observe → Retry (Self-Healing)
// ============================================================

export const MAX_ITERATIONS = 10;
export const MAX_TOOL_RETRIES = 3;
export const MAX_PAGE_TOKENS = 4000; // chars before truncation

// ── Token Truncation ──────────────────────────────────────────
// Keywords that mean "just navigate, don't read the page yet"
const NAV_ONLY_KEYWORDS = [
    'abra', 'abrir', 'vá para', 'va para', 'navegue', 'navegar',
    'acesse', 'acessar', 'ir para', 'open', 'go to', 'navigate to',
    'abre o site', 'abre a página',
];

function isNavOnlyGoal(goal) {
    const lower = goal.toLowerCase();
    const hasNav = NAV_ONLY_KEYWORDS.some(k => lower.includes(k));
    const hasAnd = /\s+e\s+|\s+and\s+|depois|então|also/.test(lower);
    return hasNav && !hasAnd && goal.length < 80;
}

// Truncate page result to MAX_PAGE_TOKENS; skip body on nav-only first iteration
export function smartTruncateResult(toolName, result, goal, iterationNum) {
    if (!result || result.error) return result;
    if (toolName !== 'read_page' || !result.bodyText) return result;

    // First iteration of a nav-only goal: strip body entirely
    if (iterationNum === 1 && isNavOnlyGoal(goal)) {
        return { ...result, bodyText: '[Conteúdo omitido — objetivo é apenas navegar]' };
    }

    // General truncation
    if (result.bodyText.length > MAX_PAGE_TOKENS) {
        return {
            ...result,
            bodyText: result.bodyText.slice(0, MAX_PAGE_TOKENS) +
                `\n… [truncado: ${result.bodyText.length - MAX_PAGE_TOKENS} chars omitidos]`,
        };
    }
    return result;
}

// ── Goal-Reaching Detection ───────────────────────────────────
// Extract expected domain/path from user's goal
function extractGoalDomain(goal) {
    // Match URLs or site names
    const urlMatch = goal.match(/https?:\/\/([^\s/]+)/);
    if (urlMatch) return urlMatch[1].toLowerCase();

    const siteMatch = goal.match(/\b(wikipedia|google|youtube|github|gmail|amazon|mercadolivre|linkedin|twitter|facebook|instagram|netflix|reddit|stackoverflow)\b/i);
    if (siteMatch) return siteMatch[1].toLowerCase();

    return null;
}

export function checkGoalReached(goal, toolName, toolResult) {
    if (toolName !== 'navigate' && toolName !== 'open_tab') return false;
    const targetDomain = extractGoalDomain(goal);
    if (!targetDomain) return false;

    const currentUrl = (toolResult?.url || '').toLowerCase();
    return currentUrl.includes(targetDomain);
}


// Prompts de recuperação por tipo de erro
const RECOVERY_PROMPTS = {
    element_not_found: `O elemento não foi encontrado no DOM. Possíveis causas:
  - A página ainda está carregando (use a tool 'wait' por 1-2 segundos e tente novamente)
  - O seletor está incorreto (tente encontrar o elemento pelo texto visível ou por um seletor alternativo)
  - O elemento está em um iframe ou shadow DOM (tente rolar a página e ler novamente)
  Analise o estado atual da página e tente uma rota alternativa.`,

    navigation_error: `A navegação falhou. Possíveis causas:
  - URL inválida ou inacessível
  - Pop-up de confirmação bloqueando a navegação
  Leia a página atual, identifique o bloqueio e resolva antes de tentar novamente.`,

    fill_error: `O preenchimento do campo falhou. Tente:
  1. Use 'wait' por 1 segundo
  2. Use 'click_element' no campo primeiro para focar
  3. Tente novamente o fill_input com seletor alternativo`,

    generic: `A ação falhou. Analise o erro acima, leia o estado atual da página com 'read_page' e tente uma abordagem diferente para completar o objetivo.`,
};

function classifyError(errorMsg) {
    if (!errorMsg) return 'generic';
    const lower = errorMsg.toLowerCase();
    if (lower.includes('not found') || lower.includes('não encontrado') || lower.includes('element')) return 'element_not_found';
    if (lower.includes('navigation') || lower.includes('navigate') || lower.includes('url')) return 'navigation_error';
    if (lower.includes('fill') || lower.includes('input') || lower.includes('field')) return 'fill_error';
    return 'generic';
}

// ── ReAct Executor ────────────────────────────────────────────
export class AgentLoop {
    constructor(geminiChat, toolExecutor, onUpdate) {
        this.gemini = geminiChat;
        this.executeTool = toolExecutor;    // async (name, args) => result
        this.onUpdate = onUpdate || (() => { }); // UI callback
        this.iterations = 0;
        this.observations = [];              // running observation log
    }

    reset() {
        this.iterations = 0;
        this.observations = [];
    }

    // ── Main run loop ──────────────────────────────────────────
    async run(userGoal) {
        this.reset();
        this.observations.push({ role: 'goal', content: userGoal });

        let currentMessage = userGoal;
        let response;

        while (this.iterations < MAX_ITERATIONS) {
            this.iterations++;

            // REASON: Ask Gemini what to do next
            try {
                response = await this.gemini.sendMessage(currentMessage, (chunk) => {
                    this.onUpdate({ type: 'chunk', chunk });
                });
            } catch (err) {
                this.onUpdate({ type: 'error', error: err.message });
                return { success: false, error: err.message };
            }

            if (response.text) {
                this.onUpdate({ type: 'text', text: response.text });
                this.observations.push({ role: 'assistant', content: response.text });
            }

            if (!response.toolCalls || response.toolCalls.length === 0) {
                this.onUpdate({ type: 'done', iterations: this.iterations });
                return { success: true, text: response.text };
            }

            // ACT + OBSERVE
            const toolResults = [];
            let goalReached = false;

            for (const call of response.toolCalls) {
                let result = await this._executeWithHealing(call);

                // ── Token Truncation: trim large page results ────────
                result = smartTruncateResult(call.name, result, userGoal, this.iterations);

                toolResults.push({ name: call.name, result });
                this.observations.push({ role: 'observation', tool: call.name, args: call.args, result });
                this.onUpdate({ type: 'tool_result', tool: call.name, result });

                // ── Goal-Reaching Detection ──────────────────────────
                if (checkGoalReached(userGoal, call.name, result)) {
                    goalReached = true;
                    this.onUpdate({ type: 'text', text: `✅ Objetivo alcançado! Chegamos em **${result.url}**` });
                }
            }

            // Early exit if goal reached
            if (goalReached) {
                const finalResp = await this.gemini.submitToolResults(toolResults, null).catch(() => ({ text: '' }));
                if (finalResp.text) this.onUpdate({ type: 'text', text: finalResp.text });
                this.onUpdate({ type: 'done', iterations: this.iterations });
                return { success: true, text: finalResp.text, goalReached: true };
            }

            // Submit observations back → Gemini reasons again
            try {
                const followUp = await this.gemini.submitToolResults(toolResults, (chunk) => {
                    this.onUpdate({ type: 'chunk', chunk });
                });

                if (followUp.text) {
                    this.onUpdate({ type: 'text', text: followUp.text });
                }

                if (followUp.toolCalls?.length > 0) {
                    const nextResults = [];
                    for (const call of followUp.toolCalls) {
                        let result = await this._executeWithHealing(call);
                        result = smartTruncateResult(call.name, result, userGoal, this.iterations);
                        nextResults.push({ name: call.name, result });
                        this.observations.push({ role: 'observation', tool: call.name, result });
                        this.onUpdate({ type: 'tool_result', tool: call.name, result });

                        if (checkGoalReached(userGoal, call.name, result)) {
                            const fr = await this.gemini.submitToolResults(nextResults, null).catch(() => ({ text: '' }));
                            if (fr.text) this.onUpdate({ type: 'text', text: fr.text });
                            this.onUpdate({ type: 'done', iterations: this.iterations });
                            return { success: true, text: fr.text, goalReached: true };
                        }
                    }
                    const finalResp = await this.gemini.submitToolResults(nextResults, null);
                    if (finalResp.text) this.onUpdate({ type: 'text', text: finalResp.text });
                    if (!finalResp.toolCalls?.length) {
                        this.onUpdate({ type: 'done', iterations: this.iterations });
                        return { success: true, text: finalResp.text };
                    }
                    currentMessage = `Continue executando o objetivo: "${userGoal}". Progresso: ${this.iterations} iterações.`;
                } else {
                    this.onUpdate({ type: 'done', iterations: this.iterations });
                    return { success: true, text: followUp.text };
                }

            } catch (err) {
                this.onUpdate({ type: 'error', error: err.message });
                return { success: false, error: err.message };
            }
        }

        this.onUpdate({ type: 'max_iterations', iterations: this.iterations });
        return { success: false, error: `Limite de ${MAX_ITERATIONS} iterações atingido.` };
    }

    // ── Self-Healing Tool Executor ─────────────────────────────
    async _executeWithHealing(call) {
        const { name, args } = call;
        let lastError = null;

        for (let attempt = 1; attempt <= MAX_TOOL_RETRIES; attempt++) {
            this.onUpdate({ type: 'tool_attempt', tool: name, attempt, args });

            let result;
            try {
                result = await this.executeTool(name, args);
            } catch (err) {
                result = { error: err.message };
            }

            // Success
            if (!result?.error) {
                return result;
            }

            lastError = result.error;
            this.onUpdate({ type: 'tool_error', tool: name, attempt, error: lastError });

            if (attempt < MAX_TOOL_RETRIES) {
                // Inject recovery context into Gemini's memory
                const recoveryType = classifyError(lastError);
                const recoveryPrompt = RECOVERY_PROMPTS[recoveryType];

                await this._injectRecovery(name, args, lastError, recoveryPrompt, attempt);

                // Small wait before retry
                await new Promise(r => setTimeout(r, 500 * attempt));
            }
        }

        // All retries exhausted
        return {
            error: lastError,
            retries_used: MAX_TOOL_RETRIES,
            self_healed: false,
        };
    }

    // ── Inject recovery observation into Gemini ────────────────
    async _injectRecovery(toolName, args, error, recoveryHint, attempt) {
        const recoveryMsg = `[SISTEMA - Tentativa ${attempt}/${MAX_TOOL_RETRIES}]\n` +
            `A ferramenta '${toolName}' falhou com: "${error}"\n\n` +
            `${recoveryHint}\n\n` +
            `Tente uma abordagem diferente para continuar o objetivo.`;

        try {
            await this.gemini.submitToolResults(
                [{ name: toolName, result: { error, recovery_hint: recoveryHint } }],
                null
            );
        } catch { }

        this.observations.push({
            role: 'recovery',
            tool: toolName,
            attempt,
            hint: recoveryHint,
        });
    }

    // ── Get observation history (for debugging / memory) ───────
    getObservations() {
        return [...this.observations];
    }

    getSummary() {
        const tools = this.observations.filter(o => o.role === 'observation');
        const errors = this.observations.filter(o => o.role === 'recovery');
        const successes = tools.filter(o => !o.result?.error);
        return {
            iterations: this.iterations,
            toolCalls: tools.length,
            successes: successes.length,
            selfHealed: errors.length,
        };
    }
}
