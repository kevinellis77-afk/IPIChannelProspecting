#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const datasetPath = path.join(root, 'data', 'ukchannel.json');
const calibrationPath = path.join(root, 'data', 'calibration_set.json');
const outputPath = path.join(root, 'data', 'top20_before_after.md');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeRecord(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const pick = (...keys) => {
    for (const key of keys) {
      if (raw[key] !== undefined && raw[key] !== null) return raw[key];
    }
    return null;
  };
  const asString = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v).trim();
    const sl = s.toLowerCase();
    if (!s || sl === 'nan' || sl === 'null' || sl === 'undefined') return '';
    return s;
  };
  const asNumber = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const cleaned = typeof v === 'string' ? v.replace(/[^0-9.-]/g, '') : v;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };
  const asArray = (v) => {
    if (Array.isArray(v)) return v.map(asString).filter(Boolean);
    const s = asString(v);
    if (!s) return [];
    return s.split(/[;,|]/).map(part => part.trim()).filter(Boolean);
  };

  return {
    id: asNumber(pick('id')) ?? (idx + 1),
    name: asString(pick('name', 'Organisation', 'Company Name')),
    revenue: asNumber(pick('revenue', 'Revenue')) ?? 0,
    employees: asString(pick('employees', 'Employees')),
    credit_score: asNumber(pick('credit_score', 'Credit Score')) ?? 0,
    credit_description: asString(pick('credit_description', 'Credit Rating')),
    adopter_profile: asString(pick('adopter_profile', 'Adopter Profile')),
    channel_role: asString(pick('channel_role', 'Channel Role')),
    channel_segment: asString(pick('channel_segment', 'Channel Segment')),
    tech_stack: asArray(pick('tech_stack', 'Tech Stack')),
    partners: asArray(pick('partners', 'Partners'))
  };
}

const BEFORE_CONFIG = {
  thresholds: {
    revenueBands: { enterpriseMin: 80000000, midMarketMin: 20000000 },
    creditScore: { excellentMin: 80, goodMin: 60, cautionMin: 40 },
    creditAdjustments: { lowScorePenalty: -1, cautionDescriptionPenalty: -1, notScoredPenalty: -0.5 }
  },
  priorityTierCutoffs: { tier1: 80, tier2: 60, tier3: 40 },
  parallelBands: [
    { min: 6, points: 12.5 },
    { min: 4.75, points: 10 },
    { min: 3.5, points: 7.5 },
    { min: 2.25, points: 5 },
    { min: 1, points: 2.5 },
    { min: 0, points: 0 }
  ],
  techThresholds: { complementaryOnlyPoints: 6, minimalPoints: 2, oneCoreOnlyPoints: 2 }
};

const AFTER_CONFIG = {
  thresholds: {
    revenueBands: { enterpriseMin: 80000000, midMarketMin: 20000000 },
    creditScore: { excellentMin: 80, goodMin: 60, cautionMin: 40 },
    creditAdjustments: { lowScorePenalty: -0.5, cautionDescriptionPenalty: -0.5, notScoredPenalty: -0.25 }
  },
  priorityTierCutoffs: { tier1: 78, tier2: 58, tier3: 38 },
  parallelBands: BEFORE_CONFIG.parallelBands,
  techThresholds: { complementaryOnlyPoints: 4, minimalPoints: 0, oneCoreOnlyPoints: 8 }
};

function scoreParallelBand(signalStrength, bands) {
  const strength = Number(signalStrength);
  if (!Number.isFinite(strength) || strength <= 0) return 0;
  const matched = bands.find(b => strength >= b.min);
  return matched ? matched.points : 0;
}

function clampScore(value, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, n));
}

function clampRange(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(min, Math.min(max, n));
}

