// Fluxograma automático do processo + versões editáveis compartilhadas.
import { html, svg, nothing } from '../lib.js';
import { store } from '../core/store.js';
import { analise, grupo } from '../core/consultas.js';
import { fmtTempo } from '../core/time.js';
import { combina, fmtQtd, uid, baixarArquivo, nomeArquivo, escaparHTML } from '../core/util.js';
import { ic, toast, confirmar, pedirTexto, abrirDialogo, topoDialogo, vazio, menuAcoes, seloSaude } from '../ui/ui.js';
import { cabecalho } from '../ui/layout.js';
import { atualizar, definirQuery } from '../ui/nav.js';

const CORES = {
  area: { fill: '#3b2f8f', stroke: '#3b2f8f', texto: '#ffffff', sub: '#d9d4ff' },
  setor: { fill: '#0f766e', stroke: '#0f766e', texto: '#ffffff', sub: '#c8f1ec' },
  atividade: { fill: '#ffffff', stroke: '#cfc9b9', texto: '#15171c', sub: '#6b6e76' },
  etapa: { fill: '#e6f0fc', stroke: '#2a78d6', texto: '#123b6d', sub: '#3f5f88' },
  decisao: { fill: '#fff3d1', stroke: '#e0a100', texto: '#5c4100', sub: '#7a5a10' },
  nota: { fill: '#fffbe0', stroke: '#e6dc9a', texto: '#4d4520', sub: '#6d6436' },
};
const TAM = { area: [220, 74], setor: [220, 74], atividade: [230, 84], etapa: [200, 70], decisao: [170, 110], nota: [200, 90] };
const ROTULO_TIPO = { area: 'Operação', setor: 'Setor', atividade: 'Atividade', etapa: 'Etapa', decisao: 'Decisão', nota: 'Nota' };

const f = {
  versaoId: 'oficial',
  termo: '',
  vista: { k: 1, x: 40, y: 40 },
  ajustar: true,
  sel: null, // { tipo: 'no'|'aresta', id }
  conectar: null, // null | { de: id|null }
  rascunho: null,
  pilha: [],
  refazer: [],
  arrasto: null,
  chave: '',
};

/* ------------------------------ geração automática ------------------------------ */
function gerarOficial(areaId, setorId) {
  const nos = [];
  const arestas = [];
  const areas = areaId ? [store.obter('areas', areaId)].filter(Boolean) : store.areas();
  let y0 = 0;
  for (const area of areas) {
    const gA = grupo({ areaId: area.id });
    const noArea = { id: 'n-' + area.id, tipo: 'area', ref: area.id, texto: area.nome, sub: gA.tpTotal ? `TP total ${fmtTempo(gA.tpTotal)}` : `${gA.nAtividades} atividade(s)`, x: 0, y: y0 };
    nos.push(noArea);
    const setores = setorId ? store.setores(area.id).filter(s => s.id === setorId) : store.setores(area.id);
    let anterior = noArea;
    let maxAt = 0;
    setores.forEach((s, i) => {
      const gS = grupo({ setorId: s.id });
      const x = 300 + i * 290;
      const noSetor = { id: 'n-' + s.id, tipo: 'setor', ref: s.id, texto: s.nome, sub: gS.capacidadeFluxo ? `${fmtQtd(gS.capacidadeFluxo.hora)}/h · gargalo ${gS.gargalo.analise.atividade.nome}` : `${gS.nAtividades} atividade(s)`, x, y: y0 };
      nos.push(noSetor);
      arestas.push({ id: `e-${anterior.id}-${noSetor.id}`, de: anterior.id, para: noSetor.id });
      anterior = noSetor;
      let antAt = noSetor;
      const ats = store.atividades(s.id);
      maxAt = Math.max(maxAt, ats.length);
      ats.forEach((a, j) => {
        const an = analise(a.id);
        const gargalo = gS.gargalo?.analise.atividade.id === a.id && gS.nComTP > 1;
        const noAt = {
          id: 'n-' + a.id,
          tipo: 'atividade',
          ref: a.id,
          texto: a.nome,
          sub: an.tempoPadrao ? `TP ${fmtTempo(an.tempoPadrao)} · ${fmtQtd(an.prodPessoa.hora)} ${a.unidade}/h` : `${an.total} medição(ões)`,
          gargalo,
          saude: an.saude,
          x: x + 5,
          y: y0 + 120 + j * 112,
        };
        nos.push(noAt);
        arestas.push({ id: `e-${antAt.id}-${noAt.id}`, de: antAt.id, para: noAt.id });
        antAt = noAt;
      });
    });
    y0 += 200 + maxAt * 112;
  }
  return { nos, arestas };
}

