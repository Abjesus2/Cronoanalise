// Gráficos leves em SVG/HTML (sem bibliotecas), seguindo a skill dataviz:
// marcas finas, ponta arredondada de 4px, grade em linha fina, dica no hover/foco,
// legenda para 2+ séries e tabela equivalente disponível em cada cartão.
import { html, svg, render, nothing } from '../lib.js';
import { finito, fmtNum } from '../core/util.js';
import { ic, ajuda } from './ui.js';
import { atualizar } from './nav.js';

/* ------------------------------ elemento responsivo ------------------------------ */
class Grafico extends HTMLElement {
  set desenhar(fn) {
    this._fn = fn;
    this._agendar();
  }
  connectedCallback() {
    this._ro = new ResizeObserver(() => {
      if (this.clientWidth !== this._w) this._agendar();
    });
    this._ro.observe(this);
    this._agendar();
  }
  disconnectedCallback() {
    this._ro?.disconnect();
  }
  _agendar() {
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => {
      const w = this.clientWidth;
      if (!w || !this._fn) return;
      this._w = w;
      render(this._fn(w), this);
    });
  }
}
if (!customElements.get('x-grafico')) customElements.define('x-grafico', Grafico);

export const grafico = (fn, altura = 240) =>
  html`<x-grafico class="grafico" style="display:block;min-height:${altura}px" .desenhar=${fn}></x-grafico>`;

/* ------------------------------ escalas ------------------------------ */
export function escalaBonita(min, max, n = 5) {
  if (!finito(min) || !finito(max)) return { min: 0, max: 1, passo: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] };
  if (min === max) {
    max = min === 0 ? 1 : max * 1.2;
    min = min * 0.8;
  }
  const bruto = (max - min) / n;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const norm = bruto / mag;
  const passo = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const lo = Math.floor(min / passo) * passo;
  const hi = Math.ceil(max / passo) * passo;
  const ticks = [];
  for (let v = lo; v <= hi + passo / 2; v += passo) ticks.push(Math.round(v / passo) * passo);
  return { min: lo, max: hi, passo, ticks };
}

/* ------------------------------ cartão de gráfico com tabela ------------------------------ */
const modoTabela = new Set();
export function cartaoGrafico({ id, titulo, sub, ajudaChave, corpo, tabela, legenda, acoes }) {
  const emTabela = modoTabela.has(id);
  return html`<section class="cartao">
    <div class="cartao-topo">
      <div class="stack tight" style="gap:2px">
        <h3>${titulo}${ajudaChave ? ajuda(ajudaChave) : nothing}</h3>
        ${sub ? html`<span class="small muted">${sub}</span>` : nothing}
      </div>
      <div class="row">
        ${acoes || nothing}
        ${tabela
          ? html`<button class="btn fantasma pequeno" aria-pressed=${emTabela} @click=${() => {
              emTabela ? modoTabela.delete(id) : modoTabela.add(id);
              atualizar();
            }}>${ic(emTabela ? 'chart-bar' : 'table')} ${emTabela ? 'Gráfico' : 'Tabela'}</button>`
          : nothing}
      </div>
    </div>
    ${emTabela && tabela ? tabela() : html`${corpo}${legenda ? html`<div class="legenda">${legenda}</div>` : nothing}`}
  </section>`;
}

export function tabelaSimples(colunas, linhas) {
  return html`<div class="tabela-wrap" style="max-height:360px">
    <table class="tabela">
      <thead><tr>${colunas.map(c => html`<th class=${c.n ? 'n' : ''}>${c.rotulo}</th>`)}</tr></thead>
      <tbody>${linhas.map(l => html`<tr>${colunas.map(c => html`<td class=${c.n ? 'n' : ''}>${c.v(l)}</td>`)}</tr>`)}</tbody>
    </table>
  </div>`;
}

/* ------------------------------ barras horizontais (HTML) ------------------------------ */
/**
 * itens: [{ rotulo, sub, valor, texto, destaque, fraca, href, dica }]
 * opcoes: { max, referencia: {valor, rotulo} }
 */
