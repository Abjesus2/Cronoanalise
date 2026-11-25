// Formulários em diálogo e ações sobre entidades.
import { html, nothing, live } from '../lib.js';
import { store } from '../core/store.js';
import { ATIVIDADE_PADRAO } from '../core/calc.js';
import { lerTempo, tempoParaCampo, dicaTempo, fmtTempo } from '../core/time.js';
import { uid, numero, fmtNum } from '../core/util.js';
import { ehAvancado, prefs } from '../core/prefs.js';
import { abrirDialogo, topoDialogo, ic, toast, confirmar, escolherSetor, escolherAtividade, ajuda } from './ui.js';
import { ir } from './nav.js';

export const UNIDADES = ['volume', 'palete', 'peça', 'item', 'pedido', 'caixa', 'etiqueta', 'nota', 'carrinho', 'tote', 'gaylord', 'posição', 'par', 'unidade', 'pacote', 'lote', 'metro', 'kg', 'ciclo'];

const isoParaLocal = iso => {
  const d = iso ? new Date(iso) : new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const localParaIso = v => {
  const d = v ? new Date(v) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
};

function rodape(fechar, rotulo = 'Salvar', extra = nothing) {
  return html`<div class="dlg-rodape">
    ${extra}
    <button type="button" class="btn" @click=${() => fechar(null)}>Cancelar</button>
    <button class="btn primario">${ic('check')} ${rotulo}</button>
  </div>`;
}

/* ------------------------------ Área ------------------------------ */
export function formArea(area = null) {
  const e = { nome: area?.nome || '', seq: area?.seq ?? store.proximaSequencia('areas'), descricao: area?.descricao || '' };
  return abrirDialogo(({ fechar }) => html`
    <form @submit=${ev => {
      ev.preventDefault();
      if (!e.nome.trim()) return;
      const salvo = store.salvar('areas', { ...(area || {}), nome: e.nome.trim(), seq: numero(e.seq), descricao: e.descricao.trim() });
      toast(area ? 'Operação atualizada' : 'Operação criada');
      fechar(salvo);
    }}>
      ${topoDialogo({ icone: 'buildings', titulo: area ? 'Editar operação' : 'Nova operação', texto: 'Operações agrupam setores (ex.: Controladora, Web, Logística reversa).' })}
      <div class="dlg-corpo">
        <div class="grade-form">
          <div class="campo cheio"><label for="fa-nome">Nome da operação</label>
            <input id="fa-nome" class="entrada" required autofocus .value=${e.nome} @input=${ev => (e.nome = ev.target.value)} placeholder="Ex.: Produção" /></div>
          <div class="campo"><label for="fa-seq">Sequência</label>
            <input id="fa-seq" class="entrada" type="number" min="1" .value=${String(e.seq ?? '')} @input=${ev => (e.seq = ev.target.value)} />
            <span class="ajuda">Ordem de exibição e do fluxo.</span></div>
          <div class="campo cheio"><label for="fa-desc">Descrição (opcional)</label>
            <textarea id="fa-desc" class="entrada" .value=${e.descricao} @input=${ev => (e.descricao = ev.target.value)}></textarea></div>
        </div>
      </div>
      ${rodape(fechar)}
    </form>`);
}

/* ------------------------------ Setor ------------------------------ */
export function formSetor(setor = null, areaId = null) {
  const e = {
    nome: setor?.nome || '',
    areaId: setor?.areaId || areaId || store.areas()[0]?.id || '',
    seq: setor?.seq ?? null,
    descricao: setor?.descricao || '',
  };
  if (e.seq == null && e.areaId) e.seq = store.proximaSequencia('setores', e.areaId);
  return abrirDialogo(({ fechar, atualizar }) => html`
    <form @submit=${ev => {
      ev.preventDefault();
      if (!e.nome.trim() || !e.areaId) return;
      const salvo = store.salvar('setores', { ...(setor || {}), nome: e.nome.trim(), areaId: e.areaId, seq: numero(e.seq), descricao: e.descricao.trim() });
      toast(setor ? 'Setor atualizado' : 'Setor criado');
      fechar(salvo);
    }}>
      ${topoDialogo({ icone: 'squares-four', titulo: setor ? 'Editar setor' : 'Novo setor', texto: 'Setores ficam dentro de uma operação e reúnem as atividades.' })}
      <div class="dlg-corpo">
        ${store.areas().length ? html`<div class="grade-form">
          <div class="campo cheio"><label for="fs-nome">Nome do setor</label>
            <input id="fs-nome" class="entrada" required autofocus .value=${e.nome} @input=${ev => (e.nome = ev.target.value)} placeholder="Ex.: Costura" /></div>
          <div class="campo"><label for="fs-area">Operação</label>
            <select id="fs-area" class="entrada" .value=${e.areaId} @change=${ev => {
              e.areaId = ev.target.value;
              if (!setor) e.seq = store.proximaSequencia('setores', e.areaId);
              atualizar();
            }}>${store.areas().map(a => html`<option value=${a.id} ?selected=${a.id === e.areaId}>${a.nome}</option>`)}</select></div>
          <div class="campo"><label for="fs-seq">Sequência no fluxo</label>
            <input id="fs-seq" class="entrada" type="number" min="1" .value=${String(e.seq ?? '')} @input=${ev => (e.seq = ev.target.value)} /></div>
          <div class="campo cheio"><label for="fs-desc">Descrição (opcional)</label>
            <textarea id="fs-desc" class="entrada" .value=${e.descricao} @input=${ev => (e.descricao = ev.target.value)}></textarea></div>
        </div>` : html`<div class="aviso alerta">${ic('warning', 'fill')}<div>Crie uma operação primeiro.</div></div>`}
      </div>
      ${rodape(fechar)}
    </form>`);
}

/* ------------------------------ Atividade ------------------------------ */
export function formAtividade(atividade = null, setorId = null) {
  const base = { ...ATIVIDADE_PADRAO, ...(atividade || {}) };
  const e = {
    nome: base.nome || '',
    setorId: atividade?.setorId || setorId || store.setores()[0]?.id || '',
    seq: atividade?.seq ?? null,
    unidade: base.unidade || 'peça',
    modoQtd: base.campoQtdId ? 'informada' : 'fixa',
    freqObs: base.freqObs ?? 1,
    freqPecas: base.freqPecas ?? 1,
    variasPessoas: Boolean(base.campoPessoasId),
    pessoas: base.pessoas ?? 1,
    descricao: base.descricao || '',
    maquina: base.maquina || '',
  };
  if (e.seq == null && e.setorId) e.seq = store.proximaSequencia('atividades', e.setorId);
  const avancado = ehAvancado();

  const salvar = fechar => {
    if (!e.nome.trim() || !e.setorId) return;
    const parametros = [...(base.parametros || [])];
    let campoQtdId = base.campoQtdId;
    let campoPessoasId = base.campoPessoasId;
    if (e.modoQtd === 'informada' && !campoQtdId) {
      campoQtdId = uid();
      parametros.unshift({ id: campoQtdId, nome: 'Quantidade', tipo: 'numero', fixo: false });
    }
    if (e.modoQtd === 'fixa') campoQtdId = null;
    if (e.variasPessoas && !campoPessoasId) {
      campoPessoasId = uid();
      parametros.splice(campoQtdId ? 1 : 0, 0, { id: campoPessoasId, nome: 'Pessoas', tipo: 'numero', fixo: true });
    }
    if (!e.variasPessoas) campoPessoasId = null;
    const salvo = store.salvar('atividades', {
      ...(atividade || ATIVIDADE_PADRAO),
      id: atividade?.id,
      nome: e.nome.trim(),
      setorId: e.setorId,
      seq: numero(e.seq),
      unidade: e.unidade.trim() || 'peça',
      freqObs: numero(e.freqObs) || 1,
      freqPecas: numero(e.freqPecas) || 1,
      campoQtdId,
      campoPessoasId,
      parametros,
      pessoas: numero(e.pessoas) || 1,
      descricao: e.descricao.trim(),
      maquina: e.maquina.trim(),
    });
    toast(atividade ? 'Atividade atualizada' : 'Atividade criada');
    fechar(salvo);
  };

  return abrirDialogo(({ fechar, atualizar }) => html`
    <form @submit=${ev => { ev.preventDefault(); salvar(fechar); }}>
      ${topoDialogo({ icone: 'cube', titulo: atividade ? 'Editar atividade' : 'Nova atividade', texto: 'A atividade é a operação que será cronometrada.' })}
      <div class="dlg-corpo">
        ${store.setores().length ? html`
        <div class="grade-form">
          <div class="campo cheio"><label for="fat-nome">Nome da atividade</label>
            <input id="fat-nome" class="entrada" required autofocus .value=${e.nome} @input=${ev => (e.nome = ev.target.value)} placeholder="Ex.: Costurar forro da gáspea" /></div>
          <div class="campo"><label for="fat-setor">Setor</label>
            <select id="fat-setor" class="entrada" @change=${ev => {
              e.setorId = ev.target.value;
              if (!atividade) e.seq = store.proximaSequencia('atividades', e.setorId);
              atualizar();
            }}>${store.areas().map(a => html`<optgroup label=${a.nome}>${store.setores(a.id).map(s => html`<option value=${s.id} ?selected=${s.id === e.setorId}>${s.nome}</option>`)}</optgroup>`)}</select></div>
          <div class="campo"><label for="fat-seq">Sequência no setor</label>
            <input id="fat-seq" class="entrada" type="number" min="1" .value=${String(e.seq ?? '')} @input=${ev => (e.seq = ev.target.value)} /></div>
          <div class="campo"><label for="fat-un">O que é produzido (unidade)</label>
            <input id="fat-un" class="entrada" list="dl-unidades" .value=${e.unidade} @input=${ev => (e.unidade = ev.target.value)} />
            <datalist id="dl-unidades">${UNIDADES.map(u => html`<option value=${u}></option>`)}</datalist></div>
          <div class="campo"><label for="fat-pes">Pessoas alocadas na operação</label>
            <input id="fat-pes" class="entrada" type="number" min="1" step="1" .value=${String(e.pessoas)} @input=${ev => (e.pessoas = ev.target.value)} />
            <span class="ajuda">Usado para a capacidade da equipe.</span></div>
        </div>

        <div class="campo">
          <span class="rotulo">Cada medição corresponde a ${ajuda('freqLogica')}</span>
          <div class="segmentado" role="group">
            <button type="button" aria-pressed=${e.modoQtd === 'fixa'} @click=${() => { e.modoQtd = 'fixa'; atualizar(); }}>Quantidade fixa</button>
            <button type="button" aria-pressed=${e.modoQtd === 'informada'} @click=${() => { e.modoQtd = 'informada'; atualizar(); }}>Informar a cada medição</button>
          </div>
          ${e.modoQtd === 'fixa' ? html`<div class="row wrap mt-s">
            ${avancado ? html`<input class="entrada" style="width:90px" type="number" min="1" step="1" aria-label="Observações" .value=${String(e.freqObs)} @input=${ev => (e.freqObs = ev.target.value)} />
            <span class="soft">medição(ões) =</span>` : html`<span class="soft">1 medição =</span>`}
            <input class="entrada" style="width:110px" type="number" min="0.0001" step="any" aria-label="Unidades" .value=${String(e.freqPecas)} @input=${ev => (e.freqPecas = ev.target.value)} />
            <span class="soft">${e.unidade || 'unidade'}(s)</span>
          </div>
          <span class="ajuda">${avancado ? 'Frequência lógica: ex. 2 medições = 1 peça (mangas), 1 medição = 34 peças (carrinho).' : 'Ex.: se você cronometra um carrinho com 34 peças, informe 34.'}</span>`
          : html`<span class="ajuda">Um campo "Quantidade" aparecerá no cronômetro para você digitar quantas ${e.unidade || 'unidades'} cada medição teve.</span>`}
        </div>

        <label class="check"><input type="checkbox" .checked=${e.variasPessoas} @change=${ev => { e.variasPessoas = ev.target.checked; atualizar(); }} />
          Mais de uma pessoa trabalha junto em cada medição</label>

        <div class="campo"><label for="fat-desc">Como a atividade é feita (opcional)</label>
          <textarea id="fat-desc" class="entrada" .value=${e.descricao} @input=${ev => (e.descricao = ev.target.value)} placeholder="Início e fim do ciclo, materiais, cuidados..."></textarea></div>
        ${avancado ? html`<div class="campo"><label for="fat-maq">Máquina / equipamento</label>
          <input id="fat-maq" class="entrada" .value=${e.maquina} @input=${ev => (e.maquina = ev.target.value)} /></div>` : nothing}
        ${!atividade ? html`<div class="aviso info">${ic('info', 'fill')}<div>Ritmo, tolerâncias, paradas e parâmetros extras podem ser ajustados depois na aba <b>Método &amp; cálculo</b> da atividade.</div></div>` : nothing}
        ` : html`<div class="aviso alerta">${ic('warning', 'fill')}<div>Crie uma operação e um setor antes de cadastrar atividades.</div></div>`}
      </div>
      ${rodape(fechar)}
    </form>`, { classe: 'largo' });
}

/* ------------------------------ Medição ------------------------------ */
export function formMedicao(medicao = null, atividadeId = null) {
  const atividade = store.obter('atividades', medicao?.atividadeId || atividadeId);
  if (!atividade) return Promise.resolve(null);
  const p = prefs();
  const e = {
    atividadeId: atividade.id,
    dataHora: isoParaLocal(medicao?.dataHora),
    tempo: medicao ? tempoParaCampo(medicao.tempo) : '',
    valores: { ...(medicao?.valores || {}) },
    operador: medicao?.operador ?? p.operador ?? '',
    cronometrista: medicao?.cronometrista ?? p.cronometrista ?? '',
    motivoId: medicao?.motivoId || '',
    observacao: medicao?.observacao || '',
    ritmo: medicao?.ritmo ? fmtNum(medicao.ritmo * 100, 0) : '',
    nivel: medicao?.nivel || 'auto',
    erro: '',
  };
  const avancado = ehAvancado();
  return abrirDialogo(({ fechar, atualizar }) => {
    const at = store.obter('atividades', e.atividadeId) || atividade;
    const segundos = lerTempo(e.tempo);
    return html`
    <form @submit=${ev => {
      ev.preventDefault();
      const t = lerTempo(e.tempo);
      if (!(t > 0)) {
        e.erro = 'Informe um tempo válido. ' + dicaTempo();
        atualizar();
        return;
      }
      if (at.campoQtdId && !(numero(e.valores[at.campoQtdId]) > 0)) {
        e.erro = 'Informe a quantidade desta medição.';
        atualizar();
        return;
      }
      const salvo = store.salvar('medicoes', {
        ...(medicao || {}),
        atividadeId: e.atividadeId,
        dataHora: localParaIso(e.dataHora),
        tempo: t,
        valores: e.valores,
        operador: e.operador.trim(),
        cronometrista: e.cronometrista.trim(),
        motivoId: e.motivoId || null,
        observacao: e.observacao.trim(),
        ritmo: numero(e.ritmo) ? numero(e.ritmo) / 100 : null,
        nivel: e.nivel,
        origem: medicao?.origem || 'manual',
      });
      toast(medicao ? 'Medição atualizada' : 'Medição adicionada');
      fechar(salvo);
    }}>
      ${topoDialogo({ icone: medicao ? 'pencil-simple-line' : 'plus-circle', titulo: medicao ? 'Editar medição' : 'Adicionar medição manual', texto: at.nome })}
      <div class="dlg-corpo">
        ${e.erro ? html`<div class="aviso erro">${ic('warning-circle', 'fill')}<div>${e.erro}</div></div>` : nothing}
        <div class="grade-form">
          <div class="campo"><label for="fm-tempo">Tempo da medição</label>
            <input id="fm-tempo" class="entrada grande" inputmode="decimal" autocomplete="off" autofocus required .value=${e.tempo}
              @input=${ev => { e.tempo = ev.target.value; e.erro = ''; atualizar(); }} placeholder="00:00,0" />
            <span class="ajuda">${segundos > 0 ? html`= <b>${fmtTempo(segundos)}</b> · ${fmtNum(segundos, 2)} s` : dicaTempo()}</span></div>
          <div class="campo"><label for="fm-data">Data e hora</label>
            <input id="fm-data" class="entrada" type="datetime-local" step="1" .value=${e.dataHora} @input=${ev => (e.dataHora = ev.target.value)} /></div>
          ${camposParametros(at, e.valores, atualizar)}
          <div class="campo"><label for="fm-op">Operador</label>
            <input id="fm-op" class="entrada" list="dl-operadores" .value=${e.operador} @input=${ev => (e.operador = ev.target.value)} placeholder="Nome ou matrícula" /></div>
          <div class="campo"><label for="fm-cr">Cronometrista</label>
            <input id="fm-cr" class="entrada" list="dl-cronometristas" .value=${e.cronometrista} @input=${ev => (e.cronometrista = ev.target.value)} /></div>
          <div class="campo"><label for="fm-mot">Anomalia / motivo</label>
            <select id="fm-mot" class="entrada" @change=${ev => (e.motivoId = ev.target.value)}>
              <option value="" ?selected=${!e.motivoId}>Operação normal</option>
              ${store.paradas('motivo').map(m => html`<option value=${m.id} ?selected=${m.id === e.motivoId}>${m.nome}${m.excluiCalculo ? ' (fora do cálculo)' : ''}</option>`)}
            </select></div>
          ${avancado ? html`<div class="campo"><label for="fm-rit">Ritmo avaliado (%) ${ajuda('ritmo')}</label>
            <input id="fm-rit" class="entrada" inputmode="decimal" .value=${e.ritmo} @input=${ev => (e.ritmo = ev.target.value)} placeholder="Usar o da atividade" /></div>` : nothing}
          <div class="campo cheio"><label for="fm-obs">Observações</label>
            <textarea id="fm-obs" class="entrada" .value=${e.observacao} @input=${ev => (e.observacao = ev.target.value)}></textarea></div>
          <div class="campo cheio"><span class="rotulo">Considerar no cálculo ${ajuda('nivelamento')}</span>
            <div class="segmentado">
              ${[['auto', 'Automático'], ['incluir', 'Sempre incluir'], ['excluir', 'Excluir']].map(([v, r]) => html`<button type="button" aria-pressed=${e.nivel === v} @click=${() => { e.nivel = v; atualizar(); }}>${r}</button>`)}
            </div></div>
        </div>
        ${datalists()}
      </div>
      ${rodape(fechar, medicao ? 'Salvar' : 'Adicionar', medicao ? html`<button type="button" class="btn fantasma" style="margin-right:auto" @click=${async () => {
        const novo = await escolherAtividade(store, { titulo: 'Mover medição para…', excluirId: e.atividadeId });
        if (novo) { e.atividadeId = novo; atualizar(); }
      }}>${ic('arrows-left-right')} Trocar atividade</button>` : nothing)}
    </form>`;
  }, { classe: 'largo' });
}

export function camposParametros(atividade, valores, atualizar, { fixos, alternarFixo } = {}) {
  const params = atividade.parametros || [];
  return params.map(par => {
    const id = `par-${par.id}`;
    const rotulo = par.id === atividade.campoQtdId ? `${par.nome} (${atividade.unidade || 'unidades'})` : par.nome;
    const pino = alternarFixo
      ? html`<button type="button" class="ajuda-btn" style=${fixos?.has(par.id) ? 'color:var(--brand-strong)' : ''} aria-pressed=${fixos?.has(par.id)}
          data-dica=${fixos?.has(par.id) ? 'Mantido para os próximos ciclos' : 'Manter para os próximos ciclos'} @click=${() => alternarFixo(par.id)}>${ic('push-pin', fixos?.has(par.id) ? 'fill' : '')}</button>`
      : nothing;
    if (par.tipo === 'lista') {
      return html`<div class="campo"><label for=${id}>${rotulo} ${pino}</label>
        <select id=${id} class="entrada" @change=${ev => { valores[par.id] = ev.target.value; atualizar?.(); }}>
          <option value="" ?selected=${!valores[par.id]}>—</option>
          ${(par.opcoes || []).map(o => html`<option ?selected=${valores[par.id] === o}>${o}</option>`)}
        </select></div>`;
    }
    return html`<div class="campo"><label for=${id}>${rotulo} ${pino}</label>
      <input id=${id} class="entrada ${par.tipo === 'numero' ? 'mono' : ''}" inputmode=${par.tipo === 'numero' ? 'decimal' : 'text'}
        .value=${live(valores[par.id] ?? '')} @input=${ev => { valores[par.id] = ev.target.value; }} @change=${() => atualizar?.()} /></div>`;
  });
}

export function datalists() {
  return html`<datalist id="dl-operadores">${store.operadoresConhecidos().map(o => html`<option value=${o}></option>`)}</datalist>
    <datalist id="dl-cronometristas">${store.cronometristasConhecidos().map(o => html`<option value=${o}></option>`)}</datalist>`;
}

/* ------------------------------ Paradas / motivos ------------------------------ */
export function formParada(parada = null, tipo = 'programada') {
  const e = {
    nome: parada?.nome || '',
    tipo: parada?.tipo || tipo,
    duracao: parada ? tempoParaCampo(parada.duracao) : '',
    freq: parada?.freq || 'jornada',
    excluiCalculo: parada?.excluiCalculo ?? false,
    erro: '',
  };
  return abrirDialogo(({ fechar, atualizar }) => html`
    <form @submit=${ev => {
      ev.preventDefault();
      const dur = e.tipo === 'programada' ? lerTempo(e.duracao) : null;
      if (e.tipo === 'programada' && !(dur > 0)) {
        e.erro = 'Informe a duração. ' + dicaTempo();
        atualizar();
        return;
      }
      const salvo = store.salvar('paradas', {
        ...(parada || {}),
        nome: e.nome.trim(),
        tipo: e.tipo,
        duracao: dur,
        freq: e.tipo === 'programada' ? e.freq : null,
        excluiCalculo: e.tipo === 'motivo' ? e.excluiCalculo : false,
      });
      toast(parada ? 'Cadastro atualizado' : 'Cadastrado com sucesso');
      fechar(salvo);
    }}>
      ${topoDialogo({
        icone: e.tipo === 'programada' ? 'coffee' : 'warning-diamond',
        titulo: e.tipo === 'programada' ? (parada ? 'Editar parada programada' : 'Nova parada programada') : parada ? 'Editar motivo' : 'Novo motivo de anomalia',
        texto: e.tipo === 'programada' ? 'Pausas previstas com duração conhecida (café, ginástica laboral, troca de turno).' : 'Classifica medições com problemas (falta de material, retrabalho, máquina parada).',
      })}
      <div class="dlg-corpo">
        ${e.erro ? html`<div class="aviso erro">${ic('warning-circle', 'fill')}<div>${e.erro}</div></div>` : nothing}
        <div class="campo"><label for="fp-nome">Nome</label>
          <input id="fp-nome" class="entrada" required autofocus .value=${e.nome} @input=${ev => (e.nome = ev.target.value)} /></div>
        ${e.tipo === 'programada' ? html`
          <div class="grade-form">
            <div class="campo"><label for="fp-dur">Duração</label>
              <input id="fp-dur" class="entrada mono" inputmode="decimal" .value=${e.duracao} @input=${ev => (e.duracao = ev.target.value)} placeholder="10:00" />
              <span class="ajuda">${dicaTempo()}</span></div>
            <div class="campo"><span class="rotulo">Acontece</span>
              <div class="segmentado">
                <button type="button" aria-pressed=${e.freq === 'jornada'} @click=${() => { e.freq = 'jornada'; atualizar(); }}>Uma vez por jornada</button>
                <button type="button" aria-pressed=${e.freq === 'ciclo'} @click=${() => { e.freq = 'ciclo'; atualizar(); }}>A cada ciclo</button>
              </div>
              <span class="ajuda">${e.freq === 'jornada' ? 'Vira tolerância: reduz o tempo produtivo do dia.' : 'Somada ao tempo de cada medição (ex.: troca de bobina a cada ciclo).'}</span></div>
          </div>` : html`
          <label class="check"><input type="checkbox" .checked=${e.excluiCalculo} @change=${ev => (e.excluiCalculo = ev.target.checked)} />
            Desconsiderar do cálculo as medições com este motivo</label>
          <span class="ajuda">Use para "elementos estranhos" que não fazem parte da operação (ex.: máquina quebrou durante a medição).</span>`}
      </div>
      ${rodape(fechar)}
    </form>`);
}

/* ------------------------------ Ações ------------------------------ */
const NOMES = { areas: ['operação', 'operações'], setores: ['setor', 'setores'], atividades: ['atividade', 'atividades'], medicoes: ['medição', 'medições'], paradas: ['cadastro', 'cadastros'] };

export async function excluirComConfirmacao(col, ids, { aoConcluir } = {}) {
  if (!ids.length) return false;
  const [sing, plur] = NOMES[col] || ['item', 'itens'];
  const desc = col === 'paradas' || col === 'medicoes' ? null : store.contarDescendentes(col, ids);
  const partes = [];
  if (desc?.setores) partes.push(`${desc.setores} setor(es)`);
  if (desc?.atividades) partes.push(`${desc.atividades} atividade(s)`);
  if (desc?.medicoes) partes.push(`${desc.medicoes} medição(ões)`);
  const nome = ids.length === 1 ? store.obter(col, ids[0])?.nome : null;
  const ok = await confirmar({
    titulo: ids.length === 1 ? `Excluir ${sing}${nome ? ` "${nome}"` : ''}?` : `Excluir ${ids.length} ${plur}?`,
    mensagem: partes.length ? `Também serão excluídos: ${partes.join(', ')}. Esta ação não pode ser desfeita.` : 'Esta ação não pode ser desfeita.',
    confirmar: 'Excluir',
    perigo: true,
  });
  if (!ok) return false;
  if (col === 'paradas') {
    store.excluir(col, ids);
    // remove referências
    const afetadas = store.atividades().filter(a => (a.paradasIds || []).some(id => ids.includes(id)));
    if (afetadas.length) store.salvarVarios('atividades', afetadas.map(a => ({ ...a, paradasIds: a.paradasIds.filter(id => !ids.includes(id)) })), { registrarHistorico: false });
    const meds = store.lista('medicoes').filter(m => ids.includes(m.motivoId));
    if (meds.length) store.salvarVarios('medicoes', meds.map(m => ({ ...m, motivoId: null })), { registrarHistorico: false });
  } else if (col === 'medicoes') {
    store.excluir(col, ids);
  } else {
    store.excluirCascata(col, ids);
  }
  toast(ids.length === 1 ? `${sing[0].toUpperCase() + sing.slice(1)} excluída(o)` : `${ids.length} ${plur} excluídos`);
  aoConcluir?.();
  return true;
}

export async function moverAtividades(ids, setorAtualId) {
  const destino = await escolherSetor(store, { titulo: `Mover ${ids.length} atividade(s) para…`, excluirId: setorAtualId });
  if (!destino) return false;
  let seq = store.proximaSequencia('atividades', destino);
  const ats = ids.map(id => store.obter('atividades', id)).filter(Boolean).map(a => ({ ...a, setorId: destino, seq: seq++ }));
  store.salvarVarios('atividades', ats, { rotulo: `moveu ${ats.length} atividade(s) para ${store.obter('setores', destino)?.nome}` });
  toast(`${ats.length} atividade(s) movida(s)`);
  return true;
}

export async function moverMedicoes(ids, atividadeAtualId) {
  const destino = await escolherAtividade(store, { titulo: `Mover ${ids.length} medição(ões) para…`, excluirId: atividadeAtualId });
  if (!destino) return false;
  const meds = ids.map(id => store.obter('medicoes', id)).filter(Boolean).map(m => ({ ...m, atividadeId: destino }));
  store.salvarVarios('medicoes', meds, { rotulo: `moveu ${meds.length} medição(ões) para ${store.obter('atividades', destino)?.nome}` });
  toast(`${meds.length} medição(ões) movida(s)`, { acao: () => ir(`#/atividade/${destino}/medicoes`), rotuloAcao: 'Ver' });
  return true;
}

export function duplicarAtividade(id) {
  const a = store.obter('atividades', id);
  if (!a) return null;
  const mapa = new Map();
  const parametros = (a.parametros || []).map(p => {
    const novo = uid();
    mapa.set(p.id, novo);
    return { ...p, id: novo };
  });
  const { id: _id, criadoEm, criadoPor, modificadoEm, modificadoPor, ...resto } = a;
  const copia = store.salvar('atividades', {
    ...resto,
    nome: `${a.nome} (cópia)`,
    seq: store.proximaSequencia('atividades', a.setorId),
    parametros,
    campoQtdId: a.campoQtdId ? mapa.get(a.campoQtdId) : null,
    campoPessoasId: a.campoPessoasId ? mapa.get(a.campoPessoasId) : null,
  });
  toast('Atividade duplicada (sem as medições)', { acao: () => ir(`#/atividade/${copia.id}`), rotuloAcao: 'Abrir' });
  return copia;
}
