// Exportações: Excel (várias abas), CSV, relatório imprimível (PDF) e Word.
import { obterXLSX } from '../lib.js';
import { store } from './store.js';
import { analise, analisesDoEscopo, contexto } from './consultas.js';
import { analisarGrupo, ROTULO_SAUDE } from './calc.js';
import { fmtTempo } from './time.js';
import { agruparPor, baixarArquivo, nomeArquivo, escaparHTML, fmtNum, fmtPct, fmtQtd, fmtDataHora } from './util.js';
import { toast, menuAcoes } from '../ui/ui.js';

const r3 = v => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const r1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

function linhaProdutividade(an) {
  const c = store.caminho(store.obter('atividades', an.atividade.id));
  return {
    'Área': c.area?.nome || '',
    'Setor': c.setor?.nome || '',
    'Atividade': an.atividade.nome,
    'Unidade': an.atividade.unidade,
    'Medições': an.total,
    'Válidas': an.nValidas,
    'Necessárias': an.ciclos.necessario,
    'Confiabilidade (%)': r1((an.confiabilidade ?? 0) * 100),
    'Tempo médio do ciclo (s)': r3(an.cicloMedio),
    'Tempo base (s/un)': r3(an.tempoBase),
    'Ritmo (%)': r1(an.ritmo * 100),
    'Tempo normal (s/un)': r3(an.tempoNormal),
    'Tolerância (%)': r1(an.tolManual * 100),
    'Tolerância paradas (%)': r1(an.tolParadas * 100),
    'Fator de tolerância': r3(an.fatorTolerancia),
    'Tempo padrão (s/un)': r3(an.tempoPadrao),
    'Tempo padrão (min/un)': r3(an.tempoPadrao / 60),
    'Pessoas alocadas': an.pessoas,
    'Prod. por minuto (pessoa)': r3(an.prodPessoa?.minuto),
    'Prod. por hora (pessoa)': r1(an.prodPessoa?.hora),
    'Prod. por dia (pessoa)': r1(an.prodPessoa?.dia),
    'Prod. por semana (pessoa)': r1(an.prodPessoa?.semana),
    'Prod. por mês (pessoa)': r1(an.prodPessoa?.mes),
    'Prod. por ano (pessoa)': r1(an.prodPessoa?.ano),
    'Prod. por hora (equipe)': r1(an.prodEquipe?.hora),
    'Prod. por dia (equipe)': r1(an.prodEquipe?.dia),
    'Prod. por dia (planejada)': r1(an.prodPlanejada?.dia),
    'CV (%)': r1((an.est.cv ?? NaN) * 100),
    'Desvio padrão (s/un)': r3(an.est.dp),
    'Situação': ROTULO_SAUDE[an.saude]?.rotulo || '',
    'Última medição': fmtDataHora(an.ultima),
  };
}

function linhaGrupo(nome, extra, g, unidade) {
  return {
    ...extra,
    'Nome': nome,
    'Atividades': g.nAtividades,
    'Com tempo padrão': g.nComTP,
    'Medições': g.medicoes,
    'TP total (s)': r3(g.tpTotal),
    'Gargalo': g.gargalo?.analise.atividade.nome || '',
    'Tempo do gargalo (s)': r3(g.gargalo?.tc),
    'Unidade': unidade,
    'Capacidade do fluxo/hora': r1(g.capacidadeFluxo?.hora),
    'Capacidade do fluxo/dia': r1(g.capacidadeFluxo?.dia),
    'Capacidade do fluxo/mês': r1(g.capacidadeFluxo?.mes),
    'Capacidade do fluxo/ano': r1(g.capacidadeFluxo?.ano),
    'Prod. por pessoa/hora': r1(g.prodPessoa?.hora),
    'Prod. por pessoa/dia': r1(g.prodPessoa?.dia),
    'Pessoas alocadas': g.pessoasTotal,
    'Balanceamento (%)': r1((g.eficienciaBalanceamento ?? NaN) * 100),
    'Amostras confiáveis (%)': r1((g.coberturaAmostra ?? NaN) * 100),
    'CV médio (%)': r1((g.cvMedio ?? NaN) * 100),
  };
}