function versaoAtual(areaId, setorId) {
  if (f.versaoId === 'oficial') return { id: 'oficial', nome: 'Fluxo oficial (automático)', ...gerarOficial(areaId, setorId), oficial: true };
  if (f.rascunho && f.rascunho.id === f.versaoId) return f.rascunho;
  const v = store.obter('fluxos', f.versaoId);
  if (!v) {
    f.versaoId = 'oficial';
    return versaoAtual(areaId, setorId);
  }
  // atualiza textos de nós ligados a cadastros que ainda existem
  f.rascunho = structuredClone(v);
  return f.rascunho;
}

/* ------------------------------ geometria ------------------------------ */
const tam = n => TAM[n.tipo] || [200, 70];
function ancoras(a, b) {
  const [wa, ha] = tam(a);
  const [wb, hb] = tam(b);
  const ca = { x: a.x + wa / 2, y: a.y + ha / 2 };
  const cb = { x: b.x + wb / 2, y: b.y + hb / 2 };
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    const p1 = { x: dx > 0 ? a.x + wa : a.x, y: ca.y };
    const p2 = { x: dx > 0 ? b.x : b.x + wb, y: cb.y };
    const m = (p2.x - p1.x) / 2;
    return `M${p1.x},${p1.y} C${p1.x + m},${p1.y} ${p2.x - m},${p2.y} ${p2.x},${p2.y}`;
  }
  const p1 = { x: ca.x, y: dy > 0 ? a.y + ha : a.y };
  const p2 = { x: cb.x, y: dy > 0 ? b.y : b.y + hb };
  const m = (p2.y - p1.y) / 2;
  return `M${p1.x},${p1.y} C${p1.x},${p1.y + m} ${p2.x},${p2.y - m} ${p2.x},${p2.y}`;
}

function quebrar(texto, max = 26) {
  const palavras = String(texto || '').split(/\s+/);
  const linhas = [''];
  for (const p of palavras) {
    const atual = linhas[linhas.length - 1];
    if ((atual + ' ' + p).trim().length > max && atual) linhas.push(p);
    else linhas[linhas.length - 1] = (atual + ' ' + p).trim();
  }
  if (linhas.length > 2) return [linhas[0], linhas[1].slice(0, max - 1) + '…'];
  return linhas;
}

function caixa(nos) {
  if (!nos.length) return { x: 0, y: 0, w: 400, h: 300 };
  const xs = nos.map(n => n.x);
  const ys = nos.map(n => n.y);
  const x2 = nos.map(n => n.x + tam(n)[0]);
  const y2 = nos.map(n => n.y + tam(n)[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...x2) - x, h: Math.max(...y2) - y };
}

/* ------------------------------ desenho ------------------------------ */
function desenharNo(n, destaque, editavel) {
  const [w, h] = tam(n);
  const c = CORES[n.cor ? 'etapa' : n.tipo] || CORES.etapa;
  const fill = n.cor || c.fill;
  const linhas = quebrar(n.texto, n.tipo === 'decisao' ? 18 : 26);
  const sel = f.sel?.tipo === 'no' && f.sel.id === n.id;
  const forma = n.tipo === 'decisao'
    ? svg`<polygon points="${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}" fill=${fill} stroke=${n.gargalo ? '#eb6834' : c.stroke} stroke-width=${n.gargalo ? 3 : 1.5}></polygon>`
    : svg`<rect width=${w} height=${h} rx=${n.tipo === 'nota' ? 4 : 14} fill=${fill} stroke=${n.gargalo ? '#eb6834' : c.stroke} stroke-width=${n.gargalo ? 3 : 1.5}></rect>
      ${n.tipo === 'atividade' ? svg`<rect width="6" height=${h - 20} x="0" y="10" rx="3" fill=${n.gargalo ? '#eb6834' : '#2a78d6'}></rect>` : nothing}`;
  const cx = n.tipo === 'decisao' ? w / 2 : 16;
  const anchor = n.tipo === 'decisao' ? 'middle' : 'start';
  const baseY = n.tipo === 'decisao' ? h / 2 - (linhas.length - 1) * 8 : 26;
  return svg`<g class="no-fluxo ${sel ? 'sel' : ''}" transform="translate(${n.x},${n.y})" data-id=${n.id} opacity=${destaque === false ? 0.25 : 1}
      @pointerdown=${e => iniciarArrastoNo(e, n, editavel)} @dblclick=${() => editavel && editarNo(n)}>
    ${forma}
    ${linhas.map((l, i) => svg`<text x=${cx} y=${baseY + i * 17} text-anchor=${anchor} fill=${c.texto} font-size="13.5" font-weight="700" font-family="Red Hat Display, Segoe UI, sans-serif">${l}</text>`)}
    ${n.sub && n.tipo !== 'decisao' ? svg`<text x=${cx} y=${baseY + linhas.length * 17 + 2} fill=${c.sub} font-size="11.5" font-family="Red Hat Text, Segoe UI, sans-serif">${String(n.sub).slice(0, 40)}</text>` : nothing}
    ${n.tipo !== 'decisao' && n.tipo !== 'nota' ? svg`<text x=${w - 12} y="18" text-anchor="end" fill=${c.sub} font-size="9.5" font-weight="700" letter-spacing="1" font-family="Red Hat Text, Segoe UI, sans-serif">${n.gargalo ? 'GARGALO' : ROTULO_TIPO[n.tipo].toUpperCase()}</text>` : nothing}
  </g>`;
}

