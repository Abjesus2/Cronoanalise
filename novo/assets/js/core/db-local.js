// Armazenamento local (IndexedDB) — cache offline e fila de sincronização.
// Se o IndexedDB não estiver disponível, cai para memória (dados somem ao fechar).

export const COLECOES = ['areas', 'setores', 'atividades', 'medicoes', 'paradas', 'fluxos', 'config'];
const NOME_BANCO = 'cronoanalise-v2';
const VERSAO = 1;

let bancoPromise = null;
let memoria = null; // fallback

function abrir() {
  if (bancoPromise) return bancoPromise;
  bancoPromise = new Promise(resolve => {
    if (!('indexedDB' in window)) {
      resolve(null);
      return;
    }
    let req;
    try {
      req = indexedDB.open(NOME_BANCO, VERSAO);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const c of COLECOES) if (!db.objectStoreNames.contains(c)) db.createObjectStore(c, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  }).then(db => {
    if (!db) {
      memoria = { meta: new Map(), outbox: new Map(), seq: 0 };
      for (const c of COLECOES) memoria[c] = new Map();
    }
    return db;
  });
  return bancoPromise;
}

function tx(db, lojas, modo, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(lojas, modo);
    let resultado;
    t.oncomplete = () => resolve(resultado);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    resultado = fn(t);
  });
}

function pedido(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const persistente = async () => Boolean(await abrir());

export async function lerTudo(colecao) {
  const db = await abrir();
  if (!db) return [...memoria[colecao].values()];
  return tx(db, colecao, 'readonly', t => pedido(t.objectStore(colecao).getAll())).then(r => r);
}

export async function lerTudoAsync(colecao) {
  const db = await abrir();
  if (!db) return [...memoria[colecao].values()];
  const t = db.transaction(colecao, 'readonly');
  return pedido(t.objectStore(colecao).getAll());
}

export async function gravar(colecao, itens) {
  const db = await abrir();
  if (!itens.length) return;
  if (!db) {
    for (const i of itens) memoria[colecao].set(i.id, i);
    return;
  }
  await tx(db, colecao, 'readwrite', t => {
    const loja = t.objectStore(colecao);
    for (const i of itens) loja.put(i);
  });
}

export async function apagar(colecao, ids) {
  const db = await abrir();
  if (!ids.length) return;
  if (!db) {
    for (const id of ids) memoria[colecao].delete(id);
    return;
  }
  await tx(db, colecao, 'readwrite', t => {
    const loja = t.objectStore(colecao);
    for (const id of ids) loja.delete(id);
  });
}

export async function limparColecao(colecao) {
  const db = await abrir();
  if (!db) {
    memoria[colecao].clear();
    return;
  }
  await tx(db, colecao, 'readwrite', t => t.objectStore(colecao).clear());
}

export async function metaLer(chave, padrao = null) {
  const db = await abrir();
  if (!db) return memoria.meta.has(chave) ? memoria.meta.get(chave) : padrao;
  const t = db.transaction('meta', 'readonly');
  const v = await pedido(t.objectStore('meta').get(chave));
  return v === undefined ? padrao : v;
}

export async function metaGravar(chave, valor) {
  const db = await abrir();
  if (!db) {
    memoria.meta.set(chave, valor);
    return;
  }
  await tx(db, 'meta', 'readwrite', t => t.objectStore('meta').put(valor, chave));
}

/* ---------------- fila de sincronização (outbox) ---------------- */

export async function filaAdicionar(entradas) {
  const db = await abrir();
  if (!entradas.length) return;
  if (!db) {
    for (const e of entradas) memoria.outbox.set(++memoria.seq, { ...e, seq: memoria.seq });
    return;
  }
  await tx(db, 'outbox', 'readwrite', t => {
    const loja = t.objectStore('outbox');
    for (const e of entradas) loja.add(e);
  });
}

export async function filaLer() {
  const db = await abrir();
  if (!db) return [...memoria.outbox.values()];
  const t = db.transaction('outbox', 'readonly');
  return pedido(t.objectStore('outbox').getAll());
}

export async function filaRemover(seqs) {
  const db = await abrir();
  if (!seqs.length) return;
  if (!db) {
    for (const s of seqs) memoria.outbox.delete(s);
    return;
  }
  await tx(db, 'outbox', 'readwrite', t => {
    const loja = t.objectStore('outbox');
    for (const s of seqs) loja.delete(s);
  });
}

export async function filaLimpar() {
  const db = await abrir();
  if (!db) {
    memoria.outbox.clear();
    return;
  }
  await tx(db, 'outbox', 'readwrite', t => t.objectStore('outbox').clear());
}

export async function apagarTudo() {
  for (const c of COLECOES) await limparColecao(c);
  await filaLimpar();
  const db = await abrir();
  if (!db) {
    memoria.meta.clear();
    return;
  }
  await tx(db, 'meta', 'readwrite', t => t.objectStore('meta').clear());
}
