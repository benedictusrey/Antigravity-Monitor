#!/usr/bin/env node
/**
 * Inline composer badge and its compact monitor card.
 *
 * The Antigravity composer is a web page served by the language server, so the
 * only way to place a control next to the "Turbo" preset selector is to attach
 * to the renderer and insert one node. That is what this does.
 *
 * Two things are deliberately paranoid:
 *
 * 1. Installs are versioned and older instances are neutralised. A page keeps
 *    every script ever injected; a previous build's MutationObserver will happily
 *    resurrect its own pill. Insertions of a foreign badge element are therefore
 *    rejected at the DOM boundary, so one pill is all that can exist.
 * 2. The card is appended to `document.body`, not the composer, because the
 *    composer clips its overflow and would cut the card in half.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { configRoot } from './platform.mjs';

const require = createRequire(import.meta.url);
const { quotaAt, quotaBucket, resolveQuotaGroup } = require('../out/src/core/quota.js');
const { snippetPreferences } = require('../out/src/core/snippet.js');

const PROBE = `!!document.querySelector('[data-testid="agent-input-box"]')`;

/** Bump when the injected script changes; the guard below is built from it. */
const VERSION = 16;

/** The Settings panel's limit rows; empty unless that panel is on screen. */
export const QUOTA_ROWS = `(function () {
  var out = [];
  var seen = new Set();
  var labels = Array.from(document.querySelectorAll('[data-testid="quota-progress-circle"]')).map(function (node) {
    return { node: node, boundary: node.closest('div.py-2') || (node.parentElement && node.parentElement.parentElement) || node };
  });
  var panels = document.querySelectorAll('[data-testid="models-and-usage"], [data-testid="models-usage"], [data-testid="usage-settings"], [aria-label="Models & Usage"], [aria-label="Models and usage"], [role="dialog"]');
  for (var panel of panels) {
    if (panel.getAttribute('role') === 'dialog' &&
        !/models\\s*(?:&|and)\\s*usage/i.test(panel.getAttribute('aria-label') || panel.textContent)) continue;
    for (var node of panel.querySelectorAll('[role="progressbar"], h2, h3, h4, label, span, p')) {
      labels.push({ node: node, boundary: panel });
    }
  }
  for (var i = 0; i < labels.length && out.length < 16; i++) {
    var anchor = labels[i];
    if (anchor.node.closest('[data-agm-card], [data-agm-badge]') || !anchor.node.getClientRects().length) continue;
    var row = anchor.node;
    var label = row.textContent.replace(/\\s+/g, ' ').trim();
    if (!/weekly|(?:five|5)[- ]hour/i.test(label) && !row.matches('[data-testid="quota-progress-circle"], [role="progressbar"]')) continue;
    for (var depth = 0; row && depth < 5; depth++, row = row.parentElement) {
      var text = row.textContent.replace(/\\s+/g, ' ').trim();
      if (text.length > 1200) break;
      if (/weekly|(?:five|5)[- ]hour/i.test(text)) {
        var progress = row.querySelector('[role="progressbar"]');
        if (progress && !/%/.test(text) && progress.getAttribute('aria-valuemax') === '100') {
          var now = progress.getAttribute('aria-valuenow');
          if (now !== null) text += ' ' + now + '%';
        }
        if (/\\d+(?:\\.\\d+)?\\s*%/.test(text)) {
          if (!seen.has(text)) { seen.add(text); out.push(text); }
          break;
        }
      }
      if (row === anchor.boundary) break;
    }
  }
  return out;
})()`;

