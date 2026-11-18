// Dados de exemplo (fictícios) para conhecer o sistema — um centro de distribuição.
// Todos os registros ficam marcados com exemplo: true e podem ser removidos de uma vez.
import { store } from './store.js';
import { ATIVIDADE_PADRAO } from './calc.js';
import { uid } from './util.js';

function aleatorio(semente) {
  let a = semente >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function carregarExemplo() {
  const r = aleatorio(20261118);
  const normal = (m, s) => {
    const u = 1 - r();
    const v = r();
    return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const inteiro = (a, b) => Math.round(a + r() * (b - a));
  const ex = { exemplo: true };

  const cafe = { id: uid(), nome: 'Café', tipo: 'programada', duracao: 600, freq: 'jornada', ...ex };
  const ginastica = { id: uid(), nome: 'Ginástica laboral', tipo: 'programada', duracao: 600, freq: 'jornada', ...ex };
  const falta = { id: uid(), nome: 'Falta de material', tipo: 'motivo', excluiCalculo: true, ...ex };
  const equipamento = { id: uid(), nome: 'Equipamento parado', tipo: 'motivo', excluiCalculo: true, ...ex };
  const internet = { id: uid(), nome: 'Conexão de internet', tipo: 'motivo', excluiCalculo: false, ...ex };
  store.salvarVarios('paradas', [cafe, ginastica, falta, equipamento, internet], { rotulo: 'dados de exemplo (paradas e motivos)' });

  const area = store.salvar('areas', { nome: 'CD Exemplo', seq: (store.areas().length || 0) + 1, descricao: 'Centro de distribuição fictício para conhecer o sistema. Exclua quando quiser.', ...ex }, { registrarHistorico: false });
  const setores = ['Recebimento', 'Armazenagem', 'Separação', 'Embalagem e Expedição'].map((nome, i) =>
    store.salvar('setores', { nome, areaId: area.id, seq: i + 1, ...ex }, { registrarHistorico: false }),
  );

  const operadores = ['Operador A', 'Operador B', 'Operador C', 'Operador D', 'Operador E'];
  // u = homem-segundos por unidade; qtd = faixa por medição; equipe = faixa de pessoas
  const defs = [
    { setor: 0, nome: 'Descarregar carreta', unidade: 'volume', campoQtd: 'Qtd Volumes', u: 40, cv: 0.22, qtd: [15, 180], equipe: [4, 10], extras: [{ nome: 'Qtd Paletes', tipo: 'numero', gerar: q => Math.max(1, Math.round(q / 18)) }], n: 18, pessoasAlocadas: 8,
      descricao: 'Retirar os volumes da carreta e montar os paletes na doca.', criterios: 'Início ao abrir o baú; fim ao posicionar o último palete na doca. Informe volumes, pessoas e paletes.' },
    { setor: 0, nome: 'Identificar paletes', unidade: 'volume', campoQtd: 'Qtd Volumes', u: 1.6, cv: 0.2, qtd: [20, 36], n: 16, pessoasAlocadas: 1,
      descricao: 'Conferir e etiquetar os paletes recebidos.', criterios: 'Início ao pegar a primeira etiqueta; fim ao liberar o palete.' },
    { setor: 1, nome: 'Armazenar paletes', unidade: 'palete', campoQtd: 'Qtd Paletes', u: 96, cv: 0.15, qtd: [1, 2], extras: [{ nome: 'Altura da posição', tipo: 'lista', opcoes: ['Nível 1', 'Nível 2', 'Nível 3', 'Nível 4'], gerar: () => `Nível ${inteiro(1, 4)}` }], n: 12, pessoasAlocadas: 2,
      descricao: 'Levar o palete da doca até a posição de armazenagem com a empilhadeira.', criterios: 'Início ao pegar o palete; fim ao confirmar o endereço no coletor.' },
    { setor: 2, nome: 'Separar pedidos (picking)', unidade: 'peça', campoQtd: 'Qtd Peças', u: 6.5, cv: 0.28, qtd: [3, 30], extras: [{ nome: 'Qtd Corredores', tipo: 'numero', gerar: q => Math.max(1, Math.round(q / 8)) }, { nome: 'Qtd Posições', tipo: 'numero', gerar: q => Math.max(1, Math.round(q * 0.7)) }], n: 24, pessoasAlocadas: 6,
      descricao: 'Coletar as peças do pedido nas posições de picking.', criterios: 'Início ao consultar a primeira posição; fim ao depositar a última peça no carrinho.' },
    { setor: 3, nome: 'Embalar itens', unidade: 'item', campoQtd: 'Qtd Itens', u: 21, cv: 0.2, qtd: [1, 5], extras: [{ nome: 'Tipo de embalagem', tipo: 'lista', opcoes: ['Caixa P', 'Caixa M', 'Envelope', 'Flyer'], gerar: () => ['Caixa P', 'Caixa M', 'Envelope', 'Flyer'][inteiro(0, 3)] }], n: 22, pessoasAlocadas: 3,
      descricao: 'Embalar os itens do pedido e fechar o volume.', criterios: 'Início ao bipar o primeiro item; fim ao fechar a caixa.' },
    { setor: 3, nome: 'Etiquetar volumes', unidade: 'volume', campoQtd: 'Qtd Volumes', u: 4.5, cv: 0.18, qtd: [5, 40], n: 9, pessoasAlocadas: 1,
      descricao: 'Imprimir e colar a etiqueta de expedição.', criterios: 'Início ao pegar o leitor; fim ao colar a última etiqueta.' },
  ];

  const agora = Date.now();
  const medicoes = [];
  defs.forEach((d, i) => {
    const qtdId = uid();
    const pesId = d.equipe ? uid() : null;
    const parametros = [{ id: qtdId, nome: d.campoQtd, tipo: 'numero' }];
    if (pesId) parametros.push({ id: pesId, nome: 'Qtd Pessoas', tipo: 'numero', fixo: true });
    const extras = (d.extras || []).map(x => ({ ...x, id: uid() }));
    for (const x of extras) parametros.push({ id: x.id, nome: x.nome, tipo: x.tipo, opcoes: x.opcoes });
    const at = store.salvar('atividades', {
      ...ATIVIDADE_PADRAO,
      nome: d.nome,
      setorId: setores[d.setor].id,
      seq: store.atividades(setores[d.setor].id).length + 1,
      unidade: d.unidade,
      campoQtdId: qtdId,
      campoPessoasId: pesId,
      parametros,
      pessoas: d.pessoasAlocadas,
      ritmo: i === 3 ? { modo: 'westinghouse', valor: 1, hab: 'C1', esf: 'D' } : { modo: 'percentual', valor: 1 },
      tolerancia: i % 2 ? { modo: 'padrao', valor: 0.1, itens: {} } : { modo: 'tabela', valor: 0.1, itens: { pessoais: 'homem', fisico: i === 0 ? 'pesado' : 'leve', mental: 'pouca', conforto: 'leve', monotonia: 'auto' } },
      paradasIds: [cafe.id, ginastica.id],
      descricao: d.descricao,
      criterios: d.criterios,
      ...ex,
    }, { registrarHistorico: false });

    for (let k = 0; k < d.n; k++) {
      const q = inteiro(d.qtd[0], d.qtd[1]);
      const p = d.equipe ? inteiro(d.equipe[0], d.equipe[1]) : 1;
      let u = Math.max(d.u * 0.45, normal(d.u, d.u * d.cv));
      let motivoId = null;
      if (k === 5) { u *= 2.1; motivoId = falta.id; }
      if (k === 11 && d.n > 12) u *= 1.7;
      if (k === 8 && r() > 0.6) motivoId = internet.id;
      const t = Math.round(((u * q) / p) * 10) / 10;
      const valores = { [qtdId]: String(q) };
      if (pesId) valores[pesId] = String(p);
      for (const x of extras) valores[x.id] = String(x.gerar(q));
      medicoes.push({
        id: uid(),
        atividadeId: at.id,
        dataHora: new Date(agora - (d.n - k) * 3600_000 * (3 + r() * 14)).toISOString(),
        tempo: t,
        valores,
        operador: operadores[inteiro(0, operadores.length - 1)],
        cronometrista: 'Cronometrista Exemplo',
        motivoId,
        observacao: motivoId === falta.id ? 'Aguardou abastecimento.' : '',
        nivel: 'auto',
        origem: 'cronometro',
        ...ex,
      });
    }
  });
  store.salvarVarios('medicoes', medicoes, { rotulo: 'dados de exemplo carregados' });
  return area;
}

export function temExemplo() {
  return store.areas().some(a => a.exemplo);
}

export function removerExemplo() {
  const areas = store.areas().filter(a => a.exemplo).map(a => a.id);
  if (areas.length) store.excluirCascata('areas', areas);
  const paradas = store.paradas().filter(p => p.exemplo).map(p => p.id);
  if (paradas.length) store.excluir('paradas', paradas);
}
