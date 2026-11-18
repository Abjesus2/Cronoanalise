// Importação do sistema antigo (Google Planilhas / Apps Script).
// Os IDs antigos são preservados com prefixo "leg-", então importar de novo
// atualiza os mesmos registros em vez de duplicar.
import { store } from './store.js';
import { ATIVIDADE_PADRAO } from './calc.js';
import { lerTempo } from './time.js';
import { paraISO, semAcento, uid, numero, agoraISO } from './util.js';

export const URL_SISTEMA_ANTIGO = 'https://script.google.com/macros/s/AKfycbwauIAhMV2qyZNrPeJRlCe6twvhdH3rfLGuMLtdgzo4CZUE_zgiAt_1hd1r_0GYIWJ6pA/exec';

const NOMES_PESSOAS = new Set(['qtdpessoas', 'quantidadepessoas', 'quantidadedepessoas', 'pessoas', 'numpessoas', 'numeropessoas', 'numerodepessoas', 'nºpessoas', 'qtddepessoas']);

async function buscarJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Lê os dados do Apps Script antigo. */
export async function lerSistemaAntigo(url = URL_SISTEMA_ANTIGO) {
  const id = Date.now();
  try {
    const d = await buscarJSON(`${url}?action=getFreshData&requestId=${id}&_=${id}`);
    if (d && (d.areas || d.analises || d.contagens)) return d;
  } catch (e) {
    console.warn('Pacote consolidado indisponível; lendo abas separadas.', e);
  }
  const acoes = { areas: 'getAreas', setores: 'getSetores', analises: 'getAnalises', contagens: 'getContagens', paradas: 'getParadasCadastradas' };
  const dados = {};
  for (const [k, acao] of Object.entries(acoes)) {
    const r = await buscarJSON(`${url}?action=${acao}&_=${id}`);
    dados[k] = Array.isArray(r) ? r : r?.data || r?.[k] || [];
  }
  return dados;
}

function decodificarObs(bruto) {
  if (!bruto) return { classif: '', obs: '' };
  const m = String(bruto).match(/^\[(.*?)\]\s?([\s\S]*)$/);
  if (m) return { classif: m[1] === 'Operação Normal' ? '' : m[1], obs: m[2] };
  return { classif: '', obs: String(bruto) };
}

