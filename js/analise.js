// Cálculos do painel (sem DOM).

import { rotulo, somarMeses, parseParcela, RX_PARCELA, mesAtual } from './util.js';
import { serieDe } from './fixas.js';
import { chaveDescricao, ehMarketplace } from './classifier.js';

export const SEM_TIPO = 'Sem tipo';

// Número da parcela: o que está no nome ("Parcela 7/10") vale mais que a coluna PARCELAS
function parcelaDe(d) {
  const m = d.nome.match(RX_PARCELA);
  return m ? { k: +m[1], n: +m[2] } : parseParcela(d.parcelas);
}

const mesesEntre = (a, b) => {
  const [a1, m1] = a.split('-').map(Number);
  const [a2, m2] = b.split('-').map(Number);
  return (a2 - a1) * 12 + (m2 - m1);
};

// Todas as parcelas da mesma compra (inclui a própria). Precisam ter o mesmo nº de parcelas e o
// mesmo valor, e ainda: mesmo nome base, ou mesma descrição do banco, ou datas coerentes com a
// numeração (a parcela 1/10 fica 7 meses antes da 8/10)
export function parcelasDaMesmaCompra(despesas, d) {
  const p = parcelaDe(d);
  if (!p || p.n <= 1) return [d];
  const serie = serieDe(d.nome);
  const chave = d.descOriginal ? chaveDescricao(d.descOriginal) : '';
  return despesas.filter((x) => {
    if (x === d) return true;
    const px = parcelaDe(x);
    // tolerância: a 1ª parcela costuma absorver os centavos do arredondamento (138,48 x 138,40)
    const tolerancia = Math.max(0.15, Math.abs(d.valor) * 0.01);
    if (!px || px.n !== p.n || Math.abs(Math.abs(x.valor) - Math.abs(d.valor)) > tolerancia) return false;
    if (serieDe(x.nome) === serie) return true;
    if (chave && x.descOriginal && chaveDescricao(x.descOriginal) === chave) return true;
    return Boolean(x.mesRef && d.mesRef) && Math.abs(mesesEntre(d.mesRef, x.mesRef) - (px.k - p.k)) <= 1;
  });
}

// "Mesma despesa" para propagar classificação: parcelas da mesma compra ou lançamentos com o mesmo nome.
// Compras de marketplace com nome genérico ("shopee") são diferentes entre si: só a própria.
export function mesmaDespesa(despesas, d) {
  const p = parcelaDe(d);
  // compra parcelada no cartão: as parcelas da compra. Contas mensais numeradas (financiamento 23/63) seguem pelo nome,
  // para um reajuste de valor não "separar" a conta das anteriores
  if (p && p.n > 1 && (RX_PARCELA.test(d.nome) || rotulo(d.forma).startsWith('CREDITO'))) return parcelasDaMesmaCompra(despesas, d);
  const serie = serieDe(d.nome);
  if (!serie || ehMarketplace(chaveDescricao(d.nome))) return [d];
  return despesas.filter((x) => x === d || serieDe(x.nome) === serie);
}

// Reajuste de valor: vale para o lançamento e os seguintes (anteriores ficam como estão)
export function lancamentosSeguintes(despesas, d) {
  const p = parcelaDe(d);
  // pelo mês de referência (na planilha a numeração de parcelas às vezes não foi incrementada)
  return mesmaDespesa(despesas, d).filter((x) => {
    if (x === d) return true;
    if (!x.mesRef || !d.mesRef) return false;
    const px = parcelaDe(x);
    return x.mesRef > d.mesRef || (x.mesRef === d.mesRef && p && px && px.k > p.k);
  });
}

export const RECORRENCIAS = ['MENSAL', 'EVENTUAL'];

// ───────────── Análises do painel ─────────────

