// Estrutura: Operações → Setores → Atividades (com métricas agregadas).
import { html, nothing } from '../lib.js';
import { store } from '../core/store.js';
import { analise, grupo } from '../core/consultas.js';
import { fmtTempo } from '../core/time.js';
import { combina, fmtQtd, fmtPct, ordenarPor, tempoRelativo, fmtNum } from '../core/util.js';
import { ic, num, anel, seloSaude, seloConjunto, vazio, ajuda, menuAcoes, medidor, toast } from '../ui/ui.js';
import { cabecalho } from '../ui/layout.js';
import { barrasH, cartaoGrafico, tabelaSimples } from '../ui/charts.js';
import { formArea, formSetor, formAtividade, excluirComConfirmacao, moverAtividades, duplicarAtividade } from '../ui/formularios.js';
import { atualizar, ir } from '../ui/nav.js';
import { carregarExemplo } from '../core/exemplo.js';
import { exportarPlanilha } from '../core/exportar.js';

const ui = {
  termo: '',
  ordem: 'seq',
  selecao: new Set(),
  selecionando: false,
  abertos: new Set(),
  contexto: '',
};

function resetarSeContextoMudou(chave) {
  if (ui.contexto !== chave) {
    ui.contexto = chave;
    ui.selecao.clear();
    ui.selecionando = false;
    ui.termo = '';
  }
}

/* ------------------------------ árvore lateral ------------------------------ */
function arvore(atual) {
  const caminho = atual.atividade ? store.caminho(atual.atividade) : atual.setor ? store.caminho(atual.setor) : { area: atual.area };
  if (caminho.area) ui.abertos.add(caminho.area.id);
  if (caminho.setor) ui.abertos.add(caminho.setor.id);
  const alternar = (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    ui.abertos.has(id) ? ui.abertos.delete(id) : ui.abertos.add(id);
    atualizar();
  };
  return html`<nav class="arvore" aria-label="Árvore da estrutura">
    <a class="no ${!atual.area && !atual.setor ? 'ativo' : ''}" href="#/estrutura">${ic('buildings')}<span>Todas as operações</span></a>
    ${store.areas().map(a => html`
      <a class="no ${atual.area?.id === a.id ? 'ativo' : ''}" href="#/estrutura/area/${a.id}">
        <button class="seta ${ui.abertos.has(a.id) ? 'aberta' : ''}" aria-label="Expandir" @click=${e => alternar(e, a.id)}>${ic('caret-right', 'bold')}</button>
        <span>${a.nome}</span><small>${store.setores(a.id).length}</small>
      </a>
      ${ui.abertos.has(a.id) ? html`<div class="filhos">${store.setores(a.id).map(s => html`
        <a class="no ${atual.setor?.id === s.id ? 'ativo' : ''}" href="#/estrutura/setor/${s.id}">
          <button class="seta ${ui.abertos.has(s.id) ? 'aberta' : ''}" aria-label="Expandir" @click=${e => alternar(e, s.id)}>${ic('caret-right', 'bold')}</button>
          <span>${s.nome}</span><small>${store.atividades(s.id).length}</small>
        </a>
        ${ui.abertos.has(s.id) ? html`<div class="filhos">${store.atividades(s.id).map(at => html`
          <a class="no" href="#/atividade/${at.id}">${ic('cube')}<span>${at.nome}</span></a>`)}</div>` : nothing}`)}</div>` : nothing}`)}
  </nav>`;
}

/* ------------------------------ barra de ferramentas ------------------------------ */
function ferramentas(opcoesOrdem, { col, paiId, extras } = {}) {
  return html`<div class="ferramentas">
    <div class="busca-local">${ic('magnifying-glass')}
      <input class="entrada" type="search" placeholder="Filtrar…" .value=${ui.termo} @input=${e => { ui.termo = e.target.value; atualizar(); }} aria-label="Filtrar" />
    </div>
    <select class="entrada" style="width:auto" aria-label="Ordenar por" @change=${e => { ui.ordem = e.target.value; atualizar(); }}>
      ${opcoesOrdem.map(([v, r]) => html`<option value=${v} ?selected=${ui.ordem === v}>${r}</option>`)}
    </select>
    ${extras || nothing}
    <button class="btn" aria-pressed=${ui.selecionando} @click=${() => { ui.selecionando = !ui.selecionando; ui.selecao.clear(); atualizar(); }}>
      ${ic(ui.selecionando ? 'x' : 'check-square-offset')} ${ui.selecionando ? 'Cancelar seleção' : 'Selecionar'}
    </button>
  </div>`;
}

