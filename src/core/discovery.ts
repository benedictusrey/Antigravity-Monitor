/**
 * Backend discovery.
 *
 * Antigravity exposes its language server through the process command line:
 *
 *   agy.exe --hub --hub-port=55908 --app_data_dir=antigravity --csrf_token=<uuid>
 *   language_server.exe --standalone ... --csrf_token <uuid>
 *
 * There is no port file and no exported handle, so the command line is the only
 * reliable source of a port and its matching token. Everything in this module is
 * pure string/number handling so it can be tested without spawning a process.
 */

import { BackendOwner, BackendTarget } from './rpc';

export interface RawProcess {
  pid: number;
  name: string;
  cmd: string;
  ports: number[];
  /** Owning installation, resolved by the discovery script when possible. */
  owner?: BackendOwner;
}

export interface DiscoveryResult {
  targets: BackendTarget[];
  /** Human-readable notes for the diagnostics channel; never contains tokens. */
  notes: string[];
}

/** Split a Windows command line into arguments, honouring quotes. */
export function tokenizeCommandLine(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let hasContent = false;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];

    if (quote) {
      if (character === '\\' && command[index + 1] === quote) {
        current += quote;
        index += 1;
      } else if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      hasContent = true;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character as '"' | "'";
      hasContent = true;
      continue;
    }

    if (character === ' ' || character === '\t' || character === '\r' || character === '\n') {
      if (hasContent) {
        tokens.push(current);
        current = '';
        hasContent = false;
      }
      continue;
    }

    current += character;
    hasContent = true;
  }

  if (hasContent) {
    tokens.push(current);
  }
  return tokens;
}

/**
 * Collect `--flag=value` and `--flag value` pairs.
 *
 * Names are lower-cased for lookup; values keep their original casing because
 * CSRF tokens and paths are case-sensitive.
 */
export function parseFlags(argv: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--') || argument.length <= 2) {
      continue;
    }

    const body = argument.slice(2);
    const equals = body.indexOf('=');
    if (equals >= 0) {
      const name = body.slice(0, equals).toLowerCase();
      const value = body.slice(equals + 1);
      if (name) {
        flags.set(name, value);
      }
      continue;
    }

    const name = body.toLowerCase();
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, '');
    }
  }

  return flags;
}

function parsePort(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  if (!/^\d{1,5}$/.test(value)) {
    return null;
  }
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : null;
}

function isOwner(value: unknown): value is BackendOwner {
  return value === 'app' || value === 'ide' || value === 'vscode' || value === 'unknown';
}

/**
 * Infer the owning app from the process name when the parent walk is unavailable.
 *
 * Only `language_server.exe` is unambiguous: it belongs to the desktop app. Both
 * the IDE and VS Code spawn `agy.exe`, so guessing there would label a VS Code
 * session as IDE — `unknown` is the honest answer.
 */
export function inferOwner(processName: string): BackendOwner {
  const name = processName.toLowerCase();
  if (name.startsWith('language_server')) {
    return 'app';
  }
  return 'unknown';
}

function isValidToken(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/\s/.test(value);
}

/**
 * Convert discovered processes into probe candidates.
 *
 * A hub advertises its port directly, so it yields exactly one candidate. A
 * legacy server advertises only a token, so every listening port of that
 * process is a candidate, HTTPS first — which is what current builds use.
 */
