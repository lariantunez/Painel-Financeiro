// Estado Global
const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1CJJ-dEYwWpY5tN3XPcEiquNPiguxTO-s2ikUgEOMvk4/edit?usp=sharing';

const state = {
  despesas: [],
  receitas: [],
  mesSelecionado: null,
  categoriaSelecionada: null,
};

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function isCreditoParcelado(d) {
  const forma = (d.formaPgto || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const match = (d.parcelas || '').trim().match(/^(\d+)\/(\d+)$/);
  const ok = forma === 'CREDITO PARCELADO' && !!match && parseInt(match[2], 10) > 1;
  return ok;
}


// Elementos DOM
const yearSelect = document.getElementById('year-select');
const monthButtonsWrapper = document.getElementById('month-buttons');
const chartWrapper = document.getElementById('chart-wrapper');
const btnImportar = document.getElementById('btn-importar');
const totalReceitaEl = document.getElementById('total-receita');
const totalDespesaEl = document.getElementById('total-despesa');
const totalSaldoEl = document.getElementById('total-saldo');
const infoReceitaEl = document.getElementById('info-receita');
const infoDespesaEl = document.getElementById('info-despesa');
const infoSaldoEl = document.getElementById('info-saldo');
const tbodyDespesasEl = document.getElementById('tbody-despesas');
const tbodyReceitasEl = document.getElementById('tbody-receitas');
const tbodyParcelamentosEl = document.getElementById('tbody-parcelamentos');
const statusMessageEl = document.getElementById('status-message');
const sheetUrlInput = document.getElementById('sheet-url');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// INICIALIZAÇÃO
document.addEventListener('DOMContentLoaded', async () => {
  // Set mês atual como padrão
  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  state.mesSelecionado = mesAtual;

  // Definir URL fixa ou usar o que estiver no localStorage
  const savedUrl = localStorage.getItem('sheetUrl') || DEFAULT_SHEET_URL;
  localStorage.setItem('sheetUrl', savedUrl);
  if (sheetUrlInput) sheetUrlInput.value = savedUrl;

  // Render de navegação de ano e meses
  renderYearOptions();
  renderMonthButtons();
  setCurrentMonthFromState();

  // Importar automaticamente e iniciar autosync
  await importarGoogleSheets(true);

  // Render inicial
  atualizarPainel();

  // Event listeners
  yearSelect.addEventListener('change', () => {
    const ano = yearSelect.value;
    const mes = state.mesSelecionado ? state.mesSelecionado.split('-')[1] : '01';
    setMesAno(ano, parseInt(mes, 10));
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
  atualizarChart();
  atualizarChartCategorias();
  atualizarChartParcelados();
}

function renderYearOptions() {
  if (!yearSelect) return;

  const currentYear = new Date().getFullYear();
  let html = '';
  for (let year = currentYear - 2; year <= currentYear + 2; year++) {
    html += `<option value="${year}">${year}</option>`;
  }
  yearSelect.innerHTML = html;
}

function renderMonthButtons() {
  if (!monthButtonsWrapper) return;

  monthButtonsWrapper.innerHTML = '';
  MONTHS.forEach((label, index) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      const ano = yearSelect ? yearSelect.value : String(new Date().getFullYear());
      setMesAno(ano, index + 1);
    });
    monthButtonsWrapper.appendChild(btn);
  });
}

function setMesAno(ano, mes) {
  const monthNumber = String(mes).padStart(2, '0');
  state.mesSelecionado = `${ano}-${monthNumber}`;
  state.categoriaSelecionada = null;
  atualizarFiltroChip();

  if (yearSelect) yearSelect.value = ano;

  const buttons = monthButtonsWrapper ? monthButtonsWrapper.querySelectorAll('button') : [];
  buttons.forEach((btn, idx) => {
    btn.classList.toggle('active', idx + 1 === mes);
  });

  atualizarPainel();
}

function setCurrentMonthFromState() {
  const data = state.mesSelecionado ? state.mesSelecionado.split('-') : null;
  const ano = data ? data[0] : String(new Date().getFullYear());
  const mes = data ? parseInt(data[1], 10) : (new Date().getMonth() + 1);

  if (yearSelect) yearSelect.value = ano;
  setMesAno(ano, mes);
}

function atualizarChart() {
  if (!chartWrapper) return;

  const ano = yearSelect ? Number(yearSelect.value) : new Date().getFullYear();
  const receitasPorMes = Array(12).fill(0);
  const despesasPorMes = Array(12).fill(0);

  state.receitas.forEach((r) => {
    const m = extractMonthFrom(r.mesReferencia || r.data || '');
    if (m && m.year === ano) receitasPorMes[m.month - 1] += Number(r.valor) || 0;
  });

  state.despesas.forEach((d) => {
    const m = extractMonthFrom(d.mesReferencia || d.vencimento || '');
    if (m && m.year === ano) despesasPorMes[m.month - 1] += Number(d.valor) || 0;
  });

  const maxValue = Math.max(...receitasPorMes, ...despesasPorMes, 1);
  const points = [];

  let chartHtml = '<div class="chart-svg-overlay"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline stroke="#38ef7d" stroke-width="0.8" fill="none" points="';

  for (let i = 0; i < 12; i++) {
    const x = (i + 0.5) * (100 / 12);
    const y = 100 - (receitasPorMes[i] / maxValue) * 100;
    points.push(`${x},${y.toFixed(2)}`);
  }

  chartHtml += points.join(' ') + '"></polyline></svg></div>';

  for (let i = 0; i < 12; i++) {
    const despesaAltura = (despesasPorMes[i] / maxValue) * 100;
    const receitaAltura = (receitasPorMes[i] / maxValue) * 100;
    const selectedMonth = state.mesSelecionado ? Number(state.mesSelecionado.split('-')[1]) : null;
    const activeClass = selectedMonth === i + 1 ? 'active' : '';
    const barStyle = despesasPorMes[i] > 0 ? `height: ${despesaAltura}%` : 'height: 0';
    const pointStyle = receitasPorMes[i] > 0 ? `bottom: ${receitaAltura}%; display: block` : 'display: none';

    chartHtml += `
      <div class="chart-column ${activeClass}" data-month="${i + 1}" data-dep="${despesasPorMes[i]}" data-rec="${receitasPorMes[i]}">
        <span class="chart-label">${MONTHS[i]}</span>
        <div class="chart-bar-despesa" style="${barStyle}"></div>
        <div class="chart-point" style="${pointStyle}"></div>
      </div>`;
  }

  chartWrapper.innerHTML = chartHtml;

  const columns = chartWrapper.querySelectorAll('.chart-column');
  columns.forEach((column) => {
    column.addEventListener('click', () => {
      const month = Number(column.dataset.month);
      const year = yearSelect ? yearSelect.value : new Date().getFullYear();
      setMesAno(year, month);
    });

    column.addEventListener('mousemove', (e) => {
      const existing = document.getElementById('chart-tooltip');
      let tooltipEl = existing;
      if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'chart-tooltip';
        tooltipEl.className = 'chart-tooltip';
        document.body.appendChild(tooltipEl);
      }

      const monthName = MONTHS[Number(column.dataset.month) - 1];
      const valorDespesa = Number(column.dataset.dep || 0);
      const valorReceita = Number(column.dataset.rec || 0);
      const saldo = valorReceita - valorDespesa;
      const saldoCor = saldo >= 0 ? '#38ef7d' : '#ff6b6b';
      const saldoSinal = saldo >= 0 ? '+' : '';
      tooltipEl.innerHTML = `
        <div style="font-weight:700;margin-bottom:6px;color:#fff;border-bottom:1px solid #2d3d4f;padding-bottom:4px;">${monthName}</div>
        <div>📈 Receita: <span style="color:#38ef7d;font-weight:600;">${formatarMoeda(valorReceita)}</span></div>
        <div>📉 Despesa: <span style="color:#ff6b6b;font-weight:600;">${formatarMoeda(valorDespesa)}</span></div>
        <div style="margin-top:4px;border-top:1px solid #2d3d4f;padding-top:4px;">💰 Saldo: <span style="color:${saldoCor};font-weight:700;">${saldoSinal}${formatarMoeda(saldo)}</span></div>
      `;

      tooltipEl.style.display = 'block';
      tooltipEl.style.visibility = 'hidden';
      const tooltipHeight = tooltipEl.offsetHeight;
      const tooltipWidth = tooltipEl.offsetWidth;
      tooltipEl.style.visibility = '';
      tooltipEl.style.left = `${e.clientX - tooltipWidth / 2}px`;
      tooltipEl.style.top = `${e.clientY - tooltipHeight - 8}px`;
    });

    column.addEventListener('mouseleave', () => {
      const tooltipEl = document.getElementById('chart-tooltip');
      if (tooltipEl) {
        tooltipEl.style.display = 'none';
      }
    });
  });
}

