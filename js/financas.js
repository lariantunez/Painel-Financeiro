// Análise financeira (sem DOM): diagnóstico, pontos críticos, oportunidades, cenários e reserva.
// Tudo calculado dos lançamentos, numa janela de meses já fechados (o mês atual ainda está incompleto).

import { rotulo, somarMeses, mesAtual, parseParcela } from './util.js';
import { serieDe } from './fixas.js';
import { tipoDe, ehSalario, donoDoSalario } from './analise.js';

export const PESSOAS = ['LARISSA', 'DOUGLAS', 'CASAL'];
// Quem tem renda individual (o salário do casal não entra na concentração nem no teste de estresse por pessoa)
export const INDIVIDUAIS = ['LARISSA', 'DOUGLAS'];

// Tipos que contam como necessidade (moradia, comida, saúde, deslocamento, contas). O resto é estilo de vida.
// A pessoa pode trocar na tela; isto é só o ponto de partida.
export const NECESSIDADES_PADRAO = ['CASA', 'ALIMENTACAO', 'SAUDE', 'TRANSPORTE', 'CARRO', 'MOTO', 'EDUCACAO', 'COMUNICACAO', 'TAXAS'];

const ehReembolso = (r) => /REEMB|REMB|ESTORNO|DEVOLU/.test(rotulo(`${r.tipo} ${r.nome}`)) && !ehSalario(r);
const ehFinanciamento = (d) => /FINANCIAMENTO|EMPRESTIMO|CONSORCIO/.test(rotulo(d.nome));
const ehParceladoCartao = (d) => rotulo(d.forma).includes('PARCELADO') && !ehFinanciamento(d);
const ehFixo = (d) => rotulo(d.categoria) === 'FIXO';
const ehSeguro = (d) => /SEGURO|SUHAI/.test(rotulo(d.nome));
const ehObrigatorio = (d) => /IPVA|IPTU|LICENCIAMENTO|DPVAT|IMPOSTO|IRPF/.test(rotulo(d.nome)) || ehSeguro(d);
const MOBILIDADE = ['CARRO', 'MOTO', 'TRANSPORTE'];

const soma = (lista, f = (x) => x.valor) => lista.reduce((s, x) => s + (f(x) || 0), 0);
const media = (nums) => (nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : 0);
function quantil(nums, q) {
  if (!nums.length) return 0;
  const o = [...nums].sort((a, b) => a - b);
  const pos = (o.length - 1) * q;
  const i = Math.floor(pos);
  return o[i] + (o[Math.min(i + 1, o.length - 1)] - o[i]) * (pos - i);
}
const desvio = (nums) => {
  const m = media(nums);
  return Math.sqrt(media(nums.map((x) => (x - m) ** 2)));
};

// Juros: taxa anual → mensal equivalente; valor futuro de aportes mensais
export const taxaMensal = (anual) => (1 + anual) ** (1 / 12) - 1;
export function valorFuturo(aporteMensal, meses, taxaAnual) {
  const i = taxaMensal(taxaAnual);
  return i === 0 ? aporteMensal * meses : aporteMensal * (((1 + i) ** meses - 1) / i);
}
// Taxa real: o que sobra do rendimento depois da inflação (valores em reais de hoje)
export const taxaReal = (nominal, inflacao) => (1 + nominal) / (1 + inflacao) - 1;

export function ultimoMesFechado() {
  return somarMeses(mesAtual(), -1);
}

export function janela(n, fim = ultimoMesFechado()) {
  return Array.from({ length: n }, (_, i) => somarMeses(fim, i - n + 1));
}

