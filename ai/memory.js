// ============================================================
//  AI Browser Assistant — Long-term Memory (IndexedDB + RAG)
//  Persistent memory with TF-IDF similarity search
// ============================================================

const DB_NAME = 'AIBrowserMemory';
const DB_VERSION = 1;
const STORE_NAME = 'memories';

// Memory types
export const MEMORY_TYPES = {
    PREFERENCE: 'preference',       // user preferences
    EXTRACTED_DATA: 'extracted_data',   // data pulled from pages
    PAGE_SUMMARY: 'page_summary',     // summary of visited pages
    WORKFLOW: 'workflow_learning', // learned patterns
    CONVERSATION: 'conversation',     // important conversation snippets
};

// ── IndexedDB wrapper ─────────────────────────────────────────
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                store.createIndex('type', 'type', { unique: false });
                store.createIndex('url', 'url', { unique: false });
                store.createIndex('created', 'created', { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// ── TF-IDF similarity (no external dependencies) ─────────────
function tokenize(text) {
    return text.toLowerCase()
        .replace(/[^\w\sàáâãéêíóôõúç]/g, '')
        .split(/\s+/)
        .filter(t => t.length > 2);
}

function computeTFIDF(query, documents) {
    const queryTokens = tokenize(query);
    const N = documents.length;

    return documents.map((doc, idx) => {
        const docTokens = tokenize(doc.content + ' ' + (doc.keywords || ''));
        const tf = {};
        docTokens.forEach(t => { tf[t] = (tf[t] || 0) + 1; });

        let score = 0;
        queryTokens.forEach(qt => {
            const tfScore = (tf[qt] || 0) / Math.max(docTokens.length, 1);
            // IDF approximation
            const docsWithTerm = documents.filter(d =>
                tokenize(d.content + ' ' + (d.keywords || '')).includes(qt)
            ).length;
            const idf = docsWithTerm > 0 ? Math.log(N / docsWithTerm) : 0;
            score += tfScore * idf;
        });

        return { idx, score };
    });
}

// ── MemoryEngine ──────────────────────────────────────────────
export class MemoryEngine {
    constructor() {
        this.db = null;
    }

    async init() {
        this.db = await openDB();
        return this;
    }

    // ── Store a memory ─────────────────────────────────────────
    async store(type, content, metadata = {}) {
        if (!this.db) await this.init();

        const memory = {
            type,
            content: typeof content === 'string' ? content : JSON.stringify(content),
            keywords: metadata.keywords || '',
            url: metadata.url || '',
            title: metadata.title || '',
            created: Date.now(),
            accessed: Date.now(),
            importance: metadata.importance || 1, // 1-5
        };

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.add(memory);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    // ── Get all memories ───────────────────────────────────────
    async getAll() {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    // ── Semantic Cache: get cached page summary by URL ──────────
    // Returns cached summary if it exists and is < 24h old
    async getCachedPage(url) {
        if (!this.db || !url) return null;
        const all = await this.getAll();
        const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

        // Normalize URL for comparison (strip query string and hash)
        const normalizeUrl = (u) => {
            try { const p = new URL(u); return p.origin + p.pathname; } catch { return u; }
        };
        const normUrl = normalizeUrl(url);

        const match = all.find(m =>
            m.type === MEMORY_TYPES.PAGE_SUMMARY &&
            normalizeUrl(m.url) === normUrl &&
            (Date.now() - m.created) < CACHE_TTL
        );

        return match ? match.content : null;
    }

    // ── Semantic Cache: store page summary ─────────────────────
    async cachePageSummary(url, title, summary) {
        if (!url || !summary) return;
        // Remove old cache for same URL before storing new one
        const all = await this.getAll();
        const normUrl = (() => { try { const p = new URL(url); return p.origin + p.pathname; } catch { return url; } })();
        const old = all.filter(m =>
            m.type === MEMORY_TYPES.PAGE_SUMMARY &&
            (() => { try { const p = new URL(m.url); return p.origin + p.pathname; } catch { return m.url; } })() === normUrl
        );
        for (const item of old) await this._deleteById(item.id);

        return this.store(MEMORY_TYPES.PAGE_SUMMARY, summary, {
            url, title, importance: 1,
            keywords: title,
        });
    }

    async _deleteById(id) {
        if (!this.db) return;
        return new Promise((resolve) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(id);
            tx.oncomplete = resolve;
        });
    }

    // ── Search memories by semantic similarity ─────────────────
    async search(query, topK = 5, filterType = null) {
        const all = await this.getAll();

        let candidates = filterType ? all.filter(m => m.type === filterType) : all;
        if (candidates.length === 0) return [];

        const scores = computeTFIDF(query, candidates);
        const sorted = scores
            .sort((a, b) => b.score - a.score)
            .slice(0, topK)
            .filter(s => s.score > 0)
            .map(s => candidates[s.idx]);

        // Update access time for retrieved memories
        this._updateAccessed(sorted.map(m => m.id));

        return sorted;
    }

    // ── Get context memories for current page/session ──────────
    async getContext(currentUrl = '', sessionSummary = '', topK = 6) {
        const all = await this.getAll();
        if (all.length === 0) return { memories: [], contextBlock: '' };

        // Prioritize: same domain > recent > high importance
        const domain = currentUrl ? new URL(currentUrl).hostname : '';

        let relevant = all
            .map(m => ({
                ...m,
                relevanceScore: (
                    (m.url.includes(domain) ? 3 : 0) +
                    m.importance +
                    (Date.now() - m.created < 7 * 24 * 60 * 60 * 1000 ? 1 : 0) // recent (1 week)
                )
            }))
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .slice(0, topK);

        // Also search by session context
        if (sessionSummary) {
            const semantic = await this.search(sessionSummary, topK);
            // Merge, deduplicate
            const ids = new Set(relevant.map(m => m.id));
            semantic.forEach(m => { if (!ids.has(m.id)) { relevant.push(m); ids.add(m.id); } });
        }

        relevant = relevant.slice(0, topK);

        const contextBlock = this._formatContextBlock(relevant);
        return { memories: relevant, contextBlock };
    }

    // ── Format memories as system prompt context ───────────────
    _formatContextBlock(memories) {
        if (memories.length === 0) return '';

        const lines = memories.map(m => {
            const date = new Date(m.created).toLocaleDateString('pt-BR');
            const label = {
                preference: '💡 Preferência',
                extracted_data: '📊 Dado Extraído',
                page_summary: '📄 Resumo de Página',
                workflow_learning: '⚡ Workflow',
                conversation: '💬 Histórico',
            }[m.type] || '📝 Memória';

            return `[${label} - ${date}${m.url ? ' | ' + m.url.slice(0, 50) : ''}]\n${m.content.slice(0, 300)}`;
        });

        return `\n\n--- MEMÓRIA DE LONGO PRAZO (${memories.length} item(s)) ---\n${lines.join('\n\n')}\n---`;
    }

    // ── Delete a memory ────────────────────────────────────────
    async forget(id) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.delete(id);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
        });
    }

    // ── Clear all memories ─────────────────────────────────────
    async clear() {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.clear();
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
        });
    }

    // ── Auto-extract memories from conversation ────────────────
    async extractAndStore(userMessage, assistantResponse, pageUrl = '', pageTitle = '') {
        // Detect preference statements
        const prefPatterns = [
            /prefer[o|e]\s+(.+)/i, /gosto\s+de\s+(.+)/i, /sempre\s+use\s+(.+)/i,
            /meu\s+(email|nome|telefone|endereço)\s+é\s+(.+)/i,
        ];
        for (const pat of prefPatterns) {
            if (pat.test(userMessage)) {
                await this.store(MEMORY_TYPES.PREFERENCE, userMessage, {
                    keywords: 'preferência usuário', url: pageUrl, importance: 3
                });
                break;
            }
        }

        // Detect extracted data in assistant response
        if (assistantResponse.length > 200 && pageUrl) {
            await this.store(MEMORY_TYPES.PAGE_SUMMARY, assistantResponse.slice(0, 500), {
                url: pageUrl, title: pageTitle, keywords: pageTitle, importance: 2
            });
        }
    }

    _updateAccessed(ids) {
        if (!this.db || ids.length === 0) return;
        const tx = this.db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        ids.forEach(id => {
            const req = store.get(id);
            req.onsuccess = () => {
                if (req.result) {
                    req.result.accessed = Date.now();
                    store.put(req.result);
                }
            };
        });
    }

    // ── Get memory count ───────────────────────────────────────
    async count() {
        const all = await this.getAll();
        return all.length;
    }
}