function extractMonthFrom(valor) {
  if (!valor) return null;

  if (typeof valor === 'string') {
    const trimmed = valor.trim();
    const m1 = trimmed.match(/^(\d{2})\/(\d{4})$/); // 03/2025
    if (m1) return { month: Number(m1[1]), year: Number(m1[2]) };

    const m2 = trimmed.match(/^(\d{4})-(\d{2})$/); // 2025-03
    if (m2) return { month: Number(m2[2]), year: Number(m2[1]) };
  }

  return null;
}

// CHIP DE FILTRO ATIVO
function atualizarFiltroChip() {
  const chip = document.getElementById('filtro-categoria-chip');
  if (!chip) return;
  if (!state.categoriaSelecionada) {
    chip.style.display = 'none';
    chip.innerHTML = '';
    return;
  }
  chip.style.display = 'inline-flex';
  chip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;background:#2d3d4f;border:1px solid #4a6080;border-radius:20px;padding:3px 10px;font-size:0.75rem;color:#e8eef7;cursor:pointer;';
  chip.innerHTML = '🔍 ' + escapeHtml(state.categoriaSelecionada) + ' <span style="font-size:1rem;line-height:1;color:#aaa;">×</span>';
  chip.onclick = function() {
    state.categoriaSelecionada = null;
    atualizarFiltroChip();
    atualizarPainel();
  };
}

