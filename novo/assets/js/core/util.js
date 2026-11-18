// Utilitários gerais (sem dependências).

export function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export const agoraISO = () => new Date().toISOString();

export function semAcento(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Busca tolerante: todas as palavras do termo precisam aparecer no alvo. */
export function combina(alvo, termo) {
  const t = semAcento(termo);
  if (!t) return true;
  const a = semAcento(alvo);
  return t.split(/\s+/).every(p => a.includes(p));
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const soma = arr => arr.reduce((s, v) => s + v, 0);
export const media = arr => (arr.length ? soma(arr) / arr.length : null);
export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const finito = v => typeof v === 'number' && Number.isFinite(v);

export function numero(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  let t = String(valor).trim().replace(/\s/g, '');
  if (!t) return null;
  if (t.includes(',') && t.includes('.')) {
    t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else {
    t = t.replace(',', '.');
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const nfCache = new Map();
function nf(min, max) {
  const chave = min + ':' + max;
  if (!nfCache.has(chave)) {
    nfCache.set(chave, new Intl.NumberFormat('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max }));
  }
  return nfCache.get(chave);
}

/** Formata número em pt-BR. */
export function fmtNum(v, casas = 2, minCasas = 0) {
  if (!finito(v)) return '—';
  return nf(Math.min(minCasas, casas), casas).format(v);
}

/** Número com casas decimais adaptativas (bom para produtividade). */
export function fmtQtd(v) {
  if (!finito(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1000) return nf(0, 0).format(v);
  if (abs >= 100) return nf(0, 1).format(v);
  if (abs >= 10) return nf(0, 1).format(v);
  if (abs >= 1) return nf(0, 2).format(v);
  return nf(0, 3).format(v);
}

/** Forma compacta: 12,9 mil · 4,2 mi */
export function fmtCompacto(v) {
  if (!finito(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return fmtNum(v / 1e9, 1) + ' bi';
  if (abs >= 1e6) return fmtNum(v / 1e6, 1) + ' mi';
  if (abs >= 1e4) return fmtNum(v / 1e3, 1) + ' mil';
  return fmtQtd(v);
}

export function fmtPct(v, casas = 1) {
  if (!finito(v)) return '—';
  return fmtNum(v * 100, casas) + '%';
}

const dtf = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dtfh = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const dtfhs = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function fmtData(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? dtf.format(d) : '—';
}
export function fmtDataHora(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? dtfh.format(d) : '—';
}
export function fmtHora(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? dtfhs.format(d) : '—';
}

export function tempoRelativo(iso) {
  if (!iso) return 'nunca';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 10) return 'agora';
  if (diff < 60) return `há ${Math.floor(diff)} s`;
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 30) return `há ${Math.floor(diff / 86400)} d`;
  return fmtData(iso);
}

/** Converte "dd/mm/aaaa hh:mm:ss" (formato antigo) ou ISO em ISO. */
export function paraISO(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return valor.toISOString();
  const t = String(valor).trim();
  const br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (br) {
    let [, d, m, a, h = '0', mi = '0', s = '0'] = br;
    if (a.length === 2) a = '20' + a;
    const dt = new Date(Number(a), Number(m) - 1, Number(d), Number(h), Number(mi), Number(s));
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }
  const dt = new Date(t);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

export function agruparPor(arr, chaveFn) {
  const m = new Map();
  for (const item of arr) {
    const k = chaveFn(item);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(item);
  }
  return m;
}

export function ordenarPor(arr, ...fns) {
  return [...arr].sort((a, b) => {
    for (const fn of fns) {
      const va = fn(a);
      const vb = fn(b);
      if (va == null && vb == null) continue;
      if (va == null) return 1;
      if (vb == null) return -1;
      const r = typeof va === 'string' ? va.localeCompare(vb, 'pt-BR', { numeric: true }) : va - vb;
      if (r) return r;
    }
    return 0;
  });
}

export function baixarArquivo(nome, conteudo, tipo = 'application/octet-stream') {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function escaparHTML(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function nomeArquivo(base) {
  const data = new Date();
  const p = n => String(n).padStart(2, '0');
  const carimbo = `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}_${p(data.getHours())}${p(data.getMinutes())}`;
  return `${semAcento(base).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cronoanalise'}_${carimbo}`;
}

export const prefereMenosMovimento = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
