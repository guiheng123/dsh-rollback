import { createHash, randomUUID } from 'node:crypto';

export const hashText = text => createHash('sha256').update(text, 'utf8').digest('hex');
export const absent = () => ({ exists: false, available: true, bytes: 0, hash: null, text: null });
export const publicSide = side => { const { text, contentRef, ...meta } = side; return meta; };
export function publicRecord(record) {
  const { workspaceKey, ...meta } = record;
  return { ...meta, files: record.files.map(file => ({ ...file, before: publicSide(file.before), after: publicSide(file.after) })) };
}
export function pathJoin(base, name) { return `${base.replace(/[\\/]+$/, '')}/${name}`; }
// A restore selection is bounded by what one workspace can hold, not by a fixed
// count: a backup record can legitimately cover the whole workspace. The only
// hard count ceiling left is a sanity bound on the request array itself, which is
// far above any scan (`maxFiles` tops out at 20000).
export const MAX_RESTORE_FILES = 20000;
export const MAX_DELETE_RECORDS = 500;
export function equalSide(a, b) {
  return a.exists === b.exists && a.available && b.available && (!a.exists || a.hash === b.hash);
}
export class HistoryError extends Error {
  constructor(code, message) { super(message); this.name = 'HistoryError'; this.code = code; }
}
// Use a portable subset even on non-Windows backends: retained rows may later be
// opened on Windows, where colons are ADS/drive syntax and dots/spaces alias paths.
export function checkName(name) {
  return typeof name === 'string' && name.length > 0 && !/[\\/:<>"|?*\x00-\x1f]/.test(name) && !/[. ]$/.test(name) && !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name);
}

/** Reads use the composed filesystem. No direct Node filesystem or subprocess bypass. */
export class WorkspaceIO {
  constructor(fs, limits) { this.fs = fs; this.limits = limits; }
  async root(cwd, signal) {
    const root = await this.fs.resolve(cwd, { signal });
    if ((await this.fs.lstat(cwd, undefined, signal))?.type === 'symlink') throw new HistoryError('UNSAFE_PATH', 'A symlinked workspace cannot be restored.');
    if ((await this.fs.stat(root, signal))?.type !== 'directory') throw new HistoryError('ROOT_MISSING', 'Workspace directory is unavailable.');
    return root;
  }
  async target(cwd, relative, signal, workspaceKey) {
    if (typeof relative !== 'string' || relative.length > 32768) throw new HistoryError('INVALID_PATH', 'Invalid recorded relative path.');
    const parts = relative.split('/');
    if (!parts.length || parts.some(part => !checkName(part))) throw new HistoryError('INVALID_PATH', 'Invalid recorded relative path.');
    const root = await this.root(cwd, signal);
    if (workspaceKey && root.targetKey !== workspaceKey) throw new HistoryError('WORKSPACE_CHANGED', 'Workspace no longer resolves to the recorded directory.');
    let path = cwd;
    for (const part of parts) {
      path = pathJoin(path, part);
      const info = await this.fs.lstat(path, { cwd }, signal);
      if (info && !['file', 'directory'].includes(info.type)) throw new HistoryError('UNSAFE_PATH', 'Links and special files cannot be restored.');
    }
    const target = await this.fs.resolve(path, { cwd, signal });
    if (!this.fs.contains(root, target) || target.targetKey === root.targetKey) throw new HistoryError('OUTSIDE_WORKSPACE', 'File is outside its recorded workspace.');
    return target;
  }
  async readTarget(target, signal, byteBudget = this.limits.maxFileBytes) {
    const info = await this.fs.stat(target, signal);
    if (!info) return absent();
    if (info.type !== 'file') return { exists: true, available: false, bytes: info.size ?? 0, hash: null, text: null, version: info.version, reason: 'Not a regular file' };
    if (info.size > this.limits.maxFileBytes) return { exists: true, available: false, bytes: info.size, hash: null, text: null, version: info.version, reason: 'File exceeds backup size limit' };
    if ((info.size ?? 0) > byteBudget) return { exists: true, available: false, bytes: info.size, hash: null, text: null, version: info.version, reason: 'Snapshot byte budget exceeded' };
    try {
      // Bound binary allocation before strict UTF-8 decode. Buffers never leave Host storage.
      const bytes = await this.fs.readBytes(target, signal, Math.min(this.limits.maxFileBytes, byteBudget));
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      if (text.includes('\0')) throw new HistoryError('BINARY_FILE', 'Binary file');
      const after = await this.fs.stat(target, signal);
      if (!after || after.type !== 'file' || typeof info.version !== 'string' || !info.version || after.version !== info.version) throw new HistoryError('FILE_CHANGED', 'File changed or its version was unavailable during snapshot read');
      return { exists: true, available: true, bytes: bytes.byteLength, hash: hashText(text), text, version: after.version };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { exists: true, available: false, bytes: info.size ?? 0, hash: null, text: null, version: info.version, reason: error.code === 'FILE_CHANGED' ? error.message : `Cannot back up as UTF-8: ${String(error.message).slice(0, 160)}` };
    }
  }
  async read(cwd, relative, signal, workspaceKey) { return this.readTarget(await this.target(cwd, relative, signal, workspaceKey), signal); }
  async scan(cwd, signal) {
    const root = await this.root(cwd, signal);
    const files = new Map(), skipped = new Set(), warnings = [];
    let totalBytes = 0, visits = 0, truncated = false, incomplete = false;
    const visit = async (directory, prefix, depth) => {
      if (depth > 64) { incomplete = true; warnings.push(`Depth limit: ${prefix}`); skipped.add(prefix); return; }
      let entries;
      try { entries = await this.fs.listDir(directory, signal); }
      catch (error) { if (signal?.aborted) throw error; incomplete = true; skipped.add(prefix); warnings.push(`Cannot list ${prefix || '.'}: ${String(error.message).slice(0, 120)}`); return; }
      for (const entry of entries) {
        if (signal?.aborted) throw signal.reason ?? new HistoryError('ABORTED', 'Cancelled');
        // Count even rejected names: an untrusted/remote provider must not bypass
        // the traversal budget by returning unusable entries.
        if (++visits > this.limits.maxFiles * 5) { truncated = true; return; }
        if (!checkName(entry.name)) { incomplete = true; skipped.add(prefix); continue; }
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (!this.fs.contains(root, entry.target) || entry.target.targetKey === root.targetKey) { incomplete = true; skipped.add(rel); continue; }
        let info;
        try { info = await this.fs.lstat(pathJoin(cwd, rel), { cwd }, signal); }
        catch (error) { if (signal?.aborted) throw error; incomplete = true; skipped.add(rel); warnings.push(`Cannot inspect ${rel}: ${String(error.message).slice(0, 120)}`); continue; }
        if (!info) { incomplete = true; skipped.add(rel); continue; }
        if (!['file', 'directory'].includes(info.type)) { skipped.add(rel); continue; }
        if (info.type === 'directory') {
          if (this.limits.excludeDirectories.includes(entry.name)) { skipped.add(rel); continue; }
          await visit(entry.target, rel, depth + 1);
          if (truncated) return;
          continue;
        }
        if (files.size >= this.limits.maxFiles) { truncated = true; return; }
        let side;
        try {
          side = await this.readTarget(await this.target(cwd, rel, signal, root.targetKey), signal, Math.max(0, this.limits.maxSnapshotBytes - totalBytes));
          if (!side.exists) { incomplete = true; skipped.add(rel); continue; }
          if (side.available) totalBytes += side.bytes;
        } catch (error) {
          if (signal?.aborted) throw error;
          incomplete = true; skipped.add(rel); warnings.push(`Cannot inspect ${rel}: ${String(error.message).slice(0, 120)}`); continue;
        }
        if (!side.available) warnings.push(`Cannot back up ${rel}: ${side.reason ?? 'content unavailable'}`);
        files.set(rel, side);
      }
    };
    await visit(root, '', 0);
    if ((await this.root(cwd, signal)).targetKey !== root.targetKey) throw new HistoryError('WORKSPACE_CHANGED', 'Workspace target changed during snapshot scan.');
    if (truncated) warnings.push('Snapshot entry limit reached; coverage is incomplete.');
    if (incomplete) warnings.push('Some paths could not be safely inspected; coverage is incomplete.');
    return { files, skipped, warnings, complete: !truncated && !incomplete, truncated, bytes: totalBytes, rootKey: root.targetKey };
  }
  async restore(cwd, file, side, expected, policy, signal, workspaceKey) {
    const target = await this.target(cwd, file.path, signal, workspaceKey);
    if (!side.available) throw new HistoryError('BACKUP_UNAVAILABLE', 'Requested backup content is unavailable.');
    if (!expected.available || (expected.exists && !expected.version)) throw new HistoryError('CURRENT_VERSION_UNAVAILABLE', 'The current file version cannot be verified; preview again after it becomes readable.');
    const current = await this.readTarget(target, signal);
    if (!equalSide(current, expected) || (current.exists && current.version !== expected.version)) throw new HistoryError('STALE_PREVIEW', 'File changed before restore publication.');
    if (!side.exists) {
      if (!expected.exists) return;
      await this.fs.deleteFile(target, { version: expected.version }, signal, policy);
    } else {
      await this.fs.writeText(target, side.text, expected.exists ? { kind: 'replaceIfVersion', version: expected.version } : { kind: 'createIfAbsent' }, signal, policy);
    }
    const actual = await this.read(cwd, file.path, signal, workspaceKey);
    if (!equalSide(actual, side)) throw new HistoryError('VERIFY_FAILED', 'Restore publication could not be verified; check retained rollback versions.');
  }
}
function covered(snapshot, path) {
  if (!snapshot.complete && snapshot.truncated !== false) return false;
  return ![...snapshot.skipped].some(prefix => prefix === '' || path === prefix || path.startsWith(`${prefix}/`));
}
// A scan reports one warning per unbackable file in the WHOLE workspace, so persisting them
// verbatim would copy a workspace-wide inventory into every turn's record and bury the files
// this turn really changed. Records therefore keep only the unbackable files of their own
// change set, grouped by cause and bounded in length.
const BACKUP_WARNING = 'Cannot back up ';
export function reasonCategory(reason) {
  if (/UTF-8/i.test(reason)) return 'not UTF-8 text; binary or unsupported encoding';
  if (/size limit/i.test(reason)) return 'over the per-file size limit';
  if (/byte budget/i.test(reason)) return 'over the snapshot byte budget';
  if (/Not a regular file/i.test(reason)) return 'not a regular file';
  return String(reason).slice(0, 160);
}
export function changeWarnings(files, snapshots, late = false) {
  const groups = new Map();
  for (const file of files) {
    for (const side of [file.before, file.after]) {
      if (!side.exists || side.available) continue;
      const category = reasonCategory(side.reason ?? 'content unavailable');
      const paths = groups.get(category) ?? new Set();
      paths.add(file.display ?? file.path);
      groups.set(category, paths);
    }
  }
  const warnings = [];
  for (const [category, paths] of groups) {
    const sorted = [...paths].sort(), extra = sorted.length > 8 ? ` (+${sorted.length - 8} more)` : '';
    warnings.push(`${BACKUP_WARNING}${sorted.length} changed ${sorted.length === 1 ? 'file' : 'files'} (${category}): ${sorted.slice(0, 8).join(', ')}${extra}`);
  }
  // Scan-level problems (unlistable directories, depth/entry limits) still explain missing
  // coverage, but the per-file inventory above replaces the scan's own file warnings.
  for (const snapshot of snapshots) for (const warning of snapshot.warnings) if (!warning.startsWith(BACKUP_WARNING)) warnings.push(warning);
  if (late) warnings.push('Baseline started after this turn began; earlier changes are not included.');
  return [...new Set(warnings)];
}
export function snapshotChanges(before, after) {
  const changes = [];
  for (const path of [...new Set([...before.files.keys(), ...after.files.keys()])].sort()) {
    const a = before.files.get(path), b = after.files.get(path);
    if ((!a && !covered(before, path)) || (!b && !covered(after, path))) continue;
    const oldSide = a ?? absent(), newSide = b ?? absent();
    const unchanged = oldSide.available && newSide.available ? equalSide(oldSide, newSide) : a && b && a.version === b.version;
    if (unchanged) continue;
    changes.push({ id: randomUUID(), path, display: path, change: !oldSide.exists ? 'added' : !newSide.exists ? 'deleted' : 'modified', before: oldSide, after: newSide });
  }
  return changes;
}

/** Diff work is bounded before allocating line arrays or the LCS table. */
export const DIFF_LIMITS = Object.freeze({ maxInputBytes: 512 * 1024, maxInputLines: 20000, maxCells: 250000, maxOutputLines: 2500 });
export function diffText(before, after, maxLines = DIFF_LIMITS.maxOutputLines) {
  const left = before ?? '', right = after ?? '';
  const limited = () => ({ lines: [], truncated: true, coarse: true });
  // UTF-8 has at least one byte per UTF-16 code unit for valid input. Check length first
  // so very large inputs never require an additional encoding allocation.
  if (left.length + right.length > DIFF_LIMITS.maxInputBytes || Buffer.byteLength(left, 'utf8') + Buffer.byteLength(right, 'utf8') > DIFF_LIMITS.maxInputBytes) return limited();
  let inputLines = 2;
  for (const text of [left, right]) {
    for (let index = 0; index < text.length; index++) {
      if (text.charCodeAt(index) === 10 && ++inputLines > DIFF_LIMITS.maxInputLines) return limited();
    }
  }
  maxLines = Number.isFinite(maxLines) ? Math.min(DIFF_LIMITS.maxOutputLines, Math.max(0, Math.floor(maxLines))) : DIFF_LIMITS.maxOutputLines;
  const a = left.split(/\r\n|\n/), b = right.split(/\r\n|\n/);
  const lines = [];
  let i = 0, j = 0, oldLine = 1, newLine = 1;
  const push = (type, text) => { if (lines.length >= maxLines) return false; lines.push({ type, oldLine: type === 'add' ? null : oldLine++, newLine: type === 'remove' ? null : newLine++, text }); return true; };
  while (i < a.length && j < b.length && a[i] === b[j]) { if (!push('equal', a[i])) return { lines, truncated: true, coarse: false }; i++; j++; }
  let ae = a.length, be = b.length;
  while (ae > i && be > j && a[ae - 1] === b[be - 1]) { ae--; be--; }
  const n = ae - i, m = be - j;
  const cells = (n + 1) * (m + 1), coarse = cells > DIFF_LIMITS.maxCells;
  if (!coarse) {
    // A single allocation bounds both cell storage and row-object overhead, including
    // highly asymmetric and empty middles where n * m alone is not a safe bound.
    const width = m + 1, table = new Uint32Array(cells);
    for (let x = n - 1; x >= 0; x--) for (let y = m - 1; y >= 0; y--) table[x * width + y] = a[i + x] === b[j + y] ? table[(x + 1) * width + y + 1] + 1 : Math.max(table[(x + 1) * width + y], table[x * width + y + 1]);
    let x = 0, y = 0;
    while (x < n || y < m) {
      if (x < n && y < m && a[i + x] === b[j + y]) { if (!push('equal', a[i + x])) return { lines, truncated: true, coarse }; x++; y++; }
      else if (x < n && (y >= m || table[(x + 1) * width + y] >= table[x * width + y + 1])) { if (!push('remove', a[i + x++])) return { lines, truncated: true, coarse }; }
      else { if (!push('add', b[j + y++])) return { lines, truncated: true, coarse }; }
    }
  } else {
    for (let x = i; x < ae; x++) if (!push('remove', a[x])) return { lines, truncated: true, coarse };
    for (let y = j; y < be; y++) if (!push('add', b[y])) return { lines, truncated: true, coarse };
  }
  while (ae < a.length) { if (!push('equal', a[ae++])) return { lines, truncated: true, coarse }; }
  return { lines, truncated: false, coarse };
}

export class HistoryService {
  constructor({ io, records, global, limits, now = Date.now, isBusy = () => false }) {
    Object.assign(this, { io, records, global, limits, now, isBusy });
    this.tokens = new Map(); this.queue = Promise.resolve();
  }
  serial(operation) { const result = this.queue.then(operation); this.queue = result.catch(() => {}); return result; }
  settings() {
    const current = this.global.get() ?? {};
    return { retentionDays: current.retentionDays ?? this.limits.defaultRetentionDays ?? 0, maxStorageBytes: current.maxStorageBytes ?? this.limits.maxStorageBytes ?? 0, maxRecords: current.maxRecords ?? this.limits.maxRecords ?? 0 };
  }
  async setSettings(value) {
    const input = typeof value === 'number' ? { retentionDays: value } : value;
    const patch = Object.fromEntries(Object.entries(input ?? {}).filter(([key, v]) => ['retentionDays', 'maxStorageBytes', 'maxRecords'].includes(key) && v !== undefined));
    return this.serial(async () => {
      const next = { ...this.settings(), ...patch };
      if (!Number.isInteger(next.retentionDays) || next.retentionDays < 0 || next.retentionDays > 3650) throw new HistoryError('INVALID_RETENTION', 'Retention must be 0 (never) or 1–3650 days.');
      if (!Number.isSafeInteger(next.maxStorageBytes) || next.maxStorageBytes < 0 || !Number.isSafeInteger(next.maxRecords) || next.maxRecords < 0) throw new HistoryError('INVALID_QUOTA', 'Quotas must be non-negative safe integers; 0 means unlimited.');
      try {
        const persist = () => this.global.set({ ...this.global.get(), ...next });
        if (this.records.durable) { this.records.assertHealthy(); await this.records.durable(persist); }
        else await persist();
      }
      catch (error) {
        throw new HistoryError('BACKUP_SETTINGS_UNCERTAIN', 'Saving backup settings failed and may have reached disk. Restart before further backup mutations, then check the saved settings.');
      }
      return { ok: true, settings: this.settings() };
    });
  }
  hydrateFile(file) { return this.records.hydrateFile ? this.records.hydrateFile(file) : file; }
  async updateJournal(journal) {
    if (this.records.updateJournal) await this.records.updateJournal(journal.id, journal.status, journal.results);
    else await this.records.put(journal.id, { ...journal, results: [...journal.results] });
  }
  optimize(cwd) {
    return this.serial(async () => {
      if (!this.records.optimize) throw new HistoryError('UNSUPPORTED_STORAGE', 'This storage does not support optimization.');
      return this.records.optimize(cwd);
    });
  }
  scoped(recordId, cwd) { const record = this.records.get(recordId); if (!record || record.cwd !== cwd) throw new HistoryError('NOT_FOUND', 'Backup is missing, expired or belongs to another workspace.'); return record; }
  /** Workspace of a Session that is no longer attached, recovered from its retained records. */
  workspaceOf(sessionId) {
    let newest;
    for (const [, record] of this.records.entries()) {
      if (record.sessionId !== sessionId || typeof record.cwd !== 'string') continue;
      if (!newest || record.createdAt > newest.createdAt) newest = record;
    }
    return newest?.cwd;
  }
  list({ cwd, sessionId, turn, turnStartSeq, endSeq, offset = 0, limit = 100, query = '', scope = 'session' }) {
    const all = [...this.records.entries()].map(([, record]) => record).filter(r => r.cwd === cwd && (scope === 'workspace' || r.sessionId === sessionId) && (turn === undefined || r.turn === turn) && (turnStartSeq === undefined || r.turnStartSeq === turnStartSeq) && (endSeq === undefined || r.endSeq === endSeq) && (!query || r.files.some(f => f.path.toLowerCase().includes(query.toLowerCase())))).sort((a, b) => b.createdAt - a.createdAt);
    offset = Math.max(0, Math.floor(offset)); limit = Math.max(1, Math.min(100, Math.floor(limit)));
    return { ok: true, records: all.slice(offset, offset + limit).map(publicRecord), total: all.length, offset, nextOffset: offset + limit < all.length ? offset + limit : null, settings: this.settings() };
  }
  detail(recordId, fileId, cwd) {
    const record = this.scoped(recordId, cwd), stored = record.files.find(f => f.id === fileId);
    if (!stored) throw new HistoryError('NOT_FOUND', 'File backup was not found.');
    const file = this.hydrateFile(stored);
    return { ok: true, record: publicRecord(record), file, diff: file.before.available && file.after.available ? diffText(file.before.text, file.after.text) : null };
  }
  // Rows are keyed by the Turn number as well as the closing sequence. The Chat UI's
  // turnTail slot reports the last assistant message seq, not the turn/end seq, so a
  // turn-keyed index is the only anchor both callers can agree on. Restore journals are
  // excluded: they describe an operation the user performed, not files this turn changed,
  // and counting them would double the badge after any rollback.
  turns({ cwd, sessionId, limit = 2000 }) {
    const counts = new Map();
    for (const [, record] of this.records.entries()) {
      if (record.cwd !== cwd || record.sessionId !== sessionId || record.kind !== 'change' || !record.files?.length || !Number.isSafeInteger(record.turn)) continue;
      const row = counts.get(record.turn) ?? { turn: record.turn, endSeq: null, fileCount: 0 };
      row.fileCount += record.files.length;
      if (Number.isSafeInteger(record.endSeq) && (row.endSeq === null || record.endSeq > row.endSeq)) row.endSeq = record.endSeq;
      counts.set(record.turn, row);
    }
    const rows = [...counts.values()].sort((a, b) => (b.endSeq ?? -1) - (a.endSeq ?? -1) || b.turn - a.turn);
    return { ok: true, turns: rows.slice(0, limit), truncated: rows.length > limit };
  }
  async saveChange({ id, sessionId, turn, turnStartSeq, messageSeq, endSeq, cwd, before, after, late = false }) {
    if (before.rootKey && after.rootKey && before.rootKey !== after.rootKey) throw new HistoryError('WORKSPACE_CHANGED', 'Workspace target changed during capture; this turn was not recorded.');
    const files = snapshotChanges(before, after);
    // A turn that changed nothing is not a backup: scan warnings alone (unbackable files
    // elsewhere in the workspace) must not create an empty, unrestorable record. A TRUNCATED
    // scan is different — it cannot prove that nothing changed, so its coverage diagnostic
    // must still be retained even without a captured file.
    const complete = before.complete && after.complete;
    if (!files.length && complete) return null;
    const record = { id, kind: 'change', sessionId, turn, turnStartSeq, messageSeq, ...(endSeq === undefined ? {} : { endSeq }), cwd, ...(before.rootKey ? { workspaceKey: before.rootKey } : {}), createdAt: this.now(), files, warnings: changeWarnings(files, [before, after], late), coverage: complete ? 'bounded' : 'incomplete' };
    await this.records.put(id, record); return record;
  }
  async verifyWorkspace(record, cwd, signal) {
    if (record.workspaceKey && (await this.io.root(cwd, signal)).targetKey !== record.workspaceKey) throw new HistoryError('WORKSPACE_CHANGED', 'Workspace no longer resolves to the recorded directory.');
  }
  // The memory budget for hydrating a selection. Capture bounds each snapshot to
  // maxSnapshotBytes, so a fully captured record's two sides fit this formula and
  // a whole-record restore never trips it. It also bounds legacy inline rows whose
  // sizes were not produced by the current scan limits.
  checkRestoreBudget(bytes) {
    const budget = 2 * Math.min(this.limits.maxSnapshotBytes ?? 33554432, 134217728);
    if (bytes > budget) throw new HistoryError('RESTORE_SIZE_LIMIT', 'Selected file versions exceed the restore memory budget for this backup.');
  }
  async prepare({ recordId, fileIds, side = 'before', all = false }, { cwd, sessionId, signal, allowActiveSessionId }) {
    if (!['before', 'after'].includes(side)) throw new HistoryError('INVALID_SIDE', 'Choose before or after.');
    const record = this.scoped(recordId, cwd);
    await this.verifyWorkspace(record, cwd, signal);
    if (await this.isBusy(cwd, allowActiveSessionId)) throw new HistoryError('WORKSPACE_BUSY', 'Wait for all agents in this workspace to finish before restoring.');
    // A whole-record selection is resolved on the Host from the record itself, so the
    // caller never has to enumerate (or size-limit) every file id.
    if (all === true && fileIds === undefined) fileIds = record.files.map(file => file.id);
    if (!Array.isArray(fileIds) || !fileIds.length || fileIds.length > MAX_RESTORE_FILES || new Set(fileIds).size !== fileIds.length) throw new HistoryError('INVALID_SELECTION', `Select 1–${MAX_RESTORE_FILES} distinct file backups.`);
    const checks = [];
    let selectedBytes = 0;
    for (const id of fileIds) {
      const stored = record.files.find(f => f.id === id);
      if (!stored) throw new HistoryError('NOT_FOUND', 'Selected file is not in this backup.');
      selectedBytes += (stored.before.available ? stored.before.bytes : 0) + (stored.after.available ? stored.after.bytes : 0);
      this.checkRestoreBudget(selectedBytes);
      const file = this.hydrateFile(stored);
      const current = await this.io.read(cwd, file.path, signal, record.workspaceKey);
      const matchesRecord = equalSide(current, file.before) || equalSide(current, file.after);
      const conflict = !current.available || (current.exists && !current.version) || !file[side].available || !matchesRecord;
      checks.push({ id, display: file.display, conflict, noOp: !conflict && equalSide(current, file[side]), reason: !current.available || (current.exists && !current.version) ? 'The current file version cannot be verified.' : !file[side].available ? file[side].reason ?? 'Requested version is not backed up.' : conflict ? 'Current file no longer matches this record. Restore the latest change first.' : null, current: publicSide(current) });
    }
    if (await this.isBusy(cwd, allowActiveSessionId)) throw new HistoryError('WORKSPACE_BUSY', 'An agent started editing while the preview was being prepared. Preview again when it finishes.');
    for (const [key, value] of this.tokens) if (value.expiresAt <= this.now()) this.tokens.delete(key);
    while (this.tokens.size >= 100) this.tokens.delete(this.tokens.keys().next().value);
    const token = randomUUID(), expiresAt = this.now() + 5 * 60000, canRestore = checks.every(c => !c.conflict);
    if (canRestore) this.tokens.set(token, { token, recordId, fileIds: [...fileIds], side, cwd, sessionId, checks, expiresAt });
    return { ok: true, token: canRestore ? token : null, expiresAt, canRestore, files: checks.map(({ current, ...check }) => check) };
  }
  async restore(token, { cwd, sessionId, signal, policy, allowActiveSessionId, withWorkspaceLock = operation => operation(), validateScope = () => {} }) {
    return this.serial(() => withWorkspaceLock(async () => {
      validateScope();
      const plan = this.tokens.get(token);
      // A rejected token stays consumable only until it expires; a token that reaches
      // the mutation phase below is deleted before the first write.
      if (!plan || plan.cwd !== cwd || plan.sessionId !== sessionId || plan.expiresAt <= this.now()) throw new HistoryError('PLAN_EXPIRED', 'Preview expired or was already used. Preview again.');
      if (await this.isBusy(cwd, allowActiveSessionId)) throw new HistoryError('WORKSPACE_BUSY', 'An agent is still editing this workspace.');
      const record = this.scoped(plan.recordId, cwd), files = [], skipped = [];
      await this.verifyWorkspace(record, cwd, signal);
      let selectedBytes = 0;
      for (const check of plan.checks) {
        const stored = record.files.find(f => f.id === check.id);
        if (!stored) throw new HistoryError('STALE_PREVIEW', 'A selected file left this backup after the preview. No files were restored.');
        selectedBytes += (stored.before.available ? stored.before.bytes : 0) + (stored.after.available ? stored.after.bytes : 0);
        this.checkRestoreBudget(selectedBytes);
        const file = this.hydrateFile(stored);
        const current = await this.io.read(cwd, file.path, signal, record.workspaceKey);
        if (!equalSide(current, check.current) || (current.exists && current.version !== check.current.version)) throw new HistoryError('STALE_PREVIEW', 'A selected file changed after the preview. No files were restored.');
        if (!file[plan.side].available) throw new HistoryError('BACKUP_UNAVAILABLE', 'Requested backup content is unavailable.');
        if (equalSide(current, file[plan.side])) { skipped.push(file.id); continue; }
        files.push({ id: randomUUID(), path: file.path, display: file.display, change: !current.exists ? 'added' : !file[plan.side].exists ? 'deleted' : 'modified', before: current, after: { ...file[plan.side] }, sourceFileId: file.id });
      }
      validateScope();
      if (await this.isBusy(cwd, allowActiveSessionId)) throw new HistoryError('WORKSPACE_BUSY', 'An agent started editing while the restore was being checked.');
      // Every check passed: this token is spent, so a retry cannot replay the plan.
      this.tokens.delete(token);
      if (!files.length) return { ok: true, noOp: true, recordId: null, restored: [], skipped, failed: [], message: 'Selected files already match the requested versions. No files or backups were written.' };
      const journal = { id: randomUUID(), kind: 'restore', sourceRecordId: record.id, sessionId: record.sessionId, operatedBySessionId: sessionId, turn: record.turn, turnStartSeq: record.turnStartSeq, messageSeq: record.messageSeq, ...(record.endSeq === undefined ? {} : { endSeq: record.endSeq }), cwd, ...(record.workspaceKey ? { workspaceKey: record.workspaceKey } : {}), createdAt: this.now(), files, warnings: [], status: 'prepared', results: [] };
      // This write must be durable BEFORE the first workspace mutation. Both versions survive even on partial failure.
      await this.records.put(journal.id, journal);
      const restored = [], failed = [];
      let journalFailed = false;
      for (const file of files) {
        try {
          validateScope();
          await this.verifyWorkspace(record, cwd, signal);
          if (await this.isBusy(cwd, allowActiveSessionId)) throw new HistoryError('WORKSPACE_BUSY', 'An agent started editing during restoration.');
          await this.io.restore(cwd, file, file.after, file.before, policy, signal, record.workspaceKey);
          restored.push(file.sourceFileId); journal.results.push({ id: file.id, status: 'restored' });
        } catch (error) {
          const message = String(error.message).slice(0, 500);
          failed.push({ id: file.sourceFileId, message, code: error.code ?? 'RESTORE_FAILED' }); journal.results.push({ id: file.id, status: 'failed', message });
          break;
        }
        // Durable per-file progress: multi-file restore is NOT claimed to be atomic.
        try { await this.updateJournal(journal); }
        catch (error) { failed.push({ id: file.sourceFileId, code: 'JOURNAL_FAILED', message: String(error.message).slice(0, 500) }); journalFailed = true; break; }
      }
      journal.status = failed.length ? 'partial' : 'completed';
      if (!journalFailed) {
        try { await this.updateJournal(journal); }
        catch (error) { failed.push({ id: null, code: 'JOURNAL_FAILED', message: String(error.message).slice(0, 500) }); journalFailed = true; }
      }
      return { ok: !failed.length, recordId: journal.id, restored, skipped, failed, journalFailed, message: journalFailed ? `Recovery progress could not be committed. Restart before continuing and inspect recovery record ${journal.id}; some files may already have been restored.` : failed.length ? 'Restore stopped after a failure. Both versions are retained; inspect the recovery record.' : 'Restore completed. Both versions are retained in history.' };
    }));
  }
  async remove(ids, cwd, confirm) {
    return this.serial(async () => {
      if (confirm !== true || !Array.isArray(ids) || !ids.length || ids.length > MAX_DELETE_RECORDS) throw new HistoryError('CONFIRM_REQUIRED', `Confirm deletion of 1–${MAX_DELETE_RECORDS} backup records. Working files are not deleted.`);
      const unique = [...new Set(ids)]; unique.forEach(id => this.scoped(id, cwd));
      for (const [token, plan] of this.tokens) if (unique.includes(plan.recordId)) this.tokens.delete(token);
      const deleted = await this.records.deleteMany(unique); return { ok: true, deleted };
    });
  }
  async clean(cwd) {
    return this.serial(async () => {
      const days = this.settings().retentionDays;
      if (!days) return { ok: true, deleted: 0, settings: this.settings() };
      const cutoff = this.now() - days * 86400000;
      const ids = [...this.records.entries()].filter(([, r]) => (!cwd || r.cwd === cwd) && r.createdAt < cutoff && r.status !== 'prepared' && r.status !== 'partial').map(([id]) => id);
      const deleted = ids.length ? await this.records.deleteMany(ids) : 0;
      for (const [token, plan] of this.tokens) if (ids.includes(plan.recordId)) this.tokens.delete(token);
      return { ok: true, deleted, settings: this.settings() };
    });
  }
}
