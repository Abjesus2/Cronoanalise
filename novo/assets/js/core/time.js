// Conversão e exibição de tempos.
// Internamente todo tempo é armazenado em SEGUNDOS (número decimal).
import { prefs } from './prefs.js';
import { finito, fmtNum, numero } from './util.js';

export const FORMATOS = {
  relogio: { rotulo: 'Relógio (hh:mm:ss)', curto: 'hh:mm:ss' },
  segundos: { rotulo: 'Segundos decimais', curto: 's' },
  cmin: { rotulo: 'Minutos centesimais (Cmin)', curto: 'min' },
};

export const PRECISOES = [
  { casas: 0, rotulo: 'Segundo' },
  { casas: 1, rotulo: 'Décimo' },
  { casas: 2, rotulo: 'Centésimo' },
  { casas: 3, rotulo: 'Milésimo' },
];

/**
 * Lê um tempo digitado pelo usuário e devolve segundos.
 * Aceita: "1:23.4", "00:01:23,4", "83,4", "83.4s", "1,39 min", "2h 5min", "1m30s".
 */
export function lerTempo(entrada) {
  if (entrada == null) return null;
  if (typeof entrada === 'number') return finito(entrada) && entrada >= 0 ? entrada : null;
  let t = String(entrada).trim().toLowerCase();
  if (!t) return null;

  // "1,39 min" ou "1.39min" → minutos decimais
  const minDec = t.match(/^([\d.,]+)\s*(min|cmin|m)$/);
  if (minDec) {
    const v = numero(minDec[1]);
    return v == null ? null : v * 60;
  }
  // "2h 5min 3s" / "1m30s"
  if (/[hms]/.test(t) && !t.includes(':')) {
    const h = t.match(/([\d.,]+)\s*h/);
    const m = t.match(/([\d.,]+)\s*m(?!s)/);
    const s = t.match(/([\d.,]+)\s*s/);
    if (h || m || s) {
      return (numero(h?.[1]) || 0) * 3600 + (numero(m?.[1]) || 0) * 60 + (numero(s?.[1]) || 0);
    }
  }
  t = t.replace(/\s*(seg(undos?)?|s)$/, '');
  const partes = t.split(':');
  if (partes.length === 1) {
    const v = numero(partes[0]);
    return v == null || v < 0 ? null : v;
  }
  let total = 0;
  for (let i = 0; i < partes.length; i++) {
    const v = numero(partes[i] === '' ? '0' : partes[i]);
    if (v == null || v < 0) return null;
    total = total * 60 + v;
  }
  return total;
}

function relogio(seg, casas) {
  const fator = 10 ** casas;
  const unidades = Math.round(seg * fator);
  const totalSeg = Math.floor(unidades / fator);
  const frac = unidades % fator;
  const h = Math.floor(totalSeg / 3600);
  const m = Math.floor((totalSeg % 3600) / 60);
  const s = totalSeg % 60;
  const p = n => String(n).padStart(2, '0');
  const base = h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
  return casas > 0 ? `${base},${String(frac).padStart(casas, '0')}` : base;
}

/** Formata segundos conforme a preferência do usuário (ou opções explícitas). */
export function fmtTempo(seg, opcoes = {}) {
  if (!finito(seg)) return '—';
  const p = prefs();
  const formato = opcoes.formato || p.formatoTempo;
  const casas = opcoes.casas ?? p.casas;
  const unidade = opcoes.unidade !== false;
  if (formato === 'segundos') {
    return fmtNum(seg, casas, casas) + (unidade ? ' s' : '');
  }
  if (formato === 'cmin') {
    // minutos centesimais: duas casas a mais que a precisão em segundos
    const c = Math.min(casas + 2, 5);
    return fmtNum(seg / 60, c, c) + (unidade ? ' min' : '');
  }
  return relogio(seg, casas);
}

/** Tempo compacto para eixos de gráfico. */
export function fmtTempoCurto(seg) {
  if (!finito(seg)) return '';
  const p = prefs();
  if (p.formatoTempo === 'segundos') return fmtNum(seg, seg < 10 ? 1 : 0) + 's';
  if (p.formatoTempo === 'cmin') return fmtNum(seg / 60, 2) + 'm';
  if (seg < 60) return fmtNum(seg, seg < 10 ? 1 : 0) + 's';
  return relogio(seg, 0);
}

/** Display do cronômetro: sempre relógio com décimos/centésimos. */
export function fmtCronometro(ms, casas = 1) {
  const seg = ms / 1000;
  const fator = 10 ** casas;
  const unidades = Math.floor(seg * fator);
  const totalSeg = Math.floor(unidades / fator);
  const frac = unidades % fator;
  const h = Math.floor(totalSeg / 3600);
  const m = Math.floor((totalSeg % 3600) / 60);
  const s = totalSeg % 60;
  const p = n => String(n).padStart(2, '0');
  return {
    principal: h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`,
    fracao: casas > 0 ? String(frac).padStart(casas, '0') : '',
  };
}

/** Texto de ajuda para campos de tempo, conforme preferência. */
export function dicaTempo() {
  const f = prefs().formatoTempo;
  if (f === 'segundos') return 'Ex.: 83,4 (segundos) ou 1:23,4';
  if (f === 'cmin') return 'Ex.: 1,39 min ou 1:23,4';
  return 'Ex.: 1:23,4 (min:seg) ou 83,4 s';
}

/** Valor sugerido para preencher um campo de edição de tempo. */
export function tempoParaCampo(seg) {
  if (!finito(seg)) return '';
  const p = prefs();
  const casas = Math.max(p.casas, 1);
  if (p.formatoTempo === 'segundos') return fmtNum(seg, 3, casas).replace(/\./g, '');
  return relogio(seg, Math.min(casas, 3));
}