function linhasMedicoes(medicoes) {
  const paradas = store.mapaParadas();
  return medicoes.map(m => {
    const at = store.obter('atividades', m.atividadeId);
    const c = at ? store.caminho(at) : {};
    const an = at ? analise(at.id) : null;
    const l = an?.linhas.find(x => x.m.id === m.id);
    const linha = {
      'Data e hora': m.dataHora ? new Date(m.dataHora) : '',
      'Área': c.area?.nome || '',
      'Setor': c.setor?.nome || '',
      'Atividade': at?.nome || '(atividade removida)',
      'Tempo (s)': r3(m.tempo),
      'Tempo': fmtTempo(m.tempo, { formato: 'relogio', casas: 2 }),
      'Quantidade': l?.q ?? null,
      'Pessoas': l?.p ?? null,
      'Tempo por unidade (s)': r3(l?.u),
      'Situação': l ? { valida: 'Válida', nivelada: 'Nivelada', excluida: 'Fora do cálculo', invalida: 'Incompleta' }[l.status] : '',
      'Motivo da situação': l?.razao || '',
      'Anomalia': m.motivoId ? paradas.get(m.motivoId)?.nome || '' : 'Operação normal',
      'Operador': m.operador || '',
      'Cronometrista': m.cronometrista || '',
      'Ritmo avaliado (%)': m.ritmo ? r1(m.ritmo * 100) : null,
      'Observação': m.observacao || '',
      'Origem': m.origem || '',
    };
    for (const p of at?.parametros || []) linha[p.nome] = m.valores?.[p.id] ?? '';
    return linha;
  });
}

function folha(XLSX, linhas) {
  const ws = XLSX.utils.json_to_sheet(linhas.length ? linhas : [{ '': 'Sem dados' }], { cellDates: true });
  const chaves = Object.keys(linhas[0] || { '': '' });
  ws['!cols'] = chaves.map(k => ({ wch: Math.min(48, Math.max(10, k.length + 2, ...linhas.slice(0, 200).map(l => String(l[k] ?? '').length + 1))) }));
  return ws;
}

/** Exporta um Excel completo do escopo: produtividade, setores, áreas, medições e paradas. */
export async function exportarPlanilha(escopo = {}, nome = 'cronoanalise', { analises } = {}) {
  try {
    toast('Gerando planilha…', { tipo: 'info', duracao: 1500 });
    const XLSX = await obterXLSX();
    const ans = analises || analisesDoEscopo(escopo);
    const cfg = store.config();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, folha(XLSX, ans.map(linhaProdutividade)), 'Produtividade');

    const porSetor = agruparPor(ans, a => a.atividade.setorId);
    const setores = [...porSetor.entries()].map(([id, lista]) => {
      const s = store.obter('setores', id);
      const area = s ? store.obter('areas', s.areaId) : null;
      return linhaGrupo(s?.nome || '', { 'Área': area?.nome || '' }, analisarGrupo(lista, cfg), lista.find(a => a.tempoPadrao)?.atividade.unidade || '');
    });
    XLSX.utils.book_append_sheet(wb, folha(XLSX, setores), 'Setores');

    const porArea = agruparPor(ans, a => store.obter('setores', a.atividade.setorId)?.areaId);
    const areas = [...porArea.entries()].map(([id, lista]) => linhaGrupo(store.obter('areas', id)?.nome || '', {}, analisarGrupo(lista, cfg), lista.find(a => a.tempoPadrao)?.atividade.unidade || ''));
    XLSX.utils.book_append_sheet(wb, folha(XLSX, areas), 'Áreas');

    const meds = ans.flatMap(a => store.medicoes(a.atividade.id));
    XLSX.utils.book_append_sheet(wb, folha(XLSX, linhasMedicoes(meds)), 'Medições');
    XLSX.utils.book_append_sheet(wb, folha(XLSX, store.paradas().map(p => ({
      'Nome': p.nome,
      'Tipo': p.tipo === 'programada' ? 'Parada programada' : 'Motivo de anomalia',
      'Duração (s)': p.duracao ?? null,
      'Frequência': p.tipo === 'programada' ? (p.freq === 'ciclo' ? 'Por ciclo' : 'Por jornada') : '',
      'Fora do cálculo': p.tipo === 'motivo' ? (p.excluiCalculo ? 'Sim' : 'Não') : '',
    }))), 'Paradas');
    XLSX.utils.book_append_sheet(wb, folha(XLSX, [
      { 'Parâmetro': 'Jornada (min/dia)', 'Valor': cfg.jornadaMin },
      { 'Parâmetro': 'Dias úteis por semana', 'Valor': cfg.diasSemana },
      { 'Parâmetro': 'Dias úteis por mês', 'Valor': cfg.diasMes },
      { 'Parâmetro': 'Dias úteis por ano', 'Valor': cfg.diasAno },
      { 'Parâmetro': 'Eficiência meta (%)', 'Valor': cfg.eficienciaMeta * 100 },
      { 'Parâmetro': 'Tolerância padrão (%)', 'Valor': cfg.toleranciaPadrao * 100 },
      { 'Parâmetro': 'Confiança (%)', 'Valor': cfg.confianca * 100 },
      { 'Parâmetro': 'Erro relativo (%)', 'Valor': cfg.erroRel * 100 },
      { 'Parâmetro': 'Exportado em', 'Valor': fmtDataHora(new Date().toISOString()) },
    ]), 'Parâmetros');
    XLSX.writeFile(wb, nomeArquivo(nome) + '.xlsx', { compression: true });
    toast('Planilha exportada');
  } catch (e) {
    console.error(e);
    toast('Não foi possível gerar a planilha: ' + e.message, { tipo: 'erro' });
  }
}