// ───────────── Análise completa ─────────────
// opcoes: { meses (6|12), fim, reserva (R$ guardado hoje), necessidades (tipos), taxaAnual, inflacao }
export function analisarFinancas(dados, opcoes = {}) {
  const { meses: n = 12, fim = ultimoMesFechado(), reserva = null, taxaAnual = 0.12, inflacao = 0.045 } = opcoes;
  const necessidades = new Set((opcoes.necessidades || NECESSIDADES_PADRAO).map(rotulo));
  const periodo = janela(n, fim);
  const noPeriodo = new Set(periodo);
  const despesas = dados.despesas.filter((d) => noPeriodo.has(d.mesRef));
  const receitas = dados.receitas.filter((r) => noPeriodo.has(r.mesRef));
  const ehNecessidade = (d) => necessidades.has(rotulo(tipoDe(d)));

  // Mês a mês
  const mensal = periodo.map((mes) => {
    const D = despesas.filter((d) => d.mesRef === mes);
    const R = receitas.filter((r) => r.mesRef === mes);
    const reembolsos = soma(R.filter(ehReembolso));
    const salarios = Object.fromEntries(PESSOAS.map((p) => [p, 0]));
    for (const r of R) {
      const dono = ehSalario(r) && donoDoSalario(r, PESSOAS);
      if (dono) salarios[dono] += r.valor;
    }
    const renda = soma(R) - reembolsos;
    const bruto = soma(D);
    return {
      mes,
      renda,
      salarios,
      reembolsos,
      despesas: bruto,
      gasto: bruto - reembolsos, // gasto líquido: o que foi devolvido por outras pessoas não é gasto da casa
      saldo: renda + reembolsos - bruto,
      fixo: soma(D.filter(ehFixo)),
      financiamentos: soma(D.filter(ehFinanciamento)),
      parcelado: soma(D.filter(ehParceladoCartao)),
      necessidades: soma(D.filter(ehNecessidade)),
      mobilidade: soma(D.filter((d) => MOBILIDADE.includes(rotulo(tipoDe(d))))),
      temDados: D.length > 0 || R.length > 0,
    };
  });
  const comDados = mensal.filter((m) => m.temDados);
  const k = Math.max(1, comDados.length);
  const med = (campo) => soma(comDados, (m) => m[campo]) / k;
  const m = {
    renda: med('renda'),
    reembolsos: med('reembolsos'),
    despesas: med('despesas'),
    gasto: med('gasto'),
    saldo: med('saldo'),
    fixo: med('fixo'),
    financiamentos: med('financiamentos'),
    parcelado: med('parcelado'),
    necessidades: med('necessidades'),
    mobilidade: med('mobilidade'),
  };
  m.estilo = Math.max(0, m.despesas - m.necessidades);
  m.dividas = m.financiamentos + m.parcelado;
  m.variavel = m.despesas - m.fixo;
  const pctRenda = (v) => (m.renda > 0 ? v / m.renda : 0);
  const poupanca = m.renda + m.reembolsos > 0 ? m.saldo / (m.renda + m.reembolsos) : 0;
  const mesesNegativos = comDados.filter((x) => x.saldo < 0).length;
  const deficitAcumulado = soma(comDados.filter((x) => x.saldo < 0), (x) => -x.saldo);
  const resultadoAcumulado = soma(comDados, (x) => x.saldo);
  const rendas = comDados.map((x) => x.renda);
  const cvRenda = media(rendas) > 0 ? desvio(rendas) / media(rendas) : 0;

  // Renda por pessoa
  const salarioPessoa = Object.fromEntries(PESSOAS.map((p) => [p, soma(comDados, (x) => x.salarios[p]) / k]));
  const outrasRendas = Math.max(0, m.renda - Object.values(salarioPessoa).reduce((s, v) => s + v, 0));
  const maiorRenda = Object.entries(salarioPessoa).filter(([p]) => INDIVIDUAIS.includes(p)).sort((a, b) => b[1] - a[1])[0];

  // Tipos: total, média, peso, tendência (últimos 3 × 3 anteriores) e o nível dos meses mais econômicos (1º quartil)
  const tiposNomes = [...new Set(despesas.map(tipoDe))];
  const tipos = tiposNomes
    .map((tipo) => {
      const doTipo = despesas.filter((d) => tipoDe(d) === tipo);
      const serie = periodo.map((mes) => soma(doTipo.filter((d) => d.mesRef === mes)));
      // parte eventual (sem contas mensais nem financiamentos): é a que dá para ajustar de um mês para outro
      const eventuais = doTipo.filter((d) => d.recorrencia !== 'MENSAL' && !ehFinanciamento(d) && !ehObrigatorio(d));
      const serieEventual = periodo.map((mes) => soma(eventuais.filter((d) => d.mesRef === mes)));
      const total = soma(doTipo);
      const ult3 = media(serie.slice(-3));
      const ant3 = media(serie.slice(-6, -3));
      const destinos = topDestinos(doTipo, 3);
      return {
        tipo,
        serie,
        total,
        media: total / k,
        p25: quantil(serie, 0.25),
        mediana: quantil(serie, 0.5),
        tendencia: ant3 > 0 ? ult3 / ant3 - 1 : null,
        ult3,
        ant3,
        fixoParte: total > 0 ? soma(doTipo.filter(ehFixo)) / total : 0,
        eventual: { media: soma(eventuais) / k, p25: quantil(serieEventual, 0.25), destinos: topDestinos(eventuais, 3) },
        necessidade: necessidades.has(rotulo(tipo)),
        destinos,
      };
    })
    .filter((t) => t.total > 0)
    .sort((a, b) => b.total - a.total);
  const totalTipos = soma(tipos, (t) => t.total);
  let acumulado = 0;
  for (const t of tipos) {
    t.pct = totalTipos ? t.total / totalTipos : 0;
    acumulado += t.pct;
    t.acumulado = acumulado;
  }
  const pareto = tipos.findIndex((t) => t.acumulado >= 0.8) + 1;

  const destinos = topDestinos(despesas, 12);

  // Assinaturas e serviços mensais (último valor de cada um)
  const recentes = new Set(periodo.slice(-2));
  const assinaturas = [];
  const vistas = new Set();
  for (const d of [...despesas].sort((a, b) => b.mesRef.localeCompare(a.mesRef))) {
    if (!recentes.has(d.mesRef) || d.recorrencia !== 'MENSAL' || d.valor > 300 || ehFinanciamento(d) || ehSeguro(d)) continue;
    if (['CASA', 'TAXAS'].includes(rotulo(tipoDe(d)))) continue; // luz, água, impostos: não dá para cancelar
    const chave = serieDe(d.nome);
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    assinaturas.push({ nome: d.nome, tipo: tipoDe(d), valor: d.valor });
  }
  assinaturas.sort((a, b) => b.valor - a.valor);
  // Mesma marca cobrando duas vezes (ex.: "Netflix" e "Netflix.Com")
  const marca = (nome) => rotulo(nome).split(/[^A-Z0-9]+/).find((p) => p.length >= 4) || rotulo(nome);
  const porMarca = new Map();
  for (const x of assinaturas) porMarca.set(marca(x.nome), [...(porMarca.get(marca(x.nome)) || []), x]);
  const duplicadas = [...porMarca.values()].filter((l) => l.length > 1);
  const totalAssinaturas = soma(assinaturas);

  const seguros = topDestinos(despesas.filter(ehSeguro), 10);
  const totalSeguros = soma(seguros, (s) => s.total);

  // Financiamentos: quanto falta e quando acabam (pela parcela k/n mais recente)
  const financiamentos = [];
  const ultimos = new Map();
  for (const d of dados.despesas.filter(ehFinanciamento)) {
    const chave = serieDe(d.nome);
    if (!ultimos.has(chave) || d.mesRef > ultimos.get(chave).mesRef) ultimos.set(chave, d);
  }
  for (const d of ultimos.values()) {
    const p = parseParcela(d.parcelas);
    if (!p || d.mesRef < somarMeses(fim, -2)) continue;
    const restantes = Math.max(0, p.n - p.k);
    financiamentos.push({ nome: d.nome, valor: d.valor, k: p.k, n: p.n, restantes, termina: somarMeses(d.mesRef, restantes), falta: restantes * d.valor, ultimoMes: d.mesRef });
  }
  financiamentos.sort((a, b) => a.restantes - b.restantes);

  // Reserva de emergência: 6 meses do custo essencial
  const custoEssencial = m.necessidades;
  const reservaAlvo = custoEssencial * 6;
  const mesesReserva = reserva != null && custoEssencial > 0 ? reserva / custoEssencial : null;
  const temCnpj = despesas.some((d) => /CNPJ|\bDAS\b|\bMEI\b/.test(rotulo(d.nome)));

  // Quanto precisaria mudar por mês para a conta fechar no zero
  const variaveisAjustaveis = Math.max(0, m.gasto - m.fixo);
  const equilibrio = m.saldo < 0 ? { falta: -m.saldo, pctVariaveis: variaveisAjustaveis ? -m.saldo / variaveisAjustaveis : null, pctRenda: m.renda ? -m.saldo / m.renda : null } : null;

  const base = { equilibrio, duplicadas, periodo, mensal, m, poupanca, mesesNegativos, deficitAcumulado, resultadoAcumulado, cvRenda, salarioPessoa, outrasRendas, maiorRenda, tipos, pareto, destinos, assinaturas, totalAssinaturas, seguros, totalSeguros, financiamentos, custoEssencial, reservaAlvo, reserva, mesesReserva, temCnpj, pctRenda, k, taxaAnual, inflacao };
  base.nota = notaSaude(base);
  base.alertas = alertas(base);
  base.oportunidades = oportunidades(base);
  return base;
}

