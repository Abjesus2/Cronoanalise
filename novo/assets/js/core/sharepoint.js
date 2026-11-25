// Integração com SharePoint Online via Microsoft Graph.
// Cada coleção vira uma Lista do SharePoint com as colunas:
//   Title (nome legível) · Chave (id da entidade, indexada) · Pai (id do pai, indexada) · Dados (JSON)
// Medições ganham colunas extras legíveis (DataHora, TempoSeg, Operador) para uso direto no Excel/Power BI.
import { URL_MSAL } from '../lib.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const ESCOPOS_DADOS = ['User.Read', 'Sites.ReadWrite.All'];
const ESCOPOS_CRIAR = ['Sites.Manage.All'];

export const LISTAS = {
  areas: { nome: 'Crono_Areas', titulo: 'Operações' },
  setores: { nome: 'Crono_Setores', titulo: 'Setores' },
  atividades: { nome: 'Crono_Atividades', titulo: 'Atividades' },
  medicoes: {
    nome: 'Crono_Medicoes',
    titulo: 'Medições',
    extras: [
      { name: 'DataHora', dateTime: { format: 'dateTime' } },
      { name: 'TempoSeg', number: { decimalPlaces: 'automatic' } },
      { name: 'Operador', text: {} },
    ],
  },
  paradas: { nome: 'Crono_Paradas', titulo: 'Paradas e motivos' },
  fluxos: { nome: 'Crono_Fluxos', titulo: 'Fluxogramas' },
  config: { nome: 'Crono_Config', titulo: 'Configurações' },
};

const COLUNAS_BASE = [
  { name: 'Chave', text: {}, indexed: true },
  { name: 'Pai', text: {}, indexed: true },
  { name: 'Dados', text: { allowMultipleLines: true, textType: 'plain', linesForEditing: 6 } },
];

export class ErroGraph extends Error {
  constructor(status, mensagem, codigo) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

const esperar = ms => new Promise(r => setTimeout(r, ms));

export class SharePoint {
  constructor() {
    this.cfg = null;
    this.msal = null;
    this.pca = null;
    this.conta = null;
    this.siteId = null;
    this.listas = {}; // colecao -> listId
  }

  get configurado() {
    return Boolean(this.cfg?.clientId && this.cfg?.siteUrl);
  }

  get redirectUri() {
    return new URL('redirect.html', location.href).href;
  }

  async iniciar(cfg) {
    this.cfg = cfg;
    this.siteId = null;
    this.listas = {};
    if (!this.configurado) return null;
    if (!this.msal) this.msal = await import(URL_MSAL);
    this.pca = new this.msal.PublicClientApplication({
      auth: {
        clientId: cfg.clientId,
        authority: `https://login.microsoftonline.com/${cfg.tenantId || 'organizations'}`,
        redirectUri: this.redirectUri,
        navigateToLoginRequestUrl: false,
      },
      cache: { cacheLocation: 'localStorage' },
    });
    await this.pca.initialize();
    try {
      await this.pca.handleRedirectPromise();
    } catch (e) {
      console.warn('MSAL redirect', e);
    }
    const contas = this.pca.getAllAccounts();
    this.conta = contas[0] || null;
    if (this.conta) this.pca.setActiveAccount(this.conta);
    return this.conta;
  }

  usuario() {
    if (!this.conta) return null;
    return { nome: this.conta.name || this.conta.username, email: this.conta.username };
  }

  async entrar() {
    if (!this.pca) throw new Error('SharePoint não configurado.');
    const r = await this.pca.loginPopup({ scopes: ESCOPOS_DADOS, prompt: 'select_account' });
    this.conta = r.account;
    this.pca.setActiveAccount(this.conta);
    return this.usuario();
  }

  async sair() {
    if (!this.pca || !this.conta) return;
    const conta = this.conta;
    this.conta = null;
    this.siteId = null;
    this.listas = {};
    try {
      await this.pca.logoutPopup({ account: conta, mainWindowRedirectUri: location.href });
    } catch {
      /* ignora */
    }
  }

