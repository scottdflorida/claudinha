/**
 * English (en) bundle. The shape exported here defines the `Strings` type
 * that every other locale must satisfy — TypeScript will fail the build if
 * a locale is missing a key. Keep keys grouped by feature/component, and
 * prefer functions for any string that interpolates user-supplied values.
 */
export const en = {
  app: {
    name: 'Claudinha',
    tagline: 'A terminal manager for Claude Code',
    managementTitle: 'Claudinha: Management'
  },
  workspace: {
    singular: 'Workspace',
    plural: 'Workspaces',
    active: 'Active workspaces',
    dormant: 'Paused',
    archived: 'Archived',
    create: 'New workspace',
    close: 'Close workspace',
    archive: 'Archive workspace',
    archiveConfirmTitle: 'Archive this workspace?',
    failedToCreate: 'Failed to create workspace.'
  },
  pane: {
    singular: 'Terminal',
    plural: 'Terminals',
    count: (n: number): string => (n === 1 ? '1 terminal' : `${n} terminals`),
    create: 'New terminal',
    openVerb: 'Open',
    opening: 'Opening…',
    clear: 'Close terminal',
    transplant: 'Move terminal',
    tend: 'Focus',
    tending: 'Opening…',
    dormant: 'Paused terminal',
    dormantPlural: 'Paused terminals',
    snapshotCount: (n: number): string =>
      n === 1 ? '1 paused terminal snapshot' : `${n} paused terminal snapshots`
  },
  toolbar: {
    backToManagement: 'Back to Claudinha',
    newTerminal: 'New Terminal',
    clearTree: 'Close Terminal',
    transnewTerminal: 'Move Terminal',
    prevNextTree: 'Prev/Next Terminal',
    moveFocus: 'Move Focus',
    cycleEffort: 'Cycle Global Effort'
  },
  spawn: {
    title: 'New terminal',
    submit: 'Open',
    submitting: 'Opening…'
  },
  launchForm: {
    headline: 'Create a workspace and open terminals',
    paneCount: 'Terminal count',
    paneLabel: (i: number): string => `Terminal ${i + 1}`,
    perTreeNote: '(leave blank to choose per terminal)',
    submitLabel: (n: number): string =>
      n === 1 ? 'Create workspace with 1 terminal' : `Create workspace with ${n} terminals`,
    failedToLaunch: 'Failed to create workspace.'
  },
  configuration: {
    sectionAnalytics: 'Analytics',
    sectionStartup: 'Startup',
    sectionNotifications: 'Notifications',
    sectionPanes: 'Terminals',
    sectionDefaults: 'Defaults',
    sectionLanguage: 'Language',
    languageHint: "Claudinha's interface language. Keyboard shortcuts and terminal output stay in English.",
    languageEnglish: 'English',
    languagePortuguese: 'Português',
    title: 'Configuration',
    loading: 'Loading preferences…',
    resetButton: 'Reset all preferences to defaults',
    resetConfirm: 'Reset all Claudinha preferences to their defaults? This does not affect analytics consent or permissions.',
    telemetryLabel: 'Telemetry',
    telemetryHint: 'Anonymous usage metrics help improve Claudinha. You can change this at any time.',
    on: 'On',
    off: 'Off',
    autoRestoreLabel: 'Auto-restore last session',
    autoRestoreHint: 'On launch, re-open the most recently closed workspace and resume its active terminals.',
    playSoundsLabel: 'Play status sounds',
    playSoundsHint: 'Master switch — when off, no sounds play regardless of the per-status toggles.',
    volumeLabel: 'Volume',
    volumeMute: 'Mute',
    volumeLow: 'Low',
    volumeMed: 'Med',
    volumeHigh: 'High',
    volumeMax: 'Max',
    soundOnNeedsInputLabel: 'When a terminal needs input',
    soundOnDoneLabel: 'When a terminal finishes',
    showToolCountsLabel: 'Show tool counts bar',
    showToolCountsHint: "Display the per-tool usage counts row (e.g. Read 30 · Edit 15) in each terminal's header.",
    defaultModelShortLabel: 'Default model for new terminals',
    defaultModelShortHint: 'Pre-selects the model in the launch form. You can still override per terminal.',
    defaultViewModeLabel: 'Default view mode for new workspaces',
    defaultViewModeHint: 'Pre-selects the Wall/Kanban tile on the launch form. Each workspace can still be toggled from its titlebar.',
    modelNone: 'None',
    viewModeWall: 'Wall',
    viewModeKanban: 'Kanban',
    resumeHint: 'On launch, re-open the most recently closed workspace and resume its active terminals.',
    needsInputLabel: 'When a terminal needs input',
    finishedLabel: 'When a terminal finishes',
    defaultModelLabel: 'Default model for new terminals',
    defaultModelHint: 'Pre-selects the model in the launch form. You can still override per terminal.'
  },
  languageToggle: {
    // Intentionally in the OPPOSITE language — the user is being shown the
    // switch they will land in, not the one they're currently using.
    switchToPortuguese: 'Switch to Português',
    switchToEnglish: 'Mudar para English'
  },
  status: {
    awaiting: 'Awaiting input',
    working: 'Working',
    needsInput: 'Needs input',
    done: 'Done',
    lost: 'Lost'
  },
  empty: {
    workspaceBare: 'This workspace is empty.',
    newTerminalHint: (shortcut: string): string => `Press ${shortcut} to open a terminal.`,
    noArchivedWorkspaces: 'No archived workspaces yet. Archiving keeps stale work reachable.',
    workspacesEmpty: 'No workspaces yet.',
    createFirstWorkspace: 'Create your first workspace to begin.'
  },
  worktreeWarning:
    'All terminals in this workspace share one directory. Avoid editing the same files in multiple terminals.',

  managerSidebar: {
    searchPlaceholder: 'Search workspaces…',
    searchAriaLabel: 'Search workspaces',
    clearSearch: 'Clear search',
    workspacesListLabel: 'Workspaces',
    groupActive: 'Active',
    groupDormant: 'Dormant',
    groupArchived: 'Archived',
    noMatches: 'No matches',
    newWorkspace: 'New workspace',
    navPermissions: 'Permissions',
    navConfiguration: 'Configuration'
  },

  managerWindow: {
    title: 'Claudinha: Management',
    submitFeedback: 'Submit Feedback',
    submitFeedbackTooltip: 'Send feedback (⌘⇧I)'
  },

  workspaceView: {
    moreActions: 'More actions',
    unarchive: 'Unarchive',
    openWorkspace: 'Open workspace',
    panesHeading: 'Terminals',
    paneLabel: (i: number): string => `Terminal ${i + 1}`,
    awaitingOrders: 'Awaiting orders',
    open: 'Open',
    noPanes: 'No terminals.',
    dormantPanesHeading: (n: number): string => `Dormant Terminals (${n})`,
    deletePermanently: 'Delete permanently',
    archiveWorkspace: 'Archive workspace',
    paneCountLabel: (n: number): string => (n === 1 ? '1 terminal' : `${n} terminals`),
    startingPrompt: 'Starting Prompt'
  },

  launchFormUI: {
    workspaceNameLabel: 'Workspace name',
    workspaceNamePlaceholder: (n: number): string => `Workspace ${n}`,
    repoPathLabel: 'Repository path',
    repoPathPlaceholderPerTerminal: '(chosen per terminal below)',
    browse: 'Browse',
    initGit: 'Initialize git here',
    statusChecking: 'Checking…',
    statusPathNotFound: 'Path not found',
    statusValidNonGit: 'Valid directory — not a git repo',
    statusValidGit: 'Git repository confirmed',
    terminalsToSpawnLabel: 'Terminals to spawn',
    publishPathLabel: 'Default publish path',
    publishPathDirectMerge: 'Direct merge',
    publishPathPr: 'Pull request',
    publishPathBoth: 'Both',
    publishPathHintDirectMerge:
      'Publishing a turn merges directly into the base branch via a side-clone, then pushes. No PRs unless you change this per repo.',
    publishPathHintPr:
      'Publishing a turn pushes the worktree branch and opens a PR via `gh`. Requires `gh` CLI.',
    publishPathHintBoth:
      'Both options surface in the publish menu — pick per action. Recommended if you have a mix of repos.',
    viewModeLabel: 'View mode',
    viewModeKanban: 'Kanban',
    viewModeWall: 'Wall',
    advancedSetup: 'Advanced Setup',
    terminalLocationLabel: 'Terminal location',
    locationSingleRepo: 'All Terminals in Same Repo',
    locationPerPane: 'Choose Repo per Terminal',
    branchLayoutLabel: 'Branch layout',
    layoutSeparate: 'Separate per terminal',
    layoutShared: 'Shared across terminals',
    layoutMain: 'On main',
    sharedConflictsWarning: '⚠ Beware of conflicts when terminals share a branch.',
    mainConflictsWarning: '⚠ Terminals will run directly in the repo on its current branch — changes land there immediately and concurrent agents may collide.',
    branchNamingLabel: 'Branch naming',
    namingAuto: 'Auto',
    namingCustom: 'Custom',
    namingDisabledOnMain: 'Disabled — terminals run on the current branch, no new branch is created.',
    perTerminalRepos: 'Per-terminal repositories',
    sharedBranchNameLabel: 'Shared branch name',
    sharedBranchPlaceholder: 'feature/foo',
    terminalNameLabel: (i: number): string => `Terminal ${i + 1} name`,
    terminalNamePlaceholder: 'Branch name (auto if blank)',
    terminalRepoLabel: (i: number): string => `Terminal ${i + 1} repo`,
    modelLabel: 'Model',
    effortLabel: 'Effort',
    submitOpening: 'Opening…',
    submitLabel: (n: number): string =>
      n === 1 ? 'Create workspace with 1 terminal' : `Create workspace with ${n} terminals`,
    failedFolderPicker: 'Failed to open folder picker.',
    failedToInitGit: 'Failed to initialize git repository.',
    repoPathRequired: 'Repository path is required.',
    pathMustBeGit: 'Path must be a git repository.',
    failedToLaunch: 'Failed to launch workspace.',
    sharedBranchNameLabelExisting: 'Worktree branch name',
    perTerminalRepoAndName: 'Per-terminal repository + branch name',
    terminalLabel: (i: number): string => `Terminal ${i + 1}`,
    worktreeBranchNamesLabel: 'Worktree branch names',
    perTerminalRepoRequired: (i: number): string => `Terminal ${i + 1}: repository path is required.`,
    perTerminalMustBeGit: (i: number): string => `Terminal ${i + 1}: path must be a git repository.`,
    initGitFailedFmt: (msg: string): string => `Failed to initialize git repository: ${msg}`
  },

  addTerminalsForm: {
    title: 'Add terminal(s)',
    cancel: 'Cancel',
    submitOpening: 'Opening…',
    submitLabel: (n: number): string =>
      n === 1 ? 'Add 1 terminal to this workspace' : `Add ${n} terminals to this workspace`,
    worktreeBranchBannerTitle: 'Locked to this workspace’s worktree',
    worktreeBranchBannerBody: (branchName: string, worktreePath: string): string =>
      `New terminals will run on branch ${branchName} at ${worktreePath}.`,
    failedToAdd: 'Failed to add terminals.'
  },

  newWorkspaceModal: {
    title: 'Create workspace',
    cancel: 'Cancel',
    create: 'Create',
    creating: 'Creating…',
    typeLabel: 'Type',
    repoPathLabel: 'Repository path',
    repoPathPlaceholder: '/absolute/path/to/repo',
    browse: 'Browse',
    worktreeLabel: 'Worktree / branch',
    worktreesLoading: 'Loading worktrees…',
    worktreesEmpty: 'No worktrees found.',
    mainTag: ' (main)',
    sharedDirWarning: 'All terminals in this workspace share one directory. Avoid editing the same files in multiple terminals.',
    nameLabel: 'Workspace name',
    nameHelper: 'Optional — auto-generated from type if left empty',
    namePlaceholder: 'Auto-generated',
    typeGeneral: 'General',
    typeRepo: 'Repo',
    typeWorktree: 'Worktree',
    failedFolderPicker: 'Failed to open folder picker.',
    failedToCreate: 'Failed to create workspace.'
  },

  archiveModal: {
    title: 'Archive this workspace?',
    cancel: 'Cancel',
    confirm: 'Archive',
    bodyIntro: 'Archiving moves the workspace to the Archived section. Terminals are preserved. You can unarchive at any time.',
    bodySnapshotCount: (n: number): string =>
      n === 1
        ? '1 dormant terminal snapshot will be preserved.'
        : `${n} dormant terminal snapshots will be preserved.`,
    bodyWithSnapshots: (n: number, name: string): string =>
      `“${name}” has ${n === 1 ? '1 paused terminal snapshot' : `${n} paused terminal snapshots`}. Archiving keeps them reachable in the Archived list — they aren't deleted.`,
    bodyWithoutSnapshots: (name: string): string =>
      `Archive “${name}”? Archived workspaces stay reachable in the Archived list and can be restored at any time.`
  },

  permanentDeleteModal: {
    title: 'Delete permanently?',
    cancel: 'Cancel',
    confirm: 'Delete Permanently',
    cannotUndo: 'This cannot be undone.',
    snapshotLoss: (n: number): string =>
      n === 1
        ? '1 dormant terminal snapshot will be permanently lost.'
        : `${n} dormant terminal snapshots will be permanently lost.`,
    typeToConfirm: (name: string): string => `Type "${name}" to confirm`,
    bodyWithSnapshots: (n: number, name: string): string =>
      `“${name}” has ${n === 1 ? '1 paused terminal snapshot' : `${n} paused terminal snapshots`}. Permanently deleting removes the workspace and every snapshot from disk. This cannot be undone.`,
    bodyWithoutSnapshots: (name: string): string =>
      `Permanently delete “${name}”? This removes the workspace from disk and cannot be undone.`
  },

  homeView: {
    headline: 'New workspace'
  },

  windowShell: {
    backTooltip: 'Back to Claudinha (⌘⇧M)',
    workspaceNamePlaceholder: 'Untitled workspace',
    workspaceNameAria: 'Workspace name',
    addTerminal: 'Add terminal',
    newTerminalsButton: '+ Terminal(s)',
    newTerminalsAria: 'Add terminals',
    moveTerminal: 'Move terminal',
    closeTerminal: 'Close terminal',
    keyboardShortcuts: 'Keyboard shortcuts',
    pauseWorkspace: 'Pause workspace',
    closeWorkspace: 'Close workspace',
    viewWall: 'Wall',
    viewKanban: 'Kanban',
    themeLight: 'Switch to light theme',
    themeDark: 'Switch to dark theme'
  },

  windowPicker: {
    movePaneTitle: 'Move terminal',
    newWindowOption: 'New workspace',
    cancel: 'Cancel',
    headerLabel: 'Transplant Terminal',
    loading: 'Loading…'
  },

  paneCloseConfirm: {
    title: 'Close terminal?',
    cancel: 'Cancel',
    closeAndDelete: 'Close and delete worktree',
    closeKeepWorktree: 'Close (keep worktree)',
    pauseInsteadOfClose: 'Pause instead',
    bodyDirty: 'This terminal has uncommitted changes. Closing will lose them. You can pause instead to keep the terminal in the dormant list.',
    bodyClean: 'This terminal has no uncommitted changes. Closing will end the Claude session and delete the worktree.',
    statusLabel: 'Status',
    gitLabel: 'Git',
    warnWorking: 'The agent is still running. Closing will interrupt it.',
    warnNeedsInput: 'The agent is waiting for your input. Closing will discard the prompt.',
    warnError: 'The terminal is in an error state. Closing will not attempt recovery.',
    cancelKeepOpen: 'Cancel (keep terminal open)',
    clean: 'Clean',
    resumableHint: 'Closed terminals remain resumable from Management (Dormant Terminals).'
  },

  workspaceCloseOverlay: {
    closingTitle: 'Closing workspace…',
    closingBody: 'Wrapping up open terminals before the window closes.',
    paneBreadcrumb: (workspaceName: string, current: number, total: number): string =>
      `Closing ${workspaceName} · Terminal ${current} of ${total}`,
    managerBreadcrumb: (current: number, total: number): string =>
      `Closing Claudinha · Workspace ${current} of ${total}`,
    overrideAll: 'Close all remaining terminals in this workspace',
    cancelKeepOpen: 'Cancel (keep workspace open)'
  },

  workspaceSpawnOverlay: {
    title: 'Claudinha is launching your agent team',
    body: 'Please give her a few seconds.'
  },

  paneHeader: {
    rename: 'Rename terminal',
    renameAria: 'Terminal name',
    renamePlaceholder: 'Untitled terminal',
    closeTooltip: 'Close terminal',
    pauseTooltip: 'Pause terminal',
    moveTooltip: 'Move terminal to another window',
    modelTooltip: 'Model',
    effortTooltip: 'Effort',
    diffTooltip: 'View diff',
    permissionTooltip: 'Permissions',
    statusAwaiting: 'Awaiting input',
    statusWorking: 'Working',
    statusNeedsInput: 'Needs input',
    statusDone: 'Done',
    statusLost: 'Lost',
    paused: 'Paused',
    moreActions: 'More actions',
    moreActionsTooltip: 'Policy · Model · Transfer',
    closePane: 'Close terminal',
    clearPane: 'Clear terminal',
    completionPolicyLabel: 'Completion policy',
    moveToWindow: 'Move to window',
    transplantTooltip: 'Transplant terminal · ⌘⇧M',
    modelClickToChange: (name: string): string => `Model: ${name} · click to change`
  },

  emptyState: {
    workspaceBare: 'This workspace is empty.',
    workspaceBareNamed: (name: string): string => `${name} is empty`,
    workspaceBareUnnamed: 'This workspace is empty',
    pressLabel: 'Press',
    pressToOpenSuffix: ' to open a terminal.',
    pressToOpen: (shortcut: string): string => `Press ${shortcut} to open a terminal.`,
    backToClaudinha: 'Back to Claudinha',
    backToClaudinhaArrow: '← Back to Claudinha ',
    noArchived: 'No archived workspaces yet. Archiving keeps stale work reachable.',
    noWorkspaces: 'No workspaces yet.',
    createFirst: 'Create your first workspace to begin.'
  },

  pausedTerminalsPanel: {
    title: 'Paused terminals',
    empty: 'No paused terminals.',
    resume: 'Resume',
    discard: 'Discard',
    discardConfirm: (name: string): string => `Discard the paused snapshot for “${name}”?`,
    pausedAt: (when: string): string => `Paused ${when}`,
    dormantPanes: (n: number): string => `Dormant Terminals (${n})`,
    tend: '[tend]',
    tending: '[tending…]',
    noSession: '[no session]',
    failedToTend: 'Failed to tend terminal.'
  },

  archivesView: {
    title: 'Archives',
    empty: 'No archived workspaces yet. Archiving keeps stale work reachable.',
    restore: 'Restore',
    deletePermanently: 'Delete permanently',
    backLabel: '[← Back]',
    backAria: 'Back to manager',
    escHint: 'back',
    typeGeneral: 'General',
    typeRepo: 'Repo',
    typeWorktree: 'Worktree Branch',
    restoreButton: '[Restore]',
    deleteButton: '[Delete Permanently]',
    restoreAria: (name: string): string => `Restore ${name}`,
    deleteAria: (name: string): string => `Delete ${name} permanently`,
    dormantPanesFmt: (n: number): string =>
      n === 1 ? '1 dormant terminal' : `${n} dormant terminals`,
    archivedAtPrefix: '· archived ',
    archivedAt: (when: string): string => `Archived ${when}`,
    pausedTerminalCount: (n: number): string =>
      n === 1 ? '1 paused terminal' : `${n} paused terminals`
  },

  permissionsManager: {
    title: 'Permissions Manager',
    description: 'Control which tools Claude can use, globally or per project.',
    scopeLabel: 'Scope',
    scopeGlobal: 'Global',
    scopeProject: 'Project',
    projectPathLabel: 'Project path',
    projectPathPlaceholder: '/path/to/project',
    browse: 'Browse',
    addButton: 'Add',
    cancelButton: 'Cancel',
    addPlaceholderAllow: 'e.g. Bash(git *)',
    addPlaceholderDeny: 'e.g. Bash(rm -rf *)',
    listAllow: 'Allow',
    listDeny: 'Deny',
    moveToDeny: 'Deny →',
    moveToAllow: '← Allow',
    removeAction: 'Remove',
    noEntries: 'No entries',
    autoFixHint: (normalized: string): string => `→ Will be saved as "${normalized}"`,
    resetAll: 'Reset all overrides',
    resetTitle: 'Reset permissions?',
    resetCancel: 'Cancel',
    resetConfirm: 'Reset',
    resetBodyFmt: (scope: string): string => `Reset all ${scope} permission overrides?`,
    resetBodyDetail: 'All user-added rules will be removed and removed defaults will be restored.',
    failedLoadDefaults: 'Failed to load defaults',
    failedLoadPermissions: 'Failed to load permissions',
    failedSavePermissions: 'Failed to save permissions',
    failedResetPermissions: 'Failed to reset permissions',
    failedFolderPicker: 'Failed to open folder picker.',
    invalidRule: 'Invalid rule.',
    addRule: 'Add rule',
    addRulePlaceholder: 'Bash(npm test:*)',
    addRuleScope: 'Scope',
    scopeUser: 'All repos',
    remove: 'Remove',
    confirmRemove: (rule: string): string => `Remove “${rule}”?`,
    cancel: 'Cancel',
    removeButton: 'Remove',
    emptyAllow: 'No allowed tools yet. Claude will ask before running anything.',
    emptyDeny: 'No deny rules.',
    headerAllow: 'Always allow',
    headerDeny: 'Always deny',
    headerAsk: 'Always ask',
    sourceUser: 'User',
    sourceProject: 'Project',
    sourceLocal: 'Local',
    sourceClaudinha: 'Claudinha',
    repoLabel: 'Repository'
  },

  claudeMdEditor: {
    title: 'Edit CLAUDE.md',
    cancel: 'Cancel',
    save: 'Save',
    saving: 'Saving…',
    pushToGithub: 'Push to GitHub after commit',
    placeholder: '# Project context for Claude Code\n\nWrite project-level guidance here.',
    failedToLoad: 'Failed to load CLAUDE.md.',
    failedToSave: 'Failed to save CLAUDE.md.',
    ariaLabelFmt: (repo: string): string => `Edit CLAUDE.md for ${repo}`,
    closeAria: 'Close',
    conflictBanner: 'CLAUDE.md was modified outside this editor. Saving would stomp those changes.',
    reload: 'Reload',
    loading: 'Loading…',
    saveFailed: (msg: string): string => `Save failed: ${msg}`,
    commitOkPushFailed: (msg: string): string => `Commit succeeded, push failed: ${msg}`
  },

  claudeCheckModal: {
    title: 'Claude CLI not found',
    subtitle: 'Claudinha needs the claude CLI on your PATH to spawn sessions.',
    checking: 'Checking…',
    retry: 'Retry',
    quit: 'Quit',
    bodyIntro: 'Install it and try again, or follow the',
    bodyInstructionsLink: 'installation instructions',
    bodyEnd: '.',
    installCommandLabel: 'Install command',
    stillMissing: 'Still not found. Make sure',
    stillMissingEnd: 'is in your PATH and try again.',
    body: 'Claudinha could not find the `claude` CLI on your PATH. Install Claude Code to continue.'
  },

  analyticsConsent: {
    titlePending: 'Help improve Claudinha?',
    titleSettings: 'Analytics',
    subtitleConsent: 'Share anonymous usage data to help us build a better product.',
    subtitleOn: 'Analytics sharing is currently on.',
    subtitleOff: 'Analytics sharing is currently off.',
    body: 'Send anonymous usage metrics to help us improve Claudinha. No prompts, terminal output, or file paths are ever sent. You can change this at any time in Configuration.',
    optIn: 'Send analytics',
    optOut: 'No thanks',
    enableAnalytics: 'Enable analytics',
    cancel: 'Cancel',
    save: 'Save',
    granted: 'Analytics on',
    grantedDescription: 'Share anonymous usage data to help improve Claudinha',
    denied: 'Analytics off',
    deniedDescription: 'No data is collected or sent',
    whatIsCollected: 'What IS collected',
    featureUsage: 'Feature usage patterns',
    performanceMetrics: 'Performance metrics',
    errorReports: 'Error reports',
    whatIsNot: 'What is NOT collected',
    codeContents: 'Code or file contents',
    filePaths: 'File paths',
    apiKeys: 'API keys or tokens',
    personalInfo: 'Personal information',
    changeLater: 'You can change this at any time in Help → Analytics.'
  },

  keyboardShortcuts: {
    title: 'Keyboard shortcuts',
    close: 'Close',
    sectionGlobal: 'Global',
    sectionWorkspace: 'Workspace window',
    sectionPane: 'Terminal',
    sectionManager: 'Management window',
    showShortcuts: 'Show keyboard shortcuts',
    newWorkspace: 'New workspace',
    closeWorkspace: 'Close workspace',
    pauseWorkspace: 'Pause workspace',
    showManagement: 'Show management window',
    newTerminal: 'New terminal',
    closeTerminal: 'Close terminal',
    moveTerminal: 'Move terminal',
    nextTerminal: 'Next terminal',
    prevTerminal: 'Previous terminal',
    cycleEffort: 'Cycle global effort',
    openMergeMenu: 'Open merge menu',
    openPrMenu: 'Open PR menu',
    toggleInspector: 'Toggle inspector',
    submitFeedback: 'Submit feedback',
    toggleViewMode: 'Toggle Wall/Kanban view'
  },

  inspectorDrawer: {
    title: 'Inspector',
    closeTooltip: 'Close Inspector',
    pinTooltipOn: 'Unpin — overlay terminals',
    pinTooltipOff: 'Pin — share width with terminals',
    pinAriaPin: 'Pin drawer',
    pinAriaUnpin: 'Unpin drawer',
    closeAria: 'Close Inspector',
    resizeTitle: 'Drag to resize',
    resizeAria: 'Resize Inspector drawer',
    summary: 'Summary',
    paneCountFmt: (n: number): string => (n === 1 ? '1 terminal' : `${n} terminals`),
    readyToMergeSuffix: ' ready to merge',
    fileCountFmt: (n: number): string => (n === 1 ? '1 file with changes' : `${n} files with changes`),
    linesSuffix: ' lines',
    byRepoHeader: 'By repo',
    repoSummaryFmt: (panes: number, ready: number): string =>
      `${panes} ${panes === 1 ? 'terminal' : 'terminals'} · ${ready} ready`,
    panesHeader: 'Terminals',
    noActivePanes: 'No active terminals in this workspace.',
    readyBadge: 'Ready',
    noBranch: '(no branch)',
    fileFmt: (n: number): string => (n === 1 ? '1 file' : `${n} files`),
    noChanges: 'no changes',
    bulkActions: 'Bulk actions',
    mergeAllReadyFmt: (n: number): string => `Merge all ready work (${n})`,
    createPrAllReadyFmt: (n: number): string => `Create PR for all ready work (${n})`,
    noPanesReady: 'No terminals ready to merge',
    noPanesReadyPr: 'No terminals ready for PR',
    enqueuedFmt: (n: number): string => (n === 1 ? 'Enqueued 1 merge.' : `Enqueued ${n} merges.`),
    startedPrsFmt: (n: number): string => (n === 1 ? 'Started 1 PR.' : `Started ${n} PRs.`),
    testsToRun: 'Tests to run',
    askKeeperTooltip: 'Ask Claude for a natural-language summary + test plan',
    keeperEmptyHint: 'No heuristic hints yet — try asking the Keeper.',
    fromTheKeeper: 'From the Keeper',
    keeperErrorFmt: (err: string): string => `Keeper error: ${err}`,
    hintChangedTests: 'Changed tests',
    hintAdjacentTests: 'Adjacent tests',
    hintRepoTestScripts: 'Repo test scripts',
    askButton: 'Ask Claude',
    askPlaceholder: 'Ask anything about the workspace…',
    asking: 'Asking…',
    branchLabel: 'Branch',
    repoLabel: 'Repository',
    uncommittedLabel: 'Uncommitted',
    untrackedLabel: 'Untracked',
    aheadLabel: 'Ahead',
    behindLabel: 'Behind',
    upstreamLabel: 'Upstream',
    noUpstream: 'No upstream',
    rateLimitsTitle: 'Rate limits',
    sessionsTitle: 'Sessions',
    sessionsEmpty: 'No prior sessions for this branch.',
    diffTitle: 'Diff',
    diffEmpty: 'No diff to show.',
    pushHint: 'Push to GitHub when saving CLAUDE.md',
    editClaudeMd: 'Edit CLAUDE.md'
  },

  kanban: {
    columnAwaitingPrompt: 'Awaiting prompt',
    columnAwaitingOrders: 'Awaiting orders',
    columnPlanning: 'Planning',
    columnPlanReady: 'Plan ready',
    columnWorking: 'Working',
    columnTodo: 'To do',
    columnInProgress: 'In progress',
    columnNeedsInput: 'Needs input',
    columnDone: 'Done',
    columnChangesReady: 'Changes ready',
    columnError: 'Error',
    columnPaused: 'Paused',
    nextStepCommit: (added: number, removed: number): string => `+${added}/-${removed} to commit`,
    nextStepMerge: (n: number): string => (n === 1 ? '1 commit to merge' : `${n} commits to merge`),
    nextStepPush: (n: number): string => `↑${n} to push`,
    nextStepPrOpen: (num: number): string => `PR #${num} open`,
    emptyColumn: 'Empty',
    repoRailHeading: 'Repos',
    repoRailEmpty: 'No repos yet.',
    cardOpenTooltip: 'Open terminal',
    cardMoveTooltip: 'Move terminal',
    cardCloseTooltip: 'Close terminal',
    diffSummary: (added: number, removed: number): string => `+${added} −${removed}`,
    sessionRowOpen: 'Open',
    sessionRowResume: 'Resume',
    sessionsHeader: 'Sessions',
    pausedHeader: 'Paused',
    working: 'Working…',
    actionRebasing: 'Rebasing',
    actionMerging: 'Merging',
    actionPushing: 'Pushing',
    actionMerged: 'Merged',
    actionConflict: 'Conflict',
    actionMainDirty: 'Main dirty',
    actionMainDirtyResolve: 'Main has uncommitted changes — click to resolve',
    actionConflictResolve: 'Merge conflict — click to resolve or abort',
    actionFailed: 'Action failed',
    actionFailedDetails: 'Action failed — click to see why',
    newTerminalAria: 'New terminal',
    collapseSessionList: 'Collapse session list',
    expandSessionList: 'Expand session list',
    editClaudeMdAria: 'Edit CLAUDE.md',
    editClaudeMdDisabled: 'CLAUDE.md editor — coming in Phase 7',
    editClaudeMdEnabled: 'Edit CLAUDE.md',
    mergeNoneReady: 'No trees ready to merge',
    mergeReady: 'Merge all ready trees in this repo',
    pushNothing: 'Nothing to push',
    pushReady: 'Push base branch to origin',
    mergePushNothing: 'Nothing to merge or push',
    mergePushReady: 'Merge all ready trees, then push',
    createPrNone: 'No trees ready to open PRs for',
    createPrReady: 'Open a PR for every ready tree in this repo',
    agentNameAria: 'Agent name',
    renameAgent: 'Rename agent',
    planMode: 'Plan mode — Claude will propose a plan before acting',
    planReady: 'Plan ready — waiting for your approval',
    viewDiff: 'View diff',
    viewDiffVsBase: 'View diff vs base branch',
    uncommittedTooltip: 'Uncommitted changes — Claudinha will auto-commit them before merging.',
    railHeader: 'Repos',
    railNoWorkspace: 'No workspace bound.',
    railLoading: 'Loading repo data…',
    railNewTerminalButton: '+ Terminal(s)',
    railReposEmpty: 'No repos yet.',
    repoRailSessionsLabel: 'Sessions',
    repoRailPausedLabel: 'Paused',
    repoRailEmptyCard: 'No sessions yet.',
    repoCardAriaFmt: (label: string): string => `Repo ${label}`,
    agentsPlural: (n: number): string => (n === 1 ? 'agent' : 'agents'),
    mergeAction: 'Merge',
    pushAction: 'Push',
    mergePushAction: 'Merge + push',
    createPrAction: 'Create PR',
    stopSequence: 'Stop sequence',
    stopSequenceTooltip: 'Cancel pending approvals. The tree currently implementing its plan keeps running.',
    approveInSequence: 'Approve plans in sequence',
    approveInSequenceTooltip: 'Approves each plan with auto-accept edits, kicking off the next when the current run ends.',
    retryFailedMerges: 'Retry failed merges',
    retryFailedMergesTooltip: 'Retries every tree in this repo whose last merge failed. Uses rebase-ff.',
    noActiveAgents: 'No active agents.'
  },

  completionBar: {
    mergeAllGrove: 'Merge all (this workspace) · rebase-ff',
    noGroveContext: 'No workspace context for this terminal.',
    createPrsGrove: 'Create PRs for all (this workspace)',
    createDraftPrsGrove: 'Create draft PRs for all (this workspace)',
    mergeButton: 'Merge',
    mergeDirty: 'Merge (dirty)',
    pushButton: 'Push',
    createPrButton: 'Create PR',
    createDraftPrButton: 'Create draft PR',
    queued: (pos: number): string => `Queued · ${pos}`,
    merging: 'Merging…',
    pushing: 'Pushing…',
    creatingPr: 'Creating PR…',
    mergedTo: (branch: string): string => `Merged → ${branch}`,
    pushedTo: (branch: string): string => `Pushed → ${branch}`,
    prCreated: 'PR created',
    error: 'Error',
    showError: 'Show error',
    resolvingConflict: 'Resolving conflict…',
    rebasingOntoMain: 'Rebasing onto main...',
    mergingIntoMain: 'Merging into main...',
    pushingToOrigin: 'Pushing to origin...',
    conflictDetected: 'Conflict detected',
    resolveWithClaude: '[Resolve with Claude]',
    abort: '[Abort]',
    mainDirty: 'main has uncommitted changes',
    mainDirtyWithCount: (n: number): string =>
      n === 1 ? 'main has uncommitted changes (1 file)' : `main has uncommitted changes (${n} files)`,
    moreFiles: (n: number): string => `…and ${n} more`,
    revealInFinder: 'Reveal in Finder',
    retry: 'Retry',
    closeAction: 'Close',
    mergedToMain: 'Merged to main',
    prCreatedAction: 'PR created',
    mergeOrPrFailed: 'Merge or PR failed',
    details: 'Details',
    queuedFmt: (ord: string): string => `Queued (${ord})`,
    cancelAction: '[Cancel]',
    mergeMenu: 'Merge ▾',
    prMenu: 'PR ▾',
    rebaseOntoMainAndMerge: 'Rebase onto main & merge',
    squashOntoMain: 'Squash onto main',
    mergeCommitIntoMain: 'Merge commit into main',
    pushAndCreatePr: 'Push & create PR',
    pushAndCreateDraftPr: 'Push & create draft PR',
    mergeAllGlobal: 'Merge all (global) · rebase-ff',
    createPrsAllGlobal: 'Create PRs for all (global)',
    installGhTooltip: 'Install gh CLI to create PRs',
    hideBarTooltip: 'Hide this bar (Esc)'
  },

  completionErrorModal: {
    title: 'Merge or PR failed',
    close: 'Close',
    retry: 'Retry',
    markResolved: 'Mark resolved',
    bodyHeader: 'Claude reported the following:'
  },

  turnsModal: {
    titleFmt: (paneName: string): string => `Turns · ${paneName}`,
    subtitle: 'Each agent turn is auto-committed and shown here. Pick turns to publish, split, or discard.',
    closeAria: 'Close turns modal',
    closeButton: 'Close',
    comingSoon: 'Turn-based completion actions are landing soon.',
    comingSoonBody:
      'M0 ships the foundation. Auto-commit on Stop, the turn list, publish/squash/split/discard, and side-clone merges arrive in the next milestones.',
    autoCommitToggle: 'Auto-commit on Stop',
    autoCommitToggleEnabled: 'On',
    autoCommitToggleDisabled: 'Off',
    sectionJustLanded: 'Just landed',
    sectionPending: 'Pending',
    sectionAlreadyPublished: 'Already published',
    turnNumberFmt: (n: number): string => `Turn ${n}`,
    turnRenumberedFmt: (current: number, original: number): string =>
      `Turn ${current} (was ${original})`,
    turnFilesAndLinesFmt: (files: number, added: number, removed: number): string =>
      `${files === 1 ? '1 file' : `${files} files`}  +${added}/-${removed}`,
    publishMenuLabel: 'Publish',
    publishSquashAndPush: 'Squash + push branch',
    publishSquashAndPushTooltip:
      'Squash the selected turns into one commit and push the worktree branch to origin. No merge into the base branch and no PR — useful for handing the branch off out-of-band.',
    publishSquashAndPushTooltipMain:
      'Squash the selected commits and push to origin/<base>. Refused when origin has diverged.',
    publishSquashAndMerge: 'Squash + merge to origin',
    publishSquashAndMergeFmt: (base: string): string => `Squash + merge to origin/${base}`,
    publishSquashAndMergeTooltip:
      'Squash the selected turns and merge them straight into the base branch via a side-clone, then push base to origin. Skips the PR step entirely. Best for solo work.',
    publishSquashAndPr: 'Squash + open PR',
    publishSquashAndPrTooltip:
      'Squash the selected turns and open a regular pull request via `gh`. The branch is pushed to origin and you finish review on GitHub.',
    publishSquashAndDraftPr: 'Squash + open draft PR',
    publishSquashAndDraftPrTooltip:
      'Same as Squash + open PR, but creates the PR in draft mode (won\'t auto-notify reviewers or trigger required checks until you mark it ready).',
    publishIndividual: 'Publish each turn individually',
    publishSplit: 'Split a turn…',
    splitAction: 'Split',
    splitTooltip: 'Split this turn into two commits by hunk. Useful when the turn touched multiple files and you want to land them as separate commits.',
    splitDisabledHint: 'Splitting only applies to open turns that touch more than one file.',
    discardAction: 'Discard',
    discardTooltip: 'Drop this turn from the worktree branch. Already-pushed turns will be force-removed from origin too.',
    discardConfirmTitle: 'Discard this turn?',
    discardConfirmBodyFmt: (turn: number): string =>
      `Turn ${turn} will be removed from the worktree branch. The reflog still has it for ~30 days, but Claudinha won't show it again.`,
    discardCascadeWarningFmt: (count: number): string =>
      count === 1
        ? `1 later turn depends on this one. Discarding will rebase that turn onto the previous parent.`
        : `${count} later turns depend on this one. Discarding will rebase them onto the previous parent.`,
    discardConfirmButton: 'Discard',
    discardCancelButton: 'Cancel',
    splitTitleFmt: (turn: number): string => `Split turn ${turn}`,
    splitBodyHint:
      'Pick which hunks go to the FIRST commit. The rest go to the SECOND.',
    splitConfirmButton: 'Split',
    splitCancelButton: 'Cancel',
    pendingActionLabel: 'Working…',
    publishingSquashFmt: (count: number): string =>
      count === 1 ? 'Squashing 1 turn…' : `Squashing ${count} turns…`,
    publishingIndividualFmt: (count: number): string =>
      count === 1 ? 'Publishing 1 turn…' : `Publishing ${count} turns…`,
    splitting: 'Splitting…',
    discarding: 'Discarding…',
    merging: 'Merging…',
    openingPr: 'Opening PR…',
    publishPathDirectMerge: 'Direct merge',
    publishPathPr: 'Pull request',
    publishPathBoth: 'Both',
    /** Pill that opens the modal, on the kanban changes-ready card and the wall-mode header. */
    pillIdle: 'View turns',
    pillCountFmt: (n: number): string => (n === 1 ? '1 turn' : `${n} turns`),
    /** Empty-state when no turns yet (Stop hasn't fired with file changes). */
    emptyState: 'No turns yet. Auto-commit fires when the agent stops with file changes.',
    autoCommitToggleAria: 'Toggle auto-commit on Stop'
  },

  changesReadyModal: {
    title: 'Changes ready',
    closeAria: 'Close',
    commitsHeader: 'Commits',
    pendingChanges: 'Pending changes',
    pendingChangesFmt: (added: number, removed: number, files: number): string =>
      `+${added}/-${removed} across ${files === 1 ? '1 file' : `${files} files`}`,
    /** Renders the file-name summary in the pending row. The full count is
     *  the canonical source of truth; the names are a richness layer on top.
     *  1 file → just the basename; 2–3 → comma-joined; 4+ → first two + "+N more". */
    pendingChangedFilesFmt: (files: string[], totalCount: number): string => {
      const basenames = files.map((f) => f.split('/').pop() || f)
      if (totalCount === 0) return ''
      if (totalCount === 1) return basenames[0] ?? ''
      if (totalCount <= 3) return basenames.slice(0, totalCount).join(', ')
      const head = basenames.slice(0, 2).join(', ')
      const more = totalCount - 2
      return `${head}, +${more} more`
    },
    /** Default commit message synthesized from the changed-files list. The
     *  user can edit before clicking Commit; this is just a starting point
     *  that's more useful than "Update 1 file". */
    defaultCommitMessageFmt: (files: string[], totalCount: number): string => {
      if (totalCount === 0) return ''
      const basename = files[0]?.split('/').pop() || files[0] || ''
      if (totalCount === 1) return `Update ${basename}`
      const remainder = totalCount - 1
      return `Update ${basename} and ${remainder} more ${remainder === 1 ? 'file' : 'files'}`
    },
    noCommits: 'No commits yet on this branch.',
    viewDiffs: 'View diffs',
    discard: 'Discard',
    discardTooltip: 'Close terminal and remove the worktree',
    actionCommit: 'Commit',
    actionCommitting: 'Committing',
    actionCommitted: 'Committed',
    actionCommitFailed: 'Commit failed',
    actionMergeToMain: 'Merge to main',
    actionMerging: 'Merging',
    actionMerged: 'Merged',
    actionMergeFailed: 'Merge failed',
    actionPushToMain: 'Push to main',
    actionPushToBranch: 'Push to branch',
    /** Label for the merge-target button when the user has picked a branch via
     *  the inline picker. Replaces `actionMergeToMain` when picker is engaged. */
    mergeToBranchFmt: (branch: string): string => `Merge to ${branch}`,
    /** Label for the push-to-base button on the top action path. Mirrors the
     *  picker so the merge + push read coherently as a pair. */
    pushToBaseFmt: (branch: string): string => `Push to ${branch}`,
    /** Tooltip on the picker chevron. */
    branchPickerTooltip: 'Choose merge target',
    branchPickerLoading: 'Loading branches…',
    branchPickerEmpty: 'No other local branches',
    actionPushing: 'Pushing',
    actionPushed: 'Pushed',
    actionPushFailed: 'Push failed',
    actionCreatePr: 'Create PR',
    actionCreatingPr: 'Creating PR',
    actionPrOpened: 'PR opened',
    actionPrFailed: 'PR failed',
    actionQueued: 'Queued',
    actionAwaitingCommit: 'Awaiting commit',
    actionAwaitingMerge: 'Awaiting merge',
    actionAwaitingPush: 'Awaiting push',
    ghMissingTooltip: 'Install gh CLI to create PRs',
    errorBannerTitle: 'Action failed',
    errorBannerRetry: 'Retry',
    errorBannerDismiss: 'Dismiss',
    rewordTitle: 'Edit commit message',
    rewordSave: 'Save',
    rewordCancel: 'Cancel',
    rewordSaveHint: 'Enter saves, Esc cancels.',
    rewordPushedTooltip: 'This commit has been pushed — editing would require a force-push.',
    rewordDirtyTooltip: 'Commit pending changes before editing earlier messages.',
    pendingMessagePlaceholder: 'Commit message',
    pendingCommitTooltip: 'Edit commit message',
    commitListLoadError: 'Failed to load commits.',
    commitNowAria: 'Commit pending changes',
    roundPushed: 'Pushed to branch',
    revealWorktree: 'Show in folder'
  },

  conflictModal: {
    title: 'Merge conflict',
    subtitleFmt: (repoLabel: string, treeLabel: string): string =>
      `${repoLabel} · ${treeLabel} — the rebase paused on a conflict.`,
    body: 'Let Claude reopen this tree and try to resolve the conflict, or abort and clean it up yourself.',
    resolveAction: 'Resolve with Claude',
    abortAction: 'Abort',
    abortConfirm: 'Abort — are you sure?',
    abortConfirmHint: 'Click again to abort the rebase.',
    closeAction: 'Close',
    errorPrefix: 'Action failed:'
  },

  dirtyMainModal: {
    title: 'Uncommitted changes on main',
    subtitleFmt: (repoLabel: string, baseBranch: string): string =>
      `${repoLabel} · ${baseBranch} — clean these up before merging.`,
    fileListHeader: 'Files:',
    moreFiles: (n: number): string => `…and ${n} more`,
    commitAction: 'Commit all',
    stashAction: 'Stash',
    discardAction: 'Discard',
    discardConfirm: 'Discard — are you sure?',
    discardConfirmHint: 'Click again to discard. This cannot be undone.',
    revealAction: 'Reveal in Finder',
    retryAction: 'Retry merge',
    closeAction: 'Close',
    commitMessageLabel: 'Commit message',
    commitMessageDefault: 'WIP before merge from Claudinha',
    stashMessageDefault: 'Claudinha: dirty-main stash before merge',
    commitConfirm: 'Commit',
    commitCancel: 'Cancel',
    busyMessage: 'A merge is in progress for this repo. Try again when it finishes.',
    emptyMessage: 'Nothing left to resolve.',
    errorPrefix: 'Action failed:'
  },

  contextBar: {
    estimateLabel: 'Context',
    pctRemaining: (pct: number): string => `${pct}% left`,
    nearLimit: 'Approaching context limit'
  },

  diffViewer: {
    title: 'Diff vs base',
    close: 'Close',
    closeAria: 'Close',
    diffForFmt: (name: string): string => `Diff for ${name}`,
    vsBranchFmt: (branch: string): string => ` · vs ${branch}`,
    truncated: 'Diff truncated — see full output via',
    truncatedSuffix: 'in the terminal.',
    loading: 'Loading diff…',
    noDifferences: 'No differences vs the base branch.',
    fileNoChanges: 'No changes in this file.',
    binaryFile: 'Binary file — not shown.',
    selectFile: 'Select a file to view its diff.'
  },

  effortPopover: {
    label: 'Effort',
    minimal: 'Minimal',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'X High',
    max: 'Max'
  },

  modelPopover: {
    label: 'Model',
    none: 'None',
    opus: 'Opus',
    sonnet: 'Sonnet',
    haiku: 'Haiku'
  },

  policyPopover: {
    label: 'When this terminal finishes',
    askLabel: 'Ask',
    autoMergeLabel: 'Auto-merge',
    autoPrLabel: 'Auto-create PR',
    autoDraftPrLabel: 'Auto-create draft PR',
    pruneOnMergeLabel: 'Delete worktree after merge',
    strategyLabel: 'Merge strategy',
    strategyRebaseFf: 'Rebase + fast-forward',
    strategyMerge: 'Merge commit',
    headerThisWorkspace: 'This workspace',
    headerGlobalDefault: 'Global default',
    workspaceLabel: 'Workspace: ',
    globalLabel: 'Global: ',
    inheritGlobal: 'inherit global',
    askManual: 'ask (manual)',
    askManualLabel: 'Ask (manual)',
    autoMergeRebase: 'Auto-merge · rebase onto main',
    autoMergeSquash: 'Auto-merge · squash',
    autoMergeMergeCommit: 'Auto-merge · merge commit',
    summaryAutoMergeFmt: (strategy: string): string => `auto-merge · ${strategy}`,
    summaryAutoPr: 'auto-create PR',
    summaryAutoDraftPr: 'auto-create draft PR',
    clearOverride: 'Clear workspace override',
    pruneOnMergeRow: 'Prune worktree + auto-close on merge'
  },

  rateLimit: {
    sessionLabel: 'Session',
    weekLabel: 'Week',
    weekOpusLabel: 'Week (Opus)',
    resetsIn: (when: string): string => `Resets ${when}`,
    pctUsed: (pct: number): string => `${pct}% used`,
    rateLimitsHeader: 'Rate Limits:'
  },

  metricsOverlay: {
    title: 'Session metrics',
    close: 'Close',
    tokensIn: 'Tokens in',
    tokensOut: 'Tokens out',
    cacheRead: 'Cache read',
    cacheCreate: 'Cache create',
    elapsed: 'Elapsed',
    totalCost: 'Estimated cost'
  },

  statusOverlay: {
    pausedTitle: 'Terminal paused',
    pausedBody: 'This terminal is currently paused. Resume to continue.',
    resumeButton: 'Resume',
    discardButton: 'Discard',
    lostTitle: 'Terminal lost',
    lostBody: 'Connection to this terminal was lost. You can try to recover or close it.',
    recoverButton: 'Recover',
    closeButton: 'Close',
    labelAwaitingOrders: 'Awaiting orders',
    labelWorking: 'Working',
    labelNeedsInput: 'Needs input',
    labelDone: 'Changes ready',
    labelError: 'Error',
    labelLost: 'Lost',
    labelResolvingConflict: 'Resolving Conflict',
    labelResolvingConflictFmt: (tool: string): string => `Resolving Conflict: ${tool}`,
    modifiedFmt: (n: number): string => `${n} modified`,
    aheadFmt: (n: number): string => `${n} ahead`
  },

  toolUsageRow: {
    label: 'Tools'
  },

  kanbanResizeHandle: {
    aria: 'Resize Kanban board',
    title: 'Drag to resize Kanban board'
  },

  railResizeHandle: {
    aria: 'Resize repo rail',
    title: 'Drag to resize repo rail'
  },

  rail: {
    groupByLabel: 'Group by',
    groupByRepo: 'Repo',
    groupByStatus: 'Status',
    groupByAria: 'Group rail by repo or status',
    viewTurns: 'View turns',
    emptyAgents: 'No agents in this group.',
    emptyRail: 'Spawn an agent to populate the rail.'
  },

  configError: {
    title: 'Something went wrong',
    body: 'Claudinha hit an unexpected error rendering this view. Restart the app or report it via Submit Feedback.',
    reload: 'Reload window'
  },

  merge: {
    autoCommitNote: 'Any uncommitted work will be committed first.'
  },

  permissionRemoveConfirm: {
    title: (rule: string): string => `Remove permission “${rule}”?`,
    body: 'Claude will ask before running this tool again.',
    cancel: 'Cancel',
    confirm: 'Remove',
    modalTitle: 'Remove permission rule?',
    listAllow: 'allow',
    listDeny: 'deny',
    bodyFmt: (rule: string, list: string): string => `Remove "${rule}" from the ${list} list?`,
    subtextDefault: 'This default rule will no longer be enforced. Claude will prompt on use.',
    subtextUser: 'This user-added rule will be deleted.'
  }
}

export type Strings = typeof en
