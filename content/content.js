// ============================================================
//  AI Browser Assistant — Content Script
//  Injected into every page. Exposes window.__AI_ASSISTANT__
// ============================================================

(function () {
    'use strict';

    // ── Recorder state ─────────────────────────────────────────
    let isRecording = false;
    let recordedSteps = [];

    // ── Cursor Animation System ───────────────────────────────────
    function ensureCursorStyles() {
        if (document.getElementById('__ai_cursor_style__')) return;
        const style = document.createElement('style');
        style.id = '__ai_cursor_style__';
        style.textContent = `
            #__ai_cursor__ {
                position: fixed;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                background: rgba(99, 102, 241, 0.92);
                border: 2.5px solid #fff;
                box-shadow: 0 0 0 4px rgba(99,102,241,0.35), 0 4px 16px rgba(0,0,0,0.35);
                pointer-events: none;
                z-index: 2147483647;
                transform: translate(-50%, -50%) scale(1);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 15px;
                transition:
                    left   0.55s cubic-bezier(0.25, 0.46, 0.45, 0.94),
                    top    0.55s cubic-bezier(0.25, 0.46, 0.45, 0.94),
                    opacity 0.25s ease,
                    transform 0.15s ease;
            }
            #__ai_cursor__::after { content: '🤖'; font-size: 15px; }
            .__ai_ripple__ {
                position: fixed;
                width: 0; height: 0;
                border-radius: 50%;
                background: rgba(99, 102, 241, 0.5);
                pointer-events: none;
                z-index: 2147483646;
                transform: translate(-50%, -50%);
                animation: __ai_expand__ 0.55s ease-out forwards;
            }
            .__ai_ripple2__ {
                position: fixed;
                width: 0; height: 0;
                border-radius: 50%;
                border: 2px solid rgba(99, 102, 241, 0.7);
                pointer-events: none;
                z-index: 2147483645;
                transform: translate(-50%, -50%);
                animation: __ai_expand2__ 0.75s ease-out forwards;
            }
            @keyframes __ai_expand__ {
                0%   { width: 0;    height: 0;    opacity: 0.9; }
                100% { width: 80px; height: 80px; opacity: 0; }
            }
            @keyframes __ai_expand2__ {
                0%   { width: 0;    height: 0;    opacity: 0.7; }
                100% { width: 120px; height: 120px; opacity: 0; }
            }
            .__ai_trail__ {
                position: fixed;
                width: 8px; height: 8px;
                border-radius: 50%;
                background: rgba(99, 102, 241, 0.4);
                pointer-events: none;
                z-index: 2147483644;
                transform: translate(-50%, -50%);
                transition: opacity 0.4s ease;
            }
        `;
        document.head.appendChild(style);
    }

    function getOrCreateCursor() {
        ensureCursorStyles();
        let c = document.getElementById('__ai_cursor__');
        if (!c) {
            c = document.createElement('div');
            c.id = '__ai_cursor__';
            c.style.left = (window.innerWidth / 2) + 'px';
            c.style.top = (window.innerHeight * 0.4) + 'px';
            c.style.opacity = '0';
            document.body.appendChild(c);
        }
        return c;
    }

    function spawnTrail(x, y) {
        ensureCursorStyles();
        const t = document.createElement('div');
        t.className = '__ai_trail__';
        t.style.left = x + 'px';
        t.style.top = y + 'px';
        document.body.appendChild(t);
        setTimeout(() => { t.style.opacity = '0'; }, 50);
        setTimeout(() => t.remove(), 450);
    }

    function showClickRipple(x, y) {
        ensureCursorStyles();
        [1, 2].forEach(i => {
            const r = document.createElement('div');
            r.className = i === 1 ? '__ai_ripple__' : '__ai_ripple2__';
            r.style.left = x + 'px';
            r.style.top = y + 'px';
            document.body.appendChild(r);
            setTimeout(() => r.remove(), 800);
        });
    }

    function animateCursorTo(targetX, targetY) {
        return new Promise(resolve => {
            const cursor = getOrCreateCursor();
            const startX = parseFloat(cursor.style.left) || window.innerWidth / 2;
            const startY = parseFloat(cursor.style.top) || window.innerHeight * 0.4;

            cursor.style.opacity = '1';

            // Spawn trail dots along path
            const steps = 8;
            for (let i = 1; i <= steps; i++) {
                const t = (i / steps);
                const tx = startX + (targetX - startX) * t;
                const ty = startY + (targetY - startY) * t;
                setTimeout(() => spawnTrail(tx, ty), i * 60);
            }

            // Move cursor
            setTimeout(() => {
                cursor.style.left = targetX + 'px';
                cursor.style.top = targetY + 'px';
            }, 20);

            // After reaching target: click animation
            setTimeout(() => {
                cursor.style.transform = 'translate(-50%, -50%) scale(0.65)';
                showClickRipple(targetX, targetY);
                setTimeout(() => {
                    cursor.style.transform = 'translate(-50%, -50%) scale(1)';
                }, 180);
                resolve();
            }, 600);
        });
    }

    function animateCursorToElement(el) {
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        return animateCursorTo(x, y);
    }

    function hideCursorAfterDelay(ms = 1800) {
        setTimeout(() => {
            const c = document.getElementById('__ai_cursor__');
            if (c) c.style.opacity = '0';
        }, ms);
    }

    // ── Agent Control Border ────────────────────────────────────
    // Orange pulsing border = AI is actively in control of this page
    function startAgentMode() {
        if (document.getElementById('__ai_border__')) return { success: true };

        // Inject keyframe styles once
        if (!document.getElementById('__ai_border_style__')) {
            const s = document.createElement('style');
            s.id = '__ai_border_style__';
            s.textContent = `
                @keyframes __ai_border_pulse__ {
                    0%   { box-shadow: inset 0 0 0 3px #f97316, inset 0 0 18px 2px rgba(249,115,22,0.25); }
                    50%  { box-shadow: inset 0 0 0 4px #fb923c, inset 0 0 32px 6px rgba(249,115,22,0.45); }
                    100% { box-shadow: inset 0 0 0 3px #f97316, inset 0 0 18px 2px rgba(249,115,22,0.25); }
                }
                #__ai_border__ {
                    position: fixed;
                    inset: 0;
                    pointer-events: none;
                    z-index: 2147483646;
                    border-radius: 0;
                    animation: __ai_border_pulse__ 1.6s ease-in-out infinite;
                    transition: opacity 0.4s ease;
                }
                #__ai_border_label__ {
                    position: fixed;
                    top: 10px;
                    right: 14px;
                    background: rgba(249,115,22,0.92);
                    color: #fff;
                    font-family: system-ui, sans-serif;
                    font-size: 12px;
                    font-weight: 600;
                    padding: 3px 10px 3px 8px;
                    border-radius: 20px;
                    pointer-events: none;
                    z-index: 2147483647;
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
                    letter-spacing: 0.01em;
                    animation: __ai_border_pulse__ 1.6s ease-in-out infinite;
                }
            `;
            document.head.appendChild(s);
        }

        const border = document.createElement('div');
        border.id = '__ai_border__';
        document.body.appendChild(border);

        const label = document.createElement('div');
        label.id = '__ai_border_label__';
        label.innerHTML = '🤖 IA no controle';
        document.body.appendChild(label);

        return { success: true };
    }

    function stopAgentMode() {
        const border = document.getElementById('__ai_border__');
        const label = document.getElementById('__ai_border_label__');
        if (border) { border.style.opacity = '0'; setTimeout(() => border.remove(), 400); }
        if (label) { label.style.opacity = '0'; setTimeout(() => label.remove(), 400); }
        return { success: true };
    }

    // ── Main API exposed to background ─────────────────────────
    window.__AI_ASSISTANT__ = {
        execute(tool, args) {
            switch (tool) {
                case 'read_page': return readPage(args);
                case 'click_element': return clickElement(args);
                case 'fill_input': return fillInput(args);
                case 'scroll_page': return scrollPage(args);
                case 'get_console_logs': return getConsoleLogs();
                case 'highlight_element': return highlightElement(args);
                case 'animate_cursor': return animateCursorTo(args.x, args.y);
                case 'agent_start': return startAgentMode();
                case 'agent_stop': return stopAgentMode();
                default:
                    return { error: `Unknown content tool: ${tool}` };
            }
        },
        startRecording() { startWorkflowRecording(); },
        stopRecording() { return stopWorkflowRecording(); },
    };

    // ── 1. Read Page (with DOM Trimming) ───────────────────────
    function readPage() {
        const title = document.title;
        const url = window.location.href;

        // ── DOM Trimming: strip noise before sending to AI ──────
        const bodyText = extractTrimmedText(document.body);

        // Interactive elements — only essential attributes
        const interactive = [];
        const selectors = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="checkbox"], [tabindex]';

        document.querySelectorAll(selectors).forEach((el, idx) => {
            if (!isVisible(el)) return;
            interactive.push({
                index: idx,
                tag: el.tagName.toLowerCase(),
                type: el.type || el.getAttribute('role') || '',
                text: (el.innerText || el.value || el.placeholder || el.title || el.alt || el.ariaLabel || '').slice(0, 80).trim(),
                id: el.id || '',
                cls: [...el.classList].slice(0, 3).join(' '),  // only first 3 classes
                selector: generateSelector(el),
            });
        });

        const metaDesc = document.querySelector('meta[name="description"]')?.content || '';

        return {
            success: true,
            title,
            url,
            description: metaDesc,
            bodyText,                          // trimmed, max 6000 chars
            interactive: interactive.slice(0, 60), // reduced from 80→60
            totalElements: interactive.length,
        };
    }

    // ── DOM Trimming: deep-clone + strip noise + extract text ───
    function extractTrimmedText(root) {
        if (!root) return '';

        // Clone so we don't mutate the real page
        const clone = root.cloneNode(true);

        // Remove all noisy tags from clone
        const NOISE_TAGS = ['script', 'style', 'svg', 'iframe', 'noscript',
            'canvas', 'video', 'audio', 'picture', 'object',
            'embed', 'head', 'meta', 'link'];
        NOISE_TAGS.forEach(tag => {
            clone.querySelectorAll(tag).forEach(el => el.remove());
        });

        // Remove HTML comments
        const walker = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
        const comments = [];
        let node;
        while ((node = walker.nextNode())) comments.push(node);
        comments.forEach(c => c.remove());

        // Extract text from cleaned clone
        return (clone.innerText || clone.textContent || '')
            .replace(/\s{3,}/g, '\n')   // collapse excessive whitespace
            .replace(/\n{4,}/g, '\n\n') // max 3 blank lines
            .trim()
            .slice(0, 6000);            // max 6000 chars (vs original 8000)
    }

    // Original extractVisibleText kept for internal use
    function extractVisibleText(el) {
        if (!el) return '';
        const ignoreTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'HEAD', 'META']);
        let text = '';
        for (const node of el.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent + ' ';
            } else if (node.nodeType === Node.ELEMENT_NODE && !ignoreTags.has(node.tagName)) {
                if (isVisible(node)) text += extractVisibleText(node) + '\n';
            }
        }
        return text.replace(/\s+/g, ' ').trim();
    }

    function isVisible(el) {
        if (!el.getBoundingClientRect) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
        );
    }

    // ── 2. Click Element ───────────────────────────────────────
    async function clickElement({ selector, text, index }) {
        let el = null;

        if (selector) {
            try { el = document.querySelector(selector); } catch { }
        }
        if (!el && text) el = findElementByText(text);
        if (!el && index !== undefined) {
            const all = document.querySelectorAll('a[href], button, input[type="submit"], [role="button"]');
            el = all[index];
        }

        if (!el) return { error: `Element not found: ${selector || text}` };

        // 🤖 Animate cursor moving to element
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await animateCursorToElement(el);
        hideCursorAfterDelay(1500);

        flashHighlight(el);

        try {
            el.click();
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            return { success: true, element: el.tagName, text: el.innerText?.slice(0, 50) };
        } catch (err) {
            return { error: err.message };
        }
    }

    function findElementByText(searchText) {
        const lower = searchText.toLowerCase();
        const candidates = document.querySelectorAll('a, button, [role="button"], label, span, div, li, td, th, h1, h2, h3, h4, h5, h6');
        for (const el of candidates) {
            if (!isVisible(el)) continue;
            const txt = (el.innerText || el.textContent || '').toLowerCase().trim();
            if (txt === lower || txt.includes(lower)) return el;
        }
        return null;
    }

    // ── 3. Fill Input ──────────────────────────────────────────
    async function fillInput({ selector, label, value, index }) {
        let el = null;

        if (selector) {
            try { el = document.querySelector(selector); } catch { }
        }
        if (!el && label) {
            const labelEl = findElementByText(label);
            if (labelEl?.htmlFor) el = document.getElementById(labelEl.htmlFor);
            if (!el) {
                const inputs = document.querySelectorAll('input, textarea, select');
                for (const inp of inputs) {
                    const ph = (inp.placeholder || inp.name || inp.id || inp.ariaLabel || '').toLowerCase();
                    if (ph.includes(label.toLowerCase())) { el = inp; break; }
                }
            }
        }
        if (!el && index !== undefined) {
            el = document.querySelectorAll('input, textarea, select')[index];
        }

        if (!el) return { error: `Input not found: ${selector || label}` };

        // 🤖 Animate cursor moving to field
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await animateCursorToElement(el);
        hideCursorAfterDelay(2000);

        el.focus();
        flashHighlight(el);

        // Clear and set value (works with React/Vue state)
        const nativeInputValueSetter =
            Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
            Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (nativeInputValueSetter) {
            nativeInputValueSetter.call(el, value);
        } else {
            el.value = value;
        }

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

        return { success: true, field: el.name || el.id || el.placeholder, value };
    }

    // ── 4. Scroll Page ─────────────────────────────────────────
    function scrollPage({ direction = 'down', amount = 300, selector }) {
        if (selector) {
            const el = document.querySelector(selector);
            if (el) { el.scrollIntoView({ behavior: 'smooth' }); return { success: true }; }
        }

        const delta = direction === 'up' ? -amount : direction === 'down' ? amount : 0;
        const deltaX = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
        window.scrollBy({ top: delta, left: deltaX, behavior: 'smooth' });
        return { success: true };
    }

    // ── 5. Console Logs ────────────────────────────────────────
    const _consoleLogs = [];
    const _origConsole = {};

    ['log', 'warn', 'error', 'info'].forEach(level => {
        _origConsole[level] = console[level].bind(console);
        console[level] = (...args) => {
            _consoleLogs.push({ level, message: args.map(String).join(' '), time: Date.now() });
            if (_consoleLogs.length > 200) _consoleLogs.shift();
            _origConsole[level](...args);
        };
    });

    function getConsoleLogs() {
        return { success: true, logs: _consoleLogs.slice(-50) };
    }

    // ── 6. Highlight Element ───────────────────────────────────
    function highlightElement({ selector }) {
        const el = document.querySelector(selector);
        if (!el) return { error: 'Element not found' };
        flashHighlight(el, 3000);
        return { success: true };
    }

    function flashHighlight(el, duration = 1200) {
        const prev = el.style.cssText;
        el.style.outline = '3px solid #6366f1';
        el.style.boxShadow = '0 0 0 6px rgba(99,102,241,0.3)';
        el.style.transition = 'all 0.2s ease';
        setTimeout(() => { el.style.cssText = prev; }, duration);
    }

    // ── 7. CSS Selector generator ──────────────────────────────
    function generateSelector(el) {
        if (el.id) return `#${CSS.escape(el.id)}`;
        if (el.name) return `[name="${CSS.escape(el.name)}"]`;

        const parts = [];
        let current = el;
        while (current && current !== document.body) {
            let part = current.tagName.toLowerCase();
            if (current.className) {
                const cls = [...current.classList].slice(0, 2).join('.');
                if (cls) part += `.${cls}`;
            }
            const idx = [...(current.parentElement?.children || [])].indexOf(current);
            if (idx > 0) part += `:nth-child(${idx + 1})`;
            parts.unshift(part);
            current = current.parentElement;
            if (parts.length >= 4) break;
        }
        return parts.join(' > ');
    }

    // ── 8. Workflow Recorder ───────────────────────────────────
    function startWorkflowRecording() {
        if (isRecording) return;
        isRecording = true;
        recordedSteps = [];

        document.addEventListener('click', recorderClickHandler, true);
        document.addEventListener('input', recorderInputHandler, true);
    }

    function stopWorkflowRecording() {
        isRecording = false;
        document.removeEventListener('click', recorderClickHandler, true);
        document.removeEventListener('input', recorderInputHandler, true);
        const steps = [...recordedSteps];
        recordedSteps = [];
        return steps;
    }

    function recorderClickHandler(e) {
        if (!isRecording) return;
        recordedSteps.push({
            type: 'click',
            selector: generateSelector(e.target),
            text: e.target.innerText?.slice(0, 50) || '',
            delay: 500,
        });
    }

    function recorderInputHandler(e) {
        if (!isRecording) return;
        const last = recordedSteps[recordedSteps.length - 1];
        const sel = generateSelector(e.target);
        if (last?.type === 'input' && last.selector === sel) {
            last.value = e.target.value; // update in place
        } else {
            recordedSteps.push({
                type: 'input',
                selector: sel,
                value: e.target.value,
                delay: 300,
            });
        }
    }

    // ── Listen for recorder + intent messages ─────────────────
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'START_RECORDING') {
            startWorkflowRecording();
            sendResponse({ success: true });
        } else if (msg.type === 'STOP_RECORDING') {
            const steps = stopWorkflowRecording();
            sendResponse({ steps });
        } else if (msg.type === 'DETECT_INTENT') {
            sendResponse({ intent: detectPageIntent() });
        }
        return true;
    });

    // ── 9. Page Intent Detection ───────────────────────────────
    function detectPageIntent() {
        const url = window.location.href.toLowerCase();
        const title = document.title.toLowerCase();
        const body = document.body?.innerText?.slice(0, 2000).toLowerCase() || '';

        const checks = [
            { intent: 'email', test: () => /mail\.google\.com|outlook\.com|webmail|inbox/i.test(url) },
            { intent: 'calendar', test: () => /calendar\.google\.com|outlook.*calendar/i.test(url) },
            { intent: 'drive', test: () => /drive\.google\.com/i.test(url) },
            { intent: 'spreadsheet', test: () => /docs\.google\.com\/spreadsheets/i.test(url) },
            { intent: 'docs', test: () => /docs\.google\.com\/document/i.test(url) },
            { intent: 'invoice', test: () => /nfe\.|sefaz|nota.*fiscal|nfce|danfe|receita\.federal|nf-e/i.test(url + title + body) },
            { intent: 'bank', test: () => /internet.*bank|banco|agencia|conta.*corrente|extrato/i.test(url + title) },
            { intent: 'code', test: () => /github\.com|gitlab\.com|bitbucket|codepen/i.test(url) },
            { intent: 'linkedin', test: () => /linkedin\.com/i.test(url) },
            { intent: 'ecommerce', test: () => /amazon\.|mercadolivre|shopee|magalu|carrinho|cart|checkout/i.test(url + title) },
            { intent: 'youtube', test: () => /youtube\.com\/watch|youtu\.be/i.test(url) },
            { intent: 'meeting', test: () => /meet\.google\.com|zoom\.us|teams\.microsoft|webex/i.test(url) },
            { intent: 'forms', test: () => /docs\.google\.com\/forms|typeform|jotform/i.test(url) },
            { intent: 'travel', test: () => /booking\.com|airbnb|expedia|skyscanner|flights|passagem/i.test(url + title) },
            { intent: 'news', test: () => /\/news|\/noticias|g1\.globo|bbc|cnn|folha\.uol/i.test(url) },
        ];

        for (const { intent, test } of checks) {
            if (test()) return intent;
        }

        // Check for forms on any page
        const formCount = document.querySelectorAll('form').length;
        const inputCount = document.querySelectorAll('input:not([type=hidden]), textarea').length;
        if (formCount >= 1 && inputCount >= 3) return 'form_page';

        return 'general';
    }

    // Run intent detection after page loads and notify background
    if (document.readyState === 'complete') {
        setTimeout(() => {
            const intent = detectPageIntent();
            if (intent !== 'general') {
                chrome.runtime.sendMessage({
                    type: 'PAGE_INTENT_FROM_CONTENT',
                    payload: { intent, url: window.location.href, title: document.title },
                }).catch(() => { });
            }
        }, 1500);
    }

    console.log('[AI Assistant v2] Content script ready on', window.location.hostname);
})();
