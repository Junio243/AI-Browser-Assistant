// ============================================================
//  AI Browser Assistant — Safety Interceptor
//  Classifies, blocks, and logs tool calls by risk level
// ============================================================

// ── Risk levels ───────────────────────────────────────────────
export const RISK = {
    SAFE: 'safe',       // read-only, no side effects
    LOW: 'low',        // minor side effect, reversible
    MEDIUM: 'medium',     // significant action, reversible
    HIGH: 'high',       // potentially irreversible or costly
    CRITICAL: 'critical',   // irreversible: delete, purchase, sendmail
};

// ── Tool risk classification ──────────────────────────────────
const TOOL_RISK = {
    read_page: RISK.SAFE,
    get_console_logs: RISK.SAFE,
    list_tabs: RISK.SAFE,
    take_screenshot: RISK.SAFE,
    vision_read: RISK.SAFE,
    highlight_element: RISK.SAFE,
    scroll_page: RISK.SAFE,
    wait: RISK.SAFE,

    switch_tab: RISK.LOW,
    open_tab: RISK.LOW,

    navigate: RISK.MEDIUM,
    click_element: RISK.MEDIUM,
    vision_click: RISK.MEDIUM,
    fill_input: RISK.MEDIUM,

    close_tab: RISK.HIGH,
    replay_workflow: RISK.HIGH,
};

// ── Pattern-based critical action detector ────────────────────
const CRITICAL_PATTERNS = [
    // Navigation patterns
    { pattern: /checkout|payment|pagar|comprar|buy|purchase|order/i, field: 'url', risk: RISK.CRITICAL, reason: 'Possível compra ou pagamento' },
    { pattern: /delete|deletar|excluir|remover|apagar|trash|lixeira/i, field: 'url', risk: RISK.CRITICAL, reason: 'Possível exclusão de dados' },
    { pattern: /logout|sair|signout|sign-out/i, field: 'url', risk: RISK.HIGH, reason: 'Logout da conta' },

    // Fill input patterns
    { pattern: /senha|password|pin|cvv|cvc|card.number/i, field: 'label|selector', risk: RISK.CRITICAL, reason: 'Campo de senha ou dados de pagamento' },
    { pattern: /credit.card|cartao.credito|numero.cartao/i, field: 'label', risk: RISK.CRITICAL, reason: 'Dados de cartão de crédito' },

    // Click patterns
    { pattern: /confirmar|confirm|enviar|send|submit|pagar|pay|deletar|excluir|apagar|purchase|comprar|assinar|subscribe/i, field: 'text|selector', risk: RISK.HIGH, reason: 'Ação de confirmação crítica' },
    { pattern: /delete|remove|trash|lixeira|excluir|apagar/i, field: 'text', risk: RISK.CRITICAL, reason: 'Ação de exclusão' },
];

// Max args chars to show in risk report
const MAX_DISPLAY = 120;

// ── SafetyInterceptor class ───────────────────────────────────
export class SafetyInterceptor {
    constructor() {
        this.log = [];     // audit log of all intercepted calls
        this.blocked = 0;      // count of blocked actions
        this.overridden = 0;      // count of user-approved overrides
        this.enabled = true;
    }

    // ── Main intercept gate ────────────────────────────────────
    async intercept(toolName, args, { autonomousMode, requestApprovalFn, onBlock }) {
        if (!this.enabled) return { allowed: true, risk: RISK.SAFE };

        const assessment = this._assess(toolName, args);

        // Always log
        this._addLog(toolName, args, assessment);

        // CRITICAL actions: always require approval regardless of autonomous mode
        if (assessment.risk === RISK.CRITICAL) {
            const approved = await requestApprovalFn({
                tool: toolName,
                args,
                risk: assessment.risk,
                reason: assessment.reason,
                urgent: true,
            });
            if (!approved) {
                this.blocked++;
                onBlock?.({ toolName, args, assessment });
                return { allowed: false, risk: assessment.risk, reason: assessment.reason };
            }
            this.overridden++;
            return { allowed: true, risk: assessment.risk, overridden: true };
        }

        // HIGH risk: require approval in manual mode
        if (assessment.risk === RISK.HIGH && !autonomousMode) {
            const approved = await requestApprovalFn({
                tool: toolName,
                args,
                risk: assessment.risk,
                reason: assessment.reason,
            });
            if (!approved) {
                this.blocked++;
                return { allowed: false, risk: assessment.risk, reason: assessment.reason };
            }
            this.overridden++;
            return { allowed: true, risk: assessment.risk, overridden: true };
        }

        // MEDIUM risk: show non-blocking notification (no wait)
        if (assessment.risk === RISK.MEDIUM && !autonomousMode) {
            // Just notify, don't block
            onBlock?.({ toolName, args, assessment, nonBlocking: true });
        }

        return { allowed: true, risk: assessment.risk };
    }

