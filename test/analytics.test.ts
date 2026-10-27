import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, deduplicate, localDay, matchesAuthor, rangeForYear, toWeeks, type RecordItem } from '../src/analytics.ts';
import { renderContributionSvg } from '../vendor/ssr-contributions-img/render-core/render.ts';
import { ChartTpl } from '../vendor/ssr-contributions-img/render-core/enums.ts';
import { chartSvg, historicalChartSvg } from '../src/charts.ts';
import { readCommitHistory } from '../src/commit-history.ts';
const record = (id: string, date: string, kind: RecordItem['kind'] = 'commit', projectId = 1): RecordItem => ({ id, date, kind, projectId, title: 'test', url: 'https://example.com' });

test('attributes commits by exact normalized author email, never by display name', () => {
  const emails = new Set(['me@example.com']);
  assert.equal(matchesAuthor({ author_email: 'ME@example.com ' }, emails), true);
  assert.equal(matchesAuthor({ author_email: 'other@example.com', author_name: 'Me' }, emails), false);
});
test('uses Montevideo date across year boundaries', () => {
  assert.equal(localDay('2026-01-01T01:30:00Z'), '2025-12-31');
  const result = aggregate([record('old', '2026-01-01T01:30:00Z'), record('new', '2026-01-01T03:30:00Z')], 2026, '2026-01-02');
  assert.equal(result.total, 1); assert.equal(result.days['2026-01-01'], 1);
});
test('deduplicates by project, kind and id while preserving distinct contributions', () => {
  const a = record('abc', '2026-01-01T12:00:00Z');
  assert.equal(deduplicate([a, a, { ...a, projectId: 2 }, { ...a, kind: 'mr' }]).length, 3);
});
test('calculates streaks, months, MR states and excludes merge diff totals', () => {
  const records = [record('1', '2026-01-01T12:00:00Z'), { ...record('2', '2026-01-02T12:00:00Z'), additions: 10, deletions: 2 }, { ...record('3', '2026-01-04T12:00:00Z'), merge: true, additions: 500 }, { ...record('4', '2026-01-04T12:00:00Z', 'mr'), state: 'merged' }];
  const result = aggregate(records, 2026, '2026-01-04');
  assert.equal(result.total, 4); assert.equal(result.activeDays, 3); assert.equal(result.longestStreak, 2); assert.equal(result.additions, 10); assert.equal(result.deletions, 2); assert.equal(result.merged, 1); assert.equal(result.months[0].count, 4);
  assert.equal(Object.values(result.days).reduce((a, b) => a + b, 0), result.total);
  assert.equal(result.weekdays.reduce((a, b) => a + b, 0), result.total);
});
test('does not include records after the cutoff, pads complete weeks and handles leap years', () => {
  const result = aggregate([record('1', '2024-02-29T12:00:00Z'), record('2', '2024-03-01T12:00:00Z')], 2024, '2024-02-29');
  assert.equal(result.total, 1); assert.equal(Object.keys(result.days).length, 60);
  const weeks = toWeeks(result.days);
  assert.ok(weeks.every(w => w.contributionDays.length === 7));
  assert.equal(weeks.reduce((a, w) => a + w.contributionDays.reduce((b, d) => b + d.contributionCount, 0), 0), 1);
});
test('year range preserves local midnight and rejects invalid input', () => {
  assert.equal(rangeForYear(2025, new Date('2026-06-01T12:00:00Z')).until, '2026-01-01T02:59:59.999Z');
  assert.throws(() => rangeForYear(2027, new Date('2026-06-01T12:00:00Z')));
  assert.throws(() => rangeForYear(NaN));
});
test('original CatsJuice renderer produces calendar and 3D SVG from GitLab counts', async () => {
  const weeks = toWeeks({ '2026-01-01': 3, '2026-01-02': 0 });
  const user = { name: 'test', contributionsCollection: { contributionCalendar: { colors: [], weeks, totalContributions: 3 } } };
  for (const chart of [ChartTpl.CALENDAR, ChartTpl.BAR3D]) {
    const svg = await renderContributionSvg(user, { chart, weeks: weeks.length, dark: true, theme: 'green', tz: 'America/Montevideo' });
    assert.match(svg, /<svg/); assert.doesNotMatch(svg, /NaN|Infinity/); assert.ok(svg.length > 500);
  }
});
test('historical calendar stays bounded to selected dates and labels months in Spanish', async () => {
  const summary = aggregate([record('past', '2024-02-29T12:00:00Z')], 2024, '2024-12-31');
  const svg = await chartSvg(summary.days, ChartTpl.CALENDAR, 'green', 'test');
  assert.match(svg, />Feb</); assert.match(svg, />Dic</); assert.doesNotMatch(svg, /NaN|Infinity/);
  const empty = await chartSvg(aggregate([], 2025).days, ChartTpl.CALENDAR, 'green', 'test');
  assert.match(empty, /<svg/);
});
test('all years combines records once, keeps separate months and crosses year boundaries for streaks', () => {
  const previous = record('old', '2025-12-31T12:00:00Z');
  const current = record('new', '2026-01-01T12:00:00Z');
  const result = aggregate([previous, previous, current], 'all', '2026-01-02');
  assert.equal(result.total, 2); assert.equal(result.startYear, 2025); assert.equal(result.endYear, 2026);
  assert.equal(result.longestStreak, 2); assert.equal(result.activeDays, 2);
  assert.deepEqual(result.years.map(y => [y.year, y.count]), [[2025, 1], [2026, 1]]);
  assert.equal(result.months.find(m => m.year === 2025 && m.month === 12)?.count, 1);
  assert.equal(result.months.find(m => m.year === 2026 && m.month === 1)?.count, 1);
  assert.equal(result.years.reduce((sum, y) => sum + y.count, 0), result.total);
});
test('historical export contains separate labeled calendars for each year', async () => {
  const data = aggregate([record('old', '2025-12-31T12:00:00Z'), record('new', '2026-01-01T12:00:00Z')], 'all', '2026-01-02');
  const svg = await historicalChartSvg(data.days, ChartTpl.CALENDAR, 'green', 'test');
  assert.match(svg, /2025 · 1 contribuciones/); assert.match(svg, /2026 · 1 contribuciones/); assert.doesNotMatch(svg, /NaN|Infinity/);
});
test('time subdivision retrieves commits despite unreliable pagination and deduplicates boundaries', async () => {
  const commits = Array.from({ length: 250 }, (_, i) => ({ id: String(i), committed_date: new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString() }));
  const result = await readCommitHistory(async (since, until) => {
    const matches = commits.filter(c => Date.parse(c.committed_date) >= Date.parse(since) && Date.parse(c.committed_date) <= Date.parse(until));
    return { data: matches.slice(0, 100), next: matches.length > 100 ? 2 : null };
  }, '2025-01-01T00:00:00Z', '2025-12-31T23:59:59Z');
  assert.equal(result.commits.length, 250); assert.equal(result.partial, false); assert.ok(result.windows > 1);
});
test('time subdivision flags partial results for excessive commits sharing one instant', async () => {
  const commits = Array.from({ length: 100 }, (_, i) => ({ id: String(i) }));
  const result = await readCommitHistory(async () => ({ data: commits, next: 2 }), '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z');
  assert.equal(result.partial, true); assert.equal(result.commits.length, 100);
});
