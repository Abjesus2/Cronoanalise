// Painel inicial.
import { html, svg, nothing } from '../lib.js';
import { store } from '../core/store.js';
import { analise, analisesDoEscopo, grupo, pendencias, recentes } from '../core/consultas.js';
import { fmtTempo } from '../core/time.js';
import { fmtQtd, fmtPct, tempoRelativo, fmtNum } from '../core/util.js';
import { ic, num, anel, seloSaude, vazio, ajuda } from '../ui/ui.js';
import { barrasH } from '../ui/charts.js';
import { formArea, formSetor, formAtividade } from '../ui/formularios.js';
import { carregarExemplo, temExemplo } from '../core/exemplo.js';
import { ir } from '../ui/nav.js';
import { toast } from '../ui/ui.js';

function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

function mostrador() {
  const marcas = Array.from({ length: 60 }, (_, i) => {
    const a = (i / 60) * Math.PI * 2;
    const r1 = i % 5 ? 160 : 148;
    return svg`<line x1=${180 + Math.sin(a) * r1} y1=${180 - Math.cos(a) * r1} x2=${180 + Math.sin(a) * 172} y2=${180 - Math.cos(a) * 172}
      stroke="currentColor" stroke-width=${i % 5 ? 1.5 : 3} stroke-linecap="round"></line>`;
  });
  return html`<svg class="mostrador" viewBox="0 0 360 360" aria-hidden="true">
    <circle cx="180" cy="180" r="176" fill="none" stroke="currentColor" stroke-width="2"></circle>
    ${marcas}
    <g class="ponteiro"><line x1="180" y1="180" x2="180" y2="40" stroke="currentColor" stroke-width="4" stroke-linecap="round"></line></g>
    <circle cx="180" cy="180" r="9" fill="currentColor"></circle>
  </svg>`;
}

function primeirosPassos() {
  const passos = [
    { feito: store.areas().length > 0, titulo: 'Crie uma área', texto: 'Ex.: Produção, Expedição.', acao: () => formArea() },
    { feito: store.setores().length > 0, titulo: 'Crie um setor', texto: 'Ex.: Corte, Costura.', acao: () => formSetor() },
    { feito: store.atividades().length > 0, titulo: 'Cadastre a atividade', texto: 'A operação que será medida.', acao: () => formAtividade() },
    { feito: store.lista('medicoes').length >= 5, titulo: 'Cronometre', texto: 'Faça ao menos 5 medições.', acao: () => ir('#/cronometro') },
    { feito: analisesDoEscopo({}).some(a => a.amostraOk), titulo: 'Veja a produtividade', texto: 'Por minuto, hora, dia, mês, ano.', acao: () => ir('#/produtividade') },
  ];
  return html`<section class="cartao">
    <div class="cartao-topo">
      <h3>${ic('rocket-launch', 'duo')} Primeiros passos</h3>
      ${!temExemplo() ? html`<button class="btn pequeno" @click=${() => {
        const area = carregarExemplo();
        toast('Dados de exemplo carregados', { acao: () => ir(`#/estrutura/area/${area.id}`), rotuloAcao: 'Ver' });
      }}>${ic('sparkle')} Carregar dados de exemplo</button>` : nothing}
    </div>
    <div class="passos-inicio entrar">
      ${passos.map((p, i) => html`<div class="passo-inicio ${p.feito ? 'feito' : ''}" style="--i:${i}">
        <b>${p.titulo}</b><span class="small soft">${p.texto}</span>
        ${p.feito ? nothing : html`<button class="btn pequeno" style="align-self:flex-start" @click=${p.acao}>Fazer agora ${ic('arrow-right')}</button>`}
      </div>`)}
    </div>
    <p class="small muted mt">Já usava o sistema antigo? Traga tudo em <a href="#/configuracoes/dados">Configurações › Importar e exportar</a>.</p>
  </section>`;
}

