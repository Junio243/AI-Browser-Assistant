# AI Browser Assistant — Documentação Completa do Sistema

> **Versão:** 3.0  
> **Modelo padrão:** `gemini-2.5-flash-lite-preview-09-2025`  
> **Tecnologia:** Extensão Chrome (Manifest V3) + Google Gemini API  
> **Autor:** [Alexandre Junio Canuto Lopes](https://github.com/Junio243)

---

## Créditos

```
╔══════════════════════════════════════════════════════════╗
║           AI Browser Assistant — Criado por              ║
║                                                          ║
║   Nome:    Alexandre Junio Canuto Lopes                  ║
║   Username: Junio243                                     ║
║   GitHub:  https://github.com/Junio243                   ║
║   Email:   canutojunio72@gmail.com                       ║
║                                                          ║
║   "Um agente autônomo que pensa, age e aprende           ║
║    enquanto navega pelo seu lado."                       ║
╚══════════════════════════════════════════════════════════╝
```

---

## 1. Visão Geral

O **AI Browser Assistant** é uma extensão do Chrome que transforma o Gemini em um agente autônomo capaz de **operar o navegador em seu nome**. Diferente de um simples chatbot, o sistema planeja, executa ações, se auto-recupera de erros, vê a tela via visão computacional, aprende com o uso e antecipa suas necessidades.

### Capacidades principais

| Capacidade | Descrição |
|---|---|
| 🤖 Agente ReAct | Raciocina → Age → Observa → Corrige (até 10 iterações) |
| 👁 Visão Computacional | Captura screenshot e localiza elementos pela descrição visual |
| 🧠 Memória de Longo Prazo | Armazena dados entre sessões com busca TF-IDF (IndexedDB) |
| 📋 Planejador Hierárquico | Decompõe tarefas complexas em sub-passos com dependências |
| 🛡 Safety Interceptor | Classifica e bloqueia ações de risco antes da execução |
| 🔮 Detecção Proativa | Detecta o contexto da página e sugere ações relevantes |
| ⏰ Agendador Automático | Agenda e executa tarefas recorrentes sem intervenção do usuário |
| ⚡ Workflows Automáticos | Grava, salva e executa sequências automaticamente por URL |
| 🟠 Borda de Controle | Indicador visual laranja quando a IA está no controle |
| 🖱 Cursor Animado | Visualiza em tempo real onde o agente está clicando |
| 🗄 Cache Semântico | Reutiliza resumos de páginas já visitadas (24h) |
| ✂️ Truncamento Inteligente | Limita tokens enviados à API com base no tipo de objetivo |
| 🎯 Detecção de Objetivo | Para automaticamente quando a URL de destino é atingida |
| 🔌 Endpoint Customizável | Suporta qualquer API compatível com OpenAI (Colab, Groq, etc.) |

---

## 2. Arquitetura do Sistema

```
┌─────────────────────────────────────────────────────────────┐
│                      SIDE PANEL (UI)                        │
│   sidepanel.html + sidepanel.css + sidepanel.js             │
│  ┌──────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ ┌────────┐  │
│  │ Chat │ │Workflows │ │ Agenda   │ │Memória │ │Config  │  │
│  └──────┘ └──────────┘ └──────────┘ └────────┘ └────────┘  │
└──────────────────┬─────────────────────┬────────────────────┘
                   │ importa módulos AI   │ chrome.runtime messages
                   ▼                     ▼
┌──────────────────────────┐  ┌──────────────────────────────┐
│       MÓDULOS AI         │  │    BACKGROUND SERVICE        │
│  ai/gemini.js            │  │    background.js             │
│  ai/agent_loop.js        │  │    ► Tab management          │
│  ai/planner.js           │  │    ► Tool dispatcher         │
│  ai/memory.js            │  │    ► Vision orchestration    │
│  ai/safety.js            │  │    ► Auto-workflow triggers  │
│  ai/vision.js            │  │    ► Auto-memory capture     │
└──────────────────────────┘  │    ► Alarms (auto-open side) │
                              └──────────────┬───────────────┘
                                             │ chrome.scripting
                                             ▼
                              ┌──────────────────────────────┐
                              │      CONTENT SCRIPT          │
                              │      content/content.js      │
                              │  ► read_page (DOM Trimmed)   │
                              │  ► click_element + animação  │
                              │  ► fill_input + animação     │
                              │  ► scroll_page               │
                              │  ► agent_start / agent_stop  │
                              │  ► animate_cursor            │
                              │  ► Workflow recorder         │
                              └──────────────────────────────┘
```

---

## 3. Estrutura de Arquivos

```
ia claude/
├── manifest.json              # Configuração da extensão (MV3)
├── background.js              # Service Worker principal
├── DOCUMENTACAO.md            # Este arquivo
│
├── ai/                        # Módulos de inteligência
│   ├── gemini.js              # GeminiChat + OpenAIChat + createChatClient()
│   ├── agent_loop.js          # Loop ReAct + Token Truncation + Goal Detection
│   ├── planner.js             # Planejador hierárquico de tarefas
│   ├── memory.js              # Memória longa (IndexedDB + TF-IDF + Semantic Cache)
│   ├── safety.js              # Interceptor de segurança por nível de risco
│   └── vision.js              # Motor de visão computacional (Gemini Vision)
│
├── content/
│   └── content.js             # Script injetado em todas as páginas (DOM Trim + Cursor + Border)
│
├── sidepanel/
│   ├── sidepanel.html         # Interface principal (painel lateral)
│   ├── sidepanel.css          # Estilos
│   └── sidepanel.js           # Controlador da UI e orquestrador do agente
│
├── popup/
│   ├── popup.html
│   └── popup.js
│
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 4. Fluxo de Execução Completo (v3.0)

```
Usuário digita mensagem
        │
        ▼
[sidepanel.js] handleSend()
        │
        ├─► START_RECORDING automático ← Inicia gravação de workflow imediatamente
        │
        ├─► injectMemoryContext()
        │     ├─ getCachedPage(url) → existe cache < 24h? → injeta resumo
        │     └─ getContext() → memórias relevantes (TF-IDF)
        │
        ├─► isComplexTask()?
        │     └─ SIM → showPlanView() → Planner.createPlan() → aprovação
        │
        ├─► agent_start → 🟠 Borda laranja aparece na página
        │
        └─► agentLoop.run(goal)
                │
        ┌───────┘
        │
        ▼  ── LOOP (máx. 10 iterações) ────────────────────────────────
        │
        ├─[REASON] gemini.sendMessage()
        │
        ├─[ACT] Para cada tool_call:
        │   ├─ safety.intercept() → avalia risco
        │   ├─ smartTruncateResult() → corta bodyText se > 4.000 chars
        │   │                          ou omite body em nav-only na 1ª iteração
        │   ├─ checkGoalReached() → URL de destino atingida? → PARA LOOP
        │   │
        │   └─ chrome.runtime.sendMessage(EXECUTE_TOOL)
        │         └─ background.js → dispatchTool()
        │               ├─ click_element / fill_input → 🖱 Cursor animado
        │               ├─ navigate → re-injeta borda laranja na nova página
        │               ├─ vision_click → animate_cursor nas coords + debugger
        │               └─ demais tools → Tab APIs do Chrome
        │
        ├─[OBSERVE] Resultado retorna ao AgentLoop
        │   └─ Erro → _executeWithHealing() → RECOVERY_PROMPT → retry
        │
        └─ gemini.submitToolResults() → Gemini raciocina novamente
              └─ Sem tool_calls → DONE ──────────────────────────────►
                                          agent_stop → 🟠 Borda some
                                          STOP_RECORDING → passos gravados
                                          saveWorkflow(steps) automático ⚡
                                          memory.store(workflow_learning) 🧠
                                          cachePageSummary(url) 🗄
                                          memory.extractAndStore()
```

---

## 5. Módulos Detalhados

### 5.1 `ai/gemini.js` — Cliente Multi-Provider

**Exportações:**

| Classe/Função | Descrição |
|---|---|
| `GeminiChat` | Cliente original da API Google Gemini |
| `OpenAIChat` | Cliente compatível com qualquer API OpenAI (`/v1/chat/completions`) |
| `createChatClient(key, model, opts)` | Factory que escolhe automaticamente o cliente correto |

**`GeminiChat`** — Configuração:
- Temperatura: `0.7` · Max tokens: `8.192` · Tool mode: `AUTO`

**`OpenAIChat`** — Converte automaticamente as `TOOL_DECLARATIONS` do Gemini para o formato `functions` da OpenAI. Compatível com:

| Provedor | Como usar |
|---|---|
| Google Colab + ngrok | URL do ngrok como endpoint |
| LM Studio (local) | `http://localhost:1234` |
| Groq | `https://api.groq.com/openai` |
| Together.ai | `https://api.together.xyz` |
| OpenAI | `https://api.openai.com` |

**`createChatClient(apiKey, model, {customEndpoint, customModel})`**  
- Se `customEndpoint` preenchido → retorna `OpenAIChat`  
- Caso contrário → retorna `GeminiChat`

---

### 5.2 `ai/agent_loop.js` — Loop ReAct + Inteligência de Tokens

**Constantes:**
- `MAX_ITERATIONS = 10`
- `MAX_TOOL_RETRIES = 3`
- `MAX_PAGE_TOKENS = 4.000` chars

**Novas funções exportáveis:**

#### `smartTruncateResult(toolName, result, goal, iteration)`
Reduz tokens enviados à API:

| Situação | Comportamento |
|---|---|
| Objetivo de navegação simples na 1ª iteração | Omite `bodyText` completamente |
| `bodyText` > 4.000 chars | Trunca e adiciona nota `[truncado: N chars omitidos]` |
| Outros casos | Passa sem alteração |

**Palavras-chave de navegação simples:** `abra`, `abrir`, `vá para`, `navegue`, `acesse`, `ir para`, `open`, `go to`

#### `checkGoalReached(goal, toolName, result)`
Verifica se a URL atual contém o domínio pedido:
- Extrai domínio de URLs explícitas ou nomes de sites reconhecidos
- Retorna `true` logo após `navigate` ou `open_tab` se URL bater
- Encerra o loop imediatamente ao retornar `true`

**Auto-recuperação (`_executeWithHealing`):**

| Tipo de erro | Estratégia injetada no Gemini |
|---|---|
| `element_not_found` | Aguardar, tentar seletor alternativo, rolar |
| `navigation_error` | Verificar URL, identificar pop-up |
| `fill_error` | Clicar no campo, seletor alternativo |
| `generic` | Ler página e tentar diferente |

---

### 5.3 `ai/planner.js` — Planejador Hierárquico

**Detecção de complexidade:** ≥2 palavras-chave (`organizar`, `comparar`, `extrair`, `relatório`, `agenda`, `múltiplas`, etc.) ou mensagem > 100 chars.

**Formato do plano:**
```json
{
  "goal": "objetivo resumido",
  "estimated_duration": "~5 minutos",
  "steps": [
    { "id": 1, "description": "Navegar para o Gmail", "tool_hint": "navigate", "depends_on": [], "reversible": true }
  ]
}
```

---

### 5.4 `ai/memory.js` — Memória de Longo Prazo + Semantic Cache

**Banco:** `AIBrowserMemory` (IndexedDB) · Store: `memories`  
Índices: `type`, `url`, `created`

**Tipos de memória:**

| Tipo | Quando criado |
|---|---|
| `preference` | Usuário expressa preferência |
| `extracted_data` | Dados extraídos de páginas |
| `page_summary` | Resumos de páginas visitadas |
| `workflow_learning` | Workflows gravados (automáticos e manuais) |
| `conversation` | Trechos importantes de conversas |

**Novos métodos — Semantic Cache:**

#### `getCachedPage(url)`
- Normaliza a URL (remove query string e hash)
- Busca `page_summary` para aquela URL com menos de **24h**
- Retorna o conteúdo em cache ou `null`

#### `cachePageSummary(url, title, summary)`
- Remove entradas antigas para a mesma URL
- Salva novo resumo com `importance: 1`

**Injeção no contexto:**  
Se existe cache para a URL atual → injeta como `[CACHE SEMÂNTICO]` antes das memórias gerais, evitando processar a página novamente.

---

### 5.5 `ai/safety.js` — Safety Interceptor

| Nível | Ferramentas | Comportamento |
|---|---|---|
| `SAFE` ✅ | `read_page`, `take_screenshot`, `list_tabs`, `vision_read` | Executa direto |
| `LOW` 🔵 | `switch_tab`, `open_tab` | Executa direto |
| `MEDIUM` 🟡 | `navigate`, `click_element`, `fill_input`, `vision_click` | Notifica (manual) |
| `HIGH` 🟠 | `close_tab`, `replay_workflow` | Pede aprovação (manual) |
| `CRITICAL` 🔴 | Detectado por padrões | **Sempre pede aprovação** |

**Padrões CRITICAL:** `checkout`, `payment`, `senha`, `password`, `cvv`, `confirmar pagamento`, `deletar`, `excluir`.

---

### 5.6 `ai/vision.js` — Visão Computacional

| Método | Descrição |
|---|---|
| `analyzeScreenshot(image, question)` | Análise em linguagem natural |
| `findElementCoordinates(image, desc, w, h)` | Retorna `{x, y, confidence}` |
| `getClickCoordinates(…)` | Rejeita se confidence < 40% |

---

### 5.7 `background.js` — Service Worker

**Automações no `tabs.onUpdated`:**

1. **Sugestão proativa** — detecta intent por URL e notifica o painel lateral
2. **Auto-Workflow trigger** — se workflow tem `autoTrigger` compatível com a URL → envia `AUTO_RUN_WORKFLOW`
3. **Auto-Memory capture** — após 2,5s: executa `read_page`, envia `AUTO_STORE_MEMORY`

**`alarms.onAlarm` (Agenda automática):**
- Quando o alarme dispara → tenta abrir o side panel (`chrome.sidePanel.open`)
- Aguarda 1,5s para inicialização → envia `RUN_SCHEDULED_TASK`

**`navigateTab`:**  
Após navegação completa, re-injeta `agent_start` na nova página → borda laranja persiste ao trocar de site.

---

### 5.8 `content/content.js` — Content Script

**DOM Trimming em `readPage()`:**

| Elemento removido (clone) | Razão |
|---|---|
| `<script>`, `<style>` | Não é conteúdo legível |
| `<svg>`, `<canvas>`, `<iframe>` | Desnecessário para o agente |
| `<video>`, `<audio>`, `<noscript>` | Ruído |
| Comentários HTML | TreeWalker SHOW_COMMENT |

Resultado: texto limpo, colapsado, máximo **6.000 chars** (era 8.000).

**Ferramentas disponíveis:**

| Ferramenta | Funcionamento |
|---|---|
| `read_page` | DOM trimmed: sem ruído, max 6.000 chars, 60 elementos interativos (id + class + selector) |
| `click_element` | Cursor 🤖 animado → trilha de pontos → ripple duplo → `clickElement()` |
| `fill_input` | Cursor anima até o campo → foco → `nativeInputValueSetter` → React/Vue compatible |
| `scroll_page` | 4 direções ou scroll até seletor |
| `get_console_logs` | Intercepta `log/warn/error/info`, retorna últimos 50 |
| `highlight_element` | Outline + box-shadow roxo por 3s |
| `animate_cursor` | Move cursor 🤖 para coordenadas (x, y) com trilha |
| `agent_start` | Liga borda laranja pulsante + badge "🤖 IA no controle" |
| `agent_stop` | Desliga borda com fade-out |

---

### 5.9 `sidepanel/sidepanel.js` — Controlador da UI

**Ciclo automático de cada execução:**

```
1. START_RECORDING → grava todas as ações do agente
2. agent_start    → borda laranja acende
3. agentLoop.run()
4. agent_stop     → borda some
5. STOP_RECORDING → retorna passos gravados
6. saveWorkflow() → salva com nome do objetivo + autoTrigger (hostname)
7. memory.store(WORKFLOW) → converte em memória automaticamente
```

**Abas e funcionalidades:**

| Aba | Automação |
|---|---|
| 💬 Chat | Semantic cache injeta contexto de páginas conhecidas |
| ⚡ Workflows | Auto-executados quando URL bate com `autoTrigger` |
| 🕐 Agenda | Painel abre sozinho quando alarme dispara |
| 🧠 Memória | Auto-captura ao visitar páginas reconhecidas |
| ⚙️ Config | Suporta endpoint customizado OpenAI-compatível |

**Configurações de endpoint (⚙️ Config → Endpoint Customizado):**
- URL do endpoint (ex: `https://xxxx.ngrok.io`)
- Nome do modelo (ex: `llama-3.1-8b-instruct`)
- API Key do endpoint (opcional)

---

## 6. Indicadores Visuais na Página

### 🟠 Borda Laranja de Controle

| Estado | Significado |
|---|---|
| Borda laranja pulsante + badge "🤖 IA no controle" | A IA está executando ações na página |
| Borda some com fade | Tarefa concluída |
| Borda persiste ao navegar | Re-injetada automaticamente em cada nova página |

> **Por que existe?** Transparência e segurança — você precisa saber quando a extensão age de forma autônoma com suas credenciais e permissões.

### 🖱 Cursor Animado

| Elemento | Descrição |
|---|---|
| Bolinha roxa 🤖 | Representação do cursor do agente, desliza suavemente |
| Trilha de pontos | 8 pontos roxos ao longo do caminho percorrido |
| Ripple duplo | Dois círculos se expandindo no ponto de clique |

> **Por que existe?** Visualização em tempo real de onde a IA está clicando — como se outra pessoa estivesse usando o mouse.

---

## 7. Ferramentas Disponíveis para o Agente

| Ferramenta | Tipo | Risco | Descrição |
|---|---|---|---|
| `read_page` | DOM | SAFE | Lê conteúdo DOM trimmed — sem ruído, max 6k chars |
| `click_element` | DOM | MEDIUM | Clica por seletor/texto/índice com cursor animado |
| `fill_input` | DOM | MEDIUM | Preenche campos com cursor animado + eventos React/Vue |
| `scroll_page` | DOM | SAFE | Rola a página em 4 direções |
| `get_console_logs` | DOM | SAFE | Lê logs do console (últimos 50) |
| `highlight_element` | DOM | SAFE | Destaca elemento com brilho roxo |
| `navigate` | Tab | MEDIUM | Navega para URL (mantém borda laranja) |
| `open_tab` | Tab | LOW | Abre nova aba |
| `close_tab` | Tab | HIGH | Fecha aba |
| `switch_tab` | Tab | LOW | Muda foco de aba |
| `list_tabs` | Tab | SAFE | Lista abas abertas |
| `take_screenshot` | Tab | SAFE | Captura JPEG 70% |
| `wait` | — | SAFE | Aguarda N segundos |
| `replay_workflow` | — | HIGH | Executa sequência gravada |
| `vision_click` | Vision | MEDIUM | Localiza e clica por descrição visual com cursor animado |
| `vision_read` | Vision | SAFE | Analisa screenshot via Gemini Vision |

---

## 8. Fluxo de Visão Computacional

```
Agente: vision_click("botão azul Enviar")
        │
        ▼
background.js: takeScreenshot() → JPEG 70%
        │
        ▼
VisionEngine.getClickCoordinates()
   └─► Gemini Vision: "Onde está o botão azul Enviar em 1280x800?"
   └─► {found: true, x: 640, y: 420, confidence: 0.95}
        │
        ├─ confidence < 0.4? → erro
        │
        ▼
content.js: animate_cursor(640, 420)    ← cursor anima até o ponto
        │
        ▼ (aguarda 700ms)
clickViaDebugger(tabId, 640, 420)
   ├─ chrome.debugger.attach()
   ├─ mouseMoved → mousePressed → 80ms → mouseReleased
   └─ chrome.debugger.detach()
```

---

## 9. Sistema de Memória (RAG Local + Cache)

```
Antes de cada tarefa:
        │
        ▼
getCachedPage(url)
   └─ Existe cache < 24h? ──► SIM → injeta [CACHE SEMÂNTICO] no Gemini
                                           (evita processar a página de novo)
        │
        ▼ NÃO (ou após cache)
getContext(url, sessionSummary)
   ├─ Score = (mesmo domínio × 3) + importância + (recente × 1)
   ├─ Top-6 memórias por score
   ├─ Busca TF-IDF com resumo da sessão
   └─ Injeta [CONTEXTO DE MEMÓRIA] no histórico do Gemini

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Ao final de cada tarefa:
        │
        ├─► cachePageSummary(url, title, summary) → TTL 24h
        ├─► memory.store(workflow_learning, steps) → aprendizado permanente
        └─► memory.extractAndStore(userGoal, ...) → preferências e dados
```

---

## 10. Automação Completa (Zero Interação do Usuário)

### ⚡ Workflows Automáticos
1. Ao **salvar** um workflow → `autoTrigger` armazena o hostname da página atual
2. Ao **navegar** para aquela URL → `background.js` detecta e envia `AUTO_RUN_WORKFLOW`
3. O painel executa o workflow e notifica com toast
4. Badge 🤖 na lista indica workflows com auto-execução ativa

### 🧠 Memória Automática
1. Ao navegar para página reconhecida (Gmail, Drive, GitHub, etc.)
2. `background.js` aguarda 2,5s → executa `read_page`
3. Envia `AUTO_STORE_MEMORY` ao painel
4. Toast **"🧠 Página memorizada automaticamente"**

### 🕐 Agenda Automática
1. Alarme dispara via `chrome.alarms`
2. `background.js` abre o side panel (`chrome.sidePanel.open`)
3. Aguarda 1,5s → envia `RUN_SCHEDULED_TASK`
4. Agente executa a tarefa normalmente

---

## 11. Fluxo do Safety Gate

```
Ferramenta solicitada
            │
            ▼
        safety.intercept()
            │
            ├─[SAFE/LOW]──────────────────► Executa
            │
            ├─[MEDIUM] ──► Manual? ──────► Notifica
            │              Auto:  ────────► Executa
            │
            ├─[HIGH] ────► Manual? ──────► Pede aprovação → Executa/Bloqueia
            │              Auto:  ────────► Executa
            │
            └─[CRITICAL]─────────────────► Sempre pede aprovação
                          └─ Aprovado? ──► Executa
                          └─ Negado?  ──► {error: "BLOQUEADO"}
```

---

## 12. Permissões da Extensão

| Permissão | Finalidade |
|---|---|
| `activeTab` | Acessar a aba ativa |
| `tabs` | Gerenciar todas as abas |
| `storage` | API Key, configurações, workflows |
| `alarms` | Agendar tarefas recorrentes |
| `sidePanel` | Abrir o painel lateral |
| `scripting` | Injetar content script + cursor/borda nas páginas |
| `notifications` | Notificações do sistema |
| `debugger` | Injetar eventos de mouse reais via CDP (vision_click) |
| `<all_urls>` (host) | Operar em qualquer site |

---

## 13. Configuração e Instalação

### Requisitos
- Google Chrome 114+ (ou Chromium)
- API Key do Google Gemini — [obtida aqui](https://aistudio.google.com/app/apikey)
- **Opcional:** endpoint OpenAI-compatível (Colab, Groq, LM Studio, etc.)

### Instalação
1. Abra `chrome://extensions/`
2. Ative o **Modo desenvolvedor**
3. Clique em **Carregar sem compactação**
4. Selecione a pasta `ia claude`

### Configuração inicial
1. Clique no ícone → painel lateral abre
2. Vá em ⚙️ **Config**
3. Cole sua **API Key** do Gemini e salve
4. **Opcional:** configure um endpoint customizado (seção "Endpoint Customizado")
5. Escolha o modo: **Manual** ou **Autônomo**

---

## 14. Modelos Disponíveis

### Google Gemini (padrão)

| Modelo | Uso recomendado |
|---|---|
| `gemini-2.5-flash-lite-preview-09-2025` | **Padrão** — rápido, econômico, ideal para maioria das tarefas |
| `gemini-2.0-flash` | Mais capaz para tarefas complexas |
| `gemini-2.0-flash-thinking-exp` | Raciocínio avançado |
| `gemini-1.5-pro` | Máxima capacidade |

### Modelos via Endpoint Customizado (exemplos)

| Modelo | Provedor |
|---|---|
| `llama-3.3-70b-versatile` | Groq (gratuito) |
| `llama-3.1-8b-instruct` | LM Studio (local) |
| `mixtral-8x7b-instruct` | Together.ai |
| Qualquer modelo no Colab | Google Colab + ngrok |

---

## 15. Exemplos de Uso

### Navegação simples (Goal Detection + Token Truncation)
> "Abra a Wikipedia"

→ `navigate(wikipedia.org)` → URL contém "wikipedia" → **loop encerra imediatamente**  
→ Body da página **não é enviado** à API na 1ª iteração (nav-only)

### Tarefa com cache semântico
> "Qual o meu saldo no Gmail?" (segunda visita do dia)

→ Cache da sessão anterior é injetado automaticamente → agente não precisa reler a página toda

### Tarefa complexa (com planejamento)
> "Acesse meu Gmail, encontre os e-mails não lidos e faça um resumo dos 5 mais importantes"

→ Planner decompõe → usuário aprova → AgentLoop executa com visão se necessário

### Workflow auto-executável
1. Grave ações em `mail.google.com` → salve como "Checar emails importantes"
2. Da próxima visita ao Gmail → executa automaticamente com toast ⚡

### Usando Colab/ngrok como backend
1. Configure endpoint: `https://xxxx-34-123.ngrok.io`
2. Modelo: `llama-3.1-8b-instruct`
3. O agente usará seu Colab em vez da API Gemini paga

---

*AI Browser Assistant v3.0 — Documentação atualizada em 28/02/2026*  
*Criado por **Alexandre Junio Canuto Lopes** ([@Junio243](https://github.com/Junio243))*
