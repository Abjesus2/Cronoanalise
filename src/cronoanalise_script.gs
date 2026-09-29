var CRONO_HEADERS_CACHE_KEY_ = 'CRONO_HEADERS_READY_V6';
var CRONO_CONTAGENS_HEADERS_CACHE_KEY_ = 'CRONO_CONTAGENS_HEADERS_READY_V1';
var CRONO_PARADAS_HEADERS_CACHE_KEY_ = 'CRONO_PARADAS_HEADERS_READY_V1';
var CRONO_DATA_VERSION_CACHE_KEY_ = 'CRONO_DATA_VERSION_CACHE_V1';
var CRONO_OPERATION_CACHE_PREFIX_ = 'CRONO_OPERATION_V2_';
var CRONO_SHEET_META_RUNTIME_CACHE_ = {};
// Leituras apenas verificam o bloqueio antes e depois de consultar as abas.
// Uma pequena espera evita que o primeiro carregamento seja recusado durante
// uma gravação breve, sem manter o bloqueio enquanto as abas são percorridas.
var CRONO_READ_LOCK_TIMEOUT_MS_ = 1200;
var CRONO_WRITE_LOCK_TIMEOUT_MS_ = 30000;
var CRONO_BATCH_MAX_ITEMS_ = 25;

// Métricas leves exibidas no histórico de execuções do Apps Script. Elas não
// escrevem na planilha e permitem separar demora de rede, espera pelo bloqueio
// e tempo efetivo de gravação.
function createWriteTrace_(action, requestId) {
  return {
    action: String(action || ''),
    requestId: String(requestId || ''),
    startedAt: Date.now(),
    lockRequestedAt: 0,
    lockAcquiredAt: 0,
    lockReleasedAt: 0
  };
}

function finishWriteTrace_(trace, result) {
  if (!trace) return null;
  var finishedAt = Date.now();
  var performance = {
    totalMs: finishedAt - trace.startedAt,
    lockWaitMs: trace.lockAcquiredAt && trace.lockRequestedAt
      ? trace.lockAcquiredAt - trace.lockRequestedAt
      : 0,
    lockedMs: trace.lockReleasedAt && trace.lockAcquiredAt
      ? trace.lockReleasedAt - trace.lockAcquiredAt
      : 0
  };
  try {
    console.log(JSON.stringify({
      event: 'crono_write_performance',
      action: trace.action,
      requestId: trace.requestId,
      status: result && result.status ? result.status : 'unknown',
      totalMs: performance.totalMs,
      lockWaitMs: performance.lockWaitMs,
      lockedMs: performance.lockedMs
    }));
  } catch (error) {}
  return performance;
}

function getScriptCacheSafe_() {
  try {
    return CacheService.getScriptCache();
  } catch (error) {
    return null;
  }
}

function invalidateHeaderCache_() {
  var cache = getScriptCacheSafe_();
  if (cache) {
    cache.remove(CRONO_HEADERS_CACHE_KEY_);
    cache.remove(CRONO_CONTAGENS_HEADERS_CACHE_KEY_);
    cache.remove(CRONO_PARADAS_HEADERS_CACHE_KEY_);
  }
  CRONO_SHEET_META_RUNTIME_CACHE_ = {};
}

function doGet(e) {
  if (e && e.parameter && e.parameter.action) {
    try {
      return handleGet(e);
    } catch (error) {
      return jsonOutput_({
        status: 'error',
        verified: false,
        message: error && error.message ? error.message : String(error),
        serverReadAt: Date.now()
      });
    }
  }
  // Este projeto funciona como API para o HTML externo. Retornar um estado
  // próprio evita depender de um arquivo Index que não existe no projeto.
  return jsonOutput_({
    status: 'online',
    service: 'Cronoanalise',
    version: getDataVersion_(),
    serverReadAt: Date.now()
  });
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

// Garante os cabeçalhos sem reescrever a planilha em toda leitura.
function ensureHeaders(ss) {
  var cache = getScriptCacheSafe_();
  if (cache && cache.get(CRONO_HEADERS_CACHE_KEY_) === '1') {
    var requiredSheets = ['Analises', 'Contagens', 'ParadasCadastradas', 'Areas', 'Setores'];
    var allSheetsExist = requiredSheets.every(function(sheetName) {
      return Boolean(ss.getSheetByName(sheetName));
    });
    if (allSheetsExist) return;
    cache.remove(CRONO_HEADERS_CACHE_KEY_);
  }

  var headersAnalises = ['ID_Analise', 'Area', 'Setor', 'Atividade', 'Paradas_Aplicaveis', 'Campo_Ritmo', 'Campo_1_Nome', 'Campo_1_Tipo', 'Campo_2_Nome', 'Campo_2_Tipo', 'Campo_3_Nome', 'Campo_3_Tipo', 'Campo_4_Nome', 'Campo_4_Tipo', 'Campo_5_Nome', 'Campo_5_Tipo', 'Campo_6_Nome', 'Campo_6_Tipo', 'Campo_7_Nome', 'Campo_7_Tipo', 'Campo_8_Nome', 'Campo_8_Tipo', 'Descricao_Atividade', 'Sequencia_Area', 'Sequencia_Setor', 'Sequencia_Atividade', 'Data_Criacao', 'Data_Ultima_Modificacao', 'Consideracoes_Atividade', 'Criterios_Medicao'];
  var headersContagens = ['ID_Contagem', 'ID_Analise', 'Data_Hora', 'Tempo_Total', 'Observacoes', 'Campo_1_Valor', 'Campo_2_Valor', 'Campo_3_Valor', 'Campo_4_Valor', 'Campo_5_Valor', 'Campo_6_Valor', 'Campo_7_Valor', 'Campo_8_Valor', 'Data_Ultima_Modificacao'];
  var headersParadas = ['ID_Parada', 'Nome', 'Tipo', 'Tempo_Formatado', 'Data_Criacao', 'Data_Ultima_Modificacao'];
  var headersAreas = ['ID_Area', 'Nome', 'Sequencia', 'Data_Criacao', 'Data_Ultima_Modificacao'];
  var headersSetores = ['ID_Setor', 'ID_Area', 'Nome', 'Sequencia', 'Data_Criacao', 'Data_Ultima_Modificacao'];

  ensureSheetHeaders_(ss, 'Analises', headersAnalises);
  ensureSheetHeaders_(ss, 'Contagens', headersContagens);
  ensureSheetHeaders_(ss, 'ParadasCadastradas', headersParadas);
  ensureSheetHeaders_(ss, 'Areas', headersAreas);
  ensureSheetHeaders_(ss, 'Setores', headersSetores);
  var properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('CRONO_TIMESTAMPS_MIGRATED_V1') !== '1') {
    initializeTimestampColumns_(ss);
    properties.setProperty('CRONO_TIMESTAMPS_MIGRATED_V1', '1');
  }
  if (properties.getProperty('CRONO_HIERARCHY_MIGRATED') !== '1') {
    ensureEntityRegistries_(ss);
    properties.setProperty('CRONO_HIERARCHY_MIGRATED', '1');
  }
  if (properties.getProperty('CRONO_DYNAMIC_SEQUENCE_MIGRATED_V1') !== '1') {
    normalizeAllDynamicSequences_(ss);
    properties.setProperty('CRONO_DYNAMIC_SEQUENCE_MIGRATED_V1', '1');
    bumpDataVersion_();
  }
  if (cache) cache.put(CRONO_HEADERS_CACHE_KEY_, '1', 300);
}

// O salvamento de medições é o caminho mais frequente do aplicativo. Esta
// verificação restrita evita conferir e migrar todas as demais abas a cada
// nova cronoanálise, sem abrir mão dos cabeçalhos obrigatórios de Contagens.
function ensureContagensReady_(ss) {
  var cache = getScriptCacheSafe_();
  var sheet = ss.getSheetByName('Contagens');
  if (sheet && cache && cache.get(CRONO_CONTAGENS_HEADERS_CACHE_KEY_) === '1') {
    return sheet;
  }

  sheet = ensureSheetHeaders_(ss, 'Contagens', [
    'ID_Contagem', 'ID_Analise', 'Data_Hora', 'Tempo_Total', 'Observacoes',
    'Campo_1_Valor', 'Campo_2_Valor', 'Campo_3_Valor', 'Campo_4_Valor',
    'Campo_5_Valor', 'Campo_6_Valor', 'Campo_7_Valor', 'Campo_8_Valor',
    'Data_Ultima_Modificacao'
  ]);
  if (cache) cache.put(CRONO_CONTAGENS_HEADERS_CACHE_KEY_, '1', 300);
  return sheet;
}

function ensureParadasReady_(ss) {
  var cache = getScriptCacheSafe_();
  var sheet = ss.getSheetByName('ParadasCadastradas');
  if (sheet && cache && cache.get(CRONO_PARADAS_HEADERS_CACHE_KEY_) === '1') {
    return sheet;
  }
  sheet = ensureSheetHeaders_(ss, 'ParadasCadastradas', [
    'ID_Parada', 'Nome', 'Tipo', 'Tempo_Formatado',
    'Data_Criacao', 'Data_Ultima_Modificacao'
  ]);
  if (cache) cache.put(CRONO_PARADAS_HEADERS_CACHE_KEY_, '1', 300);
  return sheet;
}

function ensureWriteActionReady_(ss, action) {
  if (action === 'editContagem' || action === 'deleteContagem' ||
      action === 'deleteMultipleContagens' || action === 'moveMultipleContagens') {
    ensureContagensReady_(ss);
    return;
  }
  if (action === 'addCadParada' || action === 'editCadParada' ||
      action === 'deleteCadParada') {
    ensureParadasReady_(ss);
    return;
  }
  ensureHeaders(ss);
}

function getTimestampSheetConfigs_() {
  return [
    { sheetName: 'Areas', idHeader: 'ID_Area', creationHeader: 'Data_Criacao' },
    { sheetName: 'Setores', idHeader: 'ID_Setor', creationHeader: 'Data_Criacao' },
    { sheetName: 'Analises', idHeader: 'ID_Analise', creationHeader: 'Data_Criacao' },
    { sheetName: 'Contagens', idHeader: 'ID_Contagem', existingCreationHeader: 'Data_Hora' },
    { sheetName: 'ParadasCadastradas', idHeader: 'ID_Parada', creationHeader: 'Data_Criacao' }
  ];
}

function inferTimestampFromId_(value) {
  var match = String(value == null ? '' : value).match(/(?:^|_)(\d{13})(?:_|$)/);
  if (!match) return null;
  var timestamp = Number(match[1]);
  var date = new Date(timestamp);
  return isNaN(date.getTime()) ? null : date;
}

function parseTimestampValue_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (typeof value === 'number' && isFinite(value)) {
    var numericDate = new Date(value);
    if (!isNaN(numericDate.getTime())) return numericDate;
  }
  var text = String(value == null ? '' : value).trim();
  if (!text) return null;
  var br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (br) {
    var brDate = new Date(
      Number(br[3]), Number(br[2]) - 1, Number(br[1]),
      Number(br[4] || 0), Number(br[5] || 0), Number(br[6] || 0)
    );
    return isNaN(brDate.getTime()) ? null : brDate;
  }
  var parsed = new Date(text);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function formatTimestampColumns_(sheet, headers) {
  var timestampHeaders = ['Data_Criacao', 'Data_Ultima_Modificacao'];
  timestampHeaders.forEach(function(header) {
    var index = headers.indexOf(header);
    if (index !== -1 && sheet.getMaxRows() > 1) {
      sheet.getRange(2, index + 1, sheet.getMaxRows() - 1, 1)
        .setNumberFormat('dd/MM/yyyy HH:mm:ss');
    }
  });
}

// Preenche somente datas ausentes. Para registros antigos sem data disponível,
// usa o horário recuperável do ID e, como último recurso, o horário da migração.
function initializeTimestampColumns_(ss) {
  var migrationTime = new Date();
  getTimestampSheetConfigs_().forEach(function(config) {
    var sheet = ss.getSheetByName(config.sheetName);
    if (!sheet || sheet.getLastColumn() < 1) return;
    var lastColumn = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
    formatTimestampColumns_(sheet, headers);
    if (sheet.getLastRow() < 2) return;

    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastColumn).getValues();
    var idIndex = headers.indexOf(config.idHeader);
    var creationIndex = config.creationHeader ? headers.indexOf(config.creationHeader) : -1;
    var existingCreationIndex = config.existingCreationHeader
      ? headers.indexOf(config.existingCreationHeader)
      : -1;
    var modifiedIndex = headers.indexOf('Data_Ultima_Modificacao');
    if (modifiedIndex === -1) return;

    var creationValues = [];
    var modifiedValues = [];
    values.forEach(function(row) {
      var existingCreation = creationIndex !== -1 ? parseTimestampValue_(row[creationIndex]) : null;
      var sourceCreation = existingCreationIndex !== -1
        ? parseTimestampValue_(row[existingCreationIndex])
        : null;
      var inferredCreation = idIndex !== -1 ? inferTimestampFromId_(row[idIndex]) : null;
      var creation = existingCreation || sourceCreation || inferredCreation || migrationTime;
      var modified = parseTimestampValue_(row[modifiedIndex]) || creation;
      if (creationIndex !== -1) creationValues.push([creation]);
      modifiedValues.push([modified]);
    });

    if (creationIndex !== -1) {
      sheet.getRange(2, creationIndex + 1, creationValues.length, 1).setValues(creationValues);
    }
    sheet.getRange(2, modifiedIndex + 1, modifiedValues.length, 1).setValues(modifiedValues);
  });
}

function migrarColunasDatas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureHeaders(ss);
  initializeTimestampColumns_(ss);
  PropertiesService.getScriptProperties().setProperty('CRONO_TIMESTAMPS_MIGRATED_V1', '1');
  SpreadsheetApp.flush();
  bumpDataVersion_();
  return {
    status: 'success',
    observacao: 'As novas colunas foram acrescentadas no fim das abas sem mover dados existentes.'
  };
}

