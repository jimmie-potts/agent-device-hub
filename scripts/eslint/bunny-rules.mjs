// Local ESLint rules for new B.U.N.N.Y. code: the module boundary (Hub #867) and the safe-error rules (Hub #953).
// docs/development.md "Static analysis" describes the strict profile and where each rule applies.
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

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
      properties: {
        root: {type: 'string'},
        allowedPackages: {type: 'array', items: {type: 'string'}},
        workspaceScopes: {type: 'array', items: {type: 'string'}},
      },
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
    const scopes = context.options[0]?.workspaceScopes ?? ['@jimmie-potts/'];
    const filePath = url => {
      try {
        return fileURLToPath(url);
      } catch {
        return '';
      }
    };
    const check = (node, source) => {
      if (source === undefined) {
        context.report({node, messageId: 'dynamic'});
      } else if (source.startsWith('.') || isAbsolute(source) || source.startsWith('file:')) {
        const target = source.startsWith('file:') ? filePath(source) : resolve(dirname(context.filename), source);
        if (target !== own && !target.startsWith(own + sep)) context.report({node, messageId: 'outside', data: {source, module: relative(root, own)}});
      } else if (scopes.some(scope => source.startsWith(scope))) {
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
      // typescript-eslint 8 names the specifier `source` and keeps the deprecated `argument`.
      TSImportType: node => check(node, literal(node.source ?? node.argument)),
    };
  },
};

// The safe-error rules (ADR 0012, "Errors, effects and outcomes" and "Observability"). They read syntax only, so they
// also check JavaScript, and they report what they can see: docs/development.md lists what each one misses.

/** TypeScript wrappers that leave the value unchanged: `as`, `!`, `satisfies` and `<T>`. */
const WRAPPERS = new Set(['TSAsExpression', 'TSNonNullExpression', 'TSSatisfiesExpression', 'TSTypeAssertion']);
/** The expression inside any wrappers. */
const unwrap = node => {
  let inner = node;
  while (inner !== null && inner !== undefined && WRAPPERS.has(inner.type)) inner = inner.expression;
  return inner;
};
/** The outermost wrapper around `node`: its parent shows how the value is used. */
const outermost = node => {
  let outer = node;
  while (WRAPPERS.has(outer.parent?.type)) outer = outer.parent;
  return outer;
};
/** A member's name: `a.b`, `a?.b` or `a['b']`. */
const memberName = node => (node.computed ? literal(node.property) : node.property.type === 'Identifier' ? node.property.name : undefined);
/** A property's key: `{b: 1}`, `{'b': 1}` or `{['b']: 1}`. */
const keyName = node => (!node.computed && node.key.type === 'Identifier' ? node.key.name : literal(node.key));
/** The variable `name` refers to from `scope`, or null for an undeclared global. */
const findVariable = (scope, name) => {
  for (let current = scope; current !== null; current = current.upper) {
    const variable = current.set.get(name);
    if (variable !== undefined) return variable;
  }
  return null;
};
/** The imported name of an import specifier, from `import {a}` or `import {'a' as b}`. */
const importedName = specifier => specifier.imported.name ?? specifier.imported.value;

const OBSERVABILITY = 'ADR 0012, "Observability"';
const SAFE_ERRORS = 'ADR 0012, "Safe errors"';
const STREAMS = new Set(['stdout', 'stderr']);

