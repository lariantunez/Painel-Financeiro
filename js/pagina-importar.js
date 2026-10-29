// Assistente de importação: arquivos -> contas do mês -> revisão -> envio.

import { lerExtrato } from './parsers.js';
import { criarClassificador, propagarDecisao, regrasAPartirDe, paraLinhasPlanilha, FORMAS, FORMAS_RECEITA, CATEGORIAS } from './classifier.js';
import { montarFixas, fixasParaLinhas, serieDe } from './fixas.js';
import { parcelasDaMesmaCompra, nomeDaParcela } from './analise.js';
import { valoresUsados, regraParaLinha } from './model.js';
import { moeda, nomeMes, mesAtual, somarMeses, escapeHtml, parseValor, parseData, dataBR, arred, rotulo } from './util.js';
import { backendConfigurado, enviar, config, salvarRegrasLocais } from './api.js';
import { toast, $, $$ } from './ui.js';

const PASSOS = ['Arquivos', 'Contas do mês', 'Revisar', 'Enviar'];
const INSTITUICOES = ['NUBANK', 'BRADESCO', 'ITAÚ', 'PORTO'];

// ───────────── Rascunho: a importação em andamento fica salva no navegador ─────────────
// (recarregar ou fechar a página não perde o que já foi preenchido)
const CHAVE_RASCUNHO = 'pf3_rascunho_importacao';

function restaurarRascunho() {
  try {
    const r = JSON.parse(localStorage.getItem(CHAVE_RASCUNHO));
    if (!r || !(r.arquivos?.length || r.fixas)) return null;
    return { ...r, selecionados: new Set(r.selecionados || []), resultado: null, enviando: false, restaurado: r.salvoEm };
  } catch {
    return null;
  }
}

function salvarRascunho() {
  try {
    if (!importacaoEmAndamento() || imp.resultado) localStorage.removeItem(CHAVE_RASCUNHO);
    else localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({ ...imp, selecionados: [...imp.selecionados], restaurado: null, salvoEm: Date.now() }));
  } catch {
    /* sem armazenamento disponível: segue sem rascunho */
  }
}

const imp = restaurarRascunho() || novoEstado();

// Aviso do navegador ao sair com importação preenchida e não enviada
window.addEventListener('beforeunload', (e) => {
  if (importacaoEmAndamento() && !imp.resultado) {
    salvarRascunho();
    e.preventDefault();
    e.returnValue = '';
  }
});

function novoEstado() {
  return {
    passo: 0,
    arquivos: [],
    lancamentos: [],
    mesFixas: mesAtual(),
    fixas: null,
    novasFixas: [],
    resultado: null,
    enviando: false,
    tiposExtras: [],
    selecionados: new Set(),
    restaurado: null,
  };
}

export function importacaoEmAndamento() {
  return imp.arquivos.length > 0 || imp.fixas !== null;
}

export function renderImportar(raiz, app) {
  const { dados } = app.estado;
  if (!dados) {
    raiz.innerHTML = '<div class="vazio">Carregando dados da planilha…</div>';
    return;
  }
  const tela = [passoArquivos, passoFixas, passoRevisar, passoEnviar][imp.passo];
  raiz.innerHTML = `
    <div class="cabecalho-pagina"><h1 style="font-size:22px;margin:0">Importar lançamentos</h1>
      ${importacaoEmAndamento() && !imp.resultado ? '<button class="btn btn-sm btn-ghost" id="recomecar">Recomeçar</button>' : ''}</div>
    ${imp.restaurado ? `<div class="aviso info"><div><b>Importação restaurada.</b> Você continua de onde parou (salvo às ${new Date(imp.restaurado).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}). Para começar do zero, clique em “Recomeçar”.</div></div>` : ''}
    ${backendConfigurado() ? '' : '<div class="aviso info"><div><b>Modo sem conexão com a planilha.</b> Você pode importar e classificar normalmente; no final o painel copia as linhas prontas para você colar na planilha. Para gravar automaticamente, <a href="#/config">configure o backend</a>.</div></div>'}
    <nav class="passos">${PASSOS.map((p, i) => `<button class="passo ${i === imp.passo ? 'ativo' : ''} ${i < imp.passo ? 'feito' : ''}" data-passo="${i}" ${i > imp.passo || imp.resultado ? 'disabled' : ''}><span class="n">${i < imp.passo ? '✓' : i + 1}</span>${p}</button>`).join('')}</nav>
    <div id="conteudo-passo"></div>`;
  for (const b of $$('[data-passo]', raiz)) b.addEventListener('click', () => irPara(+b.dataset.passo, app));
  $('#recomecar', raiz)?.addEventListener('click', () => {
    Object.assign(imp, novoEstado());
    app.renderizar();
  });
  tela($('#conteudo-passo', raiz), app);
  salvarRascunho();
}

function irPara(passo, app) {
  if (passo === 1 && !imp.fixas) carregarFixas(app);
  if (passo === 2) congelarSecoes();
  imp.passo = passo;
  app.renderizar();
  window.scrollTo({ top: 0 });
}

// ═════════════════════════ Passo 1 — Arquivos ═════════════════════════

