// ===================================================================
//  Configuração do banco de dados (SharePoint)
// -------------------------------------------------------------------
//  Deixe em branco para usar o modo local (dados só no navegador).
//  Para a equipe toda usar o SharePoint, preencha os três campos
//  depois de registrar o aplicativo no Microsoft Entra ID.
//  Passo a passo completo: arquivo SHAREPOINT.md
// ===================================================================
window.CRONO_CONFIG = {
  sharepoint: {
    // ID do aplicativo (cliente) — Entra ID › Registros de aplicativo › Visão geral
    clientId: '',
    // ID do diretório (locatário) da empresa
    tenantId: '',
    // Endereço do site do SharePoint onde ficarão as listas
    // ex.: 'https://suaempresa.sharepoint.com/sites/Cronoanalise'
    siteUrl: '',
  },
};