function ensureSheetHeaders_(ss, sheetName, expectedHeaders) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    delete CRONO_SHEET_META_RUNTIME_CACHE_[sheetName];
  }

  var lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    delete CRONO_SHEET_META_RUNTIME_CACHE_[sheetName];
    return sheet;
  }

  var currentHeaders = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
    .map(function(header) { return String(header || '').trim(); });
  var missingHeaders = expectedHeaders.filter(function(header) {
    return currentHeaders.indexOf(header) === -1;
  });

  if (missingHeaders.length > 0) {
    sheet.getRange(1, lastColumn + 1, 1, missingHeaders.length).setValues([missingHeaders]);
    delete CRONO_SHEET_META_RUNTIME_CACHE_[sheetName];
  }
  return sheet;
}

function normalizeEntityName_(value) {
  return String(value == null ? '' : value)
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

function safeSequence_(value) {
  try {
    return normalizeSequence_(value);
  } catch (error) {
    return '';
  }
}

function requireNewSequence_(value, label) {
  var sequence = normalizeSequence_(value);
  if (!sequence) {
    throw new Error(label + ' é obrigatória para um novo cadastro.');
  }
  return sequence;
}

// Compara a estrutura de campos personalizados (Campo_1..8, nome e tipo) de duas
// atividades. Usada para permitir mover Contagens só entre atividades compatíveis,
// já que cada campo (Campo_1_Valor etc.) só faz sentido no contexto do seu próprio nome/tipo.
function mesmaEstruturaCampos_(analiseA, analiseB) {
  for (var i = 1; i <= 8; i++) {
    var nomeA = String(analiseA['Campo_' + i + '_Nome'] || '').trim();
    var nomeB = String(analiseB['Campo_' + i + '_Nome'] || '').trim();
    var tipoA = String(analiseA['Campo_' + i + '_Tipo'] || '').trim();
    var tipoB = String(analiseB['Campo_' + i + '_Tipo'] || '').trim();
    if (nomeA !== nomeB || tipoA !== tipoB) return false;
  }
  return true;
}

function canonicalizeParameterNames_(ss, data) {
  var canonicalNames = {};
  var registeredAnalyses = getDataFromSheet(ss, 'Analises');
  registeredAnalyses.forEach(function(record) {
    for (var i = 1; i <= 8; i++) {
      var registeredName = String(record['Campo_' + i + '_Nome'] || '').trim();
      var registeredKey = normalizeEntityName_(registeredName);
      if (registeredKey && !canonicalNames[registeredKey]) {
        canonicalNames[registeredKey] = registeredName;
      }
    }
  });

  for (var index = 1; index <= 8; index++) {
    var property = 'c' + index;
    var providedName = String(data[property] || '').trim();
    var providedKey = normalizeEntityName_(providedName);
    if (!providedKey) {
      data[property] = '';
      continue;
    }
    if (canonicalNames[providedKey]) {
      data[property] = canonicalNames[providedKey];
    } else {
      canonicalNames[providedKey] = providedName;
      data[property] = providedName;
    }
  }
  return registeredAnalyses;
}

// Evita reorganizar toda a aba quando uma nova Atividade já está entrando na
// próxima posição livre ou quando uma repetição idempotente já está correta.
function canSkipActivitySequenceReorder_(
  registeredAnalyses,
  action,
  previousAnalysis,
  area,
  setor,
  targetId,
  targetSequence
) {
  var normalizedTarget = normalizeSequence_(targetSequence);
  var existingTarget = registeredAnalyses.find(function(record) {
    return String(record.ID_Analise) === String(targetId);
  });
  if (existingTarget) {
    return String(existingTarget.Area) === String(area) &&
      String(existingTarget.Setor) === String(setor) &&
      safeSequence_(existingTarget.Sequencia_Atividade) === normalizedTarget;
  }

  if (action === 'editAnalise' && previousAnalysis) {
    return String(previousAnalysis.Area) === String(area) &&
      String(previousAnalysis.Setor) === String(setor) &&
      safeSequence_(previousAnalysis.Sequencia_Atividade) === normalizedTarget;
  }
  if (action !== 'addAnalise') return false;

  var groupSequences = registeredAnalyses
    .filter(function(record) {
      return String(record.Area) === String(area) && String(record.Setor) === String(setor);
    })
    .map(function(record) { return sequenceNumberOrNull_(record.Sequencia_Atividade); })
    .filter(function(sequence) { return sequence != null; })
    .sort(function(a, b) { return a - b; });

  var isContiguous = groupSequences.every(function(sequence, index) {
    return sequence === index + 1;
  });
  return isContiguous && Number(normalizedTarget) === groupSequences.length + 1;
}

function createEntityId_(prefix) {
  var suffix = typeof Utilities !== 'undefined' && Utilities.getUuid
    ? Utilities.getUuid().replace(/-/g, '').slice(0, 16)
    : String(Date.now()) + '_' + Math.random().toString(36).slice(2, 8);
  return prefix + '_' + suffix;
}

// Cria os registros normalizados a partir das Cronoanálises existentes.
// A rotina é idempotente: nomes já cadastrados não são duplicados.
function ensureEntityRegistries_(ss) {
  var analyses = getDataFromSheet(ss, 'Analises');
  if (analyses.length === 0) return;

  var areas = getDataFromSheet(ss, 'Areas');
  var setores = getDataFromSheet(ss, 'Setores');
  var areasByName = {};
  var setoresByKey = {};

  areas.forEach(function(area) {
    var key = normalizeEntityName_(area.Nome);
    if (key && !areasByName[key]) areasByName[key] = area;
  });
  setores.forEach(function(setor) {
    var key = String(setor.ID_Area || '') + '|' + normalizeEntityName_(setor.Nome);
    if (setor.ID_Area && normalizeEntityName_(setor.Nome) && !setoresByKey[key]) {
      setoresByKey[key] = setor;
    }
  });

  analyses.forEach(function(analysis) {
    var areaName = String(analysis.Area || '').trim();
    var setorName = String(analysis.Setor || '').trim();
    if (!areaName) return;

    var areaKey = normalizeEntityName_(areaName);
    var area = areasByName[areaKey];
    if (!area) {
      area = {
        ID_Area: createEntityId_('AREA'),
        Nome: areaName,
        Sequencia: safeSequence_(analysis.Sequencia_Area)
      };
      writeFieldsByField_(ss, 'Areas', 'ID_Area', area.ID_Area, area, true);
      areasByName[areaKey] = area;
    }
    if (!setorName) return;

    var setorKey = area.ID_Area + '|' + normalizeEntityName_(setorName);
    if (!setoresByKey[setorKey]) {
      var setor = {
        ID_Setor: createEntityId_('SETOR'),
        ID_Area: area.ID_Area,
        Nome: setorName,
        Sequencia: safeSequence_(analysis.Sequencia_Setor)
      };
      writeFieldsByField_(ss, 'Setores', 'ID_Setor', setor.ID_Setor, setor, true);
      setoresByKey[setorKey] = setor;
    }
  });
}

// Pode ser executada manualmente uma vez no editor do Apps Script.
// Acrescenta somente os cabeçalhos ausentes, sempre depois da última coluna existente.
function migrarColunasSequencia() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureHeaders(ss);
  SpreadsheetApp.flush();

  var sheet = ss.getSheetByName('Analises');
  var lastColumn = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  var sequenceHeaders = ['Sequencia_Area', 'Sequencia_Setor', 'Sequencia_Atividade'];
  var positions = sequenceHeaders.map(function(header) {
    var index = headers.indexOf(header);
    if (index === -1) throw new Error('Não foi possível criar a coluna ' + header + '.');
    return index + 1;
  });

  bumpDataVersion_();
  return {
    status: 'success',
    sheet: 'Analises',
    headers: sequenceHeaders,
    columns: positions,
    lastColumn: lastColumn
  };
}

// Migra a hierarquia sem mover colunas nem reescrever os dados existentes.
// As novas colunas são acrescentadas no fim das respectivas abas.
function migrarEstruturaHierarquia() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureHeaders(ss);
  ensureEntityRegistries_(ss);
  PropertiesService.getScriptProperties().setProperty('CRONO_HIERARCHY_MIGRATED', '1');
  SpreadsheetApp.flush();
  bumpDataVersion_();
  return {
    status: 'success',
    areas: getDataFromSheet(ss, 'Areas').length,
    setores: getDataFromSheet(ss, 'Setores').length,
    colunasAnalises: ['Sequencia_Area', 'Sequencia_Setor', 'Sequencia_Atividade'],
    observacao: 'Nenhuma coluna existente foi movida ou sobrescrita.'
  };
}

function getInitialData() {
  return getFreshData('initial_' + Date.now());
}

function busyFreshData_(requestId) {
  return {
    status: 'busy',
    verified: false,
    retryAfterMs: 350,
    version: getDataVersion_(),
    serverReadAt: Date.now(),
    requestId: String(requestId || '')
  };
}

// Confere o bloqueio apenas em sondagens curtas, antes e depois da leitura.
// A versão é comparada nas duas pontas: se alguma gravação ocorrer durante a
// consulta, o HTML recebe "busy" e repete. A leitura completa deixa de impedir
// que outros usuários salvem medições enquanto as cinco abas são percorridas.
function getFreshData(requestId) {
  var lock = LockService.getScriptLock();
  var lockObtido = lock.tryLock(CRONO_READ_LOCK_TIMEOUT_MS_);
  if (!lockObtido) return busyFreshData_(requestId);

  var dataVersionBefore;
  var ss;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureHeaders(ss);
    dataVersionBefore = getDataVersion_();
  } finally {
    lock.releaseLock();
  }

  var result = {
    areas: getDataFromSheet(ss, 'Areas'),
    setores: getDataFromSheet(ss, 'Setores'),
    analises: getDataFromSheet(ss, 'Analises'),
    contagens: getDataFromSheet(ss, 'Contagens'),
    paradas: getDataFromSheet(ss, 'ParadasCadastradas'),
    serverReadAt: Date.now(),
    requestId: String(requestId || '')
  };

  lockObtido = lock.tryLock(CRONO_READ_LOCK_TIMEOUT_MS_);
  if (!lockObtido) return busyFreshData_(requestId);

  try {
    var dataVersionAfter = getDataVersion_();
    if (String(dataVersionBefore) !== String(dataVersionAfter)) {
      return busyFreshData_(requestId);
    }
    result.version = dataVersionAfter;
    result.fingerprint = dataVersionAfter;
    return result;
  } finally {
    lock.releaseLock();
  }
}

