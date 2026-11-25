// Estado central da aplicação: dados em memória + cache IndexedDB + sincronização
// (pasta compartilhada com arquivos Excel, ou SharePoint via Microsoft Graph).
import * as db from './db-local.js';
import { sharepoint, SharePoint } from './sharepoint.js';
import { pasta, nomeArquivoDispositivo, montarPlanilha, NOME_CONSOLIDADO } from './pasta.js';
import { obterXLSX } from '../lib.js';
import { CONFIG_PADRAO } from './calc.js';
import { uid, agoraISO, ordenarPor, debounce } from './util.js';
import { prefs } from './prefs.js';

const COLS = db.COLECOES;
export const PAI = { setores: 'areaId', atividades: 'setorId', medicoes: 'atividadeId' };
const ROTULO_COL = {
  areas: ['operação', 'operações'],
  setores: ['setor', 'setores'],
  atividades: ['atividade', 'atividades'],
  medicoes: ['medição', 'medições'],
  paradas: ['parada/motivo', 'paradas/motivos'],
  fluxos: ['fluxograma', 'fluxogramas'],
  config: ['configuração', 'configurações'],
};
const CHAVE_SP = 'crono.v2.sharepoint';

class Store {
  constructor() {
    this.dados = Object.fromEntries(COLS.map(c => [c, new Map()]));
    this.versao = 0;
    this.versaoCol = Object.fromEntries(COLS.map(c => [c, 0]));
    this.cache = new Map();
    this.ouvintes = new Set();
    this.sync = {
      modo: 'local',
      online: navigator.onLine,
      pendentes: 0,
      sincronizando: false,
      ultima: null,
      erro: null,
      usuario: null,
      precisaEntrar: false,
      listasFaltando: [],
      naoEnviados: 0,
      pasta: { nome: '', permissao: null, arquivos: [], avisos: [], consolidadoEm: null },
    };
    // modo pasta: o que ESTE computador gravou (vai para o arquivo dele) + exclusões
    this.diario = Object.fromEntries(COLS.map(c => [c, {}]));
    this.exclusoesDiario = {};
    this.versaoDiario = 0;
    this.diarioSujo = false;
    this.dispositivoId = null;
    this.arquivoProprio = '';
    this.consolidadoAuto = true;
    this.salvarDiario = debounce(() => {
      db.metaGravar('diario', this.diario);
      db.metaGravar('exclusoesDiario', this.exclusoesDiario);
      db.metaGravar('diarioSujo', this.diarioSujo);
    }, 1000);
    this.spIds = {};
    this.spMod = {};
    this.pendentes = new Set();
    this.historico = [];
    this.cadeia = Promise.resolve();
    this.carregado = false;
    this.agendarSync = debounce(() => this.sincronizar(), 3000);
    this.salvarHistorico = debounce(() => db.metaGravar('historico', this.historico), 800);
  }

  /* ------------------------------ ciclo de vida ------------------------------ */

  async iniciar() {
    this.persistente = await db.persistente();
    for (const c of COLS) {
      const itens = await db.lerTudoAsync(c);
      for (const i of itens) this.dados[c].set(i.id, i);
    }
    this.spIds = (await db.metaLer('spIds', {})) || {};
    this.spMod = (await db.metaLer('spMod', {})) || {};
    this.historico = (await db.metaLer('historico', [])) || [];
    this.sync.ultima = await db.metaLer('ultimaSync', null);
    await this.recontarFila();
    this.carregado = true;
    this.emitir();

    window.addEventListener('online', () => {
      this.sync.online = true;
      this.emitir();
      this.sincronizar();
    });
    window.addEventListener('offline', () => {
      this.sync.online = false;
      this.emitir();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.sincronizar();
    });
    setInterval(() => {
      if (document.visibilityState === 'visible') this.sincronizar();
    }, 45000);

    // modo pasta compartilhada
    this.dispositivoId = await db.metaLer('dispositivoId', null);
    this.arquivoProprio = (await db.metaLer('arquivoProprio', '')) || '';
    this.consolidadoAuto = (await db.metaLer('consolidadoAuto', true)) !== false;
    const diario = await db.metaLer('diario', null);
    if (diario) for (const c of COLS) this.diario[c] = diario[c] || {};
    this.exclusoesDiario = (await db.metaLer('exclusoesDiario', {})) || {};
    this.diarioSujo = Boolean(await db.metaLer('diarioSujo', false));
    const modo = await db.metaLer('modoArmazenamento', 'local');

    const cfg = this.configSharePoint();
    // não bloqueia a primeira tela: os dados locais aparecem na hora e a sincronização vem em seguida
    if (modo === 'pasta') this.iniciarPasta();
    else if (cfg.clientId && cfg.siteUrl) this.ativarSharePoint(cfg);
  }

