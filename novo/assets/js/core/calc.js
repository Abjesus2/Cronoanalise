// Motor de cálculo da cronoanálise.
// Segue a metodologia do Treinamento de Métodos & Processos:
//  1 Nivelamento → 2 Tempo total → 3 Nº de observações → 4 Frequência lógica →
//  5 Tempo base → 6 Avaliação de ritmo → 7 Tempo normal → 8 Tolerâncias →
//  9 Tempo padrão → 10 Soma (agrupamentos).
// Todos os tempos em SEGUNDOS. "u" = tempo por unidade por pessoa (homem-segundo/unidade).
import { finito, numero, soma } from './util.js';

/* ------------------------------------------------------------------ */
/* Tabelas de referência                                               */
/* ------------------------------------------------------------------ */

export const WESTINGHOUSE = {
  habilidade: [
    { cod: 'A1', grupo: 'Superior', v: 0.15 },
    { cod: 'A2', grupo: 'Superior', v: 0.13 },
    { cod: 'B1', grupo: 'Excelente', v: 0.11 },
    { cod: 'B2', grupo: 'Excelente', v: 0.08 },
    { cod: 'C1', grupo: 'Boa', v: 0.06 },
    { cod: 'C2', grupo: 'Boa', v: 0.03 },
    { cod: 'D', grupo: 'Normal', v: 0 },
    { cod: 'E1', grupo: 'Regular', v: -0.05 },
    { cod: 'E2', grupo: 'Regular', v: -0.1 },
    { cod: 'F1', grupo: 'Fraca', v: -0.16 },
    { cod: 'F2', grupo: 'Fraca', v: -0.22 },
  ],
  esforco: [
    { cod: 'A1', grupo: 'Excessivo', v: 0.13 },
    { cod: 'A2', grupo: 'Excessivo', v: 0.12 },
    { cod: 'B1', grupo: 'Excelente', v: 0.1 },
    { cod: 'B2', grupo: 'Excelente', v: 0.08 },
    { cod: 'C1', grupo: 'Bom', v: 0.05 },
    { cod: 'C2', grupo: 'Bom', v: 0.02 },
    { cod: 'D', grupo: 'Normal', v: 0 },
    { cod: 'E1', grupo: 'Regular', v: -0.04 },
    { cod: 'E2', grupo: 'Regular', v: -0.08 },
    { cod: 'F1', grupo: 'Fraco', v: -0.12 },
    { cod: 'F2', grupo: 'Fraco', v: -0.17 },
  ],
};

export function fatorWestinghouse(hab = 'D', esf = 'D') {
  const h = WESTINGHOUSE.habilidade.find(x => x.cod === hab)?.v ?? 0;
  const e = WESTINGHOUSE.esforco.find(x => x.cod === esf)?.v ?? 0;
  return Math.round((1 + h + e) * 100) / 100;
}

