// Todas as medições, com filtros combinados e ações em lote.
import { html, nothing } from '../lib.js';
import { store } from '../core/store.js';
import { analise, atividadesDoEscopo } from '../core/consultas.js';
import { fmtTempo } from '../core/time.js';
import { combina, fmtDataHora, fmtPct, fmtQtd } from '../core/util.js';
import { ic, vazio, toast } from '../ui/ui.js';
import { cabecalho } from '../ui/layout.js';
import { formMedicao, excluirComConfirmacao, moverMedicoes } from '../ui/formularios.js';
import { atualizar, definirQuery, ir } from '../ui/nav.js';
import { exportarMedicoes } from '../core/exportar.js';

const ui = { termo: '', selecao: new Set(), selecionando: false, limite: 200 };
const STATUS = {
  valida: ['Válida', 'good', 'check-circle'],
  nivelada: ['Nivelada', 'serious', 'funnel'],
  excluida: ['Fora do cálculo', 'critical', 'prohibit'],
  invalida: ['Incompleta', 'warning', 'warning'],
};

export function telaMedicoes(rota) {
  const q = rota.query;
  const escopo = q.atividade ? { atividadeId: q.atividade } : q.setor ? { setorId: q.setor } : q.area ? { areaId: q.area } : {};
  const limite = q.dias ? Date.now() - Number(q.dias) * 86400000 : null;
  let linhas = [];
  for (const a of atividadesDoEscopo(escopo)) {
    const an = analise(a.id);
    const c = store.caminho(a);
    for (const l of an.linhas) linhas.push({ ...l, an, caminho: c });
  }
  if (limite) linhas = linhas.filter(l => l.m.dataHora && new Date(l.m.dataHora).getTime() >= limite);
  if (q.operador) linhas = linhas.filter(l => (l.m.operador || '') === q.operador);
  if (q.motivo) linhas = linhas.filter(l => (q.motivo === 'normal' ? !l.m.motivoId : l.m.motivoId === q.motivo));
  if (q.situacao) linhas = linhas.filter(l => (q.situacao === 'fora' ? l.status !== 'valida' : l.status === q.situacao));
  if (ui.termo) linhas = linhas.filter(l => combina(`${l.an.atividade.nome} ${l.m.operador} ${l.m.cronometrista} ${l.m.observacao} ${l.motivo?.nome || ''}`, ui.termo));
  linhas.sort((a, b) => (b.m.dataHora || '').localeCompare(a.m.dataHora || ''));
  const visiveis = linhas.slice(0, ui.limite);
  const sel = ui.selecao;
  const setores = q.area ? store.setores(q.area) : store.setores();
  const atividades = q.setor ? store.atividades(q.setor) : q.area ? store.atividadesDaArea(q.area) : store.atividades();
  const filtrosAtivos = ['area', 'setor', 'atividade', 'dias', 'operador', 'motivo', 'situacao'].some(k => q[k]);

  return {
    titulo: 'Medições',
    migalhas: [{ rotulo: 'Medições' }],
    conteudo: html`
      ${cabecalho({
        sobre: 'Dados coletados',
        icone: 'list-numbers',
        titulo: 'Medições',
        texto: `${linhas.length} medição(ões) ${filtrosAtivos ? 'nos filtros' : 'no total'}. Clique para editar.`,
        acoes: html`<button class="btn" @click=${() => exportarMedicoes(linhas.map(l => l.m), 'medicoes-filtradas')}>${ic('download-simple')} Exportar</button>
          <button class="btn primario" @click=${async () => {
            const { escolherAtividade } = await import('../ui/ui.js');
            const id = await escolherAtividade(store, { titulo: 'Adicionar medição em…' });
            if (id) formMedicao(null, id);
          }}>${ic('plus')} Medição manual</button>`,
      })}
      <div class="ferramentas cartao plano" style="padding:12px">
        ${ic('funnel-simple')}
        <select class="entrada" style="width:auto;max-width:200px" aria-label="Operação" @change=${e => definirQuery({ area: e.target.value, setor: '', atividade: '' })}>
          <option value="">Todas as operações</option>${store.areas().map(a => html`<option value=${a.id} ?selected=${q.area === a.id}>${a.nome}</option>`)}</select>
        <select class="entrada" style="width:auto;max-width:200px" aria-label="Setor" @change=${e => definirQuery({ setor: e.target.value, atividade: '' })}>
          <option value="">Todos os setores</option>${setores.map(s => html`<option value=${s.id} ?selected=${q.setor === s.id}>${s.nome}</option>`)}</select>
        <select class="entrada" style="width:auto;max-width:220px" aria-label="Atividade" @change=${e => definirQuery({ atividade: e.target.value })}>
          <option value="">Todas as atividades</option>${atividades.map(a => html`<option value=${a.id} ?selected=${q.atividade === a.id}>${a.nome}</option>`)}</select>
        <select class="entrada" style="width:auto" aria-label="Período" @change=${e => definirQuery({ dias: e.target.value })}>
          ${[['', 'Todo o período'], ['1', 'Hoje (24 h)'], ['7', '7 dias'], ['30', '30 dias'], ['90', '90 dias']].map(([v, r]) => html`<option value=${v} ?selected=${(q.dias || '') === v}>${r}</option>`)}</select>
        <select class="entrada" style="width:auto;max-width:180px" aria-label="Operador" @change=${e => definirQuery({ operador: e.target.value })}>
          <option value="">Operadores</option>${store.operadoresConhecidos().map(o => html`<option ?selected=${q.operador === o}>${o}</option>`)}</select>
        <select class="entrada" style="width:auto;max-width:180px" aria-label="Anomalia" @change=${e => definirQuery({ motivo: e.target.value })}>
          <option value="">Anomalias</option><option value="normal" ?selected=${q.motivo === 'normal'}>Operação normal</option>
          ${store.paradas('motivo').map(m => html`<option value=${m.id} ?selected=${q.motivo === m.id}>${m.nome}</option>`)}</select>
        <select class="entrada" style="width:auto" aria-label="Situação" @change=${e => definirQuery({ situacao: e.target.value })}>
          <option value="">Situação</option><option value="valida" ?selected=${q.situacao === 'valida'}>Válidas</option><option value="fora" ?selected=${q.situacao === 'fora'}>Fora do cálculo</option></select>
        ${filtrosAtivos ? html`<button class="btn fantasma pequeno" @click=${() => ir('#/medicoes')}>${ic('x')} Limpar</button>` : nothing}
      </div>
      <div class="ferramentas">
        <div class="busca-local">${ic('magnifying-glass')}<input class="entrada" type="search" placeholder="Buscar texto…" .value=${ui.termo} @input=${e => { ui.termo = e.target.value; atualizar(); }} /></div>
        <span class="grow"></span>
        <button class="btn" aria-pressed=${ui.selecionando} @click=${() => { ui.selecionando = !ui.selecionando; sel.clear(); atualizar(); }}>${ic(ui.selecionando ? 'x' : 'check-square-offset')} ${ui.selecionando ? 'Cancelar' : 'Selecionar'}</button>
      </div>
      ${ui.selecionando ? html`<div class="barra-selecao">
        <label class="check"><input type="checkbox" .checked=${visiveis.length && visiveis.every(l => sel.has(l.m.id))} @change=${e => { visiveis.forEach(l => (e.target.checked ? sel.add(l.m.id) : sel.delete(l.m.id))); atualizar(); }} /><b>${sel.size} selecionada(s)</b></label>
        <span class="grow"></span>
        <button class="btn pequeno" ?disabled=${!sel.size} @click=${() => { store.salvarVarios('medicoes', [...sel].map(id => ({ ...store.obter('medicoes', id), nivel: 'excluir' })), { rotulo: `${sel.size} medição(ões) tiradas do cálculo` }); toast('Medições tiradas do cálculo'); sel.clear(); }}>${ic('prohibit')} Tirar do cálculo</button>
        <button class="btn pequeno" ?disabled=${!sel.size} @click=${async () => { if (await moverMedicoes([...sel])) { sel.clear(); ui.selecionando = false; } }}>${ic('arrows-left-right')} Mover</button>
        <button class="btn perigo-cheio pequeno" ?disabled=${!sel.size} @click=${async () => { if (await excluirComConfirmacao('medicoes', [...sel])) { sel.clear(); ui.selecionando = false; atualizar(); } }}>${ic('trash')} Excluir</button>
      </div>` : nothing}
      ${linhas.length ? html`<div class="tabela-wrap">
        <table class="tabela">
          <thead><tr>${ui.selecionando ? html`<th class="chk"></th>` : nothing}<th>Data e hora</th><th>Atividade</th><th class="n">Tempo</th><th class="n">Por unidade</th><th class="n">vs. média</th><th>Operador</th><th>Anomalia</th><th>Observação</th><th>Situação</th></tr></thead>
          <tbody>${visiveis.map(l => {
            const m = l.m;
            const st = STATUS[l.status];
            const marcado = sel.has(m.id);
            return html`<tr class="clicavel ${l.status !== 'valida' ? 'riscada' : ''} ${marcado ? 'selecionada' : ''}" @click=${() => (ui.selecionando ? (marcado ? sel.delete(m.id) : sel.add(m.id), atualizar()) : formMedicao(m))}>
              ${ui.selecionando ? html`<td class="chk"><input type="checkbox" .checked=${marcado} @click=${e => e.stopPropagation()} @change=${e => { e.target.checked ? sel.add(m.id) : sel.delete(m.id); atualizar(); }} /></td>` : nothing}
              <td class="nowrap">${fmtDataHora(m.dataHora)}</td>
              <td><a href="#/atividade/${l.an.atividade.id}/medicoes" @click=${e => e.stopPropagation()}><b>${l.an.atividade.nome}</b></a><br /><span class="tiny muted">${l.caminho.setor?.nome || ''}</span></td>
              <td class="n mono t-tempo">${fmtTempo(l.t)}</td>
              <td class="n mono">${fmtTempo(l.u)}<br /><span class="tiny muted">${l.an.atividade.unidade}</span></td>
              <td class="n">${l.desvio ? fmtPct(l.desvio, 0) : '—'}</td>
              <td>${m.operador || html`<span class="muted">—</span>`}</td>
              <td>${l.motivo ? html`<span class="selo ${l.motivo.excluiCalculo ? 'critical' : 'serious'}">${l.motivo.nome}</span>` : html`<span class="muted small">Normal</span>`}</td>
              <td class="small soft truncate" style="max-width:240px" title=${m.observacao || ''}>${m.observacao || ''}</td>
              <td><span class="selo ${st[1]}" data-dica=${l.razao || st[0]}>${ic(st[2], 'fill')}${st[0]}</span></td>
            </tr>`;
          })}</tbody>
        </table>
      </div>
      ${linhas.length > ui.limite ? html`<button class="btn bloco mt" @click=${() => { ui.limite += 300; atualizar(); }}>Mostrar mais (${linhas.length - ui.limite} restantes)</button>` : nothing}`
      : html`<section class="cartao">${vazio({ icone: 'list-numbers', titulo: 'Nenhuma medição encontrada', texto: filtrosAtivos ? 'Ajuste os filtros.' : 'Use o cronômetro para registrar as primeiras medições.' })}</section>`}`,
  };
}
