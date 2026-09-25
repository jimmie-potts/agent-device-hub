"""Where we've been / where we're going: one dated history chart and one
ordered (not dated) roadmap map, both rendered as inline SVG for the guide.

History comes from work/history/github-history.json (read-only gh api reads).
The roadmap is derived from the guides and the current issue snapshot. Future
stages are ordered by prerequisite, never assigned dates.
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import html
import json

TZ = ZoneInfo('America/New_York')
# Layout limits tied to the guide CSS: 10px axis labels and 11px node labels in 188-unit nodes.
DAY_LABEL_GAP = 56
NODE_LABEL_CHARS = 27
REPO_ORDER = ['H', 'N', 'P']
REPO_NAME = {'H': 'agent-device-hub', 'N': 'codex-nanoleaf', 'P': 'divoom-app-upgrade'}
REPO_LABEL = {'H': 'Hub', 'N': 'Nanoleaf', 'P': 'Pixoo'}
# Delivered baselines worth naming on the history chart (repo key, PR number, caption).
MILESTONES = {
    ('H', 135): 'Standalone qualification', ('H', 74): 'Lifecycle contract v1', ('H', 12): 'Shared architecture', ('H', 28): 'Controller contract v1', ('H', 29): 'Device MCP module',
    ('H', 275): 'Now-playing controls', ('H', 284): 'Session retirement', ('H', 299): 'ADR 0006 moments', ('H', 318): 'Local controller host', ('H', 321): 'Contract 1.1 moments', ('H', 326): 'ADR 0007 shell', ('H', 339): 'ADR 0008 hosting',
    ('N', 39): 'Protected controller API', ('N', 48): 'Nanoleaf MCP bindings', ('N', 56): 'Connector geometry', ('N', 144): 'Lines/Panels selector', ('N', 164): 'Panels controller',
    ('P', 60): 'Embedded monitor host', ('P', 54): 'Local reliability', ('P', 53): 'Monitoring contract', ('P', 28): 'Playlist playback', ('P', 45): 'Physical Pixoo adapter', ('P', 49): 'Pixoo MCP media tools', ('P', 90): 'Now-playing cards', ('P', 50): 'Local Codex acceptance',
}

# Roadmap columns order each track. Cross-track prerequisites come from arrows,
# not from the shared Codex milestone's position in a different row.
SLOTS = ['First in this track', 'Next in this track', 'Following stage', 'Later', 'Deferred · conditional']
TRACKS = [
    ('Main product path', [
        dict(id='n-local', x=0, label='Local + Codex milestones', issues=[], guide='local-acceptance'),
        dict(id='n-codex', x=1, label='UI foundation delivered', issues=['H181', 'H182'], guide='bunny-controls', main=True),
        dict(id='n-controls', x=2, label='Alias fix · setup docs', issues=['H247', 'H244', 'H245', 'H232', 'P67', 'N91'], guide='bunny-controls', main=True),
        dict(id='n-music', x=3, label='Sonos Move · later music', issues=['H233', 'H242', 'H37', 'H38', 'H39', 'H229', 'H36', 'H178', 'H40', 'H41', 'H35'], guide='controls-music', main=True),
        dict(id='n-assistant', x=4, label='Assistant + access', issues=['H45', 'H46', 'H47', 'H48'], guide='assistant-access', main=True),
    ]),
    ('B.U.N.N.Y. shell', [
        dict(id='n-shell-open', x=0, label='Bookmark · dense home', issues=['H276', 'H277'], guide='bunny-controls'),
        dict(id='n-shell-widgets', x=1, label='Widgets · Panels · wall art', issues=['H287', 'H286', 'H323', 'H355'], guide='bunny-controls'),
        dict(id='n-shell-status', x=2, label='Status page + histories', issues=['H282', 'H283', 'H329', 'H342'], guide='bunny-controls'),
        dict(id='n-shell-ideas', x=3, label='Device widget ideas', issues=['H333', 'H336', 'H362', 'H363'], guide='bunny-controls'),
        dict(id='n-shell-pages', x=4, label='Group page · task pool', issues=['H271', 'H272'], guide='bunny-controls'),
    ]),
    ('Widget navigation', [
        dict(id='n-shell-nav', x=1, label='Palette · N30 · catalog', issues=['H288', 'H366'], guide='desktop-controls'),
    ]),
    ('Hub moments', [
        dict(id='n-moments-rules', x=0, label='Rules · MCP catalog size', issues=['H358', 'H357'], guide='assistant-access'),
        dict(id='n-moments-send', x=1, label='Send moments · sources', issues=['H335', 'H293', 'H298', 'H352'], guide='assistant-access'),
        dict(id='n-moments-agents', x=2, label='Personas · proposals · log', issues=['H294', 'H295', 'H296', 'H297'], guide='assistant-access'),
        dict(id='n-moments-routines', x=3, label='Routines · automation UI', issues=['H359', 'H360', 'H369'], guide='assistant-access'),
    ]),
    ('Now-playing follow-ups', [
        dict(id='n-music-cards', x=3, label='Artwork · source switch', issues=['H285', 'H331'], guide='controls-music'),
        dict(id='n-music-ideas', x=4, label='Music ideas', issues=['H334', 'H345', 'H346', 'H349', 'H350'], guide='controls-music'),
    ]),
    ('Session settings + aliases', [
        dict(id='n-settings-observe', x=1, label='Model + level observed', issues=['H305', 'H306'], guide='shared-codex'),
        dict(id='n-settings-records', x=2, label='Delivery record · aliases', issues=['H343', 'H364'], guide='shared-codex'),
    ]),
    ('Producers + MCP clients', [
        dict(id='n-producers', x=1, label='Producer · MCP registration', issues=['H367', 'N159', 'N160'], guide='shared-codex'),
        dict(id='n-producers-ends', x=2, label='Session-end qualification', issues=['H312'], guide='shared-codex'),
    ]),
    ('Monitor readability', [
        dict(id='n-monitor-rows', x=1, label='Pixoo rows · layout', issues=['P87', 'P98'], guide='shared-codex'),
        dict(id='n-monitor-stale', x=2, label='Retire stale attention', issues=['H332'], guide='shared-codex'),
    ]),
    ('Monitor status and recovery', [
        dict(id='n-status-fix', x=0, label='Current status delivered', issues=[], guide='shared-codex'),
        dict(id='n-status-reset', x=1, label='Optional per-task reset', issues=['H138'], guide='shared-codex'),
    ]),
    ('Session retirement', [
        dict(id='n-shared-lifetime', x=0, label='Read state + expiry done', issues=[], guide='shared-codex'),
        dict(id='n-shared-retire', x=1, label='Desktop retirement done', issues=['H218'], guide='shared-codex'),
        dict(id='n-shared-retire-all', x=2, label='Provider retirement done', issues=['H241'], guide='shared-codex'),
        dict(id='n-nl-presence', x=3, label='Work/Free by presence', issues=['N110'], guide='shared-codex'),
    ]),
    ('Evict everywhere', [
        dict(id='n-shared-evict', x=3, label='Evict on every device', issues=['H262'], guide='shared-codex'),
    ]),
    ('Desktop SessionEnd', [
        dict(id='n-shared-sessionend', x=1, label='Qualify Desktop SessionEnd', issues=['H253'], guide='shared-codex'),
    ]),
    ('Change notifications', [
        dict(id='n-shared-push', x=1, label='Commit notices delivered', issues=['H222'], guide='shared-codex'),
        dict(id='n-nl-push', x=2, label='Nanoleaf wakes on push', issues=['N90'], guide='shared-codex'),
    ]),
    ('Reliable event history', [
        dict(id='n-event-history', x=4, label='History refinement', issues=['H139'], guide='shared-codex'),
    ]),
    ('Desktop controls (shortcut path)', [
        dict(id='n-desk-doc', x=0, label='Input qualified', issues=[], guide='desktop-controls'),
        dict(id='n-desk-local', x=1, label='Codex mouse controls', issues=['H65', 'H66'], guide='desktop-controls'),
        dict(id='n-desk-presets', x=2, label='Work / Free / Quiet presets', issues=['H67', 'H68'], guide='desktop-controls'),
        dict(id='n-desk-verify', x=3, label='Preset verification', issues=['H69'], guide='desktop-controls'),
        dict(id='n-desk-later', x=4, label='Profiles · Music preset', issues=['H70', 'H71'], guide='desktop-controls'),
    ]),
    ('Cross-device looks', [
        dict(id='n-desk-looks', x=4, label='Coordinated device looks', issues=['H267'], guide='desktop-controls'),
    ]),
    ('Nanoleaf Lines + Light Panels', [
        dict(id='n-nl-state', x=0, label='State + geometry delivered', issues=[], guide='nanoleaf-devices'),
        dict(id='n-nl-accept', x=1, label='Panels trial accepted', issues=[], guide='nanoleaf-devices'),
        dict(id='n-nl-map', x=2, label='Install Panels · scenes', issues=['N44', 'N167', 'N168'], guide='nanoleaf-devices'),
        dict(id='n-nl-pool', x=4, label='Combined pool', issues=['N47'], guide='nanoleaf-devices'),
    ]),
    ('Nanoleaf external control', [
        dict(id='n-nl-external', x=1, label='Report external changes', issues=['N161'], guide='nanoleaf-devices'),
    ]),
    ('Wall map retirement', [
        dict(id='n-shell-geometry', x=0, label='Geometry · extension ops', issues=['N169', 'N170'], guide='nanoleaf-devices'),
        dict(id='n-shell-retire', x=4, label='Retire the wall map', issues=['N171'], guide='nanoleaf-devices'),
    ]),
    ('LIFX Beam', [
        dict(id='n-beam-ctrl', x=2, label='Beam controller', issues=['H319'], guide='nanoleaf-devices'),
        dict(id='n-beam-install', x=3, label='Beam install · zone strip', issues=['H320', 'H327'], guide='nanoleaf-devices'),
    ]),
    ('Tidbyt + LIFX moments', [
        dict(id='n-tl-moments', x=3, label='Moments on Tidbyt + LIFX', issues=['H337'], guide='nanoleaf-devices'),
    ]),
    ('Nanoleaf wall map hierarchy', [
        dict(id='n-map-hierarchy', x=0, label='Projects + tasks delivered', issues=[], guide='nanoleaf-presentation'),
        dict(id='n-map-layout', x=1, label='Default layout simplified', issues=[], guide='nanoleaf-presentation'),
        dict(id='n-map-inspector', x=2, label='Show the Lines hold', issues=['N117', 'N112', 'N135'], guide='nanoleaf-presentation'),
    ]),
    ('Task metadata', [
        dict(id='n-map-metadata', x=0, label='Titles + thread links done', issues=[], guide='nanoleaf-presentation'),
        dict(id='n-map-source', x=1, label='Undeclared source fixed', issues=['N111'], guide='nanoleaf-presentation'),
        dict(id='n-map-claude', x=2, label='Claude Code titles', issues=['N100'], guide='nanoleaf-presentation'),
    ]),
    ('Work-mode colors', [
        dict(id='n-nl-colors', x=1, label='Work-mode colors delivered', issues=['N139'], guide='nanoleaf-presentation'),
    ]),
    ('Comets and animations', [
        dict(id='n-map-comets', x=1, label='Comet and wave fixes', issues=['N81', 'N115', 'N92'], guide='nanoleaf-presentation'),
    ]),
    ('Requested animations', [
        dict(id='n-anim-safety', x=1, label='Stop · restore · flash cap', issues=['N150', 'N149'], guide='nanoleaf-presentation'),
        dict(id='n-anim-patterns', x=2, label='Presets · speed · chase', issues=['N151', 'N152', 'N153'], guide='nanoleaf-presentation'),
        dict(id='n-anim-save', x=3, label='Save · scene · preview', issues=['N154', 'N155', 'N156'], guide='nanoleaf-presentation'),
        dict(id='n-anim-moments', x=4, label='Panels · events · moments', issues=['N157', 'N146', 'N158'], guide='nanoleaf-presentation'),
    ]),
    ('Nanoleaf rendering + displays', [
        dict(id='n-np-fix', x=0, label='Scene findings delivered', issues=[], guide='nanoleaf-presentation'),
        dict(id='n-np-render', x=1, label='Live app renderer', issues=['N17'], guide='nanoleaf-presentation'),
        dict(id='n-np-custom', x=2, label='Palettes + effects', issues=['N18', 'N19', 'N20'], guide='nanoleaf-presentation'),
        dict(id='n-np-ambient', x=4, label='Ambient view', issues=['N16'], guide='nanoleaf-presentation'),
    ]),
    ('Prism wall artwork', [
        dict(id='n-prism-geometry', x=0, label='Geometry delivered', issues=[], guide='nanoleaf-presentation'),
        dict(id='n-prism-renderer', x=1, label='Crystal + flow delivered', issues=[], guide='nanoleaf-presentation'),
        dict(id='n-prism-numbers', x=2, label='Luminous numbers delivered', issues=[], guide='nanoleaf-presentation'),
    ]),
    ('Tidbyt + LIFX', [
        dict(id='n-tl-qual', x=0, label='Qualification done', issues=[], guide='tidbyt-lifx'),
        dict(id='n-tl-ctrl', x=1, label='Controllers · host done', issues=[], guide='tidbyt-lifx'),
        dict(id='n-tl-status', x=2, label='LIFX status · Tidbyt text', issues=['H20', 'H227'], guide='tidbyt-lifx'),
        dict(id='n-tl-accept', x=3, label='LIFX install check', issues=['H22'], guide='tidbyt-lifx'),
        dict(id='n-tl-later', x=4, label='Tronbyt · other options', issues=['H23', 'H24', 'H11'], guide='tidbyt-lifx'),
    ]),
    ('PC + desk lighting', [
        dict(id='n-pc-doc', x=0, label='Documentation issue closed', issues=[], guide='pc-lighting'),
        dict(id='n-pc-qual', x=1, label='Qualification', issues=['H51', 'H52', 'H60'], guide='pc-lighting'),
        dict(id='n-pc-ctrl', x=2, label='Corsair controller · status', issues=['H53', 'H55'], guide='pc-lighting'),
        dict(id='n-pc-accept', x=3, label='Acceptance · shared UI', issues=['H57', 'H56'], guide='pc-lighting'),
        dict(id='n-pc-opt', x=4, label='Strimer · Varmilo', issues=['H58', 'H61', 'H62'], guide='pc-lighting'),
    ]),
    ('Pixoo media + access', [
        dict(id='n-px-media', x=2, label='Media · cloud-free display', issues=['P79', 'P76', 'P52', 'P55', 'P13', 'P15', 'P16', 'P18'], guide='pixoo-media'),
        dict(id='n-px-access', x=3, label='Remote browser · ChatGPT', issues=['P11', 'P43', 'P17', 'P44'], guide='assistant-access'),
    ]),
    ('Pixoo catalog + moments', [
        dict(id='n-px-catalog', x=2, label='Catalog API · page previews', issues=['P96', 'H353'], guide='pixoo-media'),
        dict(id='n-px-moments', x=3, label='Moods · interludes · art', issues=['P91', 'P92', 'P93', 'P94'], guide='pixoo-media'),
        dict(id='n-px-cards', x=4, label='Pixel cards · widgets', issues=['H365', 'H368'], guide='pixoo-media'),
    ]),
    ('Nanoleaf Linux runtime', [
        dict(id='n-linux-acceptance', x=0, label='Linux runtime accepted', issues=[], guide='hosting-migrations'),
        dict(id='n-linux-signin', x=1, label='WSL availability decided', issues=[], guide='hosting-migrations'),
        dict(id='n-linux-retire', x=2, label='Windows runtime retired', issues=['N131', 'N132'], guide='hosting-migrations'),
        dict(id='n-linux-upgrade', x=3, label='Upgrade + rollback command', issues=['N140'], guide='hosting-migrations'),
    ]),
    ('Pixoo installation', [
        dict(id='n-px-service', x=0, label='User service delivered', issues=['P77'], guide='hosting-migrations'),
    ]),
    ('Pixoo network', [
        dict(id='n-px-cloud', x=0, label='Divoom cloud disconnect', issues=['P83'], guide='pixoo-media'),
    ]),
    ('Hosting + migrations', [
        dict(id='n-host-keepalive', x=1, label='Keep-alive · clean stops', issues=['H356', 'H361'], guide='hosting-migrations'),
        dict(id='n-host', x=2, label='Linux server · ARM64 check', issues=['H44', 'P14'], guide='hosting-migrations'),
        dict(id='n-host-src', x=4, label='Source consolidation', issues=['H25', 'H26'], guide='hosting-migrations'),
    ]),
    ('Development workflow', [
        dict(id='n-dev-jobs', x=0, label='Job merge not planned', issues=[], guide='development-workflow'),
        dict(id='n-dev-spec', x=1, label='OpenSpec tools not planned', issues=[], guide='development-workflow'),
        dict(id='n-hub-cache-docs', x=2, label='Setup cache docs delivered', issues=[], guide='development-workflow'),
    ]),
    ('Hub maintenance', [
        dict(id='n-hub-gates', x=0, label='Merge gates · contracts', issues=['H240', 'H246'], guide='development-workflow'),
    ]),
    ('Documentation drift', [
        dict(id='n-hub-drift', x=0, label='Docs drift in CI', issues=['H258'], guide='development-workflow'),
    ]),
    ('Dashboard test stability', [
        dict(id='n-hub-flake', x=0, label='Dashboard job flakes', issues=['H263', 'H303'], guide='development-workflow'),
    ]),
    ('Delivery hygiene', [
        dict(id='n-dev-hygiene', x=0, label='Branches · gotchas · digest', issues=['H309', 'H310', 'H314'], guide='development-workflow'),
    ]),
    ('Nanoleaf docs', [
        dict(id='n-nl-docs', x=0, label='Upgrade docs · glossary', issues=['N162', 'N163'], guide='development-workflow'),
    ]),
    ('Nanoleaf architecture', [
        dict(id='n-nl-config', x=0, label='Config and hook owners', issues=['N118'], guide='development-workflow'),
        dict(id='n-nl-owners', x=1, label='Render input · state owners', issues=['N127', 'N120'], guide='development-workflow'),
    ]),
    ('Nanoleaf worker context', [
        dict(id='n-nl-context', x=2, label='Worker device context', issues=['N121'], guide='development-workflow'),
    ]),
    ('Nanoleaf investigations', [
        dict(id='n-nl-studies', x=3, label='Later investigations', issues=['N122', 'N128', 'N129', 'N130'], guide='development-workflow'),
    ]),
    ('Nanoleaf wall page code', [
        dict(id='n-wall-decide', x=0, label='Renderer decision', issues=['N123'], guide='nanoleaf-presentation'),
        dict(id='n-wall-scheduler', x=1, label='One rebuild scheduler', issues=['N119'], guide='development-workflow'),
    ]),
    ('Wall rendering baseline', [
        dict(id='n-wall-edge', x=0, label='Edge rendering baseline', issues=['N124'], guide='nanoleaf-presentation'),
    ]),
    ('Pixoo code maintenance', [
        dict(id='n-px-typed', x=0, label='Typed commands · SSE · docs', issues=['P80', 'P81', 'P82', 'P86'], guide='development-workflow'),
    ]),
    ('Engineering maintenance', [
        dict(id='n-performance', x=4, label='Later performance work', issues=['P61', 'H123'], guide='development-workflow'),
    ]),
    ('Guide defects', [
        dict(id='n-dev-ci', x=0, label='Diagram connector fix', issues=['H73'], guide='development-workflow'),
    ]),
    ('System design documents', [
        dict(id='n-system-design', x=0, label='Atlas published', issues=[], guide='development-workflow'),
    ]),
    ('Guide workflow checkpoints', [
        dict(id='n-guide-workflow', x=0, label='Pixoo guide rules done', issues=[], guide='development-workflow'),
    ]),
    ('Guide Neon restyle + rollout', [
        dict(id='n-guide-design', x=0, label='Neon restyle delivered', issues=['H85'], guide='development-workflow'),
        dict(id='n-guide-artwork', x=1, label='Guide artwork not planned', issues=[], guide='development-workflow'),
        dict(id='n-guide-publish', x=2, label='Mobile publication done', issues=['H87'], guide='development-workflow'),
    ]),
    ('Guide mobile tasks and status', [
        dict(id='n-guide-mobile', x=0, label='Live status delivered', issues=[], guide='development-workflow'),
    ]),
    ('Guide overview', [
        dict(id='n-guide-overview', x=0, label='Overview refresh delivered', issues=[], guide='work-guide'),
    ]),
    ('Guide refresh + records', [
        dict(id='n-guide-snapshot', x=0, label='Snapshot · stale text', issues=['H324', 'H311', 'H341'], guide='work-guide'),
        dict(id='n-guide-nightly', x=1, label='Nightly refresh · warnings', issues=['H315', 'H316'], guide='work-guide'),
        dict(id='n-guide-publish-auto', x=2, label='Auto publish · installed', issues=['H317', 'H313'], guide='work-guide'),
        dict(id='n-guide-records', x=3, label='Delivery records', issues=['H307'], guide='work-guide'),
        dict(id='n-guide-ideas', x=4, label='Guide ideas', issues=['H325', 'H328', 'H344', 'H347', 'H348'], guide='work-guide'),
    ]),
    ('Guide navigation + polish', [
        dict(id='n-guide-places', x=0, label='Places nav · alignment', issues=['H278', 'H279'], guide='work-guide'),
    ]),
    ('Guide automatic refresh', [
        dict(id='n-guide-refresh', x=3, label='Auto refresh not planned', issues=[], guide='development-workflow'),
    ]),
    ('Guide cleanup + clipboard check', [
        dict(id='n-guide-clipboard', x=0, label='Clipboard check completed', issues=[], guide='development-workflow'),
        dict(id='n-guide-cleanup', x=1, label='Cleanup follow-up done', issues=[], guide='development-workflow'),
    ]),
    ('Guide recommendations', [
        dict(id='n-guide-recs', x=0, label='Session labels delivered', issues=['H252'], guide='work-guide'),
        dict(id='n-guide-placement', x=1, label='Story placement delivered', issues=['H259'], guide='work-guide'),
    ]),
    ('Guide skins and motion', [
        dict(id='n-guide-cards', x=2, label='Trading-card skin', issues=['H254'], guide='work-guide'),
    ]),
    ('Guide motion', [
        dict(id='n-guide-trace', x=2, label='Circuit trace delivered', issues=['H264'], guide='work-guide'),
    ]),
    ('Guide mission map', [
        dict(id='n-guide-map', x=2, label='Neon mission map', issues=['H201'], guide='development-workflow'),
    ]),
    ('Atlas signal playback', [
        dict(id='n-atlas-playback', x=2, label='Controlled signal playback', issues=['H202'], guide='development-workflow'),
    ]),
    ('Optional history replay', [
        dict(id='n-guide-replay', x=4, label='Recorded delivery history', issues=['H198'], guide='development-workflow'),
    ]),
    ('Later app coordination', [
        dict(id='n-app-qualify', x=0, label='Qualify native-app paths', issues=['H199'], guide='development-workflow'),
        dict(id='n-app-boundary', x=1, label='Owner sign-in + boundary', issues=['H203'], guide='development-workflow'),
        dict(id='n-app-inbox', x=2, label='Private task inbox', issues=['H204'], guide='development-workflow'),
        dict(id='n-app-handoff', x=3, label='Qualified app handoff', issues=['H205'], guide='development-workflow'),
    ]),
]
# Cross-track prerequisites (from → to). Same-track order is drawn automatically.
CROSS = [
    # #85 (the Neon restyle) has closed, so it no longer draws as a prerequisite.
    ('n-shared-retire-all', 'n-shared-evict', 'H241'), ('n-nl-colors', 'n-np-custom', 'N139'),
    ('n-guide-mobile', 'n-guide-publish', 'H197'), ('n-shell-geometry', 'n-shell-widgets', 'N169'), ('n-host', 'n-tl-later', 'H44'),
    ('n-guide-clipboard', 'n-guide-cleanup', 'H210'),
    ('n-guide-clipboard', 'n-hub-cache-docs', 'H210'),
    ('n-guide-mobile', 'n-guide-refresh', 'H197 only'),
    ('n-guide-publish', 'n-guide-refresh', 'H87'),
    ('n-app-qualify', 'n-app-handoff', 'H199'),
    ('n-app-boundary', 'n-app-handoff', 'H203'),
    # Delivered local and Codex milestone inputs (H3, H5, H8, H31, H32, P31) start at the first main-path node.
    ('n-local', 'n-desk-presets', 'H32 · H31 · H5'), ('n-local', 'n-tl-status', 'H3 · P31'), ('n-local', 'n-pc-ctrl', 'H3 · P31'),
    ('n-local', 'n-tl-accept', 'H8'), ('n-local', 'n-pc-accept', 'H8'), ('n-local', 'n-desk-verify', 'H8'),
    ('n-local', 'n-px-media', 'P12'), ('n-local', 'n-px-access', 'P12 · P26'), ('n-local', 'n-host', 'H5'),
    ('n-music', 'n-desk-later', 'H40'), ('n-desk-local', 'n-desk-presets', 'H65'),
    ('n-desk-presets', 'n-desk-looks', 'H67'),
    # Nanoleaf #121 starts after #118 and after the worker fixes in #111, #112 and #115 merge.
    ('n-nl-config', 'n-nl-context', 'N118'), ('n-map-source', 'n-nl-context', 'N111'),
    ('n-map-inspector', 'n-nl-context', 'N112'), ('n-map-comets', 'n-nl-context', 'N115'),
]


def esc(value):
    return html.escape(str(value), quote=True)


def local(iso):
    return datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone(TZ)


def history_chart(history, snapshot_iso, issues):
    repos = history['repositories']
    start = min(local(v['createdAt']) for v in repos.values())
    end = local(snapshot_iso)
    start = start - timedelta(hours=2)
    span = (end + timedelta(hours=4) - start).total_seconds()
    left, right, top = 150, 24, 46
    row_h, width = 92, 1000
    plot_w = width - left - right
    height = top + row_h * 3 + 44

    def x(dt):
        return left + plot_w * (dt - start).total_seconds() / span

    parts = [f'<svg class="history" viewBox="0 0 {width} {height}" role="img" aria-labelledby="history-title history-desc" preserveAspectRatio="xMidYMid meet">',
             f'<title id="history-title">Merged pull requests per repository through {esc(end.strftime("%B %d, %Y"))}</title>',
             f'<desc id="history-desc">Three rows, one per repository, with a mark for every pull request merged to main between repository creation and the backlog snapshot. Milestone deliveries are ringed and captioned where space allows; each milestone is named in its tooltip. A vertical line marks the backlog snapshot time.</desc>']
    # ticks every 12 hours, day labels at local midnight
    tick = start.replace(hour=0, minute=0, second=0, microsecond=0)
    labelled = -100
    while tick <= end + timedelta(hours=4):
        if tick >= start:
            tx = x(tick)
            major = tick.hour == 0
            parts.append(f'<line class="tick{" major" if major else ""}" x1="{tx:.1f}" y1="{top - 6}" x2="{tx:.1f}" y2="{height - 40}"/>')
            # Day labels only, spaced so they never overlap as the history grows.
            if major and tx - labelled >= DAY_LABEL_GAP:
                parts.append(f'<text class="tick-label" x="{tx:.1f}" y="{height - 22}" text-anchor="middle">{esc(tick.strftime("%b %-d"))}</text>')
                labelled = tx
        tick += timedelta(hours=12)
    snapshot_x = x(end)
    parts.append(f'<line class="snapshot-line" x1="{snapshot_x:.1f}" y1="{top - 14}" x2="{snapshot_x:.1f}" y2="{height - 40}"/>')
    parts.append(f'<text class="snapshot-label" x="{snapshot_x - 6:.1f}" y="{top - 18}" text-anchor="end">backlog snapshot {esc(end.strftime("%b %d %H:%M %Z"))}</text>')
    totals = {'merged': 0, 'closed': 0, 'commits': 0}
    for index, key in enumerate(REPO_ORDER):
        repo = repos[REPO_NAME[key]]
        cy = top + row_h * index + row_h / 2
        parts.append(f'<line class="row-line" x1="{left}" y1="{cy:.1f}" x2="{width - right}" y2="{cy:.1f}"/>')
        parts.append(f'<text class="row-label repo-{key}" x="{left - 12}" y="{cy - 4:.1f}" text-anchor="end">{esc(REPO_LABEL[key])}</text>')
        parts.append(f'<text class="row-meta" x="{left - 12}" y="{cy + 12:.1f}" text-anchor="end">{len(repo["mergedPRs"])} merged · {len(repo["closedIssues"])} closed</text>')
        created = x(local(repo['createdAt']))
        parts.append(f'<g class="repo-start"><line x1="{created:.1f}" y1="{cy - 14:.1f}" x2="{created:.1f}" y2="{cy + 14:.1f}"/><text x="{created + 4:.1f}" y="{cy - 17:.1f}">repo created</text></g>')
        last_x, lane = -100, 0
        # Milestone captions take the first free level below the row, then above it.
        levels = [cy + 30, cy + 41, cy - 24, cy - 35]
        placed = {level: [(created - 6, created + 70)] if level < cy else [] for level in levels}
        for pr in repo['mergedPRs']:
            when = local(pr['mergedAt'])
            px = x(when)
            lane = (lane + 1) % 3 if px - last_x < 9 else 0
            last_x = px
            py = cy + (0, -9, 9)[lane]
            milestone = MILESTONES.get((key, pr['number']))
            label = f'{REPO_LABEL[key]} PR #{pr["number"]}: {pr["title"]}'
            classes = f'pr repo-{key}{" milestone" if milestone else ""}'
            caption = ''
            if milestone:
                half = len(milestone) * 2.7 + 4
                level = next((lv for lv in levels if all(px + half < a or px - half > b for a, b in placed[lv])), None)
                # A crowded baseline keeps its ring and names itself in the tooltip instead of overlapping another caption.
                if level is not None:
                    placed[level].append((px - half, px + half))
                    leader = f'<line class="leader" x1="{px:.1f}" y1="{py + (7 if level > cy else -7):.1f}" x2="{px:.1f}" y2="{level - (8 if level > cy else -3):.1f}"/>' if abs(level - cy) > 30 else ''
                    caption = leader + f'<text class="milestone-label" x="{px:.1f}" y="{level:.1f}" text-anchor="middle">{esc(milestone)}</text>'
            detail = f' data-detail="Delivery baseline: {esc(milestone)}"' if milestone else ''
            parts.append(f'<a class="{classes}" href="{esc(pr["url"])}" target="_blank" rel="noopener noreferrer" data-repo="{key}" data-tip="{esc(label)}" data-when="{esc(when.strftime("%a %b %d, %H:%M %Z"))}"{detail} aria-label="{esc(label)}, merged {esc(when.strftime("%b %d %H:%M %Z"))}{", delivery baseline " + esc(milestone) if milestone else ""}">'
                         f'<circle cx="{px:.1f}" cy="{py:.1f}" r="{7 if milestone else 5}"/>' + caption + '</a>')
        totals['merged'] += len(repo['mergedPRs']); totals['closed'] += len(repo['closedIssues']); totals['commits'] += repo['mainCommitCount']
    parts.append('</svg>')
    return ''.join(parts), totals


def roadmap_map(issues, guides_by_id):
    slot_w, left, top, track_h, node_w, node_h = 206, 236, 74, 66, 188, 44
    width = left + slot_w * len(SLOTS) + 12
    height = top + track_h * len(TRACKS) + 20
    nodes = {}
    for track_index, (track, items) in enumerate(TRACKS):
        for item in items:
            cx = left + slot_w * item['x'] + slot_w / 2
            cy = top + track_h * track_index + track_h / 2
            nodes[item['id']] = dict(item, cx=cx, cy=cy, track=track)
    parts = [f'<svg class="roadmap" viewBox="0 0 {width} {height}" role="img" aria-labelledby="roadmap-title roadmap-desc" preserveAspectRatio="xMidYMid meet">',
             '<title id="roadmap-title">Ordered roadmap of the remaining work guides</title>',
             '<desc id="roadmap-desc">Rows are work tracks. Columns order stages from first to deferred; they are not dates. Solid connectors show order within a track; dashed connectors show cross-track prerequisites. Each node links to its work guide and lists its issues.</desc>',
             '<defs><marker id="road-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 8 4 0 8z"/></marker></defs>']
    for slot, name in enumerate(SLOTS):
        sx = left + slot_w * slot
        parts.append(f'<rect class="slot{" even" if slot % 2 else ""}" x="{sx}" y="{top - 30}" width="{slot_w}" height="{height - top + 10}"/>')
        parts.append(f'<text class="slot-label" x="{sx + slot_w / 2:.1f}" y="{top - 40}" text-anchor="middle">{esc(name)}</text>')
    for track_index, (track, items) in enumerate(TRACKS):
        cy = top + track_h * track_index + track_h / 2
        parts.append(f'<text class="track-label{" main" if track_index == 0 else ""}" x="{left - 14}" y="{cy + 4:.1f}" text-anchor="end">{esc(track)}</text>')
        for a, b in zip(items, items[1:]):
            na, nb = nodes[a['id']], nodes[b['id']]
            parts.append(f'<line class="edge same" data-from="{a["id"]}" data-to="{b["id"]}" x1="{na["cx"] + node_w / 2:.1f}" y1="{cy:.1f}" x2="{nb["cx"] - node_w / 2:.1f}" y2="{cy:.1f}" marker-end="url(#road-arrow)"/>')
    for frm, to, why in CROSS:
        a, b = nodes[frm], nodes[to]
        x1, y1 = a['cx'], a['cy'] + node_h / 2
        x2, y2 = b['cx'] - node_w / 2, b['cy']
        parts.append(f'<path class="edge cross" data-from="{frm}" data-to="{to}" d="M{x1:.1f} {y1:.1f} C {x1:.1f} {(y1 + y2) / 2:.1f}, {x2 - 40:.1f} {y2:.1f}, {x2:.1f} {y2:.1f}" marker-end="url(#road-arrow)"><title>{esc(a["label"])} → {esc(b["label"])}: needs {esc(why)}</title></path>')
    listed = []
    for node in nodes.values():
        keys = node['issues']
        repo_counts = {k: sum(i.startswith(k) for i in keys) for k in REPO_ORDER}
        chips = ' '.join(f'{REPO_LABEL[k]} {v}' for k, v in repo_counts.items() if v)
        open_keys = [k for k in keys if issues[k]['state'] == 'OPEN']
        summary = f'{chips} · {len(open_keys)} open' if chips else f'{len(open_keys)} open'
        tip = (' · '.join(f'{REPO_LABEL[k[0]]} #{issues[k]["number"]} {issues[k]["title"]}' for k in keys) if len(keys) <= 4
               else f'{len(keys)} issues: ' + ', '.join(f'{REPO_LABEL[k[0]]} #{issues[k]["number"]}' for k in keys))
        guide = guides_by_id[node['guide']]
        classes = 'node' + (' main' if node.get('main') else '')
        repos = ' '.join(k for k, v in repo_counts.items() if v)
        parts.append(f'<a class="{classes}" href="#{node["guide"]}" data-node="{node["id"]}" data-repos="{repos}" data-tip="{esc(node["label"])}" data-detail="{esc(tip)}" data-guide="{esc(guide)}" aria-label="{esc(node["label"])}: {len(open_keys)} open issues in guide {esc(guide)}. {esc(tip)}">'
                     f'<rect x="{node["cx"] - node_w / 2:.1f}" y="{node["cy"] - node_h / 2:.1f}" width="{node_w}" height="{node_h}" rx="3"/>'
                     f'<text class="node-label" x="{node["cx"]:.1f}" y="{node["cy"] - 4:.1f}" text-anchor="middle">{esc(node["label"])}</text>'
                     f'<text class="node-meta" x="{node["cx"]:.1f}" y="{node["cy"] + 13:.1f}" text-anchor="middle">{esc(summary)}</text></a>')
        listed.append((node['track'], node['label'], guide, keys))
    parts.append('</svg>')
    return ''.join(parts), nodes, listed


def build(history, snapshot_iso, issues, guides_by_id, coverage):
    all_keys = [k for _, items in TRACKS for item in items for k in item['issues']]
    open_keys = {k for k, v in issues.items() if v['state'] == 'OPEN'}
    assert len(all_keys) == len(set(all_keys)), 'Roadmap lists an issue twice'
    assert set(all_keys) == open_keys, f'Roadmap coverage mismatch: {set(all_keys) ^ open_keys}'
    for _, items in TRACKS:
        for item in items:
            assert set(item['issues']) <= set(coverage[item['guide']]), f'{item["id"]} lists issues outside its guide'
    for track, items in TRACKS:
        columns = [item['x'] for item in items]
        # Same-track arrows follow list order, so columns must be unique and ascending.
        assert columns == sorted(set(columns)), f'Overlapping or unordered roadmap nodes in {track}'
        assert all(len(item['label']) <= NODE_LABEL_CHARS for item in items), f'Roadmap label too long for its node in {track}'
    chart, totals = history_chart(history, snapshot_iso, issues)
    roadmap, nodes, listed = roadmap_map(issues, guides_by_id)
    fetched = local(history['fetchedAt'])
    meta = dict(historyFetchedAt=history['fetchedAt'], mergedPRs=totals['merged'], closedIssues=totals['closed'], mainCommits=totals['commits'],
                roadmapNodes=len(nodes), roadmapTracks=len(TRACKS), roadmapSlots=SLOTS,
                headRevisions={repo: value['headSha'] for repo, value in history['repositories'].items()})
    return dict(history=chart, roadmap=roadmap, totals=totals, fetched=fetched, meta=meta, nodes=nodes, listed=listed)


def reconcile(issues, coverage, aliases):
    """Keep the reviewed roadmap layout aligned with current topic ownership."""
    owners = {key: guide for guide, keys in coverage.items() for key in keys}
    for _, items in TRACKS:
        for node in items:
            node['issues'] = [key for key in node['issues'] if key in owners]
            assigned = {owners[key] for key in node['issues']}
            assert len(assigned) <= 1, f'Split roadmap node {node["id"]} across topic owners'
            node['guide'] = next(iter(assigned), aliases.get(node['guide'], node['guide']))
            if node['guide'] == 'local-acceptance':
                node['guide'] = 'shared-codex'
