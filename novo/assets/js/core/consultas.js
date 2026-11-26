// Consultas e cálculos memorizados sobre o estado atual.
import { store } from './store.js';
import { analisarAtividade, analisarGrupo, analisarOperadores } from './calc.js';
import { combina } from './util.js';

/** Contexto de cálculo com um conjunto de parâmetros (padrão: o da empresa). */
export function contexto(conjuntoId = 'global') {
  const cfg = store.conjunto(conjuntoId);
  return store.memo('ctx:' + cfg.id, () => ({ config: cfg, paradas: store.mapaParadas() }));
}

/** Contexto com o conjunto de parâmetros que vale para a atividade (setor → operação → padrão). */
export function contextoDe(atividade) {
  return contexto(store.conjuntoIdDoSetor(atividade?.setorId));
}

export function analise(atividadeId) {
  return store.memo('an:' + atividadeId, () => {
    const a = store.obter('atividades', atividadeId);
    if (!a) return null;
    return analisarAtividade(a, store.medicoes(atividadeId), contextoDe(a));
  });
}

export function atividadesDoEscopo(escopo = {}) {
  if (escopo.atividadeId) {
    const a = store.obter('atividades', escopo.atividadeId);
    return a ? [a] : [];
  }
  if (escopo.setorId) return store.atividades(escopo.setorId);
  if (escopo.areaId) return store.atividadesDaArea(escopo.areaId);
  return store.atividades();
}

export function analisesDoEscopo(escopo = {}) {
  const chave = 'ans:' + JSON.stringify(escopo);
  return store.memo(chave, () => atividadesDoEscopo(escopo).map(a => analise(a.id)).filter(Boolean));
}

export function grupo(escopo = {}) {
  return store.memo('gr:' + JSON.stringify(escopo), () => analisarGrupo(analisesDoEscopo(escopo), configDoGrupo(analisesDoEscopo(escopo), escopo)));
}

/**
 * Conjunto usado nos indicadores do grupo (capacidade por dia/mês, meta de eficiência).
 * Se todas as atividades do grupo usam o mesmo conjunto, é ele; senão, o do escopo
 * (setor/operação) ou o padrão da empresa.
 */
export function configDoGrupo(analises, escopo = {}) {
  const ids = new Set(analises.map(an => store.conjuntoIdDoSetor(an.atividade.setorId)));
  if (ids.size === 1) return store.conjunto([...ids][0]);
  return store.configDoEscopo(escopo);
}

/** Os conjuntos de parâmetros usados por um grupo de análises (para avisar quando há mais de um). */
export function conjuntosDoGrupo(analises) {
  return [...new Set(analises.map(an => store.conjuntoIdDoSetor(an.atividade.setorId)))].map(id => store.conjunto(id));
}

export function grupoArea(areaId) {
  return grupo({ areaId });
}

export function grupoSetor(setorId) {
  return grupo({ setorId });
}

export function operadores(escopo = {}) {
  return store.memo('ops:' + JSON.stringify(escopo), () => analisarOperadores(analisesDoEscopo(escopo)));
}

/** Busca global (paleta de comandos). */
export function buscar(termo, limite = 30) {
  if (!termo || !termo.trim()) return [];
  const r = [];
  for (const a of store.areas()) if (combina(a.nome, termo)) r.push({ tipo: 'area', item: a, rota: `#/estrutura/area/${a.id}` });
  for (const s of store.setores()) {
    if (combina(s.nome, termo)) {
      const area = store.obter('areas', s.areaId);
      r.push({ tipo: 'setor', item: s, contexto: area?.nome, rota: `#/estrutura/setor/${s.id}` });
    }
  }
  for (const a of store.atividades()) {
    if (combina(`${a.nome} ${a.descricao || ''} ${a.maquina || ''}`, termo)) {
      const c = store.caminho(a);
      r.push({ tipo: 'atividade', item: a, contexto: [c.area?.nome, c.setor?.nome].filter(Boolean).join(' › '), rota: `#/atividade/${a.id}` });
    }
  }
  for (const nome of store.operadoresConhecidos()) {
    if (combina(nome, termo)) r.push({ tipo: 'operador', item: { nome }, rota: `#/produtividade/operadores?operador=${encodeURIComponent(nome)}` });
  }
  return r.slice(0, limite);
}

/** Atividades que pedem atenção (amostra pequena / instáveis). */
export function pendencias() {
  return store.memo('pendencias', () =>
    analisesDoEscopo({})
      .filter(an => an.total > 0 && an.saude !== 'ok')
      .sort((a, b) => (a.confiabilidade ?? 0) - (b.confiabilidade ?? 0)),
  );
}

/** Atividades medidas recentemente. */
export function recentes(limite = 6) {
  return store.memo('recentes:' + limite, () => {
    const ultimaPorAtividade = new Map();
    for (const m of store.lista('medicoes')) {
      const atual = ultimaPorAtividade.get(m.atividadeId);
      if (!atual || (m.dataHora || '') > atual) ultimaPorAtividade.set(m.atividadeId, m.dataHora || '');
    }
    return [...ultimaPorAtividade.entries()]
      .sort((a, b) => b[1].localeCompare(a[1]))
      .map(([id, data]) => ({ atividade: store.obter('atividades', id), data }))
      .filter(x => x.atividade)
      .slice(0, limite);
  });
}