function createDataFingerprint_(data) {
  var serialized = JSON.stringify([
    data.areas || [],
    data.setores || [],
    data.analises || [],
    data.contagens || [],
    data.paradas || []
  ]);
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    serialized,
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function getDataVersion() {
  return { version: getDataVersion_() };
}

function getDataVersion_() {
  var cache = getScriptCacheSafe_();
  var cachedVersion = cache ? cache.get(CRONO_DATA_VERSION_CACHE_KEY_) : null;
  if (cachedVersion) return cachedVersion;

  var properties = PropertiesService.getScriptProperties();
  var version = properties.getProperty('CRONO_DATA_VERSION');
  if (!version) {
    version = String(Date.now());
    properties.setProperty('CRONO_DATA_VERSION', version);
  }
  if (cache) cache.put(CRONO_DATA_VERSION_CACHE_KEY_, version, 21600);
  return version;
}

function bumpDataVersion_() {
  var properties = PropertiesService.getScriptProperties();
  var currentVersion = parseInt(properties.getProperty('CRONO_DATA_VERSION') || '0', 10);
  var nextVersion = Math.max(Date.now(), currentVersion + 1);
  properties.setProperty('CRONO_DATA_VERSION', String(nextVersion));
  var cache = getScriptCacheSafe_();
  if (cache) cache.put(CRONO_DATA_VERSION_CACHE_KEY_, String(nextVersion), 21600);
  return String(nextVersion);
}

function operationCacheKey_(requestId) {
  var normalized = String(requestId == null ? '' : requestId).trim();
  if (!normalized) return '';
  return CRONO_OPERATION_CACHE_PREFIX_ + normalized
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    .slice(0, 180);
}

function readOperationStatus_(requestId) {
  var key = operationCacheKey_(requestId);
  var cache = getScriptCacheSafe_();
  if (!key || !cache) return null;
  var stored = cache.get(key);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch (error) {
    cache.remove(key);
    return null;
  }
}

function storeOperationStatus_(requestId, result) {
  var key = operationCacheKey_(requestId);
  var cache = getScriptCacheSafe_();
  if (!key || !cache || !result) return result;
  var payload = {};
  Object.keys(result).forEach(function(name) { payload[name] = result[name]; });
  payload.requestId = String(requestId || '');
  payload.confirmedAt = Date.now();
  cache.put(key, JSON.stringify(payload), 21600);
  return payload;
}

function getOperationStatus(requestId) {
  return readOperationStatus_(requestId) || {
    status: 'pending',
    verified: false,
    requestId: String(requestId || '')
  };
}

// Também detecta alterações feitas manualmente nas abas da planilha.
function onEdit(e) {
  if (!e || !e.range || !e.range.getSheet) return;
  var sheetName = e.range.getSheet().getName();
  if (['Areas', 'Setores', 'Analises', 'Contagens', 'ParadasCadastradas'].indexOf(sheetName) !== -1) {
    var lock = LockService.getScriptLock();
    var lockObtido = lock.tryLock(30000);
    try {
      if (!lockObtido) throw new Error('A edição manual aguardou outra gravação. Tente novamente.');
      if (e.range.getRow() === 1) invalidateHeaderCache_();
      stampManualEditTimestamps_(e);
      if (sheetName === 'Analises') {
        ensureEntityRegistries_(e.source || SpreadsheetApp.getActiveSpreadsheet());
      }
      if (manualEditTouchesSequence_(e)) {
        normalizeAllDynamicSequences_(e.source || SpreadsheetApp.getActiveSpreadsheet());
      }
      SpreadsheetApp.flush();
      bumpDataVersion_();
    } finally {
      if (lockObtido) lock.releaseLock();
    }
  }
}

function manualEditTouchesSequence_(e) {
  var sheet = e.range.getSheet();
  var sequenceHeaderBySheet = {
    Areas: 'Sequencia',
    Setores: 'Sequencia',
    Analises: 'Sequencia_Atividade'
  };
  var sequenceHeader = sequenceHeaderBySheet[sheet.getName()];
  if (!sequenceHeader || sheet.getLastColumn() < 1 || e.range.getLastRow() < 2) return false;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  var sequenceColumn = headers.indexOf(sequenceHeader) + 1;
  return sequenceColumn > 0 &&
    sequenceColumn >= e.range.getColumn() &&
    sequenceColumn <= e.range.getLastColumn();
}

function stampManualEditTimestamps_(e) {
  var sheet = e.range.getSheet();
  if (e.range.getLastRow() < 2 || sheet.getLastColumn() < 1) return;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  var modifiedIndex = headers.indexOf('Data_Ultima_Modificacao');
  if (modifiedIndex === -1) return;

  var firstRow = Math.max(2, e.range.getRow());
  var rowCount = e.range.getLastRow() - firstRow + 1;
  if (rowCount <= 0) return;
  var now = new Date();
  var modifiedValues = new Array(rowCount).fill(null).map(function() { return [now]; });
  sheet.getRange(firstRow, modifiedIndex + 1, rowCount, 1)
    .setValues(modifiedValues)
    .setNumberFormat('dd/MM/yyyy HH:mm:ss');

  var creationIndex = headers.indexOf('Data_Criacao');
  if (creationIndex !== -1) {
    var creationRange = sheet.getRange(firstRow, creationIndex + 1, rowCount, 1);
    var creationValues = creationRange.getValues();
    var changed = false;
    creationValues.forEach(function(row) {
      if (!parseTimestampValue_(row[0])) {
        row[0] = now;
        changed = true;
      }
    });
    if (changed) {
      creationRange.setValues(creationValues).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    }
  }
}

function handleGet(e) {
  var action = e.parameter.action;

  // Esta consulta é usada a cada poucos segundos e não abre as abas da planilha.
  if (action === 'getDataVersion') {
    return jsonOutput_(getDataVersion());
  }

  if (action === 'getOperationStatus') {
    return jsonOutput_(
      getOperationStatus(e.parameter.requestId || '')
    );
  }

  if (action === 'getFreshData' || action === 'getBootstrapData') {
    return jsonOutput_(
      getFreshData(e.parameter.requestId || e.parameter._ || '')
    );
  }

  // Leitura individual sem bloqueio, como na versão funcional de 31/07.
  // As gravações continuam protegidas por ScriptLock e são confirmadas antes
  // de incrementar a versão; uma leitura transitória é renovada no próximo ciclo.
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureHeaders(ss);

  var result = [];
  if (action === 'getAreas') {
    result = getDataFromSheet(ss, 'Areas');
  } else if (action === 'getSetores') {
    result = getDataFromSheet(ss, 'Setores');
  } else if (action === 'getAnalises') {
    result = getDataFromSheet(ss, 'Analises');
  } else if (action === 'getContagens') {
    result = getDataFromSheet(ss, 'Contagens');
  } else if (action === 'getParadasCadastradas') {
    result = getDataFromSheet(ss, 'ParadasCadastradas');
  }

  return jsonOutput_(result);
}

function expectedContagemFields_(p) {
  return {
    'ID_Analise': p.idAnalise,
    'Tempo_Total': p.tempoTotal,
    'Observacoes': p.obs || '',
    'Campo_1_Valor': p.v1 || '',
    'Campo_2_Valor': p.v2 || '',
    'Campo_3_Valor': p.v3 || '',
    'Campo_4_Valor': p.v4 || '',
    'Campo_5_Valor': p.v5 || '',
    'Campo_6_Valor': p.v6 || '',
    'Campo_7_Valor': p.v7 || '',
    'Campo_8_Valor': p.v8 || ''
  };
}

function displayRowMatchesFields_(headers, row, expectedFields) {
  var fieldNames = Object.keys(expectedFields);
  for (var i = 0; i < fieldNames.length; i++) {
    var fieldName = fieldNames[i];
    var index = headers.indexOf(fieldName);
    if (index === -1) return false;
    var actual = row[index] == null ? '' : row[index];
    var expected = expectedFields[fieldName] == null ? '' : expectedFields[fieldName];
    if (String(actual) !== String(expected)) return false;
  }
  return true;
}

function buildContagemRow_(headers, p, idContagem, now) {
  var valuesByHeader = {
    'ID_Contagem': idContagem,
    'ID_Analise': p.idAnalise,
    'Data_Hora': p.dataHoraCliente || now.toLocaleString('pt-BR'),
    'Tempo_Total': p.tempoTotal,
    'Observacoes': p.obs || '',
    'Campo_1_Valor': p.v1 || '',
    'Campo_2_Valor': p.v2 || '',
    'Campo_3_Valor': p.v3 || '',
    'Campo_4_Valor': p.v4 || '',
    'Campo_5_Valor': p.v5 || '',
    'Campo_6_Valor': p.v6 || '',
    'Campo_7_Valor': p.v7 || '',
    'Campo_8_Valor': p.v8 || '',
    'Data_Ultima_Modificacao': now
  };
  return headers.map(function(header) {
    return Object.prototype.hasOwnProperty.call(valuesByHeader, header)
      ? valuesByHeader[header]
      : '';
  });
}

function parseContagensBatch_(p) {
  var parsed;
  try {
    parsed = JSON.parse(String(p.itemsJson || '[]'));
  } catch (error) {
    throw new Error('O lote de medições recebido está inválido.');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('O lote de medições está vazio.');
  }
  if (parsed.length > CRONO_BATCH_MAX_ITEMS_) {
    throw new Error('O lote excedeu o limite de ' + CRONO_BATCH_MAX_ITEMS_ + ' medições.');
  }
  return parsed.map(function(item) {
    if (!item || item.action !== 'addContagem' || !item.idContagem) {
      throw new Error('O lote contém uma medição inválida.');
    }
    item.requestId = String(item.requestId || item.idContagem);
    return item;
  });
}

// Inclui uma ou várias medições usando uma leitura de IDs, um setValues e um
// único flush. O ScriptLock continua protegendo a escolha das novas linhas.
function appendContagensLocked_(ss, items) {
  ensureContagensReady_(ss);

  // Para uma única medição, preserva o caminho mais rápido: pesquisa somente
  // a coluna de IDs e não carrega toda a aba Contagens para a memória.
  if (items.length === 1) {
    var singleItem = items[0];
    var singleId = String(singleItem.idContagem || createEntityId_('CONT'));
    singleItem.idContagem = singleId;
    var existingRowNumber = findRowNumberByField_(
      ss, 'Contagens', 'ID_Contagem', singleId
    );
    if (existingRowNumber === -1) {
      appendRowToSheet(ss, 'Contagens', [
        singleId,
        singleItem.idAnalise,
        singleItem.dataHoraCliente || new Date().toLocaleString('pt-BR'),
        singleItem.tempoTotal,
        singleItem.obs || '',
        singleItem.v1 || '', singleItem.v2 || '', singleItem.v3 || '', singleItem.v4 || '',
        singleItem.v5 || '', singleItem.v6 || '', singleItem.v7 || '', singleItem.v8 || ''
      ]);
      SpreadsheetApp.flush();
      return { ids: [singleId], inserted: 1 };
    }
    if (!verifyFieldsAtRow_(
      ss, 'Contagens', existingRowNumber, expectedContagemFields_(singleItem)
    )) {
      throw new Error('Já existe uma medição diferente com o identificador ' + singleId + '.');
    }
    return { ids: [singleId], inserted: 0 };
  }

  var meta = getSheetMeta_(ss, 'Contagens');
  var idIndex = meta.headers.indexOf('ID_Contagem');
  if (idIndex === -1) throw new Error('A coluna ID_Contagem não foi encontrada.');

  var existingById = {};
  if (meta.sheet.getLastRow() >= 2) {
    var existingRows = meta.sheet
      .getRange(2, 1, meta.sheet.getLastRow() - 1, meta.lastColumn)
      .getDisplayValues();
    existingRows.forEach(function(row) {
      existingById[String(row[idIndex])] = row;
    });
  }

  var newRows = [];
  var pendingById = {};
  var ids = [];
  var now = new Date();
  items.forEach(function(item) {
    var id = String(item.idContagem || createEntityId_('CONT'));
    item.idContagem = id;
    var expected = expectedContagemFields_(item);
    var existingRow = existingById[id] || pendingById[id];
    if (existingRow) {
      if (!displayRowMatchesFields_(meta.headers, existingRow, expected)) {
        throw new Error('Já existe uma medição diferente com o identificador ' + id + '.');
      }
    } else {
      var newRow = buildContagemRow_(meta.headers, item, id, now);
      newRows.push(newRow);
      pendingById[id] = newRow.map(function(value) {
        return value instanceof Date ? '' : value;
      });
    }
    ids.push(id);
  });

  if (newRows.length > 0) {
    var targetRow = meta.sheet.getLastRow() + 1;
    meta.sheet.getRange(targetRow, 1, newRows.length, meta.lastColumn).setValues(newRows);
    SpreadsheetApp.flush();
  }
  return { ids: ids, inserted: newRows.length };
}

// Caminho otimizado para a operação mais frequente. A confirmação e o registro
// de status ocorrem depois da liberação do bloqueio, reduzindo a espera das
// outras pessoas sem retirar a proteção da gravação na planilha.
function processarInclusaoContagensRapida_(items, requestId, actionName) {
  var trace = createWriteTrace_(actionName, requestId);
  var lock = LockService.getScriptLock();
  trace.lockRequestedAt = Date.now();
  var lockObtido = lock.tryLock(CRONO_WRITE_LOCK_TIMEOUT_MS_);
  if (lockObtido) trace.lockAcquiredAt = Date.now();
  var result;

  try {
    if (!lockObtido) {
      throw new Error('Não foi possível obter acesso exclusivo à planilha. Tente novamente.');
    }

    var previousResult = readOperationStatus_(requestId);
    if (previousResult && previousResult.status === 'success' && previousResult.verified === true) {
      result = previousResult;
    } else {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var writeResult = appendContagensLocked_(ss, items);
      var dataVersion = writeResult.inserted > 0 ? bumpDataVersion_() : getDataVersion_();
      result = {
        status: 'success',
        verified: true,
        action: actionName,
        id: writeResult.ids.length === 1 ? writeResult.ids[0] : '',
        ids: writeResult.ids,
        inserted: writeResult.inserted,
        requestId: requestId,
        version: dataVersion
      };
    }
  } catch (err) {
    result = {
      status: 'error',
      verified: false,
      requestId: requestId,
      message: err.toString()
    };
  } finally {
    if (lockObtido) {
      lock.releaseLock();
      trace.lockReleasedAt = Date.now();
    }
  }

  result.performance = finishWriteTrace_(trace, result);
  storeOperationStatus_(requestId, result);
  items.forEach(function(item) {
    storeOperationStatus_(item.requestId, {
      status: result.status,
      verified: result.verified,
      action: 'addContagem',
      id: item.idContagem,
      requestId: item.requestId,
      version: result.version,
      message: result.message || '',
      performance: result.performance
    });
  });
  return jsonOutput_(result);
}

function processarInclusaoContagemRapida_(p, requestId) {
  p.requestId = requestId || p.requestId || p.idContagem;
  return processarInclusaoContagensRapida_([p], requestId, 'addContagem');
}

function prepareWritePayload_(p) {
  var action = String(p.action || '');
  var supported = {
    addCadParada: true, editCadParada: true, deleteCadParada: true,
    addArea: true, editArea: true, addSetor: true, editSetor: true,
    deleteAreas: true, deleteSetores: true, deleteMultipleAnalises: true,
    addAnalise: true, editAnalise: true,
    deleteMultipleContagens: true, deleteContagem: true, editContagem: true,
    moveMultipleAnalises: true, moveMultipleContagens: true
  };
  if (!supported[action]) throw new Error('Ação de gravação não reconhecida: ' + action);

  if (action === 'deleteAreas' || action === 'deleteSetores' ||
      action === 'deleteMultipleAnalises' || action === 'deleteMultipleContagens' ||
      action === 'moveMultipleAnalises' || action === 'moveMultipleContagens') {
    var ids;
    try {
      ids = JSON.parse(String(p.ids || '[]'));
    } catch (error) {
      throw new Error('A lista de itens selecionados está inválida.');
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error('Nenhum item foi selecionado.');
    }
    p.__parsedIds = ids;
  }
  return p;
}

function doPost(e) {
  var p = e && e.parameter ? e.parameter : {};
  var requestId = String(p.requestId || '');
  var previousResult = readOperationStatus_(requestId);
  if (previousResult && previousResult.status === 'success' && previousResult.verified === true) {
    return jsonOutput_(previousResult);
  }

  if (p.action === 'addContagem') {
    return processarInclusaoContagemRapida_(p, requestId);
  }

  if (p.action === 'addContagensBatch') {
    try {
      return processarInclusaoContagensRapida_(
        parseContagensBatch_(p),
        requestId,
        'addContagensBatch'
      );
    } catch (batchError) {
      return jsonOutput_(storeOperationStatus_(requestId, {
        status: 'error',
        verified: false,
        requestId: requestId,
        message: batchError.toString()
      }));
    }
  }

  try {
    p = prepareWritePayload_(p);
  } catch (payloadError) {
    return jsonOutput_(storeOperationStatus_(requestId, {
      status: 'error',
      verified: false,
      requestId: requestId,
      message: payloadError.toString()
    }));
  }

  var trace = createWriteTrace_(p.action, requestId);
  var lock = LockService.getScriptLock();
  trace.lockRequestedAt = Date.now();
  var lockObtido = lock.tryLock(CRONO_WRITE_LOCK_TIMEOUT_MS_);
  if (lockObtido) trace.lockAcquiredAt = Date.now();
  var finalResult;
  try {
    if (!lockObtido) {
      throw new Error('Não foi possível obter acesso exclusivo à planilha. Tente novamente.');
    }

    // Uma repetição pode ter ficado aguardando o bloqueio enquanto a primeira
    // execução concluía. A segunda conferência impede qualquer gravação dupla.
    previousResult = readOperationStatus_(requestId);
    if (previousResult && previousResult.status === 'success' && previousResult.verified === true) {
      return jsonOutput_(previousResult);
    }

    var action = p.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var validarAlteracao;
    var idProcessado = '';
    var normalizeDynamicSequencesAfter = false;
    var skipReadBackValidation = false;
    
    ensureWriteActionReady_(ss, action); // Confere somente as abas usadas pela ação.

    if (action === 'addCadParada') {
      skipReadBackValidation = true;
      idProcessado = p.idParada || createEntityId_('CADP');
      var dadosNovaParada = [idProcessado, p.nome, p.tipo, p.tempoFormatado];
      if (!updateRowByField(ss, 'ParadasCadastradas', 'ID_Parada', idProcessado, dadosNovaParada)) {
        appendRowToSheet(ss, 'ParadasCadastradas', dadosNovaParada);
      }
      validarAlteracao = function() {
        return verifyFieldsByField(ss, 'ParadasCadastradas', 'ID_Parada', idProcessado, {
          'Nome': p.nome,
          'Tipo': p.tipo,
          'Tempo_Formatado': p.tempoFormatado
        });
      };
    } else if (action === 'editCadParada') {
      skipReadBackValidation = true;
      idProcessado = p.idParada;
      var paradaAtualizada = updateRowByField(
        ss,
        'ParadasCadastradas',
        'ID_Parada',
        idProcessado,
        [idProcessado, p.nome, p.tipo, p.tempoFormatado]
      );
      if (!paradaAtualizada) {
        throw new Error('A parada informada não foi encontrada para edição.');
      }
      validarAlteracao = function() {
        return verifyFieldsByField(ss, 'ParadasCadastradas', 'ID_Parada', idProcessado, {
          'Nome': p.nome,
          'Tipo': p.tipo,
          'Tempo_Formatado': p.tempoFormatado
        });
      };
    } else if (action === 'deleteCadParada') {
      skipReadBackValidation = true;
      deleteRowByField(ss, 'ParadasCadastradas', 'ID_Parada', p.idParada);
      idProcessado = p.idParada;
      validarAlteracao = function() {
        return !rowExistsByField(ss, 'ParadasCadastradas', 'ID_Parada', p.idParada);
      };
    } else if (action === 'addArea' || action === 'editArea') {
      normalizeDynamicSequencesAfter = action === 'editArea';
      var resultadoArea = saveAreaEntity_(ss, p, action === 'editArea');
      resultadoArea.sequencia = reorderAreaSequences_(
        ss,
        resultadoArea.id,
        resultadoArea.sequencia
      );
      p.sequenciaArea = resultadoArea.sequencia;
      idProcessado = resultadoArea.id;
      validarAlteracao = function() {
        var areaValida = verifyFieldsByField(ss, 'Areas', 'ID_Area', resultadoArea.id, {
          'Nome': resultadoArea.nome,
          'Sequencia': resultadoArea.sequencia
        });
        var origemRemovida = !resultadoArea.mergedFromId ||
          !rowExistsByField(ss, 'Areas', 'ID_Area', resultadoArea.mergedFromId);
        var cascataValida = !resultadoArea.nomeAnterior ||
          resultadoArea.nomeAnterior === resultadoArea.nome ||
          !analysisExistsByHierarchy_(ss, resultadoArea.nomeAnterior, null);
        return areaValida && origemRemovida && cascataValida &&
          verifyUniqueSequences_(ss, 'Areas', 'Sequencia', function() { return true; });
      };
    } else if (action === 'addSetor' || action === 'editSetor') {
      normalizeDynamicSequencesAfter = action === 'editSetor';
      var resultadoSetor = saveSetorEntity_(ss, p, action === 'editSetor');
      var areaResultadoSetor = getRecordByField_(ss, 'Areas', 'ID_Area', resultadoSetor.idArea);
      if (!areaResultadoSetor) throw new Error('A Área do Setor não foi encontrada após a gravação.');
      p.sequenciaArea = reorderAreaSequences_(
        ss,
        areaResultadoSetor.ID_Area,
        areaResultadoSetor.Sequencia
      );
      resultadoSetor.sequencia = reorderSetorSequences_(
        ss,
        resultadoSetor.idArea,
        resultadoSetor.id,
        resultadoSetor.sequencia
      );
      p.sequenciaSetor = resultadoSetor.sequencia;
      idProcessado = resultadoSetor.id;
      validarAlteracao = function() {
        var setorValido = verifyFieldsByField(ss, 'Setores', 'ID_Setor', resultadoSetor.id, {
          'ID_Area': resultadoSetor.idArea,
          'Nome': resultadoSetor.nome,
          'Sequencia': resultadoSetor.sequencia
        });
        var origemSetorRemovida = !resultadoSetor.mergedFromId ||
          !rowExistsByField(ss, 'Setores', 'ID_Setor', resultadoSetor.mergedFromId);
        var cascataSetorValida = !resultadoSetor.areaAnterior ||
          !resultadoSetor.nomeAnterior ||
          (
            resultadoSetor.areaAnterior === resultadoSetor.areaNome &&
            resultadoSetor.nomeAnterior === resultadoSetor.nome
          ) ||
          !analysisExistsByHierarchy_(
            ss,
            resultadoSetor.areaAnterior,
            resultadoSetor.nomeAnterior
          );
        return setorValido && origemSetorRemovida && cascataSetorValida &&
          verifyUniqueSequences_(ss, 'Areas', 'Sequencia', function() { return true; }) &&
          verifyUniqueSequences_(ss, 'Setores', 'Sequencia', function(row, headers) {
            return String(row[headers.indexOf('ID_Area')]) === String(resultadoSetor.idArea);
          });
      };
    } else if (action === 'deleteAreas') {
      normalizeDynamicSequencesAfter = true;
      var idsAreas = p.__parsedIds;
      var resultadoExcluirAreas = deleteAreasCascade_(ss, idsAreas);
      idProcessado = idsAreas.join(',');
      validarAlteracao = function() {
        return noneOfFieldValuesExist_(ss, 'Areas', 'ID_Area', idsAreas) &&
          noneOfFieldValuesExist_(ss, 'Analises', 'ID_Analise', resultadoExcluirAreas.analysisIds) &&
          noneOfFieldValuesExist_(ss, 'Contagens', 'ID_Analise', resultadoExcluirAreas.analysisIds);
      };
    } else if (action === 'deleteSetores') {
      normalizeDynamicSequencesAfter = true;
      var idsSetores = p.__parsedIds;
      var resultadoExcluirSetores = deleteSetoresCascade_(ss, idsSetores);
      idProcessado = idsSetores.join(',');
      validarAlteracao = function() {
        return noneOfFieldValuesExist_(ss, 'Setores', 'ID_Setor', idsSetores) &&
          noneOfFieldValuesExist_(ss, 'Analises', 'ID_Analise', resultadoExcluirSetores.analysisIds) &&
          noneOfFieldValuesExist_(ss, 'Contagens', 'ID_Analise', resultadoExcluirSetores.analysisIds);
      };
    } else if (action === 'deleteMultipleAnalises') {
      normalizeDynamicSequencesAfter = true;
      var ids = p.__parsedIds;
      deleteRowsByFieldValues(ss, 'Analises', 'ID_Analise', ids);
      deleteRowsByFieldValues(ss, 'Contagens', 'ID_Analise', ids);
      validarAlteracao = function() {
        return noneOfFieldValuesExist_(ss, 'Analises', 'ID_Analise', ids) &&
          noneOfFieldValuesExist_(ss, 'Contagens', 'ID_Analise', ids);
      };
    } else if (action === 'moveMultipleAnalises') {
      // Move uma ou mais Atividades para outra Área/Setor já cadastrados. As Contagens
      // continuam vinculadas pelo ID_Analise (não são tocadas aqui), então acompanham a
      // atividade automaticamente. A sequência de cada atividade dentro do setor de destino
      // é recalculada no fim (normalizeDynamicSequencesAfter), então não precisa escolher
      // manualmente onde cada uma entra na nova ordem.
      normalizeDynamicSequencesAfter = true;
      var idsAnalisesMover = p.__parsedIds;
      var areaDestinoMover = resolveAreaForAnalysis_(ss, { idArea: p.idArea });
      var setorDestinoMover = resolveSetorForAnalysis_(ss, { idSetor: p.idSetor }, areaDestinoMover);
      var camposDestinoMover = {
        'Area': areaDestinoMover.Nome,
        'Setor': setorDestinoMover.Nome,
        'Sequencia_Area': safeSequence_(areaDestinoMover.Sequencia),
        'Sequencia_Setor': safeSequence_(setorDestinoMover.Sequencia)
      };
      idsAnalisesMover.forEach(function(idAnaliseMover) {
        var linhaMovida = writeFieldsByField_(ss, 'Analises', 'ID_Analise', idAnaliseMover, camposDestinoMover, false);
        if (!linhaMovida) throw new Error('Uma das atividades selecionadas não foi encontrada.');
      });
      idProcessado = idsAnalisesMover.join(',');
      validarAlteracao = function() {
        return idsAnalisesMover.every(function(idAnaliseMover) {
          return verifyFieldsByField(ss, 'Analises', 'ID_Analise', idAnaliseMover, {
            'Area': areaDestinoMover.Nome,
            'Setor': setorDestinoMover.Nome
          });
        });
      };
    } else if (action === 'addAnalise' || action === 'editAnalise') {
      var idAnalise = p.idAnalise || createEntityId_('ANAL');
      var analiseAnterior = action === 'editAnalise'
        ? getRecordByField_(ss, 'Analises', 'ID_Analise', idAnalise)
        : null;
      var areaEntidade = resolveAreaForAnalysis_(ss, p);
      var setorEntidade = resolveSetorForAnalysis_(ss, p, areaEntidade);
      var analisesAntesGravacao = canonicalizeParameterNames_(ss, p);
      p.area = areaEntidade.Nome;
      p.setor = setorEntidade.Nome;
      p.idArea = areaEntidade.ID_Area;
      p.idSetor = setorEntidade.ID_Setor;
      var possuiSequenciaAtividade = Object.prototype.hasOwnProperty.call(p, 'sequenciaAtividade');
      var sequenciaArea = areaEntidade.__sequenceChanged
        ? reorderAreaSequences_(
            ss,
            areaEntidade.ID_Area,
            safeSequence_(areaEntidade.Sequencia)
          )
        : safeSequence_(areaEntidade.Sequencia);
      areaEntidade.Sequencia = sequenciaArea;
      p.sequenciaArea = sequenciaArea;
      var sequenciaSetor = setorEntidade.__sequenceChanged
        ? reorderSetorSequences_(
            ss,
            areaEntidade.ID_Area,
            setorEntidade.ID_Setor,
            safeSequence_(setorEntidade.Sequencia)
          )
        : safeSequence_(setorEntidade.Sequencia);
      setorEntidade.Sequencia = sequenciaSetor;
      p.sequenciaSetor = sequenciaSetor;
      var sequenciaAtividade = possuiSequenciaAtividade
        ? normalizeSequence_(p.sequenciaAtividade)
        : getFieldValueByField_(ss, 'Analises', 'ID_Analise', idAnalise, 'Sequencia_Atividade');
      if (action === 'addAnalise') {
        sequenciaAtividade = requireNewSequence_(sequenciaAtividade, 'A sequência da Atividade');
      }
      var camposAnalise = {
        'ID_Analise': idAnalise,
        'Area': p.area,
        'Setor': p.setor,
        'Atividade': p.atividade,
        'Paradas_Aplicaveis': p.paradasAplicaveis,
        'Campo_Ritmo': p.campoRitmo,
        'Campo_1_Nome': p.c1 || '', 'Campo_1_Tipo': p.t1 || 'numero',
        'Campo_2_Nome': p.c2 || '', 'Campo_2_Tipo': p.t2 || 'numero',
        'Campo_3_Nome': p.c3 || '', 'Campo_3_Tipo': p.t3 || 'numero',
        'Campo_4_Nome': p.c4 || '', 'Campo_4_Tipo': p.t4 || 'numero',
        'Campo_5_Nome': p.c5 || '', 'Campo_5_Tipo': p.t5 || 'numero',
        'Campo_6_Nome': p.c6 || '', 'Campo_6_Tipo': p.t6 || 'numero',
        'Campo_7_Nome': p.c7 || '', 'Campo_7_Tipo': p.t7 || 'numero',
        'Campo_8_Nome': p.c8 || '', 'Campo_8_Tipo': p.t8 || 'numero',
        'Descricao_Atividade': p.descricaoAtividade || '',
        'Criterios_Medicao': p.criteriosMedicao || '',
        'Consideracoes_Atividade': p.consideracoesAtividade || '',
        'Sequencia_Area': sequenciaArea,
        'Sequencia_Setor': sequenciaSetor,
        'Sequencia_Atividade': sequenciaAtividade
      };
      var linhaAnalise;
      if (action === 'editAnalise') {
        linhaAnalise = writeFieldsByField_(
          ss,
          'Analises',
          'ID_Analise',
          idAnalise,
          camposAnalise,
          false
        );
        if (!linhaAnalise) {
          throw new Error('A atividade informada não foi encontrada para edição.');
        }
      } else {
        linhaAnalise = writeFieldsByField_(ss, 'Analises', 'ID_Analise', idAnalise, camposAnalise, true);
      }
      if (!canSkipActivitySequenceReorder_(
        analisesAntesGravacao,
        action,
        analiseAnterior,
        p.area,
        p.setor,
        idAnalise,
        sequenciaAtividade
      )) {
        sequenciaAtividade = reorderActivitySequences_(
          ss,
          p.area,
          p.setor,
          idAnalise,
          sequenciaAtividade
        );
      }
      p.sequenciaAtividade = sequenciaAtividade;
      normalizeDynamicSequencesAfter = Boolean(
        analiseAnterior &&
        (
          String(analiseAnterior.Area) !== String(p.area) ||
          String(analiseAnterior.Setor) !== String(p.setor)
        )
      );
      idProcessado = idAnalise;
      validarAlteracao = function() {
        return verifyFieldsAtRow_(ss, 'Analises', linhaAnalise, {
          'Area': p.area,
          'Setor': p.setor,
          'Atividade': p.atividade,
          'Sequencia_Area': sequenciaArea,
          'Sequencia_Setor': sequenciaSetor,
          'Sequencia_Atividade': sequenciaAtividade,
          'Descricao_Atividade': p.descricaoAtividade || '',
          'Criterios_Medicao': p.criteriosMedicao || '',
          'Consideracoes_Atividade': p.consideracoesAtividade || '',
          'Paradas_Aplicaveis': p.paradasAplicaveis,
          'Campo_Ritmo': p.campoRitmo,
          'Campo_1_Nome': p.c1 || '', 'Campo_1_Tipo': p.t1 || 'numero',
          'Campo_2_Nome': p.c2 || '', 'Campo_2_Tipo': p.t2 || 'numero',
          'Campo_3_Nome': p.c3 || '', 'Campo_3_Tipo': p.t3 || 'numero',
          'Campo_4_Nome': p.c4 || '', 'Campo_4_Tipo': p.t4 || 'numero',
          'Campo_5_Nome': p.c5 || '', 'Campo_5_Tipo': p.t5 || 'numero',
          'Campo_6_Nome': p.c6 || '', 'Campo_6_Tipo': p.t6 || 'numero',
          'Campo_7_Nome': p.c7 || '', 'Campo_7_Tipo': p.t7 || 'numero',
          'Campo_8_Nome': p.c8 || '', 'Campo_8_Tipo': p.t8 || 'numero'
        });
      };
    } else if (action === 'deleteMultipleContagens') {
      skipReadBackValidation = true;
      var idsContagens = p.__parsedIds;
      deleteRowsByFieldValues(ss, 'Contagens', 'ID_Contagem', idsContagens);
      idProcessado = idsContagens.join(',');
      validarAlteracao = function() {
        return noneOfFieldValuesExist_(ss, 'Contagens', 'ID_Contagem', idsContagens);
      };
    } else if (action === 'moveMultipleContagens') {
      // Move uma ou mais Contagens para outra Atividade. Só é permitido entre atividades
      // com a mesma estrutura de Campo_1..8 (mesmo nome e tipo) — caso contrário os valores
      // registrados ficariam fora de contexto na atividade de destino (ex.: um valor de
      // "Quantidade de peças" indo parar num campo "Tempo de setup"). A checagem é repetida
      // aqui no servidor mesmo que a tela já filtre as opções, como segunda camada de proteção.
      skipReadBackValidation = true;
      var idsContagensMover = p.__parsedIds;
      var analiseDestinoMover = getRecordByField_(ss, 'Analises', 'ID_Analise', p.idAnaliseDestino);
      if (!analiseDestinoMover) throw new Error('A atividade de destino não foi encontrada.');
      var analiseOrigemMover = p.idAnaliseOrigem
        ? getRecordByField_(ss, 'Analises', 'ID_Analise', p.idAnaliseOrigem)
        : null;
      if (analiseOrigemMover && !mesmaEstruturaCampos_(analiseOrigemMover, analiseDestinoMover)) {
        throw new Error('A atividade de destino tem campos diferentes da atividade de origem. Só é possível mover contagens entre atividades com a mesma estrutura de campos.');
      }
      idsContagensMover.forEach(function(idContagemMover) {
        var linhaMovida = writeFieldsByField_(ss, 'Contagens', 'ID_Contagem', idContagemMover, {
          'ID_Analise': analiseDestinoMover.ID_Analise
        }, false);
        if (!linhaMovida) throw new Error('Uma das contagens selecionadas não foi encontrada.');
      });
      idProcessado = idsContagensMover.join(',');
      validarAlteracao = function() {
        return idsContagensMover.every(function(idContagemMover) {
          return verifyFieldsByField(ss, 'Contagens', 'ID_Contagem', idContagemMover, {
            'ID_Analise': analiseDestinoMover.ID_Analise
          });
        });
      };
    } else if (action === 'deleteContagem') {
      skipReadBackValidation = true;
      deleteRowByField(ss, 'Contagens', 'ID_Contagem', p.idContagem);
      idProcessado = p.idContagem;
      validarAlteracao = function() {
        return !rowExistsByField(ss, 'Contagens', 'ID_Contagem', p.idContagem);
      };
    } else if (action === 'editContagem') {
      skipReadBackValidation = true;
      var idContagem = p.idContagem;
      var contagemAtualizada = updateContagemRow(ss, 'Contagens', 'ID_Contagem', idContagem, p.tempoTotal, p.obs, [
        p.v1, p.v2, p.v3, p.v4, p.v5, p.v6, p.v7, p.v8
      ]);
      if (!contagemAtualizada) {
        throw new Error('A medição informada não foi encontrada para edição.');
      }
      idProcessado = idContagem;
      validarAlteracao = function() {
        return verifyFieldsByField(ss, 'Contagens', 'ID_Contagem', idContagem, {
          'Tempo_Total': p.tempoTotal,
          'Observacoes': p.obs,
          'Campo_1_Valor': p.v1 || '',
          'Campo_2_Valor': p.v2 || '',
          'Campo_3_Valor': p.v3 || '',
          'Campo_4_Valor': p.v4 || '',
          'Campo_5_Valor': p.v5 || '',
          'Campo_6_Valor': p.v6 || '',
          'Campo_7_Valor': p.v7 || '',
          'Campo_8_Valor': p.v8 || ''
        });
      };
    } else if (action === 'addContagem') {
      var idNovaContagem = p.idContagem || createEntityId_('CONT');
      var dataHora = p.dataHoraCliente || new Date().toLocaleString('pt-BR');
      var novaContagem = [
        idNovaContagem, p.idAnalise, dataHora, p.tempoTotal, p.obs,
        p.v1 || '', p.v2 || '', p.v3 || '', p.v4 || '',
        p.v5 || '', p.v6 || '', p.v7 || '', p.v8 || ''
      ];
      var linhaNovaContagem = findRowNumberByField_(ss, 'Contagens', 'ID_Contagem', idNovaContagem);
      if (linhaNovaContagem === -1) {
        linhaNovaContagem = appendRowToSheet(ss, 'Contagens', novaContagem);
      }
      idProcessado = idNovaContagem;
      validarAlteracao = function() {
        return verifyFieldsAtRow_(ss, 'Contagens', linhaNovaContagem, {
          'ID_Analise': p.idAnalise,
          'Tempo_Total': p.tempoTotal,
          'Observacoes': p.obs,
          'Campo_1_Valor': p.v1 || '',
          'Campo_2_Valor': p.v2 || '',
          'Campo_3_Valor': p.v3 || '',
          'Campo_4_Valor': p.v4 || '',
          'Campo_5_Valor': p.v5 || '',
          'Campo_6_Valor': p.v6 || '',
          'Campo_7_Valor': p.v7 || '',
          'Campo_8_Valor': p.v8 || ''
        });
      };
    } else {
      throw new Error('Ação de gravação não reconhecida: ' + action);
    }

    if (normalizeDynamicSequencesAfter) {
      normalizeAllDynamicSequences_(ss);
    }
    SpreadsheetApp.flush();

    if (!skipReadBackValidation && (!validarAlteracao || !validarAlteracao())) {
      throw new Error('A alteração não pôde ser confirmada após a gravação na planilha.');
    }

    var dataVersion = bumpDataVersion_();

    finalResult = {
      status: 'success',
      verified: true,
      action: action,
      id: idProcessado,
      requestId: requestId,
      version: dataVersion
    };
    // Mantém a idempotência das operações estruturais: uma repetição que já
    // esteja aguardando o bloqueio encontra o resultado antes de poder gravar.
    storeOperationStatus_(requestId, finalResult);
  } catch (err) {
    finalResult = {
      status: 'error',
      verified: false,
      requestId: requestId,
      message: err.toString()
    };
  } finally {
    if (lockObtido) {
      lock.releaseLock();
      trace.lockReleasedAt = Date.now();
    }
  }

  finalResult.performance = finishWriteTrace_(trace, finalResult);
  storeOperationStatus_(requestId, finalResult);
  return jsonOutput_(finalResult);
}

// Permite que o HTML servido pelo próprio Apps Script grave e receba a confirmação diretamente.
function processarAlteracao(data) {
  var resposta = doPost({ parameter: data || {} });
  return JSON.parse(resposta.getContent());
}

// Funções auxiliares de manipulação e validação da planilha.
function getSheetMeta_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return null;
  var lastColumn = sheet.getLastColumn();
  var sheetId = typeof sheet.getSheetId === 'function' ? sheet.getSheetId() : sheetName;
  if (lastColumn < 1) return { sheet: sheet, headers: [], lastColumn: 0 };
  var cached = CRONO_SHEET_META_RUNTIME_CACHE_[sheetName];
  if (cached && cached.sheetId === sheetId && cached.lastColumn === lastColumn) {
    cached.sheet = sheet;
    return cached;
  }
  var meta = {
    sheet: sheet,
    sheetId: sheetId,
    lastColumn: lastColumn,
    headers: sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
  };
  CRONO_SHEET_META_RUNTIME_CACHE_[sheetName] = meta;
  return meta;
}