/** Exporta medições (Excel ou CSV). */
export function exportarMedicoes(medicoes, nome = 'medicoes') {
  menuAcoes(`Exportar ${medicoes.length} medição(ões)`, [
    {
      icone: 'microsoft-excel-logo',
      rotulo: 'Excel (.xlsx)',
      acao: async () => {
        const XLSX = await obterXLSX();
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, folha(XLSX, linhasMedicoes(medicoes)), 'Medições');
        XLSX.writeFile(wb, nomeArquivo(nome) + '.xlsx', { compression: true });
      },
    },
    {
      icone: 'file-csv',
      rotulo: 'CSV (separado por ponto e vírgula)',
      texto: 'Abre direto no Excel em português',
      acao: () => {
        const linhas = linhasMedicoes(medicoes).map(l => ({ ...l, 'Data e hora': l['Data e hora'] ? fmtDataHora(l['Data e hora'].toISOString()) : '' }));
        if (!linhas.length) return;
        const cab = Object.keys(linhas[0]);
        const esc = v => {
          if (v == null) return '';
          const t = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
          return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
        };
        const csv = '﻿' + [cab.join(';'), ...linhas.map(l => cab.map(k => esc(l[k])).join(';'))].join('\r\n');
        baixarArquivo(nomeArquivo(nome) + '.csv', csv, 'text/csv;charset=utf-8');
      },
    },
  ]);
}

/* ------------------------------ relatório ------------------------------ */
function htmlRelatorio(escopo, titulo) {
  const ans = analisesDoEscopo(escopo);
  const g = analisarGrupo(ans, store.config());
  const cfg = store.config();
  const linhas = ans
    .map(an => {
      const c = store.caminho(store.obter('atividades', an.atividade.id));
      return `<tr><td>${escaparHTML(c.setor?.nome || '')}</td><td><b>${escaparHTML(an.atividade.nome)}</b></td>
        <td class="n">${an.nValidas}${an.ciclos.necessario ? ' / ' + an.ciclos.necessario : ''}</td>
        <td class="n">${escaparHTML(fmtTempo(an.tempoBase))}</td><td class="n">${escaparHTML(fmtPct(an.ritmo, 0))}</td>
        <td class="n">${escaparHTML(fmtNum(an.fatorTolerancia, 3))}</td><td class="n"><b>${escaparHTML(fmtTempo(an.tempoPadrao))}</b></td>
        <td class="n">${escaparHTML(fmtQtd(an.prodPessoa?.hora))}</td><td class="n">${escaparHTML(fmtQtd(an.prodPessoa?.dia))}</td>
        <td class="n">${escaparHTML(fmtQtd(an.prodPessoa?.mes))}</td><td class="n">${escaparHTML(fmtPct(an.est.cv))}</td>
        <td>${escaparHTML(ROTULO_SAUDE[an.saude]?.rotulo || '')}</td></tr>`;
    })
    .join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escaparHTML(titulo)}</title>