export function toBackendTargets(processes: readonly RawProcess[]): DiscoveryResult {
  const targets: BackendTarget[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();

  const add = (target: BackendTarget): void => {
    if (seen.has(target.id)) {
      return;
    }
    seen.add(target.id);
    targets.push(target);
  };

  for (const process of processes) {
    const argv = tokenizeCommandLine(process.cmd ?? '');
    const flags = parseFlags(argv);
    const token = flags.get('csrf_token') ?? flags.get('csrf-token') ?? flags.get('csrftoken');
    const name = (process.name ?? '').toLowerCase();

    if (!isValidToken(token)) {
      notes.push(`pid ${process.pid} (${process.name || 'unknown'}) has no usable request token`);
      continue;
    }

    const appDataDir = flags.get('app_data_dir') ?? null;
    const hubPort = parsePort(flags.get('hub-port') ?? flags.get('hub_port'));
    const isLegacyName = name.startsWith('language_server');
    const owner: BackendOwner =
      process.owner && process.owner !== 'unknown' ? process.owner : inferOwner(process.name ?? '');

    if (hubPort !== null) {
      add({
        id: `hub:http:${hubPort}`,
        kind: 'hub',
        scheme: 'http',
        host: '127.0.0.1',
        port: hubPort,
        token,
        pid: process.pid,
        appDataDir,
        owner,
      });
      continue;
    }

    if (!isLegacyName) {
      if (flags.has('hub')) {
        notes.push(`pid ${process.pid} advertises a hub role without a usable --hub-port`);
      }
      continue;
    }

    const httpsPort = parsePort(flags.get('https_server_port') ?? flags.get('https-server-port'));
    const ports: Array<{ port: number; scheme: 'http' | 'https' }> = [];
    if (httpsPort !== null) {
      ports.push({ port: httpsPort, scheme: 'https' });
    }
    for (const port of process.ports ?? []) {
      if (Number.isInteger(port) && port >= 1 && port <= 65535) {
        ports.push({ port, scheme: 'https' });
      }
    }
    for (const port of process.ports ?? []) {
      if (Number.isInteger(port) && port >= 1 && port <= 65535) {
        ports.push({ port, scheme: 'http' });
      }
    }

    if (ports.length === 0) {
      notes.push(`pid ${process.pid} (${process.name}) exposes no listening port`);
      continue;
    }

    // Bound the search: a process with many sockets should not turn one poll
    // into dozens of timed-out probes.
    for (const candidate of ports.slice(0, 12)) {
      add({
        id: `${candidate.scheme}:${candidate.port}`,
        kind: 'legacy',
        scheme: candidate.scheme,
        host: '127.0.0.1',
        port: candidate.port,
        token,
        pid: process.pid,
        appDataDir,
        owner,
      });
    }
  }

  // Hub targets first: they advertise their port, so they are cheapest to trust.
  targets.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'hub' ? -1 : 1;
    }
    return left.port - right.port;
  });

  return { targets, notes };
}

/**
 * Windows discovery script.
 *
 * `Get-NetTCPConnection` is used instead of parsing `netstat` because the state
 * column is localized on non-English Windows installations. The owning app is
 * resolved by walking the parent chain, which is the only reliable way to tell
 * the desktop app from the IDE when both are running.
 */
export function windowsDiscoveryScript(): string {
  return [
    '$ErrorActionPreference = "SilentlyContinue";',
    '$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine;',
    '$byId = @{};',
    'foreach ($x in $all) { $byId[[string]$x.ProcessId] = $x }',
    'function Get-Owner([int]$startPid) {',
    '  $cur = $startPid; $depth = 0;',
    '  while ($cur -and $depth -lt 8) {',
    '    $proc = $byId[[string]$cur];',
    '    if (-not $proc) { return "unknown" }',
    '    if ($proc.Name -eq "Antigravity IDE.exe") { return "ide" }',
    '    if ($proc.Name -eq "Antigravity.exe") { return "app" }',
    '    if ($proc.Name -eq "Code.exe") { return "vscode" }',
    '    $cur = $proc.ParentProcessId; $depth++;',
    '  }',
    '  return "unknown"',
    '}',
    '$procs = $all | Where-Object { $_.Name -like "agy*" -or $_.Name -like "language_server*" };',
    '$result = @();',
    'foreach ($p in $procs) {',
    '  $ports = @(Get-NetTCPConnection -OwningProcess $p.ProcessId -State Listen -ErrorAction SilentlyContinue |',
    '    Select-Object -ExpandProperty LocalPort -Unique);',
    '  $result += [pscustomobject]@{ pid = $p.ProcessId; name = $p.Name; cmd = $p.CommandLine; ports = $ports; owner = (Get-Owner $p.ProcessId) };',
    '}',
    'if ($result.Count -eq 0) { "[]" } else { ConvertTo-Json -InputObject $result -Compress -Depth 4 }',
  ].join('\n');
}

