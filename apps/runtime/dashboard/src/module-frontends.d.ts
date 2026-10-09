// The existing build supplies these fixed static imports; this is not a runtime module loader.
declare module '@bunny/module-frontends' {
  export const FRONTENDS: readonly import('@jimmie-potts/sdk/frontend').FrontendContribution[];
}