function barraSelecao(col, itensVisiveis, acoes) {
  if (!ui.selecionando) return nothing;
  const n = ui.selecao.size;
  const todos = itensVisiveis.length && itensVisiveis.every(i => ui.selecao.has(i.id));
  return html`<div class="barra-selecao">
    <label class="check"><input type="checkbox" .checked=${todos} @change=${e => {
      itensVisiveis.forEach(i => (e.target.checked ? ui.selecao.add(i.id) : ui.selecao.delete(i.id)));
      atualizar();
    }} /> <b>${n} selecionado(s)</b></label>
    <span class="grow"></span>
    ${acoes}
    <button class="btn perigo-cheio pequeno" ?disabled=${!n} @click=${async () => {
      if (await excluirComConfirmacao(col, [...ui.selecao])) { ui.selecao.clear(); ui.selecionando = false; atualizar(); }
    }}>${ic('trash')} Excluir</button>
  </div>`;
}

function marcador(id) {
  if (!ui.selecionando) return nothing;
  return html`<input type="checkbox" class="marcador" aria-label="Selecionar" .checked=${ui.selecao.has(id)}
    @click=${e => e.stopPropagation()} @change=${e => { e.target.checked ? ui.selecao.add(id) : ui.selecao.delete(id); atualizar(); }} />`;
}

function clicarCartao(e, id, href) {
  if (ui.selecionando) {
    e.preventDefault();
    ui.selecao.has(id) ? ui.selecao.delete(id) : ui.selecao.add(id);
    atualizar();
    return;
  }
  ir(href);
}

/* ------------------------------ nível: áreas ------------------------------ */
function telaAreas() {
  resetarSeContextoMudou('areas');
  let areas = store.areas().filter(a => combina(a.nome, ui.termo));
  const g = Object.fromEntries(areas.map(a => [a.id, grupo({ areaId: a.id })]));
  if (ui.ordem === 'nome') areas = ordenarPor(areas, a => a.nome);
  if (ui.ordem === 'medicoes') areas = ordenarPor(areas, a => -g[a.id].medicoes);
  if (ui.ordem === 'recente') areas = ordenarPor(areas, a => -(new Date(g[a.id].ultima || 0).getTime()));

  const conteudo = store.areas().length
    ? html`
      ${ferramentas([['seq', 'Sequência'], ['nome', 'Nome (A–Z)'], ['medicoes', 'Mais medições'], ['recente', 'Medidas recentemente']])}
      ${barraSelecao('areas', areas, nothing)}
      <div class="grade entrar">
        ${areas.map((a, i) => {
          const gr = g[a.id];
          return html`<article class="cartao clicavel selecionavel ent-card ${ui.selecao.has(a.id) ? 'marcado' : ''}" style="--i:${i}" tabindex="0"
            @click=${e => clicarCartao(e, a.id, `#/estrutura/area/${a.id}`)} @keydown=${e => e.key === 'Enter' && clicarCartao(e, a.id, `#/estrutura/area/${a.id}`)}>
            ${marcador(a.id)}
            <div class="topo">
              <span class="seq">${a.seq ?? '–'}</span>
              <div class="grow stack tight"><h3>${a.nome}</h3>
                <span class="small muted">${store.setores(a.id).length} setor(es) · ${gr.nAtividades} atividade(s)${a.exemplo ? ' · exemplo' : ''}</span>${a.configId && store.conjuntoValido(a.configId) ? html`<span style="margin-top:4px" @click=${e => e.stopPropagation()}>${seloConjunto(store.configDaArea(a.id))}</span>` : nothing}</div>
              ${ui.selecionando ? nothing : html`<button class="btn fantasma icone pequeno menu-card" aria-label="Ações" @click=${e => { e.stopPropagation(); acoesArea(a); }}>${ic('dots-three', 'bold')}</button>`}
            </div>
            ${medidor(gr.nAtividades ? gr.nComTP / gr.nAtividades : 0, 'good')}
            <div class="metricas">
              <div><b>${num(gr.medicoes, 'int')}</b><span>medições</span></div>
              <div><b>${gr.nComTP}/${gr.nAtividades}</b><span>com tempo padrão</span></div>
              <div><b>${gr.ultima ? tempoRelativo(gr.ultima) : '—'}</b><span>última medição</span></div>
            </div>
          </article>`;
        })}
        <button class="cartao clicavel" style="border-style:dashed;display:grid;place-items:center;min-height:180px;background:transparent;color:var(--ink-2);font-weight:650" @click=${() => formArea()}>
          <span class="stack tight" style="align-items:center">${ic('plus-circle', 'duo')}<span>Nova operação</span></span>
        </button>
      </div>`
    : html`<section class="cartao">${vazio({
        icone: 'buildings',
        titulo: 'Comece pela primeira operação',
        texto: 'A estrutura organiza o trabalho em Operações → Setores → Atividades. Cada nível mostra a produtividade agrupada.',
        acao: html`<div class="row wrap" style="justify-content:center">
          <button class="btn primario" @click=${() => formArea()}>${ic('plus')} Criar operação</button>
          <button class="btn" @click=${() => carregarExemplo()}>${ic('sparkle')} Carregar exemplo</button></div>`,
      })}</section>`;

  return {
    titulo: 'Estrutura',
    migalhas: [{ rotulo: 'Estrutura' }],
    conteudo: html`
      ${cabecalho({
        sobre: 'Estrutura',
        icone: 'tree-structure',
        titulo: 'Operações',
        texto: 'Organize o trabalho e veja a produtividade agrupada de cada operação.',
        acoes: html`<button class="btn" @click=${() => exportarPlanilha({}, 'estrutura-completa')}>${ic('microsoft-excel-logo')} Exportar tudo</button>
          <button class="btn primario" @click=${() => formArea()}>${ic('plus')} Nova operação</button>`,
      })}
      <div class="explorador">${arvore({})}<div class="stack">${conteudo}</div></div>`,
  };
}