// Tabela de tolerâncias do treinamento (valores em fração: 0,026 = 2,6%).
export const TABELA_TOLERANCIAS = [
  {
    id: 'pessoais', nome: 'Necessidades pessoais', ajuda: 'Banheiro, água, pausas pessoais.',
    opcoes: [
      { id: 'homem', nome: 'Homem', v: 0.026 },
      { id: 'mulher', nome: 'Mulher', v: 0.03 },
      { id: 'coringa', nome: 'Coringa', v: 0.005 },
    ],
  },
  {
    id: 'ambientacao', nome: 'Ambientação (temperatura)', ajuda: 'Temperatura do posto de trabalho.',
    opcoes: [
      { id: 'lt4', nome: 'Abaixo de 4 °C', v: 0.03 },
      { id: '4a10', nome: '4 a 10 °C', v: 0.01 },
      { id: '11a28', nome: '11 a 28 °C', v: 0 },
      { id: '29a34', nome: '29 a 34 °C', v: 0.01 },
      { id: 'gt34', nome: 'Acima de 34 °C', v: 0.03 },
    ],
  },
  {
    id: 'fisico', nome: 'Esforço físico', ajuda: 'Intensidade física exigida pela operação.',
    opcoes: [
      { id: 'muitoleve', nome: 'Muito leve', v: 0.018 },
      { id: 'leve', nome: 'Leve', v: 0.036 },
      { id: 'medio', nome: 'Médio', v: 0.054 },
      { id: 'pesado', nome: 'Pesado', v: 0.072 },
      { id: 'muitopesado', nome: 'Muito pesado', v: 0.09 },
    ],
  },
  {
    id: 'peso', nome: 'Levantar peso a 1 m de altura', ajuda: 'O valor muda conforme a opção de necessidades pessoais (homem/mulher).',
    porGenero: true,
    opcoes: [
      { id: '2.5', nome: '2,5 kg', h: 0.01, m: 0.02 },
      { id: '5', nome: '5 kg', h: 0.02, m: 0.03 },
      { id: '7.5', nome: '7,5 kg', h: 0.03, m: 0.04 },
      { id: '10', nome: '10 kg', h: 0.04, m: 0.06 },
      { id: '12.5', nome: '12,5 kg', h: 0.05, m: 0.08 },
      { id: '15', nome: '15 kg', h: 0.07, m: 0.1 },
      { id: '17.5', nome: '17,5 kg', h: 0.09, m: 0.15 },
    ],
  },
  {
    id: 'mental', nome: 'Esforço mental', ajuda: 'Atenção e precisão exigidas.',
    opcoes: [
      { id: 'pouca', nome: 'Pouca precisão', v: 0.01 },
      { id: 'preciso', nome: 'Preciso', v: 0.02 },
      { id: 'grande', nome: 'Grande precisão', v: 0.03 },
    ],
  },
  {
    id: 'conforto', nome: 'Condições de conforto', ajuda: 'Ambiente do posto de trabalho.',
    opcoes: [
      { id: 'confortavel', nome: 'Local confortável', v: 0.01 },
      { id: 'leve', nome: 'Levemente desconfortável', v: 0.02 },
      { id: 'poeira', nome: 'Poeira, sujeira, ruído', v: 0.08 },
    ],
  },
  {
    id: 'monotonia', nome: 'Monotonia (duração do ciclo)', ajuda: 'Calculada automaticamente pela duração média do ciclo medido.',
    automatica: true,
    faixas: [
      { ate: 0.05, v: 0.078 }, { ate: 0.25, v: 0.054 }, { ate: 0.5, v: 0.036 }, { ate: 1, v: 0.021 },
      { ate: 4, v: 0.01 }, { ate: 8, v: 0.008 }, { ate: 12, v: 0.006 }, { ate: 16, v: 0.003 },
      { ate: Infinity, v: 0.001 },
    ],
  },
  { id: 'lubrificacao', nome: 'Lubrificação de máquinas', faixa: [0, 0.03], ajuda: 'De 0 a 3%.' },
  { id: 'ferramentas', nome: 'Ferramentas', faixa: [0, 0.08], ajuda: 'De 0 a 8%.' },
  { id: 'imprevistos', nome: 'Imprevistos', faixa: [0, 0.05], ajuda: 'De 0 a 5% (variável).' },
];

export function toleranciaMonotonia(cicloMin) {
  if (!finito(cicloMin) || cicloMin <= 0) return 0;
  const cat = TABELA_TOLERANCIAS.find(c => c.id === 'monotonia');
  return cat.faixas.find(f => cicloMin <= f.ate).v;
}

/** Soma da tabela de tolerâncias. itens = { pessoais:'homem', fisico:'leve', lubrificacao:0.01, monotonia:'auto'|'off' } */
export function calcularTabelaTolerancias(itens = {}, cicloMedioSeg = null) {
  const detalhes = [];
  const genero = itens.pessoais === 'mulher' ? 'm' : 'h';
  for (const cat of TABELA_TOLERANCIAS) {
    const sel = itens[cat.id];
    let v = 0;
    let rotulo = '';
    if (cat.automatica) {
      if (sel === 'off') continue;
      const cicloMin = finito(cicloMedioSeg) ? cicloMedioSeg / 60 : null;
      v = toleranciaMonotonia(cicloMin);
      rotulo = cicloMin ? `ciclo de ${cicloMin.toFixed(2).replace('.', ',')} min` : 'sem medições';
    } else if (cat.faixa) {
      const n = numero(sel);
      if (!n) continue;
      v = Math.min(Math.max(n, cat.faixa[0]), cat.faixa[1]);
      rotulo = 'informado';
    } else {
      const op = cat.opcoes.find(o => o.id === sel);
      if (!op) continue;
      v = cat.porGenero ? op[genero] : op.v;
      rotulo = op.nome;
    }
    if (v > 0) detalhes.push({ id: cat.id, nome: cat.nome, rotulo, v });
  }
  return { total: soma(detalhes.map(d => d.v)), detalhes };
}