/** POSIX discovery script: process table plus listening sockets. */
export function posixDiscoveryScript(): string {
  return [
    `ps -axo pid=,ppid=,comm= | awk '
      {
        pid=$1; parent[pid]=$2;
        sub(/^[[:space:]]*[0-9]+[[:space:]]+[0-9]+[[:space:]]+/, "");
        executable[pid]=$0; sub(/[[:space:]]+$/, "", executable[pid]);
      }
      END {
        for (pid in executable) {
          name=executable[pid]; sub("^.*/", "", name);
          if (name !~ /^agy([._-].*)?$/ && name !~ /^language_server/) continue;
          owner="unknown"; current=pid;
          for (depth=0; current && depth<12; depth++) {
            ancestor=tolower(executable[current]); base=ancestor; sub("^.*/", "", base);
            if (ancestor ~ /antigravity[ -]ide/ || ancestor ~ /antigravityide/) { owner="ide"; break; }
            if (ancestor ~ /visual studio code/ || base ~ /^(code|code-insiders)$/) { owner="vscode"; break; }
            if (ancestor ~ /antigravity[.]app[/]/ || base == "antigravity") { owner="app"; break; }
            current=parent[current];
          }
          printf "%s\\t%s\\t%s\\n", pid, owner, name;
        }
      }' | while IFS="$(printf '\\t')" read -r pid owner name; do`,
    '  cmd=$(ps -p "$pid" -o args= 2>/dev/null | tr \'\\t\\r\\n\' \'   \');',
    '  [ -n "$cmd" ] || continue;',
    '  ports="";',
    '  if command -v lsof >/dev/null 2>&1; then',
    '    ports=$(lsof -nP -iTCP -sTCP:LISTEN -a -p "$pid" -Fn 2>/dev/null | awk \'/^n/ {sub(/^.*:/, ""); if ($0 ~ /^[0-9]+$/) print}\');',
    '  fi',
    '  if [ -z "$ports" ] && command -v ss >/dev/null 2>&1; then',
    '    ports=$(ss -ltnp 2>/dev/null | awk -v pid="$pid" \'index($0, "pid=" pid ",") {port=$4; sub(/^.*:/, "", port); if (port ~ /^[0-9]+$/) print port}\');',
    '  fi',
    '  ports=$(printf \'%s\\n\' "$ports" | sort -nu | tr \'\\n\' \',\');',
    '  printf \'%s\\t%s\\t%s\\t%s\\t%s\\n\' "$pid" "$ports" "$cmd" "$owner" "$name";',
    'done',
  ].join('\n');
}

/**
 * Parse the tab-separated POSIX discovery output into process records.
 * Kept separate from the script so both can be tested independently.
 */
export function parsePosixOutput(stdout: string): RawProcess[] {
  const processes: RawProcess[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const [pidText, portsText, ...rest] = line.split('\t');
    const pid = Number(pidText);
    if (!Number.isInteger(pid) || pid <= 0) {
      continue;
    }
    const hasOwner = isOwner(rest[1]);
    const cmd = (hasOwner ? rest[0] : rest.join('\t')).trim();
    const ports = (portsText ?? '')
      .split(',')
      .map((entry) => Number(entry.trim()))
      .filter((port) => Number.isInteger(port) && port >= 1 && port <= 65535);
    const executable = cmd.match(/^.*?\/(agy(?:[._-][^\s/"']*)?|language_server[^\s/"']*)\s+(?=--)/)?.[1];
    const name = (hasOwner ? rest[2] : undefined) ?? executable ?? tokenizeCommandLine(cmd)[0]?.split(/[\\/]/).pop() ?? '';
    const process: RawProcess = { pid, name, cmd, ports: [...new Set(ports)] };
    if (hasOwner) process.owner = rest[1] as BackendOwner;
    processes.push(process);
  }
  return processes;
}

/** Parse the Windows discovery script's JSON output. */
export function parseWindowsOutput(stdout: string): RawProcess[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const processes: RawProcess[] = [];

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const pid = Number(record.pid);
    if (!Number.isInteger(pid) || pid <= 0) {
      continue;
    }
    const rawPorts = Array.isArray(record.ports) ? record.ports : record.ports !== undefined ? [record.ports] : [];
    const ports = rawPorts
      .map((port) => Number(port))
      .filter((port) => Number.isInteger(port) && port >= 1 && port <= 65535);
    processes.push({
      pid,
      name: typeof record.name === 'string' ? record.name : '',
      cmd: typeof record.cmd === 'string' ? record.cmd : '',
      ports: Array.from(new Set(ports)),
      owner: isOwner(record.owner) ? record.owner : undefined,
    });
  }

  return processes;
}