function svgFluxo(v, editavel) {
  const mapa = new Map(v.nos.map(n => [n.id, n]));
  const termo = f.termo.trim();
  const { k, x, y } = f.vista;
  return html`<svg id="fluxo-svg" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Fluxograma do processo">
    <defs><marker id="seta" markerWidth="10" markerHeight="10" refX="8.5" refY="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,1 L9,5 L0,9 z" fill="#7c7f87"></path></marker></defs>
    <g id="fluxo-vista" transform="translate(${x},${y}) scale(${k})">
      ${v.arestas.map(e => {
        const a = mapa.get(e.de);
        const b = mapa.get(e.para);
        if (!a || !b) return nothing;
        const d = ancoras(a, b);
        const sel = f.sel?.tipo === 'aresta' && f.sel.id === e.id;
        return svg`<g>
          <path class="aresta ${sel ? 'sel' : ''}" d=${d} marker-end="url(#seta)" stroke="#7c7f87"></path>
          <path class="aresta-hit" d=${d} @pointerdown=${ev => { ev.stopPropagation(); f.sel = { tipo: 'aresta', id: e.id }; atualizar(); }}></path>
          ${e.rotulo ? svg`<text x=${(a.x + b.x) / 2 + 60} y=${(a.y + b.y) / 2 + 30} font-size="11" fill="#4a4d55">${e.rotulo}</text>` : nothing}
        </g>`;
      })}
      ${v.nos.map(n => desenharNo(n, termo ? combina(`${n.texto} ${n.sub || ''}`, termo) : null, editavel))}
    </g>
  </svg>`;
}

/* ------------------------------ interação ------------------------------ */
function registrarDesfazer() {
  f.pilha.push(JSON.stringify({ nos: f.rascunho.nos, arestas: f.rascunho.arestas }));
  if (f.pilha.length > 60) f.pilha.shift();
  f.refazer = [];
}

function iniciarArrastoNo(e, n, editavel) {
  e.stopPropagation();
  if (f.conectar && editavel) {
    if (!f.conectar.de) f.conectar = { de: n.id };
    else if (f.conectar.de !== n.id) {
      registrarDesfazer();
      f.rascunho.arestas.push({ id: uid(), de: f.conectar.de, para: n.id });
      f.conectar = { de: null };
      toast('Conexão criada', { tipo: 'info', duracao: 1500 });
    }
    atualizar();
    return;
  }
  f.sel = { tipo: 'no', id: n.id };
  if (!editavel) {
    atualizar();
    return;
  }
  const inicio = { px: e.clientX, py: e.clientY, x: n.x, y: n.y };
  let moveu = false;
  const mover = ev => {
    const dx = (ev.clientX - inicio.px) / f.vista.k;
    const dy = (ev.clientY - inicio.py) / f.vista.k;
    if (!moveu && Math.hypot(dx, dy) > 3) {
      registrarDesfazer();
      moveu = true;
    }
    if (moveu) {
      n.x = Math.round((inicio.x + dx) / 10) * 10;
      n.y = Math.round((inicio.y + dy) / 10) * 10;
      atualizar();
    }
  };
  const soltar = () => {
    removeEventListener('pointermove', mover);
    removeEventListener('pointerup', soltar);
  };
  addEventListener('pointermove', mover);
  addEventListener('pointerup', soltar);
  atualizar();
}