// Coeficientes estatísticos do treinamento (Tabelas 1 e 2).
export const Z_CONFIANCA = [
  { c: 0.9, z: 1.65 }, { c: 0.91, z: 1.7 }, { c: 0.92, z: 1.75 }, { c: 0.93, z: 1.81 }, { c: 0.94, z: 1.88 },
  { c: 0.95, z: 1.96 }, { c: 0.96, z: 2.05 }, { c: 0.97, z: 2.17 }, { c: 0.98, z: 2.33 }, { c: 0.99, z: 2.58 },
];
export const D2 = { 2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326, 6: 2.534, 7: 2.704, 8: 2.847, 9: 2.97, 10: 3.078 };

export function zPorConfianca(c) {
  let melhor = Z_CONFIANCA[5];
  for (const linha of Z_CONFIANCA) if (Math.abs(linha.c - c) < Math.abs(melhor.c - c)) melhor = linha;
  return melhor.z;
}

export const CONFIG_PADRAO = {
  id: 'global',
  jornadaMin: 528, // minutos por dia (jornada total)
  diasSemana: 5,
  diasMes: 22,
  diasAno: 264,
  eficienciaMeta: 0.85,
  toleranciaPadrao: 0.1,
  confianca: 0.95,
  erroRel: 0.05,
  nivelamento: 'sigma', // sigma | iqr | off
  nivelamentoK: 2,
  cvBom: 0.1,
  cvAtencao: 0.25,
  minMedicoes: 5,
  mediaTempoBase: 'ponderada', // ponderada | simples
};

export const ATIVIDADE_PADRAO = {
  unidade: 'peça',
  freqObs: 1,
  freqPecas: 1,
  campoQtdId: null,
  campoPessoasId: null,
  parametros: [],
  ritmo: { modo: 'percentual', valor: 1, hab: 'D', esf: 'D' },
  tolerancia: { modo: 'padrao', valor: 0.1, itens: { pessoais: 'homem', monotonia: 'auto' } },
  paradasIds: [],
  pessoas: 1,
  descricao: '',
  criterios: '',
  consideracoes: '',
  maquina: '',
};

export function normalizarAtividade(a) {
  return {
    ...ATIVIDADE_PADRAO,
    ...a,
    ritmo: { ...ATIVIDADE_PADRAO.ritmo, ...(a?.ritmo || {}) },
    tolerancia: {
      ...ATIVIDADE_PADRAO.tolerancia,
      ...(a?.tolerancia || {}),
      itens: { ...ATIVIDADE_PADRAO.tolerancia.itens, ...(a?.tolerancia?.itens || {}) },
    },
    parametros: Array.isArray(a?.parametros) ? a.parametros : [],
    paradasIds: Array.isArray(a?.paradasIds) ? a.paradasIds : [],
  };
}

export function ritmoDaAtividade(a) {
  const r = a?.ritmo || {};
  if (r.modo === 'westinghouse') return fatorWestinghouse(r.hab, r.esf);
  const v = numero(r.valor);
  return v && v > 0 ? v : 1;
}

/* ------------------------------------------------------------------ */
/* Estatística                                                         */
/* ------------------------------------------------------------------ */

export function quantil(ordenados, p) {
  if (!ordenados.length) return null;
  const pos = (ordenados.length - 1) * p;
  const base = Math.floor(pos);
  const resto = pos - base;
  const prox = ordenados[base + 1];
  return prox !== undefined ? ordenados[base] + resto * (prox - ordenados[base]) : ordenados[base];
}