function topDestinos(lista, n) {
  const mapa = new Map();
  for (const d of lista) {
    const chave = serieDe(d.nome);
    const x = mapa.get(chave) || { nome: d.nome.replace(/\s*-?\s*Parcela.*$/i, '').trim(), chave, total: 0, vezes: 0, tipo: tipoDe(d), mensal: false };
    x.total += d.valor;
    x.vezes += 1;
    x.mensal ||= d.recorrencia === 'MENSAL';
    mapa.set(chave, x);
  }
  return [...mapa.values()].filter((x) => x.total > 0).sort((a, b) => b.total - a.total).slice(0, n);
}

// ───────────── Nota de saúde financeira (0 a 100) ─────────────
// Escala linear entre "ruim" e "bom" em cada critério; pesos somam 100
const faixa = (v, ruim, bom) => Math.max(0, Math.min(1, (v - ruim) / (bom - ruim)));
function notaSaude(a) {
  const { m, poupanca, cvRenda, mesesReserva, pctRenda } = a;
  const componentes = [
    { nome: 'Sobra no mês', peso: 30, nota: faixa(poupanca, -0.2, 0.2), valor: poupanca, ideal: 'guardar 20% da renda' },
    { nome: 'Peso das dívidas', peso: 25, nota: faixa(pctRenda(m.dividas), 0.5, 0.15), valor: pctRenda(m.dividas), ideal: 'até 30% da renda' },
    { nome: 'Peso dos gastos fixos', peso: 15, nota: faixa(pctRenda(m.fixo), 0.9, 0.5), valor: pctRenda(m.fixo), ideal: 'até 50% da renda' },
    { nome: 'Estabilidade da renda', peso: 15, nota: faixa(cvRenda, 0.6, 0.15), valor: cvRenda, ideal: 'variação abaixo de 15%' },
    { nome: 'Reserva de emergência', peso: 15, nota: mesesReserva == null ? 0 : faixa(mesesReserva, 0, 6), valor: mesesReserva, ideal: '6 meses do custo essencial' },
  ];
  const nota = Math.round(componentes.reduce((s, c) => s + c.nota * c.peso, 0));
  const nivel = nota >= 75 ? 'bom' : nota >= 50 ? 'atencao' : 'critico';
  return { nota, nivel, componentes };
}