function iniciarPan(e) {
  if (e.button !== 0) return;
  f.sel = null;
  const inicio = { px: e.clientX, py: e.clientY, x: f.vista.x, y: f.vista.y };
  const mover = ev => {
    f.vista = { ...f.vista, x: inicio.x + ev.clientX - inicio.px, y: inicio.y + ev.clientY - inicio.py };
    const g = document.getElementById('fluxo-vista');
    if (g) g.setAttribute('transform', `translate(${f.vista.x},${f.vista.y}) scale(${f.vista.k})`);
  };
  const soltar = () => {
    removeEventListener('pointermove', mover);
    removeEventListener('pointerup', soltar);
    atualizar();
  };
  addEventListener('pointermove', mover);
  addEventListener('pointerup', soltar);
  atualizar();
}

function zoom(fator, cx, cy) {
  const area = document.querySelector('.fluxo-area');
  const r = area?.getBoundingClientRect();
  const px = cx ?? (r ? r.width / 2 : 300);
  const py = cy ?? (r ? r.height / 2 : 200);
  const k = Math.min(2.5, Math.max(0.06, f.vista.k * fator));
  const real = k / f.vista.k;
  f.vista = { k, x: px - (px - f.vista.x) * real, y: py - (py - f.vista.y) * real };
  f.ajustar = false;
  atualizar();
}

function enquadrar(nos) {
  const area = document.querySelector('.fluxo-area');
  if (!area || !nos.length) return;
  const r = area.getBoundingClientRect();
  const b = caixa(nos);
  const k = Math.min(1.2, Math.max(0.06, Math.min((r.width - 40) / b.w, (r.height - 70) / b.h)));
  f.vista = { k, x: (r.width - b.w * k) / 2 - b.x * k, y: (r.height - 40 - b.h * k) / 2 - b.y * k };
}

function editarNo(n) {
  const e = { texto: n.texto, detalhe: n.detalhe || '', tipo: n.tipo, cor: n.cor || CORES[n.tipo]?.fill || '#e6f0fc' };
  abrirDialogo(({ fechar, atualizar: att }) => html`<form @submit=${ev => {
      ev.preventDefault();
      registrarDesfazer();
      Object.assign(n, { texto: e.texto.trim() || n.texto, detalhe: e.detalhe, tipo: e.tipo, cor: e.cor === CORES[e.tipo]?.fill ? null : e.cor });
      fechar(true);
      atualizar();
    }}>
    ${topoDialogo({ icone: 'pencil-simple', titulo: 'Editar elemento', texto: 'A edição vale só para esta versão do fluxograma; os cadastros não mudam.' })}
    <div class="dlg-corpo">
      <div class="campo"><label>Texto</label><input class="entrada" required autofocus .value=${e.texto} @input=${ev => (e.texto = ev.target.value)} /></div>
      <div class="campo"><label>Detalhamento</label><textarea class="entrada" .value=${e.detalhe} @input=${ev => (e.detalhe = ev.target.value)}></textarea></div>
      <div class="grade-form">
        <div class="campo"><label>Formato</label><select class="entrada" @change=${ev => { e.tipo = ev.target.value; e.cor = CORES[e.tipo].fill; att(); }}>
          ${Object.entries(ROTULO_TIPO).map(([k, r]) => html`<option value=${k} ?selected=${e.tipo === k}>${r}</option>`)}</select></div>
        <div class="campo"><label>Cor</label><input class="entrada" type="color" style="padding:4px;height:42px" .value=${e.cor} @input=${ev => (e.cor = ev.target.value)} /></div>
      </div>
    </div>
    <div class="dlg-rodape">
      <button type="button" class="btn perigo" style="margin-right:auto" @click=${() => { excluirSelecionado(n.id); fechar(); }}>${ic('trash')} Excluir</button>
      <button type="button" class="btn" @click=${() => fechar()}>Cancelar</button><button class="btn primario">Aplicar</button>
    </div></form>`);
}

function excluirSelecionado(idNo) {
  const r = f.rascunho;
  if (!r) return;
  const alvo = idNo ? { tipo: 'no', id: idNo } : f.sel;
  if (!alvo) return;
  registrarDesfazer();
  if (alvo.tipo === 'no') {
    r.nos = r.nos.filter(n => n.id !== alvo.id);
    r.arestas = r.arestas.filter(e => e.de !== alvo.id && e.para !== alvo.id);
  } else r.arestas = r.arestas.filter(e => e.id !== alvo.id);
  f.sel = null;
  atualizar();
}