/** Converte o pacote antigo para o novo modelo e grava. Retorna um resumo. */
export function importarDadosAntigos(d) {
  const lista = v => (Array.isArray(v) ? v : []);
  const resumo = { areas: 0, setores: 0, atividades: 0, medicoes: 0, paradas: 0, motivos: 0, avisos: [] };
  const agora = agoraISO();

  // Paradas
  const paradas = [];
  const paradaPorNome = new Map();
  for (const p of lista(d.paradas)) {
    if (!p.ID_Parada && !p.Nome) continue;
    const tipo = String(p.Tipo || '').toLowerCase() === 'programada' ? 'programada' : 'motivo';
    const ent = {
      id: `leg-p-${p.ID_Parada || semAcento(p.Nome)}`,
      nome: String(p.Nome || '').trim(),
      tipo,
      duracao: tipo === 'programada' ? lerTempo(p.Tempo_Formatado) : null,
      freq: tipo === 'programada' ? 'ciclo' : null, // o sistema antigo somava a parada a cada ciclo
      excluiCalculo: false,
      criadoEm: paraISO(p.Data_Criacao) || agora,
      legado: true,
    };
    paradas.push(ent);
    paradaPorNome.set(semAcento(ent.nome) + ':' + tipo, ent);
    tipo === 'programada' ? resumo.paradas++ : resumo.motivos++;
  }

  // Áreas
  const areas = new Map();
  for (const a of lista(d.areas)) {
    if (!a.Nome) continue;
    const ent = { id: `leg-a-${a.ID_Area || semAcento(a.Nome)}`, nome: String(a.Nome).trim(), seq: numero(a.Sequencia), criadoEm: paraISO(a.Data_Criacao) || agora, legado: true };
    areas.set(ent.id, ent);
  }
  const areaPorNome = nome => {
    const chave = semAcento(nome);
    let a = [...areas.values()].find(x => semAcento(x.nome) === chave);
    if (!a && nome) {
      a = { id: `leg-a-${chave.replace(/\s+/g, '-')}`, nome: String(nome).trim(), seq: null, criadoEm: agora, legado: true };
      areas.set(a.id, a);
    }
    return a;
  };

  // Setores
  const setores = new Map();
  for (const s of lista(d.setores)) {
    if (!s.Nome) continue;
    const areaId = s.ID_Area ? `leg-a-${s.ID_Area}` : null;
    const ent = { id: `leg-s-${s.ID_Setor || semAcento(s.Nome)}`, areaId, nome: String(s.Nome).trim(), seq: numero(s.Sequencia), criadoEm: paraISO(s.Data_Criacao) || agora, legado: true };
    setores.set(ent.id, ent);
  }
  const setorPorNome = (areaId, nome) => {
    const chave = semAcento(nome);
    let s = [...setores.values()].find(x => x.areaId === areaId && semAcento(x.nome) === chave);
    if (!s && nome) {
      s = { id: `leg-s-${areaId}-${chave.replace(/\s+/g, '-')}`, areaId, nome: String(nome).trim(), seq: null, criadoEm: agora, legado: true };
      setores.set(s.id, s);
    }
    return s;
  };

  // Atividades
  const atividades = [];
  const atividadePorIdAntigo = new Map();
  for (const an of lista(d.analises)) {
    if (!an.ID_Analise) continue;
    const area = areaPorNome(an.Area || 'Sem área');
    const setor = setorPorNome(area.id, an.Setor || 'Sem setor');
    if (an.Sequencia_Area && area.seq == null) area.seq = numero(an.Sequencia_Area);
    if (an.Sequencia_Setor && setor.seq == null) setor.seq = numero(an.Sequencia_Setor);
    const parametros = [];
    let campoPessoasId = null;
    for (let i = 1; i <= 8; i++) {
      const nome = String(an[`Campo_${i}_Nome`] || '').trim();
      if (!nome) continue;
      const tipo = String(an[`Campo_${i}_Tipo`] || '').toLowerCase().startsWith('num') ? 'numero' : 'texto';
      parametros.push({ id: `c${i}`, nome, tipo, fixo: false });
      if (NOMES_PESSOAS.has(semAcento(nome).replace(/[^a-z0-9º]/g, ''))) campoPessoasId = `c${i}`;
    }
    const idxRitmo = numero(an.Campo_Ritmo);
    const campoQtdId = idxRitmo && parametros.some(p => p.id === `c${idxRitmo}`) ? `c${idxRitmo}` : null;
    if (campoQtdId) {
      const p = parametros.find(x => x.id === campoQtdId);
      p.tipo = 'numero';
    }
    if (campoPessoasId === campoQtdId) campoPessoasId = null;
    const paradasIds = String(an.Paradas_Aplicaveis || '')
      .split(',')
      .map(n => paradaPorNome.get(semAcento(n) + ':programada')?.id)
      .filter(Boolean);
    const ent = {
      ...ATIVIDADE_PADRAO,
      id: `leg-at-${an.ID_Analise}`,
      setorId: setor.id,
      nome: String(an.Atividade || 'Atividade').trim(),
      seq: numero(an.Sequencia_Atividade),
      descricao: an.Descricao_Atividade || '',
      criterios: an.Criterios_Medicao || '',
      consideracoes: an.Consideracoes_Atividade || '',
      parametros,
      campoQtdId,
      campoPessoasId,
      paradasIds,
      // preserva o resultado do sistema antigo: sem ritmo e sem tolerância adicional
      ritmo: { modo: 'percentual', valor: 1, hab: 'D', esf: 'D' },
      tolerancia: { modo: 'percentual', valor: 0, itens: { pessoais: 'homem', monotonia: 'auto' } },
      criadoEm: paraISO(an.Data_Criacao) || agora,
      legado: true,
    };
    atividades.push(ent);
    atividadePorIdAntigo.set(String(an.ID_Analise), ent);
  }

  // Medições
  const medicoes = [];
  let semAtividade = 0;
  let semTempo = 0;
  for (const c of lista(d.contagens)) {
    const at = atividadePorIdAntigo.get(String(c.ID_Analise));
    if (!at) {
      semAtividade++;
      continue;
    }
    const tempo = lerTempo(c.Tempo_Total);
    if (!(tempo > 0)) semTempo++;
    const { classif, obs } = decodificarObs(c.Observacoes);
    let motivoId = null;
    if (classif) {
      let motivo = paradaPorNome.get(semAcento(classif) + ':motivo');
      if (!motivo) {
        motivo = { id: `leg-p-${semAcento(classif).replace(/\s+/g, '-')}`, nome: classif, tipo: 'motivo', excluiCalculo: false, criadoEm: agora, legado: true };
        paradas.push(motivo);
        paradaPorNome.set(semAcento(classif) + ':motivo', motivo);
        resumo.motivos++;
      }
      motivoId = motivo.id;
    }
    const valores = {};
    for (let i = 1; i <= 8; i++) {
      const v = c[`Campo_${i}_Valor`];
      if (v !== undefined && v !== null && v !== '') valores[`c${i}`] = String(v);
    }
    medicoes.push({
      id: `leg-m-${c.ID_Contagem || uid()}`,
      atividadeId: at.id,
      dataHora: paraISO(c.Data_Hora) || agora,
      tempo: tempo ?? 0,
      valores,
      operador: '',
      cronometrista: '',
      motivoId,
      observacao: obs || '',
      ritmo: null,
      nivel: 'auto',
      origem: 'importado',
      criadoEm: paraISO(c.Data_Hora) || agora,
      legado: true,
    });
  }

  const comDatas = (col, itens) => itens.map(i => ({ ...i, modificadoEm: agora, modificadoPor: 'Importação' }));
  store.importarItens('paradas', comDatas('paradas', paradas));
  store.importarItens('areas', comDatas('areas', [...areas.values()]));
  store.importarItens('setores', comDatas('setores', [...setores.values()]));
  store.importarItens('atividades', comDatas('atividades', atividades));
  store.importarItens('medicoes', comDatas('medicoes', medicoes));
  resumo.areas = areas.size;
  resumo.setores = setores.size;
  resumo.atividades = atividades.length;
  resumo.medicoes = medicoes.length;
  if (semAtividade) resumo.avisos.push(`${semAtividade} medição(ões) sem atividade correspondente foram ignoradas.`);
  if (semTempo) resumo.avisos.push(`${semTempo} medição(ões) sem tempo válido (aparecem como incompletas).`);
  store.registrarHistorico('importou', 'config', [], `do sistema antigo (${resumo.atividades} atividades, ${resumo.medicoes} medições)`);
  return resumo;
}


