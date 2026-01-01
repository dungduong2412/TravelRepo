/**
 * API utility for making requests to the backend
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface FetchOptions extends RequestInit {
  token?: string;
}

/**
 * Make an authenticated API request
 */
export async function apiFetch(endpoint: string, options: FetchOptions = {}) {
  const { token, ...fetchOptions } = options;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...fetchOptions.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
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
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
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

  post: async (endpoint: string, data: any, token?: string) => {
    return apiFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
      token,
    });
  },

  patch: async (endpoint: string, data: any, token?: string) => {
    return apiFetch(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
      token,
    });
  },

  put: async (endpoint: string, data: any, token?: string) => {
    return apiFetch(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
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
