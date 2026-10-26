import type { RouteNetworkOverlay } from './routeNetworkOverlay';
import type { WalkingRouteOption } from './walkingRoutes';

/** At least 60% of route distance must have measured bins before recommending network quality. */
export const MIN_NETWORK_RECOMMENDATION_COVERAGE = 60;
export const DEFAULT_DURATION_WEIGHT = 0.7;
export const DEFAULT_NETWORK_RISK_WEIGHT = 0.3;

export interface RankedWalkingRoute {
  route: WalkingRouteOption;
  overlay: RouteNetworkOverlay | null;
  durationCost: number | null;
  networkRisk: number | null;
  finalCost: number | null;
  confidentNetworkEvidence: boolean;
  fastest: boolean;
  bestNetwork: boolean;
  explanation: string;
}

/** Risk is distance weighted. Confidence controls how much measured NQS can reduce uncertainty.
 * risk(bin) = confidence * (1 - NQS/100) + (1-confidence). Unknown distance has risk 1.
 * final cost = 0.70 * min-max normalized duration + 0.30 * network risk; lower is better.
 */
export function calculateRouteRankings(
  routes: WalkingRouteOption[], overlays: ReadonlyMap<string, RouteNetworkOverlay>,
  weights = { duration: DEFAULT_DURATION_WEIGHT, networkRisk: DEFAULT_NETWORK_RISK_WEIGHT },
  historyComplete = true,
): RankedWalkingRoute[] {
  if (!routes.length) return [];
  if (!Number.isFinite(weights.duration) || !Number.isFinite(weights.networkRisk) || weights.duration < 0 || weights.networkRisk < 0 || weights.duration + weights.networkRisk <= 0) {
    throw new Error('Route ranking weights must be finite, non-negative, and not both zero.');
  }
  const durations = routes.map((route) => route.durationSeconds);
  const min = Math.min(...durations), max = Math.max(...durations);
  const durationCost = (duration: number) => max === min ? 0 : (duration - min) / (max - min);
  const risks = routes.map((route) => {
    const overlay = overlays.get(route.id);
    if (!overlay || !Number.isFinite(overlay.coveragePercent)) return null;
    const total = overlay.bins.reduce((sum, bin) => sum + bin.lengthMeters, 0);
    if (!total) return null;
    return overlay.bins.reduce((sum, bin) => {
      const confidence = bin.classification === 'unknown' || bin.nqs === null ? 0 : Math.max(0, Math.min(1, bin.confidence));
      const qualityRisk = bin.nqs === null ? 1 : 1 - Math.max(0, Math.min(100, bin.nqs)) / 100;
      return sum + bin.lengthMeters * (confidence * qualityRisk + 1 - confidence);
    }, 0) / total;
  });
  const fastestIndex = durations.indexOf(min);
  const coverageQualified = routes.map((route) => historyComplete && (overlays.get(route.id)?.coveragePercent ?? 0) >= MIN_NETWORK_RECOMMENDATION_COVERAGE);
  const qualifiedRiskIndices = risks.map((risk, i) => risk !== null && coverageQualified[i] ? i : -1).filter((i) => i >= 0);
  const bestNetworkIndex = qualifiedRiskIndices.length
    ? qualifiedRiskIndices.reduce((best, index) => risks[index]! < risks[best]! ? index : best)
    : -1;
  const weightTotal = weights.duration + weights.networkRisk;
  return routes.map((route, index) => {
    const overlay = overlays.get(route.id) ?? null;
    const risk = risks[index];
    const dCost = durationCost(route.durationSeconds);
    const final = risk === null ? null : (weights.duration * dCost + weights.networkRisk * risk) / weightTotal;
    const confidentNetworkEvidence = coverageQualified[index] && risk !== null;
    const fastest = index === fastestIndex;
    const bestNetwork = index === bestNetworkIndex;
    const coverage = overlay?.coveragePercent ?? 0;
    const explanation = !overlay || risk === null
      ? 'Network score is unavailable until historical measurements load.'
      : !historyComplete
        ? 'Insufficient network data: historical retrieval reached its safety cap, so route coverage may be incomplete.'
        : !confidentNetworkEvidence
        ? `Insufficient network data: ${coverage}% coverage is below the ${MIN_NETWORK_RECOMMENDATION_COVERAGE}% recommendation threshold; unknown sections count as uncertainty.`
        : `${coverage}% measured coverage, ${overlay.unknownMeters} m unknown, and ${Math.round((risk ?? 1) * 100)}% network risk. ${fastest ? 'This is the fastest option.' : `It takes ${Math.max(0, Math.round(route.durationSeconds - durations[fastestIndex]))} seconds longer than the fastest route.`}`;
    return { route, overlay, durationCost: dCost, networkRisk: risk, finalCost: final,
      confidentNetworkEvidence, fastest, bestNetwork, explanation };
  });
}
