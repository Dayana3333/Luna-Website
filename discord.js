(async () => {
    try {
        const module = await import(
            "https://esm.sh/@discord/embedded-app-sdk"
        );

        if (!module || !module.DiscordSDK) {
            throw new Error("DiscordSDK export not found");
        }

        window.DiscordSDK = module.DiscordSDK;

        console.log("✅ Discord SDK loaded");
        console.log("DiscordSDK:", window.DiscordSDK);
    } catch (error) {
        console.error("❌ Discord SDK failed to load");
        console.error(error);
    }
})();