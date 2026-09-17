(async () => {
    try {
        const module = await import("./vendor/discord-sdk.js?v=55");
        window.DiscordSDK = module.DiscordSDK;
        console.log("Discord SDK loaded");
    } catch (error) {
        console.warn("Discord SDK not available. Running in normal web mode.");
        console.warn(error);
        window.DiscordSDK = null;
    }
})();
