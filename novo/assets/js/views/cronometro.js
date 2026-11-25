// Cronômetro de campo: leitura contínua por ciclos, com registro imediato.
import { html, svg, nothing, live } from '../lib.js';
import { store } from '../core/store.js';
import { analise } from '../core/consultas.js';
import { estatisticas } from '../core/calc.js';
import { fmtTempo, fmtCronometro } from '../core/time.js';
import { combina, fmtNum, fmtPct, fmtQtd, numero, tempoRelativo, prefereMenosMovimento } from '../core/util.js';
import { prefs, definirPrefs, ehAvancado } from '../core/prefs.js';
import { ic, anel, toast, vazio, confirmar } from '../ui/ui.js';
import { cabecalho } from '../ui/layout.js';
import { camposParametros, datalists, formMedicao } from '../ui/formularios.js';
import { atualizar, ir, rotaAtual } from '../ui/nav.js';
import { recentes } from '../core/consultas.js';

const CHAVE_SESSAO = 'crono.v2.cronometro';

const c = {
  atividadeId: null,
  estado: 'parado', // parado | rodando | pausado
  inicioVolta: 0,
  inicioEpoch: 0,
  acumulado: 0,
  valores: {},
  fixos: new Set(),
  motivoId: '',
  observacao: '',
  obsFixa: false,
  ritmo: '',
  ritmoFixo: true,
  sessao: [],
  aposRegistrar: 'continuar',
  termo: '',
  wake: null,
  raf: 0,
};

/* ------------------------------ persistência da sessão ------------------------------ */
function salvarSessao() {
  try {
    sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify({
      atividadeId: c.atividadeId,
      estado: c.estado,
      acumulado: c.acumulado,
      inicioEpoch: c.inicioEpoch,
      sessao: c.sessao,
      valores: c.valores,
      fixos: [...c.fixos],
      aposRegistrar: c.aposRegistrar,
    }));
  } catch {
    /* ignora */
  }
}

(function restaurar() {
  try {
    const s = JSON.parse(sessionStorage.getItem(CHAVE_SESSAO) || 'null');
    if (!s) return;
    Object.assign(c, { atividadeId: s.atividadeId, estado: s.estado, acumulado: s.acumulado || 0, inicioEpoch: s.inicioEpoch, sessao: s.sessao || [], valores: s.valores || {}, fixos: new Set(s.fixos || []), aposRegistrar: s.aposRegistrar || 'continuar' });
    if (c.estado === 'rodando') c.inicioVolta = performance.now() - (Date.now() - c.inicioEpoch);
  } catch {
    /* ignora */
  }
})();

const decorrido = () => (c.estado === 'rodando' ? c.acumulado + (performance.now() - c.inicioVolta) : c.acumulado);

/* ------------------------------ tela sempre ligada ------------------------------ */
async function manterTela(ligar) {
  try {
    if (ligar && prefs().manterTelaLigada && 'wakeLock' in navigator && !c.wake) {
      c.wake = await navigator.wakeLock.request('screen');
      c.wake.addEventListener('release', () => (c.wake = null));
    } else if (!ligar && c.wake) {
      await c.wake.release();
      c.wake = null;
    }
  } catch {
    c.wake = null;
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && c.estado === 'rodando') manterTela(true);
});
window.addEventListener('beforeunload', e => {
  if (c.estado !== 'parado' && decorrido() > 1000) {
    salvarSessao();
    e.preventDefault();
    e.returnValue = '';
  }
});

/* ------------------------------ ações ------------------------------ */
function iniciar() {
  if (!c.atividadeId) return;
  c.estado = 'rodando';
  c.acumulado = 0;
  c.inicioVolta = performance.now();
  c.inicioEpoch = Date.now();
  manterTela(true);
  vibrar(20);
  salvarSessao();
  atualizar();
}

function pausar() {
  if (c.estado !== 'rodando') return;
  c.acumulado += performance.now() - c.inicioVolta;
  c.estado = 'pausado';
  manterTela(false);
  salvarSessao();
  atualizar();
}