function passoArquivos(el, app) {
  const total = imp.lancamentos.length;
  const meses = [];
  for (let i = -2; i <= 1; i++) meses.push(somarMeses(mesAtual(), i));
  el.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <label class="dropzone" id="drop">
        <input type="file" id="arquivo" multiple accept=".csv,.ofx,.txt" hidden>
        <div class="grande">Arraste aqui a fatura do cartão e o extrato da conta</div>
        <div class="muted">ou clique para escolher · CSV do Nubank, OFX de qualquer banco ou CSV com data, descrição e valor</div>
      </label>
      ${imp.arquivos.length ? `<div style="margin-top:12px">${imp.arquivos.map(linhaArquivo).join('')}</div>` : ''}
    </div>

    <div class="card">
      <div class="card-titulo"><h2>Contas do mês</h2><span class="sub">Contas mensais: no próximo passo você confirma valor e status de cada uma</span></div>
      <label class="campo" style="max-width:260px">Mês das contas mensais
        <select class="select" id="mes-fixas">${meses.map((m) => `<option value="${m}" ${m === imp.mesFixas ? 'selected' : ''}>${nomeMes(m)}</option>`).join('')}</select>
      </label>
    </div>

    <div class="rodape-acoes">
      <span class="muted">${total ? `${total} lançamento(s) lidos dos arquivos` : 'Sem arquivos? Dá para lançar só as contas do mês.'}</span>
      <button class="btn btn-primario" id="avancar">${total ? 'Continuar' : 'Só contas do mês'} →</button>
    </div>
    ${historicoImportacoes(app)}`;

  const input = $('#arquivo', el);
  const drop = $('#drop', el);
  input.addEventListener('change', () => adicionarArquivos([...input.files], app));
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('arrastando');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('arrastando'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('arrastando');
    adicionarArquivos([...e.dataTransfer.files], app);
  });
  $('#mes-fixas', el).addEventListener('change', (e) => {
    imp.mesFixas = e.target.value;
    imp.fixas = null;
  });
  $('#avancar', el).addEventListener('click', () => irPara(1, app));

  for (const s of $$('[data-arq-origem]', el)) {
    s.addEventListener('change', () => {
      imp.arquivos[+s.dataset.arqOrigem].origem = s.value;
      reclassificar(app);
    });
  }
  for (const s of $$('[data-arq-inst]', el)) {
    s.addEventListener('change', () => {
      imp.arquivos[+s.dataset.arqInst].instituicao = s.value;
      reclassificar(app);
    });
  }
  for (const s of $$('[data-arq-mes]', el)) {
    s.addEventListener('change', () => {
      imp.arquivos[+s.dataset.arqMes].mesFatura = s.value;
      reclassificar(app);
    });
  }
  for (const b of $$('[data-arq-remover]', el)) {
    b.addEventListener('click', () => {
      imp.arquivos.splice(+b.dataset.arqRemover, 1);
      reclassificar(app);
    });
  }
  for (const b of $$('[data-desfazer]', el)) b.addEventListener('click', () => desfazer(b, app));
}

function linhaArquivo(a, i) {
  if (a.erro) {
    return `<div class="arquivo"><div><b>${escapeHtml(a.nome)}</b><div class="small neg">${escapeHtml(a.erro)}</div></div><span></span><span></span><button class="btn btn-sm btn-ghost" data-arq-remover="${i}">Remover</button></div>`;
  }
  const periodo = a.extrato.transacoes.map((t) => dataBR(t.data)).sort((x, y) => (parseData(x).ano * 400 + parseData(x).mes * 32 + parseData(x).dia) - (parseData(y).ano * 400 + parseData(y).mes * 32 + parseData(y).dia));
  return `<div class="arquivo">
    <div><b>${escapeHtml(a.nome)}</b><div class="small muted">${escapeHtml(a.extrato.formato)} · ${a.extrato.transacoes.length} movimentações${periodo.length ? ` · ${periodo[0]} a ${periodo[periodo.length - 1]}` : ''}</div></div>
    <select class="select select-sm" data-arq-origem="${i}" aria-label="Tipo de extrato">
      <option value="cartao" ${a.origem === 'cartao' ? 'selected' : ''}>Fatura do cartão</option>
      <option value="conta" ${a.origem === 'conta' ? 'selected' : ''}>Extrato da conta</option>
    </select>
    <select class="select select-sm" data-arq-inst="${i}" aria-label="Banco">${INSTITUICOES.map((n) => `<option ${n === a.instituicao ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <button class="btn btn-sm btn-ghost" data-arq-remover="${i}">Remover</button>
    ${
      a.origem === 'cartao'
        ? `<label class="small text-2" style="grid-column:1/-1;display:flex;align-items:center;gap:8px">Mês da fatura (vale para todas as compras do arquivo)
        <select class="select select-sm" style="width:auto" data-arq-mes="${i}">${[-3, -2, -1, 0].map((n) => somarMeses(mesAtual(), n)).map((m) => `<option value="${m}" ${m === a.mesFatura ? 'selected' : ''}>${nomeMes(m)}</option>`).join('')}</select></label>`
        : ''
    }
  </div>`;
}

async function adicionarArquivos(arquivos, app) {
  for (const f of arquivos) {
    if (imp.arquivos.some((a) => a.nome === f.name && a.tamanho === f.size)) {
      toast(`“${f.name}” já foi adicionado`);
      continue;
    }
    try {
      const texto = decodificar(await f.arrayBuffer());
      const extrato = lerExtrato(texto, f.name);
      if (!extrato.transacoes.length) throw new Error('Nenhuma movimentação encontrada no arquivo.');
      // A fatura inteira conta para o mês anterior, mesmo com compras feitas no mês atual
      imp.arquivos.push({ nome: f.name, tamanho: f.size, extrato, origem: extrato.origem, instituicao: extrato.instituicao || config.instituicaoCartao, mesFatura: somarMeses(mesAtual(), -1) });
    } catch (e) {
      imp.arquivos.push({ nome: f.name, tamanho: f.size, erro: e.message });
    }
  }
  reclassificar(app);
}

function decodificar(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer); // OFX de bancos costuma vir em Latin-1
  }
}

// Reclassifica tudo, preservando o que o usuário já editou
function reclassificar(app) {
  const editados = new Map(imp.lancamentos.filter((l) => l.editado).map((l) => [l.id, l]));
  const cls = criarClassificador({ ...app.estado.dados, titulares: config.titulares });
  imp.lancamentos = [];
  for (const a of imp.arquivos) {
    if (a.erro) continue;
    const extrato = { ...a.extrato, origem: a.origem, instituicao: a.instituicao, mesFatura: a.origem === 'cartao' ? a.mesFatura : null };
    for (const l of cls.classificarExtrato(extrato)) imp.lancamentos.push(editados.get(l.id) || l);
  }
  for (const l of imp.lancamentos) if (l.possivelDuplicado && l.excluir === undefined) l.excluir = true;
  app.renderizar();
}

