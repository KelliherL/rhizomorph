/**
 * @observatory/core — the event contract and every pure derivation over it.
 *
 * Server, collectors and web all import from here; nothing here imports from
 * them. One event log in, one SessionState and a pile of selectors out.
 */

export * from './collector.js'
export * from './events/index.js'
