// Read-only GitHub access for the delivery preflight.
//
// Every request passes through assertReadOnlyRequest before any transport sees
// it: REST calls must be GET requests to the GitHub API, and the only POST is
// one of the preflight's own GraphQL query documents, matched by exact text.
// Merges, issue transitions, labels, reviews, comments and every other write
// are refused here, so no code path in the preflight can perform them.
import { spawnSync } from 'node:child_process';

export const API = 'https://api.github.com';
const GRAPHQL = `${API}/graphql`;
export const MAX_PAGES = 50;

export class ReadFailure extends Error {
  constructor(what, detail) {
    super(`${what}: ${detail}`);
    this.name = 'ReadFailure';
    this.what = what;
    this.detail = detail;
  }
}

export class ReadOnlyViolation extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReadOnlyViolation';
  }
}

// The only GraphQL documents the preflight sends. Each is a single named query
// with no comments, block strings or carriage returns.
export const QUERIES = Object.freeze({
  PullRequestState: `query PullRequestState($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      closingIssuesReferences(first: 50) { nodes { number repository { nameWithOwner } } }
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { isResolved isOutdated path comments(first: 1) { nodes { url author { login } } } }
      }
    }
  }
}`,
  RequirementVersion: `query RequirementVersion($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) { lastEditedAt createdAt state } }
}`,
});
const ALLOWED_QUERIES = new Set(Object.values(QUERIES));

/**
 * Refuse any GraphQL document that is not a single query operation. Comments,
 * block strings and carriage returns are refused outright, so no lexer trick
 * can hide a second operation.
 */
export function assertQueryOnly(document) {
  if (typeof document !== 'string') throw new ReadOnlyViolation('a GraphQL document must be a string');
  if (/[#\r]|"""/.test(document)) throw new ReadOnlyViolation('GraphQL comments, block strings and carriage returns are refused');
  const code = document
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/#[^\n]*/g, '');
  if (/\b(?:mutation|subscription)\b/.test(code)) {
    throw new ReadOnlyViolation('GraphQL mutations and subscriptions are refused');
  }
  if (!/^\s*(?:query\b|\{)/.test(code)) {
    throw new ReadOnlyViolation('only a GraphQL query operation is allowed');
  }
}

/** The single gate every request crosses, in the client and again in the live transport. */
export function assertReadOnlyRequest(method, url, body) {
  if (typeof url !== 'string' || !url.startsWith(`${API}/`)) {
    throw new ReadOnlyViolation(`requests may only address ${API}`);
  }
  if (method === 'GET') {
    if (body !== undefined) throw new ReadOnlyViolation('a GET request carries no body');
    if (url === GRAPHQL || url.startsWith(`${GRAPHQL}?`)) throw new ReadOnlyViolation('GraphQL requires a query document');
    return;
  }
  if (method === 'POST' && url === GRAPHQL) {
    if (!body || typeof body !== 'object') throw new ReadOnlyViolation('a GraphQL request needs a query document');
    const extra = Object.keys(body).filter(key => key !== 'query' && key !== 'variables');
    if (extra.length) throw new ReadOnlyViolation(`unexpected GraphQL fields: ${extra.join(', ')}`);
    assertQueryOnly(body.query);
    if (!ALLOWED_QUERIES.has(body.query)) throw new ReadOnlyViolation("only the preflight's own GraphQL query documents are allowed");
    return;
  }
  throw new ReadOnlyViolation(`${method} ${url.slice(API.length)} is refused: the preflight is read-only`);
}

function nextLink(link) {
  if (!link) return null;
  for (const part of link.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

/** Replace absolute and home-relative paths in free text. */
export function redactPaths(text) {
  return String(text).replace(/(?:~|\/)[^\s'"]*\/[^\s'"]*/g, '[path]');
}

function describeError(error) {
  const message = error && error.message ? String(error.message) : String(error);
  return redactPaths(message.replace(/(?:gh[opsu]_|github_pat_)[A-Za-z0-9_]+/g, '[redacted: token]'));
}

/**
 * Wrap a transport `({method, url, body}) => {status, link, json}` in a client
 * that can only read. `request` is exposed so tests can prove refusals.
 */
export function createReadOnlyClient(transport) {
  async function send(method, url, body, what) {
    assertReadOnlyRequest(method, url, body);
    let response;
    try {
      response = await transport({ method, url, body });
    } catch (error) {
      if (error instanceof ReadOnlyViolation) throw error;
      throw new ReadFailure(what, describeError(error));
    }
    if (!response || typeof response.status !== 'number') throw new ReadFailure(what, 'no response');
    if (response.status < 200 || response.status >= 300) {
      const message = response.json && typeof response.json.message === 'string' ? `: ${response.json.message}` : '';
      throw new ReadFailure(what, `HTTP ${response.status}${message}`);
    }
    return response;
  }

  // Relative paths address the API; any absolute URL must pass the gate as given.
  const toUrl = path => (String(path).startsWith('/') ? `${API}${path}` : String(path));

  return Object.freeze({
    async request(method, path, body) {
      const url = toUrl(path);
      return (await send(method, url, body, `${method} ${url.slice(API.length)}`)).json;
    },
    async get(path) {
      const url = toUrl(path);
      return (await send('GET', url, undefined, `GET ${url.slice(API.length)}`)).json;
    },
    /** Read every page. `key` names the array inside an object response. */
    async getAll(path, key) {
      const items = [];
      let url = toUrl(path);
      const what = `GET ${url.slice(API.length)}`;
      for (let page = 0; url; page += 1) {
        if (page >= MAX_PAGES) throw new ReadFailure(what, `more than ${MAX_PAGES} pages`);
        const response = await send('GET', url, undefined, what);
        const batch = key ? response.json && response.json[key] : response.json;
        if (!Array.isArray(batch)) throw new ReadFailure(what, 'unexpected response shape');
        items.push(...batch);
        url = nextLink(response.link);
        if (url && !url.startsWith(`${API}/`)) throw new ReadFailure(what, 'pagination left the GitHub API');
      }
      return items;
    },
    async graphql(query, variables = {}) {
      const name = (query.match(/query\s+(\w+)/) || [])[1] || 'query';
      const response = await send('POST', GRAPHQL, { query, variables }, `GraphQL ${name}`);
      const json = response.json || {};
      if (Array.isArray(json.errors) && json.errors.length) {
        throw new ReadFailure(`GraphQL ${name}`, json.errors.map(error => error.message).join('; '));
      }
      if (!json.data) throw new ReadFailure(`GraphQL ${name}`, 'no data');
      return json.data;
    },
  });
}

/** Live transport over fetch. It repeats the read-only gate before any network use. */
export function fetchTransport({ token, fetchImpl = globalThis.fetch, timeoutMs = 30000 }) {
  return async ({ method, url, body }) => {
    assertReadOnlyRequest(method, url, body);
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'agent-device-hub-delivery-preflight',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, link: response.headers.get('link'), json };
  };
}

/** A token from the environment or the authenticated gh client; never printed. */
export function resolveToken(env = process.env) {
  if (env.GH_TOKEN) return env.GH_TOKEN;
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  const result = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 15000 });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  return null;
}
