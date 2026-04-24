import type { Strings } from './en'

/**
 * Brazilian Portuguese (pt-BR) bundle. Must satisfy the `Strings` type from
 * en.ts — TypeScript will fail the build if any key is missing or has the
 * wrong shape.
 *
 * Translation conventions:
 * - "Workspace" → "Espaço de trabalho" (the project's product term).
 * - "Terminal" stays "Terminal" (singular) / "Terminais" (plural).
 * - "Claudinha" is a proper noun — never translated.
 * - "Claude Code" stays in English (product name).
 * - Keyboard shortcuts ("Cmd", "Shift", etc.) stay in English.
 */
export const ptBR: Strings = {
  app: {
    name: 'Claudinha',
    tagline: 'Um gerenciador de terminais para o Claude Code',
    managementTitle: 'Claudinha: Gerenciamento'
  },
  workspace: {
    singular: 'Espaço de trabalho',
    plural: 'Espaços de trabalho',
    active: 'Espaços de trabalho ativos',
    dormant: 'Pausado',
    archived: 'Arquivado',
    create: 'Novo espaço de trabalho',
    close: 'Fechar espaço de trabalho',
    archive: 'Arquivar espaço de trabalho',
    archiveConfirmTitle: 'Arquivar este espaço de trabalho?',
    failedToCreate: 'Falha ao criar espaço de trabalho.'
  },
  pane: {
    singular: 'Terminal',
    plural: 'Terminais',
    count: (n: number): string => (n === 1 ? '1 terminal' : `${n} terminais`),
    create: 'Novo terminal',
    openVerb: 'Abrir',
    opening: 'Abrindo…',
    clear: 'Fechar terminal',
    transplant: 'Mover terminal',
    tend: 'Focar',
    tending: 'Abrindo…',
    dormant: 'Terminal pausado',
    dormantPlural: 'Terminais pausados',
    snapshotCount: (n: number): string =>
      n === 1 ? '1 instantâneo de terminal pausado' : `${n} instantâneos de terminal pausado`
  },
  toolbar: {
    backToManagement: 'Voltar para Claudinha',
    newTerminal: 'Novo Terminal',
    clearTree: 'Fechar Terminal',
    transnewTerminal: 'Mover Terminal',
    prevNextTree: 'Terminal Ant./Próx.',
    moveFocus: 'Mover Foco',
    cycleEffort: 'Alternar Esforço Global'
  },
  windowPicker: {
    title: 'Mover terminal',
    newGrove: 'Novo espaço de trabalho'
  },
  spawn: {
    title: 'Novo terminal',
    submit: 'Abrir',
    submitting: 'Abrindo…'
  },
  launchForm: {
    headline: 'Crie um espaço de trabalho e abra terminais',
    paneCount: 'Quantidade de terminais',
    paneLabel: (i: number): string => `Terminal ${i + 1}`,
    perTreeNote: '(deixe em branco para escolher por terminal)',
    submitLabel: (n: number): string =>
      n === 1
        ? 'Criar espaço de trabalho com 1 terminal'
        : `Criar espaço de trabalho com ${n} terminais`,
    failedToLaunch: 'Falha ao criar espaço de trabalho.'
  },
  configuration: {
    sectionAnalytics: 'Telemetria',
    sectionStartup: 'Inicialização',
    sectionNotifications: 'Notificações',
    sectionPanes: 'Terminais',
    sectionDefaults: 'Padrões',
    sectionLanguage: 'Idioma',
    languageHint:
      'Idioma da interface da Claudinha. Atalhos do teclado e a saída do terminal permanecem em inglês.',
    languageEnglish: 'English',
    languagePortuguese: 'Português',
    title: 'Configuração',
    loading: 'Carregando preferências…',
    resetButton: 'Restaurar todas as preferências para o padrão',
    resetConfirm:
      'Restaurar todas as preferências da Claudinha para o padrão? Isso não afeta o consentimento de telemetria nem as permissões.',
    telemetryLabel: 'Telemetria',
    telemetryHint: 'Métricas de uso anônimas ajudam a melhorar a Claudinha. Você pode mudar isso a qualquer momento.',
    on: 'Ativada',
    off: 'Desativada',
    autoRestoreLabel: 'Restaurar última sessão automaticamente',
    autoRestoreHint: 'Ao iniciar, reabrir o espaço de trabalho fechado mais recentemente e retomar seus terminais ativos.',
    playSoundsLabel: 'Reproduzir sons de status',
    playSoundsHint: 'Interruptor geral — quando desativado, nenhum som é reproduzido, independente dos controles por status.',
    volumeLabel: 'Volume',
    volumeMute: 'Silenciar',
    volumeLow: 'Baixo',
    volumeMed: 'Médio',
    volumeHigh: 'Alto',
    volumeMax: 'Máx',
    soundOnNeedsInputLabel: 'Quando um terminal precisa de entrada',
    soundOnDoneLabel: 'Quando um terminal termina',
    showToolCountsLabel: 'Mostrar barra de contagem de ferramentas',
    showToolCountsHint: 'Exibe a linha de contagens de uso por ferramenta (ex.: Read 30 · Edit 15) no cabeçalho de cada terminal.',
    defaultModelShortLabel: 'Modelo padrão para novos terminais',
    defaultModelShortHint: 'Pré-seleciona o modelo no formulário de criação. Você ainda pode trocar por terminal.',
    defaultViewModeLabel: 'Modo de visualização padrão para novos espaços de trabalho',
    defaultViewModeHint: 'Pré-seleciona o bloco Mural/Kanban no formulário de criação. Cada espaço de trabalho ainda pode ser alternado pela barra de título.',
    modelNone: 'Nenhum',
    viewModeWall: 'Mural',
    viewModeKanban: 'Kanban',
    resumeHint:
      'Ao iniciar, reabrir o último espaço de trabalho fechado e retomar seus terminais ativos.',
    needsInputLabel: 'Quando um terminal precisa de entrada',
    finishedLabel: 'Quando um terminal termina',
    defaultModelLabel: 'Modelo padrão para novos terminais',
    defaultModelHint:
      'Pré-seleciona o modelo no formulário de criação. Você ainda pode trocar por terminal.'
  },
  languageToggle: {
    switchToPortuguese: 'Switch to Português',
    switchToEnglish: 'Mudar para English'
  },
  completionBar: {
    mergeAllGrove: 'Mesclar todos (este espaço de trabalho) · rebase-ff',
    noGroveContext: 'Sem contexto de espaço de trabalho para este terminal.',
    createPrsGrove: 'Criar PRs para todos (este espaço de trabalho)',
    createDraftPrsGrove: 'Criar PRs em rascunho para todos (este espaço de trabalho)'
  },
  status: {
    awaiting: 'Aguardando entrada',
    working: 'Trabalhando',
    needsInput: 'Precisa de entrada',
    done: 'Concluído',
    lost: 'Perdido'
  },
  empty: {
    workspaceBare: 'Este espaço de trabalho está vazio.',
    newTerminalHint: (shortcut: string): string => `Pressione ${shortcut} para abrir um terminal.`,
    noArchivedWorkspaces:
      'Nenhum espaço de trabalho arquivado ainda. Arquivar mantém trabalhos antigos acessíveis.',
    workspacesEmpty: 'Nenhum espaço de trabalho ainda.',
    createFirstWorkspace: 'Crie seu primeiro espaço de trabalho para começar.'
  },
  worktreeWarning:
    'Todos os terminais neste espaço de trabalho compartilham um diretório. Evite editar os mesmos arquivos em múltiplos terminais.',

  managerSidebar: {
    searchPlaceholder: 'Buscar espaços de trabalho…',
    searchAriaLabel: 'Buscar espaços de trabalho',
    clearSearch: 'Limpar busca',
    workspacesListLabel: 'Espaços de trabalho',
    groupActive: 'Ativos',
    groupDormant: 'Pausados',
    groupArchived: 'Arquivados',
    noMatches: 'Nenhuma correspondência',
    newWorkspace: 'Novo espaço de trabalho',
    navPermissions: 'Permissões',
    navConfiguration: 'Configuração'
  },

  managerWindow: {
    title: 'Claudinha: Gerenciamento',
    submitFeedback: 'Enviar Feedback',
    submitFeedbackTooltip: 'Enviar feedback (⌘⇧I)'
  },

  workspaceView: {
    moreActions: 'Mais ações',
    typeGeneral: 'Espaço de trabalho geral',
    typeRepo: 'Espaço de trabalho de repositório',
    typeWorktree: 'Espaço de trabalho de worktree',
    unarchive: 'Desarquivar',
    openWorkspace: 'Abrir espaço de trabalho',
    tendWorkspace: 'Retomar espaço de trabalho',
    panesHeading: 'Terminais',
    paneLabel: (i: number): string => `Terminal ${i + 1}`,
    awaitingOrders: 'Aguardando ordens',
    open: 'Abrir',
    noPanes: 'Sem terminais.',
    dormantPanesHeading: (n: number): string => `Terminais pausados (${n})`,
    deletePermanently: 'Excluir permanentemente',
    archiveWorkspace: 'Arquivar espaço de trabalho',
    paneCountLabel: (n: number): string => (n === 1 ? '1 terminal' : `${n} terminais`)
  },

  launchFormUI: {
    workspaceNameLabel: 'Nome do espaço de trabalho',
    workspaceNamePlaceholder: (n: number): string => `Espaço de trabalho ${n}`,
    repoPathLabel: 'Caminho do repositório',
    repoPathPlaceholderPerTerminal: '(escolhido por terminal abaixo)',
    browse: 'Procurar',
    initGit: 'Inicializar git aqui',
    statusChecking: 'Verificando…',
    statusPathNotFound: 'Caminho não encontrado',
    statusValidNonGit: 'Diretório válido — não é um repositório git',
    statusValidGit: 'Repositório git confirmado',
    terminalsToSpawnLabel: 'Terminais a abrir',
    viewModeLabel: 'Modo de visualização',
    viewModeKanban: 'Kanban',
    viewModeWall: 'Mural',
    advancedSetup: 'Configuração avançada',
    terminalLocationLabel: 'Localização dos terminais',
    locationSingleRepo: 'Todos os terminais no mesmo repo',
    locationPerPane: 'Escolher repo por terminal',
    branchLayoutLabel: 'Layout de branches',
    layoutSeparate: 'Uma branch por terminal',
    layoutShared: 'Compartilhada entre terminais',
    sharedConflictsWarning: '⚠ Cuidado com conflitos quando terminais compartilham uma branch.',
    branchNamingLabel: 'Nomeação de branch',
    namingAuto: 'Automática',
    namingCustom: 'Personalizada',
    perTerminalRepos: 'Repositórios por terminal',
    sharedBranchNameLabel: 'Nome da branch compartilhada',
    sharedBranchPlaceholder: 'feature/foo',
    terminalNameLabel: (i: number): string => `Nome do terminal ${i + 1}`,
    terminalNamePlaceholder: 'Nome da branch (automático se vazio)',
    terminalRepoLabel: (i: number): string => `Repo do terminal ${i + 1}`,
    modelLabel: 'Modelo',
    effortLabel: 'Esforço',
    submitOpening: 'Abrindo…',
    submitLabel: (n: number): string =>
      n === 1
        ? 'Criar espaço de trabalho com 1 terminal'
        : `Criar espaço de trabalho com ${n} terminais`,
    failedFolderPicker: 'Falha ao abrir o seletor de pastas.',
    failedToInitGit: 'Falha ao inicializar o repositório git.',
    repoPathRequired: 'O caminho do repositório é obrigatório.',
    pathMustBeGit: 'O caminho deve ser um repositório git.',
    failedToLaunch: 'Falha ao iniciar o espaço de trabalho.',
    sharedBranchNameLabelExisting: 'Nome da branch da worktree',
    perTerminalRepoAndName: 'Repositório + nome da branch por terminal',
    terminalLabel: (i: number): string => `Terminal ${i + 1}`,
    worktreeBranchNamesLabel: 'Nomes das branches das worktrees',
    perTerminalRepoRequired: (i: number): string => `Terminal ${i + 1}: o caminho do repositório é obrigatório.`,
    perTerminalMustBeGit: (i: number): string => `Terminal ${i + 1}: o caminho deve ser um repositório git.`,
    initGitFailedFmt: (msg: string): string => `Falha ao inicializar o repositório git: ${msg}`
  },

  newWorkspaceModal: {
    title: 'Criar espaço de trabalho',
    cancel: 'Cancelar',
    create: 'Criar',
    creating: 'Criando…',
    typeLabel: 'Tipo',
    repoPathLabel: 'Caminho do repositório',
    repoPathPlaceholder: '/caminho/absoluto/para/o/repo',
    browse: 'Procurar',
    worktreeLabel: 'Worktree / branch',
    worktreesLoading: 'Carregando worktrees…',
    worktreesEmpty: 'Nenhuma worktree encontrada.',
    mainTag: ' (principal)',
    sharedDirWarning: 'Todos os terminais neste espaço de trabalho compartilham um diretório. Evite editar os mesmos arquivos em múltiplos terminais.',
    nameLabel: 'Nome do espaço de trabalho',
    nameHelper: 'Opcional — gerado automaticamente a partir do tipo se vazio',
    namePlaceholder: 'Gerado automaticamente',
    typeGeneral: 'Geral',
    typeRepo: 'Repositório',
    typeWorktree: 'Worktree',
    failedFolderPicker: 'Falha ao abrir o seletor de pastas.',
    failedToCreate: 'Falha ao criar espaço de trabalho.'
  },

  archiveModal: {
    title: 'Arquivar este espaço de trabalho?',
    cancel: 'Cancelar',
    confirm: 'Arquivar',
    bodyIntro: 'Arquivar move o espaço de trabalho para a seção Arquivados. Os terminais são preservados. Você pode desarquivar a qualquer momento.',
    bodySnapshotCount: (n: number): string =>
      n === 1
        ? '1 instantâneo de terminal pausado será preservado.'
        : `${n} instantâneos de terminais pausados serão preservados.`,
    bodyWithSnapshots: (n: number, name: string): string =>
      `“${name}” tem ${n === 1 ? '1 instantâneo de terminal pausado' : `${n} instantâneos de terminal pausados`}. Arquivar mantém-os acessíveis na lista Arquivados — eles não são excluídos.`,
    bodyWithoutSnapshots: (name: string): string =>
      `Arquivar “${name}”? Espaços de trabalho arquivados continuam acessíveis na lista Arquivados e podem ser restaurados a qualquer momento.`
  },

  permanentDeleteModal: {
    title: 'Excluir permanentemente?',
    cancel: 'Cancelar',
    confirm: 'Excluir Permanentemente',
    cannotUndo: 'Isso não pode ser desfeito.',
    snapshotLoss: (n: number): string =>
      n === 1
        ? '1 instantâneo de terminal pausado será perdido permanentemente.'
        : `${n} instantâneos de terminais pausados serão perdidos permanentemente.`,
    typeToConfirm: (name: string): string => `Digite "${name}" para confirmar`,
    bodyWithSnapshots: (n: number, name: string): string =>
      `“${name}” tem ${n === 1 ? '1 instantâneo de terminal pausado' : `${n} instantâneos de terminal pausados`}. A exclusão permanente remove o espaço de trabalho e todos os instantâneos do disco. Esta ação não pode ser desfeita.`,
    bodyWithoutSnapshots: (name: string): string =>
      `Excluir “${name}” permanentemente? Isso remove o espaço de trabalho do disco e não pode ser desfeito.`
  },

  homeView: {
    headline: 'Novo espaço de trabalho'
  },

  windowShell: {
    backTooltip: 'Voltar para Claudinha (⌘⇧M)',
    workspaceNamePlaceholder: 'Espaço de trabalho sem nome',
    workspaceNameAria: 'Nome do espaço de trabalho',
    addTerminal: 'Adicionar terminal',
    moveTerminal: 'Mover terminal',
    closeTerminal: 'Fechar terminal',
    keyboardShortcuts: 'Atalhos do teclado',
    pauseWorkspace: 'Pausar espaço de trabalho',
    closeWorkspace: 'Fechar espaço de trabalho',
    viewWall: 'Mural',
    viewKanban: 'Kanban',
    themeLight: 'Mudar para o tema claro',
    themeDark: 'Mudar para o tema escuro'
  },

  windowPicker: {
    movePaneTitle: 'Mover terminal',
    newWindowOption: 'Novo espaço de trabalho',
    cancel: 'Cancelar',
    headerLabel: 'Transplantar Terminal',
    loading: 'Carregando…'
  },

  spawnDialog: {
    title: 'Novo terminal',
    submit: 'Abrir',
    submitting: 'Abrindo…',
    cancel: 'Cancelar',
    promptLabel: 'Prompt inicial (opcional)',
    promptPlaceholder: 'Diga ao Claude no que começar a trabalhar…',
    modelLabel: 'Modelo',
    effortLabel: 'Esforço',
    failedToCreate: 'Falha ao abrir terminal.',
    launchModeLabel: 'Modo de início',
    modeNewWorktree: 'Nova worktree',
    modeExistingWorktree: 'Worktree existente',
    modeManualPath: 'Caminho manual',
    repoPathLabel: 'Caminho do repositório',
    setByWorkspace: ' (definido pelo espaço de trabalho)',
    browse: 'Procurar',
    worktreeNameLabel: 'Nome da worktree',
    worktreeNameHelper: 'Opcional — gerado automaticamente se vazio',
    selectWorktree: 'Selecionar worktree',
    loadingWorktrees: 'Carregando worktrees…',
    noAdditionalWorktrees: 'Nenhuma worktree adicional encontrada.',
    directoryPathLabel: 'Caminho do diretório',
    failedFolderPicker: 'Falha ao abrir o seletor de pastas.',
    failedToSpawn: 'Falha ao abrir terminal.',
    windowTooSmall: (cols: number, rows: number): string =>
      `Janela pequena demais para outro terminal no tamanho mínimo (${cols}×${rows}). Aumente e tente novamente.`,
    invalidPath: 'Caminho inválido.',
    mainSuffix: ' (principal)',
    titleWithSession: (name: string, title: string): string => `${name} (${title})`
  },

  paneCloseConfirm: {
    title: 'Fechar terminal?',
    cancel: 'Cancelar',
    closeAndDelete: 'Fechar e excluir worktree',
    closeKeepWorktree: 'Fechar (manter worktree)',
    pauseInsteadOfClose: 'Pausar em vez disso',
    bodyDirty: 'Este terminal tem alterações não confirmadas. Fechar irá perdê-las. Você pode pausar para mantê-lo na lista de pausados.',
    bodyClean: 'Este terminal não tem alterações não confirmadas. Fechar encerrará a sessão do Claude e excluirá a worktree.',
    statusLabel: 'Status',
    gitLabel: 'Git',
    warnWorking: 'O agente ainda está rodando. Fechar irá interrompê-lo.',
    warnNeedsInput: 'O agente está esperando sua entrada. Fechar irá descartar o prompt.',
    warnError: 'O terminal está em estado de erro. Fechar não tentará recuperação.',
    cancelKeepOpen: 'Cancelar (manter terminal aberto)',
    clean: 'Limpo',
    resumableHint: 'Terminais fechados continuam retomáveis pelo Gerenciamento (Terminais Pausados).'
  },

  workspaceCloseOverlay: {
    closingTitle: 'Fechando espaço de trabalho…',
    closingBody: 'Finalizando os terminais abertos antes de fechar a janela.',
    paneBreadcrumb: (workspaceName: string, current: number, total: number): string =>
      `Fechando ${workspaceName} · Terminal ${current} de ${total}`,
    managerBreadcrumb: (current: number, total: number): string =>
      `Fechando a Claudinha · Espaço de trabalho ${current} de ${total}`,
    overrideAll: 'Fechar todos os terminais restantes neste espaço de trabalho',
    cancelKeepOpen: 'Cancelar (manter espaço de trabalho aberto)'
  },

  paneHeader: {
    rename: 'Renomear terminal',
    renameAria: 'Nome do terminal',
    renamePlaceholder: 'Terminal sem nome',
    closeTooltip: 'Fechar terminal',
    pauseTooltip: 'Pausar terminal',
    moveTooltip: 'Mover terminal para outra janela',
    modelTooltip: 'Modelo',
    effortTooltip: 'Esforço',
    diffTooltip: 'Ver diff',
    permissionTooltip: 'Permissões',
    statusAwaiting: 'Aguardando entrada',
    statusWorking: 'Trabalhando',
    statusNeedsInput: 'Precisa de entrada',
    statusDone: 'Concluído',
    statusLost: 'Perdido',
    paused: 'Pausado',
    moreActions: 'Mais ações',
    moreActionsTooltip: 'Política · Modelo · Transferir',
    closePane: 'Fechar terminal',
    clearPane: 'Limpar terminal',
    completionPolicyLabel: 'Política de conclusão',
    moveToWindow: 'Mover para janela',
    transplantTooltip: 'Transplantar terminal · ⌘⇧M',
    modelClickToChange: (name: string): string => `Modelo: ${name} · clique para mudar`
  },

  emptyState: {
    workspaceBare: 'Este espaço de trabalho está vazio.',
    workspaceBareNamed: (name: string): string => `${name} está vazio`,
    workspaceBareUnnamed: 'Este espaço de trabalho está vazio',
    pressLabel: 'Pressione',
    pressToOpenSuffix: ' para abrir um terminal.',
    pressToOpen: (shortcut: string): string => `Pressione ${shortcut} para abrir um terminal.`,
    backToClaudinha: 'Voltar para Claudinha',
    backToClaudinhaArrow: '← Voltar para Claudinha ',
    noArchived: 'Nenhum espaço de trabalho arquivado ainda. Arquivar mantém trabalhos antigos acessíveis.',
    noWorkspaces: 'Nenhum espaço de trabalho ainda.',
    createFirst: 'Crie seu primeiro espaço de trabalho para começar.'
  },

  pausedTerminalsPanel: {
    title: 'Terminais pausados',
    empty: 'Nenhum terminal pausado.',
    resume: 'Retomar',
    discard: 'Descartar',
    discardConfirm: (name: string): string => `Descartar o instantâneo pausado de “${name}”?`,
    pausedAt: (when: string): string => `Pausado ${when}`,
    dormantPanes: (n: number): string => `Terminais pausados (${n})`,
    tend: '[retomar]',
    tending: '[retomando…]',
    noSession: '[sem sessão]',
    failedToTend: 'Falha ao retomar terminal.'
  },

  archivesView: {
    title: 'Arquivados',
    empty: 'Nenhum espaço de trabalho arquivado ainda. Arquivar mantém trabalhos antigos acessíveis.',
    restore: 'Restaurar',
    deletePermanently: 'Excluir permanentemente',
    backLabel: '[← Voltar]',
    backAria: 'Voltar ao gerenciador',
    escHint: 'voltar',
    typeGeneral: 'Geral',
    typeRepo: 'Repositório',
    typeWorktree: 'Worktree Branch',
    restoreButton: '[Restaurar]',
    deleteButton: '[Excluir Permanentemente]',
    restoreAria: (name: string): string => `Restaurar ${name}`,
    deleteAria: (name: string): string => `Excluir ${name} permanentemente`,
    dormantPanesFmt: (n: number): string =>
      n === 1 ? '1 terminal pausado' : `${n} terminais pausados`,
    archivedAtPrefix: '· arquivado ',
    archivedAt: (when: string): string => `Arquivado ${when}`,
    pausedTerminalCount: (n: number): string =>
      n === 1 ? '1 terminal pausado' : `${n} terminais pausados`
  },

  permissionsManager: {
    title: 'Gerenciador de Permissões',
    description: 'Controle quais ferramentas o Claude pode usar, globalmente ou por projeto.',
    scopeLabel: 'Escopo',
    scopeGlobal: 'Global',
    scopeProject: 'Projeto',
    projectPathLabel: 'Caminho do projeto',
    projectPathPlaceholder: '/caminho/do/projeto',
    browse: 'Procurar',
    addButton: 'Adicionar',
    cancelButton: 'Cancelar',
    addPlaceholderAllow: 'ex.: Bash(git *)',
    addPlaceholderDeny: 'ex.: Bash(rm -rf *)',
    listAllow: 'Permitir',
    listDeny: 'Bloquear',
    moveToDeny: 'Bloquear →',
    moveToAllow: '← Permitir',
    removeAction: 'Remover',
    noEntries: 'Sem entradas',
    autoFixHint: (normalized: string): string => `→ Será salvo como "${normalized}"`,
    resetAll: 'Restaurar todas as alterações',
    resetTitle: 'Restaurar permissões?',
    resetCancel: 'Cancelar',
    resetConfirm: 'Restaurar',
    resetBodyFmt: (scope: string): string => `Restaurar todas as alterações de permissão ${scope}?`,
    resetBodyDetail: 'Todas as regras adicionadas pelo usuário serão removidas e os padrões removidos serão restaurados.',
    failedLoadDefaults: 'Falha ao carregar padrões',
    failedLoadPermissions: 'Falha ao carregar permissões',
    failedSavePermissions: 'Falha ao salvar permissões',
    failedResetPermissions: 'Falha ao restaurar permissões',
    failedFolderPicker: 'Falha ao abrir o seletor de pastas.',
    invalidRule: 'Regra inválida.',
    addRule: 'Adicionar regra',
    addRulePlaceholder: 'Bash(npm test:*)',
    addRuleScope: 'Escopo',
    scopeUser: 'Todos os repositórios',
    remove: 'Remover',
    confirmRemove: (rule: string): string => `Remover “${rule}”?`,
    cancel: 'Cancelar',
    removeButton: 'Remover',
    emptyAllow: 'Nenhuma ferramenta permitida ainda. O Claude irá perguntar antes de executar qualquer coisa.',
    emptyDeny: 'Nenhuma regra de bloqueio.',
    headerAllow: 'Sempre permitir',
    headerDeny: 'Sempre bloquear',
    headerAsk: 'Sempre perguntar',
    sourceUser: 'Usuário',
    sourceProject: 'Projeto',
    sourceLocal: 'Local',
    sourceClaudinha: 'Claudinha',
    repoLabel: 'Repositório'
  },

  claudeMdEditor: {
    title: 'Editar CLAUDE.md',
    cancel: 'Cancelar',
    save: 'Salvar',
    saving: 'Salvando…',
    pushToGithub: 'Enviar ao GitHub após o commit',
    placeholder: '# Contexto do projeto para o Claude Code\n\nEscreva orientações de nível de projeto aqui.',
    failedToLoad: 'Falha ao carregar CLAUDE.md.',
    failedToSave: 'Falha ao salvar CLAUDE.md.',
    ariaLabelFmt: (repo: string): string => `Editar CLAUDE.md de ${repo}`,
    closeAria: 'Fechar',
    conflictBanner: 'CLAUDE.md foi modificado fora deste editor. Salvar irá sobrescrever essas alterações.',
    reload: 'Recarregar',
    loading: 'Carregando…',
    saveFailed: (msg: string): string => `Falha ao salvar: ${msg}`,
    commitOkPushFailed: (msg: string): string => `Commit feito, push falhou: ${msg}`
  },

  claudeCheckModal: {
    title: 'CLI do Claude não encontrado',
    subtitle: 'A Claudinha precisa do CLI `claude` no seu PATH para abrir sessões.',
    checking: 'Verificando…',
    retry: 'Tentar novamente',
    quit: 'Sair',
    bodyIntro: 'Instale-o e tente novamente, ou siga as',
    bodyInstructionsLink: 'instruções de instalação',
    bodyEnd: '.',
    installCommandLabel: 'Comando de instalação',
    stillMissing: 'Ainda não encontrado. Verifique se',
    stillMissingEnd: 'está no seu PATH e tente novamente.',
    body: 'A Claudinha não conseguiu encontrar o CLI `claude` no seu PATH. Instale o Claude Code para continuar.'
  },

  analyticsConsent: {
    titlePending: 'Ajudar a melhorar a Claudinha?',
    titleSettings: 'Telemetria',
    subtitleConsent: 'Compartilhe dados de uso anônimos para nos ajudar a criar um produto melhor.',
    subtitleOn: 'O compartilhamento de telemetria está ativado.',
    subtitleOff: 'O compartilhamento de telemetria está desativado.',
    body: 'Envie métricas anônimas de uso para nos ajudar a melhorar a Claudinha. Nenhum prompt, saída de terminal ou caminho de arquivo é enviado. Você pode mudar isso a qualquer momento em Configuração.',
    optIn: 'Enviar telemetria',
    optOut: 'Não, obrigado',
    enableAnalytics: 'Ativar telemetria',
    cancel: 'Cancelar',
    save: 'Salvar',
    granted: 'Telemetria ativada',
    grantedDescription: 'Compartilhe dados de uso anônimos para ajudar a melhorar a Claudinha',
    denied: 'Telemetria desativada',
    deniedDescription: 'Nenhum dado é coletado ou enviado',
    whatIsCollected: 'O que É coletado',
    featureUsage: 'Padrões de uso de funcionalidades',
    performanceMetrics: 'Métricas de desempenho',
    errorReports: 'Relatos de erro',
    whatIsNot: 'O que NÃO é coletado',
    codeContents: 'Código ou conteúdo de arquivos',
    filePaths: 'Caminhos de arquivos',
    apiKeys: 'Chaves de API ou tokens',
    personalInfo: 'Informações pessoais',
    changeLater: 'Você pode mudar isso a qualquer momento em Ajuda → Telemetria.'
  },

  keyboardShortcuts: {
    title: 'Atalhos do teclado',
    close: 'Fechar',
    sectionGlobal: 'Global',
    sectionWorkspace: 'Janela do espaço de trabalho',
    sectionPane: 'Terminal',
    sectionManager: 'Janela de gerenciamento',
    showShortcuts: 'Mostrar atalhos do teclado',
    newWorkspace: 'Novo espaço de trabalho',
    closeWorkspace: 'Fechar espaço de trabalho',
    pauseWorkspace: 'Pausar espaço de trabalho',
    showManagement: 'Mostrar janela de gerenciamento',
    newTerminal: 'Novo terminal',
    closeTerminal: 'Fechar terminal',
    moveTerminal: 'Mover terminal',
    nextTerminal: 'Próximo terminal',
    prevTerminal: 'Terminal anterior',
    cycleEffort: 'Alternar esforço global',
    openMergeMenu: 'Abrir menu de merge',
    openPrMenu: 'Abrir menu de PR',
    toggleInspector: 'Alternar inspector',
    submitFeedback: 'Enviar feedback',
    toggleViewMode: 'Alternar visão Mural/Kanban'
  },

  inspectorDrawer: {
    title: 'Inspector',
    closeTooltip: 'Fechar Inspector',
    pinTooltipOn: 'Desafixar — sobrepor terminais',
    pinTooltipOff: 'Fixar — dividir largura com os terminais',
    pinAriaPin: 'Fixar gaveta',
    pinAriaUnpin: 'Desafixar gaveta',
    closeAria: 'Fechar Inspector',
    resizeTitle: 'Arraste para redimensionar',
    resizeAria: 'Redimensionar a gaveta do Inspector',
    summary: 'Resumo',
    paneCountFmt: (n: number): string => (n === 1 ? '1 terminal' : `${n} terminais`),
    readyToMergeSuffix: ' prontos para mesclar',
    fileCountFmt: (n: number): string => (n === 1 ? '1 arquivo com alterações' : `${n} arquivos com alterações`),
    linesSuffix: ' linhas',
    byRepoHeader: 'Por repositório',
    repoSummaryFmt: (panes: number, ready: number): string =>
      `${panes} ${panes === 1 ? 'terminal' : 'terminais'} · ${ready} prontos`,
    panesHeader: 'Terminais',
    noActivePanes: 'Nenhum terminal ativo neste espaço de trabalho.',
    readyBadge: 'Pronto',
    noBranch: '(sem branch)',
    fileFmt: (n: number): string => (n === 1 ? '1 arquivo' : `${n} arquivos`),
    noChanges: 'sem alterações',
    bulkActions: 'Ações em massa',
    mergeAllReadyFmt: (n: number): string => `Mesclar todo trabalho pronto (${n})`,
    createPrAllReadyFmt: (n: number): string => `Criar PR para todo trabalho pronto (${n})`,
    noPanesReady: 'Nenhum terminal pronto para mesclar',
    noPanesReadyPr: 'Nenhum terminal pronto para PR',
    enqueuedFmt: (n: number): string => (n === 1 ? 'Enfileirado 1 merge.' : `Enfileirados ${n} merges.`),
    startedPrsFmt: (n: number): string => (n === 1 ? 'Iniciado 1 PR.' : `Iniciados ${n} PRs.`),
    testsToRun: 'Testes a executar',
    askKeeperTooltip: 'Peça ao Claude um resumo em linguagem natural + plano de testes',
    keeperEmptyHint: 'Nenhuma dica heurística ainda — tente pedir ao Keeper.',
    fromTheKeeper: 'Do Keeper',
    keeperErrorFmt: (err: string): string => `Erro do Keeper: ${err}`,
    hintChangedTests: 'Testes alterados',
    hintAdjacentTests: 'Testes adjacentes',
    hintRepoTestScripts: 'Scripts de teste do repo',
    askButton: 'Perguntar ao Claude',
    askPlaceholder: 'Pergunte qualquer coisa sobre o espaço de trabalho…',
    asking: 'Perguntando…',
    branchLabel: 'Branch',
    repoLabel: 'Repositório',
    uncommittedLabel: 'Não confirmadas',
    untrackedLabel: 'Não rastreadas',
    aheadLabel: 'À frente',
    behindLabel: 'Atrás',
    upstreamLabel: 'Upstream',
    noUpstream: 'Sem upstream',
    rateLimitsTitle: 'Limites de taxa',
    sessionsTitle: 'Sessões',
    sessionsEmpty: 'Nenhuma sessão anterior para esta branch.',
    diffTitle: 'Diff',
    diffEmpty: 'Nenhum diff para mostrar.',
    pushHint: 'Enviar ao GitHub ao salvar CLAUDE.md',
    editClaudeMd: 'Editar CLAUDE.md'
  },

  kanban: {
    columnAwaitingPrompt: 'Aguardando prompt',
    columnWorking: 'Trabalhando',
    columnTodo: 'A fazer',
    columnInProgress: 'Em andamento',
    columnNeedsInput: 'Precisa de entrada',
    columnDone: 'Concluído',
    columnError: 'Erro',
    columnPaused: 'Pausados',
    emptyColumn: 'Vazio',
    repoRailHeading: 'Repositórios',
    repoRailEmpty: 'Nenhum repositório ainda.',
    cardOpenTooltip: 'Abrir terminal',
    cardMoveTooltip: 'Mover terminal',
    cardCloseTooltip: 'Fechar terminal',
    diffSummary: (added: number, removed: number): string => `+${added} −${removed}`,
    sessionRowOpen: 'Abrir',
    sessionRowResume: 'Retomar',
    sessionsHeader: 'Sessões',
    pausedHeader: 'Pausados',
    working: 'Trabalhando…',
    actionRebasing: 'Rebaseando',
    actionMerging: 'Mesclando',
    actionPushing: 'Enviando',
    actionMerged: 'Mesclado',
    actionConflict: 'Conflito',
    actionMainDirty: 'Main modificada',
    actionFailed: 'Ação falhou',
    newTerminalAria: 'Novo terminal',
    collapseSessionList: 'Recolher lista de sessões',
    expandSessionList: 'Expandir lista de sessões',
    editClaudeMdAria: 'Editar CLAUDE.md',
    editClaudeMdDisabled: 'Editor de CLAUDE.md — em breve na Fase 7',
    editClaudeMdEnabled: 'Editar CLAUDE.md',
    mergeNoneReady: 'Nenhuma árvore pronta para mesclar',
    mergeReady: 'Mesclar todas as árvores prontas neste repositório',
    pushNothing: 'Nada para enviar',
    pushReady: 'Enviar branch base para o origin',
    mergePushNothing: 'Nada para mesclar ou enviar',
    mergePushReady: 'Mesclar todas as árvores prontas e então enviar',
    createPrNone: 'Nenhuma árvore pronta para abrir PR',
    createPrReady: 'Abrir PR para cada árvore pronta neste repositório',
    agentNameAria: 'Nome do agente',
    renameAgent: 'Renomear agente',
    planMode: 'Modo plano — o Claude vai propor um plano antes de agir',
    viewDiff: 'Ver diff',
    viewDiffVsBase: 'Ver diff vs branch base',
    uncommittedTooltip: 'Alterações não confirmadas — a Claudinha vai confirmá-las automaticamente antes do merge.',
    railHeader: 'Repositórios',
    railNoWorkspace: 'Nenhum espaço de trabalho vinculado.',
    railLoading: 'Carregando dados do repositório…',
    railNewTerminalButton: '+ Terminal',
    railReposEmpty: 'Nenhum repositório ainda.',
    repoRailSessionsLabel: 'Sessões',
    repoRailPausedLabel: 'Pausados',
    repoRailEmptyCard: 'Nenhuma sessão ainda.',
    repoCardAriaFmt: (label: string): string => `Repositório ${label}`,
    agentsPlural: (n: number): string => (n === 1 ? 'agente' : 'agentes'),
    mergeAction: 'Mesclar',
    pushAction: 'Enviar',
    mergePushAction: 'Mesclar + enviar',
    createPrAction: 'Criar PR',
    stopSequence: 'Parar sequência',
    stopSequenceTooltip: 'Cancela as aprovações pendentes. A árvore que está implementando um plano agora continua rodando.',
    approveInSequence: 'Aprovar planos em sequência',
    approveInSequenceTooltip: 'Aprova cada plano com auto-accept edits, iniciando o próximo quando o atual termina.',
    retryFailedMerges: 'Repetir merges com falha',
    retryFailedMergesTooltip: 'Repete cada árvore neste repositório cujo último merge falhou. Usa rebase-ff.',
    noActiveAgents: 'Nenhum agente ativo.'
  },

  completionBar: {
    mergeAllGrove: 'Mesclar todos (este espaço de trabalho) · rebase-ff',
    noGroveContext: 'Sem contexto de espaço de trabalho para este terminal.',
    createPrsGrove: 'Criar PRs para todos (este espaço de trabalho)',
    createDraftPrsGrove: 'Criar PRs em rascunho para todos (este espaço de trabalho)',
    mergeButton: 'Mesclar',
    mergeDirty: 'Mesclar (modificado)',
    pushButton: 'Enviar',
    createPrButton: 'Criar PR',
    createDraftPrButton: 'Criar PR em rascunho',
    queued: (pos: number): string => `Na fila · ${pos}`,
    merging: 'Mesclando…',
    pushing: 'Enviando…',
    creatingPr: 'Criando PR…',
    mergedTo: (branch: string): string => `Mesclado → ${branch}`,
    pushedTo: (branch: string): string => `Enviado → ${branch}`,
    prCreated: 'PR criado',
    error: 'Erro',
    showError: 'Ver erro',
    resolvingConflict: 'Resolvendo conflito…',
    rebasingOntoMain: 'Rebaseando no main...',
    mergingIntoMain: 'Mesclando no main...',
    pushingToOrigin: 'Enviando para o origin...',
    conflictDetected: 'Conflito detectado',
    resolveWithClaude: '[Resolver com Claude]',
    abort: '[Abortar]',
    mainDirty: 'main tem alterações não confirmadas',
    mainDirtyWithCount: (n: number): string =>
      n === 1
        ? 'main tem alterações não confirmadas (1 arquivo)'
        : `main tem alterações não confirmadas (${n} arquivos)`,
    moreFiles: (n: number): string => `…e mais ${n}`,
    revealInFinder: 'Mostrar no Finder',
    retry: 'Tentar novamente',
    closeAction: 'Fechar',
    mergedToMain: 'Mesclado no main',
    prCreatedAction: 'PR criado',
    mergeOrPrFailed: 'Merge ou PR falhou',
    details: 'Detalhes',
    queuedFmt: (ord: string): string => `Na fila (${ord})`,
    cancelAction: '[Cancelar]',
    mergeMenu: 'Mesclar ▾',
    prMenu: 'PR ▾',
    rebaseOntoMainAndMerge: 'Rebase no main + merge',
    squashOntoMain: 'Squash no main',
    mergeCommitIntoMain: 'Commit de merge no main',
    pushAndCreatePr: 'Enviar e criar PR',
    pushAndCreateDraftPr: 'Enviar e criar PR em rascunho',
    mergeAllGlobal: 'Mesclar todos (global) · rebase-ff',
    createPrsAllGlobal: 'Criar PRs para todos (global)',
    installGhTooltip: 'Instale o CLI gh para criar PRs',
    hideBarTooltip: 'Ocultar esta barra (Esc)'
  },

  completionErrorModal: {
    title: 'Merge ou PR falhou',
    close: 'Fechar',
    retry: 'Tentar novamente',
    bodyHeader: 'O Claude relatou o seguinte:'
  },

  contextBar: {
    estimateLabel: 'Contexto',
    pctRemaining: (pct: number): string => `${pct}% restante`,
    nearLimit: 'Aproximando-se do limite de contexto'
  },

  diffViewer: {
    title: 'Diff vs base',
    close: 'Fechar',
    closeAria: 'Fechar',
    diffForFmt: (name: string): string => `Diff de ${name}`,
    vsBranchFmt: (branch: string): string => ` · vs ${branch}`,
    truncated: 'Diff truncado — veja a saída completa via',
    truncatedSuffix: 'no terminal.',
    loading: 'Carregando diff…',
    noDifferences: 'Sem diferenças em relação à branch base.',
    fileNoChanges: 'Nenhuma alteração neste arquivo.',
    binaryFile: 'Arquivo binário — não exibido.',
    selectFile: 'Selecione um arquivo para ver seu diff.'
  },

  effortPopover: {
    label: 'Esforço',
    minimal: 'Mínimo',
    low: 'Baixo',
    medium: 'Médio',
    high: 'Alto',
    xhigh: 'X Alto',
    max: 'Máx'
  },

  modelPopover: {
    label: 'Modelo',
    none: 'Nenhum',
    opus: 'Opus',
    sonnet: 'Sonnet',
    haiku: 'Haiku'
  },

  policyPopover: {
    label: 'Quando este terminal terminar',
    askLabel: 'Perguntar',
    autoMergeLabel: 'Mesclar automaticamente',
    autoPrLabel: 'Criar PR automaticamente',
    autoDraftPrLabel: 'Criar PR em rascunho automaticamente',
    pruneOnMergeLabel: 'Excluir worktree após o merge',
    strategyLabel: 'Estratégia de merge',
    strategyRebaseFf: 'Rebase + fast-forward',
    strategyMerge: 'Commit de merge',
    headerThisWorkspace: 'Este espaço de trabalho',
    headerGlobalDefault: 'Padrão global',
    workspaceLabel: 'Espaço de trabalho: ',
    globalLabel: 'Global: ',
    inheritGlobal: 'herdar do global',
    askManual: 'perguntar (manual)',
    askManualLabel: 'Perguntar (manual)',
    autoMergeRebase: 'Auto-merge · rebase no main',
    autoMergeSquash: 'Auto-merge · squash',
    autoMergeMergeCommit: 'Auto-merge · commit de merge',
    summaryAutoMergeFmt: (strategy: string): string => `auto-merge · ${strategy}`,
    summaryAutoPr: 'criar PR automaticamente',
    summaryAutoDraftPr: 'criar PR em rascunho automaticamente',
    clearOverride: 'Limpar override do espaço de trabalho',
    pruneOnMergeRow: 'Remover worktree + fechar automaticamente após merge'
  },

  rateLimit: {
    sessionLabel: 'Sessão',
    weekLabel: 'Semana',
    weekOpusLabel: 'Semana (Opus)',
    resetsIn: (when: string): string => `Renova ${when}`,
    pctUsed: (pct: number): string => `${pct}% usado`,
    rateLimitsHeader: 'Limites de uso:'
  },

  metricsOverlay: {
    title: 'Métricas da sessão',
    close: 'Fechar',
    tokensIn: 'Tokens entrada',
    tokensOut: 'Tokens saída',
    cacheRead: 'Leitura de cache',
    cacheCreate: 'Criação de cache',
    elapsed: 'Decorrido',
    totalCost: 'Custo estimado'
  },

  statusOverlay: {
    pausedTitle: 'Terminal pausado',
    pausedBody: 'Este terminal está pausado. Retome para continuar.',
    resumeButton: 'Retomar',
    discardButton: 'Descartar',
    lostTitle: 'Terminal perdido',
    lostBody: 'A conexão com este terminal foi perdida. Você pode tentar recuperar ou fechá-lo.',
    recoverButton: 'Recuperar',
    closeButton: 'Fechar',
    labelAwaitingOrders: 'Aguardando ordens',
    labelWorking: 'Trabalhando',
    labelNeedsInput: 'Precisa de entrada',
    labelDone: 'Concluído',
    labelError: 'Erro',
    labelLost: 'Perdido',
    labelResolvingConflict: 'Resolvendo Conflito',
    labelResolvingConflictFmt: (tool: string): string => `Resolvendo Conflito: ${tool}`,
    modifiedFmt: (n: number): string => `${n} modificados`,
    aheadFmt: (n: number): string => `${n} à frente`
  },

  toolUsageRow: {
    label: 'Ferramentas'
  },

  kanbanResizeHandle: {
    aria: 'Redimensionar quadro Kanban',
    title: 'Arraste para redimensionar o quadro Kanban'
  },

  configError: {
    title: 'Algo deu errado',
    body: 'A Claudinha encontrou um erro inesperado ao renderizar esta tela. Reinicie o app ou reporte via Enviar Feedback.',
    reload: 'Recarregar janela'
  },

  permissionRemoveConfirm: {
    title: (rule: string): string => `Remover permissão “${rule}”?`,
    body: 'O Claude irá perguntar antes de executar essa ferramenta novamente.',
    cancel: 'Cancelar',
    confirm: 'Remover',
    modalTitle: 'Remover regra de permissão?',
    listAllow: 'permitir',
    listDeny: 'bloquear',
    bodyFmt: (rule: string, list: string): string => `Remover "${rule}" da lista de ${list}?`,
    subtextDefault: 'Esta regra padrão deixará de ser aplicada. O Claude irá perguntar ao usar.',
    subtextUser: 'Esta regra adicionada pelo usuário será excluída.'
  }
}