export function barrasH(itens, { max, referencia, vazioTexto = 'Sem dados para exibir.' } = {}) {
  const validos = itens.filter(i => finito(i.valor));
  if (!validos.length) return html`<p class="muted small" style="padding:20px 0">${vazioTexto}</p>`;
  const m = max ?? Math.max(...validos.map(i => i.valor), referencia?.valor || 0) * 1.05;
  return html`<div class="barras-h" style="display:flex;flex-direction:column;gap:10px;position:relative">
    ${itens.map((it, i) => {
      const f = finito(it.valor) && m > 0 ? Math.max(0, it.valor / m) : 0;
      const conteudo = html`
        <div class="row between" style="gap:12px">
          <span class="truncate small" style="font-weight:600">${it.rotulo}${it.sub ? html` <span class="muted" style="font-weight:500">· ${it.sub}</span>` : nothing}</span>
          <span class="small num nowrap" style="font-weight:700">${it.texto ?? fmtNum(it.valor, 1)}</span>
        </div>
        <div style="position:relative;height:14px;margin-top:4px">
          <div style="position:absolute;inset:5px 0 auto;height:4px;border-radius:99px;background:var(--surface-3)"></div>
          <div class="anim-barra" style="--i:${i};position:absolute;left:0;top:0;height:14px;width:${(f * 100).toFixed(2)}%;border-radius:0 4px 4px 0;background:${it.destaque ? 'var(--series-2)' : it.fraca ? 'color-mix(in srgb, var(--series-1) 35%, var(--surface-3))' : 'var(--series-1)'};transform-origin:left;animation:crescerX .7s var(--ease) both;animation-delay:${i * 35}ms"></div>
          ${referencia && m > 0
            ? html`<div style="position:absolute;top:-3px;bottom:-3px;left:${((referencia.valor / m) * 100).toFixed(2)}%;width:0;border-left:1.5px solid var(--ink-2)"></div>`
            : nothing}
        </div>`;
      return it.href
        ? html`<a href=${it.href} style="text-decoration:none;color:inherit;display:block;border-radius:8px" data-dica=${it.dica || nothing}>${conteudo}</a>`
        : html`<div tabindex="0" data-dica=${it.dica || nothing} style="border-radius:8px">${conteudo}</div>`;
    })}
    ${referencia ? html`<div class="legenda" style="margin-top:2px"><span><i class="linha-chave" style="background:var(--ink-2);width:2px;height:12px"></i>${referencia.rotulo}</span></div>` : nothing}
  </div>`;
}

/* ------------------------------ histograma (HTML) ------------------------------ */
export function histograma(valores, { fmt = v => fmtNum(v, 1), classes, limites, media } = {}) {
  const v = valores.filter(finito);
  if (v.length < 2) return html`<p class="muted small" style="padding:20px 0">São necessárias ao menos 2 medições.</p>`;
  const min = Math.min(...v);
  const max = Math.max(...v);
  const k = classes || Math.max(4, Math.min(12, Math.ceil(Math.sqrt(v.length)) + 1));
  const largura = (max - min) / k || 1;
  const bins = Array.from({ length: k }, (_, i) => ({ de: min + i * largura, ate: min + (i + 1) * largura, n: 0 }));
  for (const x of v) bins[Math.min(k - 1, Math.floor((x - min) / largura))].n++;
  const maxN = Math.max(...bins.map(b => b.n));
  const esc = escalaBonita(0, maxN, 4);
  return html`<div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px">
    <div style="display:flex;flex-direction:column-reverse;justify-content:space-between;height:180px;font-size:11px;color:var(--ink-3);text-align:right" class="num">
      ${esc.ticks.map(t => html`<span style="line-height:0">${fmtNum(t, 0)}</span>`)}
    </div>
    <div style="position:relative;height:180px;border-bottom:1px solid var(--axis)">
      ${esc.ticks.slice(1).map(t => html`<div style="position:absolute;left:0;right:0;bottom:${(t / esc.max) * 100}%;border-top:1px solid var(--grid)"></div>`)}
      <div style="position:absolute;inset:0;display:flex;align-items:flex-end;gap:2px">
        ${bins.map((b, i) => {
          const foraLimite = limites && (b.ate <= limites.inf || b.de >= limites.sup);
          const temMedia = finito(media) && media >= b.de && (media < b.ate || i === k - 1);
          return html`<div tabindex="0" style="flex:1;height:100%;display:flex;align-items:flex-end;position:relative;outline-offset:-2px"
            data-dica-titulo=${`${b.n} medição(ões)`} data-dica=${`${fmt(b.de)} a ${fmt(b.ate)}${foraLimite ? '\nFora dos limites do nivelamento' : ''}`}>
            <div style="width:100%;max-width:48px;margin:0 auto;height:${maxN ? (b.n / esc.max) * 100 : 0}%;border-radius:4px 4px 0 0;background:${foraLimite ? 'color-mix(in srgb, var(--critical) 55%, var(--surface-3))' : 'var(--series-1)'};transform-origin:bottom;animation:crescerY .7s var(--ease) both;animation-delay:${i * 35}ms"></div>
            ${temMedia ? html`<div style="position:absolute;left:50%;top:0;bottom:0;border-left:1.5px solid var(--ink-2)"></div>` : nothing}
          </div>`;
        })}
      </div>
    </div>
    <span></span>
    <div class="row between tiny muted num"><span>${fmt(min)}</span><span>${fmt((min + max) / 2)}</span><span>${fmt(max)}</span></div>
  </div>`;
}

