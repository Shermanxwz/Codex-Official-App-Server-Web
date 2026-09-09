if (typeof window !== 'undefined' && typeof document !== 'undefined') await import('./mcp-app-host.js');

export const FORWARD_COMPATIBLE_THREAD_ITEM_TYPES = Object.freeze(['functionCallOutput']);

export const THREAD_ITEM_TYPES = Object.freeze([
  'userMessage', 'hookPrompt', 'agentMessage', 'plan', 'reasoning', 'commandExecution', 'fileChange',
  'mcpToolCall', 'dynamicToolCall', 'collabAgentToolCall', 'subAgentActivity', 'webSearch', 'imageView',
  'sleep', 'imageGeneration', 'enteredReviewMode', 'exitedReviewMode', 'contextCompaction',
  ...FORWARD_COMPATIBLE_THREAD_ITEM_TYPES,
]);

export const SERVER_REQUEST_SUPPORT = Object.freeze({
  'item/commandExecution/requestApproval': 'native',
  'item/fileChange/requestApproval': 'native',
  'item/tool/requestUserInput': 'native',
  'mcpServer/elicitation/request': 'native',
  'item/permissions/requestApproval': 'native',
  'item/tool/call': 'native-tool-host',
  'account/chatgptAuthTokens/refresh': 'platform-only',
  'attestation/generate': 'platform-only',
  'currentTime/read': 'native-experimental-host',
  'applyPatchApproval': 'native-legacy',
  'execCommandApproval': 'native-legacy',
});

export const PLATFORM_ONLY_SERVER_REQUESTS = Object.freeze(Object.keys(SERVER_REQUEST_SUPPORT).filter((method) => SERVER_REQUEST_SUPPORT[method] === 'platform-only'));
export const NATIVE_SERVER_REQUESTS = Object.freeze(Object.keys(SERVER_REQUEST_SUPPORT).filter((method) => SERVER_REQUEST_SUPPORT[method].startsWith('native')));
export const MANUAL_SERVER_REQUESTS = Object.freeze(Object.keys(SERVER_REQUEST_SUPPORT).filter((method) => SERVER_REQUEST_SUPPORT[method] === 'manual-tool-host'));

const TIMELINE_DELTA_NOTIFICATION_KINDS = Object.freeze({
  'item/agentMessage/delta': 'agent',
  'item/commandExecution/outputDelta': 'command',
  'item/fileChange/outputDelta': 'file',
  'item/fileChange/patchUpdated': 'file-patch',
  'item/plan/delta': 'plan',
  'item/reasoning/summaryTextDelta': 'reasoning',
  'item/reasoning/textDelta': 'reasoning',
  'item/mcpToolCall/progress': 'tool-progress',
  'turn/diff/updated': 'ignore',
  'turn/moderationMetadata': 'ignore',
  'turn/plan/updated': 'ignore',
});

// These methods have dedicated UI/state handlers in app.js. They may pass the
// delta routing checkpoint because the specialized handler intentionally runs
// before or after that checkpoint. Any method not explicitly admitted here or
// in the delta table is fail-closed at the human timeline boundary.
export const SERVER_NOTIFICATION_SPECIALIZED_UI = Object.freeze([
  'turn/started',
  'turn/completed',
  'turn/plan/updated',
  'thread/compacted',
  'thread/queue/changed',
  'item/started',
  'item/completed',
  'item/reasoning/summaryPartAdded',
  'thread/tokenUsage/updated',
  'serverRequest/resolved',
  'thread/name/updated',
  'thread/archived',
  'thread/unarchived',
  'thread/deleted',
  'thread/closed',
  'thread/started',
  'thread/status/changed',
  'error',
  'warning',
  'configWarning',
  'guardianWarning',
  'deprecationNotice',
]);

// Explicitly documented transport/protocol notifications that are observable
// in Official Events but are not standalone conversation work items. The
// default for every future, schema-admitted ServerNotification is the same.
export const SERVER_NOTIFICATION_DIAGNOSTIC_ONLY = Object.freeze([
  'item/commandExecution/terminalInteraction',
  'turn/diff/updated',
  'turn/moderationMetadata',
  'hook/started',
  'hook/completed',
]);

