(async () => {
    try {
        const module = await import("https://esm.sh/@discord/embedded-app-sdk");
        window.DiscordSDK = module.DiscordSDK;
        console.log("Discord SDK loaded");
    } catch (error) {
        console.warn("Discord SDK not available. Running in normal web mode.");
        console.warn(error);
        window.DiscordSDK = null;
    }
})();