/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { _Blob } from 'aws-sdk/clients/lambda'
import { readFileSync } from 'fs'
import * as _ from 'lodash'
import * as vscode from 'vscode'
import { DefaultLambdaClient, LambdaClient } from '../../../shared/clients/lambdaClient'
import * as picker from '../../../shared/ui/picker'
import { ExtContext } from '../../../shared/extensions'

import { getLogger } from '../../../shared/logger'
import { HttpResourceFetcher } from '../../../shared/resourcefetcher/httpResourceFetcher'
import { sampleRequestPath } from '../../constants'
import { LambdaFunctionNode } from '../../explorer/lambdaFunctionNode'
import { getSampleLambdaPayloads, SampleRequest } from '../../utils'

import * as nls from 'vscode-nls'
import { VueWebview } from '../../../webviews/main'
import { telemetry } from '../../../shared/telemetry/telemetry'
import { Result } from '../../../shared/telemetry/telemetry'
import {
    runSamCliRemoteTestEvents,
    SamCliRemoteTestEventsParameters,
    TestEventsOperation,
} from '../../../shared/sam/cli/samCliRemoteTestEvent'
import { getSamCliContext } from '../../../shared/sam/cli/samCliContext'
import { type DeployedResource } from '../../../shared/applicationBuilder/explorer/nodes/deployedNode'
import { isTreeNode, type TreeNode } from '../../../shared/treeview/resourceTreeDataProvider'
import { ToolkitError } from '../../../shared'
import { basename } from 'path'

const localize = nls.loadMessageBundle()

type Event = {
    name: string
    region: string
    arn: string
    event?: string
}

export interface InitialData {
    FunctionName: string
    FunctionArn: string
    FunctionRegion: string
    InputSamples: SampleRequest[]
    TestEvents?: string[]
    Source?: string
}

export interface RemoteInvokeData {
    initialData: InitialData
    selectedSampleRequest: string
    sampleText: string
    selectedFile: string
    selectedFilePath: string
    selectedTestEvent: string
    payload: string
    showNameInput: boolean
    newTestEventName: string
    selectedFunction: string
}
interface SampleQuickPickItem extends vscode.QuickPickItem {
    filename: string
}

export class RemoteInvokeWebview extends VueWebview {
    public static readonly sourcePath: string = 'src/lambda/vue/remoteInvoke/index.js'
    public readonly id = 'remoteInvoke'

    public constructor(
        private readonly channel: vscode.OutputChannel,
        private readonly client: LambdaClient,
        private readonly data: InitialData
    ) {
        super(RemoteInvokeWebview.sourcePath)
    }

    public init() {
        return this.data
    }

    public async invokeLambda(input: string, source?: string): Promise<void> {
        let result: Result = 'Succeeded'

        this.channel.show()
        this.channel.appendLine('Loading response...')

        try {
            const funcResponse = await this.client.invoke(this.data.FunctionArn, input)
            const logs = funcResponse.LogResult ? Buffer.from(funcResponse.LogResult, 'base64').toString() : ''
            const payload = funcResponse.Payload ? funcResponse.Payload : JSON.stringify({})

            this.channel.appendLine(`Invocation result for ${this.data.FunctionArn}`)
            this.channel.appendLine('Logs:')
            this.channel.appendLine(logs)
            this.channel.appendLine('')
            this.channel.appendLine('Payload:')
            this.channel.appendLine(String(payload))
            this.channel.appendLine('')
        } catch (e) {
            const error = e as Error
            this.channel.appendLine(`There was an error invoking ${this.data.FunctionArn}`)
            this.channel.appendLine(error.toString())
            this.channel.appendLine('')
            result = 'Failed'
        } finally {
            telemetry.lambda_invokeRemote.emit({ result, passive: false, source: source })
        }
    }

    public async getSample(requestName: string) {
        const sampleUrl = `${sampleRequestPath}${requestName}`
        const sample = (await new HttpResourceFetcher(sampleUrl, { showUrl: true }).get()) ?? ''

        return sample
    }

    public async promptFile() {
        const fileLocations = await vscode.window.showOpenDialog({
            openLabel: 'Open',
        })

        if (!fileLocations || fileLocations.length === 0) {
            return undefined
        }

        try {
            const fileContent = readFileSync(fileLocations[0].fsPath, { encoding: 'utf8' })
            return {
                sample: fileContent,
                selectedFilePath: fileLocations[0].path,
                selectedFile: this.getFileName(fileLocations[0].path),
            }
        } catch (e) {
            getLogger().error('readFileSync: Failed to read file at path %O', fileLocations[0].fsPath, e)
            throw ToolkitError.chain(e, 'Failed to read selected file')
        }
    }

    public async reloadFile(fileLocations: string) {
        return await this.readFile(fileLocations)
    }

