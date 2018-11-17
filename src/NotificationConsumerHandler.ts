import * as AWS from "aws-sdk";
import {SQSEvent} from "aws-lambda";
import {DocumentClient} from "aws-sdk/clients/dynamodb";
import UpdateItemInput = DocumentClient.UpdateItemInput;

interface WaiteeMessage {
    id: string
    waitlistId: string
    name: string
    phoneNumber: string
}

async function consumeEvent(event: SQSEvent, documentClient: DocumentClient) {
    console.log("Started process at ", new Date());

    const waiteesTableName = process.env.waiteesTableName || "";
    if (!waiteesTableName) {
        throw new Error("Table name must not be empty");
    }

    for (const record of event.Records) {
        const message: WaiteeMessage = JSON.parse(record.body);
        const updateWaiteeParams: UpdateItemInput = {
            TableName: waiteesTableName,
            Key: {
                "id": message.id,
                "waitlistId": message.waitlistId
            },
            UpdateExpression: "set notifiedAt = :notifiedAt",
            ExpressionAttributeValues: {
                ":notifiedAt": new Date().getTime()
            },
            ReturnValues: "NONE"
        };

        const updateResult = await documentClient.update(updateWaiteeParams).promise()
        if (updateResult.$response.httpResponse.statusCode != 200) {
            console.log("Error occurred while updating waitee ", message.id);
        }

        console.log("Updated waitee ", message.id);
    }

    console.log("Finished process at ", new Date());
}

export const consumer = async (event: SQSEvent) => {
    const documentClient = new AWS.DynamoDB.DocumentClient();
    return await consumeEvent(event, documentClient)
};