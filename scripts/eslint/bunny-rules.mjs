// Local ESLint rules for new B.U.N.N.Y. code (Hub #867). docs/development.md "Static analysis" describes the strict profile.
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';

/** The module directory a file belongs to, found relative to the repository root, not the working directory. */
const moduleRoot = (root, filename) => {
  const parts = relative(root, filename).split(sep);
  return parts[0] === 'modules' && parts.length > 2 ? resolve(root, 'modules', parts[1]) : null;
};
const literal = node => {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  if (node?.type === 'TSLiteralType') return literal(node.literal);
  return undefined;
};

/** A module imports only its own files, the allowed workspace packages, Node built-ins and third-party packages. */
const moduleBoundary = {
  meta: {
    type: 'problem',
    docs: {description: 'Keep each module to its own files, the SDK and the contracts packages'},
    schema: [{
      type: 'object',
      properties: {root: {type: 'string'}, allowedPackages: {type: 'array', items: {type: 'string'}}},
      additionalProperties: false,
    }],
    messages: {
      outside: 'A module imports only its own files; "{{source}}" leaves {{module}}.',
      workspace: 'A module imports only the SDK and contracts packages, not "{{source}}".',
      dynamic: 'A module imports only literal specifiers, so the boundary can be checked.',
    },
  },
  create(context) {
    const root = context.options[0]?.root ?? context.cwd;
    const own = moduleRoot(root, context.filename);
    if (!own) return {};
    const allowed = new Set(context.options[0]?.allowedPackages ?? []);
    const check = (node, source) => {
      if (source === undefined) {
        context.report({node, messageId: 'dynamic'});
      } else if (source.startsWith('.') || isAbsolute(source)) {
        const target = resolve(dirname(context.filename), source);
        if (target !== own && !target.startsWith(own + sep)) context.report({node, messageId: 'outside', data: {source, module: relative(root, own)}});
      } else if (source.startsWith('@jimmie-potts/')) {
        const name = source.split('/').slice(0, 2).join('/');
        if (!allowed.has(name)) context.report({node, messageId: 'workspace', data: {source}});
      }
    };
    const fromSource = node => node.source && check(node.source, literal(node.source));
    return {
      ImportDeclaration: fromSource,
      ExportAllDeclaration: fromSource,
      ExportNamedDeclaration: fromSource,
      ImportExpression: node => check(node.source, literal(node.source)),
      TSImportType: node => check(node, literal(node.argument)),
    };
  },
};

/** Every ESLint disable comment says why, and code under the profile never reconfigures a rule inline. */
const disableReason = {
  meta: {
    type: 'suggestion',
    docs: {description: 'Require a reason on every ESLint disable comment and forbid inline rule configuration'},
    schema: [],
    messages: {
      reason: 'Explain this exception after " -- ".',
      configuration: 'Rules are configured in eslint.config.mjs, not inline.',
    },
  },
  create(context) {
    return {
      Program() {
        for (const directive of context.sourceCode.getDisableDirectives().directives) {
          if (!directive.justification?.trim()) context.report({loc: directive.node.loc, messageId: 'reason'});
        }
        for (const comment of context.sourceCode.getInlineConfigNodes()) {
          if (/^\s*eslint\s/.test(comment.value)) context.report({loc: comment.loc, messageId: 'configuration'});
        }
      },
    };
  },
};

export default {meta: {name: 'bunny'}, rules: {'module-boundary': moduleBoundary, 'disable-reason': disableReason}};
