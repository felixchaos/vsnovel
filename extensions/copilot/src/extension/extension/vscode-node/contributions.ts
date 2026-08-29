/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptFileContribution } from '../../agents/vscode-node/promptFileContrib';
import { AuthenticationContrib } from '../../authentication/vscode-node/authentication.contribution';
import { BYOKContrib } from '../../byok/vscode-node/byokContribution';
import { ChatDebugFileLoggerContribution } from '../../chat/vscode-node/chatDebugFileLoggerService';
import { ChatQuotaContribution } from '../../chat/vscode-node/chatQuota.contribution';
import { ChatSessionContextContribution } from '../../chatSessionContext/vscode-node/chatSessionContextProvider';
// NOVEL-BUILDER: ChatSessionsContrib is not registered. It hosts two alternate
// agent back-ends — Copilot CLI and Claude Code — whose npm packages
// (@github/copilot, @anthropic-ai/claude-agent-sdk) are proprietary and cannot
// ship in a commercial product. Both are also independent session types that
// bypass ChatParticipantRequestHandler/AgentPrompt entirely, so the prose
// tuning in prompts/node/ has no effect on them.
//
// The import is removed rather than the registration alone because esbuild
// walks the entry graph: with no import the whole subtree is unreachable and is
// tree-shaken out, which is what actually keeps the proprietary packages out of
// the bundle. The source stays in the tree on purpose — deleting it would turn
// every upstream change under chatSessions/ into a delete/modify conflict on
// each rebase, and CLAUDE.md rules out deleting directories under extensions/.
import { SessionStoreTracker } from '../../chronicle/vscode-node/sessionStoreTracker';
import * as sessionSyncContribution from '../../chronicle/vscode-node/sessionSync.contribution';
import * as chatBlockLanguageContribution from '../../codeBlocks/vscode-node/chatBlockLanguageFeatures.contribution';
import { IExtensionContributionFactory, asContributionFactory } from '../../common/contributions';
import { CompletionsUnificationContribution } from '../../completions/vscode-node/completionsUnificationContribution';
import { ConfigurationMigrationContribution } from '../../configuration/vscode-node/configurationMigration';
import { InternalConfigurationInformationCommandContribution } from '../../configuration/vscode-node/internalConfigurationInformationCommand';
import { ContextKeysContribution } from '../../contextKeys/vscode-node/contextKeys.contribution';
import { ByokUtilityModelNotificationContribution } from '../../chatInputNotification/vscode-node/byokUtilityModel.contribution';
import { AiMappedEditsContrib } from '../../conversation/vscode-node/aiMappedEditsContrib';
import { ConversationFeature } from '../../conversation/vscode-node/conversationFeature';
import { FeedbackCommandContribution } from '../../conversation/vscode-node/feedbackContribution';
import { LanguageModelAccess } from '../../conversation/vscode-node/languageModelAccess';
// NOVEL-BUILDER: see the registration below.
import { NameDiagnosticsContrib } from '../../../novel/names/nameDiagnostics';
import { ConsistencyDiagnosticsContrib } from '../../../novel/consistency/consistencyDiagnostics';
import { GlossaryDiagnosticsContrib } from '../../../novel/glossary/glossaryDiagnostics';
import { GlossaryCommandsContrib } from '../../../novel/glossary/enforceCommand';
import { AuthoringCommandsContrib } from '../../../novel/authoring/authoringCommands';
import { WritingInstructionsContrib } from '../../../novel/authoring/writingInstructions';
import { GrokAgentContribution } from '../../../novel/grok/contribution';
import { BalanceStatusContrib } from '../../../novel/status/balanceStatus';
import { LogWorkspaceStateContribution } from '../../conversation/vscode-node/logWorkspaceState';
import { RemoteAgentContribution } from '../../conversation/vscode-node/remoteAgents';
import { DiagnosticsContextContribution } from '../../diagnosticsContext/vscode/diagnosticsContextProvider';
import { LanguageModelProxyContrib } from '../../externalAgents/vscode-node/lmProxyContrib';
import { WalkthroughCommandContribution } from '../../getting-started/vscode-node/commands';
import * as newWorkspaceContribution from '../../getting-started/vscode-node/newWorkspace.contribution';
import { ScmContextProviderContribution } from '../../git/vscode/scmContextprovider';
import { GitHubMcpContrib } from '../../githubMcp/vscode-node/githubMcp.contribution';
import { IgnoredFileProviderContribution } from '../../ignore/vscode-node/ignoreProvider';
import { JointCompletionsProviderContribution } from '../../inlineEdits/vscode-node/jointInlineCompletionProvider';
import { FixTestFailureContribution } from '../../intents/vscode-node/fixTestFailureContributions';
import { ExtensionStateCommandContribution } from '../../log/vscode-node/extensionStateCommand';
import { FetcherTelemetryContribution, LoggingActionsContrib } from '../../log/vscode-node/loggingActions';
import { RequestLogTree } from '../../log/vscode-node/requestLogTree';
import { McpSetupCommands } from '../../mcp/vscode-node/commands';
import { NotebookFollowCommands } from '../../notebook/vscode-node/followActions';
import { CopilotDebugCommandContribution } from '../../onboardDebug/vscode-node/copilotDebugCommandContribution';
import { OnboardTerminalTestsContribution } from '../../onboardDebug/vscode-node/onboardTerminalTestsContribution';
import { OTelContrib } from '../../otel/vscode-node/otelContrib';
import { PowerStateLogger } from '../../power/vscode-node/powerStateLogger';
import { DebugCommandsContribution } from '../../prompt/vscode-node/debugCommands';
import { RenameSuggestionsContrib } from '../../prompt/vscode-node/renameSuggestions';
import { PromptFileContextContribution } from '../../promptFileContext/vscode-node/promptFileContextService';
import { SearchPanelCommands } from '../../search/vscode-node/commands';
import { SettingsSchemaFeature } from '../../settingsSchema/vscode-node/settingsSchemaFeature';
import { SurveyCommandContribution } from '../../survey/vscode-node/surveyCommands';
import { SetupTestsContribution } from '../../testing/vscode/setupTestContributions';
import { ToolsContribution } from '../../tools/vscode-node/tools';
import { OTelChatDebugLogProviderContribution } from '../../trajectory/vscode-node/otelChatDebugLogProvider';
import { InlineCompletionContribution } from '../../typescriptContext/vscode-node/languageContextService';
import { NesRenameContribution } from '../../typescriptContext/vscode-node/nesRenameService';
import * as workspaceIndexingContribution from '../../workspaceChunkSearch/vscode-node/workspaceChunkSearch.contribution';
import { WorkspaceRecorderFeature } from '../../workspaceRecorder/vscode-node/workspaceRecorderFeature';
import vscodeContributions from '../vscode/contributions';

