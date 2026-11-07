#!/usr/bin/env node
// Installs the Mac host's sign-in pieces (Hub #1426) into fixed folders outside every release and checkout.
//   diagnostics REVISION  copies deploy/diagnostics from that commit and recreates the stack from the copy
//   signin [PROJECT]      writes the runtime and private-route launchd agents; the owner loads them
import {execFile} from 'node:child_process';
import {access, chmod, copyFile, mkdir, mkdtemp, rename, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

const tailscale = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
const grafanaHealth = 'http://127.0.0.1:3000/api/health';
const run = (file, args, cwd) => new Promise((done, fail) => {
  execFile(file, args, {cwd, timeout: 600_000, maxBuffer: 16 * 1024 * 1024}, (error, stdout) => (error ? fail(error) : done(stdout)));
});
const refuse = reason => {throw new Error(reason);};

const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function plist({label, program, keepAlive, background, log, path, environment = {}, workingDirectory}) {
  const strings = values => values.map(value => `    <string>${xml(value)}</string>`).join('\n');
  const variables = Object.entries({PATH: path, ...environment})
    .map(([name, value]) => `    <key>${xml(name)}</key>\n    <string>${xml(value)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${strings(program)}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${variables}
  </dict>
  <key>WorkingDirectory</key>
  <string>${xml(workingDirectory)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <${keepAlive}/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
${background ? '  <key>ProcessType</key>\n  <string>Background</string>\n' : ''}  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`;
}

export function agents({home, node, project = 'bunny-mac-personal'}) {
  const signin = join(home, '.local', 'share', 'bunny', 'signin');
  const route = join(home, '.config', 'bunny', 'private-access');
  const path = [join(home, '.docker', 'bin'), '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
  return [
    // Once per sign-in: a crash or a Docker Desktop restart in the session leaves the runtime stopped until the next one.
    {label: 'org.bunny.runtime-signin', keepAlive: false, background: true, path, workingDirectory: signin,
      program: [node, join(signin, 'mac-signin.mjs'), '--project', project], log: join(signin, 'signin.log')},
    // The route holds no state and sends no device command, so launchd keeps it up while Tailscale or the core is away.
    {label: 'org.bunny.private-forwarder', keepAlive: true, path, workingDirectory: route,
      program: ['/bin/sh', join(route, 'start-forwarder.sh')], log: join(route, 'forwarder.log')},
    // The app binary starts as the GUI, logs a CLIError and exits 0 without a terminal unless TAILSCALE_BE_CLI is set, and
    // even then whenever its parent is launchd. So a shell stays its parent: no exec, the binary as $0 rather than shell
    // text, a stop forwarded and waited for, and the job ending with the serve so KeepAlive restarts it.
    {label: 'org.bunny.private-serve', keepAlive: true, path, environment: {TAILSCALE_BE_CLI: '1'}, workingDirectory: route,
      program: ['/bin/sh', '-c', `trap 'kill -TERM "$c" 2>/dev/null; wait "$c"; exit' TERM INT; "$0" serve --https=443 http://127.0.0.1:18789 & c=$!; wait "$c"`, tailscale],
      log: join(route, 'serve.log')},
  ];
}

export async function installSignin({home = homedir(), node = process.execPath, source = dirname(fileURLToPath(import.meta.url)), project} = {}) {
  if (project !== undefined && !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(project)) refuse('project-invalid');
  const selected = agents({home, node, project});
  const [starter, forwarder] = selected;
  await access(forwarder.program[1]).catch(() => refuse('private-route-missing'));
  await mkdir(starter.workingDirectory, {recursive: true, mode: 0o700});
  await copyFile(join(source, 'mac-signin.mjs'), starter.program[1]);
  await chmod(starter.program[1], 0o700);
  const launchAgents = join(home, 'Library', 'LaunchAgents');
  await mkdir(launchAgents, {recursive: true});
  // launchd loads these by itself at the next sign-in; the guide gives the commands that load them now.
  for (const agent of selected) await writeFile(join(launchAgents, `${agent.label}.plist`), plist(agent), {mode: 0o644});
  return {installed: selected.map(agent => agent.label)};
}

export async function installDiagnostics(revision, {home = homedir(), checkout = process.cwd(), command = run} = {}) {
  if (!/^[0-9a-f]{40}$/.test(revision ?? '')) refuse('revision-invalid');
  const root = join(home, '.local', 'share', 'bunny', 'diagnostics');
  await mkdir(root, {recursive: true, mode: 0o700});
  const incoming = await mkdtemp(join(root, '.incoming-'));
  try {
    const archive = `${incoming}.tar`;
    await command('git', ['archive', '--format=tar', '-o', archive, revision, 'deploy/diagnostics'], checkout);
    await command('tar', ['-xf', archive, '-C', incoming, '--strip-components=2']);
    await rm(archive);
    await command('docker', ['compose', '-f', join(incoming, 'compose.yaml'), 'config', '-q']);
    await writeFile(join(incoming, 'revision.txt'), `${revision}\n`);
    const current = join(root, 'current'), previous = join(root, 'previous');
    await rm(previous, {recursive: true, force: true});
    await rename(current, previous).catch(error => {if (error.code !== 'ENOENT') throw error;});
    await rename(incoming, current);
    // Recreating follows the copied files and the restart policy; the three data volumes stay.
    const up = () => command('docker', ['compose', '-f', join(current, 'compose.yaml'), 'up', '-d', '--no-build', '--pull', 'missing', '--force-recreate']);
    try {await up();}
    catch (error) {
      // The folder keeps naming what runs. The first install has no copy to return to: its containers keep their old path.
      await rm(current, {recursive: true, force: true});
      const restored = await rename(previous, current).then(() => true, () => false);
      if (restored) await up().catch(() => {});
      throw error;
    }
    return {compose: join(current, 'compose.yaml'), revision};
  } finally {
    await rm(incoming, {recursive: true, force: true});
    await rm(`${incoming}.tar`, {force: true});
  }
}

async function grafanaAnswers() {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const body = await fetch(grafanaHealth, {signal: AbortSignal.timeout(3000)}).then(response => response.json()).catch(() => undefined);
    if (body?.database === 'ok') return true;
    await delay(5000);
  }
  return false;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, argument] = process.argv.slice(2);
  try {
    if (command === 'signin') process.stdout.write(`${JSON.stringify(await installSignin({project: argument}))}\n`);
    else if (command === 'diagnostics') {
      const result = await installDiagnostics(argument);
      if (!await grafanaAnswers()) refuse('grafana-unavailable');
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else refuse('usage: node scripts/mac-host-install.mjs <diagnostics REVISION|signin [PROJECT]>');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
