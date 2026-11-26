// Configurações: parâmetros gerais, preferências, banco de dados, importação e histórico.
import { html, nothing } from '../lib.js';
import { store } from '../core/store.js';
import { sharepoint, LISTAS } from '../core/sharepoint.js';
import { CONFIG_PADRAO, Z_CONFIANCA } from '../core/calc.js';
import { prefs, definirPrefs } from '../core/prefs.js';
import { FORMATOS, PRECISOES, fmtTempo } from '../core/time.js';
import { fmtNum, fmtPct, numero, tempoRelativo, fmtDataHora, combina } from '../core/util.js';
import { ic, toast, confirmar, ajuda, abrirDialogo, topoDialogo, pedirTexto } from '../ui/ui.js';
import { cabecalho } from '../ui/layout.js';
import { atualizar, ir } from '../ui/nav.js';
import { baixarBackup, exportarPlanilha } from '../core/exportar.js';
import { lerSistemaAntigo, importarDadosAntigos, importarPlanilhaAntiga, URL_SISTEMA_ANTIGO } from '../core/legado.js';
import { obterXLSX } from '../lib.js';
import { suportado as pastaSuportada, NOME_CONSOLIDADO, PREFIXO } from '../core/pasta.js';
import { carregarExemplo, removerExemplo, temExemplo } from '../core/exemplo.js';

const ui = { geral: null, sp: null, importando: false, urlAntigo: URL_SISTEMA_ANTIGO, termoHist: '' };

/* ------------------------------ geral (conjuntos de parâmetros) ------------------------------ */
const CAMPOS_CONJUNTO = Object.keys(CONFIG_PADRAO).filter(k => k !== 'id');
const valoresDe = c => Object.fromEntries(CAMPOS_CONJUNTO.map(k => [k, c[k]]));

async function trocarConjunto(id) {
  if (ui.geral && ui.geralId && ui.geralId !== id) {
    const atual = store.conjunto(ui.geralId);
    if (JSON.stringify(ui.geral) !== JSON.stringify(valoresDe(atual))) {
      const ok = await confirmar({ titulo: 'Descartar alterações?', mensagem: `Há alterações não salvas em "${atual.nome}".`, confirmar: 'Descartar' });
      if (!ok) return;
    }
  }
  ui.conjuntoSel = id;
  ui.geral = null;
  atualizar();
}

async function novoConjunto(base = null) {
  const origem = base || store.config();
  const nome = await pedirTexto({
    titulo: base ? `Duplicar "${base.nome}"` : 'Novo conjunto de parâmetros',
    texto: 'Ex.: "CD – 2 turnos", "Web – 6 dias por semana". Depois escolha em quais operações ele vale.',
    rotulo: 'Nome do conjunto',
    valor: base ? `${base.nome} (cópia)` : '',
    placeholder: 'Ex.: CD – 2 turnos',
    icone: 'sliders-horizontal',
    confirmar: 'Criar',
  });
  if (!nome) return;
  const salvo = store.salvarConjunto(null, { ...valoresDe(origem), nome });
  toast(`Conjunto "${nome}" criado`);
  ui.conjuntoSel = salvo.id;
  ui.geral = null;
  atualizar();
}

function painelConjuntos(sel) {
  const conjuntos = store.conjuntos();
  return html`<section class="cartao stack">
    <div class="row between wrap">
      <div class="stack tight" style="gap:2px"><h3 class="row">${ic('stack', 'duo')} Conjuntos de parâmetros gerais</h3>
        <span class="small muted">Cada operação usa um conjunto; um setor pode herdar o da operação ou usar outro.</span></div>
      <button class="btn primario" @click=${() => novoConjunto()}>${ic('plus')} Novo conjunto</button>
    </div>
    <div class="grade estreita">
      ${conjuntos.map(c => {
        const uso = store.usoDoConjunto(c.id);
        const ativo = c.id === sel;
        return html`<button class="cartao clicavel" style="text-align:left;padding:14px 16px;${ativo ? 'border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)' : ''}" aria-pressed=${ativo} @click=${() => trocarConjunto(c.id)}>
          <div class="row between"><b style="font-family:var(--f-display)">${c.nome}</b>${c.id === 'global' ? html`<span class="selo">padrão</span>` : nothing}</div>
          <div class="small soft mt-s">${fmtNum(c.jornadaMin, 0)} min/dia · ${fmtNum(c.diasSemana, 0)} dias/sem · ${fmtNum(c.diasMes, 0)} dias/mês</div>
          <div class="small soft">meta ${fmtPct(c.eficienciaMeta, 0)} · tolerância ${fmtPct(c.toleranciaPadrao, 0)}</div>
          <div class="tiny muted mt-s">${uso.areas.length} operação(ões)${uso.setores.length ? ` · ${uso.setores.length} setor(es) próprios` : ''}</div>
        </button>`;
      })}
    </div>
  </section>`;
}

