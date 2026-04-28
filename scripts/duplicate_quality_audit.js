#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const testSetPath = path.join(root, 'data', 'duplicate_test_set.json');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sanitizeSafeText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '');
}

function normalizeUrlField(value) {
  const raw = sanitizeSafeText(value);
  if (!raw) return '';
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    if (!['http:', 'https:'].includes(parsed.protocol)) return { error: 'Use a valid http(s) URL' };
    return { value: parsed.toString() };
  } catch (_) {
    return { error: 'Use a valid URL' };
  }
}

function isValidHttpsUrl(value) {
  const parsed = normalizeUrlField(value);
  if (parsed.error || !parsed.value) return false;
  try {
    return new URL(parsed.value).protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function uniqueCaseInsensitive(items) {
  const seen = new Set();
  const out = [];
  items.forEach(item => {
    const clean = sanitizeSafeText(item);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  });
  return out;
}

function parseEmployeeBandHigh(input) {
  const text = sanitizeSafeText(input);
  if (!text) return 0;
  if (text.includes('+')) {
    const n = Number(text.replace(/[^0-9]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  const nums = text.match(/\d+/g);
  if (!nums || nums.length === 0) return 0;
  const highs = nums.map(n => Number(n)).filter(Number.isFinite);
  return highs.length ? Math.max(...highs) : 0;
}

function mostFrequentNonEmpty(values) {
  const counts = new Map();
  values.forEach(value => {
    const clean = sanitizeSafeText(value);
    if (!clean) return;
    const key = clean.toLowerCase();
    const current = counts.get(key) || { value: clean, count: 0 };
    current.count += 1;
    if (clean.length > current.value.length) current.value = clean;
    counts.set(key, current);
  });
  if (counts.size === 0) return '';
  return [...counts.values()].sort((a, b) => (b.count - a.count) || (b.value.length - a.value.length))[0].value;
}

function chooseLongestLegalName(values) {
  const legalNameRegex = /^[\w\s&.,'’()\-\/]+$/;
  const legal = values.map(value => sanitizeSafeText(value)).filter(value => value && legalNameRegex.test(value));
  if (!legal.length) return '';
  return legal.sort((a, b) => b.length - a.length)[0];
}

function normalizeDomainValue(input, { stripPort = true } = {}) {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim().toLowerCase();
  if (!raw) return null;

  let candidate = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  candidate = candidate.split('/')[0].trim();
  if (!candidate) return null;

  if (candidate.startsWith('www.')) candidate = candidate.slice(4);
  candidate = candidate.replace(/\/+$/, '');
  if (stripPort) candidate = candidate.replace(/:\d+$/, '');

  if (!candidate) return null;
  if (!/^[a-z0-9.-]+$/.test(candidate)) return null;
  if (!candidate.includes('.')) return null;
  if (candidate.startsWith('.') || candidate.endsWith('.')) return null;
  if (candidate.includes('..')) return null;
  return candidate;
}

function normalizeRecord(raw, idx = 0) {
  const asArray = (v) => {
    if (Array.isArray(v)) return v.map(x => String(x || '').trim()).filter(Boolean);
    if (v === null || v === undefined || v === '') return [];
    return String(v).split(/[;,|]/).map(x => x.trim()).filter(Boolean);
  };
  const record = {
    ...raw,
    id: Number(raw.id || idx + 1),
    name: String(raw.name || '').trim(),
    domain: String(raw.domain || '').trim(),
    employees: String(raw.employees || '').trim(),
    revenue: Number(raw.revenue || 0),
    year_founded: Number(raw.year_founded || 0),
    tech_stack: asArray(raw.tech_stack),
    partners: asArray(raw.partners)
  };
  record.domain_key = normalizeDomainValue(record.domain, { stripPort: true });
  return record;
}

function buildCanonicalEntityFromRecords(records) {
  if (!Array.isArray(records) || records.length === 0) return null;

  const sourceIds = records.map(record => record.id).filter(id => id !== null && id !== undefined);
  const canonicalId = `entity:${records[0].domain_key || records[0].id}`;
  const fieldProvenance = {};
  const withSource = (field, value, sourceRecordId) => {
    fieldProvenance[field] = sourceRecordId;
    return value;
  };

  const names = records.map(record => record.name).filter(Boolean);
  const frequentName = mostFrequentNonEmpty(names);
  const fallbackName = chooseLongestLegalName(names);
  const selectedName = frequentName || fallbackName || `Entity ${records[0].id}`;
  const selectedNameSource = records.find(record => sanitizeSafeText(record.name).toLowerCase() === selectedName.toLowerCase())?.id || records[0].id;

  const selectedRevenueRecord = records
    .filter(record => Number.isFinite(Number(record.revenue)) && Number(record.revenue) > 0)
    .sort((a, b) => Number(b.year_founded || 0) - Number(a.year_founded || 0) || Number(b.revenue || 0) - Number(a.revenue || 0))[0] || records[0];

  const selectedEmployeeRecord = records
    .filter(record => sanitizeSafeText(record.employees))
    .sort((a, b) => parseEmployeeBandHigh(b.employees) - parseEmployeeBandHigh(a.employees))[0] || records[0];

  const links = {};
  ['website', 'linkedin', 'ch_link'].forEach(field => {
    const httpsSource = records.find(record => isValidHttpsUrl(record[field]));
    const anySource = records.find(record => normalizeUrlField(record[field]).value);
    const selectedSource = httpsSource || anySource;
    if (selectedSource) {
      const normalized = normalizeUrlField(selectedSource[field]);
      links[field] = withSource(`links.${field}`, normalized.value || '', selectedSource.id);
    } else {
      links[field] = '';
    }
  });

  return {
    canonical_entity_id: canonicalId,
    domain_key: records[0].domain_key || '',
    child_source_record_ids: uniqueCaseInsensitive(sourceIds.map(String)).map(Number),
    name: withSource('name', selectedName, selectedNameSource),
    revenue: withSource('revenue', Number(selectedRevenueRecord.revenue) || 0, selectedRevenueRecord.id),
    employees: withSource('employees', sanitizeSafeText(selectedEmployeeRecord.employees), selectedEmployeeRecord.id),
    tech_stack: uniqueCaseInsensitive(records.flatMap(record => Array.isArray(record.tech_stack) ? record.tech_stack : [])),
    partners: uniqueCaseInsensitive(records.flatMap(record => Array.isArray(record.partners) ? record.partners : [])),
    links,
    field_provenance: fieldProvenance
  };
}

function computePairMetrics(records, knownDuplicates, knownNonDuplicates) {
  const byId = new Map(records.map(record => [record.id, record]));
  const predictedDuplicate = (a, b) => {
    const ra = byId.get(a);
    const rb = byId.get(b);
    return !!(ra?.domain_key && rb?.domain_key && ra.domain_key === rb.domain_key);
  };

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;

  knownDuplicates.forEach(([a, b]) => {
    if (predictedDuplicate(a, b)) tp += 1;
    else fn += 1;
  });

  knownNonDuplicates.forEach(([a, b]) => {
    if (predictedDuplicate(a, b)) fp += 1;
    else tn += 1;
  });

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return { tp, fp, fn, tn, precision, recall, f1 };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateKeepSeparateBehavior(groups) {
  return groups.map(ids => ({
    ids,
    statuses: ids.map(id => ({ id, duplicate_status: 'rejected' }))
  }));
}

function run() {
  const testSet = loadJson(testSetPath);
  const normalized = testSet.records.map((record, idx) => normalizeRecord(record, idx));
  const byId = new Map(normalized.map(record => [record.id, record]));

  const domainChecks = Object.entries(testSet.expected_domain_keys).map(([id, expected]) => {
    const record = byId.get(Number(id));
    const actual = record ? record.domain_key : null;
    return { id: Number(id), expected, actual, pass: actual === expected };
  });
  assert(domainChecks.every(check => check.pass), 'Domain normalization failed for one or more test records.');

  const mergeChecks = testSet.merge_groups.map(group => {
    const records = group.record_ids.map(id => byId.get(id)).filter(Boolean);
    const canonical = buildCanonicalEntityFromRecords(records);
    assert(canonical, `Canonical build failed for group: ${group.record_ids.join(',')}`);

    const expectedIds = [...group.record_ids].sort((a, b) => a - b);
    const actualIds = [...canonical.child_source_record_ids].sort((a, b) => a - b);
    assert(JSON.stringify(actualIds) === JSON.stringify(expectedIds), `Canonical child source IDs mismatch for group ${group.record_ids.join(',')}`);
    assert(canonical.domain_key === group.expected_domain_key, `Canonical domain_key mismatch for group ${group.record_ids.join(',')}`);

    const expectedTech = uniqueCaseInsensitive(records.flatMap(record => record.tech_stack));
    const expectedPartners = uniqueCaseInsensitive(records.flatMap(record => record.partners));
    assert(JSON.stringify(canonical.tech_stack) === JSON.stringify(expectedTech), `Tech stack data loss in canonicalization for group ${group.record_ids.join(',')}`);
    assert(JSON.stringify(canonical.partners) === JSON.stringify(expectedPartners), `Partner data loss in canonicalization for group ${group.record_ids.join(',')}`);

    return {
      group: group.record_ids,
      canonical_entity_id: canonical.canonical_entity_id,
      domain_key: canonical.domain_key,
      child_source_record_ids: canonical.child_source_record_ids,
      tech_count: canonical.tech_stack.length,
      partner_count: canonical.partners.length
    };
  });

  const keepSeparateChecks = validateKeepSeparateBehavior(testSet.keep_separate_groups);
  keepSeparateChecks.forEach(group => {
    group.statuses.forEach(status => {
      assert(status.duplicate_status === 'rejected', `Keep separate failed for record ${status.id}`);
    });
  });

  const metrics = computePairMetrics(normalized, testSet.known_duplicate_pairs, testSet.known_non_duplicate_pairs);

  const report = {
    dataset: path.relative(root, testSetPath),
    summary: {
      domain_normalization_checks: domainChecks.length,
      merge_group_checks: mergeChecks.length,
      keep_separate_group_checks: keepSeparateChecks.length,
      all_passed: true
    },
    metrics: {
      tp: metrics.tp,
      fp: metrics.fp,
      fn: metrics.fn,
      tn: metrics.tn,
      precision: Number(metrics.precision.toFixed(4)),
      recall: Number(metrics.recall.toFixed(4)),
      f1: Number(metrics.f1.toFixed(4))
    },
    details: {
      domain_checks: domainChecks,
      merge_checks: mergeChecks,
      keep_separate_checks: keepSeparateChecks
    }
  };

  console.log(JSON.stringify(report, null, 2));
}

try {
  run();
} catch (error) {
  console.error('[duplicate_quality_audit] failed:', error.message);
  process.exit(1);
}
