// Estado Global
const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1CJJ-dEYwWpY5tN3XPcEiquNPiguxTO-s2ikUgEOMvk4/edit?usp=sharing';

const state = {
  despesas: [],
  receitas: [],
  mesSelecionado: null,
};

// Elementos DOM
const monthYearInput = document.getElementById('month-year');
const btnImportar = document.getElementById('btn-importar');
const totalReceitaEl = document.getElementById('total-receita');
const totalDespesaEl = document.getElementById('total-despesa');
const totalSaldoEl = document.getElementById('total-saldo');
const infoReceitaEl = document.getElementById('info-receita');
const infoDespesaEl = document.getElementById('info-despesa');
const infoSaldoEl = document.getElementById('info-saldo');
const tbodyDespesasEl = document.getElementById('tbody-despesas');
const tbodyReceitasEl = document.getElementById('tbody-receitas');
const statusMessageEl = document.getElementById('status-message');
const sheetUrlInput = document.getElementById('sheet-url');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// INICIALIZAÇÃO
document.addEventListener('DOMContentLoaded', async () => {
  // Set mês atual como padrão
  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  monthYearInput.value = mesAtual;
  state.mesSelecionado = mesAtual;

  // Definir URL fixa ou usar o que estiver no localStorage
  const savedUrl = localStorage.getItem('sheetUrl') || DEFAULT_SHEET_URL;
  localStorage.setItem('sheetUrl', savedUrl);
  if (sheetUrlInput) sheetUrlInput.value = savedUrl;

  // Importar automaticamente e iniciar autosync
  await importarGoogleSheets(true);

  // Render inicial
  atualizarPainel();

  // Event listeners
  monthYearInput.addEventListener('change', (e) => {
    state.mesSelecionado = e.target.value;
    atualizarPainel();
  });

  // Esconde o botão import e campo URL para interface mais limpa
  if (btnImportar) btnImportar.style.display = 'none';
  if (sheetUrlInput) sheetUrlInput.style.display = 'none';

  // Botão permanece funcional em caso de necessidade manual
  if (btnImportar) {
    btnImportar.addEventListener('click', () => {
      importarGoogleSheets();
    });
  }

  // Auto-salva a URL e importa automaticamente quando o campo é alterado
  if (sheetUrlInput) {
    sheetUrlInput.addEventListener('change', async (e) => {
      const newUrl = e.target.value.trim();
      if (!newUrl) {
        localStorage.removeItem('sheetUrl');
        mostrarStatus('⚠️ URL da planilha removida. Informe uma planilha para continuar.', 'info');
        return;
      }

      localStorage.setItem('sheetUrl', newUrl);
      mostrarStatus('✅ URL da planilha salva. Importando automaticamente...', 'success');
      await importarGoogleSheets(true);
    });
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      trocarTab(tabName, btn);
    });
  });
});

// TROCAR ABA
function trocarTab(tabName, clickedButton) {
  // Atualizar botões
  tabButtons.forEach((btn) => {
    btn.classList.remove('active');
  });
  if (clickedButton) {
    clickedButton.classList.add('active');
  }

  // Atualizar conteúdo
  tabContents.forEach((content) => {
    content.classList.remove('active');
  });
  document.getElementById(`tab-${tabName}`).classList.add('active');
}

// ATUALIZAR PAINEL
function atualizarPainel() {
  const { totalReceita, totalDespesa, saldo, qtdReceita, qtdDespesa } = calcularTotais();

  // Atualizar cards
  totalReceitaEl.textContent = formatarMoeda(totalReceita);
  totalDespesaEl.textContent = formatarMoeda(totalDespesa);
  totalSaldoEl.textContent = formatarMoeda(saldo);

  // Informações
  infoReceitaEl.textContent = qtdReceita === 0 ? 'Sem receitas' : `${qtdReceita} receita(s)`;
  infoDespesaEl.textContent = qtdDespesa === 0 ? 'Sem despesas' : `${qtdDespesa} despesa(s)`;
  infoSaldoEl.textContent = saldo >= 0 ? '✅ Positivo' : '⚠️ Negativo';

  // Render tabelas
  renderizarTabelas();
}

