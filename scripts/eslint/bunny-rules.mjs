// Local ESLint rules for new B.U.N.N.Y. code (Hub #867). docs/development.md "Static analysis" describes the strict profile.
import {dirname, relative, resolve, sep} from 'node:path';

const moduleRoot = (cwd, filename) => {
  const parts = relative(cwd, filename).split(sep);
  return parts[0] === 'modules' && parts.length > 2 ? resolve(cwd, 'modules', parts[1]) : null;
};

/** A module imports only its own files, the allowed workspace packages, Node built-ins and third-party packages. */
const moduleBoundary = {
  meta: {
    type: 'problem',
    docs: {description: 'Keep each module to its own files, the SDK and the contracts packages'},
    schema: [{type: 'object', properties: {allowedPackages: {type: 'array', items: {type: 'string'}}}, additionalProperties: false}],
    messages: {
      outside: 'A module imports only its own files; "{{source}}" leaves {{module}}.',
      workspace: 'A module imports only the SDK and contracts packages, not "{{source}}".',
    },
  },
  create(context) {
    const root = moduleRoot(context.cwd, context.filename);
    if (!root) return {};
    const allowed = new Set(context.options[0]?.allowedPackages ?? []);
    const check = (node, source) => {
      if (typeof source !== 'string') return;
      if (source.startsWith('.')) {
        const target = resolve(dirname(context.filename), source);
        if (target !== root && !target.startsWith(root + sep)) context.report({node, messageId: 'outside', data: {source, module: relative(context.cwd, root)}});
      } else if (source.startsWith('@jimmie-potts/')) {
        const name = source.split('/').slice(0, 2).join('/');
        if (!allowed.has(name)) context.report({node, messageId: 'workspace', data: {source}});
      }
    };
    const fromSource = node => node.source && check(node.source, node.source.value);
    return {
      ImportDeclaration: fromSource,
      ExportAllDeclaration: fromSource,
      ExportNamedDeclaration: fromSource,
      ImportExpression: node => node.source.type === 'Literal' && check(node.source, node.source.value),
    };
  },
};

/** Every ESLint disable comment says why, after " -- ". */
const disableReason = {
  meta: {
    type: 'suggestion',
    docs: {description: 'Require a reason on every ESLint disable comment'},
    schema: [],
    messages: {reason: 'Explain this exception after " -- ".'},
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const text = comment.value.trim();
          if (!/^eslint-disable(-next-line|-line)?(\s|$)/.test(text)) continue;
          const reason = text.split(/\s--\s/)[1];
          if (!reason || !reason.trim()) context.report({loc: comment.loc, messageId: 'reason'});
        }
      },
    };
  },
};

export default {meta: {name: 'bunny'}, rules: {'module-boundary': moduleBoundary, 'disable-reason': disableReason}};
