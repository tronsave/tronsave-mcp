import { ok } from "./response";

type Primitive = string | number | boolean;
type QueryValue = Primitive | undefined | null;

export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, QueryValue>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

interface CreateApiFetchConfig {
  baseUrl: string;
  defaults?: {
    headers?: Record<string, string>;
  };
}

const buildUrl = (baseUrl: string, path: string, query: Record<string, QueryValue> = {}): string => {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
};

export const createApiFetch =
  ({ baseUrl, defaults }: CreateApiFetchConfig) =>
  async <T>(path: string, options: ApiFetchOptions = {}) => {
    const url = buildUrl(baseUrl, path, options.query);
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(defaults?.headers ?? {}),
        ...(options.headers ?? {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const data = (await response.json().catch(() => ({}))) as T;
    return ok(data);
  };