function retomar() {
  if (c.estado !== 'pausado') return;
  // o tempo já acumulado é incorporado ao instante de início (sobrevive a recarregar a página)
  const antes = c.acumulado;
  c.estado = 'rodando';
  c.acumulado = 0;
  c.inicioVolta = performance.now() - antes;
  c.inicioEpoch = Date.now() - antes;
  manterTela(true);
  salvarSessao();
  atualizar();
}

async function zerar() {
  const t = decorrido();
  if (t > 15000 && !(await confirmar({ titulo: 'Descartar o ciclo atual?', mensagem: `O tempo de ${fmtTempo(t / 1000)} não será registrado.`, confirmar: 'Descartar', perigo: true }))) return;
  c.estado = 'parado';
  c.acumulado = 0;
  manterTela(false);
  salvarSessao();
  atualizar();
}

function vibrar(ms) {
  if (prefs().vibrar && navigator.vibrate) navigator.vibrate(ms);
}

function registrar(evento) {
  const a = store.obter('atividades', c.atividadeId);
  if (!a || c.estado === 'parado') return;
  const ms = decorrido();
  if (ms < 200) return;
  const agora = performance.now();
  const p = prefs();
  const med = store.salvar('medicoes', {
    atividadeId: a.id,
    dataHora: new Date().toISOString(),
    tempo: Math.round(ms) / 1000,
    valores: { ...c.valores },
    operador: (p.operador || '').trim(),
    cronometrista: (p.cronometrista || '').trim(),
    motivoId: c.motivoId || null,
    observacao: c.observacao.trim(),
    ritmo: numero(c.ritmo) ? numero(c.ritmo) / 100 : null,
    nivel: 'auto',
    origem: 'cronometro',
  }, { registrarHistorico: false });
  c.sessao.unshift(med.id);

  // próximo ciclo
  if (c.aposRegistrar === 'continuar' && c.estado === 'rodando') {
    c.acumulado = 0;
    c.inicioVolta = agora;
    c.inicioEpoch = Date.now();
  } else {
    c.estado = 'parado';
    c.acumulado = 0;
    manterTela(false);
  }
  // limpa campos não fixados
  for (const par of a.parametros || []) if (!c.fixos.has(par.id)) delete c.valores[par.id];
  c.motivoId = '';
  if (!c.obsFixa) c.observacao = '';
  if (!c.ritmoFixo) c.ritmo = '';
  vibrar(35);
  ondular(evento);
  salvarSessao();
  if (a.campoQtdId && !(numero(med.valores[a.campoQtdId]) > 0)) {
    toast('Ciclo registrado sem quantidade — complete na lista abaixo.', { tipo: 'aviso' });
  }
  atualizar();
}

function desfazer() {
  const id = c.sessao[0];
  if (!id) return;
  store.excluir('medicoes', [id], { registrarHistorico: false });
  c.sessao.shift();
  salvarSessao();
  toast('Último ciclo removido', { tipo: 'info' });
}

function ondular(evento) {
  const btn = document.getElementById('crono-principal');
  if (!btn || prefereMenosMovimento()) return;
  const r = btn.getBoundingClientRect();
  const o = document.createElement('span');
  o.className = 'onda';
  const tam = Math.max(r.width, r.height);
  o.style.width = o.style.height = tam + 'px';
  const x = evento?.clientX ? evento.clientX - r.left : r.width / 2;
  const y = evento?.clientY ? evento.clientY - r.top : r.height / 2;
  o.style.left = x - tam / 2 + 'px';
  o.style.top = y - tam / 2 + 'px';
  btn.appendChild(o);
  setTimeout(() => o.remove(), 650);
}

function acaoPrincipal(e) {
  if (c.estado === 'parado') iniciar();
  else if (c.estado === 'rodando') registrar(e);
  else retomar();
}

