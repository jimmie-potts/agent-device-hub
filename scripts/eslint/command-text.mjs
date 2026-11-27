// Receipts are display text. The shell and module frontends decide from the command phase (Hub #1644).
import ts from 'typescript';

const comparisons = new Set([
  ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken,
]);
const matchers = new Set(['startsWith', 'endsWith', 'includes', 'has', 'indexOf', 'lastIndexOf',
  'match', 'matchAll', 'test', 'exec', 'search', 'replace', 'replaceAll', 'split', 'localeCompare']);
const normalizers = new Set(['trim', 'trimStart', 'trimEnd', 'toLowerCase', 'toUpperCase']);

function member(node) {
  if (ts.isPropertyAccessExpression(node)) return {object: node.expression, name: node.name.text};
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression))
    return {object: node.expression, name: node.argumentExpression.text};
  return undefined;
}

function matchesText(node, readsText) {
  if (ts.isBinaryExpression(node) && comparisons.has(node.operatorToken.kind)) return readsText(node.left) || readsText(node.right);
  if (ts.isSwitchStatement(node)) return readsText(node.expression);
  if (ts.isCallExpression(node)) {
    const call = member(node.expression);
    return call !== undefined && matchers.has(call.name) && (readsText(call.object) || node.arguments.some(readsText));
  }
  return false;
}

const noCommandTextDecision = {
  meta: {
    type: 'problem',
    docs: {description: 'Use a typed command phase to make decisions instead of matching its display text'},
    schema: [],
    messages: {phase: 'Use the command phase for decisions and keep receipt text for display.'},
  },
  create(context) {
    const {program, esTreeNodeToTSNodeMap} = context.sourceCode.parserServices;
    const checker = program.getTypeChecker();
    // Shell projections may carry only text and lock; module callers may still use the pre-phase SDK type.
    const command = node => {
      const type = checker.getNonNullableType(checker.getTypeAtLocation(node));
      return type.getProperty('text') !== undefined && type.getProperty('locked') !== undefined;
    };
    const receipt = (value, seen = new Set()) => {
      const node = ts.skipOuterExpressions(value);
      if (seen.has(node)) return false;
      seen.add(node);
      const property = member(node);
      if (property?.name === 'text') return command(property.object);
      if (property?.name === 'length') return receipt(property.object, seen);
      if (ts.isCallExpression(node)) {
        const call = member(node.expression);
        return call !== undefined && normalizers.has(call.name) && receipt(call.object, seen);
      }
      if (ts.isIdentifier(node)) {
        const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
        if (declaration !== undefined && ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined)
          return receipt(declaration.initializer, seen);
        if (declaration !== undefined && ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent)) {
          const {parent: {parent: binding}, name, propertyName} = declaration;
          return (propertyName ?? name).getText() === 'text' && ts.isVariableDeclaration(binding) &&
            binding.initializer !== undefined && command(binding.initializer);
        }
      }
      return false;
    };
    const readsReceipt = node => receipt(node);
    // A presentation helper can accept plain strings. Check the corresponding parameter of a directly called
    // implementation too, so moving a text match into that helper does not hide the command-text decision.
    const forwardsToMatcher = node => {
      if (!node.arguments.some(readsReceipt)) return false;
      const declaration = checker.getResolvedSignature(node)?.declaration;
      if (declaration?.body === undefined) return false;
      const parameters = new Set(declaration.parameters.flatMap(({name}, index) => {
        const arg = node.arguments[index];
        return ts.isIdentifier(name) && arg !== undefined && readsReceipt(arg) ? [checker.getSymbolAtLocation(name)] : [];
      }));
      const readsParameter = value => {
        const name = ts.skipOuterExpressions(value);
        return ts.isIdentifier(name) && parameters.has(checker.getSymbolAtLocation(name));
      };
      const findMatch = child => matchesText(child, readsParameter) || ts.forEachChild(child, findMatch) || undefined;
      return findMatch(declaration.body) === true;
    };
    const check = node => {
      const source = esTreeNodeToTSNodeMap.get(node);
      if (matchesText(source, readsReceipt) || ts.isCallExpression(source) && forwardsToMatcher(source))
        context.report({node, messageId: 'phase'});
    };
    return {BinaryExpression: check, CallExpression: check, SwitchStatement: check};
  },
};

export default noCommandTextDecision;