/** Estatística descritiva (desvio padrão AMOSTRAL, n−1). */
export function estatisticas(valores) {
  const v = valores.filter(finito);
  const n = v.length;
  if (!n) return { n: 0, media: null, mediana: null, min: null, max: null, dp: null, cv: null, amplitude: null, soma: 0 };
  const ord = [...v].sort((a, b) => a - b);
  const total = soma(v);
  const med = total / n;
  const dp = n > 1 ? Math.sqrt(soma(v.map(x => (x - med) ** 2)) / (n - 1)) : 0;
  return {
    n,
    soma: total,
    media: med,
    mediana: quantil(ord, 0.5),
    min: ord[0],
    max: ord[n - 1],
    q1: quantil(ord, 0.25),
    q3: quantil(ord, 0.75),
    dp,
    cv: med > 0 ? dp / med : null,
    amplitude: ord[n - 1] - ord[0],
  };
}

/** Limites do nivelamento automático. */
export function limitesNivelamento(valores, metodo = 'sigma', k = 2) {
  const v = valores.filter(finito);
  if (metodo === 'off' || v.length < 5) return null;
  const e = estatisticas(v);
  if (metodo === 'iqr') {
    const iqr = e.q3 - e.q1;
    return { inf: e.q1 - 1.5 * iqr, sup: e.q3 + 1.5 * iqr, metodo };
  }
  return { inf: e.media - k * e.dp, sup: e.media + k * e.dp, metodo };
}

/** Nº de ciclos necessários: N = (Z · σ̂ / (Er · x̄))²; σ̂ = R/d₂ (n ≤ 10) ou s (n > 10). */
export function ciclosNecessarios(valores, confianca = 0.95, erroRel = 0.05) {
  const e = estatisticas(valores);
  if (e.n < 2 || !(e.media > 0)) return { necessario: null, metodo: null };
  const z = zPorConfianca(confianca);
  let sigma;
  let metodo;
  if (e.n <= 10) {
    sigma = e.amplitude / D2[e.n];
    metodo = 'amplitude';
  } else {
    sigma = e.dp;
    metodo = 'desvio';
  }
  const n = Math.ceil(((z * sigma) / (erroRel * e.media)) ** 2);
  return { necessario: Math.max(n, 2), metodo, z, sigma };
}

/* ------------------------------------------------------------------ */
/* Análise de uma atividade                                            */
/* ------------------------------------------------------------------ */

export function periodos(tpSeg, cfg) {
  if (!(tpSeg > 0)) return null;
  const jornadaSeg = cfg.jornadaMin * 60;
  const dia = jornadaSeg / tpSeg;
  return {
    segundo: 1 / tpSeg,
    minuto: 60 / tpSeg,
    hora: 3600 / tpSeg,
    dia,
    semana: dia * cfg.diasSemana,
    mes: dia * cfg.diasMes,
    ano: dia * cfg.diasAno,
  };
}

export function multiplicarPeriodos(p, fator) {
  if (!p) return null;
  const r = {};
  for (const k of Object.keys(p)) r[k] = p[k] * fator;
  return r;
}

/**
 * Analisa uma atividade a partir das suas medições.
 * ctx = { config, paradas: Map(id → parada) }
 */
