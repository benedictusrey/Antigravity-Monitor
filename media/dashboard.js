/*
 * Antigravity Monitor — dashboard behaviour.
 *
 * Plain JavaScript, no framework, no build step. The host posts a whole
 * immutable snapshot; this file renders it. Every value is inserted with
 * `textContent` (never string-interpolated into markup), so a conversation title
 * containing angle brackets is displayed rather than executed.
 *
 * Number formatting intentionally mirrors src/core/format.ts. The rules are
 * small and stable, and duplicating them keeps the webview free of a bundler.
 */

(function () {
  'use strict';

  const vscode = acquireVsCodeApi();

  const TABS = ['overview', 'sessions', 'models', 'settings'];
  const HISTORY_LIMIT = 60;

  /** @type {{snapshot: any, tab: string, history: Map<string, number[]>, rendered: Map<string,string>, showDiagnostics: boolean}} */
  const state = {
    snapshot: null,
    tab: 'overview',
    history: new Map(),
    rendered: new Map(),
    showDiagnostics: false,
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
      // Accept a single node as well as an array: a missing pair of brackets
      // should not blank the whole pane.
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

  /** Name the installation: desktop app, IDE, or VS Code. */
  function backendLabel(app) {
    if (app === 'app') return 'Antigravity';
    if (app === 'ide') return 'Antigravity IDE';
    if (app === 'vscode') return 'VS Code';
    return 'Unknown app';
  }

  // ------------------------------------------------------------------ chrome

  const subtitleNode = document.getElementById('subtitle');
  const statusChip = document.getElementById('status-chip');
  const refreshButton = document.getElementById('btn-refresh');
  const footerNote = document.getElementById('footer-note');
  const panes = {
    overview: document.getElementById('pane-overview'),
    sessions: document.getElementById('pane-sessions'),
    models: document.getElementById('pane-models'),
    settings: document.getElementById('pane-settings'),
  };

  refreshButton.addEventListener('click', function () {
    send({ type: 'refresh' });
  });

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

  function chipFor(status) {
    switch (status) {
      case 'ok':
        return { label: 'Live', className: 'chip chip--ok' };
      case 'no-conversation':
        return { label: 'No conversation', className: 'chip chip--neutral' };
      case 'connecting':
        return { label: 'Connecting', className: 'chip chip--neutral' };
      case 'disconnected':
        return { label: 'Disconnected', className: 'chip chip--warn' };
      case 'error':
        return { label: 'Error', className: 'chip chip--danger' };
      default:
        return { label: 'Starting', className: 'chip chip--neutral' };
    }
  }

  function renderChrome(snapshot) {
    const chip = chipFor(snapshot.status);
    statusChip.textContent = chip.label;
    statusChip.className = chip.className;

    if (snapshot.status === 'ok' && snapshot.conversation) {
      const app = snapshot.backend ? backendLabel(snapshot.backend.app) : '';
      subtitleNode.textContent = app ? app + ' \u00b7 ' + snapshot.conversation.title : snapshot.conversation.title;
      subtitleNode.title = subtitleNode.textContent;
    } else if (snapshot.lastError) {
      subtitleNode.textContent = snapshot.lastError;
    } else if (snapshot.status === 'no-conversation') {
      subtitleNode.textContent =
        'Connected. No conversation is open in ' +
        (snapshot.backend ? backendLabel(snapshot.backend.app) : 'Antigravity') +
        '.';
    } else if (snapshot.status === 'disconnected') {
      subtitleNode.textContent = 'No Antigravity language server was found.';
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

  function quotaView(snapshot) {
    const value = snapshot.quota;
    if (!value) return null;
    const age = value.observedAt === null ? Infinity : Date.now() - value.observedAt;
    const status = age < 0 || age > 30000 ? 'unavailable' : value.error || value.status === 'cached' || age > 12000 ? 'cached' : 'live';
    return Object.assign({}, value, { status });
  }

  function modelQuotaBucket(snapshot, modelName, window) {
    const quota = quotaView(snapshot);
    if (!quota || quota.status === 'unavailable') return null;
    const family = /gemini/i.test(modelName || '') ? /gemini/i : /claude|gpt/i.test(modelName || '') ? /claude|gpt/i : null;
    const groups = family ? quota.groups.filter(function (group) { return family.test(group.label); }) : [];
    if (groups.length !== 1) return null;
    const bucket = groups[0].buckets.find(function (entry) { return entry.window === window; });
    return bucket && bucket.enabled && bucket.percent !== null && (!bucket.resetsAt || Date.parse(bucket.resetsAt) > Date.now()) ? bucket : null;
  }

  setInterval(function () {
    if (state.snapshot && !document.hidden && (state.tab === 'overview' || state.tab === 'models')) renderActivePane();
  }, 1000);

  window.addEventListener('message', function (event) {
    const message = event.data;
    if (!message || message.type !== 'snapshot') return;
    state.snapshot = message.snapshot;
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

    // Each tab recomputes only from the data it actually shows. In particular the
    // Settings tab ignores live usage: rebuilding its inputs on every poll would
    // steal focus from someone mid-edit.
    const signature = JSON.stringify([state.tab, snapshot.prefs, paneSignature(state.tab, snapshot)]);
    if (state.rendered.get(state.tab) === signature) {
      return;
    }
    state.rendered.set(state.tab, signature);

    const focusedId = pane.contains(document.activeElement) ? document.activeElement.id : null;
    clear(pane);
    if (state.tab === 'overview') renderOverview(pane, snapshot);
    else if (state.tab === 'sessions') renderSessions(pane, snapshot);
    else if (state.tab === 'models') renderModels(pane, snapshot);
    else renderSettings(pane, snapshot);
    if (focusedId) {
      const focused = document.getElementById(focusedId);
      if (focused && pane.contains(focused)) focused.focus({ preventScroll: true });
    }
  }

  function paneSignature(tab, snapshot) {
    if (tab === 'settings') {
      return [
        snapshot.backends.map(function (b) {
          return [b.id, b.active, b.reachable, b.conversations, b.running];
        }),
        (snapshot.instances || []).map(function (instance) {
          return [
            instance.backend.id,
            instance.conversation ? instance.conversation.id : null,
            instance.conversation && instance.conversation.usage ? instance.conversation.usage.percent : null,
          ];
        }),
      ];
    }
    if (tab === 'sessions') {
      return snapshot.sessions.map(function (s) {
        return [s.id, s.stepCount, s.percent, s.active, s.status];
      });
    }
    if (tab === 'models') {
      return [
        quotaView(snapshot), Math.floor(Date.now() / 60000),
        snapshot.models.map(function (m) {
          return [m.modelId, m.quotaPercent, m.active, m.resetsAt];
        }),
      ];
    }
    return [
      snapshot.status,
      quotaView(snapshot), Math.floor(Date.now() / 60000),
      snapshot.lastError,
      snapshot.stale,
      snapshot.conversation ? snapshot.conversation.id : null,
      snapshot.conversation ? snapshot.conversation.stepCount : null,
      snapshot.conversation ? snapshot.conversation.compressed : null,
      snapshot.conversation && snapshot.conversation.usage ? snapshot.conversation.usage.used : null,
      snapshot.conversation && snapshot.conversation.usage ? snapshot.conversation.usage.source : null,
      (snapshot.instances || []).map(function (instance) {
        return [
          instance.backend.id,
          instance.status,
          instance.viewState,
          instance.conversation ? instance.conversation.id : null,
          instance.conversation ? instance.conversation.stepCount : null,
          instance.conversation && instance.conversation.usage ? instance.conversation.usage.percent : null,
        ];
      }),
      snapshot.account,
      snapshot.usage.todayTokens,
      snapshot.usage.monthTokens,
    ];
  }

  function renderEmptyPane(pane, title, body) {
    clear(pane);
    pane.appendChild(
      el('div', { className: 'empty' }, [
        el('div', { className: 'empty__title', text: title }),
        el('div', { className: 'empty__body', text: body }),
      ]),
    );
  }

  // --------------------------------------------------------------- overview

  function renderOverview(pane, snapshot) {
    const conversation = snapshot.conversation;

    if (snapshot.lastError) {
      pane.appendChild(
        el('div', { className: 'notice notice--error', text: snapshot.lastError }),
      );
    }

    const apps = appsCard(snapshot);

    if (!conversation) {
      const lead = el('div', { className: 'overview-lead overview-lead--empty' });
      lead.appendChild(
        card('Context window', [
          el('div', { className: 'empty' }, [
            el('div', { className: 'empty__title', text: (snapshot.instances || []).some(function (instance) {
              return instance.backend.active && instance.viewState === 'new-thread';
            }) ? 'New thread' : 'Waiting for a conversation' }),
            el('div', {
              className: 'empty__body',
              text:
                snapshot.status === 'disconnected'
                  ? 'Start Antigravity with a workspace open. The monitor will connect automatically.'
                  : 'Start a thread or open a conversation. Context appears after a measured response.',
            }),
          ]),
        ]),
      );
      lead.appendChild(weeklyQuotaCard(snapshot));
      pane.appendChild(lead);
      if (apps) pane.appendChild(apps);
      renderAccountCard(pane, snapshot);
      return;
    }

    pane.appendChild(el('div', { className: 'overview-lead' }, [
      contextCard(snapshot, conversation), weeklyQuotaCard(snapshot),
    ]));
    if (apps) pane.appendChild(apps);
    const details = el('div', { className: 'overview-column' }, [detailsCard(snapshot, conversation)]);
    renderAccountCard(details, snapshot);
    const charts = el('div', { className: 'overview-column' }, [growthCard(snapshot, conversation), usageCard(snapshot)]);
    pane.appendChild(el('div', { className: 'overview-columns' }, [details, charts]));
  }

  function weeklyQuotaCard(snapshot) {
    const quota = quotaView(snapshot);
    const groups = quota && quota.groups || [];
    const model = snapshot.conversation && snapshot.conversation.modelName || '';
    const family = /gemini/i.test(model) ? /gemini/i : /claude|gpt/i.test(model) ? /claude|gpt/i : null;
    const selected = family ? groups.filter(function (group) { return family.test(group.label); }) : [];
    const shown = selected.length === 1 ? selected : groups;
    const groupsNode = el('div', { className: 'quota-groups' });
    for (const group of shown) {
      const rows = [];
      rows.push(el('p', { className: 'quota-group', text: group.label }));
      for (const window of ['5h', 'weekly']) {
        const bucket = group.buckets.find(function (entry) { return entry.window === window; });
        const available = quota.status !== 'unavailable' && bucket && bucket.enabled && bucket.percent !== null &&
          (!bucket.resetsAt || Date.parse(bucket.resetsAt) > Date.now());
        rows.push(el('div', { className: 'quota-row' }, [
          el('span', { text: window === '5h' ? '5-hour' : 'Weekly' }),
          el('strong', { text: available ? (quota.status === 'cached' ? '~' : '') + fmtPercent(bucket.percent) + ' left' : 'Unavailable' }),
        ]));
        if (available && bucket.resetsAt) rows.push(el('div', { className: 'quota-reset', text: 'Resets in ' + fmtCountdown(bucket.resetsAt) }));
      }
      groupsNode.appendChild(el('div', { className: 'quota-group-block' }, rows));
    }
    const rows = [groupsNode];
    if (!shown.length) rows.push(el('p', { className: 'figure-note', text: 'Waiting for live quota from the local backend.' }));
    rows.push(el('p', { className: 'figure-note', text: quota
      ? (quota.status === 'live' ? 'Live · automatic 5-second refresh' : quota.status === 'cached' ? 'Cached · retrying automatically' : 'Unavailable · retrying automatically') +
        (quota.observedAt ? ' · checked ' + fmtTime(new Date(quota.observedAt).toISOString()) : '')
      : 'Automatic quota detection starts when a backend connects.' }));
    return card('Model quotas', rows);
  }

  /**
   * One row per running installation.
   *
   * With three hosts sharing an account, "which app is on which conversation"
   * is the first question the dashboard has to answer. Selecting a row focuses
   * that app; the rest of the dashboard follows.
   */
  function appsCard(snapshot) {
    const instances = snapshot.instances || [];
    if (instances.length === 0) return null;

    const list = el('div', { className: 'list' });
    for (const instance of instances) {
      const conversation = instance.conversation;
      const percent = conversation && conversation.usage ? conversation.usage.percent : null;
      const running = conversation && conversation.status === 'running';

      const meta = [conversation ? conversation.title : instance.viewState === 'new-thread' ? 'New thread' : 'Conversation not identified'];
      if (conversation) {
        meta.push(fmtExact(conversation.stepCount) + ' steps');
      }
      if (conversation && conversation.modelName) {
        meta.push(conversation.modelName);
      }
      if (running) {
        meta.push('Running');
      }

      const row = el('button', {
        className: 'list__row',
        attrs: { type: 'button', 'data-active': instance.backend.active ? 'true' : 'false' },
        on: {
          click: function () {
            send({ type: 'selectBackend', id: instance.backend.id });
          },
        },
      }, [
        el('div', { className: 'list__content' }, [
          el('div', { className: 'list__title' }, [
            el('span', { className: 'dot ' + (running ? 'dot--running' : 'dot--live') }),
            document.createTextNode(' ' + backendLabel(instance.backend.app)),
          ]),
          el('div', { className: 'list__meta' }, [el('span', { text: meta.join(' \u00b7 ') })]),
        ]),
        el('div', {
          className: 'list__value',
          text: percent === null ? '—' : fmtPercent(percent),
        }),
      ]);
      list.appendChild(row);
    }

    return el('section', { className: 'card card--flush' }, [
      el('div', { className: 'card__head card__head--inset' }, [
        el('h2', { className: 'card__title', text: 'Apps' }),
        el('span', { className: 'card__hint', text: 'Click to follow' }),
      ]),
      list,
    ]);
  }

  function card(title, children, hint) {
    const head = el('div', { className: 'card__head' }, [
      el('h2', { className: 'card__title', text: title }),
      hint ? el('span', { className: 'card__hint', text: hint }) : null,
    ]);
    return el('section', { className: 'card' }, [head].concat(children));
  }

  function contextCard(snapshot, conversation) {
    const usage = conversation.usage;
    const threshold = snapshot.prefs.warningThreshold;

    if (!usage) {
      return card('Context window', [
        el('div', { className: 'empty' }, [
          el('div', { className: 'empty__title', text: 'No usage reported yet' }),
          el('div', {
            className: 'empty__body',
            text: 'Antigravity reports usage after the model produces a response. The first reading usually appears within a few seconds of activity.',
          }),
        ]),
      ]);
    }

    const percent = usage.percent;
    const band = bandOf(percent, threshold);

    const radius = 70;
    const circumference = 2 * Math.PI * radius;
    const ratio = percent === null ? 0 : Math.min(1, Math.max(0, percent / 100));

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 168 168');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Context window usage');

    const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    track.setAttribute('class', 'gauge__track');
    track.setAttribute('cx', '84');
    track.setAttribute('cy', '84');
    track.setAttribute('r', String(radius));

    const value = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    value.setAttribute('class', 'gauge__value');
    value.setAttribute('data-band', band);
    value.setAttribute('cx', '84');
    value.setAttribute('cy', '84');
    value.setAttribute('r', String(radius));
    value.setAttribute('stroke-dasharray', String(circumference));
    value.setAttribute('stroke-dashoffset', String(circumference * (1 - ratio)));

    svg.appendChild(track);
    svg.appendChild(value);

    const gauge = el('div', { className: 'gauge' }, [
      svg,
      el('div', { className: 'gauge__center' }, [
        el('div', { className: 'gauge__percent', text: percent === null ? '—' : fmtPercent(percent) }),
        el('div', { className: 'gauge__caption', text: 'used' }),
      ]),
    ]);

    const figures = el('div', { className: 'gauge-figures' }, [
      el('div', { className: 'figure-lead' }, [
        document.createTextNode(fmtTokens(usage.used)),
        el('small', { text: usage.capacity === null ? ' tokens used' : ' / ' + fmtTokens(usage.capacity) + ' tokens' }),
      ]),
      el('div', { className: 'figure-note' }, [
        document.createTextNode(
          usage.remaining === null
            ? 'Remaining capacity is unknown for this model.'
            : fmtTokens(usage.remaining) + ' tokens remaining',
        ),
      ]),
      el('div', { className: 'badge-row' }, [badgeRow(usage, conversation, snapshot)]),
    ]);

    return card('Context window', [el('div', { className: 'gauge-row' }, [gauge, figures])], conversation.modelName || '');
  }

  function badgeRow(usage, conversation, snapshot) {
    const row = el('div', { className: 'actions-row' });
    const sourceLabel = usage.source === 'measured' ? 'Measured' : 'Estimated';
    const sourceClass = usage.source === 'measured' ? 'badge badge--measured' : 'badge badge--estimated';
    row.appendChild(el('span', { className: sourceClass, text: sourceLabel }));
    if (conversation.compressed) {
      row.appendChild(el('span', { className: 'badge badge--accent', text: 'Compressed' }));
    }
    if (snapshot.stale) {
      row.appendChild(el('span', { className: 'badge', text: 'Stale' }));
    }
    if (usage.measuredAt) {
      row.appendChild(el('span', { className: 'card__hint', text: 'at ' + fmtTime(usage.measuredAt) }));
    }
    return row;
  }

  function detailsCard(snapshot, conversation) {
    const usage = conversation.usage;
    const facts = [];

    facts.push(fact('Model', conversation.modelName || conversation.modelId || 'Unknown'));
    facts.push(fact('Fresh input', usage ? fmtExact(usage.input) + ' tokens' : '—'));
    facts.push(fact('Cache read', usage ? fmtExact(usage.cacheRead) + ' tokens' : '—'));
    if (usage && usage.cacheCreate > 0) {
      facts.push(fact('Cache write', fmtExact(usage.cacheCreate) + ' tokens'));
    }
    facts.push(fact('Output', usage ? fmtExact(usage.output) + ' tokens' : '—'));
    facts.push(fact('Capacity', usage && usage.capacity !== null ? fmtExact(usage.capacity) + ' tokens' : 'Not reported'));
    facts.push(fact('Steps', fmtExact(conversation.stepCount)));
    facts.push(fact('Status', conversation.status === 'running' ? 'Running' : 'Idle'));
    facts.push(fact('Last activity', fmtAge(conversation.lastModified)));
    facts.push(fact('Image generations', conversation.imageSteps > 0 ? String(conversation.imageSteps) : 'None'));
    facts.push(fact('Backend', snapshot.backend ? backendLabel(snapshot.backend.app) + ' · port ' + snapshot.backend.port : '—'));
    if (conversation.totals.costUsd !== null) {
      facts.push(fact('Estimated cost', fmtUsd(conversation.totals.costUsd) + ' for ' + fmtExact(conversation.totals.calls) + ' calls'));
    }

    return card('Session detail', [el('div', { className: 'facts' }, facts)]);
  }

  function fact(label, value) {
    return el('div', { className: 'fact' }, [
      el('div', { className: 'fact__label', text: label }),
      el('div', { className: 'fact__value', text: value }),
    ]);
  }

  function growthCard(snapshot, conversation) {
    const history = state.history.get(conversation.id) || [];
    const body = [];

    if (history.length < 2) {
      body.push(
        el('div', {
          className: 'sparkline__empty',
          text: 'Context growth will appear here as new readings arrive during this session.',
        }),
      );
    } else {
      body.push(sparkline(history, conversation.usage ? conversation.usage.capacity : null));
    }

    return card('Context growth', body, 'this session');
  }

  function sparkline(values, capacity) {
    const width = 100;
    const height = 40;
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
    svg.setAttribute(
      'aria-label',
      'Context grew from ' + fmtTokens(values[0]) + ' to ' + fmtTokens(values[values.length - 1]) + ' tokens',
    );

    const area = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    area.setAttribute('class', 'sparkline__area');
    area.setAttribute('points', '0,' + height + ' ' + points.join(' ') + ' ' + width + ',' + height);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('class', 'sparkline__line');
    line.setAttribute('points', points.join(' '));

    svg.appendChild(area);
    svg.appendChild(line);

    const wrapper = el('div', {}, [
      svg,
      el('div', {
        className: 'figure-note',
        text:
          fmtTokens(values[0]) +
          ' → ' +
          fmtTokens(values[values.length - 1]) +
          (capacity ? ' of ' + fmtTokens(capacity) : '') +
          ' · ' +
          values.length +
          ' readings',
      }),
    ]);
    return wrapper;
  }

  function renderAccountCard(pane, snapshot) {
    const account = snapshot.account;
    if (!account) return;

    const masked = snapshot.prefs.maskPersonalInfo;
    const rows = [];

    if (account.planName) rows.push(fact('Plan', account.planName));
    if (account.tierName) rows.push(fact('Tier', account.tierName));
    if (account.monthlyPromptCredits !== null) rows.push(fact('Monthly prompt credits', fmtExact(account.monthlyPromptCredits)));
    if (account.monthlyFlowCredits !== null) rows.push(fact('Monthly flow credits', fmtExact(account.monthlyFlowCredits)));
    if (account.name) rows.push(fact('Account', masked ? maskValue(account.name) : account.name));
    if (account.email) rows.push(fact('E-mail', masked ? maskValue(account.email) : account.email));

    if (rows.length === 0) return;

    pane.appendChild(card('Account', [el('div', { className: 'facts' }, rows)], masked ? 'masked' : ''));
  }

  function maskValue(value) {
    if (value.length <= 4) return '••••';
    return value.slice(0, 1) + '•••••' + value.slice(-1);
  }

  function usageCard(snapshot) {
    const usage = snapshot.usage;
    const days = usage.days || [];
    const max = days.reduce(function (peak, day) {
      return Math.max(peak, day.tokens);
    }, 0);

    const chart = el('div', { className: 'usage-chart' });
    const todayKey = days.length > 0 ? days[days.length - 1].day : null;

    for (const day of days) {
      const ratio = max > 0 ? day.tokens / max : 0;
      const bar = el('div', { className: 'usage-day__bar' });
      bar.style.height = Math.max(2, Math.round(ratio * 64)) + 'px';
      chart.appendChild(
        el('div', { className: 'usage-day' + (day.day === todayKey ? ' usage-day--today' : '') }, [
          bar,
          el('div', { className: 'usage-day__label', text: day.day.slice(8) }),
        ]),
      );
    }

    const legend = el('div', { className: 'usage-legend' }, [
      el('div', { className: 'usage-legend__item' }, [
        document.createTextNode('Today '),
        el('strong', { text: fmtTokens(usage.todayTokens) + ' tokens' }),
      ]),
      el('div', { className: 'usage-legend__item' }, [
        document.createTextNode('This month '),
        el('strong', { text: fmtTokens(usage.monthTokens) + ' tokens' }),
      ]),
      usage.monthCostUsd !== null
        ? el('div', { className: 'usage-legend__item' }, [
            document.createTextNode('API-equivalent '),
            el('strong', { text: fmtUsd(usage.monthCostUsd) }),
          ])
        : null,
    ]);

    const hint = usage.priced
      ? 'last 14 days'
      : usage.monthTokens > 0
        ? 'no published rate for this model'
        : 'no calls observed yet';
    const note = el('div', {
      className: 'figure-note',
      text: 'Tracked locally from observed calls. Estimates use published API rates and are not Antigravity billing.',
    });

    return card('Usage', [chart, legend, note], hint);
  }

  // --------------------------------------------------------------- sessions

  function renderSessions(pane, snapshot) {
    const sessions = snapshot.sessions || [];
    if (sessions.length === 0) {
      renderEmptyPane(pane, 'No conversations', 'Start a conversation in Antigravity and it will appear here.');
      return;
    }

    const list = el('div', { className: 'list' });
    for (const session of sessions) {
      const row = el('button', {
        className: 'list__row',
        attrs: { type: 'button', 'data-active': session.active ? 'true' : 'false' },
        on: {
          click: function () {
            send({ type: 'selectSession', id: session.id });
          },
        },
      });

      const meta = el('div', { className: 'list__meta' }, [
        el('span', { className: 'dot ' + (session.status === 'running' ? 'dot--running' : 'dot--idle') }),
        el('span', { text: session.status === 'running' ? 'Running' : 'Idle' }),
        el('span', { text: fmtExact(session.stepCount) + ' steps' }),
        el('span', { text: session.modelName || 'Model unknown' }),
        el('span', { text: fmtAge(session.lastModified) }),
      ]);

      const content = el('div', { className: 'list__content' }, [
        el('div', { className: 'list__title', text: session.title, attrs: { title: session.title } }),
        meta,
      ]);

      if (session.percent !== null) {
        const bar = el('div', { className: 'bar' });
        const fill = el('div', { className: 'bar__fill', attrs: { 'data-band': bandOf(session.percent, snapshot.prefs.warningThreshold) } });
        fill.style.width = Math.min(100, Math.max(0, session.percent)) + '%';
        bar.appendChild(fill);
        content.appendChild(el('div', { className: 'bar-row' }, [bar]));
      }

      row.appendChild(content);
      row.appendChild(
        el('div', { className: 'list__value', text: session.percent === null ? '—' : fmtPercent(session.percent) }),
      );
      list.appendChild(row);
    }

    pane.appendChild(
      el('section', { className: 'card card--flush' }, [
        el('div', { className: 'card__head card__head--inset' }, [
          el('h2', { className: 'card__title', text: 'Conversations' }),
          el('span', { className: 'card__hint', text: sessions.length + ' in this backend' }),
        ]),
        list,
      ]),
    );

    const note = el('div', {
      className: 'figure-note',
      text: 'Selecting a conversation reads its full trajectory, which can take a moment for very long sessions.',
    });
    pane.appendChild(note);
  }

  // ----------------------------------------------------------------- models

  function renderModels(pane, snapshot) {
    const models = (snapshot.models || []).map(function (model) {
      if (!snapshot.quota) return model;
      const bucket = modelQuotaBucket(snapshot, model.label, '5h');
      return Object.assign({}, model, { quotaPercent: bucket ? bucket.percent : null, resetsAt: bucket ? bucket.resetsAt : null });
    });
    if (models.length === 0) {
      renderEmptyPane(pane, 'No models reported', 'Antigravity has not returned a model catalogue for this account yet.');
      return;
    }

    const grid = el('div', { className: 'models' });
    for (const model of models) {
      const head = el('div', { className: 'model-card__head' }, [
        el('div', { className: 'model-card__name', text: model.label }),
        model.active ? el('span', { className: 'badge badge--accent', text: 'In use' }) : null,
      ]);

      const meta = el('div', { className: 'model-card__meta' }, [
        el('span', {}, [document.createTextNode('Context '), el('strong', { text: model.contextLimit === null ? '—' : fmtTokens(model.contextLimit) })]),
        el('span', {}, [document.createTextNode('Max output '), el('strong', { text: model.maxOutput === null ? '—' : fmtTokens(model.maxOutput) })]),
      ]);

      const children = [head, meta];

      if (model.quotaPercent !== null) {
        const bar = el('div', { className: 'bar' });
        const fill = el('div', {
          className: 'bar__fill',
          attrs: { 'data-band': bandOf(100 - model.quotaPercent, snapshot.prefs.warningThreshold) },
        });
        fill.style.width = Math.min(100, Math.max(0, model.quotaPercent)) + '%';
        bar.appendChild(fill);

        children.push(
          el('div', { className: 'bar-row' }, [
            bar,
            el('span', { className: 'bar-row__value', text: fmtWhole(model.quotaPercent) }),
          ]),
        );
        if (model.resetsAt) {
          children.push(el('div', { className: 'figure-note', text: 'Resets in ' + fmtCountdown(model.resetsAt) }));
        }
      } else {
        children.push(el('div', { className: 'figure-note', text: 'Quota not reported' }));
      }

      grid.appendChild(
        el('div', { className: 'model-card', attrs: { 'data-active': model.active ? 'true' : 'false' } }, children),
      );
    }

    pane.appendChild(
      el('section', { className: 'card' }, [
        el('div', { className: 'card__head' }, [
          el('h2', { className: 'card__title', text: 'Models and quota' }),
          el('span', { className: 'card__hint', text: 'reported by Antigravity' }),
        ]),
        grid,
      ]),
    );
  }

  // --------------------------------------------------------------- settings

  const SETTING_SPECS = [
    {
      key: 'pollIntervalMs',
      label: 'Refresh interval',
      description: 'How often to check for conversation changes. Trajectory contents are only re-read when a change is detected.',
      type: 'number',
      min: 1000,
      max: 60000,
      step: 500,
      suffix: 'ms',
    },
    {
      key: 'warningThreshold',
      label: 'Warning threshold',
      description: 'Context usage percentage at which the status bar starts warning.',
      type: 'range',
      min: 50,
      max: 100,
      step: 5,
      suffix: '%',
    },
    {
      key: 'maxPayloadMb',
      label: 'Maximum response size',
      description: 'Conversations larger than this are reported as unmeasurable instead of being parsed.',
      type: 'number',
      min: 16,
      max: 1024,
      step: 16,
      suffix: 'MB',
    },
    {
      key: 'displayMode',
      label: 'Display detail',
      description: 'How much the status bar and the inline badge show. Tooltips and this dashboard stay detailed either way.',
      type: 'select',
      options: [
        { value: 'essentials', label: 'Essentials' },
        { value: 'full', label: 'Full' },
        { value: 'custom', label: 'Custom snippet' },
      ],
    },
    {
      key: 'showQuota',
      label: 'Show quota in status bar',
      description: 'Display the active model\'s remaining quota next to the context usage.',
      type: 'toggle',
    },
    {
      key: 'maskPersonalInfo',
      label: 'Mask personal information',
      description: 'Hide your account name and e-mail address in the dashboard and tooltip.',
      type: 'toggle',
    },
  ];

  const SNIPPET_FIELDS = [
    ['snippetContext', 'Context used', true], ['snippetRemaining', 'Context remaining', true],
    ['snippetFiveHour', '5-hour quota', false], ['snippetWeekly', 'Weekly quota', false],
    ['snippetModel', 'Model name', false], ['snippetResets', 'Reset countdowns', false],
  ];

  function renderSettings(pane, snapshot) {
    const settings = el('div', { className: 'settings' });

    for (const spec of SETTING_SPECS) {
      const control = el('div', { className: 'setting__control' });
      const value = snapshot.prefs[spec.key];

      if (spec.type === 'toggle') {
        const input = el('input', {
          attrs: { type: 'checkbox', id: 'setting-' + spec.key },
          on: {
            change: function () {
              send({ type: 'updateSetting', key: spec.key, value: input.checked });
            },
          },
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
          on: {
            change: function () {
              send({ type: 'updateSetting', key: spec.key, value: select.value });
            },
          },
        });
        for (const option of spec.options) {
          const node = el('option', { text: option.label, attrs: { value: option.value } });
          node.selected = option.value === value;
          select.appendChild(node);
        }
        control.appendChild(select);
      } else if (spec.type === 'range') {
        const output = el('span', {
          className: 'setting__range-value',
          text: String(value) + (spec.suffix || ''),
        });
        const input = el('input', {
          attrs: {
            type: 'range',
            min: String(spec.min),
            max: String(spec.max),
            step: String(spec.step),
            'aria-label': spec.label,
          },
          on: {
            input: function () {
              output.textContent = String(input.value) + (spec.suffix || '');
            },
            change: function () {
              send({ type: 'updateSetting', key: spec.key, value: Number(input.value) });
            },
          },
        });
        input.value = String(value);
        control.appendChild(input);
        control.appendChild(output);
      } else {
        const input = el('input', {
          attrs: {
            type: 'number',
            min: String(spec.min),
            max: String(spec.max),
            step: String(spec.step),
            'aria-label': spec.label,
          },
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

    pane.appendChild(
      el('section', { className: 'card' }, [
        el('div', { className: 'card__head' }, [el('h2', { className: 'card__title', text: 'Settings' })]),
        settings,
      ]),
    );

    const snippets = el('div', { className: 'snippet-options' });
    for (const [key, label, fallback] of SNIPPET_FIELDS) {
      const input = el('input', { attrs: { type: 'checkbox', id: 'setting-' + key }, on: {
        change: function () {
          const values = Object.fromEntries(SNIPPET_FIELDS.map(function ([name, , defaultValue]) {
            return [name, typeof snapshot.prefs[name] === 'boolean' ? snapshot.prefs[name] : defaultValue];
          }));
          values[key] = input.checked;
          for (const [name, value] of Object.entries(values)) send({ type: 'updateSetting', key: name, value });
          send({ type: 'updateSetting', key: 'displayMode', value: 'custom' });
        },
      } });
      input.checked = typeof snapshot.prefs[key] === 'boolean' ? snapshot.prefs[key] : fallback;
      snippets.appendChild(el('label', { className: 'snippet-option', attrs: { for: 'setting-' + key } }, [input, el('span', { text: label })]));
    }
    pane.appendChild(card(document.body.dataset.host === 'editor' ? 'Status bar fields' : 'Inline snippet fields', [
      el('p', { className: 'figure-note', text: document.body.dataset.host === 'editor'
        ? 'Choose this editor’s status bar fields. Inline snippets use Customize snippet in their card.'
        : 'Choose inline snippet fields across connected apps. Selecting a field enables Custom mode.' }), snippets,
    ]));

    // Backends
    const backendList = el('div', { className: 'list' });
    for (const backend of snapshot.backends) {
      const instance = (snapshot.instances || []).find(function (entry) {
        return entry.backend.id === backend.id;
      });
      const conversation = instance ? instance.conversation : null;
      const row = el('button', {
        className: 'list__row',
        attrs: { type: 'button', 'data-active': backend.active ? 'true' : 'false' },
        on: {
          click: function () {
            send({ type: 'selectBackend', id: backend.id });
          },
        },
      }, [
        el('div', { className: 'list__content' }, [
          el('div', { className: 'list__title', text: backendLabel(backend.app) + ' · ' + backend.scheme + '://127.0.0.1:' + backend.port }),
          el('div', { className: 'list__meta' }, [
            el('span', { className: 'dot ' + (backend.reachable ? 'dot--live' : 'dot--idle') }),
            el('span', { text: backend.reachable ? 'Reachable' : 'Unreachable' }),
            el('span', { text: backend.conversations + ' conversations' }),
            backend.running > 0 ? el('span', { text: backend.running + ' running' }) : null,
            backend.pid ? el('span', { text: 'pid ' + backend.pid }) : null,
          ]),
          conversation
            ? el('div', { className: 'list__meta' }, [
                el('span', { text: conversation.title }),
                conversation.usage && conversation.usage.percent !== null
                  ? el('span', { text: fmtPercent(conversation.usage.percent) + ' context' })
                  : null,
              ])
            : null,
        ]),
        el('div', { className: 'list__value', text: backend.active ? 'Following' : '' }),
      ]);
      backendList.appendChild(row);
    }

    pane.appendChild(
      el('section', { className: 'card card--flush' }, [
        el('div', { className: 'card__head card__head--inset' }, [
          el('h2', { className: 'card__title', text: 'Backend' }),
          el('span', { className: 'card__hint', text: 'Antigravity can run several at once' }),
        ]),
        backendList,
      ]),
    );

    const actions = el('div', { className: 'actions-row' }, [
      el('button', {
        className: 'btn',
        attrs: { type: 'button' },
        text: 'Refresh now',
        on: { click: function () { send({ type: 'refresh' }); } },
      }),
      el('button', {
        className: 'btn',
        attrs: { type: 'button' },
        text: state.showDiagnostics ? 'Hide diagnostics' : 'Show diagnostics',
        on: { click: function () {
          state.showDiagnostics = !state.showDiagnostics;
          state.rendered.delete('settings');
          if (state.showDiagnostics) send({ type: 'diagnostics' });
          renderActivePane();
        } },
      }),
    ]);

    pane.appendChild(card('Actions', [actions]));
    if (state.showDiagnostics) {
      pane.appendChild(card('Connection diagnostics', [
        el('div', { className: 'facts' }, [
          fact('Status', snapshot.status),
          fact('Snapshot time', new Date(snapshot.generatedAt).toLocaleString()),
          fact('Reachable apps', String((snapshot.backends || []).filter(function (backend) { return backend.reachable; }).length)),
          fact('Quota source', snapshot.quota ? 'Local backend · ' + snapshot.quota.status : 'Waiting for backend'),
        ]),
        el('p', { className: 'figure-note', text: snapshot.lastError || 'No error reported in this snapshot.' }),
        el('div', {}, (snapshot.discoveryNotes || []).map(function (note) {
          return el('p', { className: 'figure-note', text: note });
        })),
      ]));
    }
  }

  // -------------------------------------------------------------------- boot

  selectTab(state.tab);
  renderEmptyPane(panes[state.tab], 'Waiting for the first reading', 'Antigravity Monitor is connecting to the local language server.');
  send({ type: 'ready' });
})();