function painelUso(c) {
  const uso = store.usoDoConjunto(c.id);
  const areas = store.areas();
  return html`<section class="cartao stack">
    <h3 class="row">${ic('tree-structure', 'duo')} Onde "${c.nome}" vale</h3>
    ${c.id === 'global'
      ? html`<p class="small soft">O conjunto padrão vale para toda operação que não tiver um conjunto próprio${uso.areas.length ? ':' : '.'}</p>
        ${uso.areas.length ? html`<div class="row wrap">${uso.areas.map(a => html`<span class="chip" style="cursor:default">${ic('buildings')} ${a.nome}</span>`)}</div>` : nothing}`
      : areas.length
        ? html`<p class="small soft">Marque as operações que trabalham com este conjunto:</p>
          <div class="grade estreita" style="gap:8px">${areas.map(a => {
            const marcado = a.configId === c.id;
            const outro = !marcado && a.configId && store.conjuntoValido(a.configId) ? store.conjunto(a.configId).nome : null;
            return html`<label class="check cartao plano" style="padding:10px 12px">
              <input type="checkbox" .checked=${marcado} @change=${e => {
                store.salvar('areas', { ...a, configId: e.target.checked ? c.id : null }, { rotulo: `parâmetros da operação ${a.nome}` });
                toast(e.target.checked ? `"${a.nome}" passa a usar "${c.nome}"` : `"${a.nome}" volta ao padrão da empresa`);
              }} />
              <span class="grow">${a.nome}${outro ? html`<br /><span class="tiny muted">hoje usa "${outro}"</span>` : nothing}</span></label>`;
          })}</div>`
        : html`<p class="small muted">Cadastre operações na Estrutura para vinculá-las a este conjunto.</p>`}
    ${uso.setores.length ? html`<div class="stack tight"><span class="rotulo">Setores que usam este conjunto (escolhido no cadastro do setor)</span>
      <div class="row wrap">${uso.setores.map(s => html`<a class="chip" href="#/estrutura/setor/${s.id}">${ic('squares-four')} ${store.obter('areas', s.areaId)?.nome || ''} › ${s.nome}</a>`)}</div></div>` : nothing}
    <p class="tiny muted">Para um setor que trabalha diferente da operação, edite o setor (Estrutura › setor › ⋯ › Editar setor) e escolha o conjunto dele.</p>
  </section>`;
}

function abaGeral(rota) {
  // link vindo de um selo "parâmetros: X" abre direto o conjunto X
  const pedido = rota?.query?.conjunto || null;
  if (pedido !== ui.conjuntoPedido) {
    ui.conjuntoPedido = pedido;
    if (pedido) {
      ui.conjuntoSel = pedido;
      ui.geral = null;
    }
  }
  if (!ui.conjuntoSel || !store.conjuntoValido(ui.conjuntoSel)) ui.conjuntoSel = 'global';
  const cfg = store.conjunto(ui.conjuntoSel);
  if (!ui.geral || ui.geralId !== cfg.id) {
    ui.geral = valoresDe(cfg);
    ui.geralId = cfg.id;
  }
  const g = ui.geral;
  const pct = (k, rot, ajudaTxt) => html`<div class="campo"><label>${rot}</label><div class="entrada-grupo">
    <input class="entrada" inputmode="decimal" .value=${fmtNum(g[k] * 100, 2)} @change=${e => { g[k] = (numero(e.target.value) ?? 0) / 100; atualizar(); }} /><span class="sufixo">%</span></div>
    ${ajudaTxt ? html`<span class="ajuda">${ajudaTxt}</span>` : nothing}</div>`;
  const n = (k, rot, suf, ajudaTxt) => html`<div class="campo"><label>${rot}</label><div class="entrada-grupo">
    <input class="entrada" inputmode="decimal" .value=${fmtNum(g[k], 2)} @change=${e => { g[k] = numero(e.target.value) ?? CONFIG_PADRAO[k]; if (k === 'diasMes' && !ui.anoManual) g.diasAno = g.diasMes * 12; atualizar(); }} />${suf ? html`<span class="sufixo">${suf}</span>` : nothing}</div>
    ${ajudaTxt ? html`<span class="ajuda">${ajudaTxt}</span>` : nothing}</div>`;
  const alterado = JSON.stringify(g) !== JSON.stringify(valoresDe(cfg));
  const padrao = cfg.id === 'global';
  return html`<div class="stack loose">
    ${painelConjuntos(cfg.id)}
    <div class="row between wrap">
      <div class="stack tight" style="gap:2px">
        <span class="sobretitulo">${ic('sliders-horizontal', 'fill')} Editando</span>
        <h2>${cfg.nome}</h2>
      </div>
      <div class="row wrap">
        ${!padrao ? html`<button class="btn" @click=${async () => {
          const nome = await pedirTexto({ titulo: 'Renomear conjunto', rotulo: 'Nome', valor: cfg.nome, icone: 'textbox' });
          if (nome) { store.salvarConjunto(cfg.id, { nome }); toast('Conjunto renomeado'); }
        }}>${ic('textbox')} Renomear</button>` : nothing}
        <button class="btn" @click=${() => novoConjunto(cfg)}>${ic('copy')} Duplicar</button>
        ${!padrao ? html`<button class="btn perigo" @click=${async () => {
          const uso = store.usoDoConjunto(cfg.id);
          const ok = await confirmar({
            titulo: `Excluir o conjunto "${cfg.nome}"?`,
            mensagem: uso.areas.length || uso.setores.length
              ? `${uso.areas.length} operação(ões) e ${uso.setores.length} setor(es) que o usam voltarão ao padrão da empresa (os setores herdam da operação). Os cálculos serão refeitos.`
              : 'Ele não está sendo usado por nenhuma operação.',
            perigo: true,
            confirmar: 'Excluir',
          });
          if (ok) { store.excluirConjunto(cfg.id); ui.conjuntoSel = 'global'; ui.geral = null; toast('Conjunto excluído'); }
        }}>${ic('trash')} Excluir</button>` : nothing}
      </div>
    </div>
    <div class="aviso info">${ic('users-three', 'fill')}<div>${padrao
      ? html`O <b>padrão da empresa</b> vale para toda operação sem conjunto próprio.`
      : html`Este conjunto vale para as operações marcadas abaixo e para os setores que o escolherem.`}
      Os valores são compartilhados com <b>toda a equipe</b>${store.sync.modo === 'pasta' ? ' (ficam na pasta compartilhada)' : store.sync.modo === 'sharepoint' ? ' (ficam no SharePoint)' : ''} e afetam o tempo padrão e a produtividade das atividades que o usam.</div></div>
    <div class="grade g2">
      <section class="cartao stack"><h3 class="row">${ic('calendar', 'duo')} Jornada e calendário ${ajuda('produtividade')}</h3>
        <div class="grade-form">
          ${n('jornadaMin', 'Jornada diária', 'min', `= ${fmtTempo(g.jornadaMin * 60, { formato: 'relogio', casas: 0 })} h`)}
          ${n('diasSemana', 'Dias úteis por semana', 'dias')}
          ${n('diasMes', 'Dias úteis por mês', 'dias')}
          ${n('diasAno', 'Dias úteis por ano', 'dias')}
        </div></section>
      <section class="cartao stack"><h3 class="row">${ic('target', 'duo')} Metas e tolerância ${ajuda('tolerancia')}</h3>
        <div class="grade-form">
          ${pct('eficienciaMeta', 'Eficiência meta', 'Usada na produtividade "planejada".')}
          ${pct('toleranciaPadrao', 'Tolerância padrão', 'Aplicada às atividades com tolerância "padrão".')}
        </div></section>
      <section class="cartao stack"><h3 class="row">${ic('chart-bar', 'duo')} Amostragem ${ajuda('ciclos')}</h3>
        <div class="grade-form">
          <div class="campo"><label>Grau de confiança</label><select class="entrada" @change=${e => { g.confianca = Number(e.target.value); atualizar(); }}>
            ${Z_CONFIANCA.map(z => html`<option value=${z.c} ?selected=${Math.abs(g.confianca - z.c) < 0.001}>${fmtPct(z.c, 0)} (Z = ${fmtNum(z.z, 2)})</option>`)}</select></div>
          ${pct('erroRel', 'Erro relativo aceitável')}
          ${n('minMedicoes', 'Mínimo de medições', 'med.', 'Abaixo disso a amostra é sempre "pequena".')}
          <div class="campo cheio"><label>Cálculo do tempo base ${ajuda('tempoBase')}</label>
            <select class="entrada" @change=${e => { g.mediaTempoBase = e.target.value; atualizar(); }}>
              <option value="ponderada" ?selected=${g.mediaTempoBase !== 'simples'}>Média ponderada pela quantidade (recomendado para lotes de tamanhos diferentes)</option>
              <option value="simples" ?selected=${g.mediaTempoBase === 'simples'}>Média simples dos tempos por unidade (igual ao sistema antigo)</option>
            </select>
            <span class="ajuda">Ponderada = tempo total ÷ total produzido: um lote de 500 volumes pesa mais que um de 2. Simples = cada medição vale o mesmo.</span></div>
        </div></section>
      <section class="cartao stack"><h3 class="row">${ic('funnel', 'duo')} Nivelamento e estabilidade ${ajuda('nivelamento')}</h3>
        <div class="grade-form">
          <div class="campo"><label>Nivelamento automático</label><select class="entrada" @change=${e => { g.nivelamento = e.target.value; atualizar(); }}>
            <option value="sigma" ?selected=${g.nivelamento === 'sigma'}>Desvio padrão (média ± k·σ)</option>
            <option value="iqr" ?selected=${g.nivelamento === 'iqr'}>Quartis (1,5 × IQR)</option>
            <option value="off" ?selected=${g.nivelamento === 'off'}>Desligado</option></select></div>
          ${g.nivelamento === 'sigma' ? n('nivelamentoK', 'k (desvios)', 'σ') : nothing}
          ${pct('cvBom', 'CV estável até')}
          ${pct('cvAtencao', 'CV moderado até')}
        </div></section>
    </div>
    <div class="row">
      <button class="btn primario" ?disabled=${!alterado} @click=${() => { store.salvarConjunto(cfg.id, g); ui.geral = null; toast(`"${cfg.nome}" salvo — os cálculos foram refeitos`); }}>${ic('check')} Salvar "${cfg.nome}"</button>
      ${alterado ? html`<button class="btn" @click=${() => { ui.geral = null; atualizar(); }}>Descartar</button>` : nothing}
      <button class="btn fantasma" @click=${() => { ui.geral = valoresDe(CONFIG_PADRAO); atualizar(); }}>Restaurar valores de fábrica</button>
    </div>
    ${painelUso(cfg)}
  </div>`;
}

