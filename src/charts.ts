import * as echarts from 'echarts/core';
import { CustomChart } from 'echarts/charts';
import { CalendarComponent, VisualMapComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { calendarProcessor } from '../vendor/ssr-contributions-img/render-core/calendar.ts';
import { normalizeRenderConfig } from '../vendor/ssr-contributions-img/render-core/normalize.ts';
import { renderContributionSvg } from '../vendor/ssr-contributions-img/render-core/render.ts';
import { ChartTpl } from '../vendor/ssr-contributions-img/render-core/enums.ts';
import { toWeeks } from './analytics.ts';

echarts.use([CustomChart, CalendarComponent, VisualMapComponent, SVGRenderer]);
export async function chartSvg(days: Record<string, number>, chart: ChartTpl, theme: string, username: string) {
  const weeks = toWeeks(days);
  const config = normalizeRenderConfig({ chart, theme, weeks: weeks.length, dark: true, tz: 'America/Montevideo', scale: 2, gap: 1.2, legend: false });
  const totalContributions = Object.values(days).reduce((a, b) => a + b, 0);
  if (chart === ChartTpl.BAR3D) return renderContributionSvg({ name: username, contributionsCollection: { contributionCalendar: { colors: [], totalContributions, weeks } } }, config);
  // Upstream ends its calendar at today's date. Bound its original processor
  // to the selected year instead so historical exports remain accurate.
  const option = calendarProcessor([...weeks].reverse(), Math.max(...Object.values(days), 0), config);
  Object.assign(option.calendar[0], {
    range: [weeks[0].firstDay, weeks.at(-1)!.contributionDays[6].date],
    left: 42, right: 18, top: 30, bottom: 18,
    monthLabel: { show: true, nameMap: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'], color: '#919b93', fontSize: 12 },
    dayLabel: { show: true, nameMap: ['D', 'L', 'M', 'M', 'J', 'V', 'S'], color: '#919b93', fontSize: 12, margin: 12 },
  });
  const instance = echarts.init(null, null, { renderer: 'svg', ssr: true, width: weeks.length * 24 + 60, height: 224 });
  try { instance.setOption(option); return instance.renderToSVGString(); } finally { instance.dispose(); }
}
export async function historicalChartSvg(days: Record<string, number>, chart: ChartTpl, theme: string, username: string) {
  const years = [...new Set(Object.keys(days).map(day => Number(day.slice(0, 4))))].sort((a, b) => b - a);
  let offset = 0, width = 0;
  const parts: string[] = [];
  for (const year of years) {
    const annualDays = Object.fromEntries(Object.entries(days).filter(([day]) => day.startsWith(`${year}-`)));
    const svg = await chartSvg(annualDays, chart, theme, username);
    const root = svg.match(/<svg\b[^>]*>/)?.[0] || '';
    const rowWidth = Number(root.match(/\bwidth=['"]([\d.]+)/)?.[1] || 1300);
    const rowHeight = Number(root.match(/\bheight=['"]([\d.]+)/)?.[1] || 250);
    width = Math.max(width, rowWidth);
    const count = Object.values(annualDays).reduce((a, b) => a + b, 0);
    parts.push(`<g transform="translate(0,${offset})"><text x="16" y="22" fill="#c6f278" font-family="Segoe UI,sans-serif" font-size="16">${year} · ${count} contribuciones</text><g transform="translate(0,36)">${svg}</g></g>`);
    offset += rowHeight + 60;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${offset}" viewBox="0 0 ${width} ${offset}">${parts.join('')}</svg>`;
}