function adicionarNo(tipo) {
  const r = f.rascunho;
  registrarDesfazer();
  const area = document.querySelector('.fluxo-area')?.getBoundingClientRect();
  const cx = ((area?.width || 600) / 2 - f.vista.x) / f.vista.k;
  const cy = ((area?.height || 400) / 2 - f.vista.y) / f.vista.k;
  const n = { id: uid(), tipo, texto: tipo === 'decisao' ? 'Decisão?' : tipo === 'nota' ? 'Nota' : 'Nova etapa', x: Math.round(cx / 10) * 10, y: Math.round(cy / 10) * 10 };
  r.nos.push(n);
  f.sel = { tipo: 'no', id: n.id };
  atualizar();
}

async function criarVersao(base, areaId, setorId) {
  const nome = await pedirTexto({ titulo: 'Nova versão editável', texto: 'Cria uma cópia do fluxo atual que você pode reorganizar e anotar, sem alterar os cadastros.', rotulo: 'Nome da versão', valor: 'Proposta de melhoria', icone: 'git-branch' });
  if (!nome) return;
  const v = store.salvar('fluxos', { nome, areaId: areaId || null, setorId: setorId || null, nos: structuredClone(base.nos), arestas: structuredClone(base.arestas) });
  f.versaoId = v.id;
  f.rascunho = null;
  f.pilha = [];
  f.refazer = [];
  toast('Versão criada — arraste os elementos para reorganizar');
}