// ───────────── Pontos críticos ─────────────
// nivel: critico | atencao | bom — sempre com um texto que explica o número
function alertas(a) {
  const { m, poupanca, mesesNegativos, deficitAcumulado, resultadoAcumulado, pctRenda, k, tipos, cvRenda, salarioPessoa, mesesReserva, reserva, custoEssencial, financiamentos } = a;
  const lista = [];

  if (m.saldo < 0) {
    lista.push({ nivel: 'critico', titulo: 'Os gastos estão maiores que a renda', valor: m.saldo, formato: 'moeda',
      texto: `Em ${mesesNegativos} de ${k} meses saiu mais dinheiro do que entrou. No período o resultado foi de ${fmt(resultadoAcumulado)} (${fmt(m.saldo)} por mês, em média). Se isso não bate com a realidade, pode haver entradas fora da planilha — resgates da caixinha, por exemplo, não são importados.` });
  } else if (poupanca < 0.1) {
    lista.push({ nivel: 'atencao', titulo: 'Sobra pouco no fim do mês', valor: poupanca, formato: 'pct', texto: `Vocês guardam ${pctTexto(poupanca)} do que entra. A referência é de pelo menos 10% a 20%. Mesmo assim ${mesesNegativos} mês(es) fecharam no vermelho, somando ${fmt(deficitAcumulado)}.` });
  } else {
    lista.push({ nivel: 'bom', titulo: 'A conta fecha no azul', valor: poupanca, formato: 'pct', texto: `Sobram ${pctTexto(poupanca)} do que entra (${fmt(m.saldo)}/mês).` });
  }

  const dividas = pctRenda(m.dividas);
  if (m.dividas > 0) {
    lista.push({ nivel: dividas > 0.35 ? 'critico' : dividas > 0.25 ? 'atencao' : 'bom', titulo: 'Comprometimento com dívidas', valor: dividas, formato: 'pct',
      texto: `${fmt(m.financiamentos)}/mês em financiamentos e ${fmt(m.parcelado)}/mês em compras parceladas no cartão: ${pctTexto(dividas)} da renda. Bancos consideram saudável até 30%.${financiamentos.length ? ` ${financiamentos.map((f) => `${f.nome}: faltam ${f.restantes} parcelas`).join('; ')}.` : ''}` });
  }

  const fixo = pctRenda(m.fixo);
  lista.push({ nivel: fixo > 0.65 ? 'critico' : fixo > 0.5 ? 'atencao' : 'bom', titulo: 'Gastos fixos', valor: fixo, formato: 'pct',
    texto: `Os gastos fixos levam ${fmt(m.fixo)}/mês, ${pctTexto(fixo)} da renda, antes de qualquer gasto do dia a dia. Quanto maior essa fatia, menos espaço para imprevistos. Referência: até 50%.` });

  const mob = pctRenda(m.mobilidade);
  if (m.mobilidade > 0) {
    lista.push({ nivel: mob > 0.3 ? 'critico' : mob > 0.18 ? 'atencao' : 'bom', titulo: 'Custo de mobilidade (carro, moto e transporte)', valor: mob, formato: 'pct',
      texto: `Somando parcelas, seguro, impostos, combustível e manutenção, são ${fmt(m.mobilidade)}/mês (${fmt(m.mobilidade * 12)} por ano), ${pctTexto(mob)} da renda. Uma referência comum é ficar entre 10% e 15%.` });
  }

  const totalSal = Object.values(salarioPessoa).reduce((s, v) => s + v, 0);
  const [pessoa, valorPessoa] = Object.entries(salarioPessoa).filter(([p]) => INDIVIDUAIS.includes(p)).sort((x, y) => y[1] - x[1])[0] || [];
  if (totalSal > 0 && valorPessoa / totalSal > 0.65) {
    lista.push({ nivel: 'atencao', titulo: 'Renda concentrada em uma pessoa', valor: valorPessoa / totalSal, formato: 'pct',
      texto: `${pctTexto(valorPessoa / totalSal)} dos salários vêm de ${capital(pessoa)}. Se essa renda parar, faltariam cerca de ${fmt(Math.max(0, valorPessoa - m.saldo))} por mês.` });
  }
  if (cvRenda > 0.35) {
    lista.push({ nivel: 'atencao', titulo: 'Renda muito irregular', valor: cvRenda, formato: 'pct',
      texto: `A renda varia em média ${pctTexto(cvRenda)} de um mês para outro. Com renda irregular, planeje o mês pelo valor dos meses mais fracos e guarde o excedente dos meses bons.` });
  }

  for (const t of tipos.filter((t) => t.tendencia != null && t.tendencia > 0.3 && t.ult3 - t.ant3 > 300).slice(0, 3)) {
    lista.push({ nivel: 'atencao', titulo: `${capital(t.tipo)} em alta`, valor: t.tendencia, formato: 'pct+',
      texto: `Nos últimos 3 meses a média foi ${fmt(t.ult3)}/mês, contra ${fmt(t.ant3)}/mês nos 3 anteriores (+${pctTexto(t.tendencia)}).${t.destinos.length ? ` Principais: ${t.destinos.map((x) => x.nome).join(', ')}.` : ''}`, tipo: t.tipo });
  }

  if (reserva == null) {
    lista.push({ nivel: 'atencao', titulo: 'Reserva de emergência não informada', texto: `Informe abaixo quanto vocês têm guardado para ver quantos meses a reserva cobre. O custo essencial de vocês é de ${fmt(custoEssencial)}/mês.` });
  } else {
    lista.push({ nivel: mesesReserva < 3 ? 'critico' : mesesReserva < 6 ? 'atencao' : 'bom', titulo: 'Reserva de emergência', valor: mesesReserva, formato: 'meses',
      texto: `${fmt(reserva)} guardados cobrem ${mesesReserva.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mês(es) do custo essencial (${fmt(custoEssencial)}/mês). O recomendado é 6 meses.` });
  }

  for (const l of a.duplicadas) {
    lista.push({ nivel: 'atencao', titulo: 'Possível assinatura em dobro', valor: soma(l), formato: 'moeda',
      texto: `${l.map((x) => `${x.nome} (${fmt(x.valor)})`).join(' e ')} aparecem como cobranças mensais separadas. Confira se não são duas contas do mesmo serviço.` });
  }
  if (m.reembolsos > 500) {
    lista.push({ nivel: 'atencao', titulo: 'Dinheiro adiantado para outras pessoas', valor: m.reembolsos, formato: 'moeda',
      texto: `Em média ${fmt(m.reembolsos)}/mês voltam como reembolso. Esse dinheiro sai antes e volta depois, apertando o caixa no meio do mês. Quando der, peça para cada um pagar a sua parte direto. Se parte disso é dinheiro de vocês mesmos para as contas da casa, lance como transferência ou salário para a renda ficar certa.` });
  }
  const ordem = { critico: 0, atencao: 1, bom: 2 };
  return lista.sort((x, y) => ordem[x.nivel] - ordem[y.nivel]);
}

