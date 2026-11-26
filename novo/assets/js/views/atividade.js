// Tela da atividade: produtividade, cálculo passo a passo, medições e método.
import { html, nothing } from '../lib.js';
import { store } from '../core/store.js';
import { analise, contextoDe } from '../core/consultas.js';
import {
  analisarAtividade, normalizarAtividade, WESTINGHOUSE, fatorWestinghouse, TABELA_TOLERANCIAS,
  calcularTabelaTolerancias, ROTULO_PERIODO,
} from '../core/calc.js';
import { fmtTempo, fmtTempoCurto } from '../core/time.js';
import { combina, fmtQtd, fmtPct, fmtNum, fmtDataHora, fmtData, numero, uid, ordenarPor, finito } from '../core/util.js';
import { ehAvancado } from '../core/prefs.js';
import { ic, num, anel, seloSaude, seloConjunto, vazio, ajuda, menuAcoes, toast, confirmar } from '../ui/ui.js';
import { cabecalho } from '../ui/layout.js';
import { cartaoGrafico, graficoControle, histograma, barraSegmentada, tabelaSimples } from '../ui/charts.js';
import { formAtividade, formMedicao, excluirComConfirmacao, moverAtividades, moverMedicoes, duplicarAtividade, UNIDADES } from '../ui/formularios.js';
import { atualizar, ir } from '../ui/nav.js';
import { exportarPlanilha, exportarMedicoes, imprimirRelatorio } from '../core/exportar.js';

const ui = {
  periodo: 'hora',
  base: 'pessoa',
  atividadeId: null,
  filtroStatus: 'todas',
  filtroOperador: '',
  termo: '',
  ordem: { campo: 'data', desc: true },
  selecao: new Set(),
  selecionando: false,
  rascunho: null,
};

const PERIODOS = ['minuto', 'hora', 'dia', 'semana', 'mes', 'ano'];
const ROTULO_STATUS = {
  valida: { r: 'Válida', c: 'good', i: 'check-circle' },
  nivelada: { r: 'Nivelada', c: 'serious', i: 'funnel' },
  excluida: { r: 'Fora do cálculo', c: 'critical', i: 'prohibit' },
  invalida: { r: 'Incompleta', c: 'warning', i: 'warning' },
};

/* =============================== RESUMO =============================== */
function heroiProdutividade(an) {
  const a = an.atividade;
  const cfg = store.configDaAtividade(a);
  const bases = {
    pessoa: { rot: 'Por pessoa', prod: an.prodPessoa, sub: '1 pessoa no ritmo normal' },
    equipe: { rot: `Equipe (${an.pessoas})`, prod: an.prodEquipe, sub: `${an.pessoas} pessoa(s) alocada(s) na operação` },
    planejada: { rot: `Planejada (${fmtPct(cfg.eficienciaMeta, 0)})`, prod: an.prodPlanejada, sub: `equipe × eficiência meta de ${fmtPct(cfg.eficienciaMeta, 0)}` },
  };
  const b = bases[ui.base] || bases.pessoa;
  const valor = b.prod?.[ui.periodo];
  return html`<section class="cartao tinta" style="padding:24px">
    <div class="prod-heroi">
      <div class="stack tight">
        <span class="sobretitulo" style="color:var(--brand)">${ic('trend-up', 'fill')} Produtividade ${ajuda('produtividade')}</span>
        <div class="heroi-numero">${num(valor)}<small>${a.unidade}(s) ${ROTULO_PERIODO[ui.periodo]}</small></div>
        <span class="soft">${b.sub} · tempo padrão de <b style="color:var(--paper)">${fmtTempo(an.tempoPadrao)}</b> por ${a.unidade} · jornada de ${fmtNum(cfg.jornadaMin, 0)} min, ${fmtNum(cfg.diasMes, 0)} dias/mês</span>
      </div>
      <div class="segmentado" style="background:color-mix(in srgb,var(--paper) 8%,transparent);border-color:transparent" role="group" aria-label="Base de cálculo">
        ${Object.entries(bases).map(([k, v]) => html`<button aria-pressed=${ui.base === k} style=${ui.base === k ? '' : 'color:color-mix(in srgb,var(--paper) 70%,transparent)'} @click=${() => { ui.base = k; atualizar(); }}>${v.rot}</button>`)}
      </div>
    </div>
    <div class="periodos" role="group" aria-label="Período">
      ${PERIODOS.map(p => html`<button class="periodo" aria-pressed=${ui.periodo === p} @click=${() => { ui.periodo = p; atualizar(); }}>
        <b>${fmtQtd(b.prod?.[p])}</b><span>${ROTULO_PERIODO[p]}</span></button>`)}
    </div>
  </section>`;
}

