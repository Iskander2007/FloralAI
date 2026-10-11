# FloralAI

FloralAI is a florist-focused assistant preview built with Next.js App Router, React, TypeScript and Tailwind CSS. It includes one consistent dark, responsive design across the product site, flower-order demo, account screens, onboarding flow and every dashboard section.

## Current status

| Capability | Status |
| --- | --- |
| Landing page and responsive navigation | Working |
| Five interactive sample business demos | Working with deterministic mock replies |
| Signup and login | Supabase email/password and Google OAuth when configured; otherwise a clearly labelled browser-local demo |
| Business profile and dashboard data | Browser-local preview data; not yet stored in a user-owned production database |
| Dashboard, assistant test chat, knowledge editor and empty states | Working with browser-local demo data |
| `/api/chat` | Validated request shape; mock mode by default; optional server-side OpenAI-compatible provider |
| Flower shop order assistant (`/flower-shop`) | Guided ordering in English, Russian and Kazakh; PostgreSQL persistence requires database setup |
| Telegram florist bot (`/api/telegram/webhook`) | Webhook code ready; requires a BotFather token, public deployment and PostgreSQL; not connected yet |
| PostgreSQL data model | Prisma schema includes flower orders; connect `DATABASE_URL` before saving orders |
| Vercel hosting | Deployed on the free Hobby plan; public demo link below |
| Supabase Auth, Google OAuth, card payments, WhatsApp, Instagram and Google Business | Require provider account setup and credentials; not configured by default |

The app is a functional product preview, not a production-ready multi-tenant SaaS. Do not put real customer data in it. When Supabase is configured, dashboard navigation is protected by a verified server session, but business/profile data remains in this browser and the chat/order APIs are not tenant-isolated.

The flower-shop page and Telegram handler use a deterministic guided conversation, not an LLM. Sample products and prices are illustrative; there is no live inventory, card payment, or owner order-management screen. Customers can choose cash on delivery or a bank transfer after the shop confirms the order. PostgreSQL is required to save confirmed orders. Telegram message delivery uses Telegram's Bot API (no per-message API charge), but the bot still needs a public host and a token from BotFather. The conversation does not collect or store card numbers.

## Requirements

- Node.js 20.9 or newer
- npm
- PostgreSQL only when enabling persistence

## Install and run locally

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The product works without API keys in mock mode. `npm run build` generates Prisma Client and creates a production build; `npm run lint` runs ESLint.

## Environment variables

See `.env.example` for the complete list. At minimum, the app uses `NEXT_PUBLIC_APP_URL` and defaults to `USE_MOCK_AI=true`.

- `USE_MOCK_AI=true` keeps all chat replies deterministic and local to the server process.
- `USE_MOCK_AI=false` enables the server-side OpenAI-compatible call and requires `OPENAI_API_KEY`.
- `DATABASE_URL` is required for the flower assistant to persist confirmed orders.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` enable real Supabase Auth. The legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted if the project does not have a publishable key.
- Never use a `NEXT_PUBLIC_` prefix for provider secrets, database credentials, Stripe secrets, or Supabase service-role keys.
- Set `NEXT_PUBLIC_APP_URL` to the public deployment URL in Vercel before enabling Telegram or relying on sitemap links.

## Database setup

The schema is in `prisma/schema.prisma`. It models users, businesses, assistants, approved knowledge, conversations, messages, leads, appointments, integrations, subscriptions, team members, notifications and florist orders.

Set `DATABASE_URL` in `.env.local` first. For a new database, validate and create the schema:

```powershell
npx prisma validate
npx prisma db push
npx prisma generate
```

The flower assistant writes confirmed orders to PostgreSQL through `/api/flower-assistant`. The rest of the workspace remains browser-local. The public order endpoint and demo login are not production authentication; do not use them with real customer data before adding authenticated merchant access, rate limiting, privacy/retention controls and a protected order-management screen.

## AI configuration

`src/lib/ai.ts` is the provider boundary. `/api/chat` validates message and business-context sizes before calling `generateAIResponse()`. Mock mode is on unless `USE_MOCK_AI` is explicitly set to `false`. The provider key is read only by the server module.

Before enabling provider calls in production, add authenticated sessions, per-tenant usage accounting, server-derived business context, rate limiting, abuse controls, audit logging and provider timeout/error monitoring. The current route accepts business context from its caller and must not be treated as a production endpoint.

## Authentication setup

Email/password registration and Google OAuth are handled by Supabase Auth when configured. Without the two public Supabase environment variables the app remains in a labelled local demo mode. Passwords are never written to `localStorage`. The business profile and workspace are still browser-local, so authentication does not yet provide multi-device business data or production tenant isolation.

1. Create a Supabase project and add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to `.env.local` and the deployment environment. The old anon key can be used as a fallback.
2. In Supabase **Authentication → URL Configuration**, set the Site URL to the app origin and allow these exact callback URLs: `http://localhost:3000/auth/callback` for local development and `https://YOUR_DEPLOYMENT_HOST/auth/callback` for production. Do not use a wildcard redirect.
3. For Google sign-in, create OAuth credentials in Google Cloud Console, enable the Google provider in Supabase, and add the Supabase callback URL shown by its provider settings to the Google OAuth client's authorized redirect URIs. Add the app callback URLs above to Supabase's redirect allow list.
4. Configure Supabase email confirmation and production SMTP before inviting real users. The confirmation link returns to `/auth/callback?next=/onboarding`.