  async token(escopos = ESCOPOS_DADOS, interativo = false) {
    if (!this.pca) throw new Error('SharePoint não configurado.');
    if (!this.conta) {
      if (!interativo) throw new ErroGraph(401, 'É preciso entrar com a conta Microsoft.', 'login');
      await this.entrar();
    }
    try {
      const r = await this.pca.acquireTokenSilent({ scopes: escopos, account: this.conta });
      return r.accessToken;
    } catch (e) {
      if (!interativo) throw new ErroGraph(401, 'Sessão expirada. Entre novamente com a conta Microsoft.', 'login');
      const r = await this.pca.acquireTokenPopup({ scopes: escopos, account: this.conta });
      return r.accessToken;
    }
  }

  async graph(metodo, caminho, corpo, opcoes = {}) {
    const url = caminho.startsWith('http') ? caminho : GRAPH + caminho;
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const tk = await this.token(opcoes.escopos, opcoes.interativo);
      const r = await fetch(url, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${tk}`,
          Accept: 'application/json',
          ...(corpo ? { 'Content-Type': 'application/json' } : {}),
          ...(opcoes.headers || {}),
        },
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
      if (r.status === 429 || r.status === 503 || r.status === 504) {
        const ra = Number(r.headers.get('Retry-After')) || 2 ** tentativa;
        await esperar(Math.min(ra, 30) * 1000);
        continue;
      }
      if (r.status === 204) return null;
      const texto = await r.text();
      const json = texto ? JSON.parse(texto) : null;
      if (!r.ok) {
        throw new ErroGraph(r.status, json?.error?.message || `Erro ${r.status} no Microsoft Graph`, json?.error?.code);
      }
      return json;
    }
    throw new ErroGraph(429, 'O SharePoint está ocupado. Tente novamente em instantes.');
  }

  /** Executa até 20 requisições por lote. Retorna respostas na mesma ordem. */
  async lote(requisicoes, opcoes = {}) {
    const respostas = [];
    for (let i = 0; i < requisicoes.length; i += 20) {
      const fatia = requisicoes.slice(i, i + 20).map((r, j) => ({
        id: String(j),
        method: r.method,
        url: r.url,
        ...(r.body ? { body: r.body, headers: { 'Content-Type': 'application/json' } } : {}),
        ...(r.headers ? { headers: { ...(r.body ? { 'Content-Type': 'application/json' } : {}), ...r.headers } } : {}),
      }));
      let pendentes = fatia;
      const resultado = new Array(fatia.length);
      for (let tentativa = 0; tentativa < 5 && pendentes.length; tentativa++) {
        const r = await this.graph('POST', '/$batch', { requests: pendentes }, opcoes);
        let maiorEspera = 0;
        const repetir = [];
        for (const resp of r.responses) {
          const original = pendentes.find(p => p.id === resp.id);
          if (resp.status === 429 || resp.status === 503) {
            maiorEspera = Math.max(maiorEspera, Number(resp.headers?.['Retry-After']) || 2);
            repetir.push(original);
          } else {
            resultado[Number(resp.id)] = resp;
          }
        }
        pendentes = repetir;
        if (repetir.length) await esperar(Math.min(maiorEspera, 30) * 1000);
      }
      respostas.push(...resultado.map(r => r || { status: 429, body: { error: { message: 'Limite de requisições' } } }));
    }
    return respostas;
  }

  async resolverSite() {
    if (this.siteId) return this.siteId;
    const u = new URL(this.cfg.siteUrl.trim());
    const caminho = u.pathname.replace(/\/+$/, '').replace(/\/(SitePages|Shared%20Documents|Lists)\/.*$/i, '');
    const site = await this.graph('GET', `/sites/${u.hostname}:${caminho || '/'}?$select=id,displayName,webUrl`);
    this.siteId = site.id;
    this.siteNome = site.displayName;
    return site.id;
  }

  /** Localiza (e opcionalmente cria) as listas. Retorna { encontradas, faltando }. */
  async verificarListas(criar = false) {
    const siteId = await this.resolverSite();
    const r = await this.graph('GET', `/sites/${siteId}/lists?$select=id,displayName,name&$top=999`);
    const existentes = new Map();
    for (const l of r.value || []) {
      existentes.set(l.displayName.toLowerCase(), l.id);
      if (l.name) existentes.set(l.name.toLowerCase(), l.id);
    }
    const faltando = [];
    for (const [col, def] of Object.entries(LISTAS)) {
      const id = existentes.get(def.nome.toLowerCase());
      if (id) this.listas[col] = id;
      else faltando.push(col);
    }
    if (criar && faltando.length) {
      for (const col of faltando) {
        this.listas[col] = await this.criarLista(siteId, col);
      }
      return { faltando: [] };
    }
    return { faltando };
  }

  async criarLista(siteId, col) {
    const def = LISTAS[col];
    const corpo = colunas => ({
      displayName: def.nome,
      description: `Cronoanálise — ${def.titulo} (não edite a coluna Dados manualmente)`,
      columns: colunas,
      list: { template: 'genericList' },
    });
    const colunas = [...COLUNAS_BASE, ...(def.extras || [])];
    const opc = { escopos: ESCOPOS_CRIAR, interativo: true };
    try {
      const r = await this.graph('POST', `/sites/${siteId}/lists`, corpo(colunas), opc);
      return r.id;
    } catch (e) {
      if (e.status !== 400) throw e;
      // alguns tenants recusam "indexed" na criação: cria sem índice
      const semIndice = colunas.map(({ indexed, ...c }) => c);
      const r = await this.graph('POST', `/sites/${siteId}/lists`, corpo(semIndice), opc);
      return r.id;
    }
  }

  caminhoItens(col) {
    const listId = this.listas[col];
    if (!listId) throw new Error(`Lista de ${LISTAS[col].titulo} não encontrada no SharePoint.`);
    return `/sites/${this.siteId}/lists/${listId}/items`;
  }

  /** Lista leve: apenas id e data de modificação dos itens. */
  async listarVersoes(col) {
    let url = `${this.caminhoItens(col)}?$select=id,lastModifiedDateTime&$top=999`;
    const itens = [];
    while (url) {
      const r = await this.graph('GET', url);
      itens.push(...(r.value || []));
      url = r['@odata.nextLink'] || null;
    }
    return itens;
  }

  /** Lê todos os itens com os campos. */
  async listarCompleto(col) {
    let url = `${this.caminhoItens(col)}?$expand=fields($select=Title,Chave,Pai,Dados)&$top=999`;
    const itens = [];
    while (url) {
      const r = await this.graph('GET', url);
      itens.push(...(r.value || []));
      url = r['@odata.nextLink'] || null;
    }
    return itens;
  }

  async lerItens(col, ids) {
    const base = this.caminhoItens(col);
    const resps = await this.lote(ids.map(id => ({ method: 'GET', url: `${base}/${id}?$expand=fields($select=Title,Chave,Pai,Dados)` })));
    return resps.filter(r => r.status === 200).map(r => r.body);
  }

  async buscarPorChave(col, chave) {
    const url = `${this.caminhoItens(col)}?$expand=fields($select=Chave)&$filter=fields/Chave eq '${String(chave).replace(/'/g, "''")}'&$select=id`;
    const r = await this.graph('GET', url, null, { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } });
    return (r.value || []).map(i => i.id);
  }

  static campos(col, entidade, pai) {
    const titulo =
      col === 'medicoes'
        ? `${(entidade.tempo ?? 0).toFixed(3)} s`
        : entidade.nome || entidade.id;
    const f = {
      Title: String(titulo).slice(0, 250),
      Chave: entidade.id,
      Pai: pai || '',
      Dados: JSON.stringify(entidade),
    };
    if (col === 'medicoes') {
      f.DataHora = entidade.dataHora || null;
      f.TempoSeg = Number.isFinite(entidade.tempo) ? entidade.tempo : null;
      f.Operador = (entidade.operador || '').slice(0, 250);
    }
    return f;
  }

  static paraEntidade(item) {
    const f = item.fields || {};
    if (!f.Dados) return null;
    try {
      const e = JSON.parse(f.Dados);
      if (!e.id) e.id = f.Chave;
      return e;
    } catch {
      return null;
    }
  }
}

export const sharepoint = new SharePoint();
