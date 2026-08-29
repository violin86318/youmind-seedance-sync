import { DEFAULT_LOCALE, DEFAULT_MODEL } from "./config.mjs";
import { enableEnvProxy } from "./http-proxy.mjs";

await enableEnvProxy();

const API_URL = "https://youmind.com/youmarketing-api/video-prompts";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readNumberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function buildHeaders(locale) {
  return {
    "content-type": "application/json",
    origin: "https://youmind.com",
    referer: `https://youmind.com/${locale}/seedance-2-0-prompts`,
    "user-agent": USER_AGENT
  };
}

export async function fetchPromptsPage({
  page = 1,
  limit = 50,
  locale = DEFAULT_LOCALE,
  model = DEFAULT_MODEL,
  query = "",
  maxRetries = readNumberEnv("YOUMIND_MAX_RETRIES", 10),
  requestTimeoutMs = readNumberEnv("YOUMIND_REQUEST_TIMEOUT_MS", 30000)
} = {}) {
  const body = {
    model,
    page,
    limit,
    locale
  };

  if (query) {
    body.q = query;
  }

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: buildHeaders(locale),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(requestTimeoutMs)
      });

      if (response.ok) {
        return response.json();
      }

      const shouldRetry = response.status === 429 || response.status >= 500;

      if (!shouldRetry || attempt === maxRetries) {
        throw new Error(`YouMind API failed: ${response.status} ${response.statusText}`);
      }

      const waitMs = response.status === 429 ? 5000 * (attempt + 1) : 2000 * (attempt + 1);
      console.warn(
        `Request page=${page} failed with ${response.status}. Retrying in ${Math.round(waitMs / 1000)}s (${attempt + 1}/${maxRetries}) ...`
      );
      await sleep(waitMs);
    } catch (error) {
      const isTimeout = error?.name === "TimeoutError";
      const isAbort = error?.name === "AbortError";
      const isNetworkError = error instanceof TypeError;

      if (!(isTimeout || isAbort || isNetworkError) || attempt === maxRetries) {
        throw error;
      }

      const waitMs = 2000 * (attempt + 1);
      console.warn(
        `Request page=${page} failed with ${error?.name || "unknown error"}. Retrying in ${Math.round(waitMs / 1000)}s (${attempt + 1}/${maxRetries}) ...`
      );
      await sleep(waitMs);
    }
  }
}

export async function fetchAllPrompts({
  locale = DEFAULT_LOCALE,
  model = DEFAULT_MODEL,
  query = "",
  limit = 50,
  pageDelayMs = readNumberEnv("YOUMIND_PAGE_DELAY_MS", 1200),
  onProgress
} = {}) {
  let page = 1;
  let total = 0;
  let totalPages = 0;
  const prompts = [];

  while (true) {
    const payload = await fetchPromptsPage({ page, limit, locale, model, query });

    total = payload.total;
    totalPages = payload.totalPages || Math.ceil(total / limit);
    prompts.push(...payload.prompts);

    if (typeof onProgress === "function") {
      onProgress({
        page,
        totalPages,
        total,
        fetched: prompts.length
      });
    }

    if (!payload.hasMore) {
      break;
    }

    await sleep(pageDelayMs);
    page += 1;
  }

  const deduped = [...new Map(prompts.map((prompt) => [String(prompt.id), prompt])).values()];

  return {
    prompts: deduped,
    total,
    totalPages
  };
}
