import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type ErrorBody = {
  error: string;
};

type Source = {
  title: string;
  url: string;
};

const REQUIRED_ENV_KEYS = [
  "UIPATH_CLIENT_ID",
  "UIPATH_CLIENT_SECRET",
  "UIPATH_ORIGIN_URL",
  "DOCS_AI_ENDPOINT"
] as const;

const MAX_QUESTION_LENGTH = 4000;
const SENSITIVE_KEY_PATTERNS = [
  /authorization/i,
  /client[_-]?secret/i,
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i
];

export async function POST(request: NextRequest) {
  const missingEnvKeys = REQUIRED_ENV_KEYS.filter((key) => !process.env[key]);

  if (missingEnvKeys.length > 0) {
    console.error("Missing required server environment variables", {
      missingEnvKeys
    });

    return jsonError(
      "Server configuration is incomplete. Required Docs AI settings are missing.",
      500
    );
  }

  let question: string;

  try {
    question = await getQuestion(request);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Invalid request body.",
      400
    );
  }

  let accessToken: string;

  try {
    accessToken = await getUiPathAccessToken({
      clientId: process.env.UIPATH_CLIENT_ID!,
      clientSecret: process.env.UIPATH_CLIENT_SECRET!,
      originUrl: process.env.UIPATH_ORIGIN_URL!
    });
  } catch (error) {
    console.error("UiPath token retrieval failed", {
      message: error instanceof Error ? error.message : "Unknown token error"
    });

    return jsonError("Failed to retrieve a UiPath access token.", 502);
  }

  try {
    const docsAiResponse = await askDocsAi({
      endpoint: process.env.DOCS_AI_ENDPOINT!,
      accessToken,
      question
    });

    return NextResponse.json({
      answer: extractAnswer(docsAiResponse),
      sources: extractSources(docsAiResponse),
      followups: extractFollowups(docsAiResponse)
    });
  } catch (error) {
    if (error instanceof DocsAiError) {
      console.error("Docs AI request failed", {
        status: error.status,
        message: error.message,
        responseBody: error.safeResponseBody
      });

      return jsonError(error.message, error.status);
    }

    console.error("Unexpected Docs AI request error", {
      message: error instanceof Error ? error.message : "Unknown Docs AI error"
    });

    return jsonError("Docs AI request failed unexpectedly.", 502);
  }
}

function jsonError(message: string, status: number) {
  return NextResponse.json<ErrorBody>({ error: message }, { status });
}

async function getQuestion(request: NextRequest): Promise<string> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new Error("Request body must be valid JSON.");
  }

  if (!isRecord(body) || typeof body.question !== "string") {
    throw new Error("Request body must include a question string.");
  }

  const question = body.question.trim();

  if (!question) {
    throw new Error("Question is required.");
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    throw new Error(
      `Question must be ${MAX_QUESTION_LENGTH} characters or fewer.`
    );
  }

  return question;
}

