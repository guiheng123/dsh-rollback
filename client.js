window.__ModuleLoader__.load({
  id: '@local/dsh-rollback',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const EN = {
      title: 'File history & rollback', history: 'File history', turnHistory: 'History for this turn', close: 'Close',
      session: 'Session', notReady: 'Session ID is unavailable.', loading: 'Loading history...',
      loadError: 'Could not load file history.', retry: 'Retry', search: 'Filter files', allTurns: 'All turns',
      records: 'Backups', noRecords: 'No matching backups.', loadMore: 'Load more', turn: 'Turn',
      change: 'Change', restore: 'Restore', files: 'files', warnings: 'Warnings', changeRecord: 'File change', restoreRecord: 'Restore',
      selectAll: 'Select all', clearSelection: 'Clear selection', selected: 'selected',
      before: 'Before', after: 'After', diff: 'Diff', noFile: 'Select a file to inspect its versions.',
      unavailable: 'Content unavailable', noDiff: 'A text comparison is unavailable for this file.',
      restoreBefore: 'Restore selected to before', restoreAfter: 'Restore selected to after',
      prepareFailed: 'Could not prepare the restore.', preview: 'Restore preview',
      conflicts: 'Conflicts prevent restoring these files. Refresh history and inspect the current files.',
      confirmRestore: 'Confirm restore', cancel: 'Cancel', restoreDone: 'Restore request finished.',
      deleteRecord: 'Delete backup', confirmDelete: 'Delete this backup? Workspace files will not be changed.',
      confirm: 'Confirm', deleting: 'Deleting...', deleted: 'Backup deleted.',
      retention: 'Retention (days)', never: '0 = never expire', save: 'Save', saved: 'Settings saved.',
      clean: 'Clean expired backups', confirmClean: 'Delete expired backup records now?', cleaned: 'Expired backups cleaned.',
      changed: 'Modified', added: 'Added', removed: 'Deleted',
      available: 'Available', unavailableShort: 'Unavailable', created: 'Created', messageSeq: 'Message sequence',
      noSession: 'Open a conversation to view its history.', restoreFailed: 'Restore failed.',
      deleteFailed: 'Could not delete backup.', settingsFailed: 'Could not save settings.', cleanFailed: 'Could not clean backups.',
      status: 'Status', noFiles: 'No file entries in this backup.', pageError: 'The history service could not be reached.',
      jump: 'Open related conversation', jumpFailed: 'Could not open the related conversation.', rollback: 'Roll back', truncatedDiff: 'Comparison is truncated; open the complete before/after versions.', absent: 'File did not exist in this version.',
      currentSession: 'This conversation', workspace: 'Workspace', capturing: 'A turn is being captured.',
      pending: 'Pending captures', refresh: 'Refresh', expired: 'Expired', conflict: 'Conflict',
      storageManagement: 'Storage & quotas', allWorkspaces: 'All workspaces', storageUnavailable: 'Storage statistics unavailable.',
      logicalBytes: 'Logical content', uniqueContentBytes: 'Unique content', storedBytes: 'Estimated stored JSON',
      recordBytes: 'Record JSON', contentBytes: 'Content JSON', packCount: 'Content packs', orphanPackCount: 'Unreferenced packs',
      legacyRecordCount: 'Legacy records', protectedRecordCount: 'Protected records', maxStorage: 'Storage quota (MiB)', maxRecords: 'Backup count quota',
      quotaHelp: 'Retention and both quotas apply to all workspaces. 0 = unlimited. Save applies all three settings.',
      storageHelp: 'Stored size estimates the plugin JSON, not physical disk usage. Logical and unique content sizes refer to uncompressed text.',
      quotaExceeded: 'Global backup quota exceeded. New backups and restores are blocked; no backups are deleted automatically. Raise a quota, delete backups, or optimize old backups.',
      optimize: 'Optimize old backups (this workspace)', confirmOptimize: 'Optimize backups in the current workspace? Legacy inline text will be compressed and deduplicated, unreferenced content reclaimed, and empty records left by earlier versions removed. Workspace files will not change.',
      storageLocked: 'Backup storage may have an incomplete write. Restart Harness and inspect the retained recovery record before continuing.', rootMissing: 'The recorded workspace is unavailable. Reconnect the original directory and refresh.',
      ready: 'Automatic backups', intro: 'Choose a backup, select files, then preview and confirm. Your current versions are retained before restoring.',
      step1: '1 · Choose backup', step2: '2 · Select files', step3: '3 · Preview & restore',
      emptyTitle: 'Your next changes start here', emptyHelp: 'After enabling the plugin, let the assistant edit files and finish a turn. Supported text changes appear here automatically; earlier changes cannot be recovered.',
      filteredEmpty: 'No results for these filters', filteredHelp: 'Try another filename, choose all turns, or switch to workspace history.',
      defaultsHelp: 'Backups never expire unless you set retention below.',
      advanced: 'Optional backup management', workflowHelp: 'Select any files, or all of them. Preview checks for conflicts; nothing changes until you confirm.',
      busyHelp: 'This workspace is busy. Wait for all agents to finish, then refresh before restoring.',
      readOnly: 'Read-only history: this session has no writable active Agent. Continue the conversation, wait for it to finish, then refresh to restore.',
      noOp: 'Already matches · no change', willDelete: 'Will delete file', willCreate: 'Will recreate file', willReplace: 'Will replace content',
      previewHelp: 'Check the target version and each file below. Current versions are saved first. Multi-file restore can stop partway if an error occurs.',
      previewExpires: 'Preview expires', previewExpired: 'Preview expired. Cancel and preview again.', protected: 'Recovery needs review',
      prepared: 'Recovery pending', partial: 'Partially restored', completed: 'Restored',
      working: 'Working… Keep this window open.', restoreSuccess: 'Restore completed. The previous versions are retained in a recovery record.',
      noOpSuccess: 'Files already match the target. No working files or backups changed.', partialHelp: 'Restore stopped. Some files may have changed. Inspect the retained recovery record before continuing.',
      optimized: 'Backup optimization finished.', migrated: 'Migrated records', pruned: 'Empty records removed', reclaimedPacks: 'Reclaimed packs', optimizeFailed: 'Could not optimize backups.',
    };
    const ZH = {
      title: '文件历史与回滚', history: '文件历史', turnHistory: '本轮历史', close: '关闭',
      session: '会话', notReady: '无法获取会话 ID。', loading: '正在加载历史...',
      loadError: '无法读取文件历史。', retry: '重试', search: '筛选文件', allTurns: '全部轮次',
      records: '备份', noRecords: '没有匹配的备份。', loadMore: '加载更多', turn: '轮次',
      change: '变更', restore: '回滚', files: '个文件', warnings: '警告', changeRecord: '文件变更', restoreRecord: '回滚记录',
      selectAll: '全选', clearSelection: '清除选择', selected: '已选',
      before: '之前', after: '之后', diff: '差异', noFile: '选择文件查看版本。',
      unavailable: '内容不可用', noDiff: '此文件无法显示文本差异。',
      restoreBefore: '回滚所选文件到之前版本', restoreAfter: '回滚所选文件到之后版本',
      prepareFailed: '无法准备回滚。', preview: '回滚预览',
      conflicts: '文件存在冲突，不能回滚。请刷新历史并检查当前文件。',
      confirmRestore: '确认回滚', cancel: '取消', restoreDone: '回滚操作已完成。',
      deleteRecord: '删除备份', confirmDelete: '删除此备份？不会更改工作区文件。',
      confirm: '确认', deleting: '正在删除...', deleted: '备份已删除。',
      retention: '保留天数', never: '0 表示永不过期', save: '保存', saved: '设置已保存。',
      clean: '清理过期备份', confirmClean: '现在删除过期备份记录？', cleaned: '已清理过期备份。',
      changed: '已修改', added: '新增', removed: '已删除',
      available: '可用', unavailableShort: '不可用', created: '创建时间', messageSeq: '消息序号',
      noSession: '打开一个会话以查看历史。', restoreFailed: '回滚失败。',
      deleteFailed: '无法删除备份。', settingsFailed: '无法保存设置。', cleanFailed: '无法清理备份。',
      status: '状态', noFiles: '此备份中没有文件记录。', pageError: '无法连接历史服务。',
      jump: '打开关联对话', jumpFailed: '无法打开关联对话。', rollback: '回滚', truncatedDiff: '差异显示已截断，可切换到之前/之后查看完整版本。', absent: '此版本中文件不存在。',
      currentSession: '当前会话', workspace: '工作区', capturing: '正在捕获当前轮次。',
      pending: '待处理捕获', refresh: '刷新', expired: '已过期', conflict: '冲突',
      storageManagement: '备份空间与配额', allWorkspaces: '全局 · 所有工作区', storageUnavailable: '暂时无法获取空间统计。',
      logicalBytes: '逻辑正文', uniqueContentBytes: '唯一正文', storedBytes: '实际存储 JSON 估算',
      recordBytes: '记录 JSON', contentBytes: '正文 JSON', packCount: '正文包', orphanPackCount: '未引用正文包',
      legacyRecordCount: '遗留记录', protectedRecordCount: '受保护记录', maxStorage: '空间配额（MiB）', maxRecords: '备份数量配额',
      quotaHelp: '保留天数及两项配额对所有工作区生效；配额 0 表示无限。保存会同时应用三项设置。',
      storageHelp: '存储量仅为插件 JSON 估算，并非物理磁盘占用；逻辑正文与唯一正文为未压缩文本大小。',
      quotaExceeded: '全局备份配额已超限：拒绝新备份和回滚，不会自动删除备份。可提高配额、删除备份或优化旧备份。',
      optimize: '优化旧备份（当前工作区）', confirmOptimize: '确认优化当前工作区的备份？将压缩、去重旧的内联正文，回收未引用内容，并移除旧版本遗留的空记录；不会修改工作区文件。',
      storageLocked: '备份存储写入结果不确定。请重启 Harness，并检查保留的回滚记录后再继续。', rootMissing: '原工作目录暂不可用。请重新连接原目录后刷新。',
      ready: '自动备份', intro: '选择备份和文件，预览后确认回滚；恢复前会先保留当前版本。',
      step1: '1 · 选择备份', step2: '2 · 选择文件', step3: '3 · 预览并回滚',
      emptyTitle: '从下一次修改开始，留住每个版本', emptyHelp: '启用插件后，让助手修改文件并完成一轮对话，支持的文本变更就会自动出现在这里。无法恢复启用前的修改。',
      filteredEmpty: '当前筛选下没有备份', filteredHelp: '试试其他文件名、切换全部轮次，或查看工作区历史。',
      defaultsHelp: '备份默认永不过期，可在下方设置保留天数。',
      advanced: '可选备份管理', workflowHelp: '可逐个勾选，也可全选整个备份。预览只检查冲突，确认前不会修改文件。',
      readOnly: '当前仅可查看：此会话尚无可写的活动 Agent。继续对话并等待结束后，刷新即可尝试回滚。',
      busyHelp: '工作区正在执行任务，请等待所有 Agent 结束后刷新，再进行回滚。',
      noOp: '已是目标版本 · 无需更改', willDelete: '将删除文件', willCreate: '将重新创建文件', willReplace: '将替换内容',
      previewHelp: '请核对目标版本及每个文件。系统会先保留当前版本；多文件恢复中途出错时可能仅完成一部分。',
      previewExpires: '预览有效至', previewExpired: '预览已过期，请取消并重新预览。', protected: '恢复记录待检查',
      prepared: '恢复待完成', partial: '部分恢复', completed: '已恢复',
      working: '正在处理，请保持此窗口打开。', restoreSuccess: '回滚已完成。恢复前的版本已保存在回滚记录中。',
      noOpSuccess: '文件已是目标版本，未修改工作文件或新增备份。', partialHelp: '恢复已停止，部分文件可能已更改。请先检查保留的回滚记录。',
      optimized: '备份优化已完成。', migrated: '迁移记录', pruned: '已移除空记录', reclaimedPacks: '回收正文包', optimizeFailed: '无法优化备份。',
    };
    let locale, translate;
    function t(key) {
      try {
        const value = translate?.(key);
        if (typeof value === 'string' && value !== key) return value;
      } catch {}
      const active = localeSnapshot()?.active;
      return (active === 'zh' ? ZH[key] : EN[key]) ?? EN[key] ?? key;
    }

    const css = `
      .dshr-backdrop{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:color-mix(in srgb,var(--dsw-alias-label-primary) 24%,transparent);backdrop-filter:blur(5px);color:var(--dsw-alias-label-primary);pointer-events:auto;font:13px/1.55 system-ui,sans-serif}
      .dshr-backdrop *{box-sizing:border-box}
      .dshr-dialog{width:min(1180px,100%);height:min(880px,100%);max-height:calc(100dvh - 48px);display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:18px;box-shadow:0 24px 80px #0003;outline:none}
      .dshr-header{display:flex;align-items:center;gap:12px;padding:20px 24px 14px;flex:0 0 auto}
      .dshr-header h2{font-size:20px;line-height:28px;font-weight:650;margin:0;flex:1;letter-spacing:-.3px}
      .dshr-session{font:11px ui-monospace,monospace;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:20%}
      .dshr-intro{padding:0 24px 18px;border-bottom:1px solid var(--dsw-alias-border-l1)}
      .dshr-ready{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:600;color:var(--dsw-alias-state-success-primary)}
      .dshr-ready:before{content:'';width:7px;height:7px;border-radius:50%;background:currentColor}
      .dshr-intro p{margin:6px 0 0;color:var(--dsw-alias-label-secondary)}
      .dshr-body{min-height:0;flex:1;display:grid;grid-template-columns:minmax(250px,.74fr) minmax(0,1.65fr)}
      .dshr-listpane,.dshr-detailpane{min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}
      .dshr-listpane{border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
      .dshr-paneheading{padding:16px 18px 4px;font-size:11px;font-weight:650;letter-spacing:.6px;color:var(--dsw-alias-label-secondary)}
      .dshr-controls{display:flex;gap:8px;padding:12px 16px;flex-wrap:wrap;flex:0 0 auto}
      .dshr-controls input{flex:1 0 100%;width:100%}.dshr-controls select{flex:1;width:40%}
      .dshr-records{overflow:auto;min-height:0;flex:1;padding:0 10px 12px}
      .dshr-record{display:block;width:100%;text-align:left;padding:13px 12px;margin:0 0 6px;border:1px solid transparent;border-radius:10px;background:transparent;color:inherit;cursor:pointer}
      .dshr-record[aria-current=true]{background:var(--dsw-alias-bg-base);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 48%,var(--dsw-alias-border-l1));box-shadow:0 2px 5px #00000008}
      .dshr-record:hover,.dshr-file:hover{background:var(--dsw-alias-bg-base)}
      .dshr-recordtitle{font-weight:650;display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:5px}
      .dshr-muted{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:19px}
      .dshr-detailpane{padding:20px 24px;overflow:auto;scrollbar-gutter:stable}
      .dshr-detailhead{display:flex;align-items:flex-start;gap:12px;margin-bottom:10px}
      .dshr-detailhead h3{font-size:18px;line-height:25px;margin:0 0 4px;font-weight:650;flex:1}
      .dshr-warning{padding:10px 12px;margin:8px 0;border-left:3px solid var(--dsw-alias-state-warn-primary);border-radius:4px;background:var(--dsw-alias-bg-layer-1);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}
      .dshr-files{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;margin:10px 0;max-height:200px;overflow:auto;flex-shrink:0}
      .dshr-file{display:grid;grid-template-columns:20px minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;text-align:left}
      .dshr-file:last-child{border-bottom:0}.dshr-file input{accent-color:var(--dsw-alias-brand-primary);width:16px;height:16px}
      .dshr-file[aria-current=true]{background:var(--dsw-alias-bg-layer-1)}
      .dshr-path{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12px/20px ui-monospace,monospace}
      .dshr-badge{font-size:11px;padding:2px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;white-space:nowrap;font-weight:400}
      .dshr-badge[data-change=added]{color:var(--dsw-alias-state-success-primary)}.dshr-badge[data-change=deleted]{color:var(--dsw-alias-state-error-primary)}
      .dshr-actions,.dshr-tabs,.dshr-selection{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dshr-actions{margin:8px 0}.dshr-spacer{flex:1}
      .dshr-button,.dshr-input,.dshr-select{font:inherit;color:inherit;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:7px;min-height:34px;box-sizing:border-box}
      .dshr-button{padding:6px 11px;cursor:pointer;transition:background .15s}.dshr-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1)}
      .dshr-button:disabled{opacity:.45;cursor:not-allowed}.dshr-button[data-primary=true]{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);border-color:var(--dsw-alias-brand-primary);font-weight:600}
      .dshr-button[data-danger=true]{color:var(--dsw-alias-state-error-primary)}.dshr-button[data-primary=true][data-danger=true]{background:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-bg-base)}
      .dshr-input,.dshr-select{padding:6px 9px;min-width:0}
      .dshr-backdrop :is(button,input,select,summary):focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}
      .dshr-tabs{margin:16px 0 8px;gap:4px}.dshr-tabs .dshr-button{border-color:transparent;background:transparent}.dshr-tabs .dshr-button[aria-pressed=true]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-brand-primary)}
      .dshr-diff{overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;max-height:340px;font:12px/20px ui-monospace,monospace;flex-shrink:0}
      .dshr-line{display:grid;grid-template-columns:40px 40px 18px minmax(max-content,1fr);white-space:pre;min-height:20px;min-width:100%;width:max-content}.dshr-line span{padding:0 5px}
      .dshr-line .dshr-lineno{text-align:right;color:var(--dsw-alias-label-secondary);user-select:none;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent)}
      .dshr-line[data-type=add]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}.dshr-line[data-type=remove]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}
      .dshr-content{white-space:pre-wrap;overflow:auto;max-height:340px;min-height:64px;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;font:12px/20px ui-monospace,monospace;overflow-wrap:anywhere;flex-shrink:0}
      .dshr-footer{padding:12px 24px;border-top:1px solid var(--dsw-alias-border-l1);max-height:40%;overflow:auto;flex-shrink:0}.dshr-footerbar,.dshr-settings{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
      .dshr-inline{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.dshr-inline .dshr-input{width:100px;max-width:100%}
      .dshr-management summary{cursor:pointer;font-size:12px;line-height:22px;overflow-wrap:anywhere}.dshr-management[open] summary{margin-bottom:12px}
      .dshr-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px 14px;margin:12px 0}.dshr-stats div{min-width:0}.dshr-stats dt{color:var(--dsw-alias-label-secondary);font-size:11px}.dshr-stats dd{margin:2px 0 0;font-size:13px;overflow-wrap:anywhere}
      .dshr-settings{margin:12px 0 8px}.dshr-confirm{padding:16px;margin:12px 0;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,var(--dsw-alias-border-l1));border-radius:10px;background:var(--dsw-alias-bg-layer-1);scroll-margin:16px}
      .dshr-check{padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-wrap:anywhere}.dshr-check:last-child{border-bottom:0}
      .dshr-error{color:var(--dsw-alias-state-error-primary);padding:10px 24px;font-size:13px;overflow-wrap:anywhere}.dshr-notice{padding:8px 24px;color:var(--dsw-alias-label-secondary);font-size:12px;overflow-wrap:anywhere}
      .dshr-empty{margin:auto;max-width:470px;padding:30px 20px;text-align:center}.dshr-empty h3{font-size:18px;line-height:26px;margin:12px 0 8px}.dshr-empty p{color:var(--dsw-alias-label-secondary);margin:8px 0;font-size:13px}.dshr-emptymark{display:inline-grid;place-items:center;width:52px;height:52px;border-radius:14px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-brand-primary);font-size:27px}
      .dshr-headerbutton{font:inherit;font-size:12px;line-height:18px;white-space:nowrap;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:5px 10px;cursor:pointer}.dshr-turnanchor{display:inline-block;min-height:1px;min-width:1px;outline:none}.dshr-headerbutton:hover{background:var(--dsw-alias-bg-layer-2)}
      @media(max-width:760px){.dshr-backdrop{padding:8px}.dshr-dialog{max-height:calc(100dvh - 16px);height:100%;border-radius:12px}.dshr-header{padding:14px 16px;gap:8px}.dshr-header h2{font-size:17px}.dshr-intro{padding:0 16px 12px}.dshr-body{display:flex;flex-direction:column;overflow:auto}.dshr-listpane{border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1);max-height:38%;flex-shrink:0}.dshr-records{max-height:160px;min-height:50px}.dshr-detailpane{overflow:visible;padding:16px;flex:1 0 auto}.dshr-controls{padding:8px 12px}.dshr-controls input{flex:1 0 40%;width:40%}.dshr-controls select{width:25%}.dshr-paneheading{padding:10px 14px 0}.dshr-detailhead{flex-direction:column;align-items:stretch;gap:8px}.dshr-detailhead .dshr-actions{margin:0}.dshr-session{display:none}.dshr-footer{padding:10px 16px;max-height:32%}.dshr-file{padding:8px}.dshr-empty{padding:18px 12px}.dshr-empty h3{font-size:16px}.dshr-notice,.dshr-error{padding:8px 16px}}
      @media(prefers-reduced-motion:reduce){.dshr-button{transition:none}.dshr-backdrop{backdrop-filter:none}}
    `;

    const shared = { open: false, sessionId: null, turn: null, revision: 0 };
    const listeners = new Set();
    const anchors = new Map();
    const turnCountCache = new Map();
    const turnCountListeners = new Map();
    const latestTurnSeq = new Map();
    let pendingJump = null;
    let services = {};
    let localeSubscribe = listener => () => {};
    let localeSnapshot = () => null;
    const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
    const snapshot = () => shared.revision;
    function updateShared(next) {
      Object.assign(shared, next);
      shared.revision += 1;
      listeners.forEach(listener => listener());
    }
    function useLocale() {
      React.useSyncExternalStore(localeSubscribe, localeSnapshot, localeSnapshot);
    }
    function anchorKey(sessionId, endSeq) { return `${sessionId}:${endSeq}`; }
    function subscribeTurnCounts(sessionId, listener) {
      let listeners = turnCountListeners.get(sessionId);
      if (!listeners) turnCountListeners.set(sessionId, listeners = new Set());
      listeners.add(listener);
      return () => { listeners.delete(listener); if (!listeners.size) turnCountListeners.delete(sessionId); };
    }
    function publishTurnCounts(sessionId, value) {
      turnCountCache.set(sessionId, value);
      turnCountListeners.get(sessionId)?.forEach(listener => listener());
    }
    // Turn rows are indexed by Turn number, not by sequence. The turnTail slot reports
    // the closing assistant-message seq, which is NOT the turn/end seq the records key
    // on, so a seq-keyed lookup would silently find nothing on every answered turn.
    function ensureTurnCounts(sessionId, turn) {
      const target = Number(turn);
      if (!Number.isSafeInteger(target) || target < 0) return;
      const latest = Math.max(target, latestTurnSeq.get(sessionId) ?? -1);
      latestTurnSeq.set(sessionId, latest);
      const current = turnCountCache.get(sessionId);
      if (current?.status === 'loading') return;
      if (current?.status === 'ready' && current.loadedThrough >= latest) return;
      const requestedThrough = latest;
      publishTurnCounts(sessionId, { status: 'loading', counts: current?.counts ?? new Map(), endSeqs: current?.endSeqs ?? new Map(), loadedThrough: current?.loadedThrough ?? -1 });
      readApi({ action: 'turns', sessionId }).then(result => {
        const rows = Array.isArray(result.turns) ? result.turns : [];
        publishTurnCounts(sessionId, {
          status: 'ready',
          counts: new Map(rows.map(row => [Number(row.turn), Number(row.fileCount)])),
          endSeqs: new Map(rows.filter(row => Number.isSafeInteger(row.endSeq)).map(row => [Number(row.turn), Number(row.endSeq)])),
          truncated: Boolean(result.truncated),
          loadedThrough: requestedThrough
        });
        const newest = latestTurnSeq.get(sessionId) ?? requestedThrough;
        if (newest > requestedThrough) ensureTurnCounts(sessionId, newest);
      }).catch(() => publishTurnCounts(sessionId, { status: 'error', counts: new Map(), endSeqs: new Map(), loadedThrough: -1 }));
    }
    function refreshTurnCounts(sessionId) {
      const previous = turnCountCache.get(sessionId);
      turnCountCache.set(sessionId, { status: 'idle', counts: previous?.counts ?? new Map(), endSeqs: previous?.endSeqs ?? new Map(), loadedThrough: -1 });
      ensureTurnCounts(sessionId, latestTurnSeq.get(sessionId));
    }
    // Subscribes to the Session's turn summary so the anchor can move from the slot's
    // fallback seq to the real turn/end seq once the summary arrives. The old badge
    // read the file count from the same store; only the anchor needs it now.
    function useTurnEndSeq(sessionId, turn, fallback) {
      const subscribeForSession = React.useCallback(listener => sessionId ? subscribeTurnCounts(sessionId, listener) : () => {}, [sessionId]);
      const getEndSeq = React.useCallback(() => turnCountCache.get(sessionId)?.endSeqs?.get(Number(turn)) ?? null, [sessionId, turn]);
      const endSeq = React.useSyncExternalStore(subscribeForSession, getEndSeq, getEndSeq);
      React.useEffect(() => { if (sessionId) ensureTurnCounts(sessionId, turn); }, [sessionId, turn]);
      return endSeq ?? fallback;
    }    function turnEndSeq(sessionId, turn) {
      return turnCountCache.get(sessionId)?.endSeqs?.get(Number(turn)) ?? null;
    }
    function registerAnchor(sessionId, endSeq, node) {
      if (!sessionId || endSeq === null || endSeq === undefined || !Number.isSafeInteger(Number(endSeq))) return;
      const key = anchorKey(sessionId, endSeq);
      if (!node) { anchors.delete(key); return; }
      anchors.set(key, node);
      if (pendingJump?.key === key) {
        node.scrollIntoView({ block: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        node.focus({ preventScroll: true });
        pendingJump = null;
      }
    }
    function readSessionId(props) { return props?.sessionId ?? null; }
    function openHistory(sessionId, turn = null) {
      const parsedTurn = turn === null || turn === undefined || turn === '' ? null : Number(turn);
      updateShared({ open: true, sessionId: sessionId || null, turn: Number.isSafeInteger(parsedTurn) && parsedTurn >= 0 ? parsedTurn : null });
    }
    function closeHistory() { updateShared({ open: false }); }
    async function jumpToRecord(record) {
      const sessionId = record?.sessionId;
      const seq = Number(record?.messageSeq);
      const endSeq = Number(record?.endSeq);
      if (!sessionId || !Number.isSafeInteger(seq) || seq < 0) throw new Error(t('jumpFailed'));
      pendingJump = Number.isFinite(endSeq) ? { key: anchorKey(sessionId, endSeq) } : null;
      try {
        if (!services.uiWorkspace?.openSession || !services.sessions?.using) throw new Error(t('jumpFailed'));
        await services.uiWorkspace.openSession(sessionId);
        await services.sessions.using(sessionId, { source: 'controllerOperation' }, async ref => {
          const binding = await ref.ready;
          await binding.session.loadThrough(Number.isSafeInteger(endSeq) ? Math.max(seq, endSeq) : seq);
        });
        if (Number.isFinite(endSeq)) {
          const node = anchors.get(anchorKey(sessionId, endSeq));
          if (node) {
            node.scrollIntoView({ block: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
            node.focus({ preventScroll: true });
            pendingJump = null;
          }
        }
      } catch (cause) {
        pendingJump = null;
        throw cause;
      }
    }
    function endpointUrl(params) {
      const url = new URL('/api/local-dsh-rollback', window.location.origin);
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
      }
      return url;
    }
    async function readApi(params, signal) {
      const response = await fetch(endpointUrl(params), { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || data.ok === false) throw new Error(data?.message ?? data?.error?.message ?? `${t('loadError')} (${response.status})`);
      return data;
    }
    async function writeApi(body, signal) {
      const response = await fetch(endpointUrl({}), { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify(body), signal });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || data.ok === false) {
        const error = new Error(data?.message ?? data?.error?.message ?? `${t('pageError')} (${response.status})`);
        error.details = data;
        throw error;
      }
      return data;
    }
    function Button({ children, onClick, disabled, primary, danger, title, type = 'button', className = '', pressed }) {
      return h('button', { type, className: `dshr-button ${className}`, onClick, disabled, title, 'aria-pressed': pressed, 'data-primary': primary ? 'true' : undefined, 'data-danger': danger ? 'true' : undefined }, children);
    }
    const MIB = 1024 * 1024;
    function formatBytes(value) {
      const bytes = Number(value);
      if (!Number.isFinite(bytes) || bytes < 0) return '—';
      const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
      let amount = bytes, unit = 0;
      while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
      return `${Number(amount.toFixed(unit ? 2 : 0))} ${units[unit]}`;
    }
    function quotaBytes(input) {
      if (!String(input).trim()) return null;
      const mib = Number(input);
      const bytes = Math.round(mib * MIB);
      return Number.isFinite(mib) && mib >= 0 && (mib === 0 || bytes > 0) && Number.isSafeInteger(bytes) ? bytes : null;
    }
    function ChangeBadge({ change }) {
      const key = change === 'added' ? 'added' : change === 'deleted' ? 'removed' : 'changed';
      return h('span', { className: 'dshr-badge', 'data-change': change }, t(key));
    }
    function ChangeLines({ diff }) {
      if (!diff?.lines?.length) return h('div', { className: 'dshr-muted' }, t('noDiff'));
      return h('div', { className: 'dshr-diff' }, diff.lines.map((line, index) => h('div', { className: 'dshr-line', 'data-type': line.type, key: `${index}-${line.oldLine}-${line.newLine}` },
        h('span', { className: 'dshr-lineno' }, line.oldLine ?? ''),
        h('span', { className: 'dshr-lineno' }, line.newLine ?? ''),
        h('span', null, line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '),
        h('span', null, line.text ?? ''))));
    }

    function HistoryDialog({ sessionId, turn }) {
      useLocale();
      const dialogRef = React.useRef(null);
      const [records, setRecords] = React.useState([]);
      const [scope, setScope] = React.useState('session');
      const [captureStatus, setCaptureStatus] = React.useState(null);
      const [total, setTotal] = React.useState(0);
      const [nextOffset, setNextOffset] = React.useState(null);
      const [query, setQuery] = React.useState('');
      // Opening from a Turn button seeds the filter with that Turn; the dropdown then
      // owns it, and every change re-queries the Host instead of filtering the page.
      const [turnFilter, setTurnFilter] = React.useState(turn === null || turn === undefined ? 'all' : String(turn));
      const [activeRecordId, setActiveRecordId] = React.useState('');
      const [activeFileId, setActiveFileId] = React.useState('');
      const [detail, setDetail] = React.useState(null);
      const [retentionInput, setRetentionInput] = React.useState('0');
      const [view, setView] = React.useState('diff');
      const [selectedIds, setSelectedIds] = React.useState([]);
      // Selecting the whole record is delegated to the Host (`all: true`) so a backup
      // with thousands of files never depends on the request-body ceiling.
      const [wholeRecord, setWholeRecord] = React.useState(false);
      const [preview, setPreview] = React.useState(null);
      const [confirmDelete, setConfirmDelete] = React.useState(false);
      const [confirmClean, setConfirmClean] = React.useState(false);
      const [loading, setLoading] = React.useState(false);
      const [loadingMore, setLoadingMore] = React.useState(false);
      const [mutating, setMutating] = React.useState(false);
      const [detailLoading, setDetailLoading] = React.useState(false);
      const [error, setError] = React.useState('');
      const [detailError, setDetailError] = React.useState('');
      const [notice, setNotice] = React.useState(() => shared.notice ?? '');
      const [refresh, setRefresh] = React.useState(0);
      const listRequests = React.useRef({ generation: 0, moreController: null });
      // Keep new hooks after the existing hook sequence for the lightweight hook fixture.
      const [maxStorageInput, setMaxStorageInput] = React.useState('0');
      const [maxRecordsInput, setMaxRecordsInput] = React.useState('0');
      const [confirmOptimize, setConfirmOptimize] = React.useState(false);
      const settingsRevision = React.useRef(0);
      const optimizeRequest = React.useRef(false);
      const mutationLock = React.useRef(false);
      const selectionVersion = React.useRef(0);
      const previewRef = React.useRef(null);
      const [clock, setClock] = React.useState(Date.now);
      const [actionError, setActionError] = React.useState('');
      const canMutate = captureStatus?.canMutate !== false;
      const workspaceBusy = captureStatus?.workspaceBusy === true;
      const restoreBlocked = loading || !canMutate || workspaceBusy || captureStatus?.storage?.quotaExceeded === true;
      function beginMutation() { if (mutationLock.current) return false; mutationLock.current = true; setMutating(true); return true; }
      function endMutation() { mutationLock.current = false; setMutating(false); }
      function invalidateSelection() { ++selectionVersion.current; setPreview(null); setConfirmDelete(false); setWholeRecord(false); }
      function dismiss() { if (!mutationLock.current) closeHistory(); }
      React.useEffect(() => {
        if (!preview) return undefined;
        setClock(Date.now());
        const timer = setInterval(() => setClock(Date.now()), 1000);
        previewRef.current?.scrollIntoView?.({ block: 'nearest' });
        return () => clearInterval(timer);
      }, [preview]);
      const previewExpired = preview && preview.expiresAt <= clock;
      function applySettings(settings) {
        if (!settings) return;
        setRetentionInput(String(settings.retentionDays ?? 0));
        setMaxStorageInput(String(Number(settings.maxStorageBytes ?? 0) / MIB));
        setMaxRecordsInput(String(settings.maxRecords ?? 0));
      }
      const retentionDays = Number(retentionInput);
      const maxStorageBytes = quotaBytes(maxStorageInput);
      const maxRecords = Number(maxRecordsInput);
      const validSettings = String(retentionInput).trim() !== '' && Number.isInteger(retentionDays) && retentionDays >= 0 && retentionDays <= 3650
        && maxStorageBytes !== null && String(maxRecordsInput).trim() !== '' && Number.isSafeInteger(maxRecords) && maxRecords >= 0;

      React.useEffect(() => {
        const previous = document.activeElement;
        dialogRef.current?.focus();
        // A one-shot message published by a failed jump must not outlive its dialog.
        if (shared.notice) shared.notice = '';
        return () => { if (previous && typeof previous.focus === 'function') previous.focus(); };
      }, []);

      React.useLayoutEffect(() => {
        ++listRequests.current.generation; invalidateSelection();
        listRequests.current.moreController?.abort();
        listRequests.current.moreController = null;
        setLoadingMore(false); setNextOffset(null);
        if (!sessionId) { setError(t('notReady')); setRecords([]); return undefined; }
        const controller = new AbortController();
        let live = true;
        setLoading(true); setError('');
        const params = { action: 'list', sessionId, scope, offset: 0, limit: 100, query, turn: turnFilter === 'all' ? null : Number(turnFilter) };
        const requestedSettingsRevision = settingsRevision.current;
        let hasStatusSettings = false;
        readApi({ action: 'status', sessionId }, controller.signal).then(status => {
          if (!live) return;
          setCaptureStatus(status);
          hasStatusSettings = Boolean(status.settings);
          if (settingsRevision.current === requestedSettingsRevision) applySettings(status.settings);
        }).catch(() => {});
        readApi(params, controller.signal).then(data => {
          if (!live) return;
          const rows = Array.isArray(data.records) ? data.records : [];
          setRecords(rows); setTotal(Number(data.total ?? rows.length)); setNextOffset(data.nextOffset ?? null);
          if (!hasStatusSettings && settingsRevision.current === requestedSettingsRevision) applySettings(data.settings);
          const selectedRecord = rows.find(record => record.id === activeRecordId) ?? rows[0] ?? null;
          setActiveRecordId(selectedRecord?.id ?? '');
          setActiveFileId(current => selectedRecord?.files?.some(file => file.id === current) ? current : (selectedRecord?.files?.[0]?.id ?? ''));
          if (!selectedRecord || selectedRecord.id !== activeRecordId) { setDetail(null); setSelectedIds([]); setPreview(null); }
        }).catch(cause => { if (live && cause.name !== 'AbortError') setError(cause.message || t('loadError')); })
          .finally(() => { if (live) setLoading(false); });
        return () => { live = false; controller.abort(); listRequests.current.moreController?.abort(); };
      }, [sessionId, scope, turnFilter, query, refresh]);

      const activeRecord = records.find(record => record.id === activeRecordId) ?? null;
      const activeFiles = Array.isArray(activeRecord?.files) ? activeRecord.files : [];
      const activeFile = activeFiles.find(file => file.id === activeFileId) ?? null;
      React.useEffect(() => {
        if (!sessionId || !activeRecordId || !activeFileId) { setDetail(null); setDetailError(''); return undefined; }
        const controller = new AbortController();
        let live = true;
        setDetail(null); setDetailLoading(true); setDetailError('');
        readApi({ action: 'detail', sessionId, recordId: activeRecordId, fileId: activeFileId }, controller.signal)
          .then(data => { if (live) setDetail(data); })
          .catch(cause => { if (live && cause.name !== 'AbortError') setDetailError(cause.message || t('loadError')); })
          .finally(() => { if (live) setDetailLoading(false); });
        return () => { live = false; controller.abort(); };
      }, [sessionId, activeRecordId, activeFileId, refresh]);

      async function loadMore() {
        if (nextOffset == null || loading || loadingMore || listRequests.current.moreController) return;
        const generation = listRequests.current.generation;
        const controller = new AbortController();
        listRequests.current.moreController = controller;
        setLoadingMore(true); setError('');
        try {
          const data = await readApi({ action: 'list', sessionId, scope, offset: nextOffset, limit: 100, query, turn: turnFilter === 'all' ? null : Number(turnFilter) }, controller.signal);
          if (generation !== listRequests.current.generation || controller.signal.aborted) return;
          setRecords(current => {
            const existing = new Set(current.map(record => record.id));
            return [...current, ...(data.records ?? []).filter(record => !existing.has(record.id))];
          });
          setNextOffset(data.nextOffset ?? null); setTotal(Number(data.total ?? total));
        } catch (cause) { if (!controller.signal.aborted && generation === listRequests.current.generation) setError(cause.message || t('loadError')); }
        finally {
          if (listRequests.current.moreController === controller) {
            listRequests.current.moreController = null;
            if (generation === listRequests.current.generation) setLoadingMore(false);
          }
        }
      }
      async function prepareRestore(side) {
        if (!activeRecordId || (!selectedIds.length && !wholeRecord) || restoreBlocked || !beginMutation()) return;
        const version = selectionVersion.current;
        setError(''); setActionError(''); setNotice(''); setPreview(null);
        try {
          const result = await writeApi({ action: 'prepare', sessionId, recordId: activeRecordId, side, ...(wholeRecord ? { all: true } : { fileIds: selectedIds }) });
          if (version === selectionVersion.current) setPreview({ ...result, side, recordId: activeRecordId });
        } catch (cause) { setError(cause.message || t('prepareFailed')); }
        finally { endMutation(); }
      }
      async function confirmRestore() {
        if (!preview?.canRestore || !preview.token || preview.recordId !== activeRecordId || preview.expiresAt <= Date.now() || restoreBlocked || !beginMutation()) return;
        setActionError('');
        try {
          const result = await writeApi({ action: 'restore', sessionId, token: preview.token });
          setPreview(null); setNotice(t(result.noOp ? 'noOpSuccess' : 'restoreSuccess')); setSelectedIds([]); setWholeRecord(false); setRefresh(value => value + 1); refreshTurnCounts(sessionId);
        } catch (cause) {
          setPreview(null);
          setActionError(`${cause.details?.recordId ? t('partialHelp') + ' ' : ''}${cause.message || t('restoreFailed')}${cause.details?.recordId ? ` · ${t('records')}: ${cause.details.recordId}` : ''}`);
          setRefresh(value => value + 1);
        }
        finally { endMutation(); }
      }
      async function deleteRecord() {
        if (!confirmDelete || !activeRecordId || !canMutate || !beginMutation()) return;
        setError('');
        try {
          await writeApi({ action: 'delete', sessionId, recordIds: [activeRecordId], confirm: true });
          setConfirmDelete(false); setNotice(t('deleted')); setActiveRecordId(''); setActiveFileId(''); setSelectedIds([]); setRefresh(value => value + 1); refreshTurnCounts(sessionId);
        } catch (cause) { setError(cause.message || t('deleteFailed')); }
        finally { endMutation(); }
      }
      async function saveSettings() {
        if (!validSettings || !canMutate || !beginMutation()) return;
        ++settingsRevision.current;
        setError('');
        try {
          const result = await writeApi({ action: 'settings', sessionId, retentionDays, maxStorageBytes, maxRecords });
          const next = { retentionDays, maxStorageBytes, maxRecords, ...result.settings };
          applySettings(next); setNotice(t('saved')); setRefresh(value => value + 1);
        } catch (cause) { setError(cause.message || t('settingsFailed')); }
        finally { endMutation(); }
      }
      async function cleanBackups() {
        if (!confirmClean || !canMutate || !beginMutation()) return;
        setError('');
        try {
          const result = await writeApi({ action: 'clean', sessionId, confirm: true });
          setConfirmClean(false); setNotice(`${t('cleaned')}: ${result.deleted ?? 0}`); setRefresh(value => value + 1); refreshTurnCounts(sessionId);
        } catch (cause) { setError(cause.message || t('cleanFailed')); }
        finally { endMutation(); }
      }
      async function optimizeBackups() {
        if (!confirmOptimize || !sessionId || !canMutate || optimizeRequest.current || !beginMutation()) return;
        optimizeRequest.current = true;
        setError(''); setNotice('');
        try {
          const result = await writeApi({ action: 'optimize', sessionId, confirm: true });
          if (result.storage) setCaptureStatus(current => ({ ...current, storage: result.storage }));
          setConfirmOptimize(false);
          setNotice(`${t('optimized')} ${t('migrated')}: ${result.migrated ?? 0} · ${t('pruned')}: ${result.pruned ?? 0} · ${t('reclaimedPacks')}: ${result.reclaimedPacks ?? 0}`);
          setRefresh(value => value + 1);
        } catch (cause) { setError(cause.message || t('optimizeFailed')); }
        finally { optimizeRequest.current = false; endMutation(); }
      }
      function toggleFile(id) {
        if (mutationLock.current) return;
        invalidateSelection();
        setSelectedIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
      }
      async function openRecord(record) {
        setError('');
        // The dialog unmounts on close, so a failure must be published to the shared
        // store to survive the remount; local state would be discarded.
        updateShared({ open: false, notice: '' });
        try { await jumpToRecord(record); }
        catch (cause) { updateShared({ open: true, notice: cause.message || t('jumpFailed') }); }
      }
      function onDialogKeyDown(event) {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); return; }
        if (event.key !== 'Tab') return;
        const nodes = [...(dialogRef.current?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex]:not([tabindex="-1"])') ?? [])].filter(node => {
          if (node.offsetParent === null) return false;
          const closed = node.closest('details:not([open])');
          if (closed) {
            const summary = closed.querySelector('summary');
            if (node !== summary && !summary?.contains(node)) return false;
          }
          return true;
        });
        if (!nodes.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus(); }
      }
      // The filter is a server-side query, so the option list comes from the Session's
      // full turn summary rather than from the currently loaded page.
      const summary = turnCountCache.get(sessionId);
      const knownTurns = [...(summary?.counts?.keys() ?? [])].filter(value => Number.isSafeInteger(value) && value >= 0);
      const turns = [...new Set([...knownTurns, ...records.map(record => Number(record.turn))].filter(value => Number.isSafeInteger(value) && value >= 0))].sort((a, b) => b - a);
      const listHeader = h('div', { className: 'dshr-controls' },
        h('input', { className: 'dshr-input', value: query, disabled: mutating, onChange: event => setQuery(event.target.value), placeholder: t('search'), 'aria-label': t('search') }),
        h('select', { className: 'dshr-select', value: scope, disabled: mutating, onChange: event => { setScope(event.target.value); setTurnFilter('all'); setActiveRecordId(''); setActiveFileId(''); setSelectedIds([]); setNextOffset(null); }, 'aria-label': t('currentSession') },
          h('option', { value: 'session' }, t('currentSession')),
          h('option', { value: 'workspace' }, t('workspace'))),
        h('select', { className: 'dshr-select', value: turnFilter, disabled: mutating, onChange: event => setTurnFilter(event.target.value), 'aria-label': t('allTurns') },
          h('option', { value: 'all' }, t('allTurns')),
          turns.map(turnValue => h('option', { key: turnValue, value: String(turnValue) }, `${t('turn')} ${turnValue}`))));
      const recordList = records.length ? records.map(record => h('button', { className: 'dshr-record', key: record.id, type: 'button', 'aria-current': record.id === activeRecordId, disabled: mutating, onClick: () => { invalidateSelection(); setActiveRecordId(record.id); setActiveFileId(record.files?.[0]?.id ?? ''); setSelectedIds([]); setPreview(null); setConfirmDelete(false); } },
        h('span', { className: 'dshr-recordtitle' }, h('span', null, `${t('turn')} ${record.turn ?? '?'}`), h('span', { className: 'dshr-badge' }, t(record.kind === 'restore' ? 'restoreRecord' : 'changeRecord'))),
        h('span', { className: 'dshr-muted' }, `${new Date(record.createdAt).toLocaleString()} · ${record.files?.length ?? 0} ${t('files')}`),
        record.status ? h('span', { className: 'dshr-muted' }, ` · ${t(record.status)}`) : null)) : h('div', { className: 'dshr-muted', style: { padding: 14 } }, loading ? t('loading') : t('noRecords'));
      const fileList = activeFiles.length ? activeFiles.map(file => h('div', { className: 'dshr-file', key: file.id, 'aria-current': file.id === activeFileId },
        h('input', { type: 'checkbox', checked: selectedIds.includes(file.id), disabled: mutating, onChange: () => toggleFile(file.id), 'aria-label': `${t('selected')}: ${file.display ?? file.path}` }),
        h('button', { type: 'button', style: { minWidth: 0, border: 0, padding: 0, textAlign: 'left', color: 'inherit', background: 'transparent', cursor: 'pointer' }, onClick: () => setActiveFileId(file.id), title: file.path }, h('span', { className: 'dshr-path' }, file.display ?? file.path)),
        h(ChangeBadge, { change: file.change }))) : h('div', { className: 'dshr-muted', style: { padding: 8 } }, t('noFiles'));
      const fileDetails = detail?.file;
      const selectedSide = view === 'before' ? fileDetails?.before : fileDetails?.after;
      const detailContent = view === 'diff'
        ? h(React.Fragment, null, detail?.diff?.truncated ? h('div', { className: 'dshr-warning' }, t('truncatedDiff')) : null, h(ChangeLines, { diff: detail?.diff }))
        : selectedSide?.exists === false
          ? h('div', { className: 'dshr-muted' }, t('absent'))
          : selectedSide?.available && selectedSide?.text != null
          ? h('pre', { className: 'dshr-content' }, selectedSide.text)
          : h('div', { className: 'dshr-warning' }, `${t('unavailable')}: ${selectedSide?.reason ?? t('unavailableShort')}`);

      const storage = captureStatus?.storage;
      const quotaExceeded = storage?.quotaExceeded === true;
      const storageSummary = storage
        ? `${t('allWorkspaces')} · ${storage.recordCount ?? 0} ${t('records')} · ${t('storedBytes')}: ${formatBytes(storage.storedBytes)}`
        : `${t('allWorkspaces')} · ${t('storageUnavailable')}`;
      const storageStats = storage ? h('dl', { className: 'dshr-stats' },
        ['recordCount', 'logicalBytes', 'storedBytes', 'uniqueContentBytes', 'legacyRecordCount', 'protectedRecordCount', 'recordBytes', 'contentBytes', 'packCount', 'orphanPackCount'].map(key =>
          h('div', { key }, h('dt', null, t(key === 'recordCount' ? 'records' : key)), h('dd', null, key.endsWith('Bytes') ? formatBytes(storage[key]) : String(storage[key] ?? 0))))) : null;
      const management = h('details', { className: 'dshr-management' },
        h('summary', null, `${t('advanced')} · ${storageSummary}`),
        h('div', { className: 'dshr-muted' }, t('storageHelp')),
        storageStats,
        h('div', { className: 'dshr-settings' },
          h('label', { className: 'dshr-inline' }, h('span', null, t('retention')), h('input', { className: 'dshr-input', type: 'number', min: 0, max: 3650, step: 1, value: retentionInput, onChange: event => { ++settingsRevision.current; setRetentionInput(event.target.value); }, 'aria-label': t('retention'), disabled: mutating || !canMutate }), h('span', { className: 'dshr-muted' }, t('never'))),
          h('label', { className: 'dshr-inline' }, h('span', null, t('maxStorage')), h('input', { className: 'dshr-input', type: 'number', min: 0, step: 'any', value: maxStorageInput, onChange: event => { ++settingsRevision.current; setMaxStorageInput(event.target.value); }, 'aria-label': t('maxStorage'), disabled: mutating || !canMutate })),
          h('label', { className: 'dshr-inline' }, h('span', null, t('maxRecords')), h('input', { className: 'dshr-input', type: 'number', min: 0, step: 1, value: maxRecordsInput, onChange: event => { ++settingsRevision.current; setMaxRecordsInput(event.target.value); }, 'aria-label': t('maxRecords'), disabled: mutating || !canMutate })),
          h(Button, { onClick: saveSettings, disabled: mutating || !canMutate || !validSettings }, t('save'))),
        h('div', { className: 'dshr-muted' }, t('quotaHelp')),
        confirmOptimize ? h('div', { className: 'dshr-confirm', role: 'group', 'aria-label': t('confirmOptimize') },
          h('div', null, t('confirmOptimize')),
          h('div', { className: 'dshr-actions' }, h(Button, { onClick: optimizeBackups, disabled: mutating, primary: true }, t('confirm')), h(Button, { onClick: () => setConfirmOptimize(false), disabled: mutating || !canMutate }, t('cancel'))))
          : h('div', { className: 'dshr-actions' }, h(Button, { onClick: () => setConfirmOptimize(true), disabled: mutating || !canMutate || !sessionId }, t('optimize'))),
        confirmClean ? h('div', { className: 'dshr-confirm' }, h('div', null, t('confirmClean')), h('div', { className: 'dshr-actions' }, h(Button, { onClick: cleanBackups, disabled: mutating || !canMutate, danger: true }, t('confirm')), h(Button, { onClick: () => setConfirmClean(false), disabled: mutating }, t('cancel'))))
          : h(Button, { onClick: () => setConfirmClean(true), disabled: mutating || !canMutate }, t('clean')));
      const emptyState = h('div', { className: 'dshr-empty' }, h('span', { className: 'dshr-emptymark', 'aria-hidden': true }, '↶'),
        h('h3', null, t(query || turnFilter !== 'all' ? 'filteredEmpty' : 'emptyTitle')),
        h('p', null, t(query || turnFilter !== 'all' ? 'filteredHelp' : 'emptyHelp')),
        h('p', null, t('defaultsHelp')));

      return h('div', { className: 'dshr-backdrop', onMouseDown: event => { if (event.target === event.currentTarget) dismiss(); } },
        h('section', { className: 'dshr-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dshr-title', tabIndex: -1, ref: dialogRef, onKeyDown: onDialogKeyDown },
          h('header', { className: 'dshr-header' },
            h('h2', { id: 'dshr-title' }, t('title')),
            h('span', { className: 'dshr-session', title: sessionId ?? '' }, `${t('session')}: ${sessionId ?? t('noSession')}`),
            h(Button, { onClick: () => setRefresh(value => value + 1), disabled: loading || mutating, title: t('refresh') }, t('refresh')),
            h(Button, { onClick: dismiss, disabled: mutating, title: t('close') }, t('close'))),
          h('div', { className: 'dshr-intro' }, h('span', { className: 'dshr-ready', style: captureStatus?.diagnostic || !canMutate ? { color: 'var(--dsw-alias-state-warn-primary)' } : undefined }, t('ready')), h('p', null, t('intro'))),
          !canMutate ? h('div', { className: 'dshr-warning', role: 'status' }, t(captureStatus?.mutationBlockedReason === 'BACKUP_STORAGE_UNCERTAIN' ? 'storageLocked' : captureStatus?.mutationBlockedReason === 'ROOT_MISSING' ? 'rootMissing' : 'readOnly')) : workspaceBusy ? h('div', { className: 'dshr-warning', role: 'status' }, t('busyHelp')) : null,
          mutating ? h('div', { className: 'dshr-notice', role: 'status' }, t('working')) : null,
          captureStatus?.capturing ? h('div', { className: 'dshr-notice', role: 'status' }, t('capturing')) : null,
          captureStatus?.diagnostic?.message ? h('div', { className: 'dshr-warning', role: 'status' }, captureStatus.diagnostic.message) : null,
          quotaExceeded ? h('div', { className: 'dshr-warning', role: 'alert' }, t('quotaExceeded')) : null,
          error ? h('div', { className: 'dshr-error', role: 'alert' }, error) : null,
          actionError ? h('div', { className: 'dshr-error', role: 'alert' }, actionError) : null,
          notice ? h('div', { className: 'dshr-notice', role: 'status' }, notice) : null,
          h('div', { className: 'dshr-body' },
            h('aside', { className: 'dshr-listpane', 'aria-label': t('records') },
              h('div', { className: 'dshr-paneheading' }, `${t('step1')} · ${total}`),
              listHeader,
              h('div', { className: 'dshr-records' }, recordList),
              nextOffset != null ? h('div', { style: { padding: 8 } }, h(Button, { onClick: loadMore, disabled: loading || loadingMore }, loadingMore ? t('loading') : t('loadMore'))) : null),
            h('main', { className: 'dshr-detailpane' }, activeRecord ? h(React.Fragment, null,
              h('div', { className: 'dshr-detailhead' },
                h('div', { style: { minWidth: 0, flex: 1 } },
                  h('h3', null, `${t('turn')} ${activeRecord.turn ?? '?'} · ${activeRecord.kind === 'restore' ? t('restore') : t('change')}`),
                  h('div', { className: 'dshr-muted' }, `${t('created')}: ${new Date(activeRecord.createdAt).toLocaleString()} · ${t('messageSeq')}: ${activeRecord.messageSeq ?? '—'}`)),
                h('div', { className: 'dshr-actions' },
                  h(Button, { onClick: () => openRecord(activeRecord), disabled: mutating || activeRecord.messageSeq == null || !Number.isSafeInteger(Number(activeRecord.messageSeq)), title: t('jump') }, t('jump')),
                  h(Button, { onClick: () => setConfirmDelete(true), danger: true, disabled: mutating || !canMutate }, t('deleteRecord')))),
              activeRecord.warnings?.length ? activeRecord.warnings.map((warning, index) => h('div', { className: 'dshr-warning', key: `${index}-${warning}` }, warning)) : null,
              h('div', { className: 'dshr-muted' }, t('workflowHelp')),
              h('div', { className: 'dshr-selection', style: { marginTop: 12 } },
                h('strong', null, t('step2')),
                h('span', { className: 'dshr-muted' }, `${wholeRecord ? activeFiles.length : selectedIds.length} ${t('selected')}`),
                h(Button, { onClick: () => { invalidateSelection(); setSelectedIds([]); setWholeRecord(true); }, disabled: mutating || !activeFiles.length, pressed: wholeRecord }, t('selectAll')),
                h(Button, { onClick: () => { invalidateSelection(); setSelectedIds([]); }, disabled: mutating || (!selectedIds.length && !wholeRecord) }, t('clearSelection'))),
              h('div', { className: 'dshr-files' }, fileList),
              h('div', { className: 'dshr-actions' },
                h(Button, { onClick: () => prepareRestore('before'), disabled: (!selectedIds.length && !wholeRecord) || mutating || restoreBlocked, primary: true }, t('restoreBefore')),
                h(Button, { onClick: () => prepareRestore('after'), disabled: (!selectedIds.length && !wholeRecord) || mutating || restoreBlocked }, t('restoreAfter')),
                h('span', { className: 'dshr-spacer' }),
                h('span', { className: 'dshr-muted' }, activeFile?.before?.available ? t('available') : t('unavailableShort')), h('span', { className: 'dshr-muted' }, '→'), h('span', { className: 'dshr-muted' }, activeFile?.after?.available ? t('available') : t('unavailableShort'))),
              activeFile ? h(React.Fragment, null,
                h('div', { className: 'dshr-muted', title: activeFile.path }, activeFile.display ?? activeFile.path),
                h('div', { className: 'dshr-tabs', role: 'group', 'aria-label': t('diff') },
                  ['diff', 'before', 'after'].map(mode => h(Button, { key: mode, onClick: () => setView(mode), pressed: view === mode }, t(mode)))),
                detailLoading ? h('div', { className: 'dshr-muted' }, t('loading')) : detailError ? h('div', { className: 'dshr-error', role: 'alert' }, detailError) : detailContent)
                : h('div', { className: 'dshr-muted', style: { padding: 14 } }, t('noFile')),
              confirmDelete ? h('div', { className: 'dshr-confirm', role: 'group', 'aria-label': t('confirmDelete') },
                h('div', null, t('confirmDelete')),
                h('div', { className: 'dshr-actions' }, h(Button, { onClick: deleteRecord, disabled: mutating, danger: true, primary: true }, mutating ? t('deleting') : t('confirm')), h(Button, { onClick: () => setConfirmDelete(false), disabled: mutating || !canMutate }, t('cancel')))) : null,
              preview ? h('div', { className: 'dshr-confirm', role: 'group', 'aria-label': t('preview'), ref: previewRef },
                h('strong', null, t('step3')),
                 h('p', { className: 'dshr-muted' }, t('previewHelp')),
                h('div', { className: 'dshr-muted', style: { marginTop: 5 } }, `${preview.files?.length ?? 0} ${t('selected')} · ${t(preview.side)}`),
                !preview.canRestore ? h('div', { className: 'dshr-warning' }, t('conflicts')) : null,
                 (preview.files ?? []).map(file => {
                   const entry = activeFiles.find(item => item.id === file.id);
                   const target = entry?.[preview.side];
                   const opposite = entry?.[preview.side === 'before' ? 'after' : 'before'];
                   return h('div', { className: 'dshr-check', key: file.id }, h('div', { className: 'dshr-path', title: file.display }, file.display), h('div', { className: 'dshr-muted' }, file.conflict ? `${t('conflict')}: ${file.reason ?? ''}` : t(file.noOp ? 'noOp' : target?.exists === false ? 'willDelete' : opposite?.exists === false ? 'willCreate' : 'willReplace')));
                 }),
                 h('div', { className: 'dshr-muted' }, previewExpired ? t('previewExpired') : `${t('previewExpires')}: ${new Date(preview.expiresAt).toLocaleTimeString()}`),
                h('div', { className: 'dshr-actions' }, h(Button, { onClick: confirmRestore, disabled: !preview.canRestore || previewExpired || mutating || restoreBlocked, primary: true }, t('confirmRestore')), h(Button, { onClick: () => setPreview(null), disabled: mutating || !canMutate }, t('cancel')))) : null
              ) : loading ? h('div', { className: 'dshr-empty', role: 'status' }, t('loading')) : emptyState)),
          h('footer', { className: 'dshr-footer' }, management)));
    }

    function HistoryOverlay() {
      useLocale();
      const revision = React.useSyncExternalStore(subscribe, snapshot, snapshot);
      void revision;
      return h(React.Fragment, null, h('style', null, css), shared.open ? h(HistoryDialog, { key: `${shared.sessionId}:${shared.turn}`, sessionId: shared.sessionId, turn: shared.turn }) : null);
    }
    function BundleGuide({ view }) {
      useLocale();
      if (view === 'summary') return h('span', null, t('ready'));
      return h('section', { style: { padding: '16px 0', lineHeight: 1.7 } },
        h('strong', { style: { color: 'var(--dsw-alias-state-success-primary)' } }, t('ready')),
        h('p', null, t('intro')),
        h('ol', { style: { paddingInlineStart: 22 } },
          h('li', null, t('emptyHelp')),
          h('li', null, `${t('history')} → ${t('step1')} → ${t('step2')} → ${t('step3')}`)),
        h('p', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('defaultsHelp')));
    }
    function HeaderEntry(props) {
      useLocale();
      const sessionId = readSessionId(props);
      return h('button', { type: 'button', className: 'dshr-headerbutton', onClick: () => openHistory(sessionId), title: t('title'), 'aria-haspopup': 'dialog' }, t('history'));
    }
    function TurnEntry(props) {
      useLocale();
      const sessionId = readSessionId(props);
      // `seq` is the closing assistant-message seq, which is not the turn/end seq that
      // records key on; the Turn number is the only anchor both sides agree on.
      const turn = typeof props?.turn === 'object' ? props.turn?.turn : props?.turn;
      const endSeq = useTurnEndSeq(sessionId, turn, props?.turn?.end?.seq ?? props?.seq);
      const anchorRef = React.useCallback(node => registerAnchor(sessionId, endSeq, node), [sessionId, endSeq]);
      // The anchor stays: "Open related conversation" scrolls and focuses it. Only the
      // visible "Roll back · N files" button was removed, so a turn adds no footer entry.
      return h('span', { ref: anchorRef, className: 'dshr-turnanchor', tabIndex: -1, 'aria-label': t('turnHistory') });
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        locale = ctx.locale;
        services = { uiWorkspace: ctx.get('uiWorkspace'), sessions: ctx.get('sessions') };
        translate = ctx.locale.bind('dshRollback');
        localeSubscribe = listener => ctx.locale.subscribe(listener);
        localeSnapshot = () => ctx.locale.getSnapshot();
        const cleanupEn = ctx.locale.register('dshRollback', 'en', EN);
        const cleanupZh = ctx.locale.register('dshRollback', 'zh', ZH);
        ctx.effect(() => () => { cleanupEn(); cleanupZh(); anchors.clear(); turnCountCache.clear(); turnCountListeners.clear(); latestTurnSeq.clear(); pendingJump = null; services = {}; });
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'local-dsh-rollback-history', order: 50 }, HistoryOverlay));
        ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({ name: 'conversation.session.header.utilities', id: 'local-dsh-rollback-header', order: 0 }, HeaderEntry));
        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({ name: 'conversation.chat.turnTail', id: 'local-dsh-rollback-turn', order: 30 }, TurnEntry));
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: '@local/dsh-rollback' }, BundleGuide));
      },
    };
  },
});
