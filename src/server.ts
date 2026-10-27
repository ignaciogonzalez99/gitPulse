import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from './config.ts';
import { getSnapshot, startSync, status } from './data.ts';
import { aggregate, localDay, rangeForPeriod, rangeForYear, type Period } from './analytics.ts';
import { chartSvg, historicalChartSvg } from './charts.ts';
import { ChartTpl } from '../vendor/ssr-contributions-img/render-core/enums.ts';
import { themes } from '../vendor/ssr-contributions-img/render-core/theme.ts';
import { currentUser, parseUserId, publicUser, searchUsers } from './users.ts';

let configError = '';
let port = Number(process.env.PORT || 4173);
try { port = (await loadConfig()).port; } catch (error: any) { configError = error.message; }
const currentYear = () => Number(localDay(new Date().toISOString()).slice(0, 4));
const assets: Record<string, [string, string]> = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  const respond = (code: number, data: any) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(req.headers.host || '')) return respond(403, { error: 'Host no permitido' });
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) return respond(403, { error: 'Origen no permitido' });
  try {
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const year: Period = url.searchParams.get('year') === 'all' ? 'all' : Number(url.searchParams.get('year') || currentYear());
    if (url.pathname.startsWith('/api/')) rangeForPeriod(year);
    if (url.pathname === '/api/status' && req.method === 'GET') return respond(200, { ...status, configError });
    if (url.pathname === '/api/palettes' && req.method === 'GET') return respond(200, Object.fromEntries(['green', 'blue', 'purple', 'sunset', 'cyan', 'amber_forge'].map(name => [name, themes[name as keyof typeof themes].dark])));
    if (url.pathname === '/api/me' && req.method === 'GET') return respond(200, publicUser(await currentUser()));
    if (url.pathname === '/api/users' && req.method === 'GET') return respond(200, await searchUsers(url.searchParams.get('search') || ''));
    if (['/api/sync', '/api/dashboard', '/api/chart.svg'].includes(url.pathname) && configError) return respond(503, { error: configError });
    const requestedUserId = parseUserId(url.searchParams.get('user'));
    const targetId = async () => requestedUserId ?? (await currentUser()).id;
    if (url.pathname === '/api/sync' && req.method === 'POST') {
      if (configError) return respond(503, { error: configError });
      const started = startSync(year, await targetId()); return respond(started ? 202 : 409, { started, ...status, ...(!started ? { error: 'Hay una lectura en curso. La actividad seleccionada se consultará cuando termine.' } : {}) });
    }
    if (url.pathname === '/api/dashboard' && req.method === 'GET') {
      const snapshot = await getSnapshot(year, await targetId());
      if (!snapshot) return respond(202, { pending: true, configError, ...status });
      return respond(200, snapshot);
    }
    if (url.pathname === '/api/chart.svg' && req.method === 'GET') {
      const snapshot = await getSnapshot(year, await targetId());
      if (!snapshot) return respond(409, { error: 'Primero actualiza tu actividad.' });
      const id = url.searchParams.get('project');
      const selected = id ? snapshot.projects.find((x: any) => x.id === Number(id)) : snapshot;
      if (!selected) return respond(404, { error: 'Proyecto no encontrado' });
      const chart = url.searchParams.get('chart') === '3dbar' ? ChartTpl.BAR3D : ChartTpl.CALENDAR;
      const theme = ['green', 'blue', 'purple', 'sunset', 'cyan', 'amber_forge'].includes(url.searchParams.get('theme') || '') ? url.searchParams.get('theme')! : 'green';
      const slice = url.searchParams.get('slice');
      let svg: string;
      if (year === 'all' && slice) {
        const sliceYear = Number(slice); rangeForYear(sliceYear);
        const days = aggregate(selected.records || snapshot.projects.flatMap((p: any) => p.records), sliceYear, sliceYear === currentYear() ? snapshot.endDay : `${sliceYear}-12-31`).days;
        svg = await chartSvg(days, chart, theme, snapshot.user.username);
      } else svg = year === 'all' ? await historicalChartSvg(selected.summary.days, chart, theme, snapshot.user.username) : await chartSvg(selected.summary.days, chart, theme, snapshot.user.username);
      res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', ...(url.searchParams.has('download') ? { 'Content-Disposition': `attachment; filename="gitlab-${year}-${chart}.svg"` } : {}) }); res.end(svg); return;
    }
    if (assets[url.pathname] && req.method === 'GET') {
      const [filename, type] = assets[url.pathname]; const body = await readFile(resolve('public', filename));
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(body); return;
    }
    respond(404, { error: 'Ruta no encontrada' });
  } catch (error: any) { const invalid = /Año inválido|Usuario inválido|Escribe entre/.test(error.message); respond(invalid ? 400 : 500, { error: invalid ? error.message : 'No se pudo completar la solicitud. Comprueba la conexión a GitLab y los permisos del perfil.' }); }
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Git Pulse · http://localhost:${port}`);
});
process.on('SIGINT', () => { server.close(); process.exit(0); });
