import type { SectionType } from '@/shared/contracts/field';
import type {
  FormInstanceSnapshot,
  InstanceObservation,
  ObservationField,
  ReanchorEvidence,
  ReanchorResult,
} from '@/shared/contracts/reanchor';

import {
  buildTopology,
  extractWitness,
  matchStableIds,
  matchTopology,
  matchWitness,
  witnessHasEvidence,
} from './ContentWitness';

export interface ReanchorWeights {
  stable: number;
  witness: number;
  context: number;
  topology: number;
}

export interface ReanchorConfig {
  weights: ReanchorWeights;
  matchThreshold: number;
  ambiguityMargin: number;
  unknownEvidenceCap: number;
}

export const DEFAULT_REANCHOR_CONFIG: ReanchorConfig = {
  weights: { stable: 0.35, witness: 0.4, context: 0.15, topology: 0.1 },
  matchThreshold: 0.6,
  ambiguityMargin: 0.15,
  unknownEvidenceCap: 0.45,
};

export interface CandidateScore {
  snapshotIndex: number;
  score: number;
  evidence: ReanchorEvidence;
}

export interface ReanchorSectionInput {
  sectionType: SectionType;
  observations: InstanceObservation[];
  snapshots: FormInstanceSnapshot[];
  availableEntryIds: string[];
  claimedEntryIds?: Set<string>;
  allocateInstanceId: () => string;
}

export interface ReanchorSectionOutput {
  results: ReanchorResult[];
  missingSnapshots: FormInstanceSnapshot[];
}

export interface FieldAnchorResult {
  status: 'MATCHED' | 'AMBIGUOUS';
  reason?: string;
}

export class ReanchorManager {
  private readonly config: ReanchorConfig;

  constructor(config: ReanchorConfig = DEFAULT_REANCHOR_CONFIG) {
    this.config = config;
  }

  scoreCandidate(observation: InstanceObservation, snapshot: FormInstanceSnapshot, uniqueStableId = false): CandidateScore {
    const observationWitness = extractWitness(observation.sectionType, observation.fields);
    const observationTopology = buildTopology(observation.fields);

    const stableScore = matchStableIds(snapshot.witness.stableIds, observationWitness.stableIds);
    const witnessMatch = matchWitness(snapshot.witness, observationWitness);
    const topologyScore = matchTopology(snapshot.topology, observationTopology);
    const contextScore = observation.sectionType === snapshot.sectionType ? 1 : 0;

    const evidence: ReanchorEvidence = {
      stableIdMatched: stableScore >= 0.5,
      witnessMatched:
        witnessMatch.primaryMatched ||
        (witnessMatch.auxiliaryCompared > 0 && witnessMatch.auxiliaryMatched / witnessMatch.auxiliaryCompared >= 0.5),
      topologyMatched: topologyScore >= 0.9,
      contextMatched: contextScore === 1,
    };

    const { weights } = this.config;
    let score =
      weights.stable * stableScore +
      weights.witness * witnessMatch.score +
      weights.context * contextScore +
      weights.topology * topologyScore;

    if ((!witnessHasEvidence(observationWitness) || !witnessHasEvidence(snapshot.witness)) && !(uniqueStableId && stableScore === 1)) {
      score = Math.min(score, this.config.unknownEvidenceCap);
    }
    // A connected container retains its logical identity; DOM position never supplies identity.
    if (observation.continuityInstanceId === snapshot.instanceId && topologyScore >= 0.9) score = 1;

    return { snapshotIndex: -1, score, evidence };
  }

