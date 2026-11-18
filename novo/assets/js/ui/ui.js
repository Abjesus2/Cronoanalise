// Componentes de interface reutilizáveis.
import { html, render, nothing } from '../lib.js';
import { combina, fmtQtd, fmtNum, fmtPct, prefereMenosMovimento, finito } from '../core/util.js';
import { fmtTempo } from '../core/time.js';
import { ROTULO_SAUDE } from '../core/calc.js';
import { AJUDA } from './ajuda.js';

/* ------------------------------ ícones ------------------------------ */
export function ic(nome, estilo = '') {
  const familia = estilo === 'fill' ? 'ph-fill' : estilo === 'bold' ? 'ph-bold' : estilo === 'duo' ? 'ph-duotone' : 'ph';
  return html`<i class="${familia} ph-${nome} ico" aria-hidden="true"></i>`;
}

/* ------------------------------ toasts ------------------------------ */
let raizToasts;
export function toast(mensagem, { tipo = 'ok', acao, rotuloAcao = 'Desfazer', duracao = 4200 } = {}) {
  if (!raizToasts) {
    raizToasts = document.createElement('div');
    raizToasts.className = 'toasts';
    raizToasts.setAttribute('role', 'status');
    raizToasts.setAttribute('aria-live', 'polite');
    document.body.appendChild(raizToasts);
  }
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  const icone = tipo === 'erro' ? 'x-circle' : tipo === 'aviso' ? 'warning' : tipo === 'info' ? 'info' : 'check-circle';
  const fechar = () => {
    el.classList.add('saindo');
    setTimeout(() => el.remove(), 260);
  };
  render(
    html`${ic(icone, 'fill')}<span class="grow">${mensagem}</span>${acao
      ? html`<button class="btn" @click=${() => { acao(); fechar(); }}>${rotuloAcao}</button>`
      : nothing}`,
    el,
  );
  raizToasts.appendChild(el);
  setTimeout(fechar, acao ? duracao + 2500 : duracao);
}

/* ------------------------------ diálogos ------------------------------ */
/**
 * Abre um <dialog> modal. `conteudo(ctx)` devolve o template; ctx = { fechar, atualizar }.
 * Retorna uma Promise resolvida com o valor passado a fechar().
 */
export function abrirDialogo(conteudo, { classe = '', aoFechar } = {}) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = `dlg ${classe}`;
    let valor;
    const ctx = {
      fechar: v => {
        valor = v;
        dlg.close();
      },
      atualizar: () => render(conteudo(ctx), dlg),
      el: dlg,
    };
    dlg.addEventListener('close', () => {
      aoFechar?.(valor);
      resolve(valor);
      setTimeout(() => dlg.remove(), 50);
    });
    dlg.addEventListener('click', e => {
      if (e.target === dlg && !classe.includes('fixo')) ctx.fechar(undefined);
    });
    document.body.appendChild(dlg);
    ctx.atualizar();
    dlg.showModal();
    const foco = dlg.querySelector('[autofocus]');
    if (foco) setTimeout(() => foco.focus(), 30);
  });
}

export function topoDialogo({ icone = 'info', titulo, texto, perigo = false, fechar }) {
  return html`<div class="dlg-topo">
    <div class="icone-dlg ${perigo ? 'perigo' : ''}">${ic(icone, 'duo')}</div>
    <div class="grow">
      <h2>${titulo}</h2>
      ${texto ? html`<p>${texto}</p>` : nothing}
    </div>
    ${fechar ? html`<button class="btn fantasma icone pequeno dlg-fechar" aria-label="Fechar" @click=${() => fechar()}>${ic('x')}</button>` : nothing}
  </div>`;
}

export function confirmar({ titulo, mensagem, confirmar = 'Confirmar', perigo = false, icone }) {
  return abrirDialogo(
    ({ fechar }) => html`
      ${topoDialogo({ icone: icone || (perigo ? 'trash' : 'question'), titulo, texto: mensagem, perigo })}
      <div class="dlg-rodape">
        <button class="btn" @click=${() => fechar(false)}>Cancelar</button>
        <button class="btn ${perigo ? 'perigo-cheio' : 'primario'}" autofocus @click=${() => fechar(true)}>${confirmar}</button>
      </div>`,
    { classe: 'estreito' },
  ).then(Boolean);
}