export const SERVER_NOTIFICATION_FALLBACK = 'official-event-log';
export const SERVER_NOTIFICATION_TIMELINE_DEFAULT = 'official-event-log-only';

const specializedUiMethods = new Set(SERVER_NOTIFICATION_SPECIALIZED_UI);

// Only methods whose dedicated handler appears after the delta checkpoint need
// to bypass the sealed default there. Methods handled before the checkpoint do
// not reach this table at all.
const TIMELINE_ROUTER_PASSTHROUGH = new Set([
  'item/reasoning/summaryPartAdded',
  'thread/tokenUsage/updated',
  'serverRequest/resolved',
  'thread/name/updated',
  'thread/archived',
  'thread/unarchived',
  'thread/deleted',
  'thread/closed',
  'thread/started',
  'thread/status/changed',
  'error',
  'warning',
  'configWarning',
  'guardianWarning',
  'deprecationNotice',
]);

const JS_META_PROPERTIES = new Set([
  '__proto__', 'prototype', 'constructor', 'toString', 'toJSON', 'valueOf',
  'inspect', 'then',
]);

export function serverNotificationDisposition(method) {
  const name = String(method || '').trim();
  if (specializedUiMethods.has(name)) return 'specialized-ui';
  const deltaKind = TIMELINE_DELTA_NOTIFICATION_KINDS[name];
  if (deltaKind && deltaKind !== 'ignore') return 'timeline-delta';
  return SERVER_NOTIFICATION_TIMELINE_DEFAULT;
}

export function timelineNotificationKind(method) {
  const name = String(method || '').trim();
  if (Object.hasOwn(TIMELINE_DELTA_NOTIFICATION_KINDS, name)) return TIMELINE_DELTA_NOTIFICATION_KINDS[name];
  if (TIMELINE_ROUTER_PASSTHROUGH.has(name)) return undefined;
  return 'ignore';
}

// app.js historically indexes this object directly. The Proxy preserves that
// API while making the default fail closed: a future notification cannot fall
// through to the raw `.system-event` renderer merely because it carries a
// turnId/itemId. It remains observable because connectEvents records every
// notification in Official Events before appendLive runs.
export const TIMELINE_DELTA_NOTIFICATIONS = new Proxy(TIMELINE_DELTA_NOTIFICATION_KINDS, {
  get(target, property, receiver) {
    if (typeof property !== 'string') return Reflect.get(target, property, receiver);
    if (Object.hasOwn(target, property)) return Reflect.get(target, property, receiver);
    if (JS_META_PROPERTIES.has(property)) return Reflect.get(target, property, receiver);
    return timelineNotificationKind(property);
  },
});

// Every schema-admitted ServerNotification is recorded in the bounded
// Official Events log before any specialized conversation/state handler runs.
// This universal disposition keeps process, realtime, MCP event-stream and
// future schema-known notifications observable without pretending they are
// ordinary conversation items.
export function serverRequestSupport(method) { return SERVER_REQUEST_SUPPORT[String(method || '')] || 'unknown'; }

export function protocolSupportSummary() {
  const values = Object.values(SERVER_REQUEST_SUPPORT);
  return {
    threadItemTypes: THREAD_ITEM_TYPES.length,
    nativeServerRequests: values.filter((value) => value.startsWith('native')).length,
    manualServerRequests: values.filter((value) => value === 'manual-tool-host').length,
    platformOnlyServerRequests: values.filter((value) => value === 'platform-only').length,
    serverRequests: values.length,
    totalServerRequests: values.length,
    mcpAppsHost: true,
    dynamicToolHost: true,
    currentTimeHost: true,
    serverNotificationFallback: SERVER_NOTIFICATION_FALLBACK,
    serverNotificationTimelineDefault: SERVER_NOTIFICATION_TIMELINE_DEFAULT,
    specializedServerNotificationUi: SERVER_NOTIFICATION_SPECIALIZED_UI.length,
    explicitDiagnosticOnlyNotifications: SERVER_NOTIFICATION_DIAGNOSTIC_ONLY.length,
    experimentalProtocolSeal: true,
    openaiForm: true,
  };
}
