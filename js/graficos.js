// Gráficos do painel em SVG: área com gradiente (minicartões), linhas suaves, rosca e anéis.
// Cores sempre por variável CSS (temas claro/escuro); nunca cinza nos dados.

import { escapeHtml, moedaCompacta, pct } from './util.js';
import { mostrarTooltip, esconderTooltip } from './ui.js';

let seq = 0;
const novoId = (p) => `${p}-${++seq}`;

// Curva suave que passa pelos pontos sem "estourar" acima/abaixo deles (interpolação monotônica)
export function caminhoSuave(pontos) {
  const n = pontos.length;
  if (!n) return '';
  if (n === 1) return `M${pontos[0][0]},${pontos[0][1]}`;
  const dx = [];
  const m = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pontos[i + 1][0] - pontos[i][0]);
    m.push((pontos[i + 1][1] - pontos[i][1]) / (dx[i] || 1));
  }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  let d = `M${pontos[0][0]},${pontos[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pontos[i];
    const [x1, y1] = pontos[i + 1];
    const h = dx[i] / 3;
    d += `C${x0 + h},${y0 + t[i] * h} ${x1 - h},${y1 - t[i + 1] * h} ${x1},${y1}`;
  }
  return d;
}

const gradiente = (id, cor, opacidade = 0.45) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style="stop-color:${cor};stop-opacity:${opacidade}"/><stop offset="100%" style="stop-color:${cor};stop-opacity:0"/></linearGradient>`;

function escala(min, max, ticks = 4) {
  if (max <= min) max = min + 1;
  const bruto = (max - Math.min(0, min)) / ticks;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((x) => x * mag).find((p) => p >= bruto);
  return { base: Math.min(0, Math.floor(min / passo) * passo), topo: passo * Math.ceil(max / passo), passo };
}

// ───────────── Minigráfico de área (cartões) ─────────────
export function sparkline(container, valores, cor, { altura = 54 } = {}) {
  const largura = Math.max(80, container.clientWidth || 160);
  const lista = valores.map((v) => (Number.isFinite(v) ? v : 0));
  const min = Math.min(...lista);
  const max = Math.max(...lista);
  const folga = (max - min) * 0.15 || 1;
  const y = (v) => 4 + (altura - 8) * (1 - (v - (min - folga)) / (max + folga - (min - folga)));
  const x = (i) => (lista.length === 1 ? largura / 2 : (i / (lista.length - 1)) * (largura - 10) + 2);
  const pts = lista.map((v, i) => [x(i), y(v)]);
  const linha = caminhoSuave(pts);
  const id = novoId('sp');
  const ultimo = pts[pts.length - 1];
  container.innerHTML = `<svg viewBox="0 0 ${largura} ${altura}" height="${altura}" width="100%" aria-hidden="true" style="display:block;overflow:visible">
    <defs>${gradiente(id, cor)}</defs>
    <path d="${linha}L${pts[pts.length - 1][0]},${altura}L${pts[0][0]},${altura}Z" fill="url(#${id})"/>
    <path d="${linha}" fill="none" style="stroke:${cor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${ultimo[0]}" cy="${ultimo[1]}" r="3.5" style="fill:${cor};stroke:var(--surface)" stroke-width="2"/>
  </svg>`;
}