/* ------------------------------ preferências ------------------------------ */
function abaPreferencias() {
  const p = prefs();
  const seg = (k, opcoes) => html`<div class="segmentado">${opcoes.map(([v, r]) => html`<button aria-pressed=${p[k] === v} @click=${() => definirPrefs({ [k]: v })}>${r}</button>`)}</div>`;
  return html`<div class="grade g2">
    <section class="cartao stack"><h3 class="row">${ic('palette', 'duo')} Aparência</h3>
      <div class="campo"><span class="rotulo">Tema</span>${seg('tema', [['auto', 'Automático'], ['claro', 'Claro'], ['escuro', 'Escuro']])}</div>
      <div class="campo"><span class="rotulo">Nível de detalhe</span>${seg('modo', [['simples', 'Simples'], ['avancado', 'Avançado']])}
        <span class="ajuda">${p.modo === 'simples' ? 'Mostra só o essencial. Ideal para quem está começando.' : 'Mostra todos os passos do cálculo, frequência lógica, ritmo por medição e mais opções.'}</span></div>
    </section>
    <section class="cartao stack"><h3 class="row">${ic('timer', 'duo')} Exibição dos tempos</h3>
      <div class="campo"><span class="rotulo">Formato</span>${seg('formatoTempo', Object.entries(FORMATOS).map(([k, v]) => [k, v.rotulo]))}</div>
      <div class="campo"><span class="rotulo">Precisão</span>${seg('casas', PRECISOES.map(x => [x.casas, x.rotulo]))}</div>
      <div class="aviso">${ic('eye')}<div>Exemplo: 83,456 s → <b>${fmtTempo(83.456)}</b>. A indústria costuma usar <b>minutos centesimais</b> (1 min 45 s = 1,75 min).</div></div>
    </section>
    <section class="cartao stack"><h3 class="row">${ic('user', 'duo')} Identificação neste aparelho</h3>
      <div class="grade-form">
        <div class="campo"><label>Cronometrista</label><input class="entrada" .value=${p.cronometrista} @change=${e => definirPrefs({ cronometrista: e.target.value.trim() })} placeholder="Seu nome" />
          <span class="ajuda">Registrado em cada medição feita aqui.</span></div>
        <div class="campo"><label>Operador padrão</label><input class="entrada" .value=${p.operador} @change=${e => definirPrefs({ operador: e.target.value.trim() })} /></div>
      </div>
    </section>
    <section class="cartao stack"><h3 class="row">${ic('device-mobile', 'duo')} Cronômetro</h3>
      <label class="row between"><span>Manter a tela ligada enquanto cronometra</span><span class="alternador"><input type="checkbox" .checked=${p.manterTelaLigada} @change=${e => definirPrefs({ manterTelaLigada: e.target.checked })} /><span></span></span></label>
      <label class="row between"><span>Vibrar ao registrar (celular)</span><span class="alternador"><input type="checkbox" .checked=${p.vibrar} @change=${e => definirPrefs({ vibrar: e.target.checked })} /><span></span></span></label>
    </section>
  </div>`;
}