  assinar(fn) {
    this.ouvintes.add(fn);
    return () => this.ouvintes.delete(fn);
  }

  emitir() {
    if (this._emitindo) return;
    this._emitindo = true;
    queueMicrotask(() => {
      this._emitindo = false;
      this.ouvintes.forEach(fn => fn());
    });
  }

  tocar(col) {
    this.versao++;
    if (col) this.versaoCol[col]++;
    this.cache.clear();
  }

  /** Memoriza um cálculo até a próxima alteração de dados. */
  memo(chave, fn) {
    if (this.cache.has(chave)) return this.cache.get(chave);
    const v = fn();
    this.cache.set(chave, v);
    return v;
  }

  /* ------------------------------ leitura ------------------------------ */

  obter(col, id) {
    return id ? this.dados[col].get(id) || null : null;
  }

  lista(col) {
    return this.memo('lista:' + col, () => [...this.dados[col].values()]);
  }

  config() {
    return this.memo('config', () => ({ ...CONFIG_PADRAO, ...(this.dados.config.get('global') || {}) }));
  }

  areas() {
    return this.memo('areas', () => ordenarPor(this.lista('areas'), a => a.seq ?? 9999, a => a.nome));
  }

  setores(areaId) {
    const todos = this.memo('setores', () => ordenarPor(this.lista('setores'), s => s.seq ?? 9999, s => s.nome));
    return areaId ? this.memo('setores:' + areaId, () => todos.filter(s => s.areaId === areaId)) : todos;
  }

  atividades(setorId) {
    const todas = this.memo('atividades', () => ordenarPor(this.lista('atividades'), a => a.seq ?? 9999, a => a.nome));
    return setorId ? this.memo('atividades:' + setorId, () => todas.filter(a => a.setorId === setorId)) : todas;
  }

  atividadesDaArea(areaId) {
    return this.memo('atividadesArea:' + areaId, () => {
      const setores = new Set(this.setores(areaId).map(s => s.id));
      return this.atividades().filter(a => setores.has(a.setorId));
    });
  }

  medicoes(atividadeId) {
    const indice = this.memo('idxMedicoes', () => {
      const m = new Map();
      for (const med of this.lista('medicoes')) {
        if (!m.has(med.atividadeId)) m.set(med.atividadeId, []);
        m.get(med.atividadeId).push(med);
      }
      for (const arr of m.values()) arr.sort((a, b) => (a.dataHora || '').localeCompare(b.dataHora || ''));
      return m;
    });
    return atividadeId ? indice.get(atividadeId) || [] : this.lista('medicoes');
  }

  paradas(tipo) {
    const todas = this.memo('paradas', () => ordenarPor(this.lista('paradas'), p => p.nome));
    return tipo ? todas.filter(p => p.tipo === tipo) : todas;
  }

  mapaParadas() {
    return this.memo('mapaParadas', () => new Map(this.lista('paradas').map(p => [p.id, p])));
  }

  caminho(atividadeOuSetor) {
    let setor = null;
    let atividade = null;
    if (atividadeOuSetor?.setorId) {
      atividade = atividadeOuSetor;
      setor = this.obter('setores', atividade.setorId);
    } else if (atividadeOuSetor?.areaId) setor = atividadeOuSetor;
    const area = setor ? this.obter('areas', setor.areaId) : null;
    return { area, setor, atividade };
  }

  /** Código de classificação no formato operação.setor.atividade (ex.: 1.4.2). */
  codigo(atividade) {
    if (!atividade) return '';
    const c = this.caminho(atividade);
    return [c.area?.seq, c.setor?.seq, atividade.seq].map(v => (v == null ? '' : v)).join('.');
  }

  operadoresConhecidos() {
    return this.memo('operadores', () => {
      const s = new Set();
      for (const m of this.lista('medicoes')) if (m.operador) s.add(m.operador.trim());
      return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    });
  }

  cronometristasConhecidos() {
    return this.memo('cronometristas', () => {
      const s = new Set();
      for (const m of this.lista('medicoes')) if (m.cronometrista) s.add(m.cronometrista.trim());
      return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    });
  }

  proximaSequencia(col, paiId) {
    const irmaos = col === 'areas' ? this.areas() : col === 'setores' ? this.setores(paiId) : this.atividades(paiId);
    return irmaos.reduce((m, x) => Math.max(m, Number(x.seq) || 0), 0) + 1;
  }

  /* ------------------------------ escrita ------------------------------ */