function pipeline(an) {
  const a = an.atividade;
  const avancado = ehAvancado();
  const qtdTxt = a.campoQtdId ? `${fmtQtd(an.qMedia)} ${a.unidade} em média` : `${fmtNum(a.freqObs, 0)} medição = ${fmtQtd(a.freqPecas)} ${a.unidade}`;
  const etapas = [
    { n: 1, nome: 'Tempo médio do ciclo', valor: fmtTempo(an.cicloMedio), op: `${an.nValidas} medições válidas`, ajuda: 'tempoMedio' },
    avancado && { n: 2, nome: 'Frequência lógica', valor: a.campoQtdId ? `÷ ${fmtQtd(an.qMedia)}` : `${fmtNum(a.freqObs, 0)}/${fmtQtd(a.freqPecas)}`, op: `${qtdTxt}${an.pMedia > 1 ? ` · ${fmtNum(an.pMedia, 1)} pessoas` : ''}`, ajuda: 'freqLogica' },
    { n: 3, nome: 'Tempo base', valor: fmtTempo(an.tempoBase), op: `por ${a.unidade}${avancado ? '' : ` · ${qtdTxt}`}`, ajuda: 'tempoBase' },
    avancado && { n: 4, nome: 'Ritmo', valor: fmtPct(an.ritmo, 0), op: a.ritmo.modo === 'westinghouse' ? `Westinghouse ${a.ritmo.hab}/${a.ritmo.esf}` : 'avaliação do cronometrista', ajuda: 'ritmo' },
    { n: 5, nome: 'Tempo normal', valor: fmtTempo(an.tempoNormal), op: `× ritmo ${fmtPct(an.ritmo, 0)}`, ajuda: 'tempoNormal' },
    avancado && { n: 6, nome: 'Tolerâncias', valor: `× ${fmtNum(an.fatorTolerancia, 3)}`, op: `${fmtPct(an.tolManual)} + paradas ${fmtPct(an.tolParadas)}`, ajuda: 'tolerancia' },
    { n: 7, nome: 'Tempo padrão', valor: fmtTempo(an.tempoPadrao), op: avancado ? `por ${a.unidade}` : `+ tolerâncias (×${fmtNum(an.fatorTolerancia, 2)})`, ajuda: 'tempoPadrao' },
  ].filter(Boolean);
  return html`<section class="stack tight">
    <div class="row between"><h3 class="row">${ic('path', 'duo')} Como chegamos nesse número</h3>
      <span class="small muted">${avancado ? 'Os 10 passos do treinamento de cronometragem' : 'Ative o modo avançado para ver todos os passos'}</span></div>
    <div class="pipeline">
      ${etapas.map((e, i) => html`<div class="etapa" style="--i:${i}">
        <span class="n-etapa">PASSO ${e.n}</span>
        <span class="nome-etapa row" style="gap:4px">${e.nome}${ajuda(e.ajuda)}</span>
        <span class="valor-etapa">${e.valor}</span>
        <span class="op">${e.op}</span>
      </div>`)}
    </div>
  </section>`;
}

function abaResumo(an) {
  const a = an.atividade;
  if (!an.tempoPadrao) {
    return html`<section class="cartao">${vazio({
      icone: 'timer',
      titulo: an.total ? 'Ainda não há medições válidas suficientes' : 'Nenhuma medição ainda',
      texto: an.total
        ? `${an.total} medição(ões) registradas, mas nenhuma pôde ser usada (${an.nInvalidas} incompleta(s), ${an.nExcluidas} fora do cálculo). Verifique a aba Medições.`
        : 'Cronometre esta atividade. A partir da 2ª medição o sistema já calcula o tempo padrão e a produtividade.',
      acao: html`<div class="row wrap" style="justify-content:center"><a class="btn primario" href="#/cronometro/${a.id}">${ic('play', 'fill')} Cronometrar</a>
        <button class="btn" @click=${() => formMedicao(null, a.id)}>${ic('plus')} Medição manual</button></div>`,
    })}</section>`;
  }
  const faltam = an.ciclos.necessario ? Math.max(0, an.ciclos.necessario - an.nValidas) : null;
  const cfg = store.configDaAtividade(a);
  const cvClasse = an.est.cv == null ? '' : an.est.cv <= cfg.cvBom ? 'good' : an.est.cv <= cfg.cvAtencao ? 'warning' : 'critical';
  const comp = [
    { rotulo: 'Tempo normal', v: an.tempoNormal, cor: 'var(--series-1)', texto: fmtTempo(an.tempoNormal) },
    { rotulo: 'Tolerâncias', v: an.tempoNormal * (an.tolManual), cor: 'var(--series-3)', texto: fmtTempo(an.tempoNormal * an.tolManual) },
    { rotulo: 'Paradas programadas', v: an.tempoNormal * an.tolParadas + an.paradasPorUnidade, cor: 'var(--series-7)', texto: fmtTempo(an.tempoNormal * an.tolParadas + an.paradasPorUnidade) },
  ];
  const pontos = an.linhas.map((l, i) => ({
    v: l.u,
    status: l.status,
    titulo: `#${i + 1} · ${fmtTempo(l.u)} por ${a.unidade}`,
    dica: `${fmtDataHora(l.m.dataHora)}${l.m.operador ? '\n' + l.m.operador : ''}${l.razao ? '\n' + l.razao : ''}`,
  }));
  return html`<div class="stack loose">
    ${heroiProdutividade(an)}
    ${pipeline(an)}
    <div class="grade" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))">
      <section class="cartao">
        <div class="cartao-topo"><h3>${ic('chart-bar', 'duo')} Confiabilidade ${ajuda('ciclos')}</h3>${seloSaude(an.saude)}</div>
        <div class="row" style="gap:18px">
          ${anel(an.confiabilidade, { classe: an.amostraOk ? 'good' : 'serie', sub: 'da amostra' })}
          <div class="stack tight">
            <b style="font-size:1.05rem">${an.nValidas} de ${an.ciclos.necessario ?? '—'} medições</b>
            <span class="small soft">${an.amostraOk
              ? `Amostra suficiente para ${fmtPct(cfg.confianca, 0)} de confiança e erro de ${fmtPct(cfg.erroRel, 0)}.`
              : faltam ? `Faltam ${faltam} medição(ões) para ${fmtPct(cfg.confianca, 0)} de confiança.` : 'Faça mais medições.'}</span>
            ${!an.amostraOk ? html`<a class="btn pequeno primario" style="align-self:flex-start" href="#/cronometro/${a.id}">${ic('play', 'fill')} Continuar medindo</a>` : nothing}
          </div>
        </div>
      </section>
      <section class="cartao">
        <div class="cartao-topo"><h3>${ic('wave-sine', 'duo')} Variação ${ajuda('cv')}</h3>
          ${an.est.cv != null ? html`<span class="selo ${cvClasse}">CV ${fmtPct(an.est.cv)}</span>` : nothing}</div>
        <div class="grade" style="grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
          <div class="estat"><span class="rotulo-estat">Menor</span><span class="valor" style="font-size:1.15rem">${fmtTempo(an.est.min)}</span></div>
          <div class="estat"><span class="rotulo-estat">Maior</span><span class="valor" style="font-size:1.15rem">${fmtTempo(an.est.max)}</span></div>
          <div class="estat"><span class="rotulo-estat">Mediana</span><span class="valor" style="font-size:1.15rem">${fmtTempo(an.est.mediana)}</span></div>
          <div class="estat"><span class="rotulo-estat">Desvio padrão</span><span class="valor" style="font-size:1.15rem">${fmtTempo(an.est.dp)}</span></div>
        </div>
        <p class="tiny muted mt-s">Valores por ${a.unidade} e por pessoa. ${an.nNiveladas ? `${an.nNiveladas} medição(ões) niveladas.` : ''}</p>
      </section>
      <section class="cartao">
        <div class="cartao-topo"><h3>${ic('stack', 'duo')} Composição do tempo padrão</h3></div>
        ${barraSegmentada(comp)}
        ${an.tolDetalhes.length ? html`<details class="mt-s"><summary class="small soft" style="cursor:pointer">Detalhes da tabela de tolerâncias</summary>
          <table class="tabela-ref mt-s">${an.tolDetalhes.map(d => html`<tr><td>${d.nome}<br /><span class="tiny muted">${d.rotulo}</span></td><td class="n">${fmtPct(d.v, 1)}</td></tr>`)}</table></details>` : nothing}
        ${an.paradasAplic.length ? html`<p class="tiny muted mt-s">Paradas: ${an.paradasAplic.map(p => `${p.nome} (${fmtTempo(p.duracao, { casas: 0 })}${p.freq === 'ciclo' ? '/ciclo' : '/dia'})`).join(', ')}</p>` : nothing}
      </section>
    </div>
    <div class="grade g2">
      ${cartaoGrafico({
        id: 'ctrl-' + a.id,
        titulo: 'Gráfico de controle',
        sub: `Tempo por ${a.unidade} em cada medição. Faixa verde = limites do nivelamento; pontos vazados ficam fora do cálculo.`,
        ajudaChave: 'nivelamento',
        corpo: graficoControle(pontos, { media: an.tempoBase, inf: an.limites?.inf, sup: an.limites?.sup, fmt: v => fmtTempoCurto(v) }),
        legenda: html`<span><i class="circ" style="background:var(--series-1)"></i>Válida</span><span><i class="circ" style="border:2px solid var(--critical);background:var(--surface)"></i>Nivelada</span><span><i class="circ" style="border:1.5px solid var(--ink-3);background:var(--surface)"></i>Fora do cálculo</span><span><i class="linha-chave" style="background:var(--ink-2)"></i>Média (tempo base)</span>`,
        tabela: () => tabelaSimples([
          { rotulo: '#', v: l => an.linhas.indexOf(l) + 1 },
          { rotulo: 'Data', v: l => fmtDataHora(l.m.dataHora) },
          { rotulo: `Tempo/${a.unidade}`, n: true, v: l => fmtTempo(l.u) },
          { rotulo: 'Situação', v: l => ROTULO_STATUS[l.status].r },
        ], an.linhas),
      })}
      ${cartaoGrafico({
        id: 'hist-' + a.id,
        titulo: 'Distribuição dos tempos',
        sub: `Quantas medições caem em cada faixa de tempo por ${a.unidade}. A linha marca a média.`,
        corpo: histograma(an.linhas.filter(l => l.status === 'valida' || l.status === 'nivelada').map(l => l.u), { fmt: v => fmtTempoCurto(v), limites: an.limites, media: an.tempoBase }),
      })}
    </div>
  </div>`;
}

