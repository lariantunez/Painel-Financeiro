/**
 * Backend do Painel Financeiro.
 *
 * Instalação (uma única vez):
 *   1. Na planilha: Extensões > Apps Script. Apague o conteúdo e cole este arquivo.
 *   2. Selecione a função "configurar" e clique em Executar (autorize o acesso).
 *      O TOKEN aparece no "Registro de execução" — copie.
 *   3. Implantar > Nova implantação > Tipo "App da Web"
 *        Executar como: Eu  |  Quem pode acessar: Qualquer pessoa
 *      Copie a URL que termina em /exec.
 *   4. No painel: Configurações > cole a URL e o TOKEN.
 *
 * Quem não tiver o TOKEN não consegue ler nem gravar nada.
 */

const ABAS = { DESPESAS: 'Despesas', RECEITAS: 'Receitas', REGRAS: 'Regras', IMPORTACOES: 'Importacoes' };
const COLUNAS_EXTRAS = ['ID_IMPORTACAO', 'DESCRICAO_ORIGINAL'];
const CAB_REGRAS = ['CHAVE', 'DESTINO', 'NOME', 'TIPO', 'CATEGORIA', 'TITULAR', 'PERGUNTAR', 'USOS', 'ATUALIZADO'];
const CAB_IMPORTACOES = ['LOTE', 'DATA', 'DESPESAS', 'RECEITAS', 'DESCRICAO', 'IDS', 'DESFEITO'];
const COLUNAS_DATA = ['VENCIMENTO'];
const COLUNAS_MES = ['MES_DE_REFERENCIA', 'DATA'];

// ───────────────────────── Configuração ─────────────────────────

function configurar() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('TOKEN', token);
  }
  prepararAbas_();
  Logger.log('TOKEN do painel: ' + token);
  return token;
}

function prepararAbas_() {
  const ss = SpreadsheetApp.getActive();
  garantirColunas_(ss.getSheetByName(ABAS.DESPESAS), COLUNAS_EXTRAS);
  garantirColunas_(ss.getSheetByName(ABAS.RECEITAS), COLUNAS_EXTRAS);
  abaComCabecalho_(ABAS.REGRAS, CAB_REGRAS);
  abaComCabecalho_(ABAS.IMPORTACOES, CAB_IMPORTACOES);
}

// ───────────────────────── HTTP ─────────────────────────

function doGet(e) {
  return responder_(() => {
    autenticar_(e.parameter.token);
    const acao = e.parameter.acao || 'dados';
    if (acao === 'ping') return { planilha: SpreadsheetApp.getActive().getName() };
    if (acao === 'dados') return lerTudo_();
    throw new Error('Ação desconhecida: ' + acao);
  });
}

function doPost(e) {
  return responder_(() => {
    const corpo = JSON.parse(e.postData.contents);
    autenticar_(corpo.token);
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      prepararAbas_();
      switch (corpo.acao) {
        case 'lancar': return lancar_(corpo);
        case 'regras': return salvarRegras_(corpo.regras || [], corpo.excluir || []);
        case 'status': return atualizarStatus_(corpo.alteracoes || []);
        case 'desfazer': return desfazer_(corpo.lote);
        default: throw new Error('Ação desconhecida: ' + corpo.acao);
      }
    } finally {
      lock.releaseLock();
    }
  });
}

