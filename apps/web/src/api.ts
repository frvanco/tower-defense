export interface PublicUser {
  id: string;
  pseudo: string;
  joinNumber: number;
  isGuest: boolean;
}

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError((body?.message as string) ?? `request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function fetchMe(): Promise<PublicUser> {
  return request('/auth/me');
}

export function guest(pseudo: string): Promise<PublicUser> {
  return request('/auth/guest', { method: 'POST', body: JSON.stringify({ pseudo }) });
}

export function login(email: string, password: string): Promise<PublicUser> {
  return request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function claim(email: string, password: string): Promise<PublicUser> {
  return request('/auth/claim', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function logout(): Promise<void> {
  return request('/auth/logout', { method: 'POST' });
}
