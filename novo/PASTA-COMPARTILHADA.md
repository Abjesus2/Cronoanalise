# Salvar os dados numa pasta compartilhada (Excel) — sem precisar de TI

Com esta opção, o site grava tudo em **arquivos Excel (.xlsx)** dentro de uma pasta que a equipe
compartilha. Não precisa de administrador, de registro de aplicativo nem de senha extra: vale o
acesso que você já tem à pasta.

A pasta pode ser:

| Onde | Como deixar a pasta disponível no computador |
|---|---|
| **SharePoint** (site da equipe) | Abra a biblioteca de documentos no navegador e clique em **Sincronizar** ou em **Adicionar atalho a Meus arquivos**. A pasta aparece no Explorador de Arquivos, dentro do OneDrive da empresa. |
| **OneDrive** | Use uma pasta do seu OneDrive e compartilhe com a equipe (cada pessoa clica em *Adicionar atalho a Meus arquivos*). |
| **Rede local** | Uma pasta do servidor, por exemplo `\\servidor\Processos\Cronoanalise`. Se ela não aparecer na hora de escolher, mapeie como unidade de rede (ex.: `Z:`). |

> Funciona no **Google Chrome** ou no **Microsoft Edge** do computador.

---

## Passo a passo (cada pessoa faz uma vez)

1. Deixe a pasta disponível no computador (tabela acima). Sugestão de nome: **Cronoanalise-Dados**.
2. Abra o site › **Configurações** › **Banco de dados**.
3. Clique em **Escolher pasta**, selecione a pasta e clique em **Permitir**/**Ver arquivos** → **Salvar alterações**.
4. Informe seu nome (ele identifica o seu arquivo).
5. Pronto. A barra lateral mostra **Pasta: Cronoanalise-Dados · Sincronizado**.

**Todos da equipe escolhem a mesma pasta.**

## O que aparece na pasta

```
Cronoanalise-Dados/
├─ Cronoanalise - Ana Souza (a1b2).xlsx     ← dados gravados pela Ana
├─ Cronoanalise - Bruno Lima (c3d4).xlsx    ← dados gravados pelo Bruno
└─ Cronoanalise - Consolidado.xlsx          ← tudo junto + produtividade calculada (para abrir no Excel)
```

- Cada pessoa/computador grava **somente o próprio arquivo**. O site lê os arquivos de todos e
  junta: em cada registro vale a alteração mais recente; exclusões são respeitadas.
  Assim ninguém sobrescreve o arquivo de outra pessoa e o OneDrive não cria cópias de conflito.
- O **Consolidado** é atualizado automaticamente (no máximo a cada 5 minutos) ou pelo botão
  *Atualizar Excel consolidado*. Ele tem as abas Produtividade, Setores, Áreas, Medições,
  Paradas e Parâmetros — use-o para relatórios, Power BI etc.
- **Não edite os arquivos de dados à mão** (o site lê a coluna técnica `_dados`). Para corrigir
  algo, use o site. O Consolidado pode ser aberto à vontade.

## No dia a dia

- **Ao abrir o site** em outro dia, o navegador pode pedir a autorização de novo: clique em
  **Reconectar pasta** no aviso do topo. (No Chrome/Edge você pode escolher *Permitir sempre*.)
- **Sem internet ou sem a pasta:** continue cronometrando — tudo fica guardado no computador e é
  gravado na pasta assim que ela estiver disponível de novo.
- **Arquivo aberto no Excel:** se você abrir o *seu* arquivo de dados no Excel, o site não consegue
  gravar até você fechá-lo (aparece um aviso).
- **Sincronização:** a cada 45 segundos, ao voltar para a aba e logo após cada alteração. Com
  pastas do SharePoint/OneDrive, considere também o tempo do OneDrive enviar o arquivo
  (normalmente alguns segundos).

## E no celular?

Navegadores de celular não permitem escolher pastas. No celular, cronometre normalmente e
depois use **Configurações › Importar e exportar › Baixar backup**. No computador conectado à
pasta, use **Restaurar backup › Mesclar com os atuais** — as medições entram no arquivo dessa pessoa.

## Trazer os dados do sistema antigo

Conecte a pasta primeiro e depois use **Configurações › Importar e exportar** (*Importar do Apps
Script* ou *Importar planilha .xlsx*). Os dados importados vão para o seu arquivo e ficam
visíveis para toda a equipe.