// ───────────── Oportunidades (ordenadas pela economia) ─────────────
function oportunidades(a) {
  const { tipos, assinaturas, totalAssinaturas, totalSeguros, seguros, m, k, taxaAnual, inflacao, financiamentos } = a;
  const real = taxaReal(taxaAnual, inflacao);
  const lista = [];
  const add = (o) => lista.push({ ...o, anual: o.mensal * 12, cincoAnos: valorFuturo(o.mensal, 60, real) });

  // Gastos eventuais de cada tipo: a meta é o nível dos meses mais econômicos (1 em cada 4), que já aconteceu de verdade
  for (const t of tipos) {
    const e = t.eventual;
    const economia = e.media - e.p25;
    if (economia < 100) continue;
    add({ tipo: t.tipo, titulo: `${capital(t.tipo)}: voltar ao nível dos meses mais econômicos`, mensal: economia, estimativa: false,
      texto: `Os gastos eventuais com ${t.tipo.toLowerCase()} ficam em ${fmt(e.media)}/mês na média. Em 1 de cada 4 meses ficaram em até ${fmt(e.p25)} — vocês já conseguiram gastar menos.${e.destinos.length ? ` Maiores: ${e.destinos.map((x) => `${x.nome} (${fmt(x.total)})`).join(', ')}.` : ''}` });
  }
  if (assinaturas.length >= 3) {
    add({ titulo: 'Revisar assinaturas e serviços mensais', mensal: totalAssinaturas * 0.3, estimativa: true,
      texto: `${assinaturas.length} cobranças mensais pequenas somam ${fmt(totalAssinaturas)}/mês (${fmt(totalAssinaturas * 12)}/ano): ${assinaturas.slice(0, 8).map((x) => x.nome).join(', ')}. Cancelar o que pouco usam e renegociar planos costuma cortar um terço.` });
  }
  if (totalSeguros > 0) {
    add({ titulo: 'Cotar os seguros na renovação', mensal: (totalSeguros / k) * 0.12, estimativa: true,
      texto: `${seguros.map((s) => s.nome).join(', ')}: ${fmt(totalSeguros)} no período. Comparar com 3 seguradoras e ajustar a franquia na renovação costuma reduzir de 10% a 15%.` });
  }
  const moto = tipos.find((t) => rotulo(t.tipo) === 'MOTO');
  const carro = tipos.find((t) => rotulo(t.tipo) === 'CARRO');
  if (moto && carro && moto.media > 300) {
    add({ tipo: moto.tipo, titulo: 'Avaliar se vale manter carro e moto', mensal: moto.media, estimativa: true, cenario: true,
      texto: `A moto custa ${fmt(moto.media)}/mês (${fmt(moto.media * 12)}/ano, com parcela, seguro, IPVA e manutenção) e o carro ${fmt(carro.media)}/mês. Se um dos dois é pouco usado, vender reduz o custo e ainda libera o valor da venda.` });
  }
  if (m.parcelado > 0) {
    add({ titulo: 'Trocar compras parceladas por à vista com desconto', mensal: m.parcelado * 0.05, estimativa: true,
      texto: `${fmt(m.parcelado)}/mês vão para parcelas no cartão. Parcelar compromete a renda dos próximos meses; à vista, peça desconto (5% é comum) e só compre o que couber no mês.` });
  }
  const carroFin = financiamentos.find((f) => /CARRO|VEICULO|AUTO/.test(rotulo(f.nome)));
  if (carroFin) {
    add({ titulo: `Amortizar o ${carroFin.nome.toLowerCase()}`, mensal: 0, estimativa: true, semValor: true,
      texto: `Faltam ${carroFin.restantes} parcelas de ${fmt(carroFin.valor)} (${fmt(carroFin.falta)}). Peça ao banco o CET do contrato: se for maior que o rendimento líquido de um investimento seguro, cada real amortizado rende mais do que investido — e sem risco. Prefira reduzir o número de parcelas.` });
  }
  return lista.sort((x, y) => y.mensal - x.mensal);
}

