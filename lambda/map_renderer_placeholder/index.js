exports.handler = async (event = {}) => {
  const records = Array.isArray(event.Records) ? event.Records : [];

  if (records.length > 0) {
    console.warn("Map renderer placeholder received SQS records before renderer code was deployed.");
    return {
      batchItemFailures: records.map((record) => ({
        itemIdentifier: record.messageId,
      })),
    };
  }

  return {
    statusCode: 501,
    body: JSON.stringify({
      message: "Map renderer artifact has not been deployed yet.",
    }),
  };
};
