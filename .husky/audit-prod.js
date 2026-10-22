#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Pre-push security gate: fails when a production dependency has a high or critical advisory,
 * except advisories listed (with a reason and review date) in .audit-allowlist.json.
 *
 * Packages flagged only because they depend on an allow-listed package (e.g. awilix → fast-glob
 * → micromatch → braces) pass too: only the advisories themselves are judged, not the chain.
 *
 *   node .husky/audit-prod.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BLOCKING_SEVERITIES = new Set(['critical', 'high']);
const allowlistPath = path.resolve(__dirname, '../.audit-allowlist.json');
const allowlist = fs.existsSync(allowlistPath)
  ? JSON.parse(fs.readFileSync(allowlistPath, 'utf8')).advisories || []
  : [];
const allowed = new Map(allowlist.map((entry) => [entry.id, entry]));

let report;
try {
  report = execSync('npm audit --omit=dev --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch (error) {
  // npm audit exits non-zero when it finds anything; the JSON is still on stdout
  report = error.stdout;
}
if (!report) {
  console.error('❌ npm audit produced no output (offline or registry error).');
  process.exit(1);
}

const advisoryId = (url = '') => (url.match(/GHSA-[a-z0-9-]+/i) || [url])[0];
const blocking = new Map();
const suppressed = new Map();
const today = new Date().toISOString().slice(0, 10);

for (const [name, vulnerability] of Object.entries(JSON.parse(report).vulnerabilities || {})) {
  for (const via of vulnerability.via) {
    // String entries point at another vulnerable package; that package's own advisories are judged there
    if (typeof via !== 'object' || !BLOCKING_SEVERITIES.has(via.severity)) continue;
    const id = advisoryId(via.url);
    const entry = allowed.get(id);
    const target = entry && entry.reviewBy >= today ? suppressed : blocking;
    target.set(id, { name, title: via.title, severity: via.severity, url: via.url, entry });
  }
}

for (const [id, { name, entry }] of suppressed) {
  console.log(`⚠️  Allowed ${id} (${name}) until ${entry.reviewBy}: ${entry.reason}`);
}
for (const entry of allowlist) {
  if (entry.reviewBy < today) {
    console.log(`⏰ Allow-list entry ${entry.id} expired on ${entry.reviewBy} — re-review it.`);
  }
}

if (blocking.size) {
  console.error('❌ High or critical vulnerabilities in production dependencies:');
  for (const [id, { name, severity, title, url }] of blocking) {
    console.error(`   - [${severity}] ${name}: ${title} (${url || id})`);
  }
  process.exit(1);
}
console.log('✅ No unreviewed high or critical vulnerabilities in production dependencies.');