function findRowNumberByField_(ss, sheetName, fieldName, fieldValue) {
  var meta = getSheetMeta_(ss, sheetName);
  if (!meta || meta.sheet.getLastRow() < 2) return -1;
  var fieldIndex = meta.headers.indexOf(fieldName);
  if (fieldIndex === -1) return -1;
  var text = String(fieldValue == null ? '' : fieldValue);
  if (!text) return -1;
  var range = meta.sheet.getRange(2, fieldIndex + 1, meta.sheet.getLastRow() - 1, 1);
  var match = range.createTextFinder(text)
    .matchEntireCell(true)
    .matchCase(true)
    .findNext();
  return match ? match.getRow() : -1;
}

function noneOfFieldValuesExist_(ss, sheetName, fieldName, fieldValues) {
  if (!fieldValues || fieldValues.length === 0) return true;
  var meta = getSheetMeta_(ss, sheetName);
  if (!meta || meta.sheet.getLastRow() < 2) return true;
  var fieldIndex = meta.headers.indexOf(fieldName);
  if (fieldIndex === -1) return false;
  var expected = {};
  fieldValues.forEach(function(value) { expected[String(value)] = true; });
  var values = meta.sheet
    .getRange(2, fieldIndex + 1, meta.sheet.getLastRow() - 1, 1)
    .getDisplayValues();
  return !values.some(function(row) { return expected[String(row[0])] === true; });
}

