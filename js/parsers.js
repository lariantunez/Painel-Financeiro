// Leitura de extratos bancários (CSV do Nubank, OFX de qualquer banco e CSV genérico).
// Saída padronizada:
//   { origem: 'cartao' | 'conta', instituicao, formato, transacoes: [{ id, data, descricao, valor, entrada }] }
// valor é sempre positivo; entrada = true quando o dinheiro entrou (pagamento de fatura, estorno, Pix recebido...).

import { normalizarCabecalho, parseData, parseValor, hashTexto, arred } from './util.js';

const BANCOS_OFX = { '0260': 'NUBANK', '260': 'NUBANK', '237': 'BRADESCO', '0237': 'BRADESCO', '341': 'ITAÚ', '0341': 'ITAÚ' };

export function lerExtrato(texto, nomeArquivo = '', origemForcada = null) {
  const conteudo = String(texto).replace(/^﻿/, '');
  let resultado;
  if (/<OFX>|OFXHEADER/i.test(conteudo)) resultado = lerOFX(conteudo);
  else resultado = lerCSV(conteudo, nomeArquivo);

  if (origemForcada && origemForcada !== resultado.origem) {
    resultado.origem = origemForcada;
  }
  if (!resultado.instituicao) resultado.instituicao = /nubank|nu_/i.test(nomeArquivo) ? 'NUBANK' : '';
  atribuirIds(resultado);
  return resultado;
}

// ───────────────────────────── CSV ─────────────────────────────

export function lerCSV(texto, nomeArquivo = '') {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim());
  if (!linhas.length) throw new Error('Arquivo vazio');

  const delim = detectarDelimitador(linhas[0]);
  const cab = dividirLinhaCSV(linhas[0], delim).map(normalizarCabecalho);
  const col = (...nomes) => cab.findIndex((c) => nomes.some((n) => (n instanceof RegExp ? n.test(c) : c === n)));

  const iData = col('DATE', 'DATA', /^DATA_/, /^DT/);
  const iDesc = col('TITLE', 'DESCRICAO', 'DESCRIPTION', /HISTORICO/, /LANCAMENTO/, /ESTABELECIMENTO/, /^DESCRI/);
  const iValor = col('AMOUNT', 'VALOR', 'VALUE', /^VALOR/);
  const iId = col('IDENTIFICADOR', 'ID');
  if (iData < 0 || iDesc < 0 || iValor < 0) {
    throw new Error('Não reconheci as colunas do CSV (preciso de data, descrição e valor).');
  }

  // Nubank cartão: date,title,amount (compras positivas). Nubank conta: Data,Valor,Identificador,Descrição (saídas negativas).
  const nubankCartao = cab[iData] === 'DATE' && cab[iDesc] === 'TITLE' && cab[iValor] === 'AMOUNT';
  const nubankConta = cab.includes('IDENTIFICADOR') && cab[iDesc] === 'DESCRICAO';

  const brutas = [];
  for (const linha of linhas.slice(1)) {
    const v = dividirLinhaCSV(linha, delim);
    const data = parseData(v[iData]);
    if (!data) continue;
    brutas.push({
      data,
      descricao: (v[iDesc] || '').trim(),
      bruto: parseValor(v[iValor]),
      idOriginal: iId >= 0 ? (v[iId] || '').trim() : '',
    });
  }

  let origem;
  if (nubankCartao) origem = 'cartao';
  else if (nubankConta) origem = 'conta';
  else origem = /fatura|cart|credit|card/i.test(nomeArquivo) ? 'cartao' : 'conta';

  // No cartão o "positivo" é compra; na conta o negativo é saída.
  // Para CSV genérico de cartão que venha com compras negativas, inverte.
  let sinalSaida = origem === 'cartao' ? 1 : -1;
  if (origem === 'cartao' && !nubankCartao) {
    const negativos = brutas.filter((b) => b.bruto < 0).length;
    if (negativos > brutas.length / 2) sinalSaida = -1;
  }

  return {
    origem,
    instituicao: nubankCartao || nubankConta ? 'NUBANK' : '',
    formato: nubankCartao ? 'Nubank (fatura CSV)' : nubankConta ? 'Nubank (conta CSV)' : 'CSV',
    transacoes: brutas
      .filter((b) => b.bruto !== 0)
      .map((b) => ({
        data: b.data,
        descricao: b.descricao,
        valor: arred(Math.abs(b.bruto)),
        entrada: Math.sign(b.bruto) !== sinalSaida,
        idOriginal: b.idOriginal,
      })),
  };
}

