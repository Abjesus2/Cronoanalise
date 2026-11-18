// Armazenamento em PASTA COMPARTILHADA, com arquivos Excel — sem precisar de TI.
// Funciona com qualquer pasta que o computador enxergue:
//   • pasta do SharePoint sincronizada pelo OneDrive (botão "Sincronizar" da biblioteca)
//   • pasta do OneDrive
//   • pasta da rede local (\\servidor\... ou unidade mapeada)
//
// Cada pessoa/computador grava APENAS o próprio arquivo "Cronoanalise - Nome (abcd).xlsx".
// O site lê os arquivos de todos e junta (vale a versão mais recente de cada registro).
// Assim ninguém sobrescreve o arquivo de outra pessoa e o OneDrive não gera conflitos.
//
// Requer Chrome ou Edge no computador (File System Access API).
import * as db from './db-local.js';
import { obterXLSX } from '../lib.js';
import { semAcento } from './util.js';

export const PREFIXO = 'Cronoanalise - ';
export const NOME_CONSOLIDADO = 'Cronoanalise - Consolidado.xlsx';
const LIMITE_CELULA = 30000; // Excel aceita até 32.767 caracteres por célula

export const ABAS = {
  areas: 'Áreas',
  setores: 'Setores',
  atividades: 'Atividades',
  medicoes: 'Medições',
  paradas: 'Paradas e motivos',
  fluxos: 'Fluxogramas',
  config: 'Configuração',
};

export const suportado = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export class ErroPasta extends Error {
  constructor(mensagem, codigo) {
    super(mensagem);
    this.codigo = codigo;
  }
}

/* ------------------------------ JSON em células ------------------------------ */
function partirJSON(obj) {
  const texto = JSON.stringify(obj);
  const partes = {};
  for (let i = 0, n = 1; i < texto.length || n === 1; i += LIMITE_CELULA, n++) {
    partes[n === 1 ? '_dados' : `_dados_${n}`] = texto.slice(i, i + LIMITE_CELULA);
    if (i + LIMITE_CELULA >= texto.length) break;
  }
  return partes;
}

function juntarJSON(linha) {
  const chaves = Object.keys(linha)
    .filter(k => k === '_dados' || /^_dados_\d+$/.test(k))
    .sort((a, b) => (a === '_dados' ? 1 : Number(a.split('_')[2])) - (b === '_dados' ? 1 : Number(b.split('_')[2])));
  const texto = chaves.map(k => String(linha[k] ?? '')).join('');
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

/* ------------------------------ montagem da planilha ------------------------------ */
/**
 * Monta a planilha de um dispositivo.
 * diario = { col: { id: entidade } }, exclusoes = { 'col:id': isoData }, nomes = funções de consulta
 */
export function montarPlanilha(XLSX, { diario, exclusoes, info, nomes }) {
  const wb = XLSX.utils.book_new();
  const legiveis = {
    areas: e => ({ 'Nome': e.nome, 'Sequência': e.seq ?? '', 'Descrição': e.descricao || '' }),
    setores: e => ({ 'Área': nomes.area(e.areaId), 'Nome': e.nome, 'Sequência': e.seq ?? '' }),
    atividades: e => ({ 'Área': nomes.areaDoSetor(e.setorId), 'Setor': nomes.setor(e.setorId), 'Código': nomes.codigo(e), 'Nome': e.nome, 'Unidade': e.unidade || '', 'Pessoas alocadas': e.pessoas ?? 1 }),
    medicoes: e => {
      const at = nomes.atividade(e.atividadeId);
      const params = (at?.parametros || []).map(p => (e.valores?.[p.id] !== undefined && e.valores?.[p.id] !== '' ? `${p.nome}: ${e.valores[p.id]}` : null)).filter(Boolean).join(' · ');
      return {
        'Data e hora': e.dataHora ? new Date(e.dataHora) : '',
        'Área': at ? nomes.areaDoSetor(at.setorId) : '',
        'Setor': at ? nomes.setor(at.setorId) : '',
        'Atividade': at?.nome || '',
        'Tempo (s)': Number.isFinite(e.tempo) ? Math.round(e.tempo * 1000) / 1000 : '',
        'Parâmetros': params,
        'Operador': e.operador || '',
        'Cronometrista': e.cronometrista || '',
        'Anomalia': e.motivoId ? nomes.parada(e.motivoId) : '',
        'Observação': e.observacao || '',
      };
    },
    paradas: e => ({ 'Nome': e.nome, 'Tipo': e.tipo === 'programada' ? 'Parada programada' : 'Motivo de anomalia', 'Duração (s)': e.duracao ?? '', 'Frequência': e.tipo === 'programada' ? (e.freq === 'ciclo' ? 'Por ciclo' : 'Por jornada') : '' }),
    fluxos: e => ({ 'Nome': e.nome }),
    config: () => ({ 'Registro': 'Parâmetros gerais' }),
  };
  for (const [col, aba] of Object.entries(ABAS)) {
    const itens = Object.values(diario[col] || {});
    const linhas = itens.map(e => ({
      ...legiveis[col](e),
      'Modificado em': e.modificadoEm ? new Date(e.modificadoEm) : '',
      'Modificado por': e.modificadoPor || '',
      ...partirJSON(e),
    }));
    const ws = XLSX.utils.json_to_sheet(linhas.length ? linhas : [{ '_dados': '' }], { cellDates: true });
    if (!linhas.length) ws['!ref'] = 'A1:A1';
    ws['!cols'] = Object.keys(linhas[0] || { _dados: '' }).map(k => ({ wch: k.startsWith('_dados') ? 12 : Math.min(40, Math.max(10, k.length + 4)) }));
    XLSX.utils.book_append_sheet(wb, ws, aba);
  }
  const excl = Object.entries(exclusoes || {}).map(([chave, ts]) => {
    const [col, ...resto] = chave.split(':');
    return { 'Tipo': col, 'Id': resto.join(':'), 'Excluído em': ts };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(excl.length ? excl : [{ 'Tipo': '', 'Id': '', 'Excluído em': '' }]), 'Exclusões');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Arquivo de dados da Cronoanálise — não edite à mão. Abra o site para alterar.'],
      ['Dispositivo', info.dispositivo],
      ['Pessoa', info.pessoa],
      ['Atualizado em', info.atualizadoEm],
      ['Formato', 'cronoanalise-pasta-v1'],
    ]),
    'Leia-me',
  );
  // a aba "Leia-me" primeiro
  wb.SheetNames.unshift(wb.SheetNames.pop());
  return wb;
}

