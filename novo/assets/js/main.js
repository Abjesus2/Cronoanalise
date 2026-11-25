// Ponto de entrada: casca da aplicação, roteamento e atalhos globais.
import { html, render, nothing } from './lib.js';
import { store } from './core/store.js';
import { prefs, definirPrefs, aplicarTema, aoMudarPrefs, temaEfetivo } from './core/prefs.js';
import { buscar } from './core/consultas.js';
import { tempoRelativo, prefereMenosMovimento } from './core/util.js';
import { definirRenderizador, atualizar, rotaAtual, ir } from './ui/nav.js';
import { ic, iniciarDicas, abrirDialogo, menuAcoes, toast } from './ui/ui.js';
import { telaPainel } from './views/painel.js';
import { telaEstrutura } from './views/estrutura.js';
import { telaAtividade } from './views/atividade.js';
import { telaCronometro, cronometroAtivo } from './views/cronometro.js';
import { telaMedicoes } from './views/medicoes.js';
import { telaProdutividade } from './views/produtividade.js';
import { telaFluxograma } from './views/fluxograma.js';
import { telaCadastros } from './views/cadastros.js';
import { telaConfiguracoes } from './views/configuracoes.js';
import { telaGuia } from './views/guia.js';
import { formArea, formAtividade, formSetor } from './ui/formularios.js';

const ROTAS = {
  '': telaPainel,
  estrutura: telaEstrutura,
  atividade: telaAtividade,
  cronometro: telaCronometro,
  medicoes: telaMedicoes,
  produtividade: telaProdutividade,
  fluxograma: telaFluxograma,
  cadastros: telaCadastros,
  configuracoes: telaConfiguracoes,
  guia: telaGuia,
};

const NAV = [
  { titulo: null, itens: [['', 'Painel', 'house']] },
  { titulo: 'Trabalho', itens: [['estrutura', 'Estrutura', 'tree-structure'], ['medicoes', 'Medições', 'list-numbers'], ['produtividade', 'Produtividade', 'chart-line-up'], ['fluxograma', 'Fluxograma', 'flow-arrow']] },
  { titulo: 'Apoio', itens: [['cadastros', 'Paradas e motivos', 'list-checks'], ['guia', 'Guia da metodologia', 'book-open'], ['configuracoes', 'Configurações', 'gear-six']] },
];

const raiz = document.getElementById('app');
const emIframe = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

/* ------------------------------ marca ------------------------------ */
function marcaSVG() {
  return html`<svg viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="18" r="11" fill="none" stroke="currentColor" stroke-width="2.4"></circle>
    <rect x="13" y="3" width="6" height="3" rx="1.2" fill="currentColor"></rect>
    <g class="ponteiro" style="transform-origin:16px 18px"><line x1="16" y1="18" x2="16" y2="10.5" stroke="#ff6a2b" stroke-width="2.6" stroke-linecap="round"></line></g>
    <circle cx="16" cy="18" r="2" fill="#ff6a2b"></circle>
  </svg>`;
}

/* ------------------------------ sincronização ------------------------------ */
function estadoSync() {
  const s = store.sync;
  if (s.modo === 'pasta') {
    const p = s.pasta;
    if (p.permissao && p.permissao !== 'granted') return { classe: 'alerta', titulo: 'Reconectar pasta', texto: `Autorize o uso de "${p.nome}"` };
    if (s.sincronizando) return { classe: 'ok pulsa', titulo: 'Sincronizando…', texto: `Pasta ${p.nome}` };
    if (s.erro) return { classe: 'erro', titulo: 'Falha ao salvar na pasta', texto: s.erro };
    return { classe: 'ok', titulo: `Pasta: ${p.nome}`, texto: `Sincronizado ${tempoRelativo(s.ultima)}` };
  }
  if (s.modo !== 'sharepoint') return { classe: 'alerta', titulo: 'Modo local', texto: 'Dados só neste navegador' };
  if (!s.online) return { classe: 'alerta', titulo: 'Offline', texto: s.pendentes ? `${s.pendentes} alteração(ões) aguardando` : 'Trabalhando sem internet' };
  if (s.precisaEntrar) return { classe: 'alerta', titulo: 'Entre na conta', texto: 'Login Microsoft necessário' };
  if (s.sincronizando) return { classe: 'ok pulsa', titulo: 'Sincronizando…', texto: s.pendentes ? `${s.pendentes} pendente(s)` : 'Buscando novidades' };
  if (s.erro) return { classe: 'erro', titulo: 'Falha ao sincronizar', texto: s.erro };
  return { classe: 'ok', titulo: 'SharePoint', texto: `Sincronizado ${tempoRelativo(s.ultima)}` };
}

