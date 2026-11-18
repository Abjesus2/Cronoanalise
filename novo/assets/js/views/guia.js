// Guia da metodologia (baseado no Treinamento de Métodos & Processos).
import { html, nothing } from '../lib.js';
import { WESTINGHOUSE, TABELA_TOLERANCIAS, Z_CONFIANCA, D2, fatorWestinghouse } from '../core/calc.js';
import { fmtNum, fmtPct } from '../core/util.js';
import { ic, abrirAjuda } from '../ui/ui.js';
import { cabecalho } from '../ui/layout.js';
import { AJUDA } from '../ui/ajuda.js';

const PASSOS = [
  ['Nivelamento dos tempos', 'Elimine os tempos que fogem do padrão (muito altos ou muito baixos). O sistema faz automaticamente e mostra no gráfico de controle; você pode incluir ou excluir qualquer medição.', 'nivelamento'],
  ['Tempo total da operação', 'Soma de todas as observações válidas depois do nivelamento.', 'tempoMedio'],
  ['Número de observações', 'Quantidade de ciclos válidos. O sistema calcula quantas medições são necessárias para a confiança desejada.', 'ciclos'],
  ['Frequência lógica', 'Quanto cada observação representa: 1/34 (um carrinho com 34 peças), 2/1 (duas medições para uma peça)…', 'freqLogica'],
  ['Tempo base (médio)', 'Tempo do operador, no sistema dele, com o método atual — por unidade.', 'tempoBase'],
  ['Avaliação de ritmo', 'Habilidade + esforço do operador (Tabela de Westinghouse), ou percentual direto.', 'ritmo'],
  ['Normalização do tempo', 'Tempo normal = tempo base × ritmo.', 'tempoNormal'],
  ['Tolerâncias', 'Necessidades pessoais, fadiga, monotonia, ambiente, lubrificação, imprevistos e paradas programadas.', 'tolerancia'],
  ['Tempo padrão', 'Tempo padrão = tempo normal × fator de tolerância.', 'tempoPadrao'],
  ['Soma de elementos', 'O tempo padrão de um setor/linha é a soma das atividades. A capacidade da linha é limitada pelo gargalo.', 'tpTotal'],
];