    // ── Risk assessment ────────────────────────────────────────
    _assess(toolName, args) {
        const baseRisk = TOOL_RISK[toolName] || RISK.MEDIUM;
        const argsStr = JSON.stringify(args || {}).toLowerCase();

        // Check critical patterns
        for (const { pattern, field, risk, reason } of CRITICAL_PATTERNS) {
            // Determine which arg fields to check
            const toCheck = [];
            if (field.includes('url')) toCheck.push(args?.url || '');
            if (field.includes('label')) toCheck.push(args?.label || '');
            if (field.includes('selector')) toCheck.push(args?.selector || '');
            if (field.includes('text')) toCheck.push(args?.text || '');
            // Also check full args if not specific
            toCheck.push(argsStr);

            const combined = toCheck.join(' ').toLowerCase();
            if (pattern.test(combined)) {
                return { risk: this._maxRisk(baseRisk, risk), reason, pattern: pattern.toString() };
            }
        }

        return { risk: baseRisk, reason: this._defaultReason(baseRisk) };
    }

    // ── Audit log ──────────────────────────────────────────────
    _addLog(toolName, args, assessment) {
        this.log.push({
            time: Date.now(),
            tool: toolName,
            args: JSON.stringify(args || {}).slice(0, MAX_DISPLAY),
            risk: assessment.risk,
            reason: assessment.reason,
        });
        if (this.log.length > 500) this.log.shift();
    }

    // ── Helpers ────────────────────────────────────────────────
    _maxRisk(a, b) {
        const order = [RISK.SAFE, RISK.LOW, RISK.MEDIUM, RISK.HIGH, RISK.CRITICAL];
        return order[Math.max(order.indexOf(a), order.indexOf(b))];
    }

    _defaultReason(risk) {
        return {
            [RISK.SAFE]: 'Leitura segura, sem efeitos colaterais',
            [RISK.LOW]: 'Ação menor, totalmente reversível',
            [RISK.MEDIUM]: 'Ação com efeito colateral moderado',
            [RISK.HIGH]: 'Ação significativa, pode ser irreversível',
            [RISK.CRITICAL]: 'Ação IRREVERSÍVEL ou de alto impacto financeiro',
        }[risk] || '';
    }

    getStats() {
        return {
            totalIntercepted: this.log.length,
            blocked: this.blocked,
            overridden: this.overridden,
            recentLog: this.log.slice(-20),
        };
    }

    clearLog() { this.log = []; this.blocked = 0; this.overridden = 0; }
}

// Risk badge helper (used in UI)
export function riskBadge(risk) {
    const cfg = {
        [RISK.SAFE]: { icon: '✅', color: '#22c55e', label: 'Seguro' },
        [RISK.LOW]: { icon: '🔵', color: '#6366f1', label: 'Baixo' },
        [RISK.MEDIUM]: { icon: '🟡', color: '#f59e0b', label: 'Médio' },
        [RISK.HIGH]: { icon: '🟠', color: '#f97316', label: 'Alto' },
        [RISK.CRITICAL]: { icon: '🔴', color: '#ef4444', label: 'CRÍTICO' },
    };
    return cfg[risk] || cfg[RISK.MEDIUM];
}