// CALCULAR TOTAIS
function calcularTotais() {
  const despesasFiltradas = filtrarPorMes(state.despesas);
  const receitasFiltradas = filtrarPorMes(state.receitas);

  console.log(`[calcularTotais] Mês selecionado: ${state.mesSelecionado}`);
  console.log(`[calcularTotais] Despesas filtradas: ${despesasFiltradas.length}`);
  console.log(`[calcularTotais] Receitas filtradas: ${receitasFiltradas.length}`);
  
  // Debug: mostrar primeiras 3 linhas de cada
  if (despesasFiltradas.length > 0) {
    console.log(`[calcularTotais] Primeiras 3 despesas:`, despesasFiltradas.slice(0, 3));
  }
  if (receitasFiltradas.length > 0) {
    console.log(`[calcularTotais] Primeiras 3 receitas:`, receitasFiltradas.slice(0, 3));
  }

  const totalDespesa = despesasFiltradas.reduce((acc, d) => acc + parseFloat(d.valor || 0), 0);
  const totalReceita = receitasFiltradas.reduce((acc, r) => acc + parseFloat(r.valor || 0), 0);
  const saldo = totalReceita - totalDespesa;

  console.log(`[calcularTotais] Totais - Despesa: ${totalDespesa}, Receita: ${totalReceita}, Saldo: ${saldo}`);

  return {
    totalDespesa,
    totalReceita,
    saldo,
    qtdDespesa: despesasFiltradas.length,
    qtdReceita: receitasFiltradas.length,
  };
}


function formatarParaMesReferencia(mesItem) {
  if (!mesItem) return '';
  let texto = mesItem.toString().trim();

  // 03/2025 ou 3/2025 ou 03/25
  const matchMesAnoBarra = texto.match(/^(\d{1,2})\/(\d{2,4})$/);
  if (matchMesAnoBarra) {
    let [, mes, ano] = matchMesAnoBarra;
    if (ano.length === 2) {
      ano = parseInt(ano, 10) < 70 ? `20${ano}` : `19${ano}`;
    }
    return `${ano}-${mes.padStart(2, '0')}`;
  }

  // 03-2025 ou 3-2025
  const matchMesAnoTraco = texto.match(/^(\d{1,2})-(\d{2,4})$/);
  if (matchMesAnoTraco) {
    let [, mes, ano] = matchMesAnoTraco;
    if (ano.length === 2) {
      ano = parseInt(ano, 10) < 70 ? `20${ano}` : `19${ano}`;
    }
    return `${ano}-${mes.padStart(2, '0')}`;
  }

  // Já está em formato yyyy-mm?
  const matchIso = texto.match(/^(\d{4})-(\d{2})$/);
  if (matchIso) {
    return texto;
  }

  // Converter datas completas e extrair ano-mês
  const iso = formatarParaIso(texto);
  if (iso.length >= 7) {
    return iso.substring(0, 7);
  }

  return '';
}

// FILTRAR POR MÊS
function filtrarPorMes(dados) {
  if (!state.mesSelecionado) return dados;

  return dados.filter((item) => {
    // Preferir mesReferencia (campo da planilha), se não existir, usa vencimento/data
    const mesItem = item.mesReferencia || item.data || item.vencimento || '';
    if (!mesItem) return false;

    const mesReferencia = formatarParaMesReferencia(mesItem);
    return mesReferencia === state.mesSelecionado;
  });
}


function formatarParaIso(dataStr) {
  if (!dataStr) return '';
  const texto = dataStr.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return texto;
  }

  if (/^\d{2}\/\d{2}\/\d{2,4}$/.test(texto)) {
    let [dia, mes, ano] = texto.split('/');
    if (ano.length === 2) {
      ano = parseInt(ano, 10) < 70 ? `20${ano}` : `19${ano}`;
    }
    return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  }

  if (/^\d{2}\.\d{2}\.\d{2,4}$/.test(texto)) {
    let [dia, mes, ano] = texto.split('.');
    if (ano.length === 2) {
      ano = parseInt(ano, 10) < 70 ? `20${ano}` : `19${ano}`;
    }
    return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  }

  const d = new Date(texto);
  if (!isNaN(d)) {
    return d.toISOString().slice(0, 10);
  }

  return '';
}


