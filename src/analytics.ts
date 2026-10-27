export type RecordItem = { id: string; projectId: number; kind: 'commit' | 'mr' | 'issue' | 'comment'; title: string; date: string; url: string; state?: string; additions?: number; deletions?: number; merge?: boolean; mergedAt?: string; labels?: string[] };
export const timezone = 'America/Montevideo';
export type Period = number | 'all';
export function localDay(date: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
}
export function rangeForYear(year: number, now = new Date()) {
  if (!Number.isInteger(year) || year < 2000 || year > Number(localDay(now.toISOString()).slice(0, 4))) throw new Error('Año inválido.');
  return { since: `${year}-01-01T00:00:00-03:00`, until: new Date(Math.min(Date.parse(`${year + 1}-01-01T00:00:00-03:00`) - 1, now.getTime())).toISOString() };
}
export function rangeForPeriod(period: Period, now = new Date()) {
  return period === 'all' ? { since: '2000-01-01T00:00:00-03:00', until: now.toISOString() } : rangeForYear(period, now);
}
export function matchesAuthor(commit: any, emails: Set<string>) {
  return emails.has(String(commit.author_email || '').trim().toLowerCase());
}
export function deduplicate(items: RecordItem[]) {
  return [...new Map(items.map(x => [`${x.kind}:${x.projectId}:${x.id}`, x])).values()];
}
export function aggregate(items: RecordItem[], year: Period, endDay = year === 'all' ? localDay(new Date().toISOString()) : `${year}-12-31`) {
  const records = deduplicate(items).filter(x => (year === 'all' ? localDay(x.date) >= '2000-01-01' : localDay(x.date).startsWith(`${year}-`)) && localDay(x.date) <= endDay);
  const startYear = year === 'all' ? records.reduce((first, r) => Math.min(first, Number(localDay(r.date).slice(0, 4))), Number(endDay.slice(0, 4))) : year;
  const endYear = year === 'all' ? Number(endDay.slice(0, 4)) : year;
  const days: Record<string, number> = {};
  for (let t = Date.parse(`${startYear}-01-01T12:00:00Z`); t <= Date.parse(`${endDay}T12:00:00Z`); t += 86400000) days[new Date(t).toISOString().slice(0, 10)] = 0;
  const months = Array.from({ length: (endYear - startYear + 1) * 12 }, (_, i) => ({ year: startYear + Math.floor(i / 12), month: i % 12 + 1, count: 0, commits: 0, mrs: 0, issues: 0, comments: 0 }));
  const years = Array.from({ length: endYear - startYear + 1 }, (_, i) => ({ year: startYear + i, count: 0, commits: 0, mrs: 0, issues: 0, comments: 0 }));
  const weekdays = Array.from({ length: 7 }, () => 0);
  for (const record of records) {
    const day = localDay(record.date); days[day] = (days[day] || 0) + 1;
    const yearIndex = Number(day.slice(0, 4)) - startYear;
    const month = months[yearIndex * 12 + Number(day.slice(5, 7)) - 1]; month.count++;
    const field = ({ commit: 'commits', mr: 'mrs', issue: 'issues', comment: 'comments' } as const)[record.kind]; month[field]++;
    years[yearIndex].count++; years[yearIndex][field]++;
    weekdays[new Date(`${day}T12:00:00Z`).getUTCDay()]++;
  }
  const counts = { commits: 0, mrs: 0, issues: 0, comments: 0, additions: 0, deletions: 0, merged: 0, open: 0 };
  for (const r of records) {
    if (r.kind === 'commit') { counts.commits++; if (!r.merge) { counts.additions += r.additions || 0; counts.deletions += r.deletions || 0; } }
    if (r.kind === 'mr') { counts.mrs++; if (r.state === 'merged') counts.merged++; if (r.state === 'opened') counts.open++; }
    if (r.kind === 'issue') counts.issues++;
    if (r.kind === 'comment') counts.comments++;
  }
  let longestStreak = 0, streak = 0;
  for (const count of Object.values(days)) { streak = count ? streak + 1 : 0; longestStreak = Math.max(streak, longestStreak); }
  const activeDays = Object.values(days).filter(Boolean).length;
  const peak = Object.entries(days).sort((a, b) => b[1] - a[1])[0];
  return { total: records.length, ...counts, activeDays, longestStreak, days, months, years, startYear, endYear, weekdays, peak: peak?.[1] ? { date: peak[0], count: peak[1] } : null };
}
export function toWeeks(days: Record<string, number>) {
  const dates = Object.keys(days).sort(); if (!dates.length) return [];
  const start = new Date(`${dates[0]}T12:00:00Z`); start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = Date.parse(`${dates.at(-1)}T12:00:00Z`);
  const weeks = [];
  for (let t = start.getTime(); t <= end; t += 7 * 86400000) {
    const contributionDays = Array.from({ length: 7 }, (_, weekday) => {
      const date = new Date(t + weekday * 86400000).toISOString().slice(0, 10);
      return { date, weekday, contributionCount: days[date] || 0 };
    });
    weeks.push({ firstDay: contributionDays[0].date, contributionDays });
  }
  return weeks;
}
export function projectAnalysis(project: any, records: RecordItem[], year: Period, endDay: string, commitsAvailable = true) {
  const summary = aggregate(records, year, endDay);
  const activeMonths = summary.months.filter(x => x.count);
  const topMonth = [...activeMonths].sort((a, b) => b.count - a.count)[0];
  const themes: Record<string, number> = {};
  for (const record of records.filter(x => x.kind === 'commit')) {
    const text = record.title.toLowerCase();
    const category = /\b(fix|bug|corrige|correg|error|arregl)/.test(text) ? 'Correcciones' : /\b(feat|add|agreg|implement|nuevo|nueva)/.test(text) ? 'Funcionalidades' : /\b(refactor|cleanup|limpieza)/.test(text) ? 'Refactorización' : /\b(doc|readme)/.test(text) ? 'Documentación' : /\b(test|prueba)/.test(text) ? 'Pruebas' : 'Otros cambios';
    themes[category] = (themes[category] || 0) + 1;
  }
  const observations = [
    `${summary.total} contribuciones registradas en ${summary.activeDays} días y ${activeMonths.length} meses.`,
    !commitsAvailable ? 'GitLab no expone un correo de autor para este perfil; no se pudieron atribuir commits.' : summary.commits ? `${summary.commits} commits propios encontrados en todas las ramas, identificados por correo de autor.` : 'No se encontraron commits vinculados a tus correos de autor en este período.',
    summary.mrs ? `${summary.merged} de ${summary.mrs} merge requests creadas en el período están integradas; ${summary.open} siguen abiertas. El estado es el actual.` : 'No se encontraron merge requests creadas por ti en este período.',
    topMonth ? `El mes con mayor actividad fue ${new Intl.DateTimeFormat('es-UY', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(topMonth.year, topMonth.month - 1, 1)))}${year === 'all' ? ` de ${topMonth.year}` : ''}: ${topMonth.count} contribuciones.` : 'No hay actividad registrada para comparar meses.',
  ];
  return { ...project, summary, themes, observations, records: records.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)) };
}