function historicoImportacoes(app) {
  const lista = (app.estado.dados.importacoes || []).slice().reverse();
  if (!lista.length || !backendConfigurado()) return '';
  return `<div class="card" style="margin-top:24px">
    <div class="card-titulo"><h2>Últimas importações</h2><span class="sub">Desfazer remove da planilha todas as linhas daquela importação</span></div>
    <div class="lista">${lista
      .map(
        (i) => `<div class="lista-item"><div class="principal"><div>${escapeHtml(i.data)}</div><div class="small">${i.despesas} despesa(s), ${i.receitas} receita(s) · ${escapeHtml(i.descricao || '')}</div></div>
        <button class="btn btn-sm btn-perigo" data-desfazer="${escapeHtml(i.lote)}">Desfazer</button></div>`
      )
      .join('')}</div></div>`;
}

async function desfazer(botao, app) {
  if (botao.dataset.confirmar !== '1') {
    botao.dataset.confirmar = '1';
    botao.textContent = 'Confirmar?';
    setTimeout(() => {
      botao.dataset.confirmar = '';
      botao.textContent = 'Desfazer';
    }, 4000);
    return;
  }
  botao.disabled = true;
  try {
    const r = await enviar('desfazer', { lote: botao.dataset.desfazer });
    toast(`${r.removidas} linha(s) removida(s) da planilha`);
    await app.recarregar();
  } catch (e) {
    toast(e.message, 'erro', 6000);
    botao.disabled = false;
  }
}

// ═════════════════════════ Passo 2 — Contas do mês ═════════════════════════

function carregarFixas(app) {
  imp.fixas = montarFixas({ ...app.estado.dados, mesAlvo: imp.mesFixas, instituicaoCartao: config.instituicaoCartao });
  imp.novasFixas = [];
}

