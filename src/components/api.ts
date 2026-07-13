export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  if (token) {
    return { ...extra, Authorization: `Bearer ${token}` };
  }
  return extra;
}

export function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = authHeaders(options.headers as Record<string, string> || {});
  return fetch(url, { ...options, headers });
}
