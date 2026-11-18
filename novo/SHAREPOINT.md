# Conectar a Cronoanálise ao SharePoint

O site funciona sozinho no **modo local** (dados guardados só no navegador). Para a equipe toda
compartilhar os mesmos dados, conecte-o a um site do **SharePoint Online**. Os dados ficam em
listas do SharePoint e cada pessoa entra com a **conta Microsoft da empresa** — isso também
substitui a senha fixa do site antigo.

> Tempo estimado: 20 minutos. Os passos 1 e 2 podem exigir alguém de TI (administrador do
> Microsoft 365), dependendo das políticas da empresa.

---

## Como funciona

```
Navegador (site no GitHub Pages)
   │  login Microsoft (MSAL) — conta da empresa
   ▼
Microsoft Graph API  ──►  Site do SharePoint  ──►  7 listas:
                                                  Crono_Areas, Crono_Setores, Crono_Atividades,
                                                  Crono_Medicoes, Crono_Paradas, Crono_Fluxos, Crono_Config
```

- **Offline primeiro:** tudo é salvo na hora no aparelho (IndexedDB) e enviado ao SharePoint em
  segundo plano. Sem internet, o cronômetro continua funcionando; as medições sobem quando a
  conexão voltar (o indicador no canto mostra "X alterações aguardando").
- **Sincronização:** a cada 45 s, ao voltar para a aba e após cada alteração.
- **Permissões:** cada pessoa só lê/grava se tiver acesso ao site do SharePoint.

---

## 1. Criar (ou escolher) o site do SharePoint

1. Acesse o SharePoint da empresa e crie um **site de equipe**, por exemplo `Cronoanalise`.
2. Anote o endereço, por exemplo: `https://suaempresa.sharepoint.com/sites/Cronoanalise`
3. Em **Configurações › Permissões do site**, dê permissão de **Edição** (Membros) a quem vai
   cronometrar ou cadastrar, e de **Leitura** (Visitantes) a quem só vai consultar.

## 2. Registrar o aplicativo no Microsoft Entra ID

1. Acesse <https://entra.microsoft.com> › **Aplicativos** › **Registros de aplicativo** › **Novo registro**.
2. **Nome:** `Cronoanálise`
3. **Tipos de conta com suporte:** *Contas somente neste diretório organizacional (locatário único)*.
4. **URI de redirecionamento:** plataforma **Aplicativo de página única (SPA)** com o endereço:
   ```
   https://SEU-USUARIO.github.io/SEU-REPOSITORIO/redirect.html
   ```
   (O endereço exato aparece no site em **Configurações › Banco de dados** — basta copiar.)
   Se for testar em outro endereço (ex.: uma pasta `novo/`), adicione também esse URI.
5. Clique em **Registrar** e copie da tela **Visão geral**:
   - **ID do aplicativo (cliente)** → `clientId`
   - **ID do diretório (locatário)** → `tenantId`
6. Em **Permissões de API** › **Adicionar uma permissão** › **Microsoft Graph** › **Permissões delegadas**, adicione:

   | Permissão | Para quê |
   |---|---|
   | `User.Read` | Mostrar o nome de quem está logado (já vem por padrão) |
   | `Sites.ReadWrite.All` | Ler e gravar os itens das listas |
   | `Sites.Manage.All` | *Opcional:* deixar o próprio site criar as 7 listas automaticamente |

7. Se a empresa não permite que usuários deem consentimento, um administrador deve clicar em
   **Conceder consentimento do administrador**.

> **Segurança:** as permissões são *delegadas* — o aplicativo nunca acessa mais do que a própria
> pessoa logada já pode acessar no SharePoint. Não há senha nem segredo guardado no código.
> Se a TI preferir restringir a um único site, use a permissão `Sites.Selected` e peça ao
> administrador para liberar apenas o site da Cronoanálise.

## 3. Configurar o site

Edite o arquivo **`config.js`** do repositório:

```js
window.CRONO_CONFIG = {
  sharepoint: {
    clientId: 'cole-aqui-o-id-do-aplicativo',
    tenantId: 'cole-aqui-o-id-do-diretorio',
    siteUrl: 'https://suaempresa.sharepoint.com/sites/Cronoanalise',
  },
};
```

Faça o commit. (Para apenas testar, você também pode colar esses dados em
**Configurações › Banco de dados › Conectar ao SharePoint**, que vale só para o seu navegador.)

## 4. Primeiro acesso

1. Abra o site e vá em **Configurações › Banco de dados** › **Entrar com a conta Microsoft**.
2. Se aparecer *"Faltam N listas no site"*, clique em **Criar listas agora** (requer `Sites.Manage.All`).
   Sem essa permissão, crie as listas manualmente (veja abaixo).
3. Se você já tinha dados no modo local (ou carregou o exemplo), o site oferece
   **Enviar para o SharePoint**.
4. Para trazer o histórico do sistema antigo: **Configurações › Importar e exportar** ›
   *Importar do Apps Script* ou *Importar planilha (.xlsx)*. Os dados vão direto para o SharePoint.

### Criar as listas manualmente (se necessário)

Crie 7 listas em branco com estes nomes exatos: `Crono_Areas`, `Crono_Setores`, `Crono_Atividades`,
`Crono_Medicoes`, `Crono_Paradas`, `Crono_Fluxos`, `Crono_Config`. Em **todas**, adicione as colunas:

| Coluna | Tipo | Observação |
|---|---|---|
| `Chave` | Uma linha de texto | Indexe em *Configurações da lista › Colunas indexadas* |
| `Pai` | Uma linha de texto | Indexe também |
| `Dados` | Várias linhas de texto (texto sem formatação) | Não edite manualmente |

Na lista `Crono_Medicoes`, adicione também: `DataHora` (Data e hora), `TempoSeg` (Número) e
`Operador` (Uma linha de texto) — úteis para relatórios no Excel ou Power BI direto da lista.

---

## Perguntas frequentes

**O login abre uma janela e fecha sem entrar.** Verifique se o URI de redirecionamento cadastrado
no Entra ID é exatamente o mostrado em *Configurações › Banco de dados* (incluindo `/redirect.html`)
e se está na plataforma **Aplicativo de página única**. Libere pop-ups para o site.

**"Precisa da aprovação do administrador".** A política da empresa bloqueia o consentimento do
usuário: peça à TI para *Conceder consentimento do administrador* (passo 2.7).

**Posso usar o site dentro do Teams ou do Google Sites?** Pode, mas o login funciona melhor com o
site aberto em uma aba própria — o botão **Nova aba** aparece automaticamente quando ele está embutido.

**Dois cronometristas editaram a mesma atividade ao mesmo tempo.** Vale a última gravação.
Medições nunca conflitam (cada uma é um item separado).

**Quantas medições cabem?** Uma lista do SharePoint suporta milhões de itens. O site baixa só o
que mudou desde a última sincronização.