export function pedirTexto({ titulo, texto, rotulo, valor = '', placeholder = '', confirmar = 'Salvar', icone = 'pencil-simple' }) {
  let atual = valor;
  return abrirDialogo(
    ({ fechar }) => html`
      <form @submit=${e => { e.preventDefault(); fechar(atual.trim() || null); }}>
        ${topoDialogo({ icone, titulo, texto })}
        <div class="dlg-corpo">
          <div class="campo">
            <label for="pt-in">${rotulo}</label>
            <input id="pt-in" class="entrada" .value=${atual} placeholder=${placeholder} autofocus required @input=${e => (atual = e.target.value)} />
          </div>
        </div>
        <div class="dlg-rodape">
          <button type="button" class="btn" @click=${() => fechar(null)}>Cancelar</button>
          <button class="btn primario">${confirmar}</button>
        </div>
      </form>`,
    { classe: 'estreito' },
  );
}

/* ------------------------------ ajuda ------------------------------ */
export function abrirAjuda(chave) {
  const a = AJUDA[chave];
  if (!a) return;
  abrirDialogo(({ fechar }) => html`
    ${topoDialogo({ icone: a.icone || 'function', titulo: a.titulo, fechar })}
    <div class="dlg-corpo">
      ${a.oque ? html`<p>${a.oque}</p>` : nothing}
      ${a.formula ? html`<div class="formula">${a.formula}</div>` : nothing}
      ${a.exemplo ? html`<div class="aviso info">${ic('lightbulb', 'fill')}<div><b>Exemplo</b><br />${a.exemplo}</div></div>` : nothing}
      ${a.leitura ? html`<div><h4>Como interpretar</h4><p class="soft mt-s">${a.leitura}</p></div>` : nothing}
    </div>
    <div class="dlg-rodape">
      <a class="btn fantasma" href="#/guia" @click=${() => fechar()}>${ic('book-open')} Guia da metodologia</a>
      <button class="btn escuro" @click=${() => fechar()}>Entendi</button>
    </div>`);
}

export function ajuda(chave, rotulo = 'Como é calculado?') {
  return html`<button type="button" class="ajuda-btn" aria-label=${rotulo} data-dica=${rotulo} @click=${e => { e.stopPropagation(); e.preventDefault(); abrirAjuda(chave); }}>${ic('question')}</button>`;
}

/* ------------------------------ dicas (tooltip) ------------------------------ */
export function iniciarDicas() {
  const dica = document.createElement('div');
  dica.className = 'dica';
  dica.setAttribute('role', 'tooltip');
  document.body.appendChild(dica);
  let alvo = null;

  const posicionar = (x, y) => {
    const r = dica.getBoundingClientRect();
    let left = x + 14;
    let top = y + 16;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > innerHeight - 8) top = y - r.height - 12;
    dica.style.left = Math.max(8, left) + 'px';
    dica.style.top = Math.max(8, top) + 'px';
  };
  const mostrar = (el, x, y) => {
    alvo = el;
    dica.replaceChildren();
    const titulo = el.getAttribute('data-dica-titulo');
    if (titulo) {
      const b = document.createElement('b');
      b.textContent = titulo;
      dica.appendChild(b);
    }
    const linhas = (el.getAttribute('data-dica') || '').split('\n');
    linhas.forEach((l, i) => {
      if (i) dica.appendChild(document.createElement('br'));
      dica.appendChild(document.createTextNode(l));
    });
    dica.classList.add('visivel');
    posicionar(x, y);
  };
  const esconder = () => {
    alvo = null;
    dica.classList.remove('visivel');
  };
  document.addEventListener('pointerover', e => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest?.('[data-dica]');
    if (el && el !== alvo) mostrar(el, e.clientX, e.clientY);
    else if (!el && alvo) esconder();
  });
  document.addEventListener('pointermove', e => {
    if (alvo) posicionar(e.clientX, e.clientY);
  });
  document.addEventListener('focusin', e => {
    const el = e.target.closest?.('[data-dica]');
    if (el && el.matches(':focus-visible')) {
      const r = el.getBoundingClientRect();
      mostrar(el, r.left + r.width / 2, r.bottom);
    }
  });
  document.addEventListener('focusout', esconder);
  document.addEventListener('scroll', esconder, true);
  document.addEventListener('pointerdown', esconder);
}

/* ------------------------------ número animado ------------------------------ */
const FORMATADORES = {
  qtd: v => fmtQtd(v),
  int: v => fmtNum(Math.round(v), 0),
  num1: v => fmtNum(v, 1),
  pct: v => fmtPct(v, 1),
  pct0: v => fmtPct(v, 0),
  tempo: v => fmtTempo(v),
};

