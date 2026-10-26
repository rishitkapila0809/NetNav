import type { CampusPoint, NetworkMetrics, OperatorOption } from '../types';

export const OPERATORS: OperatorOption[] = [
  {
    id: 'Jio',
    name: 'Reliance Jio 5G',
    badge: '5G True',
    avgNqs: 92,
    status: 'EXCELLENT',
    color: '#00D9FF'
  },
  {
    id: 'Airtel',
    name: 'Bharti Airtel 5G',
    badge: '5G Plus',
    avgNqs: 84,
    status: 'EXCELLENT',
    color: '#35F4FF'
  },
  {
    id: 'Vi',
    name: 'Vodafone Idea 4G',
    badge: '4G GIGA',
    avgNqs: 58,
    status: 'MODERATE',
    color: '#FF9100'
  },
  {
    id: 'BSNL',
    name: 'BSNL Mobile 4G',
    badge: '4G National',
    avgNqs: 34,
    status: 'POOR',
    color: '#FF1744'
  }
];

export const MOCK_BEST_SPOT_METRICS: Record<string, NetworkMetrics> = {
  Jio: {
    nqs: 92,
    status: 'EXCELLENT',
    latencyMs: 32,
    packetLossPercent: 0.8,
    throughputMbps: 85,
    jitterMs: 6,
    signalDbm: -62,
    frequencyGhz: 3.5,
    band: 'n78 (5G)'
  },
  Airtel: {
    nqs: 84,
    status: 'EXCELLENT',
    latencyMs: 38,
    packetLossPercent: 1.1,
    throughputMbps: 72,
    jitterMs: 8,
    signalDbm: -68,
    frequencyGhz: 3.3,
    band: 'n78 (5G)'
  },
  Vi: {
    nqs: 58,
    status: 'MODERATE',
    latencyMs: 64,
    packetLossPercent: 3.2,
    throughputMbps: 28,
    jitterMs: 16,
    signalDbm: -84,
    frequencyGhz: 2.1,
    band: 'B1 (4G)'
  },
  BSNL: {
    nqs: 34,
    status: 'POOR',
    latencyMs: 112,
    packetLossPercent: 7.5,
    throughputMbps: 9.4,
    jitterMs: 29,
    signalDbm: -98,
    frequencyGhz: 1.8,
    band: 'B3 (4G)'
  }
};

export const MOCK_CAMPUS_POINTS: CampusPoint[] = [
  {
    id: 'pt-1',
    name: 'Technology Tower Plaza',
    buildingCode: 'TT-P1',
    x: 52,
    y: 38,
    nqs: 92,
    status: 'EXCELLENT',
    isBestSpot: true,
    distanceMeters: 8,
    lastMeasured: '12 min ago',
    landmarkType: 'academic',
    operatorScores: { Jio: 92, Airtel: 88, Vi: 62, BSNL: 36 }
  },
  {
    id: 'pt-2',
    name: 'Silver Jubilee Tower Quad',
    buildingCode: 'SJT-Q2',
    x: 74,
    y: 28,
    nqs: 71,
    status: 'GOOD',
    distanceMeters: 140,
    lastMeasured: '25 min ago',
    landmarkType: 'academic',
    operatorScores: { Jio: 71, Airtel: 76, Vi: 54, BSNL: 30 }
  },
  {
    id: 'pt-3',
    name: 'Anna Auditorium Court',
    buildingCode: 'AUD-C1',
    x: 35,
    y: 64,
    nqs: 54,
    status: 'MODERATE',
    distanceMeters: 310,
    lastMeasured: '42 min ago',
    landmarkType: 'amenity',
    operatorScores: { Jio: 54, Airtel: 59, Vi: 48, BSNL: 24 }
  },
  {
    id: 'pt-4',
    name: 'Food Mall Courtyard',
    buildingCode: 'FM-Z4',
    x: 62,
    y: 75,
    nqs: 28,
    status: 'POOR',
    distanceMeters: 520,
    lastMeasured: '1 hour ago',
    landmarkType: 'amenity',
    operatorScores: { Jio: 28, Airtel: 32, Vi: 22, BSNL: 18 }
  },
  {
    id: 'pt-user',
    name: 'Main Building Lawn',
    buildingCode: 'MB-L1',
    x: 44,
    y: 48,
    nqs: 78,
    status: 'GOOD',
    isUserLocation: true,
    distanceMeters: 0,
    lastMeasured: 'Just now',
    landmarkType: 'academic',
    operatorScores: { Jio: 78, Airtel: 81, Vi: 50, BSNL: 28 }
  }
];

export const CAMPUS_ROADS_SVG = [
  // Academic Spine Road
  { d: 'M 15 50 Q 30 45 44 48 T 52 38 T 74 28 T 90 22', label: 'Academic Spine' },
  // Central Avenue
  { d: 'M 44 48 L 35 64 L 38 85', label: 'Central Walkway' },
  // East Quad Way
  { d: 'M 52 38 L 62 75 L 85 80', label: 'Hostel Connector' },
  // Loop Road
  { d: 'M 74 28 L 88 50 L 62 75', label: 'Eastern Loop' }
];

export const MOCK_STATS_SUMMARY = {
  totalActiveNodes: 142,
  avgCampusLatency: 38.4,
  coverageAreaKm2: 1.45,
  lastUpdatedTime: '17:00 IST'
};