/* ------------------------------ gráfico de controle (SVG) ------------------------------ */
/**
 * pontos: [{ v, status: 'valida'|'nivelada'|'excluida'|'invalida', dica, titulo }]
 * opcoes: { media, inf, sup, fmt }
 */
export function graficoControle(pontos, { media, inf, sup, fmt = v => fmtNum(v, 1) } = {}) {
  const altura = 250;
  return grafico(largura => {
    const ml = 52;
    const mr = 16;
    const mt = 14;
    const mb = 30;
    const W = largura;
    const H = altura;
    const vs = pontos.map(p => p.v).filter(finito);
    if (!vs.length) return html`<p class="muted small">Sem medições.</p>`;
    const extremos = [...vs, ...(finito(inf) ? [inf] : []), ...(finito(sup) ? [sup] : [])];
    const esc = escalaBonita(Math.max(0, Math.min(...extremos)), Math.max(...extremos), 5);
    const x = i => ml + (pontos.length === 1 ? (W - ml - mr) / 2 : (i * (W - ml - mr)) / (pontos.length - 1));
    const y = v => mt + (1 - (v - esc.min) / (esc.max - esc.min)) * (H - mt - mb);
    const validos = pontos.map((p, i) => ({ ...p, i })).filter(p => p.status === 'valida' && finito(p.v));
    const caminho = validos.map((p, j) => `${j ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const passoX = Math.max(1, Math.ceil(pontos.length / Math.max(2, Math.floor((W - ml) / 46))));
    return html`<svg viewBox="0 0 ${W} ${H}" width=${W} height=${H} role="img" aria-label="Gráfico de controle das medições">
      ${esc.ticks.map(t => svg`<line class="grade-linha" x1=${ml} x2=${W - mr} y1=${y(t)} y2=${y(t)}></line>
        <text class="rotulo-eixo" x=${ml - 8} y=${y(t) + 4} text-anchor="end">${fmt(t)}</text>`)}
      ${finito(inf) && finito(sup) ? svg`<rect class="faixa" x=${ml} width=${W - ml - mr} y=${y(Math.min(sup, esc.max))} height=${Math.max(0, y(Math.max(inf, esc.min)) - y(Math.min(sup, esc.max)))}></rect>
        <line class="limite" x1=${ml} x2=${W - mr} y1=${y(Math.min(sup, esc.max))} y2=${y(Math.min(sup, esc.max))}></line>
        ${inf > esc.min ? svg`<line class="limite" x1=${ml} x2=${W - mr} y1=${y(inf)} y2=${y(inf)}></line>` : nothing}` : nothing}
      <line class="eixo" x1=${ml} x2=${W - mr} y1=${H - mb} y2=${H - mb}></line>
      ${finito(media) ? svg`<line class="media-linha" x1=${ml} x2=${W - mr} y1=${y(media)} y2=${y(media)}></line>
        <text class="rotulo-valor" x=${W - mr} y=${y(media) - 6} text-anchor="end">média ${fmt(media)}</text>` : nothing}
      ${caminho ? svg`<path class="linha desenhar" d=${caminho} pathLength="2000" style="--comp:2000;opacity:.55"></path>` : nothing}
      ${pontos.map((p, i) => i % passoX === 0 || i === pontos.length - 1
        ? svg`<text class="rotulo-eixo" x=${x(i)} y=${H - mb + 18} text-anchor="middle">${i + 1}</text>` : nothing)}
      ${pontos.map((p, i) => finito(p.v) ? svg`<g class="alvo" tabindex="0" data-dica-titulo=${p.titulo || fmt(p.v)} data-dica=${p.dica || ''}>
          <circle cx=${x(i)} cy=${y(p.v)} r="12" fill="transparent"></circle>
          <circle class="ponto-g ${p.status === 'nivelada' ? 'fora' : p.status !== 'valida' ? 'excl' : ''}" cx=${x(i)} cy=${y(p.v)} r="4.5"></circle>
        </g>` : nothing)}
    </svg>`;
  }, altura);
}

/* ------------------------------ linha / área no tempo (SVG) ------------------------------ */
/** serie: [{ rotulo, v, dica }] */
export function graficoLinha(serie, { fmt = v => fmtNum(v, 0), altura = 220, nome = 'valor' } = {}) {
  return grafico(largura => {
    const ml = 44;
    const mr = 14;
    const mt = 14;
    const mb = 30;
    const W = largura;
    const H = altura;
    if (!serie.length) return html`<p class="muted small">Sem dados no período.</p>`;
    const esc = escalaBonita(0, Math.max(...serie.map(s => s.v), 1), 4);
    const banda = (W - ml - mr) / serie.length;
    const x = i => ml + banda * (i + 0.5);
    const y = v => mt + (1 - (v - esc.min) / (esc.max - esc.min)) * (H - mt - mb);
    const linha = serie.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.v).toFixed(1)}`).join(' ');
    const area = `${linha} L${x(serie.length - 1).toFixed(1)},${y(esc.min)} L${x(0).toFixed(1)},${y(esc.min)} Z`;
    const passo = Math.max(1, Math.ceil(serie.length / Math.max(2, Math.floor((W - ml) / 64))));
    return html`<svg viewBox="0 0 ${W} ${H}" width=${W} height=${H} role="img" aria-label=${`Evolução de ${nome}`}>
      ${esc.ticks.map(t => svg`<line class="grade-linha" x1=${ml} x2=${W - mr} y1=${y(t)} y2=${y(t)}></line>
        <text class="rotulo-eixo" x=${ml - 8} y=${y(t) + 4} text-anchor="end">${fmt(t)}</text>`)}
      <line class="eixo" x1=${ml} x2=${W - mr} y1=${H - mb} y2=${H - mb}></line>
      <path class="area" d=${area}></path>
      <path class="linha desenhar" d=${linha} pathLength="2000" style="--comp:2000"></path>
      ${serie.length === 1 ? svg`<circle class="ponto-g" cx=${x(0)} cy=${y(serie[0].v)} r="4.5"></circle>` : nothing}
      ${serie.map((s, i) => (i % passo === 0 || i === serie.length - 1) ? svg`<text class="rotulo-eixo" x=${x(i)} y=${H - mb + 18} text-anchor="middle">${s.rotulo}</text>` : nothing)}
      ${serie.map((s, i) => svg`<g class="alvo mira-alvo" tabindex="0" data-dica-titulo=${fmt(s.v) + ' ' + nome} data-dica=${s.dica || s.rotulo}>
        <rect x=${ml + banda * i} y=${mt} width=${banda} height=${H - mt - mb} fill="transparent"></rect>
        <line class="mira" x1=${x(i)} x2=${x(i)} y1=${mt} y2=${H - mb} opacity="0"></line>
        <circle class="ponto-g" cx=${x(i)} cy=${y(s.v)} r="4.5" opacity="0"></circle>
      </g>`)}
    </svg>`;
  }, altura);
}

