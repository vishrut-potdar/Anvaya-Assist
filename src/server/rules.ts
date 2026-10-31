export interface AnomalyRuleDefinition {
  code: string;
  name: string;
  defaultSeverity: 'low' | 'medium' | 'high' | 'critical';
  weight: number; // weight w_i in [0.2, 0.95] for score = 1 - \prod(1 - w_i)
  explanationTemplate: (details: Record<string, any>) => string;
}

export const RULES: Record<string, AnomalyRuleDefinition> = {
  R1: {
    code: 'R1_UNKNOWN_OR_FORGED_CODE',
    name: 'Unknown or Forged Code',
    defaultSeverity: 'high',
    weight: 0.95,
    explanationTemplate: (d) =>
      `QR code token or identifier failed verification (${d.reason || 'Cryptographic HMAC mismatch or unregistered serial'}).`,
  },
  R2: {
    code: 'R2_REUSED_DUPLICATE_COMMISSIONING',
    name: 'Duplicate Commissioning',
    defaultSeverity: 'critical',
    weight: 0.95,
    explanationTemplate: (d) =>
      `A duplicate MANUFACTURE event or active commissioning was detected for GTIN ${d.gtin} and serial ${d.serial}.`,
  },
  R3: {
    code: 'R3_STATE_INCONSISTENT_SCAN',
    name: 'Premature or Inconsistent Scan',
    defaultSeverity: 'high',
    weight: 0.75,
    explanationTemplate: (d) =>
      `Consumer scanned an item whose registered state is '${d.state}'. Genuine items can only be scanned by consumers after 'SOLD'.`,
  },
  R4: {
    code: 'R4_IMPOSSIBLE_TRAVEL',
    name: 'Impossible Physical Travel',
    defaultSeverity: 'high',
    weight: 0.85,
    explanationTemplate: (d) =>
      `Consecutive scans occurred across ${d.km} km in ${d.hours} hours (${d.kmh} km/h), exceeding physical velocity limits (${d.maxKmh} km/h). High probability of a cloned photocopy!`,
  },
  R5: {
    code: 'R5_SCAN_DIVERSITY_AFTER_SALE',
    name: 'Abnormal Scan Diversity',
    defaultSeverity: 'medium',
    weight: 0.50,
    explanationTemplate: (d) =>
      `Code scanned across ${d.distinctDevices} unique devices or ${d.distinctRegions} distinct geographical regions post-sale.`,
  },
  R6: {
    code: 'R6_BROKEN_CHAIN_CUSTODY_GAP',
    name: 'Broken Custody Chain',
    defaultSeverity: 'high',
    weight: 0.85,
    explanationTemplate: (d) =>
      `Custody anomaly: Event ${d.type} was recorded by partner ${d.actorId}, but current custodian in ledger is ${d.expectedCustodian}.`,
  },
  R7: {
    code: 'R7_QUANTITY_MISMATCH',
    name: 'Dispatched vs Received Quantity Mismatch',
    defaultSeverity: 'high',
    weight: 0.60,
    explanationTemplate: (d) =>
      `Discrepancy at receipt: Dispatched ${d.dispatched} units, but receiver recorded ${d.received} units (shortage of ${d.delta} units).`,
  },
  R8: {
    code: 'R8_ROUTE_DEVIATION',
    name: 'Route Deviation',
    defaultSeverity: 'medium',
    weight: 0.50,
    explanationTemplate: (d) =>
      `Shipment was received by partner ${d.actualReceiver}, differing from expected destination partner ${d.expectedReceiver}.`,
  },
  R9: {
    code: 'R9_POST_RECALL_MOVEMENT',
    name: 'Post-Recall Movement Violation',
    defaultSeverity: 'critical',
    weight: 0.95,
    explanationTemplate: (d) =>
      `A ${d.type} action was attempted on batch ${d.batchCode}, which was officially recalled on ${d.recalledAt}.`,
  },
};

export type BuyerVerdict = 'Verified' | 'Caution' | 'Not verified' | 'Recalled';

/**
 * Multiplicative independence risk score formula from Research Paper (Page 22):
 * score = 1 - \prod(1 - w_i)
 */
export function calculateRiskScore(triggeredRuleCodes: string[]): {
  score: number;
  verdict: BuyerVerdict;
} {
  if (triggeredRuleCodes.length === 0) {
    return { score: 0.0, verdict: 'Verified' };
  }

  let product = 1.0;
  let hasCriticalOrFatal = false;

  for (const code of triggeredRuleCodes) {
    const key = Object.keys(RULES).find(k => RULES[k].code === code || k === code);
    const rule = key ? RULES[key] : null;
    const w = rule ? rule.weight : 0.5;
    product *= (1.0 - w);

    if (code.startsWith('R1') || code.startsWith('R2') || code.startsWith('R9')) {
      hasCriticalOrFatal = true;
    }
  }

  const score = Math.round((1.0 - product) * 1000) / 1000;

  let verdict: BuyerVerdict = 'Verified';
  if (hasCriticalOrFatal || score > 0.7) {
    verdict = 'Not verified';
  } else if (score >= 0.3) {
    verdict = 'Caution';
  }

  return { score, verdict };
}
