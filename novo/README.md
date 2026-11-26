# Cronoanálise — Métodos & Processos (v2)

Sistema web para cronometrar atividades e transformar as medições em **tempo padrão** e
**produtividade** — por minuto, hora, dia, semana, mês e ano — individualmente (por atividade e
por operador) e agrupada (por setor, por operação e na empresa toda).

Refeito do zero a partir das funções do site anterior, seguindo a metodologia do
*Treinamento de Métodos & Processos* (10 passos do tempo padrão).

---

## Publicar no GitHub Pages

O site é estático (HTML + CSS + JavaScript, sem etapa de build). Basta copiar o conteúdo desta
pasta para o repositório.

**Para testar sem desligar o site atual:**

1. No repositório, crie uma pasta `novo/` e copie para dentro dela **todo o conteúdo** desta pasta
   (`index.html`, `config.js`, `redirect.html`, `sw.js`, `manifest.webmanifest`, pasta `assets/`).
2. Faça o commit. O novo site fica em `https://SEU-USUARIO.github.io/SEU-REPOSITORIO/novo/`.
3. Quando estiver satisfeito, mova os arquivos para a raiz (substituindo o `index.html` antigo).
   Se usar SharePoint, atualize o URI de redirecionamento no Entra ID para o novo endereço.

Para rodar localmente basta qualquer servidor estático na pasta (ex.: `python -m http.server`).

## Banco de dados

| Modo | Onde ficam os dados | Quando usar |
|---|---|---|
| **Local** (padrão) | Só no navegador (IndexedDB) | Testes, uso individual |
| **Pasta compartilhada** ⭐ | Arquivos **Excel** numa pasta do SharePoint sincronizada, do OneDrive ou da rede | Uso em equipe **sem precisar de TI** — veja **[PASTA-COMPARTILHADA.md](PASTA-COMPARTILHADA.md)** |
| **SharePoint direto** | Listas de um site do SharePoint, via Microsoft Graph | Exige registro de aplicativo pela TI — veja [SHAREPOINT.md](SHAREPOINT.md) |

Em todos os modos o sistema funciona **offline** e sincroniza quando a pasta/conexão volta.

## Trazer os dados do sistema antigo

Em **Configurações › Importar e exportar**:

- **Importar do Apps Script** — lê direto da planilha Google usada pelo site atual.
- **Importar planilha (.xlsx)** — usa a exportação em Excel do sistema antigo
  (abas *Medições* e *Descrição Atividades*). O sistema descobre sozinho a quantidade-base de cada
  atividade (volumes, paletes, peças, itens, pedidos…) conferindo com o "Tempo por Unidade"
  exportado, e identifica o campo de pessoas.

Importar mais de uma vez não duplica registros. Para manter os números do sistema antigo, as
atividades importadas entram com ritmo 100% e tolerância 0%; ajuste depois em *Método e cálculo*.

---

## Funções: site antigo → site novo

| Site antigo | Site novo |
|---|---|
| Senha fixa no código | Login Microsoft da empresa (modo SharePoint) |
| Planilha Google via Apps Script (lenta, com tempo limite) | SharePoint via Microsoft Graph, offline primeiro, sincronização em segundo plano |
| Operações → Setores → Atividades, sequência, exclusão em lote, mover | Estrutura com árvore lateral, cartões com métricas agregadas, código 1.4.2, seleção em lote (excluir, mover, duplicar) |
| Cadastro da atividade: descrição, critérios, considerações, 8 parâmetros, campo de ritmo, paradas | Igual, sem limite de parâmetros (número, texto ou lista), quantidade fixa (frequência lógica) ou informada, pessoas na medição, ritmo Westinghouse, tabela de tolerâncias |
| Cronômetro: iniciar/zerar/salvar e próximo, anomalia, observação fixável | Leitura contínua (registra e já inicia o próximo), pausa, descartar, desfazer, campos fixáveis, atalhos de teclado, tela sempre ligada, sobrevive a recarregar a página, funciona sem internet |
| Adicionar/editar/excluir/mover medição | Igual + incluir/excluir do cálculo (nivelamento manual) |
| Paradas programadas e motivos de anomalia | Paradas por jornada (viram tolerância) ou por ciclo; motivos podem tirar a medição do cálculo |
| Dashboard: total, médio, padrão, mínimo, desvio, CV, 4 gráficos, resumo | Produtividade: visão geral, por atividade, por setor/operação, por operador e planejamento; gráfico de controle, histograma, tendência; tabela equivalente em cada gráfico |
| Capacidade por hora | Produtividade por minuto, hora, dia, semana, mês e ano — por pessoa, equipe ou planejada |
| Um único conjunto de parâmetros gerais | **Vários conjuntos de parâmetros gerais** (jornada, dias úteis, meta de eficiência, tolerância, confiança, nivelamento): cada operação escolhe o seu e um setor pode herdar ou usar outro |
| — | Confiabilidade da amostra (nº de ciclos necessários), gargalo, balanceamento, takt time, pessoas necessárias, eficiência (EF%) e produção do dia |
| Fluxograma com versões editáveis no navegador | Fluxograma automático com tempos e gargalo; versões editáveis salvas no banco (compartilhadas), exportação SVG/PNG/PDF/JSON |
| Exportar CSV/Excel/DOCX | Excel com 6 abas, CSV, relatório PDF e Word, backup completo (.json) |
| Formato e precisão do tempo, modo escuro | Relógio, segundos ou **minutos centesimais**; 0 a 3 casas; tema claro/escuro/automático; modo simples/avançado |
| Notificações / histórico | Histórico de alterações + indicador de sincronização |
| — | Busca global (Ctrl+K), guia da metodologia, ajuda "?" em cada indicador, instalável no celular (PWA) |

## Como o tempo padrão é calculado

Para cada medição: **tempo por unidade = tempo × pessoas ÷ quantidade**.

1. **Nivelamento** — medições fora de média ± 2σ (ou dos quartis) saem do cálculo; motivos marcados também.
2. **Tempo base** — média ponderada pela quantidade: Σ(tempo × pessoas) ÷ Σ quantidades
   (opção de média simples em *Configurações*, igual ao sistema antigo).
3. **Tempo normal** = tempo base × ritmo (percentual ou Westinghouse Habilidade + Esforço).
4. **Tempo padrão** = tempo normal × (1 + tolerância + paradas por jornada) + paradas por ciclo.
5. **Produtividade** = período ÷ tempo padrão (jornada, dias úteis por semana/mês/ano configuráveis).
6. **Nº de ciclos** = (Z × R ÷ (Er × d₂ × x̄))² até 10 medições, ou (Z × s ÷ (Er × x̄))² acima.
7. **Agrupado** — tempo padrão total (soma), capacidade do fluxo pelo gargalo, balanceamento.
   Só é calculado quando as atividades do grupo usam a mesma unidade.

## Estrutura dos arquivos

```
index.html            página única
config.js             configuração do SharePoint (editar)
redirect.html         retorno do login Microsoft
sw.js                 funcionamento offline
manifest.webmanifest  instalação no celular
assets/css/app.css    design system (tema claro/escuro, animações)
assets/js/
  main.js             casca, rotas, busca global
  lib.js              bibliotecas (lit-html, MSAL, SheetJS) via CDN com versão fixa
  core/               cálculos (calc.js), dados (store.js, db-local.js, sharepoint.js),
                      importação (legado.js), exportação (exportar.js), exemplo
  ui/                 componentes, gráficos, formulários, ajuda
  views/              telas: painel, estrutura, atividade, cronômetro, medições,
                      produtividade, fluxograma, cadastros, configurações, guia
```
