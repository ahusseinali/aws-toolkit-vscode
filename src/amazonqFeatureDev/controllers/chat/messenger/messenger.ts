/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { FollowUpTypes, SessionStatePhase } from '../../../types'
import { CodeReference } from '../../../../amazonq/webview/ui/apps/amazonqCommonsConnector'
import {
    ChatMessage,
    AsyncEventProgressMessage,
    ErrorMessage,
    CodeResultMessage,
    UpdatePlaceholderMessage,
    ChatInputEnabledMessage,
    AuthenticationUpdateMessage,
} from '../../../views/connector/connector'
import { AppToWebViewMessageDispatcher } from '../../../views/connector/connector'
import { ChatItemFollowUp } from '@aws/mynah-ui-chat'

export class Messenger {
    public constructor(private readonly dispatcher: AppToWebViewMessageDispatcher) {}

    public sendAnswer(params: {
        message?: string
        type: 'answer' | 'answer-part' | 'answer-stream' | 'system-prompt'
        followUps?: ChatItemFollowUp[]
        tabID: string
        canBeVoted?: boolean
    }) {
        this.dispatcher.sendChatMessage(
            new ChatMessage(
                {
                    message: params.message,
                    messageType: params.type,
                    followUps: params.followUps,
                    relatedSuggestions: undefined,
                    canBeVoted: params.canBeVoted ?? false,
                },
                params.tabID
            )
        )
    }

    public sendErrorMessage(
        errorMessage: string,
        tabID: string,
        retries: number,
        phase: SessionStatePhase | undefined
    ) {
        if (retries === 0) {
            this.dispatcher.sendErrorMessage(
                new ErrorMessage(
                    `Sorry, we're unable to provide a response at this time. Please try again later or share feedback with our team to help us troubleshoot.`,
                    errorMessage,
                    tabID
                )
            )
            return
        }

        switch (phase) {
            case 'Approach':
                this.dispatcher.sendErrorMessage(
                    new ErrorMessage(
                        `Sorry, we're experiencing an issue on our side. Would you like to try again?`,
                        errorMessage,
                        tabID
                    )
                )
                break
            case 'Codegen':
                this.dispatcher.sendErrorMessage(
                    new ErrorMessage(
                        `Sorry, we're experiencing an issue on our side. Restarting generation...`,
                        errorMessage,
                        tabID
                    )
                )
                break
            default:
                this.dispatcher.sendErrorMessage(
                    new ErrorMessage(
                        `Sorry, we're experiencing an issue on our side. Would you like to try again?`,
                        errorMessage,
                        tabID
                    )
                )
                break
        }

        this.sendAnswer({
            message: undefined,
            type: 'system-prompt',
            followUps: [
                {
                    pillText: 'Retry',
                    type: FollowUpTypes.Retry,
                    status: 'warning',
                },
            ],
            tabID,
        })
    }

    public sendCodeResult(
        filePaths: string[],
        deletedFiles: string[],
        references: CodeReference[],
        tabID: string,
        uploadId: string
    ) {
        this.dispatcher.sendCodeResult(new CodeResultMessage(filePaths, deletedFiles, references, tabID, uploadId))
    }

    public sendAsyncEventProgress(tabID: string, inProgress: boolean, message: string | undefined) {
        this.dispatcher.sendAsyncEventProgress(new AsyncEventProgressMessage(tabID, inProgress, message))
    }

    public sendUpdatePlaceholder(tabID: string, newPlaceholder: string) {
        this.dispatcher.sendPlaceholder(new UpdatePlaceholderMessage(tabID, newPlaceholder))
    }

    public sendChatInputEnabled(tabID: string, enabled: boolean) {
        this.dispatcher.sendChatInputEnabled(new ChatInputEnabledMessage(tabID, enabled))
    }

    public sendAuthenticationUpdate(featureDevEnabled: boolean) {
        this.dispatcher.sendAuthenticationUpdate(new AuthenticationUpdateMessage(featureDevEnabled))
    }
}
