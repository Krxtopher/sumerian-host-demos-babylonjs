import { BedrockRuntime } from "@aws-sdk/client-bedrock-runtime";

export async function handler(event) {
  // Log the event to CloudWatch for easier troubleshooting when things go wrong.
  console.log(`EVENT: ${JSON.stringify(event)}`);

  // Create the Bedrock runtime client we'll use invoke our text generation model.
  const bedrockRuntime = new BedrockRuntime();

  // Grab the prompt text that the user submitted.
  const { userPrompt } = event.queryStringParameters;

  const bodyConfig = {
    prompt: `\n\nHuman: ${userPrompt}.\n\nAssistant:`,
    max_tokens_to_sample: 300, // rough maximum for the response length
    temperature: 0.5, // 0-1. Higher values can increase randomness of word choices.
    top_k: 250, // Higher values can avoid repetition in the response.
    top_p: 0.5, // 0-1. Higher values increase word diversity.
    stop_sequences: ["\\n\\nHuman:"],
  };

  try {
    const response = await bedrockRuntime.invokeModel({
      // We're using Claude Instant because it responds quickly and is economical.
      modelId: "anthropic.claude-instant-v1",
      contentType: "application/json",
      body: JSON.stringify(bodyConfig),
    });
    const value = JSON.parse(response.body.transformToString());
    const completion = value.completion;

    return {
      statusCode: 200,
      // WARNING: The following header values allow this API to be called from any domain. Before
      // using this API in production, be sure to reduce the scope to just our own domain.
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
      },
      body: completion,
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: {
        // WARNING: The following header values allow this API to be called from any domain. Before
        // using this API in production, be sure to reduce the scope to just our own domain.
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
      },
      body: err,
    };
  }
}
