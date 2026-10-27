const $ = (id) => document.getElementById(id);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const number = (value) => new Intl.NumberFormat('es-UY').format(value || 0);
const date = (value) => new Intl.DateTimeFormat('es-UY', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Montevideo' }).format(new Date(value));
const safeUrl = (value) => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? escape(url.href) : '#'; } catch { return '#'; } };
const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
let snapshot = null, view = 'calendar', loading = false, polling = null, requestVersion = 0, connectionLost = false;
let palettes = {};
let authenticatedUser = null, viewingUser = null, selectedUserId = '', userSearchVersion = 0, userMatches = [], pollRunning = false;
const userQuery = () => selectedUserId ? { user: selectedUserId } : {};
const periodQuery = () => new URLSearchParams({ year: $('year').value, ...userQuery() });
const mineSelected = () => !selectedUserId || Number(selectedUserId) === authenticatedUser?.id;
const currentYear = Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'America/Montevideo' }).format(new Date()));
$('year').add(new Option('Todos los años', 'all'));
for (let year = currentYear; year >= 2000; year--) $('year').add(new Option(String(year), String(year)));
$('year').value = String(currentYear);
const periodLabel = () => snapshot?.year === 'all' ? `${summary().startYear}–${summary().endYear} · Todos los años` : String(snapshot?.year || $('year').value);
const selectedProject = () => snapshot?.projects.find(p => p.id === Number($('project').value));
const summary = () => selectedProject()?.summary || snapshot?.summary;
const chartUrl = (download = false) => '/api/chart.svg?' + new URLSearchParams({ year: $('year').value, ...userQuery(), chart: view === 'monthly' ? 'calendar' : view, theme: $('theme').value, ...( $('project').value ? { project: $('project').value } : {}), v: snapshot?.updatedAt || '', ...(download ? { download: '1' } : {}) });
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; setTimeout(() => $('toast').hidden = true, 4500); }
function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function api(path, options = {}) {
  const response = await fetch(path, options); const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la consulta.'); return data;
}
function error(message) { $('error-banner').textContent = message; $('error-banner').hidden = false; }
function setEmpty(message) {
  snapshot = null;
  for (const id of ['total', 'commits', 'mrs', 'days', 'nav-count', 'project-count']) $(id).textContent = '—';
  $('chart-area').innerHTML = `<div class="empty-state"><span class="empty-icon">⑂</span><strong>${escape(message)}</strong><p>Usa Actualizar actividad para consultar este período.</p></div>`;
  $('project-rows').innerHTML = '<tr><td colspan="7" class="table-empty">Todavía no hay una lectura para este período.</td></tr>';
  $('weekdays').innerHTML = ''; $('insights').innerHTML = ''; $('project').innerHTML = '<option value="">Todos los proyectos</option>';
  $('updated').textContent = 'Sin lectura para este período'; $('coverage').textContent = 'Contribuciones vinculadas a tu usuario de GitLab'; $('chart-summary').textContent = 'Datos reales · America/Montevideo';
  $('period-label').textContent = $('year').value === 'all' ? 'Todos los años · Consultando el historial disponible en GitLab' : `${$('year').value} · Consultando el período seleccionado`;
  $('mr-caption').textContent = 'Creadas por tu usuario'; $('streak-caption').textContent = 'Constancia a lo largo del período'; $('rhythm-caption').textContent = 'Descubre cómo se distribuyen tus contribuciones.';
  $('chart-title').textContent = $('year').value === 'all' ? 'Toda tu trayectoria, año a año' : 'Un año de trabajo, a simple vista';
  document.querySelector('[data-view="monthly"]').textContent = $('year').value === 'all' ? '▤ Comparación anual' : '▤ Tendencia mensual';
  $('export-svg').disabled = true; $('export-png').disabled = true;
}
async function loadDashboard(autoSync = false) {
  const revision = ++requestVersion; const year = $('year').value;
  try {
    const data = await api(`/api/dashboard?${periodQuery()}`);
    if (revision !== requestVersion) return;
    if (data.pending) {
      setEmpty('Este período aún no está sincronizado');
      if (data.configError) error(data.configError);
      else if (autoSync && data.state !== 'syncing') await sync();
      return;
    }
    snapshot = data;
    viewingUser = data.user;
    renderUserContext();
    const previous = $('project').value;
    $('project').innerHTML = '<option value="">Todos los proyectos</option>' + snapshot.projects.map(p => `<option value="${p.id}">${escape(p.name)} · ${escape(p.path)}</option>`).join('');
    if (snapshot.projects.some(p => String(p.id) === previous)) $('project').value = previous;
    $('updated').textContent = `Lectura: ${date(snapshot.updatedAt)}`;
    $('period-label').textContent = snapshot.year === 'all' ? `@${snapshot.user.username} · ${snapshot.summary.startYear}–${snapshot.summary.endYear} · Historial disponible en GitLab` : `@${snapshot.user.username} · 1 ene — ${date(`${snapshot.endDay}T12:00:00Z`)} · GitLab`;
    $('nav-count').textContent = number(snapshot.projects.length);
    $('coverage').textContent = `${snapshot.coverage.scannedProjects} proyectos consultados · ${snapshot.projects.length} con contribuciones${snapshot.coverage.warnings.length ? ' · Lectura parcial: ver cómo se calcula' : ''}`;
    $('export-svg').disabled = false; $('export-png').disabled = false;
    render();
  } catch (e) { if (revision === requestVersion) error(e.message); }
}
function render() {
  if (!snapshot) return;
  const s = summary();
  $('total').textContent = number(s.total); $('commits').textContent = snapshot.coverage.commitsAvailable === false ? 'N/D' : number(s.commits); $('mrs').textContent = number(s.mrs); $('days').textContent = number(s.activeDays);
  $('commit-caption').textContent = snapshot.coverage.commitsAvailable === false ? 'GitLab no expone su correo de autor' : 'Autor verificado · todas las ramas';
  $('mr-caption').textContent = `${number(s.merged)} integradas · ${number(s.open)} abiertas`;
  $('streak-caption').textContent = `Racha máxima: ${number(s.longestStreak)} días`;
  $('chart-summary').textContent = `${number(s.total)} contribuciones en ${number(s.activeDays)} días · ${periodLabel()}`;
  $('chart-title').textContent = snapshot.year === 'all' ? 'Toda tu trayectoria, año a año' : 'Un año de trabajo, a simple vista';
  document.querySelector('[data-view="monthly"]').textContent = snapshot.year === 'all' ? '▤ Comparación anual' : '▤ Tendencia mensual';
  renderChart(); renderWeekdays(); renderInsights(); renderProjects();
}
function renderChart() {
  if (!snapshot) return;
  const s = summary(); const area = $('chart-area'); area.classList.toggle('three-d', view === '3dbar');
  if (!s.total) { area.innerHTML = '<div class="empty-state"><strong>No hay contribuciones registradas</strong><p>Revisa el período seleccionado y la cobertura de fuentes.</p></div>'; return; }
  if (view === 'monthly') {
    const periods = snapshot.year === 'all' ? s.years.map(y => ({ ...y, label: String(y.year) })) : s.months.map(m => ({ ...m, label: months[m.month - 1] }));
    const max = Math.max(...periods.map(m => m.count), 1);
    area.innerHTML = '<div class="monthly-chart" role="img" aria-label="' + escape(periods.map(m => `${m.label}: ${m.count}`).join(', ')) + '">' + periods.map(m => `<div class="monthly-col" title="${m.label}: ${number(m.count)} contribuciones"><strong>${number(m.count)}</strong><div class="monthly-bar" style="height:${m.count / max * 150}px"></div><span>${m.label}</span></div>`).join('') + '</div>';
  } else if (snapshot.year === 'all') {
    const history = document.createElement('div'); history.className = 'historical-charts';
    for (const annual of [...s.years].reverse()) {
      const section = document.createElement('section'); section.className = 'historical-year';
      const heading = document.createElement('h3'); heading.textContent = `${annual.year} · ${number(annual.count)} contribuciones`;
      const container = document.createElement('div'); container.className = 'annual-image';
      const img = new Image(); img.loading = 'lazy'; img.alt = `${view === '3dbar' ? 'Barras 3D' : 'Calendario'} de ${annual.count} contribuciones en ${annual.year}`; img.src = `${chartUrl()}&slice=${annual.year}`;
      container.append(img); section.append(heading, container); history.append(section);
    }
    area.replaceChildren(history);
  } else {
    const img = new Image(); img.alt = `${view === '3dbar' ? 'Barras 3D' : 'Calendario'} de ${s.total} contribuciones en ${s.activeDays} días para ${selectedProject()?.name || snapshot.user.name}, ${snapshot.year}`;
    img.src = chartUrl(); img.addEventListener('error', () => { if (img.isConnected) error('No se pudo generar el gráfico. Intenta actualizar la actividad.'); }); area.replaceChildren(img);
  }
  document.querySelector('.legend').hidden = view === 'monthly';
  if (palettes[$('theme').value]) document.querySelectorAll('.legend i').forEach((cell, i) => cell.style.backgroundColor = palettes[$('theme').value][i]);
  $('export-svg').textContent = view === 'monthly' ? '↓ Calendario SVG' : '↓ SVG';
  $('export-png').textContent = view === 'monthly' ? '↓ Calendario PNG' : '↓ PNG';
}
function renderWeekdays() {
  const s = summary(), order = [1, 2, 3, 4, 5, 6, 0], names = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']; const max = Math.max(...s.weekdays, 1);
  $('weekdays').innerHTML = order.map(i => `<div class="weekday ${s.weekdays[i] === max ? 'peak' : ''}" title="${names[i]}: ${number(s.weekdays[i])} contribuciones"><strong>${number(s.weekdays[i])}</strong><div class="weekday-bar" style="height:${s.weekdays[i] / max * 80}px"></div><span>${names[i]}</span></div>`).join('');
  $('rhythm-caption').textContent = s.peak ? `Día más activo: ${date(`${s.peak.date}T12:00:00Z`)} · ${number(s.peak.count)} contribuciones` : 'Sin actividad para este período.';
}
function renderInsights() {
  const s = summary(), project = selectedProject(); const lead = project || snapshot.projects[0]; const activeMonth = [...s.months].sort((a, b) => b.count - a.count)[0];
  const insights = [
    { icon: '↗', title: project ? `${number(s.total)} contribuciones en ${project.name}` : lead ? `${lead.name} concentra el ${Math.round(lead.summary.total / Math.max(s.total, 1) * 100)} %` : 'Sin actividad registrada', body: project ? 'El detalle distingue código, propuestas de integración, issues y comentarios.' : lead ? `${number(lead.summary.total)} contribuciones de las ${number(s.total)} registradas en tus proyectos.` : 'Actualiza otro período para explorar tus proyectos.' },
    { icon: '◷', title: `${number(s.longestStreak)} días consecutivos con actividad`, body: activeMonth?.count ? `${months[activeMonth.month - 1]}${snapshot.year === 'all' ? ` ${activeMonth.year}` : ''} fue tu mes más activo, con ${number(activeMonth.count)} contribuciones.` : 'No hay suficiente actividad para comparar meses.' },
    { icon: '⇄', title: snapshot.coverage.commitsAvailable === false ? 'Líneas modificadas: no disponibles' : `${number(s.additions)} líneas añadidas · ${number(s.deletions)} eliminadas`, body: `${number(s.issues)} issues creados y ${number(s.comments)} comentarios. ${snapshot.coverage.commitsAvailable === false ? 'GitLab no expone el correo necesario para atribuir commits.' : 'Las líneas excluyen commits de merge.'}` },
  ];
  $('insights').innerHTML = insights.map(i => `<div class="insight"><span class="insight-icon">${i.icon}</span><p><strong>${escape(i.title)}</strong>${escape(i.body)}</p></div>`).join('');
}
function renderProjects() {
  if (!snapshot) return;
  const query = $('search').value.trim().toLowerCase();
  let projects = snapshot.projects.filter(p => `${p.name} ${p.path}`.toLowerCase().includes(query) && (!$('project').value || String(p.id) === $('project').value));
  projects = [...projects].sort($('sort').value === 'name' ? (a, b) => a.name.localeCompare(b.name) : $('sort').value === 'commits' ? (a, b) => b.summary.commits - a.summary.commits : (a, b) => b.summary.total - a.summary.total);
  $('project-count').textContent = number(projects.length);
  $('project-rows').innerHTML = projects.length ? projects.map(p => {
    const share = p.summary.total / Math.max(snapshot.summary.total, 1) * 100;
    const shareLabel = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 1 }).format(share);
    return `<tr><td><div class="project-cell"><span class="project-symbol">⑂</span><div><a href="${safeUrl(p.url)}" target="_blank" rel="noopener noreferrer" class="project-name">${escape(p.name)}${p.archived ? ' · Archivado' : ''}</a><span class="project-path" title="${escape(p.path)}">${escape(p.path)}</span></div></div></td><td>${number(p.summary.total)}</td><td>${snapshot.coverage.commitsAvailable === false ? 'N/D' : number(p.summary.commits)}</td><td>${number(p.summary.mrs)}</td><td>${number(p.summary.issues)}</td><td class="share-cell">${shareLabel} %<div class="share-bar" aria-hidden="true"><div style="width:${share}%"></div></div></td><td><button class="analyze-button" data-analyze="${p.id}" aria-label="Analizar ${escape(p.name)}">Ver análisis ↗</button></td></tr>`;
  }).join('') : '<tr><td colspan="7" class="table-empty">No hay proyectos que coincidan con esta selección.</td></tr>';
}
function showProject(id) {
  const p = snapshot?.projects.find(p => p.id === id); if (!p) return;
  const kinds = { commit: 'COMMIT', mr: 'MR', issue: 'ISSUE', comment: 'NOTA' }, states = { merged: 'Integrada', opened: 'Abierta', closed: 'Cerrada' };
  $('detail-content').innerHTML = `<h2 class="detail-title">${escape(p.name)}</h2><a class="detail-path" href="${safeUrl(p.url)}" target="_blank" rel="noopener noreferrer">${escape(p.path)} ↗</a><div class="detail-stats">${[['total', 'Contribuciones'], ['commits', 'Commits'], ['mrs', 'Merge requests'], ['activeDays', 'Días activos']].map(([key, label]) => `<div><strong>${key === 'commits' && snapshot.coverage.commitsAvailable === false ? 'N/D' : number(p.summary[key])}</strong><span>${label}</span></div>`).join('')}</div><h3 class="detail-subheading">Análisis de tu participación</h3><ul class="observations">${p.observations.map(x => `<li>${escape(x)}</li>`).join('')}</ul><h3 class="detail-subheading">Temas de tus commits</h3><div class="theme-chips">${Object.entries(p.themes).map(([key, count]) => `<span class="theme-chip">${escape(key)} · ${number(count)}</span>`).join('') || '<span class="report-note">Sin commits atribuibles.</span>'}</div><p class="report-note">Clasificación orientativa por palabras en los títulos. El volumen de actividad no mide calidad ni productividad.</p><div class="report-actions"><button id="report-md" class="button primary">↓ Informe Markdown</button><button id="report-json" class="button">↓ Datos JSON</button></div><h3 class="detail-subheading">Contribuciones recientes</h3>${p.records.slice(0, 40).map(r => `<div class="record"><span class="record-kind">${kinds[r.kind]}</span><div><a class="record-title" href="${safeUrl(r.url)}" target="_blank" rel="noopener noreferrer">${escape(r.title)}</a><div class="record-meta">${date(r.date)}${r.state ? ' · ' + escape(states[r.state] || r.state) : ''}${r.kind === 'commit' ? ` · +${number(r.additions)} / −${number(r.deletions)}${r.merge ? ' · Merge: líneas excluidas del total' : ''}` : ''}</div></div></div>`).join('')}<p class="report-note">Se muestran hasta 40 registros. El informe y JSON incluyen el período completo.</p>`;
  $('detail-dialog').showModal();
  $('report-md').addEventListener('click', () => exportReport(p));
  $('report-json').addEventListener('click', () => download(JSON.stringify({ year: snapshot.year, updatedAt: snapshot.updatedAt, project: p, coverage: snapshot.coverage }, null, 2), `gitlab-${p.id}-${snapshot.year}.json`, 'application/json'));
}
function exportReport(p) {
  const plain = value => String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/[\[\]`*<>]/g, '');
  const lines = [`# ${plain(p.name)} · ${periodLabel()}`, '', `Usuario: @${snapshot.user.username}`, `Proyecto: ${p.url}`, `Lectura: ${snapshot.updatedAt}`, '', '## Resumen', '', ...p.observations.map(x => `- ${plain(x)}`), '', snapshot.coverage.commitsAvailable === false ? 'Líneas modificadas: no disponibles (GitLab no expone un correo de autor).' : `Líneas añadidas: ${p.summary.additions}; eliminadas: ${p.summary.deletions} (excluye merges).`, '', '## Contribuciones', '', ...p.records.map(r => `- ${date(r.date)} · ${r.kind} · ${plain(r.title)} · ${r.url}`), '', '## Metodología y cobertura', '', snapshot.coverage.methodology, '', ...snapshot.coverage.warnings.map(x => `- ${plain(x)}`)];
  download(lines.join('\n'), `gitlab-${p.id}-${snapshot.year}.md`, 'text/markdown;charset=utf-8');
}
async function sync() {
  if (loading) return; loading = true; $('refresh').disabled = true; $('error-banner').hidden = true; $('sync-banner').hidden = false;
  try { await api(`/api/sync?${periodQuery()}`, { method: 'POST' }); } catch (e) { error(e.message); }
  loading = false; await pollStatus();
}
let lastCompletion = '';
async function pollStatus() {
  if (pollRunning) return;
  pollRunning = true;
  try {
    const s = await api('/api/status'); const syncing = s.state === 'syncing';
    if (connectionLost) { connectionLost = false; $('error-banner').hidden = true; }
    $('refresh').disabled = syncing || loading; $('sync-banner').hidden = !syncing;
    const selectedId = viewingUser?.id || authenticatedUser?.id;
    const sameUser = s.userId === selectedId;
    if (syncing) { $('sync-text').textContent = `${s.username ? `@${s.username} · ` : ''}${s.year === 'all' ? 'Todos los años' : s.year} · ${s.message}${!sameUser && !snapshot ? ' · La búsqueda seleccionada queda en espera.' : ''}`; $('sync-progress').textContent = `${s.completed} / ${s.total}`; $('progress').max = s.total || 1; $('progress').value = s.completed; }
    if (s.state === 'error' && sameUser) error(s.message);
    if (s.configError) error(s.configError);
    const completion = `${s.userId}:${s.year}:${s.state}`;
    if (s.state === 'done' && lastCompletion !== completion) { lastCompletion = completion; if (sameUser && (String(s.year) === $('year').value || s.year === 'all')) await loadDashboard(); }
    if (syncing) lastCompletion = '';
    if (!snapshot && !syncing && (['done', 'idle'].includes(s.state) || s.state === 'error' && !sameUser) && !s.configError) await loadDashboard(true);
  } catch (e) { connectionLost = true; error('La aplicación perdió conexión con el servidor local. Reinicia npm start si es necesario.'); }
  clearTimeout(polling); polling = setTimeout(pollStatus, 2500);
  pollRunning = false;
}
function renderUserContext() {
  const user = viewingUser || authenticatedUser;
  $('user-context').textContent = user ? `${mineSelected() ? 'Mis contribuciones' : 'Viendo contribuciones de'} · ${user.name} · @${user.username}` : 'Identificando tu usuario…';
  $('mine').setAttribute('aria-pressed', String(mineSelected()));
  $('commit-label').textContent = mineSelected() ? 'Commits propios' : 'Commits del usuario';
}
function selectUser(user, mine = false) {
  selectedUserId = mine || user.id === authenticatedUser?.id ? '' : String(user.id);
  viewingUser = user; ++requestVersion; lastCompletion = '';
  $('user-results').hidden = true; $('user-search-status').hidden = true;
  $('user-search').value = mine ? '' : user.username;
  $('error-banner').hidden = true; $('search').value = ''; $('project').value = '';
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  setEmpty(`Leyendo la actividad de @${user.username}`); renderUserContext();
  loadDashboard(true);
}
$('user-form').addEventListener('submit', async event => {
  event.preventDefault();
  const revision = ++userSearchVersion;
  const query = $('user-search').value.trim().replace(/^@/, '');
  if (query.length < 2) { $('user-search-status').textContent = 'Escribe al menos 2 caracteres.'; $('user-search-status').hidden = false; return; }
  $('user-search-button').disabled = true; $('user-results').hidden = true;
  $('user-search-status').hidden = false; $('user-search-status').textContent = 'Buscando usuarios en GitLab…';
  try {
    const result = await api(`/api/users?search=${encodeURIComponent(query)}`);
    if (revision !== userSearchVersion) return;
    userMatches = result.users;
    const exact = userMatches.find(user => user.username.toLowerCase() === query.toLowerCase());
    if (exact) { selectUser(exact); return; }
    $('user-search-status').textContent = !userMatches.length ? 'No se encontraron usuarios. Prueba otro nombre o @usuario.' : `Selecciona un usuario${result.hasMore ? '; hay más coincidencias, puedes precisar la búsqueda' : ''}.`;
    $('user-results').innerHTML = userMatches.map(user => `<li><button type="button" data-user-id="${user.id}"><strong>${escape(user.name)}</strong><span>@${escape(user.username)}${user.state && user.state !== 'active' ? ` · ${escape(user.state)}` : ''}</span></button></li>`).join('');
    $('user-results').hidden = !userMatches.length;
  } catch (e) { if (revision === userSearchVersion) $('user-search-status').textContent = e.message; }
  finally { if (revision === userSearchVersion) $('user-search-button').disabled = false; }
});
$('user-results').addEventListener('click', event => {
  const button = event.target.closest('[data-user-id]');
  const user = button && userMatches.find(user => user.id === Number(button.dataset.userId));
  if (user) selectUser(user);
});
$('mine').addEventListener('click', async () => {
  ++userSearchVersion; $('user-search-button').disabled = false;
  try {
    if (!authenticatedUser) authenticatedUser = await api('/api/me');
    selectUser(authenticatedUser, true);
  } catch (e) { error(e.message); }
});
$('refresh').addEventListener('click', sync);
$('year').addEventListener('change', () => { $('error-banner').hidden = true; setEmpty('Leyendo el período seleccionado'); loadDashboard(true); });
$('project').addEventListener('change', render);
$('theme').addEventListener('change', renderChart);
$('search').addEventListener('input', renderProjects); $('sort').addEventListener('change', renderProjects);
document.querySelectorAll('[data-view]').forEach((button, i, buttons) => {
  button.addEventListener('click', () => { view = button.dataset.view; for (const tab of buttons) { tab.setAttribute('aria-selected', String(tab === button)); tab.tabIndex = tab === button ? 0 : -1; } renderChart(); });
  button.tabIndex = i ? -1 : 0;
  button.addEventListener('keydown', e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length; buttons[next].click(); buttons[next].focus(); } });
});
$('project-rows').addEventListener('click', event => { const button = event.target.closest('[data-analyze]'); if (button) showProject(Number(button.dataset.analyze)); });
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $(b.dataset.close).close()));
function showMethodology() {
  $('method-content').innerHTML = `<p class="methodology-text">${escape(snapshot?.coverage.methodology || 'Actualiza la actividad para consultar la cobertura del período. Los datos se leen mediante tu MCP local; las credenciales nunca llegan al navegador.')}</p>${snapshot ? `<h3>Fuentes consultadas</h3><ul class="methodology-text">${snapshot.coverage.sources.map(x => `<li>${escape(x)}</li>`).join('')}</ul><h3>Cobertura de esta lectura</h3><p class="methodology-text">${snapshot.coverage.scannedProjects} proyectos consultados; ${snapshot.projects.length} con contribuciones.</p>${snapshot.coverage.warnings.length ? '<ul class="warning-list">' + snapshot.coverage.warnings.map(x => `<li>${escape(x)}</li>`).join('') + '</ul>' : '<p class="methodology-text">No se registraron errores de consulta.</p>'}` : ''}`;
  $('method-dialog').showModal();
}
$('methodology-btn').addEventListener('click', showMethodology);
$('methodology-footer').addEventListener('click', showMethodology);
$('export-svg').addEventListener('click', async () => {
  try { const response = await fetch(chartUrl(true)); if (!response.ok) throw new Error(); download(await response.text(), `gitlab-${$('year').value}-${$('project').value || 'todos'}-${view === 'monthly' ? 'calendar' : view}.svg`, 'image/svg+xml'); } catch { toast('No se pudo exportar el gráfico.'); }
});
$('export-png').addEventListener('click', async () => {
  const button = $('export-png'); button.disabled = true;
  try {
    const response = await fetch(chartUrl()); if (!response.ok) throw new Error();
    const blob = await response.blob(); const url = URL.createObjectURL(blob);
    try {
      const img = new Image(); img.src = url; await img.decode();
      const width = img.naturalWidth || 1200, height = img.naturalHeight || 250;
      const scale = Math.min(2, 8192 / Math.max(width, height));
      const canvas = document.createElement('canvas'); canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#191d1a'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!png) throw new Error();
      download(png, `gitlab-${$('year').value}-${$('project').value || 'todos'}.png`, 'image/png');
    } finally { URL.revokeObjectURL(url); }
  } catch { toast('No se pudo generar el PNG. Puedes descargar el SVG.'); } finally { button.disabled = !snapshot; }
});
api('/api/palettes').then(data => { palettes = data; if (snapshot) renderChart(); }).catch(() => {});
(async () => {
  try {
    authenticatedUser = await api('/api/me'); viewingUser = authenticatedUser;
    $('profile-name').textContent = authenticatedUser.name; $('profile-user').textContent = `@${authenticatedUser.username}`;
    document.querySelector('.avatar').textContent = authenticatedUser.name.split(/\s+/).map(x => x[0]).slice(0, 2).join('');
    renderUserContext();
    await loadDashboard(true);
  } catch (e) { error(e.message); }
  pollStatus();
})();