/* ------------------------------ atalhos de teclado ------------------------------ */
document.addEventListener('keydown', e => {
  if (!location.hash.startsWith('#/cronometro/') || !c.atividadeId) return;
  if (document.querySelector('dialog[open]')) return;
  const alvo = e.target;
  const digitando = alvo.closest?.('input, textarea, select, [contenteditable]');
  if (e.key === ' ' && !digitando) {
    e.preventDefault();
    acaoPrincipal();
  } else if ((e.key === 'Enter' && e.ctrlKey) || (e.key === 'Enter' && !digitando && alvo.tagName !== 'BUTTON' && alvo.tagName !== 'A')) {
    e.preventDefault();
    acaoPrincipal();
  } else if (!digitando && (e.key === 'p' || e.key === 'P')) {
    c.estado === 'rodando' ? pausar() : retomar();
  } else if (!digitando && e.key === 'Escape') {
    zerar();
  } else if (!digitando && (e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    desfazer();
  }
});

/* ------------------------------ laço de animação ------------------------------ */
const R = 150;
const CIRC = 2 * Math.PI * R;

function laco(referencia) {
  cancelAnimationFrame(c.raf);
  const passo = () => {
    const tempoEl = document.getElementById('crono-tempo');
    if (!tempoEl) return; // saiu da tela
    const ms = decorrido();
    const { principal, fracao } = fmtCronometro(ms, 1);
    tempoEl.firstChild.nodeValue = principal;
    document.getElementById('crono-fr').textContent = ',' + fracao;
    const prog = document.getElementById('crono-prog');
    const ponteiro = document.getElementById('crono-ponteiro');
    if (prog) {
      const f = referencia > 0 ? ms / 1000 / referencia : 0;
      prog.setAttribute('stroke-dashoffset', String(CIRC * (1 - Math.min(1, f))));
      prog.classList.toggle('passou', f > 1);
    }
    if (ponteiro) ponteiro.setAttribute('transform', `rotate(${((ms / 1000) % 60) * 6} 180 180)`);
    c.raf = requestAnimationFrame(passo);
  };
  c.raf = requestAnimationFrame(passo);
}

function mostrador(referencia) {
  const marcas = Array.from({ length: 60 }, (_, i) => {
    const ang = (i / 60) * Math.PI * 2;
    const r1 = i % 5 ? 164 : 158;
    return svg`<line class=${i % 5 ? '' : 'forte'} x1=${180 + Math.sin(ang) * r1} y1=${180 - Math.cos(ang) * r1} x2=${180 + Math.sin(ang) * 170} y2=${180 - Math.cos(ang) * 170}></line>`;
  });
  const estadoTxt = { parado: 'Pronto', rodando: 'Cronometrando', pausado: 'Pausado' }[c.estado];
  return html`<div class="mostrador-crono">
    <svg class="aro" viewBox="0 0 360 360" aria-hidden="true">
      <g class="marcas">${marcas}</g>
      <circle class="base-aro" cx="180" cy="180" r=${R}></circle>
      <circle id="crono-prog" class="progresso" cx="180" cy="180" r=${R} stroke-dasharray=${CIRC} stroke-dashoffset=${CIRC} transform="rotate(-90 180 180)"></circle>
      <g id="crono-ponteiro"><line class="ponteiro-crono" x1="180" y1="70" x2="180" y2="40"></line><circle cx="180" cy="44" r="5" fill="var(--brand)"></circle></g>
    </svg>
    <div class="leitura" aria-live="off">
      <span class="estado">${c.estado === 'rodando' ? html`<span class="ponto ok pulsa"></span>` : c.estado === 'pausado' ? html`<span class="ponto alerta"></span>` : html`<span class="ponto"></span>`}${estadoTxt}</span>
      <span class="tempo" id="crono-tempo">00:00<span class="fr" id="crono-fr">,0</span></span>
      <span class="ref">${referencia ? `média do ciclo ${fmtTempo(referencia)}` : 'sem média ainda'}</span>
    </div>
  </div>`;
}

/* ------------------------------ escolha da atividade ------------------------------ */
function telaEscolha() {
  const rec = recentes(8);
  const grupos = [];
  for (const area of store.areas()) {
    for (const setor of store.setores(area.id)) {
      const ats = store.atividades(setor.id).filter(a => combina(`${area.nome} ${setor.nome} ${a.nome}`, c.termo));
      if (ats.length) grupos.push({ area, setor, ats });
    }
  }
  return {
    titulo: 'Cronômetro',
    migalhas: [{ rotulo: 'Cronômetro' }],
    conteudo: html`
      ${cabecalho({ sobre: 'Cronômetro', icone: 'timer', titulo: 'O que vamos medir?', texto: 'Escolha a atividade. Cada ciclo registrado é salvo na hora — mesmo sem internet.' })}
      ${store.atividades().length ? html`<div class="dividido">
        <section class="cartao stack">
          <div class="busca-local" style="max-width:none">${ic('magnifying-glass')}
            <input class="entrada" type="search" autofocus placeholder="Buscar atividade, setor ou operação…" .value=${c.termo} @input=${e => { c.termo = e.target.value; atualizar(); }} /></div>
          <div class="lista">
            ${grupos.map(g => html`<div class="paleta-grupo">${g.area.nome} › ${g.setor.nome}</div>
              ${g.ats.map(a => {
                const an = analise(a.id);
                return html`<a class="item" href="#/cronometro/${a.id}">
                  <span class="avatar">${ic('cube')}</span>
                  <span class="corpo"><b>${a.nome}</b><span>${an.nValidas} medições válidas${an.ciclos.necessario ? ` de ${an.ciclos.necessario} necessárias` : ''}</span></span>
                  ${ic('play', 'fill')}
                </a>`;
              })}`)}
          </div>
        </section>
        <section class="cartao stack">
          <h3 class="row">${ic('clock-counter-clockwise', 'duo')} Medidas recentemente</h3>
          ${rec.length ? html`<div class="lista">${rec.map(({ atividade, data }) => html`<a class="item" href="#/cronometro/${atividade.id}">
            <span class="corpo"><b>${atividade.nome}</b><span>${tempoRelativo(data)}</span></span>${ic('arrow-right')}</a>`)}</div>`
          : html`<p class="small muted">Nada medido ainda.</p>`}
        </section>
      </div>` : html`<section class="cartao">${vazio({ icone: 'cube', titulo: 'Cadastre uma atividade primeiro', texto: 'O cronômetro mede atividades cadastradas na Estrutura.', acao: html`<a class="btn primario" href="#/estrutura">Ir para a estrutura</a>` })}</section>`}`,
  };
}

/* ------------------------------ tela principal ------------------------------ */
export function telaCronometro(rota) {
  const id = rota.partes[1];
  if (!id) return telaEscolha();
  const a = store.obter('atividades', id);
  if (!a) return telaEscolha();
  if (c.atividadeId !== id) {
    if (c.estado !== 'parado' && c.atividadeId) {
      c.estado = 'parado';
      c.acumulado = 0;
    }
    c.atividadeId = id;
    c.sessao = [];
    c.valores = {};
    c.fixos = new Set((a.parametros || []).filter(p => p.fixo).map(p => p.id));
    salvarSessao();
  }
  const an = analise(id);
  const caminho = store.caminho(a);
  const p = prefs();
  const avancado = ehAvancado();
  const sessao = c.sessao.map(mid => an.linhas.find(l => l.m.id === mid)).filter(Boolean);
  const estSessao = estatisticas(sessao.map(l => l.t));
  const referencia = an.cicloMedio || estSessao.media || null;
  const paradas = store.mapaParadas();
  queueMicrotask(() => laco(referencia));

  const rotuloPrincipal = c.estado === 'parado' ? 'Iniciar' : c.estado === 'rodando' ? 'Registrar ciclo' : 'Retomar';
  const iconePrincipal = c.estado === 'parado' ? 'play' : c.estado === 'rodando' ? 'flag-pennant' : 'play';

  return {
    titulo: 'Cronômetro',
    migalhas: [{ rotulo: 'Cronômetro', href: '#/cronometro' }, { rotulo: a.nome }],
    conteudo: html`
      <div class="crono">
        <section class="crono-painel">
          <div class="row top between">
            <div class="stack tight" style="gap:2px;min-width:0">
              <span class="contexto">${[caminho.area?.nome, caminho.setor?.nome].filter(Boolean).join(' › ')}</span>
              <span class="atividade-nome">${a.nome}</span>
            </div>
            <div class="row" style="gap:6px">
              <a class="btn pequeno" style="--b-bg:transparent;--b-fg:var(--paper);--b-bd:color-mix(in srgb,var(--paper) 25%,transparent)" href="#/atividade/${a.id}" data-dica="Ver produtividade">${ic('chart-line-up')}</a>
              <a class="btn pequeno" style="--b-bg:transparent;--b-fg:var(--paper);--b-bd:color-mix(in srgb,var(--paper) 25%,transparent)" href="#/cronometro" data-dica="Trocar atividade">${ic('swap')}</a>
              ${document.fullscreenEnabled ? html`<button class="btn pequeno" style="--b-bg:transparent;--b-fg:var(--paper);--b-bd:color-mix(in srgb,var(--paper) 25%,transparent)" data-dica="Tela cheia"
                @click=${() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())}>${ic('arrows-out')}</button>` : nothing}
            </div>
          </div>
          ${mostrador(referencia)}
          <div class="crono-acoes">
            <button class="crono-btn" @click=${zerar} ?disabled=${c.estado === 'parado'} aria-label="Descartar ciclo atual">${ic('arrow-counter-clockwise', 'bold')}<span class="rot">Descartar</span></button>
            <button id="crono-principal" class="crono-btn principal ${c.estado === 'parado' ? 'iniciar' : ''}" @click=${acaoPrincipal}>${ic(iconePrincipal, 'fill')}<span class="rot">${rotuloPrincipal}</span></button>
            <button class="crono-btn" @click=${() => (c.estado === 'rodando' ? pausar() : retomar())} ?disabled=${c.estado === 'parado'}>${ic(c.estado === 'pausado' ? 'play' : 'pause', 'fill')}<span class="rot">${c.estado === 'pausado' ? 'Retomar' : 'Pausar'}</span></button>
          </div>
          <div class="crono-stats">
            <div><b>${sessao.length}</b><span>ciclos agora</span></div>
            <div><b>${sessao[0] ? fmtTempo(sessao[0].t) : '—'}</b><span>último</span></div>
            <div><b>${estSessao.media ? fmtTempo(estSessao.media) : '—'}</b><span>média agora</span></div>
            <div><b>${an.nValidas}${an.ciclos.necessario ? `/${an.ciclos.necessario}` : ''}</b><span>na amostra</span></div>
          </div>
          <div class="crono-teclas nao-imprimir">
            <span><kbd>Espaço</kbd> iniciar / registrar</span><span><kbd>P</kbd> pausar</span><span><kbd>Esc</kbd> descartar</span><span><kbd>Ctrl</kbd>+<kbd>Z</kbd> desfazer</span>
          </div>
        </section>

        <div class="stack">
          <section class="cartao stack">
            <div class="row between"><h3 class="row">${ic('note-pencil', 'duo')} Dados do próximo ciclo</h3>
              <div class="segmentado" role="group" aria-label="Após registrar">
                <button aria-pressed=${c.aposRegistrar === 'continuar'} data-dica="Leitura contínua: o próximo ciclo começa no instante do registro" @click=${() => { c.aposRegistrar = 'continuar'; salvarSessao(); atualizar(); }}>Contínuo</button>
                <button aria-pressed=${c.aposRegistrar === 'parar'} data-dica="O cronômetro para após cada registro" @click=${() => { c.aposRegistrar = 'parar'; salvarSessao(); atualizar(); }}>Um por vez</button>
              </div>
            </div>
            <div class="grade-form">
              ${camposParametros(a, c.valores, () => salvarSessao(), {
                fixos: c.fixos,
                alternarFixo: pid => { c.fixos.has(pid) ? c.fixos.delete(pid) : c.fixos.add(pid); salvarSessao(); atualizar(); },
              })}
              <div class="campo"><label for="cr-op">Operador</label>
                <input id="cr-op" class="entrada" list="dl-operadores" .value=${p.operador || ''} placeholder="Nome ou matrícula" @change=${e => definirPrefs({ operador: e.target.value })} /></div>
              <div class="campo"><label for="cr-mot">Anomalia</label>
                <select id="cr-mot" class="entrada" @change=${e => (c.motivoId = e.target.value)}>
                  <option value="" ?selected=${!c.motivoId}>Operação normal</option>
                  ${store.paradas('motivo').map(m => html`<option value=${m.id} ?selected=${c.motivoId === m.id}>${m.nome}</option>`)}
                </select></div>
              ${avancado ? html`<div class="campo"><label for="cr-rit">Ritmo avaliado
                <button type="button" class="ajuda-btn" style=${c.ritmoFixo ? 'color:var(--brand-strong)' : ''} data-dica="Manter para os próximos ciclos" @click=${() => { c.ritmoFixo = !c.ritmoFixo; atualizar(); }}>${ic('push-pin', c.ritmoFixo ? 'fill' : '')}</button></label>
                <div class="entrada-grupo"><input id="cr-rit" class="entrada" inputmode="decimal" placeholder=${fmtNum((an.atividade.ritmo.modo === 'westinghouse' ? an.ritmo : an.atividade.ritmo.valor) * 100, 0)} .value=${live(c.ritmo)} @input=${e => (c.ritmo = e.target.value)} /><span class="sufixo">%</span></div></div>` : nothing}
              <div class="campo cheio"><label for="cr-obs">Observação
                <button type="button" class="ajuda-btn" style=${c.obsFixa ? 'color:var(--brand-strong)' : ''} data-dica=${c.obsFixa ? 'Mantida nos próximos ciclos' : 'Manter nos próximos ciclos'} @click=${() => { c.obsFixa = !c.obsFixa; atualizar(); }}>${ic('push-pin', c.obsFixa ? 'fill' : '')}</button></label>
                <textarea id="cr-obs" class="entrada" rows="2" .value=${live(c.observacao)} @input=${e => (c.observacao = e.target.value)} placeholder="Detalhes deste ciclo (opcional)"></textarea></div>
            </div>
            ${datalists()}
            ${a.campoQtdId ? html`<p class="tiny muted">${ic('info')} Informe a quantidade de ${a.unidade} antes de registrar. Use o alfinete para repetir o valor.</p>` : nothing}
          </section>

          <section class="cartao stack">
            <div class="row between"><h3 class="row">${ic('list-numbers', 'duo')} Ciclos desta sessão</h3>
              <div class="row" style="gap:6px">
                ${sessao.length ? html`<button class="btn fantasma pequeno" @click=${desfazer}>${ic('arrow-u-up-left')} Desfazer último</button>` : nothing}
                <a class="btn fantasma pequeno" href="#/atividade/${a.id}/medicoes">Todas ${ic('arrow-right')}</a>
              </div></div>
            ${sessao.length ? html`<div class="ciclos-lista">
              ${sessao.map((l, i) => {
                const rel = an.tempoBase && l.u ? l.u / an.tempoBase : null;
                const classe = rel == null ? '' : rel > 1.15 ? 'lento' : rel < 0.85 ? 'rapido' : '';
                const motivo = l.m.motivoId ? paradas.get(l.m.motivoId) : null;
                return html`<div class="ciclo ${classe} ${motivo ? 'anomalia' : ''}">
                  <span class="n-ciclo">${sessao.length - i}</span>
                  <div class="stack tight" style="gap:4px;min-width:0">
                    <div class="row" style="gap:8px"><span class="t-ciclo">${fmtTempo(l.t)}</span>
                      ${l.q && l.q !== 1 ? html`<span class="tiny muted">${fmtQtd(l.q)} ${a.unidade}</span>` : nothing}
                      ${!l.q ? html`<span class="selo warning">${ic('warning', 'fill')}sem quantidade</span>` : nothing}
                      ${motivo ? html`<span class="selo serious">${motivo.nome}</span>` : nothing}
                      ${l.status === 'nivelada' ? html`<span class="selo critical" data-dica=${l.razao}>${ic('funnel', 'fill')}</span>` : nothing}</div>
                    <div class="barra-ciclo" style="width:${Math.min(100, (rel || 1) * 60)}%"></div>
                  </div>
                  <span class="tiny muted num">${rel ? fmtPct(1 / rel, 0) : ''}</span>
                  <button class="btn fantasma icone pequeno" aria-label="Editar" @click=${() => formMedicao(l.m)}>${ic('pencil-simple')}</button>
                </div>`;
              })}
            </div>` : html`<p class="small muted">Os ciclos registrados aparecem aqui. ${c.estado === 'parado' ? 'Toque em Iniciar ou pressione Espaço.' : ''}</p>`}
          </section>
        </div>
      </div>`,
  };
}

export function cronometroAtivo() {
  return c.estado !== 'parado' ? c.atividadeId : null;
}