/** Runtime code records through its logger and the SDK's diagnostics, never straight to the console or stdio. */
const noConsole = {
  meta: {
    type: 'problem',
    docs: {description: 'Keep runtime code off the console and the process\'s standard streams'},
    schema: [],
    messages: {
      console: `Runtime code does not write to the console (${OBSERVABILITY}). Record through the module's logger, or report `
        + 'through the SDK\'s onDiagnostic callback, which the runtime connects to its sink. An entry point that owns the '
        + 'process\'s output is listed in eslint.config.mjs.',
      stream: `Runtime code does not write to process.{{stream}} (${OBSERVABILITY}). Record through the module's logger, or `
        + 'report through the SDK\'s onDiagnostic callback, which the runtime connects to its sink. An entry point that owns '
        + 'the process\'s output is listed in eslint.config.mjs.',
    },
  },
  create(context) {
    const {sourceCode} = context;
    /**
     * A use of `process`: an identifier, or `globalThis.process`. Reading `stdout` or `stderr` from it, as a member or by
     * destructuring (`const {stdout} = process`), is a write to the stream.
     */
    const stream = node => {
      const parent = node.parent;
      if (parent.type === 'MemberExpression' && parent.object === node) {
        const name = memberName(parent);
        if (STREAMS.has(name)) context.report({node: parent, messageId: 'stream', data: {stream: name}});
        return;
      }
      const pattern = parent.type === 'VariableDeclarator' && parent.init === node ? parent.id
        : parent.type === 'AssignmentExpression' && parent.right === node ? parent.left : undefined;
      if (pattern?.type !== 'ObjectPattern') return;
      for (const property of pattern.properties) {
        const name = property.type === 'Property' ? keyName(property) : undefined;
        if (STREAMS.has(name)) context.report({node: property, messageId: 'stream', data: {stream: name}});
      }
    };
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (source === 'console' || source === 'node:console') context.report({node, messageId: 'console'});
        if (source !== 'process' && source !== 'node:process') return;
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier') {
            const name = importedName(specifier);
            if (STREAMS.has(name)) context.report({node: specifier, messageId: 'stream', data: {stream: name}});
          } else {
            for (const variable of sourceCode.getDeclaredVariables(specifier)) for (const {identifier} of variable.references) stream(identifier);
          }
        }
      },
      'Program:exit'() {
        const {globalScope} = sourceCode.scopeManager;
        // A configured global resolves to its variable; an undeclared one stays in the global scope's `through` list.
        const uses = name => {
          const variable = globalScope.set.get(name);
          const declared = variable !== undefined && variable.defs.length === 0 ? variable.references : [];
          return [...declared, ...globalScope.through.filter(reference => reference.identifier.name === name)].map(reference => reference.identifier);
        };
        for (const identifier of uses('console')) context.report({node: identifier, messageId: 'console'});
        for (const identifier of uses('globalThis')) {
          const member = identifier.parent;
          if (member.type !== 'MemberExpression' || member.object !== identifier) continue;
          if (memberName(member) === 'console') context.report({node: member, messageId: 'console'});
          if (memberName(member) === 'process') stream(member);
        }
        for (const identifier of uses('process')) stream(identifier);
      },
    };
  },
};

/** An exception's parts that may quote anything, such as a credential a library put in its message. */
const UNSAFE = new Set(['message', 'stack', 'cause']);
/** A class whose name says it is an error, such as `TypeError`, `SdkError` or `NodeJS.ErrnoException`. */
const ERROR_CLASS = /(?:Error|Exception)$/;
/** Events whose first listener argument is an exception. */
const ERROR_EVENTS = new Set(['error', 'uncaughtException', 'unhandledRejection']);
const LISTENERS = new Set(['on', 'once', 'addListener', 'prependListener', 'prependOnceListener']);
const UTIL = new Set(['util', 'node:util']);
/** node:util functions that write a value's text, which for an error includes its stack. */
const UTIL_TEXT = new Set(['inspect', 'format', 'formatWithOptions']);
const EXITS = new Set(['ThrowStatement', 'ReturnStatement', 'BreakStatement', 'ContinueStatement']);
const exits = statement => (statement.type === 'BlockStatement' ? statement.body.length > 0 && exits(statement.body.at(-1)) : EXITS.has(statement.type));
const className = node => (node.type === 'TSQualifiedName' ? node.right.name : node.type === 'MemberExpression' ? memberName(node) : node.name);

