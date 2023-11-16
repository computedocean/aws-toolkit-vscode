/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ChatItem, ChatItemFollowUp, ChatItemType, FeedbackPayload } from '@aws/mynah-ui-chat'
import { ExtensionMessage } from '../commands'
import { TabsStorage } from '../storages/tabsStorage'
import { CodeReference } from './amazonqCommonsConnector'

interface ChatPayload {
    chatMessage: string
}

export interface ConnectorProps {
    sendMessageToExtension: (message: ExtensionMessage) => void
    onMessageReceived?: (tabID: string, messageData: any, needToShowAPIDocsTab: boolean) => void
    onAsyncEventProgress: (tabID: string, inProgress: boolean, message: string) => void
    onChatAnswerReceived?: (tabID: string, message: ChatItem) => void
    sendFeedback?: (tabId: string, feedbackPayload: FeedbackPayload) => void | undefined
    onError: (tabID: string, message: string, title: string) => void
    onWarning: (tabID: string, message: string, title: string) => void
    onUpdatePlaceholder: (tabID: string, newPlaceholder: string) => void
    onChatInputEnabled: (tabID: string, enabled: boolean) => void
    onUpdateAuthentication: (featureDevEnabled: boolean) => void
    tabsStorage: TabsStorage
}

export class Connector {
    private readonly sendMessageToExtension
    private readonly onError
    private readonly onWarning
    private readonly onChatAnswerReceived
    private readonly onAsyncEventProgress
    private readonly updatePlaceholder
    private readonly chatInputEnabled
    private readonly onUpdateAuthentication

    constructor(props: ConnectorProps) {
        this.sendMessageToExtension = props.sendMessageToExtension
        this.onChatAnswerReceived = props.onChatAnswerReceived
        this.onWarning = props.onWarning
        this.onError = props.onError
        this.onAsyncEventProgress = props.onAsyncEventProgress
        this.updatePlaceholder = props.onUpdatePlaceholder
        this.chatInputEnabled = props.onChatInputEnabled
        this.onUpdateAuthentication = props.onUpdateAuthentication
    }

    onCodeInsertToCursorPosition = (
        tabID: string,
        code?: string,
        type?: 'selection' | 'block',
        codeReference?: CodeReference[]
    ): void => {
        this.sendMessageToExtension({
            tabID: tabID,
            code,
            command: 'insert_code_at_cursor_position',
            codeReference,
            tabType: 'featuredev',
        })
    }

    onCopyCodeToClipboard = (
        tabID: string,
        code?: string,
        type?: 'selection' | 'block',
        codeReference?: CodeReference[]
    ): void => {
        this.sendMessageToExtension({
            tabID: tabID,
            code,
            command: 'code_was_copied_to_clipboard',
            codeReference,
            tabType: 'featuredev',
        })
    }

    onOpenDiff = (tabID: string, leftPath: string, rightPath: string): void => {
        this.sendMessageToExtension({
            command: 'open-diff',
            tabID,
            leftPath,
            rightPath,
            tabType: 'featuredev',
        })
    }

    followUpClicked = (tabID: string, followUp: ChatItemFollowUp): void => {
        this.sendMessageToExtension({
            command: 'follow-up-was-clicked',
            followUp,
            tabID,
            tabType: 'featuredev',
        })
    }

    requestGenerativeAIAnswer = (tabID: string, payload: ChatPayload): Promise<any> =>
        new Promise((resolve, reject) => {
            this.sendMessageToExtension({
                tabID: tabID,
                command: 'chat-prompt',
                chatMessage: payload.chatMessage,
                tabType: 'featuredev',
            })
        })

    private processChatMessage = async (messageData: any): Promise<void> => {
        if (this.onChatAnswerReceived !== undefined) {
            const answer: ChatItem = {
                type: messageData.messageType,
                body: messageData.message ?? undefined,
                messageId: messageData.messageID ?? messageData.triggerID ?? '',
                relatedContent: undefined,
                canBeVoted: messageData.canBeVoted,
                followUp:
                    messageData.followUps !== undefined && messageData.followUps.length > 0
                        ? {
                              text:
                                  messageData.messageType === ChatItemType.SYSTEM_PROMPT
                                      ? ''
                                      : 'Please follow up with one of these',
                              options: messageData.followUps,
                          }
                        : undefined,
            }
            this.onChatAnswerReceived(messageData.tabID, answer)
        }
    }

    private processFilePathMessage = async (messageData: any): Promise<void> => {
        if (this.onChatAnswerReceived !== undefined) {
            const answer: ChatItem = {
                type: ChatItemType.CODE_RESULT,
                body: messageData.filePaths,
                relatedContent: undefined,
                followUp: undefined,
                canBeVoted: true,
                // TODO get the backend to store a message id in addition to conversationID
                messageId: messageData.messageID ?? messageData.triggerID ?? messageData.conversationID,
            }
            this.onChatAnswerReceived(messageData.tabID, answer)
        }
    }

    handleMessageReceive = async (messageData: any): Promise<void> => {
        if (messageData.type === 'errorMessage') {
            this.onError(messageData.tabID, messageData.message, messageData.title)
            return
        }

        if (messageData.type === 'showInvalidTokenNotification') {
            this.onWarning(messageData.tabID, messageData.message, messageData.title)
            return
        }

        if (messageData.type === 'chatMessage') {
            await this.processChatMessage(messageData)
            return
        }

        if (messageData.type === 'filePathMessage') {
            await this.processFilePathMessage(messageData)
            return
        }

        if (messageData.type === 'asyncEventProgressMessage') {
            this.onAsyncEventProgress(messageData.tabID, messageData.inProgress, messageData.message ?? undefined)
            return
        }

        if (messageData.type === 'updatePlaceholderMessage') {
            this.updatePlaceholder(messageData.tabID, messageData.newPlaceholder)
            return
        }

        if (messageData.type === 'chatInputEnabledMessage') {
            this.chatInputEnabled(messageData.tabID, messageData.enabled)
            return
        }

        if (messageData.type === 'authenticationUpdateMessage') {
            this.onUpdateAuthentication(messageData.featureDevEnabled)
            return
        }
    }

    onStopChatResponse = (tabID: string): void => {
        this.sendMessageToExtension({
            tabID: tabID,
            command: 'stop-response',
        })
    }

    onTabOpen = (tabID: string): void => {
        this.sendMessageToExtension({
            tabID,
            command: 'new-tab-was-created',
            tabType: 'featuredev',
        })
    }

    onTabRemove = (tabID: string): void => {
        this.sendMessageToExtension({
            tabID: tabID,
            command: 'tab-was-removed',
            tabType: 'featuredev',
        })
    }

    sendFeedback = (tabId: string, feedbackPayload: FeedbackPayload): void | undefined => {
        // TODO implement telemetry
    }

    onChatItemVoted = (tabId: string, messageId: string, vote: string): void | undefined => {
        this.sendMessageToExtension({
            tabID: tabId,
            messageId: messageId,
            vote: vote,
            command: 'chat-item-voted',
            tabType: 'featuredev',
        })
    }
}