  autor() {
    return this.sync.usuario?.nome || prefs().cronometrista || '';
  }

  salvar(col, obj, opcoes = {}) {
    return this.salvarVarios(col, [obj], opcoes)[0];
  }

  salvarVarios(col, objs, { registrarHistorico = true, rotulo } = {}) {
    if (!objs.length) return [];
    const agora = agoraISO();
    const autor = this.autor();
    let criados = 0;
    const salvos = objs.map(obj => {
      const id = obj.id || uid();
      const existente = this.dados[col].get(id);
      if (!existente) criados++;
      const ent = {
        ...(existente || {}),
        ...obj,
        id,
        criadoEm: existente?.criadoEm || obj.criadoEm || agora,
        criadoPor: existente?.criadoPor || obj.criadoPor || autor,
        modificadoEm: agora,
        modificadoPor: autor,
      };
      this.dados[col].set(id, ent);
      return ent;
    });
    this.tocar(col);
    this.persistir(col, salvos, []);
    if (registrarHistorico) {
      const acao = criados === salvos.length ? 'criou' : criados === 0 ? 'editou' : 'salvou';
      this.registrarHistorico(acao, col, salvos, rotulo);
    }
    this.emitir();
    return salvos;
  }

  excluir(col, ids, { registrarHistorico = true } = {}) {
    const existentes = ids.map(id => this.dados[col].get(id)).filter(Boolean);
    if (!existentes.length) return 0;
    for (const e of existentes) this.dados[col].delete(e.id);
    this.tocar(col);
    this.persistir(col, [], existentes.map(e => e.id));
    if (registrarHistorico) this.registrarHistorico('excluiu', col, existentes);
    this.emitir();
    return existentes.length;
  }

  /** Exclui com todos os descendentes (operação → setores → atividades → medições). */
  excluirCascata(col, ids) {
    const alvo = { areas: new Set(), setores: new Set(), atividades: new Set(), medicoes: new Set() };
    ids.forEach(id => alvo[col].add(id));
    if (col === 'areas') for (const s of this.lista('setores')) if (alvo.areas.has(s.areaId)) alvo.setores.add(s.id);
    if (col === 'areas' || col === 'setores')
      for (const a of this.lista('atividades')) if (alvo.setores.has(a.setorId)) alvo.atividades.add(a.id);
    if (col !== 'medicoes')
      for (const m of this.lista('medicoes')) if (alvo.atividades.has(m.atividadeId)) alvo.medicoes.add(m.id);
    const contagem = {};
    for (const c of ['medicoes', 'atividades', 'setores', 'areas']) {
      if (alvo[c].size) contagem[c] = this.excluir(c, [...alvo[c]], { registrarHistorico: c === col });
    }
    return contagem;
  }

  contarDescendentes(col, ids) {
    const set = new Set(ids);
    const r = { setores: 0, atividades: 0, medicoes: 0 };
    let setores = col === 'areas' ? this.lista('setores').filter(s => set.has(s.areaId)) : [];
    if (col === 'setores') setores = this.lista('setores').filter(s => set.has(s.id));
    r.setores = col === 'areas' ? setores.length : 0;
    const idsSet = new Set(setores.map(s => s.id));
    let atividades = col === 'atividades' ? this.lista('atividades').filter(a => set.has(a.id)) : this.lista('atividades').filter(a => idsSet.has(a.setorId));
    r.atividades = col === 'atividades' ? 0 : atividades.length;
    const idsAt = new Set(atividades.map(a => a.id));
    r.medicoes = this.lista('medicoes').filter(m => idsAt.has(m.atividadeId)).length;
    return r;
  }

  persistir(col, salvos, excluidos) {
    if (this.sync.modo === 'pasta') {
      const agora = agoraISO();
      for (const e of salvos) {
        this.diario[col][e.id] = e;
        delete this.exclusoesDiario[`${col}:${e.id}`];
      }
      for (const id of excluidos) {
        delete this.diario[col][id];
        this.exclusoesDiario[`${col}:${id}`] = agora;
      }
      this.versaoDiario++;
      this.diarioSujo = true;
      this.salvarDiario();
      this.agendarSync();
    }
    const modoSP = this.sync.modo === 'sharepoint';
    const entradas = [
      ...salvos.map(e => ({ col, id: e.id, op: 'salvar', ts: Date.now() })),
      ...excluidos.map(id => ({ col, id, op: 'excluir', ts: Date.now() })),
    ];
    if (modoSP) for (const e of entradas) this.pendentes.add(`${e.col}:${e.id}`);
    this.cadeia = this.cadeia
      .then(async () => {
        if (salvos.length) await db.gravar(col, salvos);
        if (excluidos.length) await db.apagar(col, excluidos);
        if (modoSP) {
          await db.filaAdicionar(entradas);
          this.sync.pendentes = this.pendentes.size;
          this.emitir();
          this.agendarSync();
        }
      })
      .catch(e => console.error('Falha ao gravar localmente', e));
  }

