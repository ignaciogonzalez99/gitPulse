import { connectMcp } from './mcp.ts';
import { loadConfig } from './config.ts';
import { readCommitHistory } from './commit-history.ts';
import { commitEmails } from './users.ts';
import { SnapshotStore } from './snapshot-store.ts';
import { aggregate, localDay, matchesAuthor, projectAnalysis, rangeForPeriod, deduplicate, type RecordItem, type Period } from './analytics.ts';

export type SyncStatus = { state: 'idle' | 'syncing' | 'done' | 'error'; completed: number; total: number; message: string; year?: Period; userId?: number; username?: string };
export const status: SyncStatus = { state: 'idle', completed: 0, total: 0, message: 'Listo para conectar' };
const snapshots = new SnapshotStore();
let job: Promise<void> | null = null;
export async function getSnapshot(year: Period, userId: number) {
  return snapshots.get(year, userId);
}
export function startSync(year: Period, userId: number) {
  rangeForPeriod(year);
  if (job) return false;
  Object.assign(status, { state: 'syncing', completed: 0, total: 1, year, userId, username: undefined, message: 'Conectando con tu MCP de GitLab…' });
  job = synchronize(year, userId).catch((error) => {
    status.state = 'error'; status.message = error instanceof Error && /credenciales/.test(error.message) ? error.message : 'No se pudo actualizar. Comprueba la conexión a GitLab, el MCP y sus permisos. La última lectura se conserva.';
  }).finally(() => { job = null; });
  return true;
}
async function synchronize(year: Period, userId: number) {
  const config = await loadConfig();
  const mcp = await connectMcp(config);
  const warnings: string[] = [];
  const range = rangeForPeriod(year);
  const endDay = localDay(range.until);
  try {
    const authenticated = await mcp.call('gitlab_get_current_user');
    const user = userId === authenticated.id ? authenticated : await mcp.call('gitlab_dashboard_user', { userId });
    status.username = user.username;
    const emails = commitEmails(user, authenticated.id, config.emails);
    if (!emails.size) warnings.push(`GitLab no expone un correo de autor para @${user.username}. Los commits no se pueden atribuir de forma fiable y se muestran como no disponibles. Las otras actividades se filtran por su ID de usuario.`);
    async function pages(kind: string, projectId?: number, author?: string) {
      const data: any[] = []; let page: number | null = 1;
      while (page) {
        const result: any = await mcp.call('gitlab_activity_page', { kind, userId: user.id, projectId, ...range, page, author });
        if (!Array.isArray(result.data)) return result.data;
        data.push(...result.data);
        if (status.total === 1) status.message = `Leyendo ${kind === 'events' ? 'eventos' : kind === 'issues' ? 'issues' : kind === 'merge_requests' ? 'merge requests' : 'proyectos'} · ${data.length} registros recibidos`;
        if (page >= 500 && result.next) { warnings.push(`Se alcanzó el límite de 50.000 registros en ${kind}${projectId ? ` del proyecto ${projectId}` : ''}. Los resultados son parciales.`); break; }
        page = result.next || null;
      }
      return data;
    }
    async function optional(kind: string) {
      try { return await pages(kind); } catch { warnings.push(`No fue posible consultar ${kind}. Las métricas de esa fuente son parciales.`); return []; }
    }
    status.message = 'Leyendo proyectos, merge requests, issues y eventos…';
    const [memberProjects, contributedProjects, mrs, issues, events] = await Promise.all([pages('projects'), optional('contributed'), optional('merge_requests'), optional('issues'), optional('events')]);
    const projectMap = new Map<number, any>();
    const pickProject = (p: any) => ({ id: p.id, name: p.name, path: p.path_with_namespace, url: p.web_url, description: p.description || '', archived: Boolean(p.archived), defaultBranch: p.default_branch });
    for (const p of [...memberProjects, ...contributedProjects]) projectMap.set(p.id, pickProject(p));
    const discoveredIds = new Set<number>([...mrs, ...issues, ...events].map(x => x.project_id).filter(Boolean));
    for (const id of discoveredIds) if (!projectMap.has(id)) {
      try { projectMap.set(id, pickProject(await pages('project', id))); }
      catch { warnings.push(`El proyecto ${id} registra actividad pero ya no es accesible.`); }
    }
    const records: RecordItem[] = [];
    for (const mr of mrs) if (mr.author?.id === user.id) records.push({ id: String(mr.id), projectId: mr.project_id, kind: 'mr', title: mr.title, date: mr.created_at, url: mr.web_url, state: mr.state, mergedAt: mr.merged_at, labels: mr.labels });
    for (const issue of issues) if (issue.author?.id === user.id) records.push({ id: String(issue.id), projectId: issue.project_id, kind: 'issue', title: issue.title, date: issue.created_at, url: issue.web_url, state: issue.state, labels: issue.labels });
    for (const event of events) if (event.author_id === user.id && event.target_type === 'Note' && event.note && !event.note.system) {
      const p = projectMap.get(event.project_id);
      records.push({ id: String(event.note.id || event.id), projectId: event.project_id, kind: 'comment', title: String(event.note.body || 'Comentario').slice(0, 240), date: event.created_at, url: event.note.noteable_iid && p ? `${p.url}/-/${event.note.noteable_type === 'MergeRequest' ? 'merge_requests' : 'issues'}/${event.note.noteable_iid}#note_${event.note.id}` : p?.url || user.web_url });
    }
    const projects = [...projectMap.values()];
    status.total = projects.length; status.completed = 0;
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, projects.length) }, async () => {
      while (cursor < projects.length) {
        const p = projects[cursor++];
        status.message = `Leyendo contribuciones · ${p.name}`;
        try {
          if (p.defaultBranch && emails.size) {
            const histories = await Promise.all([...emails].map(email => readCommitHistory(
              (since, until) => mcp.call('gitlab_activity_page', { kind: 'commits', userId: user.id, projectId: p.id, since, until, page: 1, author: email }),
              range.since, range.until,
            )));
            if (histories.some(history => history.partial)) warnings.push(`${p.name}: la lectura de commits alcanzó un límite de intervalos o de registros con la misma fecha. Los resultados son parciales.`);
            const commits = histories.flatMap(history => history.commits);
            let ambiguous = 0;
            for (const c of commits) {
              if (!matchesAuthor(c, emails)) { if (c.author_name?.toLowerCase() === user.name?.toLowerCase()) ambiguous++; continue; }
              records.push({ id: c.id, projectId: p.id, kind: 'commit', title: c.title, date: c.committed_date || c.created_at, url: c.web_url, additions: c.stats?.additions || 0, deletions: c.stats?.deletions || 0, merge: c.parent_ids?.length > 1 });
            }
            if (ambiguous) warnings.push(`${p.name}: ${ambiguous} commits con tu nombre y otro correo quedaron sin atribuir. Puedes agregar correos verificados en COMMIT_EMAILS.`);
          }
        } catch { warnings.push(`No se pudieron leer los commits de ${p.name}.`); }
        status.completed++;
      }
    }));
    const cleanRecords = deduplicate(records).filter(x => projectMap.has(x.projectId) && (year === 'all' ? localDay(x.date) >= '2000-01-01' : localDay(x.date).startsWith(`${year}-`)) && localDay(x.date) <= endDay);
    const projectResults = projects.map(p => projectAnalysis(p, cleanRecords.filter(x => x.projectId === p.id), year, endDay, emails.size > 0)).filter(p => p.summary.total > 0).sort((a, b) => b.summary.total - a.summary.total);
    const snapshot = {
      version: 1, year, endDay, updatedAt: new Date().toISOString(),
      user: { id: user.id, username: user.username, name: user.name, url: user.web_url },
      summary: aggregate(cleanRecords, year, endDay), projects: projectResults,
      coverage: { scannedProjects: projects.length, contributedProjects: projectResults.length, warnings, sources: [...(emails.size ? ['Commits en todas las ramas'] : []), 'Merge requests creadas', 'Issues creados', 'Comentarios disponibles en eventos'],
        commitsAvailable: emails.size > 0,
        methodology: 'Una contribución es un commit de autor verificado por correo, una merge request creada, un issue creado o un comentario no automático. MR, issues y comentarios se atribuyen por el ID del usuario seleccionado. Los commits usan únicamente sus correos visibles; si GitLab los oculta, esa métrica no está disponible. COMMIT_EMAILS solo se aplica al usuario autenticado. Se cuentan por fecha de commit o creación, en America/Montevideo. Los pushes no se suman para evitar duplicar commits. Los cambios de líneas excluyen commits de merge. Los estados de MR e issues son actuales. Los proyectos consultados incluyen tus membresías accesibles y los proyectos descubiertos por contribuciones recientes, eventos, MR e issues del usuario seleccionado. Repositorios sin acceso y proyectos históricos no descubiertos pueden faltar. GitLab conserva eventos por un tiempo limitado (normalmente tres años); las métricas no equivalen al calendario nativo de GitLab ni miden productividad o calidad.' },
    };
    await snapshots.save(snapshot);
    if (year === 'all') {
      // Reuse the complete read for annual filters, without additional GitLab requests.
      for (const annual of snapshot.summary.years) {
        const annualEnd = annual.year === Number(endDay.slice(0, 4)) ? endDay : `${annual.year}-12-31`;
        const annualRecords = cleanRecords.filter(x => localDay(x.date).startsWith(`${annual.year}-`));
        const annualProjects = projects.map(p => projectAnalysis(p, annualRecords.filter(x => x.projectId === p.id), annual.year, annualEnd, emails.size > 0)).filter(p => p.summary.total > 0).sort((a, b) => b.summary.total - a.summary.total);
        const annualSnapshot = { ...snapshot, year: annual.year, endDay: annualEnd, summary: aggregate(annualRecords, annual.year, annualEnd), projects: annualProjects, coverage: { ...snapshot.coverage, contributedProjects: annualProjects.length } };
        await snapshots.save(annualSnapshot);
      }
    }
    Object.assign(status, { state: 'done', message: 'Actividad actualizada', completed: projects.length });
  } finally { await mcp.close(); }
}
