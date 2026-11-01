const PANE = 'bunny-read';
const VERSION = '2.1.292';

export function register(on) {
  let prompt = null, started = null, stopped = null, latest = null, shown = null;
  let reply = 0;
  on('session.start', async ($, e, next) => {
    try { await $.command.register({name: PANE, description: 'Mark a completed reply as read in B.U.N.N.Y.'}); } catch {}
    return next(e);
  });
  on('session.end', async ($, e, next) => {
    prompt = started = stopped = latest = shown = null;
    reply = 0;
    return next(e);
  });
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e);
    if (e.agent_id === undefined) {
      prompt = {sessionId: e.session_id, promptId: e.prompt_id};
      started = stopped = latest = null;
    }
    return result;
  }).catch(($, e, next) => { prompt = started = stopped = latest = null; return next(e); });
  on('turn.start', async ($, e, next) => {
    try {
      const sessionId = await $.session.id();
      started = prompt?.sessionId === sessionId && typeof prompt.promptId === 'string'
        ? {sessionId, promptId: prompt.promptId, turnId: e.turnId} : null;
    } catch { started = null; }
    return next(e);
  });
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e);
    if (e.agent_id === undefined) stopped = {sessionId: e.session_id, promptId: e.prompt_id};
    return result;
  }).catch(($, e, next) => { stopped = latest = null; return next(e); });
  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    if (e.agentId !== undefined) return result;
    latest = null;
    try {
      const sessionId = await $.session.id();
      if (e.reason === 'answer' && started?.sessionId === sessionId && started.turnId === e.turnId &&
          stopped?.sessionId === sessionId && stopped.promptId === started.promptId) {
        latest = {...started, reply: ++reply};
      }
    } catch {}
    return result;
  });
  on('command.run', {command: PANE}, async ($) => {
    const selected = latest;
    const pane = {selected, target: null, status: 'This reply cannot be marked read. Complete a reply, then reopen this panel.'};
    shown = pane;
    try {
      const version = await $.session.version();
      const surface = await $.session.surface();
      const sessionId = await $.session.id();
      if (version.version === VERSION && surface === 'terminal' && selected?.sessionId === sessionId) {
        const node = await $.env.get('BUNNY_READ_NODE');
        const helper = await $.env.get('BUNNY_READ_HELPER');
        const producer = await $.env.get('BUNNY_CLAUDE_READ_PRODUCER');
        if (node?.startsWith('/') && helper?.startsWith('/') && producer?.startsWith('/')) {
          const result = await $.process.run([node, helper, producer], {timeoutMs: 2800,
            stdin: JSON.stringify({action: 'bind', version: VERSION, surface, sessionId, promptId: selected.promptId})});
          if (result.exitCode === 0 && !result.isStdoutTruncated) {
            const bound = JSON.parse(result.stdout);
            if (bound.status === 'ready' && bound.target?.data?.identity?.sessionId === selected.sessionId &&
                bound.target.data.turn?.id === selected.promptId) {
              pane.target = bound.target;
              pane.status = 'Opening this panel does not mark the reply read.';
            }
          }
        }
      }
      await $.ui.open({id: PANE, title: 'Read receipt', focus: true, closeOnEscape: true});
    } catch { pane.target = null; }
    return {};
  }).catch(() => ({}));
  on('ui.render', {component: 'Pane'}, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e);
    const {Box, Text, Button} = $.ui.resolve(e);
    const pane = shown;
    if (e.surface !== 'terminal' || pane === null) return Text({children: ['Read receipts are unavailable here.']});
    const children = [Text({children: [pane.selected === null ? pane.status : 'Reply ' + pane.selected.reply + '. ' + pane.status]})];
    if (pane.target !== null) children.push(Button({key: 'read', label: 'I read this reply', onPress: async () => {
      const target = pane.target;
      if (target === null) return;
      pane.target = null;
      pane.status = 'Read status was not confirmed. Reopen this panel to check.';
      try {
        if (await $.session.id() === pane.selected?.sessionId) {
          const node = await $.env.get('BUNNY_READ_NODE');
          const helper = await $.env.get('BUNNY_READ_HELPER');
          const producer = await $.env.get('BUNNY_CLAUDE_READ_PRODUCER');
          if (node?.startsWith('/') && helper?.startsWith('/') && producer?.startsWith('/')) {
            const result = await $.process.run([node, helper, producer], {timeoutMs: 2800,
              stdin: JSON.stringify({action: 'read', version: VERSION, surface: e.surface, target})});
            if (result.exitCode === 0 && !result.isStdoutTruncated && JSON.parse(result.stdout).status === 'confirmed') pane.status = 'Marked read in B.U.N.N.Y.';
          }
        }
      } catch {}
      await $.ui.invalidate('ui.render');
    }}));
    return Box({flexDirection: 'column', children});
  });
}
