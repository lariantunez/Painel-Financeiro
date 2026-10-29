// Componentes de interface: toasts, tooltip e gráficos SVG.

import { escapeHtml, moedaCompacta } from './util.js';

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

// ───────────── Toast ─────────────

export function toast(mensagem, tipo = 'ok', duracao = 3500) {
  let pilha = $('.toasts');
  if (!pilha) {
    pilha = document.createElement('div');
    pilha.className = 'toasts';
    pilha.setAttribute('role', 'status');
    document.body.appendChild(pilha);
  }
  const el = document.createElement('div');
  el.className = `toast ${tipo === 'erro' ? 'erro' : ''}`;
  el.textContent = mensagem;
  pilha.appendChild(el);
  setTimeout(() => el.remove(), duracao);
}

// ───────────── Tooltip ─────────────

let tip;
export function mostrarTooltip(evento, html) {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tooltip';
    document.body.appendChild(tip);
  }
  tip.innerHTML = html;
  tip.hidden = false;
  const { innerWidth: W } = window;
  const r = tip.getBoundingClientRect();
  let x = evento.clientX + 14;
  if (x + r.width > W - 8) x = evento.clientX - r.width - 14;
  let y = evento.clientY - r.height - 12;
  if (y < 8) y = evento.clientY + 16;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${y}px`;
}

export function esconderTooltip() {
  if (tip) tip.hidden = true;
}

export function linhaTooltip(cor, rotulo, valor) {
  const sw = cor ? `<i class="swatch" style="background:${cor}"></i>` : '';
  return `<div class="t-linha"><span>${sw}${escapeHtml(rotulo)}</span><b class="num">${valor}</b></div>`;
}

// ───────────── Escala ─────────────

function escalaBonita(max, ticks = 4) {
  if (max <= 0) return { topo: 1, passo: 1 };
  const bruto = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= bruto);
  return { topo: passo * Math.ceil(max / passo), passo };
}

function colunaArredondada(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

// ───────────── Gráfico de colunas (agrupadas) ─────────────
// opcoes: { rotulos[], series:[{nome, cor, valores[]}], selecionado (índice ou lista de índices), tooltip(i), onClick(i, evento), altura }
export function graficoColunas(container, opcoes) {
  const { rotulos, series, selecionado = -1, tooltip, onClick, altura = 220 } = opcoes;
  const destacados = new Set(Array.isArray(selecionado) ? selecionado : [selecionado]);
  const largura = Math.max(300, container.clientWidth || 600);
  const margem = { t: 8, r: 4, b: 26, l: 52 };
  const plotW = largura - margem.l - margem.r;
  const plotH = altura - margem.t - margem.b;
  const max = Math.max(0, ...series.flatMap((s) => s.valores));
  const { topo, passo } = escalaBonita(max);
  const y = (v) => margem.t + plotH - (Math.max(0, v) / topo) * plotH;
  const banda = plotW / rotulos.length;
  const larguraBarra = Math.max(4, Math.min(24, (banda * 0.7 - 2 * (series.length - 1)) / series.length));
  const grupo = larguraBarra * series.length + 2 * (series.length - 1);

  let svg = `<svg viewBox="0 0 ${largura} ${altura}" height="${altura}" role="img">`;
  for (let v = 0; v <= topo + 1e-9; v += passo) {
    const yy = Math.round(y(v)) + 0.5;
    svg += `<line x1="${margem.l}" x2="${largura - margem.r}" y1="${yy}" y2="${yy}" stroke="var(${v === 0 ? '--axis' : '--grid'})" stroke-width="1"/>`;
    svg += `<text x="${margem.l - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="var(--muted)" class="num">${v === 0 ? '0' : moedaCompacta(v).replace('R$ ', '')}</text>`;
  }
  rotulos.forEach((rot, i) => {
    const x0 = margem.l + i * banda;
    const ativo = destacados.has(i);
    svg += `<g class="alvo" data-i="${i}">`;
    svg += `<rect class="fundo-hover" x="${x0 + 1}" y="${margem.t}" width="${banda - 2}" height="${plotH}" rx="6" fill="${ativo ? 'var(--hover)' : 'transparent'}"/>`;
    const inicio = x0 + (banda - grupo) / 2;
    series.forEach((s, j) => {
      const v = s.valores[i] || 0;
      const yy = y(v);
      const xb = inicio + j * (larguraBarra + 2);
      svg += `<path d="${colunaArredondada(xb, yy, larguraBarra, margem.t + plotH - yy)}" fill="${s.cor}"/>`;
    });
    const pular = banda < 40 && i % 2 !== (rotulos.length - 1) % 2 && !ativo;
    if (!pular) svg += `<text x="${x0 + banda / 2}" y="${altura - 8}" text-anchor="middle" font-size="11" fill="var(${ativo ? '--text' : '--muted'})" font-weight="${ativo ? 600 : 400}">${escapeHtml(rot)}</text>`;
    svg += '</g>';
  });
  svg += '</svg>';
  container.innerHTML = `<div class="grafico">${svg}</div>`;

  for (const g of container.querySelectorAll('.alvo')) {
    const i = +g.dataset.i;
    if (tooltip) {
      g.addEventListener('mousemove', (e) => mostrarTooltip(e, tooltip(i)));
      g.addEventListener('mouseleave', esconderTooltip);
    }
    if (onClick) g.addEventListener('click', (e) => onClick(i, e));
  }
}