class NumeroAnimado extends HTMLElement {
  static observedAttributes = ['v', 'f'];
  constructor() {
    super();
    this._atual = null;
    this._raf = 0;
  }
  attributeChangedCallback() {
    const alvo = Number(this.getAttribute('v'));
    const fmt = FORMATADORES[this.getAttribute('f') || 'qtd'] || FORMATADORES.qtd;
    if (!Number.isFinite(alvo) || this.getAttribute('v') === '') {
      this.textContent = '—';
      this._atual = null;
      return;
    }
    const inicio = this._atual ?? 0;
    cancelAnimationFrame(this._raf);
    if (prefereMenosMovimento() || inicio === alvo || !this.isConnected) {
      this._atual = alvo;
      this.textContent = fmt(alvo);
      return;
    }
    const t0 = performance.now();
    const dur = 750;
    const passo = agora => {
      const p = Math.min(1, (agora - t0) / dur);
      const e = 1 - (1 - p) ** 3;
      const v = inicio + (alvo - inicio) * e;
      this.textContent = fmt(p === 1 ? alvo : v);
      if (p < 1) this._raf = requestAnimationFrame(passo);
      else this._atual = alvo;
    };
    this._raf = requestAnimationFrame(passo);
  }
  connectedCallback() {
    if (this._atual == null) this.attributeChangedCallback();
  }
}
if (!customElements.get('x-num')) customElements.define('x-num', NumeroAnimado);

export const num = (v, f = 'qtd') => html`<x-num v=${finito(v) ? String(v) : ''} f=${f}></x-num>`;

/* ------------------------------ indicadores ------------------------------ */
export function anel(fracao, { centro, sub, classe = 'good', tamanho = 92 } = {}) {
  const f = finito(fracao) ? Math.max(0, Math.min(1, fracao)) : 0;
  const r = 40;
  const c = 2 * Math.PI * r;
  const cor = { good: 'var(--good)', warning: 'var(--warning)', serious: 'var(--serious)', critical: 'var(--critical)', brand: 'var(--brand)', serie: 'var(--series-1)' }[classe] || classe;
  return html`<div class="anel" style="width:${tamanho}px;height:${tamanho}px">
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle class="trilho-anel" cx="50" cy="50" r=${r}></circle>
      <circle class="arco" cx="50" cy="50" r=${r} stroke=${cor} stroke-dasharray=${c} stroke-dashoffset=${c * (1 - f)}></circle>
    </svg>
    <div class="centro"><div><b>${centro ?? fmtPct(f, 0)}</b>${sub ? html`<span>${sub}</span>` : nothing}</div></div>
  </div>`;
}

export function medidor(fracao, classe = '') {
  const f = finito(fracao) ? Math.max(0, Math.min(1, fracao)) : 0;
  return html`<div class="medidor" role="img" aria-label=${fmtPct(f, 0)}>
    <div class="trilho"><div class="enchimento ${classe}" style="width:${(f * 100).toFixed(1)}%"></div></div>
  </div>`;
}

export function seloSaude(saude, compacto = false) {
  const s = ROTULO_SAUDE[saude] || ROTULO_SAUDE['sem-dados'];
  return html`<span class="selo ${s.classe}" data-dica=${compacto ? s.rotulo : nothing}>${ic(s.icone, 'fill')}${compacto ? nothing : s.rotulo}</span>`;
}

export function vazio({ icone = 'stack', titulo, texto, acao }) {
  return html`<div class="vazio">
    <div class="ilustra">${ic(icone, 'duo')}</div>
    <h3>${titulo}</h3>
    ${texto ? html`<p>${texto}</p>` : nothing}
    ${acao || nothing}
  </div>`;
}

export function estat(rotulo, valor, { sub, ajudaChave, unidade } = {}) {
  return html`<div class="estat">
    <span class="rotulo-estat">${rotulo}${ajudaChave ? ajuda(ajudaChave) : nothing}</span>
    <span class="valor">${valor}${unidade ? html`<small>${unidade}</small>` : nothing}</span>
    ${sub ? html`<span class="sub">${sub}</span>` : nothing}
  </div>`;
}

