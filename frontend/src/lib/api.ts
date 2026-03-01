const BASE_URL = '/api';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    let message: string;
    try {
      const json = JSON.parse(body);
      message = json.error || json.message || response.statusText;
    } catch {
      message = body || response.statusText;
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export async function get<T = unknown>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`);
  return handleResponse<T>(response);
}

export async function post<T = unknown>(
  path: string,
  body?: unknown,
  options?: { signal?: AbortSignal; raw?: boolean }
): Promise<T | Response> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: options?.signal,
  });

  if (options?.raw) {
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || response.statusText);
    }
    return response as unknown as T;
  }

  return handleResponse<T>(response);
}

export async function put<T = unknown>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(response);
}

export async function del<T = unknown>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
  });
  return handleResponse<T>(response);
}