// RENDERIZAR TABELAS
function renderizarTabelas() {
  const despesasFiltradas = filtrarPorMes(state.despesas);
  const receitasFiltradas = filtrarPorMes(state.receitas);

  // Despesas
  if (despesasFiltradas.length === 0) {
    tbodyDespesasEl.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#999;">Nenhuma despesa</td></tr>';
  } else {
    tbodyDespesasEl.innerHTML = despesasFiltradas
      .map(
        (d) => `
        <tr>
          <td>${escapeHtml(d.nomeDespesa || d.nome || '')}</td>
          <td>${formatarData(d.vencimento || d.data || '')}</td>
          <td>${formatarMoeda(d.valor)}</td>
        </tr>
      `
      )
      .join('');
  }

  // Receitas
  if (receitasFiltradas.length === 0) {
    tbodyReceitasEl.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#999;">Nenhuma receita</td></tr>';
  } else {
    tbodyReceitasEl.innerHTML = receitasFiltradas
      .map(
        (r) => `
        <tr>
          <td>${escapeHtml(r.nome || '')}</td>
          <td>${escapeHtml(r.tipo || '')}</td>
          <td>${formatarMoeda(r.valor)}</td>
        </tr>
      `
      )
      .join('');
  }
}

// IMPORTAÇÃO (Manual JSON e Google Sheets automática)
async function importarGoogleSheets(silencioso = false) {
  const sheetInputField = document.getElementById('sheet-url');
  let sheetInput = '';

  if (sheetInputField) {
    sheetInput = sheetInputField.value.trim();
  }

  if (!sheetInput) {
    sheetInput = localStorage.getItem('sheetUrl') || DEFAULT_SHEET_URL;
    if (sheetInputField) {
      sheetInputField.value = sheetInput;
    }
  }

  if (!sheetInput) {
    if (!silencioso) mostrarStatus('⚠️ URL da planilha não encontrada.', 'error');
    return;
  }

  // Se for URL válida, mantenha salvo para próximas visitas
  if (!sheetInput.startsWith('{') && !sheetInput.startsWith('[')) {
    localStorage.setItem('sheetUrl', sheetInput);
  }

  // Se o usuário colar um JSON direto no campo
  if (sheetInput.startsWith('{') || sheetInput.startsWith('[')) {
    try {
      const dados = JSON.parse(sheetInput);
      state.despesas = dados.despesas || [];
      state.receitas = dados.receitas || [];
      salvarDados();
      atualizarPainel();
      if (!silencioso) mostrarStatus('✅ Dados JSON importados com sucesso!', 'success');
      iniciarAutoRefreshSePossivel();
      return;
    } catch (err) {
      if (!silencioso) {
        mostrarStatus('❌ Erro ao ler JSON. Verifique o formato e tente novamente.', 'error');
        console.error(err);
      }
      return;
    }
  }

  const spreadsheetId = extrairIdPlanilha(sheetInput);
  if (!spreadsheetId) {
    if (!silencioso) mostrarStatus('❌ URL/ID da planilha inválido. Verifique e tente novamente.', 'error');
    return;
  }

  if (!silencioso) {
    mostrarStatus('⏳ Buscando dados do Google Sheets...', 'info');
    btnImportar.disabled = true;
  }

  try {
    let despesas = [];
    let receitas = [];

    try {
      [despesas, receitas] = await Promise.all([
        buscarDadosAba(spreadsheetId, 'Despesas'),
        buscarDadosAba(spreadsheetId, 'Receitas'),
      ]);
    } catch (_) {
      // se uma das abas não existir, tenta quando elas estiverem num mesmo sheet
    }

    console.log('Dados baixados - Despesas:', despesas.length, 'Receitas:', receitas.length);

    if ((despesas.length === 0 && receitas.length === 0) || (!despesas.length && !receitas.length)) {
      const nomesPossiveis = ['DESPESAS', 'RECEITAS', 'Despesas', 'Receitas', 'Planilha1', 'Sheet1'];
      for (const nome of nomesPossiveis) {
        mostrarStatus(`⏳ Tentando aba ${nome}...`, 'info');
        if (despesas.length > 0 || receitas.length > 0) break;

        try {
          const rows = await buscarDadosAba(spreadsheetId, nome);
          if (rows.length > 0) {
            // Tenta separar linhas por estrutura
            despesas = rows.filter((r) => r.nomeDespesa || r.vencimento || r.valor < 0);
            receitas = rows.filter((r) => r.nome && r.tipo && r.valor >= 0);
            if (!despesas.length && !receitas.length) {
              // fallback: dividir pelas primeiras colunas pelo conteúdo
              despesas = rows.filter((r) => !r.tipo);
              receitas = rows.filter((r) => r.tipo);
            }
          }
        } catch (err) {
          // ignora e continua
        }
      }
    }

    if (despesas.length === 0 && receitas.length === 0) {
      if (!silencioso) mostrarStatus('❌ Não foram encontrados dados nas abas Despesas e Receitas.', 'error');
      console.error('[importarGoogleSheets] Nenhum dado encontrado em nenhuma aba');
      return;
    }

    console.log('[importarGoogleSheets] Dados finais - Despesas:', despesas.length, 'Receitas:', receitas.length);
    console.log('[importarGoogleSheets] Primeira despesa:', despesas[0]);
    console.log('[importarGoogleSheets] Primeira receita:', receitas[0]);

    state.despesas = despesas;
    state.receitas = receitas;
    salvarDados();
    atualizarPainel();
    if (!silencioso) mostrarStatus('✅ Dados importados do Google Sheets com sucesso!', 'success');
    iniciarAutoRefreshSePossivel();
  } catch (err) {
    console.error(err);
    if (!silencioso) mostrarStatus('❌ Falha ao importar Google Sheets. Veja console para detalhes.', 'error');
  } finally {
    if (!silencioso) btnImportar.disabled = false;
  }
}

