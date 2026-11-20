# ADR 0001 — Next.js static export with client-side data access

**Status:** accepted (Phase 1)

## Context
The same UI must run in a browser, an Android app (Capacitor) and a Windows app (Tauri), and it
must keep working offline. Capacitor and Tauri serve a folder of static assets. They cannot
run a Next.js server.

## Decision
Build `apps/web` with `output: 'export'`. Do not use server components that fetch data, route
handlers, middleware or server actions. Data access goes through `@erp/data` in the client,
and authorization is enforced by Postgres RLS. Dynamic routes use query strings.

## Consequences
+ One artifact for three platforms. Offline data access can be added behind the same repository interfaces.
− No SSR/SEO, which an authenticated back-office app does not need. Secrets can never live in the app.
  Server-side work that needs secrets (ZATCA credentials) goes to Supabase Edge Functions.