/* ------------------------------ barra segmentada (composição) ------------------------------ */
/** partes: [{ rotulo, v, cor, texto }] */
export function barraSegmentada(partes) {
  const total = partes.reduce((s, p) => s + (finito(p.v) ? p.v : 0), 0);
  if (!(total > 0)) return nothing;
  const visiveis = partes.filter(p => p.v > 0);
  return html`
    <div class="composicao" role="img" aria-label=${visiveis.map(p => `${p.rotulo}: ${p.texto}`).join('; ')}>
      ${visiveis.map((p, i) => {
        const f = p.v / total;
        return html`<div tabindex="0" style="flex:${f};background:${p.cor};animation-delay:${i * 80}ms;color:${p.tinta || '#fff'}"
          data-dica-titulo=${p.rotulo} data-dica=${`${p.texto} · ${fmtNum(f * 100, 1)}%`}>${f > 0.14 ? `${fmtNum(f * 100, 0)}%` : ''}</div>`;
      })}
    </div>
    <div class="legenda">${visiveis.map(p => html`<span><i style="background:${p.cor}"></i>${p.rotulo} · <b class="num">${p.texto}</b></span>`)}</div>`;
}

/* ------------------------------ sparkline ------------------------------ */
export function sparkline(valores, { largura = 120, altura = 32 } = {}) {
  const v = valores.filter(finito);
  if (v.length < 2) return nothing;
  const min = Math.min(...v);
  const max = Math.max(...v);
  const x = i => (i * (largura - 4)) / (v.length - 1) + 2;
  const y = val => 2 + (1 - (val - min) / (max - min || 1)) * (altura - 4);
  const d = v.map((val, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(val).toFixed(1)}`).join(' ');
  return html`<svg class="grafico" width=${largura} height=${altura} viewBox="0 0 ${largura} ${altura}" aria-hidden="true">
    <path class="linha" d=${d} style="stroke-width:1.5;opacity:.7"></path>
    <circle class="ponto-g" cx=${x(v.length - 1)} cy=${y(v[v.length - 1])} r="3"></circle>
  </svg>`;
}