function passoFixas(el, app) {
  const f = imp.fixas;
  const tipos = listaTipos(app);
  const pend = f.despesas.filter((x) => !x.jaLancado);
  el.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="card-titulo"><h2>Contas mensais · ${nomeMes(imp.mesFixas)}</h2>
        <span class="sub">${pend.filter((x) => x.incluir).length} para lançar${f.despesas.length - pend.length ? ` · ${f.despesas.length - pend.length} já na planilha` : ''}</span></div>
      <p class="muted small" style="margin:-6px 0 8px">Desmarque o que não existe mais, ajuste o valor deste mês e diga se já pagou. Vencimento e parcela já vêm calculados.</p>
      <div id="lista-fixas">${f.despesas.map((x, i) => linhaFixa(x, i)).join('') || '<div class="vazio">Nenhuma conta mensal encontrada nos últimos meses.</div>'}</div>
      ${imp.novasFixas.map((x, i) => linhaNovaFixa(x, i, tipos)).join('')}
      <button class="btn btn-sm" id="add-fixa" style="margin-top:10px">+ Nova conta mensal</button>
      ${f.viaCartao.length ? `<p class="small muted" style="margin:14px 0 0">Vêm pela fatura do cartão e são reconhecidas na importação: ${f.viaCartao.map(escapeHtml).join(', ')}.</p>` : ''}
    </div>

    ${
      f.receitas.length || f.receitasViaExtrato.length
        ? `<div class="card">
      <div class="card-titulo"><h2>Receitas mensais · ${nomeMes(imp.mesFixas)}</h2><span class="sub">Salários e outras entradas recorrentes</span></div>
      ${f.receitas.map((x, i) => linhaReceitaFixa(x, i)).join('')}
      ${f.receitasViaExtrato.length ? `<p class="small muted" style="margin:${f.receitas.length ? '14px' : '0'} 0 0">${f.receitas.length ? '' : '✓ Nada para lançar à mão. '}Chegam pelo extrato da conta e são reconhecidas na importação: ${f.receitasViaExtrato.map(escapeHtml).join(', ')}.</p>` : ''}
    </div>`
        : ''
    }

    <div class="rodape-acoes">
      <button class="btn" data-ir="0">← Voltar</button>
      <button class="btn btn-primario" data-ir="2">Continuar →</button>
    </div>`;

  for (const b of $$('[data-ir]', el)) b.addEventListener('click', () => irPara(+b.dataset.ir, app));
  $('#add-fixa', el).addEventListener('click', () => {
    imp.novasFixas.push({ nome: '', tipo: '', forma: 'BOLETO', instituicao: 'NUBANK', valor: '', vencimento: dataBR({ ano: +imp.mesFixas.slice(0, 4), mes: +imp.mesFixas.slice(5), dia: 10 }), status: 'A PAGAR', parcelas: '1/1', incluir: true });
    app.renderizar();
  });

  // Despesas fixas
  ligarLista(el, '[data-fixa]', (i) => f.despesas[i]);
  ligarLista(el, '[data-rfixa]', (i) => f.receitas[i]);
  ligarLista(el, '[data-nfixa]', (i) => imp.novasFixas[i]);
  for (const b of $$('[data-remover-nova]', el)) {
    b.addEventListener('click', () => {
      imp.novasFixas.splice(+b.dataset.removerNova, 1);
      app.renderizar();
    });
  }
}

// Liga os campos de uma linha (checkbox, inputs, segmentado de status) ao objeto correspondente
function ligarLista(el, seletor, obter) {
  for (const linha of $$(seletor, el)) {
    const item = obter(+linha.dataset[Object.keys(linha.dataset)[0]]);
    for (const campo of $$('[data-campo]', linha)) {
      const evento = campo.type === 'checkbox' ? 'change' : 'input';
      campo.addEventListener(evento, () => {
        const c = campo.dataset.campo;
        item[c] = campo.type === 'checkbox' ? campo.checked : campo.value;
        if (c === 'incluir') linha.classList.toggle('desligada', !campo.checked);
        salvarRascunho();
      });
    }
    for (const b of $$('.seg button', linha)) {
      b.addEventListener('click', () => {
        item.status = b.dataset.status;
        salvarRascunho();
        $$('.seg button', linha).forEach((x) => x.classList.toggle('ativo', x === b));
      });
    }
  }
}

function segStatus(status, rotulos = ['A PAGAR', 'PAGO']) {
  return `<div class="seg" role="group" aria-label="Status">${rotulos.map((s) => `<button type="button" data-status="${s}" class="${rotulo(status) === s ? 'ativo' : ''}">${s === 'PAGO' ? 'Pago' : 'A pagar'}</button>`).join('')}</div>`;
}

function valorCampo(v) {
  return typeof v === 'number' ? v.toFixed(2).replace('.', ',') : escapeHtml(v);
}

function linhaFixa(x, i) {
  const variou = x.valorAnterior !== null && Math.abs(x.valor - x.valorAnterior) > 0.009;
  const info = x.jaLancado
    ? '<span class="badge badge-good">✓ já está na planilha</span>'
    : x.encerrada
      ? '<span class="badge badge-warn">parcelas terminaram?</span>'
      : `último: ${moeda(x.valorAnterior)} em ${nomeMes(x.mesAnterior, false)}`;
  return `<div class="fixa ${x.incluir ? '' : 'desligada'}" data-fixa="${i}">
    <input type="checkbox" data-campo="incluir" ${x.incluir ? 'checked' : ''} ${x.jaLancado ? 'disabled' : ''} aria-label="Incluir ${escapeHtml(x.nome)}">
    <div class="fixa-info"><div>${escapeHtml(x.nome)}${x.parcelas !== '1/1' ? ` <span class="muted small">${escapeHtml(x.parcelas)}</span>` : ''}</div>
      <div class="small">${escapeHtml(x.tipo)} · ${escapeHtml(x.forma)} · ${escapeHtml(x.instituicao)} · ${info}${variou ? ' · <b>valor mudou</b>' : ''}</div></div>
    <input class="input input-sm num" data-campo="valor" inputmode="decimal" value="${valorCampo(x.valor)}" aria-label="Valor">
    <input class="input input-sm num" data-campo="vencimento" value="${escapeHtml(x.vencimento)}" aria-label="Vencimento">
    ${segStatus(x.status)}
  </div>`;
}

function linhaNovaFixa(x, i, tipos) {
  return `<div class="fixa" data-nfixa="${i}">
    <button class="btn btn-ghost btn-icone btn-sm" data-remover-nova="${i}" aria-label="Remover">✕</button>
    <div style="display:grid;gap:6px;grid-template-columns:minmax(0,1.4fr) repeat(3,minmax(0,1fr))">
      <input class="input input-sm" data-campo="nome" placeholder="Nome da conta" value="${escapeHtml(x.nome)}">
      <select class="select select-sm" data-campo="tipo"><option value="">Tipo…</option>${tipos.map((t) => `<option ${t === x.tipo ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select>
      <select class="select select-sm" data-campo="forma">${FORMAS.map((t) => `<option ${t === x.forma ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select class="select select-sm" data-campo="instituicao">${INSTITUICOES.map((t) => `<option ${t === x.instituicao ? 'selected' : ''}>${t}</option>`).join('')}</select>
    </div>
    <input class="input input-sm num" data-campo="valor" inputmode="decimal" placeholder="Valor" value="${escapeHtml(x.valor)}">
    <input class="input input-sm num" data-campo="vencimento" value="${escapeHtml(x.vencimento)}" aria-label="Vencimento">
    ${segStatus(x.status)}
  </div>`;
}

function linhaReceitaFixa(x, i) {
  return `<div class="fixa ${x.incluir ? '' : 'desligada'}" data-rfixa="${i}">
    <input type="checkbox" data-campo="incluir" ${x.incluir ? 'checked' : ''} ${x.jaLancado ? 'disabled' : ''} aria-label="Incluir ${escapeHtml(x.tipo)}">
    <div class="fixa-info"><div>${escapeHtml(x.tipo)}</div><div class="small">${escapeHtml(x.titular)} · ${escapeHtml(x.instituicao)} · ${x.jaLancado ? '<span class="badge badge-good">✓ já está na planilha</span>' : `último: ${moeda(x.valorAnterior)}`}</div></div>
    <input class="input input-sm num" data-campo="valor" inputmode="decimal" value="${valorCampo(x.valor)}" aria-label="Valor" ${x.jaLancado ? 'disabled' : ''}>
    <span></span><span></span>
  </div>`;
}

// ═════════════════════════ Passo 3 — Revisar ═════════════════════════

// As seções são definidas ao entrar no passo, para as linhas não "pularem" enquanto você edita
function congelarSecoes() {
  // Conta fixa do checklist paga no mesmo mês do extrato: o lançamento do extrato é a mesma conta
  const doChecklist = (imp.fixas?.despesas || []).filter((f) => f.incluir && !f.jaLancado);
  for (const l of imp.lancamentos) {
    if (l.destino !== 'DESPESA' || l.jaLancado || l.possivelDuplicado || l.mesRef !== imp.mesFixas) continue;
    const f = doChecklist.find((x) => Math.abs(parseValor(x.valor) - l.valor) < 0.01);
    if (f) {
      doChecklist.splice(doChecklist.indexOf(f), 1);
      Object.assign(l, { possivelDuplicado: true, excluir: true, motivo: `Mesma conta mensal “${f.nome}” do passo anterior` });
    }
  }
  for (const l of imp.lancamentos) {
    if (l.jaLancado) l.secao = 'lancado';
    else if (l.possivelDuplicado) l.secao = 'duplicado';
    else if (l.destino === 'IGNORAR' && l.confianca === 'certo') l.secao = 'ignorado';
    else if (l.confianca === 'certo') l.secao = 'auto';
    else l.secao = 'atencao';
  }
}

function listaTipos(app) {
  const usados = valoresUsados(app.estado.dados.despesas.filter((d) => d.mesRef >= somarMeses(mesAtual(), -12)), 'tipo');
  return [...new Set([...usados, ...imp.tiposExtras])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function pendentes() {
  return imp.lancamentos.filter((l) => !l.jaLancado && !l.excluir && ((l.destino === 'DESPESA' && !l.tipo) || (l.destino === 'RECEITA' && (!l.tipo || !l.titular))));
}

function passoRevisar(el, app) {
  if (!imp.lancamentos.length) {
    el.innerHTML = `<div class="card"><div class="vazio">Nenhum arquivo importado — siga para enviar as contas do mês.</div></div>
      <div class="rodape-acoes"><button class="btn" data-ir="1">← Voltar</button><button class="btn btn-primario" data-ir="3">Continuar →</button></div>`;
    for (const b of $$('[data-ir]', el)) b.addEventListener('click', () => irPara(+b.dataset.ir, app));
    return;
  }
  const grupos = { atencao: [], auto: [], duplicado: [], ignorado: [], lancado: [] };
  imp.lancamentos.forEach((l, i) => grupos[l.secao].push(i));
  const ctx = { tipos: listaTipos(app), titulares: [...new Set([...Object.values(config.titulares), ...valoresUsados(app.estado.dados.receitas, 'nome')])], tiposReceita: valoresUsados(app.estado.dados.receitas, 'tipo').slice(0, 40) };

  const secao = (id, titulo, sub, aberta) =>
    grupos[id].length
      ? `<details class="secao card" style="margin-bottom:12px" ${aberta ? 'open' : ''}><summary>${titulo} <span class="badge">${grupos[id].length}</span><span class="muted small" style="font-weight:400">${sub}</span></summary>
         ${id === 'atencao' ? barraLote(ctx) : ''}
         <div style="margin-top:8px">${grupos[id].map((i) => linhaRevisao(imp.lancamentos[i], i, ctx)).join('')}</div></details>`
      : '';

  el.innerHTML = `
    <div class="resumo">
      ${miniResumo('Precisam de você', grupos.atencao.length)}
      ${miniResumo('Classificados sozinhos', grupos.auto.length)}
      ${miniResumo('Ignorados', grupos.ignorado.length + grupos.duplicado.length)}
      ${miniResumo('Já estavam na planilha', grupos.lancado.length)}
    </div>
    <datalist id="dl-receitas">${ctx.tiposReceita.map((t) => `<option value="${escapeHtml(t)}">`).join('')}</datalist>
    ${grupos.atencao.length ? '' : '<div class="aviso info"><div>Tudo foi classificado automaticamente. Dê uma olhada se quiser e siga em frente.</div></div>'}
    ${secao('atencao', 'Precisam da sua atenção', ' · lançamentos novos ou com dúvida — o que você decidir vale para os próximos', true)}
    ${secao('duplicado', 'Possíveis duplicados', ' · já existe lançamento com mesma data e valor; marque “Incluir” se não for o caso', true)}
    ${secao('auto', 'Classificados automaticamente', ' · confira se quiser', grupos.atencao.length === 0)}
    ${secao('ignorado', 'Ignorados', ' · pagamento de fatura, caixinha, transferências entre suas contas', false)}
    ${secao('lancado', 'Já estavam na planilha', ' · importados antes, não serão duplicados', false)}
    <div class="rodape-acoes">
      <button class="btn" data-ir="1">← Voltar</button>
      <span class="muted" id="pendencias"></span>
      <button class="btn btn-primario" id="avancar">Continuar →</button>
    </div>`;

  for (const b of $$('[data-ir]', el)) b.addEventListener('click', () => irPara(+b.dataset.ir, app));
  $('#avancar', el).addEventListener('click', () => {
    const p = pendentes();
    if (p.length) {
      toast(`Falta classificar ${p.length} lançamento(s)`, 'erro');
      const alvo = $(`[data-rev="${imp.lancamentos.indexOf(p[0])}"]`, el);
      alvo?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    irPara(3, app);
  });
  atualizarPendencias(el);
  $('#lote-ignorar', el)?.addEventListener('click', () => {
    for (const i of imp.selecionados) {
      imp.lancamentos[i].destino = 'IGNORAR';
      decidir(imp.lancamentos[i]);
    }
    imp.selecionados = new Set();
    redesenhar(el, app);
  });
  el._ctx = ctx;
  if (!el._ligado) {
    ligarRevisao(el, app);
    el._ligado = true;
  }
}

// Classificação em lote: marque vários lançamentos e aplique o mesmo tipo
function barraLote(ctx) {
  const n = imp.selecionados.size;
  return `<div class="lote">
    <label><input type="checkbox" id="sel-todos" ${n ? 'checked' : ''}> ${n ? `${n} selecionado(s)` : 'Selecionar despesas sem tipo'}</label>
    ${n ? `<select class="select select-sm" id="lote-tipo" aria-label="Tipo para os selecionados"><option value="">Aplicar tipo…</option>${ctx.tipos.map((t) => `<option>${escapeHtml(t)}</option>`).join('')}</select>
    <button class="btn btn-sm" id="lote-ignorar">Ignorar selecionados</button>` : '<span class="muted small">ou marque cada linha para classificar várias de uma vez</span>'}
  </div>`;
}

function miniResumo(rotuloResumo, n) {
  return `<div class="card"><div class="muted small">${rotuloResumo}</div><div class="valor">${n}</div></div>`;
}

function opcoes(lista, atual, vazio) {
  const temAtual = !atual || lista.includes(atual);
  return `${vazio ? `<option value="">${vazio}</option>` : ''}${temAtual ? '' : `<option selected>${escapeHtml(atual)}</option>`}${lista.map((t) => `<option ${t === atual ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}`;
}

function linhaRevisao(l, i, ctx) {
  const ignorado = l.destino === 'IGNORAR' || l.excluir;
  const travado = l.jaLancado;
  const dis = travado ? 'disabled' : '';
  let campos;
  if (l.destino === 'DESPESA') {
    campos = `<select class="select select-sm ${l.tipo ? '' : 'falta'}" data-c="tipo" ${dis} aria-label="Tipo">${opcoes(ctx.tipos, l.tipo, 'Escolha o tipo…')}<option value="__novo">+ Novo tipo…</option></select>
      <select class="select select-sm" data-c="categoria" ${dis} aria-label="Categoria (valor fixo ou variável)">${opcoes(CATEGORIAS, l.categoria)}</select>
      <select class="select select-sm" data-c="recorrencia" ${dis} aria-label="Recorrência"><option value="EVENTUAL" ${l.recorrencia !== 'MENSAL' ? 'selected' : ''}>Eventual</option><option value="MENSAL" ${l.recorrencia === 'MENSAL' ? 'selected' : ''}>Mensal</option></select>`;
  } else if (l.destino === 'RECEITA') {
    // na receita, o "nome no painel" é a descrição (coluna TIPO da aba Receitas)
    campos = `<select class="select select-sm ${l.titular ? '' : 'falta'}" data-c="titular" ${dis} aria-label="Quem recebeu">${opcoes(ctx.titulares, l.titular, 'Quem recebeu…')}</select><span></span><span></span>`;
  } else {
    campos = '<span class="muted small" style="grid-column:span 3">não vai para a planilha</span>';
  }
  const parcela = l.parcelas && l.parcelas !== '1/1' ? ` · parcela ${l.parcelas}` : '';
  const podePerguntar = !travado && l.destino !== 'IGNORAR' && l.secao === 'atencao';
  return `<div class="revisao-item ${ignorado ? 'ignorado' : ''} ${l.secao === 'atencao' ? 'pendente' : ''}" data-rev="${i}">
    <div class="num small r-data">${l.secao === 'atencao' && !travado ? `<input type="checkbox" data-sel="${i}" ${imp.selecionados.has(i) ? 'checked' : ''} aria-label="Selecionar"> ` : ''}${l.vencimento.slice(0, 5)}<div class="muted">${l.origem === 'cartao' ? 'cartão' : 'conta'}</div></div>
    <div class="desc">
      <div class="no-banco" title="${escapeHtml(l.descricaoOriginal)}"><span class="rot">No banco</span><span class="txt">${escapeHtml(l.descricaoOriginal)}</span></div>
      <label class="nome-painel"><span class="rot">Nome no painel</span>${
        l.destino === 'RECEITA'
          ? `<input class="input input-sm ${l.tipo ? '' : 'falta'}" data-c="tipo" list="dl-receitas" placeholder="Ex.: Salário, Reembolso…" value="${escapeHtml(l.tipo)}" ${dis}>`
          : `<input class="input input-sm" data-c="nome" value="${escapeHtml(l.nome)}" ${travado || l.destino !== 'DESPESA' ? 'disabled' : ''}>`
      }</label>
      <div class="motivo">${escapeHtml(l.forma)}${parcela} · ${escapeHtml(l.motivo)}
        ${podePerguntar ? `· <label><input type="checkbox" data-c="perguntar" ${l.perguntar ? 'checked' : ''}> perguntar sempre</label>` : ''}
        ${l.secao === 'duplicado' ? `· <label><input type="checkbox" data-c="incluir" ${l.excluir ? '' : 'checked'}> Incluir</label>` : ''}</div>
    </div>
    <div class="num ${l.valor < 0 ? 'pos' : ''}" style="text-align:right">${moeda(l.valor)}</div>
    <select class="select select-sm" data-c="destino" ${dis} aria-label="Destino">
      <option value="DESPESA" ${l.destino === 'DESPESA' ? 'selected' : ''}>Despesa</option>
      <option value="RECEITA" ${l.destino === 'RECEITA' ? 'selected' : ''}>Receita</option>
      <option value="IGNORAR" ${l.destino === 'IGNORAR' ? 'selected' : ''}>Ignorar</option>
    </select>
    ${campos}
  </div>`;
}

function ligarRevisao(el, app) {
  el.addEventListener('change', (e) => {
    const ctx = el._ctx;
    if (e.target.dataset.sel !== undefined) {
      const i = +e.target.dataset.sel;
      if (e.target.checked) imp.selecionados.add(i);
      else imp.selecionados.delete(i);
      redesenhar(el, app);
      return;
    }
    if (e.target.id === 'sel-todos') {
      imp.selecionados = new Set();
      if (e.target.checked) imp.lancamentos.forEach((l, i) => l.secao === 'atencao' && l.destino === 'DESPESA' && !l.tipo && imp.selecionados.add(i));
      redesenhar(el, app);
      return;
    }
    if (e.target.id === 'lote-tipo' && e.target.value) {
      for (const i of imp.selecionados) {
        const l = imp.lancamentos[i];
        Object.assign(l, { destino: 'DESPESA', tipo: e.target.value });
        decidir(l);
      }
      imp.selecionados = new Set();
      redesenhar(el, app);
      return;
    }
    const campo = e.target.closest('[data-c]');
    const linha = e.target.closest('[data-rev]');
    if (!campo || !linha) return;
    const l = imp.lancamentos[+linha.dataset.rev];
    const c = campo.dataset.c;

    if (c === 'tipo' && campo.value === '__novo') {
      const input = document.createElement('input');
      input.className = 'input input-sm';
      input.placeholder = 'Nome do novo tipo';
      campo.replaceWith(input);
      input.focus();
      input.addEventListener('change', () => {
        const novo = input.value.trim().toUpperCase();
        if (novo) {
          imp.tiposExtras.push(novo);
          ctx.tipos.push(novo);
          l.tipo = novo;
          decidir(l);
        }
        redesenhar(el, app);
      });
      return;
    }

    if (c === 'perguntar') l.perguntar = campo.checked;
    else if (c === 'incluir') l.excluir = !campo.checked;
    else if (c === 'destino') {
      l.destino = campo.value;
      if (l.destino === 'RECEITA') {
        l.tipo = l.tipo && !ctx.tipos.includes(l.tipo) ? l.tipo : '';
        l.titular = l.titular || config.titulares[l.instituicao] || '';
        l.forma = FORMAS_RECEITA.includes(l.forma) ? l.forma : 'PIX';
      } else if (l.destino === 'DESPESA') {
        if (!ctx.tipos.includes(l.tipo)) l.tipo = '';
        if (l.forma === 'DEPÓSITO EM CONTA') l.forma = 'PIX';
      }
      l.valor = l.destino === 'DESPESA' && l.tx.entrada && l.origem === 'cartao' ? -l.tx.valor : l.tx.valor;
    } else l[c] = c === 'tipo' && l.destino === 'RECEITA' ? campo.value.trim() : campo.value;

    decidir(l);
    salvarRascunho();
    // Mudanças estruturais redesenham; edição simples só atualiza o contador
    if (['destino', 'tipo', 'categoria', 'recorrencia', 'titular', 'incluir'].includes(c)) redesenhar(el, app);
    else atualizarPendencias(el);
  });
}

function decidir(l) {
  l.editado = true;
  if (l.secao !== 'atencao' && l.secao !== 'duplicado') l.motivo = 'Ajustado por você';
  propagarDecisao(imp.lancamentos.filter((x) => !x.editado || x === l), l);
}

function redesenhar(el, app) {
  const y = window.scrollY;
  passoRevisar(el, app);
  window.scrollTo({ top: y });
}

function atualizarPendencias(el) {
  const n = pendentes().length;
  const alvo = $('#pendencias', el);
  if (alvo) alvo.textContent = n ? `${n} lançamento(s) sem tipo` : '';
}

// ═════════════════════════ Passo 4 — Enviar ═════════════════════════

// Parcela renomeada (ou com tipo trocado) na revisão: as parcelas anteriores da mesma compra acompanham
function renomearParcelasAnteriores(dados) {
  const alteracoes = [];
  for (const l of imp.lancamentos) {
    const ant = l.anteriorParcela;
    if (!ant || !l.editado || l.excluir || l.jaLancado || l.destino !== 'DESPESA') continue;
    for (const x of parcelasDaMesmaCompra(dados.despesas, ant)) {
      const campos = {};
      const nome = nomeDaParcela(l.nome, x);
      if (nome !== x.nome) campos.NOME_DESPESA = nome;
      if (l.tipo && l.tipo !== x.tipo) campos.TIPO = l.tipo;
      if (Object.keys(campos).length) alteracoes.push({ aba: 'despesas', linha: x._linha, nome: x.nome, campos });
    }
  }
  return alteracoes;
}

function montarEnvio(dados) {
  const lanc = paraLinhasPlanilha(imp.lancamentos);
  const fixas = imp.fixas ? fixasParaLinhas({ ...imp.fixas, despesas: [...imp.fixas.despesas, ...imp.novasFixas.filter((n) => n.nome).map((n) => ({ ...n, serie: serieDe(n.nome) }))] }, imp.mesFixas) : { despesas: [], receitas: [] };
  const regras = regrasAPartirDe(imp.lancamentos);
  // Contas já lançadas como "A PAGAR" que apareceram pagas no extrato
  const pagasNoExtrato = imp.lancamentos
    .filter((l) => l.possivelDuplicado && l.excluir && l.duplicadoDe && rotulo(l.duplicadoDe.status) === 'A PAGAR')
    .map((l) => ({ aba: 'despesas', linha: l.duplicadoDe._linha, nome: l.duplicadoDe.nome, campos: { STATUS: 'PAGO' } }));
  // Fixas que já estavam na planilha e tiveram status/valor alterado aqui
  const alteracoes = (imp.fixas?.despesas || [])
    .filter((f) => f.jaLancado && (rotulo(f.status) !== rotulo(f.jaLancado.status) || Math.abs(parseValor(f.valor) - Math.abs(f.jaLancado.valor)) > 0.009))
    .map((f) => ({ aba: 'despesas', linha: f.jaLancado._linha, nome: f.jaLancado.nome, campos: { STATUS: f.status, VALOR: arred(parseValor(f.valor)) } }));
  return {
    despesas: [...fixas.despesas, ...lanc.despesas],
    receitas: [...fixas.receitas, ...lanc.receitas],
    regras,
    alteracoes: [...alteracoes, ...pagasNoExtrato.filter((p) => !alteracoes.some((a) => a.linha === p.linha)), ...renomearParcelasAnteriores(dados)],
    qtdFixas: fixas.despesas.length + fixas.receitas.length,
  };
}

function passoEnviar(el, app) {
  if (imp.resultado) {
    const r = imp.resultado;
    el.innerHTML = `<div class="card" style="text-align:center;padding:36px 20px">
      <div style="font-size:34px">✓</div>
      <h2 style="margin:6px 0">${r.manual ? 'Linhas prontas para colar' : 'Planilha atualizada'}</h2>
      <p class="text-2">${escapeHtml(r.texto)}</p>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:16px">
        <a class="btn btn-primario" href="#/painel">Ver no painel</a>
        <button class="btn" id="nova">Nova importação</button>
      </div></div>`;
    $('#nova', el).addEventListener('click', () => {
      Object.assign(imp, novoEstado());
      app.renderizar();
    });
    return;
  }

  const env = montarEnvio(app.estado.dados);
  const totD = env.despesas.reduce((s, d) => s + d.VALOR, 0);
  const totR = env.receitas.reduce((s, d) => s + d.VALOR, 0);
  const meses = [...new Set([...env.despesas, ...env.receitas].map((d) => d.MES_DE_REFERENCIA))].sort();
  el.innerHTML = `
    <div class="resumo">
      <div class="card"><div class="muted small">Despesas</div><div class="valor">${env.despesas.length}</div><div class="small text-2 num">${moeda(totD)}</div></div>
      <div class="card"><div class="muted small">Receitas</div><div class="valor">${env.receitas.length}</div><div class="small text-2 num">${moeda(totR)}</div></div>
      <div class="card"><div class="muted small">Contas do mês</div><div class="valor">${env.qtdFixas}</div><div class="small text-2">${env.alteracoes.length ? `+ ${env.alteracoes.length} linha(s) já existente(s) atualizada(s)` : 'novas no mês'}</div></div>
      <div class="card"><div class="muted small">Aprendizados</div><div class="valor">${env.regras.length}</div><div class="small text-2">regras novas ou atualizadas</div></div>
    </div>
    <div class="card">
      <div class="card-titulo"><h2>Prévia</h2><span class="sub">Meses de referência: ${meses.join(', ') || '—'}</span></div>
      <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Data</th><th>Descrição</th><th>Tipo</th><th>Forma</th><th>Status</th><th class="num">Valor</th></tr></thead><tbody>
        ${env.despesas.map((d) => `<tr><td class="tab">${escapeHtml(d.VENCIMENTO)}</td><td>${escapeHtml(d.NOME_DESPESA)}${d.CATEGORIA === 'FIXO' ? ' <span class="badge">fixo</span>' : ''}</td><td>${escapeHtml(d.TIPO)}</td><td class="text-2">${escapeHtml(d.FORMA_DE_PGTO)}</td><td>${escapeHtml(d.STATUS)}</td><td class="num">${moeda(d.VALOR)}</td></tr>`).join('')}
        ${env.receitas.map((r) => `<tr><td class="tab">${escapeHtml(r.DATA)}</td><td>${escapeHtml(r.TIPO)} <span class="badge badge-acc">receita</span></td><td>${escapeHtml(r.NOME)}</td><td class="text-2">${escapeHtml(r.FORMA_DE_PGTO)}</td><td>${escapeHtml(r.STATUS)}</td><td class="num">${moeda(r.VALOR)}</td></tr>`).join('')}
        ${env.despesas.length + env.receitas.length ? '' : '<tr><td colspan="6" class="vazio">Nada novo para lançar.</td></tr>'}
      </tbody></table></div>
    </div>
    <div class="rodape-acoes">
      <button class="btn" data-ir="2">← Voltar</button>
      ${
        backendConfigurado()
          ? `<button class="btn btn-primario" id="enviar" ${env.despesas.length + env.receitas.length + env.alteracoes.length + env.regras.length ? '' : 'disabled'}>Enviar para a planilha</button>`
          : `<span style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="copiar-d" ${env.despesas.length ? '' : 'disabled'}>Copiar despesas</button><button class="btn" id="copiar-r" ${env.receitas.length ? '' : 'disabled'}>Copiar receitas</button><button class="btn btn-primario" id="concluir-manual">Concluir</button></span>`
      }
    </div>`;

  for (const b of $$('[data-ir]', el)) b.addEventListener('click', () => irPara(+b.dataset.ir, app));
  $('#enviar', el)?.addEventListener('click', (e) => enviarPlanilha(e.target, env, app));
  $('#copiar-d', el)?.addEventListener('click', () => copiar(env.despesas, ['NOME_DESPESA', 'VENCIMENTO', 'VALOR', 'CATEGORIA', 'STATUS', 'FORMA_DE_PGTO', 'PARCELAS', 'TIPO', 'INSTITUICAO_FINANCEIRA', 'MES_DE_REFERENCIA'], 'despesas'));
  $('#copiar-r', el)?.addEventListener('click', () => copiar(env.receitas, ['NOME', 'TIPO', 'VALOR', 'DATA', 'INSTITUICAO_FINANCEIRA', 'CATEGORIA', 'STATUS', 'FORMA_DE_PGTO', 'PARCELAS', 'MES_DE_REFERENCIA'], 'receitas'));
  $('#concluir-manual', el)?.addEventListener('click', () => {
    salvarRegrasLocais(env.regras);
    imp.resultado = { manual: true, texto: `${env.regras.length} aprendizado(s) guardados neste navegador. Cole as linhas copiadas no fim de cada aba da planilha.` };
    app.renderizar();
  });
}

async function enviarPlanilha(botao, env, app) {
  botao.disabled = true;
  botao.textContent = 'Enviando…';
  try {
    const lote = Date.now().toString(36);
    const descricao = [imp.arquivos.filter((a) => !a.erro).map((a) => a.nome).join(', '), env.qtdFixas ? `fixas ${nomeMes(imp.mesFixas, false)}` : ''].filter(Boolean).join(' · ');
    const r = await enviar('lancar', { lote, descricao, despesas: env.despesas, receitas: env.receitas, regras: env.regras.map(regraParaLinha) });
    let extra = '';
    if (env.alteracoes.length) {
      const s = await enviar('status', { alteracoes: env.alteracoes });
      extra = ` ${s.alteradas} linha(s) já existente(s) atualizada(s) (status pago, nomes de parcelas).`;
      if (s.erros?.length) extra += ` Atenção: ${s.erros.join(' ')}`;
    }
    imp.resultado = {
      texto: `${r.despesas} despesa(s) e ${r.receitas} receita(s) lançadas, ${r.regras} aprendizado(s) salvos.${r.ignoradasDuplicadas ? ` ${r.ignoradasDuplicadas} já existiam e foram ignoradas.` : ''}${extra}`,
    };
    toast('Planilha atualizada');
    app.recarregar();
    app.renderizar();
  } catch (e) {
    toast(e.message, 'erro', 8000);
    botao.disabled = false;
    botao.textContent = 'Tentar de novo';
  }
}

async function copiar(linhas, colunas, nome) {
  const tsv = linhas
    .map((l) => colunas.map((c) => (c === 'VALOR' ? String(l[c]).replace('.', ',') : String(l[c] ?? '').replace(/\t|\n/g, ' '))).join('\t'))
    .join('\n');
  try {
    await navigator.clipboard.writeText(tsv);
    toast(`${linhas.length} ${nome} copiadas — cole na primeira linha vazia da aba`);
  } catch {
    toast('Não consegui copiar automaticamente', 'erro');
  }
}
