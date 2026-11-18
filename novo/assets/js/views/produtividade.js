// Análises de produtividade: individual e agrupada.
import { html, nothing } from '../lib.js';
import { store } from '../core/store.js';
import { contexto, atividadesDoEscopo } from '../core/consultas.js';
import { analisarAtividade, analisarGrupo, analisarOperadores, ROTULO_PERIODO, ROTULO_SAUDE, eficiencia, producao, pessoasNecessarias } from '../core/calc.js';
import { fmtTempo } from '../core/time.js';
import { fmtQtd, fmtPct, fmtNum, fmtData, tempoRelativo, ordenarPor, numero, agruparPor } from '../core/util.js';
import { ic, num, seloSaude, vazio, ajuda, estat } from '../ui/ui.js';
import { cabecalho } from '../ui/layout.js';
import { barrasH, cartaoGrafico, graficoLinha, barraSegmentada, tabelaSimples } from '../ui/charts.js';
import { atualizar, definirQuery, ir } from '../ui/nav.js';
import { exportarPlanilha } from '../core/exportar.js';
import { avisoUnidadesMistas } from './estrutura.js';

const ui = {
  periodo: 'hora',
  base: 'pessoa',
  ordem: { campo: 'prod', desc: true },
  plan: { setorId: '', demanda: 500, jornada: null, ef: null },
  ef: { atividadeId: '', tpMin: '', pecas: 500, pessoas: 28, jornada: 505 },
  prod: { atividadeId: '', tpMin: '', pessoas: 26, jornada: 505, ef: 86 },
};
const PERIODOS = ['minuto', 'hora', 'dia', 'semana', 'mes', 'ano'];

/* ------------------------------ filtros ------------------------------ */
function lerFiltros(query) {
  return {
    areaId: query.area || '',
    setorId: query.setor || '',
    operador: query.operador || '',
    dias: query.dias || '',
  };
}

function analisesFiltradas(f) {
  return store.memo('prodf:' + JSON.stringify(f), () => {
    const escopo = f.setorId ? { setorId: f.setorId } : f.areaId ? { areaId: f.areaId } : {};
    const limite = f.dias ? Date.now() - Number(f.dias) * 86400000 : null;
    return atividadesDoEscopo(escopo).map(a => {
      let meds = store.medicoes(a.id);
      if (limite) meds = meds.filter(m => m.dataHora && new Date(m.dataHora).getTime() >= limite);
      if (f.operador) meds = meds.filter(m => (m.operador || '').trim() === f.operador);
      return analisarAtividade(a, meds, contexto());
    });
  });
}

function barraFiltros(f) {
  const setores = f.areaId ? store.setores(f.areaId) : store.setores();
  return html`<div class="ferramentas cartao plano" style="padding:12px;gap:10px">
    ${ic('funnel-simple')}
    <select class="entrada" style="width:auto;max-width:220px" aria-label="Área" @change=${e => definirQuery({ area: e.target.value, setor: '' })}>
      <option value="">Todas as áreas</option>${store.areas().map(a => html`<option value=${a.id} ?selected=${a.id === f.areaId}>${a.nome}</option>`)}
    </select>
    <select class="entrada" style="width:auto;max-width:220px" aria-label="Setor" @change=${e => definirQuery({ setor: e.target.value })}>
      <option value="">Todos os setores</option>${setores.map(s => html`<option value=${s.id} ?selected=${s.id === f.setorId}>${s.nome}</option>`)}
    </select>
    <select class="entrada" style="width:auto" aria-label="Período das medições" @change=${e => definirQuery({ dias: e.target.value })}>
      ${[['', 'Todo o período'], ['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias'], ['365', 'Último ano']].map(([v, r]) => html`<option value=${v} ?selected=${f.dias === v}>${r}</option>`)}
    </select>
    <select class="entrada" style="width:auto;max-width:220px" aria-label="Operador" @change=${e => definirQuery({ operador: e.target.value })}>
      <option value="">Todos os operadores</option>${store.operadoresConhecidos().map(o => html`<option ?selected=${o === f.operador}>${o}</option>`)}
    </select>
    ${f.areaId || f.setorId || f.operador || f.dias ? html`<button class="btn fantasma pequeno" @click=${() => definirQuery({ area: '', setor: '', operador: '', dias: '' })}>${ic('x')} Limpar filtros</button>` : nothing}
  </div>`;
}