  reanchorSection(input: ReanchorSectionInput): ReanchorSectionOutput {
    const { snapshots, observations } = input;
    const results: ReanchorResult[] = new Array<ReanchorResult>(observations.length);
    const claimedSnapshots = new Set<number>();
    const claimedEntries = new Set(input.claimedEntryIds ?? []);
    for (const snapshot of snapshots) {
      if (snapshot.resumeEntryId !== undefined) {
        claimedEntries.add(snapshot.resumeEntryId);
      }
    }

    if (snapshots.length === 0) {
      for (let index = 0; index < observations.length; index += 1) {
        results[index] = this.makeNewInstance(input, claimedEntries);
      }
      return { results, missingSnapshots: [] };
    }

    const candidateLists: CandidateScore[][] = observations.map((observation) =>
      snapshots
        .map((snapshot, snapshotIndex) => {
          const uniqueStableId = snapshot.witness.stableIds.some((id) =>
            observation.fields.some((field) => field.fieldName === id || field.stableAttribute === id) &&
            !snapshots.some((other) => other !== snapshot && other.witness.stableIds.includes(id)));
          const scored = this.scoreCandidate(observation, snapshot, uniqueStableId);
          const primary = extractWitness(observation.sectionType, observation.fields).primary?.value;
          const owners = primary ? snapshots.filter((candidate) => candidate.witness.primary?.value === primary) : [];
          if (owners.length === 1 && owners[0] !== snapshot && observation.continuityInstanceId !== snapshot.instanceId) {
            scored.score = Math.min(scored.score, this.config.unknownEvidenceCap);
          }
          return { ...scored, snapshotIndex };
        })
        .sort((a, b) => b.score - a.score),
    );

    const deferred: number[] = [];
    const order = observations
      .map((_observation, index) => index)
      .sort((a, b) => (candidateLists[b]?.[0]?.score ?? 0) - (candidateLists[a]?.[0]?.score ?? 0));

    let matchedCount = 0;
    for (const observationIndex of order) {
      const candidates = candidateLists[observationIndex] ?? [];
      const best = candidates[0];
      if (best === undefined || best.score < this.config.matchThreshold) {
        deferred.push(observationIndex);
        continue;
      }
      const second = candidates[1];
      if (second !== undefined && best.score - second.score < this.config.ambiguityMargin) {
        results[observationIndex] = {
          status: 'AMBIGUOUS',
          evidence: best.evidence,
          confidence: best.score,
          reason: 'CANDIDATE_TIE',
        };
        continue;
      }
      if (claimedSnapshots.has(best.snapshotIndex)) {
        results[observationIndex] = {
          status: 'AMBIGUOUS',
          evidence: best.evidence,
          confidence: best.score,
          reason: 'SNAPSHOT_CONTESTED',
        };
        continue;
      }
      const snapshot = snapshots[best.snapshotIndex];
      if (snapshot === undefined) {
        continue;
      }
      claimedSnapshots.add(best.snapshotIndex);
      matchedCount += 1;
      results[observationIndex] = this.makeMatched(snapshot, best);
    }

    for (const observationIndex of deferred) {
      if (matchedCount === 0) {
        const best = candidateLists[observationIndex]?.[0];
        results[observationIndex] = {
          status: 'AMBIGUOUS',
          evidence: best?.evidence ?? {
            stableIdMatched: false,
            witnessMatched: false,
            topologyMatched: false,
            contextMatched: false,
          },
          confidence: best?.score,
          reason: 'NO_RELIABLE_EVIDENCE',
        };
        continue;
      }
      results[observationIndex] = this.makeNewInstance(input, claimedEntries);
    }

    const missingSnapshots: FormInstanceSnapshot[] = [];
    for (let index = 0; index < snapshots.length; index += 1) {
      if (!claimedSnapshots.has(index)) {
        const snapshot = snapshots[index];
        if (snapshot !== undefined) {
          missingSnapshots.push(snapshot);
        }
      }
    }

    return { results, missingSnapshots };
  }

  reanchorField(fields: ObservationField[], snapshot: FormInstanceSnapshot): FieldAnchorResult {
    const counts = countByToken(fields);
    const keys = new Set([...Object.keys(counts), ...Object.keys(snapshot.topologyCounts)]);
    for (const key of keys) {
      if ((counts[key] ?? 0) !== (snapshot.topologyCounts[key] ?? 0)) {
        return { status: 'AMBIGUOUS', reason: 'TOPOLOGY_CHANGED' };
      }
    }
    return { status: 'MATCHED' };
  }

  private makeMatched(snapshot: FormInstanceSnapshot, best: CandidateScore): ReanchorResult {
    const result: ReanchorResult = {
      status: 'MATCHED',
      instanceId: snapshot.instanceId,
      evidence: best.evidence,
      confidence: best.score,
    };
    if (snapshot.resumeEntryId !== undefined) {
      result.resumeEntryId = snapshot.resumeEntryId;
    }
    return result;
  }

  private makeNewInstance(input: ReanchorSectionInput, claimedEntries: Set<string>): ReanchorResult {
    const instanceId = input.allocateInstanceId();
    let resumeEntryId: string | undefined;
    for (const entryId of input.availableEntryIds) {
      if (!claimedEntries.has(entryId)) {
        resumeEntryId = entryId;
        break;
      }
    }
    if (resumeEntryId !== undefined) {
      claimedEntries.add(resumeEntryId);
    }
    const result: ReanchorResult = {
      status: 'NEW_INSTANCE',
      instanceId,
      evidence: { stableIdMatched: false, witnessMatched: false, topologyMatched: false, contextMatched: true },
    };
    if (resumeEntryId !== undefined) {
      result.resumeEntryId = resumeEntryId;
    } else {
      result.reason = 'NO_UNCLAIMED_ENTRY';
    }
    return result;
  }
}

function countByToken(fields: ObservationField[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const token of buildTopology(fields)) {
    counts[token] = (counts[token] ?? 0) + 1;
  }
  return counts;
}