export function analisarAtividade(atividadeBruta, medicoes, ctx) {
  const a = normalizarAtividade(atividadeBruta);
  const cfg = { ...CONFIG_PADRAO, ...(ctx.config || {}) };
  const paradas = ctx.paradas || new Map();
  const ritmoBase = ritmoDaAtividade(a);
  const qFixa = (numero(a.freqPecas) || 1) / (numero(a.freqObs) || 1);

  const linhas = medicoes.map(m => {
    const t = numero(m.tempo);
    const q = a.campoQtdId ? numero(m.valores?.[a.campoQtdId]) : qFixa;
    let p = a.campoPessoasId ? numero(m.valores?.[a.campoPessoasId]) : 1;
    if (!(p > 0)) p = 1;
    const u = t > 0 && q > 0 ? (t * p) / q : null;
    const motivo = m.motivoId ? paradas.get(m.motivoId) : null;
    const r = numero(m.ritmo) > 0 ? numero(m.ritmo) : ritmoBase;
    let status = 'valida';
    let razao = '';
    if (m.nivel === 'excluir') {
      status = 'excluida';
      razao = 'Excluída manualmente';
    } else if (u == null) {
      status = 'invalida';
      razao = !(t > 0) ? 'Sem tempo válido' : 'Sem quantidade válida';
    } else if (motivo?.excluiCalculo && m.nivel !== 'incluir') {
      status = 'excluida';
      razao = `Motivo: ${motivo.nome}`;
    }
    return { m, t, q: q > 0 ? q : null, p, u, r, motivo, status, razao, desvio: null };
  });

  // Passo 1 — nivelamento automático
  const candidatas = linhas.filter(l => l.status === 'valida');
  const limites = limitesNivelamento(candidatas.map(l => l.u), cfg.nivelamento, cfg.nivelamentoK);
  if (limites) {
    for (const l of candidatas) {
      if (l.m.nivel === 'incluir') continue;
      if (l.u < limites.inf || l.u > limites.sup) {
        l.status = 'nivelada';
        l.razao = l.u > limites.sup ? 'Acima do limite do nivelamento' : 'Abaixo do limite do nivelamento';
      }
    }
  }

  const validas = linhas.filter(l => l.status === 'valida');
  const est = estatisticas(validas.map(l => l.u));
  const somaTP = soma(validas.map(l => l.t * l.p));
  const somaQ = soma(validas.map(l => l.q));
  const somaP = soma(validas.map(l => l.p));

  // Passos 2–5: tempo base
  //  'ponderada' (padrão): Σ(tempo × pessoas) ÷ Σ quantidades — lotes grandes pesam mais (tempo total ÷ total produzido)
  //  'simples': média dos tempos por unidade de cada medição (como fazia o sistema antigo)
  const simples = cfg.mediaTempoBase === 'simples';
  const tempoBase = simples
    ? (validas.length ? soma(validas.map(l => l.u)) / validas.length : null)
    : somaQ > 0 ? somaTP / somaQ : null;
  // Passos 6–7: ritmo e tempo normal
  const tempoNormal = simples
    ? (validas.length ? soma(validas.map(l => l.u * l.r)) / validas.length : null)
    : somaQ > 0 ? soma(validas.map(l => l.t * l.p * l.r)) / somaQ : null;
  const ritmo = tempoBase ? tempoNormal / tempoBase : ritmoBase;
  for (const l of linhas) l.desvio = l.u && tempoBase ? tempoBase / l.u : null;

  const cicloMedio = validas.length ? soma(validas.map(l => l.t)) / validas.length : null;

  // Passo 8: tolerâncias
  let tolManual;
  let tolDetalhes = [];
  if (a.tolerancia.modo === 'tabela') {
    const r = calcularTabelaTolerancias(a.tolerancia.itens, cicloMedio);
    tolManual = r.total;
    tolDetalhes = r.detalhes;
  } else if (a.tolerancia.modo === 'percentual') {
    tolManual = numero(a.tolerancia.valor) ?? 0;
  } else {
    tolManual = cfg.toleranciaPadrao;
  }
  const paradasAplic = a.paradasIds.map(id => paradas.get(id)).filter(p => p && p.tipo === 'programada');
  const jornadaSeg = cfg.jornadaMin * 60;
  const segParadasJornada = soma(paradasAplic.filter(p => p.freq !== 'ciclo').map(p => numero(p.duracao) || 0));
  const segParadasCiclo = soma(paradasAplic.filter(p => p.freq === 'ciclo').map(p => numero(p.duracao) || 0));
  const tolParadas = segParadasJornada > 0 && segParadasJornada < jornadaSeg ? segParadasJornada / (jornadaSeg - segParadasJornada) : 0;
  const fatorTolerancia = 1 + tolManual + tolParadas;
  const paradasPorUnidade = segParadasCiclo > 0 && somaQ > 0 ? (segParadasCiclo * somaP) / somaQ : 0;

  // Passo 9: tempo padrão
  const tempoPadrao = tempoNormal ? tempoNormal * fatorTolerancia + paradasPorUnidade : null;

  // Tamanho de amostra
  const cn = ciclosNecessarios(validas.map(l => l.u), cfg.confianca, cfg.erroRel);
  const confiabilidade = cn.necessario ? Math.min(1, est.n / cn.necessario) : est.n >= 2 ? 0 : null;

  const prodPessoa = periodos(tempoPadrao, cfg);
  const pessoas = numero(a.pessoas) > 0 ? numero(a.pessoas) : 1;

  const datas = linhas.map(l => l.m.dataHora).filter(Boolean).sort();
  const operadores = new Set(linhas.map(l => l.m.operador).filter(Boolean));

  let saude = 'sem-dados';
  if (est.n >= 1) {
    if (est.n < cfg.minMedicoes || (cn.necessario && est.n < cn.necessario)) saude = 'amostra';
    else if (est.cv != null && est.cv > cfg.cvAtencao) saude = 'instavel';
    else if (est.cv != null && est.cv > cfg.cvBom) saude = 'atencao';
    else saude = 'ok';
  }

  return {
    atividade: a,
    linhas,
    total: linhas.length,
    nValidas: validas.length,
    nExcluidas: linhas.filter(l => l.status === 'excluida').length,
    nNiveladas: linhas.filter(l => l.status === 'nivelada').length,
    nInvalidas: linhas.filter(l => l.status === 'invalida').length,
    limites,
    est,
    tempoTotal: soma(validas.map(l => l.t)),
    cicloMedio,
    qMedia: validas.length ? somaQ / validas.length : null,
    pMedia: validas.length ? somaP / validas.length : null,
    tempoBase,
    ritmo,
    tempoNormal,
    tolManual,
    tolDetalhes,
    tolParadas,
    paradasAplic,
    segParadasJornada,
    segParadasCiclo,
    paradasPorUnidade,
    fatorTolerancia,
    tempoPadrao,
    ciclos: cn,
    confiabilidade,
    amostraOk: cn.necessario != null && est.n >= cn.necessario,
    prodPessoa,
    pessoas,
    prodEquipe: multiplicarPeriodos(prodPessoa, pessoas),
    prodPlanejada: multiplicarPeriodos(prodPessoa, pessoas * cfg.eficienciaMeta),
    primeira: datas[0] || null,
    ultima: datas[datas.length - 1] || null,
    operadores: [...operadores],
    saude,
  };
}