/* =============================== MEDIÇÕES =============================== */
function abaMedicoes(an) {
  const a = an.atividade;
  const paramsExtras = (a.parametros || []).filter(p => p.id !== a.campoQtdId && p.id !== a.campoPessoasId);
  const qtdParam = a.parametros.find(p => p.id === a.campoQtdId);
  const pesParam = a.parametros.find(p => p.id === a.campoPessoasId);
  const operadores = [...new Set(an.linhas.map(l => l.m.operador).filter(Boolean))].sort();
  const paradas = store.mapaParadas();
  let linhas = an.linhas.map((l, i) => ({ ...l, n: i + 1 }));
  if (ui.filtroStatus === 'validas') linhas = linhas.filter(l => l.status === 'valida');
  if (ui.filtroStatus === 'fora') linhas = linhas.filter(l => l.status !== 'valida');
  if (ui.filtroOperador) linhas = linhas.filter(l => l.m.operador === ui.filtroOperador);
  if (ui.termo) linhas = linhas.filter(l => combina(`${l.m.observacao} ${l.m.operador} ${l.motivo?.nome || ''} ${Object.values(l.m.valores || {}).join(' ')}`, ui.termo));
  const campos = { data: l => l.m.dataHora || '', tempo: l => l.t, u: l => l.u, n: l => l.n, vs: l => l.desvio };
  linhas = ordenarPor(linhas, campos[ui.ordem.campo] || campos.data);
  if (ui.ordem.desc) linhas.reverse();
  const th = (campo, rotulo, n) => html`<th class=${n ? 'n' : ''}><button @click=${() => {
    ui.ordem = { campo, desc: ui.ordem.campo === campo ? !ui.ordem.desc : true };
    atualizar();
  }}>${rotulo}${ui.ordem.campo === campo ? ic(ui.ordem.desc ? 'caret-down' : 'caret-up', 'bold') : nothing}</button></th>`;
  const alternarNivel = (m, nivel) => {
    store.salvar('medicoes', { ...m, nivel }, { registrarHistorico: false });
    toast(nivel === 'excluir' ? 'Medição excluída do cálculo' : nivel === 'incluir' ? 'Medição forçada no cálculo' : 'Nivelamento automático');
  };
  const sel = ui.selecao;

  return html`<div class="stack">
    <div class="ferramentas">
      <div class="busca-local">${ic('magnifying-glass')}<input class="entrada" type="search" placeholder="Buscar observação, operador, motivo…" .value=${ui.termo} @input=${e => { ui.termo = e.target.value; atualizar(); }} /></div>
      <div class="segmentado">
        ${[['todas', `Todas (${an.total})`], ['validas', `Válidas (${an.nValidas})`], ['fora', `Fora do cálculo (${an.total - an.nValidas})`]].map(([v, r]) => html`<button aria-pressed=${ui.filtroStatus === v} @click=${() => { ui.filtroStatus = v; atualizar(); }}>${r}</button>`)}
      </div>
      ${operadores.length ? html`<select class="entrada" style="width:auto" aria-label="Operador" @change=${e => { ui.filtroOperador = e.target.value; atualizar(); }}>
        <option value="">Todos os operadores</option>${operadores.map(o => html`<option ?selected=${ui.filtroOperador === o}>${o}</option>`)}</select>` : nothing}
      <span class="grow"></span>
      <button class="btn" aria-pressed=${ui.selecionando} @click=${() => { ui.selecionando = !ui.selecionando; sel.clear(); atualizar(); }}>${ic(ui.selecionando ? 'x' : 'check-square-offset')} ${ui.selecionando ? 'Cancelar' : 'Selecionar'}</button>
      <button class="btn" @click=${() => exportarMedicoes(store.medicoes(a.id), a.nome)}>${ic('download-simple')} Exportar</button>
      <button class="btn primario" @click=${() => formMedicao(null, a.id)}>${ic('plus')} Manual</button>
    </div>
    ${ui.selecionando ? html`<div class="barra-selecao">
      <label class="check"><input type="checkbox" .checked=${linhas.length && linhas.every(l => sel.has(l.m.id))} @change=${e => { linhas.forEach(l => (e.target.checked ? sel.add(l.m.id) : sel.delete(l.m.id))); atualizar(); }} /><b>${sel.size} selecionada(s)</b></label>
      <span class="grow"></span>
      <button class="btn pequeno" ?disabled=${!sel.size} @click=${() => { store.salvarVarios('medicoes', [...sel].map(id => ({ ...store.obter('medicoes', id), nivel: 'excluir' })), { rotulo: `${sel.size} medição(ões) excluídas do cálculo` }); sel.clear(); }}>${ic('prohibit')} Tirar do cálculo</button>
      <button class="btn pequeno" ?disabled=${!sel.size} @click=${() => { store.salvarVarios('medicoes', [...sel].map(id => ({ ...store.obter('medicoes', id), nivel: 'auto' })), { rotulo: `${sel.size} medição(ões) com nivelamento automático` }); sel.clear(); }}>${ic('funnel')} Automático</button>
      <button class="btn pequeno" ?disabled=${!sel.size} @click=${async () => { if (await moverMedicoes([...sel], a.id)) { sel.clear(); ui.selecionando = false; } }}>${ic('arrows-left-right')} Mover</button>
      <button class="btn perigo-cheio pequeno" ?disabled=${!sel.size} @click=${async () => { if (await excluirComConfirmacao('medicoes', [...sel])) { sel.clear(); ui.selecionando = false; atualizar(); } }}>${ic('trash')} Excluir</button>
    </div>` : nothing}
    ${an.total ? html`<div class="tabela-wrap">
      <table class="tabela">
        <thead><tr>
          ${ui.selecionando ? html`<th class="chk"></th>` : nothing}
          ${th('n', '#')}${th('data', 'Data e hora')}${th('tempo', 'Tempo', true)}
          ${qtdParam || a.freqPecas !== 1 || a.freqObs !== 1 ? html`<th class="n">Qtd.</th>` : nothing}
          ${pesParam ? html`<th class="n">Pessoas</th>` : nothing}
          ${th('u', `Por ${a.unidade}`, true)}${th('vs', 'vs. média', true)}
          <th>Operador</th><th>Anomalia</th>${paramsExtras.map(p => html`<th>${p.nome}</th>`)}<th>Observação</th><th>Situação</th><th></th>
        </tr></thead>
        <tbody>
          ${linhas.map(l => {
            const m = l.m;
            const st = ROTULO_STATUS[l.status];
            const marcado = sel.has(m.id);
            return html`<tr class="clicavel ${l.status !== 'valida' ? 'riscada' : ''} ${marcado ? 'selecionada' : ''}"
              @click=${() => (ui.selecionando ? (marcado ? sel.delete(m.id) : sel.add(m.id), atualizar()) : formMedicao(m))}>
              ${ui.selecionando ? html`<td class="chk"><input type="checkbox" .checked=${marcado} @click=${e => e.stopPropagation()} @change=${e => { e.target.checked ? sel.add(m.id) : sel.delete(m.id); atualizar(); }} /></td>` : nothing}
              <td class="mono muted">${l.n}</td>
              <td class="nowrap">${fmtDataHora(m.dataHora)}</td>
              <td class="n mono t-tempo">${fmtTempo(l.t)}</td>
              ${qtdParam || a.freqPecas !== 1 || a.freqObs !== 1 ? html`<td class="n">${fmtQtd(l.q)}</td>` : nothing}
              ${pesParam ? html`<td class="n">${fmtNum(l.p, 0)}</td>` : nothing}
              <td class="n mono">${fmtTempo(l.u)}</td>
              <td class="n">${l.desvio ? html`<span style="color:${l.desvio >= 1 ? 'var(--good-ink)' : 'var(--serious-ink)'}">${fmtPct(l.desvio, 0)}</span>` : '—'}</td>
              <td class="nowrap">${m.operador || html`<span class="muted">—</span>`}</td>
              <td>${l.motivo ? html`<span class="selo ${l.motivo.excluiCalculo ? 'critical' : 'serious'}">${l.motivo.nome}</span>` : html`<span class="muted small">Normal</span>`}</td>
              ${paramsExtras.map(p => html`<td>${m.valores?.[p.id] || html`<span class="muted">—</span>`}</td>`)}
              <td style="max-width:260px" class="truncate small soft" title=${m.observacao || ''}>${m.observacao || ''}</td>
              <td><span class="selo ${st.c}" data-dica=${l.razao || st.r}>${ic(st.i, 'fill')}${st.r}</span></td>
              <td class="n nowrap">
                ${m.nivel === 'excluir' || l.status === 'nivelada'
                  ? html`<button class="btn fantasma icone pequeno" data-dica="Incluir no cálculo" aria-label="Incluir no cálculo" @click=${e => { e.stopPropagation(); alternarNivel(m, l.status === 'nivelada' ? 'incluir' : 'auto'); }}>${ic('plus-circle')}</button>`
                  : html`<button class="btn fantasma icone pequeno" data-dica="Tirar do cálculo" aria-label="Tirar do cálculo" @click=${e => { e.stopPropagation(); alternarNivel(m, 'excluir'); }}>${ic('prohibit')}</button>`}
              </td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>` : html`<section class="cartao">${vazio({ icone: 'list-numbers', titulo: 'Sem medições', texto: 'Use o cronômetro ou adicione manualmente.' })}</section>`}
    ${an.limites ? html`<p class="small muted">${ic('funnel')} Nivelamento automático (${an.limites.metodo === 'iqr' ? 'quartis' : 'desvio padrão'}): aceita de ${fmtTempo(Math.max(0, an.limites.inf))} a ${fmtTempo(an.limites.sup)} por ${a.unidade}. Clique numa linha para editar.</p>` : nothing}
  </div>`;
}

/* =============================== MÉTODO =============================== */
function rascunhoDe(a) {
  if (!ui.rascunho || ui.rascunho.id !== a.id) ui.rascunho = structuredClone(normalizarAtividade(a));
  return ui.rascunho;
}

function secaoMetodo(titulo, icone, conteudo, ajudaChave) {
  return html`<section class="cartao stack">
    <h3 class="row">${ic(icone, 'duo')} ${titulo} ${ajudaChave ? ajuda(ajudaChave) : nothing}</h3>
    ${conteudo}
  </section>`;
}

function abaMetodo(an) {
  const original = an.atividade;
  const r = rascunhoDe(original);
  const preview = analisarAtividade(r, store.medicoes(original.id), contextoDe(original));
  const alterado = JSON.stringify(normalizarAtividade(original)) !== JSON.stringify(r);
  const numericos = r.parametros.filter(p => p.tipo === 'numero');
  const ok = () => atualizar();
  const programadas = store.paradas('programada');
  const cfg = store.configDaAtividade(original);

  const criarParam = (nome, campo) => {
    const id = uid();
    r.parametros.push({ id, nome, tipo: 'numero', fixo: campo === 'campoPessoasId' });
    r[campo] = id;
    ok();
  };

  return html`<div class="stack loose" style="padding-bottom:80px">
    <div class="grade g2">
      ${secaoMetodo('Quantidade e pessoas', 'stack', html`
        <div class="grade-form">
          <div class="campo"><label>Unidade produzida</label>
            <input class="entrada" list="dl-un2" .value=${r.unidade} @input=${e => { r.unidade = e.target.value; ok(); }} />
            <datalist id="dl-un2">${UNIDADES.map(u => html`<option value=${u}></option>`)}</datalist></div>
          <div class="campo"><label>Pessoas alocadas na operação</label>
            <input class="entrada" type="number" min="1" .value=${String(r.pessoas)} @change=${e => { r.pessoas = numero(e.target.value) || 1; ok(); }} />
            <span class="ajuda">Para a capacidade da equipe e o balanceamento.</span></div>
        </div>
        <div class="campo"><span class="rotulo">Quantidade em cada medição ${ajuda('freqLogica')}</span>
          <div class="segmentado">
            <button aria-pressed=${!r.campoQtdId} @click=${() => { r.campoQtdId = null; ok(); }}>Fixa (frequência lógica)</button>
            <button aria-pressed=${Boolean(r.campoQtdId)} @click=${() => { if (!r.campoQtdId) numericos.length ? (r.campoQtdId = numericos[0].id) : criarParam('Quantidade', 'campoQtdId'); ok(); }}>Informada a cada medição</button>
          </div>
          ${r.campoQtdId
            ? html`<select class="entrada mt-s" @change=${e => { r.campoQtdId = e.target.value; ok(); }}>${numericos.map(p => html`<option value=${p.id} ?selected=${p.id === r.campoQtdId}>Campo: ${p.nome}</option>`)}</select>`
            : html`<div class="row wrap mt-s">
              <input class="entrada" style="width:90px" type="number" min="1" .value=${String(r.freqObs)} @change=${e => { r.freqObs = numero(e.target.value) || 1; ok(); }} aria-label="Observações" />
              <span class="soft">medição(ões) =</span>
              <input class="entrada" style="width:110px" type="number" min="0.0001" step="any" .value=${String(r.freqPecas)} @change=${e => { r.freqPecas = numero(e.target.value) || 1; ok(); }} aria-label="Unidades" />
              <span class="soft">${r.unidade}(s)</span></div>`}
        </div>
        <div class="campo"><span class="rotulo">Pessoas em cada medição</span>
          <div class="segmentado">
            <button aria-pressed=${!r.campoPessoasId} @click=${() => { r.campoPessoasId = null; ok(); }}>Sempre 1</button>
            <button aria-pressed=${Boolean(r.campoPessoasId)} @click=${() => { if (!r.campoPessoasId) { const outro = numericos.find(p => p.id !== r.campoQtdId); outro ? (r.campoPessoasId = outro.id) : criarParam('Pessoas', 'campoPessoasId'); } ok(); }}>Informada</button>
          </div>
          ${r.campoPessoasId ? html`<select class="entrada mt-s" @change=${e => { r.campoPessoasId = e.target.value; ok(); }}>${numericos.filter(p => p.id !== r.campoQtdId).map(p => html`<option value=${p.id} ?selected=${p.id === r.campoPessoasId}>Campo: ${p.nome}</option>`)}</select>
            <span class="ajuda">O tempo vira homem-tempo: tempo × pessoas ÷ quantidade.</span>` : nothing}
        </div>`)}

      ${secaoMetodo('Avaliação de ritmo', 'gauge', html`
        <div class="segmentado">
          <button aria-pressed=${r.ritmo.modo !== 'westinghouse'} @click=${() => { r.ritmo.modo = 'percentual'; ok(); }}>Percentual</button>
          <button aria-pressed=${r.ritmo.modo === 'westinghouse'} @click=${() => { r.ritmo.modo = 'westinghouse'; ok(); }}>Tabela de Westinghouse</button>
        </div>
        ${r.ritmo.modo === 'westinghouse' ? html`
          <div class="grade-form">
            <div class="campo"><label>Habilidade</label><select class="entrada" @change=${e => { r.ritmo.hab = e.target.value; ok(); }}>
              ${WESTINGHOUSE.habilidade.map(w => html`<option value=${w.cod} ?selected=${r.ritmo.hab === w.cod}>${w.cod} · ${w.grupo} (${w.v > 0 ? '+' : ''}${fmtNum(w.v, 2)})</option>`)}</select></div>
            <div class="campo"><label>Esforço</label><select class="entrada" @change=${e => { r.ritmo.esf = e.target.value; ok(); }}>
              ${WESTINGHOUSE.esforco.map(w => html`<option value=${w.cod} ?selected=${r.ritmo.esf === w.cod}>${w.cod} · ${w.grupo} (${w.v > 0 ? '+' : ''}${fmtNum(w.v, 2)})</option>`)}</select></div>
          </div>
          <div class="aviso info">${ic('gauge', 'fill')}<div>Fator de ritmo: <b>${fmtNum(fatorWestinghouse(r.ritmo.hab, r.ritmo.esf), 2)}</b> (${fmtPct(fatorWestinghouse(r.ritmo.hab, r.ritmo.esf), 0)}). D = normal.</div></div>`
        : html`<div class="row wrap">
            <input type="range" min="50" max="150" step="1" style="flex:1;accent-color:var(--brand)" .value=${String(Math.round((numero(r.ritmo.valor) || 1) * 100))} @input=${e => { r.ritmo.valor = Number(e.target.value) / 100; ok(); }} aria-label="Ritmo" />
            <div class="entrada-grupo" style="width:130px"><input class="entrada" type="number" min="1" .value=${String(Math.round((numero(r.ritmo.valor) || 1) * 100))} @change=${e => { r.ritmo.valor = (numero(e.target.value) || 100) / 100; ok(); }} /><span class="sufixo">%</span></div>
          </div>
          <span class="ajuda">100% = operador normal. Você também pode avaliar o ritmo em cada medição (modo avançado).</span>`}
      `, 'ritmo')}
    </div>

    ${secaoMetodo('Tolerâncias', 'coffee', html`
      <div class="segmentado">
        <button aria-pressed=${r.tolerancia.modo === 'padrao'} @click=${() => { r.tolerancia.modo = 'padrao'; ok(); }}>Padrão do conjunto (${fmtPct(cfg.toleranciaPadrao, 0)})</button>
        <button aria-pressed=${r.tolerancia.modo === 'percentual'} @click=${() => { r.tolerancia.modo = 'percentual'; ok(); }}>Informar %</button>
        <button aria-pressed=${r.tolerancia.modo === 'tabela'} @click=${() => { r.tolerancia.modo = 'tabela'; ok(); }}>Tabela de tolerâncias</button>
      </div>
      ${r.tolerancia.modo === 'percentual' ? html`<div class="entrada-grupo" style="max-width:180px">
        <input class="entrada" type="number" min="0" step="0.1" .value=${fmtNum((numero(r.tolerancia.valor) || 0) * 100, 2).replace(',', '.')} @change=${e => { r.tolerancia.valor = (numero(e.target.value) || 0) / 100; ok(); }} /><span class="sufixo">%</span></div>` : nothing}
      ${r.tolerancia.modo === 'tabela' ? tabelaTolerancias(r, preview) : nothing}
      <div class="campo"><span class="rotulo">Paradas programadas aplicáveis</span>
        ${programadas.length ? html`<div class="grade estreita" style="gap:8px">${programadas.map(p => html`<label class="check cartao plano" style="padding:10px 12px">
          <input type="checkbox" .checked=${r.paradasIds.includes(p.id)} @change=${e => { r.paradasIds = e.target.checked ? [...r.paradasIds, p.id] : r.paradasIds.filter(x => x !== p.id); ok(); }} />
          <span class="grow">${p.nome}<br /><span class="tiny muted">${fmtTempo(p.duracao, { casas: 0 })} ${p.freq === 'ciclo' ? 'por ciclo' : 'por jornada'}</span></span></label>`)}</div>`
        : html`<span class="small muted">Nenhuma parada programada cadastrada. <a href="#/cadastros">Cadastrar</a></span>`}
      </div>
      <div class="aviso">${ic('equals')}<div>Fator de tolerância resultante: <b>${fmtNum(preview.fatorTolerancia, 3)}</b> — ${fmtPct(preview.tolManual)} de tolerância + ${fmtPct(preview.tolParadas)} das paradas por jornada${preview.paradasPorUnidade ? ` + ${fmtTempo(preview.paradasPorUnidade)} por ${r.unidade} de paradas por ciclo` : ''}.</div></div>
    `, 'tolerancia')}

    ${secaoMetodo('Campos personalizados da medição', 'textbox', html`
      <p class="small soft">Informações registradas a cada medição (ex.: modelo, cor, máquina, tamanho do lote). Campos numéricos podem ser usados como quantidade ou pessoas.</p>
      ${r.parametros.length ? html`<div class="stack tight">${r.parametros.map((p, i) => html`<div class="row wrap cartao plano" style="padding:10px 12px;gap:8px">
        <input class="entrada grow" style="min-width:160px" .value=${p.nome} @input=${e => { p.nome = e.target.value; ok(); }} aria-label="Nome do campo" />
        <select class="entrada" style="width:auto" @change=${e => { p.tipo = e.target.value; ok(); }} aria-label="Tipo">
          <option value="numero" ?selected=${p.tipo === 'numero'}>Número</option><option value="texto" ?selected=${p.tipo === 'texto'}>Texto</option><option value="lista" ?selected=${p.tipo === 'lista'}>Lista de opções</option>
        </select>
        ${p.tipo === 'lista' ? html`<input class="entrada" style="flex:1 1 200px" placeholder="Opções separadas por vírgula" .value=${(p.opcoes || []).join(', ')} @change=${e => { p.opcoes = e.target.value.split(',').map(s => s.trim()).filter(Boolean); ok(); }} />` : nothing}
        ${p.id === r.campoQtdId ? html`<span class="selo marca">quantidade</span>` : nothing}
        ${p.id === r.campoPessoasId ? html`<span class="selo acento">pessoas</span>` : nothing}
        <label class="check small" data-dica="Mantém o valor do ciclo anterior no cronômetro"><input type="checkbox" .checked=${Boolean(p.fixo)} @change=${e => { p.fixo = e.target.checked; ok(); }} />manter</label>
        <button class="btn fantasma icone pequeno" aria-label="Subir" ?disabled=${i === 0} @click=${() => { r.parametros.splice(i - 1, 0, r.parametros.splice(i, 1)[0]); ok(); }}>${ic('arrow-up')}</button>
        <button class="btn fantasma icone pequeno perigo" aria-label="Remover" @click=${() => {
          r.parametros.splice(i, 1);
          if (r.campoQtdId === p.id) r.campoQtdId = null;
          if (r.campoPessoasId === p.id) r.campoPessoasId = null;
          ok();
        }}>${ic('trash')}</button>
      </div>`)}</div>` : nothing}
      <button class="btn" style="align-self:flex-start" @click=${() => { r.parametros.push({ id: uid(), nome: `Campo ${r.parametros.length + 1}`, tipo: 'texto' }); ok(); }}>${ic('plus')} Adicionar campo</button>
    `)}

    <div class="barra-selecao" style="position:sticky;bottom:${innerWidth < 900 ? 92 : 16}px;top:auto;${alterado ? '' : 'display:none'}">
      ${ic('pencil-simple-line')}
      <span class="grow">Alterações não salvas · tempo padrão: <b>${fmtTempo(an.tempoPadrao)}</b> → <b>${fmtTempo(preview.tempoPadrao)}</b>
        ${preview.prodPessoa ? html` (${fmtQtd(preview.prodPessoa.hora)} ${r.unidade}/h)` : nothing}</span>
      <button class="btn pequeno" @click=${() => { ui.rascunho = null; atualizar(); }}>Descartar</button>
      <button class="btn pequeno" style="--b-bg:var(--brand);--b-fg:#fff;--b-bd:transparent" @click=${() => {
        r.parametros = r.parametros.filter(p => p.nome.trim());
        store.salvar('atividades', { ...original, ...r }, { rotulo: `método de ${original.nome}` });
        ui.rascunho = null;
        toast('Método salvo — cálculos atualizados');
      }}>${ic('check')} Salvar método</button>
    </div>
  </div>`;
}

function tabelaTolerancias(r, preview) {
  const itens = r.tolerancia.itens;
  const res = calcularTabelaTolerancias(itens, preview.cicloMedio);
  const ok = () => atualizar();
  return html`<div class="tabela-wrap"><table class="tabela">
    <thead><tr><th>Fator</th><th>Condição</th><th class="n">%</th></tr></thead>
    <tbody>${TABELA_TOLERANCIAS.map(cat => {
      const det = res.detalhes.find(d => d.id === cat.id);
      let controle;
      if (cat.automatica) {
        controle = html`<label class="check small"><input type="checkbox" .checked=${itens[cat.id] !== 'off'} @change=${e => { itens[cat.id] = e.target.checked ? 'auto' : 'off'; ok(); }} />
          Automática ${det ? `(${det.rotulo})` : ''} ${ajuda('monotonia')}</label>`;
      } else if (cat.faixa) {
        controle = html`<div class="entrada-grupo" style="max-width:150px"><input class="entrada" type="number" min="0" max=${cat.faixa[1] * 100} step="0.1"
          .value=${itens[cat.id] ? String((numero(itens[cat.id]) || 0) * 100) : ''} placeholder="0" @change=${e => { itens[cat.id] = (numero(e.target.value) || 0) / 100; ok(); }} /><span class="sufixo">%</span></div>`;
      } else {
        controle = html`<select class="entrada" @change=${e => { itens[cat.id] = e.target.value; ok(); }}>
          <option value="">Não se aplica</option>
          ${cat.opcoes.map(o => html`<option value=${o.id} ?selected=${itens[cat.id] === o.id}>${o.nome} — ${fmtPct(cat.porGenero ? (itens.pessoais === 'mulher' ? o.m : o.h) : o.v, 1)}</option>`)}
        </select>`;
      }
      return html`<tr><td><b>${cat.nome}</b><br /><span class="tiny muted">${cat.ajuda}</span></td><td style="min-width:220px">${controle}</td><td class="n"><b>${det ? fmtPct(det.v, 1) : '—'}</b></td></tr>`;
    })}</tbody>
    <tfoot><tr><td colspan="2">Total de tolerâncias</td><td class="n">${fmtPct(res.total, 1)}</td></tr></tfoot>
  </table></div>`;
}

/* =============================== INFORMAÇÕES =============================== */
function abaInfo(an) {
  const a = an.atividade;
  const r = { descricao: a.descricao || '', criterios: a.criterios || '', consideracoes: a.consideracoes || '', maquina: a.maquina || '' };
  const campo = (k, rotulo, dica) => html`<div class="campo"><label for="inf-${k}">${rotulo}</label>
    <textarea id="inf-${k}" class="entrada" rows="5" .value=${r[k]} placeholder=${dica} @change=${e => {
      store.salvar('atividades', { ...store.obter('atividades', a.id), [k]: e.target.value.trim() }, { rotulo: `${rotulo.toLowerCase()} de ${a.nome}` });
      toast('Salvo');
    }}></textarea></div>`;
  return html`<div class="grade g2">
    <section class="cartao stack">
      ${campo('descricao', 'Detalhamento da atividade', 'Como é executada, objetivo, início e fim do ciclo, materiais, cuidados.')}
      ${campo('criterios', 'Critérios de medição', 'Pontos de leitura, método (ciclo, lote, elemento), condições da medição.')}
      ${campo('consideracoes', 'Considerações', 'Observações gerais, melhorias propostas, restrições.')}
      <div class="campo"><label for="inf-maq">Máquina / equipamento</label>
        <input id="inf-maq" class="entrada" .value=${r.maquina} @change=${e => { store.salvar('atividades', { ...store.obter('atividades', a.id), maquina: e.target.value.trim() }); toast('Salvo'); }} /></div>
      <p class="tiny muted">As alterações são salvas ao sair do campo.</p>
    </section>
    <section class="cartao stack">
      <h3 class="row">${ic('info', 'duo')} Registro</h3>
      <table class="tabela-ref">
        <tr><td>Criada em</td><td>${fmtDataHora(a.criadoEm)}${a.criadoPor ? ` por ${a.criadoPor}` : ''}</td></tr>
        <tr><td>Última alteração</td><td>${fmtDataHora(a.modificadoEm)}${a.modificadoPor ? ` por ${a.modificadoPor}` : ''}</td></tr>
        <tr><td>Primeira medição</td><td>${fmtDataHora(an.primeira)}</td></tr>
        <tr><td>Última medição</td><td>${fmtDataHora(an.ultima)}</td></tr>
        <tr><td>Operadores medidos</td><td>${an.operadores.join(', ') || '—'}</td></tr>
        <tr><td>Medições</td><td>${an.total} (${an.nValidas} válidas)</td></tr>
      </table>
    </section>
  </div>`;
}

/* =============================== TELA =============================== */
function acoes(a) {
  menuAcoes(a.nome, [
    { icone: 'pencil-simple', rotulo: 'Editar dados básicos', texto: 'Nome, setor, sequência, unidade', acao: () => formAtividade(a) },
    { icone: 'copy', rotulo: 'Duplicar atividade', texto: 'Copia o método, sem as medições', acao: () => duplicarAtividade(a.id) },
    { icone: 'arrows-out-cardinal', rotulo: 'Mover para outro setor', acao: () => moverAtividades([a.id], a.setorId) },
    { icone: 'microsoft-excel-logo', rotulo: 'Exportar para Excel', acao: () => exportarPlanilha({ atividadeId: a.id }, a.nome) },
    { icone: 'printer', rotulo: 'Relatório (PDF / impressão)', acao: () => imprimirRelatorio({ atividadeId: a.id }, a.nome) },
    { icone: 'trash', rotulo: 'Excluir atividade', perigo: true, texto: 'Exclui também as medições', acao: () => excluirComConfirmacao('atividades', [a.id], { aoConcluir: () => ir(`#/estrutura/setor/${a.setorId}`) }) },
  ]);
}

