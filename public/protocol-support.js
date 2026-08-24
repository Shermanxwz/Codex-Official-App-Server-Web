export const THREAD_ITEM_TYPES = Object.freeze([
  'userMessage',
  'hookPrompt',
  'agentMessage',
  'plan',
  'reasoning',
  'commandExecution',
  'fileChange',
  'mcpToolCall',
  'dynamicToolCall',
  'collabAgentToolCall',
  'subAgentActivity',
  'webSearch',
  'imageView',
  'sleep',
  'imageGeneration',
  'enteredReviewMode',
  'exitedReviewMode',
  'contextCompaction',
]);

export const SERVER_REQUEST_SUPPORT = Object.freeze({
  'item/commandExecution/requestApproval': 'native',
  'item/fileChange/requestApproval': 'native',
  'item/tool/requestUserInput': 'native',
  'mcpServer/elicitation/request': 'native',
  'item/permissions/requestApproval': 'native',
  'item/tool/call': 'manual-tool-host',
  'account/chatgptAuthTokens/refresh': 'platform-only',
  'attestation/generate': 'platform-only',
  'applyPatchApproval': 'native-legacy',
  'execCommandApproval': 'native-legacy',
});

export const PLATFORM_ONLY_SERVER_REQUESTS = Object.freeze(
  Object.keys(SERVER_REQUEST_SUPPORT).filter((method) => SERVER_REQUEST_SUPPORT[method] === 'platform-only'),
);

export const NATIVE_SERVER_REQUESTS = Object.freeze(
  Object.keys(SERVER_REQUEST_SUPPORT).filter((method) => SERVER_REQUEST_SUPPORT[method].startsWith('native')),
);

export const MANUAL_SERVER_REQUESTS = Object.freeze(
  Object.keys(SERVER_REQUEST_SUPPORT).filter((method) => SERVER_REQUEST_SUPPORT[method] === 'manual-tool-host'),
);

export const TIMELINE_DELTA_NOTIFICATIONS = Object.freeze({
  'item/agentMessage/delta': 'agent',
  'item/commandExecution/outputDelta': 'command',
  'item/fileChange/outputDelta': 'file',
  'item/fileChange/patchUpdated': 'file-patch',
  'item/plan/delta': 'plan',
  'item/reasoning/summaryTextDelta': 'reasoning',
  'item/reasoning/textDelta': 'reasoning',
  'item/mcpToolCall/progress': 'tool-progress',
});

export function serverRequestSupport(method) {
  return SERVER_REQUEST_SUPPORT[String(method || '')] || 'unknown';
}

export function protocolSupportSummary() {
  const values = Object.values(SERVER_REQUEST_SUPPORT);
  return {
    threadItemTypes: THREAD_ITEM_TYPES.length,
    nativeServerRequests: values.filter((value) => value.startsWith('native')).length,
    manualServerRequests: values.filter((value) => value === 'manual-tool-host').length,
    platformOnlyServerRequests: values.filter((value) => value === 'platform-only').length,
    serverRequests: values.length,
    totalServerRequests: values.length,
    mcpAppsHost: false,
    openaiForm: true,
  };
}