/* ------------------------------ paleta de comandos ------------------------------ */
const COMANDOS = [
  { rotulo: 'Cronometrar', icone: 'timer', acao: () => ir('#/cronometro') },
  { rotulo: 'Nova atividade', icone: 'cube', acao: () => formAtividade() },
  { rotulo: 'Novo setor', icone: 'squares-four', acao: () => formSetor() },
  { rotulo: 'Nova operação', icone: 'buildings', acao: () => formArea() },
  { rotulo: 'Produtividade por atividade', icone: 'chart-line-up', acao: () => ir('#/produtividade/atividades') },
  { rotulo: 'Produtividade por setor e operação', icone: 'tree-structure', acao: () => ir('#/produtividade/agrupado') },
  { rotulo: 'Planejar equipe', icone: 'users-three', acao: () => ir('#/produtividade/planejamento') },
  { rotulo: 'Fluxograma', icone: 'flow-arrow', acao: () => ir('#/fluxograma') },
  { rotulo: 'Todas as medições', icone: 'list-numbers', acao: () => ir('#/medicoes') },
  { rotulo: 'Importar do sistema antigo', icone: 'download-simple', acao: () => ir('#/configuracoes/dados') },
  { rotulo: 'Pasta compartilhada / banco de dados', icone: 'folder-open', acao: () => ir('#/configuracoes/banco') },
  { rotulo: 'Alternar tema claro/escuro', icone: 'moon', acao: () => definirPrefs({ tema: temaEfetivo() === 'dark' ? 'claro' : 'escuro' }) },
  { rotulo: 'Alternar modo simples/avançado', icone: 'sliders-horizontal', acao: () => definirPrefs({ modo: prefs().modo === 'simples' ? 'avancado' : 'simples' }) },
  { rotulo: 'Guia da metodologia', icone: 'book-open', acao: () => ir('#/guia') },
];
const ICONE_TIPO = { area: 'buildings', setor: 'squares-four', atividade: 'cube', operador: 'user' };
const ROTULO_TIPO = { area: 'Operação', setor: 'Setor', atividade: 'Atividade', operador: 'Operador' };

let paletaAberta = false;
function abrirPaleta() {
  if (paletaAberta) return;
  paletaAberta = true;
  let termo = '';
  let ativo = 0;
  abrirDialogo(({ fechar, atualizar: att }) => {
    const res = buscar(termo, 12).map(r => ({ rotulo: r.item.nome, sub: [ROTULO_TIPO[r.tipo], r.contexto].filter(Boolean).join(' · '), icone: ICONE_TIPO[r.tipo], acao: () => ir(r.rota) }));
    const cmds = COMANDOS.filter(c => !termo || c.rotulo.toLowerCase().includes(termo.toLowerCase()));
    const tudo = [...res, ...cmds];
    ativo = Math.min(ativo, Math.max(0, tudo.length - 1));
    const executar = i => {
      const item = tudo[i];
      if (!item) return;
      fechar();
      item.acao();
    };
    return html`<div class="paleta-busca">${ic('magnifying-glass')}
        <input autofocus placeholder="Buscar atividade, setor, operação, operador ou comando…" .value=${termo} aria-label="Buscar"
          @input=${e => { termo = e.target.value; ativo = 0; att(); }}
          @keydown=${e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); ativo = Math.min(tudo.length - 1, ativo + 1); att(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); ativo = Math.max(0, ativo - 1); att(); }
            else if (e.key === 'Enter') { e.preventDefault(); executar(ativo); }
          }} />
        <kbd>Esc</kbd></div>
      <div class="paleta-lista" role="listbox">
        ${res.length ? html`<div class="paleta-grupo">Resultados</div>` : nothing}
        ${tudo.map((item, i) => html`${i === res.length ? html`<div class="paleta-grupo">Ações</div>` : nothing}
          <button class="item" role="option" aria-selected=${i === ativo} @mouseenter=${() => { ativo = i; att(); }} @click=${() => executar(i)}>
            <span class="avatar">${ic(item.icone)}</span>
            <span class="corpo"><b>${item.rotulo}</b>${item.sub ? html`<span>${item.sub}</span>` : nothing}</span>
            ${i === ativo ? html`<kbd>↵</kbd>` : nothing}
          </button>`)}
        ${!tudo.length ? html`<p class="muted small" style="padding:16px">Nada encontrado para “${termo}”.</p>` : nothing}
      </div>`;
  }, { classe: 'paleta' }).then(() => (paletaAberta = false));
}

