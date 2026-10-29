// Acesso aos dados: backend (Apps Script) quando configurado; senão, leitura da planilha pública.
// Mantém um cache local para o painel abrir instantaneamente.

import { csvParaObjetos } from './parsers.js';
import { normalizarDespesa, normalizarReceita, normalizarRegra } from './model.js';

const CHAVE_CONFIG = 'pf3_config';
const CHAVE_CACHE = 'pf3_cache';
const CHAVE_REGRAS_LOCAIS = 'pf3_regras_locais';
const PLANILHA_PADRAO = '1CJJ-dEYwWpY5tN3XPcEiquNPiguxTO-s2ikUgEOMvk4';

const CONFIG_PADRAO = {
  url: '',
  token: '',
  planilhaId: PLANILHA_PADRAO,
  instituicaoCartao: 'NUBANK',
  titulares: { NUBANK: 'LARISSA', BRADESCO: 'DOUGLAS', 'ITAÚ': 'LARISSA' },
  tema: 'auto',
};

function lerLocal(chave, padrao) {
  try {
    const v = localStorage.getItem(chave);
    return v ? JSON.parse(v) : padrao;
  } catch {
    return padrao;
  }
}

function gravarLocal(chave, valor) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* armazenamento indisponível (modo privado) — segue sem cache */
  }
}

export const config = { ...CONFIG_PADRAO, ...lerLocal(CHAVE_CONFIG, {}) };

export function salvarConfig(parcial) {
  Object.assign(config, parcial);
  gravarLocal(CHAVE_CONFIG, config);
}

export function backendConfigurado() {
  return Boolean(config.url && config.token);
}

// ───────────── Leitura ─────────────

function montar(bruto) {
  return {
    despesas: (bruto.despesas || []).map(normalizarDespesa).filter((d) => d.nome || d.valor),
    receitas: (bruto.receitas || []).map(normalizarReceita).filter((r) => r.nome || r.valor),
    regras: (bruto.regras || []).map(normalizarRegra).filter((r) => r.chave),
    importacoes: bruto.importacoes || [],
    lidoEm: bruto.lidoEm || new Date().toISOString(),
    fonte: bruto.fonte,
  };
}

export function dadosEmCache() {
  const c = lerLocal(CHAVE_CACHE, null);
  return c ? montar(c) : null;
}

export async function carregarDados() {
  let bruto;
  if (backendConfigurado()) {
    const r = await fetch(`${config.url}?acao=dados&token=${encodeURIComponent(config.token)}`);
    bruto = await r.json();
    if (!bruto.ok) throw new Error(bruto.erro || 'Falha no backend');
    bruto.fonte = 'backend';
  } else {
    const id = config.planilhaId || PLANILHA_PADRAO;
    const aba = async (nome) => {
      const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(nome)}`);
      if (!r.ok) throw new Error(`Não consegui ler a aba ${nome} (HTTP ${r.status})`);
      const texto = await r.text();
      if (texto.trim().startsWith('<')) throw new Error('A planilha não está pública. Configure o backend em Configurações.');
      return csvParaObjetos(texto);
    };
    const [despesas, receitas] = await Promise.all([aba('Despesas'), aba('Receitas')]);
    let regras = [];
    try {
      regras = await aba('Regras');
      if (!regras.length || !('CHAVE' in regras[0])) regras = [];
    } catch {
      regras = [];
    }
    bruto = { despesas, receitas, regras, fonte: 'publica', lidoEm: new Date().toISOString() };
  }
  gravarLocal(CHAVE_CACHE, bruto);
  const dados = montar(bruto);
  // Sem backend, o aprendizado fica guardado neste navegador
  if (!backendConfigurado()) dados.regras = mesclarRegras(dados.regras, regrasLocais());
  return dados;
}

// ───────────── Escrita ─────────────

export async function enviar(acao, corpo = {}) {
  if (!backendConfigurado()) throw new Error('Backend não configurado. Vá em Configurações.');
  const r = await fetch(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight CORS no Apps Script
    body: JSON.stringify({ ...corpo, acao, token: config.token }),
  });
  const json = await r.json();
  if (!json.ok) throw new Error(json.erro || 'Falha no backend');
  return json;
}

export async function testarConexao(url, token) {
  const r = await fetch(`${url}?acao=ping&token=${encodeURIComponent(token)}`);
  const json = await r.json();
  if (!json.ok) throw new Error(json.erro);
  return json.planilha;
}

// ───────────── Regras locais (modo sem backend) ─────────────

export function regrasLocais() {
  return lerLocal(CHAVE_REGRAS_LOCAIS, []);
}

export function salvarRegrasLocais(novas, excluir = []) {
  const atuais = mesclarRegras(regrasLocais(), novas).filter((r) => !excluir.includes(r.chave));
  gravarLocal(CHAVE_REGRAS_LOCAIS, atuais);
}

function mesclarRegras(base, novas) {
  const mapa = new Map(base.map((r) => [r.chave, r]));
  for (const r of novas) mapa.set(r.chave, { ...mapa.get(r.chave), ...r });
  return [...mapa.values()];
}

// Link que leva a configuração para outro aparelho (ex.: celular)
// Link curto e só com caracteres seguros (letras, números, - e _), que apps de mensagem não quebram:
// ?c=<id da implantação do backend>.<token>
// Fica no endereço (não é apagado): o atalho da tela inicial do iPhone tem memória separada do Safari
// e precisa do endereço completo para abrir já conectado.
const RX_URL_BACKEND = /^https:\/\/script\.google\.com\/macros\/s\/([\w-]+)\/exec$/;

export function linkDeConfiguracao() {
  const id = (config.url.match(RX_URL_BACKEND) || [])[1];
  if (!id || !/^[\w-]+$/.test(config.token)) throw new Error('Conexão não configurada neste navegador.');
  return `${location.origin}${location.pathname}?c=${id}.${config.token}#/painel`;
}

const aplicarChave = (id, token) => {
  const url = `https://script.google.com/macros/s/${id}/exec`;
  const mudou = config.url !== url || config.token !== token;
  if (mudou) salvarConfig({ url, token });
  return mudou;
};

// Retorna 'ok' (configurou agora), 'erro' (link veio quebrado) ou null (nada a fazer)
export function importarConfiguracaoDoLink() {
  const hash = location.hash;
  const limpar = () => history.replaceState(null, '', location.pathname + '#/painel');
  const param = new URLSearchParams(location.search).get('c');
  if (param !== null) {
    const m = param.match(/^([\w-]+)\.([\w-]+)$/);
    if (!m) return 'erro';
    return aplicarChave(m[1], m[2]) ? 'ok' : null; // abre conectado a cada uso (sem aviso se já estava)
  }
  const curto = hash.match(/^#c=([\w-]+)\.([\w-]+)$/);
  if (curto) {
    // link da versão anterior: passa a chave para o endereço, para o atalho da tela inicial guardá-la
    aplicarChave(curto[1], curto[2]);
    history.replaceState(null, '', `${location.pathname}?c=${curto[1]}.${curto[2]}#/painel`);
    return 'ok';
  }
  const antigo = hash.match(/#config=([^&]+)/); // formato anterior (base64)
  if (antigo) {
    try {
      salvarConfig(JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(antigo[1]))))));
      limpar();
      return 'ok';
    } catch {
      limpar();
      return 'erro';
    }
  }
  if (/^#c=/.test(hash)) {
    limpar();
    return 'erro';
  }
  return null;
}
