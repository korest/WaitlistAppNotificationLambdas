import * as AWS from "aws-sdk";
import * as SQS from "aws-sdk/clients/sqs";
import {GetQueueUrlRequest, SendMessageBatchRequest, SendMessageBatchRequestEntry} from "aws-sdk/clients/sqs";
import {DocumentClient} from "aws-sdk/lib/dynamodb/document_client";
import {ScheduledEvent} from "aws-lambda";
import AttributeMap = DocumentClient.AttributeMap;
import QueryInput = DocumentClient.QueryInput;

interface Waitee extends AttributeMap {
    id: string
    waitlistId: string
    name: string
    phoneNumber: string
}

async function produceEvent(event: ScheduledEvent, queueUrl: string, sqs: SQS, documentClient: DocumentClient) {
    console.log("Started process at ", new Date());

    const waiteesTableName = process.env.waiteesTableName || "";
    if (!waiteesTableName) {
        throw new Error("Table name must not be empty");
    }
    const notifyAtIndexName = process.env.notifyAtIndexName || "";
    if (!notifyAtIndexName) {
        throw new Error("Index name must not be empty");
    }

    const notifyAt = new Date();
    notifyAt.setMinutes(notifyAt.getMinutes() + 15, 0, 0);

    const queryWaiteesParams: QueryInput = {
        TableName: waiteesTableName,
        IndexName: notifyAtIndexName,
        KeyConditionExpression: "notifyAt = :notifyAt",
        ProjectionExpression: "id, waitlistId, #name, phoneNumber",
        ExpressionAttributeNames: {
            "#name": "name"
        },
        ExpressionAttributeValues: {
            ":notifyAt": notifyAt.getTime()
        }
    };

    const waiteesQuery = await documentClient.query(queryWaiteesParams).promise();
    const waiteesCount = waiteesQuery.Count || 0;
    console.log("Received ", waiteesCount, " waitees from db at ", notifyAt);

    const waitees = waiteesQuery.Items as Waitee[] || [];
    let batchEntries = [];
    for (let i = 0; i < waiteesCount; i++) {
        const waitee = waitees[i];
        const batchEntry: SendMessageBatchRequestEntry = {
            Id: waitee.id,
            MessageBody: JSON.stringify({
                "id": waitee.id,
                "waitlistId": waitee.waitlistId,
                "name": waitee.name,
                "phoneNumber": waitee.phoneNumber
            })
        };

        batchEntries.push(batchEntry);

        if (batchEntries.length == 10 || i == waiteesCount - 1) {
            const batchRequest: SendMessageBatchRequest = {
                QueueUrl: queueUrl,
                Entries: batchEntries
            };
            const response = await sqs.sendMessageBatch(batchRequest).promise();
            if (response.$response.httpResponse.statusCode != 200) {
                console.log("Failed to send batch: ", response.$response.error);
            } else {
                console.log("Sent batch at ", notifyAt);
            }

            batchEntries = [];
        }
    }

    console.log("Finished process at ", new Date());
}

export const producer = async (event: ScheduledEvent) => {
    const documentClient = new AWS.DynamoDB.DocumentClient();
    const sqs = new AWS.SQS();

    const getQueueUrlRequest: GetQueueUrlRequest = {
        QueueName: process.env.notificationQueueName || "",
    };

    const queueUrlResponse = await sqs.getQueueUrl(getQueueUrlRequest).promise();
    const queueUrl = queueUrlResponse.QueueUrl || "";
    if (queueUrl == "") {
        throw new Error("Queue url is empty: " + queueUrlResponse);
    }

    await produceEvent(event, queueUrl, sqs, documentClient);
};