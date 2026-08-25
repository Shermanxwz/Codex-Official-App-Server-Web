import os from 'node:os';
import path from 'node:path';

function bool(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

function integer(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function list(name, fallback = []) {
  const value = process.env[name];
  if (value == null || value.trim() === '') return [...fallback];
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

function choice(name, fallback, allowed) {
  const value = (process.env[name] || '').trim().toLowerCase();
  return allowed.includes(value) ? value : fallback;
}

function allowedList(name, allowed) {
  return list(name).filter((value) => allowed.includes(value));
}

const home = os.homedir();
const stateHome = process.env.XDG_STATE_HOME || path.join(home, '.local', 'state');
const configHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');

export const config = Object.freeze({
  host: process.env.CWEB_HOST || '127.0.0.1',
  port: integer('CWEB_PORT', 4173, 1, 65535),
  codexBin: process.env.CWEB_CODEX_BIN || 'codex',
  workspace: path.resolve(process.env.CWEB_WORKSPACE || process.cwd()),
  stateDir: path.resolve(process.env.CWEB_STATE_DIR || path.join(stateHome, 'codex-app-server-web')),
  configDir: path.resolve(process.env.CWEB_CONFIG_DIR || path.join(configHome, 'codex-app-server-web')),
  requireAuth: bool('CWEB_REQUIRE_AUTH', true),
  experimental: bool('CWEB_EXPERIMENTAL', false),
  publicOrigin: process.env.CWEB_PUBLIC_ORIGIN || '',
  token: process.env.CWEB_TOKEN || '',
  accessProfile: choice('CWEB_ACCESS_PROFILE', 'full', ['read', 'coding', 'admin', 'full']),
  notificationOptOut: list('CWEB_NOTIFICATION_OPT_OUT'),
  mcpAppsEnabled: bool('CWEB_MCP_APPS', true),
  mcpAppPermissions: allowedList('CWEB_MCP_APP_PERMISSIONS', ['camera', 'microphone', 'geolocation', 'clipboardWrite']),
  dynamicToolsFile: process.env.CWEB_DYNAMIC_TOOLS_FILE ? path.resolve(process.env.CWEB_DYNAMIC_TOOLS_FILE) : '',
  rpcTimeoutMs: integer('CWEB_RPC_TIMEOUT_MS', 600_000, 1_000, 3_600_000),
  bodyLimit: integer('CWEB_BODY_LIMIT', 2 * 1024 * 1024, 16 * 1024, 32 * 1024 * 1024),
  maxPendingRpc: integer('CWEB_MAX_PENDING_RPC', 64, 1, 512),
  maxStdinBufferBytes: integer('CWEB_MAX_STDIN_BUFFER', 4 * 1024 * 1024, 64 * 1024, 64 * 1024 * 1024),
  maxJsonlLineBytes: integer('CWEB_MAX_JSONL_LINE', 32 * 1024 * 1024, 1024 * 1024, 128 * 1024 * 1024),
  sseMaxBufferBytes: integer('CWEB_SSE_MAX_BUFFER', 2 * 1024 * 1024, 64 * 1024, 32 * 1024 * 1024),
  eventMaxBytes: integer('CWEB_EVENT_MAX_BYTES', 16 * 1024 * 1024, 1024 * 1024, 64 * 1024 * 1024),
  restartMaxDelayMs: integer('CWEB_RESTART_MAX_DELAY_MS', 30_000, 1_000, 120_000),
});