function getDataFromSheet(ss, sheetName) {
  var meta = getSheetMeta_(ss, sheetName);
  if (!meta) return [];
  var rows = meta.sheet.getDataRange().getDisplayValues();
  if (rows.length <= 1) return [];
  var headers = rows[0];
  var data = [];
  for (var i = 1; i < rows.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = rows[i][j];
    }
    data.push(obj);
  }
  return data;
}

function appendRowToSheet(ss, sheetName, rowData) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (sheetName === 'ParadasCadastradas') {
      sheet.appendRow(['ID_Parada', 'Nome', 'Tipo', 'Tempo_Formatado', 'Data_Criacao', 'Data_Ultima_Modificacao']);
    } else if (sheetName === 'Analises') {
      sheet.appendRow([
        'ID_Analise', 'Area', 'Setor', 'Atividade', 'Paradas_Aplicaveis', 'Campo_Ritmo',
        'Campo_1_Nome', 'Campo_1_Tipo', 'Campo_2_Nome', 'Campo_2_Tipo',
        'Campo_3_Nome', 'Campo_3_Tipo', 'Campo_4_Nome', 'Campo_4_Tipo',
        'Campo_5_Nome', 'Campo_5_Tipo', 'Campo_6_Nome', 'Campo_6_Tipo',
        'Campo_7_Nome', 'Campo_7_Tipo', 'Campo_8_Nome', 'Campo_8_Tipo',
        'Descricao_Atividade', 'Sequencia_Area', 'Sequencia_Setor', 'Sequencia_Atividade',
        'Data_Criacao', 'Data_Ultima_Modificacao', 'Consideracoes_Atividade', 'Criterios_Medicao'
      ]);
    } else if (sheetName === 'Contagens') {
      sheet.appendRow([
        'ID_Contagem', 'ID_Analise', 'Data_Hora', 'Tempo_Total', 'Observacoes',
        'Campo_1_Valor', 'Campo_2_Valor', 'Campo_3_Valor', 'Campo_4_Valor',
        'Campo_5_Valor', 'Campo_6_Valor', 'Campo_7_Valor', 'Campo_8_Valor',
        'Data_Ultima_Modificacao'
      ]);
    }
    delete CRONO_SHEET_META_RUNTIME_CACHE_[sheetName];
  }
  var meta = getSheetMeta_(ss, sheetName);
  var lastColumn = meta.lastColumn;
  var headers = meta.headers;
  var fullRow = new Array(lastColumn).fill('');
  for (var i = 0; i < Math.min(rowData.length, fullRow.length); i++) fullRow[i] = rowData[i];
  var now = new Date();
  var creationIndex = headers.indexOf('Data_Criacao');
  var modifiedIndex = headers.indexOf('Data_Ultima_Modificacao');
  if (creationIndex !== -1 && !fullRow[creationIndex]) fullRow[creationIndex] = now;
  if (modifiedIndex !== -1) fullRow[modifiedIndex] = now;
  var targetRow = sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1, 1, lastColumn).setValues([fullRow]);
  return targetRow;
}

function normalizeSequence_(value) {
  var text = value == null ? '' : String(value).trim();
  if (!text) return '';
  if (!/^\d+$/.test(text)) {
    throw new Error('O número de sequência deve ser um inteiro maior que zero.');
  }
  var number = parseInt(text, 10);
  if (!isFinite(number) || number <= 0) {
    throw new Error('O número de sequência deve ser um inteiro maior que zero.');
  }
  return String(number);
}

function sequenceNumberOrNull_(value) {
  var normalized = safeSequence_(value);
  return normalized === '' ? null : Number(normalized);
}

