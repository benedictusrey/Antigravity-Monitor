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
const { formatRate } = require('../out/src/core/format.js');
const { RpcError, SERVICE_PATH } = require('../out/src/core/rpc.js');

export const PROBE = `(function(){
  if (typeof location !== 'undefined') {
    var proto = location.protocol || '';
    var host = location.hostname || '';
    var isLocal = ['127.0.0.1', 'localhost', '[::1]', ''].includes(host) || proto === 'vscode-webview:' || proto === 'vscode-file:' || proto === 'file:';
    if (!isLocal) return false;
  }
  if (typeof window !== 'undefined' && window.__APP_CONFIG__ && /antigravity/i.test(String(window.__APP_CONFIG__.productName || '')) && typeof location !== 'undefined' && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) return true;
  if (document.querySelector('[data-testid="agent-input-box"], [data-testid="conversation-view"], [data-testid*="composer"], [data-testid*="chat-input"], [data-testid="model-selector-trigger"], [data-testid="permissions-selector-trigger"]')) return true;
  if (document.querySelector('[contenteditable="true"][aria-label*="Ask" i], [contenteditable="true"][data-placeholder*="Ask" i], textarea[placeholder*="Ask" i], [aria-label*="chat input" i]')) return true;
  if (!document.querySelector('[contenteditable="true"], textarea')) return false;
  var btns = document.querySelectorAll('button, [role="button"]');
  for (var i = 0; i < btns.length; i++) {
    var t = (btns[i].textContent || '').trim();
    if (/^(?:Turbo|Auto|Manual|Ask before edit|Orchestrator\\b|Gemini\\b|Claude\\b|GPT\\b|Argon\\b|Neon\\b|Hydrogen\\b|Carbon\\b|Opus\\b|Sonnet\\b)/i.test(t) && t.length <= 48) return true;
  }
  return false;
})()`;

/** Bump when the injected script changes; the guard below is built from it. */
const VERSION = 32;

export const SIDE_PANEL_OPENER = `function openMonitorInSidePanel(targetUrl) {
    var url = targetUrl || 'http://127.0.0.1:4599';
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function isExcludedContainer(el) {
      return !el || Boolean(el.closest('[data-agm-badge], [data-agm-card], [data-testid="conversation-view"], [data-testid="plugins-section"]'));
    }
    function findSidePanelMonitorTab() {
      var newTabBtn = document.querySelector('[data-testid="side-panel-new-tab-button"]');
      var tabStrip = newTabBtn && newTabBtn.parentElement;
      var tabs = (tabStrip || document).querySelectorAll('button, [role="tab"]');
      for (var i = 0; i < tabs.length; i++) {
        var el = tabs[i];
        if (isExcludedContainer(el)) continue;
        if (el.offsetParent === null) continue;
        var label = ((el.getAttribute('title') || el.textContent || '')).trim();
        if (label !== 'Antigravity Monitor') continue;
        if (tabStrip && tabStrip.contains(el)) return el;
        var closeBtn = el.parentElement && el.parentElement.querySelector('button[aria-label="Close Antigravity Monitor"]');
        if (closeBtn) return el;
        if (typeof el.getBoundingClientRect === 'function') {
          var rect = el.getBoundingClientRect();
          if (rect.top >= 0 && rect.top < 120 && rect.left > 320) return el;
        }
      }
      return null;
    }
    function findSidebarPluginItem() {
      var items = document.querySelectorAll('[data-testid="plugin-sidebar-mcp-app-item"], [data-testid="plugins-section"] a, [data-testid="plugins-section"] button');
      for (var i = 0; i < items.length; i++) {
        var el = items[i];
        if (!el || el.offsetParent === null) continue;
        var text = (el.textContent || '').trim();
        if (text === 'Antigravity Monitor') return el;
      }
      return null;
    }
    function findPluginLauncherInSidePanel() {
      var items = document.querySelectorAll('button, [role="menuitem"], [role="option"], a');
      for (var i = 0; i < items.length; i++) {
        var el = items[i];
        if (isExcludedContainer(el) || el.offsetParent === null) continue;
        if (typeof el.getBoundingClientRect === 'function' && el.getBoundingClientRect().top < 90) continue;
        var tid = el.getAttribute('data-testid') || '';
        var text = (el.textContent || '').trim();
        if (text === 'Antigravity Monitor' || /antigravity-monitor/i.test(tid)) return el;
      }
      return null;
    }
    function setUrlAndSubmit(input) {
      var desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (desc && desc.set) desc.set.call(input, url);
      else input.value = url;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (input.form && typeof input.form.requestSubmit === 'function') {
        input.form.requestSubmit();
      } else if (input.form) {
        input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      } else {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }
    }
    function findBrowserCard() {
      var direct = document.querySelector('[data-testid="new-tab-card-new-preview"]');
      if (direct && direct.offsetParent !== null) return direct;
      var items = document.querySelectorAll('button, [role="menuitem"], [role="option"]');
      for (var m = 0; m < items.length; m++) {
        var el = items[m];
        if (isExcludedContainer(el) || el.offsetParent === null) continue;
        if (/^browser$/i.test((el.textContent || '').trim())) return el;
      }
      return null;
    }
    return (async function () {
      var existing = findSidePanelMonitorTab();
      if (existing) {
        existing.click();
        return 'focused';
      }
      var sidebarPlugin = findSidebarPluginItem();
      if (sidebarPlugin) {
        sidebarPlugin.click();
        return 'plugin-window';
      }
      var toggle = document.querySelector('[data-testid="toggle-aux-sidebar"]');
      if (toggle && (toggle.getAttribute('aria-expanded') === 'false' || toggle.getAttribute('aria-pressed') === 'false')) {
        toggle.click();
        await sleep(180);
      }
      existing = findSidePanelMonitorTab();
      if (existing) {
        existing.click();
        return 'focused';
      }
      var pluginCard = findPluginLauncherInSidePanel();
      if (pluginCard) {
        pluginCard.click();
        return 'plugin-panel';
      }
      var urlInput = document.querySelector('[data-testid="browser-url-input"]');
      if (urlInput && (!urlInput.value || urlInput.value === 'about:blank')) {
        setUrlAndSubmit(urlInput);
        return 'navigated';
      }
      var browserCard = findBrowserCard();
      if (!browserCard) {
        var newTab = document.querySelector('[data-testid="side-panel-new-tab-button"]');
        if (newTab) {
          newTab.click();
          for (var w = 0; w < 12; w++) {
            await sleep(60);
            pluginCard = findPluginLauncherInSidePanel();
            if (pluginCard) {
              pluginCard.click();
              return 'plugin-panel';
            }
            browserCard = findBrowserCard();
            if (browserCard) break;
          }
        }
      }
      if (browserCard) {
        browserCard.click();
      }
      for (var attempt = 0; attempt < 22; attempt++) {
        await sleep(75);
        urlInput = document.querySelector('[data-testid="browser-url-input"]');
        if (urlInput) {
          setUrlAndSubmit(urlInput);
          return 'opened';
        }
      }
      return 'unavailable';
    })();
  }`;