/* ------------------------------ banco de dados ------------------------------ */
function abaDados() {
  const s = store.sync;
  const p = s.pasta;
  const naPasta = s.modo === 'pasta';
  const temSuporte = pastaSuportada();
  const conectar = async () => {
    let incluirLocais = true;
    const temDados = store.lista('atividades').length || store.lista('medicoes').length;
    if (temDados) {
      const escolha = await abrirDialogo(({ fechar }) => html`
        ${topoDialogo({ icone: 'folder-simple-plus', titulo: 'Dados que já estão neste navegador', texto: `Este navegador já tem ${store.lista('atividades').length} atividade(s) e ${store.lista('medicoes').length} medição(ões)${temExemplo() ? ', incluindo os dados de exemplo' : ''}.` })}
        <div class="dlg-corpo"><p>Deseja levar esses dados para a pasta compartilhada?</p>
          ${temExemplo() ? html`<div class="aviso alerta">${ic('warning', 'fill')}<div>Dica: remova os dados de exemplo antes (Importar e exportar › Remover exemplo), para não enviá-los à equipe.</div></div>` : nothing}</div>
        <div class="dlg-rodape">
          <button class="btn" @click=${() => fechar(null)}>Cancelar</button>
          <button class="btn" @click=${() => fechar('nao')}>Não, usar só o que está na pasta</button>
          <button class="btn primario" @click=${() => fechar('sim')}>Sim, levar para a pasta</button>
        </div>`, { classe: 'estreito' });
      if (!escolha) return;
      incluirLocais = escolha === 'sim';
    }
    if (!prefs().cronometrista) {
      const nome = await pedirTexto({ titulo: 'Como você se chama?', texto: 'O nome identifica o seu arquivo na pasta e as medições que você fizer.', rotulo: 'Seu nome', placeholder: 'Ex.: Ana Souza', icone: 'user', confirmar: 'Continuar' });
      if (!nome) return;
      definirPrefs({ cronometrista: nome });
    }
    try {
      await store.conectarPasta(null, { incluirLocais });
      toast(`Conectado à pasta "${store.sync.pasta.nome}"`);
    } catch (e) {
      if (e.name !== 'AbortError') toast('Não foi possível usar a pasta: ' + e.message, { tipo: 'erro', duracao: 8000 });
    }
  };

  return html`<div class="stack loose">
    <section class="cartao stack">
      <div class="row between wrap">
        <h3 class="row">${ic('database', 'duo')} Onde os dados ficam</h3>
        <span class="selo ${naPasta ? (s.erro || p.permissao !== 'granted' ? 'warning' : 'good') : s.modo === 'sharepoint' ? 'good' : 'warning'}">${ic(naPasta ? 'folder-simple' : s.modo === 'sharepoint' ? 'cloud-check' : 'hard-drives', 'fill')}${naPasta ? `Pasta: ${p.nome}` : s.modo === 'sharepoint' ? 'SharePoint' : 'Somente neste navegador'}</span>
      </div>
      ${!naPasta && s.modo !== 'sharepoint' ? html`<div class="aviso alerta">${ic('warning', 'fill')}<div><b>Os dados estão salvos apenas neste navegador.</b> Outras pessoas não veem as medições e, se o cache for limpo, elas se perdem. Use uma <b>pasta compartilhada</b> para trabalhar em equipe — não precisa de TI.</div></div>` : nothing}
    </section>

    <section class="cartao stack" style=${naPasta ? 'border-color:var(--good)' : ''}>
      <div class="row between wrap">
        <h3 class="row">${ic('folder-open', 'duo')} Pasta compartilhada — arquivos Excel</h3>
        <span class="selo marca">${ic('star', 'fill')} recomendado · não precisa de TI</span>
      </div>
      <p class="small soft">O site grava os dados em arquivos <b>.xlsx</b> numa pasta que você escolhe: uma pasta do <b>SharePoint sincronizada</b> no computador, do <b>OneDrive</b> ou da <b>rede</b>. Cada pessoa grava o próprio arquivo (<code>Cronoanalise - Nome.xlsx</code>) e o site junta os de todos — ninguém sobrescreve o arquivo de outra pessoa. Também é mantido um <code>${NOME_CONSOLIDADO}</code> com tudo junto e a produtividade calculada.</p>

      ${naPasta ? html`
        ${p.permissao !== 'granted' ? html`<div class="aviso alerta">${ic('lock-key', 'fill')}<div class="grow">O navegador precisa da sua autorização para voltar a usar a pasta <b>${p.nome}</b>.
          <div class="mt-s"><button class="btn primario pequeno" @click=${() => store.reconectarPasta().catch(e => toast(e.message, { tipo: 'erro' }))}>${ic('lock-key-open')} Reconectar pasta</button></div></div></div>` : nothing}
        ${s.erro ? html`<div class="aviso erro">${ic('warning-circle', 'fill')}<div>${s.erro}</div></div>` : nothing}
        ${p.avisos?.length ? html`<div class="aviso alerta">${ic('warning', 'fill')}<div>${p.avisos.map(a => html`<div>${a}</div>`)}</div></div>` : nothing}
        <div class="grade g4">
          <div class="estat"><span class="rotulo-estat">Pasta</span><span class="valor truncate" style="font-size:1rem">${p.nome}</span></div>
          <div class="estat"><span class="rotulo-estat">Última sincronização</span><span class="valor" style="font-size:1rem">${tempoRelativo(s.ultima)}</span><span class="sub">${s.sincronizando ? 'sincronizando…' : 'a cada 45 s e após cada alteração'}</span></div>
          <div class="estat"><span class="rotulo-estat">Seu arquivo</span><span class="valor truncate" style="font-size:.9rem" title=${store.arquivoProprio}>${store.arquivoProprio || '—'}</span><span class="sub">${store.diarioSujo ? 'alterações aguardando gravação' : 'em dia'}</span></div>
          <div class="estat"><span class="rotulo-estat">Consolidado</span><span class="valor" style="font-size:1rem">${p.consolidadoEm ? tempoRelativo(p.consolidadoEm) : '—'}</span><span class="sub">${store.consolidadoAuto ? 'atualiza a cada 5 min' : 'atualização manual'}</span></div>
        </div>
        ${p.arquivos?.length ? html`<div class="stack tight"><span class="rotulo">Arquivos da equipe nesta pasta (${p.arquivos.length})</span>
          <div class="lista">${p.arquivos.map(a => html`<div class="item" style="padding:8px 10px">
            <span class="avatar" style="width:32px;height:32px;font-size:1rem">${ic('microsoft-excel-logo')}</span>
            <span class="corpo"><b>${a.nome.replace(PREFIXO, '').replace(/\.xlsx$/i, '')}${a.proprio ? ' (este computador)' : ''}</b><span>atualizado ${tempoRelativo(new Date(a.modificado).toISOString())}</span></span>
          </div>`)}</div></div>` : nothing}
        <div class="row wrap">
          <button class="btn primario" ?disabled=${s.sincronizando || p.permissao !== 'granted'} @click=${() => store.sincronizarPasta({ forcarEscrita: true })}>${ic('arrows-clockwise')} ${s.sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}</button>
          <button class="btn" ?disabled=${p.permissao !== 'granted'} @click=${async () => { try { await store.gravarConsolidado(); toast('Excel consolidado salvo na pasta'); } catch (e) { toast(e.message, { tipo: 'erro', duracao: 8000 }); } }}>${ic('microsoft-excel-logo')} Atualizar Excel consolidado</button>
          <label class="row" style="gap:8px"><span class="alternador"><input type="checkbox" .checked=${store.consolidadoAuto} @change=${e => store.definirConsolidadoAuto(e.target.checked)} /><span></span></span><span class="small">Atualizar o consolidado automaticamente</span></label>
        </div>
        <div class="row wrap">
          <button class="btn fantasma" @click=${conectar}>${ic('folder-open')} Trocar de pasta</button>
          <button class="btn fantasma perigo" @click=${async () => { if (await confirmar({ titulo: 'Desconectar da pasta?', mensagem: 'O site volta a guardar os dados só neste navegador. Nenhum arquivo é apagado da pasta.', confirmar: 'Desconectar' })) store.desconectarPasta(); }}>${ic('plugs')} Desconectar</button>
        </div>`
      : temSuporte ? html`
        <ol class="small soft" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">
          <li><b>SharePoint:</b> abra a biblioteca de documentos do site da equipe no navegador e clique em <b>Sincronizar</b> (ou <b>Adicionar atalho a Meus arquivos</b>). Ela aparece no Explorador de Arquivos, dentro de "${'AREZZO…'}" / OneDrive. Crie uma pasta, por exemplo <b>Cronoanalise-Dados</b>.</li>
          <li><b>Rede:</b> use uma pasta compartilhada do servidor (ex.: <code>\\\\servidor\\Processos\\Cronoanalise</code>). Se não aparecer, mapeie como unidade (ex.: <b>Z:</b>).</li>
          <li>Clique em <b>Escolher pasta</b> abaixo e autorize. <b>Todos da equipe escolhem a mesma pasta.</b></li>
        </ol>
        <div class="row wrap"><button class="btn primario grande" @click=${conectar}>${ic('folder-open')} Escolher pasta</button></div>
        <p class="tiny muted">Funciona no Google Chrome e no Microsoft Edge do computador. Ao abrir o site em outro dia, pode ser preciso clicar em "Reconectar pasta" (o navegador pede a autorização de novo).</p>`
      : html`<div class="aviso info">${ic('device-mobile', 'fill')}<div>Este navegador não permite escolher pastas (celulares e alguns navegadores). Use o <b>Chrome ou o Edge no computador</b> para conectar a pasta.
          No celular, cronometre normalmente e depois use <b>Importar e exportar › Baixar backup</b>; no computador conectado à pasta, use <b>Restaurar backup › Mesclar</b>.</div></div>`}
    </section>

    <details class="cartao" ?open=${s.modo === 'sharepoint'}>
      <summary class="row" style="cursor:pointer"><h3 class="row">${ic('cloud', 'duo')} SharePoint direto pela internet (exige TI)</h3></summary>
      <div class="stack mt">
        <p class="small soft">Alternativa que não depende de pasta sincronizada, mas exige registrar um aplicativo no Microsoft Entra ID (feito pela TI). Veja o SHAREPOINT.md.</p>
        ${abaSharePoint()}
      </div>
    </details>
  </div>`;
}