function seletorUnidade() {
  const cfg = store.config();
  return html`<div class="row wrap">
    <div class="segmentado" role="group" aria-label="Período">${PERIODOS.map(p => html`<button aria-pressed=${ui.periodo === p} @click=${() => { ui.periodo = p; atualizar(); }}>${ROTULO_PERIODO[p].replace('por ', '')}</button>`)}</div>
    <div class="segmentado" role="group" aria-label="Base">
      <button aria-pressed=${ui.base === 'pessoa'} @click=${() => { ui.base = 'pessoa'; atualizar(); }}>Por pessoa</button>
      <button aria-pressed=${ui.base === 'equipe'} @click=${() => { ui.base = 'equipe'; atualizar(); }}>Equipe</button>
      <button aria-pressed=${ui.base === 'planejada'} @click=${() => { ui.base = 'planejada'; atualizar(); }}>Planejada ${fmtPct(cfg.eficienciaMeta, 0)}</button>
    </div>
    ${ajuda('produtividade')}
  </div>`;
}

const prodDe = an => (ui.base === 'equipe' ? an.prodEquipe : ui.base === 'planejada' ? an.prodPlanejada : an.prodPessoa)?.[ui.periodo];

/* ------------------------------ visão geral ------------------------------ */
function abaVisao(ans, f) {
  const comTP = ans.filter(a => a.tempoPadrao > 0);
  const g = analisarGrupo(ans, store.config());
  const medicoes = ans.flatMap(a => a.linhas.map(l => l.m));
  const porDia = agruparPor(medicoes.filter(m => m.dataHora), m => m.dataHora.slice(0, 10));
  const serie = [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, arr]) => ({ rotulo: fmtData(d + 'T12:00:00').slice(0, 5), v: arr.length, dica: fmtData(d + 'T12:00:00') }));
  const saude = agruparPor(ans.filter(a => a.total), a => a.saude);
  const cores = { ok: 'var(--good)', atencao: 'var(--warning)', instavel: 'var(--critical)', amostra: 'var(--serious)' };
  const partes = ['ok', 'atencao', 'amostra', 'instavel'].map(k => ({ rotulo: ROTULO_SAUDE[k].rotulo, v: saude.get(k)?.length || 0, cor: cores[k], tinta: k === 'atencao' ? '#0b0b0b' : '#fff', texto: String(saude.get(k)?.length || 0) }));
  const ranking = ordenarPor(comTP, a => -(prodDe(a) ?? 0)).slice(0, 15).map(a => ({
    rotulo: a.atividade.nome,
    sub: store.obter('setores', a.atividade.setorId)?.nome,
    valor: prodDe(a),
    texto: `${fmtQtd(prodDe(a))} ${a.atividade.unidade}`,
    href: `#/atividade/${a.atividade.id}`,
    dica: `Tempo padrão ${fmtTempo(a.tempoPadrao)}\n${a.nValidas} medições válidas`,
  }));
  const operadores = new Set(medicoes.map(m => m.operador).filter(Boolean)).size;
  return html`<div class="stack loose">
    <section class="cartao">
      <div class="grade g4">
        ${estat('Atividades com tempo padrão', html`${num(comTP.length, 'int')}<small>de ${ans.length}</small>`, { sub: `${ans.filter(a => a.total).length} com medições` })}
        ${estat('Medições válidas', num(g.validas, 'int'), { sub: `${g.medicoes - g.validas} fora do cálculo` })}
        ${estat('Amostras confiáveis', num(g.coberturaAmostra, 'pct0'), { ajudaChave: 'ciclos', sub: 'atingiram o nº de ciclos' })}
        ${estat('Variação média (CV)', num(g.cvMedio, 'pct'), { ajudaChave: 'cv', sub: 'quanto menor, mais estável' })}
        ${estat('Operadores medidos', num(operadores, 'int'), { sub: f.operador ? `filtrado: ${f.operador}` : 'nas medições filtradas' })}
      </div>
    </section>
    ${f.setorId || f.areaId ? html`${resumoGrupoCompacto(g, ans)}` : nothing}
    <div class="dividido">
      ${cartaoGrafico({
        id: 'rank-prod',
        titulo: `Produtividade ${ROTULO_PERIODO[ui.periodo]}`,
        sub: `${ui.base === 'pessoa' ? 'Por pessoa' : ui.base === 'equipe' ? 'Pela equipe alocada' : 'Planejada (equipe × eficiência meta)'} · maiores primeiro (até 15)`,
        ajudaChave: 'produtividade',
        acoes: seletorUnidade(),
        corpo: barrasH(ranking, { vazioTexto: 'Nenhuma atividade com tempo padrão nos filtros.' }),
        tabela: () => tabelaSimples([{ rotulo: 'Atividade', v: r => r.rotulo }, { rotulo: 'Setor', v: r => r.sub || '' }, { rotulo: 'Produtividade', n: true, v: r => r.texto }], ranking),
      })}
      <div class="stack">
        ${cartaoGrafico({
          id: 'med-dia',
          titulo: 'Medições por dia',
          sub: 'Ritmo do levantamento de dados',
          corpo: graficoLinha(serie, { nome: 'medições' }),
          tabela: () => tabelaSimples([{ rotulo: 'Dia', v: s => s.dica }, { rotulo: 'Medições', n: true, v: s => s.v }], serie),
        })}
        <section class="cartao">
          <div class="cartao-topo"><h3>${ic('heartbeat', 'duo')} Situação das atividades medidas</h3></div>
          ${partes.some(p => p.v) ? barraSegmentada(partes) : html`<p class="small muted">Sem medições nos filtros.</p>`}
        </section>
      </div>
    </div>
  </div>`;
}