export function telaPainel() {
  const ans = analisesDoEscopo({});
  const g = grupo({});
  const medicoes = store.lista('medicoes');
  const hoje = new Date().toDateString();
  const medHoje = medicoes.filter(m => m.dataHora && new Date(m.dataHora).toDateString() === hoje).length;
  const comTP = ans.filter(a => a.tempoPadrao > 0);
  const confiaveis = ans.filter(a => a.amostraOk).length;
  const nome = (store.sync.usuario?.nome || '').split(' ')[0];
  const pend = pendencias().slice(0, 6);
  const rec = recentes(6);
  const iniciante = store.atividades().length === 0 || medicoes.length < 5;

  const areasCobertura = store.areas().map(area => {
    const gr = grupo({ areaId: area.id });
    return {
      rotulo: area.nome,
      valor: gr.nAtividades ? gr.nComTP / gr.nAtividades : 0,
      texto: `${gr.nComTP}/${gr.nAtividades}`,
      href: `#/estrutura/area/${area.id}`,
      dica: `${gr.nComTP} de ${gr.nAtividades} atividades com tempo padrão\n${gr.medicoes} medições`,
    };
  });

  return {
    titulo: 'Painel',
    conteudo: html`
      <div class="stack loose entrar">
        <section class="boas-vindas" style="--i:0">
          ${mostrador()}
          <div class="stack" style="justify-content:center">
            <span class="sobretitulo" style="color:var(--brand)">${ic('timer', 'fill')} Métodos &amp; Processos</span>
            <h1>${saudacao()}${nome ? `, ${nome}` : ''}.</h1>
            <p>${comTP.length
              ? `${comTP.length} atividade(s) já têm tempo padrão. ${confiaveis} com amostra estatisticamente suficiente.`
              : 'Cadastre suas atividades, cronometre e o sistema calcula o tempo padrão e a produtividade automaticamente.'}</p>
            <div class="row wrap mt-s">
              <a class="btn primario grande" href="#/cronometro">${ic('play', 'fill')} Cronometrar agora</a>
              <a class="btn grande" style="--b-bg:transparent;--b-fg:var(--paper);--b-bd:color-mix(in srgb,var(--paper) 30%,transparent)" href="#/produtividade">${ic('chart-line-up')} Produtividade</a>
            </div>
          </div>
          <div class="grade-mini">
            <div class="mini"><b>${num(store.atividades().length, 'int')}</b><span>atividades cadastradas</span></div>
            <div class="mini"><b>${num(medicoes.length, 'int')}</b><span>medições${medHoje ? ` · ${medHoje} hoje` : ''}</span></div>
            <div class="mini"><b>${num(comTP.length, 'int')}</b><span>com tempo padrão</span></div>
            <div class="mini"><b>${num(g.coberturaAmostra ?? 0, 'pct0')}</b><span>amostras confiáveis</span></div>
          </div>
        </section>

        ${iniciante ? primeirosPassos() : nothing}

        <section class="atalhos" style="--i:2">
          <a class="atalho" href="#/cronometro"><span class="ic laranja">${ic('timer', 'duo')}</span><div><b>Cronometrar</b><span>Medir uma atividade</span></div></a>
          <a class="atalho" href="#/estrutura"><span class="ic azul">${ic('tree-structure', 'duo')}</span><div><b>Estrutura</b><span>Áreas, setores e atividades</span></div></a>
          <a class="atalho" href="#/produtividade/planejamento"><span class="ic verde">${ic('users-three', 'duo')}</span><div><b>Planejar equipe</b><span>Pessoas por demanda</span></div></a>
          <a class="atalho" href="#/fluxograma"><span class="ic violeta">${ic('flow-arrow', 'duo')}</span><div><b>Fluxograma</b><span>Visualizar o processo</span></div></a>
        </section>

        <div class="grade g2" style="--i:3">
          <section class="cartao">
            <div class="cartao-topo"><h3>${ic('clock-counter-clockwise', 'duo')} Continuar medindo</h3><a class="btn fantasma pequeno" href="#/medicoes">Todas as medições ${ic('arrow-right')}</a></div>
            ${rec.length ? html`<div class="lista">${rec.map(({ atividade, data }) => {
              const an = analise(atividade.id);
              const c = store.caminho(atividade);
              return html`<a class="item" href="#/atividade/${atividade.id}">
                ${anel(an.confiabilidade ?? 0, { tamanho: 42, centro: html`<span style="font-size:.7rem">${an.nValidas}</span>`, classe: an.amostraOk ? 'good' : 'serie' })}
                <span class="corpo"><b>${atividade.nome}</b><span>${c.setor?.nome || ''} · ${tempoRelativo(data)}</span></span>
                <span class="lado"><b>${an.tempoPadrao ? fmtTempo(an.tempoPadrao) : '—'}</b><span>tempo padrão</span></span>
              </a>`;
            })}</div>` : vazio({ icone: 'timer', titulo: 'Nenhuma medição ainda', texto: 'Comece pelo cronômetro.' })}
          </section>

          <section class="cartao">
            <div class="cartao-topo"><h3>${ic('bell-ringing', 'duo')} Precisa de atenção</h3>${ajuda('ciclos', 'Por que aparece aqui?')}</div>
            ${pend.length ? html`<div class="lista">${pend.map(an => html`<a class="item" href="#/atividade/${an.atividade.id}">
              <span class="corpo"><b>${an.atividade.nome}</b><span>${an.ciclos.necessario
                ? `${an.nValidas} de ${an.ciclos.necessario} medições necessárias`
                : `${an.nValidas} medição(ões) válidas`}${an.est.cv != null ? ` · CV ${fmtPct(an.est.cv)}` : ''}</span></span>
              ${seloSaude(an.saude)}
            </a>`)}</div>` : vazio({ icone: 'seal-check', titulo: 'Tudo em ordem', texto: 'Nenhuma atividade com amostra insuficiente ou instável.' })}
          </section>
        </div>

        <div class="grade g2" style="--i:4">
          <section class="cartao">
            <div class="cartao-topo"><h3>${ic('chart-bar-horizontal', 'duo')} Cobertura por área</h3><span class="small muted">atividades com tempo padrão</span></div>
            ${barrasH(areasCobertura, { max: 1, vazioTexto: 'Cadastre áreas para acompanhar a cobertura.' })}
          </section>
          <section class="cartao">
            <div class="cartao-topo"><h3>${ic('list-bullets', 'duo')} Últimas alterações</h3><a class="btn fantasma pequeno" href="#/configuracoes/historico">Histórico ${ic('arrow-right')}</a></div>
            ${store.historico.length ? html`<div class="lista">${store.historico.slice(0, 6).map(h => html`<div class="item">
              <span class="avatar">${ic(h.acao === 'excluiu' ? 'trash' : h.acao === 'criou' ? 'plus' : h.acao === 'importou' ? 'download-simple' : 'pencil-simple')}</span>
              <span class="corpo"><b>${h.acao[0].toUpperCase() + h.acao.slice(1)} ${h.texto}</b><span>${h.autor ? h.autor + ' · ' : ''}${tempoRelativo(h.ts)}</span></span>
            </div>`)}</div>` : html`<p class="small muted">Nenhuma alteração registrada neste dispositivo.</p>`}
          </section>
        </div>
      </div>`,
  };
}