/* ======================================================================
   Importação da planilha Excel exportada pelo sistema antigo
   (abas "Medições" e "Descrição Atividades").
   ====================================================================== */
const COL_TEMPO_SEG = /tempo cronometrado.*segundos/i;
const COL_UNID_SEG = /tempo por unidade.*segundos/i;
const COL_TEMPO_TXT = /^tempo cronometrado/i;

function slug(t) {
  return semAcento(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
}

/** "Qtd Volumes" → "volume", "Qtd Peças" → "peça", "Qtd Itens" → "item". */
export function unidadeDoCampo(nome) {
  let t = String(nome || '').replace(/^(qtd\.?|quantidade( de)?|n[ºo°]\.?( de)?)\s*/i, '').trim().toLowerCase();
  if (!t) return 'unidade';
  const especiais = { itens: 'item', 'posições': 'posição', posicoes: 'posição', 'peças': 'peça', notas: 'nota', 'paletes': 'palete', 'pallets': 'pallet' };
  if (especiais[t]) return especiais[t];
  if (t.endsWith('ões')) return t.slice(0, -3) + 'ão';
  if (t.endsWith('is') && t.length > 4) return t.slice(0, -2) + 'l';
  if (t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

function hashCurto(texto) {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Lê o arquivo .xlsx exportado pelo sistema antigo e grava no novo modelo. */
export async function importarPlanilhaAntiga(arquivo, XLSX) {
  const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
  const abaMed = wb.SheetNames.find(n => /^medi[cç][oõ]es$/i.test(semAcento(n).replace('c', 'c'))) || wb.SheetNames.find(n => semAcento(n).startsWith('medicoes') && !/convert/i.test(n)) || wb.SheetNames[0];
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[abaMed], { defval: '', raw: true });
  if (!linhas.length) throw new Error('A aba de medições está vazia.');
  const cab = Object.keys(linhas[0]);
  const colTempoSeg = cab.find(c => COL_TEMPO_SEG.test(c));
  const colUnidSeg = cab.find(c => COL_UNID_SEG.test(c));
  const colTempoTxt = cab.find(c => COL_TEMPO_TXT.test(c) && c !== colTempoSeg);
  const iIni = cab.findIndex(c => /^ritmo/i.test(c));
  const iFim = cab.findIndex(c => /^anomalia/i.test(c));
  if (!['Área', 'Setor', 'Atividade'].every(c => cab.includes(c)) || iFim < 0) {
    throw new Error('Formato não reconhecido. Use a planilha exportada pelo sistema antigo (aba "Medições").');
  }
  const colParams = cab.slice(iIni + 1, iFim);

  // descrições
  const descricoes = new Map();
  const abaDesc = wb.SheetNames.find(n => /descri/i.test(n));
  if (abaDesc) {
    for (const d of XLSX.utils.sheet_to_json(wb.Sheets[abaDesc], { defval: '', raw: false })) {
      const chave = [d['Área'], d['Setor'], d['Atividade']].map(slug).join('|');
      const k = Object.keys(d);
      descricoes.set(chave, {
        descricao: d[k.find(x => /o que/i.test(x))] || '',
        criterios: d[k.find(x => /crit[eé]rio/i.test(x))] || '',
        consideracoes: d[k.find(x => /considera/i.test(x))] || '',
      });
    }
  }

  // agrupa por atividade
  const grupos = new Map();
  for (const l of linhas) {
    if (!l['Atividade']) continue;
    const chave = [l['Área'], l['Setor'], l['Atividade']].map(slug).join('|');
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(l);
  }

  const agora = agoraISO();
  const resumo = { areas: 0, setores: 0, atividades: 0, medicoes: 0, paradas: 0, motivos: 0, avisos: [], duplicadas: 0 };
  const areas = new Map(store.areas().map(a => [slug(a.nome), { ...a }]));
  const setores = new Map(store.setores().map(s => [s.areaId + '|' + slug(s.nome), { ...s }]));
  const motivos = new Map(store.paradas('motivo').map(m => [slug(m.nome), m]));
  const novasAreas = new Map();
  const novosSetores = new Map();
  const novasAtividades = [];
  const novasMedicoes = [];
  const novosMotivos = [];

  for (const [chave, ls] of grupos) {
    const l0 = ls[0];
    const cls = String(l0['Classificação'] || '').split('.').map(numero);
    // área
    let area = areas.get(slug(l0['Área']));
    if (!area) {
      area = { id: `xl-a-${slug(l0['Área'])}`, nome: String(l0['Área']).trim(), seq: cls[0] ?? null, criadoEm: agora, legado: true };
      areas.set(slug(area.nome), area);
      novasAreas.set(area.id, area);
    }
    // setor
    const chaveSetor = area.id + '|' + slug(l0['Setor']);
    let setor = setores.get(chaveSetor);
    if (!setor) {
      setor = { id: `xl-s-${slug(l0['Área'])}-${slug(l0['Setor'])}`, areaId: area.id, nome: String(l0['Setor']).trim(), seq: cls[1] ?? null, criadoEm: agora, legado: true };
      setores.set(chaveSetor, setor);
      novosSetores.set(setor.id, setor);
    }
    // parâmetros usados por esta atividade
    const usados = colParams.filter(c => ls.some(l => l[c] !== '' && l[c] != null));
    const parametros = usados.map(c => {
      const vals = ls.map(l => l[c]).filter(v => v !== '' && v != null);
      const numericos = vals.every(v => numero(v) != null);
      const distintos = [...new Set(vals.map(v => String(v).trim()))];
      return {
        id: 'c-' + slug(c),
        nome: c,
        tipo: numericos ? 'numero' : distintos.length <= 8 ? 'lista' : 'texto',
        opcoes: !numericos && distintos.length <= 8 ? distintos : undefined,
        fixo: NOMES_PESSOAS.has(semAcento(c).replace(/[^a-z0-9º]/g, '')),
      };
    });
    const pPessoas = parametros.find(p => p.fixo && p.tipo === 'numero');
    if (pPessoas) pPessoas.fixo = true;
    // descobre a quantidade-base reproduzindo o "tempo por unidade" exportado
    const tempoDe = l => (colTempoSeg ? numero(l[colTempoSeg]) : lerTempo(l[colTempoTxt]));
    let base = null;
    let melhor = 0;
    for (const p of parametros.filter(x => x.tipo === 'numero' && x !== pPessoas)) {
      let ok = 0;
      for (const l of ls) {
        const t = tempoDe(l);
        const u = numero(l[colUnidSeg]);
        const q = numero(l[p.nome]);
        const pes = pPessoas ? numero(l[pPessoas.nome]) || 1 : 1;
        if (t > 0 && u > 0 && q > 0 && Math.abs((t * pes) / q - u) / u < 0.01) ok++;
      }
      if (ok / ls.length > melhor) {
        melhor = ok / ls.length;
        base = p;
      }
    }
    if (melhor < 0.5) base = null;
    const desc = descricoes.get(chave) || {};
    const existente = store.atividades(setor.id).find(a => slug(a.nome) === slug(l0['Atividade']));
    const atividade = existente || {
      ...ATIVIDADE_PADRAO,
      id: `xl-at-${chave.replace(/\|/g, '-')}`,
      setorId: setor.id,
      nome: String(l0['Atividade']).trim(),
      seq: cls[2] ?? null,
      unidade: base ? unidadeDoCampo(base.nome) : 'ciclo',
      parametros,
      campoQtdId: base?.id || null,
      campoPessoasId: pPessoas?.id || null,
      descricao: desc.descricao || '',
      criterios: desc.criterios || '',
      consideracoes: desc.consideracoes || '',
      ritmo: { modo: 'percentual', valor: 1, hab: 'D', esf: 'D' },
      tolerancia: { modo: 'percentual', valor: 0, itens: { pessoais: 'homem', monotonia: 'auto' } },
      criadoEm: agora,
      legado: true,
    };
    if (!existente) novasAtividades.push(atividade);
    const mapaParam = new Map((atividade.parametros || []).map(p => [semAcento(p.nome), p.id]));
    const jaExistem = new Set(store.medicoes(atividade.id).map(m => `${(m.dataHora || '').slice(0, 19)}|${Math.round((m.tempo || 0) * 10)}`));

    for (const l of ls) {
      const tempo = tempoDe(l);
      const dataHora = paraISO(l['Data/Hora']) || agora;
      const assinatura = `${dataHora.slice(0, 19)}|${Math.round((tempo || 0) * 10)}`;
      if (jaExistem.has(assinatura)) {
        resumo.duplicadas++;
        continue;
      }
      jaExistem.add(assinatura);
      const valores = {};
      for (const c of usados) {
        const id = mapaParam.get(semAcento(c));
        if (id && l[c] !== '' && l[c] != null) valores[id] = String(l[c]);
      }
      const anom = String(l['Anomalia'] || '').trim();
      let motivoId = null;
      if (anom && !/^opera[cç][aã]o normal$/i.test(anom)) {
        let m = motivos.get(slug(anom));
        if (!m) {
          m = { id: `xl-p-${slug(anom)}`, nome: anom, tipo: 'motivo', excluiCalculo: false, criadoEm: agora, legado: true };
          motivos.set(slug(anom), m);
          novosMotivos.push(m);
        }
        motivoId = m.id;
      }
      novasMedicoes.push({
        id: `xl-m-${hashCurto(atividade.id + assinatura + (l['Observações'] || ''))}`,
        atividadeId: atividade.id,
        dataHora,
        tempo: tempo ?? 0,
        valores,
        operador: '',
        cronometrista: '',
        motivoId,
        observacao: String(l['Observações'] || ''),
        ritmo: null,
        nivel: 'auto',
        origem: 'importado',
        criadoEm: dataHora,
        legado: true,
      });
    }
    if (!base && !existente) resumo.avisos.push(`"${atividade.nome}": não foi possível identificar a quantidade-base; ficou 1 por medição (ajuste em Método e cálculo).`);
  }

  const comDatas = itens => itens.map(i => ({ ...i, modificadoEm: agora, modificadoPor: 'Importação' }));
  store.importarItens('paradas', comDatas(novosMotivos));
  store.importarItens('areas', comDatas([...novasAreas.values()]));
  store.importarItens('setores', comDatas([...novosSetores.values()]));
  store.importarItens('atividades', comDatas(novasAtividades));
  store.importarItens('medicoes', comDatas(novasMedicoes));
  resumo.areas = novasAreas.size;
  resumo.setores = novosSetores.size;
  resumo.atividades = novasAtividades.length;
  resumo.medicoes = novasMedicoes.length;
  resumo.motivos = novosMotivos.length;
  if (resumo.duplicadas) resumo.avisos.unshift(`${resumo.duplicadas} medição(ões) já existiam e não foram duplicadas.`);
  if (resumo.avisos.length > 8) resumo.avisos = [...resumo.avisos.slice(0, 8), `… e mais ${resumo.avisos.length - 8} aviso(s).`];
  store.registrarHistorico('importou', 'config', [], `planilha do sistema antigo (${resumo.atividades} atividades, ${resumo.medicoes} medições)`);
  return resumo;
}