/* ------------------------------ exportação ------------------------------ */
function svgParaExportar(v) {
  const b = caixa(v.nos);
  const pad = 30;
  const original = document.getElementById('fluxo-vista');
  if (!original) return null;
  const clone = original.cloneNode(true);
  clone.setAttribute('transform', `translate(${pad - b.x},${pad - b.y})`);
  clone.querySelectorAll('.aresta-hit').forEach(el => el.remove());
  clone.querySelectorAll('.aresta').forEach(el => { el.setAttribute('fill', 'none'); el.setAttribute('stroke-width', '1.6'); });
  clone.querySelectorAll('[opacity]').forEach(el => el.removeAttribute('opacity'));
  const w = Math.ceil(b.w + pad * 2);
  const h = Math.ceil(b.h + pad * 2);
  const defs = document.querySelector('#fluxo-svg defs').outerHTML;
  return { texto: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#faf8f3"/>${defs}${clone.outerHTML}</svg>`, w, h };
}

function exportar(v) {
  const nome = nomeArquivo('fluxograma-' + v.nome);
  menuAcoes('Exportar fluxograma', [
    { icone: 'file-svg', rotulo: 'SVG (editável em PowerPoint, Visio, Illustrator)', acao: () => { const s = svgParaExportar(v); if (s) baixarArquivo(nome + '.svg', s.texto, 'image/svg+xml'); } },
    { icone: 'file-png', rotulo: 'PNG (imagem)', acao: () => {
      const s = svgParaExportar(v);
      if (!s) return;
      const img = new Image();
      img.onload = () => {
        const escala = Math.min(2, 8000 / Math.max(s.w, s.h));
        const cv = document.createElement('canvas');
        cv.width = s.w * escala;
        cv.height = s.h * escala;
        const ctx = cv.getContext('2d');
        ctx.scale(escala, escala);
        ctx.drawImage(img, 0, 0);
        cv.toBlob(blob => baixarArquivo(nome + '.png', blob), 'image/png');
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s.texto);
    } },
    { icone: 'file-pdf', rotulo: 'PDF / imprimir', acao: () => {
      const s = svgParaExportar(v);
      const w = window.open('', '_blank');
      if (!s || !w) return toast('Permita pop-ups para imprimir.', { tipo: 'aviso' });
      w.document.write(`<!doctype html><title>${escaparHTML(v.nome)}</title><style>@page{size:landscape;margin:10mm}body{margin:0}svg{width:100%;height:auto}</style>${s.texto}`);
      w.document.close();
      setTimeout(() => w.print(), 400);
    } },
    { icone: 'file-code', rotulo: 'JSON (reimportável)', acao: () => baixarArquivo(nome + '.json', JSON.stringify({ formato: 'cronoanalise-fluxo', nome: v.nome, nos: v.nos, arestas: v.arestas }, null, 1), 'application/json') },
  ]);
}

async function importarJSON(ev, areaId, setorId) {
  const arq = ev.target.files?.[0];
  ev.target.value = '';
  if (!arq) return;
  try {
    const obj = JSON.parse(await arq.text());
    if (!Array.isArray(obj.nos)) throw new Error('arquivo sem elementos');
    const v = store.salvar('fluxos', { nome: (obj.nome || 'Importado') + ' (importado)', areaId: areaId || null, setorId: setorId || null, nos: obj.nos, arestas: obj.arestas || [] });
    f.versaoId = v.id;
    f.rascunho = null;
    f.ajustar = true;
    toast('Fluxograma importado');
  } catch (e) {
    toast('JSON inválido: ' + e.message, { tipo: 'erro' });
  }
}

/* ------------------------------ painel de detalhes ------------------------------ */
function detalhes(v) {
  if (!f.sel || f.sel.tipo !== 'no') return html`<div class="stack tight muted small" style="align-items:center;text-align:center;padding:24px 8px">${ic('cursor-click', 'duo')}<span>Clique num elemento para ver os detalhes.${v.oficial ? '' : ' Dê dois cliques para editar.'}</span></div>`;
  const n = v.nos.find(x => x.id === f.sel.id);
  if (!n) return nothing;
  if (n.tipo === 'atividade' && n.ref && store.obter('atividades', n.ref)) {
    const an = analise(n.ref);
    return html`<div class="stack">
      <span class="sobretitulo">${ic('cube', 'fill')} Atividade</span>
      <h3>${an.atividade.nome}</h3>
      <div class="row wrap">${seloSaude(an.saude)}${n.gargalo ? html`<span class="selo serious">${ic('funnel-simple', 'fill')}gargalo</span>` : nothing}</div>
      <table class="tabela-ref">
        <tr><td>Tempo padrão</td><td class="n"><b>${fmtTempo(an.tempoPadrao)}</b></td></tr>
        <tr><td>Por hora (pessoa)</td><td class="n">${fmtQtd(an.prodPessoa?.hora)} ${an.atividade.unidade}</td></tr>
        <tr><td>Por dia (pessoa)</td><td class="n">${fmtQtd(an.prodPessoa?.dia)}</td></tr>
        <tr><td>Pessoas alocadas</td><td class="n">${an.pessoas}</td></tr>
        <tr><td>Medições válidas</td><td class="n">${an.nValidas}${an.ciclos.necessario ? ` / ${an.ciclos.necessario}` : ''}</td></tr>
      </table>
      ${an.atividade.descricao ? html`<p class="small soft">${an.atividade.descricao}</p>` : nothing}
      ${n.detalhe ? html`<p class="small">${n.detalhe}</p>` : nothing}
      <div class="row wrap"><a class="btn pequeno" href="#/atividade/${n.ref}">${ic('arrow-square-out')} Abrir</a><a class="btn pequeno primario" href="#/cronometro/${n.ref}">${ic('timer')} Cronometrar</a></div>
    </div>`;
  }
  if ((n.tipo === 'setor' || n.tipo === 'area') && n.ref) {
    const g = grupo(n.tipo === 'setor' ? { setorId: n.ref } : { areaId: n.ref });
    return html`<div class="stack">
      <span class="sobretitulo">${ic(n.tipo === 'setor' ? 'squares-four' : 'buildings', 'fill')} ${ROTULO_TIPO[n.tipo]}</span>
      <h3>${n.texto}</h3>
      <table class="tabela-ref">
        <tr><td>Atividades</td><td class="n">${g.nComTP}/${g.nAtividades} com TP</td></tr>
        <tr><td>TP total</td><td class="n">${fmtTempo(g.tpTotal)}</td></tr>
        <tr><td>Capacidade/hora</td><td class="n">${fmtQtd(g.capacidadeFluxo?.hora)}</td></tr>
        <tr><td>Gargalo</td><td class="n">${g.gargalo?.analise.atividade.nome || '—'}</td></tr>
        <tr><td>Medições</td><td class="n">${g.medicoes}</td></tr>
      </table>
      ${n.detalhe ? html`<p class="small">${n.detalhe}</p>` : nothing}
      <a class="btn pequeno" href=${n.tipo === 'setor' ? `#/estrutura/setor/${n.ref}` : `#/estrutura/area/${n.ref}`}>${ic('arrow-square-out')} Abrir</a>
    </div>`;
  }
  return html`<div class="stack"><span class="sobretitulo">${ROTULO_TIPO[n.tipo]}</span><h3>${n.texto}</h3>${n.detalhe ? html`<p class="small">${n.detalhe}</p>` : html`<p class="small muted">Sem detalhamento.</p>`}
    ${!v.oficial ? html`<button class="btn pequeno" style="align-self:flex-start" @click=${() => editarNo(n)}>${ic('pencil-simple')} Editar</button>` : nothing}</div>`;
}

/* ------------------------------ tela ------------------------------ */
export function telaFluxograma(rota) {
  const areaId = rota.query.area || '';
  const setorId = rota.query.setor || '';
  const chave = `${areaId}|${setorId}`;
  if (f.chave !== chave) {
    f.chave = chave;
    f.ajustar = true;
    f.sel = null;
  }
  const v = versaoAtual(areaId, setorId);
  const editavel = !v.oficial;
  const versoes = store.lista('fluxos');
  const alterado = editavel && JSON.stringify({ nos: v.nos, arestas: v.arestas }) !== JSON.stringify({ nos: store.obter('fluxos', v.id)?.nos, arestas: store.obter('fluxos', v.id)?.arestas });
  if (f.ajustar) queueMicrotask(() => { enquadrar(v.nos); f.ajustar = false; atualizar(); });

  const barraEdicao = editavel ? html`<div class="ferramentas cartao plano" style="padding:10px">
    <button class="btn pequeno primario" ?disabled=${!alterado} @click=${() => { store.salvar('fluxos', { ...store.obter('fluxos', v.id), nos: v.nos, arestas: v.arestas }); toast('Versão salva'); }}>${ic('floppy-disk')} Salvar</button>
    <button class="btn pequeno icone" aria-label="Desfazer" data-dica="Desfazer" ?disabled=${!f.pilha.length} @click=${() => { f.refazer.push(JSON.stringify({ nos: v.nos, arestas: v.arestas })); Object.assign(f.rascunho, JSON.parse(f.pilha.pop())); atualizar(); }}>${ic('arrow-u-up-left')}</button>
    <button class="btn pequeno icone" aria-label="Refazer" data-dica="Refazer" ?disabled=${!f.refazer.length} @click=${() => { f.pilha.push(JSON.stringify({ nos: v.nos, arestas: v.arestas })); Object.assign(f.rascunho, JSON.parse(f.refazer.pop())); atualizar(); }}>${ic('arrow-u-up-right')}</button>
    <span style="width:1px;height:24px;background:var(--line)"></span>
    <button class="btn pequeno" @click=${() => adicionarNo('etapa')}>${ic('rectangle')} Etapa</button>
    <button class="btn pequeno" @click=${() => adicionarNo('decisao')}>${ic('diamond')} Decisão</button>
    <button class="btn pequeno" @click=${() => adicionarNo('nota')}>${ic('note')} Nota</button>
    <button class="btn pequeno" aria-pressed=${Boolean(f.conectar)} style=${f.conectar ? 'background:var(--brand-soft);border-color:var(--brand)' : ''} @click=${() => { f.conectar = f.conectar ? null : { de: null }; atualizar(); }}>${ic('flow-arrow')} ${f.conectar ? (f.conectar.de ? 'Clique no destino…' : 'Clique na origem…') : 'Conectar'}</button>
    <button class="btn pequeno perigo" ?disabled=${!f.sel} @click=${() => excluirSelecionado()}>${ic('trash')} Excluir selecionado</button>
    <span class="grow"></span>
    <button class="btn pequeno fantasma" @click=${async () => { const nome = await pedirTexto({ titulo: 'Renomear versão', rotulo: 'Nome', valor: v.nome }); if (nome) { store.salvar('fluxos', { ...store.obter('fluxos', v.id), nome }); v.nome = nome; } }}>${ic('textbox')} Renomear</button>
    <button class="btn pequeno fantasma perigo" @click=${async () => { if (await confirmar({ titulo: `Excluir a versão "${v.nome}"?`, perigo: true, confirmar: 'Excluir' })) { store.excluir('fluxos', [v.id]); f.versaoId = 'oficial'; f.rascunho = null; f.ajustar = true; } }}>${ic('trash')} Excluir versão</button>
  </div>` : nothing;

  return {
    titulo: 'Fluxograma',
    migalhas: [{ rotulo: 'Fluxograma' }],
    conteudo: html`
      ${cabecalho({
        sobre: 'Processo',
        icone: 'flow-arrow',
        titulo: 'Fluxograma',
        texto: 'Gerado automaticamente a partir da estrutura: Operação → Setores → Atividades, com tempos e gargalos. Crie versões editáveis para propor melhorias.',
        acoes: html`
          <label class="btn">${ic('upload-simple')} Importar<input type="file" accept=".json,application/json" hidden @change=${e => importarJSON(e, areaId, setorId)} /></label>
          <button class="btn" ?disabled=${!v.nos.length} @click=${() => exportar(v)}>${ic('export')} Exportar</button>
          <button class="btn primario" ?disabled=${!v.nos.length} @click=${() => criarVersao(v, areaId, setorId)}>${ic('git-branch')} Nova versão editável</button>`,
      })}
      <div class="ferramentas">
        <select class="entrada" style="width:auto;max-width:220px" aria-label="Operação" @change=${e => definirQuery({ area: e.target.value, setor: '' })}>
          <option value="">Todas as operações</option>${store.areas().map(a => html`<option value=${a.id} ?selected=${a.id === areaId}>${a.nome}</option>`)}</select>
        <select class="entrada" style="width:auto;max-width:220px" aria-label="Setor" @change=${e => definirQuery({ setor: e.target.value })}>
          <option value="">Todos os setores</option>${(areaId ? store.setores(areaId) : store.setores()).map(s => html`<option value=${s.id} ?selected=${s.id === setorId}>${s.nome}</option>`)}</select>
        <select class="entrada" style="width:auto;max-width:260px" aria-label="Versão" @change=${e => { f.versaoId = e.target.value; f.rascunho = null; f.pilha = []; f.refazer = []; f.sel = null; f.conectar = null; f.ajustar = true; atualizar(); }}>
          <option value="oficial" ?selected=${f.versaoId === 'oficial'}>Fluxo oficial (automático)</option>
          ${versoes.map(x => html`<option value=${x.id} ?selected=${x.id === f.versaoId}>Versão: ${x.nome}</option>`)}</select>
        <div class="busca-local">${ic('magnifying-glass')}<input class="entrada" type="search" placeholder="Localizar no fluxo…" .value=${f.termo} @input=${e => { f.termo = e.target.value; atualizar(); }} /></div>
        ${editavel ? html`<span class="selo marca">${ic('pencil-simple', 'fill')}editando${alterado ? ' · não salvo' : ''}</span>` : html`<span class="selo acento">${ic('lightning', 'fill')}automático</span>`}
      </div>
      ${barraEdicao}
      ${v.nos.length ? html`<div class="fluxo-grade">
        <div class="fluxo-area ${f.conectar ? 'conectando' : ''}" @pointerdown=${iniciarPan}
          @wheel=${{ handleEvent: e => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top); }, passive: false }}
          @keydown=${e => { if ((e.key === 'Delete' || e.key === 'Backspace') && editavel) excluirSelecionado(); }} tabindex="0" aria-label="Área do fluxograma: arraste para mover, role para aproximar">
          ${svgFluxo(v, editavel)}
          <div class="fluxo-legenda">
            <span><i style="background:${CORES.area.fill}"></i>Operação</span><span><i style="background:${CORES.setor.fill}"></i>Setor</span>
            <span><i style="background:#fff;border:1px solid #cfc9b9"></i>Atividade</span><span><i style="background:#eb6834"></i>Gargalo</span>
          </div>
          <div class="fluxo-controles" @pointerdown=${e => e.stopPropagation()}>
            <button class="btn icone pequeno" aria-label="Afastar" @click=${() => zoom(1 / 1.2)}>${ic('minus')}</button>
            <button class="btn pequeno" style="min-width:58px" @click=${() => { f.vista = { ...f.vista, k: 1 }; atualizar(); }}>${Math.round(f.vista.k * 100)}%</button>
            <button class="btn icone pequeno" aria-label="Aproximar" @click=${() => zoom(1.2)}>${ic('plus')}</button>
            <button class="btn icone pequeno" aria-label="Enquadrar tudo" data-dica="Enquadrar tudo" @click=${() => { enquadrar(v.nos); atualizar(); }}>${ic('frame-corners')}</button>
          </div>
        </div>
        <aside class="cartao" style="position:sticky;top:calc(var(--topbar) + 10px)">${detalhes(v)}</aside>
      </div>` : html`<section class="cartao">${vazio({ icone: 'flow-arrow', titulo: 'Nada para desenhar', texto: 'Cadastre operações, setores e atividades na Estrutura.', acao: html`<a class="btn primario" href="#/estrutura">Ir para a estrutura</a>` })}</section>`}`,
  };
}
