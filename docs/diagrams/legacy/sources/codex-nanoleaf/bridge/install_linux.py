"""Fresh Linux installation using the existing bridge and controller processes."""
import argparse
import contextlib
import getpass
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import shutil
import stat
import subprocess
import sys
import venv
import warnings

import bridge as b


@contextlib.contextmanager
def private_files():
    previous = os.umask(0o077)
    try:
        yield
    finally:
        os.umask(previous)


def linux_state_directory(value):
    directory = Path(value).expanduser().resolve()
    if re.match(r'^/mnt/[a-zA-Z](?:/|$)', str(directory)):
        raise ValueError('State must be on the Linux filesystem, outside Windows-mounted drives.')
    # Require a known local type rather than trying to enumerate every remote
    # filesystem that would undermine SQLite ownership or private permissions.
    mounts = Path('/proc/mounts')
    local_filesystems = {'ext2', 'ext3', 'ext4', 'btrfs', 'xfs', 'f2fs', 'zfs',
                         'bcachefs', 'jfs', 'reiserfs', 'nilfs2', 'tmpfs', 'ramfs', 'overlay', 'rootfs'}
    candidates = []
    if mounts.exists():
        for line in mounts.read_text().splitlines():
            fields = line.split()
            if len(fields) < 3:
                continue
            mount = Path(re.sub(r'\\([0-7]{3})', lambda m: chr(int(m[1], 8)), fields[1]))
            if directory.is_relative_to(mount):
                candidates.append((len(mount.parts), fields[2]))
    deepest = max((depth for depth, _ in candidates), default=-1)
    types = {filesystem for depth, filesystem in candidates if depth == deepest}
    # /proc/mounts can repeat a mount point. Reject an ambiguous remote/local
    # stack rather than choosing a type by string order.
    if not types or not types <= local_filesystems:
        raise ValueError('State must be on a supported local Linux filesystem, such as ext4.')
    if directory.exists() and (not directory.is_dir() or any(directory.iterdir())):
        raise ValueError('Fresh setup requires an empty Linux state directory.')
    return directory


def copy_runtime(directory):
    source = Path(__file__).resolve().parents[1]
    runtime = directory / 'runtime'
    bridge = runtime / 'bridge'
    with private_files():
        bridge.mkdir(parents=True)
        for path in (source / 'bridge').glob('*.py'):
            if path.name not in {'install_linux.py', 'backup_install.py'}:
                shutil.copyfile(path, bridge / path.name)
        for name in ('wall.html', 'prism.js', 'prism-adapters.js', 'prism-labels.js',
                     'requirements-controller.txt'):
            shutil.copyfile(source / 'bridge' / name, bridge / name)
        shutil.copytree(source / 'bridge/vendor', bridge / 'vendor')
        shutil.copytree(source / 'vendor', runtime / 'vendor')
        mcp = runtime / 'mcp'
        mcp.mkdir()
        for name in ('package.json', 'package-lock.json', 'tsconfig.json'):
            shutil.copyfile(source / 'mcp' / name, mcp / name)
        for name in ('src', 'scripts'):
            shutil.copytree(source / 'mcp' / name, mcp / name)
    return runtime


def write_launcher(directory, python):
    launcher = directory / 'nanoleaf'
    script = directory / 'runtime/bridge/bridge.py'
    text = ('#!/bin/sh\numask 077\nexec ' + shlex.join([str(python), str(script)]) +
            ' "$@" --state-dir ' + shlex.quote(str(directory)) + '\n')
    with private_files():
        launcher.write_text(text, encoding='utf-8')
        launcher.chmod(0o700)
    return launcher


def register_hooks(hooks_file, directory, python):
    hooks_file = Path(hooks_file).expanduser().resolve()
    original = json.loads(hooks_file.read_text(encoding='utf-8-sig')) if hooks_file.exists() else {}
    command = shlex.join([str(python), str(directory / 'runtime/bridge/bridge.py'),
                          'hook', '--state-dir', str(directory)])
    updated = b.merge_hooks(original, command)
    with private_files():
        hooks_file.parent.mkdir(parents=True, exist_ok=True)
        b.write_json(hooks_file, updated)


def systemd_argument(value):
    value = str(value)
    if any(char in value for char in '\n\r\0'):
        raise ValueError('Service paths must not contain line breaks or NUL.')
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%').replace('$', '$$') + '"'


