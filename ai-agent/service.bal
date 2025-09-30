import ballerina/ai;
import ballerina/http;
import ballerina/log;
import ballerina/time;

listener ai:Listener 'listener = new (listenOn = check http:getDefaultListener());

service /api on 'listener {
    // isolated resource function post chat(http:Request request) returns ai:ChatRespMessage|error {
        resource function post chat(@http:Payload ai:ChatReqMessage chatReqMessage) returns ai:ChatRespMessage|error {
        ai:Context context = new;
        map<string> headers = {};
        context.set("headers", headers);

        // final ai:ChatReqMessage chatReqMessage = check (check request.getJsonPayload()).cloneWithType();

        log:printInfo(`Chat request received: ${chatReqMessage.message}`);
        final string stringResult = check agent.run(query = chatReqMessage.message, sessionId = chatReqMessage.sessionId, context = context);
        log:printInfo(`Agent response: ${stringResult}`);
        return {message: stringResult};
    }

    resource function get health() returns record {|string status; string timestamp;|} {
        return {
            status: "OK",
            timestamp: time:utcToString(time:utcNow())
        };
    }
}