function computeCreditAdjustment(record, config) {
  const score = Number(record.credit_score) || 0;
  const desc = String(record.credit_description || '').toLowerCase();
  const t = config.thresholds;
  let adjustment = 0;

  if (score >= t.creditScore.excellentMin) adjustment = 1.5;
  else if (score >= t.creditScore.goodMin) adjustment = 1;
  else if (score >= t.creditScore.cautionMin) adjustment = 0;
  else if (score > 0) adjustment = t.creditAdjustments.lowScorePenalty;

  if (desc.includes('very good')) adjustment += 0.5;
  else if (desc.includes('good')) adjustment += 0.25;
  else if (desc.includes('caution')) adjustment += t.creditAdjustments.cautionDescriptionPenalty;
  else if (desc.includes('not scored')) adjustment += t.creditAdjustments.notScoredPenalty;

  return clampRange(adjustment, -2, 2);
}

function computeScore(r, config) {
  const subscores = { revenue: 0, employeeScale: 0, creditQuality: 0, partnerSignals: 0, technologySignals: 0, adoptionReadiness: 0 };

  if (r.revenue >= config.thresholds.revenueBands.enterpriseMin) subscores.revenue = 30;
  else if (r.revenue >= config.thresholds.revenueBands.midMarketMin) subscores.revenue = 20;
  else if (r.revenue > 0) subscores.revenue = 10;

  if (['5000+','1001-5000'].includes(r.employees)) subscores.employeeScale = 15;
  else if (r.employees === '501-1000') subscores.employeeScale = 12;
  else if (r.employees === '201-500') subscores.employeeScale = 10;
  else if (r.employees === '51-200') subscores.employeeScale = 8;
  else if (r.employees === '11-50') subscores.employeeScale = 6;
  else if (['1-10','6-10','1-5'].includes(r.employees)) subscores.employeeScale = 4;

  subscores.creditQuality = computeCreditAdjustment(r, config);

  const partners = [...new Set((r.partners || []).map(p => String(p || '').toUpperCase().trim()).filter(Boolean))];
  const tech = [...new Set((r.tech_stack || []).map(t => String(t || '').toLowerCase().trim()).filter(Boolean))];
  const adopter = String(r.adopter_profile || '').toLowerCase();
  const channelRole = String(r.channel_role || '').toLowerCase();
  const channelSegment = String(r.channel_segment || '').toLowerCase();

  const vendorMap = { MICROSOFT: 5, CISCO: 4, AVAYA: 3, GAMMA: 3, VODAFONE: 3, BT: 3, MITEL: 2, VMWARE: 2, SOPHOS: 2, FORTINET: 2 };
  const strategicMatches = partners.filter(p => vendorMap[p]);
  const strategicWeight = strategicMatches.reduce((sum, p) => sum + (vendorMap[p] || 0), 0);
  const strategicStrength = Math.min(3, strategicMatches.length);
  const strategicQuality = Math.min(2, strategicWeight / 6);
  let breadth = 0;
  if (partners.length >= 7) breadth = 2;
  else if (partners.length >= 4) breadth = 1.5;
  else if (partners.length >= 2) breadth = 1;
  else if (partners.length >= 1) breadth = 0.5;
  if (channelRole === 'vendor') breadth += 0.25;
  if (channelSegment.includes('enterprise')) breadth += 0.25;
  const partnerSignalStrength = strategicStrength + strategicQuality + Math.min(2, breadth);
  subscores.partnerSignals = scoreParallelBand(partnerSignalStrength, config.parallelBands);

  const coreTech = ['ucaas', 'ccaas', 'telephony', 'teams'];
  const complementaryTech = ['microsoft 365', 'cloud services', 'it services'];
  const coreMatches = coreTech.filter(signal => tech.some(t => t.includes(signal)));
  const complementMatches = complementaryTech.filter(signal => tech.some(t => t.includes(signal)));

  if (coreMatches.length >= 3) subscores.technologySignals = 20;
  else if (coreMatches.length >= 2) subscores.technologySignals = 16;
  else if ((coreMatches.length === 1 && complementMatches.length >= 1) || complementMatches.length >= 2) subscores.technologySignals = 12;
  else if (coreMatches.length === 1) subscores.technologySignals = config.techThresholds.oneCoreOnlyPoints;
  else if (complementMatches.length === 1) subscores.technologySignals = config.techThresholds.complementaryOnlyPoints;
  else subscores.technologySignals = config.techThresholds.minimalPoints;

  let adopterStrength = 0;
  if (adopter.includes('innovator')) adopterStrength = 3;
  else if (adopter.includes('early adopter')) adopterStrength = 2.5;
  else if (adopter.includes('early majority')) adopterStrength = 1.75;
  else if (adopter.includes('late majority')) adopterStrength = 1;
  else if (adopter.includes('sceptic')) adopterStrength = 0.5;

  const modernizationIndicators = ['microsoft 365', 'teams', 'ucaas', 'ccaas', 'cloud', 'azure', 'aws', 'gcp', 'managed it', 'it services', 'cyber', 'security', 'ai', 'automation', 'sd-wan'];
  const modernizationMatches = [...new Set(modernizationIndicators.filter(signal => tech.some(t => t.includes(signal))))];
  const modernizationCoreStrength = Math.min(3, modernizationMatches.length * 0.75);
  const modernizationBreadthBonus = modernizationMatches.length >= 5 ? 1 : modernizationMatches.length >= 3 ? 0.5 : 0;
  const adoptionSignalStrength = adopterStrength + modernizationCoreStrength + modernizationBreadthBonus;
  subscores.adoptionReadiness = scoreParallelBand(adoptionSignalStrength, config.parallelBands);

  const totalScore = clampScore(Object.values(subscores).reduce((sum, n) => sum + n, 0), 100);
  let priorityTier = 'P4';
  if (totalScore >= config.priorityTierCutoffs.tier1) priorityTier = 'P1';
  else if (totalScore >= config.priorityTierCutoffs.tier2) priorityTier = 'P2';
  else if (totalScore >= config.priorityTierCutoffs.tier3) priorityTier = 'P3';

  return { totalScore, priorityTier, subscores };
}

