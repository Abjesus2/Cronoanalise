// Cadastros auxiliares: paradas programadas e motivos de anomalia.
import { html, nothing } from '../lib.js';
import { store } from '../core/store.js';
import { fmtTempo } from '../core/time.js';
import { fmtPct, fmtNum } from '../core/util.js';
import { ic, vazio, ajuda } from '../ui/ui.js';
import { cabecalho } from '../ui/layout.js';
import { formParada, excluirComConfirmacao } from '../ui/formularios.js';

export function telaCadastros() {
  const cfg = store.config();
  const programadas = store.paradas('programada');
  const motivos = store.paradas('motivo');
  const usoParada = id => store.atividades().filter(a => (a.paradasIds || []).includes(id)).length;
  const usoMotivo = id => store.lista('medicoes').filter(m => m.motivoId === id).length;
  const totalJornada = programadas.filter(p => p.freq !== 'ciclo').reduce((s, p) => s + (p.duracao || 0), 0);
  const jornadaSeg = cfg.jornadaMin * 60;

  return {
    titulo: 'Cadastros',
    migalhas: [{ rotulo: 'Cadastros' }],
    conteudo: html`
      ${cabecalho({ sobre: 'Cadastros', icone: 'list-checks', titulo: 'Paradas e anomalias', texto: 'Paradas programadas entram no tempo padrão como tolerância. Motivos classificam medições com problemas e podem tirá-las do cálculo.' })}
      <div class="grade g2">
        <section class="cartao stack">
          <div class="row between">
            <h2 class="row">${ic('coffee', 'duo')} Paradas programadas ${ajuda('tolerancia')}</h2>
            <button class="btn primario pequeno" @click=${() => formParada(null, 'programada')}>${ic('plus')} Nova</button>
          </div>
          ${totalJornada ? html`<div class="aviso">${ic('clock')}<div>Paradas por jornada somam <b>${fmtTempo(totalJornada, { casas: 0 })}</b> de ${fmtNum(cfg.jornadaMin, 0)} min
            (${fmtPct(totalJornada / jornadaSeg)} da jornada). Quando aplicadas a uma atividade, viram tolerância de <b>${fmtPct(totalJornada / (jornadaSeg - totalJornada))}</b>.</div></div>` : nothing}
          ${programadas.length ? html`<div class="lista">${programadas.map(p => html`<div class="item">
            <span class="avatar">${ic(p.freq === 'ciclo' ? 'repeat' : 'coffee')}</span>
            <span class="corpo"><b>${p.nome}</b><span>${fmtTempo(p.duracao, { casas: 0 })} ${p.freq === 'ciclo' ? 'a cada ciclo' : 'por jornada'} · aplicada em ${usoParada(p.id)} atividade(s)</span></span>
            <button class="btn fantasma icone pequeno" aria-label="Editar" @click=${() => formParada(p)}>${ic('pencil-simple')}</button>
            <button class="btn fantasma icone pequeno perigo" aria-label="Excluir" @click=${() => excluirComConfirmacao('paradas', [p.id])}>${ic('trash')}</button>
          </div>`)}</div>` : vazio({ icone: 'coffee', titulo: 'Nenhuma parada programada', texto: 'Ex.: café 10 min, ginástica laboral 10 min, troca de turno.' })}
          <p class="small muted">Escolha em cada atividade (aba Método e cálculo) quais paradas se aplicam.</p>
        </section>

        <section class="cartao stack">
          <div class="row between">
            <h2 class="row">${ic('warning-diamond', 'duo')} Motivos de anomalia ${ajuda('nivelamento')}</h2>
            <button class="btn primario pequeno" @click=${() => formParada(null, 'motivo')}>${ic('plus')} Novo</button>
          </div>
          ${motivos.length ? html`<div class="lista">${motivos.map(m => html`<div class="item">
            <span class="avatar" style=${m.excluiCalculo ? 'background:var(--critical-soft);color:var(--critical-ink)' : ''}>${ic(m.excluiCalculo ? 'prohibit' : 'tag')}</span>
            <span class="corpo"><b>${m.nome}</b><span>${m.excluiCalculo ? 'Fora do cálculo' : 'Informativo'} · usado em ${usoMotivo(m.id)} medição(ões)</span></span>
            <button class="btn fantasma icone pequeno" aria-label="Editar" @click=${() => formParada(m)}>${ic('pencil-simple')}</button>
            <button class="btn fantasma icone pequeno perigo" aria-label="Excluir" @click=${() => excluirComConfirmacao('paradas', [m.id])}>${ic('trash')}</button>
          </div>`)}</div>` : vazio({ icone: 'warning-diamond', titulo: 'Nenhum motivo cadastrado', texto: 'Ex.: falta de material, retrabalho, máquina parada, setup.' })}
        </section>
      </div>
      <section class="cartao stack mt">
        <h2 class="row">${ic('users', 'duo')} Operadores e cronometristas</h2>
        <p class="small soft">A lista é formada automaticamente a partir das medições. Digite o nome ao cronometrar e ele passa a ser sugerido.</p>
        <div class="row wrap">${store.operadoresConhecidos().map(o => html`<a class="chip" href="#/produtividade/operadores?operador=${encodeURIComponent(o)}">${ic('user')} ${o}</a>`)}
          ${!store.operadoresConhecidos().length ? html`<span class="small muted">Nenhum operador registrado ainda.</span>` : nothing}</div>
      </section>`,
  };
}