  registrarHistorico(acao, col, itens, rotulo) {
    const [sing, plur] = ROTULO_COL[col] || [col, col];
    const nomes = itens.slice(0, 3).map(i => i.nome || (col === 'medicoes' ? `${(i.tempo ?? 0).toFixed(1)} s` : '')).filter(Boolean);
    this.historico.unshift({
      ts: agoraISO(),
      acao,
      col,
      qtd: itens.length,
      texto: rotulo || `${itens.length === 1 ? sing : `${itens.length} ${plur}`}${nomes.length ? ': ' + nomes.join(', ') : ''}${itens.length > 3 ? '…' : ''}`,
      autor: this.autor(),
    });
    this.historico = this.historico.slice(0, 300);
    this.salvarHistorico();
  }

  limparHistorico() {
    this.historico = [];
    db.metaGravar('historico', []);
    this.emitir();
  }

  salvarConfig(parcial) {
    const atual = this.dados.config.get('global') || { id: 'global', nome: 'Configuração geral' };
    return this.salvar('config', { ...atual, ...parcial, id: 'global', nome: 'Configuração geral' }, { rotulo: 'parâmetros gerais' });
  }

  /* ------------------------------ SharePoint ------------------------------ */

  configSharePoint() {
    const base = window.CRONO_CONFIG?.sharepoint || {};
    let local = {};
    try {
      local = JSON.parse(localStorage.getItem(CHAVE_SP) || '{}');
    } catch {
      /* ignora */
    }
    return { clientId: '', tenantId: '', siteUrl: '', ...base, ...local };
  }

  salvarConfigSharePoint(cfg) {
    try {
      localStorage.setItem(CHAVE_SP, JSON.stringify(cfg));
    } catch {
      /* ignora */
    }
  }

  async ativarSharePoint(cfg) {
    this.sync.erro = null;
    try {
      this.sync.modo = 'sharepoint';
      this.emitir();
      const conta = await sharepoint.iniciar(cfg);
      this.sync.usuario = sharepoint.usuario();
      this.sync.precisaEntrar = !conta;
      this.contarNaoEnviados();
      this.emitir();
      if (conta) await this.sincronizar();
    } catch (e) {
      console.error(e);
      this.sync.erro = 'Não foi possível iniciar o SharePoint: ' + e.message;
      this.emitir();
    }
  }

  async desativarSharePoint() {
    this.sync.modo = 'local';
    this.sync.usuario = null;
    this.sync.erro = null;
    this.sync.precisaEntrar = false;
    try {
      localStorage.removeItem(CHAVE_SP);
    } catch {
      /* ignora */
    }
    await db.filaLimpar();
    this.pendentes.clear();
    await this.recontarFila();
    this.emitir();
  }

  async entrar() {
    await sharepoint.entrar();
    this.sync.usuario = sharepoint.usuario();
    this.sync.precisaEntrar = false;
    this.emitir();
    await this.sincronizar();
  }

  async sair() {
    await sharepoint.sair();
    this.sync.usuario = null;
    this.sync.precisaEntrar = true;
    this.emitir();
  }

  async criarListas() {
    await sharepoint.resolverSite();
    await sharepoint.verificarListas(true);
    this.sync.listasFaltando = [];
    this.emitir();
    await this.sincronizar();
  }

  contarNaoEnviados() {
    let n = 0;
    for (const c of COLS) {
      const mapa = this.spIds[c] || {};
      for (const id of this.dados[c].keys()) if (!mapa[id] && !this.pendentes.has(`${c}:${id}`)) n++;
    }
    this.sync.naoEnviados = n;
    return n;
  }

  /** Coloca na fila todos os registros locais que ainda não existem no SharePoint. */
  async enviarDadosLocais() {
    const entradas = [];
    for (const c of COLS) {
      const mapa = this.spIds[c] || {};
      for (const id of this.dados[c].keys()) {
        if (!mapa[id]) {
          entradas.push({ col: c, id, op: 'salvar', ts: Date.now() });
          this.pendentes.add(`${c}:${id}`);
        }
      }
    }
    await db.filaAdicionar(entradas);
    await this.recontarFila();
    this.sync.naoEnviados = 0;
    this.emitir();
    await this.sincronizar();
  }