function abaSharePoint() {
  const s = store.sync;
  const cfgSP = store.configSharePoint();
  if (!ui.sp) ui.sp = { ...cfgSP };
  const sp = ui.sp;
  const conectado = s.modo === 'sharepoint';
  const fixoNoArquivo = Boolean(window.CRONO_CONFIG?.sharepoint?.clientId);
  const copiar = texto => navigator.clipboard?.writeText(texto).then(() => toast('Copiado'));

  return html`<div class="stack loose">
      ${conectado ? html`<section class="cartao stack">
        <div class="grade g4">
          <div class="estat"><span class="rotulo-estat">Usuário</span><span class="valor" style="font-size:1rem">${s.usuario?.nome || 'Não conectado'}</span><span class="sub">${s.usuario?.email || ''}</span></div>
          <div class="estat"><span class="rotulo-estat">Última sincronização</span><span class="valor" style="font-size:1rem">${tempoRelativo(s.ultima)}</span><span class="sub">${fmtDataHora(s.ultima)}</span></div>
          <div class="estat"><span class="rotulo-estat">Alterações pendentes</span><span class="valor" style="font-size:1rem">${s.pendentes}</span><span class="sub">${s.online ? 'online' : 'offline — serão enviadas depois'}</span></div>
          <div class="estat"><span class="rotulo-estat">Site</span><span class="valor truncate" style="font-size:1rem">${sharepoint.siteNome || '—'}</span><span class="sub truncate">${cfgSP.siteUrl}</span></div>
        </div>
        ${s.erro ? html`<div class="aviso erro">${ic('warning-circle', 'fill')}<div>${s.erro}</div></div>` : nothing}
        ${s.listasFaltando.length ? html`<div class="aviso alerta">${ic('list-plus', 'fill')}<div>Faltam ${s.listasFaltando.length} lista(s) no site: ${s.listasFaltando.map(c => LISTAS[c].nome).join(', ')}.
          <br /><button class="btn pequeno primario mt-s" @click=${async () => { try { await store.criarListas(); toast('Listas criadas no SharePoint'); } catch (e) { toast('Não foi possível criar: ' + e.message, { tipo: 'erro' }); } }}>${ic('plus')} Criar listas agora</button></div></div>` : nothing}
        ${s.naoEnviados ? html`<div class="aviso alerta">${ic('cloud-arrow-up', 'fill')}<div>Há <b>${s.naoEnviados}</b> registro(s) neste navegador que ainda não estão no SharePoint (ex.: criados antes de conectar).
          <div class="row wrap mt-s"><button class="btn pequeno primario" @click=${() => store.enviarDadosLocais()}>${ic('upload-simple')} Enviar para o SharePoint</button>
          <button class="btn pequeno perigo" @click=${async () => { if (await confirmar({ titulo: 'Descartar dados locais?', mensagem: 'Os registros que não estão no SharePoint serão apagados deste navegador e tudo será baixado novamente.', perigo: true, confirmar: 'Descartar e recarregar' })) store.recarregarDoSharePoint(); }}>Descartar e baixar do SharePoint</button></div></div></div>` : nothing}
        <div class="row wrap">
          ${s.usuario
            ? html`<button class="btn primario" ?disabled=${s.sincronizando} @click=${() => store.sincronizar()}>${ic('arrows-clockwise', '')} ${s.sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}</button>
              <button class="btn" @click=${() => store.sair()}>${ic('sign-out')} Sair da conta</button>`
            : html`<button class="btn primario" @click=${() => store.entrar().catch(e => toast(e.message, { tipo: 'erro' }))}>${ic('microsoft-outlook-logo')} Entrar com a conta Microsoft</button>`}
          <button class="btn fantasma" @click=${async () => { if (await confirmar({ titulo: 'Recarregar tudo do SharePoint?', mensagem: 'Apaga o cache deste navegador e baixa os dados novamente. Alterações pendentes serão perdidas.', confirmar: 'Recarregar' })) store.recarregarDoSharePoint(); }}>${ic('cloud-arrow-down')} Recarregar do SharePoint</button>
          ${!fixoNoArquivo ? html`<button class="btn fantasma perigo" @click=${async () => { if (await confirmar({ titulo: 'Desconectar do SharePoint?', mensagem: 'O sistema volta a guardar dados só neste navegador. Nada é apagado no SharePoint.', confirmar: 'Desconectar' })) { await store.desativarSharePoint(); ui.sp = null; } }}>${ic('plugs')} Desconectar</button>` : nothing}
        </div></section>`
      : nothing}

    ${!conectado || !fixoNoArquivo ? html`<section class="cartao stack">
      <h3 class="row">${ic('microsoft-teams-logo', 'duo')} Conectar ao SharePoint</h3>
      <p class="small soft">Os dados ficam em listas do SharePoint (${Object.values(LISTAS).map(l => l.nome).join(', ')}), com login da conta Microsoft da empresa. Cada pessoa vê o que tem permissão de ver no site. É preciso registrar o aplicativo uma única vez no Microsoft Entra ID — o passo a passo está no arquivo <b>SHAREPOINT.md</b>.</p>
      <div class="grade-form">
        <div class="campo cheio"><label>URL do site do SharePoint</label><input class="entrada" placeholder="https://suaempresa.sharepoint.com/sites/Cronoanalise" .value=${sp.siteUrl || ''} @input=${e => (sp.siteUrl = e.target.value.trim())} /></div>
        <div class="campo"><label>ID do aplicativo (Client ID)</label><input class="entrada mono" placeholder="00000000-0000-0000-0000-000000000000" .value=${sp.clientId || ''} @input=${e => (sp.clientId = e.target.value.trim())} /></div>
        <div class="campo"><label>ID do diretório (Tenant ID)</label><input class="entrada mono" placeholder="00000000-0000-0000-0000-000000000000" .value=${sp.tenantId || ''} @input=${e => (sp.tenantId = e.target.value.trim())} /></div>
        <div class="campo cheio"><label>URI de redirecionamento (cadastre no Entra ID como "Aplicativo de página única")</label>
          <div class="entrada-grupo"><input class="entrada mono" readonly .value=${sharepoint.redirectUri} /><button class="sufixo" style="cursor:pointer" @click=${() => copiar(sharepoint.redirectUri)}>${ic('copy')}</button></div></div>
      </div>
      <div class="row wrap">
        <button class="btn primario" ?disabled=${!sp.clientId || !sp.siteUrl} @click=${async () => {
          store.salvarConfigSharePoint(sp);
          await store.ativarSharePoint(sp);
          if (!store.sync.usuario) await store.entrar().catch(e => toast(e.message, { tipo: 'erro' }));
        }}>${ic('plug')} Conectar e entrar</button>
        <span class="small muted">Para fixar para todos, coloque esses valores no arquivo <code>config.js</code>.</span>
      </div>
    </section>` : nothing}
  </div>`;
}