function resumoGrupoCompacto(g, ans) {
  const unidade = ans.find(a => a.tempoPadrao)?.atividade.unidade || 'un.';
  if (g.unidadesMistas) return avisoUnidadesMistas(g);
  return html`<section class="cartao tinta">
    <div class="grade g4" style="gap:22px">
      ${estat('Tempo padrão total', g.tpTotal ? fmtTempo(g.tpTotal) : '—', { ajudaChave: 'tpTotal', sub: `${g.nComTP} atividade(s) somadas` })}
      ${estat('Capacidade do fluxo', html`${num(g.capacidadeFluxo?.[ui.periodo])}<small>${unidade} ${ROTULO_PERIODO[ui.periodo]}</small>`, { ajudaChave: 'capacidadeFluxo', sub: g.gargalo ? `gargalo: ${g.gargalo.analise.atividade.nome}` : '' })}
      ${estat('Produtividade por pessoa', html`${num(g.prodPessoa?.[ui.periodo])}<small>${unidade} ${ROTULO_PERIODO[ui.periodo]}</small>`, { ajudaChave: 'tpTotal', sub: 'produto completo, 1 pessoa' })}
      ${estat('Balanceamento', num(g.eficienciaBalanceamento, 'pct0'), { ajudaChave: 'balanceamento', sub: `${g.pessoasTotal} pessoa(s) alocadas` })}
    </div>
  </section>`;
}