function extrairIdPlanilha(urlOrId) {
  const idPattern = /(?:\/d\/|spreadsheets\/d\/)([a-zA-Z0-9-_]+)/;
  const match = urlOrId.match(idPattern);
  if (match && match[1]) return match[1];

  // Se vier só o ID
  if (/^[a-zA-Z0-9-_]+$/.test(urlOrId)) return urlOrId;

  return null;
}

async function fetchTexto(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return await response.text();
  } catch (err) {
    // Usar proxy CORS como fallback
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      throw new Error(`Proxy HTTP ${response.status} ${response.statusText}: ${err.message}`);
    }
    return await response.text();
  }
}

async function buscarDadosAba(spreadsheetId, nomeAba) {
  const urls = [
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(nomeAba)}`,
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&sheet=${encodeURIComponent(nomeAba)}`,
  ];

  let csv;
  let lastError;

  for (const url of urls) {
    mostrarStatus(`⏳ Consultando ${nomeAba} em: ${url.substring(0, 80)}...`, 'info');
    try {
      const text = await fetchTexto(url);
      console.log(`[buscarDadosAba] Recebido de ${nomeAba}:`, text.substring(0, 200));
      
      if (!text.trim()) {
        throw new Error('Resposta vazia');
      }
      if (text.trim().startsWith('<') || text.includes('Google Drive') || text.includes('Not Found') || text.includes('Error')) {
        throw new Error('Conteúdo inválido recebido (provável problema de permissões).');
      }
      csv = text;
      break;
    } catch (error) {
      console.log(`[buscarDadosAba] Erro ao tentar ${nomeAba}:`, error.message);
      lastError = error;
    }
  }

  if (!csv) {
    throw new Error(`Não foi possível buscar a aba ${nomeAba}: ${lastError?.message || 'erro desconhecido'}`);
  }

  const rows = parseCSV(csv);
  console.log(`[buscarDadosAba] Parseado ${nomeAba}: ${rows.length} linhas`);
  
  if (rows.length === 0) return [];

  if (nomeAba.toLowerCase() === 'despesas') {
    return rows.map((row) => ({
      nomeDespesa: row.Nome || row.nome || row.NOME || row['Nome da Despesa'] || row['Descrição'] || row['descrição'] || '',
      vencimento: row.Vencimento || row.vencimento || row.VENCIMENTO || row.Data || row.data || row.DATA || row['Data de Vencimento'] || row['Data Vencimento'] || '',
      valor: parseMoney(row.Valor || row.valor || row.VALOR || row['Valor Pago'] || row['R$'] || 0),
      mesReferencia: row['MES DE REFERENCIA'] || row['Mês de Referência'] || row['mes_de_referencia'] || '',
    }));
  }

  if (nomeAba.toLowerCase() === 'receitas') {
    return rows.map((row) => ({
      nome: row.NOME || row.Nome || row.nome || row['Descrição'] || row['descrição'] || row.DESCRIÇÃO || row['Receita'] || '',
      tipo: row.TIPO || row.Tipo || row.tipo || row['Tipo de Receita'] || row['Categoria'] || row['categoria'] || '',
      valor: parseMoney(row.VALOR || row.Valor || row.valor || row['Valor'] || row['R$'] || 0),
      mesReferencia: row['MES DE REFERENCIA'] || row['Mês de Referência'] || row['mes_de_referencia'] || '',
    }));
  }

  return [];
}