function rank(records, config) {
  return records
    .map((record, idx) => ({ record, ...computeScore(record, config), idx }))
    .sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      return a.idx - b.idx;
    })
    .map((entry, i) => ({ ...entry, rank: i + 1 }));
}

function indexById(rankedList) {
  const map = new Map();
  rankedList.forEach(item => map.set(item.record.id, item));
  return map;
}

function validateCalibration(calibrationRaw) {
  const records = calibrationRaw.records.map((r, i) => normalizeRecord(r, i));
  const beforeRanked = rank(records, BEFORE_CONFIG);
  const afterRanked = rank(records, AFTER_CONFIG);
  const afterMap = indexById(afterRanked);
  const beforeMap = indexById(beforeRanked);

  const expectedOrder = calibrationRaw.expected_order || [];
  const actualOrder = afterRanked.map(item => item.record.id);
  const strictOrderPass = JSON.stringify(expectedOrder) === JSON.stringify(actualOrder);

  const groups = calibrationRaw.validation_groups || {};

  const highTechAvgBefore = (groups.high_tech_fit_ids || []).reduce((sum, id) => sum + (beforeMap.get(id)?.rank || 999), 0) / (groups.high_tech_fit_ids || []).length;
  const highTechAvgAfter = (groups.high_tech_fit_ids || []).reduce((sum, id) => sum + (afterMap.get(id)?.rank || 999), 0) / (groups.high_tech_fit_ids || []).length;
  const highTechMovedUp = highTechAvgAfter < highTechAvgBefore;

  const lowCreditId = groups.low_credit_strong_fit_ids?.[0];
  const weakFitId = groups.credit_safe_low_fit_ids?.[0];
  const lowCreditOutranksWeakFit = (afterMap.get(lowCreditId)?.rank || 999) < (afterMap.get(weakFitId)?.rank || 999);

  const [partnerHeavyId, adoptionHeavyId] = groups.adoption_partner_parity_pair || [];
  const partnerItem = afterMap.get(partnerHeavyId);
  const adoptionItem = afterMap.get(adoptionHeavyId);
  const parityGap = Math.abs((partnerItem?.subscores?.partnerSignals || 0) - (adoptionItem?.subscores?.adoptionReadiness || 0));
  const parityPass = parityGap <= 2.5;

  return {
    records,
    beforeRanked,
    afterRanked,
    checks: {
      strictOrderPass,
      highTechMovedUp,
      lowCreditOutranksWeakFit,
      parityPass,
      highTechAvgBefore,
      highTechAvgAfter,
      parityGap
    }
  };
}