  /** Descarta os dados locais e baixa tudo novamente do SharePoint. */
  async recarregarDoSharePoint() {
    for (const c of COLS) {
      this.dados[c].clear();
      await db.limparColecao(c);
    }
    await db.filaLimpar();
    this.pendentes.clear();
    this.spIds = {};
    this.spMod = {};
    await db.metaGravar('spIds', {});
    await db.metaGravar('spMod', {});
    this.tocar();
    await this.recontarFila();
    this.sync.naoEnviados = 0;
    this.emitir();
    await this.sincronizar();
  }

  async recontarFila() {
    const fila = await db.filaLer();
    this.pendentes = new Set(fila.map(e => `${e.col}:${e.id}`));
    this.sync.pendentes = this.pendentes.size;
  }

  sincronizar() {
    if (this.sync.modo === 'pasta') return this.sincronizarPasta();
    if (this.sync.modo !== 'sharepoint') return Promise.resolve();
    if (this._sincronizando) return this._sincronizando;
    if (!navigator.onLine) {
      this.sync.online = false;
      this.emitir();
      return Promise.resolve();
    }
    if (!sharepoint.conta) {
      this.sync.precisaEntrar = true;
      this.emitir();
      return Promise.resolve();
    }
    this._sincronizando = (async () => {
      this.sync.sincronizando = true;
      this.emitir();
      try {
        await sharepoint.resolverSite();
        const { faltando } = await sharepoint.verificarListas(false);
        this.sync.listasFaltando = faltando;
        if (faltando.length) {
          throw new Error('As listas ainda não existem no site do SharePoint. Use "Criar listas" em Configurações › Banco de dados.');
        }
        await this.enviarFila();
        await this.puxar();
        this.sync.ultima = agoraISO();
        this.sync.erro = null;
        this.sync.precisaEntrar = false;
        await db.metaGravar('ultimaSync', this.sync.ultima);
      } catch (e) {
        console.error('Sincronização', e);
        this.sync.erro = e.message || String(e);
        if (e.codigo === 'login' || e.status === 401) this.sync.precisaEntrar = true;
      } finally {
        this.sync.sincronizando = false;
        this._sincronizando = null;
        await this.recontarFila();
        this.contarNaoEnviados();
        this.emitir();
      }
    })();
    return this._sincronizando;
  }

  async enviarFila() {
    const fila = await db.filaLer();
    if (!fila.length) return;
    const ultimo = new Map();
    for (const e of fila) ultimo.set(`${e.col}:${e.id}`, e);
    const reqs = [];
    const ops = [];
    const concluidos = [];
    for (const op of ultimo.values()) {
      const mapa = (this.spIds[op.col] ||= {});
      const itemId = mapa[op.id];
      const base = sharepoint.caminhoItens(op.col);
      if (op.op === 'excluir') {
        if (itemId) {
          reqs.push({ method: 'DELETE', url: `${base}/${itemId}` });
          ops.push(op);
        } else {
          const remotos = await sharepoint.buscarPorChave(op.col, op.id).catch(() => []);
          for (const r of remotos) {
            reqs.push({ method: 'DELETE', url: `${base}/${r}` });
            ops.push({ ...op, itemId: r });
          }
          if (!remotos.length) concluidos.push(op);
        }
        continue;
      }
      const ent = this.dados[op.col].get(op.id);
      if (!ent) {
        concluidos.push(op);
        continue;
      }
      const campos = SharePoint.campos(op.col, ent, ent[PAI[op.col]]);
      if (itemId) reqs.push({ method: 'PATCH', url: `${base}/${itemId}/fields`, body: campos });
      else reqs.push({ method: 'POST', url: base, body: { fields: campos } });
      ops.push(op);
    }
    const resps = reqs.length ? await sharepoint.lote(reqs) : [];
    const erros = [];
    resps.forEach((r, i) => {
      const op = ops[i];
      const req = reqs[i];
      const mapa = (this.spIds[op.col] ||= {});
      const mods = (this.spMod[op.col] ||= {});
      if (r.status >= 200 && r.status < 300) {
        if (req.method === 'POST') {
          mapa[op.id] = r.body.id;
          mods[r.body.id] = r.body.lastModifiedDateTime;
        } else if (req.method === 'DELETE') {
          const itemId = op.itemId || mapa[op.id];
          delete mods[itemId];
          delete mapa[op.id];
        }
        concluidos.push(op);
      } else if (r.status === 404) {
        if (req.method === 'DELETE') {
          delete mapa[op.id];
          concluidos.push(op);
        } else {
          delete mapa[op.id]; // será criado de novo na próxima rodada
        }
      } else {
        erros.push(r.body?.error?.message || `HTTP ${r.status}`);
      }
    });
    const chavesOk = new Map(concluidos.map(op => [`${op.col}:${op.id}`, op.seq]));
    const remover = fila.filter(e => {
      const limite = chavesOk.get(`${e.col}:${e.id}`);
      return limite !== undefined && e.seq <= limite;
    });
    await db.filaRemover(remover.map(e => e.seq));
    await db.metaGravar('spIds', this.spIds);
    await db.metaGravar('spMod', this.spMod);
    if (erros.length) throw new Error(`Falha ao enviar ${erros.length} alteração(ões): ${erros[0]}`);
  }