function detectarDelimitador(linha) {
  const conta = (c) => dividirLinhaCSV(linha, c).length;
  return [';', ',', '\t'].reduce((melhor, c) => (conta(c) > conta(melhor) ? c : melhor), ',');
}

export function dividirLinhaCSV(linha, delim = ',') {
  const valores = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (aspas && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else aspas = !aspas;
    } else if (c === delim && !aspas) {
      valores.push(atual);
      atual = '';
    } else atual += c;
  }
  valores.push(atual);
  return valores.map((v) => v.trim());
}

// CSV completo (com quebras de linha dentro de aspas) -> array de objetos pelo cabeçalho
export function csvParaObjetos(texto) {
  const linhas = [];
  let atual = '';
  let aspas = false;
  for (const c of String(texto).replace(/^﻿/, '')) {
    if (c === '"') aspas = !aspas;
    if ((c === '\n') && !aspas) {
      linhas.push(atual.replace(/\r$/, ''));
      atual = '';
    } else atual += c;
  }
  if (atual.trim()) linhas.push(atual);
  const validas = linhas.filter((l) => l.trim());
  if (!validas.length) return [];
  const cab = dividirLinhaCSV(validas[0]).map(normalizarCabecalho);
  return validas.slice(1).map((l, i) => {
    const v = dividirLinhaCSV(l);
    const obj = { _linha: i + 2 };
    cab.forEach((c, j) => {
      if (c) obj[c] = v[j] ?? '';
    });
    return obj;
  });
}

// ───────────────────────────── OFX ─────────────────────────────

export function lerOFX(texto) {
  const tag = (bloco, nome) => {
    const m = bloco.match(new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i'));
    return m ? m[1].trim() : '';
  };
  const cartao = /<CREDITCARDMSGSRSV1>|<CCSTMTRS>/i.test(texto);
  const banco = tag(texto, 'BANKID');
  const org = tag(texto, 'ORG').toUpperCase();
  const instituicao = BANCOS_OFX[banco] || (/NU ?PAGAMENTOS|NUBANK/.test(org) ? 'NUBANK' : /BRADESCO/.test(org) ? 'BRADESCO' : /ITAU/.test(org) ? 'ITAÚ' : '');

  const transacoes = [];
  for (const bloco of texto.split(/<STMTTRN>/i).slice(1)) {
    const data = parseData(tag(bloco, 'DTPOSTED'));
    const valor = parseValor(tag(bloco, 'TRNAMT').replace(',', '.'));
    if (!data || !valor) continue;
    const memo = tag(bloco, 'MEMO');
    const nome = tag(bloco, 'NAME');
    transacoes.push({
      data,
      descricao: decodificarEntidades(memo && nome && !memo.includes(nome) ? `${nome} - ${memo}` : memo || nome),
      valor: arred(Math.abs(valor)),
      entrada: valor > 0,
      idOriginal: tag(bloco, 'FITID'),
    });
  }
  return { origem: cartao ? 'cartao' : 'conta', instituicao, formato: 'OFX', transacoes };
}

function decodificarEntidades(t) {
  return t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// ───────────────────────────── IDs ─────────────────────────────

// ID estável por transação: usa o identificador do banco quando existe;
// senão hash(data|descrição|valor|ocorrência) — a ocorrência diferencia compras idênticas no mesmo dia.
function atribuirIds(resultado) {
  const ocorrencias = {};
  for (const t of resultado.transacoes) {
    const base = `${t.data.ano}-${t.data.mes}-${t.data.dia}|${t.descricao}|${t.valor}|${t.entrada ? 'E' : 'S'}`;
    ocorrencias[base] = (ocorrencias[base] || 0) + 1;
    const semente = t.idOriginal || `${base}|${ocorrencias[base]}`;
    t.id = `${(resultado.instituicao || 'X').slice(0, 3)}-${resultado.origem === 'cartao' ? 'C' : 'D'}-${hashTexto(semente)}`;
    delete t.idOriginal;
  }
}
