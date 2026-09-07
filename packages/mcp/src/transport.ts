import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CancelledNotificationSchema, ErrorCode, type JSONRPCMessage, type RequestId } from '@modelcontextprotocol/sdk/types.js';

type JsonStream = { cleanup(): void; resolveJson?: (response: Response) => void };
type JsonInternals = { _streamMapping: Map<string, JsonStream>; _requestToStreamMapping: Map<RequestId, string>;
  _requestResponseMap: Map<RequestId, JSONRPCMessage> };

/** SDK 1.30.0 JSON lifecycle compatibility. Keep private SDK access confined here. */
export class JsonResponseTransport extends StreamableHTTPServerTransport {
  private readonly json: JsonInternals;
  constructor(sessionId: string, private readonly maximumBytes: number) {
    super({ sessionIdGenerator: () => sessionId, enableJsonResponse: true });
    // Upstream JSON send() omits cleanup, and close() never resolves pending JSON Responses.
    // Public closeSSEStream() cannot find a successfully sent JSON stream after its ID is removed.
    this.json = (this as unknown as { _webStandardTransport: JsonInternals })._webStandardTransport;
    if (!(this.json?._streamMapping instanceof Map) || !(this.json._requestToStreamMapping instanceof Map)
        || !(this.json._requestResponseMap instanceof Map)) throw new Error('Unsupported MCP SDK transport layout');
  }
  override get onmessage(): Transport['onmessage'] { return super.onmessage; }
  override set onmessage(handler: Transport['onmessage']) {
    super.onmessage = (message, extra) => {
      if ('method' in message && message.method === 'notifications/cancelled' && !('id' in message)) {
        const cancellation = CancelledNotificationSchema.safeParse(message);
        if (cancellation.success && cancellation.data.params.requestId !== undefined) this.releaseRequest(cancellation.data.params.requestId);
      }
      handler?.(message, extra);
    };
  }
  private releaseRequest(id: RequestId): void {
    const streamId = this.json._requestToStreamMapping.get(id);
    const stream = streamId === undefined ? undefined : this.json._streamMapping.get(streamId);
    // Cancellation has no JSON-RPC reply. Ending delivery never cancels or retries owner work.
    stream?.resolveJson?.(new Response(null, { status: 204 }));
    this.closeSSEStream(id);
    this.json._requestToStreamMapping.delete(id);
    this.json._requestResponseMap.delete(id);
  }
  override async handleRequest(req: IncomingMessage, res: ServerResponse, parsedBody?: unknown): Promise<void> {
    const id = (parsedBody as { id?: RequestId } | undefined)?.id;
    const disconnected = () => { if (id !== undefined) this.releaseRequest(id); };
    res.once('close', disconnected);
    try { await super.handleRequest(req, res, parsedBody); }
    finally { res.off('close', disconnected); }
  }
  override async send(message: JSONRPCMessage, options?: Parameters<Transport['send']>[1]): Promise<void> {
    const response = 'result' in message || 'error' in message;
    const id = 'result' in message || 'error' in message ? message.id : options?.relatedRequestId;
    const streamId = id === undefined ? undefined : this.json._requestToStreamMapping.get(id);
    const stream = streamId === undefined ? undefined : this.json._streamMapping.get(streamId);
    if (response && !stream) return; // Delivery ended while its owning operation was still running.
    if (response && Buffer.byteLength(JSON.stringify(message)) > this.maximumBytes) {
      message = { jsonrpc: '2.0', id: id!, error: { code: ErrorCode.InternalError, message: 'Response exceeds configured limit' } };
    }
    try { await super.send(message, options); }
    finally { if (response) stream?.cleanup(); }
  }
  override async close(): Promise<void> {
    for (const id of this.json._requestToStreamMapping.keys()) this.releaseRequest(id);
    await super.close();
  }
}
