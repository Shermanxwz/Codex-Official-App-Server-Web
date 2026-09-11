const PLAN_MODE = 'plan';
const DEFAULT_MODE = 'default';

export const PLAN_MODE_VALUES = Object.freeze({
  PLAN: PLAN_MODE,
  DEFAULT: DEFAULT_MODE,
});

export function normalizePlanMode(value) {
  const mode = String(value ?? '').trim().toLowerCase();
  if (mode === PLAN_MODE || mode === DEFAULT_MODE) return mode;
  return null;
}

function asObject(value) {
  return value && typeof value === 'object' ? value : null;
}

/**
 * Read the authoritative collaboration mode from a thread response or the
 * thread/settings/updated notification.  Missing mode information is kept
 * distinct from an explicit default mode so callers cannot silently turn a
 * failed update into a successful UI transition.
 */
export function extractPlanModeState(value, fallbackThreadId = '') {
  const root = asObject(value);
  const payload = asObject(root?.params) || root;
  const thread = asObject(payload?.thread);
  const threadSettings = asObject(payload?.threadSettings);
  const settings = asObject(payload?.settings);
  const threadId = String(
    fallbackThreadId ||
      payload?.threadId ||
      thread?.id ||
      threadSettings?.threadId ||
      '',
  );
  const candidates = [
    payload?.collaborationMode,
    payload?.collaboration_mode,
    threadSettings?.collaborationMode,
    threadSettings?.collaboration_mode,
    settings?.collaborationMode,
    settings?.collaboration_mode,
    thread?.settings?.collaborationMode,
    thread?.settings?.collaboration_mode,
  ];
  const candidate = candidates.find((item) => item !== undefined);
  if (!threadId || candidate === undefined) return null;

  const mode =
    candidate === null
      ? DEFAULT_MODE
      : normalizePlanMode(asObject(candidate)?.mode ?? asObject(candidate)?.kind);
  if (!mode) return null;

  return {
    threadId,
    mode,
    enabled: mode === PLAN_MODE,
  };
}

export function buildCollaborationMode(mode, model = 'gpt-5', reasoningEffort = null) {
  const normalized = normalizePlanMode(mode);
  if (!normalized) throw new TypeError(`Unsupported collaboration mode: ${mode}`);
  return {
    mode: normalized,
    settings: {
      model: String(model || 'gpt-5'),
      reasoning_effort:
        reasoningEffort === undefined || reasoningEffort === '' ? null : reasoningEffort,
      developer_instructions: null,
    },
  };
}