function parseMoney(value) {
  if (value === undefined || value === null || value === '') return 0;
  const text = String(value).trim().replace(/\s/g, '').replace('R$', '').replace('$', '');
  if (!text || text === '') return 0;
  const normalized = text.replace(/\./g, '').replace(/,/g, '.');
  const result = parseFloat(normalized) || 0;
  return result;
}


function parseCSV(csvText) {
  const lines = csvText
    .trim()
    .split(/\r?\n/) 
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const delimiter = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  console.log(`[parseCSV] Delimiter detectado:`, delimiter, 'Primeira linha:', lines[0].substring(0, 100));

  const headers = parseCsvLine(lines[0], delimiter).map((h) => h.trim());
  console.log(`[parseCSV] Headers:`, headers);

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line, delimiter);
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = values[i] || '';
    });
    return obj;
  });
}

function parseCsvLine(line, delimiter) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }
  values.push(current);
  return values.map((v) => v.trim());
}

// ══════════════════════════════════════════════════════
// AUTO-REFRESH em tempo real — polling a cada 30s, silencioso
// ══════════════════════════════════════════════════════
const POLL_INTERVAL = 30000; // 30 segundos (mais conservador que 5s para evitar rate limits)
let _pollTimer = null;
let _polling = false; // lock: evita requisições paralelas
let _lastUpdate = null;

function startAutoRefresh() {
  if (_pollTimer) return;
  _pollTimer = setInterval(silentRefresh, POLL_INTERVAL);
  console.log('[AutoRefresh] Iniciado - polling a cada 30s');
}

function stopAutoRefresh() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
  console.log('[AutoRefresh] Parado');
}

// Refresh silencioso: busca dados novos sem apagar filtros nem mudar aba
async function silentRefresh() {
  if (_polling) return; // evita requisições paralelas
  _polling = true;

  try {
    console.log('[AutoRefresh] Buscando dados atualizados...');
    await importarGoogleSheets(true); // true = silencioso
    _lastUpdate = new Date();
    console.log('[AutoRefresh] Dados atualizados em', _lastUpdate.toLocaleTimeString());
  } catch (error) {
    console.error('[AutoRefresh] Erro no refresh:', error.message);
  } finally {
    _polling = false;
  }
}

// Iniciar auto-refresh quando dados são carregados
function iniciarAutoRefreshSePossivel() {
  if (state.despesas.length > 0 || state.receitas.length > 0) {
    startAutoRefresh();
  }
}


// STATUS
function mostrarStatus(mensagem, tipo = 'info') {
  statusMessageEl.textContent = mensagem;
  statusMessageEl.className = `status-message show ${tipo}`;
  setTimeout(() => {
    statusMessageEl.classList.remove('show');
  }, 4000);
}

// PERSISTÊNCIA
function salvarDados() {
  localStorage.setItem(
    'painel_financeiro_v2',
    JSON.stringify({
      despesas: state.despesas,
      receitas: state.receitas,
    })
  );
}

function carregarDados() {
  try {
    const dados = localStorage.getItem('painel_financeiro_v2');
    if (dados) {
      const parsed = JSON.parse(dados);
      state.despesas = parsed.despesas || [];
      state.receitas = parsed.receitas || [];
    }
  } catch (e) {
    console.warn('Erro ao carregar dados:', e);
  }
}

// HELPERS
function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor || 0);
}

function formatarData(dataStr) {
  if (!dataStr) return '-';
  try {
    const parts = dataStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dataStr;
  } catch {
    return dataStr;
  }
}
//teste
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
