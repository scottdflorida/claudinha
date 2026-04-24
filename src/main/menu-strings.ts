/**
 * Main-process bundle for the OS menu bar. Kept separate from the renderer
 * bundle (src/renderer/lib/strings/) because main and renderer don't share
 * a build, and because the main-process surface is small. New main-process
 * dialog text should land here too.
 */

export interface MenuStrings {
  fileMenu: string
  newTerminal: string
  newWorkspace: string
  clearPane: string
  closeWorkspace: string
  quit: string
  editMenu: string
  viewMenu: string
  windowMenu: string
  showManagement: string
  helpMenu: string
  sendFeedback: string
  analytics: string
  aboutClaudinha: string
  // Native dialog strings — auto-updater + close-confirmation fallbacks. Kept
  // in this bundle so all main-process user-facing copy lives in one place.
  updateAvailableTitle: string
  updateAvailableMessage: (version: string) => string
  updateAvailableDetail: string
  updateAvailableButtonDownload: string
  updateAvailableButtonLater: string
  updateReadyTitle: string
  updateReadyMessage: string
  updateReadyDetail: string
  updateReadyButtonRestart: string
  updateReadyButtonLater: string
  notRespondingMessage: string
  notRespondingDetail: (count: number) => string
  cancelButton: string
  closeAnywayButton: string
}

const en: MenuStrings = {
  fileMenu: 'File',
  newTerminal: 'New Terminal',
  newWorkspace: 'New Workspace',
  clearPane: 'Clear Terminal',
  closeWorkspace: 'Close Workspace',
  quit: 'Quit',
  editMenu: 'Edit',
  viewMenu: 'View',
  windowMenu: 'Window',
  showManagement: 'Show Claudinha Management',
  helpMenu: 'Help',
  sendFeedback: 'Send Feedback…',
  analytics: 'Analytics…',
  aboutClaudinha: 'About Claudinha',
  updateAvailableTitle: 'Update Available',
  updateAvailableMessage: (version: string) => `Claudinha ${version} is available.`,
  updateAvailableDetail: 'Would you like to download and install the update?',
  updateAvailableButtonDownload: 'Download Update',
  updateAvailableButtonLater: 'Later',
  updateReadyTitle: 'Update Ready',
  updateReadyMessage: 'Update downloaded.',
  updateReadyDetail: 'The update will be installed when you quit the app.',
  updateReadyButtonRestart: 'Restart Now',
  updateReadyButtonLater: 'Later',
  notRespondingMessage: 'Claudinha is not responding.',
  notRespondingDetail: (count: number) =>
    `${count} active session(s) will be terminated.\n\nThe in-app confirmation couldn't be shown. You can cancel and try again, or force-close the window.`,
  cancelButton: 'Cancel',
  closeAnywayButton: 'Close Anyway'
}

const ptBR: MenuStrings = {
  fileMenu: 'Arquivo',
  newTerminal: 'Novo Terminal',
  newWorkspace: 'Novo Espaço de Trabalho',
  clearPane: 'Limpar Terminal',
  closeWorkspace: 'Fechar Espaço de Trabalho',
  quit: 'Sair',
  editMenu: 'Editar',
  viewMenu: 'Visualizar',
  windowMenu: 'Janela',
  showManagement: 'Mostrar Gerenciamento da Claudinha',
  helpMenu: 'Ajuda',
  sendFeedback: 'Enviar Feedback…',
  analytics: 'Telemetria…',
  aboutClaudinha: 'Sobre a Claudinha',
  updateAvailableTitle: 'Atualização Disponível',
  updateAvailableMessage: (version: string) => `A Claudinha ${version} está disponível.`,
  updateAvailableDetail: 'Deseja baixar e instalar a atualização?',
  updateAvailableButtonDownload: 'Baixar Atualização',
  updateAvailableButtonLater: 'Depois',
  updateReadyTitle: 'Atualização Pronta',
  updateReadyMessage: 'Atualização baixada.',
  updateReadyDetail: 'A atualização será instalada ao sair do app.',
  updateReadyButtonRestart: 'Reiniciar Agora',
  updateReadyButtonLater: 'Depois',
  notRespondingMessage: 'A Claudinha não está respondendo.',
  notRespondingDetail: (count: number) =>
    `${count} sessão(ões) ativa(s) serão encerradas.\n\nA confirmação no app não pôde ser exibida. Você pode cancelar e tentar novamente, ou forçar o fechamento da janela.`,
  cancelButton: 'Cancelar',
  closeAnywayButton: 'Fechar Mesmo Assim'
}

const BUNDLES: Record<'en' | 'pt-BR', MenuStrings> = { en, 'pt-BR': ptBR }

export function getMenuStrings(language: 'en' | 'pt-BR'): MenuStrings {
  return BUNDLES[language] ?? en
}
