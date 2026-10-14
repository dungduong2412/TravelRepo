/**
 * API utility for making requests to the backend
 */

import { getAuthToken } from './supabase';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100';

interface FetchOptions extends RequestInit {
  token?: string;
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

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `API request failed: ${response.statusText}`);
  }

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

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `API request failed: ${response.statusText}`);
  }

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