export function telaGuia() {
  const glossario = Object.entries(AJUDA).sort((a, b) => a[1].titulo.localeCompare(b[1].titulo, 'pt-BR'));
  return {
    titulo: 'Guia',
    migalhas: [{ rotulo: 'Guia da metodologia' }],
    conteudo: html`
      ${cabecalho({ sobre: 'Aprenda', icone: 'book-open', titulo: 'Guia da metodologia', texto: 'Como o sistema transforma cronometragens em tempo padrão e produtividade — os mesmos passos do treinamento de Métodos & Processos.' })}
      <div class="dividido">
        <div class="stack loose">
          <section class="cartao tinta stack">
            <h2 style="color:var(--paper)">Como usar em 4 passos</h2>
            <div class="grade g4">
              ${[
                ['tree-structure', 'Organize', 'Cadastre áreas, setores e atividades na ordem do processo.', '#/estrutura'],
                ['timer', 'Cronometre', 'Abra o cronômetro, toque em Iniciar e em Registrar ciclo a cada peça/lote.', '#/cronometro'],
                ['seal-check', 'Confie', 'Continue até a confiabilidade da amostra chegar a 100%.', '#/produtividade/atividades'],
                ['chart-line-up', 'Use', 'Veja a produtividade por minuto, hora, dia, mês e ano; planeje a equipe.', '#/produtividade'],
              ].map(([i, t, d, h]) => html`<a class="stack tight" href=${h} style="text-decoration:none;color:inherit">
                <span class="ic laranja" style="width:44px;height:44px;border-radius:13px;display:grid;place-items:center;font-size:1.4rem">${ic(i, 'duo')}</span>
                <b style="font-family:var(--f-display);font-size:1.05rem">${t}</b><span class="small soft">${d}</span></a>`)}
            </div>
          </section>

          <section class="stack">
            <h2 class="row">${ic('path', 'duo')} Os 10 passos do tempo padrão</h2>
            <div class="guia-passos">
              ${PASSOS.map(([t, d, chave]) => html`<div class="guia-passo"><div class="stack tight">
                <h3>${t}</h3><p class="soft">${d}</p>
                ${AJUDA[chave]?.formula ? html`<div class="formula">${AJUDA[chave].formula}</div>` : nothing}
              </div></div>`)}
            </div>
          </section>

          <section class="cartao stack">
            <h2 class="row">${ic('gauge', 'duo')} Tabela de Westinghouse (Habilidade × Esforço)</h2>
            <p class="small soft">Fator de ritmo = 1 + habilidade + esforço. D = normal (100%).</p>
            <div class="tabela-wrap"><table class="tabela" style="font-size:.8rem">
              <thead><tr><th>Esforço ↓ / Habilidade →</th>${WESTINGHOUSE.habilidade.map(h => html`<th class="n" title=${h.grupo}>${h.cod}<br /><span style="font-weight:500">${h.v > 0 ? '+' : ''}${fmtNum(h.v, 2)}</span></th>`)}</tr></thead>
              <tbody>${WESTINGHOUSE.esforco.map(e => html`<tr><td><b>${e.cod}</b> ${e.grupo} <span class="muted">(${e.v > 0 ? '+' : ''}${fmtNum(e.v, 2)})</span></td>
                ${WESTINGHOUSE.habilidade.map(h => {
                  const v = fatorWestinghouse(h.cod, e.cod);
                  return html`<td class="n mono" style=${v === 1 ? 'background:var(--brand-soft);font-weight:700' : ''}>${fmtNum(v, 2)}</td>`;
                })}</tr>`)}</tbody>
            </table></div>
          </section>

          <section class="cartao stack">
            <h2 class="row">${ic('coffee', 'duo')} Tabela de tolerâncias</h2>
            <div class="grade g2">${TABELA_TOLERANCIAS.map(cat => html`<div class="cartao plano" style="padding:14px">
              <h4>${cat.nome}</h4><p class="tiny muted">${cat.ajuda}</p>
              <table class="tabela-ref mt-s">
                ${cat.opcoes ? cat.opcoes.map(o => html`<tr><td>${o.nome}</td><td class="n">${cat.porGenero ? `H ${fmtPct(o.h, 0)} · M ${fmtPct(o.m, 0)}` : fmtPct(o.v, 1)}</td></tr>`) : nothing}
                ${cat.faixas ? cat.faixas.map((fx, i) => html`<tr><td>${i === 0 ? 'até' : cat.faixas[i - 1].ate.toString().replace('.', ',') + ' a'} ${fx.ate === Infinity ? 'mais' : fx.ate.toString().replace('.', ',')} min</td><td class="n">${fmtPct(fx.v, 1)}</td></tr>`) : nothing}
                ${cat.faixa ? html`<tr><td>Faixa</td><td class="n">${fmtPct(cat.faixa[0], 0)} a ${fmtPct(cat.faixa[1], 0)}</td></tr>` : nothing}
              </table></div>`)}</div>
          </section>
        </div>

        <div class="stack loose">
          <section class="cartao stack">
            <h3 class="row">${ic('clock', 'duo')} Escalas de tempo</h3>
            <p class="small soft">A cronometragem industrial usa minutos <b>centesimais</b> (o minuto dividido em 100). Só a fração do minuto é convertida.</p>
            <div class="formula">1 min 45 s = 1,75 min (45 ÷ 60 = 0,75)\n0,58 min × 60 = 35 s\nErrado: 1 min 45 s ≠ 1,45 min</div>
            <p class="small soft">Escolha o formato de exibição em Configurações › Preferências.</p>
          </section>
          <section class="cartao stack">
            <h3 class="row">${ic('chart-bar', 'duo')} Coeficientes estatísticos</h3>
            <table class="tabela-ref"><tr><th>Confiança</th><th class="n">Z</th></tr>${Z_CONFIANCA.map(z => html`<tr><td>${fmtPct(z.c, 0)}</td><td class="n">${fmtNum(z.z, 2)}</td></tr>`)}</table>
            <table class="tabela-ref"><tr><th>Medições iniciais</th><th class="n">d₂</th></tr>${Object.entries(D2).map(([n, d]) => html`<tr><td>${n}</td><td class="n">${fmtNum(d, 3)}</td></tr>`)}</table>
          </section>
          <section class="cartao stack">
            <h3 class="row">${ic('book-bookmark', 'duo')} Glossário</h3>
            <div class="lista">${glossario.map(([k, a]) => html`<button class="item" @click=${() => abrirAjuda(k)}>
              <span class="avatar">${ic(a.icone || 'function')}</span><span class="corpo"><b>${a.titulo}</b></span>${ic('caret-right')}</button>`)}</div>
          </section>
          <section class="cartao stack">
            <h3 class="row">${ic('keyboard', 'duo')} Atalhos</h3>
            <table class="tabela-ref">
              <tr><td><kbd>Ctrl</kbd> + <kbd>K</kbd></td><td>Buscar qualquer coisa</td></tr>
              <tr><td><kbd>Espaço</kbd></td><td>Cronômetro: iniciar / registrar ciclo</td></tr>
              <tr><td><kbd>P</kbd></td><td>Cronômetro: pausar / retomar</td></tr>
              <tr><td><kbd>Esc</kbd></td><td>Cronômetro: descartar ciclo atual</td></tr>
              <tr><td><kbd>Ctrl</kbd> + <kbd>Z</kbd></td><td>Cronômetro: desfazer último ciclo</td></tr>
            </table>
          </section>
        </div>
      </div>`,
  };
}
