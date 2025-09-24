import ballerina/ai;
import ballerina/http;
import ballerina/log;
import ballerina/time;

listener ai:Listener 'listener = new (listenOn = check http:getDefaultListener());

service /api on 'listener {
    // isolated resource function post chat(http:Request request) returns ai:ChatRespMessage|error {
        resource function post chat(@http:Payload ai:ChatReqMessage request) returns ai:ChatRespMessage|error {
        ai:Context context = new;
        // context.set("headers", check extractMCPHeaders(request));

        // final ai:ChatReqMessage request = check (check request.getJsonPayload()).cloneWithType();

        log:printInfo(`Chat request received: ${request.message}`);
        final string stringResult = check agent.run(query = request.message, sessionId = request.sessionId, context = context);
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