// FILTRAR POR CATEGORIA
function filtrarPorCategoria(dados) {
  if (!state.categoriaSelecionada) return dados;
  return dados.filter((d) => {
    const cat = (d.tipo || '').trim() || 'Sem categoria';
    return cat === state.categoriaSelecionada;
  });
}

// CALCULAR TOTAIS
function calcularTotais() {
  const despesasFiltradas = filtrarPorCategoria(filtrarPorMes(state.despesas));
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
  const despesasFiltradas = filtrarPorCategoria(filtrarPorMes(state.despesas));
  const receitasFiltradas = filtrarPorMes(state.receitas);

  // Monta mapa tipo → cor (mesma lógica do gráfico de categorias)
  const totaisPorTipo = {};
  despesasFiltradas.forEach((d) => {
    const cat = (d.tipo || '').trim() || 'Sem categoria';
    totaisPorTipo[cat] = (totaisPorTipo[cat] || 0) + (Number(d.valor) || 0);
  });
  const tiposOrdenados = Object.keys(totaisPorTipo).sort((a, b) => totaisPorTipo[b] - totaisPorTipo[a]);
  const corPorTipo = {};
  tiposOrdenados.forEach((t, i) => { corPorTipo[t] = CATEGORIA_CORES[i % CATEGORIA_CORES.length]; });

  // Despesas
  if (despesasFiltradas.length === 0) {
    tbodyDespesasEl.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#999;">Nenhuma despesa</td></tr>';
  } else {
    tbodyDespesasEl.innerHTML = despesasFiltradas
      .map((d) => {
        const cat = (d.tipo || '').trim() || 'Sem categoria';
        const cor = corPorTipo[cat] || '#c8d8e8';
        return `
        <tr>
          <td>${escapeHtml(d.nomeDespesa || d.nome || '')}</td>
          <td>${formatarData(d.vencimento || d.data || '')}</td>
          <td>${formatarMoeda(d.valor)}</td>
          <td style="text-align:center;color:#7fa8c8;">${escapeHtml(d.parcelas || '-')}</td>
          <td class="td-tipo" style="--tipo-cor:${cor};color:${cor};font-weight:600;font-size:0.78rem;text-transform:uppercase;">${escapeHtml(cat === 'Sem categoria' ? (d.tipo || '') : cat)}</td>
        </tr>`;
      })
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

  // Parcelamentos — usa a mesma projeção do gráfico
  const mesSel = state.mesSelecionado;
  const parcelamentosDoMes = [];

  if (mesSel) {
    const [anoSel, mesMNum] = mesSel.split('-').map(Number);
    const projecaoParc = montarProjecaoParcelados(anoSel);
    const itensDoMes = projecaoParc[mesMNum] ? projecaoParc[mesMNum].itens : [];
    itensDoMes.forEach((it) => {
      parcelamentosDoMes.push({ d: { nomeDespesa: it.nome, valor: it.valor, tipo: it.tipo, vencimento: '' }, numeroParcela: it.parcela, totalParcelas: it.total });
    });
  }

  // Aplica filtro de categoria se ativo
  const parcelamentosFiltrados = parcelamentosDoMes.filter(({ d }) => {
    if (!state.categoriaSelecionada) return true;
    return ((d.tipo || '').trim() || 'Sem categoria') === state.categoriaSelecionada;
  });

  // Mapa de cores por tipo
  const totaisParc = {};
  parcelamentosFiltrados.forEach(({ d }) => {
    const cat = (d.tipo || '').trim() || 'Sem categoria';
    totaisParc[cat] = (totaisParc[cat] || 0) + (Number(d.valor) || 0);
  });
  const tiposOrdParc = Object.keys(totaisParc).sort((a, b) => totaisParc[b] - totaisParc[a]);
  const corParc = {};
  tiposOrdParc.forEach((t, i) => { corParc[t] = CATEGORIA_CORES[i % CATEGORIA_CORES.length]; });

  if (parcelamentosFiltrados.length === 0) {
    tbodyParcelamentosEl.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#999;">Nenhum parcelamento no período</td></tr>';
  } else {
    tbodyParcelamentosEl.innerHTML = parcelamentosFiltrados.map(({ d, numeroParcela, totalParcelas }) => {
      const cat = (d.tipo || '').trim() || 'Sem categoria';
      const cor = corParc[cat] || '#c8d8e8';
      return `<tr>
        <td>${escapeHtml(d.nomeDespesa || d.nome || '')}</td>
        <td>${formatarData(d.vencimento || d.data || '')}</td>
        <td>${formatarMoeda(d.valor)}</td>
        <td style="text-align:center;color:#7fa8c8;">${numeroParcela}/${totalParcelas}</td>
        <td class="td-tipo" style="color:${cor};font-weight:600;font-size:0.78rem;text-transform:uppercase;">${escapeHtml(cat)}</td>
      </tr>`;
    }).join('');
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
    // Detecta dinamicamente a coluna de forma de pagamento
    const colForma = rows.length > 0
      ? Object.keys(rows[0]).find((k) => k.toUpperCase().replace(/[\s_]/g, '').includes('FORMADEPGTO') || k.toUpperCase().replace(/[\s_]/g, '').includes('FORMAPGTO') || k.toUpperCase().includes('FORMA_DE_PGTO'))
      : null;
    console.log('[buscarDadosAba] Coluna FORMA detectada:', colForma);

    return rows.map((row) => ({
      nomeDespesa: row.NOME_DESPESA || row['NOME DESPESA'] || row['Nome Despesa'] || row['nome_despesa'] || row.Nome || row.nome || row.NOME || row['Nome da Despesa'] || row['Descrição'] || row['descrição'] || row.Descricao || row.DESCRICAO || '',
      vencimento: row.Vencimento || row.vencimento || row.VENCIMENTO || row.Data || row.data || row.DATA || row['Data de Vencimento'] || row['Data Vencimento'] || '',
      valor: parseMoney(row.Valor || row.valor || row.VALOR || row['Valor Pago'] || row['R$'] || 0),
      tipo: row.Tipo || row.tipo || row.TIPO || row['Categoria'] || row['categoria'] || '',
      parcelas: row.Parcelas || row.parcelas || row.PARCELAS || row['Nº Parcelas'] || row['Numero Parcelas'] || row['NUM_PARCELAS'] || '',
      formaPgto: (colForma ? row[colForma] : '') || row.FORMA_DE_PGTO || row['FORMA DE PGTO'] || row['Forma de Pagamento'] || row['forma_de_pgto'] || row.FormaPgto || '',
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


// Monta projeção de parcelados a partir dos registros de parcela 1/X
function montarProjecaoParcelados(ano) {
  const projecao = {};
  for (let m = 1; m <= 12; m++) {
    projecao[m] = { total: 0, itens: [] };
  }

  // Olha APENAS os registros que são a parcela 1 (1/X)
  state.despesas.filter(isCreditoParcelado).forEach((d) => {
    const match = (d.parcelas || '').trim().match(/^1\/(\d+)$/);
    if (!match) return; // ignora se não for 1/X

    const totalParcelas = parseInt(match[1], 10);
    const parsed = extractMonthFrom(d.mesReferencia || '');
    if (!parsed) return;

    // parcela 1 cai no mesReferencia, projeta as demais para frente
    for (let i = 0; i < totalParcelas; i++) {
      const mp = new Date(parsed.year, parsed.month - 1 + i, 1);
      if (mp.getFullYear() !== ano) continue;
      const mes = mp.getMonth() + 1;
      projecao[mes].total += Number(d.valor) || 0;
      projecao[mes].itens.push({
        nome: d.nomeDespesa || d.nome || '',
        valor: Number(d.valor) || 0,
        parcela: i + 1,
        total: totalParcelas,
        tipo: d.tipo || '',
      });
    }
  });

  return projecao;
}

// GRÁFICO DE PARCELADOS
function atualizarChartParcelados() {
  const wrapper = document.getElementById('parcelados-chart-wrapper');
  if (!wrapper) return;

  const ano = yearSelect ? Number(yearSelect.value) : new Date().getFullYear();
  const projecao = montarProjecaoParcelados(ano);

  const temDados = Object.values(projecao).some((v) => v.total > 0);
  if (!temDados) {
    wrapper.innerHTML = '<div style="color:#6b8299;font-size:0.85rem;padding:12px 0;">Nenhuma compra parcelada encontrada para este ano.</div>';
    return;
  }

  const maxTotal = Math.max(...Object.values(projecao).map((v) => v.total), 1);
  const mesSelecionado = state.mesSelecionado ? Number(state.mesSelecionado.split('-')[1]) : null;

  // Mesmo layout do chart-wrapper original
  let html = '';
  for (let i = 1; i <= 12; i++) {
    const dados = projecao[i];
    const isActive = mesSelecionado === i;
    const altPct = dados.total > 0 ? (dados.total / maxTotal) * 100 : 0;
    const activeClass = isActive ? 'active' : '';
    html += `<div class="chart-column ${activeClass}" data-month="${i}" data-parc-total="${dados.total}" style="cursor:pointer;">
      <span class="chart-label">${MONTHS[i - 1]}</span>
      <div class="chart-bar-parc" style="height:${altPct}%;background:${isActive ? '#38ef7d' : '#3a7bd5'};${isActive ? 'box-shadow:0 0 8px #38ef7d88;' : ''}${dados.total === 0 ? 'opacity:0.15;' : ''}"></div>
    </div>`;
  }
  wrapper.innerHTML = html;
  wrapper.className = 'chart-wrapper';

  // Clique para navegar ao mês
  wrapper.querySelectorAll('.chart-column').forEach((col) => {
    col.addEventListener('click', () => {
      setMesAno(ano, Number(col.dataset.month));
    });

    // Tooltip
    col.addEventListener('mousemove', (e) => {
      const mes = Number(col.dataset.month);
      const dados = projecao[mes];
      let tooltipEl = document.getElementById('chart-tooltip');
      if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'chart-tooltip';
        tooltipEl.className = 'chart-tooltip';
        document.body.appendChild(tooltipEl);
      }
      if (dados.total === 0) {
        tooltipEl.style.display = 'none';
        return;
      }
      tooltipEl.innerHTML = `
        <div style="font-weight:700;margin-bottom:6px;color:#fff;border-bottom:1px solid #2d3d4f;padding-bottom:4px;">💳 ${MONTHS[mes - 1]}</div>
        <div>Total parcelado: <span style="color:#38ef7d;font-weight:700;">${formatarMoeda(dados.total)}</span></div>
        <div style="color:#7fa8c8;font-size:0.72rem;margin-top:4px;">${dados.itens.length} compra(s) parcelada(s)</div>
      `;
      tooltipEl.style.display = 'block';
      tooltipEl.style.visibility = 'hidden';
      const h = tooltipEl.offsetHeight;
      const w = tooltipEl.offsetWidth;
      tooltipEl.style.visibility = '';
      tooltipEl.style.left = (e.clientX - w / 2) + 'px';
      tooltipEl.style.top = (e.clientY - h - 8) + 'px';
    });
    col.addEventListener('mouseleave', () => {
      const t = document.getElementById('chart-tooltip');
      if (t) t.style.display = 'none';
    });
  });
}

// GRÁFICO DE CATEGORIAS
const CATEGORIA_CORES = [
  '#38ef7d', '#3a7bd5', '#f7971e', '#eb3349', '#a855f7',
  '#06b6d4', '#f43f5e', '#eab308', '#10b981', '#8b5cf6',
  '#ec4899', '#14b8a6',
];

function atualizarChartCategorias() {
  const wrapper = document.getElementById('categoria-chart-wrapper');
  if (!wrapper) return;

  const despesasFiltradas = filtrarPorMes(state.despesas);

  const categorias = {};
  despesasFiltradas.forEach(function(d) {
    var cat = (d.tipo || '').trim() || 'Sem categoria';
    categorias[cat] = (categorias[cat] || 0) + (Number(d.valor) || 0);
  });

  var entries = [];
  Object.keys(categorias).forEach(function(k) {
    if (categorias[k] > 0) entries.push([k, categorias[k]]);
  });
  entries.sort(function(a, b) { return b[1] - a[1]; });

  if (entries.length === 0) {
    wrapper.innerHTML = '<div class="categoria-empty">Nenhuma despesa no período</div>';
    return;
  }

  var total = 0;
  entries.forEach(function(e) { total += e[1]; });
  var maxVal = entries[0][1];

  wrapper.innerHTML = '';

  entries.forEach(function(e, i) {
    var cor = CATEGORIA_CORES[i % CATEGORIA_CORES.length];
    var pct = ((e[1] / total) * 100).toFixed(1);
    var largura = ((e[1] / maxVal) * 100).toFixed(1);

    var isActive = state.categoriaSelecionada === e[0];
    var opacity = state.categoriaSelecionada && !isActive ? '0.35' : '1';

    var row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:120px 1fr 160px;align-items:center;gap:12px;margin-bottom:8px;cursor:pointer;opacity:' + opacity + ';transition:opacity 0.2s;';

    var label = document.createElement('div');
    label.style.cssText = 'font-size:0.8rem;color:' + (isActive ? '#fff' : '#c8d8e8') + ';text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:' + (isActive ? '700' : '400') + ';';
    label.textContent = e[0];

    var barWrap = document.createElement('div');
    barWrap.style.cssText = 'background:#0d1e2e;border-radius:4px;height:20px;overflow:hidden;outline:' + (isActive ? '2px solid ' + cor : 'none') + ';';

    var bar = document.createElement('div');
    bar.style.cssText = 'height:100%;border-radius:4px;background:' + cor + ';width:' + largura + '%;transition:width 0.4s ease;';

    var info = document.createElement('div');
    info.style.cssText = 'font-size:0.76rem;white-space:nowrap;';
    info.innerHTML = '<span style="color:#7fa8c8;">' + pct + '%</span>&nbsp;&nbsp;<span style="color:' + cor + ';font-weight:700;">' + formatarMoeda(e[1]) + '</span>';

    barWrap.appendChild(bar);
    row.appendChild(label);
    row.appendChild(barWrap);
    row.appendChild(info);
    wrapper.appendChild(row);

    // Clique para filtrar
    row.addEventListener('click', function() {
      state.categoriaSelecionada = isActive ? null : e[0];
      atualizarFiltroChip();
      atualizarPainel();
    });

    // Tooltip
    row.addEventListener('mousemove', function(ev) {
      var tooltipEl = document.getElementById('chart-tooltip');
      if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'chart-tooltip';
        tooltipEl.className = 'chart-tooltip';
        document.body.appendChild(tooltipEl);
      }
      tooltipEl.innerHTML = '<div style="font-weight:700;margin-bottom:6px;color:#fff;border-bottom:1px solid #2d3d4f;padding-bottom:4px;">' + escapeHtml(e[0]) + '</div>'
        + '<div>💸 Valor: <span style="color:#ff6b6b;font-weight:600;">' + formatarMoeda(e[1]) + '</span></div>'
        + '<div>📊 Participação: <span style="color:#38ef7d;font-weight:600;">' + pct + '%</span></div>';
      tooltipEl.style.display = 'block';
      tooltipEl.style.visibility = 'hidden';
      var h = tooltipEl.offsetHeight;
      var w = tooltipEl.offsetWidth;
      tooltipEl.style.visibility = '';
      tooltipEl.style.left = (ev.clientX - w / 2) + 'px';
      tooltipEl.style.top = (ev.clientY - h - 8) + 'px';
    });
    row.addEventListener('mouseleave', function() {
      var t = document.getElementById('chart-tooltip');
      if (t) t.style.display = 'none';
    });
  });
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
    // yyyy-mm-dd
    const iso = dataStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    // dd/mm/yyyy ou dd/mm/yy
    const brl = dataStr.match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
    if (brl) {
      const ano = brl[3].length === 2 ? '20' + brl[3] : brl[3];
      return `${brl[1]}/${brl[2]}/${ano}`;
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