function top20Comparison(normalizedDataset) {
  const beforeRanked = rank(normalizedDataset, BEFORE_CONFIG);
  const afterRanked = rank(normalizedDataset, AFTER_CONFIG);
  const beforeTop20 = beforeRanked.slice(0, 20);
  const afterTop20 = afterRanked.slice(0, 20);
  const beforeMap = indexById(beforeRanked);

  const lines = [];
  lines.push('# Top-20 Ranking Comparison (Before vs After Threshold Tuning)');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('| After Rank | Company | Score (Before) | Score (After) | Before Rank | Movement |');
  lines.push('|---:|---|---:|---:|---:|---:|');

  afterTop20.forEach(item => {
    const before = beforeMap.get(item.record.id);
    const movement = before ? before.rank - item.rank : 0;
    lines.push(`| ${item.rank} | ${item.record.name} | ${before?.totalScore?.toFixed(2) || '0.00'} | ${item.totalScore.toFixed(2)} | ${before?.rank || '-'} | ${movement > 0 ? `+${movement}` : movement} |`);
  });

  lines.push('');
  lines.push('## Entries that entered top-20 after tuning');
  const beforeIds = new Set(beforeTop20.map(i => i.record.id));
  const entered = afterTop20.filter(i => !beforeIds.has(i.record.id));
  if (!entered.length) lines.push('- None');
  else entered.forEach(i => lines.push(`- ${i.record.name} (id: ${i.record.id})`));

  lines.push('');
  lines.push('## Threshold-only changes applied');
  lines.push('- Credit penalties reduced for low-score/caution/not-scored profiles.');
  lines.push('- Technology thresholds updated (single core-signal uplift, weak-signal floor reduced).');
  lines.push('- Priority tier cutoffs adjusted to maintain practical distribution after threshold tuning.');

  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
}

(function main() {
  const rawDataset = loadJson(datasetPath);
  const normalizedDataset = rawDataset.map((r, i) => normalizeRecord(r, i)).filter(Boolean);
  const calibrationRaw = loadJson(calibrationPath);

  const calibrationResult = validateCalibration(calibrationRaw);
  console.log('Calibration before ranks:', calibrationResult.beforeRanked.map(item => `${item.record.id}:${item.rank}`).join(', '));
  console.log('Calibration after ranks:', calibrationResult.afterRanked.map(item => `${item.record.id}:${item.rank}`).join(', '));
  console.log('Calibration before scores:', calibrationResult.beforeRanked.map(item => `${item.record.id}:${item.totalScore.toFixed(2)}`).join(', '));
  console.log('Calibration after scores:', calibrationResult.afterRanked.map(item => `${item.record.id}:${item.totalScore.toFixed(2)}`).join(', '));
  const failedChecks = Object.entries(calibrationResult.checks)
    .filter(([k, v]) => ['strictOrderPass', 'highTechMovedUp', 'lowCreditOutranksWeakFit', 'parityPass'].includes(k) && !v)
    .map(([k]) => k);

  top20Comparison(normalizedDataset);

  console.log('Calibration checks:', calibrationResult.checks);
  if (failedChecks.length) {
    console.error('Failed checks:', failedChecks.join(', '));
    process.exit(1);
  }
})();