  async puxar() {
    let mudou = false;
    for (const col of COLS) {
      const versoes = await sharepoint.listarVersoes(col);
      const mapa = (this.spIds[col] ||= {});
      const mods = (this.spMod[col] ||= {});
      const reverso = new Map(Object.entries(mapa).map(([ent, item]) => [String(item), ent]));
      const remotos = new Set(versoes.map(v => String(v.id)));
      const alterados = versoes.filter(v => mods[v.id] !== v.lastModifiedDateTime).map(v => String(v.id));
      let itens = [];
      if (alterados.length > 150) itens = await sharepoint.listarCompleto(col);
      else if (alterados.length) itens = await sharepoint.lerItens(col, alterados);
      const gravar = [];
      const apagar = [];
      for (const item of itens) {
        mods[item.id] = item.lastModifiedDateTime;
        const ent = SharePoint.paraEntidade(item);
        if (!ent) continue;
        const atual = mapa[ent.id];
        if (atual && String(atual) !== String(item.id) && remotos.has(String(atual))) continue; // duplicado
        mapa[ent.id] = item.id;
        if (this.pendentes.has(`${col}:${ent.id}`)) continue;
        const local = this.dados[col].get(ent.id);
        if (local && local.modificadoEm === ent.modificadoEm && local.modificadoEm) continue;
        this.dados[col].set(ent.id, ent);
        gravar.push(ent);
      }
      for (const [itemId, entId] of reverso) {
        if (remotos.has(itemId)) continue;
        delete mapa[entId];
        delete mods[itemId];
        if (this.pendentes.has(`${col}:${entId}`)) continue;
        if (this.dados[col].has(entId)) {
          this.dados[col].delete(entId);
          apagar.push(entId);
        }
      }
      if (gravar.length || apagar.length) {
        mudou = true;
        this.tocar(col);
        await db.gravar(col, gravar);
        await db.apagar(col, apagar);
      }
    }
    await db.metaGravar('spIds', this.spIds);
    await db.metaGravar('spMod', this.spMod);
    if (mudou) this.emitir();
  }

  /* ------------------------------ backup ------------------------------ */

  exportarBackup() {
    const dados = {};
    for (const c of COLS) dados[c] = this.lista(c);
    return { formato: 'cronoanalise-v2', versao: 1, exportadoEm: agoraISO(), dados };
  }

  importarBackup(obj, modo = 'mesclar') {
    if (!obj || obj.formato !== 'cronoanalise-v2' || !obj.dados) throw new Error('Arquivo de backup inválido.');
    const resumo = {};
    if (modo === 'substituir') {
      for (const c of COLS) {
        const ids = [...this.dados[c].keys()];
        if (ids.length) this.excluir(c, ids, { registrarHistorico: false });
      }
    }
    for (const c of COLS) {
      const itens = Array.isArray(obj.dados[c]) ? obj.dados[c].filter(i => i && i.id) : [];
      if (itens.length) {
        this.importarItens(c, itens);
        resumo[c] = itens.length;
      }
    }
    this.registrarHistorico('importou', 'config', [], `backup (${Object.values(resumo).reduce((a, b) => a + b, 0)} registros)`);
    return resumo;
  }

  /* ------------------------------ pasta compartilhada (Excel) ------------------------------ */

  nomesConsulta() {
    return {
      area: id => this.obter('areas', id)?.nome || '',
      areaDoSetor: sid => this.obter('areas', this.obter('setores', sid)?.areaId)?.nome || '',
      setor: id => this.obter('setores', id)?.nome || '',
      atividade: id => this.obter('atividades', id),
      codigo: a => this.codigo(a),
      parada: id => this.obter('paradas', id)?.nome || '',
    };
  }