export const INSTALL = `(function () {
  if (window.__agmVersion === ${VERSION}) return true;
  window.__agmVersion = ${VERSION};

  var owner = 'agm-' + Math.random().toString(36).slice(2);
  window.__agmOwner = owner;
  var readContext = (${readRendererContext.toString()});
  var waitingPayload = (${selectionPayload.toString()});
  var localContext = readContext();
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Older instances keep their own element reference and re-insert it from a
  // MutationObserver. Reject foreign badges at the DOM boundary instead of
  // racing them with clean-up sweeps.
  if (!window.__agmGuard) {
    window.__agmGuard = true;
    var nativeInsert = Node.prototype.insertBefore;
    var nativeAppend = Node.prototype.appendChild;
    var foreign = function (node) {
      return (
        node &&
        node.nodeType === 1 &&
        node.hasAttribute &&
        node.hasAttribute('data-agm-badge') &&
        node.getAttribute('data-agm-owner') !== window.__agmOwner
      );
    };
    Node.prototype.insertBefore = function (node, reference) {
      if (foreign(node)) return node;
      return nativeInsert.call(this, node, reference);
    };
    Node.prototype.appendChild = function (node) {
      if (foreign(node)) return node;
      return nativeAppend.call(this, node);
    };
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-agm-badge], [data-agm-card]'), function (node) {
    node.remove();
  });

  var STALE_MS = 20000;
  var last = null;
  var lastUpdate = 0;
  var stale = false;
  var pill = null;
  var dot = null;
  var label = null;
  var card = null;
  var cardParts = null;
  var open = false;
  var refreshRequested = false;
  var copyTimer = null;
  var pendingPrefs = {};
  var settingsQueue = {};

  function snippetPrefs() {
    return Object.assign({ snippetContext: true, snippetRemaining: true, snippetFiveHour: false,
      snippetWeekly: false, snippetModel: false, snippetResets: false }, last && last.snippetPrefs, pendingPrefs);
  }

  function queueSetting(key, value) {
    pendingPrefs[key] = value;
    settingsQueue[key] = value;
  }

  function setPreset(value) {
    queueSetting('displayMode', value);
    var values = { snippetContext: true, snippetRemaining: value === 'full', snippetFiveHour: false,
      snippetWeekly: false, snippetModel: false, snippetResets: false };
    for (var key in values) queueSetting(key, values[key]);
    renderPill();
    renderCard();
  }

  function quotaStatus(values) {
    if (!values || typeof values.quotaObservedAt !== 'number') return 'unavailable';
    var age = Date.now() - values.quotaObservedAt;
    if (age < 0 || age > 30000) return 'unavailable';
    return values.quotaStatus === 'cached' || age > 12000 ? 'cached' : values.quotaStatus;
  }

  function mk(tag, style, text) {
    var node = document.createElement(tag);
    if (style) node.style.cssText = style;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // ---------------------------------------------------------------- density

  function preference() {
    try {
      var stored = localStorage.getItem('agm-density');
      return stored === 'essentials' || stored === 'full' ? stored : null;
    } catch (error) {
      return null;
    }
  }

  function remember(value) {
    try {
      localStorage.setItem('agm-density', value);
    } catch (error) {
      // Private mode or wiped profile: the choice simply does not persist.
    }
  }

  function density() {
    return pendingPrefs.displayMode || (last && last.density) || 'full';
  }

  // ------------------------------------------------------------------- pill

  function createPill() {
    pill = document.createElement('div');
    pill.setAttribute('data-agm-badge', '');
    pill.setAttribute('data-agm-owner', owner);
    pill.setAttribute('role', 'button');
    pill.setAttribute('tabindex', '0');
    pill.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'gap:6px',
      'height:24px',
      'padding:0 8px',
      'margin-right:2px',
      'border-radius:999px',
      'font-size:12px',
      'line-height:1',
      'font-variant-numeric:tabular-nums',
      'color:var(--secondary-foreground,#a0a0a0)',
      'background:transparent',
      'white-space:nowrap',
      'max-width:min(520px,45vw)',
      'min-width:0',
      'flex:0 1 auto',
      'user-select:none',
      'cursor:pointer',
      'transition:background-color 120ms ease,opacity 160ms ease'
    ].join(';');
    if (reducedMotion) pill.style.transition = 'none';

    dot = mk('span', 'width:6px;height:6px;border-radius:50%;background:currentColor;flex:0 0 auto');
    label = mk('span', 'overflow:hidden;text-overflow:ellipsis;min-width:0');
    pill.appendChild(dot);
    pill.appendChild(label);

    pill.addEventListener('click', function (event) {
      event.stopPropagation();
      toggleCard(!open);
    });
    pill.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleCard(!open);
      }
    });
    pill.addEventListener('mouseenter', function () {
      if (!stale) pill.style.backgroundColor = 'var(--secondary,rgba(255,255,255,0.08))';
    });
    pill.addEventListener('mouseleave', function () {
      pill.style.backgroundColor = 'transparent';
    });
    pill.addEventListener('focus', function () {
      pill.style.outline = '1px solid var(--ring,#4daafc)';
      pill.style.outlineOffset = '2px';
    });
    pill.addEventListener('blur', function () {
      pill.style.outline = 'none';
    });
  }

  function placePill() {
    var turbo = document.querySelector('[data-testid="permissions-selector-trigger"]');
    var group = turbo && turbo.parentElement;
    if (!group || !group.parentElement) return false;
    if (pill.parentElement !== group.parentElement || pill.nextSibling !== group) {
      group.parentElement.insertBefore(pill, group);
    }
    return true;
  }

  function renderPill() {
    if (!last || !last.show) {
      if (pill && pill.parentElement) pill.remove();
      toggleCard(false);
      return;
    }
    if (!pill) createPill();
    if (!placePill()) return;

    var prefs = snippetPrefs();
    var values = last.snippetValues || { context: last.essentials, remaining: last.card && last.card.remainingText };
    var parts = [];
    if (prefs.snippetContext && values.context) parts.push(values.context);
    if (prefs.snippetRemaining && values.remaining) parts.push(values.remaining);
    var status = quotaStatus(last.card);
    window.__agmQuotaStatus = status;
    var quotaExpired = status === 'unavailable';
    var quotaPrefix = status === 'cached' ? '~' : '';
    if (prefs.snippetFiveHour) parts.push((quotaExpired ? '5h —' : quotaPrefix + (values.fiveHour || '5h —').replace(/^~/, '')) + (!quotaExpired && prefs.snippetResets && values.fiveHourReset ? ' (' + values.fiveHourReset + ')' : ''));
    if (prefs.snippetWeekly) parts.push((quotaExpired ? 'Week —' : quotaPrefix + (values.weekly || 'Week —').replace(/^~/, '')) + (!quotaExpired && prefs.snippetResets && values.weeklyReset ? ' (' + values.weeklyReset + ')' : ''));
    if (prefs.snippetModel && values.model) parts.push(values.model);
    label.textContent = parts.length ? parts.join(' · ') : 'Monitor';
    dot.style.background = last.color;
    pill.title = label.textContent + '\\n' + (stale ? 'Stale reading. ' : '') + last.title;
    pill.setAttribute(
      'aria-label',
      (stale ? 'Stale reading. ' : '') + last.aria + (open ? ' Close details.' : ' Open details.'),
    );
    pill.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  // ------------------------------------------------------------------ card

  function limitText(limit) {
    if (!limit || typeof limit.percent !== 'number' || !isFinite(limit.percent)) return null;
    var text = Math.round(limit.percent * 10) / 10 + '% left';
    if (limit.resetText) text += ' \\u00b7 ' + limit.resetText;
    return text;
  }

  // A lower limit is the number that constrains the next request; make it
  // visible without adding another badge or another row.
  function limitTone(percent) {
    if (typeof percent !== 'number' || !isFinite(percent)) return null;
    if (percent <= 10) return '#e5534b';
    if (percent <= 20) return '#d29922';
    return null;
  }

  // Clearing the display property forgets the row's original grid display, so
  // restore the exact value instead of wiping the declaration.
  function setRow(parts, text, tone) {
    if (text) {
      parts.wrap.style.display = 'grid';
      parts.value.textContent = text;
      parts.value.style.color = tone || 'var(--foreground,#fff)';
    } else {
      parts.wrap.style.display = 'none';
      parts.value.textContent = '';
    }
  }

  function row(labelText, valueText) {
    var wrap = mk('div', 'display:grid;grid-template-columns:80px minmax(0,1fr);column-gap:12px;align-items:baseline');
    var name = mk('span', 'color:var(--muted-foreground,#b4b4b4);font-size:13px;line-height:1.6', labelText);
    var value = mk('span', 'color:var(--foreground,#fff);font-size:13px;line-height:1.6;font-variant-numeric:tabular-nums;text-align:right;overflow-wrap:anywhere');
    wrap.appendChild(name);
    wrap.appendChild(value);
    return { wrap: wrap, value: value };
  }

  function buildCard() {
    card = document.createElement('div');
    card.setAttribute('data-agm-card', '');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Antigravity context window');
    card.setAttribute('tabindex', '-1');
    card.style.cssText = [
      'position:fixed',
      'z-index:2147483000',
      'width:360px',
      'max-width:calc(100vw - 24px)',
      'max-height:calc(100vh - 24px)',
      'overflow:auto',
      'box-sizing:border-box',
      'padding:16px',
      'border-radius:10px',
      'background:var(--card,#1b1b1b)',
      'color:var(--foreground,#fff)',
      'border:1px solid var(--border,rgba(255,255,255,0.12))',
      'box-shadow:0 8px 24px rgba(0,0,0,0.22)',
      'font-family:var(--font-sans,system-ui)',
      'font-size:14px',
      'line-height:1.45',
      'display:none',
      'user-select:none'
    ].join(';');

    var head = mk('div', 'display:flex;align-items:flex-start;justify-content:space-between;gap:10px');
    var ident = mk('div', 'display:flex;flex-direction:column;gap:1px;min-width:0;overflow:hidden');
    var app = mk('span', 'color:var(--muted-foreground,#b4b4b4);font-size:12px;line-height:1.4');
    var title = mk('span', 'color:var(--foreground,#fff);font-size:14px;font-weight:600;line-height:1.4;overflow-wrap:anywhere');
    ident.appendChild(app);
    ident.appendChild(title);
    var chip = mk('span', 'font-size:12px;color:var(--muted-foreground,#b4b4b4);flex:0 0 auto');
    var refresh = mk('button', [
      'appearance:none',
      'display:inline-flex',
      'align-items:center',
      'justify-content:center',
      'height:32px',
      'padding:0 8px',
      'border:0',
      'background:transparent',
      'color:var(--muted-foreground,#9a9a9a)',
      'font:inherit',
      'font-size:12px',
      'line-height:1',
      'cursor:pointer'
    ].join(';'), 'Refresh');
    refresh.setAttribute('type', 'button');
    refresh.setAttribute('aria-label', 'Refresh now');
    refresh.title = 'Refresh now';
    refresh.addEventListener('mouseenter', function () {
      if (!refresh.disabled) refresh.style.color = 'var(--foreground,#fff)';
    });
    refresh.addEventListener('mouseleave', function () {
      refresh.style.color = 'var(--muted-foreground,#9a9a9a)';
    });
    refresh.addEventListener('click', function (event) {
      event.stopPropagation();
      if (refresh.disabled) return;
      refreshRequested = true;
      refresh.disabled = true;
      refresh.style.opacity = '0.45';
      refresh.setAttribute('aria-busy', 'true');
      setTimeout(function () {
        if (!refresh) return;
        refresh.disabled = false;
        refresh.style.opacity = '1';
        refresh.removeAttribute('aria-busy');
      }, 4000);
    });
    head.appendChild(ident);
    head.appendChild(chip);

    var percent = mk('div', 'font-size:30px;font-weight:600;letter-spacing:-0.02em;font-variant-numeric:tabular-nums;margin:6px 0 8px');

    var track = mk('div', 'height:6px;border-radius:999px;background:rgba(128,128,128,0.28);overflow:hidden');
    var fill = mk('div', 'height:100%;width:0;border-radius:999px;background:currentColor;transition:width 240ms ease,background-color 200ms ease');
    if (reducedMotion) fill.style.transition = 'none';
    track.appendChild(fill);

    var figures = mk('div', 'display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-top:8px;font-size:13px;color:var(--muted-foreground,#b4b4b4)');
    var volume = mk('span', 'font-variant-numeric:tabular-nums');
    var remaining = mk('span', 'font-variant-numeric:tabular-nums');
    figures.appendChild(volume);
    figures.appendChild(remaining);

    var ruleOne = mk('div', 'height:1px;background:var(--border,rgba(255,255,255,0.1));margin:12px 0');
    var modelRow = row('Model', '');
    var quotaModelRow = row('Quota model', '');
    var sessionRow = row('5-hour', '');
    var weeklyRow = row('Weekly', '');
    var updatedRow = row('Updated', '');
    var quotaNote = mk('p', 'margin:10px 0 0;color:var(--muted-foreground,#b4b4b4);font-size:12px;line-height:1.5');
    var rows = mk('div', 'display:flex;flex-direction:column;gap:6px');
    rows.appendChild(modelRow.wrap);
    rows.appendChild(quotaModelRow.wrap);
    rows.appendChild(sessionRow.wrap);
    rows.appendChild(weeklyRow.wrap);
    rows.appendChild(updatedRow.wrap);

    var ruleTwo = mk('div', 'height:1px;background:var(--border,rgba(255,255,255,0.1));margin:12px 0');
    var foot = mk('div', 'display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px');
    var footLabel = mk('span', 'color:var(--muted-foreground,#9a9a9a);font-size:11px', 'Display');
    var group = mk('div', 'display:inline-flex;padding:2px;border-radius:9px;background:rgba(128,128,128,0.16)');

    function segment(value, textContent) {
      var node = mk('button', [
        'appearance:none',
        'border:0',
        'background:transparent',
        'color:var(--muted-foreground,#9a9a9a)',
        'font:inherit',
        'font-size:12px',
        'min-height:32px',
        'padding:4px 10px',
        'border-radius:7px',
        'cursor:pointer'
      ].join(';'), textContent);
      node.setAttribute('type', 'button');
      node.setAttribute('data-agm-density', value);
      node.addEventListener('click', function (event) {
        event.stopPropagation();
        setPreset(value);
      });
      group.appendChild(node);
      return node;
    }

    var essentialButton = segment('essentials', 'Essentials');
    var fullButton = segment('full', 'Full');

    var customize = mk('details', 'margin-top:14px');
    var summary = mk('summary', 'cursor:pointer;min-height:32px;line-height:32px;font-size:13px', 'Customize snippet');
    customize.appendChild(summary);
    customize.addEventListener('toggle', positionCard);
    var fields = {};
    var fieldGrid = mk('div', 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:10px;row-gap:2px;padding-top:4px');
    customize.appendChild(fieldGrid);
    var fieldNames = { snippetContext: 'Context used', snippetRemaining: 'Context remaining',
      snippetFiveHour: '5-hour quota', snippetWeekly: 'Weekly quota', snippetModel: 'Model name', snippetResets: 'Reset countdowns' };
    Object.keys(fieldNames).forEach(function (key) {
      var wrap = mk('label', 'display:flex;align-items:center;gap:10px;min-height:32px;cursor:pointer;font-size:13px');
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('data-agm-setting', key);
      input.style.cursor = 'pointer';
      input.addEventListener('change', function () {
        var prefs = snippetPrefs();
        prefs[key] = input.checked;
        queueSetting('displayMode', 'custom');
        Object.keys(fieldNames).forEach(function (name) { queueSetting(name, prefs[name]); });
        renderPill();
        renderCard();
      });
      fields[key] = input;
      wrap.appendChild(input);
      wrap.appendChild(mk('span', '', fieldNames[key]));
      fieldGrid.appendChild(wrap);
    });

    var copy = mk('button', [
      'appearance:none',
      'border:0',
      'background:transparent',
      'color:var(--muted-foreground,#9a9a9a)',
      'font:inherit',
      'font-size:12px',
      'min-height:32px',
      'padding:4px 8px',
      'cursor:pointer'
    ].join(';'), 'Copy');
    copy.setAttribute('type', 'button');
    copy.setAttribute('aria-label', 'Copy reading');
    copy.title = 'Copy this reading';
    copy.addEventListener('mouseenter', function () {
      copy.style.color = 'var(--foreground,#fff)';
    });
    copy.addEventListener('mouseleave', function () {
      copy.style.color = 'var(--muted-foreground,#9a9a9a)';
    });
    copy.addEventListener('click', function (event) {
      event.stopPropagation();
      copySummary();
    });

    var footActions = mk('div', 'display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%');
    footActions.appendChild(copy);
    footActions.appendChild(refresh);
    foot.appendChild(footLabel);
    foot.appendChild(group);
    foot.appendChild(footActions);

    card.appendChild(head);
    card.appendChild(percent);
    card.appendChild(track);
    card.appendChild(figures);
    card.appendChild(ruleOne);
    card.appendChild(rows);
    card.appendChild(quotaNote);
    card.appendChild(ruleTwo);
    card.appendChild(foot);
    card.appendChild(customize);

    card.addEventListener('click', function (event) {
      event.stopPropagation();
    });

    cardParts = {
      app: app,
      title: title,
      chip: chip,
      refresh: refresh,
      percent: percent,
      fill: fill,
      volume: volume,
      remaining: remaining,
      model: modelRow,
      quotaModel: quotaModelRow,
      session: sessionRow,
      weekly: weeklyRow,
      updated: updatedRow,
      quotaNote: quotaNote,
      essentials: essentialButton,
      full: fullButton,
      copy: copy,
      fields: fields,
    };

    document.body.appendChild(card);
  }

  function fallbackCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (error) {
      ok = false;
    }
    area.remove();
    return ok;
  }

  function copySummary() {
    var values = last && last.card;
    if (!values || !cardParts) return;

    var parts = [values.app, values.title, values.percent === null ? null : values.percentText + ' used'];
    if (values.volumeText) parts.push(values.volumeText);
    if (values.session) parts.push('5-hour ' + limitText(values.session));
    if (values.limits && values.limits.weekly) parts.push('weekly ' + limitText(values.limits.weekly));
    if (values.updatedText) parts.push('updated ' + values.updatedText);
    var text = parts.filter(Boolean).join(' \\u00b7 ');

    function finish(ok) {
      if (!cardParts) return;
      cardParts.copy.textContent = ok ? 'Copied' : 'Copy failed';
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(function () {
        copyTimer = null;
        if (cardParts) cardParts.copy.textContent = 'Copy';
      }, 1600);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          finish(true);
        },
        function () {
          finish(fallbackCopy(text));
        },
      );
      return;
    }
    finish(fallbackCopy(text));
  }

  function positionCard() {
    if (!card || !open) return;
    var rect = pill.getBoundingClientRect();
    card.style.visibility = 'hidden';
    card.style.display = 'block';
    var height = card.offsetHeight;
    var width = card.offsetWidth;

    var top = rect.top - height - 10;
    if (top < 8) top = rect.bottom + 10;
    var left = rect.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - height - 8));

    card.style.top = top + 'px';
    card.style.left = left + 'px';
    card.style.visibility = 'visible';
  }

  function renderCard() {
    if (!open || !card || !last) return;
    var values = last.card;
    if (!values) {
      toggleCard(false);
      return;
    }

    cardParts.app.textContent = values.app || '';
    cardParts.app.style.display = values.app ? '' : 'none';
    cardParts.title.textContent = values.title;
    cardParts.title.title = values.title;
    cardParts.chip.textContent = stale ? 'Stale' : values.sourceLabel;
    cardParts.chip.style.color = values.sourceLabel === 'Estimated' ? 'var(--primary,#ffc799)' : 'var(--muted-foreground,#9a9a9a)';

    cardParts.percent.textContent = values.percentText;
    cardParts.percent.style.color = values.color === 'currentColor' ? 'var(--foreground,#fff)' : values.color;

    cardParts.fill.style.width = Math.max(0, Math.min(100, values.percent)) + '%';
    cardParts.fill.parentElement.style.display = values.percent === null ? 'none' : 'block';
    cardParts.fill.style.background = values.color === 'currentColor' ? 'var(--foreground,#fff)' : values.color;

    cardParts.volume.textContent = values.volumeText;
    cardParts.remaining.textContent = values.remainingText || '';
    cardParts.remaining.style.display = values.remainingText ? '' : 'none';

    setRow(cardParts.model, values.model);
    cardParts.model.value.title = values.model;
    var normalizedModel = String(values.model || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    var normalizedQuotaModel = String(values.quotaModel || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    setRow(cardParts.quotaModel, normalizedModel !== normalizedQuotaModel ? values.quotaModel : null);

    var status = quotaStatus(values);
    var quotaExpired = status === 'unavailable';
    var sessionText = quotaExpired ? null : limitText(values.session);
    setRow(cardParts.session, sessionText || 'Unavailable', values.session && limitTone(values.session.percent));

    var weekly = !quotaExpired && values.limits && values.limits.weekly;
    var weeklyText = limitText(weekly);
    setRow(cardParts.weekly, weeklyText || 'Unavailable', weekly && limitTone(weekly.percent));
    cardParts.quotaNote.textContent = (values.quotaGroup || 'Quota group not identified') + '. ' +
      (stale ? 'Companion disconnected; quota is not live.' : status === 'live' ? 'Live; refreshes every 5 seconds.' : status === 'cached' ? 'Cached; retrying automatically.' : 'Quota unavailable; retrying automatically.') +
      (values.quotaCheckedText ? ' Checked ' + values.quotaCheckedText + '.' : '');

    cardParts.updated.value.textContent = values.updatedText;

    if (cardParts.refresh.disabled) {
      cardParts.refresh.disabled = false;
      cardParts.refresh.style.opacity = '1';
      cardParts.refresh.removeAttribute('aria-busy');
    }

    var active = density();
    cardParts.essentials.style.background = active === 'essentials' ? 'var(--card,#1b1b1b)' : 'transparent';
    cardParts.essentials.style.color = active === 'essentials' ? 'var(--foreground,#fff)' : 'var(--muted-foreground,#9a9a9a)';
    cardParts.full.style.background = active === 'full' ? 'var(--card,#1b1b1b)' : 'transparent';
    cardParts.full.style.color = active === 'full' ? 'var(--foreground,#fff)' : 'var(--muted-foreground,#9a9a9a)';
    cardParts.essentials.setAttribute('aria-pressed', active === 'essentials' ? 'true' : 'false');
    cardParts.full.setAttribute('aria-pressed', active === 'full' ? 'true' : 'false');
    var prefs = snippetPrefs();
    Object.keys(cardParts.fields).forEach(function (key) { cardParts.fields[key].checked = Boolean(prefs[key]); });

    positionCard();
  }

  function toggleCard(next) {
    if (!next || !last || !last.show) {
      open = false;
      if (card) card.style.display = 'none';
      if (pill) {
        pill.setAttribute('aria-expanded', 'false');
        if (last) {
          pill.setAttribute('aria-label', (stale ? 'Stale reading. ' : '') + last.aria + ' Open details.');
        }
      }
      return;
    }
    if (!card) buildCard();
    open = true;
    card.style.display = 'block';
    renderCard();
    if (pill) {
      pill.setAttribute('aria-expanded', 'true');
      pill.setAttribute('aria-label', last.aria + ' Close details.');
    }
    card.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- events

  window.__agmApply = function (payload) {
    var context = readContext();
    if (payload.show && payload.contextKey !== context.contextKey) return;
    if (payload.show && payload.modelKey !== (context.modelName || '')) return;
    localContext = context;
    last = payload;
    for (var key in pendingPrefs) {
      var actual = key === 'displayMode' ? payload.density : payload.snippetPrefs && payload.snippetPrefs[key];
      if (actual === pendingPrefs[key]) delete pendingPrefs[key];
    }
    lastUpdate = Date.now();
    if (stale) {
      stale = false;
      if (pill) pill.style.opacity = '1';
    }
    renderPill();
    if (open) renderCard();
  };

  window.__agmTakeRefresh = function () {
    var value = refreshRequested;
    refreshRequested = false;
    return value;
  };
  window.__agmTakeSettings = function () {
    var values = settingsQueue;
    settingsQueue = {};
    return values;
  };

  function checkConversation() {
    if (window.__agmOwner !== owner) return;
    var context = readContext();
    if (context.contextKey === localContext.contextKey) {
      if (context.modelName !== localContext.modelName && last && last.card) {
        localContext = context;
        last.card.quotaModel = context.modelName;
        last.card.session = null;
        last.card.limits = null;
        last.card.quotaStatus = 'unavailable';
        last.card.quotaGroup = 'Updating selected model';
        last.snippetValues = Object.assign({}, last.snippetValues, { fiveHour: '5h —', weekly: 'Week —', model: context.modelName, fiveHourReset: null, weeklyReset: null });
        renderPill();
        if (open) renderCard();
      }
      return;
    }
    localContext = context;
    var prior = last;
    last = waitingPayload(context.viewState, prior && prior.card && prior.card.app);
    last.contextKey = context.contextKey;
    last.snippetPrefs = prior && prior.snippetPrefs;
    renderPill();
    if (open) renderCard();
  }
  var contextTimer = setInterval(function () {
    if (window.__agmOwner !== owner) { clearInterval(contextTimer); return; }
    if (!document.hidden) checkConversation();
  }, 250);
  window.addEventListener('popstate', checkConversation);
  window.addEventListener('hashchange', checkConversation);
  window.addEventListener('focus', checkConversation);

  if (!window.__agmObserver) {
    var scheduled = false;
    window.__agmObserver = new MutationObserver(function () {
      scheduled = false;
      if (!last || !last.show) return;
      if (!pill || !pill.isConnected) renderPill();
    });
    window.__agmObserver.observe(document.body, { childList: true, subtree: true });
  }

  function checkStale() {
    if (!last || !last.show) return;
    var next = Date.now() - lastUpdate > STALE_MS;
    var nextQuotaStatus = quotaStatus(last.card);
    if (next === stale && nextQuotaStatus === window.__agmQuotaStatus && !(next && open)) return;
    window.__agmQuotaStatus = nextQuotaStatus;
    stale = next;
    if (pill) pill.style.opacity = stale ? '0.55' : '1';
    renderPill();
    if (open) renderCard();
  }

  var staleTimer = setInterval(function () {
    if (window.__agmOwner !== owner) { clearInterval(staleTimer); return; }
    checkStale();
  }, 1000);
  // A background window throttles timers to roughly once a minute, which is
  // exactly when a stale number must not be shown.
  document.addEventListener('visibilitychange', checkStale);
  window.addEventListener('focus', checkStale);
  window.addEventListener('resize', function () {
    if (open) positionCard();
  });
  document.addEventListener(
    'mousedown',
    function (event) {
      if (!open) return;
      if ((card && card.contains(event.target)) || (pill && pill.contains(event.target))) return;
      toggleCard(false);
    },
    true
  );
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && open) {
      toggleCard(false);
      if (pill) pill.focus({ preventScroll: true });
    }
  });

  return true;
})()`;