// ───────────── Cenários (patrimônio mês a mês, em reais de hoje) ─────────────
// ajustes: { corteVariaveis (0..1), aumentoRenda (0..1), quitacoes: true usa o fim dos financiamentos }
export function cenario(a, { corteVariaveis = 0, aumentoRenda = 0, quitacoes = false, meses = 60, perdaRenda = 0 } = {}) {
  const real = taxaMensal(taxaReal(a.taxaAnual, a.inflacao));
  const variaveisCortaveis = Math.max(0, a.m.gasto - a.m.fixo);
  let saldo = a.m.saldo + variaveisCortaveis * corteVariaveis + a.m.renda * aumentoRenda - perdaRenda;
  let patrimonio = a.reserva || 0;
  const pontos = [patrimonio];
  // a parcela some da conta no mês seguinte ao último pagamento
  const fins = quitacoes ? a.financiamentos.map((f) => ({ mes: mesesEntre(a.periodo.at(-1), f.termina) + 1, valor: f.valor })) : [];
  for (let i = 1; i <= meses; i++) {
    for (const f of fins) if (i === f.mes) saldo += f.valor;
    // saldo negativo vira dívida: no cheque especial o custo seria bem maior que a taxa usada aqui
    patrimonio = patrimonio * (1 + real) + saldo;
    pontos.push(patrimonio);
  }
  pontos.sobra = a.m.saldo + variaveisCortaveis * corteVariaveis + a.m.renda * aumentoRenda - perdaRenda; // sobra do 1º mês
  return pontos;
}