// Reorganiza somente os registros do mesmo nível hierárquico. O registro-alvo
// entra na posição solicitada e os seguintes são deslocados, sem duplicidade.
// A reconstrução é determinística para que uma repetição segura da requisição
// produza exatamente o mesmo resultado.
function rebuildDynamicSequenceGroup_(
  ss,
  sheetName,
  idHeader,
  sequenceHeader,
  targetId,
  targetSequence,
  matchesGroup
) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) {
    if (targetId) throw new Error('O registro de sequência não foi encontrado em ' + sheetName + '.');
    return { sequence: '', changed: false };
  }

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  var rows = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  var headers = rows[0];
  var idIndex = headers.indexOf(idHeader);
  var sequenceIndex = headers.indexOf(sequenceHeader);
  var modifiedIndex = headers.indexOf('Data_Ultima_Modificacao');
  if (idIndex === -1 || sequenceIndex === -1) {
    throw new Error('As colunas de sequência não foram encontradas em ' + sheetName + '.');
  }

  var targetRowIndex = -1;
  var sequencedRows = [];
  for (var i = 1; i < rows.length; i++) {
    if (matchesGroup && !matchesGroup(rows[i], headers)) continue;
    var isTarget = targetId && String(rows[i][idIndex]) === String(targetId);
    if (isTarget) {
      targetRowIndex = i;
      continue;
    }
    var number = sequenceNumberOrNull_(rows[i][sequenceIndex]);
    if (number != null) {
      sequencedRows.push({ rowIndex: i, sequence: number, originalIndex: i });
    }
  }

  if (targetId && targetRowIndex === -1) {
    throw new Error('O registro-alvo da sequência não foi encontrado em ' + sheetName + '.');
  }

  sequencedRows.sort(function(a, b) {
    return a.sequence - b.sequence || a.originalIndex - b.originalIndex;
  });

  var normalizedTarget = targetId ? normalizeSequence_(targetSequence) : '';
  if (targetId && normalizedTarget !== '') {
    var targetPosition = Math.min(Number(normalizedTarget), sequencedRows.length + 1);
    sequencedRows.splice(targetPosition - 1, 0, {
      rowIndex: targetRowIndex,
      sequence: targetPosition,
      originalIndex: targetRowIndex,
      isTarget: true
    });
    normalizedTarget = String(targetPosition);
  }

  var desiredByRow = {};
  sequencedRows.forEach(function(entry, index) {
    desiredByRow[entry.rowIndex] = String(index + 1);
  });
  if (targetId && normalizedTarget === '') desiredByRow[targetRowIndex] = '';

  var changed = false;
  var now = new Date();
  var sequenceValues = [];
  var modifiedValues = [];
  for (var rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    if (Object.prototype.hasOwnProperty.call(desiredByRow, rowIndex)) {
      var desired = desiredByRow[rowIndex];
      if (String(rows[rowIndex][sequenceIndex] || '') !== desired) {
        rows[rowIndex][sequenceIndex] = desired;
        if (modifiedIndex !== -1) rows[rowIndex][modifiedIndex] = now;
        changed = true;
      }
    }
    sequenceValues.push([rows[rowIndex][sequenceIndex]]);
    if (modifiedIndex !== -1) modifiedValues.push([rows[rowIndex][modifiedIndex]]);
  }

  if (changed) {
    sheet.getRange(2, sequenceIndex + 1, sequenceValues.length, 1).setValues(sequenceValues);
    if (modifiedIndex !== -1) {
      sheet.getRange(2, modifiedIndex + 1, modifiedValues.length, 1)
        .setValues(modifiedValues)
        .setNumberFormat('dd/MM/yyyy HH:mm:ss');
    }
  }
  return { sequence: normalizedTarget, changed: changed };
}

function syncEntitySequencesToAnalyses_(ss) {
  var areas = getDataFromSheet(ss, 'Areas');
  var setores = getDataFromSheet(ss, 'Setores');
  var areasByName = {};
  var setoresByKey = {};
  areas.forEach(function(area) {
    areasByName[normalizeEntityName_(area.Nome)] = area;
  });
  setores.forEach(function(setor) {
    setoresByKey[String(setor.ID_Area) + '|' + normalizeEntityName_(setor.Nome)] = setor;
  });

  var sheet = ss.getSheetByName('Analises');
  if (!sheet || sheet.getLastRow() < 2) return false;
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var areaIndex = headers.indexOf('Area');
  var setorIndex = headers.indexOf('Setor');
  var areaSequenceIndex = headers.indexOf('Sequencia_Area');
  var setorSequenceIndex = headers.indexOf('Sequencia_Setor');
  var modifiedIndex = headers.indexOf('Data_Ultima_Modificacao');
  if (areaIndex === -1 || setorIndex === -1 || areaSequenceIndex === -1 || setorSequenceIndex === -1) {
    throw new Error('As colunas de hierarquia não foram encontradas na aba Analises.');
  }

  var changed = false;
  var now = new Date();
  var areaValues = [];
  var setorValues = [];
  var modifiedValues = [];
  for (var i = 1; i < rows.length; i++) {
    var area = areasByName[normalizeEntityName_(rows[i][areaIndex])];
    var setor = area
      ? setoresByKey[String(area.ID_Area) + '|' + normalizeEntityName_(rows[i][setorIndex])]
      : null;
    var desiredArea = area ? safeSequence_(area.Sequencia) : String(rows[i][areaSequenceIndex] || '');
    var desiredSetor = setor ? safeSequence_(setor.Sequencia) : String(rows[i][setorSequenceIndex] || '');
    var rowChanged = false;
    if (String(rows[i][areaSequenceIndex] || '') !== desiredArea) {
      rows[i][areaSequenceIndex] = desiredArea;
      rowChanged = true;
    }
    if (String(rows[i][setorSequenceIndex] || '') !== desiredSetor) {
      rows[i][setorSequenceIndex] = desiredSetor;
      rowChanged = true;
    }
    if (rowChanged && modifiedIndex !== -1) rows[i][modifiedIndex] = now;
    changed = changed || rowChanged;
    areaValues.push([rows[i][areaSequenceIndex]]);
    setorValues.push([rows[i][setorSequenceIndex]]);
    if (modifiedIndex !== -1) modifiedValues.push([rows[i][modifiedIndex]]);
  }

  if (changed) {
    sheet.getRange(2, areaSequenceIndex + 1, areaValues.length, 1).setValues(areaValues);
    sheet.getRange(2, setorSequenceIndex + 1, setorValues.length, 1).setValues(setorValues);
    if (modifiedIndex !== -1) {
      sheet.getRange(2, modifiedIndex + 1, modifiedValues.length, 1)
        .setValues(modifiedValues)
        .setNumberFormat('dd/MM/yyyy HH:mm:ss');
    }
  }
  return changed;
}

function reorderAreaSequences_(ss, targetId, targetSequence) {
  var result = rebuildDynamicSequenceGroup_(
    ss, 'Areas', 'ID_Area', 'Sequencia', targetId, targetSequence,
    function() { return true; }
  );
  if (result.changed) syncEntitySequencesToAnalyses_(ss);
  return result.sequence;
}

function reorderSetorSequences_(ss, idArea, targetId, targetSequence) {
  var result = rebuildDynamicSequenceGroup_(
    ss, 'Setores', 'ID_Setor', 'Sequencia', targetId, targetSequence,
    function(row, headers) {
      return String(row[headers.indexOf('ID_Area')]) === String(idArea);
    }
  );
  if (result.changed) syncEntitySequencesToAnalyses_(ss);
  return result.sequence;
}

function reorderActivitySequences_(ss, area, setor, targetId, targetSequence) {
  return rebuildDynamicSequenceGroup_(
    ss, 'Analises', 'ID_Analise', 'Sequencia_Atividade', targetId, targetSequence,
    function(row, headers) {
      return String(row[headers.indexOf('Area')]) === String(area) &&
        String(row[headers.indexOf('Setor')]) === String(setor);
    }
  ).sequence;
}

function verifyUniqueSequences_(ss, sheetName, sequenceHeader, matchesGroup) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return true;
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var sequenceIndex = headers.indexOf(sequenceHeader);
  if (sequenceIndex === -1) return false;
  var used = {};
  for (var i = 1; i < rows.length; i++) {
    if (matchesGroup && !matchesGroup(rows[i], headers)) continue;
    var sequence = safeSequence_(rows[i][sequenceIndex]);
    if (sequence === '') continue;
    if (used[sequence]) return false;
    used[sequence] = true;
  }
  return true;
}

function normalizeAllDynamicSequences_(ss) {
  rebuildDynamicSequenceGroup_(
    ss, 'Areas', 'ID_Area', 'Sequencia', '', '', function() { return true; }
  );

  var setores = getDataFromSheet(ss, 'Setores');
  var areaIds = {};
  setores.forEach(function(setor) { areaIds[String(setor.ID_Area)] = true; });
  Object.keys(areaIds).forEach(function(idArea) {
    rebuildDynamicSequenceGroup_(
      ss, 'Setores', 'ID_Setor', 'Sequencia', '', '',
      function(row, headers) {
        return String(row[headers.indexOf('ID_Area')]) === idArea;
      }
    );
  });

  var analyses = getDataFromSheet(ss, 'Analises');
  var groups = {};
  analyses.forEach(function(analysis) {
    var key = String(analysis.Area) + '\u0000' + String(analysis.Setor);
    groups[key] = { area: String(analysis.Area), setor: String(analysis.Setor) };
  });
  Object.keys(groups).forEach(function(key) {
    var group = groups[key];
    rebuildDynamicSequenceGroup_(
      ss, 'Analises', 'ID_Analise', 'Sequencia_Atividade', '', '',
      function(row, headers) {
        return String(row[headers.indexOf('Area')]) === group.area &&
          String(row[headers.indexOf('Setor')]) === group.setor;
      }
    );
  });
  syncEntitySequencesToAnalyses_(ss);
  SpreadsheetApp.flush();
}

function getFieldValueByField_(ss, sheetName, fieldName, fieldValue, targetFieldName) {
  var meta = getSheetMeta_(ss, sheetName);
  if (!meta) return '';
  var targetIndex = meta.headers.indexOf(targetFieldName);
  if (targetIndex === -1) return '';
  var rowNumber = findRowNumberByField_(ss, sheetName, fieldName, fieldValue);
  if (rowNumber === -1) return '';
  var value = meta.sheet.getRange(rowNumber, targetIndex + 1).getValue();
  return value == null ? '' : String(value);
}

function updateEntitySequences_(
  ss,
  area,
  setor,
  sequenciaArea,
  sequenciaSetor,
  atualizarArea,
  atualizarSetor
) {
  if (!atualizarArea && !atualizarSetor) return;
  var sheet = ss.getSheetByName('Analises');
  if (!sheet || sheet.getLastRow() < 2) return;

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  var rows = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  var headers = rows[0];
  var areaIndex = headers.indexOf('Area');
  var setorIndex = headers.indexOf('Setor');
  var sequenciaAreaIndex = headers.indexOf('Sequencia_Area');
  var sequenciaSetorIndex = headers.indexOf('Sequencia_Setor');
  var modifiedIndex = headers.indexOf('Data_Ultima_Modificacao');
  if (areaIndex === -1 || setorIndex === -1 || sequenciaAreaIndex === -1 || sequenciaSetorIndex === -1) {
    throw new Error('As colunas de sequência não foram encontradas na aba Analises.');
  }

  var valoresArea = [];
  var valoresSetor = [];
  var valoresModificacao = [];
  var houveAlteracao = false;
  var now = new Date();
  for (var i = 1; i < rows.length; i++) {
    var rowChanged = false;
    if (atualizarArea && String(rows[i][areaIndex]) === String(area)) {
      rows[i][sequenciaAreaIndex] = sequenciaArea;
      rowChanged = true;
    }
    if (
      atualizarSetor &&
      String(rows[i][areaIndex]) === String(area) &&
      String(rows[i][setorIndex]) === String(setor)
    ) {
      rows[i][sequenciaSetorIndex] = sequenciaSetor;
      rowChanged = true;
    }
    if (rowChanged && modifiedIndex !== -1) rows[i][modifiedIndex] = now;
    houveAlteracao = houveAlteracao || rowChanged;
    valoresArea.push([rows[i][sequenciaAreaIndex]]);
    valoresSetor.push([rows[i][sequenciaSetorIndex]]);
    if (modifiedIndex !== -1) valoresModificacao.push([rows[i][modifiedIndex]]);
  }

  if (atualizarArea) {
    sheet.getRange(2, sequenciaAreaIndex + 1, valoresArea.length, 1).setValues(valoresArea);
  }
  if (atualizarSetor) {
    sheet.getRange(2, sequenciaSetorIndex + 1, valoresSetor.length, 1).setValues(valoresSetor);
  }
  if (houveAlteracao && modifiedIndex !== -1) {
    sheet.getRange(2, modifiedIndex + 1, valoresModificacao.length, 1)
      .setValues(valoresModificacao)
      .setNumberFormat('dd/MM/yyyy HH:mm:ss');
  }
}

function verifyEntitySequences_(
  ss,
  area,
  setor,
  sequenciaArea,
  sequenciaSetor,
  verificarArea,
  verificarSetor
) {
  if (!verificarArea && !verificarSetor) return true;
  var sheet = ss.getSheetByName('Analises');
  if (!sheet || sheet.getLastRow() < 2) return false;
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var areaIndex = headers.indexOf('Area');
  var setorIndex = headers.indexOf('Setor');
  var sequenciaAreaIndex = headers.indexOf('Sequencia_Area');
  var sequenciaSetorIndex = headers.indexOf('Sequencia_Setor');
  if (areaIndex === -1 || setorIndex === -1 || sequenciaAreaIndex === -1 || sequenciaSetorIndex === -1) {
    return false;
  }

  var encontrouArea = false;
  var encontrouSetor = false;
  for (var i = 1; i < rows.length; i++) {
    var mesmaArea = String(rows[i][areaIndex]) === String(area);
    var mesmoSetor = mesmaArea && String(rows[i][setorIndex]) === String(setor);
    if (mesmaArea) {
      encontrouArea = true;
      if (verificarArea && String(rows[i][sequenciaAreaIndex] || '') !== String(sequenciaArea || '')) {
        return false;
      }
    }
    if (mesmoSetor) {
      encontrouSetor = true;
      if (verificarSetor && String(rows[i][sequenciaSetorIndex] || '') !== String(sequenciaSetor || '')) {
        return false;
      }
    }
  }
  return (!verificarArea || encontrouArea) && (!verificarSetor || encontrouSetor);
}