The server checks Supabase users before serving the dashboard when auth is enabled; Next.js proxy refreshes the auth cookie. This is not sufficient production authorization for the rest of the product: API endpoints, order ownership, database records and tenant isolation still need server-side authorization before real business data is used.

## Payments

Card payments, including Visa, are not connected. No card form is present and FloralAI does not collect or store PAN/CVV data. To enable payments, the business owner must first open a merchant account with a supported payment provider; implementation should use that provider's hosted checkout and verified server-side webhooks. Do not ask customers to message their card details.

## Telegram florist bot and payments

To connect a free Telegram bot after deploying the app:

1. Create a bot with `@BotFather` and set `TELEGRAM_BOT_TOKEN` in the hosting provider's server-side environment.
2. Set a long random `TELEGRAM_WEBHOOK_SECRET` there as well. Never expose either value in client code or commit them.
3. Set `NEXT_PUBLIC_APP_URL` to the public HTTPS deployment URL. Configure the webhook from PowerShell:

```powershell
$body = @{
  url = "$env:NEXT_PUBLIC_APP_URL/api/telegram/webhook"
  secret_token = $env:TELEGRAM_WEBHOOK_SECRET
  allowed_updates = @("message")
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post `
  -Uri "https://api.telegram.org/bot$env:TELEGRAM_BOT_TOKEN/setWebhook" `
  -ContentType "application/json" -Body $body
```

The webhook only accepts private Telegram chats, validates Telegram's secret header, keeps each chat's order progress in PostgreSQL, and uses the same guided flower-order workflow as the website. A free bot API does not provide free hosting or a database. WhatsApp, Instagram, Facebook, Google Business, Stripe, merchant notifications and a florist order-management screen are not connected. The website demo is available at `/flower-shop`; online card payments are not processed.

## GitHub, team roles and presentation

Do not claim that a channel or integration is live until it has been configured and tested.

- GitHub repository: [Iskander2007/FloralAI](https://github.com/Iskander2007/FloralAI).
- Live deployment: [FloralAI on Vercel](https://floral-ai-git-main-iskander11.vercel.app).
- Flower shop demo: [Open the order conversation](https://floral-ai-git-main-iskander11.vercel.app/flower-shop). Catalog and prices are examples; without a configured PostgreSQL database, confirmed orders are not persisted.
- Database: not configured in production. Set `DATABASE_URL` in Vercel and apply the Prisma schema before using order persistence.
- Telegram: not connected. Set the server-side bot token, webhook secret, and `NEXT_PUBLIC_APP_URL`, then register the HTTPS webhook using the command above.
- Payments: card payments are not connected. The demo does not collect money.
- Team roles and individual contributions: record each participant's actual work and meaningful GitHub commits here before presenting; do not invent contributions.

## Deployment checklist

- Configure production database and apply the Prisma schema if order persistence is required.
- Implement server-backed auth, authorization, tenant isolation and protected API routes.
- Add a protected florist order inbox and merchant notifications before taking real orders.
- Derive AI context from the authorized database record, not request JSON.
- Add rate limiting, usage limits and retention/deletion controls.
- Store integration tokens encrypted and use signed, verified provider webhooks.
- Configure and test Stripe only after billing policy and webhook handling are ready.
- Set `NEXT_PUBLIC_APP_URL` to the deployed URL, review privacy/terms and set production metadata.
- Run `npm run lint` and `npm run build` against production environment values.
- Add automated tests for onboarding, authentication, tenant boundaries, chat validation, usage limits and handoff behavior.

## Project layout

```text
src/app/          Next.js routes, pages and API routes
src/components/   Shared client components
src/lib/          Workspace types, flower-order flow, Prisma client and AI abstraction
prisma/           PostgreSQL data model
```
