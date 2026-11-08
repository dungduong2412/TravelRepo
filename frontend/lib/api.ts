/**
 * API utility for making requests to the backend
 */

import { getAuthToken } from './supabase';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100';

interface FetchOptions extends RequestInit {
  token?: string;
}

/**
 * A non-2xx API answer. `message` is exactly what callers always received (the server's message), so existing `err.message` code is unchanged.
 * The HTTP status and the server's error code travel with it so the UI can show them (see lib/api-failure.ts). The field names are
 * deliberately NOT `status` / `code`: errorCode() in auth-diagnostics reads those for Supabase Auth errors and must keep ignoring API errors.
 */
export type ApiFieldError = { field: string; code: string; message: string };

export class ApiRequestError extends Error {
  constructor(message: string, readonly httpStatus: number, readonly apiCode?: string, readonly method?: string, readonly path?: string, readonly fieldErrors: ApiFieldError[] = []) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function failureOf(response: Response, method: string, endpoint: string) {
  const errorData = await response.json().catch(() => ({}));
  const raw = errorData?.message;
  const message = (Array.isArray(raw) ? raw.join('; ') : raw) || `API request failed: ${response.statusText}`;
  const fieldErrors: ApiFieldError[] = Array.isArray(errorData?.errors)
    ? errorData.errors.filter((e: any) => e && typeof e.field === 'string' && typeof e.message === 'string').map((e: any) => ({ field: e.field, code: String(e.code ?? ''), message: e.message }))
    : [];
  return new ApiRequestError(String(message), response.status, typeof errorData?.code === 'string' ? errorData.code : undefined, method, endpoint, fieldErrors);
}

/**
 * Make an authenticated API request
 */
export async function apiFetch(endpoint: string, options: FetchOptions = {}) {
  const { token, ...fetchOptions } = options;
  let authToken = token;

  if (!authToken && typeof window !== 'undefined') {
    authToken = (await getAuthToken()) || undefined;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string> | undefined),
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...fetchOptions,
    headers,
  });

  if (!response.ok) throw await failureOf(response, String(fetchOptions.method || 'GET'), endpoint);

  return response.json();
}

/**
 * Make a public (non-authenticated) API request
 */
export async function publicApiFetch(endpoint: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) throw await failureOf(response, String(options.method || 'GET'), endpoint);

  return response.json();
}

/**
 * API client with common methods
 */
export const api = {
  get: async (endpoint: string, token?: string) => {
    return apiFetch(endpoint, { method: 'GET', token });
  },

  post: async (endpoint: string, data?: any, token?: string) => {
    return apiFetch(endpoint, {
      method: 'POST',
      body: data !== undefined ? JSON.stringify(data) : undefined,
      token,
    });
  },

  patch: async (endpoint: string, data?: any, token?: string) => {
    return apiFetch(endpoint, {
      method: 'PATCH',
      body: data !== undefined ? JSON.stringify(data) : undefined,
      token,
    });
  },

  put: async (endpoint: string, data?: any, token?: string) => {
    return apiFetch(endpoint, {
      method: 'PUT',
      body: data !== undefined ? JSON.stringify(data) : undefined,
      token,
    });
  },

  delete: async (endpoint: string, token?: string) => {
    return apiFetch(endpoint, {
      method: 'DELETE',
      token,
    });
  },
};

/**
 * Public API client (no authentication)
 */
export const publicApi = {
  get: async (endpoint: string) => {
    return publicApiFetch(endpoint, { method: 'GET' });
  },

  post: async (endpoint: string, data: any) => {
    return publicApiFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};
