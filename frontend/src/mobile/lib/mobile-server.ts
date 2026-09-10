import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export type ServerInfo = {
  name: string;
  apiVersion: string;
  capabilities: string[];
};

export type SavedServer = ServerInfo & {
  id: string;
  url: string;
  lastConnectedAt: string;
};

type SavedSession = {
  accessToken: string;
  expiresAt: string;
};

type MobileServerState = {
  activeServerId?: string;
  servers: SavedServer[];
  sessions: Record<string, SavedSession>;
};

const storageKey = 'rime.mobile.servers.v1';
const nativeClientHeader = 'X-Rime-Client';
let state = readState();

export function isTauriClient(): boolean {
  return typeof window !== 'undefined'
    && ('__TAURI_INTERNALS__' in window || (import.meta.env.DEV && new URLSearchParams(window.location.search).has('native-preview')));
}

export function listSavedServers(): SavedServer[] {
  return [...state.servers].sort((left, right) => right.lastConnectedAt.localeCompare(left.lastConnectedAt));
}

export function getActiveServer(): SavedServer | undefined {
  return state.servers.find((server) => server.id === state.activeServerId);
}

export function selectServer(server: SavedServer): void {
  state = {
    ...state,
    activeServerId: server.id,
    servers: [server, ...state.servers.filter((candidate) => candidate.id !== server.id)],
  };
  writeState();
}

export function leaveActiveServer(): void {
  state = { ...state, activeServerId: undefined };
  writeState();
}

export function removeSavedServer(serverId: string): void {
  const sessions = { ...state.sessions };
  delete sessions[serverId];
  state = {
    activeServerId: state.activeServerId === serverId ? undefined : state.activeServerId,
    servers: state.servers.filter((server) => server.id !== serverId),
    sessions,
  };
  writeState();
}

export function saveMobileSession(accessToken: string, expiresAt: string): void {
  const server = getActiveServer();
  if (!server) return;
  state = {
    ...state,
    sessions: { ...state.sessions, [server.id]: { accessToken, expiresAt } },
  };
  writeState();
}

export function clearMobileSession(): void {
  const server = getActiveServer();
  if (!server) return;
  const sessions = { ...state.sessions };
  delete sessions[server.id];
  state = { ...state, sessions };
  writeState();
}

export function normalizeServerUrl(input: string): string {
  const candidate = input.trim();
  if (!candidate) throw new Error('请输入服务器地址');

  let parsed: URL;
  try {
    parsed = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
  } catch {
    throw new Error('服务器地址格式不正确');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('服务器地址必须使用 HTTP 或 HTTPS');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('请输入不含账号、参数和片段的服务器根地址');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.href.replace(/\/$/, '');
}

export async function probeServer(input: string, signal?: AbortSignal): Promise<SavedServer> {
  const url = normalizeServerUrl(input);
  let response: Response;
  try {
    response = await tauriFetch(joinServerPath(url, '/api/v1/system/info'), {
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('无法连接到服务器，请检查地址和网络');
  }
  if (!response.ok) {
    throw new Error(`服务器返回异常状态 (${response.status})`);
  }

  const info = await response.json().catch(() => undefined) as ServerInfo | undefined;
  if (!info || info.name !== 'Rime' || info.apiVersion !== 'v1' || !Array.isArray(info.capabilities)) {
    throw new Error('该地址不是兼容的 Rime 服务器');
  }
  if (!info.capabilities.includes('auth.bearer.v1')) {
    throw new Error('服务器版本过旧，不支持移动客户端登录');
  }
  return {
    ...info,
    id: url,
    url,
    lastConnectedAt: new Date().toISOString(),
  };
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!isTauriClient()) return window.fetch(path, init);
  const server = getActiveServer();
  if (!server) throw new Error('尚未选择服务器');

  const headers = new Headers(init?.headers);
  headers.set(nativeClientHeader, 'tauri');
  const session = state.sessions[server.id];
  if (session && new Date(session.expiresAt).getTime() > Date.now()) {
    headers.set('Authorization', `Bearer ${session.accessToken}`);
  }
  return tauriFetch(joinServerPath(server.url, path), { ...init, headers });
}

export function resolveServerPath(path: string): string {
  if (!isTauriClient()) return path;
  const server = getActiveServer();
  if (!server) throw new Error('尚未选择服务器');
  return joinServerPath(server.url, path);
}

function joinServerPath(serverUrl: string, path: string): string {
  return `${serverUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function readState(): MobileServerState {
  if (typeof window === 'undefined') return { servers: [], sessions: {} };
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '') as Partial<MobileServerState>;
    return {
      activeServerId: typeof parsed.activeServerId === 'string' ? parsed.activeServerId : undefined,
      servers: Array.isArray(parsed.servers) ? parsed.servers.filter(isSavedServer) : [],
      sessions: parsed.sessions && typeof parsed.sessions === 'object'
        ? Object.fromEntries(Object.entries(parsed.sessions).filter((entry): entry is [string, SavedSession] => isSavedSession(entry[1])))
        : {},
    };
  } catch {
    return { servers: [], sessions: {} };
  }
}

function isSavedServer(value: unknown): value is SavedServer {
  if (!value || typeof value !== 'object') return false;
  const server = value as Partial<SavedServer>;
  return typeof server.id === 'string'
    && typeof server.url === 'string'
    && typeof server.name === 'string'
    && typeof server.apiVersion === 'string'
    && Array.isArray(server.capabilities)
    && typeof server.lastConnectedAt === 'string';
}

function isSavedSession(value: unknown): value is SavedSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<SavedSession>;
  return typeof session.accessToken === 'string' && typeof session.expiresAt === 'string';
}

function writeState(): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // The active in-memory connection remains usable when storage is unavailable.
  }
}
