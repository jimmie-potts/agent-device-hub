import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Authorization, FailureCode, Receipt, Request, Snapshot } from '@jimmie-potts/device-contracts';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export type MachinePrincipal = { id: string; credential: NonNullable<Authorization['credential']> };
export type ControllerContext = { principalId: string; authorization: Authorization };
export type CommandResult =
  | { kind: 'receipt'; receipt: Receipt }
  | { kind: 'rejected'; code: FailureCode; priorEffects: 'none' }
  | { kind: 'unavailable'; code: 'transport-failure' | 'uncertain-result'; priorEffects: 'none' | 'possible' };
export interface ControllerService {
  readSnapshot(context: ControllerContext): Promise<Snapshot>;
  submit(request: Request, context: ControllerContext): Promise<CommandResult>;
}
export type JsonSchema = Tool['inputSchema'];
export interface ServiceExtension {
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  scope: 'read' | 'control';
  description: string;
  annotations: NonNullable<Tool['annotations']>;
  invoke(args: Record<string, unknown>, context: ControllerContext): Promise<{ data: Record<string, unknown>; isError?: boolean }>;
}
export interface DeviceRegistration {
  controllerId: string;
  deviceId: string;
  label?: string;
  service?: ControllerService;
  extensions?: Readonly<Record<string, ServiceExtension>>;
}
export type DeviceTool = Readonly<Tool>;
export interface GatewayLimits {
  maxBodyBytes: number;
  maxResponseBytes: number;
  maxInFlight: number;
  maxSessions: number;
  maxDevices: number;
  authenticationTimeoutMs: number;
  requestTimeoutMs: number;
  sessionIdleMs: number;
}
export interface McpHandlerOptions {
  enabled: boolean;
  registry: import('./registry.js').DeviceRegistry;
  tools: readonly DeviceTool[];
  authenticate(bearer: string, signal: AbortSignal): Promise<MachinePrincipal | null>;
  allowedHosts: readonly string[];
  allowedOrigins: readonly string[];
  allowFetchMetadata?: (headers: IncomingMessage['headers']) => boolean;
  limits?: Partial<GatewayLimits>;
}
export interface McpHandler {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  close(): Promise<void>;
}
