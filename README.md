# React Intelligence

React Intelligence is a self-hosted runtime analytics MVP for React apps. It includes:

- `@react-intelligence/sdk` for collecting errors, React Profiler commits, network calls, console warnings, user actions, route changes and custom events.
- `apps/server`, a Fastify + SQLite backend with Zod validation, aggregations and an Ollama analysis endpoint.
- `apps/dashboard`, a dark Radix UI observability dashboard.
- `apps/demo`, a tiny React app wired to the SDK.

<img width="1280" height="720" alt="2026-07-24 13 47 13" src="https://github.com/user-attachments/assets/48e568d9-1cd4-4de9-9fe3-07d11994b00f" />

## Quick Start

```bash
pnpm install
pnpm seed
pnpm dev:server
pnpm dev:dashboard
```

Open the dashboard at `http://localhost:5173`. The server listens on `http://localhost:4000`.

To run the demo SDK app:

```bash
pnpm dev:demo
```

Open `http://localhost:5174`, click around, then return to the dashboard.

For the separate browser integration test app:

```bash
pnpm dev:test-app
```

Open `http://localhost:5175`. Its telemetry is stored under the `test-store` app id.

## SDK Usage

```tsx
import { ReactIntelligenceProvider } from "@react-intelligence/sdk";

createRoot(document.getElementById("root")!).render(
  <ReactIntelligenceProvider
    appId="demo-app"
    endpoint="http://localhost:4000"
    environment="development"
    release="1.0.0"
  >
    <App />
  </ReactIntelligenceProvider>
);
```

Custom events:

```ts
import { track } from "@react-intelligence/sdk";

track("checkout_started", {
  cartSize: 3,
  source: "product_page"
});
```

Privacy defaults: the SDK does not collect request bodies, response bodies, cookies, localStorage or input values. You can disable capture surfaces:

```tsx
<ReactIntelligenceProvider
  appId="demo-app"
  endpoint="http://localhost:4000"
  captureConsole={false}
  captureNetwork={false}
  captureUserActions={false}
  scrubText
>
  <App />
</ReactIntelligenceProvider>
```

## Ollama

Install and run Ollama locally:

```bash
ollama pull llama3.1
ollama serve
```

Then open `AI Analysis` in the dashboard and ask a question such as:

```txt
Which components are causing the most render cost?
```

The server calls `POST http://localhost:11434/api/generate`, sends compact telemetry context, stores the run in SQLite and returns a structured response.

## API

- `POST /api/events/batch`
- `GET /api/apps`
- `GET /api/apps/:appId/overview`
- `GET /api/apps/:appId/events`
- `GET /api/apps/:appId/errors`
- `GET /api/apps/:appId/performance`
- `GET /api/apps/:appId/network`
- `POST /api/apps/:appId/analyze`

SQLite is stored at `data/react-intelligence.sqlite` by default. Override with `REACT_INTELLIGENCE_DB=/path/to/file.sqlite`.

## Scripts

```bash
pnpm dev
pnpm dev:server
pnpm dev:dashboard
pnpm dev:demo
pnpm build
pnpm seed
pnpm typecheck
```