/** Lê a planilha de um dispositivo. */
export function lerPlanilha(XLSX, buffer) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const registros = {};
  for (const [col, aba] of Object.entries(ABAS)) {
    const ws = wb.Sheets[aba];
    if (!ws) continue;
    registros[col] = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true }).map(juntarJSON).filter(e => e && e.id);
  }
  const exclusoes = [];
  const wsExcl = wb.Sheets['Exclusões'];
  if (wsExcl) {
    for (const l of XLSX.utils.sheet_to_json(wsExcl, { defval: '', raw: true })) {
      if (l['Tipo'] && l['Id']) exclusoes.push({ col: String(l['Tipo']), id: String(l['Id']), ts: String(l['Excluído em'] || '') });
    }
  }
  return { registros, exclusoes };
}

/* ------------------------------ acesso à pasta ------------------------------ */
export class Pasta {
  constructor() {
    this.handle = null;
    this.cache = new Map(); // nome do arquivo -> { assinatura, conteudo }
  }

  get nome() {
    return this.handle?.name || '';
  }

  async carregar() {
    this.handle = (await db.metaLer('pastaHandle', null)) || null;
    return this.handle;
  }

  async escolher() {
    if (!suportado()) throw new ErroPasta('Este navegador não permite escolher pastas. Use o Chrome ou o Edge no computador.', 'suporte');
    const h = await window.showDirectoryPicker({ id: 'cronoanalise-dados', mode: 'readwrite' });
    this.handle = h;
    this.cache.clear();
    await db.metaGravar('pastaHandle', h);
    return h;
  }

  /** Usado nos testes e em casos especiais: define a pasta diretamente. */
  async definir(handle) {
    this.handle = handle;
    this.cache.clear();
    await db.metaGravar('pastaHandle', handle);
  }

  async esquecer() {
    this.handle = null;
    this.cache.clear();
    await db.metaGravar('pastaHandle', null);
  }

  async permissao(pedir = false) {
    if (!this.handle) return 'sem-pasta';
    if (!this.handle.queryPermission) return 'granted';
    const opcoes = { mode: 'readwrite' };
    let p = await this.handle.queryPermission(opcoes);
    if (p !== 'granted' && pedir) p = await this.handle.requestPermission(opcoes);
    return p;
  }

  async listarArquivosDados() {
    const lista = [];
    for await (const [nome, h] of this.handle.entries()) {
      if (h.kind !== 'file') continue;
      if (!nome.startsWith(PREFIXO) || !nome.toLowerCase().endsWith('.xlsx')) continue;
      if (nome === NOME_CONSOLIDADO || /consolidado/i.test(nome)) continue;
      lista.push({ nome, handle: h });
    }
    return lista;
  }

  /** Lê todos os arquivos de dados (usa cache para os que não mudaram). */
  async lerTodos() {
    const XLSX = await obterXLSX();
    const arquivos = await this.listarArquivosDados();
    const resultado = [];
    const erros = [];
    for (const a of arquivos) {
      try {
        const f = await a.handle.getFile();
        const assinatura = `${f.lastModified}:${f.size}`;
        const em = this.cache.get(a.nome);
        if (em && em.assinatura === assinatura) {
          resultado.push({ nome: a.nome, ...em.conteudo, modificado: f.lastModified });
          continue;
        }
        const conteudo = lerPlanilha(XLSX, await f.arrayBuffer());
        this.cache.set(a.nome, { assinatura, conteudo });
        resultado.push({ nome: a.nome, ...conteudo, modificado: f.lastModified });
      } catch (e) {
        erros.push(`${a.nome}: ${e.message}`);
      }
    }
    return { arquivos: resultado, erros };
  }

  async gravarArquivo(nome, dados) {
    let fh;
    try {
      fh = await this.handle.getFileHandle(nome, { create: true });
      const w = await fh.createWritable();
      await w.write(dados);
      await w.close();
    } catch (e) {
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') throw new ErroPasta('Sem permissão para gravar na pasta. Clique em "Reconectar pasta".', 'permissao');
      if (e.name === 'NoModificationAllowedError' || e.name === 'InvalidStateError' || /lock|in use|uso/i.test(e.message)) {
        throw new ErroPasta(`O arquivo "${nome}" está aberto em outro programa (provavelmente no Excel). Feche-o para o site conseguir salvar.`, 'bloqueado');
      }
      throw e;
    }
  }

  async gravarPlanilha(nome, wb) {
    const XLSX = await obterXLSX();
    const dados = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true });
    await this.gravarArquivo(nome, new Blob([dados], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    this.cache.delete(nome);
  }
}

export function nomeArquivoDispositivo(pessoa, dispositivoId) {
  const limpo = String(pessoa || 'Usuario')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40) || 'Usuario';
  return `${PREFIXO}${limpo} (${String(dispositivoId).slice(0, 4)}).xlsx`;
}

export const semAcentoNome = n => semAcento(n);
export const pasta = new Pasta();