export const INSTALL = `(function () {
  if (window.__agmVersion === ${VERSION}) return true;
  window.__agmVersion = ${VERSION};

  if (window.__agmAbort) {
    try { window.__agmAbort.abort(); } catch (_) {}
  }
  var ac = typeof AbortController === 'function' ? new AbortController() : null;
  window.__agmAbort = ac;
  var listenOpts = ac ? { signal: ac.signal } : undefined;
  var captureOpts = ac ? { capture: true, signal: ac.signal } : true;

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
  var emailRevealed = null;
  var refreshRequested = false;
  var copyTimer = null;
  var pendingPrefs = {};
  var settingsQueue = {};

  function snippetPrefs() {
    return Object.assign({ snippetContext: true, snippetRemaining: true, snippetFiveHour: false,
      snippetWeekly: false, snippetModel: false, snippetResets: false, snippetTokPerSec: false }, last && last.snippetPrefs, pendingPrefs);
  }

  function queueSetting(key, value) {
    pendingPrefs[key] = value;
    settingsQueue[key] = value;
  }

  function setPreset(value) {
    queueSetting('displayMode', value);
    var values = { snippetContext: true, snippetRemaining: value === 'full', snippetFiveHour: false,
      snippetWeekly: false, snippetModel: false, snippetResets: false, snippetTokPerSec: false };
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
      'border:1px solid transparent',
      'transition:background-color 150ms cubic-bezier(0.2,0.8,0.2,1),border-color 150ms cubic-bezier(0.2,0.8,0.2,1),transform 90ms cubic-bezier(0.2,0.8,0.2,1),opacity 160ms ease'
    ].join(';');
    if (reducedMotion) pill.style.transition = 'none';

    dot = mk('span', 'width:6px;height:6px;border-radius:50%;background:currentColor;flex:0 0 auto;transition:background-color 180ms ease');
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
      if (!stale) {
        pill.style.backgroundColor = 'var(--secondary,rgba(255,255,255,0.08))';
        pill.style.borderColor = 'var(--border,rgba(255,255,255,0.12))';
      }
    });
    pill.addEventListener('mouseleave', function () {
      if (pill.hasAttribute('data-agm-floating')) {
        pill.style.backgroundColor = 'var(--card,rgba(27,27,27,0.92))';
        pill.style.borderColor = 'var(--border,rgba(255,255,255,0.14))';
      } else {
        pill.style.backgroundColor = 'transparent';
        pill.style.borderColor = 'transparent';
      }
      if (!reducedMotion) pill.style.transform = 'scale(1)';
    });
    pill.addEventListener('pointerdown', function () {
      if (!reducedMotion) pill.style.transform = 'scale(0.985)';
    });
    pill.addEventListener('pointerup', function () {
      if (!reducedMotion) pill.style.transform = 'scale(1)';
    });
    pill.addEventListener('focus', function () {
      pill.style.outline = '1px solid var(--ring,#4daafc)';
      pill.style.outlineOffset = '2px';
    });
    pill.addEventListener('blur', function () {
      pill.style.outline = 'none';
    });
  }

  function setFloating(floating) {
    if (!pill) return;
    if (floating) {
      pill.setAttribute('data-agm-floating', '1');
      pill.style.position = 'fixed';
      pill.style.bottom = '14px';
      pill.style.right = '16px';
      pill.style.zIndex = '2147482999';
      pill.style.backgroundColor = 'var(--card,rgba(27,27,27,0.92))';
      pill.style.borderColor = 'var(--border,rgba(255,255,255,0.14))';
      pill.style.boxShadow = '0 4px 14px rgba(0,0,0,0.28)';
    } else if (pill.hasAttribute('data-agm-floating')) {
      pill.removeAttribute('data-agm-floating');
      pill.style.position = '';
      pill.style.bottom = '';
      pill.style.right = '';
      pill.style.zIndex = '';
      pill.style.backgroundColor = 'transparent';
      pill.style.borderColor = 'transparent';
      pill.style.boxShadow = '';
    }
  }

  function placePill() {
    var turbo = document.querySelector('[data-testid="permissions-selector-trigger"]');
    var group = turbo && turbo.parentElement;
    if (group && group.parentElement) {
      setFloating(false);
      if (pill.parentElement !== group.parentElement || pill.nextSibling !== group) {
        group.parentElement.insertBefore(pill, group);
      }
      return true;
    }
    var footer = document.querySelector('.agy-composer-footer');
    var rightGroup = footer && footer.lastElementChild;
    if (footer && rightGroup && rightGroup !== pill && footer.children.length >= 2) {
      setFloating(false);
      if (pill.parentElement !== footer || pill.nextSibling !== rightGroup) {
        footer.insertBefore(pill, rightGroup);
      }
      return true;
    }
    var model = document.querySelector('[data-testid="model-selector-trigger"], [data-testid*="model-selector"], [data-testid*="model-picker"], button[aria-label*="Model" i]');
    var bar = model && model.parentElement && model.parentElement.parentElement;
    if (bar && model.parentElement) {
      setFloating(false);
      if (pill.parentElement !== bar) {
        bar.insertBefore(pill, model.parentElement.nextSibling);
      }
      return true;
    }
    // Tier 3: button text heuristic when data-testid attributes change.
    var buttons = document.querySelectorAll('button, [role="button"]');
    var tiers = [/^(?:Turbo|Auto|Manual|Ask before edit|Plan|Fast)\b/i, /^(?:Orchestrator|Gemini|Claude|GPT|Argon|Neon|Hydrogen|Carbon|Opus|Sonnet)\b/i];
    for (var pass = 0; pass < tiers.length; pass++) {
      for (var i = 0; i < buttons.length; i++) {
        var btn = buttons[i];
        if (!btn || btn === pill || btn.offsetParent === null || btn.closest('[data-agm-badge], [data-agm-card]')) continue;
        var txt = (btn.textContent || '').trim();
        if (!tiers[pass].test(txt) || txt.length > 48) continue;
        var row = btn.parentElement;
        for (var hop = 0; hop < 3 && row; hop++) {
          if (row.offsetHeight > 0 && row.offsetHeight <= 72 && row.offsetWidth > btn.offsetWidth + 20 && row.querySelectorAll('button, [role="button"]').length >= 2) {
            var child = btn;
            while (child && child.parentElement !== row) child = child.parentElement;
            if (child) {
              setFloating(false);
              if (pill.parentElement !== row || pill.nextSibling !== child) {
                row.insertBefore(pill, child);
              }
            }
            return true;
          }
          row = row.parentElement;
        }
      }
    }
    // Tier 4: structural composer-toolbar heuristic for future UI redesigns.
    var input = document.querySelector('[data-testid="agent-input-box"], [data-testid*="composer"], [data-testid*="chat-input"], [contenteditable="true"], textarea');
    if (input && input.offsetParent !== null) {
      var box = input.parentElement;
      for (var depth = 0; depth < 5 && box && box !== document.body; depth++) {
        if (box.offsetHeight >= 48 && box.offsetHeight <= 360) {
          var candidates = box.querySelectorAll('div, footer, section');
          for (var c = candidates.length - 1; c >= 0; c--) {
            var barEl = candidates[c];
            if (!barEl || barEl === pill || barEl.closest('[data-agm-badge], [data-agm-card]')) continue;
            if (barEl.offsetHeight > 0 && barEl.offsetHeight <= 72 && barEl.offsetWidth >= 140) {
              var barBtns = barEl.querySelectorAll('button, [role="button"]');
              if (barBtns.length >= 2) {
                setFloating(false);
                if (pill.parentElement !== barEl) {
                  barEl.appendChild(pill);
                }
                return true;
              }
            }
          }
        }
        box = box.parentElement;
      }
    }
    // Tier 5: non-intrusive floating corner dock on verified Antigravity app pages when no toolbar anchor exists.
    var isAgPage = typeof window !== 'undefined' && window.__APP_CONFIG__ && /antigravity/i.test(String(window.__APP_CONFIG__.productName || ''));
    if (isAgPage && document.body) {
      setFloating(true);
      if (pill.parentElement !== document.body) {
        document.body.appendChild(pill);
      }
      return true;
    }
    return false;
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
    if (prefs.snippetTokPerSec) parts.push(values.tokPerSec || '— tok/s');
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

  function quotaRow(labelText) {
    var wrap = mk('div', 'display:grid;grid-template-columns:80px minmax(0,1fr);column-gap:12px;align-items:center');
    var name = mk('span', 'color:var(--muted-foreground,#b4b4b4);font-size:13px;line-height:1.5', labelText);
    var right = mk('div', 'display:flex;flex-direction:column;gap:4px;min-width:0;align-items:stretch');
    var value = mk('span', 'color:var(--foreground,#fff);font-size:13px;line-height:1.4;font-variant-numeric:tabular-nums;text-align:right;overflow-wrap:anywhere');
    var barTrack = mk('div', 'height:4px;border-radius:999px;background:rgba(128,128,128,0.22);overflow:hidden');
    var barFill = mk('div', 'height:100%;width:100%;border-radius:999px;background:var(--ring,#4daafc);transform-origin:left center;transform:scaleX(0);transition:transform 240ms cubic-bezier(0.22,1,0.36,1),background-color 200ms ease');
    if (reducedMotion) barFill.style.transition = 'none';
    barTrack.appendChild(barFill);
    right.appendChild(value);
    right.appendChild(barTrack);
    wrap.appendChild(name);
    wrap.appendChild(right);
    return { wrap: wrap, value: value, barTrack: barTrack, barFill: barFill };
  }

  function setQuotaRow(parts, limit, text) {
    parts.wrap.style.display = 'grid';
    var tone = limit && limitTone(limit.percent);
    parts.value.textContent = text;
    parts.value.style.color = tone || 'var(--foreground,#fff)';
    if (limit && typeof limit.percent === 'number' && isFinite(limit.percent)) {
      parts.barTrack.style.display = 'block';
      parts.barFill.style.transform = 'scaleX(' + (Math.max(0, Math.min(100, limit.percent)) / 100).toFixed(4) + ')';
      parts.barFill.style.background = tone || '#3b9eff';
    } else {
      parts.barTrack.style.display = 'none';
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
      'border-radius:12px',
      'background:var(--card,#1b1b1b)',
      'color:var(--foreground,#fff)',
      'border:1px solid var(--border,rgba(255,255,255,0.12))',
      'box-shadow:0 12px 32px rgba(0,0,0,0.28)',
      'font-family:var(--font-sans,system-ui)',
      'font-size:14px',
      'line-height:1.45',
      'display:none',
      'user-select:none',
      'opacity:0',
      'transform:translateY(6px) scale(0.985)',
      'transition:opacity 180ms cubic-bezier(0.22,1,0.36,1),transform 180ms cubic-bezier(0.22,1,0.36,1)'
    ].join(';');
    if (reducedMotion) card.style.transition = 'none';

    var head = mk('div', 'display:flex;align-items:flex-start;justify-content:space-between;gap:10px');
    var ident = mk('div', 'display:flex;flex-direction:column;gap:1px;min-width:0;overflow:hidden');
    var app = mk('button', 'appearance:none;border:0;background:transparent;padding:0;margin:0;text-align:left;color:var(--muted-foreground,#b4b4b4);font:inherit;font-size:12px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;cursor:default');
    app.setAttribute('type', 'button');
    app.addEventListener('mouseenter', function () {
      if (last && last.card && last.card.accountEmail) app.style.color = 'var(--foreground,#fff)';
    });
    app.addEventListener('mouseleave', function () {
      app.style.color = 'var(--muted-foreground,#b4b4b4)';
    });
    app.addEventListener('click', function (event) {
      if (!last || !last.card || !last.card.accountEmail) return;
      event.stopPropagation();
      var currentlyRevealed = emailRevealed !== null ? emailRevealed : !last.card.maskEmailDefault;
      emailRevealed = !currentlyRevealed;
      renderCard();
    });
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
    var fill = mk('div', 'height:100%;width:100%;border-radius:999px;background:currentColor;transform-origin:left center;transform:scaleX(0);transition:transform 240ms cubic-bezier(0.22,1,0.36,1),background-color 200ms ease');
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
    var breakdownRow = row('Tokens', '');
    var sessionRow = quotaRow('5-hour');
    var weeklyRow = quotaRow('Weekly');
    var updatedRow = row('Updated', '');
    var quotaNote = mk('p', 'margin:8px 0 0;color:var(--muted-foreground,#9ca3af);font-size:12px;line-height:1.45');
    var rows = mk('div', 'display:flex;flex-direction:column;gap:8px');
    rows.appendChild(modelRow.wrap);
    rows.appendChild(quotaModelRow.wrap);
    rows.appendChild(breakdownRow.wrap);
    rows.appendChild(sessionRow.wrap);
    rows.appendChild(weeklyRow.wrap);
    rows.appendChild(updatedRow.wrap);

    var ruleTwo = mk('div', 'height:1px;background:var(--border,rgba(255,255,255,0.1));margin:12px 0');
    var foot = mk('div', 'display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px');
    var footLabel = mk('span', 'color:var(--muted-foreground,#9a9a9a);font-size:12px', 'Display');
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
      snippetFiveHour: '5-hour quota', snippetWeekly: 'Weekly quota', snippetModel: 'Model name', snippetResets: 'Reset countdowns', snippetTokPerSec: 'Output tok/s' };
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

    var openDash = mk('a', [
      'display:inline-flex',
      'align-items:center',
      'gap:4px',
      'color:var(--ring,#4daafc)',
      'font-size:12px',
      'font-weight:500',
      'text-decoration:none',
      'min-height:32px',
      'padding:4px 6px',
      'cursor:pointer'
    ].join(';'), 'Dashboard');
    openDash.href = 'http://127.0.0.1:4599';
    openDash.title = 'Open Antigravity Monitor in side panel';
    openDash.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      toggleCard(false);
      void openMonitorInSidePanel(openDash.href);
    });

    var footActions = mk('div', 'display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%');
    var rightActions = mk('div', 'display:flex;align-items:center;gap:4px');
    rightActions.appendChild(copy);
    rightActions.appendChild(refresh);
    footActions.appendChild(openDash);
    footActions.appendChild(rightActions);
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
      breakdown: breakdownRow,
      session: sessionRow,
      weekly: weeklyRow,
      updated: updatedRow,
      openDash: openDash,
      quotaNote: quotaNote,
      footLabel: footLabel,
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
      cardParts.copy.textContent = ok ? 'Copied \\u2713' : 'Copy failed';
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

    if (values.accountEmail) {
      var revealed = emailRevealed !== null ? emailRevealed : !values.maskEmailDefault;
      cardParts.app.textContent = revealed ? values.accountEmail : (values.maskedEmail || values.accountEmail);
      cardParts.app.style.display = '';
      cardParts.app.style.cursor = 'pointer';
      cardParts.app.title = revealed ? 'Click to mask account email' : 'Click to show account email';
      cardParts.app.setAttribute('aria-label', cardParts.app.title);
    } else {
      cardParts.app.textContent = values.app || '';
      cardParts.app.style.display = values.app ? '' : 'none';
      cardParts.app.style.cursor = 'default';
      cardParts.app.title = '';
      cardParts.app.removeAttribute('aria-label');
    }
    cardParts.title.textContent = values.title;
    cardParts.title.title = values.title;
    cardParts.chip.textContent = stale ? 'Stale' : values.sourceLabel;
    cardParts.chip.style.color = values.sourceLabel === 'Estimated' ? 'var(--primary,#ffc799)' : 'var(--muted-foreground,#9a9a9a)';

    cardParts.percent.textContent = values.percentText;
    cardParts.percent.style.color = values.color === 'currentColor' ? 'var(--foreground,#fff)' : values.color;

    cardParts.fill.style.transform = 'scaleX(' + (Math.max(0, Math.min(100, values.percent)) / 100).toFixed(4) + ')';
    cardParts.fill.parentElement.style.display = values.percent === null ? 'none' : 'block';
    cardParts.fill.style.background = values.color === 'currentColor' ? 'var(--foreground,#fff)' : values.color;

    cardParts.volume.textContent = values.volumeText;
    cardParts.remaining.textContent = values.remainingText || '';
    cardParts.remaining.style.display = values.remainingText ? '' : 'none';

    setRow(cardParts.model, values.model);
    cardParts.model.value.title = values.model || '';
    var normalizedModel = String(values.model || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    var normalizedQuotaModel = String(values.quotaModel || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    setRow(cardParts.quotaModel, normalizedModel !== normalizedQuotaModel ? values.quotaModel : null);
    setRow(cardParts.breakdown, values.breakdownText || null);
    if (values.dashboardUrl && cardParts.openDash) cardParts.openDash.href = values.dashboardUrl;

    var status = quotaStatus(values);
    var quotaExpired = status === 'unavailable';
    var sessionText = quotaExpired ? null : limitText(values.session);
    setQuotaRow(cardParts.session, quotaExpired ? null : values.session, sessionText || 'Unavailable');

    var weekly = !quotaExpired && values.limits && values.limits.weekly;
    var weeklyText = limitText(weekly);
    setQuotaRow(cardParts.weekly, weekly || null, weeklyText || 'Unavailable');
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
    if (cardParts.footLabel) cardParts.footLabel.textContent = active === 'custom' ? 'Display · Custom' : 'Display';
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
      if (card) {
        card.style.display = 'none';
        if (!reducedMotion) {
          card.style.opacity = '0';
          card.style.transform = 'translateY(6px) scale(0.985)';
        }
      }
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
    if (reducedMotion) {
      card.style.opacity = '1';
      card.style.transform = 'none';
    } else {
      card.style.opacity = '0';
      card.style.transform = 'translateY(6px) scale(0.985)';
      requestAnimationFrame(function () {
        if (card && open) {
          card.style.opacity = '1';
          card.style.transform = 'translateY(0) scale(1)';
        }
      });
    }
    if (pill) {
      pill.setAttribute('aria-expanded', 'true');
      pill.setAttribute('aria-label', last.aria + ' Close details.');
    }
    card.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- side panel

  ${SIDE_PANEL_OPENER}

  window.__agmOpenPanel = openMonitorInSidePanel;

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

  window.__agmDrain = function () {
    var refresh = refreshRequested;
    refreshRequested = false;
    var settings = settingsQueue;
    settingsQueue = {};
    return { refresh: refresh, settings: settings };
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
        last.card.quotaObservedAt = null;
        last.card.quotaStatus = 'unavailable';
        last.card.quotaGroup = 'Updating selected model';
        last.snippetValues = Object.assign({}, last.snippetValues, { fiveHour: '5h —', weekly: 'Week —', model: context.modelName, fiveHourReset: null, weeklyReset: null, tokPerSec: null });
        renderPill();
        if (open) renderCard();
      }
      return;
    }
    localContext = context;
    var prior = last;
    last = waitingPayload(context.viewState, prior && prior.card && prior.card.app);
    last.contextKey = context.contextKey;
    last.density = (prior && prior.density) || 'full';
    last.snippetPrefs = prior && prior.snippetPrefs;
    renderPill();
    if (open) renderCard();
  }
  var contextTimer = setInterval(function () {
    if (window.__agmOwner !== owner) { clearInterval(contextTimer); return; }
    if (!document.hidden) checkConversation();
  }, 250);
  window.addEventListener('popstate', checkConversation, listenOpts);
  window.addEventListener('hashchange', checkConversation, listenOpts);
  window.addEventListener('focus', checkConversation, listenOpts);

  if (window.__agmObserver) {
    try { window.__agmObserver.disconnect(); } catch (_) {}
  }
  window.__agmObserver = new MutationObserver(function () {
    if (window.__agmOwner !== owner) return;
    if (!last || !last.show) return;
    if (!pill || !pill.isConnected) renderPill();
  });
  window.__agmObserver.observe(document.body, { childList: true, subtree: true });

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
  document.addEventListener('visibilitychange', function () {
    if (window.__agmOwner !== owner) return;
    checkStale();
  }, listenOpts);
  window.addEventListener('focus', function () {
    if (window.__agmOwner !== owner) return;
    checkStale();
  }, listenOpts);
  window.addEventListener('resize', function () {
    if (window.__agmOwner !== owner) return;
    if (open) positionCard();
  }, listenOpts);
  document.addEventListener(
    'mousedown',
    function (event) {
      if (window.__agmOwner !== owner || !open) return;
      if ((card && card.contains(event.target)) || (pill && pill.contains(event.target))) return;
      toggleCard(false);
    },
    captureOpts
  );
  document.addEventListener('keydown', function (event) {
    if (window.__agmOwner !== owner) return;
    if (event.key === 'Escape' && open) {
      toggleCard(false);
      if (pill) pill.focus({ preventScroll: true });
    }
  }, listenOpts);

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
    this.onEvent = null;
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('connect timeout')); }
      }, timeoutMs);
      this.socket.onopen = () => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(); }
      };
      this.socket.onerror = (event) => {
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`socket error: ${event.message ?? 'unknown'}`)); }
      };
      this.socket.addEventListener('close', () => {
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error('socket closed before open')); }
      }, { once: true });
    });
    this.socket.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (typeof message.method === 'string' && typeof this.onEvent === 'function') {
        try {
          this.onEvent(message.method, message.params);
        } catch {
          // Listener errors must never disrupt CDP request correlation.
        }
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

  send(method, params, timeoutMs = this.timeoutMs) {
    if (this.closed) {
      return Promise.reject(new Error('socket closed'));
    }
    const id = (this.nextId += 1);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, timeoutMs = this.timeoutMs) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
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
export function resolveCandidateEndpoints(explicitPorts = [], endpoints = devtoolsEndpoints(), readPort = readDevtoolsPort) {
  const list = [];
  for (const entry of endpoints) {
    const port = readPort(entry.file);
    if (port && !list.some((existing) => existing.port === port)) {
      list.push({ port, app: entry.app });
    }
  }
  for (const port of explicitPorts) {
    if (!list.some((entry) => entry.port === port)) {
      list.push({ port, app: null });
    }
  }
  if (!list.some((entry) => entry.port === 9222)) {
    // Fallback for Electron builds launched with --remote-debugging-port=9222 without a port file.
    list.push({ port: 9222, app: null });
  }
  if (!list.some((entry) => entry.port === 9223)) {
    // Fallback for Antigravity IDE launched with --remote-debugging-port=9223 without a port file.
    list.push({ port: 9223, app: 'ide' });
  }
  return list;
}

export function devtoolsEndpoints(env = process.env, platform = process.platform, home) {
  const appData = configRoot(env, platform, home);
  if (!appData) {
    return [];
  }
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const list = [
    { app: 'app', file: join(appData, 'Antigravity', 'DevToolsActivePort') },
    { app: 'ide', file: join(appData, 'Antigravity IDE', 'DevToolsActivePort') },
    { app: 'vscode', file: join(appData, 'Code', 'DevToolsActivePort') },
    { app: 'vscode', file: join(appData, 'Code - Insiders', 'DevToolsActivePort') },
  ];
  // Discover additional Antigravity channels (Canary, Beta, Insiders, custom profiles) automatically.
  try {
    const known = new Set(list.map((entry) => entry.file.toLowerCase()));
    for (const entry of fs.readdirSync(appData, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^antigravity/i.test(entry.name)) continue;
      const file = join(appData, entry.name, 'DevToolsActivePort');
      if (known.has(file.toLowerCase())) continue;
      if (fs.existsSync(file)) {
        const app = /ide/i.test(entry.name) ? 'ide' : 'app';
        list.push({ app, file });
        known.add(file.toLowerCase());
      }
    }
  } catch {
    // Missing or unreadable config root (e.g. unit tests with virtual paths).
  }
  return list;
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
  const routeRe = /(?:^|\/)(?:c|chat|conversation|t|thread)\/([0-9a-f-]{8,})(?:[/?#]|$)/i;
  const direct = routeRe.exec(route);
  const query = url.searchParams.get('conversationId') || url.searchParams.get('cascadeId');
  let conversationId = direct ? direct[1] : query && /^[0-9a-f-]{8,}$/i.test(query) ? query : null;
  const isExtensionView = url.searchParams.get('extensionView') === 'true';
  const composer = !!document.querySelector('[data-testid="agent-input-box"], [data-testid*="composer"], [data-testid*="chat-input"]');
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  const newThread = !isExtensionView && composer && local && /^\/(?:new|new-chat|chat\/new)?\/?$/.test(route);
  if (!conversationId && !newThread) {
    const selected = document.querySelector('[aria-current="page"][href*="/c/"], [aria-current="page"][href*="/chat/"], [data-conversation-id][data-active="true"], [data-testid="conversation-row-sidebar"][data-active="true"]');
    if (selected) {
      const value = selected.getAttribute('data-conversation-id') || selected.getAttribute('href') || '';
      const match = /(?:^|\/(?:c|chat|conversation|t|thread)\/)([0-9a-f-]{8,})(?:[/?#]|$)/i.exec(value);
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
  const rawModel = document.querySelector('[data-testid="model-selector-trigger"], [data-testid*="model-selector"], [data-testid*="model-picker"], button[aria-label*="Model" i]')?.textContent?.trim().slice(0, 160) || null;
  const modelName = rawModel ? rawModel.replace(/\s*(?:New|Notice|Unavailable|Beta|Preview)\s*$/i, '').trim() || null : null;
  const pageTitle = typeof document !== 'undefined' && typeof document.title === 'string'
    ? document.title.trim().slice(0, 200) || null
    : null;
  return {
    port,
    conversationId,
    viewState,
    extensionView: isExtensionView,
    contextKey: String(hash),
    modelName,
    pageTitle,
    productName: url.searchParams.get('appName') || window.__APP_CONFIG__?.productName || null,
    appVersion: typeof window.__APP_CONFIG__?.appVersion === 'string' ? window.__APP_CONFIG__.appVersion.trim() || null : null,
  };
}

export const RENDERER_CONTEXT = `(${readRendererContext.toString()})()`;

/** Extract a CSRF request token from a CDP Network.requestWillBeSent event on the same loopback backend port. */
export function extractCsrfHeader(params, expectedPort) {
  const url = params?.request?.url;
  const headers = params?.request?.headers;
  if (typeof url !== 'string' || !headers || typeof headers !== 'object') return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) return null;
  if (expectedPort && Number(parsed.port) !== expectedPort) return null;
  for (const [key, value] of Object.entries(headers)) {
    if (!/^x-(?:[a-z0-9-]+-)?csrf-token$/i.test(key)) continue;
    if (typeof value === 'string' && value.length > 0 && value.length <= 512 && !/\s/.test(value)) {
      return value;
    }
  }
  return null;
}

/** Read the loopback CSRF token from the renderer's runtime config. Memory-only; never logged or persisted. */
export const RENDERER_TOKEN = `(function () {
  var cfg = window.__APP_CONFIG__;
  if (!cfg || typeof cfg !== 'object') return null;
  if (typeof cfg.csrfToken === 'string' && cfg.csrfToken.length > 0 && cfg.csrfToken.length <= 512) return cfg.csrfToken;
  for (var key in cfg) {
    if (/csrf.*token|token.*csrf/i.test(key) && typeof cfg[key] === 'string' && cfg[key].length > 0 && cfg[key].length <= 512) {
      return cfg[key];
    }
  }
  return null;
})()`;

/** A missing conversation is a named state, never a fabricated measurement. */
export function selectionPayload(viewState, app = null) {
  if (viewState === 'unauthorized') {
    const title = 'Authorization needed';
    return {
      show: true, density: 'full', essentials: title, full: title, color: '#e5534b', title, aria: title,
      card: {
        app: app || 'Antigravity', title, percent: null, percentText: 'Locked', color: '#e5534b',
        sourceLabel: 'Auth',
        volumeText: 'Backend requires a request token. Reconnecting via DevTools…',
        remainingText: null, model: null, session: null, limits: null, updatedText: 'No reading yet',
      },
    };
  }
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
export function rendererPayload(snapshot, instance, context) {
  const app = appName(instance.backend.app);
  if (snapshot?.status === 'unauthorized' && instance.backend.reachable === false) {
    const payload = selectionPayload('unauthorized', app);
    if (payload.card) {
    const email = typeof snapshot?.account?.email === 'string' && snapshot.account.email.trim()
      ? snapshot.account.email.trim()
      : null;
    payload.card.accountEmail = email;
    payload.card.maskedEmail = email ? maskEmailAddress(email) : null;
    payload.card.maskEmailDefault = snapshot?.prefs?.maskPersonalInfo !== false;
  }
  payload.snippetPrefs = snippetPreferences(snapshot.prefs || {});
    payload.density = snapshot.prefs?.displayMode || 'full';
    payload.contextKey = context.contextKey;
    payload.modelKey = context.modelName || '';
    return payload;
  }
  const scoped = { ...snapshot, conversation: instance.conversation, backend: instance.backend,
    quota: instance.quota || (snapshot.backend?.id === instance.backend.id ? snapshot.quota : undefined) };
  const matches = context.viewState === 'conversation' && instance.conversation && instance.conversation.id === context.conversationId;
  const extensionMatch = context.extensionView === true && context.viewState === 'unknown' && Boolean(instance.conversation);
  const payload = matches || extensionMatch
    ? toPayload(scoped, app, context.modelName)
    : selectionPayload(context.viewState, app);
  if (!payload.show) Object.assign(payload, selectionPayload('conversation', app));
  if (!(matches || extensionMatch) || payload.card.percent === null) decorateQuota(payload, scoped, context.modelName || instance.conversation?.modelName);
  if (payload.card) {
    const email = typeof snapshot?.account?.email === 'string' && snapshot.account.email.trim()
      ? snapshot.account.email.trim()
      : null;
    payload.card.accountEmail = email;
    payload.card.maskedEmail = email ? maskEmailAddress(email) : null;
    payload.card.maskEmailDefault = snapshot?.prefs?.maskPersonalInfo !== false;
  }
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
  if (value.includes('visual studio code') || value === 'code' || value.startsWith('code ')) {
    return 'vscode';
  }
  if (value.includes('antigravity')) {
    return 'app';
  }
  return null;
}

export function conversationIdFromUrl(url) {
  const value = String(url ?? '');
  const direct = /(?:^|\/)(?:c|chat|conversation|t|thread)\/([0-9a-f-]{8,})(?:[/?#]|$)/i.exec(value);
  if (direct) {
    return direct[1];
  }
  const query = /[?&](?:conversationId|cascadeId)=([0-9a-f-]{8,})/i.exec(value);
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
/**
 * Only a local/app page can host the badge. Workers, extensions, our own companion dashboard,
 * and external websites opened in Antigravity's built-in browser (e.g. gemini.google.com) are rejected.
 */
export function isAttachableTarget(target, dashboardUrl = null) {
  if (!target || (target.type !== 'page' && target.type !== 'iframe') || typeof target.webSocketDebuggerUrl !== 'string') {
    return false;
  }
  if (typeof target.url === 'string' && target.url.length > 0) {
    let parsed;
    try {
      parsed = new URL(target.url);
    } catch {
      return false;
    }
    const proto = parsed.protocol;
    const isLocalHost = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    const isAppProto = proto === 'vscode-webview:' || proto === 'vscode-file:' || proto === 'file:';
    if (target.type === 'iframe') {
      if (!((proto === 'http:' || proto === 'https:') && isLocalHost)) return false;
    } else if (!isAppProto && !((proto === 'http:' || proto === 'https:') && isLocalHost)) {
      return false;
    }
    if (dashboardUrl) {
      try {
        const dash = new URL(dashboardUrl);
        if (parsed.origin === dash.origin) return false;
      } catch {
        // Ignore malformed dashboardUrl.
      }
    }
  } else if (target.type === 'iframe') {
    return false;
  }
  return true;
}

export class BadgeInjector {
  constructor(options = {}) {
    this.logger = options.logger ?? (() => {});
    this.explicitPorts = parsePortList(options.ports ?? options.port ?? []);
    this.dashboardUrl = options.dashboardUrl ?? 'http://127.0.0.1:4599';
    this.latest = null;
    this.renderers = new Map();
    this.connecting = false;
    this.connectAt = 0;
    this.pumping = false;
    this.disposed = false;
    this.describeAttempted = false;
    this.probeLogged = false;
    this.reachablePorts = 0;
    this.probedPages = 0;
    this.onUpdateSetting = options.onUpdateSetting ?? (() => {});
    this.onObserved = options.onObserved ?? (() => {});
    this.onToken = options.onToken ?? (() => {});
    this.onAppVersion = options.onAppVersion ?? (() => {});
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

  /** Wake attachment immediately when a DevTools endpoint file changes. */
  wake() {
    if (this.disposed) return;
    this.connectAt = 0;
    void this.pump();
  }

  getStatus() {
    const state = this.renderers.size > 0
      ? 'attached'
      : this.reachablePorts > 0
        ? 'no-composer'
        : 'no-devtools';
    return {
      state,
      attached: this.renderers.size,
      reachablePorts: this.reachablePorts,
      probedPages: this.probedPages,
    };
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
          const prevKey = renderer.contextKey;
          const prevModel = renderer.modelName;
          await this.refreshContext(renderer);
          if (renderer.contextKey !== prevKey || renderer.modelName !== prevModel) {
            await this.push(renderer);
          }
          const drained = await renderer.connection.evaluate('window.__agmDrain ? window.__agmDrain() : null');
          if (drained && typeof drained === 'object') {
            requested = drained.refresh === true;
            const settings = drained.settings;
            if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
              for (const [key, value] of Object.entries(settings)) this.onUpdateSetting(key, value);
            }
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
      const endpoints = resolveCandidateEndpoints(this.explicitPorts);

      let reachablePorts = 0;
      let probedPages = 0;
      for (const endpoint of endpoints) {
        const result = await this.attachPort(endpoint.port, endpoint.app);
        if (result.reachable) {
          reachablePorts += 1;
          probedPages += result.probed;
        }
      }
      this.reachablePorts = reachablePorts;
      this.probedPages = probedPages;

      if (reachablePorts === 0) {
        if (!this.describeAttempted) {
          this.describeAttempted = true;
          this.logger(
            'Badge: no DevTools endpoint found; launch a host with --remote-debugging-port to enable its badge',
          );
        }
      } else if (this.renderers.size === 0 && probedPages > 0 && !this.probeLogged) {
        this.probeLogged = true;
        this.logger(`Badge: inspected ${probedPages} DevTools target(s), but no composer UI matched`);
      } else if (this.renderers.size > 0) {
        this.probeLogged = false;
      }
      this.connectAt = Date.now() + 4_000;
    } finally {
      this.connecting = false;
    }
  }

  async attachPort(port, appHint) {
    const response = await this.listTargets(port);
    if (!response.reachable) {
      return { reachable: false, probed: 0 };
    }
    const targets = response.targets;
    const alive = new Set();
    let probed = 0;

    for (const target of targets) {
      if (!isAttachableTarget(target, this.dashboardUrl)) {
        continue;
      }
      const key = `${port}:${target.id}`;
      alive.add(key);
      if (this.renderers.has(key)) {
        probed += 1;
        continue;
      }

      const connection = new CdpConnection(target.webSocketDebuggerUrl);
      try {
        await connection.ready;
        probed += 1;
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
          appVersion: null,
          observed: null,
          viewState: 'unknown',
          extensionView: false,
          pageTitle: null,
          contextKey: null,
          modelName: null,
          tokenSentForPort: null,
          networkSniffing: false,
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
    return { reachable: true, probed };
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
    const owner = appFromProductName(context.productName || renderer.target?.title);
    if (owner && !renderer.appHint) {
      // The DevTools port file already names the product; the page is only a
      // fallback for an explicitly supplied port.
      renderer.app = owner;
    }

    const conversationId = typeof context.conversationId === 'string' ? context.conversationId : null;
    renderer.observed = conversationId;
    renderer.viewState = context.viewState || 'unknown';
    renderer.extensionView = context.extensionView === true;
    renderer.pageTitle = typeof context.pageTitle === 'string' && context.pageTitle.trim() ? context.pageTitle.trim() : null;
    renderer.contextKey = context.contextKey;
    renderer.modelName = typeof context.modelName === 'string' ? context.modelName : null;
    if (typeof context.appVersion === 'string' && context.appVersion && context.appVersion !== renderer.appVersion) {
      renderer.appVersion = context.appVersion;
      this.onAppVersion(context.appVersion);
    }
    if (renderer.backendPort) {
      if (renderer.tokenSentForPort !== renderer.backendPort) {
        let token = null;
        try {
          token = await renderer.connection.evaluate(RENDERER_TOKEN);
        } catch {
          // Token unavailable or page navigated; passive capture or Tier-3 fallback will handle it.
        }
        if (typeof token === 'string' && token.length > 0 && token.length <= 512 && !/\s/.test(token)) {
          renderer.tokenSentForPort = renderer.backendPort;
          this.onToken(renderer.backendPort, token);
        } else if (!renderer.networkSniffing) {
          // Tier 2b: if a future Antigravity build moves the token out of __APP_CONFIG__ into a closure,
          // passively observe the loopback request header once via CDP Network events, then disable.
          this.armNetworkTokenCapture(renderer);
        }
      }
      // A null reading is meaningful: a new-chat page must not keep showing the
      // previous conversation. In extensionView (IDE iframe), route stays `/` with document.title carrying the thread name.
      if (conversationId !== null || renderer.viewState === 'new-thread' || !renderer.extensionView || Boolean(renderer.pageTitle)) {
        this.onObserved(renderer.backendPort, conversationId, renderer.viewState, renderer.modelName, renderer.pageTitle);
      }
    }
  }

  armNetworkTokenCapture(renderer) {
    if (this.disposed || renderer.networkSniffing || renderer.connection.closed) return;
    renderer.networkSniffing = true;
    const expectedPort = renderer.backendPort;
    renderer.connection.onEvent = (method, params) => {
      if (method !== 'Network.requestWillBeSent') return;
      const captured = extractCsrfHeader(params, expectedPort);
      if (!captured) return;
      renderer.networkSniffing = false;
      renderer.connection.onEvent = null;
      renderer.tokenSentForPort = expectedPort;
      void renderer.connection.send('Network.disable').catch(() => {});
      this.onToken(expectedPort, captured);
    };
    void renderer.connection.send('Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0 }).catch(() => {
      renderer.networkSniffing = false;
      renderer.connection.onEvent = null;
    });
  }

  /**
   * Focus or open the Antigravity Monitor dashboard inside the foreground Antigravity session's right-side panel.
   * Prefers the visible/focused renderer and reuses an existing "Antigravity Monitor" tab when present.
   */
  async openInAppPanel() {
    if (this.disposed) return false;
    await this.ensureConnections();
    const candidates = [...this.renderers.values()].filter((entry) => !entry.connection.closed);
    if (candidates.length === 0) return false;
    const preferred = candidates.filter((entry) => (entry.app ?? entry.appHint) !== 'ide');
    const pool = preferred.length > 0 ? preferred : candidates;
    let chosen = pool[0];
    if (pool.length > 1) {
      let bestScore = -1;
      for (const entry of pool) {
        try {
          const score = await entry.connection.evaluate('(document.hasFocus() ? 2 : 0) + (document.hidden ? 0 : 1)');
          if (typeof score === 'number' && score > bestScore) {
            bestScore = score;
            chosen = entry;
          }
        } catch {
          // Ignore unresponsive renderer.
        }
      }
    }
    try {
      const outcome = await chosen.connection.evaluate(
        `window.__agmOpenPanel ? window.__agmOpenPanel(${JSON.stringify(this.dashboardUrl)}) : 'unavailable'`,
        6000,
      );
      return outcome === 'focused' || outcome === 'opened' || outcome === 'navigated' || outcome === 'plugin-window' || outcome === 'plugin-panel';
    } catch {
      return false;
    }
  }

  /**
   * Tier-3 same-origin RPC fallback: runs inside the attached renderer page when
   * direct loopback RPC receives 401 and no readable token was exposed.
   */
  async callRpc(port, method, body = {}, options = {}) {
    if (this.disposed) {
      throw new RpcError('aborted', 'Badge bridge disposed');
    }
    const renderer = [...this.renderers.values()].find((entry) => entry.backendPort === port && !entry.connection.closed);
    if (!renderer) {
      throw new RpcError('unauthorized', 'No attached renderer for this backend port');
    }
    const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 15_000;
    const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : 128 * 1024 * 1024;
    const expr = `(async function () {
      var ac = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = ac ? setTimeout(function () { ac.abort(); }, ${timeoutMs}) : null;
      try {
        var headers = { 'content-type': 'application/json', 'connect-protocol-version': '1', 'accept': 'application/json' };
        var cfg = window.__APP_CONFIG__;
        if (cfg && typeof cfg.csrfToken === 'string' && cfg.csrfToken) headers['x-codeium-csrf-token'] = cfg.csrfToken;
        var res = await fetch(${JSON.stringify(`${SERVICE_PATH}/${method}`)}, {
          method: 'POST',
          credentials: 'include',
          headers: headers,
          body: ${JSON.stringify(JSON.stringify(body ?? {}))},
          signal: ac ? ac.signal : undefined
        });
        var text = await res.text();
        if (text.length > ${maxBytes}) return { ok: false, status: res.status, overflow: true };
        return { ok: res.ok, status: res.status, text: text };
      } catch (err) {
        return { ok: false, status: 0, error: String(err && err.message ? err.message : err) };
      } finally {
        if (timer) clearTimeout(timer);
      }
    })()`;
    const result = await renderer.connection.evaluate(expr, timeoutMs + 2000);
    if (!result || typeof result !== 'object') {
      throw new RpcError('network', 'Renderer RPC returned no result');
    }
    if (result.overflow) {
      throw new RpcError('payload_too_large', `Response exceeded the ${Math.round(maxBytes / (1024 * 1024))} MB limit`, result.status || null);
    }
    if (!result.ok) {
      const status = Number(result.status) || 0;
      const code = status === 401 || status === 403 ? 'unauthorized'
        : status === 404 ? 'not_found'
        : status === 400 || status === 422 ? 'invalid_argument'
        : status >= 500 ? 'unavailable'
        : 'network';
      throw new RpcError(code, result.error || result.text?.slice(0, 300) || `HTTP ${status}`, status || null);
    }
    const text = typeof result.text === 'string' ? result.text : '';
    if (!text.trim()) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new RpcError('protocol', `Malformed JSON response (${text.length} bytes)`, result.status || null);
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
      if (this.latest.status === 'unauthorized') {
        renderer.tokenSentForPort = null;
        const payload = selectionPayload('unauthorized', appName(renderer.app ?? renderer.appHint));
        payload.snippetPrefs = snippetPreferences(this.latest.prefs || {});
        payload.density = this.latest.prefs?.displayMode || 'full';
        payload.contextKey = renderer.contextKey;
        payload.modelKey = renderer.modelName || '';
        if (payload.card) payload.card.dashboardUrl = this.dashboardUrl;
        await renderer.connection.evaluate(`window.__agmApply(${JSON.stringify(payload)})`);
        renderer.shown = true;
        return;
      }
      if (renderer.shown !== false) {
        renderer.shown = false;
        await renderer.connection.evaluate('window.__agmApply({show:false})');
        this.logger(`Badge: ${renderer.key} has no matching backend; hidden`);
      }
      return;
    }

    const payload = rendererPayload(this.latest, instance, {
      viewState: renderer.viewState,
      extensionView: renderer.extensionView,
      conversationId: renderer.observed,
      contextKey: renderer.contextKey,
      modelName: renderer.modelName,
    });
    if (payload.card) payload.card.dashboardUrl = this.dashboardUrl;
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
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(800) });
      if (!response.ok) {
        return { reachable: false, targets: [] };
      }
      const targets = await response.json();
      return { reachable: true, targets: Array.isArray(targets) ? targets : [] };
    } catch {
      return { reachable: false, targets: [] };
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
export function toPayload(snapshot, app = null, modelNameOverride = null) {
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
      breakdownText:
        usage.input || usage.cacheRead || usage.output
          ? `In ${format(usage.input)} · Cache ${format(usage.cacheRead)} · Out ${format(usage.output)}` +
            (typeof usage.tokPerSec === 'number' && usage.tokPerSec > 0 ? ` · ${formatRate(usage.tokPerSec)}` : '')
          : null,
      model,
      session: null,
      limits: null,
      updatedText: timeOf(usage.measuredAt || snapshot.generatedAt),
    },
  };
  if (payload.card) {
    const email = typeof snapshot?.account?.email === 'string' && snapshot.account.email.trim()
      ? snapshot.account.email.trim()
      : null;
    payload.card.accountEmail = email;
    payload.card.maskedEmail = email ? maskEmailAddress(email) : null;
    payload.card.maskEmailDefault = snapshot?.prefs?.maskPersonalInfo !== false;
  }
  payload.snippetPrefs = snippetPreferences(snapshot.prefs || {});
  decorateQuota(payload, snapshot, modelNameOverride || model);
  return payload;
}

function decorateQuota(payload, snapshot, modelName) {
  const quota = quotaAt(snapshot.quota || { groups: [], observedAt: null, status: 'unavailable', error: null });
  const normalized = String(modelName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const matchedRow = (snapshot.models || []).find(
    (row) => String(row.label || '').toLowerCase().replace(/[^a-z0-9]/g, '') === normalized,
  );
  const hint = matchedRow ? { resetsAt: matchedRow.resetsAt, percent: matchedRow.quotaPercent } : null;
  const group = resolveQuotaGroup(quota.groups, modelName, hint);
  const session = quotaBucket(quota, modelName, '5h', Date.now(), hint);
  const weekly = quotaBucket(quota, modelName, 'weekly', Date.now(), hint);
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
    tokPerSec: typeof snapshot.conversation?.usage?.tokPerSec === 'number' && snapshot.conversation.usage.tokPerSec > 0
      ? formatRate(snapshot.conversation.usage.tokPerSec)
      : null,
  };
}

function maskEmailAddress(email) {
  const at = email.indexOf('@');
  if (at <= 0) return '•••';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}•••${domain}`;
}

function formatPercent(value) {
  return (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, '') + '%';
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