/* ------------------------------------------------------------------ */
/* Agrupamentos (setor, área, empresa)                                 */
/* ------------------------------------------------------------------ */

export function analisarGrupo(analises, config) {
  const cfg = { ...CONFIG_PADRAO, ...(config || {}) };
  const comTP = analises.filter(x => x.tempoPadrao > 0);
  const tpTotal = soma(comTP.map(x => x.tempoPadrao));
  const estacoes = comTP.map(x => ({ analise: x, tc: x.tempoPadrao / x.pessoas }));
  let gargalo = null;
  for (const e of estacoes) if (!gargalo || e.tc > gargalo.tc) gargalo = e;
  const pessoasTotal = soma(comTP.map(x => x.pessoas));
  const medicoes = soma(analises.map(x => x.total));
  const validas = soma(analises.map(x => x.nValidas));
  const cvs = comTP.map(x => x.est.cv).filter(finito);
  const comAmostra = comTP.filter(x => x.amostraOk).length;

  // Somar tempos e falar em gargalo só faz sentido quando todas as atividades medem a mesma unidade
  // (ex.: todas em "volume"). Com unidades diferentes (volume + palete), esses indicadores ficam vazios.
  const unidades = [...new Set(comTP.map(x => String(x.atividade.unidade || '').trim().toLowerCase()))];
  const unidadesMistas = unidades.length > 1;
  const capacidadeFluxo = gargalo && !unidadesMistas ? periodos(gargalo.tc, cfg) : null;
  return {
    nAtividades: analises.length,
    nMedidas: analises.filter(x => x.total > 0).length,
    nComTP: comTP.length,
    medicoes,
    validas,
    unidades,
    unidadesMistas,
    tpTotal: comTP.length && !unidadesMistas ? tpTotal : null,
    tpMedio: comTP.length ? tpTotal / comTP.length : null,
    gargalo: unidadesMistas ? null : gargalo,
    estacoes,
    pessoasTotal,
    capacidadeFluxo,
    capacidadePlanejada: multiplicarPeriodos(capacidadeFluxo, cfg.eficienciaMeta),
    // produtividade de 1 pessoa executando todo o conteúdo de trabalho do grupo
    prodPessoa: comTP.length && !unidadesMistas ? periodos(tpTotal, cfg) : null,
    eficienciaBalanceamento: gargalo && pessoasTotal && !unidadesMistas ? tpTotal / (pessoasTotal * gargalo.tc) : null,
    cvMedio: cvs.length ? soma(cvs) / cvs.length : null,
    coberturaAmostra: comTP.length ? comAmostra / comTP.length : null,
    ultima: analises.map(x => x.ultima).filter(Boolean).sort().pop() || null,
  };
}

