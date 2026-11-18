// Preferências pessoais deste navegador (tema, formato de tempo, modo simples...).
const CHAVE = 'crono.v2.prefs';

const PADRAO = {
  tema: 'auto', // auto | claro | escuro
  formatoTempo: 'relogio', // relogio | segundos | cmin
  casas: 1, // 0..3 casas decimais
  modo: 'simples', // simples | avancado
  sidebarRecolhida: false,
  operador: '',
  cronometrista: '',
  vibrar: true,
  manterTelaLigada: true,
  somAoRegistrar: false,
};

let atual = { ...PADRAO };
try {
  const salvo = JSON.parse(localStorage.getItem(CHAVE) || '{}');
  atual = { ...PADRAO, ...salvo };
} catch {
  /* armazenamento indisponível: usa padrão em memória */
}

const ouvintes = new Set();

export function prefs() {
  return atual;
}

export function definirPrefs(parcial) {
  atual = { ...atual, ...parcial };
  try {
    localStorage.setItem(CHAVE, JSON.stringify(atual));
  } catch {
    /* ignora */
  }
  aplicarTema();
  ouvintes.forEach(fn => fn(atual));
}

export function aoMudarPrefs(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

export function temaEfetivo() {
  if (atual.tema === 'claro') return 'light';
  if (atual.tema === 'escuro') return 'dark';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function aplicarTema() {
  const raiz = document.documentElement;
  if (atual.tema === 'auto') raiz.removeAttribute('data-theme');
  else raiz.setAttribute('data-theme', atual.tema === 'escuro' ? 'dark' : 'light');
  raiz.dataset.modo = atual.modo;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = temaEfetivo() === 'dark' ? '#111214' : '#f4f2ec';
}

export const ehAvancado = () => atual.modo === 'avancado';
