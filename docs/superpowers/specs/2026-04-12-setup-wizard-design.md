# Setup Wizard — Design Spec

**Data:** 2026-04-12
**Projeto:** testn8nmetaapi
**Contexto:** Clientes não-técnicos (donos de clínica) precisam configurar o sistema ao acessar a URL do Render pela primeira vez, sem intervenção técnica.

---

## 1. Fluxo geral

```
Primeira visita (sem usuário cadastrado)
└─ GET / → detecta: sem usuário → screen-register
   → POST /api/auth/register → cria conta (nome + email + senha)
   → screen-setup-1: Provedor de IA (provider + key + modelo + teste)
   → screen-setup-2: Meta (VERIFY_TOKEN + APP_SECRET)
   → screen-setup-done: "Tudo configurado!" → screen-app

Retorno sem sessão ativa
└─ GET / → detecta: usuário existe, sem JWT válido → screen-login
   → POST /api/auth/login → JWT cookie → screen-app (se setup_complete=true)
                                       → screen-setup-1 (se setup_complete=false)

Retorno com sessão ativa
└─ GET / → detecta: JWT válido + setup_complete=true → screen-app direto

Editar configurações depois
└─ screen-app → clica ⚙️ no header → panel-settings desliza
   → edita campos individualmente → salva na hora → feedback inline
```

**Roteamento JS ao carregar a página:**
```
GET /api/auth/me
  → 401 + sem usuário cadastrado → screen-register
  → 401 + usuário existe         → screen-login
  → 200 + setup_complete = false → screen-setup-1
  → 200 + setup_complete = true  → screen-app
```

---

## 2. Autenticação

- **Registro:** único, só permitido enquanto tabela `users` está vazia. Após criação do primeiro usuário, endpoint retorna 403.
- **Senha:** mínimo 8 caracteres, validado no backend. Hash com `bcryptjs`.
- **Sessão:** JWT em cookie `httpOnly`, `SameSite=Strict`, duração 30 dias.
- **Rate limiting:** `/api/auth/login` limitado a 5 tentativas/minuto por IP (via `@fastify/rate-limit` já instalado).
- **Logout:** `POST /api/auth/logout` limpa o cookie.
- **Esqueceu a senha:** mensagem "Entre em contato com o administrador". Reset manual no banco pelo Douglas.
- **Usuários:** 1 por instância (single-tenant MVP).

---

## 3. Armazenamento

### Novas tabelas