/** Minimal CDP client: one socket, correlated requests, hard timeouts. */
class CdpConnection {
  constructor(url, timeoutMs = 4000) {
    this.timeoutMs = timeoutMs;
    this.nextId = 0;
    this.pending = new Map();
    this.closed = false;
    this.onClose = null;
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connect timeout')), timeoutMs);
      this.socket.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      this.socket.onerror = (event) => {
        clearTimeout(timer);
        reject(new Error(`socket error: ${event.message ?? 'unknown'}`));
      };
    });
    this.socket.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      const waiter = this.pending.get(message.id);
      if (!waiter) {
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) {
        waiter.reject(new Error(message.error.message ?? 'cdp error'));
      } else {
        waiter.resolve(message.result);
      }
    };
    this.socket.onclose = () => {
      this.closed = true;
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('socket closed'));
      }
      this.pending.clear();
      if (typeof this.onClose === 'function') {
        this.onClose();
      }
    };
  }

  send(method, params) {
    if (this.closed) {
      return Promise.reject(new Error('socket closed'));
    }
    const id = (this.nextId += 1);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result && result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? 'evaluation failed');
    }
    return result && result.result ? result.result.value : undefined;
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // Already gone.
    }
  }
}

/** Candidate DevTools endpoints, most likely first. */
export function devtoolsEndpoints(env = process.env, platform = process.platform, home) {
  const appData = configRoot(env, platform, home);
  if (!appData) {
    return [];
  }
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  return [
    { app: 'app', file: join(appData, 'Antigravity', 'DevToolsActivePort') },
    { app: 'ide', file: join(appData, 'Antigravity IDE', 'DevToolsActivePort') },
    { app: 'vscode', file: join(appData, 'Code', 'DevToolsActivePort') },
  ];
}