function acoesArea(a) {
  menuAcoes(a.nome, [
    { icone: 'pencil-simple', rotulo: 'Editar operação', acao: () => formArea(a) },
    { icone: 'plus', rotulo: 'Novo setor nesta operação', acao: () => formSetor(null, a.id) },
    { icone: 'microsoft-excel-logo', rotulo: 'Exportar para Excel', acao: () => exportarPlanilha({ areaId: a.id }, a.nome) },
    { icone: 'trash', rotulo: 'Excluir operação', perigo: true, texto: 'Exclui setores, atividades e medições', acao: () => excluirComConfirmacao('areas', [a.id], { aoConcluir: () => ir('#/estrutura') }) },
  ]);
}

function acoesSetor(s) {
  menuAcoes(s.nome, [
    { icone: 'pencil-simple', rotulo: 'Editar setor', texto: 'Nome, operação e sequência', acao: () => formSetor(s) },
    { icone: 'plus', rotulo: 'Nova atividade neste setor', acao: () => formAtividade(null, s.id) },
    { icone: 'microsoft-excel-logo', rotulo: 'Exportar para Excel', acao: () => exportarPlanilha({ setorId: s.id }, s.nome) },
    { icone: 'trash', rotulo: 'Excluir setor', perigo: true, texto: 'Exclui atividades e medições', acao: () => excluirComConfirmacao('setores', [s.id], { aoConcluir: () => ir(`#/estrutura/area/${s.areaId}`) }) },
  ]);
}

/* ------------------------------ resumo do grupo ------------------------------ */
export function avisoUnidadesMistas(gr) {
  return html`<div class="aviso info">${ic('stack', 'fill')}<div>Este grupo reúne atividades com <b>unidades diferentes</b> (${gr.unidades.join(', ')}).
    Tempo padrão total, capacidade do fluxo, gargalo e balanceamento só são calculados quando todas as atividades medem a mesma unidade.
    A produtividade de cada atividade continua disponível individualmente.</div></div>`;
}