def write_service_units(directory, units, python, node):
    units = Path(units).expanduser().resolve()
    config = json.loads((directory / 'config.json').read_text())
    script = directory / 'runtime/bridge/bridge.py'
    commands = {
        'wall': [python, script, 'serve', '--state-dir', directory, '--port', config['wall_port']],
        'controller': [python, script, 'controller-serve', '--state-dir', directory, '--port', config['controller_port']],
        'mcp': [node, directory / 'runtime/mcp/dist/main.js', '--config', directory / 'mcp-config.json'],
    }
    for name in commands:
        if (units / f'codex-nanoleaf-{name}.service').exists():
            raise ValueError('A Nanoleaf user service already exists. Retire its installation first.')
    with private_files():
        units.mkdir(parents=True, exist_ok=True)
        for name, command in commands.items():
            text = ('[Unit]\nDescription=Codex Nanoleaf ' + name + '\n\n[Service]\nType=simple\n' +
                    'ExecStart=' + ' '.join(systemd_argument(arg) for arg in command) +
                    '\nUMask=0077\nRestart=on-failure\nRestartSec=2\n\n[Install]\nWantedBy=default.target\n')
            with (units / f'codex-nanoleaf-{name}.service').open('x', encoding='utf-8') as output:
                output.write(text)


def prepare_state(directory, ip, token, *, wall_port=8765, controller_port=41231,
                  mcp_port=41230, desktop_state_path=None, metadata_path=None,
                  title_index_path=None, request=None):
    directory = linux_state_directory(directory)
    address = ipaddress.ip_address(ip)
    if address.version != 4 or not address.is_private:
        raise ValueError('Use a private IPv4 address for the lights.')
    if not token or not token.isascii() or not token.isalnum():
        raise ValueError('The device credential must contain only ASCII letters and numbers.')
    ports = (wall_port, controller_port, mcp_port)
    if any(type(port) is not int or not 1024 <= port <= 65535 for port in ports) or len(set(ports)) != 3:
        raise ValueError('Choose three distinct loopback ports from 1024 through 65535.')
    config = {'ip': str(address), 'token': token}
    layout = (request or b.light_request)(config, 'GET')['panelLayout']
    groups = b.pair_lines(layout)
    zones = {p['panelId']: p for p in layout['layout']['positionData']}
    saved = {
        'line_groups': groups,
        'line_positions': [[sum(zones[p]['x'] for p in pair) / 2,
                            sum(zones[p]['y'] for p in pair) / 2] for pair in groups],
        'zone_geometry': {'orientation': layout['globalOrientation']['value'],
                          'positionData': [p for p in zones.values() if p['shapeType'] == 18]},
    }
    try:
        saved['connector_geometry'], _ = b.wall.validated_connector_geometry({
            'orientation': layout['globalOrientation']['value'],
            'positionData': layout['layout']['positionData']}, groups)
    except (ValueError, TypeError, KeyError, OverflowError):
        pass  # Retain the existing standard-Line fallback for unsupported housings.
    config.update(wall_port=wall_port, controller_port=controller_port, mcp_port=mcp_port)
    for name, value in [('desktop_state_path', desktop_state_path),
                        ('metadata_path', metadata_path or desktop_state_path),
                        ('title_index_path', title_index_path)]:
        if value is not None:
            config[name] = str(Path(value).expanduser().resolve())
    with private_files():
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        directory.chmod(0o700)
        b.write_json(directory / 'config.json', config)
        b.write_json(directory / 'layout.json', saved)
        with contextlib.closing(b.connect_state(directory)) as db, db:
            pass
    return directory


def provision_machine_credentials(directory):
    import controller_server
    with private_files():
        controller_server.configure(directory, b, 'local-controller', 'wall', 'local-source')
        upstream = controller_server.issue(directory, b, 'codex', ['read', 'control'])
        client = secrets.token_urlsafe(32)
        b.write_json(directory / 'mcp-credentials.json', {'principals': [{
            'id': 'codex', 'tokenSha256': hashlib.sha256(client.encode()).hexdigest(),
            'scopes': ['read', 'control'], 'upstreamToken': upstream}]})
        ports = json.loads((directory / 'config.json').read_text())
        b.write_json(directory / 'mcp-config.json', {
            'enabled': True, 'port': ports['mcp_port'], 'controllerPort': ports['controller_port'],
            'controllerId': 'local-controller', 'deviceId': 'wall',
            # Compatibility name: this transport is direct Linux HTTP as well.
            'transport': 'windows-http', 'credentialsFile': str(directory / 'mcp-credentials.json')})
        (directory / 'mcp-client-token').write_text(client + '\n', encoding='ascii')


def native_tool(value, name):
    resolved = shutil.which(str(value)) if value else None
    if not resolved or Path(resolved).suffix.lower() in {'.exe', '.cmd', '.bat', '.ps1'}:
        raise ValueError(f'Install a native Linux {name} executable and select its path.')
    return Path(resolved).resolve()


def read_token(path):
    if path is None:
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            try:
                return getpass.getpass('Nanoleaf auth_token (hidden): ').strip()
            except getpass.GetPassWarning:
                raise ValueError('A hidden prompt is unavailable. Use a private --token-file.') from None
    descriptor = os.open(Path(path).expanduser(), os.O_RDONLY | os.O_NONBLOCK)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise ValueError('The token file must be a regular private text file.')
        value = os.read(descriptor, 1025)
        if len(value) > 1024:
            raise ValueError('The token file exceeds 1024 bytes.')
        return value.decode('ascii').strip()
    finally:
        os.close(descriptor)


