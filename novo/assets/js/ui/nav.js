// Navegação e re-renderização global (evita importações circulares entre telas).
let renderizar = () => {};
let agendado = false;

export function definirRenderizador(fn) {
  renderizar = fn;
}

/** Agenda uma nova renderização da tela atual. */
export function atualizar() {
  if (agendado) return;
  agendado = true;
  requestAnimationFrame(() => {
    agendado = false;
    renderizar();
  });
}

export function ir(rota) {
  if (location.hash === rota) atualizar();
  else location.hash = rota;
}

export function rotaAtual() {
  const bruto = location.hash.replace(/^#/, '') || '/';
  const [caminho, busca = ''] = bruto.split('?');
  const partes = caminho.split('/').filter(Boolean).map(decodeURIComponent);
  const query = Object.fromEntries(new URLSearchParams(busca));
  return { caminho, partes, query };
}

export function definirQuery(parcial) {
  const { caminho, query } = rotaAtual();
  const nova = { ...query, ...parcial };
  for (const k of Object.keys(nova)) if (nova[k] === '' || nova[k] == null) delete nova[k];
  const qs = new URLSearchParams(nova).toString();
  history.replaceState(null, '', `#${caminho}${qs ? '?' + qs : ''}`);
  atualizar();
}