```sql
-- 006_add_users.sql
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 007_add_settings.sql
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Chaves em `settings`

| key | descrição | configurado por |
|---|---|---|
| `llm_provider` | `anthropic` \| `openai` \| `gemini` | cliente (wizard step 1) |
| `llm_api_key` | API key do provedor escolhido | cliente (wizard step 1) |
| `llm_model` | modelo selecionado | cliente (wizard step 1) |
| `meta_verify_token` | token de verificação Meta | cliente (wizard step 2) |
| `meta_app_secret` | secret do app Meta | cliente (wizard step 2) |
| `setup_complete` | `true` \| `false` | sistema |

### Env vars que viram opcionais em `env.ts`
`ANTHROPIC_API_KEY`, `META_VERIFY_TOKEN`, `META_APP_SECRET` → `.optional()`

### Env vars que permanecem obrigatórias (infra)
`DATABASE_URL`, `BACKEND_API_KEY`, `N8N_WEBHOOK_URL`, `N8N_INTERNAL_AUTH_TOKEN`

---

## 4. Wizard — UX por step

### screen-register (primeira vez)
- Campos: nome, email, senha (mín. 8 chars)
- Validação frontend + backend
- Sucesso → redireciona para screen-setup-1

### screen-login (retorno)
- Campos: email, senha
- Rate limit: 5 tentativas/min → mensagem "Muitas tentativas, aguarde 1 minuto"
- Sucesso → screen-app ou screen-setup-1 conforme `setup_complete`

### screen-setup-1 — Inteligência Artificial
- Selector visual de provedor: **Anthropic** / **OpenAI** / **Google Gemini**
- Campo API Key (type=password com toggle mostrar/ocultar)
- Dropdown de modelo pré-populado por provedor:
  - Anthropic: `claude-haiku-4-5` / `claude-sonnet-4-6` / `claude-opus-4-6`
  - OpenAI: `gpt-4o-mini` / `gpt-4o`
  - Gemini: `gemini-2.0-flash` / `gemini-1.5-pro`
- Botão **"Testar conexão"** → chama `POST /api/setup/test-llm` → resposta inline ("✅ Conexão OK" / "❌ Chave inválida")
- Linguagem simples: "Cole aqui a chave da sua conta de IA. Ela começa com sk-ant (Anthropic) ou sk- (OpenAI)."
- Botão **"Próximo"** só habilita após teste bem-sucedido
- Salva no banco ao avançar (step persistido — fechar o browser não perde o progresso)

### screen-setup-2 — Instagram / Meta
- Campo **Token de Verificação**: texto livre, mín. 8 chars. Explicação: "Você mesmo escolhe esse valor — anote e use o mesmo quando configurar o webhook no Meta."
- Campo **App Secret**: explicação: "Encontrado em Meta for Developers → Seu App → Configurações básicas → App Secret."
- Link de ajuda para documentação Meta (abre em nova aba)
- Botão **"Salvar e finalizar"** → persiste no banco → `setup_complete = true`

### screen-setup-done
- Mensagem de sucesso visual
- Botão "Abrir o sistema" → screen-app

### panel-settings (gear icon no header do screen-app)
- Lista todos os campos configuráveis
- Valores mascarados com toggle mostrar/ocultar
- Cada campo tem botão "Editar" inline → salva individualmente via `PUT /api/settings`
- Feedback: "✅ Salvo" ou "❌ Erro ao salvar"
- Botão "Sair" (logout)

---

## 5. Componentes novos e impacto por arquivo

### Novos arquivos

| Arquivo | Responsabilidade |
|---|---|
| `db/migrations/006_add_users.sql` | Tabela users |
| `db/migrations/007_add_settings.sql` | Tabela settings |
| `src/services/settingsService.ts` | get/set settings no banco + cache em memória (invalidado no set) |
| `src/services/authService.ts` | hashPassword, comparePassword, signToken, verifyToken |
| `src/services/llmService.ts` | Abstração multi-provider: AnthropicAdapter, OpenAIAdapter, GeminiAdapter |
| `src/routes/auth.ts` | POST /api/auth/register, /login, /logout, GET /api/auth/me |
| `src/routes/settings.ts` | GET /api/settings, PUT /api/settings |

### Arquivos modificados

| Arquivo | O que muda |
|---|---|
| `src/config/env.ts` | ANTHROPIC_API_KEY, META_VERIFY_TOKEN, META_APP_SECRET → `.optional()` |
| `src/app/createApp.ts` | Adiciona @fastify/jwt, @fastify/cookie, auth middleware, novas rotas |
| `src/services/promptTesterService.ts` | `askAnthropic()` → `llmService.ask()` |
| `src/routes/meta.ts` | Lê `meta_app_secret` / `meta_verify_token` do settingsService |
| `src/routes/tester.ts` | Lê `llm_api_key` do settingsService (fallback para env) |
| `src/ui.html` | Adiciona screens e panel-settings; organizado por seções comentadas |
| `package.json` | Adiciona @fastify/jwt, @fastify/cookie, bcryptjs, @types/bcryptjs |

---

## 6. LLM Service — interface

```typescript
interface LLMRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
}

interface LLMAdapter {
  ask(req: LLMRequest): Promise<string>;
}

// Erros traduzidos para o usuário:
// HTTP 401 → "Chave de API inválida. Verifique e tente novamente."
// HTTP 429 → "Limite de uso atingido. Aguarde alguns instantes."
// Network error → "Não foi possível conectar ao serviço de IA."

export async function askLLM(req: LLMRequest): Promise<string>
// lê provider/key/model do settingsService, instancia o adapter correto
```

---

## 7. Rotas — visão geral

| Rota | Método | Auth | Descrição |
|---|---|---|---|
| `/api/auth/register` | POST | público (só se users vazia) | Cria conta |
| `/api/auth/login` | POST | público + rate limit | Login |
| `/api/auth/logout` | POST | JWT | Logout |
| `/api/auth/me` | GET | JWT | Retorna user + setup_complete |
| `/api/setup/test-llm` | POST | JWT | Testa conexão com LLM |
| `/api/settings` | GET | JWT | Retorna settings (valores mascarados) |
| `/api/settings` | PUT | JWT | Atualiza um ou mais campos |
| `/api/prompts` | GET | JWT | Existente |
| `/api/run` | POST | JWT | Existente |
| `/api/chat` | POST | JWT | Existente |
| `/webhooks/*` | POST | BACKEND_API_KEY | Existente — não muda |
| `/api/health` | GET | público | Existente |

---

## 8. Guardrails de qualidade

- Rate limit no login: 5 req/min por IP
- Senha: mínimo 8 chars (backend + frontend)
- JWT: httpOnly + SameSite=Strict (mitiga CSRF)
- Registro: 403 se usuário já existe
- LLM adapters: erros HTTP traduzidos em mensagem legível
- `ui.html`: organizado com comentários de seção (`<!-- SCREEN: login -->` etc.)
- Settings retornados com valores mascarados (`***`) exceto quando editando

---

## 9. O que fica para pós-MVP

- Reset de senha por email
- Múltiplos usuários / roles
- Refresh token
- Verificação de email no registro
- Separar ui.html em componentes
- OpenRouter como opção de provedor
