// ============================================================
//  AI Browser Assistant — Vision Module
//  Gemini Vision: screenshot → coordinates → real click
//  Screenshot: JPEG 70% (optimized for Flash Lite latency)
// ============================================================

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class VisionEngine {
    constructor(apiKey, model = 'gemini-2.0-flash') {
        this.apiKey = apiKey;
        this.model = model;
    }

    // ── Analyze a screenshot with a natural language question ───
    async analyzeScreenshot(base64Image, question) {
        const url = `${GEMINI_API_BASE}/models/${this.model}:generateContent?key=${this.apiKey}`;
        const body = {
            contents: [{
                role: 'user',
                parts: [
                    {
                        inline_data: {
                            mime_type: 'image/png',
                            data: base64Image.replace(/^data:image\/\w+;base64,/, ''),
                        }
                    },
                    { text: question }
                ],
            }],
            generation_config: { temperature: 0.2, max_output_tokens: 1024 },
        };

        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!resp.ok) throw new Error(`Vision API error ${resp.status}`);
        const data = await resp.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    // ── Find element coordinates by description ─────────────────
    async findElementCoordinates(base64Image, description, viewportWidth, viewportHeight) {
        const prompt = `Você está analisando um screenshot de uma página web com resolução ${viewportWidth}x${viewportHeight} pixels.

Encontre o elemento descrito como: "${description}"

Responda SOMENTE com JSON válido no formato:
{
  "found": true,
  "x": <coordenada X em pixels do centro do elemento>,
  "y": <coordenada Y em pixels do centro do elemento>,
  "description": "<descrição breve do que foi encontrado>",
  "confidence": <0.0 a 1.0>
}

Se não encontrar, responda: {"found": false, "description": "não encontrado"}`;

        const text = await this.analyzeScreenshot(base64Image, prompt);

        // Parse JSON from response
        try {
            const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            return JSON.parse(cleaned);
        } catch {
            return { found: false, description: 'Erro ao parsear resposta da visão' };
        }
    }

    // ── Extract structured data from screenshot ─────────────────
    async extractDataFromScreenshot(base64Image, dataDescription) {
        const prompt = `Analise este screenshot e extraia as seguintes informações: ${dataDescription}

Responda em formato JSON estruturado com os dados encontrados. Se um dado não estiver visível, use null.`;

        const text = await this.analyzeScreenshot(base64Image, prompt);
        try {
            const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            return { success: true, data: JSON.parse(cleaned) };
        } catch {
            return { success: true, data: text }; // return raw text if not JSON
        }
    }

    // ── Click by vision (background orchestrates debugger) ──────
    async getClickCoordinates(base64Image, elementDescription, viewportWidth, viewportHeight) {
        const coords = await this.findElementCoordinates(
            base64Image, elementDescription, viewportWidth, viewportHeight
        );

        if (!coords.found) {
            return { error: `Elemento "${elementDescription}" não encontrado na captura de tela` };
        }

        if (coords.confidence < 0.4) {
            return { error: `Confiança baixa (${(coords.confidence * 100).toFixed(0)}%) para localizar "${elementDescription}"` };
        }

        return { success: true, x: coords.x, y: coords.y, description: coords.description, confidence: coords.confidence };
    }
}