const mesesEntre = (a, b) => {
  const [a1, m1] = a.split('-').map(Number);
  const [a2, m2] = b.split('-').map(Number);
  return (a2 - a1) * 12 + (m2 - m1);
};

// Plano da reserva: quanto guardar por mês para chegar à meta no prazo
export function planoReserva(a, prazoMeses = 12) {
  const falta = Math.max(0, a.reservaAlvo - (a.reserva || 0));
  return { falta, porMes: falta / prazoMeses, prazoMeses };
}

// Alocação de referência por perfil (soma 100%). É ponto de partida, não recomendação individual.
export const PERFIS = {
  conservador: { nome: 'Conservador', classes: [['Pós-fixado com liquidez (Tesouro Selic, CDB 100% CDI)', 0.6], ['Inflação (Tesouro IPCA+)', 0.25], ['Prefixado', 0.1], ['Fundos imobiliários', 0.05]] },
  moderado: { nome: 'Moderado', classes: [['Pós-fixado com liquidez (Tesouro Selic, CDB 100% CDI)', 0.35], ['Inflação (Tesouro IPCA+)', 0.25], ['Prefixado', 0.1], ['Ações Brasil (ETF)', 0.12], ['Fundos imobiliários', 0.1], ['Exterior (ETF)', 0.08]] },
  arrojado: { nome: 'Arrojado', classes: [['Pós-fixado com liquidez (Tesouro Selic, CDB 100% CDI)', 0.2], ['Inflação (Tesouro IPCA+)', 0.2], ['Prefixado', 0.05], ['Ações Brasil (ETF)', 0.25], ['Fundos imobiliários', 0.12], ['Exterior (ETF)', 0.18]] },
};

const fmtMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const fmt = (v) => fmtMoeda.format(Math.round(v || 0));
const pctTexto = (v) => `${Math.round((v || 0) * 100)}%`;
const capital = (t) => String(t || '').toLowerCase().replace(/(^|[\s/])\p{L}/gu, (c) => c.toUpperCase());