/**
 * An exception's message, stack and cause never reach an outward value, so code does not read them or turn the
 * exception into text. An exception is a catch binding, the first parameter of an inline rejection handler or `error`
 * listener, a parameter typed as an error class, or a variable or simple member chain, such as `r.reason` or
 * `this.#failure`, inside an `instanceof` test against an error class.
 * An error class this repository declares holds fixed text from the code that raised it, so its message may be read
 * where an `instanceof` test or the parameter's type proves the value is one; its stack and cause may not.
 */
const noRawErrorText = {
  meta: {
    type: 'problem',
    docs: {description: 'Keep an exception\'s message, stack and cause out of every value code builds from it'},
    schema: [{
      type: 'object',
      properties: {workspaceScopes: {type: 'array', items: {type: 'string'}}},
      additionalProperties: false,
    }],
    messages: {
      read: `An exception's {{property}} may hold anything, such as a credential a library quoted (${SAFE_ERRORS}). Report `
        + 'its registry code, its type (the SDK\'s errorType) and fixed text, and keep the exception in memory as a cause.',
      text: `Turning an exception into text quotes its message, which may hold anything, such as a credential a library `
        + `quoted (${SAFE_ERRORS}). Report its registry code, its type (the SDK's errorType) and fixed text, and keep the `
        + 'exception in memory as a cause.',
    },
  },
  create(context) {
    const {sourceCode} = context;
    const scopes = context.options[0]?.workspaceScopes ?? ['@jimmie-potts/'];
    /** The function, class field, static block or program whose `this` a `this` expression is. */
    const thisOwner = node => {
      let owner = node.parent;
      while (!['FunctionDeclaration', 'FunctionExpression', 'PropertyDefinition', 'StaticBlock', 'Program'].includes(owner.type)) owner = owner.parent;
      return owner;
    };
    const inner = node => {
      let current = unwrap(node);
      while (current?.type === 'ChainExpression') current = unwrap(current.expression);
      return current;
    };
    /**
     * What a value is, so its uses and tests can be matched: a variable, or a simple member chain on a variable or on
     * `this`, such as `r.reason` or `this.#failure`, as its root and dotted path. Computed members and calls are not.
     */
    const keyOf = node => {
      const path = [];
      let current = inner(node);
      while (current?.type === 'MemberExpression' && !current.computed) {
        path.unshift(current.property.type === 'PrivateIdentifier' ? `#${current.property.name}` : current.property.name);
        current = inner(current.object);
      }
      if (current?.type === 'Identifier') {
        const variable = findVariable(sourceCode.getScope(current), current.name);
        return variable === null ? null : {root: variable, path: path.join('.')};
      }
      return current?.type === 'ThisExpression' && path.length > 0 ? {root: thisOwner(current), path: path.join('.')} : null;
    };
    const same = (node, key) => {
      const other = keyOf(node);
      return other !== null && other.root === key.root && other.path === key.path;
    };
    /**
     * Each tracked value by root and path: whether it is known to hold an exception, and the classes its type annotation
     * names. Member chains are matched against every member expression whose last name ends a tracked path.
     */
    const tracked = new Map();
    const tails = new Set();
    const members = [];
    const entryOf = key => tracked.get(key.root)?.get(key.path);
    const track = (key, entry) => {
      if (!tracked.has(key.root)) tracked.set(key.root, new Map());
      tracked.get(key.root).set(key.path, entry);
      if (key.path !== '') tails.add(key.path.split('.').at(-1));
    };
    const definitionOf = identifier => findVariable(sourceCode.getScope(identifier), identifier.name)?.defs[0];
    const isGlobal = identifier => {
      const variable = findVariable(sourceCode.getScope(identifier), identifier.name);
      return variable === null || (variable.scope.type === 'global' && variable.defs.length === 0);
    };
    /** An import from node:util: a named `inspect` or `format`, or the whole module. */
    const fromUtil = (identifier, whole) => {
      const definition = definitionOf(identifier);
      if (definition?.type !== 'ImportBinding' || !UTIL.has(definition.parent.source.value)) return false;
      return whole ? definition.node.type !== 'ImportSpecifier' : definition.node.type === 'ImportSpecifier' && UTIL_TEXT.has(importedName(definition.node));
    };
    /** Whether this repository declares the class: in this file, or imported by a relative path or a workspace scope. */
    const own = node => {
      const reference = unwrap(node);
      // `ValueError`, `errors.ValueError`, or the type `errors.ValueError`.
      const base = reference.type === 'MemberExpression' ? unwrap(reference.object) : reference.type === 'TSQualifiedName' ? reference.left : reference;
      if (base.type !== 'Identifier') return false;
      const definition = definitionOf(base);
      if (definition?.type === 'ClassName') return base === reference;
      if (definition?.type !== 'ImportBinding') return false;
      const source = definition.parent.source.value;
      return source.startsWith('.') || source.startsWith('/') || scopes.some(scope => source.startsWith(scope));
    };
    const errorTypes = type => {
      if (type?.type === 'TSUnionType') return type.types.flatMap(errorTypes);
      return type?.type === 'TSTypeReference' && ERROR_CLASS.test(className(type.typeName)) ? [type.typeName] : [];
    };
    const reported = new WeakSet();
    const report = (node, finding) => {
      if (reported.has(node)) return;
      reported.add(node);
      context.report(finding.property === undefined ? {node, messageId: 'text'} : {node, messageId: 'read', data: {property: finding.property}});
    };
    const destructured = pattern => {
      const found = [];
      for (const property of pattern.properties) {
        const name = property.type === 'Property' ? keyName(property) : undefined;
        if (UNSAFE.has(name)) found.push({node: property, property: name});
      }
      return found;
    };
    /**
     * Tracks a parameter or catch binding that holds an exception, with the error classes its type names, if any. A
     * destructuring pattern is checked at once.
     */
    const bind = (owner, pattern, declared) => {
      const target = pattern?.type === 'AssignmentPattern' ? pattern.left : pattern;
      if (target?.type === 'ObjectPattern') for (const finding of destructured(target)) report(finding.node, finding);
      if (target?.type !== 'Identifier') return;
      const variable = sourceCode.getDeclaredVariables(owner).find(candidate => candidate.name === target.name);
      if (variable === undefined) return;
      const key = {root: variable, path: ''};
      track(key, {exception: true, declared: declared.length > 0 ? declared : (entryOf(key)?.declared ?? null)});
    };
    const typesOf = parameter => errorTypes((parameter?.type === 'AssignmentPattern' ? parameter.left : parameter)?.typeAnnotation?.typeAnnotation);

    // The classes a test proves the tracked value an instance of when it is true, or when it is false; null when it proves none.
    const whenTrue = (test, key) => {
      const node = unwrap(test);
      if (node.type === 'BinaryExpression') return node.operator === 'instanceof' && same(node.left, key) ? [node.right] : null;
      if (node.type === 'UnaryExpression') return node.operator === '!' ? whenFalse(node.argument, key) : null;
      if (node.type !== 'LogicalExpression') return null;
      if (node.operator === '&&') return whenTrue(node.left, key) ?? whenTrue(node.right, key);
      const [left, right] = [whenTrue(node.left, key), whenTrue(node.right, key)];
      return node.operator === '||' && left !== null && right !== null ? [...left, ...right] : null;
    };
    const whenFalse = (test, key) => {
      const node = unwrap(test);
      if (node.type === 'UnaryExpression') return node.operator === '!' ? whenTrue(node.argument, key) : null;
      if (node.type !== 'LogicalExpression') return null;
      if (node.operator === '||') return whenFalse(node.left, key) ?? whenFalse(node.right, key);
      const [left, right] = [whenFalse(node.left, key), whenFalse(node.right, key)];
      return node.operator === '&&' && left !== null && right !== null ? [...left, ...right] : null;
    };
    /** The classes the nearest enclosing test proves at `node`: a branch, a `&&` or `||`, or an earlier early exit. */
    const narrowed = (node, key) => {
      for (let child = node, parent = node.parent; parent !== null && parent !== undefined; child = parent, parent = parent.parent) {
        let classes = null;
        if (parent.type === 'IfStatement' || parent.type === 'ConditionalExpression') {
          if (child === parent.consequent) classes = whenTrue(parent.test, key);
          else if (child === parent.alternate) classes = whenFalse(parent.test, key);
        } else if (parent.type === 'LogicalExpression' && child === parent.right) {
          classes = parent.operator === '&&' ? whenTrue(parent.left, key) : parent.operator === '||' ? whenFalse(parent.left, key) : null;
        } else if (['BlockStatement', 'StaticBlock', 'Program', 'SwitchCase'].includes(parent.type)) {
          const statements = parent.type === 'SwitchCase' ? parent.consequent : parent.body;
          for (let index = statements.indexOf(child) - 1; index >= 0 && classes === null; index -= 1) {
            const statement = statements[index];
            if (statement.type === 'IfStatement' && statement.alternate === null && exits(statement.consequent)) classes = whenFalse(statement.test, key);
          }
        }
        if (classes !== null) return classes;
      }
      return null;
    };
    /** What a use of the value reveals: a part it reads, or its text. Only a message or text can be an own class's. */
    const findings = value => {
      const use = outermost(value);
      const parent = use.parent;
      switch (parent.type) {
        case 'MemberExpression': {
          if (parent.object !== use) return [];
          const name = memberName(parent);
          if (UNSAFE.has(name)) return [{node: parent, property: name}];
          const call = parent.parent;
          return name === 'toString' && call.type === 'CallExpression' && call.callee === parent ? [{node: call}] : [];
        }
        case 'TemplateLiteral': {
          // A tag decides what it does with each value; `String.raw` turns each into text.
          const tagged = parent.parent.type === 'TaggedTemplateExpression' ? unwrap(parent.parent.tag) : undefined;
          if (tagged === undefined) return [{node: use}];
          const raw = tagged.type === 'MemberExpression' && memberName(tagged) === 'raw' && unwrap(tagged.object).type === 'Identifier'
            && unwrap(tagged.object).name === 'String' && isGlobal(unwrap(tagged.object));
          return raw ? [{node: parent.parent}] : [];
        }
        case 'ArrayExpression': {
          // An array literal joined into text: `[label, error].join(' ')`.
          const array = outermost(parent), member = array.parent, call = member.parent;
          const joined = member.type === 'MemberExpression' && member.object === array && memberName(member) === 'join'
            && call.type === 'CallExpression' && call.callee === member;
          return joined ? [{node: call}] : [];
        }
        case 'BinaryExpression':
          return parent.operator === '+' ? [{node: parent}] : [];
        case 'AssignmentExpression':
          if (parent.right !== use) return [];
          if (parent.operator === '+=') return [{node: parent}];
          return parent.operator === '=' && parent.left.type === 'ObjectPattern' ? destructured(parent.left) : [];
        case 'VariableDeclarator':
          return parent.init === use && parent.id.type === 'ObjectPattern' ? destructured(parent.id) : [];
        case 'CallExpression': {
          if (!parent.arguments.includes(use)) return [];
          const callee = unwrap(parent.callee);
          const first = parent.arguments[0] === use;
          if (callee.type === 'Identifier') {
            if (callee.name === 'String' && first && isGlobal(callee)) return [{node: parent}];
            return fromUtil(callee, false) ? [{node: parent, stack: true}] : [];
          }
          if (callee.type !== 'MemberExpression') return [];
          const object = unwrap(callee.object), name = memberName(callee);
          // Text concatenated onto a string literal: `'failed: '.concat(error)`. An array's `concat` keeps the value whole.
          const text = (object.type === 'Literal' && typeof object.value === 'string') || object.type === 'TemplateLiteral';
          if (name === 'concat' && text) return [{node: parent}];
          if (object.type !== 'Identifier') return [];
          if (object.name === 'JSON' && name === 'stringify' && first && isGlobal(object)) return [{node: parent}];
          return UTIL_TEXT.has(name) && fromUtil(object, true) ? [{node: parent, stack: true}] : [];
        }
        default:
          return [];
      }
    };

    const fn = node => {
      for (const parameter of node.params) {
        const declared = typesOf(parameter);
        if (declared.length > 0) bind(node, parameter, declared);
      }
    };
    return {
      CatchClause: node => bind(node, node.param, typesOf(node.param)),
      FunctionDeclaration: fn,
      FunctionExpression: fn,
      ArrowFunctionExpression: fn,
      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (callee.type !== 'MemberExpression') return;
        const name = memberName(callee);
        const handler = name === 'catch' ? node.arguments[0]
          : name === 'then' ? node.arguments[1]
            : LISTENERS.has(name) && ERROR_EVENTS.has(literal(node.arguments[0])) ? node.arguments[1] : undefined;
        if (handler?.type === 'ArrowFunctionExpression' || handler?.type === 'FunctionExpression') bind(handler, handler.params[0], typesOf(handler.params[0]));
      },
      BinaryExpression(node) {
        const key = node.operator === 'instanceof' ? keyOf(node.left) : null;
        if (key !== null && entryOf(key) === undefined) track(key, {exception: false, declared: null});
      },
      MemberExpression(node) {
        if (!node.computed) members.push(node);
      },
      'Program:exit'() {
        const check = (value, key, {exception, declared}) => {
          const found = findings(value);
          if (found.length === 0) return;
          const classes = narrowed(value, key) ?? declared;
          if (!exception && !(classes?.some(node => ERROR_CLASS.test(className(unwrap(node)))) ?? false)) return;
          const fixedText = classes !== null && classes.every(own);
          for (const finding of found) {
            const safe = fixedText && finding.stack !== true && (finding.property === undefined || finding.property === 'message');
            if (!safe) report(finding.node, finding.stack === true ? {} : finding);
          }
        };
        for (const [root, paths] of tracked) {
          const entry = paths.get('');
          if (entry === undefined) continue;
          for (const reference of root.references) {
            if (reference.isValueReference !== false && reference.isRead()) check(reference.identifier, {root, path: ''}, entry);
          }
        }
        for (const member of members.filter(node => tails.has(node.property.type === 'PrivateIdentifier' ? `#${node.property.name}` : node.property.name))) {
          const key = keyOf(member);
          const entry = key === null || key.path === '' ? undefined : entryOf(key);
          if (entry !== undefined) check(member, key, entry);
        }
      },
    };
  },
};