export function legenda(itens) {
  return `<div class="legenda">${itens
    .map(([cor, nome]) => (cor === 'tick' ? `<span><i class="tick"></i>${escapeHtml(nome)}</span>` : `<span><i class="swatch" style="background:${cor}"></i>${escapeHtml(nome)}</span>`))
    .join('')}</div>`;
}

// ───────────── Tabelas ordenáveis ─────────────
// colunas: [{ id, rotulo, classe, desc }] — id vazio = coluna sem ordenação; desc = 1º clique decrescente
// ordem: { col, dir } (dir 1 = crescente, -1 = decrescente), guardado por quem chama

export function cabecalho(colunas, ordem) {
  return `<thead><tr>${colunas
    .map(({ id, rotulo, classe = '' }) => {
      if (!id) return `<th class="${classe}">${rotulo}</th>`;
      const ativa = ordem.col === id;
      const sort = ativa ? (ordem.dir === 1 ? 'ascending' : 'descending') : 'none';
      return `<th class="${classe}" data-ordenar="${id}" aria-sort="${sort}" tabindex="0">${rotulo}<span class="seta">${ativa ? (ordem.dir === 1 ? '▲' : '▼') : ''}</span></th>`;
    })
    .join('')}</tr></thead>`;
}

export function ordenar(lista, ordem, valorDe) {
  const pegar = valorDe[ordem.col];
  if (!pegar) return lista;
  const colador = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
  return [...lista].sort((a, b) => {
    const va = pegar(a);
    const vb = pegar(b);
    const vazioA = va === '' || va === null || va === undefined;
    const vazioB = vb === '' || vb === null || vb === undefined;
    if (vazioA || vazioB) return vazioA - vazioB; // vazios sempre no fim
    const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : colador.compare(String(va), String(vb));
    return r * ordem.dir;
  });
}

export function ligarOrdenacao(el, colunas, ordem, redesenhar) {
  for (const th of $$('[data-ordenar]', el)) {
    const trocar = () => {
      const col = th.dataset.ordenar;
      if (ordem.col === col) ordem.dir *= -1;
      else Object.assign(ordem, { col, dir: colunas.find((c) => c.id === col)?.desc ? -1 : 1 });
      redesenhar();
    };
    th.addEventListener('click', trocar);
    th.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), trocar()));
  }
}

// Data "dd/mm/aaaa" (ou ISO) como número ordenável
export function dataOrdenavel(texto) {
  const m = String(texto || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})|^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return m[1] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) * 10000 + +m[2] * 100 + +m[1] : +m[4] * 10000 + +m[5] * 100 + +m[6];
}

// Redesenha gráficos quando a largura muda
const observados = new WeakMap();
const observer = typeof ResizeObserver !== 'undefined'
  ? new ResizeObserver((entradas) => {
      for (const e of entradas) {
        if (!e.target.isConnected) {
          observer.unobserve(e.target);
          continue;
        }
        const desenhar = observados.get(e.target);
        const w = Math.round(e.contentRect.width);
        if (desenhar && e.target._largura !== w) {
          e.target._largura = w;
          desenhar();
        }
      }
    })
  : null;

export function responsivo(container, desenhar) {
  container._largura = Math.round(container.clientWidth);
  observados.set(container, desenhar);
  observer?.observe(container);
  desenhar();
}