// ───────────── Linhas suaves com área ─────────────
// opcoes: { rotulos[], series:[{nome, cor, valores[]}], selecionados[], tooltip(i), onClick(i, e), altura }
export function linhasSuaves(container, opcoes) {
  const { rotulos, series, selecionados = [], tooltip, onClick, altura = 240 } = opcoes;
  const largura = Math.max(300, container.clientWidth || 600);
  const mg = { t: 10, r: 10, b: 26, l: 52 };
  const plotW = largura - mg.l - mg.r;
  const plotH = altura - mg.t - mg.b;
  const todos = series.flatMap((s) => s.valores);
  const { base, topo, passo } = escala(Math.min(0, ...todos), Math.max(...todos, 1));
  const y = (v) => mg.t + plotH - ((v - base) / (topo - base)) * plotH;
  const banda = plotW / rotulos.length;
  const x = (i) => mg.l + banda * i + banda / 2;
  const marcados = new Set(selecionados);

  let svg = `<svg viewBox="0 0 ${largura} ${altura}" height="${altura}" width="100%" role="img" style="display:block;overflow:visible"><defs>`;
  const ids = series.map((s) => {
    const id = novoId('ln');
    svg += gradiente(id, s.cor, 0.28);
    return id;
  });
  svg += '</defs>';
  for (let v = base; v <= topo + 1e-9; v += passo) {
    const yy = Math.round(y(v)) + 0.5;
    svg += `<line x1="${mg.l}" x2="${largura - mg.r}" y1="${yy}" y2="${yy}" stroke="var(${v === 0 ? '--axis' : '--grid'})"/>`;
    svg += `<text x="${mg.l - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v === 0 ? '0' : moedaCompacta(v).replace('R$ ', '')}</text>`;
  }
  // meses selecionados ao fundo
  rotulos.forEach((_, i) => {
    if (marcados.has(i)) svg += `<rect x="${mg.l + banda * i + 1}" y="${mg.t}" width="${banda - 2}" height="${plotH}" rx="6" fill="var(--selecao)"/>`;
  });
  series.forEach((s, j) => {
    const pts = s.valores.map((v, i) => [x(i), y(v)]);
    const linha = caminhoSuave(pts);
    svg += `<path d="${linha}L${pts[pts.length - 1][0]},${y(Math.max(0, base))}L${pts[0][0]},${y(Math.max(0, base))}Z" fill="url(#${ids[j]})"/>`;
    svg += `<path d="${linha}" fill="none" style="stroke:${s.cor}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  });
  // áreas de clique/hover por mês (guia e pontos aparecem no hover)
  rotulos.forEach((rot, i) => {
    const ativo = marcados.has(i);
    const pular = banda < 40 && i % 2 !== (rotulos.length - 1) % 2 && !ativo; // pouco espaço: meses alternados
    svg += `<g class="alvo-linha" data-i="${i}"><rect x="${mg.l + banda * i}" y="${mg.t}" width="${banda}" height="${plotH + mg.b}" fill="transparent"/>
      <line class="guia" x1="${x(i)}" x2="${x(i)}" y1="${mg.t}" y2="${mg.t + plotH}" stroke="var(--axis)" stroke-width="1"/>
      ${series.map((s) => `<circle class="ponto" cx="${x(i)}" cy="${y(s.valores[i])}" r="4.5" style="fill:${s.cor};stroke:var(--surface)" stroke-width="2"/>`).join('')}
      ${pular ? '' : `<text x="${x(i)}" y="${altura - 8}" text-anchor="middle" font-size="11" fill="var(${ativo ? '--text' : '--muted'})" font-weight="${ativo ? 700 : 400}">${escapeHtml(rot)}</text>`}</g>`;
  });
  svg += '</svg>';
  container.innerHTML = `<div class="grafico">${svg}</div>`;
  for (const g of container.querySelectorAll('.alvo-linha')) {
    const i = +g.dataset.i;
    if (tooltip) {
      g.addEventListener('mousemove', (e) => mostrarTooltip(e, tooltip(i)));
      g.addEventListener('mouseleave', esconderTooltip);
    }
    if (onClick) g.addEventListener('click', (e) => onClick(i, e));
  }
}

// ───────────── Rosca ─────────────
// segmentos: [{rotulo, valor, cor, atributos}] — atributos: HTML extra (ex.: data-filtro) na legenda e na fatia
export function rosca(container, { segmentos, centro, sub, tooltip }) {
  const total = segmentos.reduce((s, x) => s + Math.max(0, x.valor), 0);
  if (total <= 0) {
    container.innerHTML = '<div class="vazio">Sem despesas no período.</div>';
    return;
  }
  const r = 78;
  const c = 2 * Math.PI * r;
  const folga = segmentos.length > 1 ? 3 : 0; // respiro entre fatias, na cor do fundo
  let acumulado = 0;
  const fatias = segmentos
    .map((s, i) => {
      const comp = (Math.max(0, s.valor) / total) * c;
      const traco = Math.max(0.5, comp - folga);
      const html = `<circle class="fatia" data-i="${i}" ${s.atributos || ''} cx="100" cy="100" r="${r}" fill="none" style="stroke:${s.cor}" stroke-width="26"
        stroke-dasharray="${traco} ${c - traco}" stroke-dashoffset="${-acumulado}" transform="rotate(-90 100 100)"/>`;
      acumulado += comp;
      return html;
    })
    .join('');
  container.innerHTML = `<div class="rosca">
    <svg viewBox="0 0 200 200" class="rosca-svg" role="img">${fatias}
      <text x="100" y="98" text-anchor="middle" class="rosca-centro">${escapeHtml(centro)}</text>
      <text x="100" y="118" text-anchor="middle" class="rosca-sub">${escapeHtml(sub || '')}</text>
    </svg>
    <div class="rosca-legenda">${segmentos
      .map(
        (s) => `<button class="rosca-item" ${s.atributos || ''}><i class="swatch" style="background:${s.cor}"></i><span class="r-nome">${escapeHtml(s.rotulo)}</span><span class="r-pct">${pct(Math.max(0, s.valor) / total)}</span></button>`
      )
      .join('')}</div>
  </div>`;
  if (tooltip) {
    for (const f of container.querySelectorAll('.fatia')) {
      f.addEventListener('mousemove', (e) => mostrarTooltip(e, tooltip(+f.dataset.i, total)));
      f.addEventListener('mouseleave', esconderTooltip);
    }
  }
}

// ───────────── Anéis de participação ─────────────
// itens: [{rotulo, pct (0–1), cor, atributos, classe, titulo}]
export function aneis(itens) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return `<div class="aneis">${itens
    .map((it) => {
      const p = Math.max(0, Math.min(1, it.pct || 0));
      return `<button class="anel ${it.classe || ''}" ${it.atributos || ''} title="${escapeHtml(it.titulo || '')}">
        <svg viewBox="0 0 80 80" aria-hidden="true">
          <circle cx="40" cy="40" r="${r}" fill="none" style="stroke:${it.cor};opacity:.18" stroke-width="9"/>
          ${p > 0 ? `<circle cx="40" cy="40" r="${r}" fill="none" style="stroke:${it.cor}" stroke-width="9" stroke-linecap="round"
            stroke-dasharray="${p * c} ${c}" transform="rotate(-90 40 40)"/>` : ''}
          <text x="40" y="45" text-anchor="middle" class="anel-pct">${Math.round(p * 100)}%</text>
        </svg>
        <span class="anel-rotulo">${escapeHtml(it.rotulo)}</span>
      </button>`;
    })
    .join('')}</div>`;
}
