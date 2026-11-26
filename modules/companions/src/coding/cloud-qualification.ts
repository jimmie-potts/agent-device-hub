import type {CodingDestination} from '@jimmie-potts/event-contracts/v2/coding';
import type {CodingHarness} from './routing.js';

export type CloudScope = {
  operationId: string;
  destination: Extract<CodingDestination, `cloud-${string}`>;
  endpointId: string;
  selectionId: string;
  repository: string;
  revision: string;
  harness: CodingHarness;
};

type Allowance = {computeMs: number; storageBytes: number; chargeMicros: number; expiresAtMs: number};
type Candidate = Pick<CloudScope, 'operationId' | 'destination' | 'repository' | 'revision' | 'harness'>;
export type CloudGrant = Candidate & Allowance;
type Workspace = CloudScope & {workspaceId: string; enforced: Allowance};
type Teardown = {workspaceId: string; operationId: string; workspaceRemoved: boolean; writerStopped: boolean; chargeMicros: number};

/** A qualification provider supplies trusted observations and enforces all four limits independently of the Hub. */
export interface QualificationProvider {
  accepts(grant: Readonly<CloudGrant>): boolean;
  launch(grant: Readonly<CloudGrant>): Promise<Workspace>;
  teardown(workspaceId: string, operationId: string): Promise<Teardown>;
}

// A disposable provider instance owns all of its one-shot claims for this process.
const claims = new WeakMap<QualificationProvider, Set<string>>();

type QualificationState = 'unused' | 'launching' | 'active' | 'cleaning' | 'closed' | 'held';

function sameCandidate(expected: Candidate, actual: Candidate): boolean {
  return expected.operationId === actual.operationId && expected.destination === actual.destination &&
    expected.repository === actual.repository && expected.revision === actual.revision && expected.harness === actual.harness;
}

function validAllowance(limits: Allowance, now: number): boolean {
  return [limits.computeMs, limits.storageBytes, limits.chargeMicros, limits.expiresAtMs].every(Number.isSafeInteger) &&
    limits.computeMs > 0 && limits.storageBytes > 0 && limits.chargeMicros >= 0 && limits.expiresAtMs > now;
}

/** Single-process disposable qualification. Installed use requires a durable claim and reconciliation before activation. */
export class CloudQualification {
  #state: QualificationState = 'unused';
  #workspace?: Workspace;
  #approved?: CloudGrant;
  #teardownStarted = false;
  #teardownConfirmed = false;
  #charged: number | null = null;
  readonly #claims: Set<string>;
  constructor(readonly provider: QualificationProvider, readonly now: () => number) {
    this.#claims = claims.get(provider) ?? new Set<string>();
    claims.set(provider, this.#claims);
  }

  get receipt() {
    const workspace = this.#workspace;
    const enforcedCharge = workspace?.enforced.chargeMicros;
    return {state: this.#state, operationId: this.#approved?.operationId ?? null, workspaceId: workspace?.workspaceId ?? null,
      approvedChargeMicros: this.#approved?.chargeMicros ?? null,
      enforcedChargeMicros: enforcedCharge !== undefined && Number.isSafeInteger(enforcedCharge) && enforcedCharge >= 0 ? enforcedCharge : null,
      chargedMicros: this.#charged, teardownConfirmed: this.#teardownConfirmed};
  }

  async launch(candidate: Candidate, grant?: CloudGrant): Promise<boolean> {
    if (this.#state !== 'unused' || grant === undefined || !sameCandidate(grant, candidate) ||
      !validAllowance(grant, this.now()) || !this.provider.accepts({...grant})) return false;
    if (this.#claims.has(grant.operationId)) return false;
    this.#claims.add(grant.operationId);
    this.#state = 'launching';
    const approved = {...grant};
    this.#approved = approved;
    try {
      const workspace = await this.provider.launch({...approved});
      if (sameCandidate(approved, workspace) && workspace.workspaceId.length > 0) {
        const limits = workspace.enforced;
        this.#workspace = {...workspace, enforced: {...limits}};
        if (workspace.endpointId.length > 0 && workspace.selectionId.length > 0 && validAllowance(limits, this.now()) &&
          limits.computeMs <= approved.computeMs && limits.storageBytes <= approved.storageBytes &&
          limits.chargeMicros <= approved.chargeMicros && limits.expiresAtMs <= approved.expiresAtMs) {
          this.#state = 'active';
          return true;
        }
      }
    } catch {
      // Launch may already have created a billable workspace.
    }
    this.#state = 'held';
    if (this.#workspace !== undefined) await this.cleanup();
    return false;
  }

  allows(scope: CloudScope, now: number): boolean {
    const workspace = this.#workspace;
    return this.#state === 'active' && workspace !== undefined && now < workspace.enforced.expiresAtMs &&
      sameCandidate(workspace, scope) && workspace.endpointId === scope.endpointId && workspace.selectionId === scope.selectionId;
  }

  async cleanup(): Promise<boolean> {
    const workspace = this.#workspace;
    const approved = this.#approved;
    if (workspace === undefined || approved === undefined || this.#teardownStarted) return false;
    this.#teardownStarted = true;
    this.#state = 'cleaning';
    try {
      const proof = await this.provider.teardown(workspace.workspaceId, workspace.operationId);
      if (proof.workspaceId === workspace.workspaceId && proof.operationId === workspace.operationId &&
        proof.workspaceRemoved === true && proof.writerStopped === true) {
        this.#teardownConfirmed = true;
        if (Number.isSafeInteger(proof.chargeMicros) && proof.chargeMicros >= 0) {
          this.#charged = proof.chargeMicros;
          if (proof.chargeMicros <= approved.chargeMicros && proof.chargeMicros <= workspace.enforced.chargeMicros) {
            this.#state = 'closed';
            return true;
          }
        }
      }
    } catch {
      // Lost cleanup evidence leaves the existing workspace claim held.
    }
    this.#state = 'held';
    return false;
  }
}