/* ------------------------------ importar e exportar ------------------------------ */
function abaImportar() {
  const restaurar = async ev => {
    const arq = ev.target.files?.[0];
    ev.target.value = '';
    if (!arq) return;
    try {
      const obj = JSON.parse(await arq.text());
      if (obj.formato === 'cronoanalise-v2') {
        const modo = await abrirDialogo(({ fechar }) => html`${topoDialogo({ icone: 'upload-simple', titulo: 'Restaurar backup', texto: `Backup de ${fmtDataHora(obj.exportadoEm)}.` })}
          <div class="dlg-corpo"><p>Como deseja restaurar?</p></div>
          <div class="dlg-rodape"><button class="btn" @click=${() => fechar(null)}>Cancelar</button>
            <button class="btn" @click=${() => fechar('mesclar')}>Mesclar com os atuais</button>
            <button class="btn perigo-cheio" @click=${() => fechar('substituir')}>Substituir tudo</button></div>`, { classe: 'estreito' });
        if (!modo) return;
        const r = store.importarBackup(obj, modo);
        toast(`Backup restaurado: ${Object.values(r).reduce((a, b) => a + b, 0)} registros`);
      } else if (obj.areas || obj.analises || obj.contagens) {
        const r = importarDadosAntigos(obj);
        mostrarResumoImportacao(r);
      } else throw new Error('Formato não reconhecido.');
    } catch (e) {
      toast('Arquivo inválido: ' + e.message, { tipo: 'erro' });
    }
  };
  return html`<div class="grade g2">
    <section class="cartao stack">
      <h3 class="row">${ic('clock-counter-clockwise', 'duo')} Trazer dados do sistema antigo</h3>
      <p class="small soft">Importa operações, setores, atividades, parâmetros, paradas e todas as medições da planilha Google usada pelo site atual. Pode repetir quantas vezes quiser: os registros são atualizados, não duplicados.</p>
      <div class="campo"><label>Endereço do Apps Script</label><input class="entrada mono" .value=${ui.urlAntigo} @input=${e => (ui.urlAntigo = e.target.value.trim())} /></div>
      <div class="row wrap">
        <button class="btn primario" ?disabled=${ui.importando} @click=${async () => {
          ui.importando = true;
          atualizar();
          try {
            const dados = await lerSistemaAntigo(ui.urlAntigo);
            mostrarResumoImportacao(importarDadosAntigos(dados));
          } catch (e) {
            toast('Não foi possível ler o sistema antigo: ' + e.message, { tipo: 'erro', duracao: 8000 });
          } finally {
            ui.importando = false;
            atualizar();
          }
        }}>${ic(ui.importando ? 'circle-notch' : 'download-simple')} ${ui.importando ? 'Importando…' : 'Importar do Apps Script'}</button>
        <label class="btn">${ic('microsoft-excel-logo')} Importar planilha (.xlsx)
          <input type="file" accept=".xlsx,.xls" hidden @change=${async ev => {
            const arq = ev.target.files?.[0];
            ev.target.value = '';
            if (!arq) return;
            ui.importando = true;
            atualizar();
            try {
              const XLSX = await obterXLSX();
              mostrarResumoImportacao(await importarPlanilhaAntiga(arq, XLSX));
            } catch (e) {
              toast('Não foi possível importar a planilha: ' + e.message, { tipo: 'erro', duracao: 8000 });
            } finally {
              ui.importando = false;
              atualizar();
            }
          }} /></label>
      </div>
      <p class="tiny muted">A planilha é a exportação do sistema antigo (abas "Medições" e "Descrição Atividades"). O sistema descobre sozinho a quantidade-base de cada atividade (volumes, paletes, peças, itens…) e o campo de pessoas. Medições repetidas não são duplicadas.</p>
      <div class="aviso info">${ic('info', 'fill')}<div>Para manter os mesmos números do sistema antigo, as atividades importadas ficam com ritmo 100%, tolerância 0% e paradas somadas por ciclo. Ajuste depois na aba <b>Método e cálculo</b> de cada atividade.</div></div>
    </section>
    <section class="cartao stack">
      <h3 class="row">${ic('lifebuoy', 'duo')} Backup</h3>
      <p class="small soft">Um arquivo com todos os dados, para guardar ou levar para outro computador.</p>
      <div class="row wrap">
        <button class="btn" @click=${baixarBackup}>${ic('download-simple')} Baixar backup (.json)</button>
        <label class="btn">${ic('upload-simple')} Restaurar backup<input type="file" accept=".json,application/json" hidden @change=${restaurar} /></label>
      </div>
      <h3 class="row mt">${ic('microsoft-excel-logo', 'duo')} Excel</h3>
      <p class="small soft">Planilha com produtividade por atividade, setores, operações, medições, paradas e parâmetros.</p>
      <button class="btn" style="align-self:flex-start" @click=${() => exportarPlanilha({}, 'cronoanalise-completa')}>${ic('microsoft-excel-logo')} Exportar tudo para Excel</button>
    </section>
    <section class="cartao stack">
      <h3 class="row">${ic('sparkle', 'duo')} Dados de exemplo</h3>
      <p class="small soft">Uma fábrica fictícia com 3 setores, 6 atividades e medições, para treinar e conhecer o sistema.</p>
      <div class="row wrap">
        ${temExemplo()
          ? html`<button class="btn perigo" @click=${() => { removerExemplo(); toast('Exemplo removido'); }}>${ic('trash')} Remover exemplo</button>`
          : html`<button class="btn" @click=${() => { carregarExemplo(); toast('Exemplo carregado'); }}>${ic('sparkle')} Carregar exemplo</button>`}
      </div>
    </section>
    <section class="cartao stack">
      <h3 class="row">${ic('warning-octagon', 'duo')} Zona de cuidado</h3>
      <p class="small soft">Apaga o cache deste navegador. ${store.sync.modo === 'sharepoint' ? 'Os dados no SharePoint não são afetados.' : 'Como você está no modo local, os dados serão perdidos — faça um backup antes.'}</p>
      <button class="btn perigo" style="align-self:flex-start" @click=${async () => {
        if (await confirmar({ titulo: 'Apagar dados deste navegador?', mensagem: 'Esta ação não pode ser desfeita.', perigo: true, confirmar: 'Apagar' })) {
          await store.apagarTudoLocal();
          toast('Dados locais apagados');
          ir('#/');
        }
      }}>${ic('trash')} Apagar dados locais</button>
    </section>
  </div>`;
}

