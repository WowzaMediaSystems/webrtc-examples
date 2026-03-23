export const validateParams = (settings) => {
  if (settings.applicationName.length === 0)
    throw new Error("Application name required");

  if (settings.streamName.length === 0)
    throw new Error("Stream name required");
}