<style>
body{font-family:'Segoe UI',system-ui,sans-serif;color:#15171c;margin:24px;font-size:11pt}
h1{font-size:20pt;margin:0 0 4px}h2{font-size:13pt;margin:22px 0 8px}
.sub{color:#555;margin:0 0 16px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}
.kpi{border:1px solid #ddd;border-radius:10px;padding:10px 12px}.kpi b{display:block;font-size:15pt}.kpi span{color:#666;font-size:9pt}
table{width:100%;border-collapse:collapse;font-size:9.5pt}th,td{border-bottom:1px solid #ddd;padding:6px 6px;text-align:left;vertical-align:top}
th{background:#f4f2ec;font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em}.n{text-align:right;white-space:nowrap}
.rod{margin-top:18px;color:#777;font-size:8.5pt}@page{margin:14mm;size:A4 landscape}
</style></head><body>
<h1>${escaparHTML(titulo)}</h1>
<p class="sub">Relatório de cronoanálise · ${escaparHTML(fmtDataHora(new Date().toISOString()))} · jornada ${cfg.jornadaMin} min · ${cfg.diasMes} dias/mês</p>
<div class="kpis">
<div class="kpi"><b>${g.nComTP} / ${g.nAtividades}</b><span>atividades com tempo padrão</span></div>
<div class="kpi"><b>${g.validas}</b><span>medições válidas</span></div>
<div class="kpi"><b>${escaparHTML(g.tpTotal ? fmtTempo(g.tpTotal) : '—')}</b><span>tempo padrão total</span></div>
<div class="kpi"><b>${escaparHTML(fmtQtd(g.capacidadeFluxo?.hora))}</b><span>capacidade do fluxo por hora${g.gargalo ? ' · gargalo: ' + escaparHTML(g.gargalo.analise.atividade.nome) : ''}</span></div>
</div>
<h2>Tempos e produtividade por atividade (por pessoa)</h2>
<table><thead><tr><th>Setor</th><th>Atividade</th><th class="n">Medições</th><th class="n">Tempo base</th><th class="n">Ritmo</th><th class="n">Fator tol.</th><th class="n">Tempo padrão</th><th class="n">Por hora</th><th class="n">Por dia</th><th class="n">Por mês</th><th class="n">CV</th><th>Situação</th></tr></thead>
<tbody>${linhas}</tbody></table>
<p class="rod">Tempo padrão = tempo base × ritmo × fator de tolerância. Produtividade = jornada ÷ tempo padrão. Gerado pelo sistema de Cronoanálise.</p>
</body></html>`;
}

export function imprimirRelatorio(escopo = {}, titulo = 'Relatório') {
  menuAcoes('Relatório', [
    {
      icone: 'file-pdf',
      rotulo: 'PDF / imprimir',
      texto: 'Abre o relatório para salvar como PDF',
      acao: () => {
        const w = window.open('', '_blank');
        if (!w) {
          toast('Permita pop-ups para gerar o relatório.', { tipo: 'aviso' });
          return;
        }
        w.document.write(htmlRelatorio(escopo, titulo));
        w.document.close();
        setTimeout(() => w.print(), 400);
      },
    },
    {
      icone: 'file-doc',
      rotulo: 'Word (.doc)',
      texto: 'Documento editável',
      acao: () => baixarArquivo(nomeArquivo(titulo) + '.doc', htmlRelatorio(escopo, titulo), 'application/msword'),
    },
  ]);
}

/* ------------------------------ backup ------------------------------ */
export function baixarBackup() {
  const dados = store.exportarBackup();
  baixarArquivo(nomeArquivo('backup-cronoanalise') + '.json', JSON.stringify(dados), 'application/json');
  toast('Backup baixado');
}
