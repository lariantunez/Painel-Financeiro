// Funções utilitárias puras (sem DOM) — usadas pelo painel e pelos testes.

export const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
export const MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export function semAcento(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// "INSTITUIÇAO_FINANCEIRA" -> "INSTITUICAO_FINANCEIRA", "MES DE REFERENCIA" -> "MES_DE_REFERENCIA"
export function normalizarCabecalho(texto) {
  return semAcento(texto).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// Comparação de rótulos da planilha ignorando acento, caixa e espaços extras
export function rotulo(texto) {
  return semAcento(texto).trim().toUpperCase().replace(/\s+/g, ' ');
}

export function parseValor(valor) {
  if (typeof valor === 'number') return valor;
  if (valor === undefined || valor === null) return 0;
  let txt = String(valor).trim().replace(/\s/g, '').replace(/R\$/i, '');
  if (!txt || txt === '-') return 0;
  const negativo = /^-|^\(.*\)$|-$/.test(txt);
  txt = txt.replace(/[()\-+]/g, '');
  // "1.234,56" (BR) | "1,234.56" (US) | "1234.56" | "1234,56"
  const ultVirgula = txt.lastIndexOf(',');
  const ultPonto = txt.lastIndexOf('.');
  if (ultVirgula > ultPonto) txt = txt.replace(/\./g, '').replace(',', '.');
  else if (ultPonto > ultVirgula && ultVirgula >= 0) txt = txt.replace(/,/g, '');
  const n = parseFloat(txt);
  if (isNaN(n)) return 0;
  return negativo ? -n : n;
}

export function arred(n) {
  return Math.round(n * 100) / 100;
}

const fmtMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export function moeda(v) {
  return fmtMoeda.format(v || 0);
}

export function moedaCompacta(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (a >= 1e3) return `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `R$ ${Math.round(v)}`;
}

export function pct(v, casas = 0) {
  return `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: casas })}%`;
}

// Converte qualquer data comum para objeto {ano, mes, dia} (ou null)
export function parseData(texto) {
  if (!texto) return null;
  if (texto instanceof Date) return { ano: texto.getFullYear(), mes: texto.getMonth() + 1, dia: texto.getDate() };
  const t = String(texto).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { ano: +m[1], mes: +m[2], dia: +m[3] };
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return { ano: anoCompleto(m[3]), mes: +m[2], dia: +m[1] };
  m = t.match(/^(\d{4})(\d{2})(\d{2})/); // OFX: 20260815120000
  if (m) return { ano: +m[1], mes: +m[2], dia: +m[3] };
  return null;
}

function anoCompleto(a) {
  const n = +a;
  return a.length <= 2 ? 2000 + n : n;
}

// "09/2026", "9/26", "2026-09", "15/09/2026" -> "2026-09"
export function parseMesRef(texto) {
  if (!texto) return '';
  const t = String(texto).trim();
  let m = t.match(/^(\d{1,2})[/-](\d{2}|\d{4})$/);
  if (m) return `${anoCompleto(m[2])}-${m[1].padStart(2, '0')}`;
  m = t.match(/^(\d{4})-(\d{2})$/);
  if (m) return t;
  const d = parseData(t);
  return d ? chaveMes(d.ano, d.mes) : '';
}

export function chaveMes(ano, mes) {
  return `${ano}-${String(mes).padStart(2, '0')}`;
}

export function somarMeses(chave, n) {
  const [a, m] = chave.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return chaveMes(d.getFullYear(), d.getMonth() + 1);
}

export function mesAtual() {
  const h = new Date();
  return chaveMes(h.getFullYear(), h.getMonth() + 1);
}

// "Agosto 2026" · "Jul – Set 2026" · "Nov 2025 – Jan 2026" · "4 meses" (não consecutivos)
export function rotuloPeriodo(meses) {
  const m = [...meses].sort();
  if (m.length === 1) return nomeMes(m[0]);
  const consecutivos = m.every((x, i) => i === 0 || somarMeses(m[i - 1], 1) === x);
  if (!consecutivos) return `${m.length} meses`;
  const [a1, a2] = [m[0].slice(0, 4), m[m.length - 1].slice(0, 4)];
  return a1 === a2 ? `${MESES[+m[0].slice(5) - 1]} – ${nomeMes(m[m.length - 1], false)}` : `${nomeMes(m[0], false)} – ${nomeMes(m[m.length - 1], false)}`;
}

export function nomeMes(chave, longo = true) {
  const [a, m] = chave.split('-').map(Number);
  return `${(longo ? MESES_LONGOS : MESES)[m - 1]} ${a}`;
}

// Formatos usados na planilha
export function dataBR({ ano, mes, dia }) {
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`;
}

export function mesRefBR(chave) {
  const [a, m] = chave.split('-');
  return `${m}/${a}`;
}

export function diasNoMes(ano, mes) {
  return new Date(ano, mes, 0).getDate();
}

// "1/10" -> {k:1, n:10}
export function parseParcela(texto) {
  const m = String(texto || '').match(/(\d+)\s*\/\s*(\d+)/);
  return m ? { k: +m[1], n: +m[2] } : null;
}

export const RX_PARCELA = /\s*-?\s*Parcela\s+(\d+)\s*\/\s*(\d+)/i;

export function hashTexto(texto) {
  // FNV-1a 32 bits, suficiente para gerar IDs estáveis de importação
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function escapeHtml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function capitalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .replace(/(^|[\s(/-])(\p{L})/gu, (_, sep, l) => sep + l.toUpperCase());
}