export function resumoGrupo(gr, unidade = 'un.') {
  if (gr.unidadesMistas) {
    return html`<section class="cartao stack">
      ${avisoUnidadesMistas(gr)}
      <div class="grade g4">
        <div class="estat"><span class="rotulo-estat">Atividades com tempo padrão</span><span class="valor">${gr.nComTP}<small>de ${gr.nAtividades}</small></span></div>
        <div class="estat"><span class="rotulo-estat">Medições válidas</span><span class="valor">${num(gr.validas, 'int')}</span><span class="sub">${gr.medicoes} no total</span></div>
        <div class="estat"><span class="rotulo-estat">Amostras confiáveis ${ajuda('ciclos')}</span><span class="valor">${num(gr.coberturaAmostra, 'pct0')}</span></div>
        <div class="estat"><span class="rotulo-estat">CV médio ${ajuda('cv')}</span><span class="valor">${num(gr.cvMedio, 'pct')}</span></div>
      </div>
    </section>`;
  }
  return html`<section class="cartao tinta">
    <div class="grade g4" style="gap:22px">
      <div class="estat"><span class="rotulo-estat">Tempo padrão total ${ajuda('tpTotal')}</span>
        <span class="valor">${gr.tpTotal ? fmtTempo(gr.tpTotal) : '—'}</span><span class="sub">soma de ${gr.nComTP} atividade(s)</span></div>
      <div class="estat"><span class="rotulo-estat">Capacidade do fluxo ${ajuda('capacidadeFluxo')}</span>
        <span class="valor">${num(gr.capacidadeFluxo?.hora)}<small>${unidade}/h</small></span>
        <span class="sub">${gr.capacidadeFluxo ? `${fmtQtd(gr.capacidadeFluxo.dia)} por dia` : 'precisa de tempos padrão'}</span></div>
      <div class="estat"><span class="rotulo-estat">Gargalo ${ajuda('capacidadeFluxo')}</span>
        <span class="valor" style="font-size:1.2rem;line-height:1.3">${gr.gargalo ? gr.gargalo.analise.atividade.nome : '—'}</span>
        <span class="sub">${gr.gargalo ? `${fmtTempo(gr.gargalo.tc)} por ${unidade} (com ${gr.gargalo.analise.pessoas} pessoa(s))` : ''}</span></div>
      <div class="estat"><span class="rotulo-estat">Produtividade por pessoa ${ajuda('tpTotal')}</span>
        <span class="valor">${num(gr.prodPessoa?.hora)}<small>${unidade}/h</small></span><span class="sub">fluxo completo, 1 pessoa</span></div>
      <div class="estat"><span class="rotulo-estat">Balanceamento ${ajuda('balanceamento')}</span>
        <span class="valor">${num(gr.eficienciaBalanceamento, 'pct0')}</span><span class="sub">${gr.pessoasTotal || 0} pessoa(s) alocadas</span></div>
      <div class="estat"><span class="rotulo-estat">Amostras confiáveis ${ajuda('ciclos')}</span>
        <span class="valor">${num(gr.coberturaAmostra, 'pct0')}</span><span class="sub">${gr.medicoes} medições · CV médio ${fmtPct(gr.cvMedio)}</span></div>
    </div>
  </section>`;
}