// ###################################################################################################
// ###                                                                                             ###
// ###                   Node contributions run ONLY in node.js extension host.                    ###
// ###                                                                                             ###
// ### !!! Prefer to list contributions in ../vscode/contributions.ts to support them anywhere !!! ###
// ###                                                                                             ###
// ###################################################################################################

export const vscodeNodeContributions: IExtensionContributionFactory[] = [

	...vscodeContributions,
	asContributionFactory(ExtensionStateCommandContribution),
	asContributionFactory(ConversationFeature),
	// NOVEL-BUILDER: the credit balance, as a row in the chat status popup.
	// First among the contributed rows because they render in registration
	// order and this is the one an author opens the popup to read.
	asContributionFactory(BalanceStatusContrib),
	asContributionFactory(AuthenticationContrib),
	chatBlockLanguageContribution,
	asContributionFactory(LoggingActionsContrib),
	asContributionFactory(FetcherTelemetryContribution),
	asContributionFactory(PowerStateLogger),
	asContributionFactory(ContextKeysContribution),
	asContributionFactory(ByokUtilityModelNotificationContribution),
	asContributionFactory(CopilotDebugCommandContribution),
	asContributionFactory(DebugCommandsContribution),
	asContributionFactory(LanguageModelAccess),
	// NOVEL-BUILDER: name-drift diagnostics. Registered here because a
	// DiagnosticCollection and a CodeActionProvider have no other entry point —
	// they must be created during activation and disposed with the extension.
	asContributionFactory(NameDiagnosticsContrib),
	asContributionFactory(ConsistencyDiagnosticsContrib),
	asContributionFactory(GlossaryDiagnosticsContrib),
	asContributionFactory(GlossaryCommandsContrib),
	asContributionFactory(AuthoringCommandsContrib),
	// NOVEL-BUILDER: the way in to `.github/copilot-instructions.md`. The
	// mechanism is upstream's and needs nothing; what it lacks is an entry point
	// an author who has never seen a dotted directory can find.
	asContributionFactory(WritingInstructionsContrib),
	// NOVEL-BUILDER: the Grok agent session. It hosts xAI's own `grok` CLI over
	// the Agent Client Protocol, which is the integration path xAI documents,
	// so the credential stays with the CLI and never reaches this editor.
	asContributionFactory(GrokAgentContribution),
	asContributionFactory(WalkthroughCommandContribution),
	asContributionFactory(JointCompletionsProviderContribution),
	// replaced by JointCompletionsProviderContribution
	// asContributionFactory(InlineEditProviderFeatureContribution),
	// asContributionFactory(CompletionsCoreContribution),
	asContributionFactory(SettingsSchemaFeature),
	asContributionFactory(InternalConfigurationInformationCommandContribution),
	asContributionFactory(WorkspaceRecorderFeature),
	asContributionFactory(SurveyCommandContribution),
	asContributionFactory(FeedbackCommandContribution),
	asContributionFactory(InlineCompletionContribution),
	asContributionFactory(NesRenameContribution),
	asContributionFactory(SearchPanelCommands),
	asContributionFactory(ChatQuotaContribution),
	asContributionFactory(NotebookFollowCommands),
	asContributionFactory(PromptFileContextContribution),
	asContributionFactory(ScmContextProviderContribution),
	asContributionFactory(DiagnosticsContextContribution),
	asContributionFactory(ChatSessionContextContribution),
	asContributionFactory(CompletionsUnificationContribution),
	workspaceIndexingContribution,
	asContributionFactory(GitHubMcpContrib),
	asContributionFactory(OTelContrib),
	asContributionFactory(SessionStoreTracker),
	sessionSyncContribution,
	asContributionFactory(BYOKContrib),
];

/**
 * These contributions are special in that they are only instantiated
 * when the user is logged in and chat is enabled.
 * Anything that contributes a copilot chat feature that doesn't need
 * to run when chat is not enabled should be added here.
*/
export const vscodeNodeChatContributions: IExtensionContributionFactory[] = [
	asContributionFactory(ConfigurationMigrationContribution),
	asContributionFactory(RequestLogTree),
	asContributionFactory(OnboardTerminalTestsContribution),
	asContributionFactory(ToolsContribution),
	asContributionFactory(RemoteAgentContribution),
	asContributionFactory(AiMappedEditsContrib),
	asContributionFactory(RenameSuggestionsContrib),
	asContributionFactory(LogWorkspaceStateContribution),
	asContributionFactory(SetupTestsContribution),
	asContributionFactory(FixTestFailureContribution),
	asContributionFactory(IgnoredFileProviderContribution),
	asContributionFactory(McpSetupCommands),
	asContributionFactory(LanguageModelProxyContrib),
	asContributionFactory(PromptFileContribution),
	newWorkspaceContribution,
	asContributionFactory(OTelChatDebugLogProviderContribution),
	asContributionFactory(ChatDebugFileLoggerContribution),
];
