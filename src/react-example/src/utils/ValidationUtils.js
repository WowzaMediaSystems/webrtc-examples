export const validateParams = (settings) => {
  if (settings.applicationName.length === 0)
    throw { message: "Application name required" };

  if (settings.streamName.length === 0)
    throw { message: "Stream name required" };
}