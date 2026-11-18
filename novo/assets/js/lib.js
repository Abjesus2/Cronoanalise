// Bibliotecas externas (sem etapa de build). Versões fixas para estabilidade.
const LIT = 'https://cdn.jsdelivr.net/npm/lit-html@3.2.1';

export { html, svg, render, nothing, noChange } from 'https://cdn.jsdelivr.net/npm/lit-html@3.2.1/lit-html.js';
export { repeat } from 'https://cdn.jsdelivr.net/npm/lit-html@3.2.1/directives/repeat.js';
export { live } from 'https://cdn.jsdelivr.net/npm/lit-html@3.2.1/directives/live.js';
export { unsafeHTML } from 'https://cdn.jsdelivr.net/npm/lit-html@3.2.1/directives/unsafe-html.js';
export { ref, createRef } from 'https://cdn.jsdelivr.net/npm/lit-html@3.2.1/directives/ref.js';
export { classMap } from 'https://cdn.jsdelivr.net/npm/lit-html@3.2.1/directives/class-map.js';
export { styleMap } from 'https://cdn.jsdelivr.net/npm/lit-html@3.2.1/directives/style-map.js';

export const URL_MSAL = 'https://cdn.jsdelivr.net/npm/@azure/msal-browser@3.27.0/+esm';
export const URL_XLSX = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
export const LIT_BASE = LIT;

const carregados = new Map();
/** Carrega um script clássico (UMD) uma única vez. */
export function carregarScript(url) {
  if (carregados.has(url)) return carregados.get(url);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      carregados.delete(url);
      reject(new Error('Não foi possível carregar ' + url));
    };
    document.head.appendChild(s);
  });
  carregados.set(url, p);
  return p;
}

export async function obterXLSX() {
  if (!window.XLSX) await carregarScript(URL_XLSX);
  return window.XLSX;
}