function writeFieldsByField_(
  ss,
  sheetName,
  fieldName,
  fieldValue,
  fields,
  appendIfMissing
) {
  var meta = getSheetMeta_(ss, sheetName);
  if (!meta || meta.sheet.getLastRow() < 1) return false;
  var sheet = meta.sheet;
  var lastColumn = meta.lastColumn;
  var headers = meta.headers;
  var fieldIndex = headers.indexOf(fieldName);
  if (fieldIndex === -1) {
    throw new Error('A coluna de identificação ' + fieldName + ' não foi encontrada em ' + sheetName + '.');
  }

  var fieldNames = Object.keys(fields);
  fieldNames.forEach(function(name) {
    if (headers.indexOf(name) === -1) {
      throw new Error('A coluna ' + name + ' não foi encontrada em ' + sheetName + '.');
    }
  });

  var targetRow = findRowNumberByField_(ss, sheetName, fieldName, fieldValue);

  if (targetRow === -1 && !appendIfMissing) return false;
  var rowValues = targetRow === -1
    ? new Array(lastColumn).fill('')
    : sheet.getRange(targetRow, 1, 1, lastColumn).getValues()[0];
  fieldNames.forEach(function(name) {
    rowValues[headers.indexOf(name)] = fields[name] == null ? '' : fields[name];
  });

  var now = new Date();
  var creationIndex = headers.indexOf('Data_Criacao');
  var modifiedIndex = headers.indexOf('Data_Ultima_Modificacao');
  if (targetRow === -1 && creationIndex !== -1 && !parseTimestampValue_(rowValues[creationIndex])) {
    rowValues[creationIndex] = now;
  }
  if (modifiedIndex !== -1) rowValues[modifiedIndex] = now;

  if (targetRow === -1) {
    targetRow = sheet.getLastRow() + 1;
    sheet.getRange(targetRow, 1, 1, lastColumn).setValues([rowValues]);
  } else {
    sheet.getRange(targetRow, 1, 1, lastColumn).setValues([rowValues]);
  }
  return targetRow;
}

function getRecordByField_(ss, sheetName, fieldName, fieldValue) {
  var meta = getSheetMeta_(ss, sheetName);
  if (!meta) return null;
  var rowNumber = findRowNumberByField_(ss, sheetName, fieldName, fieldValue);
  if (rowNumber === -1) return null;
  var values = meta.sheet.getRange(rowNumber, 1, 1, meta.lastColumn).getDisplayValues()[0];
  var record = {};
  meta.headers.forEach(function(header, index) { record[header] = values[index]; });
  return record;
}

function findAreaByName_(ss, name) {
  var normalized = normalizeEntityName_(name);
  if (!normalized) return null;
  var areas = getDataFromSheet(ss, 'Areas');
  for (var i = 0; i < areas.length; i++) {
    if (normalizeEntityName_(areas[i].Nome) === normalized) return areas[i];
  }
  return null;
}

function findSetorByName_(ss, idArea, name) {
  var normalized = normalizeEntityName_(name);
  if (!idArea || !normalized) return null;
  var setores = getDataFromSheet(ss, 'Setores');
  for (var i = 0; i < setores.length; i++) {
    if (
      String(setores[i].ID_Area) === String(idArea) &&
      normalizeEntityName_(setores[i].Nome) === normalized
    ) {
      return setores[i];
    }
  }
  return null;
}

function requireEntityName_(value, label) {
  var name = String(value == null ? '' : value).trim();
  if (!name) throw new Error(label + ' deve ser informado.');
  return name;
}

function resolveAreaForAnalysis_(ss, data) {
  var area = data.idArea
    ? getRecordByField_(ss, 'Areas', 'ID_Area', data.idArea)
    : findAreaByName_(ss, data.area);
  if (area) {
    area.__sequenceChanged = false;
    if (Object.prototype.hasOwnProperty.call(data, 'sequenciaArea')) {
      var areaSequence = normalizeSequence_(data.sequenciaArea);
      area.__sequenceChanged = safeSequence_(area.Sequencia) !== areaSequence;
      if (area.__sequenceChanged) {
        writeFieldsByField_(ss, 'Areas', 'ID_Area', area.ID_Area, {
          ID_Area: area.ID_Area,
          Nome: area.Nome,
          Sequencia: areaSequence
        }, false);
        updateAnalysisRowsHierarchy_(ss, area.Nome, null, {
          Sequencia_Area: areaSequence
        });
      }
      area.Sequencia = areaSequence;
    }
    return area;
  }

  var name = requireEntityName_(data.area, 'A Área');
  area = {
    ID_Area: data.idArea || createEntityId_('AREA'),
    Nome: name,
    Sequencia: requireNewSequence_(data.sequenciaArea, 'A sequência da Área')
  };
  writeFieldsByField_(ss, 'Areas', 'ID_Area', area.ID_Area, area, true);
  area.__sequenceChanged = true;
  return area;
}

function resolveSetorForAnalysis_(ss, data, area) {
  var setor = data.idSetor
    ? getRecordByField_(ss, 'Setores', 'ID_Setor', data.idSetor)
    : findSetorByName_(ss, area.ID_Area, data.setor);
  if (setor && String(setor.ID_Area) !== String(area.ID_Area)) {
    throw new Error('O Setor selecionado não pertence à Área escolhida.');
  }
  if (!setor) {
    var name = requireEntityName_(data.setor, 'O Setor');
    setor = {
      ID_Setor: data.idSetor || createEntityId_('SETOR'),
      ID_Area: area.ID_Area,
      Nome: name,
      Sequencia: requireNewSequence_(data.sequenciaSetor, 'A sequência do Setor')
    };
    writeFieldsByField_(ss, 'Setores', 'ID_Setor', setor.ID_Setor, setor, true);
    setor.__sequenceChanged = true;
  } else if (Object.prototype.hasOwnProperty.call(data, 'sequenciaSetor')) {
    var setorSequence = normalizeSequence_(data.sequenciaSetor);
    setor.__sequenceChanged = safeSequence_(setor.Sequencia) !== setorSequence;
    if (setor.__sequenceChanged) {
      writeFieldsByField_(ss, 'Setores', 'ID_Setor', setor.ID_Setor, {
        ID_Setor: setor.ID_Setor,
        ID_Area: setor.ID_Area,
        Nome: setor.Nome,
        Sequencia: setorSequence
      }, false);
      updateAnalysisRowsHierarchy_(ss, area.Nome, setor.Nome, {
        Sequencia_Setor: setorSequence
      });
    }
    setor.Sequencia = setorSequence;
  } else {
    setor.__sequenceChanged = false;
  }
  return setor;
}

function updateAnalysisRowsHierarchy_(ss, oldArea, oldSetor, updates) {
  var sheet = ss.getSheetByName('Analises');
  if (!sheet || sheet.getLastRow() < 2) return [];
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  var rows = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  var headers = rows[0];
  var areaIndex = headers.indexOf('Area');
  var setorIndex = headers.indexOf('Setor');
  var idIndex = headers.indexOf('ID_Analise');
  var modifiedIndex = headers.indexOf('Data_Ultima_Modificacao');
  if (areaIndex === -1 || setorIndex === -1 || idIndex === -1) {
    throw new Error('A aba Analises não possui as colunas de hierarquia esperadas.');
  }

  var updateNames = Object.keys(updates);
  updateNames.forEach(function(name) {
    if (headers.indexOf(name) === -1) {
      throw new Error('A coluna ' + name + ' não foi encontrada na aba Analises.');
    }
  });

  var changed = false;
  var ids = [];
  for (var i = 1; i < rows.length; i++) {
    var sameArea = String(rows[i][areaIndex]) === String(oldArea);
    var sameSetor = oldSetor == null || String(rows[i][setorIndex]) === String(oldSetor);
    if (!sameArea || !sameSetor) continue;
    updateNames.forEach(function(name) {
      rows[i][headers.indexOf(name)] = updates[name] == null ? '' : updates[name];
    });
    if (modifiedIndex !== -1) rows[i][modifiedIndex] = new Date();
    ids.push(String(rows[i][idIndex]));
    changed = true;
  }
  if (changed) {
    sheet.getRange(2, 1, lastRow - 1, lastColumn).setValues(rows.slice(1));
  }
  return ids;
}

function analysisExistsByHierarchy_(ss, area, setor) {
  var records = getDataFromSheet(ss, 'Analises');
  return records.some(function(record) {
    return String(record.Area) === String(area) &&
      (setor == null || String(record.Setor) === String(setor));
  });
}

function saveAreaEntity_(ss, data, isEdit) {
  var name = requireEntityName_(data.nomeArea, 'O nome da Área');
  var sequence = normalizeSequence_(data.sequenciaArea);
  if (!isEdit) sequence = requireNewSequence_(sequence, 'A sequência da Área');
  if (!isEdit) {
    var existingById = getRecordByField_(ss, 'Areas', 'ID_Area', data.idArea);
    if (existingById) {
      if (normalizeEntityName_(existingById.Nome) !== normalizeEntityName_(name)) {
        throw new Error('O ID da Área já existe com outro nome.');
      }
      writeFieldsByField_(ss, 'Areas', 'ID_Area', existingById.ID_Area, {
        ID_Area: existingById.ID_Area,
        Nome: existingById.Nome,
        Sequencia: sequence
      }, false);
      updateAnalysisRowsHierarchy_(ss, existingById.Nome, null, {
        Sequencia_Area: sequence
      });
      return { id: existingById.ID_Area, nome: existingById.Nome, sequencia: sequence };
    }
    if (findAreaByName_(ss, name)) {
      throw new Error('Esta Área já está cadastrada. Selecione-a na lista para acessá-la.');
    }
    var id = data.idArea || createEntityId_('AREA');
    writeFieldsByField_(ss, 'Areas', 'ID_Area', id, {
      ID_Area: id,
      Nome: name,
      Sequencia: sequence
    }, true);
    return { id: id, nome: name, sequencia: sequence };
  }

  var source = getRecordByField_(ss, 'Areas', 'ID_Area', data.idArea);
  if (!source && data.targetAreaId) {
    var completedTarget = getRecordByField_(ss, 'Areas', 'ID_Area', data.targetAreaId);
    if (completedTarget) {
      writeFieldsByField_(ss, 'Areas', 'ID_Area', completedTarget.ID_Area, {
        ID_Area: completedTarget.ID_Area,
        Nome: completedTarget.Nome,
        Sequencia: sequence
      }, false);
      updateAnalysisRowsHierarchy_(ss, completedTarget.Nome, null, {
        Sequencia_Area: sequence
      });
      return {
        id: completedTarget.ID_Area,
        nome: completedTarget.Nome,
        sequencia: sequence
      };
    }
  }
  if (!source) throw new Error('A Área original não foi encontrada para edição.');
  var target = data.targetAreaId
    ? getRecordByField_(ss, 'Areas', 'ID_Area', data.targetAreaId)
    : findAreaByName_(ss, name);
  if (target && String(target.ID_Area) === String(source.ID_Area)) target = null;

  if (target) {
    var targetName = target.Nome;
    writeFieldsByField_(ss, 'Areas', 'ID_Area', target.ID_Area, {
      ID_Area: target.ID_Area,
      Nome: targetName,
      Sequencia: sequence
    }, false);

    var sourceSetores = getDataFromSheet(ss, 'Setores').filter(function(setor) {
      return String(setor.ID_Area) === String(source.ID_Area);
    });
    sourceSetores.forEach(function(sourceSetor) {
      var targetSetor = findSetorByName_(ss, target.ID_Area, sourceSetor.Nome);
      if (targetSetor) {
        updateAnalysisRowsHierarchy_(ss, source.Nome, sourceSetor.Nome, {
          Area: targetName,
          Setor: targetSetor.Nome,
          Sequencia_Area: sequence,
          Sequencia_Setor: safeSequence_(targetSetor.Sequencia)
        });
        deleteRowByField(ss, 'Setores', 'ID_Setor', sourceSetor.ID_Setor);
      } else {
        writeFieldsByField_(ss, 'Setores', 'ID_Setor', sourceSetor.ID_Setor, {
          ID_Setor: sourceSetor.ID_Setor,
          ID_Area: target.ID_Area,
          Nome: sourceSetor.Nome,
          Sequencia: safeSequence_(sourceSetor.Sequencia)
        }, false);
        updateAnalysisRowsHierarchy_(ss, source.Nome, sourceSetor.Nome, {
          Area: targetName,
          Sequencia_Area: sequence,
          Sequencia_Setor: safeSequence_(sourceSetor.Sequencia)
        });
      }
    });
    updateAnalysisRowsHierarchy_(ss, source.Nome, null, {
      Area: targetName,
      Sequencia_Area: sequence
    });
    updateAnalysisRowsHierarchy_(ss, targetName, null, {
      Sequencia_Area: sequence
    });
    deleteRowByField(ss, 'Areas', 'ID_Area', source.ID_Area);
    return {
      id: target.ID_Area,
      nome: targetName,
      sequencia: sequence,
      mergedFromId: source.ID_Area,
      nomeAnterior: source.Nome
    };
  }

  var duplicate = findAreaByName_(ss, name);
  if (duplicate && String(duplicate.ID_Area) !== String(source.ID_Area)) {
    throw new Error('Já existe outra Área com este nome.');
  }
  writeFieldsByField_(ss, 'Areas', 'ID_Area', source.ID_Area, {
    ID_Area: source.ID_Area,
    Nome: name,
    Sequencia: sequence
  }, false);
  updateAnalysisRowsHierarchy_(ss, source.Nome, null, {
    Area: name,
    Sequencia_Area: sequence
  });
  return {
    id: source.ID_Area,
    nome: name,
    sequencia: sequence,
    nomeAnterior: source.Nome
  };
}