/* ------------------------------------------------------------------ */
/* Produtividade individual (por operador)                             */
/* ------------------------------------------------------------------ */

export function analisarOperadores(analises) {
  const mapa = new Map();
  for (const an of analises) {
    if (!(an.tempoNormal > 0)) continue;
    for (const l of an.linhas) {
      if (l.status !== 'valida') continue;
      const nome = (l.m.operador || '').trim() || 'Não informado';
      if (!mapa.has(nome)) mapa.set(nome, { nome, medicoes: 0, atividades: new Map(), padraoSeg: 0, realSeg: 0, unidades: 0, ultima: null });
      const o = mapa.get(nome);
      o.medicoes++;
      o.padraoSeg += an.tempoNormal * l.q; // tempo normal "ganho" (homem-seg)
      o.realSeg += l.t * l.p; // tempo real gasto (homem-seg)
      o.unidades += l.q;
      const at = o.atividades.get(an.atividade.id) || { analise: an, medicoes: 0, padrao: 0, real: 0 };
      at.medicoes++;
      at.padrao += an.tempoNormal * l.q;
      at.real += l.t * l.p;
      o.atividades.set(an.atividade.id, at);
      if (!o.ultima || l.m.dataHora > o.ultima) o.ultima = l.m.dataHora;
    }
  }
  return [...mapa.values()]
    .map(o => ({
      ...o,
      desempenho: o.realSeg > 0 ? o.padraoSeg / o.realSeg : null,
      // unidades por pessoa-hora (comparável apenas dentro da mesma atividade)
      unidadesHora: o.realSeg > 0 ? (o.unidades / o.realSeg) * 3600 : null,
      atividadesLista: [...o.atividades.values()].map(x => ({ ...x, desempenho: x.real > 0 ? x.padrao / x.real : null })),
    }))
    .sort((a, b) => (b.desempenho ?? 0) - (a.desempenho ?? 0));
}

/* ------------------------------------------------------------------ */
/* Fórmulas de planejamento (treinamento — Eficiência e produtividade)  */
/* ------------------------------------------------------------------ */

/** EF% = TP × peças produzidas / (nº pessoas × jornada) */
export function eficiencia(tpSeg, pecas, pessoas, jornadaMin) {
  if (!(tpSeg > 0 && pessoas > 0 && jornadaMin > 0)) return null;
  return (tpSeg * pecas) / (pessoas * jornadaMin * 60);
}

/** Produção = nº pessoas × jornada × EF desejada / TP */
export function producao(tpSeg, pessoas, jornadaMin, ef) {
  if (!(tpSeg > 0)) return null;
  return (pessoas * jornadaMin * 60 * ef) / tpSeg;
}

/** Pessoas necessárias = demanda × TP / (jornada × EF) */
export function pessoasNecessarias(tpSeg, demanda, jornadaMin, ef) {
  if (!(tpSeg > 0 && jornadaMin > 0 && ef > 0)) return null;
  return (demanda * tpSeg) / (jornadaMin * 60 * ef);
}

export const ROTULO_PERIODO = {
  minuto: 'por minuto',
  hora: 'por hora',
  dia: 'por dia',
  semana: 'por semana',
  mes: 'por mês',
  ano: 'por ano',
};

export const ROTULO_SAUDE = {
  ok: { rotulo: 'Confiável', classe: 'good', icone: 'seal-check' },
  atencao: { rotulo: 'Variação moderada', classe: 'warning', icone: 'warning' },
  instavel: { rotulo: 'Instável', classe: 'critical', icone: 'warning-octagon' },
  amostra: { rotulo: 'Amostra pequena', classe: 'serious', icone: 'hourglass-medium' },
  'sem-dados': { rotulo: 'Sem medições', classe: 'muted', icone: 'circle-dashed' },
};