export function devtoolsPortFiles(env = process.env, platform = process.platform, home) {
  return devtoolsEndpoints(env, platform, home).map((entry) => entry.file);
}

/** Parse `--cdp-port 9222,9223` without turning a typo into a random port. */
export function parsePortList(value) {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(',');
  const ports = [];
  for (const part of parts) {
    const port = Number(String(part).trim());
    if (Number.isInteger(port) && port >= 1 && port <= 65535 && !ports.includes(port)) {
      ports.push(port);
    }
  }
  return ports;
}

export function readDevtoolsPort(file) {
  try {
    const first = fs.readFileSync(file, 'utf8').split(/\r?\n/)[0].trim();
    const port = Number(first);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

/**
 * Read from the page: which backend serves it, which conversation is open, and
 * which product hosts it. The page URL is the language server's own origin for
 * the composer, so the port mapping is exact rather than a guess.
 */
/** Read only the visible route and selected navigation, never conversation text. */
export function readRendererContext() {
  const url = new URL(location.href);
  const route = url.hash.startsWith('#/') ? url.hash.slice(1) : url.pathname;
  const direct = /\/c\/([0-9a-f-]{8,})(?:[/?#]|$)/i.exec(route);
  const query = url.searchParams.get('conversationId');
  let conversationId = direct ? direct[1] : query && /^[0-9a-f-]{8,}$/i.test(query) ? query : null;
  const composer = !!document.querySelector('[data-testid="agent-input-box"]');
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  const newThread = composer && local && /^\/(?:new|new-chat|chat\/new)?\/?$/.test(route);
  if (!conversationId && !newThread) {
    const selected = document.querySelector('[aria-current="page"][href*="/c/"], [data-conversation-id][data-active="true"]');
    if (selected) {
      const value = selected.getAttribute('data-conversation-id') || selected.getAttribute('href') || '';
      const match = /(?:^|\/c\/)([0-9a-f-]{8,})(?:[/?#]|$)/i.exec(value);
      conversationId = match ? match[1] : null;
    }
  }
  let port = local ? Number(url.port) || null : null;
  if (!port) {
    const counts = new Map();
    for (const entry of performance.getEntriesByType('resource')) {
      const match = /^https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)\//.exec(entry.name);
      if (match) counts.set(Number(match[1]), (counts.get(Number(match[1])) || 0) + 1);
    }
    port = [...counts].sort((left, right) => right[1] - left[1])[0]?.[0] || null;
  }
  const viewState = conversationId ? 'conversation' : newThread ? 'new-thread' : 'unknown';
  const key = viewState + ':' + (conversationId || route);
  let hash = 0;
  for (let index = 0; index < key.length; index++) hash = ((hash << 5) - hash + key.charCodeAt(index)) | 0;
  const modelName = document.querySelector('[data-testid="model-selector-trigger"]')?.textContent?.trim().slice(0, 160) || null;
  return { port, conversationId, viewState, contextKey: String(hash), modelName, productName: window.__APP_CONFIG__?.productName || null };
}

export const RENDERER_CONTEXT = `(${readRendererContext.toString()})()`;

/** A missing conversation is a named state, never a fabricated measurement. */
export function selectionPayload(viewState, app = null) {
  const fresh = viewState === 'new-thread';
  const title = fresh ? 'New thread' : viewState === 'conversation' ? 'Switching conversation' : 'Conversation not identified';
  return {
    show: true, density: 'full', essentials: title, full: title, color: 'currentColor', title, aria: title,
    card: {
      app: app || 'Antigravity', title, percent: null, percentText: fresh ? 'Ready' : 'Waiting', color: 'currentColor',
      sourceLabel: fresh ? 'On screen' : 'Detecting',
      volumeText: fresh ? 'Context appears after the first response.' : 'Waiting for this conversation’s reading.',
      remainingText: null, model: null, session: null, limits: null, updatedText: 'No reading yet',
    },
  };
}

/** Never substitute another conversation when the renderer has an explicit selection. */
export function rendererPayload(snapshot, instance, context, _legacyLimits = null) {
  const app = appName(instance.backend.app);
  const scoped = { ...snapshot, conversation: instance.conversation, backend: instance.backend,
    quota: instance.quota || (snapshot.backend?.id === instance.backend.id ? snapshot.quota : undefined) };
  const matches = context.viewState === 'conversation' && instance.conversation && instance.conversation.id === context.conversationId;
  const payload = matches
    ? toPayload(scoped, null, app, context.modelName)
    : selectionPayload(context.viewState, app);
  if (!payload.show) Object.assign(payload, selectionPayload('conversation', app));
  if (!matches || payload.card.percent === null) decorateQuota(payload, scoped, context.modelName || instance.conversation?.modelName);
  payload.snippetPrefs = snippetPreferences(snapshot.prefs || {});
  payload.density = snapshot.prefs?.displayMode || 'full';
  payload.contextKey = context.contextKey;
  payload.modelKey = context.modelName || '';
  return payload;
}

export function appFromProductName(name) {
  const value = String(name ?? '').toLowerCase();
  if (!value) {
    return null;
  }
  if (value.includes('antigravity ide')) {
    return 'ide';
  }
  if (value.includes('visual studio code') || value === 'code') {
    return 'vscode';
  }
  if (value.includes('antigravity')) {
    return 'app';
  }
  return null;
}

export function conversationIdFromUrl(url) {
  const value = String(url ?? '');
  const direct = /\/c\/([0-9a-f-]{8,})/i.exec(value);
  if (direct) {
    return direct[1];
  }
  const query = /[?&]conversationId=([0-9a-f-]{8,})/i.exec(value);
  return query ? query[1] : null;
}

/** Map one renderer to the backend instance it is actually talking to. */
export function chooseInstance(snapshot, hint = {}) {
  const instances = snapshot && Array.isArray(snapshot.instances) ? snapshot.instances : [];
  if (instances.length === 0) {
    return null;
  }

  if (Number.isInteger(hint.backendPort)) {
    const byPort = instances.find(
      (entry) => entry.backend && entry.backend.port === hint.backendPort && entry.backend.reachable !== false,
    );
    if (byPort) {
      return byPort;
    }
  }

  if (hint.conversationId) {
    const byConversation = instances.find(
      (entry) => entry.conversation && entry.conversation.id === hint.conversationId,
    );
    if (byConversation) {
      return byConversation;
    }
  }

  const owner = hint.appHint;
  if (owner && owner !== 'unknown') {
    const matches = instances.filter(
      (entry) => entry.backend && entry.backend.app === owner && entry.backend.reachable !== false,
    );
    if (matches.length === 1) {
      return matches[0];
    }
  }

  // With one installation, a missing mapping cannot mean "another app".
  return instances.length === 1 ? instances[0] : null;
}

function appName(app) {
  switch (app) {
    case 'app':
      return 'Antigravity';
    case 'ide':
      return 'Antigravity IDE';
    case 'vscode':
      return 'VS Code';
    default:
      return 'Unknown app';
  }
}

/**
 * Attach to every renderer that exposes the composer, and push each one the
 * picture of its own backend. Several hosts can run at once; a shared push would
 * make the desktop badge report the IDE's conversation.
 */
export class BadgeInjector {
  constructor(options = {}) {
    this.logger = options.logger ?? (() => {});
    this.explicitPorts = parsePortList(options.ports ?? options.port ?? []);
    this.latest = null;
    this.renderers = new Map();
    this.connecting = false;
    this.connectAt = 0;
    this.pumping = false;
    this.disposed = false;
    this.describeAttempted = false;
    this.onUpdateSetting = options.onUpdateSetting ?? (() => {});
    this.onObserved = options.onObserved ?? (() => {});
    this.onRefresh = options.onRefresh ?? (() => {});
    this.checkingRefresh = false;
    this.heartbeat = setInterval(() => {
      void this.pump();
    }, 10_000);
    this.heartbeat.unref?.();
    this.refreshTimer = setInterval(() => {
      void this.checkRefresh();
    }, 750);
    this.refreshTimer.unref?.();
  }

  /** Feed the newest snapshot; every attached renderer gets its own slice. */
  update(snapshot) {
    this.latest = snapshot;
    if (!this.disposed) {
      void this.pump();
    }
  }

  async pump() {
    if (this.disposed || this.pumping) {
      return;
    }
    this.pumping = true;
    try {
      await this.ensureConnections();
      for (const renderer of [...this.renderers.values()]) {
        try {
          await this.push(renderer);
        } catch {
          this.drop(renderer.key);
        }
      }
    } catch (error) {
      this.logger(`Badge: scan failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.pumping = false;
    }
  }

  /**
   * The card cannot reach the companion directly, so it leaves a flag in the
   * page. Read it on a short cadence; a refresh should not wait for the next
   * snapshot or heartbeat.
   */
  async checkRefresh() {
    if (this.disposed || this.checkingRefresh) {
      return;
    }
    this.checkingRefresh = true;
    try {
      for (const renderer of [...this.renderers.values()]) {
        let requested = false;
        try {
          await this.push(renderer);
          requested = (await renderer.connection.evaluate(
            'window.__agmTakeRefresh ? window.__agmTakeRefresh() : false',
          )) === true;
          const settings = await renderer.connection.evaluate('window.__agmTakeSettings ? window.__agmTakeSettings() : {}');
          if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
            for (const [key, value] of Object.entries(settings)) this.onUpdateSetting(key, value);
          }
        } catch {
          continue;
        }
        if (requested) {
          this.onRefresh();
        }
      }
    } finally {
      this.checkingRefresh = false;
    }
  }

  async ensureConnections() {
    if (this.disposed || this.connecting || Date.now() < this.connectAt) {
      return;
    }
    this.connecting = true;
    try {
      const endpoints = devtoolsEndpoints()
        .map((entry) => ({ port: readDevtoolsPort(entry.file), app: entry.app }))
        .filter((entry) => entry.port);
      for (const port of this.explicitPorts) {
        if (!endpoints.some((entry) => entry.port === port)) {
          endpoints.push({ port, app: null });
        }
      }

      if (endpoints.length === 0) {
        if (!this.describeAttempted) {
          this.describeAttempted = true;
          this.logger(
            'Badge: no DevTools endpoint found; launch a host with --remote-debugging-port to enable its badge',
          );
        }
        this.connectAt = Date.now() + 30_000;
        return;
      }

      for (const endpoint of endpoints) {
        await this.attachPort(endpoint.port, endpoint.app);
      }
      this.connectAt = Date.now() + 10_000;
    } finally {
      this.connecting = false;
    }
  }

  async attachPort(port, appHint) {
    const targets = await this.listTargets(port);
    const alive = new Set();

    for (const target of targets) {
      if (!target.webSocketDebuggerUrl) {
        continue;
      }
      const key = `${port}:${target.id}`;
      alive.add(key);
      if (this.renderers.has(key)) {
        continue;
      }

      const connection = new CdpConnection(target.webSocketDebuggerUrl);
      try {
        await connection.ready;
        if ((await connection.evaluate(PROBE)) !== true) {
          connection.close();
          continue;
        }
        await connection.evaluate(INSTALL);
        const renderer = {
          key,
          appHint,
          connection,
          target,
          backendPort: null,
          app: null,
          observed: null,
          viewState: 'unknown',
          contextKey: null,
          modelName: null,
          contextAt: 0,
          limitsAt: 0,
          shown: null,
        };
        connection.onClose = () => this.drop(key);
        await this.refreshContext(renderer);
        if (connection.closed) {
          continue;
        }
        this.renderers.set(key, renderer);
        this.logger(
          `Badge: attached to ${target.title || target.url || 'renderer'} on port ${port}` +
            `${appHint ? ` (${appHint})` : ''}`,
        );
        if (this.latest) {
          await this.push(renderer);
        }
      } catch {
        connection.close();
      }
    }

    // A closed window leaves its target behind; drop the stale renderer so the
    // page can attach cleanly when the user reopens it.
    for (const key of [...this.renderers.keys()]) {
      if (key.startsWith(`${port}:`) && !alive.has(key)) {
        this.drop(key);
      }
    }
  }

  async refreshContext(renderer) {
    if (Date.now() - renderer.contextAt < 500) {
      return;
    }
    renderer.contextAt = Date.now();

    let context;
    try {
      context = await renderer.connection.evaluate(RENDERER_CONTEXT);
    } catch {
      this.drop(renderer.key);
      return;
    }
    if (!context || typeof context !== 'object') {
      return;
    }

    const port = Number(context.port);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) {
      renderer.backendPort = port;
    }
    const owner = appFromProductName(context.productName);
    if (owner && !renderer.appHint) {
      // The DevTools port file already names the product; the page is only a
      // fallback for an explicitly supplied port.
      renderer.app = owner;
    }

    const conversationId = typeof context.conversationId === 'string' ? context.conversationId : null;
    renderer.observed = conversationId;
    renderer.viewState = context.viewState || 'unknown';
    renderer.contextKey = context.contextKey;
    renderer.modelName = typeof context.modelName === 'string' ? context.modelName : null;
    if (renderer.backendPort) {
      // A null reading is meaningful: a new-chat page must not keep showing the
      // previous conversation.
      this.onObserved(renderer.backendPort, conversationId, renderer.viewState);
    }
  }

  async push(renderer) {
    if (!this.latest) {
      return;
    }
    await this.refreshContext(renderer);
    if (!this.renderers.has(renderer.key)) {
      return;
    }

    const instance = chooseInstance(this.latest, {
      backendPort: renderer.backendPort,
      appHint: renderer.app ?? renderer.appHint,
      conversationId: renderer.observed,
    });
    if (!instance) {
      if (renderer.shown !== false) {
        renderer.shown = false;
        await renderer.connection.evaluate('window.__agmApply({show:false})');
        this.logger(`Badge: ${renderer.key} has no matching backend; hidden`);
      }
      return;
    }

    const payload = rendererPayload(this.latest, instance, {
      viewState: renderer.viewState, conversationId: renderer.observed, contextKey: renderer.contextKey, modelName: renderer.modelName,
    });
    await renderer.connection.evaluate(`window.__agmApply(${JSON.stringify(payload)})`);
    renderer.shown = payload.show !== false;
  }

  drop(key) {
    const renderer = this.renderers.get(key);
    if (!renderer) {
      return;
    }
    this.renderers.delete(key);
    try {
      renderer.connection.close();
    } catch {
      // Already gone.
    }
  }

  async listTargets(port) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
      if (!response.ok) {
        return [];
      }
      const targets = await response.json();
      return Array.isArray(targets) ? targets : [];
    } catch {
      return [];
    }
  }

  stop() {
    this.disposed = true;
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    for (const key of [...this.renderers.keys()]) {
      this.drop(key);
    }
  }
}

/**
 * Translate a snapshot into the strings the pill and card render.
 *
 * Only display values cross the bridge: no token, no conversation id, no path.
 * Both densities are sent, so a click never needs another round trip, and the
 * card is pre-formatted so the injected script holds no formatting rules.
 */
export function toPayload(snapshot, _legacyLimits = null, app = null, modelNameOverride = null) {
  const conversation = snapshot && snapshot.conversation;
  const usage = conversation && conversation.usage;
  if (!usage || usage.percent === null || usage.percent === undefined) {
    return { show: false };
  }

  const percent = Math.round(usage.percent * 10) / 10;
  const percentText = percent >= 100 ? '100%' : `${percent.toFixed(1).replace(/\.0$/, '')}%`;
  const estimated = usage.source === 'estimated';
  const prefix = estimated ? '~' : '';
  const threshold = (snapshot.prefs && snapshot.prefs.warningThreshold) || 80;
  const color = usage.percent >= 95 ? '#e5534b' : usage.percent >= threshold ? '#d29922' : 'currentColor';
  const model = conversation.modelName || 'Unknown model';
  const remaining =
    typeof usage.remaining === 'number' && Number.isFinite(usage.remaining)
      ? ` · ${format(usage.remaining)} left`
      : '';

  const payload = {
    show: true,
    density: snapshot.prefs?.displayMode || 'full',
    essentials: `${prefix}${percentText}`,
    full: `${prefix}${percentText}${remaining}`,
    color,
    title: `Context ${format(usage.used)} / ${format(usage.capacity)} (${percentText}) · ${model} · ${
      estimated ? 'estimated' : 'measured'
    } · ${app ? `${app} · ` : ''}${conversation.title}`,
    aria: `Context window ${percentText} used`,
    card: {
      app: app || null,
      title: conversation.title,
      percent,
      percentText,
      color,
      sourceLabel: estimated ? 'Estimated' : 'Measured',
      volumeText: `${format(usage.used)} / ${format(usage.capacity)}`,
      remainingText:
        typeof usage.remaining === 'number' && Number.isFinite(usage.remaining)
          ? `${format(usage.remaining)} left`
          : null,
      model,
      session: null,
      limits: null,
      updatedText: timeOf(usage.measuredAt || snapshot.generatedAt),
    },
  };
  payload.snippetPrefs = snippetPreferences(snapshot.prefs || {});
  decorateQuota(payload, snapshot, modelNameOverride || model);
  return payload;
}

function decorateQuota(payload, snapshot, modelName) {
  const quota = quotaAt(snapshot.quota || { groups: [], observedAt: null, status: 'unavailable', error: null });
  const group = resolveQuotaGroup(quota.groups, modelName);
  const session = quotaBucket(quota, modelName, '5h');
  const weekly = quotaBucket(quota, modelName, 'weekly');
  const display = (bucket) => bucket ? { percent: bucket.percent, resetText: countdown(bucket.resetsAt) } : null;
  payload.card.session = display(session);
  payload.card.limits = weekly ? { weekly: display(weekly) } : null;
  payload.card.quotaStatus = quota.status;
  payload.card.quotaGroup = group?.label || 'Quota group not identified';
  payload.card.quotaCheckedText = quota.observedAt ? timeOf(quota.observedAt) : null;
  payload.card.quotaObservedAt = quota.observedAt;
  payload.card.quotaModel = modelName || null;
  const differentModel = payload.card.model && modelName &&
    payload.card.model.toLowerCase().replace(/[^a-z0-9]/g, '') !== modelName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (differentModel) {
    payload.title += ' · Context measured with ' + payload.card.model + '; quota for ' + modelName;
    payload.aria += '. Context measured with ' + payload.card.model + '; quota for ' + modelName;
  }
  const prefix = quota.status === 'cached' ? '~' : '';
  payload.snippetValues = {
    context: payload.card.percent === null ? payload.full : (differentModel ? 'Last ' : '') + (payload.card.sourceLabel === 'Estimated' ? '~' : '') + payload.card.percentText,
    remaining: payload.card.remainingText,
    fiveHour: session ? prefix + '5h ' + formatPercent(session.percent) : '5h —',
    weekly: weekly ? prefix + 'Week ' + formatPercent(weekly.percent) : 'Week —',
    model: modelName || null,
    fiveHourReset: session ? countdown(session.resetsAt) : null,
    weeklyReset: weekly ? countdown(weekly.resetsAt) : null,
  };
}

function formatPercent(value) {
  return (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, '') + '%';
}

/**
 * Age a cached weekly reading.
 *
 * The Settings panel reports a countdown, not an absolute reset time. Once the
 * panel closes, the only honest thing to do is subtract the time that passed
 * since it was read; when the countdown reaches zero the reading is gone.
 */
function agedLimit(limit, readAt) {
  if (!limit || typeof limit.percent !== 'number') {
    return null;
  }
  if (!limit.resetText || !Number.isFinite(readAt)) {
    return limit;
  }
  const minutes = parseReset(limit.resetText);
  if (minutes === null) {
    return limit;
  }
  const left = minutes - Math.max(0, Math.floor((Date.now() - readAt) / 60_000));
  if (left <= 0) {
    return null;
  }
  return { percent: limit.percent, resetText: formatReset(left) };
}

function parseReset(text) {
  const value = String(text ?? '').trim();
  if (!value) {
    return null;
  }
  const days = /(\d+)\s*d/.exec(value);
  const hours = /(\d+)\s*h/.exec(value);
  const minutes = /(\d+)\s*m/.exec(value);
  if (!days && !hours && !minutes) {
    return null;
  }
  return Number(days ? days[1] : 0) * 1440 + Number(hours ? hours[1] : 0) * 60 + Number(minutes ? minutes[1] : 0);
}

function formatReset(totalMinutes) {
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  return parts.length ? parts.join(' ') : 'under a minute';
}

function sessionLimit(modelRow) {
  if (!modelRow || typeof modelRow.quotaPercent !== 'number' || !Number.isFinite(modelRow.quotaPercent)) {
    return null;
  }
  return {
    percent: modelRow.quotaPercent,
    resetText: countdown(modelRow.resetsAt),
  };
}

/**
 * Parse the Settings panel's limit rows.
 *
 * Rows arrive as plain text: the label, the app's own sentence, then the
 * percentage. When several rows describe the same window the lowest remaining
 * wins, because that is the limit that constrains the work.
 */
export function parseQuotaRows(rows) {
  if (!Array.isArray(rows)) {
    return null;
  }
  let session = null;
  let weekly = null;

  for (const text of rows) {
    if (typeof text !== 'string') {
      continue;
    }
    const isWeekly = /weekly(?:\s+(?:usage|quota|limit))?|7[- ]day\s+(?:limit|quota)/i.test(text);
    const isSession = /\b(?:five|5)[- ]hour\b(?:\s+(?:usage|quota|limit))?/i.test(text);
    const kind = isWeekly && !isSession ? 'weekly' : isSession && !isWeekly ? 'session' : null;
    if (!kind) {
      continue;
    }
    const matches = [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*%/g)];
    if (matches.length !== 1) {
      continue;
    }
    const value = Number(matches[0][1]);
    if (!Number.isFinite(value) || value < 0 || value > 100) continue;
    const used = /\d+(?:\.\d+)?\s*%\s*(?:used|consumed)|(?:used|consumed)\s*:?\s*\d+(?:\.\d+)?\s*%/i.test(text);
    const remaining = /remaining|left|available/i.test(text);
    if (!used && !remaining) continue;
    const entry = { percent: used ? 100 - value : value, resetText: shortReset(text) };
    if (kind === 'weekly') {
      weekly = lowest(weekly, entry);
    } else {
      session = lowest(session, entry);
    }
  }

  return session || weekly ? { session, weekly } : null;
}

function lowest(current, candidate) {
  return !current || candidate.percent < current.percent ? candidate : current;
}

function shortReset(text) {
  const phrase = text.match(/(?:refresh(?:es)?|reset(?:s)?|renew(?:s)?)\s+in\s+(.+)/i);
  if (!phrase) {
    return null;
  }
  const parts = [];
  const days = phrase[1].match(/(\d+)\s*d(?:ays?)?\b/i);
  const hours = phrase[1].match(/(\d+)\s*h(?:ours?|rs?)?\b/i);
  const minutes = phrase[1].match(/(\d+)\s*m(?:inutes?|ins?)?\b/i);
  if (days) {
    parts.push(`${days[1]}d`);
  }
  if (hours) {
    parts.push(`${hours[1]}h`);
  }
  if (minutes) {
    parts.push(`${minutes[1]}m`);
  }
  return parts.length ? parts.join(' ') : null;
}

function countdown(iso) {
  if (!iso) {
    return null;
  }
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) {
    return null;
  }
  const minutes = Math.floor((target - Date.now()) / 60000);
  if (minutes < 1) {
    return 'under a minute';
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  }
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function timeOf(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function format(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'unknown';
  }
  if (Math.abs(value) < 1000) {
    return String(Math.round(value));
  }
  if (Math.abs(value) < 1_000_000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return `${(value / 1_000_000).toFixed(1)}M`;
}
