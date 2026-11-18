import { html, nothing } from '../lib.js';
import { ic } from './ui.js';

export function cabecalho({ sobre, icone, titulo, texto, acoes, extra }) {
  return html`<header class="cabecalho">
    <div class="titulos">
      ${sobre ? html`<span class="sobretitulo">${icone ? ic(icone, 'fill') : nothing}${sobre}</span>` : nothing}
      <h1>${titulo}</h1>
      ${texto ? html`<p>${texto}</p>` : nothing}
      ${extra || nothing}
    </div>
    ${acoes ? html`<div class="acoes">${acoes}</div>` : nothing}
  </header>`;
}

export function secao(titulo, conteudo, { acoes, sub, icone } = {}) {
  return html`<section class="stack">
    <div class="row between wrap">
      <div class="stack tight" style="gap:2px">
        <h2 class="row">${icone ? ic(icone, 'duo') : nothing}${titulo}</h2>
        ${sub ? html`<span class="small muted">${sub}</span>` : nothing}
      </div>
      ${acoes || nothing}
    </div>
    ${conteudo}
  </section>`;
}
