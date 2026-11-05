import type {DeviceSimulation, ModuleRegistration} from '@jimmie-potts/sdk';
import {configureArt} from './configuration.js';
import {artSchemas, registerArtStateFamily} from './families.js';
import {createArtModule} from './module.js';
import {ART_SIMULATION_ACTIONS, SimulatedArt, remoteProviders, simulatedProviders} from './simulated.js';

const build = (provider: SimulatedArt) => createArtModule({providers: simulatedProviders(provider.call.bind(provider))});
const simulation: DeviceSimulation<SimulatedArt, SimulatedArt> = {
  actions: ART_SIMULATION_ACTIONS,
  memory: {create: () => new SimulatedArt(), state: provider => provider.state(), act: (provider, value) => {provider.act(value.action);}, build},
  run: {create: () => new SimulatedArt(), state: provider => provider.state(), act: (provider, value) => {provider.act(value.action);},
    serve: (provider, {method, args, signal}) => provider.call(method, args, signal), remote: link => createArtModule({providers: remoteProviders(link)})},
};

// Production keeps its keyed providers. Simulation always uses local synthetic pixels and reported synthetic usage.
export const registration: ModuleRegistration = {name: 'art', shipped: true, order: 760,
  create: () => createArtModule(), simulate: () => build(new SimulatedArt()),
  schemas: artSchemas, registerFamilies: registerArtStateFamily, simulatedSection: {config: {}}, simulation,
  hostLocal: section => 'config' in configureArt(section)};