function responder_(fn) {
  let saida;
  try {
    saida = Object.assign({ ok: true }, fn());
  } catch (err) {
    saida = { ok: false, erro: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(saida)).setMimeType(ContentService.MimeType.JSON);
}

function autenticar_(token) {
  // TOKEN_INSTALACAO vem do arquivo Token.gs quando o backend é instalado via clasp (não vai para o GitHub)
  const esperado = PropertiesService.getScriptProperties().getProperty('TOKEN') || (typeof TOKEN_INSTALACAO !== 'undefined' ? TOKEN_INSTALACAO : '');
  if (!esperado) throw new Error('Backend não configurado: execute a função "configurar" no Apps Script.');
  if (token !== esperado) throw new Error('Token inválido.');
}

// ───────────────────────── Leitura ─────────────────────────

function lerTudo_() {
  const ss = SpreadsheetApp.getActive();
  const importacoes = lerAba_(ss.getSheetByName(ABAS.IMPORTACOES))
    .filter((l) => !l.DESFEITO)
    .slice(-10)
    .map((l) => ({ lote: l.LOTE, data: l.DATA, despesas: l.DESPESAS, receitas: l.RECEITAS, descricao: l.DESCRICAO }));
  return {
    despesas: lerAba_(ss.getSheetByName(ABAS.DESPESAS)),
    receitas: lerAba_(ss.getSheetByName(ABAS.RECEITAS)),
    regras: lerAba_(ss.getSheetByName(ABAS.REGRAS)),
    importacoes: importacoes,
    lidoEm: new Date().toISOString(),
  };
}

function lerAba_(aba) {
  if (!aba || aba.getLastRow() < 2) return [];
  const valores = aba.getDataRange().getDisplayValues();
  const cab = valores[0].map(normalizar_);
  const linhas = [];
  for (let i = 1; i < valores.length; i++) {
    const v = valores[i];
    if (!v.some((x) => String(x).trim())) continue;
    const obj = { _linha: i + 1 };
    cab.forEach((c, j) => {
      if (c) obj[c] = v[j];
    });
    linhas.push(obj);
  }
  return linhas;
}

// ───────────────────────── Gravação ─────────────────────────

function lancar_(corpo) {
  const ss = SpreadsheetApp.getActive();
  const lote = corpo.lote || Utilities.getUuid().slice(0, 8);
  const d = anexar_(ss.getSheetByName(ABAS.DESPESAS), corpo.despesas || []);
  const r = anexar_(ss.getSheetByName(ABAS.RECEITAS), corpo.receitas || []);
  let regras = { regras: 0 };
  if (corpo.regras && corpo.regras.length) regras = salvarRegras_(corpo.regras, []);
  const ids = d.ids.concat(r.ids);
  if (ids.length) {
    ss.getSheetByName(ABAS.IMPORTACOES).appendRow([lote, new Date(), d.ids.length, r.ids.length, corpo.descricao || '', JSON.stringify(ids), '']);
  }
  return { lote: lote, despesas: d.ids.length, receitas: r.ids.length, ignoradasDuplicadas: d.duplicadas + r.duplicadas, regras: regras.regras };
}

function anexar_(aba, linhas) {
  if (!linhas.length) return { ids: [], duplicadas: 0 };
  const cab = garantirColunas_(aba, COLUNAS_EXTRAS);
  const iId = cab.indexOf('ID_IMPORTACAO');
  const ultima = ultimaLinhaComDados_(aba);
  const existentes = new Set(ultima > 1 ? aba.getRange(2, iId + 1, ultima - 1, 1).getValues().map((x) => String(x[0])) : []);

  const novas = linhas.filter((l) => !l.ID_IMPORTACAO || !existentes.has(String(l.ID_IMPORTACAO)));
  if (!novas.length) return { ids: [], duplicadas: linhas.length };

  // Linha de referência: herda formatação, listas suspensas e o tipo de dado (data x texto) de cada coluna
  const ref = ultima > 1 ? aba.getRange(ultima, 1, 1, cab.length).getValues()[0] : [];
  const valores = novas.map((l) => cab.map((c, j) => converter_(c, l[c], ref[j])));

  const inicio = ultima + 1;
  const destino = aba.getRange(inicio, 1, valores.length, cab.length);
  if (ultima > 1) {
    const linhaRef = aba.getRange(ultima, 1, 1, cab.length);
    linhaRef.copyFormatToRange(aba, 1, cab.length, inicio, inicio + valores.length - 1);
    const validacoes = linhaRef.getDataValidations()[0];
    destino.setDataValidations(valores.map(() => validacoes));
  }
  destino.setValues(valores);
  return { ids: novas.map((l) => l.ID_IMPORTACAO).filter(String), duplicadas: linhas.length - novas.length };
}

function converter_(coluna, valor, referencia) {
  if (valor === undefined || valor === null) return '';
  const refEhData = Object.prototype.toString.call(referencia) === '[object Date]';
  if (COLUNAS_DATA.indexOf(coluna) >= 0) {
    const m = String(valor).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  }
  if (COLUNAS_MES.indexOf(coluna) >= 0 && refEhData) {
    const m = String(valor).match(/^(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(+m[2], +m[1] - 1, 1);
  }
  if (coluna === 'VALOR') return Number(valor) || 0;
  // Texto que o Sheets poderia converter sozinho (ex.: "1/1" vira data) é gravado como texto
  if (coluna === 'PARCELAS' || COLUNAS_MES.indexOf(coluna) >= 0) return "'" + valor;
  return texto_(valor);
}

// Impede que textos como "+ FULANO" ou "-Estorno" sejam interpretados como fórmula
function texto_(valor) {
  return typeof valor === 'string' && /^[=+\-@]/.test(valor) ? "'" + valor : valor;
}

// Última linha com conteúdo real na 1ª coluna (ignora linhas só com lista suspensa/formatação)
function ultimaLinhaComDados_(aba) {
  const n = aba.getLastRow();
  if (n < 2) return 1;
  const col = aba.getRange(1, 1, n, 1).getDisplayValues();
  for (let i = n - 1; i >= 1; i--) if (String(col[i][0]).trim()) return i + 1;
  return 1;
}

function salvarRegras_(regras, excluir) {
  const aba = abaComCabecalho_(ABAS.REGRAS, CAB_REGRAS);
  const cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(normalizar_);
  const iChave = cab.indexOf('CHAVE');
  const ultima = aba.getLastRow();
  const dados = ultima > 1 ? aba.getRange(2, 1, ultima - 1, cab.length).getValues() : [];
  const posicao = new Map();
  dados.forEach((l, i) => posicao.set(String(l[iChave]), i + 2));

  const agora = new Date();
  const novas = [];
  regras.forEach((r) => {
    r.ATUALIZADO = agora;
    const linha = cab.map((c) => (r[c] !== undefined ? texto_(r[c]) : ''));
    const existente = posicao.get(String(r.CHAVE));
    if (existente) aba.getRange(existente, 1, 1, cab.length).setValues([linha]);
    else novas.push(linha);
  });
  if (novas.length) aba.getRange(aba.getLastRow() + 1, 1, novas.length, cab.length).setValues(novas);

  const apagar = excluir.map((c) => posicao.get(String(c))).filter(Boolean).sort((a, b) => b - a);
  apagar.forEach((l) => aba.deleteRow(l));
  return { regras: regras.length, excluidas: apagar.length };
}

function atualizarStatus_(alteracoes) {
  const ss = SpreadsheetApp.getActive();
  let feitas = 0;
  const erros = [];
  alteracoes.forEach((a) => {
    const aba = ss.getSheetByName(a.aba === 'receitas' ? ABAS.RECEITAS : ABAS.DESPESAS);
    const cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(normalizar_);
    const iNome = cab.indexOf(a.aba === 'receitas' ? 'TIPO' : 'NOME_DESPESA');
    const linha = Number(a.linha);
    const nomeAtual = aba.getRange(linha, iNome + 1).getDisplayValue();
    if (String(nomeAtual).trim() !== String(a.nome).trim()) {
      erros.push('Linha ' + linha + ' mudou na planilha ("' + nomeAtual + '"). Atualize o painel e tente de novo.');
      return;
    }
    Object.keys(a.campos || {}).forEach((campo) => {
      const j = cab.indexOf(campo);
      if (j < 0) return;
      const celula = aba.getRange(linha, j + 1);
      celula.setValue(converter_(campo, a.campos[campo], celula.getValue()));
    });
    feitas++;
  });
  return { alteradas: feitas, erros: erros };
}

function desfazer_(lote) {
  const ss = SpreadsheetApp.getActive();
  const log = ss.getSheetByName(ABAS.IMPORTACOES);
  const dados = log.getDataRange().getValues();
  const i = dados.findIndex((l, n) => n > 0 && String(l[0]) === String(lote));
  if (i < 0) throw new Error('Importação não encontrada.');
  if (dados[i][6]) throw new Error('Essa importação já foi desfeita.');
  const ids = new Set(JSON.parse(dados[i][5] || '[]'));
  let removidas = 0;
  [ABAS.DESPESAS, ABAS.RECEITAS].forEach((nome) => {
    const aba = ss.getSheetByName(nome);
    const cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(normalizar_);
    const iId = cab.indexOf('ID_IMPORTACAO');
    if (iId < 0 || aba.getLastRow() < 2) return;
    const col = aba.getRange(2, iId + 1, aba.getLastRow() - 1, 1).getValues();
    for (let l = col.length - 1; l >= 0; l--) {
      if (ids.has(String(col[l][0]))) {
        aba.deleteRow(l + 2);
        removidas++;
      }
    }
  });
  log.getRange(i + 1, 7).setValue(new Date());
  return { removidas: removidas };
}

// ───────────────────────── Auxiliares ─────────────────────────

function normalizar_(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function garantirColunas_(aba, colunas) {
  if (!aba) throw new Error('Aba não encontrada na planilha.');
  let cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(normalizar_);
  // ignora colunas vazias à direita
  while (cab.length && !cab[cab.length - 1]) cab.pop();
  colunas.forEach((c) => {
    if (cab.indexOf(c) < 0) {
      aba.getRange(1, cab.length + 1).setValue(c);
      cab.push(c);
    }
  });
  return cab;
}

function abaComCabecalho_(nome, cabecalho) {
  const ss = SpreadsheetApp.getActive();
  let aba = ss.getSheetByName(nome);
  if (!aba) {
    aba = ss.insertSheet(nome);
    aba.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]).setFontWeight('bold');
    aba.setFrozenRows(1);
  }
  return aba;
}