  async iniciarPasta() {
    this.sync.modo = 'pasta';
    this.emitir();
    await pasta.carregar();
    this.sync.pasta.nome = pasta.nome;
    this.sync.pasta.permissao = await pasta.permissao(false).catch(() => 'prompt');
    this.emitir();
    if (this.sync.pasta.permissao === 'granted') await this.sincronizarPasta();
  }

  /** Escolhe (ou recebe) a pasta e passa a trabalhar nela. */
  async conectarPasta(handle = null, { incluirLocais = true } = {}) {
    if (handle) await pasta.definir(handle);
    else await pasta.escolher();
    const p = await pasta.permissao(true);
    if (p !== 'granted') throw new Error('O navegador não recebeu permissão para usar a pasta.');
    if (!this.dispositivoId) {
      this.dispositivoId = uid().replace(/-/g, '').slice(0, 8);
      await db.metaGravar('dispositivoId', this.dispositivoId);
    }
    this.arquivoProprio = nomeArquivoDispositivo(this.autor() || 'Usuario', this.dispositivoId);
    await db.metaGravar('arquivoProprio', this.arquivoProprio);
    this.diario = Object.fromEntries(COLS.map(c => [c, {}]));
    this.exclusoesDiario = {};
    if (incluirLocais) for (const c of COLS) for (const e of this.dados[c].values()) this.diario[c][e.id] = e;
    this.versaoDiario++;
    this.diarioSujo = true;
    this.salvarDiario();
    this.sync.modo = 'pasta';
    this.sync.erro = null;
    this.sync.pasta.nome = pasta.nome;
    this.sync.pasta.permissao = 'granted';
    await db.metaGravar('modoArmazenamento', 'pasta');
    this.emitir();
    await this.sincronizarPasta({ forcarEscrita: true, removerAusentes: true });
  }

  /** Pede de novo a permissão da pasta (precisa ser chamado a partir de um clique). */
  async reconectarPasta() {
    const p = await pasta.permissao(true);
    this.sync.pasta.permissao = p;
    this.emitir();
    if (p === 'granted') await this.sincronizarPasta();
    return p;
  }

  async desconectarPasta() {
    await pasta.esquecer();
    this.sync.modo = 'local';
    this.sync.erro = null;
    this.sync.pasta = { nome: '', permissao: null, arquivos: [], avisos: [], consolidadoEm: null };
    await db.metaGravar('modoArmazenamento', 'local');
    this.emitir();
  }

  async definirConsolidadoAuto(valor) {
    this.consolidadoAuto = Boolean(valor);
    await db.metaGravar('consolidadoAuto', this.consolidadoAuto);
    this.emitir();
  }

  async gravarArquivoProprio() {
    const XLSX = await obterXLSX();
    const versao = this.versaoDiario;
    const wb = montarPlanilha(XLSX, {
      diario: this.diario,
      exclusoes: this.exclusoesDiario,
      info: { dispositivo: this.dispositivoId, pessoa: this.autor() || '', atualizadoEm: agoraISO() },
      nomes: this.nomesConsulta(),
    });
    await pasta.gravarPlanilha(this.arquivoProprio, wb);
    if (this.versaoDiario === versao) {
      this.diarioSujo = false;
      db.metaGravar('diarioSujo', false);
    }
  }

  /** Junta os arquivos de todos: vale a versão mais recente de cada registro; exclusões vencem versões anteriores. */
  mesclarArquivos(arquivos, { removerAusentes = true } = {}) {
    const mapas = Object.fromEntries(COLS.map(c => [c, new Map()]));
    const tumbas = new Map();
    const considerar = (col, e) => {
      if (!mapas[col] || !e?.id) return;
      const atual = mapas[col].get(e.id);
      if (!atual || (e.modificadoEm || '') > (atual.modificadoEm || '')) mapas[col].set(e.id, e);
    };
    const tumba = (chave, ts) => {
      if (!tumbas.has(chave) || ts > tumbas.get(chave)) tumbas.set(chave, ts);
    };
    for (const arq of arquivos) {
      for (const [col, lista] of Object.entries(arq.registros || {})) for (const e of lista) considerar(col, e);
      for (const t of arq.exclusoes || []) tumba(`${t.col}:${t.id}`, t.ts);
    }
    for (const c of COLS) for (const e of Object.values(this.diario[c] || {})) considerar(c, e);
    for (const [k, ts] of Object.entries(this.exclusoesDiario)) tumba(k, ts);
    for (const [k, ts] of tumbas) {
      const i = k.indexOf(':');
      const col = k.slice(0, i);
      const id = k.slice(i + 1);
      const e = mapas[col]?.get(id);
      if (e && (e.modificadoEm || '') <= ts) mapas[col].delete(id);
    }
    let mudou = false;
    for (const col of COLS) {
      const atual = this.dados[col];
      const novo = mapas[col];
      const gravar = [];
      const apagar = [];
      for (const [id, e] of novo) {
        const a = atual.get(id);
        if (!a || a.modificadoEm !== e.modificadoEm) gravar.push(e);
      }
      for (const id of atual.keys()) {
        if (novo.has(id)) continue;
        if (removerAusentes || tumbas.has(`${col}:${id}`)) apagar.push(id);
      }
      if (gravar.length || apagar.length) {
        mudou = true;
        for (const e of gravar) atual.set(e.id, e);
        for (const id of apagar) atual.delete(id);
        this.tocar(col);
        db.gravar(col, gravar);
        db.apagar(col, apagar);
      }
    }
    if (mudou) this.emitir();
    return mudou;
  }