/* ------------------------------ nível: setores de uma área ------------------------------ */
function telaArea(id) {
  const area = store.obter('areas', id);
  if (!area) return naoEncontrado();
  resetarSeContextoMudou('area:' + id);
  const gr = grupo({ areaId: id });
  let setores = store.setores(id).filter(s => combina(s.nome, ui.termo));
  const gs = Object.fromEntries(setores.map(s => [s.id, grupo({ setorId: s.id })]));
  if (ui.ordem === 'nome') setores = ordenarPor(setores, s => s.nome);
  if (ui.ordem === 'medicoes') setores = ordenarPor(setores, s => -gs[s.id].medicoes);
  if (ui.ordem === 'capacidade') setores = ordenarPor(setores, s => -(gs[s.id].capacidadeFluxo?.hora ?? -1));

  return {
    titulo: area.nome,
    migalhas: [{ rotulo: 'Estrutura', href: '#/estrutura' }, { rotulo: area.nome }],
    conteudo: html`
      ${cabecalho({
        sobre: 'Operação',
        icone: 'buildings',
        titulo: area.nome,
        extra: html`<div class="row wrap">${seloConjunto(store.configDaArea(area.id), { mostrarPadrao: true, prefixo: 'Parâmetros: ' })}</div>`,
        texto: area.descricao || `${setores.length} setor(es) · ${gr.nAtividades} atividade(s) · ${gr.medicoes} medições`,
        acoes: html`<button class="btn icone" aria-label="Mais ações" data-dica="Mais ações" @click=${() => acoesArea(area)}>${ic('dots-three', 'bold')}</button>
          <a class="btn" href="#/produtividade?area=${area.id}">${ic('chart-line-up')} Produtividade</a>
          <button class="btn primario" @click=${() => formSetor(null, id)}>${ic('plus')} Novo setor</button>`,
      })}
      <div class="explorador">${arvore({ area })}
        <div class="stack">
          ${gr.nComTP ? resumoGrupo(gr) : nothing}
          ${store.setores(id).length ? html`
            ${ferramentas([['seq', 'Sequência do fluxo'], ['nome', 'Nome (A–Z)'], ['medicoes', 'Mais medições'], ['capacidade', 'Maior capacidade']])}
            ${barraSelecao('setores', setores, nothing)}
            <div class="grade entrar">
              ${setores.map((s, i) => {
                const g = gs[s.id];
                return html`<article class="cartao clicavel selecionavel ent-card ${ui.selecao.has(s.id) ? 'marcado' : ''}" style="--i:${i}" tabindex="0"
                  @click=${e => clicarCartao(e, s.id, `#/estrutura/setor/${s.id}`)} @keydown=${e => e.key === 'Enter' && clicarCartao(e, s.id, `#/estrutura/setor/${s.id}`)}>
                  ${marcador(s.id)}
                  <div class="topo">
                    <span class="seq">${s.seq ?? '–'}</span>
                    <div class="grow stack tight"><h3>${s.nome}</h3><span class="small muted">${g.nAtividades} atividade(s) · ${g.medicoes} medições</span>${s.configId && store.conjuntoValido(s.configId) ? html`<span style="margin-top:4px" @click=${e => e.stopPropagation()}>${seloConjunto(store.configDoSetor(s.id), { mostrarPadrao: true, prefixo: 'próprio: ' })}</span>` : nothing}</div>
                    ${ui.selecionando ? nothing : html`<button class="btn fantasma icone pequeno menu-card" aria-label="Ações" @click=${e => { e.stopPropagation(); acoesSetor(s); }}>${ic('dots-three', 'bold')}</button>`}
                  </div>
                  ${medidor(g.nAtividades ? g.nComTP / g.nAtividades : 0, 'good')}
                  <div class="metricas">
                    <div><b>${g.tpTotal ? fmtTempo(g.tpTotal) : '—'}</b><span>TP total</span></div>
                    <div><b>${g.capacidadeFluxo ? fmtQtd(g.capacidadeFluxo.hora) : '—'}</b><span>por hora</span></div>
                    <div><b class="truncate">${g.gargalo ? g.gargalo.analise.atividade.nome : '—'}</b><span>gargalo</span></div>
                  </div>
                </article>`;
              })}
              <button class="cartao clicavel" style="border-style:dashed;display:grid;place-items:center;min-height:180px;background:transparent;color:var(--ink-2);font-weight:650" @click=${() => formSetor(null, id)}>
                <span class="stack tight" style="align-items:center">${ic('plus-circle', 'duo')}<span>Novo setor</span></span>
              </button>
            </div>`
          : html`<section class="cartao">${vazio({ icone: 'squares-four', titulo: 'Nenhum setor nesta operação', texto: 'Setores reúnem atividades em sequência (ex.: Corte → Costura → Montagem).', acao: html`<button class="btn primario" @click=${() => formSetor(null, id)}>${ic('plus')} Criar setor</button>` })}</section>`}
        </div>
      </div>`,
  };
}

/* ------------------------------ nível: atividades de um setor ------------------------------ */
function telaSetor(id) {
  const setor = store.obter('setores', id);
  if (!setor) return naoEncontrado();
  resetarSeContextoMudou('setor:' + id);
  const area = store.obter('areas', setor.areaId);
  const gr = grupo({ setorId: id });
  let ats = store.atividades(id).filter(a => combina(`${a.nome} ${a.descricao || ''}`, ui.termo));
  const an = Object.fromEntries(ats.map(a => [a.id, analise(a.id)]));
  if (ui.ordem === 'nome') ats = ordenarPor(ats, a => a.nome);
  if (ui.ordem === 'tp') ats = ordenarPor(ats, a => -(an[a.id].tempoPadrao ?? -1));
  if (ui.ordem === 'capacidade') ats = ordenarPor(ats, a => -(an[a.id].prodPessoa?.hora ?? -1));
  if (ui.ordem === 'medicoes') ats = ordenarPor(ats, a => -an[a.id].total);
  if (ui.ordem === 'confiabilidade') ats = ordenarPor(ats, a => an[a.id].confiabilidade ?? -1);
  const unidade = ats[0] ? an[ats[0].id].atividade.unidade : 'un.';

  const barras = ats.filter(a => an[a.id].tempoPadrao > 0).map(a => {
    const x = an[a.id];
    const tc = x.tempoPadrao / x.pessoas;
    return {
      rotulo: a.nome,
      sub: x.pessoas > 1 ? `${x.pessoas} pessoas` : null,
      valor: tc,
      texto: fmtTempo(tc),
      destaque: gr.gargalo?.analise.atividade.id === a.id,
      href: `#/atividade/${a.id}`,
      dica: `Tempo padrão ${fmtTempo(x.tempoPadrao)} ÷ ${x.pessoas} pessoa(s)\n${fmtQtd(3600 / tc)} ${x.atividade.unidade}/h nesta etapa`,
    };
  });

  return {
    titulo: setor.nome,
    migalhas: [{ rotulo: 'Estrutura', href: '#/estrutura' }, { rotulo: area?.nome || 'Operação', href: `#/estrutura/area/${setor.areaId}` }, { rotulo: setor.nome }],
    conteudo: html`
      ${cabecalho({
        sobre: area?.nome || 'Setor',
        icone: 'squares-four',
        titulo: setor.nome,
        extra: html`<div class="row wrap">${seloConjunto(store.configDoSetor(setor.id), { mostrarPadrao: true, prefixo: setor.configId ? 'Parâmetros próprios: ' : 'Parâmetros: ' })}</div>`,
        texto: setor.descricao || `${ats.length} atividade(s) · ${gr.medicoes} medições`,
        acoes: html`<button class="btn icone" aria-label="Mais ações" data-dica="Mais ações" @click=${() => acoesSetor(setor)}>${ic('dots-three', 'bold')}</button>
          <a class="btn" href="#/fluxograma?area=${setor.areaId}&setor=${id}">${ic('flow-arrow')} Fluxograma</a>
          <button class="btn primario" @click=${() => formAtividade(null, id)}>${ic('plus')} Nova atividade</button>`,
      })}
      <div class="explorador">${arvore({ setor })}
        <div class="stack">
          ${gr.nComTP ? resumoGrupo(gr, unidade) : nothing}
          ${barras.length > 1 && !gr.unidadesMistas ? cartaoGrafico({
            id: 'bal-' + id,
            titulo: 'Balanceamento da linha',
            sub: 'Tempo de ciclo de cada etapa (TP ÷ pessoas). Em laranja, o gargalo que limita a produção.',
            ajudaChave: 'balanceamento',
            corpo: barrasH(barras),
            tabela: () => tabelaSimples(
              [{ rotulo: 'Atividade', v: b => b.rotulo }, { rotulo: 'Tempo de ciclo', n: true, v: b => b.texto }, { rotulo: 'Gargalo', v: b => (b.destaque ? 'Sim' : '') }],
              barras,
            ),
          }) : nothing}
          ${store.atividades(id).length ? html`
            ${ferramentas([['seq', 'Sequência'], ['nome', 'Nome (A–Z)'], ['tp', 'Maior tempo padrão'], ['capacidade', 'Maior produtividade'], ['medicoes', 'Mais medições'], ['confiabilidade', 'Menor confiabilidade']])}
            ${barraSelecao('atividades', ats, html`
              <button class="btn pequeno" ?disabled=${!ui.selecao.size} @click=${async () => { if (await moverAtividades([...ui.selecao], id)) { ui.selecao.clear(); ui.selecionando = false; } }}>${ic('arrows-out-cardinal')} Mover</button>
              <button class="btn pequeno" ?disabled=${!ui.selecao.size} @click=${() => { [...ui.selecao].forEach(duplicarAtividade); ui.selecao.clear(); ui.selecionando = false; }}>${ic('copy')} Duplicar</button>`)}
            <div class="tabela-wrap">
              <table class="tabela">
                <thead><tr>
                  ${ui.selecionando ? html`<th class="chk"></th>` : nothing}
                  <th style="width:64px">Cód.</th><th>Atividade</th><th class="n">Medições</th><th class="n">Tempo padrão</th>
                  <th class="n">Por hora/pessoa</th><th class="n">Pessoas</th><th class="n">CV</th><th>Situação</th><th></th>
                </tr></thead>
                <tbody>
                  ${ats.map(a => {
                    const x = an[a.id];
                    const marcado = ui.selecao.has(a.id);
                    return html`<tr class="clicavel ${marcado ? 'selecionada' : ''} ${gr.gargalo?.analise.atividade.id === a.id ? 'gargalo' : ''}"
                      @click=${() => (ui.selecionando ? (marcado ? ui.selecao.delete(a.id) : ui.selecao.add(a.id), atualizar()) : ir(`#/atividade/${a.id}`))}>
                      ${ui.selecionando ? html`<td class="chk"><input type="checkbox" .checked=${marcado} @click=${e => e.stopPropagation()} @change=${e => { e.target.checked ? ui.selecao.add(a.id) : ui.selecao.delete(a.id); atualizar(); }} /></td>` : nothing}
                      <td class="mono muted">${store.codigo(a)}</td>
                      <td><div class="stack tight" style="gap:0"><b>${a.nome}</b>${gr.gargalo?.analise.atividade.id === a.id ? html`<span class="selo serious" style="align-self:flex-start;margin-top:4px">${ic('funnel-simple', 'fill')} gargalo</span>` : nothing}</div></td>
                      <td class="n"><span class="row" style="justify-content:flex-end;gap:8px">${x.nValidas}${x.ciclos.necessario ? html`<span class="muted">/ ${x.ciclos.necessario}</span>` : nothing}</span></td>
                      <td class="n mono">${x.tempoPadrao ? fmtTempo(x.tempoPadrao) : '—'}</td>
                      <td class="n"><b>${x.prodPessoa ? fmtQtd(x.prodPessoa.hora) : '—'}</b> <span class="muted small">${x.atividade.unidade}</span></td>
                      <td class="n">${x.pessoas}</td>
                      <td class="n">${fmtPct(x.est.cv)}</td>
                      <td>${seloSaude(x.saude)}</td>
                      <td class="n"><a class="btn fantasma icone pequeno" href="#/cronometro/${a.id}" aria-label="Cronometrar" data-dica="Cronometrar" @click=${e => e.stopPropagation()}>${ic('timer')}</a></td>
                    </tr>`;
                  })}
                </tbody>
              </table>
            </div>`
          : html`<section class="cartao">${vazio({ icone: 'cube', titulo: 'Nenhuma atividade neste setor', texto: 'Cadastre as operações na ordem em que acontecem.', acao: html`<button class="btn primario" @click=${() => formAtividade(null, id)}>${ic('plus')} Nova atividade</button>` })}</section>`}
        </div>
      </div>`,
  };
}

function naoEncontrado() {
  return {
    titulo: 'Não encontrado',
    conteudo: html`<section class="cartao">${vazio({ icone: 'ghost', titulo: 'Item não encontrado', texto: 'Ele pode ter sido excluído ou movido.', acao: html`<a class="btn" href="#/estrutura">Voltar para a estrutura</a>` })}</section>`,
  };
}

export function telaEstrutura(rota) {
  const [, nivel, id] = rota.partes;
  if (nivel === 'area' && id) return telaArea(id);
  if (nivel === 'setor' && id) return telaSetor(id);
  return telaAreas();
}