/* ------------------------------ tabela por atividade ------------------------------ */
function abaAtividades(ans) {
  const linhas = ans.map(an => {
    const c = store.caminho(store.obter('atividades', an.atividade.id));
    return { an, area: c.area?.nome || '', setor: c.setor?.nome || '' };
  });
  const campos = {
    nome: l => l.an.atividade.nome,
    setor: l => `${l.area} ${l.setor}`,
    med: l => l.an.nValidas,
    tp: l => l.an.tempoPadrao,
    ritmo: l => l.an.ritmo,
    tol: l => l.an.fatorTolerancia,
    cv: l => l.an.est.cv,
    prod: l => prodDe(l.an),
    conf: l => l.an.confiabilidade,
  };
  let ord = ordenarPor(linhas, campos[ui.ordem.campo] || campos.prod);
  if (ui.ordem.desc) ord = ord.reverse();
  const nulos = ord.filter(l => (campos[ui.ordem.campo] || campos.prod)(l) == null);
  ord = [...ord.filter(l => (campos[ui.ordem.campo] || campos.prod)(l) != null), ...nulos];
  const th = (campo, rotulo, n) => html`<th class=${n ? 'n' : ''}><button @click=${() => { ui.ordem = { campo, desc: ui.ordem.campo === campo ? !ui.ordem.desc : true }; atualizar(); }}>${rotulo}${ui.ordem.campo === campo ? ic(ui.ordem.desc ? 'caret-down' : 'caret-up', 'bold') : nothing}</button></th>`;
  return html`<div class="stack">
    <div class="row between wrap">${seletorUnidade()}<span class="small muted">${ans.length} atividade(s)</span></div>
    ${ans.length ? html`<div class="tabela-wrap">
      <table class="tabela">
        <thead><tr>${th('nome', 'Atividade')}${th('setor', 'Área › Setor')}${th('med', 'Medições', true)}${th('tp', 'Tempo padrão', true)}
          ${th('ritmo', 'Ritmo', true)}${th('tol', 'Tolerância', true)}${th('cv', 'CV', true)}${th('prod', `Produtividade ${ROTULO_PERIODO[ui.periodo]}`, true)}<th class="n">Pessoas</th>${th('conf', 'Situação')}</tr></thead>
        <tbody>${ord.map(({ an, area, setor }) => html`<tr class="clicavel" @click=${() => ir(`#/atividade/${an.atividade.id}`)}>
          <td><b>${an.atividade.nome}</b></td>
          <td class="small soft">${area} › ${setor}</td>
          <td class="n">${an.nValidas}${an.ciclos.necessario ? html`<span class="muted"> / ${an.ciclos.necessario}</span>` : nothing}</td>
          <td class="n mono">${an.tempoPadrao ? fmtTempo(an.tempoPadrao) : '—'}</td>
          <td class="n">${an.tempoPadrao ? fmtPct(an.ritmo, 0) : '—'}</td>
          <td class="n">${an.tempoPadrao ? `×${fmtNum(an.fatorTolerancia, 2)}` : '—'}</td>
          <td class="n">${fmtPct(an.est.cv)}</td>
          <td class="n"><b>${fmtQtd(prodDe(an))}</b> <span class="small muted">${an.atividade.unidade}</span></td>
          <td class="n">${an.pessoas}</td>
          <td>${seloSaude(an.saude)}</td>
        </tr>`)}</tbody>
      </table>
    </div>` : html`<section class="cartao">${vazio({ icone: 'cube', titulo: 'Nenhuma atividade nos filtros' })}</section>`}
  </div>`;
}

/* ------------------------------ agrupado ------------------------------ */
function abaAgrupado(ans) {
  const cfg = store.config();
  const porSetor = agruparPor(ans, a => a.atividade.setorId);
  const setores = [...porSetor.entries()].map(([id, lista]) => ({ item: store.obter('setores', id), g: analisarGrupo(lista, cfg), lista })).filter(x => x.item);
  const porArea = agruparPor(setores, s => s.item.areaId);
  const areas = [...porArea.entries()].map(([id, ss]) => ({ item: store.obter('areas', id), g: analisarGrupo(ss.flatMap(s => s.lista), cfg), lista: ss.flatMap(s => s.lista) })).filter(x => x.item);
  const unidadeDe = lista => lista.find(a => a.tempoPadrao)?.atividade.unidade || 'un.';
  const tabela = (linhas, tipo) => html`<div class="tabela-wrap"><table class="tabela">
    <thead><tr><th>${tipo === 'setor' ? 'Setor' : 'Área'}</th><th class="n">Atividades</th><th class="n">Medições</th>
      <th class="n">TP total ${ajuda('tpTotal')}</th><th>Gargalo</th><th class="n">Capacidade do fluxo ${ajuda('capacidadeFluxo')}</th>
      <th class="n">Por pessoa ${ajuda('tpTotal')}</th><th class="n">Pessoas</th><th class="n">Balanceamento ${ajuda('balanceamento')}</th><th class="n">Confiáveis</th></tr></thead>
    <tbody>${ordenarPor(linhas, l => l.item.seq ?? 999, l => l.item.nome).map(({ item, g, lista }) => {
      const un = unidadeDe(lista);
      return html`<tr class="clicavel" @click=${() => ir(tipo === 'setor' ? `#/estrutura/setor/${item.id}` : `#/estrutura/area/${item.id}`)}>
        <td><b>${item.nome}</b>${tipo === 'setor' ? html`<br /><span class="tiny muted">${store.obter('areas', item.areaId)?.nome || ''}</span>` : nothing}</td>
        <td class="n">${g.nComTP}/${g.nAtividades}</td>
        <td class="n">${g.medicoes}</td>
        <td class="n mono">${g.tpTotal ? fmtTempo(g.tpTotal) : '—'}</td>
        <td class="small">${g.unidadesMistas ? html`<span class="selo contorno" data-dica=${`Unidades diferentes: ${g.unidades.join(', ')}\nCapacidade do fluxo e gargalo não se aplicam`}>${ic('stack')} unidades mistas</span>` : g.gargalo ? g.gargalo.analise.atividade.nome : '—'}</td>
        <td class="n"><b>${fmtQtd(g.capacidadeFluxo?.[ui.periodo])}</b> <span class="small muted">${un}</span></td>
        <td class="n">${fmtQtd(g.prodPessoa?.[ui.periodo])} <span class="small muted">${un}</span></td>
        <td class="n">${g.pessoasTotal}</td>
        <td class="n">${fmtPct(g.eficienciaBalanceamento, 0)}</td>
        <td class="n">${fmtPct(g.coberturaAmostra, 0)}</td>
      </tr>`;
    })}</tbody></table></div>`;
  return html`<div class="stack loose">
    <div class="row between wrap">${seletorUnidade()}</div>
    <div class="aviso info">${ic('info', 'fill')}<div>O agrupamento considera que as atividades de um setor/área formam uma sequência (linha) para o mesmo produto. A <b>capacidade do fluxo</b> é limitada pelo gargalo; a <b>produtividade por pessoa</b> é quanto 1 pessoa produziria fazendo todas as etapas.</div></div>
    <section class="stack"><h2 class="row">${ic('squares-four', 'duo')} Por setor</h2>${setores.length ? tabela(setores, 'setor') : html`<p class="muted">Sem dados.</p>`}</section>
    <section class="stack"><h2 class="row">${ic('buildings', 'duo')} Por área</h2>${areas.length ? tabela(areas, 'area') : html`<p class="muted">Sem dados.</p>`}</section>
  </div>`;
}

/* ------------------------------ operadores ------------------------------ */
const abertosOp = new Set();
function abaOperadores(ans, f) {
  const ops = analisarOperadores(ans);
  const barras = ops.filter(o => o.desempenho).map(o => ({
    rotulo: o.nome,
    sub: `${o.medicoes} medições`,
    valor: o.desempenho,
    texto: fmtPct(o.desempenho, 0),
    destaque: false,
    fraca: o.nome === 'Não informado',
    dica: `${o.atividades.size} atividade(s)\nTempo real ${fmtTempo(o.realSeg)} · normal ${fmtTempo(o.padraoSeg)}`,
  }));
  return html`<div class="stack loose">
    <div class="aviso">${ic('user-focus')}<div><b>Desempenho individual</b> compara o tempo de cada operador com o tempo normal da atividade (100% = ritmo normal). Use para orientar treinamentos e padronizar o método — nunca como avaliação isolada. ${ajuda('desempenho')}</div></div>
    ${ops.length ? html`
    <div class="dividido">
      ${cartaoGrafico({
        id: 'ops',
        titulo: 'Desempenho por operador',
        sub: 'Linha vertical = 100% (tempo normal)',
        ajudaChave: 'desempenho',
        corpo: barrasH(barras, { referencia: { valor: 1, rotulo: '100% = tempo normal' } }),
        tabela: () => tabelaSimples([{ rotulo: 'Operador', v: b => b.rotulo }, { rotulo: 'Medições', v: b => b.sub }, { rotulo: 'Desempenho', n: true, v: b => b.texto }], barras),
      })}
      <section class="cartao stack">
        <h3 class="row">${ic('users', 'duo')} Operadores</h3>
        <div class="lista">${ops.map(o => html`
          <button class="item" @click=${() => { abertosOp.has(o.nome) ? abertosOp.delete(o.nome) : abertosOp.add(o.nome); atualizar(); }} aria-expanded=${abertosOp.has(o.nome)}>
            <span class="avatar">${o.nome === 'Não informado' ? ic('question') : html`<b style="font-family:var(--f-display)">${o.nome.slice(0, 1).toUpperCase()}</b>`}</span>
            <span class="corpo"><b>${o.nome}</b><span>${o.medicoes} medições · ${o.atividades.size} atividade(s) · ${tempoRelativo(o.ultima)}</span></span>
            <span class="lado"><b>${fmtPct(o.desempenho, 0)}</b><span>desempenho</span></span>
          </button>
          ${abertosOp.has(o.nome) ? html`<div class="cartao plano" style="margin:4px 0 10px;padding:12px">
            <table class="tabela-ref"><tr><th>Atividade</th><th class="n">Medições</th><th class="n">Desempenho</th></tr>
              ${o.atividadesLista.map(x => html`<tr><td><a href="#/atividade/${x.analise.atividade.id}">${x.analise.atividade.nome}</a></td><td class="n">${x.medicoes}</td><td class="n">${fmtPct(x.desempenho, 0)}</td></tr>`)}</table>
            ${o.nome !== 'Não informado' ? html`<button class="btn pequeno mt-s" @click=${() => definirQuery({ operador: o.nome })}>${ic('funnel')} Ver tudo só deste operador</button>` : nothing}
          </div>` : nothing}`)}
        </div>
      </section>
    </div>` : html`<section class="cartao">${vazio({ icone: 'users', titulo: 'Sem medições com tempo normal', texto: 'Informe o operador ao cronometrar para acompanhar a produtividade individual.' })}</section>`}
  </div>`;
}

/* ------------------------------ planejamento ------------------------------ */
function abaPlanejamento(ans, f) {
  const cfg = store.config();
  const p = ui.plan;
  if (!p.setorId || !store.obter('setores', p.setorId)) p.setorId = f.setorId || store.setores().find(s => store.atividades(s.id).length)?.id || '';
  const jornada = numero(p.jornada) || cfg.jornadaMin;
  const ef = (numero(p.ef) || cfg.eficienciaMeta * 100) / 100;
  const demanda = numero(p.demanda) || 0;
  const doSetor = p.setorId ? store.atividades(p.setorId).map(a => analisarAtividade(a, store.medicoes(a.id), contexto())).filter(a => a.tempoPadrao > 0) : [];
  const takt = demanda > 0 ? (jornada * 60) / demanda : null;
  const linhas = doSetor.map(an => {
    const nec = pessoasNecessarias(an.tempoPadrao, demanda, jornada, ef);
    const alocar = Math.max(1, Math.ceil(nec - 1e-9));
    const tc = an.tempoPadrao / alocar;
    return { an, nec, alocar, tc, capDia: (jornada * 60 * ef) / tc };
  });
  const totalNec = linhas.reduce((s, l) => s + l.nec, 0);
  const totalAloc = linhas.reduce((s, l) => s + l.alocar, 0);
  const capLinha = linhas.length ? Math.min(...linhas.map(l => l.capDia)) : null;
  const un = doSetor[0]?.atividade.unidade || 'un.';
  const opcoesAtividades = store.atividades().map(a => ({ a, an: analisarAtividade(a, store.medicoes(a.id), contexto()) })).filter(x => x.an.tempoPadrao > 0);

  const e1 = ui.ef;
  const tpEf = e1.atividadeId ? opcoesAtividades.find(x => x.a.id === e1.atividadeId)?.an.tempoPadrao : (numero(e1.tpMin) || 0) * 60;
  const efCalc = eficiencia(tpEf, numero(e1.pecas) || 0, numero(e1.pessoas) || 0, numero(e1.jornada) || 0);
  const e2 = ui.prod;
  const tpProd = e2.atividadeId ? opcoesAtividades.find(x => x.a.id === e2.atividadeId)?.an.tempoPadrao : (numero(e2.tpMin) || 0) * 60;
  const prodCalc = producao(tpProd, numero(e2.pessoas) || 0, numero(e2.jornada) || 0, (numero(e2.ef) || 0) / 100);

  const seletorTP = (estado) => html`<div class="campo"><label>Tempo padrão</label>
    <select class="entrada" @change=${e => { estado.atividadeId = e.target.value; atualizar(); }}>
      <option value="" ?selected=${!estado.atividadeId}>Informar manualmente (minutos)</option>
      ${opcoesAtividades.map(x => html`<option value=${x.a.id} ?selected=${estado.atividadeId === x.a.id}>${x.a.nome} — ${fmtTempo(x.an.tempoPadrao)}</option>`)}
    </select>
    ${!estado.atividadeId ? html`<div class="entrada-grupo mt-s"><input class="entrada" inputmode="decimal" placeholder="25,304" .value=${String(estado.tpMin)} @change=${e => { estado.tpMin = e.target.value; atualizar(); }} /><span class="sufixo">min</span></div>` : nothing}
  </div>`;
  const campoNum = (estado, k, rotulo, sufixo) => html`<div class="campo"><label>${rotulo}</label><div class="entrada-grupo">
    <input class="entrada" inputmode="decimal" .value=${String(estado[k] ?? '')} @change=${e => { estado[k] = e.target.value; atualizar(); }} />${sufixo ? html`<span class="sufixo">${sufixo}</span>` : nothing}</div></div>`;

  return html`<div class="stack loose">
    <section class="cartao stack">
      <div class="row between wrap"><h2 class="row">${ic('users-three', 'duo')} Dimensionar a equipe ${ajuda('pessoasNecessarias')}</h2>
        <span class="small muted">Quantas pessoas cada atividade precisa para atender a demanda?</span></div>
      <div class="grade-form">
        <div class="campo"><label>Setor (linha)</label><select class="entrada" @change=${e => { p.setorId = e.target.value; atualizar(); }}>
          ${store.areas().map(a => html`<optgroup label=${a.nome}>${store.setores(a.id).map(s => html`<option value=${s.id} ?selected=${s.id === p.setorId}>${s.nome}</option>`)}</optgroup>`)}</select></div>
        ${campoNum(p, 'demanda', 'Demanda por dia', un)}
        <div class="campo"><label>Jornada</label><div class="entrada-grupo"><input class="entrada" inputmode="decimal" placeholder=${String(cfg.jornadaMin)} .value=${p.jornada ?? ''} @change=${e => { p.jornada = e.target.value; atualizar(); }} /><span class="sufixo">min/dia</span></div></div>
        <div class="campo"><label>Eficiência esperada</label><div class="entrada-grupo"><input class="entrada" inputmode="decimal" placeholder=${fmtNum(cfg.eficienciaMeta * 100, 0)} .value=${p.ef ?? ''} @change=${e => { p.ef = e.target.value; atualizar(); }} /><span class="sufixo">%</span></div></div>
      </div>
      ${new Set(doSetor.map(a => a.atividade.unidade)).size > 1 ? html`<div class="aviso alerta">${ic('warning', 'fill')}<div>Este setor tem atividades com unidades diferentes (${[...new Set(doSetor.map(a => a.atividade.unidade))].join(', ')}). A demanda informada é aplicada igualmente a todas — confira se faz sentido para o seu processo.</div></div>` : nothing}
      ${linhas.length ? html`
        <div class="grade g4">
          ${estat('Takt time', takt ? fmtTempo(takt) : '—', { sub: `ritmo exigido pela demanda (1 ${un} a cada…)` })}
          ${estat('Pessoas necessárias', html`${num(totalNec, 'num1')}`, { sub: `${totalAloc} arredondando por atividade` })}
          ${estat('Capacidade da linha', html`${num(capLinha)}<small>${un}/dia</small>`, { sub: capLinha >= demanda ? 'atende a demanda' : 'abaixo da demanda' })}
          ${estat('Balanceamento', num(totalAloc ? totalNec / totalAloc : null, 'pct0'), { ajudaChave: 'balanceamento', sub: 'necessário ÷ alocado' })}
        </div>
        <div class="tabela-wrap"><table class="tabela">
          <thead><tr><th>Atividade</th><th class="n">Tempo padrão</th><th class="n">Carga (h/dia)</th><th class="n">Pessoas (cálculo)</th><th class="n">Alocar</th><th class="n">Ciclo resultante</th><th class="n">Capacidade/dia</th></tr></thead>
          <tbody>${linhas.map(l => html`<tr>
            <td><a href="#/atividade/${l.an.atividade.id}">${l.an.atividade.nome}</a></td>
            <td class="n mono">${fmtTempo(l.an.tempoPadrao)}</td>
            <td class="n">${fmtNum((demanda * l.an.tempoPadrao) / 3600, 1)}</td>
            <td class="n">${fmtNum(l.nec, 2)}</td>
            <td class="n"><b>${l.alocar}</b></td>
            <td class="n mono">${fmtTempo(l.tc)}${takt && l.tc > takt ? html` <span class="selo critical" data-dica="Acima do takt time">${ic('warning', 'fill')}</span>` : nothing}</td>
            <td class="n">${fmtQtd(l.capDia)}</td>
          </tr>`)}</tbody>
          <tfoot><tr><td>Total</td><td class="n mono">${fmtTempo(linhas.reduce((s, l) => s + l.an.tempoPadrao, 0))}</td><td class="n">${fmtNum(linhas.reduce((s, l) => s + (demanda * l.an.tempoPadrao) / 3600, 0), 1)}</td><td class="n">${fmtNum(totalNec, 2)}</td><td class="n">${totalAloc}</td><td></td><td class="n">${fmtQtd(capLinha)}</td></tr></tfoot>
        </table></div>
        ${barrasH(linhas.map(l => ({ rotulo: l.an.atividade.nome, sub: `${l.alocar} pessoa(s)`, valor: l.tc, texto: fmtTempo(l.tc), destaque: takt && l.tc > takt })), { referencia: takt ? { valor: takt, rotulo: `Takt time ${fmtTempo(takt)}` } : null })}`
      : html`<p class="muted small">O setor escolhido não tem atividades com tempo padrão.</p>`}
    </section>

    <div class="grade g2">
      <section class="cartao stack">
        <h2 class="row">${ic('percent', 'duo')} Calcular a eficiência ${ajuda('eficiencia')}</h2>
        <div class="grade-form">
          ${seletorTP(e1)}
          ${campoNum(e1, 'pecas', 'Peças produzidas', 'un.')}
          ${campoNum(e1, 'pessoas', 'Pessoas que trabalharam', 'pessoas')}
          ${campoNum(e1, 'jornada', 'Jornada', 'min')}
        </div>
        <div class="cartao tinta" style="padding:18px">${estat('Eficiência', html`${num(efCalc, 'pct')}`, { sub: 'TP × peças × 100 ÷ (pessoas × jornada)' })}</div>
      </section>
      <section class="cartao stack">
        <h2 class="row">${ic('calendar-check', 'duo')} Produção do dia ${ajuda('producaoDia')}</h2>
        <div class="grade-form">
          ${seletorTP(e2)}
          ${campoNum(e2, 'pessoas', 'Pessoas', 'pessoas')}
          ${campoNum(e2, 'jornada', 'Jornada', 'min')}
          ${campoNum(e2, 'ef', 'Eficiência desejada', '%')}
        </div>
        <div class="cartao tinta" style="padding:18px">${estat('Produção esperada', html`${num(prodCalc)}<small>peças/dia</small>`, { sub: 'pessoas × jornada × EF ÷ TP' })}</div>
      </section>
    </div>
  </div>`;
}

/* ------------------------------ tela ------------------------------ */
export function telaProdutividade(rota) {
  const aba = rota.partes[1] || 'visao';
  const f = lerFiltros(rota.query);
  const ans = analisesFiltradas(f);
  const qs = new URLSearchParams(rota.query).toString();
  const abas = [
    ['visao', 'Visão geral', 'squares-four'],
    ['atividades', 'Por atividade', 'cube'],
    ['agrupado', 'Por setor e área', 'tree-structure'],
    ['operadores', 'Por operador', 'user-focus'],
    ['planejamento', 'Planejamento', 'calculator'],
  ];
  const corpo = {
    visao: () => abaVisao(ans, f),
    atividades: () => abaAtividades(ans),
    agrupado: () => abaAgrupado(ans),
    operadores: () => abaOperadores(ans, f),
    planejamento: () => abaPlanejamento(ans, f),
  }[aba] || (() => abaVisao(ans, f));
  const escopoNome = f.setorId ? store.obter('setores', f.setorId)?.nome : f.areaId ? store.obter('areas', f.areaId)?.nome : 'Todas as áreas';
  return {
    titulo: 'Produtividade',
    migalhas: [{ rotulo: 'Produtividade' }],
    conteudo: html`
      ${cabecalho({
        sobre: 'Análises',
        icone: 'chart-line-up',
        titulo: 'Produtividade',
        texto: `Calculada a partir de todas as medições — individual e agrupada. Escopo: ${escopoNome}${f.operador ? ` · operador ${f.operador}` : ''}.`,
        acoes: html`<button class="btn" @click=${() => exportarPlanilha(f.setorId ? { setorId: f.setorId } : f.areaId ? { areaId: f.areaId } : {}, `produtividade-${escopoNome}`, { analises: ans })}>${ic('microsoft-excel-logo')} Exportar Excel</button>`,
      })}
      ${aba !== 'planejamento' ? barraFiltros(f) : nothing}
      <nav class="abas" role="tablist">${abas.map(([k, r, i]) => html`<a role="tab" href="#/produtividade/${k}${qs ? '?' + qs : ''}" aria-selected=${aba === k}>${ic(i)} ${r}</a>`)}</nav>
      ${corpo()}`,
  };
}
