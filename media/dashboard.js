/*
 * Antigravity Monitor — data-terminal dashboard behaviour.
 *
 * Plain JavaScript, no framework, no build step. Dynamic strings pass through
 * `textContent` so untrusted conversation titles never become markup.
 */

(function () {
  'use strict';

  const vscode = acquireVsCodeApi();

  const TABS = ['overview', 'sessions', 'models', 'settings'];
  const HISTORY_LIMIT = 60;

  /** @type {{snapshot: any, tab: string, threadFilter: string, threadQuery: string, history: Map<string, number[]>, rendered: Map<string,string>, showDiagnostics: boolean, refreshTimer: any}} */
  const state = {
    snapshot: null,
    tab: 'overview',
    threadFilter: 'all',
    threadQuery: '',
    history: new Map(),
    rendered: new Map(),
    showDiagnostics: false,
    refreshTimer: null,
  };

  const persisted = vscode.getState();
  if (persisted && typeof persisted.tab === 'string' && TABS.includes(persisted.tab)) {
    state.tab = persisted.tab;
  }

  // ---------------------------------------------------------------- utilities

  function el(tag, options, children) {
    const node = document.createElement(tag);
    const opts = options || {};
    if (opts.className) node.className = opts.className;
    if (opts.text !== undefined && opts.text !== null) node.textContent = String(opts.text);
    if (opts.attrs) {
      for (const [key, value] of Object.entries(opts.attrs)) {
        if (value === null || value === undefined || value === false) continue;
        node.setAttribute(key, value === true ? '' : String(value));
      }
    }
    if (opts.on) {
      for (const [event, handler] of Object.entries(opts.on)) node.addEventListener(event, handler);
    }
    if (children) {
      const list = Array.isArray(children) ? children : [children];
      for (const child of list) {
        if (child) node.appendChild(child);
      }
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function send(message) {
    vscode.postMessage(message);
  }

  function fmtTokens(value) {
    if (typeof value !== 'number' || !isFinite(value)) return '—';
    const abs = Math.abs(value);
    if (abs < 1000) return String(Math.round(value));
    if (abs < 1e6) return (value / 1e3).toFixed(1) + 'k';
    if (abs < 1e9) return (value / 1e6).toFixed(1) + 'M';
    return (value / 1e9).toFixed(1) + 'B';
  }

  function fmtExact(value) {
    if (typeof value !== 'number' || !isFinite(value)) return '—';
    return Math.round(value).toLocaleString('en-US');
  }

  function fmtRate(value) {
    if (typeof value !== 'number' || !isFinite(value) || value <= 0) return '— tok/s';
    const text = value >= 10 ? Math.round(value).toLocaleString('en-US') : value.toFixed(1).replace(/\.0$/, '');
    return text + ' tok/s';
  }

  function fmtPercent(value) {
    if (typeof value !== 'number' || !isFinite(value)) return '—';
    if (value >= 100) return '100%';
    return value.toFixed(1).replace(/\.0$/, '') + '%';
  }

  function fmtWhole(value) {
    if (typeof value !== 'number' || !isFinite(value)) return '—';
    return Math.round(Math.min(100, Math.max(0, value))) + '%';
  }

  function fmtUsd(value) {
    if (typeof value !== 'number' || !isFinite(value)) return '—';
    if (value > 0 && value < 0.01) return '<$0.01';
    return '$' + value.toFixed(2);
  }

  function fmtTime(iso) {
    const date = iso ? new Date(iso) : null;
    if (!date || isNaN(date.getTime())) return '—';
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  function fmtCountdown(iso) {
    if (!iso) return '—';
    const target = new Date(iso).getTime();
    if (!isFinite(target)) return '—';
    const remaining = target - Date.now();
    if (remaining <= 0) return 'now';
    const minutes = Math.floor(remaining / 60000);
    if (minutes < 1) return '<1m';
    if (minutes < 60) return minutes + 'm';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ' + String(minutes % 60).padStart(2, '0') + 'm';
    return Math.floor(hours / 24) + 'd ' + (hours % 24) + 'h';
  }

  function fmtAge(iso) {
    if (!iso) return '—';
    const then = new Date(iso).getTime();
    if (!isFinite(then)) return '—';
    const delta = Date.now() - then;
    if (delta < 45000) return 'just now';
    const minutes = Math.floor(delta / 60000);
    if (minutes < 60) return minutes + 'm ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    return Math.floor(hours / 24) + 'd ago';
  }

  function bandOf(percent, threshold) {
    if (typeof percent !== 'number') return 'normal';
    if (percent >= 95) return 'critical';
    if (percent >= threshold) return 'warning';
    return 'normal';
  }

  function backendLabel(app) {
    if (app === 'app') return 'Antigravity';
    if (app === 'ide') return 'Antigravity IDE';
    if (app === 'vscode') return 'VS Code';
    return 'Unknown app';
  }

  function normalizeModel(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // ------------------------------------------------------------------ quota

  function quotaView(snapshot) {
    const value = snapshot.quota;
    if (!value) return null;
    const age = value.observedAt === null ? Infinity : Date.now() - value.observedAt;
    const status = age < 0 || age > 30000 ? 'unavailable' : value.error || value.status === 'cached' || age > 12000 ? 'cached' : 'live';
    return Object.assign({}, value, { status });
  }

  function isArgonGroup(group) {
    return /argon/i.test(group.label || '') || (group.buckets || []).some(function (b) { return /argon/i.test(b.id || ''); });
  }

  function resolveQuotaGroupLocal(groups, modelName, hint) {
    if (!Array.isArray(groups) || !groups.length) return null;
    if (hint && hint.resetsAt) {
      const hintMs = Date.parse(hint.resetsAt);
      if (isFinite(hintMs)) {
        const byReset = groups.filter(function (g) {
          return (g.buckets || []).some(function (b) { return b.resetsAt && Math.abs(Date.parse(b.resetsAt) - hintMs) <= 120000; });
        });
        if (byReset.length === 1) return byReset[0];
      }
    }
    if (!modelName) return null;
    if (/argon/i.test(modelName)) {
      const argon = groups.filter(isArgonGroup);
      return argon.length === 1 ? argon[0] : null;
    }
    const base = String(modelName)
      .replace(/\s*\((?:high|medium|low|xhigh|thinking|orchestrator|argon)\)\s*/gi, ' ')
      .replace(/\s+(?:high|medium|low|xhigh|thinking|orchestrator)\s*$/i, '')
      .trim().toLowerCase();
    if (base.length >= 4) {
      const described = groups.filter(function (g) {
        return !isArgonGroup(g) && String(g.description || '').toLowerCase().includes(base);
      });
      if (described.length === 1) return described[0];
    }
    const family = /gemini/i.test(modelName) ? 'gemini' : /claude|gpt|openai|opus|sonnet/i.test(modelName) ? 'third-party' : null;
    if (!family) return null;
    const matches = groups.filter(function (g) {
      if (family === 'gemini') {
        return !isArgonGroup(g) && (/gemini/i.test(g.label || '') || (g.buckets || []).some(function (b) { return /^gemini-/.test(b.id || ''); }));
      }
      return /claude|gpt/i.test(g.label || '') || (g.buckets || []).some(function (b) { return /^3p-/.test(b.id || ''); });
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function bucketAvailable(bucket, quotaStatus) {
    if (!bucket || quotaStatus === 'unavailable' || !bucket.enabled || bucket.percent === null) return false;
    return !bucket.resetsAt || Date.parse(bucket.resetsAt) > Date.now();
  }

  function activeSelectedModel(snapshot) {
    const conv = snapshot.conversation;
    return snapshot.composerModelName || (conv && (conv.selectedModelName || conv.modelName)) || null;
  }

  // ------------------------------------------------------------------ chrome

  const subtitleNode = document.getElementById('subtitle');
  const statusChip = document.getElementById('status-chip');
  const followButton = document.getElementById('btn-follow');
  const refreshButton = document.getElementById('btn-refresh');
  const threadsTab = document.getElementById('tab-sessions');
  const footerNote = document.getElementById('footer-note');
  const panes = {
    overview: document.getElementById('pane-overview'),
    sessions: document.getElementById('pane-sessions'),
    models: document.getElementById('pane-models'),
    settings: document.getElementById('pane-settings'),
  };

  function setRefreshing(active) {
    if (state.refreshTimer) {
      clearTimeout(state.refreshTimer);
      state.refreshTimer = null;
    }
    if (!refreshButton) return;
    if (active) {
      refreshButton.disabled = true;
      refreshButton.setAttribute('aria-busy', 'true');
      refreshButton.textContent = 'Refreshing…';
      state.refreshTimer = setTimeout(function () {
        setRefreshing(false);
      }, 2500);
    } else {
      refreshButton.disabled = false;
      refreshButton.removeAttribute('aria-busy');
      refreshButton.textContent = 'Refresh';
    }
  }

  function triggerRefresh() {
    setRefreshing(true);
    send({ type: 'refresh' });
  }

  refreshButton.addEventListener('click', triggerRefresh);

  document.addEventListener('keydown', function (event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      triggerRefresh();
    } else if (event.key >= '1' && event.key <= '4') {
      const targetTab = TABS[Number(event.key) - 1];
      if (targetTab) selectTab(targetTab);
    }
  });

  if (followButton) {
    followButton.addEventListener('click', function () {
      send({ type: 'selectSession', id: null });
    });
  }

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      selectTab(tab.getAttribute('data-tab'));
    });
    tab.addEventListener('keydown', function (event) {
      const index = TABS.indexOf(state.tab);
      const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length
        : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null;
      if (next === null) return;
      event.preventDefault();
      selectTab(TABS[next]);
      document.getElementById('tab-' + TABS[next]).focus();
    });
  });

  function selectTab(name) {
    if (!TABS.includes(name)) return;
    state.tab = name;
    vscode.setState({ tab: name });

    document.querySelectorAll('.tab').forEach(function (tab) {
      const isActive = tab.getAttribute('data-tab') === name;
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.tabIndex = isActive ? 0 : -1;
    });

    for (const key of TABS) {
      panes[key].hidden = key !== name;
    }
    renderActivePane();
  }

  function chipFor(snapshot) {
    switch (snapshot.status) {
      case 'ok':
        if (snapshot.conversation && snapshot.conversation.usage && snapshot.conversation.usage.source === 'estimated') {
          return { label: 'Streaming', className: 'chip chip--ok' };
        }
        return { label: 'Live', className: 'chip chip--ok' };
      case 'no-conversation':
        return { label: 'Ready', className: 'chip chip--neutral' };
      case 'connecting':
        return { label: 'Connecting', className: 'chip chip--neutral' };
      case 'disconnected':
        return { label: 'Standby', className: 'chip chip--neutral' };
      case 'error':
        if (!snapshot.backends || snapshot.backends.length === 0) {
          return { label: 'Standby', className: 'chip chip--neutral' };
        }
        return { label: 'Error', className: 'chip chip--danger' };
      default:
        return { label: 'Starting', className: 'chip chip--neutral' };
    }
  }

  function renderChrome(snapshot) {
    const chip = chipFor(snapshot);
    statusChip.textContent = chip.label;
    statusChip.className = chip.className;

    if (followButton) {
      followButton.hidden = !snapshot.pinnedConversationId;
    }

    const runningTotal = (snapshot.sessions || []).filter(function (s) { return s.status === 'running'; }).length;
    if (threadsTab) {
      clear(threadsTab);
      threadsTab.appendChild(document.createTextNode('Threads'));
      if (runningTotal > 0) {
        threadsTab.appendChild(el('span', { className: 'tab__count', text: String(runningTotal), attrs: { title: runningTotal + ' running' } }));
      }
    }

    const noBackend = !snapshot.backends || snapshot.backends.length === 0;
    if (snapshot.status === 'ok' && snapshot.conversation) {
      const app = snapshot.backend ? backendLabel(snapshot.backend.app) : '';
      const ws = snapshot.conversation.workspace ? ' · ' + snapshot.conversation.workspace : '';
      subtitleNode.textContent = (app ? app + ' · ' : '') + snapshot.conversation.title + ws;
      subtitleNode.title = subtitleNode.textContent;
    } else if (noBackend && (snapshot.status === 'disconnected' || snapshot.status === 'error')) {
      subtitleNode.textContent = 'Waiting for Antigravity to launch';
    } else if (snapshot.lastError) {
      subtitleNode.textContent = snapshot.lastError;
    } else if (snapshot.status === 'no-conversation') {
      subtitleNode.textContent = 'Connected to ' + (snapshot.backend ? backendLabel(snapshot.backend.app) : 'Antigravity') + ' · Ready for a thread';
    } else if (snapshot.status === 'connecting') {
      subtitleNode.textContent = 'Connecting to the Antigravity language server…';
    } else {
      subtitleNode.textContent = 'Antigravity Monitor';
    }

    const parts = [];
    if (snapshot.backend) {
      parts.push(backendLabel(snapshot.backend.app) + ' · ' + snapshot.backend.scheme + '://127.0.0.1:' + snapshot.backend.port);
    }
    parts.push('Updated ' + fmtTime(new Date(snapshot.generatedAt).toISOString()));
    if ((snapshot.instances || []).length > 1) {
      parts.push((snapshot.instances || []).length + ' apps connected');
    }
    footerNote.textContent = parts.join(' · ');
  }

  // ------------------------------------------------------------------ render

  setInterval(function () {
    if (state.snapshot && !document.hidden && (state.tab === 'overview' || state.tab === 'models')) renderActivePane();
  }, 1000);

  window.addEventListener('message', function (event) {
    const message = event.data;
    if (!message || message.type !== 'snapshot') return;
    state.snapshot = message.snapshot;
    setRefreshing(false);
    trackHistory(message.snapshot);
    renderChrome(message.snapshot);
    renderActivePane();
  });

  function trackHistory(snapshot) {
    const conversation = snapshot.conversation;
    if (!conversation || !conversation.usage || conversation.usage.source !== 'measured') return;
    const list = state.history.get(conversation.id) || [];
    const last = list[list.length - 1];
    if (last !== conversation.usage.used) {
      list.push(conversation.usage.used);
      if (list.length > HISTORY_LIMIT) list.shift();
      state.history.set(conversation.id, list);
    }
  }

  function renderActivePane() {
    const snapshot = state.snapshot;
    const pane = panes[state.tab];
    if (!snapshot) {
      renderEmptyPane(pane, 'Waiting for the first reading', 'Antigravity Monitor is connecting to the local language server.');
      return;
    }

    const signature = JSON.stringify([state.tab, state.threadFilter, state.threadQuery, state.showDiagnostics, snapshot.prefs, paneSignature(state.tab, snapshot)]);
    if (state.rendered.get(state.tab) === signature) {
      return;
    }
    state.rendered.set(state.tab, signature);

    const active = document.activeElement;
    const focusedId = active && pane.contains(active) ? active.id : null;
    const selection = active && typeof active.selectionStart === 'number'
      ? { start: active.selectionStart, end: active.selectionEnd }
      : null;
    clear(pane);
    if (state.tab === 'overview') renderOverview(pane, snapshot);
    else if (state.tab === 'sessions') renderSessions(pane, snapshot);
    else if (state.tab === 'models') renderModels(pane, snapshot);
    else renderSettings(pane, snapshot);
    if (focusedId) {
      const focused = document.getElementById(focusedId);
      if (focused && pane.contains(focused)) {
        focused.focus({ preventScroll: true });
        if (selection && typeof focused.setSelectionRange === 'function') {
          try { focused.setSelectionRange(selection.start, selection.end); } catch (_) {}
        }
      }
    }
  }

  function paneSignature(tab, snapshot) {
    if (tab === 'settings') {
      return [
        snapshot.backends.map(function (b) { return [b.id, b.active, b.reachable, b.conversations, b.running]; }),
        (snapshot.instances || []).map(function (i) { return [i.backend.id, i.conversation && i.conversation.id, i.conversation && i.conversation.usage && i.conversation.usage.percent]; }),
      ];
    }
    if (tab === 'sessions') {
      return snapshot.sessions.map(function (s) {
        return [s.id, s.stepCount, s.percent, s.active, s.pinned, s.status, s.modelName, s.isSubagent];
      });
    }
    if (tab === 'models') {
      return [
        quotaView(snapshot), Math.floor(Date.now() / 60000),
        snapshot.composerModelName,
        snapshot.models.map(function (m) { return [m.modelId, m.quotaPercent, m.weeklyPercent, m.active, m.quotaGroup]; }),
      ];
    }
    return [
      snapshot.status,
      quotaView(snapshot), Math.floor(Date.now() / 60000),
      snapshot.lastError,
      snapshot.stale,
      snapshot.pinnedConversationId,
      snapshot.composerModelName,
      snapshot.conversation ? [snapshot.conversation.id, snapshot.conversation.stepCount, snapshot.conversation.compressed, snapshot.conversation.modelId, snapshot.conversation.selectedModelId] : null,
      snapshot.conversation && snapshot.conversation.usage ? [snapshot.conversation.usage.used, snapshot.conversation.usage.source, snapshot.conversation.usage.tokPerSec] : null,
      (snapshot.instances || []).map(function (i) { return [i.backend.id, i.status, i.viewState, i.composerModelName, i.conversation && i.conversation.id, i.conversation && i.conversation.stepCount, i.conversation && i.conversation.usage && i.conversation.usage.percent]; }),
      snapshot.account,
      snapshot.usage.todayTokens,
      snapshot.usage.monthTokens,
    ];
  }

  function renderEmptyPane(pane, title, body) {
    clear(pane);
    pane.appendChild(
      el('section', { className: 'panel' }, [
        el('div', { className: 'empty' }, [
          el('div', { className: 'empty__title', text: title }),
          el('div', { className: 'empty__body', text: body }),
        ]),
      ]),
    );
  }

  function cellHead(title, hint) {
    return el('div', { className: 'panel__head' }, [
      el('h2', { className: 'panel__title', text: title }),
      hint ? el('span', { className: 'panel__hint', text: hint }) : null,
    ]);
  }

  // --------------------------------------------------------------- overview

  function renderOverview(pane, snapshot) {
    const conversation = snapshot.conversation;
    const hasBackends = (snapshot.backends || []).length > 0;

    if (snapshot.lastError && hasBackends) {
      pane.appendChild(el('div', { className: 'notice notice--error', text: snapshot.lastError }));
    }

    // Band 1: Ruled Primary Split (Context & Speed | Quota Pools)
    const contextCell = el('div', { className: 'band-split__cell' }, contextCellContent(snapshot, conversation, hasBackends));
    const quotaCell = el('div', { className: 'band-split__cell' }, quotaCellContent(snapshot));
    pane.appendChild(el('section', { className: 'band-split' }, [contextCell, quotaCell]));

    if (!conversation) {
      const apps = appsPanel(snapshot);
      if (apps) pane.appendChild(apps);
      const account = accountLedgerPanel(snapshot);
      if (account) pane.appendChild(account);
      return;
    }

    // Band 2: Divided 4-Cell KPI Telemetry Strip
    pane.appendChild(kpiStrip(snapshot, conversation));

    // Band 3: Active Apps & Running Threads (when active)
    const apps = appsPanel(snapshot);
    if (apps) pane.appendChild(apps);

    // Band 4: Balanced Bottom Split (Session & Account Ledger | Usage & Growth)
    const leftCell = el('div', { className: 'band-split__cell' }, [
      cellHead('Session ledger', fmtExact(conversation.stepCount) + ' steps · ' + (conversation.status === 'running' ? 'Running' : 'Idle')),
      ledgerContent(snapshot, conversation),
    ]);
    const rightCell = el('div', { className: 'band-split__cell' }, analyticsContent(snapshot, conversation));
    pane.appendChild(el('section', { className: 'band-split band-split--even' }, [leftCell, rightCell]));
  }

  function contextCellContent(snapshot, conversation, hasBackends) {
    if (!conversation || !conversation.usage) {
      const isNewThread = (snapshot.instances || []).some(function (i) {
        return i.backend.active && i.viewState === 'new-thread';
      });
      const title = !conversation
        ? (!hasBackends ? 'Standby mode' : isNewThread ? 'New thread' : 'Waiting for a conversation')
        : 'No usage reported yet';
      const body = !conversation
        ? (!hasBackends
          ? 'Antigravity is not running yet. Context and quota telemetry appear automatically the moment you launch it.'
          : isNewThread
            ? 'Ready in the composer. Context usage appears once the first response arrives.'
            : 'Open or start a thread in Antigravity to begin measuring context.')
        : 'Antigravity reports usage after the model produces a response. Readings update automatically.';
      return [
        cellHead('Context window', (conversation && conversation.modelName) || snapshot.composerModelName || ''),
        el('div', { className: 'empty' }, [
          el('div', { className: 'empty__title', text: title }),
          el('div', { className: 'empty__body', text: body }),
          el('div', { className: 'empty__actions' }, [
            el('button', { className: 'btn btn--small', attrs: { type: 'button' }, text: 'Refresh now', on: { click: triggerRefresh } }),
          ]),
        ]),
      ];
    }

    const usage = conversation.usage;
    const threshold = snapshot.prefs.warningThreshold;
    const percent = usage.percent;
    const band = bandOf(percent, threshold);
    const pctRatio = percent === null ? 0 : Math.min(100, Math.max(0, percent));

    const badges = [
      el('span', { className: usage.source === 'measured' ? 'badge badge--measured' : 'badge badge--estimated', text: usage.source === 'measured' ? 'Measured' : 'Estimated' }),
    ];
    if (conversation.compressed) badges.push(el('span', { className: 'badge badge--accent', text: 'Compressed' }));
    if (snapshot.stale) badges.push(el('span', { className: 'badge', text: 'Stale' }));
    if (usage.measuredAt) badges.push(el('span', { className: 'panel__hint', text: fmtTime(usage.measuredAt) }));

    const heroTop = el('div', { className: 'hero-top' }, [
      el('div', { className: 'hero-figure' }, [
        el('span', { className: 'hero-percent', text: percent === null ? '—' : fmtPercent(percent), attrs: { 'data-band': band } }),
        el('span', { className: 'hero-tokens' }, [
          document.createTextNode(fmtTokens(usage.used)),
          el('small', { text: usage.capacity === null ? ' tokens' : ' / ' + fmtTokens(usage.capacity) }),
        ]),
      ]),
      el('div', { className: 'hero-sub' }, badges),
    ]);

    const fill = el('div', { className: 'ruler__fill', attrs: { 'data-band': band } });
    fill.style.width = pctRatio + '%';
    const warnTick = el('div', { className: 'ruler__tick', attrs: { title: 'Warning threshold ' + threshold + '%' } });
    warnTick.style.left = threshold + '%';
    const critTick = el('div', { className: 'ruler__tick', attrs: { title: 'Critical 95%' } });
    critTick.style.left = '95%';

    const ruler = el('div', { className: 'ruler', attrs: { role: 'progressbar', 'aria-valuenow': String(Math.round(pctRatio)), 'aria-valuemin': '0', 'aria-valuemax': '100' } }, [
      fill, warnTick, critTick,
    ]);

    const rulerMeta = el('div', { className: 'ruler-meta' }, [
      el('span', {}, [
        usage.remaining === null
          ? document.createTextNode('Capacity unknown')
          : el('span', {}, [el('strong', { text: fmtTokens(usage.remaining) }), document.createTextNode(' remaining')]),
      ]),
      el('span', {}, [
        document.createTextNode('Warning '),
        el('strong', { text: threshold + '%' }),
      ]),
    ]);

    const bodyChildren = [heroTop, el('div', {}, [ruler, rulerMeta])];

    const denom = usage.capacity && usage.capacity > 0 ? usage.capacity : usage.used || 1;
    const totalMeasured = usage.input + usage.cacheRead + usage.cacheCreate + usage.output;
    if (totalMeasured > 0) {
      const segs = [
        ['input', 'Fresh', usage.input, '--seg-input'],
        ['cache', 'Cache read', usage.cacheRead, '--seg-cache'],
        ['create', 'Cache write', usage.cacheCreate, '--seg-create'],
        ['output', 'Output', usage.output, '--seg-output'],
      ].filter(function (item) { return item[2] > 0; });

      const promptTotal = usage.input + usage.cacheRead;
      const cacheHitPct = promptTotal > 0 ? Math.round((usage.cacheRead / promptTotal) * 100) : null;
      const compHead = el('div', { className: 'composition__head' }, [
        el('span', { text: 'Token breakdown' }),
        cacheHitPct !== null && usage.cacheRead > 0
          ? el('span', {}, [document.createTextNode('Cache hit '), el('strong', { text: cacheHitPct + '%' })])
          : null,
      ]);

      const compTrack = el('div', { className: 'composition__track', attrs: { 'aria-label': 'Token breakdown bar' } });
      const compLegend = el('div', { className: 'composition__legend' });
      for (const [kind, label, amount, cssVar] of segs) {
        const sharePct = Math.round((amount / totalMeasured) * 100);
        const seg = el('div', {
          className: 'composition__seg composition__seg--' + kind,
          attrs: { title: label + ': ' + fmtExact(amount) + ' tokens (' + sharePct + '%)' },
        });
        seg.style.width = Math.max(0.5, (amount / denom) * 100).toFixed(2) + '%';
        compTrack.appendChild(seg);

        const swatch = el('span', { className: 'composition__swatch' });
        swatch.style.background = 'var(' + cssVar + ')';
        compLegend.appendChild(
          el('span', { className: 'composition__item' }, [
            swatch,
            document.createTextNode(label + ' '),
            el('strong', { text: fmtTokens(amount) }),
            el('span', { className: 'composition__share', text: sharePct + '%' }),
          ]),
        );
      }
      bodyChildren.push(el('div', { className: 'composition' }, [compHead, compTrack, compLegend]));
    }

    const responseModel = conversation.modelName || conversation.modelId || 'Unknown';
    const selectedModel = snapshot.composerModelName || conversation.selectedModelName;
    const attribution = [
      el('span', {}, [document.createTextNode('Model '), el('strong', { text: responseModel })]),
    ];
    if (selectedModel && normalizeModel(selectedModel) !== normalizeModel(responseModel)) {
      attribution.push(el('span', {}, [document.createTextNode('Next '), el('strong', { text: selectedModel })]));
    }
    if (conversation.workspace) {
      attribution.push(el('span', {}, [document.createTextNode('Workspace '), el('strong', { text: conversation.workspace })]));
    }
    bodyChildren.push(el('div', { className: 'hero-foot' }, attribution));

    return [
      cellHead('Context window', conversation.title),
      el('div', { className: 'hero-body' }, bodyChildren),
    ];
  }

  function quotaCellContent(snapshot) {
    const quota = quotaView(snapshot);
    const groups = (quota && quota.groups) || [];
    const activeModel = activeSelectedModel(snapshot);
    const matchedGroup = resolveQuotaGroupLocal(groups, activeModel);

    const list = el('div', { className: 'quota-list' });
    for (const group of groups) {
      const isSelected = matchedGroup && matchedGroup.id === group.id;
      const poolBadges = [];
      if (isSelected) poolBadges.push(el('span', { className: 'badge badge--accent', text: 'Active' }));
      const minLivePct = (group.buckets || []).reduce(function (lowest, bucket) {
        if (!bucketAvailable(bucket, quota.status) || bucket.percent === null) return lowest;
        return lowest === null ? bucket.percent : Math.min(lowest, bucket.percent);
      }, null);
      if (minLivePct !== null && minLivePct <= 10) poolBadges.push(el('span', { className: 'badge badge--danger', text: 'Critical' }));
      else if (minLivePct !== null && minLivePct <= 20) poolBadges.push(el('span', { className: 'badge badge--estimated', text: 'Low' }));

      const windows = el('div', { className: 'quota-windows' });
      for (const window of ['5h', 'weekly']) {
        const bucket = (group.buckets || []).find(function (entry) { return entry.window === window; });
        if (!bucket) continue;
        const available = bucketAvailable(bucket, quota.status);
        const pct = available ? bucket.percent : null;
        const bar = el('div', { className: 'bar' });
        if (pct !== null) {
          const fill = el('div', { className: 'bar__fill', attrs: { 'data-band': bandOf(100 - pct, 80) } });
          fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
          bar.appendChild(fill);
        }
        windows.appendChild(
          el('div', { className: 'quota-bucket' }, [
            el('div', { className: 'quota-row' }, [
              el('span', { className: 'quota-row__label', text: window === '5h' ? '5-hour' : 'Weekly' }),
              el('span', { className: 'quota-row__meta' }, [
                available && bucket.resetsAt ? el('span', { className: 'quota-reset', text: fmtCountdown(bucket.resetsAt) }) : null,
                el('strong', { text: available ? (quota.status === 'cached' ? '~' : '') + fmtPercent(pct) : '—' }),
              ]),
            ]),
            bar,
          ]),
        );
      }

      list.appendChild(
        el('div', { className: 'quota-item', attrs: { 'data-active': isSelected ? 'true' : 'false' } }, [
          el('div', { className: 'quota-item__head' }, [
            el('p', { className: 'quota-item__name', text: group.label, attrs: { title: group.description || '' } }),
            poolBadges.length ? el('div', { className: 'actions-row' }, poolBadges) : null,
          ]),
          windows,
        ]),
      );
    }

    if (!groups.length) {
      list.appendChild(el('div', { className: 'empty' }, [
        el('div', { className: 'empty__body', text: 'Quota buckets appear once a backend connects.' }),
      ]));
    }

    const footText = quota
      ? (quota.status === 'live' ? 'Live · 5s cadence' : quota.status === 'cached' ? 'Cached · retrying' : 'Unavailable · retrying') +
        (quota.observedAt ? ' · checked ' + fmtTime(new Date(quota.observedAt).toISOString()) : '')
      : 'Waiting for quota response';
    list.appendChild(el('div', { className: 'quota-foot', text: footText }));

    return [
      cellHead('Quota pools', activeModel ? 'for ' + activeModel : ''),
      list,
    ];
  }

  function kpiStrip(snapshot, conversation) {
    const usage = conversation.usage;
    const uSummary = snapshot.usage;
    const promptTotal = usage ? usage.input + usage.cacheRead : 0;
    const cacheRatio = promptTotal > 0 ? Math.round((usage.cacheRead / promptTotal) * 100) + '%' : '—';

    const cells = [
      {
        label: 'Output speed',
        value: usage && usage.tokPerSec > 0 ? fmtRate(usage.tokPerSec) : '—',
        sub: usage ? (usage.output ? fmtTokens(usage.output) + ' out tokens' : 'No response yet') : 'Waiting',
      },
      {
        label: 'Cache hit ratio',
        value: cacheRatio,
        sub: usage && usage.cacheRead > 0 ? fmtTokens(usage.cacheRead) + ' cached read' : 'Fresh prompt',
      },
      {
        label: 'Session API equiv.',
        value: conversation.totals.costUsd !== null ? fmtUsd(conversation.totals.costUsd) : '—',
        sub: fmtExact(conversation.totals.calls) + ' model calls',
      },
      {
        label: 'Observed today',
        value: fmtTokens(uSummary.todayTokens),
        sub: fmtTokens(uSummary.monthTokens) + ' this month' + (uSummary.monthCostUsd !== null ? ' · ' + fmtUsd(uSummary.monthCostUsd) : ''),
      },
    ];

    return el('section', { className: 'kpi-strip', attrs: { 'aria-label': 'Key metrics' } }, cells.map(function (c) {
      return el('div', { className: 'kpi-cell' }, [
        el('div', { className: 'kpi-cell__label', text: c.label }),
        el('div', { className: 'kpi-cell__value', text: c.value }),
        el('div', { className: 'kpi-cell__sub', text: c.sub }),
      ]);
    }));
  }

  function appsPanel(snapshot) {
    const instances = snapshot.instances || [];
    const runningSessions = (snapshot.sessions || []).filter(function (s) {
      return s.status === 'running' && (!snapshot.conversation || s.id !== snapshot.conversation.id);
    });
    if (instances.length === 0 && runningSessions.length === 0) return null;

    const list = el('div', { className: 'list' });
    for (const instance of instances) {
      const conv = instance.conversation;
      const percent = conv && conv.usage ? conv.usage.percent : null;
      const running = conv && conv.status === 'running';
      const meta = [conv ? conv.title : instance.viewState === 'new-thread' ? 'New thread' : 'Unidentified thread'];
      if (conv && conv.workspace) meta.push(conv.workspace);
      if (conv) meta.push(fmtExact(conv.stepCount) + ' steps');
      const modelLabel = instance.composerModelName || (conv && conv.modelName);
      if (modelLabel) meta.push(modelLabel);
      if (running) meta.push('Running');

      list.appendChild(
        el('button', {
          className: 'list__row list__row--compact',
          attrs: { type: 'button', 'data-active': instance.backend.active ? 'true' : 'false' },
          on: { click: function () { send({ type: 'selectBackend', id: instance.backend.id }); } },
        }, [
          el('div', {}, [
            el('div', { className: 'list__title' }, [
              el('span', { className: 'dot ' + (running ? 'dot--running' : 'dot--live') }),
              el('span', { className: 'list__title-text', text: backendLabel(instance.backend.app) }),
            ]),
            el('div', { className: 'list__meta' }, [el('span', { text: meta.join(' · ') })]),
          ]),
          el('div', { className: 'list__value', text: percent === null ? '—' : fmtPercent(percent) }),
        ]),
      );
    }

    for (const session of runningSessions) {
      const meta = ['Running'];
      if (session.isSubagent) meta.push('Subagent');
      if (session.modelName) meta.push(session.modelName);
      meta.push(fmtExact(session.stepCount) + ' steps');

      list.appendChild(
        el('button', {
          className: 'list__row list__row--compact',
          attrs: { type: 'button', 'data-active': 'false', 'data-subagent': session.isSubagent ? 'true' : 'false' },
          on: { click: function () { send({ type: 'selectSession', id: session.id }); } },
        }, [
          el('div', {}, [
            el('div', { className: 'list__title' }, [
              el('span', { className: 'dot dot--running' }),
              el('span', { className: 'list__title-text', text: session.title }),
            ]),
            el('div', { className: 'list__meta' }, [el('span', { text: meta.join(' · ') })]),
          ]),
          el('div', { className: 'list__value', text: session.percent === null ? '—' : fmtPercent(session.percent) }),
        ]),
      );
    }

    return el('section', { className: 'panel' }, [
      cellHead('Active apps & running threads', 'Click row to focus'),
      list,
    ]);
  }

  function accountFacts(snapshot) {
    const account = snapshot.account;
    if (!account) return [];
    const masked = snapshot.prefs.maskPersonalInfo;
    const rows = [];
    if (account.planName) rows.push(fact('Plan', account.planName));
    if (account.tierName) rows.push(fact('Tier', account.tierName));
    if (account.monthlyPromptCredits !== null) rows.push(fact('Prompt credits', fmtExact(account.monthlyPromptCredits)));
    if (account.monthlyFlowCredits !== null) rows.push(fact('Flow credits', fmtExact(account.monthlyFlowCredits)));
    if (account.name) rows.push(fact('Account', masked ? maskValue(account.name) : account.name));
    if (account.email) rows.push(fact('E-mail', masked ? maskValue(account.email) : account.email));
    return rows;
  }

  function accountLedgerPanel(snapshot) {
    const rows = accountFacts(snapshot);
    if (!rows.length) return null;
    return el('section', { className: 'panel' }, [
      cellHead('Account', snapshot.prefs.maskPersonalInfo ? 'masked' : ''),
      el('div', { className: 'ledger' }, rows),
    ]);
  }

  function ledgerContent(snapshot, conversation) {
    const usage = conversation.usage;
    const facts = [
      fact('Response model', conversation.modelName || conversation.modelId || 'Unknown'),
    ];
    if (snapshot.composerModelName || conversation.selectedModelName) {
      facts.push(fact('Selected model', snapshot.composerModelName || conversation.selectedModelName));
    }
    facts.push(fact('Fresh input', usage ? fmtExact(usage.input) : '—'));
    facts.push(fact('Cache read', usage ? fmtExact(usage.cacheRead) : '—'));
    if (usage && usage.cacheCreate > 0) facts.push(fact('Cache write', fmtExact(usage.cacheCreate)));
    facts.push(fact('Output', usage ? fmtExact(usage.output) : '—'));
    facts.push(fact('Output speed', usage && usage.tokPerSec > 0 ? fmtRate(usage.tokPerSec) : '—'));
    facts.push(fact('Capacity', usage && usage.capacity !== null ? fmtExact(usage.capacity) : 'Unknown'));
    facts.push(fact('Last activity', fmtAge(conversation.lastModified)));
    facts.push(fact('Backend', snapshot.backend ? backendLabel(snapshot.backend.app) + ' · :' + snapshot.backend.port : '—'));
    if (conversation.imageSteps > 0) facts.push(fact('Image steps', String(conversation.imageSteps)));

    for (const row of accountFacts(snapshot)) facts.push(row);

    return el('div', { className: 'ledger' }, facts);
  }

  function fact(label, value) {
    return el('div', { className: 'fact' }, [
      el('div', { className: 'fact__label', text: label }),
      el('div', { className: 'fact__value', text: value }),
    ]);
  }

  function analyticsContent(snapshot, conversation) {
    const usage = snapshot.usage;
    const days = usage.days || [];
    const max = days.reduce(function (peak, day) { return Math.max(peak, day.tokens); }, 0);
    const todayKey = days.length > 0 ? days[days.length - 1].day : null;

    const plot = el('div', { className: 'usage-plot' }, [el('div', { className: 'usage-plot__mid' })]);
    for (const day of days) {
      const ratio = max > 0 ? day.tokens / max : 0;
      const tip = day.day + ': ' + fmtExact(day.tokens) + ' tokens' + (day.costUsd ? ' · ' + fmtUsd(day.costUsd) : '');
      const bar = el('div', { className: 'usage-day__bar', attrs: { title: tip } });
      bar.style.height = Math.max(2, Math.round(ratio * 102)) + 'px';
      plot.appendChild(
        el('div', { className: 'usage-day' + (day.day === todayKey ? ' usage-day--today' : ''), attrs: { title: tip } }, [bar]),
      );
    }

    const scale = el('div', { className: 'usage-scale' }, [
      el('span', { text: max > 0 ? fmtTokens(max) : '0' }),
      el('span', { text: max > 0 ? fmtTokens(max / 2) : '' }),
      el('span', { text: '0' }),
    ]);

    const firstDay = days.length > 0 ? days[0].day.slice(5) : '';
    const midDay = days.length > 2 ? days[Math.floor(days.length / 2)].day.slice(5) : '';
    const lastDay = days.length > 1 ? days[days.length - 1].day.slice(5) : '';
    const axis = el('div', { className: 'usage-axis' }, [
      el('span', { text: firstDay }),
      el('span', { text: midDay }),
      el('span', { text: lastDay }),
    ]);

    const body = [
      el('div', { className: 'usage-wrap' }, [scale, plot, axis]),
      el('div', { className: 'usage-legend' }, [
        el('div', { className: 'usage-legend__item' }, [document.createTextNode('Today '), el('strong', { text: fmtTokens(usage.todayTokens) })]),
        el('div', { className: 'usage-legend__item' }, [document.createTextNode('Month '), el('strong', { text: fmtTokens(usage.monthTokens) })]),
        usage.monthCostUsd !== null
          ? el('div', { className: 'usage-legend__item' }, [document.createTextNode('API equiv. '), el('strong', { text: fmtUsd(usage.monthCostUsd) })])
          : null,
      ]),
    ];

    const history = state.history.get(conversation.id) || [];
    if (history.length >= 2) {
      body.push(
        el('div', { className: 'sparkline-box' }, [
          el('div', { className: 'sparkline-head' }, [
            el('span', { text: 'Session context trend' }),
            el('strong', { text: fmtTokens(history[0]) + ' → ' + fmtTokens(history[history.length - 1]) + ' (' + history.length + ' pts)' }),
          ]),
          sparkline(history),
        ]),
      );
    }

    body.push(el('p', { className: 'figure-note', text: 'Local model observations only; API-equivalent rates are estimates, not billing.' }));

    return [
      cellHead('Daily usage', usage.priced ? '14 days' : usage.monthTokens > 0 ? 'unpriced model' : '14 days'),
      el('div', { className: 'analytics-body' }, body),
    ];
  }

  function sparkline(values) {
    const width = 100;
    const height = 36;
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const span = max - min || 1;

    const points = values.map(function (value, index) {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * (height - 4) - 2;
      return x.toFixed(2) + ',' + y.toFixed(2);
    });

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'sparkline');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Context trend from ' + fmtTokens(values[0]) + ' to ' + fmtTokens(values[values.length - 1]));

    const area = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    area.setAttribute('class', 'sparkline__area');
    area.setAttribute('points', '0,' + height + ' ' + points.join(' ') + ' ' + width + ',' + height);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('class', 'sparkline__line');
    line.setAttribute('points', points.join(' '));

    svg.appendChild(area);
    svg.appendChild(line);
    return svg;
  }

  function maskValue(value) {
    if (value.length <= 4) return '••••';
    return value.slice(0, 1) + '•••••' + value.slice(-1);
  }

  // --------------------------------------------------------------- sessions

  function orderSessionsHierarchically(sessions) {
    if (state.threadFilter !== 'all' || state.threadQuery) return sessions;
    const byId = new Set(sessions.map(function (s) { return s.id; }));
    const childrenByRoot = new Map();
    const roots = [];
    for (const session of sessions) {
      if (session.isSubagent && session.rootId && byId.has(session.rootId)) {
        const list = childrenByRoot.get(session.rootId) || [];
        list.push(session);
        childrenByRoot.set(session.rootId, list);
      } else {
        roots.push(session);
      }
    }
    const ordered = [];
    for (const root of roots) {
      ordered.push(root);
      const children = childrenByRoot.get(root.id);
      if (children) {
        for (const child of children) ordered.push(child);
      }
    }
    return ordered;
  }

  function renderSessions(pane, snapshot) {
    const all = snapshot.sessions || [];
    if (all.length === 0) {
      renderEmptyPane(pane, 'No threads yet', 'Start a conversation in Antigravity and it will appear here.');
      return;
    }

    const runningCount = all.filter(function (s) { return s.status === 'running'; }).length;
    const query = state.threadQuery.trim().toLowerCase();
    const filtered = orderSessionsHierarchically(all.filter(function (s) {
      if (state.threadFilter === 'running' && s.status !== 'running') return false;
      if (state.threadFilter === 'top' && s.isSubagent) return false;
      if (!query) return true;
      const haystack = [s.title, s.modelName, s.workspace, s.isSubagent ? 'subagent' : ''].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(query);
    }));

    const filterGroup = el('div', { className: 'segmented', attrs: { role: 'group', 'aria-label': 'Thread filter' } }, [
      filterBtn('all', 'All (' + all.length + ')'),
      filterBtn('running', 'Running (' + runningCount + ')'),
      filterBtn('top', 'Top-level'),
    ]);

    const rightToolbar = [];
    if (all.length > 3 || state.threadQuery) {
      const search = el('input', {
        className: 'search-input',
        attrs: {
          id: 'threads-search',
          type: 'search',
          placeholder: 'Filter by title, model, or workspace…',
          'aria-label': 'Filter threads',
          value: state.threadQuery,
        },
        on: {
          input: function (event) {
            state.threadQuery = event.target.value;
            state.rendered.delete('sessions');
            renderActivePane();
          },
        },
      });
      search.value = state.threadQuery;
      rightToolbar.push(search);
    }
    if (snapshot.pinnedConversationId) {
      rightToolbar.push(
        el('button', {
          className: 'btn btn--small',
          attrs: { type: 'button' },
          text: 'Follow active thread',
          on: { click: function () { send({ type: 'selectSession', id: null }); } },
        }),
      );
    }

    pane.appendChild(el('div', { className: 'toolbar' }, [
      filterGroup,
      rightToolbar.length ? el('div', { className: 'toolbar__right' }, rightToolbar) : null,
    ]));

    const list = el('div', { className: 'list' });
    for (const session of filtered) {
      const row = el('button', {
        className: 'list__row',
        attrs: {
          type: 'button',
          'data-active': session.active ? 'true' : 'false',
          'data-subagent': session.isSubagent ? 'true' : 'false',
        },
        on: { click: function () { send({ type: 'selectSession', id: session.id }); } },
      });

      const titleChildren = [
        el('span', { className: 'dot ' + (session.status === 'running' ? 'dot--running' : 'dot--idle') }),
        el('span', { className: 'list__title-text', text: session.title, attrs: { title: session.title } }),
      ];
      if (session.active && !session.pinned) titleChildren.push(el('span', { className: 'badge badge--measured', text: 'Following' }));
      if (session.isSubagent) titleChildren.push(el('span', { className: 'badge', text: 'Subagent' }));
      if (session.pinned) titleChildren.push(el('span', { className: 'badge badge--accent', text: 'Pinned' }));

      const metaItems = [
        el('span', { text: session.status === 'running' ? 'Running' : 'Idle' }),
        el('span', { text: fmtExact(session.stepCount) + ' steps' }),
        el('span', { text: session.modelName || 'Model pending' }),
      ];
      if (session.workspace) metaItems.push(el('span', { text: session.workspace }));
      metaItems.push(el('span', { text: fmtAge(session.lastUserViewTime || session.lastModified) }));

      const left = el('div', {}, [
        el('div', { className: 'list__title' }, titleChildren),
        el('div', { className: 'list__meta' }, metaItems),
      ]);

      const rightChildren = [
        el('div', { className: 'list__value', text: session.percent === null ? '—' : fmtPercent(session.percent) }),
      ];
      if (session.percent !== null) {
        const bar = el('div', { className: 'bar' });
        const fill = el('div', { className: 'bar__fill', attrs: { 'data-band': bandOf(session.percent, snapshot.prefs.warningThreshold) } });
        fill.style.width = Math.min(100, Math.max(0, session.percent)) + '%';
        bar.appendChild(fill);
        rightChildren.push(bar);
      }

      row.appendChild(left);
      row.appendChild(el('div', { className: 'list__right' }, rightChildren));
      list.appendChild(row);
    }

    if (filtered.length === 0) {
      list.appendChild(el('div', { className: 'empty' }, [
        el('div', { className: 'empty__title', text: 'No matching threads' }),
        el('div', { className: 'empty__body', text: 'Clear the filter or switch tab filter to view all threads.' }),
      ]));
    }

    pane.appendChild(
      el('section', { className: 'panel' }, [
        cellHead('Conversations', filtered.length + ' shown'),
        list,
      ]),
    );
  }

  function filterBtn(id, label) {
    return el('button', {
      className: 'segmented__btn',
      text: label,
      attrs: { type: 'button', 'aria-pressed': state.threadFilter === id ? 'true' : 'false' },
      on: {
        click: function () {
          state.threadFilter = id;
          state.rendered.delete('sessions');
          renderActivePane();
        },
      },
    });
  }

  // ----------------------------------------------------------------- models

  function renderModels(pane, snapshot) {
    const models = snapshot.models || [];
    if (models.length === 0) {
      renderEmptyPane(pane, 'No models reported', 'Antigravity has not returned a model catalogue for this account yet.');
      return;
    }

    const quota = quotaView(snapshot);
    const groups = (quota && quota.groups) || [];
    const byPool = new Map();

    for (const model of models) {
      const matched = resolveQuotaGroupLocal(groups, model.label, { resetsAt: model.resetsAt, percent: model.quotaPercent });
      const poolName = model.quotaGroup || (matched ? matched.label : 'Other models');
      const list = byPool.get(poolName) || [];
      list.push(model);
      byPool.set(poolName, list);
    }

    for (const [poolName, poolModels] of byPool.entries()) {
      const groupObj = groups.find(function (g) { return g.label === poolName; });
      const limits = [];
      if (groupObj && quota) {
        for (const win of ['5h', 'weekly']) {
          const bucket = (groupObj.buckets || []).find(function (b) { return b.window === win; });
          if (!bucket) continue;
          const ok = bucketAvailable(bucket, quota.status);
          const bar = el('div', { className: 'bar' });
          if (ok) {
            const fill = el('div', { className: 'bar__fill', attrs: { 'data-band': bandOf(100 - bucket.percent, 80) } });
            fill.style.width = Math.min(100, Math.max(0, bucket.percent)) + '%';
            bar.appendChild(fill);
          }
          limits.push(
            el('div', { className: 'pool-limit' }, [
              el('span', { className: 'panel__hint', text: win === '5h' ? '5h' : 'Weekly' }),
              bar,
              el('strong', { text: ok ? fmtWhole(bucket.percent) : '—' }),
              ok && bucket.resetsAt ? el('span', { className: 'panel__hint', text: fmtCountdown(bucket.resetsAt) }) : null,
            ]),
          );
        }
      }

      const grid = el('div', { className: 'models-grid' });
      const activePool = poolModels.some(function (m) { return m.active; });
      for (const model of poolModels) {
        const badges = [];
        if (model.active) badges.push(el('span', { className: 'badge badge--accent', text: 'In use' }));
        else if (model.tag) badges.push(el('span', { className: 'badge', text: model.tag }));

        const head = el('div', { className: 'model-cell__head' }, [
          el('div', { className: 'model-cell__name', text: model.label }),
          badges.length ? el('div', { className: 'actions-row' }, badges) : null,
        ]);

        const meta = el('div', { className: 'model-cell__meta' }, [
          el('span', {}, [document.createTextNode('Context '), el('strong', { text: model.contextLimit === null ? '—' : fmtTokens(model.contextLimit) })]),
          el('span', {}, [document.createTextNode('Max out '), el('strong', { text: model.maxOutput === null ? '—' : fmtTokens(model.maxOutput) })]),
        ]);

        const children = [head, meta];
        if (model.quotaPercent !== null && !groupObj) {
          const bar = el('div', { className: 'bar' });
          const fill = el('div', { className: 'bar__fill', attrs: { 'data-band': bandOf(100 - model.quotaPercent, 80) } });
          fill.style.width = Math.min(100, Math.max(0, model.quotaPercent)) + '%';
          bar.appendChild(fill);
          children.push(el('div', { className: 'bar-row' }, [bar, el('span', { className: 'bar-row__value', text: fmtWhole(model.quotaPercent) })]));
        }

        grid.appendChild(el('div', { className: 'model-cell', attrs: { 'data-active': model.active ? 'true' : 'false' } }, children));
      }

      pane.appendChild(
        el('section', { className: 'panel' }, [
          el('div', { className: 'pool-head-bar' }, [
            el('div', {}, [
              el('div', { className: 'actions-row' }, [
                el('h2', { className: 'panel__title', text: poolName }),
                activePool ? el('span', { className: 'badge badge--accent', text: 'Active pool' }) : null,
              ]),
              groupObj && groupObj.description ? el('p', { className: 'figure-note', text: groupObj.description }) : null,
            ]),
            limits.length ? el('div', { className: 'pool-limits' }, limits) : null,
          ]),
          grid,
        ]),
      );
    }
  }

  // --------------------------------------------------------------- settings

  const SETTING_SPECS = [
    { key: 'pollIntervalMs', label: 'Refresh interval', description: 'Check cadence in milliseconds.', type: 'number', min: 1000, max: 60000, step: 500, suffix: 'ms' },
    { key: 'warningThreshold', label: 'Warning threshold', description: 'Context percentage threshold.', type: 'range', min: 50, max: 100, step: 5, suffix: '%' },
    { key: 'maxPayloadMb', label: 'Maximum response size', description: 'Larger conversations become unmeasurable.', type: 'number', min: 16, max: 1024, step: 16, suffix: 'MB' },
    {
      key: 'displayMode', label: 'Display detail', description: 'Status bar and inline pill mode.', type: 'select',
      options: [{ value: 'essentials', label: 'Essentials' }, { value: 'full', label: 'Full' }, { value: 'custom', label: 'Custom snippet' }],
    },
    { key: 'showQuota', label: 'Show quota in status bar', description: 'Display remaining quota next to context.', type: 'toggle' },
    { key: 'maskPersonalInfo', label: 'Mask personal information', description: 'Hide account name and e-mail.', type: 'toggle' },
  ];

  const SNIPPET_FIELDS = [
    ['snippetContext', 'Context used', true],
    ['snippetRemaining', 'Context remaining', true],
    ['snippetFiveHour', '5-hour quota', false],
    ['snippetWeekly', 'Weekly quota', false],
    ['snippetModel', 'Model name', false],
    ['snippetResets', 'Reset countdowns', false],
    ['snippetTokPerSec', 'Output tok/s', false],
  ];

  function buildSnippetPreview(prefs) {
    const mode = prefs.displayMode || 'full';
    const parts = [];
    if (mode === 'essentials') {
      parts.push('22.3%');
    } else if (mode === 'full') {
      parts.push('22.3%', '814.4k left');
    } else {
      if (prefs.snippetContext) parts.push('22.3%');
      if (prefs.snippetRemaining) parts.push('814.4k left');
      if (prefs.snippetFiveHour) parts.push('5h 94%' + (prefs.snippetResets ? ' (4h 04m)' : ''));
      if (prefs.snippetWeekly) parts.push('Week 50%' + (prefs.snippetResets ? ' (5d 18h)' : ''));
      if (prefs.snippetModel) parts.push('Gemini 4 Hydrogen High');
      if (prefs.snippetTokPerSec) parts.push('214 tok/s');
    }
    return parts.length ? parts.join(' · ') : 'Monitor';
  }

  function renderSettings(pane, snapshot) {
    const settings = el('div', { className: 'settings-grid' });

    for (const spec of SETTING_SPECS) {
      const control = el('div', { className: 'setting__control' });
      const value = snapshot.prefs[spec.key];

      if (spec.type === 'toggle') {
        const input = el('input', {
          attrs: { type: 'checkbox', id: 'setting-' + spec.key },
          on: { change: function () { send({ type: 'updateSetting', key: spec.key, value: input.checked }); } },
        });
        input.checked = Boolean(value);
        control.appendChild(
          el('label', { className: 'setting__toggle', attrs: { for: 'setting-' + spec.key } }, [
            input,
            el('span', { text: input.checked ? 'Enabled' : 'Disabled' }),
          ]),
        );
      } else if (spec.type === 'select') {
        const select = el('select', {
          attrs: { 'aria-label': spec.label },
          on: { change: function () { send({ type: 'updateSetting', key: spec.key, value: select.value }); } },
        });
        for (const option of spec.options) {
          const node = el('option', { text: option.label, attrs: { value: option.value } });
          node.selected = option.value === value;
          select.appendChild(node);
        }
        control.appendChild(select);
      } else if (spec.type === 'range') {
        const output = el('span', { className: 'setting__range-value', text: String(value) + (spec.suffix || '') });
        const input = el('input', {
          attrs: { type: 'range', min: String(spec.min), max: String(spec.max), step: String(spec.step), 'aria-label': spec.label },
          on: {
            input: function () { output.textContent = String(input.value) + (spec.suffix || ''); },
            change: function () { send({ type: 'updateSetting', key: spec.key, value: Number(input.value) }); },
          },
        });
        input.value = String(value);
        control.appendChild(input);
        control.appendChild(output);
      } else {
        const input = el('input', {
          attrs: { type: 'number', min: String(spec.min), max: String(spec.max), step: String(spec.step), 'aria-label': spec.label },
          on: {
            change: function () {
              const parsed = Number(input.value);
              if (isFinite(parsed)) send({ type: 'updateSetting', key: spec.key, value: parsed });
            },
          },
        });
        input.value = String(value);
        control.appendChild(input);
        control.appendChild(el('span', { className: 'setting__range-value', text: spec.suffix || '' }));
      }

      settings.appendChild(
        el('div', { className: 'setting' }, [
          el('div', {}, [
            el('label', { className: 'setting__label', text: spec.label, attrs: { for: 'setting-' + spec.key } }),
            el('div', { className: 'setting__description', text: spec.description }),
          ]),
          control,
        ]),
      );
      const field = control.querySelector('input,select');
      if (field && !field.id) field.id = 'setting-' + spec.key;
    }

    pane.appendChild(el('section', { className: 'panel' }, [cellHead('Preferences'), settings]));

    const preview = el('div', { className: 'snippet-preview' }, [
      el('span', { className: 'dot dot--live' }),
      el('span', { text: buildSnippetPreview(snapshot.prefs) }),
    ]);

    const snippets = el('div', { className: 'snippet-options' });
    for (const [key, label, fallback] of SNIPPET_FIELDS) {
      const input = el('input', {
        attrs: { type: 'checkbox', id: 'setting-' + key },
        on: {
          change: function () {
            const values = Object.fromEntries(SNIPPET_FIELDS.map(function (entry) {
              return [entry[0], typeof snapshot.prefs[entry[0]] === 'boolean' ? snapshot.prefs[entry[0]] : entry[2]];
            }));
            values[key] = input.checked;
            for (const [name, val] of Object.entries(values)) send({ type: 'updateSetting', key: name, value: val });
            send({ type: 'updateSetting', key: 'displayMode', value: 'custom' });
          },
        },
      });
      input.checked = typeof snapshot.prefs[key] === 'boolean' ? snapshot.prefs[key] : fallback;
      snippets.appendChild(el('label', { className: 'snippet-option', attrs: { for: 'setting-' + key } }, [input, el('span', { text: label })]));
    }

    pane.appendChild(
      el('section', { className: 'panel' }, [
        cellHead(document.body.dataset.host === 'editor' ? 'Status bar fields' : 'Inline snippet fields', 'Checking a box switches to Custom mode'),
        el('div', { className: 'panel__body' }, [preview, snippets]),
      ]),
    );

    const backendList = el('div', { className: 'list' });
    for (const backend of snapshot.backends) {
      const instance = (snapshot.instances || []).find(function (entry) { return entry.backend.id === backend.id; });
      const conv = instance ? instance.conversation : null;
      backendList.appendChild(
        el('button', {
          className: 'list__row list__row--compact',
          attrs: { type: 'button', 'data-active': backend.active ? 'true' : 'false' },
          on: { click: function () { send({ type: 'selectBackend', id: backend.id }); } },
        }, [
          el('div', {}, [
            el('div', { className: 'list__title' }, [
              el('span', { className: 'dot ' + (backend.reachable ? 'dot--live' : 'dot--idle') }),
              el('span', { className: 'list__title-text', text: backendLabel(backend.app) + ' · ' + backend.scheme + '://127.0.0.1:' + backend.port }),
            ]),
            el('div', { className: 'list__meta' }, [
              el('span', { text: backend.reachable ? 'Reachable' : 'Unreachable' }),
              el('span', { text: backend.conversations + ' threads' }),
              backend.running > 0 ? el('span', { text: backend.running + ' running' }) : null,
              backend.pid ? el('span', { text: 'pid ' + backend.pid }) : null,
              conv ? el('span', { text: conv.title }) : null,
            ]),
          ]),
          el('div', { className: 'list__value', text: backend.active ? 'Following' : '' }),
        ]),
      );
    }

    if (snapshot.backends.length === 0) {
      backendList.appendChild(el('div', { className: 'empty' }, [
        el('div', { className: 'empty__title', text: 'No active backends' }),
        el('div', { className: 'empty__body', text: 'Open Antigravity, Antigravity IDE, or VS Code to connect.' }),
      ]));
    }

    pane.appendChild(
      el('section', { className: 'panel' }, [
        cellHead('Connected backends', 'Multiple hosts supported'),
        backendList,
      ]),
    );

    const actions = el('div', { className: 'panel__body actions-row' }, [
      el('button', { className: 'btn', attrs: { type: 'button' }, text: 'Refresh now', on: { click: triggerRefresh } }),
      el('button', {
        className: 'btn',
        attrs: { type: 'button' },
        text: state.showDiagnostics ? 'Hide diagnostics' : 'Show diagnostics',
        on: {
          click: function () {
            state.showDiagnostics = !state.showDiagnostics;
            state.rendered.delete('settings');
            if (state.showDiagnostics) send({ type: 'diagnostics' });
            renderActivePane();
          },
        },
      }),
    ]);

    const diagNodes = [cellHead('Actions & diagnostics'), actions];
    if (state.showDiagnostics) {
      diagNodes.push(
        el('div', { className: 'ledger' }, [
          fact('Status', snapshot.status),
          fact('Snapshot time', new Date(snapshot.generatedAt).toLocaleString()),
          fact('Reachable apps', String((snapshot.backends || []).filter(function (b) { return b.reachable; }).length)),
          fact('Quota source', snapshot.quota ? 'Local backend · ' + snapshot.quota.status : 'Waiting'),
        ]),
        el('div', { className: 'panel__body' }, [
          el('p', { className: 'figure-note', text: snapshot.lastError || 'No error reported in this snapshot.' }),
        ].concat((snapshot.discoveryNotes || []).map(function (note) { return el('p', { className: 'figure-note', text: note }); }))),
      );
    }
    pane.appendChild(el('section', { className: 'panel' }, diagNodes));
  }

  // -------------------------------------------------------------------- boot

  selectTab(state.tab);
  renderEmptyPane(panes[state.tab], 'Waiting for the first reading', 'Antigravity Monitor is connecting to the local language server.');
  send({ type: 'ready' });
})();
