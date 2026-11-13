// The SDK test harness supplies the core's clock, scheduler and database without starting a runtime process.
import {CORE_SOURCE} from '@jimmie-potts/event-contracts/v2/families';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';

export class CoreHarness extends ModuleHarness {
  override readonly source = CORE_SOURCE;
}