function mostrarResumoImportacao(r) {
  abrirDialogo(({ fechar }) => html`${topoDialogo({ icone: 'check-circle', titulo: 'Importação concluída', texto: 'Os dados do sistema antigo foram trazidos.' })}
    <div class="dlg-corpo">
      <div class="grade g4">
        <div class="estat"><span class="rotulo-estat">Operações</span><span class="valor">${r.areas}</span></div>
        <div class="estat"><span class="rotulo-estat">Setores</span><span class="valor">${r.setores}</span></div>
        <div class="estat"><span class="rotulo-estat">Atividades</span><span class="valor">${r.atividades}</span></div>
        <div class="estat"><span class="rotulo-estat">Medições</span><span class="valor">${r.medicoes}</span></div>
        <div class="estat"><span class="rotulo-estat">Paradas</span><span class="valor">${r.paradas}</span></div>
        <div class="estat"><span class="rotulo-estat">Motivos</span><span class="valor">${r.motivos}</span></div>
      </div>
      ${r.avisos.map(a => html`<div class="aviso alerta">${ic('warning', 'fill')}<div>${a}</div></div>`)}
    </div>
    <div class="dlg-rodape"><button class="btn" @click=${() => fechar()}>Fechar</button><button class="btn primario" @click=${() => { fechar(); ir('#/estrutura'); }}>Ver estrutura</button></div>`);
}