    private async readFile(filePath: string) {
        if (!filePath) {
            return undefined
        }
        const fileLocation = vscode.Uri.file(filePath)
        try {
            const fileContent = readFileSync(fileLocation.fsPath, { encoding: 'utf8' })

            return {
                sample: fileContent,
                selectedFilePath: fileLocation.fsPath,
                selectedFile: this.getFileName(fileLocation.fsPath),
            }
        } catch (e) {
            getLogger().error('readFileSync: Failed to read file at path %O', fileLocation.fsPath, e)
            throw ToolkitError.chain(e, 'Failed to read selected file')
        }
    }

    private getFileName(filePath: string): string {
        return basename(filePath)
    }

    public async listRemoteTestEvents(arn: string, region: string): Promise<string[]> {
        return await listRemoteTestEvents(arn, region)
    }

    public async createRemoteTestEvents(putEvent: Event) {
        const params: SamCliRemoteTestEventsParameters = {
            functionArn: putEvent.arn,
            operation: TestEventsOperation.Put,
            name: putEvent.name,
            eventSample: putEvent.event,
            region: putEvent.region,
        }
        return await this.remoteTestEvents(params)
    }
    public async getRemoteTestEvents(getEvents: Event) {
        const params: SamCliRemoteTestEventsParameters = {
            name: getEvents.name,
            operation: TestEventsOperation.Get,
            functionArn: getEvents.arn,
            region: getEvents.region,
        }
        return await this.remoteTestEvents(params)
    }

    private async remoteTestEvents(params: SamCliRemoteTestEventsParameters) {
        return await runSamCliRemoteTestEvents(params, getSamCliContext().invoker)
    }

    public async getSamplePayload(): Promise<string | undefined> {
        try {
            const inputs: SampleQuickPickItem[] = (await getSampleLambdaPayloads()).map((entry) => {
                return { label: entry.name ?? '', filename: entry.filename ?? '' }
            })

            const qp = picker.createQuickPick({
                items: inputs,
                options: {
                    title: localize(
                        'AWS.lambda.form.pickSampleInput',
                        'Enter keywords to filter the list of sample events'
                    ),
                },
            })

            const choices = await picker.promptUser({
                picker: qp,
            })
            const pickerResponse = picker.verifySinglePickerOutput<SampleQuickPickItem>(choices)

            if (!pickerResponse) {
                return
            }
            const sampleUrl = `${sampleRequestPath}${pickerResponse.filename}`
            const sample = (await new HttpResourceFetcher(sampleUrl, { showUrl: true }).get()) ?? ''

            return sample
        } catch (err) {
            getLogger().error('Error getting manifest data..: %O', err as Error)
            throw ToolkitError.chain(err, 'getting manifest data')
        }
    }
}

const Panel = VueWebview.compilePanel(RemoteInvokeWebview)

export async function invokeRemoteLambda(
    context: ExtContext,
    params: {
        /* TODO: Instead of vague scope-leaking objects: awsContext & element, it would be cleaner if this took:
         *  {
         *      lambdaClient: LambdaClient,         // or just invoke/invokeAsync interface of AWS.Lambda (see: lambda.d.ts)
         *      invokeParams: {functionArn: string} // or Lambda.Types.InvocationRequest (see: lambda.d.ts)
         *  }
         */
        outputChannel: vscode.OutputChannel
        functionNode: LambdaFunctionNode | TreeNode
    }
) {
    const inputs = await getSampleLambdaPayloads()
    let resource: any = params.functionNode
    let remoteTestsEventsList: string[] = []
    let source: string = 'AwsExplorerRemoteInvoke'
    let functionArn: string | undefined
    if (isTreeNode(params.functionNode)) {
        resource = params.functionNode.resource as DeployedResource
        functionArn = resource.configuration.FunctionArn
        source = 'AppBuilderRemoteInvoke'
    } else {
        functionArn = params.functionNode.configuration.FunctionArn
    }
    try {
        remoteTestsEventsList = functionArn ? await listRemoteTestEvents(functionArn, resource.regionCode) : []
    } catch (err) {
        getLogger().error('InvokeLambda: Error listing remote test events:', err)
    }
    const client = new DefaultLambdaClient(resource.regionCode)
    const wv = new Panel(context.extensionContext, context.outputChannel, client, {
        FunctionName: resource.configuration.FunctionName ?? '',
        FunctionArn: resource.configuration.FunctionArn ?? '',
        FunctionRegion: resource.regionCode,
        InputSamples: inputs,
        TestEvents: remoteTestsEventsList,
        Source: source,
    })

    await wv.show({
        title: localize('AWS.invokeLambda.title', 'Invoke Lambda {0}', resource.configuration.FunctionName),
    })
}

export async function listRemoteTestEvents(arn: string, region: string): Promise<string[]> {
    try {
        const params: SamCliRemoteTestEventsParameters = {
            functionArn: arn,
            operation: TestEventsOperation.List,
            region: region,
        }
        const result = await runSamCliRemoteTestEvents(params, getSamCliContext().invoker)
        return result.split('\n')
    } catch (err) {
        getLogger().debug('Error listing remote test events:', err)
        return []
    }
}