/** Error bodies come from the registry through `errorBody`, never from an object literal shaped `{error: {code}}`. */
const errorBodyFromRegistry = {
  meta: {
    type: 'problem',
    docs: {description: 'Build every error body with errorBody, or pass on one that came from it'},
    schema: [],
    messages: {
      literal: 'Build an error body with errorBody(code, {detail}) from @jimmie-potts/event-contracts, or pass on or spread one '
        + 'that came from it, so its code and retryable flag come from the registry (ADR 0012, "Errors, effects and '
        + `outcomes"). Its detail is fixed text, never an exception's message (${SAFE_ERRORS}).`,
    },
  },
  create(context) {
    return {
      Property(node) {
        if (node.parent.type !== 'ObjectExpression' || keyName(node) !== 'error') return;
        const value = unwrap(node.value);
        if (value.type === 'ObjectExpression' && value.properties.some(property => property.type === 'Property' && keyName(property) === 'code')) {
          context.report({node: value, messageId: 'literal'});
        }
      },
    };
  },
};

export default {
  meta: {name: 'bunny'},
  rules: {
    'module-boundary': moduleBoundary,
    'no-console': noConsole,
    'no-raw-error-text': noRawErrorText,
    'error-body-from-registry': errorBodyFromRegistry,
  },
};
