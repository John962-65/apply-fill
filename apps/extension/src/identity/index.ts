export { canonicalizeDescriptor, computeFieldKey, KEY_SCHEMA_VERSION } from './DeterministicFieldKey';
export { buildFieldIdentity } from './FieldIdentity';
export type { FieldIdentity } from './FieldIdentity';
export {
  buildTopology,
  countTopology,
  extractWitness,
  matchStableIds,
  matchTopology,
  matchWitness,
  MAX_AUXILIARY_WITNESS,
  normalizeWitnessValue,
  PRIMARY_WITNESS_LABELS,
  witnessHasEvidence,
} from './ContentWitness';
export type { WitnessMatchResult } from './ContentWitness';
export { FormInstanceRegistry } from './FormInstanceRegistry';
export type { InstanceDraft } from './FormInstanceRegistry';
export { DEFAULT_REANCHOR_CONFIG, ReanchorManager } from './ReanchorManager';
export type {
  CandidateScore,
  FieldAnchorResult,
  ReanchorConfig,
  ReanchorSectionInput,
  ReanchorSectionOutput,
  ReanchorWeights,
} from './ReanchorManager';
