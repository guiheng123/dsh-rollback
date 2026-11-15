import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { WorkspaceIO, HistoryService, HistoryError, MAX_RESTORE_FILES, MAX_DELETE_RECORDS } from './core.js';
import { BackupStore, storageValueSchema } from './storage.js';

export const name = 'file-history-and-rollback';
export const inject = ['fs', 'storageDomain', 'sessionProjections', 'sessions', 'agents', 'commands', 'tools', 'sandboxPolicy', 'workingDirectory', 'connection'];
const defaults = { maxFileBytes: 2097152, maxSnapshotBytes: 33554432, maxFiles: 2000, defaultRetentionDays: 0, cleanupIntervalMinutes: 60, excludeDirectories: ['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.next', '.cache', '.pnpm-store', '.dsh', 'dist', 'build', 'coverage'] };
const limitsSchema = z.object({ maxFileBytes: z.number().int().min(1024).max(16777216).default(defaults.maxFileBytes), maxSnapshotBytes: z.number().int().min(1024).max(134217728).default(defaults.maxSnapshotBytes), maxFiles: z.number().int().min(1).max(20000).default(defaults.maxFiles), defaultRetentionDays: z.number().int().min(0).max(3650).default(0), cleanupIntervalMinutes: z.number().int().min(1).max(1440).default(60), excludeDirectories: z.array(z.string().min(1)).default(defaults.excludeDirectories), maxStorageBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0), maxRecords: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0) });
const stateSchema = z.object({ turn: z.number(), startSeq: z.number(), messageSeq: z.number(), inTurn: z.boolean(), ended: z.number(), endedStartSeq: z.number(), endedMessageSeq: z.number(), endSeq: z.number() });
const toolParameters = { type: 'object', properties: {
  action: { type: 'string', enum: ['list', 'turns', 'detail', 'prepare', 'status'], description: 'Inspect retained file backups, compare contents, or preview a restore. Confirming restores, deleting backups and changing retention are user-only UI actions.' },
  recordId: { type: 'string', description: 'Record id from list; required for detail and prepare.' }, fileId: { type: 'string', description: 'File id from list; required for detail.' }, fileIds: { type: 'array', items: { type: 'string' }, description: `Distinct file ids for prepare; every file of the backup may be selected (up to ${MAX_RESTORE_FILES}).` }, all: { type: 'boolean', description: 'Preview every file of the record; use instead of listing all fileIds.' }, side: { type: 'string', enum: ['before', 'after'], description: 'Version to preview for restore; defaults to before.' },
  scope: { type: 'string', enum: ['session', 'workspace'], description: 'List scope; defaults to current session.' }, query: { type: 'string', description: 'Case-insensitive filename substring.' }, offset: { type: 'integer', description: 'Zero-based list page offset; default 0.' }, limit: { type: 'integer', description: 'List page size, 1–100; default 100.' }, turnStartSeq: { type: 'integer', description: 'Optional exact turn start sequence for list.' }
}, required: ['action'], additionalProperties: false };
const errorValue = error => ({ ok: false, code: error.code ?? 'HISTORY_ERROR', message: String(error.message ?? error).slice(0, 500) });
// This route must stay `buffered`. The carrier builds `new Request(url, {body})`
// from the raw socket for every method a `streaming` route accepts, and WHATWG
// Request rejects a body on GET/HEAD — which is how every history read arrives.
// A streaming declaration therefore failed before dispatch and the web server
// answered a bodiless 400, so reads could never be served.
// Count raw bytes incrementally and cancel the stream on overflow; Content-Length
// is only a cheap early rejection, never the authority for this ceiling.
// The ceiling must admit an explicit selection of MAX_RESTORE_FILES ids (a UUID is
// 36 characters, so 20000 ids need ~780 KiB), while still bounding a hostile body.
// Whole-record restores should use the `all` selector instead of listing every id.
const MAX_BODY_BYTES = 1048576;
export { MAX_BODY_BYTES };
async function readBoundedText(request) {
  if (!request.body) return '';
  const reader = request.body.getReader(), chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) { await reader.cancel('request too large'); throw new HistoryError('REQUEST_TOO_LARGE', 'Request exceeds limit.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
const idSchema = z.string().min(1).max(256);
const operationSchema = z.object({
  action: z.enum(['list', 'turns', 'detail', 'prepare', 'status', 'restore', 'delete', 'settings', 'optimize', 'clean']),
  sessionId: idSchema.optional(), recordId: idSchema.optional(), fileId: idSchema.optional(), token: idSchema.optional(),
  fileIds: z.array(idSchema).min(1).max(MAX_RESTORE_FILES).optional(), recordIds: z.array(idSchema).min(1).max(MAX_DELETE_RECORDS).optional(),
  // `all` restores every file of the record without listing ids, so a whole-record
  // selection never depends on the request-body ceiling.
  all: z.boolean().optional(),
  side: z.enum(['before', 'after']).optional(), scope: z.enum(['session', 'workspace']).optional(), query: z.string().max(4096).optional(),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(), limit: z.number().int().min(1).max(100).optional(),
  turn: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(), turnStartSeq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(), endSeq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  confirm: z.boolean().optional(), retentionDays: z.number().int().min(0).max(3650).optional(),
  maxStorageBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(), maxRecords: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional()
}).strict();

export async function apply(ctx, raw = {}) {
  const limits = limitsSchema.parse(raw ?? {}), io = new WorkspaceIO(ctx.fs, limits);
  // Keep the original table/layout, admit v1 inline rows, and stamp v2 so an old
  // plugin cannot decode compact records while dropping contentRef. On the JSON
  // per-record backend a downgraded reader skips v2 documents (it cannot read them).
  const domain = await ctx.storageDomain.open({ name: 'dshrollback', version: 2, compatibleVersions: [1], layout: 'per-record', tables: { records: { valueSchema: storageValueSchema } }, global: { schema: z.object({ retentionDays: z.number().int().min(0).max(3650), maxStorageBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(), maxRecords: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional() }), initial: { retentionDays: limits.defaultRetentionDays, maxStorageBytes: limits.maxStorageBytes, maxRecords: limits.maxRecords } } });
  ctx.effect(() => () => domain.close());
  const active = new Map(), diagnostics = new Map();
  const installedWatermarks = new Map(ctx.sessions.list?.().map(session => [session.id, session.seq]) ?? []);
  let disposed = false;
  const projection = await ctx.sessionProjections.register({
    key: 'localRollbackTurns', stateVersion: 1, stateSchema,
    init: () => ({ turn: -1, startSeq: -1, messageSeq: -1, inTurn: false, ended: -1, endedStartSeq: -1, endedMessageSeq: -1, endSeq: -1 }),
    apply(state, event) {
      if (event.type === 'turn/start') return { ...state, turn: event.data.turn, startSeq: event.seq, messageSeq: event.seq, inTurn: true };
      if (event.type === 'assistant/message' && state.inTurn) return { ...state, messageSeq: event.seq };
      if (event.type === 'turn/end') return { ...state, inTurn: false, ended: event.data.turn, endedStartSeq: state.startSeq, endedMessageSeq: state.messageSeq, endSeq: event.seq };
      return state;
    }
  });
  ctx.effect(() => () => projection.dispose());
  const agentStatuses = new Map(), workspaceLocks = new Map();
  // Observe driver scheduling as well as open turns. In particular, running is
  // emitted BEFORE turn/start and idle only after all driver work drains.
  ctx.on('agent/status', ({ agent, status }) => agentStatuses.set(agent.id, status));
  ctx.on('agent/disposed', ({ agent }) => agentStatuses.delete(agent.id));
  const isBusy = async (cwd, allowActiveSessionId) => {
    const root = await io.root(cwd);
    const controller = ctx.get?.('sessionController');
    for (const agent of ctx.agents.list()) {
      if (agent.id === allowActiveSessionId) continue;
      const session = ctx.sessions.get(agent.id);
      if (!session) return true; // registry transition: fail closed until attached
      const directory = ctx.workingDirectory.get(session);
      let sameWorkspace;
      try { const other = await io.root(directory); sameWorkspace = ctx.fs.contains(root, other) || ctx.fs.contains(other, root); }
      catch { return true; }
      if (!sameWorkspace) continue;
      if (projection.stateOf(session).inTurn || agentStatuses.get(agent.id) === 'running' || pendingOf(agent.id).length) return true;
      // A plugin enabled mid-idle/mid-wake has not observed a status event yet.
      // Use the exact passive API, never undocumented Agent properties.
      if (!agentStatuses.has(agent.id)) {
        if (!controller) return true;
        try { if ((await controller.state({ sessionId: agent.id }, new AbortController().signal)).running) return true; }
        catch { return true; }
      }
    }
    return false;
  };
  // Reserve the canonical workspace BEFORE asynchronous validation starts. The
  // pre-step barrier below waits for this promise before allowing tool work.
  const withWorkspaceLock = async (cwd, operation, signal) => {
    const key = (await io.root(cwd, signal)).targetKey;
    if (workspaceLocks.has(key)) throw new HistoryError('WORKSPACE_BUSY', 'Another restore is already in progress.');
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    workspaceLocks.set(key, pending);
    try { return await operation(); }
    finally { workspaceLocks.delete(key); release(); }
  };
  const records = new BackupStore(domain.table('records'), () => history.settings());
  const history = new HistoryService({ io, records, global: domain.global, limits, isBusy });
  // Pending side effects are tracked per Session: a new turn only has to wait for the
  // work of its OWN Session, never for an unrelated Session's capture or save.
  const pendingBySession = new Map();
  let pendingCount = 0;
  const pendingOf = sessionId => [...(pendingBySession.get(sessionId) ?? [])];
  const allPending = () => [...pendingBySession.values()].flatMap(group => [...group]);
  const track = (sessionId, promise) => {
    let group = pendingBySession.get(sessionId);
    if (!group) pendingBySession.set(sessionId, group = new Set());
    group.add(promise); pendingCount += 1;
    const done = () => { group.delete(promise); pendingCount -= 1; if (!group.size) pendingBySession.delete(sessionId); };
    promise.then(done, done).catch(() => {});
    return promise;
  };
  const report = (sessionId, error) => diagnostics.set(sessionId, { code: error.code ?? 'CAPTURE_FAILED', message: String(error.message).slice(0, 500), time: Date.now() });
  const finish = async (session, state, signal) => {
    const capture = active.get(session.id);
    if (!capture || capture.startSeq !== state.endedStartSeq) return;
    active.delete(session.id);
    try {
      const before = await capture.promise;
      // A failed seal is not an invitation to scan later: its time boundary has
      // already passed and other Sessions may now be editing the workspace.
      if (capture.afterError) throw capture.afterError;
      const after = capture.after ?? await io.scan(capture.cwd, signal);
      await history.serial(() => history.saveChange({ id: capture.id, sessionId: session.id, turn: state.ended, turnStartSeq: capture.startSeq, messageSeq: state.endedMessageSeq, endSeq: state.endSeq, cwd: capture.cwd, before, after, late: capture.late }));
    } catch (error) { report(session.id, error); }
  };
  // The awaited pre-step captures before tools can mutate files, preserving the waterfall result.
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next();
    if (decision.kind !== 'enter' || disposed) return decision;
    const session = ctx.sessions.get(agent.id);
    if (!session) return decision;
    await Promise.all(pendingOf(session.id));
    await history.queue;
    if (workspaceLocks.size) {
      const locked = workspaceLocks.get((await io.root(ctx.workingDirectory.get(session), signal)).targetKey);
      if (locked) await locked;
    }
    const state = projection.stateOf(session), existing = active.get(session.id);
    if (!existing || existing.startSeq !== state.startSeq) {
      const cwd = ctx.workingDirectory.get(session);
      const capture = { id: randomUUID(), startSeq: state.startSeq, cwd, late: state.startSeq < (installedWatermarks.get(session.id) ?? session.firstLifecycleSeq), promise: io.scan(cwd, signal) };
      active.set(session.id, capture);
      try { await capture.promise; diagnostics.delete(session.id); }
      catch (error) { active.delete(session.id); report(session.id, error); }
    } else {
      delete existing.after; delete existing.afterError;
    }
    return decision;
  });
  // Seal the after-image before the next turn can run; the committed end event supplies its exact anchor.
  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    const capture = active.get(agent.id);
    if (!capture || disposed) return;
    try { capture.after = await io.scan(capture.cwd, signal); delete capture.afterError; }
    catch (error) { delete capture.after; capture.afterError = error; report(agent.id, error); }
  });
  // Only side effects consume the commit feed; turn state is incrementally folded by the projection.
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/end' && !disposed) track(session.id, finish(session, projection.stateOf(session)));
  });
  ctx.on('session/flush', async session => { await Promise.all(session ? pendingOf(session.id) : []); });
  // Reads stay available for a Session whose Agent is not live in this process: the
  // history panel is most useful after a restart, when nothing is attached yet.
  const READ_ACTIONS = new Set(['list', 'turns', 'detail', 'status', 'settings']);
  const TOOL_READ_ACTIONS = new Set(['list', 'turns', 'detail', 'prepare', 'status']);
  // Reads must survive a restart, when the Session is attached but no Agent is live.
  // The durable header (or the newest retained record) supplies the workspace then.
  const durableCwd = async sessionId => {
    for (const service of ['sessionPersistence', 'sessionQuery']) {
      try {
        const target = ctx.get?.(service);
        if (!target) continue;
        const observed = service === 'sessionPersistence' ? await target.stat(sessionId) : await target.observeSession(sessionId);
        try { if (typeof observed?.header?.cwd === 'string') return observed.header.cwd; }
        finally { if (service === 'sessionQuery') observed?.[Symbol.dispose]?.(); }
      } catch {}
    }
    return history.workspaceOf(sessionId);
  };
  // An attached Session supplies its workspace even when no Agent is live. Mutations are
  // different: they need the Agent for its resolved sandbox policy and for the busy check.
  const scopeFor = async (agent, session, action) => {
    const sessionId = session?.id ?? agent?.id ?? (agent ? ctx.sessions.get(agent.id)?.id : undefined);
    if (!sessionId) throw new HistoryError('SESSION_MISSING', 'Session is not active. Open it before operating on backups.');
    const liveAgent = ctx.agents.get(sessionId);
    const live = session ?? (liveAgent ? ctx.sessions.get(liveAgent.id) : undefined);
    if (!liveAgent && !READ_ACTIONS.has(action)) throw new HistoryError('SESSION_MISSING', 'Open the session and wait for its Agent before restoring backups.');
    const cwd = live ? ctx.workingDirectory.get(live) : await durableCwd(sessionId);
    if (!cwd) throw new HistoryError('SESSION_MISSING', 'This session has no retained backups and is not open.');
    return { ...(live ? { session: live } : {}), sessionId, cwd };
  };
  const dispatch = async (args, agent, signal, caller = 'command', session) => {
    const parsed = operationSchema.safeParse(args);
    if (!parsed.success) throw new HistoryError('INVALID_INPUT', 'Invalid file history operation or field value.');
    args = parsed.data;
    // A command's JSON booleans are not proof of a UI confirmation. Only the
    // authenticated browser Fetch entry below may enter mutation dispatch.
    const readSettings = args.action === 'settings' && ['retentionDays', 'maxStorageBytes', 'maxRecords'].every(key => args[key] === undefined);
    if (caller !== 'ui' && !TOOL_READ_ACTIONS.has(args.action) && !(caller === 'command' && readSettings)) throw new HistoryError('USER_ONLY_ACTION', 'Confirming a restore, deleting backups and changing retention require the file history UI.');
    const scope = { ...await scopeFor(agent, session, args.action), signal, ...(caller === 'tool' && agent ? { allowActiveSessionId: agent.id } : {}) };
    switch (args.action) {
      case 'list': await Promise.all(pendingOf(scope.sessionId)); return history.list({ ...args, cwd: scope.cwd, sessionId: scope.sessionId });
      case 'detail': return history.detail(args.recordId, args.fileId, scope.cwd);
      case 'turns': await Promise.all(pendingOf(scope.sessionId)); return history.turns({ cwd: scope.cwd, sessionId: scope.sessionId, limit: 2000 });
      case 'prepare': return history.prepare(args, scope);
      case 'restore': {
        // No live Agent means no resolved policy for this Session; falling back to the
        // deployment root would widen the write boundary, so refuse instead.
        const target = ctx.sessions.get(scope.sessionId);
        if (!target) throw new HistoryError('SESSION_MISSING', 'Open the session and wait for its Agent before restoring backups.');
        const policy = ctx.sandboxPolicy.resolve({ session: target });
        if (policy.mode === 'read-only') throw new HistoryError('READ_ONLY', 'This session is read-only. Change its file policy before restoring.');
        return history.restore(args.token, {
          ...scope, session: target, policy,
          withWorkspaceLock: operation => withWorkspaceLock(scope.cwd, operation, signal),
          validateScope: () => {
            if (ctx.agents.get(scope.sessionId) !== agent || ctx.sessions.get(scope.sessionId) !== target || ctx.workingDirectory.get(target) !== scope.cwd) throw new HistoryError('SESSION_CHANGED', 'Session or workspace changed. Preview again.');
            const currentPolicy = ctx.sandboxPolicy.resolve({ session: target });
            if (JSON.stringify(currentPolicy) !== JSON.stringify(policy)) throw new HistoryError('POLICY_CHANGED', 'File policy changed. Preview again.');
          }
        });
      }
      case 'delete': return history.remove(args.recordIds, scope.cwd, args.confirm);
      case 'settings': return ['retentionDays', 'maxStorageBytes', 'maxRecords'].every(key => args[key] === undefined) ? { ok: true, settings: history.settings() } : history.setSettings(args);
      case 'optimize': if (args.confirm !== true) throw new HistoryError('CONFIRM_REQUIRED', 'Confirm optimization of retained backups. Working files are not modified.'); return history.optimize(scope.cwd);
      case 'clean': if (args.confirm !== true) throw new HistoryError('CONFIRM_REQUIRED', 'Confirm expired backup cleanup.'); return history.clean(scope.cwd);
      case 'status': {
        const target = ctx.sessions.get(scope.sessionId), liveAgent = ctx.agents.get(scope.sessionId);
        let mutationBlockedReason = !target || !liveAgent ? 'SESSION_MISSING' : records.failure ? 'BACKUP_STORAGE_UNCERTAIN' : ctx.sandboxPolicy.resolve({ session: target }).mode === 'read-only' ? 'READ_ONLY' : null;
        let workspaceBusy = false;
        try { workspaceBusy = await isBusy(scope.cwd) || workspaceLocks.has((await io.root(scope.cwd, signal)).targetKey); }
        catch { mutationBlockedReason ??= 'ROOT_MISSING'; }
        const canMutate = mutationBlockedReason === null;
        return { ok: true, canMutate, mutationBlockedReason, workspaceBusy, capturing: active.has(scope.sessionId), pending: pendingOf(scope.sessionId).length, diagnostic: diagnostics.get(scope.sessionId) ?? null, settings: history.settings(), limits, recordCount: records.size, storage: records.stats() };
      }
      default: throw new HistoryError('INVALID_ACTION', 'Unknown file history action.');
    }
  };
  ctx.effect(() => ctx.commands.register({ name: 'file-history', description: '文件历史：查看状态、列表和回滚预览；恢复、删除和设置变更请使用文件历史 UI。', input: { hint: 'JSON operation; e.g. {"action":"list"}' }, recordInput: false,
    async handler({ rawInput, agent, signal }) {
      try {
        const args = JSON.parse(rawInput || '{"action":"status"}');
        // Never persist file contents in command/done. The view reads bodies via the authenticated resource route.
        if (args.action === 'detail') throw new HistoryError('USE_HISTORY_VIEW', 'Open file history to compare content, or use the file_history tool.');
        const value = await dispatch(args, agent, signal);
        return { kind: 'success', text: JSON.stringify(value) };
      } catch (error) { return { kind: 'error', text: JSON.stringify(errorValue(error)) }; }
    }
  }));
  ctx.effect(() => ctx.tools.register({ name: 'file_history', description: 'Inspect retained per-turn file backups and compare content. `prepare` returns a conflict check and a short-lived preview token that only the file history UI can confirm; this tool never writes files or deletes backups.', deferLoading: true, parameters: toolParameters,
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: args => TOOL_READ_ACTIONS.has(args?.action),
    async execute(args, exec) { try { if (!exec.agent) throw new HistoryError('SESSION_REQUIRED', 'A session is required.'); return await dispatch(args, exec.agent, exec.signal, 'tool'); } catch (error) { return errorValue(error); } }
  }));
  // The shared Connection carrier authenticates these exact Fetch routes.
  // File bodies do not enter the durable conversation log.
  // `buffered` is required, not a preference: this exact route serves GET/HEAD
  // reads and POST mutations, and a `streaming` declaration makes the carrier
  // attach a socket body to GET/HEAD, which throws before the handler runs.
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/local-dsh-rollback', methods: ['GET', 'HEAD', 'POST'], requestBody: 'buffered', async fetch(request) {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    const respond = (value, status = 200) => new Response(request.method === 'HEAD' ? null : JSON.stringify(value), { status, headers });
    try {
      // Fetch routes inherit authentication, not RPC resource authorization.
      // Require the actual browser owner Peer explicitly; API credentials must
      // not mint/consume a token advertised as a user-only UI confirmation.
      const admission = ctx.connection.admit(request);
      if ('rejection' in admission) return respond({ ok: false, code: 'UNAUTHORIZED', message: 'Authentication required.' }, admission.rejection);
      if (admission.peer.id !== ctx.connection.browserPeer.id) return respond({ ok: false, code: 'USER_ONLY_ACTION', message: 'File history routes require the authenticated owner browser.' }, 403);
      if (request.headers.get('sec-fetch-site') === 'cross-site') return respond({ ok: false, code: 'FORBIDDEN', message: 'Cross-site requests are not permitted.' }, 403);
      let args, sessionId;
      if (request.method === 'POST') {
        if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type') ?? '')) return respond({ ok: false, message: 'JSON content type required.' }, 415);
        const declared = Number(request.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return respond({ ok: false, message: 'Request exceeds limit.' }, 413);
        const text = await readBoundedText(request);
        args = JSON.parse(text);
        sessionId = args.sessionId;
      } else {
        const params = new URL(request.url).searchParams;
        sessionId = params.get('sessionId');
        args = { action: params.get('action') || 'list' };
        if (!['list', 'detail', 'turns', 'status', 'settings'].includes(args.action)) return respond({ ok: false, message: 'Use POST for changes.' }, 405);
        for (const key of ['recordId', 'fileId', 'query', 'scope']) if (params.has(key)) args[key] = params.get(key);
        for (const key of ['offset', 'limit', 'turn', 'turnStartSeq', 'endSeq']) if (params.has(key)) {
          const n = Number(params.get(key));
          if (!Number.isSafeInteger(n) || n < 0) throw new HistoryError('INVALID_INPUT', 'Invalid page/sequence number.');
          args[key] = n;
        }
      }
      if (typeof sessionId !== 'string' || !sessionId) throw new HistoryError('SESSION_REQUIRED', 'Session identity is required.');
      // A live Agent is preferred (it supplies the resolved sandbox policy for
      // mutations), but reads also work for a Session that is merely attached.
      const agent = ctx.agents.get(sessionId);
      const session = ctx.sessions.get(sessionId);
      if (!agent && !session) return respond({ ok: false, code: 'SESSION_MISSING', message: 'Open the session before using history.' }, 404);
      return respond(await dispatch(args, agent, request.signal, 'ui', session));
    } catch (error) { return respond(errorValue(error), error.code === 'REQUEST_TOO_LARGE' ? 413 : 400); }
  } }));
  ctx.effect(() => {
    const timer = setInterval(() => { if (!disposed) track('cleanup', history.clean().catch(error => report('cleanup', error))); }, limits.cleanupIntervalMinutes * 60000);
    timer.unref?.();
    return () => clearInterval(timer);
  });
  ctx.effect(() => async () => {
    disposed = true;
    await Promise.allSettled([...allPending(), history.queue]);
    active.clear(); history.tokens.clear(); installedWatermarks.clear();
  });
}