export function telaAtividade(rota) {
  const [, id, aba = 'resumo'] = rota.partes;
  const an = analise(id);
  if (!an) {
    return { titulo: 'Atividade', conteudo: html`<section class="cartao">${vazio({ icone: 'ghost', titulo: 'Atividade não encontrada', acao: html`<a class="btn" href="#/estrutura">Ir para a estrutura</a>` })}</section>` };
  }
  if (ui.atividadeId !== id) {
    ui.atividadeId = id;
    ui.selecao.clear();
    ui.selecionando = false;
    ui.termo = '';
    ui.filtroOperador = '';
    ui.filtroStatus = 'todas';
    ui.rascunho = null;
  }
  const a = an.atividade;
  const c = store.caminho(store.obter('atividades', id));
  const abas = [
    ['resumo', 'Produtividade', 'trend-up'],
    ['medicoes', 'Medições', 'list-numbers', an.total],
    ['metodo', 'Método e cálculo', 'sliders-horizontal'],
    ['info', 'Informações', 'info'],
  ];
  const corpo = aba === 'medicoes' ? abaMedicoes(an) : aba === 'metodo' ? abaMetodo(an) : aba === 'info' ? abaInfo(an) : abaResumo(an);
  return {
    titulo: a.nome,
    migalhas: [
      { rotulo: 'Estrutura', href: '#/estrutura' },
      c.area && { rotulo: c.area.nome, href: `#/estrutura/area/${c.area.id}` },
      c.setor && { rotulo: c.setor.nome, href: `#/estrutura/setor/${c.setor.id}` },
      { rotulo: a.nome },
    ].filter(Boolean),
    conteudo: html`
      ${cabecalho({
        sobre: [c.area?.nome, c.setor?.nome].filter(Boolean).join(' › ') || 'Atividade',
        icone: 'cube',
        titulo: a.nome,
        extra: html`<div class="row wrap"><span class="selo contorno mono" data-dica="Classificação operação.setor.atividade">${store.codigo(store.obter('atividades', id))}</span>${seloSaude(an.saude)}${seloConjunto(store.configDaAtividade(a))}
          <span class="selo contorno">${ic('stack')} ${a.unidade}</span>
          ${a.maquina ? html`<span class="selo contorno">${ic('gear-six')} ${a.maquina}</span>` : nothing}
          ${a.exemplo ? html`<span class="selo marca">exemplo</span>` : nothing}</div>`,
        acoes: html`<button class="btn icone" aria-label="Mais ações" data-dica="Mais ações" @click=${() => acoes(store.obter('atividades', id))}>${ic('dots-three', 'bold')}</button>
          <button class="btn" @click=${() => formMedicao(null, id)}>${ic('plus')} Manual</button>
          <a class="btn primario" href="#/cronometro/${id}">${ic('play', 'fill')} Cronometrar</a>`,
      })}
      <nav class="abas" role="tablist">
        ${abas.map(([k, r, i, n]) => html`<a role="tab" href="#/atividade/${id}/${k}" aria-selected=${aba === k}>${ic(i)} ${r}${n != null ? html`<span class="contador">${n}</span>` : nothing}</a>`)}
      </nav>
      ${corpo}`,
  };
}