/* ------------------------------ menus simples ------------------------------ */
/** Menu de ações em diálogo leve (funciona bem em toque e teclado). */
export function menuAcoes(titulo, acoes) {
  return abrirDialogo(({ fechar }) => html`
    ${topoDialogo({ icone: 'dots-three-circle', titulo, fechar })}
    <div class="dlg-corpo" style="padding-top:6px">
      <div class="lista">
        ${acoes.filter(Boolean).map(a => html`<button class="item" @click=${() => { fechar(); a.acao(); }}>
          <span class="avatar" style=${a.perigo ? 'color:var(--critical-ink);background:var(--critical-soft)' : ''}>${ic(a.icone)}</span>
          <span class="corpo"><b style=${a.perigo ? 'color:var(--critical-ink)' : ''}>${a.rotulo}</b>${a.texto ? html`<span>${a.texto}</span>` : nothing}</span>
        </button>`)}
      </div>
    </div>`, { classe: 'estreito' });
}

/* ------------------------------ seletor de atividade ------------------------------ */
/** Abre um seletor pesquisável de atividade. Resolve com o id escolhido. */
export function escolherAtividade(store, { titulo = 'Escolha a atividade', excluirId, permitirSetor = false } = {}) {
  let termo = '';
  return abrirDialogo(({ fechar, atualizar }) => {
    const grupos = [];
    for (const area of store.areas()) {
      for (const setor of store.setores(area.id)) {
        const ats = store.atividades(setor.id).filter(a => a.id !== excluirId && combina(`${area.nome} ${setor.nome} ${a.nome}`, termo));
        if (ats.length || (permitirSetor && combina(`${area.nome} ${setor.nome}`, termo))) grupos.push({ area, setor, ats });
      }
    }
    return html`
      ${topoDialogo({ icone: 'list-magnifying-glass', titulo, fechar })}
      <div class="dlg-corpo" style="padding-top:8px">
        <div class="busca-local" style="max-width:none">
          ${ic('magnifying-glass')}
          <input class="entrada" placeholder="Buscar por área, setor ou atividade" autofocus .value=${termo} @input=${e => { termo = e.target.value; atualizar(); }} />
        </div>
        <div class="lista" style="max-height:52dvh;overflow:auto">
          ${grupos.length ? grupos.map(g => html`
            <div class="paleta-grupo">${g.area.nome} › ${g.setor.nome}</div>
            ${permitirSetor ? html`<button class="item" @click=${() => fechar({ setorId: g.setor.id })}>
              <span class="avatar">${ic('folder-simple')}</span>
              <span class="corpo"><b>Setor ${g.setor.nome}</b><span>Mover para este setor</span></span></button>` : nothing}
            ${g.ats.map(a => html`<button class="item" @click=${() => fechar(permitirSetor ? { atividadeId: a.id } : a.id)}>
              <span class="avatar">${ic('cube')}</span>
              <span class="corpo"><b>${a.nome}</b><span>${store.medicoes(a.id).length} medições</span></span>
              ${ic('caret-right')}
            </button>`)}`)
          : vazio({ icone: 'magnifying-glass', titulo: 'Nada encontrado', texto: 'Cadastre áreas, setores e atividades em Estrutura.' })}
        </div>
      </div>`;
  });
}

/** Seletor de setor (para mover atividades). */
export function escolherSetor(store, { titulo = 'Escolha o setor', excluirId } = {}) {
  let termo = '';
  return abrirDialogo(({ fechar, atualizar }) => html`
    ${topoDialogo({ icone: 'folders', titulo, fechar })}
    <div class="dlg-corpo" style="padding-top:8px">
      <div class="busca-local" style="max-width:none">
        ${ic('magnifying-glass')}
        <input class="entrada" placeholder="Buscar setor" autofocus .value=${termo} @input=${e => { termo = e.target.value; atualizar(); }} />
      </div>
      <div class="lista" style="max-height:52dvh;overflow:auto">
        ${store.areas().map(area => {
          const setores = store.setores(area.id).filter(s => s.id !== excluirId && combina(`${area.nome} ${s.nome}`, termo));
          return setores.length ? html`<div class="paleta-grupo">${area.nome}</div>
            ${setores.map(s => html`<button class="item" @click=${() => fechar(s.id)}>
              <span class="avatar">${ic('folder-simple')}</span>
              <span class="corpo"><b>${s.nome}</b><span>${store.atividades(s.id).length} atividades</span></span>${ic('caret-right')}
            </button>`)}` : nothing;
        })}
      </div>
    </div>`);
}

/* ------------------------------ helpers de formulário ------------------------------ */
export function lerFormulario(form) {
  return Object.fromEntries(new FormData(form).entries());
}