/* ------------------------------ casca ------------------------------ */
function sidebar(chave) {
  const s = estadoSync();
  const mini = prefs().sidebarRecolhida;
  const ativo = cronometroAtivo();
  return html`<aside class="sidebar">
    <a class="marca" href="#/">
      <span class="marca-icone">${marcaSVG()}</span>
      <span class="marca-texto"><b>Cronoanálise</b><span>Métodos &amp; Processos</span></span>
    </a>
    <nav class="nav" aria-label="Principal">
      <a class="destaque" href=${ativo ? `#/cronometro/${ativo}` : '#/cronometro'} aria-current=${chave === 'cronometro' ? 'page' : 'false'} data-dica=${mini ? 'Cronometrar' : nothing}>
        ${ic('timer', 'fill')}<span>${ativo ? 'Cronômetro rodando' : 'Cronometrar'}</span>${ativo ? html`<span class="ponto ok pulsa" style="margin-left:auto"></span>` : nothing}</a>
      ${NAV.map(g => html`${g.titulo ? html`<div class="nav-titulo">${g.titulo}</div>` : nothing}
        ${g.itens.map(([r, rot, i]) => html`<a href="#/${r}" aria-current=${chave === r || (r === 'estrutura' && chave === 'atividade') ? 'page' : 'false'} data-dica=${mini ? rot : nothing}>
          ${ic(i, chave === r ? 'fill' : '')}<span>${rot}</span>
          ${r === 'estrutura' ? html`<span class="contador">${store.atividades().length}</span>` : nothing}
          ${r === 'medicoes' ? html`<span class="contador">${store.lista('medicoes').length}</span>` : nothing}
        </a>`)}`)}
    </nav>
    <div class="sidebar-rodape">
      <a class="sync-card" href="#/configuracoes/banco" data-dica=${mini ? `${s.titulo}\n${s.texto}` : nothing}>
        <span class="ponto ${s.classe}"></span>
        <span class="sync-detalhe"><b>${s.titulo}</b><span>${s.texto}</span></span>
      </a>
      <div class="row" style="justify-content:${mini ? 'center' : 'space-between'};flex-wrap:wrap;gap:4px">
        <button class="btn fantasma icone pequeno" aria-label="Alternar tema" data-dica="Tema claro/escuro" @click=${() => definirPrefs({ tema: temaEfetivo() === 'dark' ? 'claro' : 'escuro' })}>${ic(temaEfetivo() === 'dark' ? 'sun' : 'moon')}</button>
        ${mini ? nothing : html`<button class="btn fantasma pequeno" data-dica="Mostrar mais ou menos detalhes" @click=${() => definirPrefs({ modo: prefs().modo === 'simples' ? 'avancado' : 'simples' })}>${ic('sliders-horizontal')} ${prefs().modo === 'simples' ? 'Simples' : 'Avançado'}</button>`}
        <button class="btn fantasma icone pequeno" aria-label=${mini ? 'Expandir menu' : 'Recolher menu'} data-dica=${mini ? 'Expandir menu' : 'Recolher menu'} @click=${() => definirPrefs({ sidebarRecolhida: !mini })}>${ic(mini ? 'caret-double-right' : 'caret-double-left')}</button>
      </div>
    </div>
  </aside>`;
}

function topbar(tela) {
  const s = estadoSync();
  const mig = tela.migalhas || [{ rotulo: tela.titulo }];
  return html`<header class="topbar">
    <a class="marca-icone" href="#/" style="width:34px;height:34px;border-radius:10px;display:none" id="marca-movel" aria-label="Início">${marcaSVG()}</a>
    <nav class="migalhas" aria-label="Você está em">
      ${mig.map((m, i) => html`${i ? html`<span class="sep">/</span>` : nothing}${m.href && i < mig.length - 1 ? html`<a href=${m.href}>${m.rotulo}</a>` : html`<span class="atual">${m.rotulo}</span>`}`)}
    </nav>
    ${emIframe ? html`<a class="btn pequeno" href=${location.href} target="_blank" rel="noopener" data-dica="Abrir em uma aba própria (recomendado)">${ic('arrow-square-out')}<span class="ocultar-movel">Nova aba</span></a>` : nothing}
    <button class="busca-gatilho" @click=${abrirPaleta} aria-label="Buscar (Ctrl+K)">${ic('magnifying-glass')}<span>Buscar ou executar…</span><kbd>Ctrl K</kbd></button>
    <a class="btn fantasma icone mostrar-movel" href="#/configuracoes/banco" aria-label=${s.titulo} data-dica=${`${s.titulo}\n${s.texto}`}><span class="ponto ${s.classe}"></span></a>
  </header>`;
}

function barraInferior(chave) {
  const ativo = cronometroAtivo();
  const mais = () => menuAcoes('Mais opções', [
    { icone: 'list-numbers', rotulo: 'Medições', acao: () => ir('#/medicoes') },
    { icone: 'flow-arrow', rotulo: 'Fluxograma', acao: () => ir('#/fluxograma') },
    { icone: 'list-checks', rotulo: 'Paradas e motivos', acao: () => ir('#/cadastros') },
    { icone: 'book-open', rotulo: 'Guia da metodologia', acao: () => ir('#/guia') },
    { icone: 'gear-six', rotulo: 'Configurações', acao: () => ir('#/configuracoes') },
    { icone: temaEfetivo() === 'dark' ? 'sun' : 'moon', rotulo: 'Alternar tema', acao: () => definirPrefs({ tema: temaEfetivo() === 'dark' ? 'claro' : 'escuro' }) },
  ]);
  const item = (r, rot, i) => html`<a href="#/${r}" aria-current=${chave === r ? 'page' : 'false'}>${ic(i, chave === r ? 'fill' : '')}${rot}</a>`;
  return html`<nav class="barra-inferior" aria-label="Navegação">
    ${item('', 'Início', 'house')}
    ${item('estrutura', 'Estrutura', 'tree-structure')}
    <a class="central" href=${ativo ? `#/cronometro/${ativo}` : '#/cronometro'} aria-label="Cronometrar"><span class="bola">${ic('timer', 'fill')}</span></a>
    ${item('produtividade', 'Análises', 'chart-line-up')}
    <button @click=${mais}>${ic('dots-three-circle')}Mais</button>
  </nav>`;
}

function avisoLogin() {
  const s = store.sync;
  if (s.modo === 'pasta') {
    const p = s.pasta;
    if (p.permissao && p.permissao !== 'granted') {
      return html`<div class="aviso alerta nao-imprimir" style="margin:12px 0">${ic('folder-lock', 'fill')}
        <div class="grow">Para salvar na pasta compartilhada <b>${p.nome}</b>, autorize o navegador (é pedido de novo a cada vez que o site é aberto). Enquanto isso, tudo fica guardado neste computador.</div>
        <button class="btn pequeno primario" @click=${() => store.reconectarPasta().catch(e => toast(e.message, { tipo: 'erro' }))}>Reconectar pasta</button></div>`;
    }
    if (s.erro) {
      return html`<div class="aviso erro nao-imprimir" style="margin:12px 0">${ic('warning-circle', 'fill')}<div class="grow">${s.erro}</div>
        <button class="btn pequeno" @click=${() => store.sincronizar()}>Tentar de novo</button></div>`;
    }
    return nothing;
  }
  if (s.modo !== 'sharepoint' || !s.precisaEntrar || !s.online) return nothing;
  return html`<div class="aviso alerta nao-imprimir" style="margin:12px 0">${ic('sign-in', 'fill')}
    <div class="grow">Entre com a sua conta Microsoft para sincronizar com o SharePoint. Enquanto isso, tudo que você registrar fica guardado neste aparelho.</div>
    <button class="btn pequeno primario" @click=${() => store.entrar().catch(e => toast(e.message, { tipo: 'erro' }))}>Entrar</button></div>`;
}

function telaErro(erro) {
  console.error(erro);
  return {
    titulo: 'Erro',
    conteudo: html`<section class="cartao"><div class="vazio"><div class="ilustra">${ic('bug', 'duo')}</div><h3>Algo deu errado nesta tela</h3>
      <p>${erro?.message || String(erro)}</p><div class="row"><a class="btn" href="#/">Voltar ao painel</a><button class="btn" @click=${() => location.reload()}>Recarregar</button></div></div></section>`,
  };
}

function renderizarApp() {
  const rota = rotaAtual();
  const chave = rota.partes[0] || '';
  let tela;
  try {
    tela = (ROTAS[chave] || telaPainel)(rota);
  } catch (e) {
    tela = telaErro(e);
  }
  document.title = `${tela.titulo} · Cronoanálise`;
  render(html`<div class="app ${prefs().sidebarRecolhida ? 'mini' : ''}">
      ${sidebar(chave)}
      <div class="area-principal">
        ${topbar(tela)}
        <main class="conteudo" id="conteudo">${avisoLogin()}${tela.conteudo}</main>
      </div>
      ${barraInferior(chave)}
    </div>`, raiz);
}

/* ------------------------------ inicialização ------------------------------ */
async function iniciar() {
  // remove a tela de abertura antes do primeiro render (o lit não limpa conteúdo pré-existente);
  // a parte demorada — baixar os módulos — já aconteceu enquanto ela era exibida
  raiz.replaceChildren();
  aplicarTema();
  iniciarDicas();
  definirRenderizador(renderizarApp);
  aoMudarPrefs(() => atualizar());
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { aplicarTema(); atualizar(); });

  let rotaAnterior = location.hash.split('?')[0];
  window.addEventListener('hashchange', () => {
    const nova = location.hash.split('?')[0];
    const mudouTela = nova !== rotaAnterior;
    rotaAnterior = nova;
    if (mudouTela && document.startViewTransition && !prefereMenosMovimento()) {
      const t = document.startViewTransition(() => renderizarApp());
      // navegação rápida interrompe a transição anterior: isso é esperado, não é erro
      [t.ready, t.finished, t.updateCallbackDone].forEach(p => p?.catch(() => {}));
    } else renderizarApp();
    if (mudouTela) window.scrollTo({ top: 0 });
  });
  window.addEventListener('scroll', () => {
    document.querySelector('.topbar')?.classList.toggle('rolou', window.scrollY > 4);
  }, { passive: true });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      abrirPaleta();
    } else if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]') && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      abrirPaleta();
    }
  });

  store.assinar(atualizar);
  await store.iniciar();
  renderizarApp();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker', e));
  }
}

iniciar().catch(e => {
  console.error(e);
  raiz.innerHTML = `<div style="padding:40px;font-family:system-ui"><h2>Não foi possível iniciar o sistema</h2><p>${String(e?.message || e)}</p></div>`;
});