/* ------------------------------ histórico ------------------------------ */
function abaHistorico() {
  const itens = store.historico.filter(h => combina(`${h.acao} ${h.texto} ${h.autor}`, ui.termoHist));
  return html`<section class="cartao stack">
    <div class="row between wrap">
      <div class="busca-local">${ic('magnifying-glass')}<input class="entrada" type="search" placeholder="Filtrar histórico…" .value=${ui.termoHist} @input=${e => { ui.termoHist = e.target.value; atualizar(); }} /></div>
      <button class="btn perigo pequeno" ?disabled=${!store.historico.length} @click=${async () => { if (await confirmar({ titulo: 'Limpar histórico deste navegador?', confirmar: 'Limpar', perigo: true })) store.limparHistorico(); }}>${ic('trash')} Limpar</button>
    </div>
    <p class="small muted">Registro das alterações feitas neste navegador (últimas 300).</p>
    ${itens.length ? html`<div class="lista">${itens.map(h => html`<div class="item">
      <span class="avatar">${ic(h.acao === 'excluiu' ? 'trash' : h.acao === 'criou' ? 'plus' : h.acao === 'importou' ? 'download-simple' : 'pencil-simple')}</span>
      <span class="corpo"><b>${h.acao[0].toUpperCase() + h.acao.slice(1)} ${h.texto}</b><span>${h.autor ? h.autor + ' · ' : ''}${fmtDataHora(h.ts)}</span></span>
    </div>`)}</div>` : html`<p class="muted">Nada registrado.</p>`}
  </section>`;
}

export function telaConfiguracoes(rota) {
  const aba = rota.partes[1] || 'geral';
  const abas = [
    ['geral', 'Parâmetros gerais', 'sliders-horizontal'],
    ['preferencias', 'Preferências', 'user-gear'],
    ['banco', 'Banco de dados', 'database'],
    ['dados', 'Importar e exportar', 'arrows-down-up'],
    ['historico', 'Histórico', 'clock-counter-clockwise'],
  ];
  const corpo = { geral: () => abaGeral(rota), preferencias: abaPreferencias, banco: abaDados, dados: abaImportar, historico: abaHistorico }[aba] || (() => abaGeral(rota));
  return {
    titulo: 'Configurações',
    migalhas: [{ rotulo: 'Configurações' }],
    conteudo: html`
      ${cabecalho({ sobre: 'Sistema', icone: 'gear-six', titulo: 'Configurações' })}
      <nav class="abas" role="tablist">${abas.map(([k, r, i]) => html`<a role="tab" href="#/configuracoes/${k}" aria-selected=${aba === k}>${ic(i)} ${r}</a>`)}</nav>
      ${corpo()}`,
  };
}