  sincronizarPasta({ forcarEscrita = false, removerAusentes } = {}) {
    if (this._sincronizando) return this._sincronizando;
    if (!pasta.handle) {
      this.sync.pasta.permissao = 'sem-pasta';
      this.emitir();
      return Promise.resolve();
    }
    this._sincronizando = (async () => {
      this.sync.sincronizando = true;
      this.emitir();
      try {
        const p = await pasta.permissao(false);
        this.sync.pasta.permissao = p;
        if (p !== 'granted') return;
        if (this.diarioSujo || forcarEscrita || !this.arquivoProprio) {
          if (!this.arquivoProprio) {
            this.arquivoProprio = nomeArquivoDispositivo(this.autor() || 'Usuario', this.dispositivoId || uid().slice(0, 8));
            db.metaGravar('arquivoProprio', this.arquivoProprio);
          }
          await this.gravarArquivoProprio();
        }
        const { arquivos, erros } = await pasta.lerTodos();
        // se algum arquivo não pôde ser lido, não remove nada que "sumiu" (evita apagar por engano)
        this.mesclarArquivos(arquivos, { removerAusentes: removerAusentes ?? !erros.length });
        this.sync.pasta.arquivos = arquivos.map(a => ({ nome: a.nome, modificado: a.modificado, proprio: a.nome === this.arquivoProprio })).sort((a, b) => b.modificado - a.modificado);
        this.sync.pasta.avisos = erros;
        this.sync.ultima = agoraISO();
        this.sync.erro = null;
        await db.metaGravar('ultimaSync', this.sync.ultima);
        if (this.consolidadoAuto && this._versaoConsolidado !== this.versao && Date.now() - (this._ultimoConsolidado || 0) > 5 * 60_000) {
          await this.gravarConsolidado().catch(e => this.sync.pasta.avisos.push('Consolidado: ' + e.message));
        }
      } catch (e) {
        console.error('Sincronização da pasta', e);
        this.sync.erro = e.message || String(e);
        if (e.codigo === 'permissao') this.sync.pasta.permissao = 'prompt';
      } finally {
        this.sync.sincronizando = false;
        this._sincronizando = null;
        this.emitir();
      }
    })();
    return this._sincronizando;
  }

  /** Grava "Cronoanalise - Consolidado.xlsx" na pasta: tudo junto, com a produtividade calculada. */
  async gravarConsolidado() {
    const XLSX = await obterXLSX();
    const { montarPlanilhaCompleta } = await import('./exportar.js');
    const wb = montarPlanilhaCompleta(XLSX, {});
    await pasta.gravarPlanilha(NOME_CONSOLIDADO, wb);
    this._versaoConsolidado = this.versao;
    this._ultimoConsolidado = Date.now();
    this.sync.pasta.consolidadoEm = agoraISO();
    this.emitir();
  }

  /** Grava itens preservando datas originais (importações). */
  importarItens(col, itens) {
    for (const i of itens) this.dados[col].set(i.id, { ...i });
    this.tocar(col);
    this.persistir(col, itens, []);
    this.emitir();
  }

  async apagarTudoLocal() {
    for (const c of COLS) this.dados[c].clear();
    await db.apagarTudo();
    this.spIds = {};
    this.spMod = {};
    this.historico = [];
    this.pendentes.clear();
    this.diario = Object.fromEntries(COLS.map(c => [c, {}]));
    this.exclusoesDiario = {};
    this.diarioSujo = false;
    if (this.sync.modo === 'pasta') {
      this.sync.modo = 'local';
      this.sync.pasta = { nome: '', permissao: null, arquivos: [], avisos: [], consolidadoEm: null };
    }
    this.tocar();
    await this.recontarFila();
    this.emitir();
  }
}

export const store = new Store();
window.__cronoStore = store; // útil para diagnóstico no console
