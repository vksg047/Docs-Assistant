# Docs AI Assistant

A minimal Next.js App Router application that asks UiPath Docs AI directly from a server-side API route. Secrets stay on the server and are never exposed to the browser.

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` from `.env.example` and fill in the values:

   ```bash
   cp .env.example .env.local
   ```

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Open `http://localhost:3000`.

## Required Environment Variables

```env
UIPATH_CLIENT_ID=
UIPATH_CLIENT_SECRET=
UIPATH_ORIGIN_URL=https://cloud.uipath.com
DOCS_AI_ENDPOINT=
```

`UIPATH_ORIGIN_URL` is used for the client credentials token request at:

```text
${UIPATH_ORIGIN_URL}/identity_/connect/token
```

`DOCS_AI_ENDPOINT` must point to the direct Docs AI API endpoint. Do not use a public endpoint unless this app is configured with server-to-server authentication as shown here.

## How It Works

The browser posts `{ "question": "..." }` to `/api/ask`. The server route retrieves a UiPath access token with `client_credentials`, calls `DOCS_AI_ENDPOINT` with `Authorization: Bearer <access_token>`, and returns the answer plus clickable documentation sources and follow-up prompts to the UI.

## Deploy To Vercel

1. Push this project to a Git repository.
2. Import the repository in Vercel as a Next.js project.
3. Add these environment variables in Vercel Project Settings:
   - `UIPATH_CLIENT_ID`
   - `UIPATH_CLIENT_SECRET`
   - `UIPATH_ORIGIN_URL`
   - `DOCS_AI_ENDPOINT`
4. Deploy.

No workflow, orchestration layer, database, queue, or extra service is required.

## Test With A Sample Query

After starting the app, enter a question such as:

```text
How do I create a queue in UiPath Orchestrator?
```

The answer panel should show the Docs AI response. If authentication fails, the app returns a server-side token error. If Docs AI returns an error, `/api/ask` passes through the Docs AI status code with a helpful message.