async function getUiPathAccessToken({
  clientId,
  clientSecret,
  originUrl
}: {
  clientId: string;
  clientSecret: string;
  originUrl: string;
}): Promise<string> {
  const tokenUrl = `${trimTrailingSlashes(originUrl)}/identity_/connect/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials"
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body,
    cache: "no-store"
  });

  const responseBody = await readResponseBody(response);

  if (!response.ok) {
    console.error("UiPath token endpoint returned an error", {
      status: response.status,
      responseBody: safeStringify(responseBody)
    });

    throw new Error(`Token endpoint returned HTTP ${response.status}.`);
  }

  if (!isRecord(responseBody) || typeof responseBody.access_token !== "string") {
    console.error("UiPath token endpoint response was missing access_token", {
      status: response.status,
      responseBody: safeStringify(responseBody)
    });

    throw new Error("Token endpoint response did not include access_token.");
  }

  return responseBody.access_token;
}

async function askDocsAi({
  endpoint,
  accessToken,
  question
}: {
  endpoint: string;
  accessToken: string;
  question: string;
}): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      question,
      locale: "en",
      source_with_title: true
    }),
    cache: "no-store"
  });

  const responseBody = await readResponseBody(response);

  if (!response.ok) {
    throw new DocsAiError({
      status: response.status,
      message: getDocsAiErrorMessage(response.status, responseBody),
      safeResponseBody: safeStringify(responseBody)
    });
  }

  return responseBody;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function extractAnswer(responseBody: unknown): string {
  if (typeof responseBody === "string") {
    return responseBody;
  }

  if (!isRecord(responseBody)) {
    return safeStringify(responseBody);
  }

  const candidates = [
    responseBody.answer,
    responseBody.response,
    responseBody.text,
    responseBody.result,
    responseBody.message,
    responseBody.content
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  if (isRecord(responseBody.data)) {
    const nestedCandidates = [
      responseBody.data.answer,
      responseBody.data.response,
      responseBody.data.text,
      responseBody.data.result
    ];

    for (const candidate of nestedCandidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate;
      }
    }
  }

  return safeStringify(responseBody);
}

function extractSources(responseBody: unknown): Source[] {
  const sourceArrays = getCandidateSourceArrays(responseBody);
  const sources: Source[] = [];
  const seenUrls = new Set<string>();

  for (const sourceArray of sourceArrays) {
    for (const source of sourceArray) {
      const normalizedSource = normalizeSource(source);

      if (!normalizedSource || seenUrls.has(normalizedSource.url)) {
        continue;
      }

      seenUrls.add(normalizedSource.url);
      sources.push(normalizedSource);

      if (sources.length >= 8) {
        return sources;
      }
    }
  }

  return sources;
}

function extractFollowups(responseBody: unknown): string[] {
  const candidateArrays = getCandidateFollowupArrays(responseBody);
  const followups: string[] = [];
  const seenFollowups = new Set<string>();

  for (const candidateArray of candidateArrays) {
    for (const candidate of candidateArray) {
      const followup =
        typeof candidate === "string"
          ? candidate.trim()
          : isRecord(candidate)
            ? getStringValue(candidate, "question") ||
              getStringValue(candidate, "text") ||
              getStringValue(candidate, "title")
            : "";

      if (!followup || seenFollowups.has(followup)) {
        continue;
      }

      seenFollowups.add(followup);
      followups.push(truncate(followup, 220));

      if (followups.length >= 5) {
        return followups;
      }
    }
  }

  return followups;
}

function getCandidateFollowupArrays(responseBody: unknown): unknown[][] {
  const candidates: unknown[] = [];

  if (isRecord(responseBody)) {
    candidates.push(
      responseBody.followups,
      responseBody.follow_ups,
      responseBody.followUpQuestions,
      responseBody.suggested_questions
    );

    if (isRecord(responseBody.data)) {
      candidates.push(
        responseBody.data.followups,
        responseBody.data.follow_ups,
        responseBody.data.followUpQuestions,
        responseBody.data.suggested_questions
      );
    }
  }

  return candidates.filter(Array.isArray);
}

function getCandidateSourceArrays(responseBody: unknown): unknown[][] {
  const candidates: unknown[] = [];

  if (isRecord(responseBody)) {
    candidates.push(
      responseBody.sources,
      responseBody.citations,
      responseBody.references,
      responseBody.source_documents
    );

    if (isRecord(responseBody.data)) {
      candidates.push(
        responseBody.data.sources,
        responseBody.data.citations,
        responseBody.data.references,
        responseBody.data.source_documents
      );
    }
  }

  return candidates.filter(Array.isArray);
}

function normalizeSource(source: unknown): Source | null {
  if (typeof source === "string") {
    const url = normalizeUrl(source);
    return url ? { title: getSourceTitleFromUrl(url), url } : null;
  }

  if (!isRecord(source)) {
    return null;
  }

  const url = normalizeUrl(
    getStringValue(source, "url") ||
      getStringValue(source, "href") ||
      getStringValue(source, "link") ||
      getStringValue(source, "uri")
  );

  if (!url) {
    return null;
  }

  const title =
    getStringValue(source, "title") ||
    getStringValue(source, "name") ||
    getStringValue(source, "label") ||
    getSourceTitleFromUrl(url);

  return {
    title: truncate(title, 120),
    url
  };
}

function normalizeUrl(value: string): string {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function getSourceTitleFromUrl(value: string): string {
  try {
    const url = new URL(value);
    const lastPathSegment = url.pathname.split("/").filter(Boolean).at(-1);

    if (!lastPathSegment) {
      return url.hostname;
    }

    return lastPathSegment
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  } catch {
    return "Source";
  }
}

function getDocsAiErrorMessage(status: number, responseBody: unknown): string {
  const fallback = `Docs AI returned HTTP ${status}.`;

  if (typeof responseBody === "string" && responseBody.trim()) {
    return `${fallback} ${truncate(responseBody.trim(), 500)}`;
  }

  if (isRecord(responseBody)) {
    const message =
      getStringValue(responseBody, "message") ||
      getStringValue(responseBody, "error_description") ||
      getStringValue(responseBody, "error") ||
      getStringValue(responseBody, "detail") ||
      getStringValue(responseBody, "title");

    if (message) {
      return `${fallback} ${truncate(message, 500)}`;
    }
  }

  return fallback;
}

function getStringValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function safeStringify(value: unknown): string {
  return truncate(
    typeof value === "string"
      ? value
      : JSON.stringify(redactSensitiveFields(value), null, 2),
    2000
  );
}

function truncate(value: string | undefined, maxLength: number): string {
  if (!value) {
    return "";
  }

  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))
        ? "[REDACTED]"
        : redactSensitiveFields(nestedValue)
    ])
  );
}

class DocsAiError extends Error {
  status: number;
  safeResponseBody: string;

  constructor({
    status,
    message,
    safeResponseBody
  }: {
    status: number;
    message: string;
    safeResponseBody: string;
  }) {
    super(message);
    this.name = "DocsAiError";
    this.status = status;
    this.safeResponseBody = safeResponseBody;
  }
}