def install(args, request=None):
    if sys.platform != 'linux' or sys.version_info < (3, 12):
        raise ValueError('Fresh Linux setup requires Linux Python 3.12 or newer.')
    directory = linux_state_directory(args.state_dir)
    node = native_tool(args.node, 'Node 24')
    npm = native_tool(args.npm, 'npm')
    version = subprocess.run([str(node), '--version'], check=True, capture_output=True, text=True).stdout.strip()
    if not re.fullmatch(r'v24\.\d+\.\d+', version):
        raise ValueError('The MCP host requires native Linux Node 24. Select it with --node.')
    units = Path(args.systemd_dir).expanduser().resolve()
    for name in ('wall', 'controller', 'mcp'):
        if (units / f'codex-nanoleaf-{name}.service').exists():
            raise ValueError('A Nanoleaf user service already exists. Retire its installation first.')
    hooks = [Path(path).expanduser().resolve() for path in args.hooks_file]
    for path in hooks:
        original = json.loads(path.read_text(encoding='utf-8-sig')) if path.exists() else {}
        b.merge_hooks(original, 'validation-only')
    prepare_state(directory, args.ip, read_token(args.token_file), wall_port=args.wall_port,
                  controller_port=args.controller_port, mcp_port=args.mcp_port,
                  desktop_state_path=args.desktop_state_path, metadata_path=args.metadata_path,
                  title_index_path=args.title_index_path, request=request)
    with private_files():
        runtime = copy_runtime(directory)
        venv.EnvBuilder(with_pip=True).create(directory / '.venv')
        python = directory / '.venv/bin/python'
        subprocess.run([str(python), '-m', 'pip', '--disable-pip-version-check', 'install',
                        '--no-cache-dir', '-r', str(runtime / 'bridge/requirements-controller.txt')], check=True)
        # Keep the selected Node binary with the installation so service startup
        # does not depend on a development checkout or a temporary download.
        installed_node = runtime / 'node/bin/node'
        installed_node.parent.mkdir(parents=True)
        shutil.copyfile(node, installed_node)
        installed_node.chmod(0o700)
        environment = dict(os.environ, PATH=str(installed_node.parent) + os.pathsep + os.environ.get('PATH', ''))
        environment['npm_config_cache'] = str(directory / '.npm-cache')
        for command in (['ci', '--ignore-scripts', '--no-audit', '--no-fund'], ['run', 'verify'], ['run', 'build']):
            subprocess.run([str(npm), '--prefix', str(runtime / 'mcp'), *command], check=True, env=environment)
        provision_machine_credentials(directory)
        launcher = write_launcher(directory, python)
        write_service_units(directory, units, python, installed_node)
        for hooks_file in hooks:
            register_hooks(hooks_file, directory, python)
    return launcher


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument('--ip', required=True, help='Configured private IPv4 address of the Nanoleaf device.')
    result.add_argument('--token-file', type=Path, help='Private token-only file; otherwise use a hidden prompt.')
    result.add_argument('--state-dir', type=Path, default=Path.home() / '.local/share/codex-nanoleaf')
    result.add_argument('--hooks-file', type=Path, action='append', help='Codex hooks.json; repeat for separate Codex homes.')
    result.add_argument('--systemd-dir', type=Path, default=Path.home() / '.config/systemd/user')
    result.add_argument('--desktop-state-path', type=Path, help='Mounted Desktop unread-state JSON, read-only.')
    result.add_argument('--metadata-path', type=Path, help='Project metadata JSON; defaults to --desktop-state-path.')
    result.add_argument('--title-index-path', type=Path, help='Mounted Desktop session_index.jsonl, read-only.')
    result.add_argument('--wall-port', type=int, default=8765)
    result.add_argument('--controller-port', type=int, default=41231)
    result.add_argument('--mcp-port', type=int, default=41230)
    result.add_argument('--node', default='node', help='Native Node 24 executable, copied into the private installation.')
    result.add_argument('--npm', default='npm', help='Native npm executable used only during setup.')
    return result


def main():
    arguments = parser().parse_args()
    if arguments.hooks_file is None:
        arguments.hooks_file = [Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'hooks.json']
    try:
        launcher = install(arguments)
    except ValueError as error:
        print(f'Linux setup: {error}', file=sys.stderr)
        return 1
    except Exception:
        print('Linux setup failed. Check the device credential, network, dependencies, and writable paths. '
              'Hooks are registered only after runtime preparation. Services were not started.', file=sys.stderr)
        return 1
    print(f'Installed Linux commands: {launcher}')
    print(f'Wall map: http://127.0.0.1:{arguments.wall_port}')
    print(f'MCP bearer is in the private file {launcher.parent / "mcp-client-token"}.')
    print('Review and trust the Nanoleaf hooks in Codex settings.')
    print('After retiring the Windows installation, run from ordinary WSL:')
    print('systemctl --user daemon-reload')
    print('systemctl --user enable --now codex-nanoleaf-wall codex-nanoleaf-controller codex-nanoleaf-mcp')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