export const mesesDoAno = (ano) => Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`);

// Soma por chave (ex.: por tipo, por despesa)
export function somarPor(lista, chave) {
  const m = new Map();
  for (const d of lista) m.set(chave(d), (m.get(chave(d)) || 0) + (d.valor || 0));
  return m;
}

// Receitas do ano mês a mês: salário de cada pessoa × outras receitas
// O dono do salário vem do tipo ("Salário Douglas") e, se não estiver lá, da coluna NOME
export const ehSalario = (r) => /SALARIO|FERIAS|PLR|RESCISAO|DECIMO TERCEIRO|13O SALARIO/.test(rotulo(`${r.tipo}`));
export function donoDoSalario(r, pessoas) {
  const tipo = rotulo(r.tipo);
  return pessoas.find((p) => tipo.includes(p)) || pessoas.find((p) => rotulo(r.nome) === p) || '';
}
export function receitasDoAno(dados, ano, pessoas = []) {
  return mesesDoAno(ano).map((mes) => {
    const doMes = dados.receitas.filter((r) => r.mesRef === mes);
    const salarios = Object.fromEntries(pessoas.map((p) => [p, 0]));
    let outras = 0;
    for (const r of doMes) {
      const dono = ehSalario(r) && donoDoSalario(r, pessoas);
      if (dono) salarios[dono] += r.valor;
      else outras += r.valor;
    }
    return { mes, salarios, outras };
  });
}

// Cor de cada tipo: fixa pelo gasto em todo o histórico (o mesmo tipo tem sempre a mesma cor, em qualquer ano)
// "principais" = tipos com gasto no ano, do maior para o menor. Só passando de 17 tipos o resto vira "Outros"
export const OUTROS = 'Outros';
export const CORES_TIPO = 18;
export function coresDosTipos(despesasDoAno, historico = despesasDoAno) {
  const maximo = CORES_TIPO - 1;
  const fixas = [...somarPor(historico, tipoDe).entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, maximo);
  const cores = new Map(fixas.map(([t], i) => [t, `var(--cat-${i + 1})`]));
  const principais = [...somarPor(despesasDoAno, tipoDe).entries()].filter(([t, v]) => v > 0 && cores.has(t)).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  return { cores, principais, corOutros: `var(--cat-${CORES_TIPO})` };
}

export function segmentosPorTipo(despesas, { cores, corOutros }) {
  const somas = somarPor(despesas, tipoDe);
  const seg = [];
  let outros = 0;
  for (const [tipo, valor] of [...somas.entries()].sort((a, b) => b[1] - a[1])) {
    if (valor <= 0) continue;
    if (cores.has(tipo)) seg.push({ tipo, valor, cor: cores.get(tipo) });
    else outros += valor;
  }
  if (outros > 0) seg.push({ tipo: OUTROS, valor: outros, cor: corOutros });
  return seg;
}

// ───────────── Previsão dos próximos meses ─────────────

const ehParcelaCartao = (d) => {
  const p = parcelaDe(d);
  return Boolean(p && p.n > 1 && (RX_PARCELA.test(d.nome) || rotulo(d.forma).startsWith('CREDITO')));
};

const nomeComParcela = (d, k) => {
  const p = parcelaDe(d);
  if (!p) return d.nome;
  return RX_PARCELA.test(d.nome) ? d.nome.replace(/Parcela\s+\d+\s*\/\s*\d+/i, `Parcela ${k}/${p.n}`) : `${d.nome} (${k}/${p.n})`;
};

// Gastos previstos mês a mês: contas mensais (lançadas ou pelo último valor) + parcelas do cartão
// (lançadas ou restantes de cada compra) e receitas mensais previstas. Gastos eventuais não entram;
// a média deles vai à parte como referência.
export function previsao(dados, horizonte = 12, inicio = mesAtual()) {
  const meses = Array.from({ length: horizonte }, (_, i) => somarMeses(inicio, i));
  const itens = new Map(meses.map((m) => [m, []]));
  const fim = meses[meses.length - 1];
  const ativoDesde = somarMeses(inicio, -3); // conta que não aparece há mais de 3 meses é considerada encerrada

  // 1. o que já está lançado nos meses da previsão
  for (const d of dados.despesas) {
    if (!itens.has(d.mesRef)) continue;
    const grupo = ehParcelaCartao(d) ? 'parcela' : d.recorrencia === 'MENSAL' ? 'mensal' : null;
    if (grupo) itens.get(d.mesRef).push({ nome: d.nome, tipo: d.tipo, valor: d.valor, grupo, origem: 'lancado', status: d.status });
  }

  // 2. contas mensais: último valor de cada uma, nos meses ainda sem lançamento
  const ultimaMensal = new Map();
  for (const d of dados.despesas) {
    if (d.recorrencia !== 'MENSAL' || ehParcelaCartao(d) || !d.mesRef || d.mesRef > fim) continue;
    const s = serieDe(d.nome);
    const atual = ultimaMensal.get(s);
    if (!atual || d.mesRef > atual.mesRef || (d.mesRef === atual.mesRef && d._linha > atual._linha)) ultimaMensal.set(s, d);
  }
  for (const d of ultimaMensal.values()) {
    if (d.mesRef < ativoDesde || !(d.valor > 0)) continue;
    const p = parcelaDe(d);
    const restantes = p && p.n > 1 ? p.n - p.k : Infinity;
    for (const m of meses) {
      if (m <= d.mesRef) continue;
      const passo = mesesEntre(d.mesRef, m);
      if (passo > restantes) break;
      itens.get(m).push({ nome: p && p.n > 1 ? nomeComParcela(d, p.k + passo) : d.nome, tipo: d.tipo, valor: d.valor, grupo: 'mensal', origem: 'previsto' });
    }
  }

  // 3. parcelas do cartão: parcelas restantes de cada compra, a partir da última lançada.
  // Agrupa pela "mesma compra" (tolera nome diferente entre meses e centavos a mais na 1ª parcela)
  const parcelasCartao = dados.despesas
    .filter((d) => ehParcelaCartao(d) && d.mesRef && d.mesRef <= fim)
    .sort((a, b) => b.mesRef.localeCompare(a.mesRef) || parcelaDe(b).k - parcelaDe(a).k);
  const vistas = new Set();
  const ultimaParcela = [];
  for (const d of parcelasCartao) {
    if (vistas.has(d)) continue;
    ultimaParcela.push(d); // a mais recente da compra
    for (const x of parcelasDaMesmaCompra(parcelasCartao, d)) vistas.add(x);
  }
  for (const d of ultimaParcela) {
    const p = parcelaDe(d);
    for (let j = 1; j <= p.n - p.k; j++) {
      const m = somarMeses(d.mesRef, j);
      if (itens.has(m)) itens.get(m).push({ nome: nomeComParcela(d, p.k + j), tipo: d.tipo, valor: d.valor, grupo: 'parcela', origem: 'previsto' });
    }
  }

  // 4. receitas: lançadas nos meses da previsão + receitas fixas pelo último mês em que apareceram
  const receitas = new Map(meses.map((m) => [m, []]));
  for (const r of dados.receitas) if (receitas.has(r.mesRef)) receitas.get(r.mesRef).push({ nome: r.tipo, quem: r.nome, valor: r.valor, origem: 'lancado' });
  const ultimaReceita = new Map();
  for (const r of dados.receitas) {
    if (rotulo(r.categoria) !== 'FIXO' || !r.mesRef || r.mesRef > fim) continue;
    const s = `${rotulo(r.tipo)}|${rotulo(r.nome)}`;
    const atual = ultimaReceita.get(s);
    if (!atual || r.mesRef > atual.mes) ultimaReceita.set(s, { mes: r.mesRef, linhas: [r] });
    else if (r.mesRef === atual.mes) atual.linhas.push(r);
  }
  for (const { mes: ultimo, linhas } of ultimaReceita.values()) {
    if (ultimo < ativoDesde) continue;
    for (const m of meses) {
      if (m <= ultimo) continue;
      for (const r of linhas) receitas.get(m).push({ nome: r.tipo, quem: r.nome, valor: r.valor, origem: 'previsto' });
    }
  }

  // média mensal dos gastos eventuais nos 6 meses anteriores (só referência)
  const anteriores = Array.from({ length: 6 }, (_, i) => somarMeses(inicio, -(i + 1)));
  const eventuais = dados.despesas.filter((d) => anteriores.includes(d.mesRef) && d.recorrencia !== 'MENSAL' && !ehParcelaCartao(d));
  const mesesComDados = new Set(eventuais.map((d) => d.mesRef)).size || 1;
  const mediaEventual = eventuais.reduce((s, d) => s + d.valor, 0) / mesesComDados;

  const soma = (lista, grupo) => lista.filter((i) => !grupo || i.grupo === grupo).reduce((s, i) => s + i.valor, 0);
  return {
    mediaEventual,
    meses: meses.map((m) => {
      const lista = itens.get(m).sort((a, b) => b.valor - a.valor);
      const rec = receitas.get(m);
      const mensais = soma(lista, 'mensal');
      const parcelas = soma(lista, 'parcela');
      const receita = soma(rec);
      return { mes: m, mensais, parcelas, total: mensais + parcelas, receita, saldo: receita - mensais - parcelas, itens: lista, receitas: rec };
    }),
  };
}

// Recorrência sugerida para lançamentos sem essa informação:
// MENSAL = conta paga todo mês (fixa, financiamento/carnê fora do cartão, ou aparece 1x por mês em 3+ meses)
// EVENTUAL = gasto que acontece ao longo do mês (compras, feira, restaurante, parcelas de compras no cartão)
export function inferirRecorrencia(despesas) {
  const porSerie = new Map();
  for (const d of despesas) {
    const s = serieDe(d.nome);
    if (!s || !d.mesRef) continue;
    if (!porSerie.has(s)) porSerie.set(s, { meses: new Set(), n: 0 });
    const e = porSerie.get(s);
    e.meses.add(d.mesRef);
    e.n++;
  }
  const resultado = new Map();
  for (const d of despesas) {
    let r = 'EVENTUAL';
    const p = parcelaDe(d);
    const cartao = rotulo(d.forma).startsWith('CREDITO');
    const e = porSerie.get(serieDe(d.nome));
    if (rotulo(d.categoria) === 'FIXO') r = 'MENSAL';
    else if (p && p.n > 1 && !cartao) r = 'MENSAL'; // financiamento, carnê
    else if (!(p && p.n > 1) && e && e.meses.size >= 3 && e.n / e.meses.size <= 1.2 && !ehMarketplace(chaveDescricao(d.nome))) r = 'MENSAL';
    resultado.set(d, r);
  }
  return resultado;
}

// Novo nome para uma parcela, mantendo o "- Parcela k/n" de cada uma
export function nomeDaParcela(nomeNovo, parcela) {
  const base = nomeNovo.replace(RX_PARCELA, '').replace(/\s+-\s*$/, '').trim();
  const p = parcelaDe(parcela);
  const usaSufixo = RX_PARCELA.test(parcela.nome) || (rotulo(parcela.forma).includes('PARCELADO') && p);
  return usaSufixo ? `${base} - Parcela ${p.k}/${p.n}` : base;
}
export const tipoDe = (d) => d.tipo || SEM_TIPO;

// mes: um mês ('2026-08') ou uma lista de meses (período)
const doMes = (lista, mes) => {
  if (!Array.isArray(mes)) return lista.filter((l) => l.mesRef === mes);
  const conj = new Set(mes);
  return lista.filter((l) => conj.has(l.mesRef));
};

// Período imediatamente anterior, com a mesma quantidade de meses
export function periodoAnterior(meses) {
  const ordenados = [...meses].sort();
  const n = ordenados.length;
  return Array.from({ length: n }, (_, i) => somarMeses(ordenados[0], i - n));
}
const soma = (lista) => lista.reduce((t, l) => t + (l.valor || 0), 0);

// Filtros da página (clicar num dado filtra; clicar de novo tira). Cada um compara um valor da despesa.
export const FILTROS = {
  tipo: { rotulo: 'Tipo', valor: (d) => tipoDe(d) },
  despesa: { rotulo: 'Despesa', valor: (d) => serieDe(d.nome) },
  categoria: { rotulo: 'Categoria', valor: (d) => (rotulo(d.categoria) === 'FIXO' ? 'FIXO' : 'VARIAVEL') },
  recorrencia: { rotulo: 'Recorrência', valor: (d) => (d.recorrencia === 'MENSAL' ? 'MENSAL' : 'EVENTUAL') },
  forma: { rotulo: 'Forma', valor: (d) => d.forma || '' },
  status: { rotulo: 'Status', valor: (d) => rotulo(d.status) },
  // compras parceladas que ainda terão parcela no mês escolhido (clique no gráfico de parcelamentos)
  parcelasEm: { rotulo: 'Parcelas em', aceita: (d, mes) => !!d.mesRef && ehParcelado(d) && terminaEm(d) >= mes },
};

const ehParcelado = (d) => rotulo(d.forma).includes('PARCELADO') && (parseParcela(d.parcelas)?.n || 0) > 1;
const terminaEm = (d) => {
  const p = parseParcela(d.parcelas);
  return somarMeses(d.mesRef, p.n - p.k);
};

// filtros: { campo: { valor, texto } } — "exceto" ignora alguns (ex.: o quadro de tipos não se filtra pelo tipo)
export function filtrarDespesas(lista, filtros, exceto = []) {
  const ativos = Object.entries(filtros || {}).filter(([k, f]) => f && !exceto.includes(k) && FILTROS[k]);
  if (!ativos.length) return lista;
  return lista.filter((d) => ativos.every(([k, f]) => (FILTROS[k].aceita ? FILTROS[k].aceita(d, f.valor) : FILTROS[k].valor(d) === f.valor)));
}

export function totaisMes(dados, mes, filtros = null) {
  if (typeof filtros === 'string') filtros = { tipo: { valor: filtros } };
  const despesas = filtrarDespesas(doMes(dados.despesas, mes), filtros);
  const receitas = doMes(dados.receitas, mes);
  const receita = soma(receitas);
  const despesa = soma(despesas);
  return {
    receita,
    despesa,
    saldo: receita - despesa,
    poupanca: receita > 0 ? (receita - despesa) / receita : null,
    qtdReceitas: receitas.length,
    qtdDespesas: despesas.length,
    despesas,
    receitas,
  };
}

export function serieMeses(dados, mesFim, n = 12, filtros = null) {
  const meses = [];
  for (let i = n - 1; i >= 0; i--) {
    const mes = somarMeses(mesFim, -i);
    const t = totaisMes(dados, mes, filtros);
    meses.push({ mes, receita: t.receita, despesa: t.despesa, saldo: t.saldo });
  }
  return meses;
}

// Despesas por tipo no período + média dos 6 meses anteriores (só meses com lançamentos),
// na mesma escala do período (média mensal × nº de meses selecionados)
export function porTipo(dados, mes, filtros = null) {
  const meses = Array.isArray(mes) ? [...mes].sort() : [mes];
  const doFiltro = (lista) => filtrarDespesas(lista, filtros, ['tipo']);
  const atual = new Map();
  for (const d of doFiltro(doMes(dados.despesas, meses))) atual.set(tipoDe(d), (atual.get(tipoDe(d)) || 0) + d.valor);

  const anteriores = [];
  for (let i = 1; i <= 6; i++) {
    const m = somarMeses(meses[0], -i);
    const lista = doFiltro(doMes(dados.despesas, m));
    if (lista.length) anteriores.push(lista);
  }
  const media = new Map();
  for (const lista of anteriores) for (const d of lista) media.set(tipoDe(d), (media.get(tipoDe(d)) || 0) + (d.valor / anteriores.length) * meses.length);

  return [...atual.entries()]
    .filter(([, v]) => Math.abs(v) > 0.005)
    .map(([tipo, valor]) => ({ tipo, valor, media: media.get(tipo) || 0 }))
    .sort((a, b) => b.valor - a.valor);
}

export function fixoVariavel(despesas) {
  let fixo = 0;
  let variavel = 0;
  for (const d of despesas) {
    if (rotulo(d.categoria) === 'FIXO') fixo += d.valor;
    else variavel += d.valor;
  }
  return { fixo, variavel };
}

export function porForma(despesas) {
  const m = new Map();
  for (const d of despesas) {
    const f = d.forma || 'Outros';
    m.set(f, (m.get(f) || 0) + d.valor);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function contasAPagar(dados, mes) {
  return dados.despesas
    .filter((d) => rotulo(d.status) === 'A PAGAR' && d.mesRef && d.mesRef <= mes)
    .sort((a, b) => (a.data && b.data ? a.data.ano - b.data.ano || a.data.mes - b.data.mes || a.data.dia - b.data.dia : 0));
}

// Situação dos parcelamentos no cartão "como estava" no mês selecionado
export function parcelamentos(dados, mes) {
  const series = new Map();
  for (const d of dados.despesas) {
    if (!rotulo(d.forma).includes('PARCELADO') || !d.mesRef || d.mesRef > mes) continue;
    const p = parseParcela(d.parcelas);
    if (!p || p.n <= 1) continue;
    const chave = `${serieDe(d.nome)}|${p.n}|${Math.round(d.valor)}`;
    const atual = series.get(chave);
    if (!atual || d.mesRef > atual.d.mesRef || (d.mesRef === atual.d.mesRef && p.k > atual.p.k)) series.set(chave, { d, p });
  }
  const ativos = [];
  const futuro = new Map();
  for (const { d, p } of series.values()) {
    const restantes = p.n - p.k;
    // parcelamento ativo: última parcela vista no mês ou no anterior, e ainda faltam parcelas (ou é deste mês)
    if (d.mesRef < somarMeses(mes, -1)) continue;
    if (restantes <= 0 && d.mesRef !== mes) continue;
    ativos.push({
      nome: d.nome.replace(RX_PARCELA, '').replace(/\s+-\s*$/, '').trim(),
      tipo: d.tipo,
      valor: d.valor,
      k: p.k,
      n: p.n,
      restante: restantes * d.valor,
      termina: somarMeses(d.mesRef, restantes),
    });
    for (let j = 1; j <= restantes; j++) {
      const m = somarMeses(d.mesRef, j);
      if (m > mes) futuro.set(m, (futuro.get(m) || 0) + d.valor);
    }
  }
  const proximos = [];
  for (let i = 1; i <= 12; i++) {
    const m = somarMeses(mes, i);
    proximos.push({ mes: m, valor: futuro.get(m) || 0 });
  }
  ativos.sort((a, b) => b.restante - a.restante);
  return { ativos, proximos, totalRestante: ativos.reduce((t, a) => t + a.restante, 0) };
}

export function maioresGastos(despesas, n = 5) {
  return [...despesas].filter((d) => d.valor > 0).sort((a, b) => b.valor - a.valor).slice(0, n);
}

// Problemas na planilha que distorcem o painel
export function qualidade(dados) {
  const problemas = [];
  const anoMax = +mesAtual().slice(0, 4) + 3;
  const mesEstranho = (l) => !l.mesRef || +l.mesRef.slice(0, 4) > anoMax || +l.mesRef.slice(0, 4) < 2000;
  const ruimR = dados.receitas.filter(mesEstranho);
  const ruimD = dados.despesas.filter(mesEstranho);
  if (ruimR.length) problemas.push({ texto: `${ruimR.length} receita(s) com mês de referência inválido`, linhas: ruimR.map((l) => l._linha), aba: 'Receitas', exemplo: ruimR[0], impacto: 'Esses lançamentos não aparecem nos totais.' });
  if (ruimD.length) problemas.push({ texto: `${ruimD.length} despesa(s) com mês de referência inválido`, linhas: ruimD.map((l) => l._linha), aba: 'Despesas', exemplo: ruimD[0], impacto: 'Esses lançamentos não aparecem nos totais.' });
  const semTipo = dados.despesas.filter((d) => !d.tipo);
  if (semTipo.length) problemas.push({ texto: `${semTipo.length} despesa(s) sem TIPO`, linhas: semTipo.map((l) => l._linha), aba: 'Despesas', impacto: 'Eles aparecem como “Sem tipo” nos gráficos.', semTipo });
  return problemas;
}

export function ultimoMesComDados(dados) {
  const meses = [...dados.despesas, ...dados.receitas].map((l) => l.mesRef).filter((m) => m && m <= mesAtual());
  return meses.sort().pop() || mesAtual();
}
