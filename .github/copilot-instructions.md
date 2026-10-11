# BizAI workspace guidance

- Use the existing Next.js App Router, TypeScript, React and CSS design tokens. Keep new UI responsive and keyboard accessible.
- The product UI is English-first. Keep user-facing copy concise and avoid implying that an unconfigured external integration is live.
- Browser-local workspace state is for preview only. It is not authentication, authorization, secure storage or a source of truth for production data.
- Keep provider secrets server-side. Validate API input and derive tenant/business context from an authenticated server session before production use.
- Preserve empty states for absent production data. Never invent analytics, customers, testimonials or integration status.
- Run `npm run lint` and `npm run build` after meaningful changes.
