// Configurações: parâmetros gerais, preferências, banco de dados, importação e histórico.
import { html, nothing } from '../lib.js';
import { store } from '../core/store.js';
import { sharepoint, LISTAS } from '../core/sharepoint.js';
import { CONFIG_PADRAO, Z_CONFIANCA } from '../core/calc.js';
import { prefs, definirPrefs } from '../core/prefs.js';
import { FORMATOS, PRECISOES, fmtTempo } from '../core/time.js';
import { fmtNum, fmtPct, numero, tempoRelativo, fmtDataHora, combina } from '../core/util.js';
import { ic, toast, confirmar, ajuda, abrirDialogo, topoDialogo } from '../ui/ui.js';
import { cabecalho } from '../ui/layout.js';
import { atualizar, ir } from '../ui/nav.js';
import { baixarBackup, exportarPlanilha } from '../core/exportar.js';
import { lerSistemaAntigo, importarDadosAntigos, importarPlanilhaAntiga, URL_SISTEMA_ANTIGO } from '../core/legado.js';
import { obterXLSX } from '../lib.js';
import { carregarExemplo, removerExemplo, temExemplo } from '../core/exemplo.js';

const ui = { geral: null, sp: null, importando: false, urlAntigo: URL_SISTEMA_ANTIGO, termoHist: '' };

/* ------------------------------ geral ------------------------------ */
function abaGeral() {
  const cfg = store.config();
  if (!ui.geral) ui.geral = { ...cfg };
  const g = ui.geral;
  const pct = (k, rot, ajudaTxt) => html`<div class="campo"><label>${rot}</label><div class="entrada-grupo">
    <input class="entrada" inputmode="decimal" .value=${fmtNum(g[k] * 100, 2)} @change=${e => { g[k] = (numero(e.target.value) ?? 0) / 100; atualizar(); }} /><span class="sufixo">%</span></div>
    ${ajudaTxt ? html`<span class="ajuda">${ajudaTxt}</span>` : nothing}</div>`;
  const n = (k, rot, suf, ajudaTxt) => html`<div class="campo"><label>${rot}</label><div class="entrada-grupo">
    <input class="entrada" inputmode="decimal" .value=${fmtNum(g[k], 2)} @change=${e => { g[k] = numero(e.target.value) ?? CONFIG_PADRAO[k]; if (k === 'diasMes' && !ui.anoManual) g.diasAno = g.diasMes * 12; atualizar(); }} />${suf ? html`<span class="sufixo">${suf}</span>` : nothing}</div>
    ${ajudaTxt ? html`<span class="ajuda">${ajudaTxt}</span>` : nothing}</div>`;
  const alterado = JSON.stringify(g) !== JSON.stringify(cfg);
  return html`<div class="stack loose">
    <div class="aviso info">${ic('users-three', 'fill')}<div>Estes parâmetros valem para <b>toda a equipe</b>${store.sync.modo === 'sharepoint' ? ' (ficam no SharePoint)' : ''} e afetam todos os cálculos de tempo padrão e produtividade.</div></div>
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
      <button class="btn primario" ?disabled=${!alterado} @click=${() => { store.salvarConfig(g); ui.geral = null; toast('Parâmetros salvos — tudo foi recalculado'); }}>${ic('check')} Salvar parâmetros</button>
      ${alterado ? html`<button class="btn" @click=${() => { ui.geral = null; atualizar(); }}>Descartar</button>` : nothing}
      <button class="btn fantasma" @click=${() => { ui.geral = { ...CONFIG_PADRAO }; atualizar(); }}>Restaurar padrões</button>
    </div>
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
  const cfgSP = store.configSharePoint();
  if (!ui.sp) ui.sp = { ...cfgSP };
  const sp = ui.sp;
  const conectado = s.modo === 'sharepoint';
  const fixoNoArquivo = Boolean(window.CRONO_CONFIG?.sharepoint?.clientId);
  const copiar = texto => navigator.clipboard?.writeText(texto).then(() => toast('Copiado'));

  return html`<div class="stack loose">
    <section class="cartao stack">
      <div class="row between wrap">
        <h3 class="row">${ic('database', 'duo')} Onde os dados ficam</h3>
        <span class="selo ${conectado ? (s.erro ? 'critical' : 'good') : 'warning'}">${ic(conectado ? 'cloud-check' : 'hard-drives', 'fill')}${conectado ? 'SharePoint' : 'Somente neste navegador'}</span>
      </div>
      ${conectado ? html`
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
        </div>`
      : html`<div class="aviso alerta">${ic('warning', 'fill')}<div><b>Os dados estão salvos apenas neste navegador.</b> Outras pessoas não veem as medições e, se o cache do navegador for limpo, elas se perdem. Conecte ao SharePoint para trabalhar em equipe — ou faça backups.</div></div>`}
    </section>

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
      <p class="small soft">Importa áreas, setores, atividades, parâmetros, paradas e todas as medições da planilha Google usada pelo site atual. Pode repetir quantas vezes quiser: os registros são atualizados, não duplicados.</p>
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
      <p class="small soft">Planilha com produtividade por atividade, setores, áreas, medições, paradas e parâmetros.</p>
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
        <div class="estat"><span class="rotulo-estat">Áreas</span><span class="valor">${r.areas}</span></div>
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
  const corpo = { geral: abaGeral, preferencias: abaPreferencias, banco: abaDados, dados: abaImportar, historico: abaHistorico }[aba] || abaGeral;
  return {
    titulo: 'Configurações',
    migalhas: [{ rotulo: 'Configurações' }],
    conteudo: html`
      ${cabecalho({ sobre: 'Sistema', icone: 'gear-six', titulo: 'Configurações' })}
      <nav class="abas" role="tablist">${abas.map(([k, r, i]) => html`<a role="tab" href="#/configuracoes/${k}" aria-selected=${aba === k}>${ic(i)} ${r}</a>`)}</nav>
      ${corpo()}`,
  };
}