function saveSetorEntity_(ss, data, isEdit) {
  var area = getRecordByField_(ss, 'Areas', 'ID_Area', data.idArea);
  if (!area && data.nomeArea) {
    area = findAreaByName_(ss, data.nomeArea);
  }
  if (!area && data.nomeArea) {
    area = {
      ID_Area: data.idArea || createEntityId_('AREA'),
      Nome: requireEntityName_(data.nomeArea, 'O nome da Área'),
      Sequencia: requireNewSequence_(data.sequenciaArea, 'A sequência da Área')
    };
    writeFieldsByField_(ss, 'Areas', 'ID_Area', area.ID_Area, area, true);
  }
  if (!area) throw new Error('A Área selecionada não foi encontrada.');
  var areaSequence = Object.prototype.hasOwnProperty.call(data, 'sequenciaArea')
    ? normalizeSequence_(data.sequenciaArea)
    : safeSequence_(area.Sequencia);
  writeFieldsByField_(ss, 'Areas', 'ID_Area', area.ID_Area, {
    ID_Area: area.ID_Area,
    Nome: area.Nome,
    Sequencia: areaSequence
  }, false);
  updateAnalysisRowsHierarchy_(ss, area.Nome, null, {
    Sequencia_Area: areaSequence
  });
  area.Sequencia = areaSequence;
  var name = requireEntityName_(data.nomeSetor, 'O nome do Setor');
  var sequence = normalizeSequence_(data.sequenciaSetor);
  if (!isEdit) sequence = requireNewSequence_(sequence, 'A sequência do Setor');

  if (!isEdit) {
    var existingById = getRecordByField_(ss, 'Setores', 'ID_Setor', data.idSetor);
    if (existingById) {
      if (
        String(existingById.ID_Area) !== String(area.ID_Area) ||
        normalizeEntityName_(existingById.Nome) !== normalizeEntityName_(name)
      ) {
        throw new Error('O ID do Setor já existe com outra Área ou nome.');
      }
      writeFieldsByField_(ss, 'Setores', 'ID_Setor', existingById.ID_Setor, {
        ID_Setor: existingById.ID_Setor,
        ID_Area: existingById.ID_Area,
        Nome: existingById.Nome,
        Sequencia: sequence
      }, false);
      updateAnalysisRowsHierarchy_(ss, area.Nome, existingById.Nome, {
        Sequencia_Area: safeSequence_(area.Sequencia),
        Sequencia_Setor: sequence
      });
      return {
        id: existingById.ID_Setor,
        idArea: area.ID_Area,
        areaNome: area.Nome,
        nome: existingById.Nome,
        sequencia: sequence
      };
    }
    if (findSetorByName_(ss, area.ID_Area, name)) {
      throw new Error('Este Setor já está cadastrado nesta Área.');
    }
    var id = data.idSetor || createEntityId_('SETOR');
    writeFieldsByField_(ss, 'Setores', 'ID_Setor', id, {
      ID_Setor: id,
      ID_Area: area.ID_Area,
      Nome: name,
      Sequencia: sequence
    }, true);
    return {
      id: id,
      idArea: area.ID_Area,
      areaNome: area.Nome,
      nome: name,
      sequencia: sequence
    };
  }

  var source = getRecordByField_(ss, 'Setores', 'ID_Setor', data.idSetor);
  if (!source && data.targetSetorId) {
    var completedTarget = getRecordByField_(ss, 'Setores', 'ID_Setor', data.targetSetorId);
    if (completedTarget && String(completedTarget.ID_Area) === String(area.ID_Area)) {
      writeFieldsByField_(ss, 'Setores', 'ID_Setor', completedTarget.ID_Setor, {
        ID_Setor: completedTarget.ID_Setor,
        ID_Area: completedTarget.ID_Area,
        Nome: completedTarget.Nome,
        Sequencia: sequence
      }, false);
      updateAnalysisRowsHierarchy_(ss, area.Nome, completedTarget.Nome, {
        Sequencia_Area: safeSequence_(area.Sequencia),
        Sequencia_Setor: sequence
      });
      return {
        id: completedTarget.ID_Setor,
        idArea: area.ID_Area,
        areaNome: area.Nome,
        nome: completedTarget.Nome,
        sequencia: sequence
      };
    }
  }
  if (!source) throw new Error('O Setor original não foi encontrado para edição.');
  var sourceArea = getRecordByField_(ss, 'Areas', 'ID_Area', source.ID_Area);
  if (!sourceArea) throw new Error('A Área original do Setor não foi encontrada.');
  var target = data.targetSetorId
    ? getRecordByField_(ss, 'Setores', 'ID_Setor', data.targetSetorId)
    : findSetorByName_(ss, area.ID_Area, name);
  if (target && String(target.ID_Setor) === String(source.ID_Setor)) target = null;

  if (target) {
    if (String(target.ID_Area) !== String(area.ID_Area)) {
      throw new Error('O Setor de destino não pertence à Área escolhida.');
    }
    writeFieldsByField_(ss, 'Setores', 'ID_Setor', target.ID_Setor, {
      ID_Setor: target.ID_Setor,
      ID_Area: target.ID_Area,
      Nome: target.Nome,
      Sequencia: sequence
    }, false);
    updateAnalysisRowsHierarchy_(ss, sourceArea.Nome, source.Nome, {
      Area: area.Nome,
      Setor: target.Nome,
      Sequencia_Area: safeSequence_(area.Sequencia),
      Sequencia_Setor: sequence
    });
    updateAnalysisRowsHierarchy_(ss, area.Nome, target.Nome, {
      Sequencia_Area: safeSequence_(area.Sequencia),
      Sequencia_Setor: sequence
    });
    deleteRowByField(ss, 'Setores', 'ID_Setor', source.ID_Setor);
    return {
      id: target.ID_Setor,
      idArea: area.ID_Area,
      areaNome: area.Nome,
      nome: target.Nome,
      sequencia: sequence,
      mergedFromId: source.ID_Setor,
      areaAnterior: sourceArea.Nome,
      nomeAnterior: source.Nome
    };
  }

  var duplicate = findSetorByName_(ss, area.ID_Area, name);
  if (duplicate && String(duplicate.ID_Setor) !== String(source.ID_Setor)) {
    throw new Error('Já existe outro Setor com este nome na Área selecionada.');
  }
  writeFieldsByField_(ss, 'Setores', 'ID_Setor', source.ID_Setor, {
    ID_Setor: source.ID_Setor,
    ID_Area: area.ID_Area,
    Nome: name,
    Sequencia: sequence
  }, false);
  updateAnalysisRowsHierarchy_(ss, sourceArea.Nome, source.Nome, {
    Area: area.Nome,
    Setor: name,
    Sequencia_Area: safeSequence_(area.Sequencia),
    Sequencia_Setor: sequence
  });
  return {
    id: source.ID_Setor,
    idArea: area.ID_Area,
    areaNome: area.Nome,
    nome: name,
    sequencia: sequence,
    areaAnterior: sourceArea.Nome,
    nomeAnterior: source.Nome
  };
}

function deleteAreasCascade_(ss, ids) {
  var idsMap = {};
  ids.forEach(function(id) { idsMap[String(id)] = true; });
  var areaNames = {};
  getDataFromSheet(ss, 'Areas').forEach(function(area) {
    if (idsMap[String(area.ID_Area)]) areaNames[String(area.Nome)] = true;
  });
  var analysisIds = getDataFromSheet(ss, 'Analises')
    .filter(function(analysis) { return areaNames[String(analysis.Area)] === true; })
    .map(function(analysis) { return String(analysis.ID_Analise); });
  deleteRowsByFieldValues(ss, 'Setores', 'ID_Area', ids);
  deleteRowsByFieldValues(ss, 'Areas', 'ID_Area', ids);
  deleteRowsByFieldValues(ss, 'Analises', 'ID_Analise', analysisIds);
  deleteRowsByFieldValues(ss, 'Contagens', 'ID_Analise', analysisIds);
  return { analysisIds: analysisIds };
}

function deleteSetoresCascade_(ss, ids) {
  var idsMap = {};
  ids.forEach(function(id) { idsMap[String(id)] = true; });
  var areasById = {};
  getDataFromSheet(ss, 'Areas').forEach(function(area) {
    areasById[String(area.ID_Area)] = String(area.Nome);
  });
  var selectedGroups = {};
  getDataFromSheet(ss, 'Setores').forEach(function(setor) {
    if (!idsMap[String(setor.ID_Setor)]) return;
    var areaName = areasById[String(setor.ID_Area)];
    if (areaName != null) selectedGroups[areaName + '\u0000' + String(setor.Nome)] = true;
  });
  var analysisIds = getDataFromSheet(ss, 'Analises')
    .filter(function(analysis) {
      return selectedGroups[String(analysis.Area) + '\u0000' + String(analysis.Setor)] === true;
    })
    .map(function(analysis) { return String(analysis.ID_Analise); });
  deleteRowsByFieldValues(ss, 'Setores', 'ID_Setor', ids);
  deleteRowsByFieldValues(ss, 'Analises', 'ID_Analise', analysisIds);
  deleteRowsByFieldValues(ss, 'Contagens', 'ID_Analise', analysisIds);
  return { analysisIds: analysisIds };
}

function deleteRowByField(ss, sheetName, fieldName, fieldValue) {
  var meta = getSheetMeta_(ss, sheetName);
  if (!meta || meta.sheet.getLastRow() < 2) return 0;
  var colIndex = meta.headers.indexOf(fieldName);
  if (colIndex === -1) return 0;
  var text = String(fieldValue == null ? '' : fieldValue);
  if (!text) return 0;
  var matches = meta.sheet
    .getRange(2, colIndex + 1, meta.sheet.getLastRow() - 1, 1)
    .createTextFinder(text)
    .matchEntireCell(true)
    .matchCase(true)
    .findAll();
  var rowsToDelete = matches.map(function(match) { return match.getRow(); })
    .sort(function(a, b) { return b - a; });
  rowsToDelete.forEach(function(rowNumber) { meta.sheet.deleteRow(rowNumber); });
  return rowsToDelete.length;
}

function deleteRowsByField(ss, sheetName, fieldName, fieldValue) {
  return deleteRowByField(ss, sheetName, fieldName, fieldValue);
}

function deleteRowsByFieldValues(ss, sheetName, fieldName, fieldValues) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2 || !fieldValues || fieldValues.length === 0) return 0;

  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var colIndex = headers.indexOf(fieldName);
  if (colIndex === -1) return 0;

  var valuesMap = {};
  fieldValues.forEach(function(value) {
    valuesMap[String(value)] = true;
  });

  var rowsToDelete = [];
  for (var i = 1; i < rows.length; i++) {
    if (valuesMap[String(rows[i][colIndex])]) rowsToDelete.push(i + 1);
  }
  if (rowsToDelete.length === 0) return 0;

  rowsToDelete.sort(function(a, b) { return b - a; });
  var blockStart = rowsToDelete[0];
  var blockEnd = rowsToDelete[0];

  for (var r = 1; r < rowsToDelete.length; r++) {
    var rowNumber = rowsToDelete[r];
    if (rowNumber === blockStart - 1) {
      blockStart = rowNumber;
    } else {
      sheet.deleteRows(blockStart, blockEnd - blockStart + 1);
      blockStart = rowNumber;
      blockEnd = rowNumber;
    }
  }
  sheet.deleteRows(blockStart, blockEnd - blockStart + 1);
  return rowsToDelete.length;
}

function updateRowByField(ss, sheetName, fieldName, fieldValue, rowData) {
  var meta = getSheetMeta_(ss, sheetName);
  if (!meta) return false;
  var rowNumber = findRowNumberByField_(ss, sheetName, fieldName, fieldValue);
  if (rowNumber === -1) return false;
  var fullRow = meta.sheet.getRange(rowNumber, 1, 1, meta.lastColumn).getValues()[0];
  for (var j = 0; j < Math.min(rowData.length, fullRow.length); j++) fullRow[j] = rowData[j];
  var modifiedIndex = meta.headers.indexOf('Data_Ultima_Modificacao');
  if (modifiedIndex !== -1) fullRow[modifiedIndex] = new Date();
  meta.sheet.getRange(rowNumber, 1, 1, meta.lastColumn).setValues([fullRow]);
  return true;
}

function rowExistsByField(ss, sheetName, fieldName, fieldValue) {
  return findRowNumberByField_(ss, sheetName, fieldName, fieldValue) !== -1;
}

function verifyFieldsByField(ss, sheetName, fieldName, fieldValue, expectedFields) {
  var rowNumber = findRowNumberByField_(ss, sheetName, fieldName, fieldValue);
  if (rowNumber === -1) return false;
  return verifyFieldsAtRow_(ss, sheetName, rowNumber, expectedFields);
}

// Confirma diretamente a linha recém-gravada. Como o doPost mantém o ScriptLock
// até o fim, nenhuma outra inclusão pelo aplicativo pode deslocar essa linha.
function verifyFieldsAtRow_(ss, sheetName, rowNumber, expectedFields) {
  var meta = getSheetMeta_(ss, sheetName);
  if (!meta || rowNumber < 2 || rowNumber > meta.sheet.getLastRow()) return false;
  var row = meta.sheet.getRange(rowNumber, 1, 1, meta.lastColumn).getDisplayValues()[0];
  var fieldNames = Object.keys(expectedFields);
  for (var j = 0; j < fieldNames.length; j++) {
    var expectedField = fieldNames[j];
    var expectedIndex = meta.headers.indexOf(expectedField);
    if (expectedIndex === -1) return false;
    var actualValue = row[expectedIndex] == null ? '' : row[expectedIndex];
    var expectedValue = expectedFields[expectedField] == null ? '' : expectedFields[expectedField];
    if (String(actualValue) !== String(expectedValue)) return false;
  }
  return true;
}

function updateOrAppendRow(ss, sheetName, fieldName, fieldValue, rowData) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    appendRowToSheet(ss, sheetName, rowData);
    return;
  }
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var colIndex = headers.indexOf(fieldName);
  if (colIndex === -1) {
    sheet.appendRow(rowData);
    return;
  }
  var found = false;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][colIndex]) === String(fieldValue)) {
      for (var j = 0; j < rowData.length; j++) {
        sheet.getRange(i + 1, j + 1).setValue(rowData[j]);
      }
      found = true;
      break;
    }
  }
  if (!found) {
    sheet.appendRow(rowData);
  }
}

function updateContagemRow(ss, sheetName, fieldName, fieldValue, tempoTotal, obs, valores) {
  var meta = getSheetMeta_(ss, sheetName);
  if (!meta) return false;
  var rowNumber = findRowNumberByField_(ss, sheetName, fieldName, fieldValue);
  if (rowNumber === -1) return false;
  var row = meta.sheet.getRange(rowNumber, 1, 1, meta.lastColumn).getValues()[0];
  row[meta.headers.indexOf('Tempo_Total')] = tempoTotal;
  row[meta.headers.indexOf('Observacoes')] = obs;
  for (var v = 0; v < valores.length; v++) {
    var colName = 'Campo_' + (v + 1) + '_Valor';
    var cIdx = meta.headers.indexOf(colName);
    if (cIdx !== -1) row[cIdx] = valores[v] || '';
  }
  var modifiedIndex = meta.headers.indexOf('Data_Ultima_Modificacao');
  if (modifiedIndex !== -1) row[modifiedIndex] = new Date();
  meta.sheet.getRange(rowNumber, 1, 1, meta.lastColumn).setValues([row]);
  return true;
}